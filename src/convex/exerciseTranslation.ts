/**
 * TRADUCTION FR DES EXERCICES — action interne Convex.
 *
 * Objectif : la bibliothèque garde ses NOMS d'origine (anglais) et reçoit une
 * version FRANÇAISE de ses consignes d'exécution (`instructionsFr`), écrite
 * par l'IA à la demande, jamais à l'affichage et jamais pendant un import.
 *
 * - `translateExerciseDescriptions({ limit, dryRun })` — action INTERNE :
 *   - lots de 20 exercices, 200 exercices max par exécution (marge sous les
 *     10 minutes d'une action Convex), puis replanification automatique
 *     (`ctx.scheduler.runAfter`) jusqu'à `limit` ou la fin de la bibliothèque ;
 *   - `limit: 0` = tous les exercices restants ;
 *   - `dryRun: true` = renvoie les traductions sans RIEN écrire (ni base, ni
 *     journal) et sans se replanifier ;
 *   - les fiches déjà traduites sont ignorées (exécution relançable sans
 *     doublon) ;
 *   - erreur fournisseur : arrêt propre, aucune replanification, cause dans
 *     `aiUsageLog`.
 * - Clé `OPENAI_API_KEY` (déjà présente côté Convex), modèle lu dans
 *   `OPENAI_TRANSLATION_MODEL` (défaut `gpt-4o-mini`).
 * - `aiUsageLog` (kind « exercise_translation ») : modèle, tokens, durée —
 *   JAMAIS de texte d'exercice.
 *
 * Contraintes produit : les noms ne sont jamais traduits (fournis au modèle
 * comme simple contexte), le tutoiement et le vocabulaire matériel/muscles
 * usuels en français sont imposés dans la consigne.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import {
	runExerciseTranslation,
	type ExerciseToTranslate,
	type ExerciseTranslation,
	type ProviderResult,
	type TranslationSummary,
} from "../lib/exerciseTranslationCore";

/** Plafond de balayage de la bibliothèque (≈ 1 500 fiches en pratique). */
const SCAN_LIMIT = 4000;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
/** Délai d'un lot — 10 lots tiennent sous les 10 min d'une action Convex. */
const BATCH_TIMEOUT_MS = 40_000;

/** Modèle de traduction : variable dédiée, sinon gpt-4o-mini. */
export function translationModel(): string {
	const raw = process.env.OPENAI_TRANSLATION_MODEL;
	const model = typeof raw === "string" ? raw.trim() : "";
	return model.length > 0 ? model : "gpt-4o-mini";
}

/** Consigne système : français naturel, tutoiement, vocabulaire usuel FR. */
const SYSTEM_PROMPT = [
	"Tu traduis en français les consignes d'exécution d'exercices de musculation.",
	"Règles :",
	"- français naturel, tutoiement direct, phrases courtes et précises ;",
	"- vocabulaire usuel de la salle : haltère, barre, poulie, élastique, banc, fessiers, ischio-jambiers, quadriceps, dorsaux, deltoïdes, gainage ;",
	"- conserve le nombre d'étapes et leur ordre, sans ajouter de conseil ;",
	"- le nom anglais de l'exercice est fourni UNIQUEMENT comme contexte : tu ne le traduis jamais et tu ne l'inclus pas dans la réponse ;",
	"- réponse STRICTE en JSON : {\"items\":[{\"id\":\"<id fourni>\",\"instructionsFr\":[\"étape 1\",\"étape 2\"]}]}",
	"- recopie chaque id tel quel, une entrée par exercice fourni, aucun autre champ.",
].join("\n");

/**
 * Exercices de la bibliothèque À TRADUIRE : consignes présentes, pas encore de
 * version française. Les exercices créés par le coach (`system: false`) sont
 * exclus : ils sont déjà rédigés en français.
 */
export const listUntranslated = internalQuery({
	args: { limit: v.number() },
	handler: async (ctx, { limit }): Promise<ExerciseToTranslate[]> => {
		const max = Math.max(0, Math.floor(limit));
		if (max === 0) return [];
		const rows = await ctx.db.query("exercises").take(SCAN_LIMIT);
		const out: ExerciseToTranslate[] = [];
		for (const ex of rows) {
			if (!ex.system) continue;
			if (ex.instructionsFr?.length) continue;
			if (!ex.instructions?.length) continue;
			out.push({ id: ex._id, name: ex.name, instructions: ex.instructions });
			if (out.length >= max) break;
		}
		return out;
	},
});

