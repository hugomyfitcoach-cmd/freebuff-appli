<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	/* ————— Profil ————— */
	let prenom = $state(data.profile.prenom);
	let profileSaving = $state(false);
	let profileMsg = $state<{ ok: boolean; text: string } | null>(null);

	/* ————— Mot de passe ————— */
	let pwdSaving = $state(false);
	let pwdMsg = $state<{ ok: boolean; text: string } | null>(null);

	/* ————— Portail Stripe (mise à jour moyen de paiement / gestion) ————— */
	let portalLoading = $state(false);

	/* ————— Facturation (état dérivé serveur, même source que /espace/facturation) ————— */
	const b = $derived(data.billing);
	const dateFR = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
	/** Carte abonnement visible même pour un « canceled » dont la période payée court encore. */
	const subVisible = $derived(
		b.subscription !== null &&
			(b.subscription.status !== 'canceled' || (b.subscription.currentPeriodEnd ?? 0) > Date.now())
	);
	const statusLabel: Record<string, string> = {
		active: 'Actif',
		trialing: 'Essai en cours',
		past_due: 'Paiement à régulariser',
		canceled: 'Prend fin le',
		unpaid: 'Suspendu',
		incomplete: 'Incomplet',
		incomplete_expired: 'Expiré',
		paused: 'En pause',
	};

	async function openPortal() {
		portalLoading = true;
		try {
			const res = await fetch('/api/billing/portal', { method: 'POST' });
			const json = await res.json();
			if (res.ok && json.url) {
				window.location.href = json.url;
				return;
			}
			alert(json.error ?? 'Une erreur est survenue. Réessaie.');
		} catch {
			alert('Connexion impossible. Vérifie ton réseau et réessaie.');
		}
		portalLoading = false;
	}
</script>

