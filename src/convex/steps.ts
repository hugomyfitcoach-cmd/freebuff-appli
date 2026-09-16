import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser, hashToken, addDaysISO } from "./helpers";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Pas quotidiens côté cliente — une seule valeur par jour (`dailySteps`),
 * modifiable si la cliente s'est trompée. La moyenne hebdo n'est jamais
 * calculée sur les jours sans donnée (jour vide ≠ 0) : les agrégations
 * vivent dans dashboard.getDashboard (récap cliente) et coach.client360
 * (cockpit CRM), qui ne comptent que les jours réellement renseignés.
 *
 * Provenance (synchro Apple Santé via raccourci iOS) :
 * - `healthCount` : dernière valeur importée d'Apple Santé pour ce jour ;
 * - `manualCount` : correction manuelle de la cliente (prioritaire) ;
 * - `count` : valeur EFFECTIVE = manualCount ?? healthCount — c'est elle
 *   que lisent déjà la page « Mes pas », l'Accueil, le dashboard et le CRM
 *   (aucune agrégation ni composant à modifier).
 * Une synchro remplace UNIQUEMENT `healthCount` (jamais `manualCount`,
 * jamais de somme avec l'ancienne valeur) ; un jour sans donnée Apple
 * Santé reste absent (jamais transformé en 0).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function requireClient(ctx: Pick<MutationCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent enregistrer leurs pas.");
	}
	return user;
}

/**
 * Écrit la saisie/correction MANUELLE du jour : manualCount = count et la
 * valeur effective devient cette correction. healthCount est conservé s'il
 * existe (une correction n'efface jamais la valeur Apple Santé). L'import
 * Apple Santé n'appelle JAMAIS ce helper (voir importFromHealth).
 */
async function upsertRow(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">,
	date: string,
	count: number
): Promise<void> {
	const existing = await ctx.db
		.query("dailySteps")
		.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
		.first();
	if (existing) await ctx.db.patch(existing._id, { count, manualCount: count, createdAt: Date.now() });
	else await ctx.db.insert("dailySteps", { userId, date, count, manualCount: count, createdAt: Date.now() });
}

function validateCount(count: number): void {
	if (!Number.isFinite(count) || count < 0 || count > 150000 || !Number.isInteger(count)) {
		throw new ConvexError("Nombre de pas invalide (entre 0 et 150 000).");
	}
}

/**
 * Historique quotidien des pas + objectif coach — même source que le
 * dashboard et le CRM (aucune deuxième base de données). La page « Mes pas »
 * construit sa fenêtre de 7 jours côté client (fuseau de la cliente) ; une
 * journée sans ligne n'est jamais interprétée comme 0 pas. Renvoie aussi la
 * provenance de chaque jour (Apple Santé / correction manuelle) pour l'écran
 * « Mes pas », et l'état de la connexion Apple Santé (bouton).
 */
export const myHistory = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx: QueryCtx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user || user.role !== "client") throw new ConvexError("Session invalide.");
		const [goalsRow, rows] = await Promise.all([
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", user._id)).first(),
			ctx.db.query("dailySteps").withIndex("by_user", (q) => q.eq("userId", user._id)).order("asc").collect(),
		]);
		return {
			goal: goalsRow?.stepGoal ?? null,
			rows: rows.map((r) => ({
				date: r.date,
				count: r.count,
				healthCount: r.healthCount ?? null,
				manualCount: r.manualCount ?? null,
			})),
			healthSync: {
				connected: user.lastHealthSyncAt !== undefined,
				lastSyncAt: user.lastHealthSyncAt ?? null,
			},
		};
	},
});

/** Enregistre (ou corrige) le nombre de pas de la journée — saisie manuelle. */
export const setSteps = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		date: v.string(),
		count: v.number(),
	},
	handler: async (ctx, { sessionToken, date, count }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!DATE_RE.test(date)) throw new ConvexError("Date invalide.");
		validateCount(count);
		await upsertRow(ctx, user._id, date, count);
		return { ok: true };
	},
});

/* ═════════ Synchro Apple Santé (raccourci iOS + jeton court) ═════════ */

/** Durée de vie d'un jeton de synchro (le raccourci part de l'app → backend). */
const HEALTH_TOKEN_TTL_MS = 15 * 60 * 1000;
/** Nombre max de couples date+pas acceptés (7 derniers jours, marge tolérée). */
const MAX_HEALTH_DAYS = 31;

/**
 * Crée un jeton court (1 usage réseau toléré, 15 min) identifiant la cliente
 * pour le raccourci. Appelé UNIQUEMENT par le BFF SvelteKit (session cookie) —
 * jamais exposé au navigateur hors de la session, jamais stocké en clair.
 * Les jetons précédents de la cliente sont supprimés (un seul actif).
 */
export const createHealthSyncToken = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		// Jeton aléatoire 256 bits (Web Crypto, compatible runtime Convex).
		const raw = new Uint8Array(32);
		crypto.getRandomValues(raw);
		let token = "";
		for (const b of raw) token += b.toString(16).padStart(2, "0");
		const tokenHash = await hashToken(token);
		const now = Date.now();
		// Un seul jeton actif par cliente : purge des anciens.
		for (const old of await ctx.db
			.query("healthSyncTokens")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.collect()) {
			await ctx.db.delete(old._id);
		}
		await ctx.db.insert("healthSyncTokens", {
			userId: user._id,
			tokenHash,
			createdAt: now,
			expiresAt: now + HEALTH_TOKEN_TTL_MS,
		});
		return { token, expiresAt: now + HEALTH_TOKEN_TTL_MS };
	},
});

