/**
 * FOURNISSEUR DE TEXTE GÉNÉRIQUE — POINT D'ENTRÉE UNIQUE DE L'IA.
 *
 * Décision 3 de `docs/coach-ai-drafts.md` : un seul module, réutilisable par
 * les autres fonctionnalités IA (analyses à la demande M6). Fournisseur et
 * modèle sont réglés PAR FONCTIONNALITÉ :
 *
 *   AI_PROVIDER_COACH_DRAFT   ·  AI_MODEL_COACH_DRAFT
 *   AI_COACH_DRAFT_DISABLED   (arrêt d'urgence, ON = désactivé)
 *
 * Le suffixe vient de la fonctionnalité (`coach_draft` → `COACH_DRAFT`).
 * Aucune autre couche ne connaît le fournisseur : une action Convex appelle
 * `generateText`, point.
 *
 * ⚠️ Ce module vit côté Convex et lit `process.env` — JAMAIS `$env` SvelteKit.
 * Le runtime Convex expose les variables via des propriétés non énumérables :
 * on les lit une par une (jamais de spread `{ ...process.env }`, qui renvoie
 * un objet vide), à chaque appel (jamais de cache de module).
 *
 * M3 : le fournisseur `openai` est branché — même clé et même client que
 * l'analyse des repas (`src/lib/server/openai.ts`, importé ici, appel réseau
 * uniquement depuis une action Convex côté serveur). Le modèle est lu dans
 * `OPENAI_COACH_DRAFT_MODEL` : AUCUN nom de modèle écrit en dur. Variable
 * absente ou vide → fournisseur `fake` (tests et repli). L'arrêt d'urgence
 * `AI_COACH_DRAFT_DISABLED` reste PRIORITAIRE : il coupe avant toute
 * résolution de fournisseur et tout appel.
 *
 * Le fournisseur `fake` reste : texte déterministe construit avec le prénom et
 * le libellé de semaine, après un court délai simulé — aucun réseau, aucune
 * clé, aucun coût. `anthropic` reste un emplacement vide (refus explicite).
 */

// Même clé et même client OpenAI que l'analyse des repas — import serveur
// uniquement (jamais dans le bundle navigateur, jamais côté client).
import { generateCoachDraftText } from "../../lib/server/openai";

/** Fonctionnalités IA connues — le suffixe d'environnement en découle. */
export type AiFeature = "coach_draft";

/** Fournisseurs prévus. M1 n'en implémente qu'un. */
export type AiProviderName = "fake" | "openai" | "anthropic";

/**
 * Variables d'environnement par fonctionnalité — noms EXPLICITES, pour que
 * le contrat `AI_PROVIDER_COACH_DRAFT` / `AI_MODEL_COACH_DRAFT` /
 * `AI_COACH_DRAFT_DISABLED` soit lisible et testable sans recomposer une
 * chaîne de caractères.
 */
const FEATURE_ENV: Record<AiFeature, { provider: string; model: string; disabled: string }> = {
	coach_draft: {
		provider: "AI_PROVIDER_COACH_DRAFT",
		model: "AI_MODEL_COACH_DRAFT",
		disabled: "AI_COACH_DRAFT_DISABLED",
	},
};

/** Fournisseur par défaut tant que la M1 est la seule livrée. */
const DEFAULT_PROVIDER: AiProviderName = "fake";

/** Modèle fictif par défaut (aucun appel réseau, aucun tarif). */
export const DEFAULT_FAKE_MODEL = "fake-deterministic-v1";

/**
 * Variable du modèle OpenAI du brouillon. C'est l'UNIQUE interrupteur du vrai
 * fournisseur : présente et non vide → `openai` avec CE modèle ; absente ou
 * vide (une variable vide est traitée comme absente) → fournisseur factice.
 */
export const COACH_DRAFT_MODEL_ENV = "OPENAI_COACH_DRAFT_MODEL";

/** Délai simulé du fournisseur `fake` (ms) — « court délai » de la mission. */
export const FAKE_PROVIDER_DELAY_MS = 300;

/** Valeurs d'environnement acceptées comme « actif » pour un kill switch. */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export type AiEnv = Partial<Record<string, string | undefined>>;

