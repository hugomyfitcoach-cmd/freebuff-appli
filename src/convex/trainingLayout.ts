/**
 * Mise en page canonique d'une séance — logique PURE (aucun accès base, aucun
 * import Convex : testable directement).
 *
 * Un circuit (superset / triset) n'existe QUE par la contiguïté de ses membres
 * dans `order` : l'UI découpe les blocs sur des suites contiguës
 * (`supersetBlocks`). Deux membres du même groupe séparés par un autre exercice
 * produisent donc DEUX blocs portant le même identifiant de groupe → erreur
 * Svelte `each_key_duplicate`, écran mort même après rechargement.
 *
 * Ce plan d'écriture rend cet état impossible :
 *   • groupes recollés en un seul bloc contigu, à la position du 1er membre
 *     (l'ordre relatif des membres est conservé) ;
 *   • groupes orphelins (< 2 membres) dissous : la référence est retirée ;
 *   • `order` réindexé 0..n-1, sans doublon.
 *
 * Aucune ligne n'est supprimée : un exercice dupliqué reste visible (le coach
 * retire lui-même le surplus), et les séries restent intactes.
 */

export type SessionLayoutRow = {
	_id: string;
	order: number;
	supersetGroup?: string | null;
	createdAt?: number;
};

export type SessionLayoutPlan = {
	/** Ordre canonique des identifiants (groupes contigus). */
	orderedIds: string[];
	/** Nouvel `order` (0..n-1) par identifiant. */
	orders: Map<string, number>;
	/** Identifiants dont la référence de groupe orpheline doit être retirée. */
	clearGroupIds: string[];
	/** Identifiants des groupes à recoller (présents dans le plan d'ordre). */
	gluedGroups: string[];
};

/**
 * Calcule le plan d'écriture canonique d'une séance.
 *
 * Tri déterministe : `order`, puis `createdAt`, puis `_id` — jamais l'ordre
 * d'itération de la base (deux passes donnent toujours le même résultat).
 */
export function planSessionLayout(rows: readonly SessionLayoutRow[]): SessionLayoutPlan {
	const sorted = [...rows].sort(
		(a, b) => a.order - b.order || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a._id.localeCompare(b._id)
	);

	// Membres par groupe (ordre courant conservé).
	const members = new Map<string, SessionLayoutRow[]>();
	for (const r of sorted) {
		const g = r.supersetGroup ?? null;
		if (!g) continue;
		const list = members.get(g);
		if (list) list.push(r);
		else members.set(g, [r]);
	}

	// Un groupe d'un seul membre est une référence orpheline : on la retire.
	const orphanGroups = new Set<string>();
	const clearGroupIds: string[] = [];
	for (const [g, list] of members) {
		if (list.length < 2) {
			orphanGroups.add(g);
			for (const r of list) clearGroupIds.push(r._id);
		}
	}

	// Recollage : chaque groupe est posé en bloc à la place de son 1er membre.
	const orderedIds: string[] = [];
	const placed = new Set<string>();
	const gluedGroups: string[] = [];
	for (const r of sorted) {
		if (placed.has(r._id)) continue;
		const g = r.supersetGroup ?? null;
		if (g && !orphanGroups.has(g)) {
			if (gluedGroups.includes(g)) continue; // bloc déjà posé
			gluedGroups.push(g);
			for (const m of members.get(g) ?? []) {
				orderedIds.push(m._id);
				placed.add(m._id);
			}
			continue;
		}
		orderedIds.push(r._id);
		placed.add(r._id);
	}

	const orders = new Map<string, number>();
	orderedIds.forEach((id, i) => orders.set(id, i));
	return { orderedIds, orders, clearGroupIds, gluedGroups };
}