/**
 * Import Apple Santé : appelé par le BFF avec le jeton brut du raccourci
 * (jamais un cookie, jamais l'ID cliente). Pour chaque jour :
 * - remplace UNIQUEMENT healthCount (nouvelle valeur Apple Santé) ;
 * - conserve manualCount (correction manuelle prioritaire) ;
 * - recalcule count = manualCount ?? healthCount ;
 * - n'insère AUCUNE ligne pour un jour sans donnée (pas de faux « 0 pas ») ;
 * - n'accepte que les 7 derniers jours + aujourd'hui (aucun jour futur).
 * `nowISO` (date serveur) borne la fenêtre côté serveur.
 */
export const importFromHealth = mutation({
	args: {
		token: v.string(),
		days: v.array(v.object({ date: v.string(), count: v.number() })),
		nowISO: v.string(),
	},
	handler: async (ctx, { token, days, nowISO }) => {
		if (!token) throw new ConvexError("Jeton manquant.");
		if (!DATE_RE.test(nowISO)) throw new ConvexError("Date serveur invalide.");
		if (!Array.isArray(days) || days.length === 0) throw new ConvexError("Aucune donnée reçue.");
		if (days.length > MAX_HEALTH_DAYS) throw new ConvexError("Trop de journées transmises.");
		const tokenHash = await hashToken(token);
		const row = await ctx.db
			.query("healthSyncTokens")
			.withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
			.unique();
		if (!row) throw new ConvexError("Connexion expirée. Relance la synchronisation depuis l'app.");
		if (row.expiresAt < Date.now()) throw new ConvexError("Connexion expirée. Relance la synchronisation depuis l'app.");
		const user = await ctx.db.get(row.userId);
		if (!user || user.disabled || user.role !== "client") {
			throw new ConvexError("Compte introuvable. Relance la synchronisation depuis l'app.");
		}
		const minISO = addDaysISO(nowISO, -32); // garde-fou large : 7 jours attendus
		// Tolérance d'1 jour (même règle que /api/steps) : la date locale de la
		// cliente (Europe/Paris) peut dépasser la date UTC du serveur avant ~2 h.
		const maxISO = addDaysISO(nowISO, 1);
		let updated = 0;
		for (const d of days) {
			if (!d || !DATE_RE.test(d.date)) throw new ConvexError(`Date invalide (${String(d?.date)}) — import refusé.`);
			if (d.date > maxISO) throw new ConvexError("Journée future reçue — import refusé.");
			if (d.date < minISO) throw new ConvexError(`Journée trop ancienne (${d.date}) — import refusé.`);
			validateCount(d.count);
		}
		// Validations OK → écriture (une ligne par jour existant, upsert sinon).
		for (const d of days) {
			const existing = await ctx.db
				.query("dailySteps")
				.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", d.date))
				.first();
			if (existing) {
				if (existing.healthCount === undefined && existing.manualCount === undefined) {
					// Ligne antérieure à la fonctionnalité = saisie manuelle historique :
					// JAMAIS écrasée — conservée comme correction manuelle prioritaire,
					// la valeur Apple Santé est posée à côté (récupérable via
					// « Revenir à la valeur Apple Santé »).
					await ctx.db.patch(existing._id, {
						healthCount: d.count,
						manualCount: existing.count,
						count: existing.count,
						createdAt: Date.now(),
					});
				} else {
					// Synchro classique : healthCount remplacé, correction préservée.
					await ctx.db.patch(existing._id, {
						healthCount: d.count,
						count: existing.manualCount ?? d.count,
						createdAt: Date.now(),
					});
				}
			} else {
				await ctx.db.insert("dailySteps", {
					userId: user._id,
					date: d.date,
					count: d.count,
					healthCount: d.count,
					createdAt: Date.now(),
				});
			}
			updated += 1;
		}
		await ctx.db.patch(row._id, { usedAt: Date.now() });
		await ctx.db.patch(user._id, { lastHealthSyncAt: Date.now() });
		return { ok: true, updated };
	},
});

/**
 * « Revenir à la valeur Apple Santé » : supprime UNIQUEMENT la correction
 * manuelle du jour. La valeur affichée redevient la dernière valeur Apple
 * Santé connue ; si aucune valeur Apple Santé n'existe pour ce jour, la
 * ligne est supprimée (retour exact à « journée non renseignée »).
 */
export const revertToHealth = mutation({
	args: { sessionToken: v.optional(v.string()), date: v.string() },
	handler: async (ctx, { sessionToken, date }) => {
		const user = await requireClient(ctx, sessionToken);
		if (!DATE_RE.test(date)) throw new ConvexError("Date invalide.");
		const existing = await ctx.db
			.query("dailySteps")
			.withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
			.first();
		if (!existing) return { ok: true, count: null };
		if (existing.healthCount === undefined) {
			// Jamais synchronisé par Apple Santé : la valeur manuelle EST la donnée.
			throw new ConvexError("Aucune valeur Apple Santé pour ce jour — la saisie manuelle reste la seule donnée.");
		}
		await ctx.db.patch(existing._id, {
			manualCount: undefined,
			count: existing.healthCount,
			createdAt: Date.now(),
		});
		return { ok: true, count: existing.healthCount };
	},
});
