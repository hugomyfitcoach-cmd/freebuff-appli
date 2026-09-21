<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import AppShell from '$lib/components/AppShell.svelte';
	import { onCoachState, startNotificationPolling } from '$lib/notificationPoll';

	let { children, data } = $props();

	/* Mécanisme central de propagation (côté coach) : le badge CRM est relu
	   toutes les 5 s au premier plan + immédiatement au retour de focus —
	   la cloche s'allume sans refresh ni navigation. Quand la version du
	   journal avance (nouvelle notification en base), la page du tableau de
	   bord est revalidée : le journal 360° et la liste se mettent à jour
	   tout seuls, sans perdre la recherche ni la saisie en cours. */
	$effect(() => {
		if (typeof window === 'undefined') return;
		startNotificationPolling();
		let lastVersion: number | null = null;
		return onCoachState((s) => {
			if (lastVersion == null) {
				lastVersion = s.journalVersion;
				return;
			}
			if (s.journalVersion > lastVersion) {
				lastVersion = s.journalVersion;
				void invalidateAll().catch(() => {});
			}
		});
	});
</script>

<svelte:head><title>CRM — G-Flux</title></svelte:head>

<AppShell role="coach" user={data.user} contentWidth="wide" badges={{ notifications: data.notificationsBadge ?? 0 }}>
	{@render children()}
</AppShell>
