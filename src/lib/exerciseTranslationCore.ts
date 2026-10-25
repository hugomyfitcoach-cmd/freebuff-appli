/**
 * Traduction FR des consignes d'exercices — ORCHESTRATION PURE.
 *
 * Ce module ne connaît ni Convex ni OpenAI : il reçoit ses dépendances
 * (lecture des exercices à traduire, appel fournisseur, écriture, journal,
 * replanification) et applique les règles de la mission :
 *
 *  - lots de 20 exercices ;
 *  - une exécution traite AU PLUS 200 exercices (sous la limite de 10 min
 *    d'une action Convex), puis se replanifie pour la suite ;
 *  - `limit` = budget TOTAL du travail ; 0 (ou négatif) = tous les restants ;
 *  - les exercices déjà traduits ne sont JAMAIS renvoyés au fournisseur ;
 *  - `dryRun` ne relit que le budget demandé, ne réécrit rien, ne journalise
 *    rien et ne se replanifie pas ;
 *  - toute erreur fournisseur arrête proprement la chaîne (aucune
 *    replanification) : la cause part dans aiUsageLog, jamais le texte.
 *
 * Le journal (`aiUsageLog`) ne reçoit que des métadonnées : jamais un nom
 * d'exercice, jamais une consigne, jamais un prompt.
 */

/** Taille d'un lot d'appel fournisseur. */
export const TRANSLATION_BATCH_SIZE = 20;
/** Plafond d'exercices traités par exécution (marge sous les 10 min Convex). */
export const MAX_PER_RUN = 200;

export type ExerciseToTranslate = {
	/** Identifiant Convex de la fiche. */
	id: string;
	/** Nom anglais — fourni comme CONTEXTE, jamais traduit ni journalisé. */
	name: string;
	/** Consignes d'origine (anglais). */
	instructions: string[];
	/** Traduction déjà présente : l'exercice est alors ignoré (relançable). */
	instructionsFr?: string[];
};

export type ExerciseTranslation = {
	id: string;
	instructionsFr: string[];
};

export type TranslationLogEntry = {
	kind: 'exercise_translation';
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	durationMs: number;
	status: 'ok' | 'error';
	estimatedCostUsd?: number;
	failReason?: string;
};

export type ProviderResult = {
	results: ExerciseTranslation[];
	inputTokens?: number;
	outputTokens?: number;
	estimatedCostUsd?: number;
};

export type TranslationDeps = {
	/** Modèle réellement appelé (journalisé). */
	model: string;
	/** Exercices non traduits, dans l'ordre de la bibliothèque (max `limit`). */
	listUntranslated(limit: number): Promise<ExerciseToTranslate[]>;
	/** Appel fournisseur sur un lot (≤ {@link TRANSLATION_BATCH_SIZE}). */
	translate(items: ExerciseToTranslate[]): Promise<ProviderResult>;
	/** Écriture des traductions ; renvoie le nombre de fiches mises à jour. */
	save(results: ExerciseTranslation[]): Promise<number>;
	/** Replanification de la suite avec le budget restant (0 = tout). */
	schedule(nextLimit: number): Promise<void>;
	/** Journalisation best-effort (métadonnées seules). */
	log(entry: TranslationLogEntry): Promise<void>;
	/** Horloge injectable (tests). */
	now?(): number;
};

export type TranslationSummary = {
	ok: boolean;
	dryRun: boolean;
	/** Exercices effectivement traduits (ou proposés en dryRun). */
	processed: number;
	/** Écritures réellement effectuées. */
	saved: number;
	/** Budget restant confié à l'exécution suivante (0 = terminé). */
	nextLimit: number;
	scheduled: boolean;
	/** Traductions renvoyées par un dryRun (jamais en écriture réelle). */
	translations?: ExerciseTranslation[];
	/** Cause d'arrêt (erreur fournisseur), sans aucun texte d'exercice. */
	reason?: string;
};

/** Borne la cause journalisée : message court, jamais de contenu d'exercice. */
function reasonOf(err: unknown): string {
	const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Erreur fournisseur.';
	return message.slice(0, 200);
}

/**
 * Ne garde que des traductions exploitables : identifiant demandé, étapes
 * non vides. Une réponse partielle du fournisseur ne crée jamais de fiche
 * vide (l'exercice reste « à traduire » et sera repris au prochain passage).
 */
