/**
 * Environnement dual-runtime : ce module vit côté BFF SvelteKit (preview/prod)
 * ET dans les actions Convex runtime node (voir aiAnalysis.ts — flux direct,
 * sans boucle Convex→BFF). `$env/dynamic/private` n'existe pas dans Convex :
 * on lit `process.env` qui est rempli par SvelteKit en dev/build et par le
 * runtime node Convex (variables d'environnement du déploiement).
 * ⚠️ La clé ne quitte JAMAIS ce module, n'est JAMAIS loggée, JAMAIS PUBLIC_*.
 */
type PrivateEnv = { OPENAI_API_KEY?: string; OPENAI_MODEL?: string };
/**
 * Lecture LIVE et DIRECTE de process.env à chaque appel. Jamais de spread
 * `{ ...process.env }` ni de cache : le runtime node Convex expose les
 * variables via des propriétés non énumérables — un spread renvoie un objet
 * VIDE (clé « invisible » alors qu'elle existe), et un cache module masque
 * les variables posées après le chargement.
 */
function aiEnv(): PrivateEnv {
	return {
		OPENAI_API_KEY: process.env.OPENAI_API_KEY,
		OPENAI_MODEL: process.env.OPENAI_MODEL,
	};
}

/**
 * Client OpenAI côté SERVEUR (BFF SvelteKit) — la clé ne quitte JAMAIS ce
 * module. Aucune dépendance npm : fetch direct de l'API Responses.
 *
 * Garde-fous demandés par la mission :
 * - modèle configurable via OPENAI_MODEL (défaut gpt-4o-mini) ;
 * - image redimensionnée/compressée AVANT analyse (déjà fait côté PWA —
 *   cette couche borne encore la taille du dataURL) ;
 * - réponse JSON structurée validée côté serveur (schémas + bornes) ;
 * - timeout propre + messages d'erreur métier (jamais de stack exposée) ;
 * - panne OpenAI = recherche, barcode et création manuelle toujours
 *   fonctionnels (les appelants dégradent, jamais ne cassent) ;
 * - traçabilité : modèle, tokens, durée, coût estimé (renvoyés à l'appelant,
 *   persistés côté Convex dans aiUsageLog — aucune donnée personnelle).
 */

const OPENAI_URL = 'https://api.openai.com/v1/responses';

/** Modèle configurable — borne stricte à des modèles vision textuels. */
function model(): string {
	const m = aiEnv().OPENAI_MODEL ?? 'gpt-4o-mini';
	return /^(gpt-4o(-mini)?|gpt-4\.1(-mini|-nano)?|o4-mini)$/.test(m) ? m : 'gpt-4o-mini';
}

/** Tarifs publics USD / 1M tokens (à date — borne l'estimation de coût). */
const PRICES: Record<string, { input: number; output: number }> = {
	'gpt-4o-mini': { input: 0.15, output: 0.6 },
	'gpt-4o': { input: 2.5, output: 10 },
	'gpt-4.1-mini': { input: 0.4, output: 1.6 },
	'gpt-4.1-nano': { input: 0.1, output: 0.4 },
	'o4-mini': { input: 1.1, output: 4.4 },
};

export type AiUsage = {
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	durationMs: number;
	estimatedCostUsd?: number;
};

export class OpenAiUnavailableError extends Error {}

/** dataURL → data:URI OpenAI (image_url). Borne la taille en mémoire. */
function assertImageDataUrl(dataUrl: string): void {
	if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl.slice(0, 64) === dataUrl ? dataUrl : dataUrl.slice(0, 64))) {
		if (!/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) {
			throw new OpenAiUnavailableError('Image invalide.');
		}
	}
	if (dataUrl.length > 4_500_000) {
		throw new OpenAiUnavailableError('Image trop lourde.');
	}
}

