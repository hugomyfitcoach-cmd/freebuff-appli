/**
 * Cyclage refeed / diet break — logique pure (portée telle quelle de
 * `src/routes/outils/+page.svelte`, sans changement de comportement).
 *
 * Principe : ces fonctions calculent et découpent l'horizon de 6 mois en
 * phases Déficit / Refeed / Diet break — l'outil n'est jamais la source de
 * vérité et n'écrit rien vers le suivi.
 */

export type Cat = {
	label: string;
	refeedPlanned: boolean;
	refeedNote: string | null;
	breakWeeks: number;
	breakRangeLabel: string;
	refeedIntervalDays?: number | null;
	refeedDurationDays?: number;
	outOfGrid?: boolean;
};

export type PlanBlock = { phase: string; startDay: number; endDay: number };

/** Horizon FIXE de planification : 6 mois. */
export const HORIZON_WEEKS = 26;

/** Femme <25 % de graisse : cadence par disponibilité énergétique (grille d'origine). */
export function getCategorieFemmeMin25(ea: number): Cat {
	let refeedIntervalDays: number | null;
	let refeedLabel: string | null;
	if (ea > 30) {
		refeedIntervalDays = 17;
		refeedLabel = '2-3 jours tous les 14-21 jours (EA > 30 kcal/kg MM)';
	} else if (ea >= 24) {
		refeedIntervalDays = 10;
		refeedLabel = '2-3 jours tous les 7-14 jours (EA 24-30 kcal/kg MM)';
	} else if (ea >= 20) {
		refeedIntervalDays = 7;
		refeedLabel = '2-3 jours tous les 7 jours (grille : 5-7 jours, plancher de 7j appliqué)';
	} else {
		refeedIntervalDays = null;
		refeedLabel = null;
	}
	return {
		label: 'Femme <25% graisse',
		refeedPlanned: refeedIntervalDays !== null,
		refeedIntervalDays,
		refeedDurationDays: 3,
		refeedNote: refeedLabel,
		breakWeeks: 5,
		breakRangeLabel: '4-6 semaines',
		outOfGrid: refeedIntervalDays === null,
	};
}

/** Homme <15 % de graisse : cadence par méthode de déficit (Alpert / Macdonald). */
export function getCategorieHommeMin15(methodeV: string): Cat {
	const refeedIntervalDays = methodeV === 'alpert' ? 17 : 10;
	const refeedLabel =
		methodeV === 'alpert'
			? '2-3 jours tous les 14-21 jours (déficit basé sur le calcul de Alpert)'
			: '2-3 jours tous les 7-14 jours (déficit basé sur le calcul de Macdonald)';
	return {
		label: 'Homme <15% graisse',
		refeedPlanned: true,
		refeedIntervalDays,
		refeedDurationDays: 3,
		refeedNote: refeedLabel,
		breakWeeks: 7,
		breakRangeLabel: '6-8 semaines',
	};
}

/* Grille reprise telle quelle de la formation « La science de la perte de graisse rapide » */
export function getCategorie(sexeV: string, pct: number, ea: number, methodeV: string): Cat {
	if (sexeV === 'femme') {
		if (pct > 35) {
			return {
				label: 'Femme >35% graisse',
				refeedPlanned: false,
				refeedNote: '2-3 jours non planifiés si nécessaire',
				breakWeeks: 10,
				breakRangeLabel: '8-12 semaines',
			};
		}
		if (pct >= 25) {
			return {
				label: 'Femme 25-35% graisse',
				refeedPlanned: false,
				refeedNote: '2-3 jours non planifiés si nécessaire',
				breakWeeks: 8,
				breakRangeLabel: '6-10 semaines',
			};
		}
			return getCategorieFemmeMin25(ea);
		} else {
		if (pct > 25) {
			return {
				label: 'Homme >25% graisse',
				refeedPlanned: false,
				refeedNote: '2-3 jours non planifiés si nécessaire',
				breakWeeks: 10,
				breakRangeLabel: '8-12 semaines',
			};
		}
		if (pct >= 15) {
			return {
				label: 'Homme 15-25% graisse',
				refeedPlanned: false,
				refeedNote: '2-3 jours non planifiés si nécessaire',
				breakWeeks: 8,
				breakRangeLabel: '6-10 semaines',
			};
		}
		return getCategorieHommeMin15(methodeV);
	}
}

/** Dates formatées « 12 janv. 2026 » (même rendu que l'outil). */
export function fmtDate(d: Date): string {
	return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function addDays(date: Date, n: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + n);
	return d;
}

/**
 * Découpage de l'horizon en phases, mêmes règles que l'outil : une semaine
 * break toutes les `breakWeeks` semaines (week 0 = semaine 1), refeeds
 * planifiés placés par compteur de jours de déficit avec un plancher de
 * 7 jours entre deux refeeds, jamais collés à un break (marge
 * `refeedDur + 7` jours avant un break), et refeeds écrasés par le break
 * quand ils se chevauchent.
 */
export function planifier(cat: Cat): PlanBlock[] {
	const refeedDur = cat.refeedDurationDays ?? 3;
	const totalDays = HORIZON_WEEKS * 7;
	const phases = new Array<string>(totalDays);

	for (let d = 0; d < totalDays; d++) {
		const week = Math.floor(d / 7);
		const isBreakWeek = cat.breakWeeks > 0 && (week + 1) % cat.breakWeeks === 0;
		phases[d] = isBreakWeek ? 'break' : 'deficit';
	}

	function nextBreakStart(fromDay: number) {
		for (let i = fromDay; i < totalDays; i++) {
			if (phases[i] === 'break' && (i === 0 || phases[i - 1] !== 'break')) return i;
		}
		return Infinity;
	}

	if (cat.refeedPlanned && !cat.outOfGrid) {
		let counter = 0;
		let d = 0;
		while (d < totalDays) {
			if (phases[d] === 'break') {
				counter = 0;
				d++;
				continue;
			}
			counter++;
			const intervalApplique = Math.max(cat.refeedIntervalDays ?? 0, 7);
			if (counter >= intervalApplique) {
				const breakStart = nextBreakStart(d);
				if (breakStart - d < refeedDur + 7) {
					d++;
					continue;
				}
				for (let k = 0; k < refeedDur && d + k < totalDays; k++) {
					if (phases[d + k] !== 'break') phases[d + k] = 'refeed';
				}
				d += refeedDur;
				counter = 0;
				continue;
			}
			d++;
		}
	}

	const blocks: PlanBlock[] = [];
	let blockStart = 0;
	for (let d = 1; d <= totalDays; d++) {
		if (d === totalDays || phases[d] !== phases[blockStart]) {
			blocks.push({ phase: phases[blockStart], startDay: blockStart, endDay: d - 1 });
			blockStart = d;
		}
	}
	return blocks;
}
