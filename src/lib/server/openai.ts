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

import { resolveLabel100, type LabelColumn, type ResolvedLabel100 } from '../labelColumns';

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

RÈGLES CRITIQUES — COLONNES (le plus important) :
- Une étiquette affiche souvent PLUSIEURS colonnes, ex. « pour 100 g » et « par portion (30 g) ». Tu dois les lire comme DEUX blocs SÉPARÉS et ne JAMAIS mélanger leurs valeurs.
- per100 : remplis ce bloc UNIQUEMENT avec la colonne « pour 100 g » / « pour 100 ml ». Chaque champ (kcal, glucides, protéines, lipides, fibres, sel) doit venir de CETTE colonne-là — jamais un kcal de la portion avec des protéines du 100 g, jamais l'inverse.
- serving : remplis ce bloc UNIQUEMENT avec la colonne « portion » (ou « par portion »). grams = poids de la portion indiqué (ex. 30 pour « portion 30 g »). null si la colonne n'existe pas ou ne précise pas de poids.
- Un liquide utilise 100 ml (et non 100 g) — même logique : la colonne 100 ml remplit per100 avec isLiquid=true.
- Si SEULE la colonne portion existe : remplis serving, laisse per100 à null. Ne convertis JAMAIS toi-même portion → 100 g (la conversion est faite côté serveur).
- Si les deux colonnes existent mais l'une est incomplète : remplis chaque bloc avec ce qu'il montre, même partiellement — null pour ce qui manque. Ne comble JAMAIS un trou d'une colonne avec l'autre.

AUTRES RÈGLES :
- Distinction kcal vs kJ : 1 kcal = 4,184 kJ. Si seuls des kJ sont indiqués, mets-les dans kj (sans conversion) et laisse kcalFromKj=false (la conversion est faite côté serveur).
- Si une valeur est absente, illisible ou ambiguë, laisse le champ à null — ne devine jamais.
- « sel » = sel ou équivalent-sel en g/100 g (pas le sodium ; si seul le sodium est donné, multiplie par 2,54).
- name : le nom du produit identifiable ; brand : la marque si identifiable.
- confidence : ta confiance que les valeurs de per100 viennent bien TOUS de la même colonne (0–1).

Réponds STRICTEMENT en JSON avec ce schéma :
{"name": string|null, "brand": string|null, "per100": {"grams": number|null, "isLiquid": boolean, "kcal": number|null, "kj": number|null, "carbs": number|null, "protein": number|null, "fat": number|null, "fiber": number|null, "salt": number|null}|null, "serving": {"grams": number|null, "isLiquid": boolean, "kcal": number|null, "kj": number|null, "carbs": number|null, "protein": number|null, "fat": number|null, "fiber": number|null, "salt": number|null}|null, "kcalFromKj": boolean, "confidence": number}`;

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

/** Colonne d'étiquette renvoyée par l'IA (bloc per100 / serving). */
type AiLabelColumn = {
	grams?: unknown;
	isLiquid?: unknown;
	kcal?: unknown;
	kj?: unknown;
	carbs?: unknown;
	protein?: unknown;
	fat?: unknown;
	fiber?: unknown;
	salt?: unknown;
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
	/* Colonnes déclarées par l'IA → résolution SANS mélange (lib/labelColumns.ts) :
	   la colonne 100 g/100 ml est exclusive ; sinon portion convertie proprement ;
	   sinon champs vides (jamais d'invention). Les kcal/kj de la portion ne
	   touchent JAMAIS les macros du 100 g, et inversement. */
	const per100 = parseLabelColumn(o.per100);
	const serving = parseLabelColumn(o.serving);
	const hasPer100 = per100 !== null && (
		num_(per100.kcal) !== null || num_(per100.kj) !== null || num_(per100.carbs) !== null ||
		num_(per100.protein) !== null || num_(per100.fat) !== null || num_(per100.fiber) !== null ||
		num_(per100.salt) !== null || num_(per100.grams) !== null
	);
	const hasServing = serving !== null && (
		num_(serving.kcal) !== null || num_(serving.kj) !== null || num_(serving.carbs) !== null ||
		num_(serving.protein) !== null || num_(serving.fat) !== null || num_(serving.fiber) !== null ||
		num_(serving.salt) !== null || num_(serving.grams) !== null
	);
	let resolved: ResolvedLabel100;
	if (hasPer100 || hasServing) {
		resolved = resolveLabel100({ per100: hasPer100 ? per100! : null, serving: hasServing ? serving! : null });
	} else {
		// Réponse IA ancienne-format (kcal100 etc. au niveau racine) : compat
		// dégradation — traitée comme une colonne 100 g déclarée par le modèle.
		resolved = resolveLabel100({
			per100: {
				grams: 100,
				kcal: num_(o.kcal100),
				kj: null,
				carbs: num_(o.carbs100),
				protein: num_(o.protein100),
				fat: num_(o.fat100),
				fiber: num_(o.fiber100),
				salt: num_(o.salt100),
			},
			serving: null,
		});
	}
	return {
		analysis: {
			name: str(o.name),
			brand: str(o.brand),
			kcal100: resolved.kcal,
			carbs100: resolved.carbs,
			protein100: resolved.protein,
			fat100: resolved.fat,
			fiber100: resolved.fromPer100 && per100 ? (num_(per100.fiber) ?? undefined) : undefined,
			salt100: resolved.fromPer100 && per100 ? (num_(per100.salt) ?? undefined) : undefined,
			servingQty: resolved.servingQty,
			kcalFromKj: resolved.kcalFromKj === true,
			confidence: num(o.confidence, 1),
		},
		usage,
	};
}

/** Chiffre exploitable ou null (jamais undefined dans les colonnes). */
function num_(v: unknown): number | null {
	const n = typeof v === 'number' ? v : Number(v);
	return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null;
}
/** Colonne IA brute → LabelColumn (valeurs bornées plus tard au clamps serveur). */
function parseLabelColumn(v: unknown): LabelColumn | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const c = v as AiLabelColumn;
	return {
		grams: num_(c.grams),
		isLiquid: c.isLiquid === true,
		kcal: num_(c.kcal),
		kj: num_(c.kj),
		carbs: num_(c.carbs),
		protein: num_(c.protein),
		fat: num_(c.fat),
		fiber: num_(c.fiber),
		salt: num_(c.salt),
	};
}

/* ─────────────── REPAS PHOTOGRAPHIÉ ─────────────── */

const MEAL_PROMPT = `Tu regardes la photo envoyée par une utilisatrice pour tracker son repas. Détermine d'abord CE QUE MONTRE la photo, puis liste les composants.

