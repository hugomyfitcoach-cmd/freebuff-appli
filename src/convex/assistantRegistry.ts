/**
 * REGISTRE D'OUTILS — Assistant G-FLUX V2 (Lot 2).
 *
 * SOURCE UNIQUE des outils exposés au modèle : chaque outil déclare son nom,
 * sa description, son schéma d'entrée (JSON Schema OpenAI), son type et son
 * exécuteur. Ajouter un outil = ajouter UNE entrée ici (+ son implémentation
 * dans son module) — plus aucun switch transversal à modifier dans `send()`.
 *
 * Types (mission §8) :
 *  - 'read'    : lecture de données autorisées (isolation userId de session) ;
 *  - 'prepare' : PRÉPARATION d'écriture → pendingAction → clic « Enregistrer »
 *                (le SEUL chemin d'écriture reste `resolveAction`, inchangé) ;
 *  - 'meta'    : fonction interne autorisée (setTopic).
 *
 * GARDES (non négociables) :
 *  - l'exécuteur reçoit `state.sessionToken` de la session authentifiée ;
 *    l'identité et les droits sont résolus côté implémentation
 *    (`requireAssistantClient`) — JAMAIS depuis un id passé par le modèle ;
 *  - args VALIDÉS par les schémas Convex de l'implémentation (v.*) — le
 *    registre borne en plus les entrées brutes (types/longueurs) ;
 *  - un outil en échec renvoie { ok:false, reason } — jamais une invention ;
 *  - aucun accès Convex générique au LLM : seule la liste fermée ici est
 *    appelable.
 */

import { api } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

/** Contexte d'exécution partagé d'un tour (muté par les outils meta). */
export type ToolRunState = {
	sessionToken: string | undefined;
	threadId: string;
	/** Sujet courant (muté par setTopic). */
	topic: string;
	/** Date locale du tour. */
	today: string;
};

export type AssistantToolKind = "read" | "prepare" | "meta";

export type AssistantToolEntry = {
	name: string;
	kind: AssistantToolKind;
	description: string;
	parameters: Record<string, unknown>;
	/** Exécuteur : reçoit l'ActionCtx, l'état du tour et les args validés côté implémentation. */
	run: (ctx: ActionCtx, state: ToolRunState, args: Record<string, unknown>) => Promise<unknown>;
};

/** Schémas JSON partagés (identiques V1 — stabilité du prompt). */
const DATE = { type: "string", description: "Date au format yyyy-mm-dd (aujourd'hui si omise)." };
const REF = {
	foodId: { type: "string", description: "foodId renvoyé par searchFood (base OFF G-FLUX)." },
	customFoodId: { type: "string", description: "customFoodId renvoyé par searchFood (aliment de la cliente)." },
	ciqualLabel: { type: "string", description: "ciqualLabel renvoyé par searchFood (référence Ciqual/ANSES)." },
};

/** Garde-fou générique : bornes des entrées texte/nombre avant implémentation. */
function sanitize(args: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(args)) {
		if (typeof v === "string") out[k] = v.slice(0, 4000);
		else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
		else if (typeof v === "boolean") out[k] = v;
		else if (Array.isArray(v)) out[k] = v.slice(0, 12);
		else if (v && typeof v === "object") out[k] = v; // validé par le schéma Convex ensuite
	}
	return out;
}

/* ═════════════════════════ Le registre ═════════════════════════ */

