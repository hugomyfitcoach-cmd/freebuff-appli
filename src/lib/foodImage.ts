/**
 * Miniatures Open Food Facts — UNE seule règle de dérivation (partagée
 * client/serveur, pur et sans dépendance).
 *
 * OFF génère les tailles à la volée : une URL quelconque d'une image produit
 * `…/front_xx.<ver>.<taille>.jpg` possède toujours une variante `.100.jpg`
 * (vignette ~10–20 Ko) au même chemin — vérifié sur l'API v2 OFF (sept. 2026).
 * On ne télécharge donc JAMAIS les variantes 200/400 px pour une vignette de
 * 50–100 px : on dérive l'URL 100 px, l'URL originale restant la source
 * technique de repli.
 */

/** Taille (px) de la miniature OFF utilisée pour le miroir. */
export const OFF_THUMB_SIZE = 100;

/**
 * Dérive la miniature OFF 100 px d'une URL d'image OFF quelconque.
 * Retourne undefined pour une URL non-OFF (miroir/exercices/stock interne) ou
 * sans variantes numérotées — dans ce cas l'URL originale est utilisée telle
 * quelle (jamais de réécriture au hasard).
 */
export function offThumb100(imageUrl: string | undefined | null): string | undefined {
	if (!imageUrl) return undefined;
	try {
		const u = new URL(imageUrl);
		const host = u.hostname.toLowerCase();
		if (!/(^|\.)openfoodfacts\.org$/.test(host)) return undefined;
		// front_en.879.200.jpg → front_en.879.100.jpg (dernier segment numérique
		// avant l'extension = taille ; <ver> garde son point initial). Une URL
		// DÉJÀ en 100 px est retournée telle quelle (identité).
		const rewritten = u.pathname.replace(/(\.\d+)\.(\d{2,4})\.(jpg|jpeg|png|webp)$/i, (_m, ver, size, ext) =>
			Number(size) === OFF_THUMB_SIZE ? `${ver}.${size}.${ext}` : `${ver}.${OFF_THUMB_SIZE}.${ext}`
		);
		if (rewritten === u.pathname) return imageUrl;
		return `${u.origin}${rewritten}`;
	} catch {
		return undefined;
	}
}
