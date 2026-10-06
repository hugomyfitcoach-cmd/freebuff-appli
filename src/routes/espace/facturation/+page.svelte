<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	/** Offre sélectionnée (checkout) — mensuelle par défaut, annuelle mise en avant. */
	let plan = $state<'monthly' | 'yearly'>('yearly');
	let loading = $state(false);
	let errorMsg = $state('');

	/** Portail Stripe (portal) — état de la requête. */
	let portalLoading = $state(false);

	const b = $derived(data.billing);
	const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
	const dateFR = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

	const statusLabel: Record<string, string> = {
		active: 'Actif',
		trialing: 'Essai en cours',
		past_due: 'Paiement à régulariser',
		canceled: 'Terminé',
		unpaid: 'Suspendu',
		incomplete: 'Incomplet',
		incomplete_expired: 'Expiré',
		paused: 'En pause',
	};

	async function startCheckout(p: 'monthly' | 'yearly') {
		plan = p;
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ plan: p }),
			});
			const json = await res.json();
			if (res.ok && json.url) {
				window.location.href = json.url;
				return;
			}
			errorMsg = json.error ?? 'Une erreur est survenue. Réessaie.';
		} catch {
			errorMsg = 'Connexion impossible. Vérifie ton réseau et réessaie.';
		}
		loading = false;
	}

	async function openPortal() {
		portalLoading = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/billing/portal', { method: 'POST' });
			const json = await res.json();
			if (res.ok && json.url) {
				window.location.href = json.url;
				return;
			}
			errorMsg = json.error ?? 'Une erreur est survenue. Réessaie.';
		} catch {
			errorMsg = 'Connexion impossible. Vérifie ton réseau et réessaie.';
		}
		portalLoading = false;
	}
</script>

