/**
 * Guide « Comment bien prendre mes mesures & mes photos »
 *
 * Contenu pédagogique repris de l'Étape 2 — Analyse corporelle du guide
 * d'onboarding G-Flux (visuels inclus, importés en static via Vite —
 * ils restent disponibles hors ligne comme tout le bundle de la PWA).
 *
 * Lecture seule : aucune saisie ni sauvegarde ici.
 */

import mesurePoints from '$lib/assets/mesure-points.jpg';
import mesureRuban from '$lib/assets/mesure-ruban.jpg';
import photoFace from '$lib/assets/photo-face.jpg';
import photoProfil from '$lib/assets/photo-profil.jpg';
import photoDos from '$lib/assets/photo-dos.jpg';

/* ————— Mensurations ————— */

export const KEY_MEASURES = [
	{
		key: 'neck',
		name: 'Tour de cou',
		how: 'Juste sous la glotte.',
	},
	{
		key: 'waist',
		name: 'Tour de taille fine',
		how: 'Au point le plus étroit (entre sternum et nombril).',
	},
	{
		key: 'hips',
		name: 'Fessiers',
		how: 'Au niveau le plus large du fessier.',
	},
] as const;

export const MEASURE_TIPS = [
	{ strong: 'Demande à ton conjoint si possible', rest: ' — plus précis.' },
	{ strong: 'Prends la mesure de côté', rest: ' pour un meilleur alignement.' },
	{ strong: 'Mètre ruban posé sans serrer', rest: '.' },
] as const;

export const MEASURE_IMAGES = [
	{ src: mesurePoints, alt: 'Points de mesure', caption: '📍 Les 3 points de mesure : cou · ventre · hanches' },
	{ src: mesureRuban, alt: 'Technique mètre ruban', caption: '✅ Mètre ruban posé sans serrer, pris de côté' },
] as const;

/* ————— Photos de progression ————— */

export const PHOTO_EXAMPLES = [
	{ src: photoFace, alt: 'Photo de progression — face', label: 'Face' },
	{ src: photoProfil, alt: 'Photo de progression — profil', label: 'Profil' },
	{ src: photoDos, alt: 'Photo de progression — dos', label: 'Dos' },
] as const;

export const PHOTO_PROTOCOL = [
	{ title: 'Même lumière 💡', desc: 'Lumière naturelle, pas de contre-jour.' },
	{ title: 'Même endroit', desc: 'Même fond, même distance à chaque prise.' },
	{ title: 'Feuille A4 devant le visage', desc: 'Prénom + date + « G-Flux » → date la photo et protège ton anonymat.' },
	{ title: 'Feuille A4 au sol', desc: 'Pour garder le même écartement des pieds.' },
	{ title: '3 angles', desc: 'Face · profil · dos. Sous-vêtements ou tenue ajustée. Ne change pas de tenue.' },
	{ title: 'Posture naturelle', desc: 'Droit(e), sans rentrer le ventre ni contracter.' },
	{ title: 'Le matin à jeun ☀️', desc: 'Avant de boire ou manger.' },
] as const;