export const ASSISTANT_REGISTRY: AssistantToolEntry[] = [
	{
		name: "setTopic",
		kind: "meta",
		description:
			"Change le sujet de la conversation quand l'utilisatrice parle d'autre chose que la catégorie active (nutrition | weight_steps | recipes | checkin | coach_question).",
		parameters: {
			type: "object",
			properties: { topic: { type: "string", enum: ["nutrition", "weight_steps", "recipes", "checkin", "coach_question"] } },
			required: ["topic"],
		},
		run: async (_ctx, state, args) => {
			const t = String(args.topic ?? "");
			if (["nutrition", "weight_steps", "recipes", "checkin", "coach_question"].includes(t)) state.topic = t;
			return { ok: true, topic: state.topic };
		},
	},
	{
		name: "getToday",
		kind: "read",
		description:
			"Objectifs, calories déjà mangées, calories/restes restants, macros restantes, pas et poids du jour. CHIFFRES DÉTERMINISTES : appelle-les pour toute question chiffrée.",
		parameters: { type: "object", properties: { date: DATE }, required: [] },
		run: async (ctx, state, args) =>
			await ctx.runQuery(api.assistantTools.getToday, {
				sessionToken: state.sessionToken,
				...(typeof args.date === "string" ? { date: args.date } : {}),
			}),
	},
	{
		name: "getPeriodRecap",
		kind: "read",
		description:
			"Récap FACTUEL d'une journée ou de la semaine en cours (moyennes sur les jours enregistrés uniquement, couverture indiquée).",
		parameters: {
			type: "object",
			properties: { period: { type: "string", enum: ["day", "week"] }, date: DATE },
			required: ["period"],
		},
		run: async (ctx, state, args) =>
			await ctx.runQuery(api.assistantTools.getPeriodRecap, {
				sessionToken: state.sessionToken,
				period: args.period === "week" ? ("week" as const) : ("day" as const),
				...(typeof args.date === "string" ? { date: args.date } : {}),
			}),
	},
	{
		name: "getProfile",
		kind: "read",
		description:
			"Profil de la cliente (prénom, taille, âge, mode coaching/autonomie). Aucune préférence alimentaire structurée n'existe encore — le champ est null, ne l'invente pas.",
		parameters: { type: "object", properties: {}, required: [] },
		run: async (ctx, state) =>
			await ctx.runQuery(api.assistantRead.getProfile, { sessionToken: state.sessionToken }),
	},
	{
		name: "getMeasurements",
		kind: "read",
		description:
			"Historique récent poids + mensurations (cou, taille, hanches) et tendance poids déterministe. Pour toute analyse corporelle.",
		parameters: { type: "object", properties: { limit: { type: "number" } }, required: [] },
		run: async (ctx, state, args) =>
			await ctx.runQuery(api.assistantRead.getMeasurements, {
				sessionToken: state.sessionToken,
				...(typeof args.limit === "number" ? { limit: args.limit } : {}),
			}),
	},
	{
		name: "getLastCheckin",
		kind: "read",
		description:
			"Dernier bilan hebdomadaire : réponses de la cliente et RETOUR DU COACH (consigne officielle de Hugo — à distinguer de tes analyses).",
		parameters: { type: "object", properties: {}, required: [] },
		run: async (ctx, state) =>
			await ctx.runQuery(api.assistantRead.getLastCheckin, { sessionToken: state.sessionToken }),
	},
	{
		name: "getMealPlan",
		kind: "read",
		description:
			"Plan alimentaire actif défini par le coach (nom, période, aperçu des repas). LECTURE SEULE : ne modifie jamais un plan.",
		parameters: { type: "object", properties: {}, required: [] },
		run: async (ctx, state) =>
			await ctx.runQuery(api.assistantRead.getMealPlan, { sessionToken: state.sessionToken }),
	},
	{
		name: "searchFood",
		kind: "read",
		description:
			"Cherche un aliment dans la base G-FLUX (produits, aliments de la cliente, références Ciqual). Renvoie les identifiants à réutiliser.",
		parameters: {
			type: "object",
			properties: { query: { type: "string", description: "Nom de l'aliment." }, limit: { type: "number" } },
			required: ["query"],
		},
		run: async (ctx, state, args) =>
			await ctx.runQuery(api.assistantTools.searchFood, {
				sessionToken: state.sessionToken,
				query: String(args.query ?? ""),
				...(typeof args.limit === "number" ? { limit: args.limit } : {}),
			}),
	},
	{
		name: "getFoodReference",
		kind: "read",
		description: "Fiche nutritionnelle complète d'un aliment (valeurs /100 g, portion mémorisée, repères G-FLUX).",
		parameters: { type: "object", properties: REF, required: [] },
		run: async (ctx, state, args) =>
			await ctx.runQuery(api.assistantTools.getFoodReference, {
				sessionToken: state.sessionToken,
				...(typeof args.foodId === "string" ? { foodId: args.foodId } : {}),
				...(typeof args.customFoodId === "string" ? { customFoodId: args.customFoodId } : {}),
				...(typeof args.ciqualLabel === "string" ? { ciqualLabel: args.ciqualLabel } : {}),
			}),
	},
	{
		name: "estimateFoodPortion",
		kind: "read",
		description:
			"Proposition de portion pour un aliment (mémorisée > produit > repère G-FLUX). Renvoie mustEstimate=true quand il faut afficher « ≈ Estimation ».",
		parameters: { type: "object", properties: { name: { type: "string" }, ...REF }, required: ["name"] },
		run: async (ctx, state, args) =>
			await ctx.runQuery(api.assistantTools.estimateFoodPortion, {
				sessionToken: state.sessionToken,
				name: String(args.name ?? ""),
				...(typeof args.foodId === "string" ? { foodId: args.foodId } : {}),
				...(typeof args.customFoodId === "string" ? { customFoodId: args.customFoodId } : {}),
				...(typeof args.ciqualLabel === "string" ? { ciqualLabel: args.ciqualLabel } : {}),
			}),
	},
	{
		name: "searchRecipes",
		kind: "read",
		description: "Cherche une recette du guide G-FLUX (filtre kcal max possible).",
		parameters: {
			type: "object",
			properties: { query: { type: "string" }, maxKcal: { type: "number" }, limit: { type: "number" } },
			required: [],
		},
		run: async (ctx, state, args) =>
			await ctx.runQuery(api.assistantTools.searchRecipes, {
				sessionToken: state.sessionToken,
				query: typeof args.query === "string" ? args.query : "",
				...(typeof args.maxKcal === "number" ? { maxKcal: args.maxKcal } : {}),
			}),
	},
	{
		name: "getJournalEntries",
		kind: "read",
		description: "Liste les aliments déjà présents dans le journal d'une date (pour corriger ou retirer).",
		parameters: { type: "object", properties: { date: DATE }, required: [] },
		run: async (ctx, state, args) =>
			await ctx.runQuery(api.assistantTools.getJournalEntries, {
				sessionToken: state.sessionToken,
				...(typeof args.date === "string" ? { date: args.date } : {}),
			}),
	},
	{
		name: "prepareJournalEntry",
		kind: "prepare",
		description:
			"PRÉPARE l'ajout d'aliments au journal : renvoie une PREVIEW à montrer à l'utilisateur. Écriture UNIQUEMENT après son clic « Enregistrer ». RÈGLE DE FIDÉLITÉ : les items sont EXACTEMENT ceux demandés par l'utilisatrice — n'ajoute jamais un aliment non demandé, ne substitue jamais une autre référence ; quantités conservées telles qu'écrites.",
		parameters: {
			type: "object",
			properties: {
				date: DATE,
				meal: { type: "string", enum: ["petit-dej", "dejeuner", "diner", "collation"] },
				items: {
					type: "array",
					items: {
						type: "object",
						properties: {
							...REF,
							name: { type: "string" },
							qtyGrams: { type: "number" },
							estimated: { type: "boolean", description: "true si la quantité n'était pas donnée clairement." },
						},
						required: ["name", "qtyGrams"],
					},
				},
			},
			required: ["meal", "items"],
		},
		run: async (ctx, state, args) => {
			const res = (await ctx.runMutation(api.assistantTools.prepareJournalEntry, {
				sessionToken: state.sessionToken,
				threadId: state.threadId,
				topic: state.topic,
				date: typeof args.date === "string" ? args.date : state.today,
				meal: String(args.meal ?? "diner"),
				items: (args.items ?? []) as never,
			})) as { actionId: string; preview: unknown };
			return {
				ok: true,
				actionId: res.actionId,
				preview: res.preview,
				note: "Prévisualisation créée : présente-la telle quelle (lignes vérifiées par le serveur) et invite au clic « Enregistrer ».",
			};
		},
	},
	{
		name: "updateJournalEntry",
		kind: "prepare",
		description:
			"MET À JOUR la prévisualisation d'ajout EN ATTENTE après une précision de l'utilisatrice (« pain de mie complet », « en fait 3 tranches »). Utilise-le au lieu de prepareJournalEntry quand une action vient d'être préparée : seuls les aliments concernés sont passés — les autres lignes et quantités déjà confirmées sont CONSERVÉES par le serveur. Sans qtyGrams, la quantité existante de la ligne remplacée est réutilisée.",
		parameters: {
			type: "object",
			properties: {
				items: {
					type: "array",
					items: {
						type: "object",
						properties: {
							...REF,
							name: { type: "string" },
							qtyGrams: { type: "number", description: "Optionnel : absent = conserver la quantité déjà préparée." },
							estimated: { type: "boolean" },
						},
						required: ["name"],
					},
				},
			},
			required: ["items"],
		},
		run: async (ctx, state, args) => {
			const res = (await ctx.runMutation(api.assistantTools.updatePendingJournalEntry, {
				sessionToken: state.sessionToken,
				threadId: state.threadId,
				topic: state.topic,
				items: (args.items ?? []) as never,
			})) as { ok: boolean; actionId: string; preview: unknown };
			return {
				ok: true,
				actionId: res.actionId,
				preview: res.preview,
				note: "Prévisualisation MISE À JOUR : présente-la telle quelle et invite au clic « Enregistrer » (l'ancienne version est remplacée).",
			};
		},
	},
	{
		name: "prepareJournalRemoval",
		kind: "prepare",
		description: "PRÉPARE le retrait d'aliments du journal (entryIds de getJournalEntries) — preview puis clic.",
		parameters: {
			type: "object",
			properties: { entryIds: { type: "array", items: { type: "string" } } },
			required: ["entryIds"],
		},
		run: async (ctx, state, args) => {
			const res = (await ctx.runMutation(api.assistantTools.prepareJournalRemoval, {
				sessionToken: state.sessionToken,
				threadId: state.threadId,
				topic: state.topic,
				entryIds: (args.entryIds ?? []) as string[],
			})) as { actionId: string; preview: unknown };
			return { ok: true, actionId: res.actionId, preview: res.preview };
		},
	},
	{
		name: "prepareMeasurement",
		kind: "prepare",
		description: "PRÉPARE une saisie de poids, de pas ou de mensurations — preview puis clic « Enregistrer ».",
		parameters: {
			type: "object",
			properties: {
				kind: { type: "string", enum: ["weight", "steps", "measurement"] },
				date: DATE,
				weightKg: { type: "number" },
				count: { type: "number", description: "Nombre de pas (entier)." },
				neckCm: { type: "number" },
				waistCm: { type: "number" },
				hipCm: { type: "number" },
			},
			required: ["kind"],
		},
		run: async (ctx, state, args) => {
			const res = (await ctx.runMutation(api.assistantTools.prepareMeasurement, {
				sessionToken: state.sessionToken,
				threadId: state.threadId,
				topic: state.topic,
				kind: (typeof args.kind === "string" && ["weight", "steps", "measurement"].includes(args.kind)
					? args.kind
					: "weight") as "weight" | "steps" | "measurement",
				date: typeof args.date === "string" ? args.date : state.today,
				...(typeof args.weightKg === "number" ? { weightKg: args.weightKg } : {}),
				...(typeof args.count === "number" ? { count: args.count } : {}),
				...(typeof args.neckCm === "number" ? { neckCm: args.neckCm } : {}),
				...(typeof args.waistCm === "number" ? { waistCm: args.waistCm } : {}),
				...(typeof args.hipCm === "number" ? { hipCm: args.hipCm } : {}),
			})) as { actionId: string; preview: unknown };
			return { ok: true, actionId: res.actionId, preview: res.preview };
		},
	},
	{
		name: "prepareCoachQuestion",
		kind: "prepare",
		description:
			"PRÉPARE une question/note pour Hugo (destination bilan ou note simple) — preview puis clic. À utiliser quand une décision de coaching est nécessaire.",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string" },
				destination: { type: "string", enum: ["bilan", "note"] },
			},
			required: ["text", "destination"],
		},
		run: async (ctx, state, args) => {
			const res = (await ctx.runMutation(api.assistantTools.prepareCoachQuestion, {
				sessionToken: state.sessionToken,
				threadId: state.threadId,
				topic: state.topic,
				text: String(args.text ?? ""),
				destination: args.destination === "bilan" ? ("bilan" as const) : ("note" as const),
			})) as { actionId: string; preview: unknown };
			return { ok: true, actionId: res.actionId, preview: res.preview };
		},
	},
];

/** Définitions OpenAI (tools) dérivées du registre — pour `runAssistantTurn`. */
export function registryToolDefs(): { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[] {
	return ASSISTANT_REGISTRY.map((t) => ({
		type: "function" as const,
		function: { name: t.name, description: t.description, parameters: t.parameters },
	}));
}

/** Dispatch : l'outil inconnu ne lève jamais — il renvoie un refus propre. */
export async function dispatchTool(
	ctx: ActionCtx,
	name: string,
	rawArgs: Record<string, unknown>,
	state: ToolRunState
): Promise<unknown> {
	const entry = ASSISTANT_REGISTRY.find((t) => t.name === name);
	if (!entry) return { ok: false, reason: `Outil inconnu : ${name}` };
	try {
		return await entry.run(ctx, state, sanitize(rawArgs));
	} catch (e) {
		return { ok: false, reason: e instanceof Error ? e.message.slice(0, 200) : "error" };
	}
}
