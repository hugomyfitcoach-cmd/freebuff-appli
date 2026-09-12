import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser, localTodayISO } from "./helpers";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { recordEvent } from "./notifications";

/**
 * Suivi corporel (progression) : poids, tour de cou, tour de taille et
 * circonférence des fessiers, enregistrés par date (une ligne par jour),
 * plus la taille (cm) stockée sur le profil.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateISO(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent enregistrer leur progression.");
	}
	return user;
}

/** Résout la cible d'une action coach : vérifie le rôle coach + le client visé. */
async function resolveCoachTarget(
	ctx: Pick<QueryCtx, "db">,
	sessionToken: string | undefined | null,
	userId: import("./_generated/dataModel").Id<"users">
): Promise<import("./_generated/dataModel").Doc<"users">> {
	const coach = await getSessionUser(ctx, sessionToken);
	if (!coach) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (coach.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
	const target = await ctx.db.get(userId);
	if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
	return target;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ───────────────── Masse grasse estimée (US Navy femme) ─────────────────
   SOURCE DE VÉRITÉ UNIQUE : ce calcul alimente l'espace cliente
   (Ma progression) ET le CRM (Vision 360) — les deux ne peuvent pas
   diverger. Rien n'est stocké : chaque point d'historique est dérivé des
   DERNIÈRES valeurs connues des mensurations (tour de taille, fessiers,
   tour de cou) et de la taille (hauteur) — les mesures n'ont pas besoin
   d'avoir été prises le même jour. */

const CM_PER_INCH = 2.54;

/** US Navy femme — formule en pouces (1 in = 2,54 cm), garde-fou 2–70 %. */
export function usNavyBodyFat(
	waistCm: number,
	hipCm: number,
	neckCm: number,
	heightCm: number
): number | null {
	const toIn = (cm: number) => cm / CM_PER_INCH;
	const w = toIn(waistCm);
	const h = toIn(hipCm);
	const n = toIn(neckCm);
	const ht = toIn(heightCm);
	if (!(w + h > n) || !(ht > 0)) return null;
	const pct = 163.205 * Math.log10(w + h - n) - 97.684 * Math.log10(ht) - 78.387;
	return isFinite(pct) && pct >= 2 && pct <= 70 ? round1(pct) : null;
}

/**
 * Historique dérivé : à chaque jour où UNE mesure (taille, fessiers, cou ou
 * hauteur) est ajoutée ou modifiée, on recalcule la masse grasse avec les
 * DERNIÈRES valeurs connues à cette date des autres mesures (report en
 * avant). Aucune exigence que les mesures partagent la même date : dès
 * qu'une valeur change, un nouveau point apparaît (ou est recalculé).
 */
export function bodyFatSeries(
	rows: Pick<Doc<"bodyMetrics">, "date" | "waistCm" | "hipCm" | "neckCm" | "heightCm">[],
	heightCm: number | null
): { date: string; value: number }[] {
	const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
	/* Dernières valeurs connues (report en avant) ; la hauteur part de la
	   valeur du profil puis suit l'historique journalisé de la taille. */
	let waist: number | undefined;
	let hip: number | undefined;
	let neck: number | undefined;
	let height: number | undefined = heightCm ?? undefined;
	const out: { date: string; value: number }[] = [];
	for (const m of sorted) {
		/* Une ligne « poids seul » ne crée jamais de point : seules les mesures
		   entrant dans le calcul (taille, fessiers, cou, hauteur) le déclenchent. */
		const relevant =
			m.waistCm !== undefined || m.hipCm !== undefined || m.neckCm !== undefined || m.heightCm !== undefined;
		if (m.waistCm !== undefined) waist = m.waistCm;
		if (m.hipCm !== undefined) hip = m.hipCm;
		if (m.neckCm !== undefined) neck = m.neckCm;
		if (m.heightCm !== undefined) height = m.heightCm;
		if (!relevant) continue;
		if (waist === undefined || hip === undefined || neck === undefined || height === undefined) continue;
		const v = usNavyBodyFat(waist, hip, neck, height);
		if (v !== null) out.push({ date: m.date, value: v });
	}
	return out;
}

/** Journalise la taille (cm) dans bodyMetrics — historique daté de la taille. */
export async function logHeightRow(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">,
	heightCm: number
): Promise<void> {
	const date = localTodayISO();
	const existing = await ctx.db
		.query("bodyMetrics")
		.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
		.first();
	if (existing) await ctx.db.patch(existing._id, { heightCm });
	else await ctx.db.insert("bodyMetrics", { userId, date, heightCm, createdAt: Date.now() });
}

function clampValue(n: number, min: number, max: number, label: string): number {
	if (!isFinite(n)) throw new ConvexError(`${label} invalide.`);
	if (n < min || n > max) throw new ConvexError(`${label} doit être entre ${min} et ${max}.`);
	return round1(n);
}

/** Une clé de métrique : poids ou l'une des trois mensurations. */
export const metricKey = v.union(
	v.literal("weightKg"),
	v.literal("neckCm"),
	v.literal("waistCm"),
	v.literal("hipCm")
);
type MetricKey = "weightKg" | "neckCm" | "waistCm" | "hipCm";

const METRIC_RANGE: Record<MetricKey, [number, number, string]> = {
	weightKg: [30, 350, "Le poids"],
	neckCm: [20, 80, "Le tour de cou"],
	waistCm: [40, 250, "Le tour de taille"],
	hipCm: [50, 300, "La circonférence des fessiers"],
};

const fmtMesure = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Description CRM d'un nouveau poids (ex. « Poids : 62,4 kg »). */
function poidsDescription(kg: number): string {
	return `Poids : ${fmtMesure(kg)} kg`;
}

/** Description CRM de nouvelles mensurations (seuls les champs saisis sont listés). */
function mesuresDescription(m: { neckCm?: number; waistCm?: number; hipCm?: number }): string {
	const parts: string[] = [];
	if (m.neckCm !== undefined) parts.push(`cou ${fmtMesure(m.neckCm)} cm`);
	if (m.waistCm !== undefined) parts.push(`taille ${fmtMesure(m.waistCm)} cm`);
	if (m.hipCm !== undefined) parts.push(`fessiers ${fmtMesure(m.hipCm)} cm`);
	return `Mensurations : ${parts.join(", ")}`;
}

/**
 * Journalise les événements CRM « nouveau poids » / « nouvelles mensurations »
 * pour la cliente concernée — uniquement quand une valeur RÉELLE est écrite.
 * Appelé depuis les écritures de la cliente (l'espace de suivi) : une saisie
 * de la coach elle-même (upsertForCoach / updateOneForCoach) n'est pas de
 * l'activité cliente et ne génère jamais de notification.
 */
async function recordCoachNotifs(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">,
	patch: { weightKg?: number; neckCm?: number; waistCm?: number; hipCm?: number }
): Promise<void> {
	const { weightKg, ...mens } = patch;
	const hasMens = mens.neckCm !== undefined || mens.waistCm !== undefined || mens.hipCm !== undefined;
	if (weightKg !== undefined) {
		await recordEvent(ctx, userId, "nouveau_poids", poidsDescription(weightKg));
	}
	if (hasMens) {
		await recordEvent(ctx, userId, "nouvelles_mesures", mesuresDescription(mens));
	}
}

function patchMetric(metric: MetricKey, value: number | undefined) {
	if (metric === "weightKg") return { weightKg: value };
	if (metric === "neckCm") return { neckCm: value };
	if (metric === "waistCm") return { waistCm: value };
	return { hipCm: value };
}

/* Variantes coach (CRM) : la coach consulte et corrige les mensurations/
   poids d'un client, « en doublon » avec lui. */

/** Toutes les prises d'un client donné (réservé coach) + masse grasse estimée. */
export const listForCoach = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		const target = await resolveCoachTarget(ctx, sessionToken, userId);
		const rows = await ctx.db.query("bodyMetrics").withIndex("by_user", (q) => q.eq("userId", userId)).order("asc").collect();
		// Tri par date de mesure (l'index by_user suit l'ordre de création) : une
		// saisie rétrodatée reste à sa place chronologique — « dernière valeur » =
		// date la plus récente, partout côté coach.
		rows.sort((a, b) => a.date.localeCompare(b.date));
		return {
			heightCm: target.heightCm ?? null,
			measurements: rows,
			bodyFat: bodyFatSeries(rows, target.heightCm ?? null),
		};
	},
});

