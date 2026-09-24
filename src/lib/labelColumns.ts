/**
 * GARDE-FOUS ÉTIQUETTE IA — COLONNES « 100 g » vs « portion » (module pur).
 *
 * Problème constaté : quand une étiquette affiche plusieurs colonnes
 * (ex. « 100 g | portion 30 g »), l'IA peut MÉLANGER les valeurs des deux
 * colonnes (kcal d'une colonne avec les protéines de l'autre).
 *
 * RÈGLE (mission) :
 *  1. si une colonne « pour 100 g » (ou 100 ml pour un liquide) existe →
 *     elle est utilisée EXCLUSIVEMENT comme référence nutritionnelle ;
 *  2. ne JAMAIS mélanger kcal d'une colonne avec protéines/glucides/lipides
 *     d'une autre ;
 *  3. si aucune valeur 100 g/100 ml n'existe → utiliser la portion indiquée ;
 *  4. si le poids de la portion est connu, convertir PROPREMENT vers /100 g ;
 *  5. si la conversion est impossible → ne rien inventer (champs vides).
 *
 * Module PUR, aucune dépendance, aucune I/O : consommé par la couche serveur
 * OpenAI (post-parsing) et testable de façon déterministe — cas de test
 * A (100 g + 30 g), B (100 g + portion), C (portion seule), D (colonnes
 * incomplètes) de la mission.
 */

/** Colonnes que l'IA doit déclarer explicitement. */
export type LabelColumn = {
	/** Grammage de la colonne (100 pour « pour 100 g », 30 pour « portion 30 g »…). */
	grams?: number | null;
	/** Vraisemblablement un LIQUIDE (étiquette en ml, boisson, huile…). */
	isLiquid?: boolean;
	/** Champs lus dans CETTE colonne — null = absent/illisible. */
	kcal?: number | null;
	kj?: number | null;
	carbs?: number | null;
	protein?: number | null;
	fat?: number | null;
	/** Fibres (information d'étiquette, servie telle quelle si lue du 100 g). */
	fiber?: number | null;
	/** Sel (information d'étiquette, servi tel quel si lu du 100 g). */
	salt?: number | null;
};

/** Résultat normalisé : des valeurs POUR 100 g (ou 100 ml) cohérentes. */
export type ResolvedLabel100 = {
	/** kcal /100 g (ou /100 ml) — undefined si impossible sans inventer. */
	kcal?: number;
	carbs?: number;
	protein?: number;
	fat?: number;
	/** Taille de portion lue (g/ml) — servie telle quelle à l'UI. */
	servingQty?: number;
	/** Conversion kJ → kcal appliquée. */
	kcalFromKj?: boolean;
	/** true = valeurs issues d'une conversion portion → /100 g. */
	convertedFromServing?: boolean;
	/** true = valeurs directement lues dans la colonne 100 g/100 ml. */
	fromPer100?: boolean;
	/** Explication humaine courte de la décision (log IA / revue). */
	reason: string;
};

/** kJ → kcal. */
function kjToKcal(kj: number): number {
	return kj / 4.184;
}

/** Valeur numérique utilisable (finie, ≥ 0) sinon null. */
function num(v: number | null | undefined): number | null {
	return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null;
}

/** Détecte une colonne « pour 100 g / 100 ml » (grammage ≈ 100). */
function isPer100(col: LabelColumn): boolean {
	const g = num(col.grams);
	return g !== null && g > 90 && g < 110; // 100 g/ml exact attendu ; tolérance 91–109
}

/** Détecte une colonne portion exploitable (poids connu, > 0, ≠ 100). */
function usableServing(col: LabelColumn): { grams: number } | null {
	const g = num(col.grams);
	return g !== null && g > 0 && (g < 90 || g > 110) ? { grams: g } : null;
}

/**
 * Vérifie qu'un jeu /100 g est PLAUSIBLE : les kcal doivent correspondre
 * raisonnablement aux macros (prot×4 + glu×4 + lip×9). Sert à rejeter un
 * mélange de colonnes quand une seule valeur a glissé (ex. kcal ×10).
 * Retourne true si cohérent ou incomplet (on ne bloque pas un partiel lisible).
 */
export function per100Plausible(v: { kcal?: number; carbs?: number; protein?: number; fat?: number }): boolean {
	if (v.kcal === undefined) return true; // rien à vérifier
	const parts: number[] = [];
	if (v.carbs !== undefined) parts.push(v.carbs * 4);
	if (v.protein !== undefined) parts.push(v.protein * 4);
	if (v.fat !== undefined) parts.push(v.fat * 9);
	if (parts.length < 2) return true; // pas assez de macros pour juger
	const theorique = parts.reduce((s, x) => s + x, 0);
	if (theorique <= 0) return v.kcal <= 10; // « 0 partout » plausible (eau, café noir)
	const gap = Math.abs(theorique - v.kcal);
	// Même double seuil que nutritionGuard : 25 % relatif ET 30 kcal absolu.
	return !(gap > 0.25 * v.kcal && gap > 30);
}