/** Écriture idempotente : une fiche déjà traduite n'est jamais écrasée. */
export const saveTranslations = internalMutation({
	args: {
		items: v.array(
			v.object({
				id: v.id("exercises"),
				instructionsFr: v.array(v.string()),
			})
		),
	},
	handler: async (ctx, { items }) => {
		let saved = 0;
		for (const item of items) {
			const ex = await ctx.db.get(item.id);
			if (!ex) continue;
			if (ex.instructionsFr?.length) continue;
			if (!item.instructionsFr.length) continue;
			await ctx.db.patch(item.id, { instructionsFr: item.instructionsFr });
			saved++;
		}
		return { saved };
	},
});

/** Extrait le JSON du fournisseur (chat completions) et valide la forme. */
function parseItems(raw: string): unknown[] {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new Error("Réponse de traduction illisible.");
	}
	const items = Array.isArray(json)
		? json
		: Array.isArray((json as { items?: unknown }).items)
			? (json as { items: unknown[] }).items
			: null;
	if (!items) throw new Error("Réponse de traduction sans liste d'items.");
	return items;
}

/** Appel OpenAI d'un lot — sortie JSON stricte, tokens et durée remontés. */
async function translateBatch(items: ExerciseToTranslate[], model: string): Promise<ProviderResult> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) throw new Error("Traduction IA non configurée sur le serveur (OPENAI_API_KEY absente).");

	const payload = items.map((item) => ({ id: item.id, name: item.name, instructions: item.instructions }));
	let res: Response;
	try {
		res = await fetch(OPENAI_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				temperature: 0.2,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{ role: "user", content: JSON.stringify({ exercises: payload }) },
				],
			}),
			signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
		});
	} catch (e) {
		const name = e instanceof Error ? e.name : "";
		throw new Error(name === "TimeoutError" ? "Traduction IA : délai dépassé." : "Service de traduction momentanément indisponible.");
	}
	if (!res.ok) {
		let detail = "";
		try {
			const body = (await res.json()) as { error?: { message?: string } };
			detail = typeof body.error?.message === "string" ? ` — ${body.error.message.slice(0, 120)}` : "";
		} catch {
			// corps non JSON : raison générique
		}
		throw new Error(`Service de traduction indisponible (HTTP ${res.status})${detail}.`);
	}

	const body = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
		usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
	};
	const content = body.choices?.[0]?.message?.content;
	if (!content) throw new Error("Réponse de traduction vide.");
	const rawItems = parseItems(content);

	const results: ExerciseTranslation[] = [];
	for (const raw of rawItems) {
		if (!raw || typeof raw !== "object") continue;
		const id = (raw as { id?: unknown }).id;
		const lines = (raw as { instructionsFr?: unknown }).instructionsFr;
		if (typeof id !== "string" || !Array.isArray(lines)) continue;
		const instructionsFr = lines
			.filter((line): line is string => typeof line === "string" && line.trim().length > 0)
			.map((line) => line.trim());
		if (!instructionsFr.length) continue;
		results.push({ id, instructionsFr });
	}

	return {
		results,
		inputTokens: body.usage?.prompt_tokens ?? body.usage?.input_tokens,
		outputTokens: body.usage?.completion_tokens ?? body.usage?.output_tokens,
	};
}

/**
 * ACTION INTERNE — traduit les consignes d'exercices en français.
 *
 * Depuis le tableau de bord Convex (Preview → Functions) :
 *   translateExerciseDescriptions  { "limit": 30, "dryRun": true }
 *   translateExerciseDescriptions  { "limit": 0, "dryRun": false }
 */
export const translateExerciseDescriptions = internalAction({
	args: {
		/** Budget total (0 = tous les exercices restants). */
		limit: v.number(),
		/** Lecture seule : renvoie les traductions sans rien écrire. */
		dryRun: v.optional(v.boolean()),
	},
	// Annotation explicite : la fonction se référence elle-même dans
	// `ctx.scheduler.runAfter` (replanification), ce qui rendrait sinon son
	// type circulaire.
	handler: async (ctx, args): Promise<TranslationSummary> => {
		const model = translationModel();
		return runExerciseTranslation(
			{
				model,
				listUntranslated: (limit) => ctx.runQuery(internal.exerciseTranslation.listUntranslated, { limit }),
				translate: (items) => translateBatch(items, model),
				save: async (results) => {
					const out = await ctx.runMutation(internal.exerciseTranslation.saveTranslations, {
						items: results.map((item) => ({
							id: item.id as Id<"exercises">,
							instructionsFr: item.instructionsFr,
						})),
					});
					return out.saved;
				},
				schedule: async (nextLimit) => {
					await ctx.scheduler.runAfter(0, internal.exerciseTranslation.translateExerciseDescriptions, {
						limit: nextLimit,
						dryRun: false,
					});
				},
				log: async (entry) => {
					await ctx.runMutation(internal.aiLog.record, entry);
				},
			},
			{ limit: args.limit, dryRun: args.dryRun === true }
		);
	},
});