<svelte:head><title>Facturation — G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-md px-4 pb-16 pt-6 md:pt-10">
	<!-- ═══ EN-TÊTE ═══ -->
	<header class="mb-6">
		<a href="/espace" class="inline-flex items-center gap-1 text-[13px] font-bold text-mist transition hover:text-brand" data-sveltekit-noscroll>
			<Icon name="arrowLeft" size={14} /> Retour
		</a>
		<h1 class="mt-3 font-display text-[1.6rem] font-black leading-tight tracking-tight text-ink">Facturation</h1>
	</header>

	<!-- ═══ ALERTE GRÂCE (paiement à régulariser) — calme, jamais anxiogène ═══ -->
	{#if b.decision === 'allow_with_payment_warning'}
		<div class="mb-5 rounded-2xl border border-warn/40 bg-warn-light px-4 py-3.5">
			<p class="flex items-center gap-2 text-sm font-bold text-ink">
				<Icon name="triangleAlert" size={16} class="shrink-0 text-warn" />
				Un problème est survenu avec ton paiement.
			</p>
			<p class="mt-1 text-[12.5px] leading-snug text-mist-strong">
				Ton accès reste ouvert. Mets à jour ton moyen de paiement pour continuer sereinement.
				{#if b.subscription?.graceUntil}Échéance : le {dateFR(b.subscription.graceUntil)}.{/if}
			</p>
			<button
				type="button"
				onclick={openPortal}
				disabled={portalLoading}
				class="mt-3 w-full rounded-xl bg-warn px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
			>
				{portalLoading ? 'Ouverture…' : 'Mettre à jour mon moyen de paiement'}
			</button>
		</div>
	{/if}

	<!-- ═══ COACHING : accès inclus, aucune demande d'abonnement ═══ -->
	{#if b.coachingMode === 'coaching'}
		<section class="rounded-2xl border border-line bg-card p-5 shadow-sm">
			<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Ton offre</p>
			<p class="mt-2 font-display text-lg font-black text-ink">G-FLUX Coaching</p>
			<p class="mt-2 flex items-center gap-2 text-sm font-semibold text-brand-dark">
				<Icon name="circleCheck" size={16} />
				Accès à G-FLUX inclus dans ton accompagnement
			</p>
			<p class="mt-2 text-[12.5px] leading-relaxed text-mist">
				Ton suivi complet (Journal, Progression, Entraînement, Ressources) est couvert par ton accompagnement — rien à régler, rien à gérer.
			</p>
		</section>

	<!-- ═══ AUTONOMIE : selon l'état dérivé ═══ -->
	{:else}
		<!-- Accès offert -->
		{#if b.billingAccessOverride === 'complimentary'}
			<section class="rounded-2xl border border-brand/30 bg-brand-light/50 p-5 shadow-sm">
				<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Ton offre</p>
				<p class="mt-2 font-display text-lg font-black text-ink">G-FLUX Autonomie</p>
				<p class="mt-2 flex items-center gap-2 text-sm font-semibold text-brand-dark">
					<Icon name="gift" size={16} />
					Accès à G-FLUX offert
				</p>
				<p class="mt-2 text-[12.5px] leading-relaxed text-mist">Offert par ton coach — l'accès complet à l'app est activé pour toi.</p>
			</section>

			<!-- Abonnement actif / trialing / past_due / canceled avec période payée en cours -->
		{:else if b.subscription && (b.subscription.status !== 'canceled' || (b.subscription.currentPeriodEnd ?? 0) > Date.now())}
			<section class="rounded-2xl border border-line bg-card p-5 shadow-sm">
				<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Ton abonnement</p>
				<div class="mt-2 flex items-start justify-between gap-3">
					<div>
						<p class="font-display text-lg font-black text-ink">G-FLUX Autonomie</p>
						<p class="mt-0.5 text-sm font-semibold text-mist-strong">
							{b.subscription.plan === 'yearly' ? '129 € / an' : '15,90 € / mois'}
						</p>
					</div>
					<span class="rounded-full px-2.5 py-1 text-[11px] font-bold {b.subscription.status === 'past_due' ? 'bg-warn-light text-warn' : 'bg-brand-light text-brand-dark'}">
						{statusLabel[b.subscription.status ?? ''] ?? b.subscription.status}
					</span>
				</div>
				{#if b.subscription.status === 'active' || b.subscription.status === 'trialing'}
					{#if b.subscription.currentPeriodEnd}
						<p class="mt-3 text-[12.5px] text-mist">
							{b.subscription.cancelAtPeriodEnd
								? `Ton abonnement prendra fin le ${dateFR(b.subscription.currentPeriodEnd)}.`
								: `Prochaine échéance : le ${dateFR(b.subscription.currentPeriodEnd)}.`}
						</p>
					{:else if b.subscription.cancelAtPeriodEnd}
						<p class="mt-3 text-[12.5px] text-mist">Ton abonnement prendra fin à la fin de la période en cours.</p>
					{/if}
					{#if b.subscription.cancelAtPeriodEnd}
						<p class="mt-1.5 text-[12.5px] leading-snug text-mist">Ton accès reste ouvert jusqu'à cette date, puis tes données restent conservées.</p>
					{/if}
				{/if}
				<button
					type="button"
					onclick={openPortal}
					disabled={portalLoading}
					class="mt-4 w-full rounded-xl border-2 border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand hover:text-brand disabled:opacity-60"
				>
					{portalLoading ? 'Ouverture…' : 'Gérer mon abonnement'}
				</button>
				<p class="mt-2 text-center text-[11px] text-mist">Moyen de paiement, factures et résiliation — espace sécurisé Stripe.</p>
			</section>

			<!-- Bloquée : PAYWALL -->
		{:else}
			<section class="rounded-2xl border border-line bg-card p-5 shadow-sm">
				<h2 class="font-display text-[1.35rem] font-black leading-tight tracking-tight text-ink">Continue avec G-FLUX</h2>
				<p class="mt-2 text-[13.5px] leading-relaxed text-mist-strong">
					Ton compte, ton historique, ton Journal, ta progression et tous les outils G-FLUX sont conservés. Choisis ton offre pour reprendre exactement là où tu t'es arrêtée.
				</p>
			</section>

			{#if !data.billingReady}
				<p class="mt-4 rounded-xl border border-line bg-cream px-4 py-3 text-center text-[12.5px] text-mist">
					La souscription en ligne arrive très bientôt — ton accès est en attente d'activation.
				</p>
			{:else}
				<!-- OFFRES : 2 cartes sobres, économie annuelle soulignée sans pression -->
				<div class="mt-4 grid gap-3">
					<button
						type="button"
						onclick={() => (plan = 'yearly')}
						class="relative rounded-2xl border-2 px-4 py-4 text-left transition {plan === 'yearly' ? 'border-brand bg-brand-soft shadow-sm' : 'border-line bg-card hover:border-mist'}"
					>
						<span class="absolute -top-2.5 right-4 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">2 mois offerts</span>
						<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Annuel</p>
						<p class="mt-1 font-display text-xl font-black text-ink">129 € <span class="text-sm font-bold text-mist">/ an</span></p>
						<p class="mt-0.5 text-[11.5px] font-semibold text-brand-dark">Soit 10,75 € / mois</p>
					</button>
					<button
						type="button"
						onclick={() => (plan = 'monthly')}
						class="rounded-2xl border-2 px-4 py-4 text-left transition {plan === 'monthly' ? 'border-brand bg-brand-soft shadow-sm' : 'border-line bg-card hover:border-mist'}"
					>
						<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Mensuel</p>
						<p class="mt-1 font-display text-xl font-black text-ink">15,90 € <span class="text-sm font-bold text-mist">/ mois</span></p>
						<p class="mt-0.5 text-[11.5px] font-semibold text-mist">Sans engagement, résiliable à tout moment</p>
					</button>
				</div>

				{#if errorMsg}
					<p class="mt-3 rounded-xl border border-danger/30 bg-danger-light px-3.5 py-2.5 text-[12.5px] font-semibold text-danger" role="alert">{errorMsg}</p>
				{/if}

				<button
					type="button"
					onclick={() => startCheckout(plan)}
					disabled={loading}
					class="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
				>
					{loading ? 'Redirection…' : 'Continuer avec G-FLUX'}
				</button>
				<p class="mt-2.5 text-center text-[11px] leading-snug text-mist">Paiement sécurisé via Stripe. Résiliation en un geste, données toujours conservées.</p>
			{/if}
		{/if}
	{/if}

	<!-- ═══ Retour de Checkout (le webhook reste la source de vérité) ═══ -->
	{#if data.checkout === 'success'}
		<p class="mt-5 rounded-xl border border-brand/30 bg-brand-light/60 px-4 py-3 text-center text-[12.5px] font-semibold text-brand-dark">
			Merci ! Ton paiement est en cours de confirmation — cette page se met à jour automatiquement dès que c'est validé.
		</p>
	{:else if data.checkout === 'cancel'}
		<p class="mt-5 rounded-xl border border-line bg-cream px-4 py-3 text-center text-[12.5px] text-mist">Paiement interrompu — aucune somme n'a été débitée. Tu peux reprendre quand tu veux.</p>
	{/if}
</div>