/**
 * ARRÊT D'URGENCE par fonctionnalité : `AI_<FEATURE>_DISABLED` (ici
 * `AI_COACH_DRAFT_DISABLED`). Actif dès que la valeur vaut 1/true/yes/on.
 * Lu à chaque appel : poser/retirer la variable suffit, sans redéploiement.
 */
export function isAiFeatureDisabled(feature: AiFeature, env: AiEnv = process.env): boolean {
	const raw = env[FEATURE_ENV[feature].disabled];
	return typeof raw === "string" && TRUTHY.has(raw.trim().toLowerCase());
}

export type AiConfig = {
	provider: string;
	model: string;
};

/**
 * Résout le couple fournisseur + modèle de la fonctionnalité.
 * Valeurs vides ou absentes → `fake` / modèle fictif par défaut.
 * Les valeurs sont volontairement renvoyées brutes : `generateText` refuse
 * un fournisseur inconnu au lieu de basculer silencieusement sur `fake`.
 */
export function resolveAiConfig(feature: AiFeature, env: AiEnv = process.env): AiConfig {
	const names = FEATURE_ENV[feature];
	const provider = (env[names.provider] ?? "").trim().toLowerCase() || DEFAULT_PROVIDER;
	const model = (env[names.model] ?? "").trim() || (provider === "fake" ? DEFAULT_FAKE_MODEL : "");
	return { provider, model };
}

export type GenerateTextInput = {
	feature: AiFeature;
	/** Environnement de test — défaut : `process.env` (lecture live). */
	env?: AiEnv;
	/** Consigne système (rôle et cadre), séparée du prompt utilisateur. */
	system: string;
	/** Prompt complet, déjà construit et testé par la fonctionnalité. */
	prompt: string;
	/**
	 * Plafond de sortie demandé au fournisseur. 2 000 par défaut : le texte
	 * attendu reste court, la marge sert au RAISONNEMENT du modèle (sinon la
	 * sortie est coupée en pleine phrase).
	 */
	maxTokens?: number;
	/**
	 * Repères factuels réservés au fournisseur `fake`. Un vrai fournisseur ne
	 * les reçoit JAMAIS : le prompt reste la seule entrée transmise.
	 */
	fakeFacts?: {
		prenom?: string;
		weekLabel?: string;
	};
};

export type GenerateTextUsage = {
	provider: string;
	model: string;
	/** Tokens lus (entrée). */
	inputTokens: number;
	/** Tokens écrits (sortie). */
	outputTokens: number;
	/** Tokens d'entrée servis depuis le cache de prompt — 0 pour le factice. */
	cachedInputTokens: number;
	durationMs: number;
	/** Coût estimé USD — toujours 0 pour le fournisseur fictif. */
	estimatedCostUsd: number;
};

export type GenerateTextResult = {
	text: string;
	usage: GenerateTextUsage;
};

/** Estimation grossière et déterministe (~4 caractères par token). */
function estimateTokens(value: string): number {
	return Math.max(1, Math.ceil(value.length / 4));
}

function cleanFact(value: string | undefined, fallback: string): string {
	const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
	return trimmed.length > 0 ? trimmed.slice(0, 120) : fallback;
}

/**
 * Texte du fournisseur fictif — DÉTERMINISTE : mêmes entrées → même sortie.
 * Construit uniquement à partir du contexte fourni (prénom, semaine), sans
 * aucun chiffre inventé. Le préfixe explicite empêche de confondre ce
 * brouillon de test avec une vraie génération en Preview.
 */
export function buildFakeDraftText(fakeFacts?: GenerateTextInput["fakeFacts"]): string {
	const prenom = cleanFact(fakeFacts?.prenom, "toi");
	const weekLabel = cleanFact(fakeFacts?.weekLabel, "cette semaine");
	return [
		`Brouillon de test — aucune IA réelle n'a été appelée.`,
		`${prenom}, merci pour ton bilan de la semaine ${weekLabel}. Ce qu'on garde de cette semaine, c'est la régularité : tu as continué à te présenter et à noter tes repas, et c'est la base sur laquelle on avance.`,
		`On garde une seule priorité pour la suite : une action simple, réaliste et répétable sur le point qui te coûte le moins d'énergie. Le reste suit sans pression, et on en reparle à ton prochain bilan.`,
	].join("\n\n");
}

