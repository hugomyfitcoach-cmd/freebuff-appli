import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import {
	canManageReferenceFood,
	cleanReferenceFood,
	gfluxIdFromLabel,
	referenceFoodError,
} from "../lib/referenceFoods";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * ALIMENTS DE RÉFÉRENCE G-FLUX (Mission R3) — table ADDITIVE `referenceFoods`.
 *
 * Le coach crée ses propres aliments de référence (valeurs pour 100 g) ; ils
 * apparaissent dans la section « Aliments de référence » des recherches
 * (journal cliente, fiche cliente CRM, plans de repas) avec le badge
 * « Référence G-Flux ».
 *
 * Règles d'accès (identiques aux contenus du Guide nutrition & recettes) :
 *  - écriture (create/update/remove) : coach PROPRIÉTAIRE de la fiche, seul ;
 *  - lecture : la cliente voit les fiches de SON coach (users.createdBy, avec
 *    repli sur le compte coach unique — même règle que dashboard.myCoachProfile),
 *    le coach voit les siennes.
 *
 * Aucune table existante n'est modifiée : les fiches ne sont jamais
 * référencées par le journal ni par les plans, qui en copient le nom et les
 * valeurs au moment de l'ajout (snapshot).
 */

async function requireCoach(
	ctx: Pick<QueryCtx, "db">,
	sessionToken: string | undefined | null
): Promise<Doc<"users">> {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé à la coach (CRM).");
	return user;
}

async function requireUser(
	ctx: Pick<QueryCtx, "db">,
	sessionToken: string | undefined | null
): Promise<Doc<"users">> {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	return user;
}

/**
 * Coach de référence d'un compte : le coach lui-même, sinon celui qui a créé
 * le compte cliente, sinon le compte coach unique (même règle que le Guide /
 * l'identité publique de la coach). `null` = aucun coach → aucune fiche.
 */
export async function coachIdForUser(
	ctx: Pick<QueryCtx, "db">,
	user: Doc<"users">
): Promise<Id<"users"> | null> {
	if (user.role === "coach") return user._id;
	if (user.createdBy) {
		const owner = await ctx.db.get(user.createdBy);
		if (owner && owner.role === "coach") return owner._id;
	}
	const coach = await ctx.db
		.query("users")
		.filter((q) => q.eq(q.field("role"), "coach"))
		.first();
	return coach ? coach._id : null;
}

/** Fiches de référence visibles par un compte (lecture, aucune écriture). */
export async function listReferenceFoodsForUser(
	ctx: Pick<QueryCtx, "db">,
	user: Doc<"users">
): Promise<Doc<"referenceFoods">[]> {
	const coachId = await coachIdForUser(ctx, user);
	if (!coachId) return [];
	return await ctx.db
		.query("referenceFoods")
		.withIndex("by_coach", (q) => q.eq("coachId", coachId))
		.collect();
}

/**
 * Résout un libellé d'ajout `gflux:<id>` pour un compte : la fiche doit
 * exister ET appartenir à son coach (ou au coach lui-même). `null` si le
 * libellé n'est pas une fiche G-Flux ou si elle n'est plus accessible — un
 * autre libellé reste une référence Ciqual (chemin inchangé).
 */
export async function resolveReferenceFoodLabel(
	ctx: Pick<QueryCtx, "db">,
	user: Doc<"users">,
	label: string | null | undefined
): Promise<Doc<"referenceFoods"> | null> {
	const id = gfluxIdFromLabel(label);
	if (!id) return null;
	const food = await ctx.db.get(id as Id<"referenceFoods">);
	if (!food) return null;
	const coachId = await coachIdForUser(ctx, user);
	if (!coachId || food.coachId !== coachId) return null;
	return food;
}

/** Liste des fiches visibles (coach : les siennes ; cliente : celles de son coach). */
export const list = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireUser(ctx, sessionToken);
		const rows = await listReferenceFoodsForUser(ctx, user);
		return rows
			.map((r) => ({
				_id: r._id,
				name: r.name,
				kcal: r.kcal,
				proteinG: r.proteinG,
				carbsG: r.carbsG,
				fatG: r.fatG,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
			}))
			.sort((a, b) => a.name.localeCompare(b.name, "fr"));
	},
});

const foodFields = {
	name: v.string(),
	kcal: v.number(),
	proteinG: v.number(),
	carbsG: v.number(),
	fatG: v.number(),
};

/** Crée une fiche de référence (coach propriétaire uniquement). */
export const create = mutation({
	args: { sessionToken: v.optional(v.string()), ...foodFields },
	handler: async (ctx, { sessionToken, ...fields }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const input = cleanReferenceFood(fields);
		const error = referenceFoodError(input);
		if (error) throw new ConvexError(error);
		const now = Date.now();
		const id = await ctx.db.insert("referenceFoods", {
			coachId: coach._id,
			...input,
			createdAt: now,
			updatedAt: now,
		});
		return { ok: true, referenceFoodId: id };
	},
});

/** Modifie une fiche — coach PROPRIÉTAIRE uniquement (aucun autre coach). */
export const update = mutation({
	args: { sessionToken: v.optional(v.string()), referenceFoodId: v.id("referenceFoods"), ...foodFields },
	handler: async (ctx, { sessionToken, referenceFoodId, ...fields }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const row = await ctx.db.get(referenceFoodId);
		if (!row || !canManageReferenceFood(coach, row)) throw new ConvexError("Aliment de référence introuvable.");
		const input = cleanReferenceFood(fields);
		const error = referenceFoodError(input);
		if (error) throw new ConvexError(error);
		// Les entrées passées (journal, plans) portent leur propre copie du nom
		// et des valeurs : cette modification ne les touche jamais.
		await ctx.db.patch(referenceFoodId, { ...input, updatedAt: Date.now() });
		return { ok: true, referenceFoodId };
	},
});

/** Supprime une fiche — coach PROPRIÉTAIRE uniquement (entrées passées intactes). */
export const remove = mutation({
	args: { sessionToken: v.optional(v.string()), referenceFoodId: v.id("referenceFoods") },
	handler: async (ctx, { sessionToken, referenceFoodId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const row = await ctx.db.get(referenceFoodId);
		if (!row) return { ok: true };
		if (!canManageReferenceFood(coach, row)) throw new ConvexError("Aliment de référence introuvable.");
		await ctx.db.delete(referenceFoodId);
		return { ok: true };
	},
});
