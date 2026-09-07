import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getSessionUser } from "./helpers";

/**
 * Onboarding de démarrage côté cliente.
 *
 * Deux étapes, suivies automatiquement — aucune deuxième source de vérité :
 *  - Étape 1 « Formulaire de démarrage » : table `intakes` (une ligne par
 *    cliente), statut `draft` (brouillon, invisible au coach comme soumis) ou
 *    `submitted`. L'identité vient du compte (userId), jamais re-saisie.
 *  - Étape 2 « Mensurations & photos » : réutilise les données existantes
 *    (`bodyMetrics` + `progressPhotos`) — mêmes règles que l'app :
 *      · mensurations faites = un relevé contenant au moins une mensuration ;
 *      · photos faites = une série « demarrage » envoyée.
 *
 * L'activation est décidée par le coach (users.onboardingEnabled) ; désactiver
 * ne supprime jamais de données, réactiver réutilise les statuts existants.
 */

type IntakeRow = Doc<"intakes">;
type DbOnly = { db: QueryCtx["db"] };

async function me(ctx: DbOnly, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	return user;
}

async function coach(ctx: DbOnly, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

/* ── Règles de complétion (partagées dashboard cliente / CRM) ─────────── */

export function mensurationsDone(metrics: { waistCm?: number | null; hipCm?: number | null; neckCm?: number | null }[]): boolean {
	// Même règle que le reste de l'app : un relevé contenant au moins une
	// mensuration compte comme « mensurations renseignées ».
	return metrics.some((m) => m.waistCm != null || m.hipCm != null || m.neckCm != null);
}

export function photosDemarrageDone(photos: { step: string; photos: unknown[] }[]): boolean {
	// Même règle que le module photos : une série « demarrage » d'au moins une photo.
	return photos.some((p) => p.step === "demarrage" && p.photos.length >= 1);
}

/** Étape 2 (mensurations & photos) terminée, uniquement sur les données réelles. */
export function step2Done(
	metrics: { waistCm?: number | null; hipCm?: number | null; neckCm?: number | null }[],
	photos: { step: string; photos: unknown[] }[]
): { measurements: boolean; photos: boolean; done: boolean } {
	const measurements = mensurationsDone(metrics);
	const photoDone = photosDemarrageDone(photos);
	return { measurements, photos: photoDone, done: measurements && photoDone };
}

async function getIntake(ctx: DbOnly, userId: Id<"users">): Promise<IntakeRow | null> {
	return (
		(await ctx.db.query("intakes").withIndex("by_user", (q) => q.eq("userId", userId)).first()) ?? null
	);
}

/** Sauvegarde (brouillon ou soumission) du formulaire de la cliente connectée. */
export const save = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		status: v.union(v.literal("draft"), v.literal("submitted")),
		answers: v.record(v.string(), v.union(v.string(), v.number(), v.null())),
	},
	handler: async (ctx, { sessionToken, status, answers }) => {
		const user = await me(ctx, sessionToken);
		if (user.role !== "client") throw new ConvexError("Réservé à l'espace cliente.");
		// Taille du formulaire : protection anti-abus.
		if (Object.keys(answers).length > 80) throw new ConvexError("Formulaire invalide.");
		const now = Date.now();
		const existing = await getIntake(ctx, user._id);
		if (existing) {
			await ctx.db.patch(existing._id, {
				status,
				answers,
				updatedAt: now,
				...(status === "submitted" && !existing.submittedAt ? { submittedAt: now } : {}),
			});
			return { ok: true, status, submittedAt: existing.submittedAt ?? (status === "submitted" ? now : null) };
		}
		const id = await ctx.db.insert("intakes", {
			userId: user._id,
			status,
			answers,
			createdAt: now,
			updatedAt: now,
			...(status === "submitted" ? { submittedAt: now } : {}),
		});
		return { ok: true, status, intakeId: id, submittedAt: status === "submitted" ? now : null };
	},
});

/** Brouillon / formulaire de la cliente connectée (retourné au wizard). */
export const mine = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await me(ctx, sessionToken);
		const intake = await getIntake(ctx, user._id);
		return {
			status: intake?.status ?? null,
			answers: intake?.answers ?? {},
			submittedAt: intake?.submittedAt ?? null,
			updatedAt: intake?.updatedAt ?? null,
			// Pré-remplissage : taille du compte (si déjà connue) — même source que
			// la fiche coach, aucune ressaisie.
			accountHeightCm: user.heightCm ?? null,
		};
	},
});

/**
 * Vue coach d'une cliente : paramètre onboarding + formulaire + statuts des
 * deux étapes (mensurations/photos dérivés des données réelles).
 */
export const coachView = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		await coach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");
		const [intake, metrics, photos] = await Promise.all([
			getIntake(ctx, userId),
			ctx.db.query("bodyMetrics").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
			ctx.db.query("progressPhotos").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
		]);
		const step2 = step2Done(metrics, photos);
		return {
			enabled: !!target.onboardingEnabled,
			enabledAt: target.onboardingEnabled ? target._creationTime : null,
			intake: intake
				? {
						status: intake.status,
						answers: intake.answers,
						submittedAt: intake.submittedAt ?? null,
						updatedAt: intake.updatedAt,
						createdAt: intake.createdAt,
				  }
				: null,
			step1: { done: intake?.status === "submitted" },
			step2,
			done: !!(intake?.status === "submitted") && step2.done,
		};
	},
});

/** Active / désactive l'onboarding d'une cliente (ne supprime jamais de données). */
export const setEnabled = mutation({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users"), enabled: v.boolean() },
	handler: async (ctx, { sessionToken, userId, enabled }) => {
		await coach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Cliente introuvable.");
		await ctx.db.patch(userId, { onboardingEnabled: enabled });
		return { ok: true, enabled };
	},
});

/** Suppression de compte : retire la ligne formulaire de la cliente. */
export async function deleteIntakeForUser(ctx: Pick<MutationCtx, "db">, userId: string) {
	const row = await ctx.db
		.query("intakes")
		.withIndex("by_user", (q) => q.eq("userId", userId as Id<"users">))
		.first();
	if (row) await ctx.db.delete(row._id);
}
