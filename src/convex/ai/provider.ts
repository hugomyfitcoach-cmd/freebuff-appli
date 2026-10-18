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
 * ÉTAT M1 : seul le fournisseur `fake` est implémenté. Il renvoie un texte
 * déterministe construit avec le prénom et le libellé de semaine, après un
 * court délai simulé — aucun réseau, aucune clé, aucun coût. `openai` et
 * `anthropic` sont des emplacements vides (refus explicite, pas de repli
 * silencieux sur `fake`) prévus pour M2 et M4.
 */

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
	/** Consigne système (rôle et cadre), séparée du prompt utilisateur. */
	system: string;
	/** Prompt complet, déjà construit et testé par la fonctionnalité. */
	prompt: string;
	/** Plafond de sortie demandé au fournisseur (≈ 400 pour un brouillon). */
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
	inputTokens: number;
	outputTokens: number;
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
 * Emplacements réservés. Refus explicite : une variable d'environnement mal
 * renseignée ne doit jamais produire un texte fictif présenté comme réel.
 */
async function generateWithProvider(
	provider: string,
	input: GenerateTextInput
): Promise<{ text: string; model: string }> {
	switch (provider) {
		case "fake":
			return { text: await generateFakeText(input), model: DEFAULT_FAKE_MODEL };
		case "openai":
		case "anthropic":
			throw new Error(`Fournisseur IA « ${provider} » pas encore disponible.`);
		default:
			throw new Error("Fournisseur IA non configuré.");
	}
}

/**
 * FONCTION UNIQUE DE GÉNÉRATION DE TEXTE, appelable depuis une action Convex.
 *  - choisit le fournisseur et le modèle de la fonctionnalité ;
 *  - borne et nettoie le texte renvoyé ;
 *  - renvoie le texte + une empreinte d'usage (sans prompt ni données perso).
 */
export async function generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
	const started = Date.now();
	const config = resolveAiConfig(input.feature);
	const { text, model } = await generateWithProvider(config.provider, input);
	const cleaned = text.trim();
	if (!cleaned) throw new Error("Réponse vide du fournisseur IA.");
	return {
		text: cleaned,
		usage: {
			provider: config.provider,
			model: config.model || model,
			inputTokens: estimateTokens(`${input.system}\n${input.prompt}`),
			outputTokens: estimateTokens(cleaned),
			durationMs: Date.now() - started,
			estimatedCostUsd: 0,
		},
	};
}