/** Enregistre / met à jour une prise pour un client (réservé coach). */
export const upsertForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		date: v.string(),
		weightKg: v.optional(v.number()),
		neckCm: v.optional(v.number()),
		waistCm: v.optional(v.number()),
		hipCm: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, userId, date, weightKg, neckCm, waistCm, hipCm }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const patch: Partial<Doc<"bodyMetrics">> = {};
		if (weightKg !== undefined) patch.weightKg = clampValue(weightKg, 30, 350, "Le poids");
		if (neckCm !== undefined) patch.neckCm = clampValue(neckCm, 20, 80, "Le tour de cou");
		if (waistCm !== undefined) patch.waistCm = clampValue(waistCm, 40, 250, "Le tour de taille");
		if (hipCm !== undefined) patch.hipCm = clampValue(hipCm, 50, 300, "La circonférence des fessiers");
		if (Object.keys(patch).length === 0) throw new ConvexError("Saisis au moins une mesure.");
		const existing = await ctx.db.query("bodyMetrics").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).first();
		if (existing) await ctx.db.patch(existing._id, patch);
		else await ctx.db.insert("bodyMetrics", { userId, date, ...patch, createdAt: Date.now() });
		return { ok: true };
	},
});

/** Modifie UNE métrique d'une date pour un client (réservé coach). */
export const updateOneForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		date: v.string(),
		metric: metricKey,
		value: v.number(),
	},
	handler: async (ctx, { sessionToken, userId, date, metric, value }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const [min, max, label] = METRIC_RANGE[metric];
		const val = clampValue(value, min, max, label);
		const existing = await ctx.db.query("bodyMetrics").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).first();
		const patch = patchMetric(metric, val);
		if (existing) await ctx.db.patch(existing._id, patch);
		else await ctx.db.insert("bodyMetrics", { userId, date, ...patch, createdAt: Date.now() });
		return { ok: true };
	},
});