/** Appel générique Responses API en mode JSON strict. */
async function callOpenAi(
	prompt: string,
	imageDataUrl: string,
	maxOutputTokens: number
): Promise<{ json: unknown; usage: AiUsage }> {
	const key = aiEnv().OPENAI_API_KEY;
	if (!key) throw new OpenAiUnavailableError("Analyse IA non configurée sur le serveur.");
	assertImageDataUrl(imageDataUrl);

	const m = model();
	const started = Date.now();
	let res: Response;
	try {
		res = await fetch(OPENAI_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: m,
				max_output_tokens: maxOutputTokens,
				text: { format: { type: 'json_object' } },
				input: [
					{
						role: 'user',
						content: [
							{ type: 'input_text', text: prompt },
							{ type: 'input_image', image_url: imageDataUrl, detail: 'high' },
						],
					},
				],
			}),
			signal: AbortSignal.timeout(40_000),
		});
	} catch (e) {
		const name = e instanceof Error ? e.name : '';
		throw new OpenAiUnavailableError(name === 'TimeoutError' ? "L'analyse IA a dépassé le délai." : 'Service IA momentanément indisponible.');
	}
	if (!res.ok) {
		// Raison OpenAI (message court, sans donnée sensible) dans la réponse :
		// distingue quota insuffisant (à régler côté compte) d'un rate limit
		// passager (à réessayer) — sinon l'UI affiche une erreur générique.
		let detail = '';
		try {
			const j = (await res.json()) as { error?: { message?: string } };
			detail = typeof j.error?.message === 'string' ? ` — ${j.error.message.slice(0, 140)}` : '';
		} catch {
			// corps non JSON : on reste générique
		}
		throw new OpenAiUnavailableError(`Service IA indisponible (HTTP ${res.status})${detail}.`);
	}
	const raw = (await res.json()) as {
		output_text?: string;
		output?: { type: string; content?: { type: string; text?: string }[] }[];
		usage?: { input_tokens?: number; output_tokens?: number };
	};
	const text = raw.output_text ?? (raw.output ?? []).flatMap((o) => (o.content ?? []).map((c) => c.text ?? '')).join('');
	const durationMs = Date.now() - started;
	const inputTokens = raw.usage?.input_tokens;
	const outputTokens = raw.usage?.output_tokens;
	const prices = PRICES[m] ?? PRICES['gpt-4o-mini'];
	const estimatedCostUsd =
		inputTokens !== undefined && outputTokens !== undefined
			? Math.round(((inputTokens * prices.input + outputTokens * prices.output) / 1_000_000) * 100000) / 100000
			: undefined;
	if (!text) throw new OpenAiUnavailableError('Réponse IA vide.');
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new OpenAiUnavailableError('Réponse IA illisible.');
	}
	return { json, usage: { model: m, inputTokens, outputTokens, durationMs, estimatedCostUsd } };
}

/* ─────────────── ÉTIQUETTE NUTRITIONNELLE ─────────────── */

const LABEL_PROMPT = `Tu lis la photo d'une étiquette nutritionnelle de produit alimentaire, en français.
Extrait UNIQUEMENT ce qui est réellement écrit sur l'étiquette — n'invente aucune valeur.

RÈGLES CRITIQUES :
- Les valeurs demandées sont POUR 100 g / 100 ml. Si l'étiquette donne une colonne « par portion », IGNORE-la pour les champs principaux.
- Distinction kcal vs kJ : 1 kcal = 4,184 kJ. Si seuls des kJ sont indiqués, convertis en kcal et mets kcalFromKj=true.
- Si une valeur est absente, illisible ou ambiguë, laisse le champ à null — ne devine jamais.
- « sel » = sel ou équivalent-sel en g/100 g (pas le sodium ; si seul le sodium est donné, multiplie par 2,54).
- portion : seulement si l'étiquette indique clairement la taille d'une portion en g/ml.
- name : le nom du produit identifiable ; brand : la marque si identifiable.

Réponds STRICTEMENT en JSON avec ce schéma :
{"name": string|null, "brand": string|null, "kcal100": number|null, "carbs100": number|null, "protein100": number|null, "fat100": number|null, "fiber100": number|null, "salt100": number|null, "servingQty": number|null, "kcalFromKj": boolean, "confidence": number}`;

export type LabelResult = {
	name?: string;
	brand?: string;
	kcal100?: number;
	carbs100?: number;
	protein100?: number;
	fat100?: number;
	fiber100?: number;
	salt100?: number;
	servingQty?: number;
	kcalFromKj?: boolean;
	confidence?: number;
};