function keepValid(results: unknown, batch: ExerciseToTranslate[]): ExerciseTranslation[] {
	if (!Array.isArray(results)) return [];
	const known = new Set(batch.map((item) => item.id));
	const seen = new Set<string>();
	const out: ExerciseTranslation[] = [];
	for (const raw of results) {
		if (!raw || typeof raw !== 'object') continue;
		const id = (raw as { id?: unknown }).id;
		const lines = (raw as { instructionsFr?: unknown }).instructionsFr;
		if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
		if (!Array.isArray(lines)) continue;
		const clean = lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).map((line) => line.trim());
		if (clean.length === 0) continue;
		seen.add(id);
		out.push({ id, instructionsFr: clean });
	}
	return out;
}

/**
 * Exécute UNE passe de traduction.
 *
 * @param args.limit budget total demandé (0 = tous les exercices restants)
 * @param args.dryRun lecture seule : renvoie les traductions sans écrire
 */
export async function runExerciseTranslation(
	deps: TranslationDeps,
	args: { limit: number; dryRun?: boolean }
): Promise<TranslationSummary> {
	const dryRun = args.dryRun === true;
	const clock = deps.now ?? Date.now;
	const requested = Number.isFinite(args.limit) ? Math.floor(args.limit) : 0;
	const budget = requested > 0 ? requested : Number.POSITIVE_INFINITY;
	const cap = Math.min(budget, MAX_PER_RUN);

	// Le plafond par exécution est fini : `cap` l'est toujours.
	const queue = await deps.listUntranslated(cap);
	// Garde-fou : une fiche déjà traduite n'est jamais renvoyée au fournisseur,
	// même si l'appelant l'a laissée passer.
	const pending = queue.filter((item) => !(item.instructionsFr && item.instructionsFr.length > 0)).slice(0, cap);
	const more = queue.length >= cap;

	const translations: ExerciseTranslation[] = [];
	let saved = 0;

	for (let i = 0; i < pending.length; i += TRANSLATION_BATCH_SIZE) {
		const batch = pending.slice(i, i + TRANSLATION_BATCH_SIZE);
		const startedAt = clock();
		let out: ProviderResult;
		try {
			out = await deps.translate(batch);
		} catch (err) {
			const reason = reasonOf(err);
			const durationMs = Math.max(0, clock() - startedAt);
			if (!dryRun) {
				await deps.log({
					kind: 'exercise_translation',
					model: deps.model,
					durationMs,
					status: 'error',
					failReason: reason,
				}).catch(() => undefined);
			}
			// Arrêt propre : aucune replanification (la chaîne s'arrête ici).
			return {
				ok: false,
				dryRun,
				processed: translations.length,
				saved,
				nextLimit: 0,
				scheduled: false,
				reason,
				...(dryRun ? { translations } : {}),
			};
		}

		const valid = keepValid(out.results, batch);
		translations.push(...valid);

		if (!dryRun) {
			// Écriture LOT PAR LOT : une panne fournisseur plus tard ne perd pas
			// les traductions déjà obtenues (et ne les repaye pas au passage
			// suivant).
			if (valid.length > 0) saved += await deps.save(valid);
			await deps.log({
				kind: 'exercise_translation',
				model: deps.model,
				inputTokens: out.inputTokens,
				outputTokens: out.outputTokens,
				durationMs: Math.max(0, clock() - startedAt),
				status: 'ok',
				estimatedCostUsd: out.estimatedCostUsd,
			}).catch(() => undefined);
		}
	}

	if (dryRun) {
		return {
			ok: true,
			dryRun,
			processed: translations.length,
			saved: 0,
			nextLimit: 0,
			scheduled: false,
			translations,
		};
	}

	// Budget restant : le plafond de 200 n'a de sens que s'il reste du travail
	// ET du budget. Un `limit` atteint termine la chaîne.
	const budgetAfter = Number.isFinite(budget) ? budget - pending.length : Number.POSITIVE_INFINITY;
	const shouldSchedule = more && pending.length > 0 && budgetAfter > 0;
	const nextLimit = shouldSchedule ? (Number.isFinite(budgetAfter) ? budgetAfter : 0) : 0;
	if (shouldSchedule) await deps.schedule(nextLimit);

	return {
		ok: true,
		dryRun,
		processed: translations.length,
		saved,
		nextLimit,
		scheduled: shouldSchedule,
	};
}