/** Supprime UNE métrique d'une date pour un client (réservé coach). */
export const deleteOneForCoach = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		date: v.string(),
		metric: metricKey,
	},
	handler: async (ctx, { sessionToken, userId, date, metric }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const existing = await ctx.db.query("bodyMetrics").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date)).first();
		if (!existing) return { ok: true };
		await ctx.db.patch(existing._id, patchMetric(metric, undefined));
		const after = await ctx.db.get(existing._id);
		if (after && after.weightKg === undefined && after.neckCm === undefined && after.waistCm === undefined && after.hipCm === undefined) {
			await ctx.db.delete(existing._id);
		}
		return { ok: true };
	},
});

/** Enregistre la taille (cm) d'un client (réservé coach) + historique daté. */
export const saveHeightForCoach = mutation({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users"), heightCm: v.number() },
	handler: async (ctx, { sessionToken, userId, heightCm }) => {
		await resolveCoachTarget(ctx, sessionToken, userId);
		const h = clampValue(heightCm, 80, 250, "La taille");
		await ctx.db.patch(userId, { heightCm: h });
		await logHeightRow(ctx, userId, h);
		return { ok: true };
	},
});

/** Toutes les prises de mesures du client (du plus ancien au plus récent) + sa taille + masse grasse estimée. */
export const list = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("asc")
			.collect();
		// Tri par date de mesure (voir listForCoach) — l'espace cliente applique
		// le même ordre chronologique que le CRM.
		rows.sort((a, b) => a.date.localeCompare(b.date));
		return {
			heightCm: user.heightCm ?? null,
			measurements: rows,
			bodyFat: bodyFatSeries(rows, user.heightCm ?? null),
		};
	},
});

