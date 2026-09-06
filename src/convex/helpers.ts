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
