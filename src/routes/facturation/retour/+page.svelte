<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { detectPlatform, isStandalone } from '$lib/pwa';
	import { startBillingFocusRevalidate } from '$lib/billingRefresh';

	let { data } = $props();

	const b = $derived(data.billing);
	const dateFR = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

	/**
	 * Contexte d'ouverture : la page peut être rendue DANS le contexte PWA
	 * (Stripe est resté dans la webview → success_url chargée ici) OU dans le
	 * navigateur externe (parcours avec sortie de l'app). Même rendu, CTA
	 * identique — les deux parcours sont supportés.
	 */
	const inPwa = $derived(typeof window !== 'undefined' && isStandalone());
	const onMobile = $derived(typeof navigator !== 'undefined' && detectPlatform() !== null);

	/**
	 * État RÉEL (source : base, canAccessApp — le paramètre d'URL ne prouve
	 * rien). « Confirmé » = accès dérivé non bloqué ET porteuse d'un accès
	 * (accès offert ou abonnement actif / période payée en cours).
	 */
	const confirmed = $derived(
		b.decision !== 'block' &&
			(b.billingAccessOverride === 'complimentary' ||
				(b.subscription !== null && (b.subscription.status !== 'canceled' || (b.subscription.currentPeriodEnd ?? 0) > Date.now())))
	);
	/** Grâce 24 h : accès ouvert, moyen de paiement à régulariser. */
	const inGrace = $derived(b.decision === 'allow_with_payment_warning');

	/**
	 * CTA « Retourner à G-FLUX » → la page Facturation (client-side en PWA,
	 * navigation complète dans le navigateur externe). Après un Checkout, on
	 * transmet ?checkout=success : le bandeau existant reste honnête tant que
	 * le webhook n'a pas confirmé (« en cours de confirmation »), et la page
	 * facturation se revalide d'elle-même au retour de focus.
	 */
	const returnHref = $derived(data.checkout === 'success' ? '/espace/facturation?checkout=success' : '/espace/facturation');

	/**
	 * Retour de focus pendant que cette page est affichée : revalidation
	 * automatique — si la confirmation Stripe arrive entre-temps, l'écran
	 * passe tout seul à « Tout est à jour ». Aucun polling.
	 */
	$effect(() => startBillingFocusRevalidate());
</script>

<svelte:head><title>Retour — G-Flux</title></svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-soft px-4 py-10">
	<img src="/logo-header.png" alt="G-Flux" class="mb-8 h-9 w-auto" />

	<div class="w-full max-w-md rounded-3xl border border-line bg-card p-7 text-center shadow-xl shadow-ink/5">
		{#if confirmed}
			<!-- État RÉEL confirmé par la base (webhook) — jamais l'URL seule -->
			<div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-light">
				<Icon name="circleCheck" size={30} class="text-brand" />
			</div>
			<h1 class="mt-4 font-display text-[1.5rem] font-black leading-tight tracking-tight text-ink">Tout est à jour ✓</h1>
			<p class="mt-2 text-sm font-semibold text-mist-strong">Ton abonnement G-FLUX a bien été mis à jour.</p>
			<p class="mt-1 text-[13px] text-mist">Tu peux maintenant revenir dans l'application.</p>
			{#if b.subscription && b.subscription.currentPeriodEnd}
				<p class="mt-3 rounded-xl bg-cream px-3 py-2 text-[12px] font-semibold text-mist-strong">
					G-FLUX Autonomie · {b.subscription.plan === 'yearly' ? '129 € / an' : '15,90 € / mois'}
					{#if b.subscription.status === 'active' || b.subscription.status === 'trialing'}
						— prochaine échéance le {dateFR(b.subscription.currentPeriodEnd)}
					{/if}
				</p>
			{/if}
		{:else if inGrace}
			<!-- Grâce 24 h : accès ouvert, moyen de paiement à régulariser -->
			<div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-warn-light">
				<Icon name="triangleAlert" size={26} class="text-warn" />
			</div>
			<h1 class="mt-4 font-display text-[1.5rem] font-black leading-tight tracking-tight text-ink">Presque terminé</h1>
			<p class="mt-2 text-sm leading-relaxed text-mist-strong">
				Ton accès reste ouvert. Il ne reste que ton moyen de paiement à mettre à jour — continue sereinement.
			</p>
		{:else}
			<!-- PAS encore confirmé : on ne dit JAMAIS « paiement validé » ici.
			     La source de vérité reste le webhook Stripe → la base. -->
			<div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-cream">
				<Icon name="refreshCw" size={24} class="animate-spin text-mist" />
			</div>
			<h1 class="mt-4 font-display text-[1.5rem] font-black leading-tight tracking-tight text-ink">Mise à jour en cours de confirmation</h1>
			<p class="mt-2 text-sm leading-relaxed text-mist-strong">
				Dès que Stripe confirme, ton accès s'ouvre automatiquement — cette page se met à jour d'elle-même.
			</p>
		{/if}

		<a
			href={returnHref}
			data-sveltekit-noscroll
			class="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-brand-dark"
		>
			Retourner à G-FLUX <Icon name="arrowRight" size={15} />
		</a>

		<p class="mt-3 text-[11.5px] leading-snug text-mist">
			{#if inPwa && onMobile}
				Tu es déjà dans l'application — le bouton te ramène à ta Facturation.
			{:else}
				Si l'application ne s'ouvre pas automatiquement, ferme cette page et reviens à G-FLUX.
			{/if}
		</p>
	</div>
</div>