/** Fournisseur fictif : court délai simulé puis texte déterministe. */
async function generateFakeText(input: GenerateTextInput): Promise<string> {
	await new Promise((resolve) => setTimeout(resolve, FAKE_PROVIDER_DELAY_MS));
	return buildFakeDraftText(input.fakeFacts);
}

/**
 * Résolution EFFECTIVE de la génération. Au contrat historique
 * (`AI_PROVIDER_COACH_DRAFT` / `AI_MODEL_COACH_DRAFT`) s'ajoute la variable
 * dédiée `OPENAI_COACH_DRAFT_MODEL` : présente et non vide, elle active le
 * vrai fournisseur `openai` avec CE modèle (aucun nom écrit en dur). Absente
 * OU vide → fournisseur factice, même si `AI_PROVIDER_COACH_DRAFT` demande
 * `openai` : aucun appel réel sans modèle explicite.
 */
export function resolveGenerationConfig(feature: AiFeature, env: AiEnv = process.env): AiConfig {
	const base = resolveAiConfig(feature, env);
	if (feature !== "coach_draft") return base;
	const draftModel = (env[COACH_DRAFT_MODEL_ENV] ?? "").trim();
	if (draftModel) return { provider: "openai", model: draftModel };
	if (base.provider === "openai") return { provider: DEFAULT_PROVIDER, model: DEFAULT_FAKE_MODEL };
	return base;
}

/**
 * Dispatch fournisseurs. Refus explicite : une variable d'environnement mal
 * renseignée ne doit jamais produire un texte fictif présenté comme réel.
 * Usage retourné : `null` pour le factice (estimé ensuite par le module).
 */
async function generateWithProvider(
	provider: string,
	model: string,
	input: GenerateTextInput
): Promise<{ text: string; usage: Omit<GenerateTextUsage, "provider"> | null }> {
	switch (provider) {
		case "fake":
			return { text: await generateFakeText(input), usage: null };
		case "openai": {
			// Client unique réutilisé avec l'analyse des repas : même clé, même
			// cœur d'appel. Modèle fourni par l'appelant (jamais en dur).
			const { text, usage } = await generateCoachDraftText({
				system: input.system,
				prompt: input.prompt,
				model,
				maxOutputTokens: input.maxTokens ?? 2000,
			});
			return {
				text,
				usage: {
					model: usage.model,
					inputTokens: usage.inputTokens ?? 0,
					outputTokens: usage.outputTokens ?? 0,
					cachedInputTokens: usage.cachedInputTokens ?? 0,
					durationMs: usage.durationMs,
					estimatedCostUsd: usage.estimatedCostUsd ?? 0,
				},
			};
		}
		case "anthropic":
			throw new Error(`Fournisseur IA « ${provider} » pas encore disponible.`);
		default:
			throw new Error("Fournisseur IA non configuré.");
	}
}

/**
 * FONCTION UNIQUE DE GÉNÉRATION DE TEXTE, appelable depuis une action Convex.
 *  - vérifie l'arrêt d'urgence EN PREMIER (prioritaire sur tout le reste) ;
 *  - choisit le fournisseur et le modèle de la fonctionnalité ;
 *  - borne et nettoie le texte renvoyé ;
 *  - renvoie le texte + une empreinte d'usage (modèle, tokens lus/écrits/
 *    mis en cache, durée — sans prompt ni données perso).
 */
export async function generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
	const env = input.env ?? process.env;
	// ARRÊT D'URGENCE PRIORITAIRE : aucune résolution de fournisseur, aucun
	// appel réseau, aucun coût — même si le vrai fournisseur est configuré.
	if (isAiFeatureDisabled(input.feature, env)) {
		throw new Error("La préparation de brouillon est momentanément désactivée.");
	}
	const started = Date.now();
	const config = resolveGenerationConfig(input.feature, env);
	const { text, usage } = await generateWithProvider(config.provider, config.model, input);
	const cleaned = text.trim();
	if (!cleaned) throw new Error("Réponse vide du fournisseur IA.");
	return {
		text: cleaned,
		usage: usage ? { provider: config.provider, ...usage } : {
			provider: config.provider,
			model: config.model || DEFAULT_FAKE_MODEL,
			inputTokens: estimateTokens(`${input.system}\n${input.prompt}`),
			outputTokens: estimateTokens(cleaned),
			cachedInputTokens: 0,
			durationMs: Date.now() - started,
			estimatedCostUsd: 0,
		},
	};
}
