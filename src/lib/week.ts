/** Utilitaires côté client — mêmes règles que le formulaire d'origine. */

/**
 * ⏸ Fenêtre de soumission DÉSACTIVÉE pendant la phase de développement :
 * le formulaire est toujours ouvert, pour pouvoir tester en continu.
 *
 * Remettre le bloc ci-dessous en place quand le projet est finalisé :
 *
 * const DAY = now.getDay(); // 0=dim, 1=lun, ..., 5=ven, 6=sam
 * const HOUR = now.getHours();
 * if (DAY === 5 && HOUR >= 9) return true; // vendredi dès 9h
 * if (DAY === 6) return true; // samedi toute la journée
 * if (DAY === 0 && HOUR < 12) return true; // dimanche avant 12h
 * return false;
 */
export function isFormOpen(_now: Date = new Date()): boolean {
	return true; // toujours ouvert — retirer ce `return true` lors de la finalisation
}

/** Lundi de la semaine courante (heure locale), au format ISO "yyyy-mm-dd". */
export function mondayISO(now: Date = new Date()): string {
	const d = new Date(now);
	const day = d.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${dd}`;
}
