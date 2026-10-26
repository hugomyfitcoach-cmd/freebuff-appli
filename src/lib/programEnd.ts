/**
 * ENTRAÎNEMENT — fin de programme proche (alerte COACH).
 *
 * Règle métier (source de vérité partagée par le tick Convex et les tests) :
 * une assignation NON RETIRÉE dont la date de fin tombe entre aujourd'hui et
 * aujourd'hui + 5 jours (fuseau métier Europe/Paris) produit UNE alerte, avec
 * une clé de déduplication par programme ET par date de fin. Une prolongation
 * change la date de fin → nouvelle clé, donc une nouvelle alerte le moment
 * venu. Aucun envoi à la cliente : l'alerte vit dans le journal coach.
 */

/** Fenêtre d'alerte : la fin du programme est dans 5 jours au plus (bornes incluses). */
export const PROGRAM_END_SOON_DAYS = 5;

export type ProgramEndAssignment = {
	_id: string;
	/** Dernier jour couvert "yyyy-mm-dd" (borne incluse). */
	endDate: string;
	/** Retrait par le coach (ms) — une assignation retirée n'alerte jamais. */
	removedAt?: number | null;
};

export type ProgramEndAlert = {
	assignmentId: string;
	/** Date de fin concernée "yyyy-mm-dd" (une prolongation en crée une autre). */
	endDate: string;
	/** « programme_fin_proche:<assignmentId>:<endDate> ». */
	dedupKey: string;
};

/** Une seule alerte par programme et par date de fin. */
export function programEndDedupKey(assignmentId: string, endDate: string): string {
	return `programme_fin_proche:${assignmentId}:${endDate}`;
}

/** Ajoute n jours à une date ISO (arithmétique UTC, insensible à l'heure d'été). */
function addDaysISO(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Alertes à créer : assignations non retirées dont la fin est dans la fenêtre
 * [aujourd'hui, aujourd'hui + 5 jours]. `notifiedKeys` porte les clés déjà
 * enregistrées (garde anti-doublon relue dans la mutation transactionnelle).
 */
export function programEndAlerts(
	assignments: ProgramEndAssignment[],
	todayISO: string,
	notifiedKeys: Iterable<string> = []
): ProgramEndAlert[] {
	const horizon = addDaysISO(todayISO, PROGRAM_END_SOON_DAYS);
	const notified = new Set(notifiedKeys);
	const out: ProgramEndAlert[] = [];
	for (const a of assignments) {
		if (a.removedAt) continue;
		// Date ISO : comparaison lexicographique = comparaison calendaire.
		if (a.endDate < todayISO || a.endDate > horizon) continue;
		const dedupKey = programEndDedupKey(a._id, a.endDate);
		if (notified.has(dedupKey)) continue;
		out.push({ assignmentId: a._id, endDate: a.endDate, dedupKey });
	}
	return out;
}

/** « jeudi 29 octobre » — jour de la semaine + jour + mois (français). */
export function fmtProgramEndDate(endDate: string): string {
	const [y, m, d] = endDate.split('-').map(Number);
	if (!y || !m || !d) return endDate;
	return new Intl.DateTimeFormat('fr-FR', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Texte de la notification coach : « Le programme de Léa se termine le … ». */
export function programEndDescription(prenom: string, endDate: string): string {
	return `Le programme de ${prenom} se termine le ${fmtProgramEndDate(endDate)} — prépare la suite.`;
}