<svelte:head><title>Paramètres — G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-md px-4 pb-16 pt-6 md:pt-10">
	<!-- ═══ EN-TÊTE ═══ -->
	<header class="mb-6">
		<a href="/espace" class="inline-flex items-center gap-1 text-[13px] font-bold text-mist transition hover:text-brand" data-sveltekit-noscroll>
			<Icon name="arrowLeft" size={14} /> Retour
		</a>
		<h1 class="mt-3 font-display text-[1.6rem] font-black leading-tight tracking-tight text-ink">Paramètres</h1>
	</header>

	<!-- ═══ PROFIL ═══ -->
	<section class="rounded-2xl border border-line bg-card p-5 shadow-sm">
		<p class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-mist">
			<Icon name="user" size={13} /> Profil
		</p>
		<form
			method="POST"
			action="?/profile"
			class="mt-3"
			use:enhance={() => {
				profileSaving = true;
				profileMsg = null;
				return async ({ update }) => {
					await update({ reset: false });
					profileSaving = false;
					profileMsg = { ok: true, text: 'Prénom enregistré.' };
				};
			}}
		>
			<label class="block text-[12px] font-bold text-mist-strong" for="prenom">Prénom</label>
			<input
				id="prenom"
				name="prenom"
				type="text"
				bind:value={prenom}
				required
				maxlength="60"
				class="mt-1 w-full rounded-xl border-2 border-line bg-white px-3.5 py-2.5 text-[15px] font-semibold text-ink outline-none transition focus:border-brand"
			/>
			{#if profileMsg}
				<p class="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-dark" role="status">
					<Icon name="circleCheck" size={14} /> {profileMsg.text}
				</p>
			{/if}
			<button
				type="submit"
				disabled={profileSaving || prenom.trim() === data.profile.prenom}
				class="mt-3 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-50"
			>
				{profileSaving ? 'Enregistrement…' : 'Enregistrer'}
			</button>
		</form>
	</section>

	<!-- ═══ COMPTE : email + mot de passe ═══ -->
	<section class="mt-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
		<p class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-mist">
			<Icon name="lockKeyhole" size={13} /> Compte
		</p>
		<div class="mt-3">
			<p class="text-[12px] font-bold text-mist-strong">Email</p>
			<p class="mt-1 rounded-xl border-2 border-line bg-cream px-3.5 py-2.5 text-[15px] font-semibold text-mist">{data.profile.email}</p>
			<p class="mt-1.5 text-[11.5px] text-mist">Ton email identifie ton compte G-FLUX et tes paiements Stripe.</p>
		</div>

		<form
			method="POST"
			action="?/password"
			class="mt-5 border-t border-line pt-4"
			use:enhance={() => {
				pwdSaving = true;
				pwdMsg = null;
				return async ({ result, update }) => {
					pwdSaving = false;
					if (result.type === 'failure') {
						const errData = result.data as { passwordError?: string } | undefined;
						pwdMsg = { ok: false, text: errData?.passwordError ?? 'Une erreur est survenue.' };
					} else {
						await update({ reset: true });
						pwdMsg = { ok: true, text: 'Mot de passe mis à jour.' };
					}
				};
			}}
		>
			<p class="text-[12px] font-bold text-mist-strong">Changer de mot de passe</p>
			<input
				name="currentPassword"
				type="password"
				required
				placeholder="Mot de passe actuel"
				autocomplete="current-password"
				class="mt-2 w-full rounded-xl border-2 border-line bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none transition focus:border-brand"
			/>
			<input
				name="newPassword"
				type="password"
				required
				minlength="8"
				placeholder="Nouveau mot de passe (8 caractères min.)"
				autocomplete="new-password"
				class="mt-2 w-full rounded-xl border-2 border-line bg-white px-3.5 py-2.5 text-[15px] text-ink outline-none transition focus:border-brand"
			/>
			{#if pwdMsg}
				<p
					class="mt-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold {pwdMsg.ok
						? 'bg-brand-light text-brand-dark'
						: 'bg-danger-light text-danger'}"
					role="status"
				>
					{pwdMsg.text}
				</p>
			{/if}
			<button
				type="submit"
				disabled={pwdSaving}
				class="mt-3 w-full rounded-xl border-2 border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand hover:text-brand disabled:opacity-60"
			>
				{pwdSaving ? 'Vérification…' : 'Mettre à jour'}
			</button>
		</form>
	</section>

	<!-- ═══ NOTIFICATIONS : pilotées par le système existant ═══ -->
	<section class="mt-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
		<p class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-mist">
			<Icon name="bell" size={13} /> Notifications
		</p>
		<p class="mt-2.5 flex items-start gap-2 text-[12.5px] leading-relaxed text-mist-strong">
			<Icon name="info" size={14} class="mt-0.5 shrink-0 text-mist" />
			Les rappels (Journal, pesée, coach) sont gérés depuis ton appareil et ton suivi. Aucun réglage supplémentaire n'est nécessaire ici.
		</p>
	</section>

	<!-- ═══ FACTURATION : même état dérivé que /espace/facturation ═══ -->
	<section class="mt-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
		<p class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-mist">
			<Icon name="creditCard" size={13} /> Facturation
		</p>

		<!-- Alerte grâce : calme, action claire -->
		{#if b.decision === 'allow_with_payment_warning'}
			<div class="mt-3 rounded-xl border border-warn/40 bg-warn-light px-4 py-3">
				<p class="flex items-center gap-2 text-sm font-bold text-ink">
					<Icon name="triangleAlert" size={15} class="shrink-0 text-warn" />
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
		{:else if b.coachingMode === 'coaching'}
			<p class="mt-3 flex items-center gap-2 text-sm font-semibold text-brand-dark">
				<Icon name="circleCheck" size={15} />
				Accès à G-FLUX inclus dans ton accompagnement
			</p>
			<p class="mt-1 text-[12.5px] leading-relaxed text-mist">Rien à régler, rien à gérer — ton suivi couvre l'app.</p>
		{:else if b.billingAccessOverride === 'complimentary'}
			<p class="mt-3 flex items-center gap-2 text-sm font-semibold text-brand-dark">
				<Icon name="gift" size={15} />
				Accès à G-FLUX offert
			</p>
			<p class="mt-1 text-[12.5px] leading-relaxed text-mist">Offert par ton coach — l'accès complet à l'app est activé pour toi.</p>
		{:else if subVisible && b.subscription}
			<div class="mt-3 flex items-start justify-between gap-3">
				<div>
					<p class="text-sm font-black text-ink">G-FLUX Autonomie</p>
					<p class="mt-0.5 text-[12.5px] font-semibold text-mist-strong">
						{b.subscription.plan === 'yearly' ? '129 € / an' : '15,90 € / mois'}
					</p>
				</div>
				<span class="rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold text-brand-dark">
					{statusLabel[b.subscription.status ?? ''] ?? b.subscription.status}
				</span>
			</div>
			{#if b.subscription.currentPeriodEnd}
				<p class="mt-2 text-[12.5px] text-mist">
					{b.subscription.cancelAtPeriodEnd
						? `Ton abonnement prendra fin le ${dateFR(b.subscription.currentPeriodEnd)} — tes données restent conservées.`
						: `Prochaine échéance : le ${dateFR(b.subscription.currentPeriodEnd)}.`}
				</p>
			{/if}
			<button
				type="button"
				onclick={openPortal}
				disabled={portalLoading}
				class="mt-3 w-full rounded-xl border-2 border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand hover:text-brand disabled:opacity-60"
			>
				{portalLoading ? 'Ouverture…' : 'Gérer mon abonnement'}
			</button>
		{:else}
			<p class="mt-3 text-[12.5px] leading-relaxed text-mist-strong">Aucun abonnement actif pour le moment.</p>
			<a
				href="/espace/facturation"
				data-sveltekit-noscroll
				class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
			>
				Voir les offres <Icon name="arrowRight" size={14} />
			</a>
		{/if}
	</section>

	<!-- ═══ DÉCONNEXION ═══ -->
	<section class="mt-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
		<form method="POST" action="?/logout">
			<button
				type="submit"
				class="w-full rounded-xl border-2 border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-danger hover:text-danger"
			>
				Se déconnecter
			</button>
		</form>
		<p class="mt-2 text-center text-[11px] text-mist">Tes données restent intactes — tu les retrouveras à ta prochaine connexion.</p>
	</section>
</div>
