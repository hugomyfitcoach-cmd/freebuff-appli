/**
 * Salutations de l'espace cliente — petit module de templates centralisés.
 *
 * Le titre varie selon le moment de la journée (heure LOCALE de la cliente,
 * c'est-à-dire celle du navigateur) et une ligne complémentaire existe pour
 * certains jours de la semaine (lundi, vendredi, dimanche).
 *
 * Aucun appel IA : tout est un ensemble de variantes prédéfinies.
 * Les textes sont regroupés ici (et non dispersés dans les composants) pour
 * faciliter une future internationalisation.
 *
 * La variante choisie est STABLE pour la journée : on dérive l'index d'un
 * hash (userId + date locale), donc un simple rechargement ne change pas le
 * message — mais la cliente verra une autre formulation le lendemain.
 */

export type Greeting = {
	/** Titre principal, ex. « Bonjour Alexandra 👋 » */
	title: string;
	/** Ligne complémentaire selon le jour (ex. lundi), ou null. */
	dayLine: string | null;
};

type Period = 'matin' | 'apresmidi' | 'soir';

const GREETINGS: Record<Period, string[]> = {
	matin: [
		'Bonjour {prenom} 👋',
		'Belle matinée {prenom}',
		'Ravie de te retrouver {prenom}',
	],
	apresmidi: [
		'Bon après-midi {prenom} 👋',
		'{prenom} est de retour 👋',
		'Contente de te revoir {prenom}',
	],
	soir: [
		'Bonsoir {prenom} 👋',
		'Bonsoir {prenom}, belle soirée',
		'Ta journée touche bientôt à sa fin {prenom}',
	],
};

/** Variantes liées au jour de la semaine (getDay : 0 = dimanche … 6 = samedi). */
const DAY_LINES: Partial<Record<number, string[]>> = {
	1: ['C’est parti pour une nouvelle semaine 💪', 'Nouvelle semaine, on repart tranquillement'],
	5: ['La semaine touche bientôt à sa fin', 'Bientôt le week-end 👋'],
	0: ['Un dimanche tout en douceur', 'Prends le temps de souffler aujourd’hui'],
};

function hashCode(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h);
}

function pick<T>(list: T[], seed: number): T {
	return list[seed % list.length];
}

function periodOf(now: Date): Period {
	const h = now.getHours();
	if (h >= 5 && h < 12) return 'matin';
	if (h >= 12 && h < 18) return 'apresmidi';
	return 'soir';
}

/** Clé de stabilité : la date locale de la cliente. */
function dateKey(now: Date): string {
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * Salutation pour la journée en cours.
 * `now` doit être l'heure locale de la cliente (navigateur) — jamais
 * l'heure du serveur, pour que « Bonjour / Bonsoir » suive son fuseau.
 */
export function getGreeting(userId: string, prenom: string, now: Date = new Date()): Greeting {
	const seed = hashCode(`${userId}:${dateKey(now)}`);
	const title = pick(GREETINGS[periodOf(now)], seed).replace('{prenom}', prenom);
	const dayTemplates = DAY_LINES[now.getDay()];
	const dayLine = dayTemplates ? pick(dayTemplates, seed + 1) : null;
	return { title, dayLine };
}