<script lang="ts">
	import AppShell from '$lib/components/AppShell.svelte';
	import { setAppBadgeFor } from '$lib/appBadge';

	let { children, data } = $props();

	/**
	 * Badge de l'icône installée (PWA) : synchronisé sur la source de vérité
	 * interne (dashboard.badges = bilans à remplir + retours non lus +
	 * mensurations/photos attendues). Recalculé à chaque navigation / action.
	 * Sans effet sur les plateformes sans Badging API.
	 */
	$effect(() => {
		const badges = data.dashboard?.badges;
		if (!badges) {
			setAppBadgeFor(0);
			return;
		}
		const total = (badges.bilans ?? 0) + (badges.progression ?? 0);
		setAppBadgeFor(total);
	});
</script>

<svelte:head><title>Mon espace — G-Flux</title></svelte:head>

<AppShell role="client" user={data.user} badges={data.dashboard?.badges} contentWidth="std" showFooter>
	{@render children()}
</AppShell>
