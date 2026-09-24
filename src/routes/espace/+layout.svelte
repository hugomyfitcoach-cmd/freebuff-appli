<script lang="ts">
	import AppShell from '$lib/components/AppShell.svelte';
	import PushOptIn from '$lib/components/PushOptIn.svelte';
	import { setAppBadgeFor } from '$lib/appBadge';
	import { onNotificationCounts, startNotificationPolling } from '$lib/notificationPoll';
	import { goto } from '$app/navigation';
	import { isStandalone, wasOnboardingSeenLocally } from '$lib/pwa';

	let { children, data } = $props();

	/**
	 * Onboarding installation PWA — après la première connexion uniquement.
	 * JAMAIS en mode standalone : si l'app est lancée depuis son icône, elle
	 * est déjà installée → on enregistre la confirmation et on reste ici
	 * (vrai même après un logout/re-login ; la règle est absolue).
	 */
	$effect(() => {
		if (!data.pwaInstallNeeded) return;
		if (isStandalone()) {
			fetch('/api/users/pwa-install', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status: 'installed_confirmed' }),
			}).catch(() => {});
			return;
		}
		if (wasOnboardingSeenLocally()) return; // « plus tard » déjà choisi cette session
		goto('/onboarding/install', { replaceState: true });
	});

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
	 * LA BASE (mécanisme central lib/notificationPoll.ts → /api/live, 5 s au
	 * premier plan + immédiat au focus) quand elle est disponible — sinon repli
	 * sur le snapshot SSR. La part « à faire » des bilans (bilan hebdo dû) vient
	 * du SSR ; les parts retours/message/drive viennent de la base en direct.
	 * Recalculé à chaque navigation / tick de polling. Sans effet sur les
	 * plateformes sans Badging API.
	 */
	let pollCounts = $state<{ retours: number; message: number; drive: number } | null>(null);
	$effect(() => {
		if (typeof window === 'undefined') return;
		startNotificationPolling();
		return onNotificationCounts((c) => {
			pollCounts = { retours: c.retours, message: c.message, drive: c.drive };
		});
	});
	$effect(() => {
		const badges = data.dashboard?.badges;
		if (!badges && !pollCounts) {
			setAppBadgeFor(0);
			return;
		}
		const duePart = pollCounts ? Math.max((badges?.bilans ?? 0) - (badges?.retours ?? 0), 0) : (badges?.bilans ?? 0);
		const retours = pollCounts?.retours ?? (badges?.retours ?? 0);
		const message = pollCounts?.message ?? (badges?.message ?? 0);
		const drive = pollCounts?.drive ?? (badges?.drive ?? 0);
		setAppBadgeFor(duePart + retours + message + drive + (badges?.progression ?? 0));
	});
</script>

<svelte:head><title>Mon espace — G-Flux</title></svelte:head>

<AppShell role="client" user={data.user} badges={data.dashboard?.badges} contentWidth="std" showFooter profilePhotoUrl={data.profilePhotoUrl ?? null}>
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