/** Analyse une photo d'étiquette → JSON structuré (validé). */
export async function analyzeLabelImage(imageDataUrl: string): Promise<{ analysis: LabelResult; usage: AiUsage }> {
	const { json, usage } = await callOpenAi(LABEL_PROMPT, imageDataUrl, 700);
	const o = (json ?? {}) as Record<string, unknown>;
	const num = (v: unknown, max: number): number | undefined => {
		const n = typeof v === 'number' ? v : Number(v);
		if (!isFinite(n) || n < 0) return undefined;
		return Math.min(max, Math.round(n * 10) / 10);
	};
	const str = (v: unknown): string | undefined => {
		const s = typeof v === 'string' ? v.trim().slice(0, 80) : '';
		return s.length >= 2 ? s : undefined;
	};
	return {
		analysis: {
			name: str(o.name),
			brand: str(o.brand),
			kcal100: num(o.kcal100, 900),
			carbs100: num(o.carbs100, 100),
			protein100: num(o.protein100, 100),
			fat100: num(o.fat100, 100),
			fiber100: num(o.fiber100, 90),
			salt100: num(o.salt100, 25),
			servingQty: num(o.servingQty, 2000),
			kcalFromKj: o.kcalFromKj === true,
			confidence: num(o.confidence, 1),
		},
		usage,
	};
}

/* ─────────────── REPAS PHOTOGRAPHIÉ ─────────────── */

const MEAL_PROMPT = `Tu regardes la photo d'un REPAS. Liste les aliments/composants visibles avec leur QUANTITÉ estimée en grammes.

RÈGLES CRITIQUES :
- Tu reconnais les aliments et proposes les quantités — tu n'es PAS la source nutritionnelle : ne calcule PAS de calories ni de macros.
- 2 à 6 composants maximum, du plus visible au moins visible. Nom en français, simple et générique (ex. « poulet grillé », « riz basmati », « courgettes », « sauce »).
- qtyGrams : estimation réaliste de la PORTION visible (pas la recette complète).
- kcal100/carbs100/protein100/fat100 : FOURNIS tout de même une estimation prudente /100 g pour chaque composant (bornes réalistes) — elle sera affichée comme « estimation à valider » UNIQUEMENT si la base G-FLUX ne trouve pas de correspondance. Utilise null si vraiment impossible.
- Si des éléments caloriques typiques sont probablement présents mais INVISIBLES (huile de cuisson, beurre, sauce versée, fromage râpé), ne les ajoute PAS à items : mets hint = « Huile, sauce ou matière grasse utilisée ? ».
- Photo floue, hors-sujet ou repas non identifiable → items = [] et note-le dans hint.

Réponds STRICTEMENT en JSON avec ce schéma :
{"items": [{"name": string, "qtyGrams": number, "kcal100": number|null, "carbs100": number|null, "protein100": number|null, "fat100": number|null, "note": string|null}], "hint": string|null}`;

export type MealComponentAi = {
	name: string;
	qtyGrams: number;
	kcal100?: number;
	carbs100?: number;
	protein100?: number;
	fat100?: number;
	note?: string;
};

export type MealResult = { items: MealComponentAi[]; hint?: string };

/** Analyse une photo de repas → composants + quantités (nutrition = repères). */
export async function analyzeMealImage(imageDataUrl: string): Promise<{ result: MealResult; usage: AiUsage }> {
	const { json, usage } = await callOpenAi(MEAL_PROMPT, imageDataUrl, 900);
	const o = (json ?? {}) as Record<string, unknown>;
	const num = (v: unknown, max: number): number | undefined => {
		const n = typeof v === 'number' ? v : Number(v);
		if (!isFinite(n) || n < 0) return undefined;
		return Math.min(max, Math.round(n * 10) / 10);
	};
	const items: MealComponentAi[] = [];
	for (const it of Array.isArray(o.items) ? o.items.slice(0, 8) : []) {
		const r = (it ?? {}) as Record<string, unknown>;
		const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
		if (name.length < 2) continue;
		const qty = num(r.qtyGrams, 2000) ?? 100;
		items.push({
			name,
			qtyGrams: Math.max(1, Math.round(qty)),
			kcal100: num(r.kcal100, 900),
			carbs100: num(r.carbs100, 100),
			protein100: num(r.protein100, 100),
			fat100: num(r.fat100, 100),
			note: typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 120) : undefined,
		});
		if (items.length >= 6) break;
	}
	return { result: { items, hint: typeof o.hint === 'string' && o.hint.trim() ? o.hint.trim().slice(0, 160) : undefined }, usage };
}
