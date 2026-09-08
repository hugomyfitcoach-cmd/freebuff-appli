/**
 * Primitives d'authentification — fonctionnent dans le runtime par défaut
 * de Convex (isolate) via Web Crypto (pas d'API Node.js) :
 * PBKDF2-SHA256 avec sel aléatoire par compte pour les mots de passe,
 * SHA-256 pour l'empreinte des jetons de session.
 */
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/** Durée de vie d'une session (30 jours). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Itérations PBKDF2 (compromis coût/sécurité raisonnable pour un CRM). */
const PBKDF2_ITERATIONS = 210_000;

const te = new TextEncoder();

function hex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

function fromHex(s: string): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function randomBytesHex(n: number): string {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return hex(b);
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
	return hex(new Uint8Array(digest));
}

/* ── Email ─────────────────────────────────────────────────────────── */

/** Normalise un email pour le stockage et les recherches (minuscules, sans espaces). */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ── Mots de passe (PBKDF2-SHA256, sel aléatoire par compte) ───────── */

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytesHex(16);
	const key = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations: PBKDF2_ITERATIONS },
		key,
		256
	);
	const hash = hex(new Uint8Array(bits));
	return `pbkdf2:sha256:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
	const parts = stored.split(":");
	if (parts.length !== 5 || parts[0] !== "pbkdf2") return false;
	const [, , iterationsStr, salt, expectedHash] = parts;
	const iterations = Number(iterationsStr);
	if (!Number.isInteger(iterations) || iterations < 1) return false;
	const key = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations },
		key,
		256
	);
	const hash = hex(new Uint8Array(bits));
	// Comparaison par empreinte pour éviter toute fuite de longueur/format.
	return (await sha256Hex(te.encode(hash))) === (await sha256Hex(te.encode(expectedHash)));
}

/* ── Sessions ──────────────────────────────────────────────────────── */

/** Jeton de session opaque (envoyé au navigateur, stocké uniquement hashé). */
export function newSessionToken(): string {
	return randomBytesHex(32);
}

export async function hashToken(token: string): Promise<string> {
	return sha256Hex(te.encode(token));
}

export type SessionUser = Doc<"users">;

/**
 * Résout un jeton de session vers l'utilisateur, ou `null`.
 * Vérifie l'existence + l'expiration + le compte (actif). Lecture seule —
 * le jeton n'est jamais stocké, seulement son empreinte SHA-256.
 */
export async function getSessionUser(
	ctx: Pick<QueryCtx, "db">,
	sessionToken: string | undefined | null
): Promise<SessionUser | null> {
	if (!sessionToken) return null;
	const tokenHash = await hashToken(sessionToken);
	const row = await ctx.db
		.query("sessions")
		.withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
		.unique();
	if (!row || row.expiresAt < Date.now()) return null;
	const user = await ctx.db.get(row.userId);
	if (!user || user.disabled) return null;
	return user;
}

/* ── Semaines (mêmes règles que le formulaire d'origine) ───────────── */

/** Numéro de semaine ISO d'une date UTC (réplique du calcul du HTML d'origine). */
export function getWeekNumber(dateUtc: Date): number {
	const d = new Date(Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth(), dateUtc.getUTCDate()));
	d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Formate un lundi ISO ("2026-09-07") en libellé du HTML d'origine : "S37 - 07 sept. 2026". */
export function formatWeekLabel(weekStartISO: string): string {
	const [y, m, d] = weekStartISO.split("-").map(Number);
	const dateUtc = new Date(Date.UTC(y, m - 1, d));
	const label = dateUtc.toLocaleDateString("fr-FR", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
	return `S${getWeekNumber(dateUtc)} - ${label}`;
}

/* ── Dates locales (mêmes conventions que le reste de l'app : "yyyy-mm-dd") ── */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const TZ_NAME_RE = /^[A-Za-z_]+\/[A-Za-z_+\-]+$/;

/** Valide un nom de fuseau IANA (ex. "Europe/Paris") — jamais de valeur arbitraire stockée. */
export function validTimeZone(tz: string | null | undefined): string | null {
	if (!tz || !TZ_NAME_RE.test(tz)) return null;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return tz;
	} catch {
		return null;
	}
}

/**
 * Instant (ms UTC) du MINUIT local suivant `ts` dans le fuseau `timeZone`
 * (ex. "Europe/Paris") : le message du jour publié le jour local D expire au
 * passage à D+1 — calculé dans le fuseau de la cliente, pas dans celui du
 * serveur. Utilise l'ICU complet du runtime (vérifié sur le déploiement).
 */
export function nextMidnightUtcMs(ts: number, timeZone: string): number {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const wallAt = (t: number) => {
		const p = fmt.formatToParts(new Date(t));
		const g = (type: string) => Number(p.find((x) => x.type === type)?.value ?? "0");
		return {
			year: g("year"),
			month: g("month"),
			day: g("day"),
			hour: g("hour"),
			minute: g("minute"),
			second: g("second"),
		};
	};
	// Heure locale de publication, puis minuit local du lendemain en UTC-naïf.
	const a = wallAt(ts);
	const target = Date.UTC(a.year, a.month - 1, a.day + 1); // 00:00:00 local (naïf)
	// Corrige par l'offset réel du fuseau au voisinage (1-2 itérations, DST inclus) :
	// offset = wallNaive - guess, et on cherche guess tel que guess + offset = target.
	let guess = target;
	for (let i = 0; i < 4; i++) {
		const w = wallAt(guess);
		const wallNaive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
		const offset = wallNaive - guess;
		const next = target - offset;
		if (next === guess) break;
		guess = next;
	}
	return guess;
}

/** Date du jour au format "yyyy-mm-dd" (fuseau du serveur). */
export function localTodayISO(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Ajoute n jours à une date ISO (arithmétique UTC, insensible à l'heure d'été). */
export function addDaysISO(iso: string, days: number): string {
	const m = ISO_RE.exec(iso);
	if (!m) return iso;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
	return d.toISOString().slice(0, 10);
}

/** Ajoute n mois à une date ISO (jour plafonné au dernier jour du mois cible). */
export function addMonthsISO(iso: string, months: number): string {
	const m = ISO_RE.exec(iso);
	if (!m) return iso;
	const day = Number(m[3]);
	const first = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, 1));
	const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
	first.setUTCDate(Math.min(day, lastDay));
	return first.toISOString().slice(0, 10);
}

/** Lundi de la semaine d'une date ISO (mêmes règles que week.ts côté client). */
export function mondayISOof(iso: string): string {
	const m = ISO_RE.exec(iso);
	if (!m) return iso;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	const day = d.getUTCDay();
	d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
	return d.toISOString().slice(0, 10);
}

/** Nombre de jours entre deux dates ISO (a - b ; négatif si a < b). */
export function daysBetweenISO(a: string, b: string): number {
	const ma = ISO_RE.exec(a);
	const mb = ISO_RE.exec(b);
	if (!ma || !mb) return 0;
	const da = new Date(Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3])));
	const db = new Date(Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3])));
	return Math.round((da.getTime() - db.getTime()) / 86400000);
}

/** Mois entiers écoulés entre b (début) et a (aujourd'hui), plancher à 0. */
export function monthsBetweenISO(a: string, b: string): number {
	const ma = ISO_RE.exec(a);
	const mb = ISO_RE.exec(b);
	if (!ma || !mb) return 0;
	let months = (Number(ma[1]) - Number(mb[1])) * 12 + (Number(ma[2]) - Number(mb[2]));
	if (Number(ma[3]) < Number(mb[3])) months -= 1;
	return Math.max(0, months);
}

/** Fenêtre du bilan hebdo : vendredi ≥ 9h → dimanche < 12h (heure locale serveur). */
export function isBilanWindowOpen(now: Date = new Date()): boolean {
	const day = now.getDay();
	const hours = now.getHours();
	if (day === 5 && hours >= 9) return true; // vendredi dès 9h
	if (day === 6) return true; // samedi toute la journée
	if (day === 0 && hours < 12) return true; // dimanche avant 12h
	return false;
}

/**
 * Lundi de la semaine du dernier bilan hebdo dont la fenêtre est fermée
 * (dimanche passé à ≥ 12h). Sert de référence pour détecter les bilans
 * manquants sans stocker d'état : la règle est purement dérivée des dates.
 */
export function lastClosedBilanWeekStart(now: Date = new Date()): string {
	const today = localTodayISO(now);
	const curMonday = mondayISOof(today);
	const sunday = addDaysISO(curMonday, 6);
	const [y, m, d] = sunday.split("-").map(Number);
	const closedAt = Date.UTC(y, m - 1, d, 12, 0, 0);
	// Si l'on est passé après dimanche 12h (heure locale serveur), la semaine
	// courante est fermée ; sinon la dernière fermée est la précédente.
	return now.getTime() >= closedAt ? curMonday : addDaysISO(curMonday, -7);
}

/** Vérifie qu'une chaîne est un lundi ISO valide ("yyyy-mm-dd"). */
export function isMondayISO(s: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!match) return false;
	const dateUtc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
	return (
		dateUtc.getUTCDay() === 1 &&
		dateUtc.getUTCFullYear() === Number(match[1]) &&
		dateUtc.getUTCMonth() === Number(match[2]) - 1 &&
		Number(match[3]) === dateUtc.getUTCDate()
	);
}
