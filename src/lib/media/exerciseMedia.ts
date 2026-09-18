/**
 * Résolution média centralisée des exercices — UNE seule règle métier.
 *
 * RÈGLE G-FLUX (sept. 2026) : `animation.mp4` est le média principal et
 * canonique de tout exercice propriétaire. Il est affiché directement dans
 * la recherche, la bibliothèque, la fiche détail et partout où un aperçu
 * média est nécessaire — exactement comme les GIF ExerciseDB. Le
 * `poster.webp` est un asset OPTIONNEL / legacy : simple filet de sécurité
 * si le média principal échoue, jamais requis par l'expérience utilisateur.
 *
 * Les origines de sources (gflux-official, exercisedb-v1, exercice coach…)
 * ne sont JAMAIS testées ici ni dans les composants : seule la FORME des
 * champs médias compte (vidéo .mp4/.webm → <video>, sinon <img>). Plus
 * aucune condition `if gflux / else if exercisedb` dispersée dans l'UI.
 */

export type ExerciseMediaKind = 'video' | 'image';

export type NormalizedExerciseMedia = {
	/** Média principal (animation.mp4 G-FLUX ou GIF ExerciseDB). */
	src?: string;
	kind: ExerciseMediaKind;
	/** Secours tenté si le média principal échoue (ex. poster legacy). */
	fallbackSrc?: string;
	fallbackKind: ExerciseMediaKind;
	/** false uniquement quand AUCUNE source valide n'existe → « Média indisponible ». */
	available: boolean;
};

/** Champs médias bruts acceptés en entrée (un exercice quelconque du modèle G-FLUX). */
export type ExerciseMediaInput = {
	animationUrl?: string;
	posterUrl?: string;
	mediaUrl?: string;
	thumbnailUrl?: string;
	sourceMediaUrl?: string;
	mediaUrls?: string[];
};

const isVideoUrl = (url: string) => /\.(mp4|webm)(\?|$)/i.test(url);

const kindOf = (url: string): ExerciseMediaKind => (isVideoUrl(url) ? 'video' : 'image');

const clean = (urls: (string | undefined)[]): string[] =>
	urls.map((u) => u?.trim()).filter((u): u is string => !!u);

/**
 * Normalise les champs médias bruts d'un exercice en une représentation
 * unique (média principal + secours). Ordre de priorité du média principal :
 *  1. `animationUrl` — animation.mp4 G-FLUX (média canonique) ;
 *  2. `mediaUrl` — GIF auto-hébergé ExerciseDB ;
 *  3. `thumbnailUrl` — miniature (GIF ExerciseDB : le même média interne) ;
 *  4. `mediaUrls[0]` — première vue multiple.
 * Secours : `posterUrl` (poster legacy G-FLUX) puis `sourceMediaUrl` puis
 * les vues secondaires. Si aucune source principale n'existe, le premier
 * secours disponible est PROMU média principal (un poster seul reste
 * affichable — jamais de « Média indisponible » évitable).
 */
export function normalizeExerciseMedia(ex?: ExerciseMediaInput | null): NormalizedExerciseMedia {
	const primary = clean([ex?.animationUrl, ex?.mediaUrl, ex?.thumbnailUrl, ex?.mediaUrls?.[0]])[0];
	let fallback = clean([ex?.posterUrl, ex?.sourceMediaUrl, ...(ex?.mediaUrls ?? []).slice(1)]).find(
		(u) => u !== primary
	);
	let src = primary;

	if (!src && fallback) {
		src = fallback;
		fallback = undefined;
	}

	return {
		src,
		kind: src ? kindOf(src) : 'image',
		fallbackSrc: fallback,
		fallbackKind: fallback ? kindOf(fallback) : 'image',
		available: !!src,
	};
}