TYPE DE PHOTO (photoType, obligatoire) :
- "meal" : un repas servi — aliments servis ou bruts dans une assiette, un bol, un verre ;
- "packaged_product" : un produit EMBALLÉ est le sujet (paquet de bonbons, bouteille de lait, brique de jus, boîte de riz, pot de yaourt, paquet de céréales…) ;
- "barcode" : un code-barres est nettement lisible sur l'emballage ;
- "nutrition_label" : une étiquette / un tableau nutritionnel est le sujet principal ;
- "unclear" : photo floue au point de rien reconnaître, hors-sujet, ou vide d'aliment.

RÈGLES CRITIQUES — COMPOSANTS :
- Tu reconnais les aliments et proposes les quantités — tu n'es PAS la source nutritionnelle : ne calcule PAS de calories ni de macros.
- ÉTAT DE L'ALIMENT : nomme chaque composant TEL QU'IL EST SERVI ET CONSOMMÉ dans l'assiette. Les féculents visibles (riz, pâtes, semoule, quinoa, boulgour, couscous, nouilles) sont CUITS dans un repas servi : écris « riz basmati cuit », « pâtes cuites », « semoule cuite », sauf si la photo montre clairement l'aliment sec/cru (alors précise « cru » ou « sec » dans le nom).
- 1 à 6 composants maximum, du plus visible au moins visible. Nom en français, simple (ex. « poulet grillé », « riz basmati cuit », « courgettes », « sauce »).
- PRODUIT EMBALLÉ : UN SEUL composant par produit. Renseigne alors :
  - brand : la marque réellement imprimée (ex. « Haribo », « Tropicana », « Lactel », « Coca-Cola ») — null si absente ou illisible ;
  - variant : la variante / déclinaison imprimée (ex. « Dragibus », « demi-écrémé », « jus de pomme », « Zero », « complet ») — null si absente ;
  - barcode : les chiffres du code-barres UNIQUEMENT s'ils sont NETTEMENT lisibles (EAN-13) — null sinon, ne devine JAMAIS un code ;
  - packaged : true pour tout produit emballé, false pour un aliment servi/brut.
