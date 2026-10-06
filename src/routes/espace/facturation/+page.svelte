<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { openStripeUrl, startBillingFocusRevalidate } from '$lib/billingRefresh';

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

	/**
	 * Entitlement RÉEL (webhook Stripe → base → accessState) : même définition
	 * que la page /facturation/retour. Sert UNIQUEMENT à personnaliser le
	 * bandeau de retour de Checkout — l'URL ?checkout=success ne prouve rien,
	 * la source de vérité reste le webhook/entitlement serveur, et le verrou
	 * d'accès est décidé côté serveur (requireClientAccess), jamais ici.
	 */
	const entitlementActive = $derived(
		b.decision !== 'block' &&
			(b.billingAccessOverride === 'complimentary' ||
				(b.subscription !== null && (b.subscription.status !== 'canceled' || (b.subscription.currentPeriodEnd ?? 0) > Date.now())))
	);

	/**
	 * Retour de focus après un passage chez Stripe (Checkout ou Portal) :
	 * revalidation AUTOMATIQUE de l'entitlement côté serveur — si le webhook a
	 * confirmé le paiement pendant l'absence, la page se déverrouille d'elle-
	 * même (aucun refresh manuel, aucun redémarrage). Aucun polling : on
	 * n'écoute que le vrai retour de l'utilisatrice.
	 */
	$effect(() => startBillingFocusRevalidate());

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
				// PWA installée → Stripe s'ouvre dans le navigateur externe (G-FLUX
				// reste ouverte derrière) ; web classique → même contexte.
				openStripeUrl(json.url);
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
				// PWA installée → navigateur externe ; web classique → même contexte.
				openStripeUrl(json.url);
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

			<!-- Bloquée : PAYWALL PREMIUM — présentation visuelle seule. Le fond imite
		     le shell G-FLUX avec des PLACEHOLDERS (aucune donnée protégée chargée,
		     aucune requête réseau) ; le verrou d'accès reste 100 % serveur
		     (requireClientAccess) : ce bloc n'ouvre AUCUN contenu réellement. -->
		{:else}
			<div class="paywall-backdrop" aria-hidden="true">
				<div class="pb-card">
					<div class="flex items-center gap-3">
						<div class="pb-sk h-10 w-10 shrink-0 rounded-full"></div>
						<div class="flex-1 space-y-2">
							<div class="pb-sk h-3 w-28"></div>
							<div class="pb-sk h-2.5 w-20"></div>
						</div>
						<div class="pb-sk h-8 w-8 shrink-0 rounded-full"></div>
					</div>
				</div>
				<div class="pb-card">
					<div class="pb-sk h-3 w-24"></div>
					<div class="pb-sk mt-2 h-7 w-44"></div>
					<div class="mt-4 grid grid-cols-3 gap-2">
						<div class="pb-sk h-14"></div>
						<div class="pb-sk h-14"></div>
						<div class="pb-sk h-14"></div>
					</div>
					<div class="mt-4 space-y-2">
						<div class="pb-sk h-3 w-full"></div>
						<div class="pb-sk h-3 w-11/12"></div>
						<div class="pb-sk h-3 w-3/4"></div>
					</div>
				</div>
				<div class="pb-card">
					<div class="pb-sk h-3 w-20"></div>
					<div class="mt-3 flex items-center gap-3">
						<div class="pb-sk h-11 w-11 shrink-0 rounded-full"></div>
						<div class="flex-1 space-y-2">
							<div class="pb-sk h-3 w-2/3"></div>
							<div class="pb-sk h-2.5 w-1/2"></div>
						</div>
					</div>
					<div class="mt-3 flex items-center gap-3">
						<div class="pb-sk h-11 w-11 shrink-0 rounded-full"></div>
						<div class="flex-1 space-y-2">
							<div class="pb-sk h-3 w-3/5"></div>
							<div class="pb-sk h-2.5 w-2/5"></div>
						</div>
					</div>
				</div>
				<div class="pb-cta mt-4"></div>
			</div>

			<div class="paywall-overlay">
				<div role="dialog" aria-modal="true" aria-label="Continue avec G-FLUX — choix de l'offre" class="w-full max-w-md rounded-3xl border border-line bg-card p-6 shadow-2xl shadow-ink/20">
					<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Ton accès G-FLUX</p>
					<h2 class="mt-1 font-display text-[1.45rem] font-black leading-tight tracking-tight text-ink">Continue avec G-FLUX</h2>
					<p class="mt-2 text-[13px] leading-relaxed text-mist-strong">
						Ton compte, ton historique, ton Journal, ta progression et tous les outils G-FLUX sont conservés. Choisis ton offre pour reprendre exactement là où tu t'es arrêtée.
					</p>

					{#if data.checkout === 'success' && !entitlementActive}
						<!-- Paiement rentré mais pas encore confirmé serveur : état visible
						     même derrière l'overlay — jamais « actif » sur la foi de l'URL. -->
						<p class="mt-3 rounded-xl border border-line bg-cream px-3.5 py-2.5 text-center text-[12px] font-semibold text-mist-strong">
							Vérification de ton abonnement…
							<span class="mt-0.5 block font-normal text-mist">Cette page se met à jour automatiquement.</span>
						</p>
					{/if}

					{#if !data.billingReady}
						<p class="mt-4 rounded-xl border border-line bg-cream px-4 py-3 text-center text-[12.5px] text-mist">
							La souscription en ligne arrive très bientôt — ton accès est en attente d'activation.
						</p>
					{:else}
						<div class="mt-4 grid gap-3" role="radiogroup" aria-label="Choisis ton offre">
							<button
								type="button"
								role="radio"
								aria-checked={plan === 'yearly'}
								onclick={() => (plan = 'yearly')}
								class="relative rounded-2xl border-2 px-4 py-4 text-left transition {plan === 'yearly' ? 'border-brand bg-brand-soft shadow-sm' : 'border-line bg-card hover:border-mist'}"
							>
								<span class="absolute -top-2.5 right-4 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Économise 32 %</span>
								<div class="flex items-start justify-between gap-3">
									<div>
										<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Annuel</p>
										<p class="mt-1 font-display text-xl font-black text-ink">129 € <span class="text-sm font-bold text-mist">/ an</span></p>
									</div>
									<span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 {plan === 'yearly' ? 'border-brand bg-brand text-white' : 'border-mist bg-white'}">
										{#if plan === 'yearly'}<Icon name="circleCheck" size={12} />{/if}
									</span>
								</div>
								<p class="mt-0.5 text-[11.5px] font-semibold text-brand-dark">Soit 10,75 € / mois</p>
							</button>
							<button
								type="button"
								role="radio"
								aria-checked={plan === 'monthly'}
								onclick={() => (plan = 'monthly')}
								class="rounded-2xl border-2 px-4 py-4 text-left transition {plan === 'monthly' ? 'border-brand bg-brand-soft shadow-sm' : 'border-line bg-card hover:border-mist'}"
							>
								<div class="flex items-start justify-between gap-3">
									<div>
										<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Mensuel</p>
										<p class="mt-1 font-display text-xl font-black text-ink">15,90 € <span class="text-sm font-bold text-mist">/ mois</span></p>
									</div>
									<span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 {plan === 'monthly' ? 'border-brand bg-brand text-white' : 'border-mist bg-white'}">
										{#if plan === 'monthly'}<Icon name="circleCheck" size={12} />{/if}
									</span>
								</div>
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

					<!-- Sortie de session toujours possible pendant le lock (12c) :
					     la page est derrière l'overlay → bouton équivalent ici. -->
					<form method="POST" action="?/logout" class="mt-4 border-t border-line pt-4">
						<button type="submit" class="w-full rounded-xl px-4 py-2 text-[12px] font-bold text-mist transition hover:text-danger">Se déconnecter</button>
					</form>
				</div>
			</div>
		{/if}
	{/if}

	<!-- ═══ Retour de Checkout (le webhook reste la source de vérité) ═══
	     Bandeau STRICTEMENT state-aware : tant que l'entitlement serveur
	     n'est pas confirmé → « Vérification… » ; dès qu'il est actif →
	     confirmation + CTA de retour. L'URL ne prouve jamais le succès. -->
	{#if data.checkout === 'success'}
		{#if entitlementActive}
			<div class="mt-5 rounded-xl border border-brand/30 bg-brand-light/60 px-4 py-3.5 text-center">
				<p class="flex items-center justify-center gap-2 text-[13px] font-black text-brand-dark">
					<Icon name="circleCheck" size={16} class="shrink-0" />
					C'est bon, ton abonnement est actif ✓
				</p>
				<p class="mt-1 text-[12.5px] text-brand-dark">Tu peux maintenant profiter de G-FLUX.</p>
				<a
					href="/espace"
					data-sveltekit-noscroll
					class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-dark"
				>
					Retour à G-FLUX <Icon name="arrowRight" size={14} />
				</a>
			</div>
		{:else}
			<p class="mt-5 rounded-xl border border-line bg-cream px-4 py-3 text-center text-[12.5px] font-semibold text-mist-strong">
				Vérification de ton abonnement…
				<span class="mt-0.5 block font-normal text-mist">Cette page se met à jour automatiquement.</span>
			</p>
		{/if}
	{:else if data.checkout === 'cancel'}
		<p class="mt-5 rounded-xl border border-line bg-cream px-4 py-3 text-center text-[12.5px] text-mist">Paiement interrompu — aucune somme n'a été débitée. Tu peux reprendre quand tu veux.</p>
	{/if}

	<!-- ═══ SORTIE DE SESSION — page facturation = seule page ouverte pendant le
			hard lock : la déconnexion doit y rester possible ═══ -->
	<form method="POST" action="?/logout" class="mt-6 border-t border-line pt-5">
		<button
			type="submit"
			class="w-full rounded-xl border-2 border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-danger hover:text-danger"
		>
			Se déconnecter
		</button>
	</form>
</div>

<style>
	/*
	 * PAYWALL PREMIUM (révision 4) — purement décoratif et sans état : le fond
	 * imite le shell G-FLUX avec des PLACEHOLDERS uniquement (aucune donnée
	 * protégée chargée, aucune requête réseau) ; l'overlay concentre le choix
	 * d'offre en bottom-sheet (mobile) / carte centrée (desktop). Le verrou
	 * d'accès reste côté serveur (requireClientAccess), strictement inchangé.
	 */
	.paywall-backdrop {
		position: relative;
		margin: 1.25rem 0 0.5rem;
		border-radius: 1.5rem;
		border: 1px solid var(--color-line);
		background-color: var(--color-card);
		padding: 1rem;
		opacity: 0.85;
		-webkit-backdrop-filter: blur(6px);
		backdrop-filter: blur(6px);
	}
	.paywall-backdrop::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0) 12%, var(--color-card) 92%);
		pointer-events: none;
	}
	.pb-card {
		border-radius: 1rem;
		border: 1px solid var(--color-line-soft);
		background-color: var(--color-soft);
		padding: 1rem;
		opacity: 0.8;
	}
	.pb-sk {
		border-radius: 0.5rem;
		background-color: var(--color-line-soft);
		animation: paywall-pulse 1.8s ease-in-out infinite;
	}
	.pb-cta {
		height: 3rem;
		border-radius: 0.75rem;
		background-color: var(--color-brand);
		opacity: 0.7;
	}
	@keyframes paywall-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pb-sk {
			animation: none;
		}
	}
	/* Bottom-sheet mobile (safe-area iPhone incluse), carte centrée ≥ md. */
	.paywall-overlay {
		position: fixed;
		inset: 0;
		z-index: 65;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 0.75rem;
		padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
		background-color: rgba(17, 17, 16, 0.5);
		-webkit-backdrop-filter: blur(6px);
		backdrop-filter: blur(6px);
	}
	@media (min-width: 768px) {
		.paywall-overlay {
			align-items: center;
			padding: 1.5rem;
		}
	}
</style>
