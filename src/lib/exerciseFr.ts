/**
 * Affichage des exercices — SOURCE UNIQUE de la règle « français d'abord ».
 *
 * Règles produit (mission T-FR) :
 *  - les NOMS restent tels quels en base (anglais pour la bibliothèque
 *    importée) ; seule la PREMIÈRE LETTRE est mise en majuscule à l'affichage ;
 *  - les instructions (étapes) s'affichent en français quand la traduction
 *    existe (`instructionsFr`), sinon dans leur version d'origine.
 *
 * Ce module ne modifie JAMAIS de donnée : il ne fait que choisir la version à
 * rendre. Tous les écrans (coach et cliente) passent par ces deux fonctions —
 * aucune copie locale de la règle.
 */

/** Champs texte d'un exercice, quelle que soit sa provenance (Convex/API). */
export type ExerciseTextFields = {
	instructions?: readonly string[] | null;
	instructionsFr?: readonly string[] | null;
};

/** Nettoyage minimal : lignes non vides uniquement (jamais de trous à l'écran). */
function cleanLines(lines?: readonly string[] | null): string[] {
	if (!Array.isArray(lines)) return [];
	return lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
}

/** Le texte affiché (étapes) : version française si elle existe, sinon l'originale. */
export function exerciseInstructions(ex: ExerciseTextFields | null | undefined): string[] {
	const fr = cleanLines(ex?.instructionsFr);
	return fr.length > 0 ? fr : cleanLines(ex?.instructions);
}

/** Vrai quand la fiche dispose d'une traduction française exploitable. */
export function hasFrenchInstructions(ex: ExerciseTextFields | null | undefined): boolean {
	return cleanLines(ex?.instructionsFr).length > 0;
}

/**
 * Séquences d'encodage corrompues repérées dans les noms importés
 * (« sled 45в° leg press ») — corrigées À L'AFFICHAGE uniquement, la base
 * n'est JAMAIS réécrite. Liste volontairement limitée aux séquences
 * non ambiguës (mojibake UTF-8 relu en latin-1/cyrillique).
 */
const ENCODING_FIXES: readonly (readonly [RegExp, string])[] = [
	[/в°/g, '°'], // « в » cyrillique + degré
	[/Â°/g, '°'],
	[/â€™/g, '’'],
	[/â€“/g, '–'],
	[/â€”/g, '—'],
	[/Ã©/g, 'é'],
	[/Ã¨/g, 'è'],
	[/Ã§/g, 'ç'],
	[/Ã /g, 'à'],
];

/** Corrige les séquences d'encodage évidentes d'un texte affiché (jamais la base). */
export function fixExerciseEncoding(value: string): string {
	let out = value;
	for (const [pattern, replacement] of ENCODING_FIXES) out = out.replace(pattern, replacement);
	return out;
}

/**
 * Nom affiché : séquences d'encodage corrigées, première lettre en majuscule,
 * RESTE INCHANGÉ (jamais de minuscule forcée — les sigles et noms propres
 * anglais restent intacts). Ne modifie pas la valeur reçue (aucun write).
 */
export function displayExerciseName(name: string | null | undefined): string {
	const raw = typeof name === 'string' ? name.trim() : '';
	if (!raw) return '';
	const value = fixExerciseEncoding(raw);
	return value.charAt(0).toLocaleUpperCase('fr-FR') + value.slice(1);
}