- name pour un produit emballé : le nom du PRODUIT (ex. « Dragibus », « lait demi-écrémé », « jus de pomme », « Coca-Cola Zero ») — la marque vit dans brand, pas dans name.
- qtyGrams : estimation réaliste de la QUANTITÉ consommée (portion du produit, pas le poids du paquet entier sauf s'il est consommé entier).
- kcal100/carbs100/protein100/fat100 : FOURNIS tout de même une estimation prudente /100 g pour chaque composant (bornes réalistes) — elle sera affichée comme « estimation à valider » UNIQUEMENT si la base G-FLUX ne trouve pas de correspondance. Utilise null si vraiment impossible.
- Si des éléments caloriques typiques sont probablement présents mais INVISIBLES (huile de cuisson, beurre, sauce versée, fromage râpé), ne les ajoute PAS à items : mets hint = « Huile, sauce ou matière grasse utilisée ? ».
- INTERDIT — RÉPONSES VIDES : n'écris JAMAIS « no comment », « unknown », « non identifié » ou tout autre placeholder dans name. Photo inexploitable → items = [] et photoType = "unclear". Photo floue mais où un aliment reste reconnaissable → liste-le quand même (l'estimation reste possible).

Réponds STRICTEMENT en JSON avec ce schéma :
{"photoType": "meal"|"packaged_product"|"barcode"|"nutrition_label"|"unclear", "items": [{"name": string, "qtyGrams": number, "brand": string|null, "variant": string|null, "barcode": string|null, "packaged": boolean, "kcal100": number|null, "carbs100": number|null, "protein100": number|null, "fat100": number|null, "note": string|null}], "hint": string|null}`;

export type MealPhotoType = 'meal' | 'packaged_product' | 'barcode' | 'nutrition_label' | 'unclear';

export type MealComponentAi = {
	name: string;
	qtyGrams: number;
	/** Produit emballé : marque imprimée (ex. « Haribo ») — jamais inventée. */
	brand?: string;
	/** Variante / déclinaison imprimée (ex. « Dragibus », « demi-écrémé »). */
	variant?: string;
	/** Code-barres UNIQUEMENT s'il est nettement lisible (chiffres seuls). */
	barcode?: string;
	/** Produit emballé (paquet, bouteille, brique, pot…) vs aliment servi. */
	packaged?: boolean;
	kcal100?: number;
	carbs100?: number;
	protein100?: number;
	fat100?: number;
	note?: string;
};

export type MealResult = { photoType: MealPhotoType; items: MealComponentAi[]; hint?: string };

/** Placeholders interdits (« no comment », « unknown »…) — normalisés sans accents. */
const PLACEHOLDER_RE =
	/^(no\s*comment|aucun(e|s)?|unknown|unkown|non\s*identifi\w*|inconnu(e|s)?|pas\s*d[e']\w*|none|null|n\/a|rien|vide)$/;

/**
 * Valide la réponse Repas IA : bornes, placeholders interdits, code-barres
 * plausibles. Une photo « no comment » devient items = [] (jamais un faux
 * composant affiché à l'utilisatrice).
 */
export function parseMealComponents(json: unknown): MealResult {
	const o = (json ?? {}) as Record<string, unknown>;
	const photoType = (['meal', 'packaged_product', 'barcode', 'nutrition_label', 'unclear'] as const).includes(
		o.photoType as MealPhotoType
	)
		? (o.photoType as MealPhotoType)
		: 'unclear';
	const num = (v: unknown, max: number): number | undefined => {
		const n = typeof v === 'number' ? v : Number(v);
		if (!isFinite(n) || n < 0) return undefined;
		return Math.min(max, Math.round(n * 10) / 10);
	};
	const str = (v: unknown, max = 80): string | undefined => {
		const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
		return s.length >= 2 ? s : undefined;
	};
	const items: MealComponentAi[] = [];
	for (const it of Array.isArray(o.items) ? o.items.slice(0, 8) : []) {
		const r = (it ?? {}) as Record<string, unknown>;
		const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
		// Garde anti-« no comment » : un placeholder n'est PAS un composant.
		const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
		if (name.length < 2 || PLACEHOLDER_RE.test(normalized) || !/[a-z0-9]/i.test(name)) continue;
		const brand = str(r.brand);
		const barcodeRaw = typeof r.barcode === 'string' || typeof r.barcode === 'number' ? String(r.barcode).replace(/\D/g, '') : '';
		const barcode = barcodeRaw.length >= 8 && barcodeRaw.length <= 14 ? barcodeRaw : undefined;
		const variant = str(r.variant);
		items.push({
			name,
			qtyGrams: Math.max(1, Math.min(2000, Math.round(num(r.qtyGrams, 2000) ?? 100))),
			brand,
			variant,
			barcode,
			// Produit emballé déclaré OU identifiable (marque / code lisible).
			packaged: r.packaged === true || !!brand || !!barcode,
			kcal100: num(r.kcal100, 900),
			carbs100: num(r.carbs100, 100),
			protein100: num(r.protein100, 100),
			fat100: num(r.fat100, 100),
			note: typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 120) : undefined,
		});
		if (items.length >= 6) break;
	}
	return { photoType, items, hint: typeof o.hint === 'string' && o.hint.trim() ? o.hint.trim().slice(0, 160) : undefined };
}

/** Analyse une photo (repas OU produit emballé) → composants + quantités
 *  (nutrition = repères ; la base G-FLUX tranche, jamais l'IA). */
export async function analyzeMealImage(imageDataUrl: string): Promise<{ result: MealResult; usage: AiUsage }> {
	const { json, usage } = await callOpenAi(MEAL_PROMPT, imageDataUrl, 1100);
	return { result: parseMealComponents(json), usage };
}

/* ─────────────── RECETTE PHOTOGRAPHIÉE (import de recette) ─────────────── */

const RECIPE_PROMPT = `Tu lis la photo d'une RECETTE (page de livre de cuisine, fiche imprimée, capture d'écran, liste d'ingrédients tapée ou manuscrite) pour pré-remplir la création d'un repas dans un suivi nutritionnel. Tu extrais la LISTE D'INGRÉDIENTS avec leurs QUANTITÉS — tu n'es PAS la source nutritionnelle : ne calcule PAS de calories totales.

