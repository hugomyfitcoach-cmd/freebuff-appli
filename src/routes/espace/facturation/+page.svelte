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
	 * 1) RESET immédiat de l'état UI de redirection — le loading ne survit
	 *    JAMAIS au retour (bouton et cartes immédiatement réutilisables) ;
	 * 2) revalidation AUTOMATIQUE de l'entitlement côté serveur — si le webhook
	 *    a confirmé le paiement pendant l'absence, la page se déverrouille
	 *    d'elle-même (aucun refresh manuel, aucun redémarrage).
	 * Aucun polling : on n'écoute que le vrai retour de l'utilisatrice.
	 */
	function resetCheckoutUi() {
		loading = false;
		portalLoading = false;
	}
	$effect(() => startBillingFocusRevalidate(resetCheckoutUi));

	/**
	 * Paywall premium : la page sous la modale ne doit pas défiler derrière
	 * elle (présentation seule — AUCUNE incidence sur le verrou d'accès, qui
	 * reste 100 % serveur). S'applique quand la cliente est bloquée ; ajuste
	 * `padding-right` pour compenser la disparition de la barre de scroll.
	 */
	$effect(() => {
		if (b.decision !== 'block') return;
		document.body.style.overflow = 'hidden';
		const sbw = window.innerWidth - document.documentElement.clientWidth;
		document.body.style.paddingRight = sbw > 0 ? `${sbw}px` : '';
		return () => {
			document.body.style.overflow = '';
			document.body.style.paddingRight = '';
		};
	});

	async function startCheckout(p: 'monthly' | 'yearly') {
		if (loading) return; // double-clic : une seule création de session à la fois
		plan = p;
		loading = true;
		errorMsg = '';
		try {
			// création de la Checkout Session — le priceId reste 100 % serveur
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ plan: p }),
			});
			const json = await res.json();
			if (res.ok && json.url) {
				// Ouverture FIABLE (iOS/PWA inclus) : tentative d'ouverture directe
				// de l'URL Stripe, puis fallback navigation même contexte si refusée
				// ou fenêtre fantôme. Aucune dépendance au user gesture, aucune
				// fenêtre vide, aucune navigation de WindowProxy (stratégie
				// « open blank → redirect » abandonnée : non fiable en PWA iOS réel).
				openStripeUrl(json.url);
				return;
			}
			errorMsg = json.error ?? 'Une erreur est survenue. Réessaie.';
		} catch {
			errorMsg = 'Connexion impossible. Vérifie ton réseau et réessaie.';
		} finally {
			// le loading ne sert qu'à éviter le double-clic pendant la création :
			// il ne survit JAMAIS à l'ouverture (ni à un échec) — le bouton et
			// les cartes redeviennent immédiatement interactifs. Une nouvelle
			// session partira avec le plan alors sélectionné.
			loading = false;
		}
	}

	async function openPortal() {
		if (portalLoading) return;
		portalLoading = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/billing/portal', { method: 'POST' });
			const json = await res.json();
			if (res.ok && json.url) {
				// Même ouverture fiable que le checkout (iOS/PWA) — jamais de
				// « Ouverture… » survivant au retour (finally ci-dessous).
				openStripeUrl(json.url);
				return;
			}
			errorMsg = json.error ?? 'Une erreur est survenue. Réessaie.';
		} catch {
			errorMsg = 'Connexion impossible. Vérifie ton réseau et réessaie.';
		} finally {
			portalLoading = false;
		}
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
				<div class="pb-shell">
					<!-- En-tête app (avatar + titre + action) -->
					<div class="pb-header">
						<div class="pb-sk h-8 w-8 rounded-full"></div>
						<div class="pb-sk h-2.5 w-20"></div>
						<div class="pb-sk h-8 w-8 rounded-full"></div>
					</div>
					<div class="pb-body">
						<!-- Dashboard : salutation + carte calories/macros (factice) -->
						<div class="pb-card">
							<div class="pb-sk h-3 w-36"></div>
							<div class="pb-sk mt-2 h-6 w-44"></div>
							<div class="mt-4 flex items-center gap-3">
								<div class="pb-ring"></div>
								<div class="flex-1 space-y-2">
									<div class="pb-sk h-2.5 w-full"></div>
									<div class="pb-sk h-2.5 w-4/5"></div>
									<div class="pb-sk h-2.5 w-3/5"></div>
								</div>
							</div>
							<div class="mt-4 grid grid-cols-3 gap-2">
								<div class="pb-chip"><div class="pb-sk h-2 w-8"></div><div class="pb-sk mt-1.5 h-3.5 w-10"></div></div>
								<div class="pb-chip"><div class="pb-sk h-2 w-8"></div><div class="pb-sk mt-1.5 h-3.5 w-10"></div></div>
								<div class="pb-chip"><div class="pb-sk h-2 w-8"></div><div class="pb-sk mt-1.5 h-3.5 w-10"></div></div>
							</div>
						</div>
						<!-- Journal (lignes factices génériques) -->
						<div class="pb-card">
							<div class="flex items-center justify-between">
								<div class="pb-sk h-3 w-16"></div>
								<div class="pb-sk h-2.5 w-12"></div>
							</div>
							<div class="mt-3 space-y-2.5">
								<div class="flex items-center gap-3">
									<div class="pb-sk h-9 w-9 rounded-full"></div>
									<div class="flex-1 space-y-1.5">
										<div class="pb-sk h-2.5 w-3/4"></div>
										<div class="pb-sk h-2 w-1/2"></div>
									</div>
								</div>
								<div class="flex items-center gap-3">
									<div class="pb-sk h-9 w-9 rounded-full"></div>
									<div class="flex-1 space-y-1.5">
										<div class="pb-sk h-2.5 w-2/3"></div>
										<div class="pb-sk h-2 w-2/5"></div>
									</div>
								</div>
								<div class="flex items-center gap-3">
									<div class="pb-sk h-9 w-9 rounded-full"></div>
									<div class="flex-1 space-y-1.5">
										<div class="pb-sk h-2.5 w-1/2"></div>
										<div class="pb-sk h-2 w-1/3"></div>
									</div>
								</div>
							</div>
						</div>
						<!-- Progression (barres hebdo factices) -->
						<div class="pb-card">
							<div class="pb-sk h-3 w-24"></div>
							<div class="mt-4 flex items-end gap-2" style="height: 4.5rem">
								<div class="pb-bar" style="height: 45%"></div>
								<div class="pb-bar" style="height: 70%"></div>
								<div class="pb-bar" style="height: 55%"></div>
								<div class="pb-bar" style="height: 85%"></div>
								<div class="pb-bar" style="height: 40%"></div>
								<div class="pb-bar" style="height: 65%"></div>
								<div class="pb-bar" style="height: 75%"></div>
							</div>
						</div>
					</div>
					<!-- Navigation basse : Accueil / Journal / Progression (placeholders) -->
					<div class="pb-nav">
						<div class="flex flex-col items-center gap-1.5">
							<div class="pb-sk h-5 w-5 rounded-md"></div>
							<div class="pb-sk h-2 w-12"></div>
						</div>
						<div class="flex flex-col items-center gap-1.5">
							<div class="pb-sk h-5 w-5 rounded-md"></div>
							<div class="pb-sk h-2 w-12"></div>
						</div>
						<div class="flex flex-col items-center gap-1.5">
							<div class="pb-sk h-5 w-5 rounded-md"></div>
							<div class="pb-sk h-2 w-12"></div>
						</div>
					</div>
				</div>
			</div>

			<div class="paywall-overlay">
				<div role="dialog" aria-modal="true" aria-label="Retrouve ton accès à G-FLUX — choix de l'offre" class="paywall-modal">
					<p class="text-[10px] font-bold uppercase tracking-widest text-mist">TON ACCÈS G-FLUX</p>
					<h2 class="paywall-title mt-1 font-display font-black leading-tight tracking-tight text-ink">Retrouve ton accès à G-FLUX</h2>
					<p class="mt-2 text-[13px] leading-relaxed text-mist-strong">
						Ton historique, ton Journal, ta progression et tous tes outils sont toujours là. Reprends exactement là où tu t'es arrêté(e).
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
						<div class="mt-5 grid gap-3" role="radiogroup" aria-label="Choisis ton offre">
							<button
								type="button"
								role="radio"
								aria-checked={plan === 'yearly'}
								onclick={() => (plan = 'yearly')}
								class="paywall-offer {plan === 'yearly' ? 'paywall-offer-selected' : ''}"
							>
								<span class="paywall-badge">Économise 32 %</span>
								<div class="flex items-start justify-between gap-3">
									<div>
										<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Annuel</p>
										<p class="mt-1 font-display text-xl font-black text-ink">129 € <span class="text-sm font-bold text-mist">/ an</span></p>
									</div>
									<span class="paywall-check" class:paywall-check-on={plan === 'yearly'} aria-hidden="true">
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
								class="paywall-offer {plan === 'monthly' ? 'paywall-offer-selected' : ''}"
							>
								<div class="flex items-start justify-between gap-3">
									<div>
										<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Mensuel</p>
										<p class="mt-1 font-display text-xl font-black text-ink">15,90 € <span class="text-sm font-bold text-mist">/ mois</span></p>
									</div>
									<span class="paywall-check" class:paywall-check-on={plan === 'monthly'} aria-hidden="true">
										{#if plan === 'monthly'}<Icon name="circleCheck" size={12} />{/if}
									</span>
								</div>
								<p class="mt-0.5 text-[11.5px] font-semibold text-mist">Sans engagement</p>
							</button>
						</div>

						{#if errorMsg}
							<p class="mt-3 rounded-xl border border-danger/30 bg-danger-light px-3.5 py-2.5 text-[12.5px] font-semibold text-danger" role="alert">{errorMsg}</p>
						{/if}

						<button
							type="button"
							onclick={() => startCheckout(plan)}
							disabled={loading}
							aria-busy={loading}
							class="mt-5 w-full rounded-2xl bg-brand px-4 py-3.5 text-[15px] font-bold text-white shadow-sm transition duration-200 hover:bg-brand-dark active:scale-[0.99] disabled:opacity-60"
						>
							<!-- Label STABLE « Réactiver mon accès » + spinner bref : le
							     loading ne dure que la création de session, jamais
							     jusqu'au paiement — il ne survit jamais au retour. -->
							<span class="flex items-center justify-center gap-2">
								{#if loading}<Icon name="refreshCw" size={16} class="animate-spin" />{/if}
								Réactiver mon accès
							</span>
						</button>
						<p class="mt-2.5 text-center text-[11px] leading-snug text-mist">Paiement sécurisé par Stripe · Tes données restent conservées.</p>
					{/if}

					<!-- Sortie de session toujours possible pendant le lock (12c) :
					     volontairement très secondaire, elle ne concurrence pas le CTA. -->
					<form method="POST" action="?/logout" class="mt-4 border-t border-line pt-3">
						<button type="submit" class="mx-auto block px-4 py-1.5 text-[12px] text-mist transition duration-200 hover:text-danger">Se déconnecter</button>
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
	 * PAYWALL PREMIUM (révision 5) — purement décoratif et sans état. Le fond
	 * ÉVOQUE l'application G-FLUX (shell, dashboard, calories/macros, Journal,
	 * Progression, navigation basse) avec des skeletons et un contenu Factice
	 * générique : AUCUNE donnée protégée requêtée ou rendue, aucune requête
	 * réseau. La modale est centrée, largeur ~91 % (max 28rem), hauteur limitée
	 * à ~87vh avec scroll interne. Le verrou d'accès reste côté serveur
	 * (requireClientAccess), strictement inchangé.
	 */
	.paywall-backdrop {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background-color: var(--color-soft);
	}
	/* Voile discret : l'app est « toujours là derrière, mais inaccessible ». */
	.paywall-backdrop::after {
		content: '';
		position: absolute;
		inset: 0;
		background: rgba(17, 17, 16, 0.18);
		pointer-events: none;
	}
	.pb-shell {
		height: 100%;
		width: 100%;
		max-width: 28rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		opacity: 0.75;
		filter: blur(4px) saturate(0.92);
	}
	.pb-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: max(1rem, env(safe-area-inset-top)) 1.25rem 0.75rem;
	}
	.pb-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0 1rem;
	}
	.pb-nav {
		display: flex;
		justify-content: space-around;
		padding: 0.85rem 1rem max(0.9rem, env(safe-area-inset-bottom));
		border-top: 1px solid var(--color-line-soft);
		background-color: var(--color-card);
	}
	.pb-card {
		border-radius: 1rem;
		border: 1px solid var(--color-line-soft);
		background-color: var(--color-card);
		padding: 1rem;
		box-shadow: 0 1px 2px rgba(17, 17, 16, 0.04);
	}
	.pb-chip {
		border-radius: 0.65rem;
		background-color: var(--color-soft);
		padding: 0.6rem;
	}
	.pb-ring {
		height: 4.5rem;
		width: 4.5rem;
		flex-shrink: 0;
		border-radius: 9999px;
		border: 6px solid var(--color-brand);
		opacity: 0.65;
		background:
			conic-gradient(var(--color-brand) 0 62%, var(--color-brand-light) 62% 100%);
	}
	.pb-bar {
		flex: 1;
		border-radius: 0.375rem 0.375rem 0 0;
		background-color: var(--color-brand);
		opacity: 0.55;
	}
	.pb-sk {
		border-radius: 0.5rem;
		background-color: var(--color-line-soft);
	}
	/* Modale CENTRÉE : ~91 % du viewport (max 28rem), centrée dans la zone
	   utile (safe areas iOS incluses), max-height ~87vh, scroll interne. */
	.paywall-overlay {
		position: fixed;
		inset: 0;
		z-index: 65;
		display: flex;
		align-items: center;
		justify-content: center;
		padding-top: max(1rem, calc(env(safe-area-inset-top) + 0.75rem));
		padding-bottom: max(1rem, calc(env(safe-area-inset-bottom) + 0.75rem));
		padding-left: 0.75rem;
		padding-right: 0.75rem;
		background-color: rgba(17, 17, 16, 0.45);
		-webkit-backdrop-filter: blur(3px);
		backdrop-filter: blur(3px);
	}
	.paywall-modal {
		width: 91%;
		max-width: 28rem;
		max-height: 87vh;
		overflow-y: auto;
		overflow-x: hidden;
		border-radius: 1.5rem;
		border: 1px solid rgba(17, 17, 16, 0.08);
		/* Blanc légèrement translucide (≈94 %) + blur doux : l’app se devine
		   derrière, la lisibilité et le contraste restent excellents. */
		background-color: rgba(255, 255, 255, 0.94);
		-webkit-backdrop-filter: blur(14px) saturate(1.05);
		backdrop-filter: blur(14px) saturate(1.05);
		padding: 1.5rem;
		box-shadow:
			0 24px 48px -12px rgba(17, 17, 16, 0.25),
			inset 0 1px 0 rgba(255, 255, 255, 0.6);
	}
	/* Titre sur UNE SEULE LIGNE (mobile compris) : taille responsive en clamp
	   (16 px sur petits écrans → 24 px ≥ 480 px) + nowrap — premium, jamais tassé. */
	.paywall-title {
		font-size: clamp(0.9375rem, 5vw, 1.5rem);
		white-space: nowrap;
	}
	/* Offres : sélection lisible (bordure verte, fond teinté, check discret). */
	.paywall-offer {
		position: relative;
		border-radius: 1rem;
		border: 1.5px solid var(--color-line);
		background-color: var(--color-card);
		padding: 1rem;
		text-align: left;
		transition: border-color 200ms ease, background-color 200ms ease, box-shadow 200ms ease;
	}
	.paywall-offer:hover {
		border-color: var(--color-mist);
	}
	.paywall-offer-selected {
		border-color: var(--color-brand);
		background-color: var(--color-brand-soft);
		box-shadow: 0 1px 3px rgba(29, 185, 84, 0.12);
	}
	.paywall-badge {
		position: absolute;
		top: -0.65rem;
		right: 1rem;
		border-radius: 9999px;
		background-color: var(--color-brand);
		padding: 0.15rem 0.55rem;
		font-size: 10px;
		line-height: 1.4;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #ffffff;
	}
	.paywall-check {
		margin-top: 0.125rem;
		display: grid;
		height: 1.25rem;
		width: 1.25rem;
		flex-shrink: 0;
		place-items: center;
		border-radius: 9999px;
		border: 1.5px solid var(--color-mist);
		background-color: #ffffff;
		color: #ffffff;
		transition: border-color 200ms ease, background-color 200ms ease;
	}
	.paywall-check-on {
		border-color: var(--color-brand);
		background-color: var(--color-brand);
	}
</style>