/** Colonnes brutes + portion éventuelle → valeurs /100 g SANS mélange. */
export function resolveLabel100(input: {
	/** Colonne « pour 100 g / 100 ml » si l'étiquette en affiche une. */
	per100?: LabelColumn | null;
	/** Colonne « portion » si l'étiquette en affiche une. */
	serving?: LabelColumn | null;
}): ResolvedLabel100 {
	const per100 = input.per100 ?? null;
	const serving = input.serving ?? null;

	// ── RÈGLE 1 : colonne 100 g / 100 ml présente → EXCLUSIVITÉ ──
	if (per100 && isPer100(per100)) {
		const raw = {
			kcal: num(per100.kcal),
			carbs: num(per100.carbs),
			protein: num(per100.protein),
			fat: num(per100.fat),
		};
		let kcal = raw.kcal ?? undefined;
		let kcalFromKj = false;
		if (kcal === undefined) {
			const kj = num(per100.kj);
			if (kj !== null && kj > 0) {
				kcal = Math.round(kjToKcal(kj) * 10) / 10;
				kcalFromKj = true;
			}
		}
		const resolved: ResolvedLabel100 = {
			kcal,
			carbs: raw.carbs ?? undefined,
			protein: raw.protein ?? undefined,
			fat: raw.fat ?? undefined,
			kcalFromKj: kcalFromKj || undefined,
			fromPer100: true,
			reason: 'colonne 100 g/100 ml utilisée exclusivement',
		};
		// Garde-fou anti-mélange : la colonne 100 g déclarée mais dont les kcal
		// contredisent les macros (valeur qui a glissé depuis la portion) →
		// on ne publie pas une fiche incohérente.
		if (!per100Plausible(resolved)) {
			return {
				kcal: undefined,
				carbs: undefined,
				protein: undefined,
				fat: undefined,
				kcalFromKj: undefined,
				reason: 'colonne 100 g incohérente (kcal vs macros) — valeurs refusées, à relire',
			};
		}
		// La portion sert UNIQUEMENT d'information d'affichage (jamais nutrition).
		const s = serving ? usableServing(serving) : null;
		if (s) resolved.servingQty = s.grams;
		return resolved;
	}

	// ── RÈGLE 3 : pas de colonne 100 g → portion indiquée uniquement ──
	if (serving) {
		const s = usableServing(serving);
		if (!s) {
			// Règle 5 : portion sans poids connu (ex. « 1 cookie ») → conversion
			// impossible, on n'invente RIEN.
			return { reason: 'portion sans poids connu — conversion /100 g impossible, valeurs vides' };
		}
		const raw = {
			kcal: num(serving.kcal),
			carbs: num(serving.carbs),
			protein: num(serving.protein),
			fat: num(serving.fat),
		};
		let kcal = raw.kcal ?? undefined;
		let kcalFromKj = false;
		if (kcal === undefined) {
			const kj = num(serving.kj);
			if (kj !== null && kj > 0) {
				kcal = Math.round(kjToKcal(kj) * 10) / 10;
				kcalFromKj = true;
			}
		}
		// Tout incomplet → on refuse la conversion partielle : mélanger un kcal
		// converti avec des macros absentes créerait une fiche trompeuse. Une
		// fiche nécessite AU MINIMUM les kcal pour être exploitable.
		if (kcal === undefined || raw.carbs === null || raw.protein === null || raw.fat === null) {
			return {
				servingQty: s.grams,
				kcalFromKj: kcalFromKj || undefined,
				reason: 'portion seule incomplète — conversion /100 g refusée (ne pas inventer)',
			};
		}
		// Règle 4 : conversion PROPRE portion → /100 g (règle de trois exacte).
		const f = 100 / s.grams;
		const resolved: ResolvedLabel100 = {
			kcal: Math.round(kcal * f * 10) / 10,
			carbs: Math.round(raw.carbs * f * 10) / 10,
			protein: Math.round(raw.protein * f * 10) / 10,
			fat: Math.round(raw.fat * f * 10) / 10,
			servingQty: s.grams,
			kcalFromKj: kcalFromKj || undefined,
			convertedFromServing: true,
			reason: `portion ${s.grams} g convertie vers /100 g`,
		};
		if (!per100Plausible(resolved)) {
			return {
				servingQty: s.grams,
				reason: 'conversion portion incohérente (kcal vs macros) — valeurs refusées, à relire',
			};
		}
		return resolved;
	}

	// ── Rien d'exploitable : on n'invente RIEN ──
	return { reason: 'aucune colonne 100 g/100 ml ni portion exploitable — valeurs vides' };
}