TYPE DE PHOTO (photoType, obligatoire) :
- "recipe" : une recette / liste d'ingrédients avec quantités est le sujet principal ;
- "unclear" : photo floue au point de ne rien lire, ou qui ne montre PAS une liste d'ingrédients (ex. un plat déjà servi dans une assiette — ce cas est traité par une autre fonction).

RÈGLES CRITIQUES — INGRÉDIENTS :
- Liste chaque ingrédient DANS L'ORDRE de la recette, avec SA quantité exactement telle qu'écrite.
- name : nom de l'ingrédient en français, simple et générique (ex. « quinoa », « brocolis », « blanc de poulet »). Pour un produit de marque listé (ex. « 1 yaourt Délisse Stracciatella ») : name = le produit, brand = la marque imprimée, variant = la variante imprimée, packaged = true. Pour un aliment générique : packaged = false, brand et variant = null.
- qtyRaw : la quantité EXACTEMENT telle qu'écrite (ex. « 50 g », « 2 œufs », « 1 cuillère à soupe d'huile », « 150 ml »), null si aucune quantité n'est écrite.
- unit : l'unité écrite : "g" (g/kg), "ml" (ml/cl/l), "piece" (pièces : œufs, tranches, filets…), "cuillere" (cuillère à soupe ou à café), null si ambigu ou absente.
- qtyGrams : le poids en GRAMMES, UNIQUEMENT si la conversion est fiable :
  · g/kg → direct (1 kg = 1000 g) ; cl/ml/l → ×1 pour les liquides courants (150 ml = 150) ;
  · repères fiables : œuf moyen = 50 g, tranche de jambon blanc = 25 g, cuillère à soupe d'huile = 10 g, cuillère à soupe de liquide = 15 g, cuillère à café = 5 g ;
  · SINON (« à discrétion », « 1 verre », « 1 bol », « une poignée », chiffre illisible) → qtyGrams = null et qtyUncertain = true. Ne devine JAMAIS un poids.
- qtyUncertain = true aussi si la photo est floue sur CE chiffre précis ou si l'unité est ambiguë, même après conversion.
- kcal100/carbs100/protein100/fat100 : FOURNIS tout de même une estimation prudente /100 g pour chaque ingrédient (bornes réalistes) — elle n'est affichée que si aucune fiche alimentaire fiable n'est trouvée. null si vraiment impossible.
- 12 ingrédients maximum, du premier au dernier de la liste ; ignore le sel, le poivre et les épices négligeables ; ne fusionne PAS deux lignes.
- servings : le nombre de personnes/portions UNIQUEMENT s'il est clairement écrit (ex. « Pour 4 personnes » → 4), sinon null. Ne calcule RIEN à partir de servings.
- name (racine) : le TITRE de la recette UNIQUEMENT s'il est clairement visible (ex. « Poulet quinoa brocolis »), sinon null.

INTERDIT — RÉPONSES VIDES : n'écris JAMAIS « no comment », « unknown », « non identifié » ou tout autre placeholder dans name. Photo inexploitable → items = [] et photoType = "unclear".

