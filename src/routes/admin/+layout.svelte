<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import AppShell from '$lib/components/AppShell.svelte';
	import { onCoachState, startNotificationPolling } from '$lib/notificationPoll';

	let { children, data } = $props();

	/* Mécanisme central de propagation (côté coach) : le badge CRM est relu
	   au premier plan + immédiatement au retour de focus — la cloche s'allume
	   sans refresh ni navigation. Quand la version du journal avance
	   (nouvelle notification en base), la page du tableau de bord est
	   revalidée : le journal 360° et la liste se mettent à jour tout seuls,
	   sans perdre la recherche ni la saisie en cours.
	   Cadence : l'invalidateAll déclenché par journalVersion est limité à
	   UNE fois toutes les 30 s au maximum (une rafale de notifications ne
	   déclenche pas une rafale de revalidations) ; le dernier événement de la
	   rafale est tout de même appliqué en fin de fenêtre, pour ne jamais
	   perdre la fraîcheur perçue. */
	const JOURNAL_INVALIDATE_MIN_MS = 30_000;

	$effect(() => {
		if (typeof window === 'undefined') return;
		startNotificationPolling();
		let lastVersion: number | null = null;
		let lastInvalidateAt = 0;
		let trailingTimer: ReturnType<typeof setTimeout> | null = null;
		const runInvalidate = () => {
			lastInvalidateAt = Date.now();
			void invalidateAll().catch(() => {});
		};
		const unsubscribe = onCoachState((s) => {
			if (lastVersion == null) {
				lastVersion = s.journalVersion;
				return;
			}
			if (s.journalVersion > lastVersion) {
				lastVersion = s.journalVersion;
				const since = Date.now() - lastInvalidateAt;
				if (since >= JOURNAL_INVALIDATE_MIN_MS) {
					runInvalidate(); // effet immédiat si la fenêtre de 30 s est libre
				} else if (trailingTimer === null) {
					// Sinon : au plus UNE revalidation différée en fin de fenêtre.
					trailingTimer = setTimeout(() => {
						trailingTimer = null;
						runInvalidate();
					}, JOURNAL_INVALIDATE_MIN_MS - since);
				}
			}
		});
		return () => {
			unsubscribe();
			if (trailingTimer !== null) clearTimeout(trailingTimer);
		};
	});
</script>

<svelte:head><title>CRM — G-Flux</title></svelte:head>

<AppShell role="coach" user={data.user} contentWidth="wide" badges={{ notifications: data.notificationsBadge ?? 0 }}>
	{@render children()}
</AppShell>
