<script lang="ts">
	import AppShell from '$lib/components/AppShell.svelte';
	import PushOptIn from '$lib/components/PushOptIn.svelte';
	import { setAppBadgeFor } from '$lib/appBadge';

	let { children, data } = $props();

	/**
	 * Fuseau horaire du navigateur de la cliente → users.touch : l'éphémère du
	 * message du coach du jour expire à SON minuit local (pas celui du serveur).
	 * Envoi silencieux et sans attente, au premier rendu client seulement.
	 */
	let tzSent = false;
	$effect(() => {
		if (tzSent) return;
		tzSent = true;
		if (typeof Intl === 'undefined') return;
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!tz) return;
		fetch('/api/users/touch', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ timeZone: tz }),
		}).catch(() => {});
	});

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
		const total = (badges.bilans ?? 0) + (badges.message ?? 0) + (badges.progression ?? 0);
		setAppBadgeFor(total);
	});
</script>

<svelte:head><title>Mon espace — G-Flux</title></svelte:head>

<AppShell role="client" user={data.user} badges={data.dashboard?.badges} contentWidth="std" showFooter>
	{@render children()}
</AppShell>

<!-- Notifications push : opt-in discret (repli : badge interne sans push). -->
<PushOptIn />

<style>
	/* Fond « gris très doux » de l'espace cliente (mobile d'abord, cohérent desktop).
	   Les autres pages (CRM coach, guide…) conservent leur propre fond. */
	:global(body) {
		background-color: #f4f6f4;
	}
</style>