/**
 * Enregistre / met à jour la prise du jour. On ne fournit que les champs à
 * écrire : une ligne par date, les champs déjà saisis sont conservés.
 */
export const upsert = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		weightKg: v.optional(v.number()),
		neckCm: v.optional(v.number()),
		waistCm: v.optional(v.number()),
		hipCm: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, date, weightKg, neckCm, waistCm, hipCm }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");

		const patch: Partial<Doc<"bodyMetrics">> = {};
		if (weightKg !== undefined) patch.weightKg = clampValue(weightKg, 30, 350, "Le poids");
		if (neckCm !== undefined) patch.neckCm = clampValue(neckCm, 20, 80, "Le tour de cou");
		if (waistCm !== undefined) patch.waistCm = clampValue(waistCm, 40, 250, "Le tour de taille");
		if (hipCm !== undefined) patch.hipCm = clampValue(hipCm, 50, 300, "La circonférence des fessiers");
		if (Object.keys(patch).length === 0) {
			throw new ConvexError("Saisis au moins une mesure.");
		}

		const existing = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, patch);
		} else {
			await ctx.db.insert("bodyMetrics", {
				userId: user._id,
				date,
				...patch,
				createdAt: Date.now(),
			});
		}
		await recordCoachNotifs(ctx, user._id, patch);
		return { ok: true };
	},
});

/**
 * Modifie UNE métrique sur une date donnée (les autres du même jour sont
 * conservées). Sert à corriger une valeur erronée depuis la courbe.
 */
export const updateOne = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		metric: metricKey,
		value: v.number(),
	},
	handler: async (ctx, { sessionToken, date, metric, value }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const [min, max, label] = METRIC_RANGE[metric];
		const val = clampValue(value, min, max, label);
		const existing = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
			.first();
		const patch = patchMetric(metric, val);
		if (existing) {
			await ctx.db.patch(existing._id, patch);
		} else {
			await ctx.db.insert("bodyMetrics", { userId: user._id, date, ...patch, createdAt: Date.now() });
		}
		await recordCoachNotifs(ctx, user._id, patch);
		return { ok: true };
	},
});

/**
 * Supprime UNE métrique d'une date donnée. Si le jour n'a plus aucune
 * mesure, la ligne entière est supprimée.
 */
export const deleteOne = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		metric: metricKey,
	},
	handler: async (ctx, { sessionToken, date, metric }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!isValidDateISO(date)) throw new ConvexError("Date invalide.");
		const existing = await ctx.db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
			.first();
		if (!existing) return { ok: true };
		await ctx.db.patch(existing._id, patchMetric(metric, undefined));
		const after = await ctx.db.get(existing._id);
		if (
			after &&
			after.weightKg === undefined &&
			after.neckCm === undefined &&
			after.waistCm === undefined &&
			after.hipCm === undefined
		) {
			await ctx.db.delete(existing._id);
		}
		return { ok: true };
	},
});

/** Enregistre la taille (cm) sur le profil du client + historique daté. */
export const saveHeight = mutation({
	args: { sessionToken: v.optional(v.string()), heightCm: v.number() },
	handler: async (ctx, { sessionToken, heightCm }) => {
		const user = await requireClient(ctx, sessionToken);
		const h = clampValue(heightCm, 80, 250, "La taille");
		await ctx.db.patch(user._id, { heightCm: h });
		await logHeightRow(ctx, user._id, h);
		return { ok: true };
	},
});