Réponds STRICTEMENT en JSON avec ce schéma :
{"photoType": "recipe"|"unclear", "name": string|null, "servings": number|null, "items": [{"name": string, "brand": string|null, "variant": string|null, "packaged": boolean, "qtyRaw": string|null, "unit": "g"|"ml"|"piece"|"cuillere"|null, "qtyGrams": number|null, "qtyUncertain": boolean, "kcal100": number|null, "carbs100": number|null, "protein100": number|null, "fat100": number|null, "note": string|null}]}`;

export type RecipeUnit = 'g' | 'ml' | 'piece' | 'cuillere';

export type RecipeIngredientAi = {
	name: string;
	/** Marque imprimée (produit de marque listé) — jamais inventée. */
	brand?: string;
	/** Variante imprimée (ex. « Stracciatella », « demi-écrémé »). */
	variant?: string;
	packaged?: boolean;
	/** Quantité exactement telle qu'écrite sur la recette (ex. « 2 œufs »). */
	qtyRaw?: string;
	/** Unité écrite (après normalisation) — null si ambiguë. */
	unit?: RecipeUnit;
	/** Poids fiable en grammes (conversion standard) — ABSENT si incertain. */
	qtyGrams?: number;
	/** Quantité non convertible / illisible : l'utilisateur doit la renseigner. */
	qtyUncertain?: boolean;
	kcal100?: number;
	carbs100?: number;
	protein100?: number;
	fat100?: number;
	note?: string;
};

export type RecipeResult = {
	photoType: 'recipe' | 'unclear';
	/** Titre de la recette UNIQUEMENT s'il est clairement visible. */
	name?: string;
	/** Nombre de personnes/portions UNIQUEMENT s'il est clairement écrit. */
	servings?: number;
	items: RecipeIngredientAi[];
};

/**
 * Valide la réponse Recette IA : bornes, placeholders interdits, quantités
 * non inventées. Un ingrédient sans poids FIABLE sort avec qtyGrams absent
 * ET qtyUncertain=true — jamais un poids deviné silencieusement.
 */
export function parseRecipeExtraction(json: unknown): RecipeResult {
	const o = (json ?? {}) as Record<string, unknown>;
	const photoType = o.photoType === 'recipe' ? 'recipe' : 'unclear';
	const str = (v: unknown, max = 80): string | undefined => {
		const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
		return s.length >= 2 ? s : undefined;
	};
	const num = (v: unknown, max: number): number | undefined => {
		const n = typeof v === 'number' ? v : Number(v);
		if (!isFinite(n) || n < 0) return undefined;
		return Math.min(max, Math.round(n * 10) / 10);
	};
	const name = str(o.name);
	const servingsRaw = num(o.servings, 30);
	const items: RecipeIngredientAi[] = [];
	for (const it of Array.isArray(o.items) ? o.items.slice(0, 12) : []) {
		const r = (it ?? {}) as Record<string, unknown>;
		const ingName = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
		// Garde anti-« no comment » (même règle que le Repas IA).
		const normalized = ingName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
		if (ingName.length < 2 || PLACEHOLDER_RE.test(normalized) || !/[a-z0-9]/i.test(ingName)) continue;
		const brand = str(r.brand);
		const variant = str(r.variant);
		const unit = (['g', 'ml', 'piece', 'cuillere'] as const).includes(r.unit as RecipeUnit) ? (r.unit as RecipeUnit) : undefined;
		const qtyGrams = num(r.qtyGrams, 5000);
		items.push({
			name: ingName,
			brand,
			variant,
			packaged: r.packaged === true || !!brand,
			qtyRaw: str(r.qtyRaw, 40),
			unit,
			// Poids fiabilisé UNIQUEMENT si la conversion est déclarée fiable :
			// sinon qtyGrams absent (l'utilisateur devra compléter).
			qtyGrams: r.qtyUncertain === true ? undefined : qtyGrams,
			qtyUncertain: r.qtyUncertain === true || qtyGrams === undefined,
			kcal100: num(r.kcal100, 900),
			carbs100: num(r.carbs100, 100),
			protein100: num(r.protein100, 100),
			fat100: num(r.fat100, 100),
			note: typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 120) : undefined,
		});
		if (items.length >= 12) break;
	}
	return { photoType, name, servings: servingsRaw, items };
}

/** Analyse une photo de RECETTE → liste d'ingrédients + quantités (grammes
 *  fiabilisés quand la conversion est standard, incertitude explicite sinon). */
export async function analyzeRecipeImage(imageDataUrl: string): Promise<{ result: RecipeResult; usage: AiUsage }> {
	const { json, usage } = await callOpenAi(RECIPE_PROMPT, imageDataUrl, 1500);
	return { result: parseRecipeExtraction(json), usage };
}
