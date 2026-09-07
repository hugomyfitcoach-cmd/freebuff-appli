<script lang="ts">
	/**
	 * Dashboard « Accueil » de l'espace cliente.
	 *
	 * Répond à trois questions : où j'en suis ? qu'est-ce que j'ai à faire ?
	 * où dois-je cliquer ? Tous les statuts sont calculés côté serveur
	 * (convex/dashboard.ts) — la page ne fait qu'afficher, sans conditions
	 * dispersées. Un bloc sans information pertinente disparaît complètement.
	 */

	type Recap = {
		weekStart: string;
		weekEnd: string;
		calories: { avg: number | null; goal: number; trackedDays: number };
		steps: { avg: number | null; goal: number | null; trackedDays: number };
		weighins: { count: number; goal: number };
		bilan: { sent: boolean };
		due: {
			measurements: { due: boolean; done: boolean } | null;
			photos: { due: boolean; done: boolean } | null;
		};
		message: string;
	};

	type Onboarding = {
		enabled: boolean;
		formDone: boolean;
		step2: { measurements: boolean; photos: boolean; done: boolean };
		done: boolean;
		submittedAt: number | null;
	};

	type Dashboard = {
		today: string;
		onboarding: Onboarding | null;
		coachMessage: {
			text: string | null;
			date: string;
			audio: { mediaId: string; durationMs: number | null; url: string } | null;
		} | null;
		tracking: { kcal: number; kcalGoal: number; maintenanceKcal: number | null };
		steps: { today: number | null; goal: number | null };
		progression: {
			lastWeightKg: number | null;
			lastWeightDate: string | null;
			weighinsThisWeek: number;
			measurementsDue: boolean;
			photosDue: boolean;
			startDate: string | null;
		};
		bilan: { due: boolean; windowOpen: boolean };
		feedback: {
			unread: boolean;
			hasCheckins: boolean;
			latestWeekLabel: string | null;
			latestFeedbackAt: number | null;
		};
		recap: Recap | null;
		badges: { bilans: number; progression: number };
	};

	import { invalidateAll } from '$app/navigation';
	import { getGreeting } from '$lib/greetings';
	import AudioPlayer from '$lib/components/AudioPlayer.svelte';
	import { fmtMs } from '$lib/media';

	/** Première écoute réelle d'un audio (message du coach) — déclenche la rétention 72 h. */
	async function listen(mediaId: string) {
		try {
			await fetch('/api/media/listen', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaId }),
			});
		} catch {
			/* silencieux : la prochaine écoute refera la tentative */
		}
	}

	let { data } = $props();
	const user = $derived(data.user);
	const dash = $derived<Dashboard | null>(data.dashboard ?? null);

	const todayLabel = $derived(
		new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase())
	);
	// Salutation contextuelle (heure locale de la cliente) — stable pour la journée.
	const greeting = $derived(getGreeting(user._id, user.prenom));

	/* ————— Actions à faire (priorité : fort puis normal) ————— */
	type Action = { id: string; strong: boolean; title: string; desc: string; href: string; cta: string };
	const actions = $derived.by<Action[]>(() => {
		if (!dash) return [];
		const list: Action[] = [];
		if (dash.bilan.due) {
			list.push({
				id: 'bilan',
				strong: true,
				title: 'Ton bilan de la semaine est disponible',
				desc: 'À compléter avant dimanche 12h',
				href: '/bilan',
				cta: 'Remplir mon bilan →',
			});
		}
		if (dash.feedback.unread) {
			list.push({
				id: 'retour',
				strong: true,
				title: 'Nouveau retour de ton coach disponible',
				desc: 'Un retour vient d’être publié pour toi',
				href: '/espace/historique',
				cta: 'Lire le retour →',
			});
		}
		if (dash.progression.measurementsDue) {
			list.push({
				id: 'mensurations',
				strong: false,
				title: 'Mensurations',
				desc: 'C’est le moment de mettre à jour tes mensurations.',
				href: '/espace/progression?action=mensurations',
				cta: 'Ajouter mes mensurations →',
			});
		}
		if (dash.progression.photosDue) {
			list.push({
				id: 'photos',
				strong: false,
				title: 'Photos de progression',
				desc: 'C’est le moment de mettre à jour tes photos.',
				href: '/espace/photos',
				cta: 'Ajouter mes photos →',
			});
		}
		return list;
	});

	const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
	const fmtWeight = (n: number | null) => (n === null ? '—' : `${String(n).replace('.', ',')} kg`);
	const peseesLabel = $derived(
		dash ? `${dash.progression.weighinsThisWeek} / 3${dash.progression.weighinsThisWeek >= 3 ? ' ✓' : ''}` : ''
	);

	/* ————— Pas du jour (une valeur par jour, modifiable) ————— */
	const isEvening = $derived(new Date().getHours() >= 18);
	let stepsOpen = $state(false);
	let stepsValue = $state('');
	let stepsSaving = $state(false);
	let stepsError = $state('');
	const todaySteps = $derived(dash?.steps.today ?? null);
	const stepGoal = $derived(dash?.steps.goal ?? null);

	function openSteps() {
		stepsValue = todaySteps !== null ? String(todaySteps) : '';
		stepsError = '';
		stepsOpen = true;
	}

	async function saveSteps() {
		if (!dash) return;
		const n = Number(String(stepsValue).replace(/\s/g, ''));
		if (!Number.isInteger(n) || n < 0 || n > 150000) {
			stepsError = 'Entre un nombre valide (0 à 150 000 pas).';
			return;
		}
		stepsSaving = true;
		stepsError = '';
		try {
			const res = await fetch('/api/steps', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ date: dash.today, count: n }),
			});
			const data = await res.json();
			if (!res.ok || data.error) throw new Error(data.error ?? 'Enregistrement impossible.');
			stepsOpen = false;
			await invalidateAll();
		} catch (e) {
			stepsError = e instanceof Error ? e.message : 'Enregistrement impossible.';
		} finally {
			stepsSaving = false;
		}
	}

	/* ————— Récap hebdo (dimanche soir → lundi) ————— */
	const recap = $derived(dash?.recap ?? null);
	function recapRangeLabel(): string {
		const fmt = (iso: string) =>
			new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
		if (!recap) return '';
		return `${fmt(recap.weekStart)} → ${fmt(recap.weekEnd)}`;
	}

	/** Filet de sécurité : maintenance > objectif (sinon comportement inchangé). */
	const maintenanceKcal = $derived(
		dash && dash.tracking.maintenanceKcal && dash.tracking.maintenanceKcal > dash.tracking.kcalGoal
			? dash.tracking.maintenanceKcal
			: null
	);
	const barScale = $derived(maintenanceKcal ?? dash?.tracking.kcalGoal ?? 1);
	const kcalPct = $derived(dash ? Math.min(100, (dash.tracking.kcal / barScale) * 100) : 0);
	const goalMarkPct = $derived(barScale > 0 ? ((dash?.tracking.kcalGoal ?? 1) / barScale) * 100 : 0);
</script>

<svelte:head><title>Accueil — G-Flux</title></svelte:head>

<!-- ═══════════ En-tête ═══════════ -->
<header class="mb-6">
	<h1 class="font-display text-2xl font-semibold text-ink">{greeting.title}</h1>
	<p class="mt-1 text-sm text-mist">{greeting.dayLine ?? `${todayLabel} — voici où tu en es.`}</p>
</header>

<!-- ═══════════ Onboarding de démarrage (si activé par le coach et non terminé) ═══════════ -->
{#if dash?.onboarding && !dash.onboarding.done}
	{@const ob = dash.onboarding}
	<section class="mb-6 rounded-2xl border border-brand/40 bg-gradient-to-br from-brand-light via-brand-light/60 to-white p-5 shadow-sm">
		<h2 class="font-display text-lg font-semibold text-ink">Bienvenue dans G-FLUX 👋</h2>
		<p class="mt-1 text-sm leading-relaxed text-mist">
			Avant de commencer, complète ces deux étapes pour que ton coach puisse préparer ton accompagnement.
		</p>

		<div class="mt-4 space-y-3">
			<!-- Étape 1 : formulaire de démarrage -->
			<div class="rounded-xl border-2 border-line bg-white p-4 transition {ob.formDone ? 'border-brand/50' : ''}">
				<div class="flex items-center gap-3">
					<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full {ob.formDone ? 'bg-brand text-white' : 'border-2 border-mist/50 text-mist'}">
						{#if ob.formDone}✓{:else}<span class="text-xs font-bold">1</span>{/if}
					</span>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-bold text-ink">Formulaire de démarrage</p>
						<p class="text-xs text-mist">{ob.formDone ? 'Reçu par ton coach ✓' : 'Ton profil, tes habitudes, ton historique…'}</p>
					</div>
					{#if !ob.formDone}
						<a href="/espace/demarrage" class="shrink-0 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-dark">
							Commencer →
						</a>
					{:else}
						<a href="/espace/demarrage" class="shrink-0 text-sm font-bold text-brand-dark">Revoir →</a>
					{/if}
				</div>
			</div>

			<!-- Étape 2 : mensurations & photos -->
			<div class="rounded-xl border-2 border-line bg-white p-4 transition {ob.step2.done ? 'border-brand/50' : ''}">
				<div class="flex items-center gap-3">
					<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full {ob.step2.done ? 'bg-brand text-white' : 'border-2 border-mist/50 text-mist'}">
						{#if ob.step2.done}✓{:else}<span class="text-xs font-bold">2</span>{/if}
					</span>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-bold text-ink">Mensurations & photos</p>
						<p class="text-xs text-mist">
							{#if ob.step2.done}
								C'est fait ✓
							{:else}
								Tes données de départ pour suivre ta progression.
								{#if !ob.step2.measurements && !ob.step2.photos}
									 Mensurations et photos à ajouter.
								{:else if ob.step2.measurements}
									 Photos encore à ajouter.
								{:else}
									 Mensurations encore à ajouter.
								{/if}
							{/if}
						</p>
					</div>
				</div>
				{#if !ob.step2.done}
					<div class="mt-3 flex flex-wrap gap-2">
						{#if !ob.step2.measurements}
							<a href="/espace/progression?action=mensurations" class="rounded-xl border-2 border-brand/50 bg-brand-light px-3.5 py-2 text-xs font-bold text-brand-dark transition hover:bg-brand/20">
								📏 Faire mes mensurations
							</a>
						{/if}
						{#if !ob.step2.photos}
							<a href="/espace/photos" class="rounded-xl border-2 border-brand/50 bg-brand-light px-3.5 py-2 text-xs font-bold text-brand-dark transition hover:bg-brand/20">
								📸 Ajouter mes photos
							</a>
						{/if}
					</div>
				{/if}
			</div>
		</div>

	</section>
{/if}

<!-- ═══════════ Message du coach (texte et/ou audio — uniquement s'il existe) ═══════════ -->
{#if dash?.coachMessage}
	<section class="rounded-2xl border border-brand/30 bg-brand-light px-5 py-4">
		<p class="text-[11px] font-bold uppercase tracking-widest text-brand-dark">Message de ton coach</p>
		{#if dash.coachMessage.text}
			<p class="mt-1.5 text-[15px] leading-relaxed text-ink">{dash.coachMessage.text}</p>
		{/if}
		{#if dash.coachMessage.audio}
			{@const a = dash.coachMessage.audio}
			<div class="mt-2 rounded-xl bg-white/70 p-3">
				<p class="mb-1.5 text-xs font-semibold text-brand-dark">🎙️ Message audio · {fmtMs(a.durationMs)}</p>
				<AudioPlayer src={a.url} durationMs={a.durationMs} onFirstPlay={() => listen(a.mediaId)} />
			</div>
		{/if}
	</section>
{/if}

<!-- ═══════════ À faire (uniquement s'il y a des actions) ═══════════ -->
{#if actions.length > 0}
	<section class="space-y-3">
		<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">À faire</h2>
		{#each actions as action (action.id)}
			<a
				href={action.href}
				class="block rounded-2xl border px-5 py-4 transition hover:border-brand
					{action.strong ? 'border-brand bg-brand-light' : 'border-line bg-card shadow-sm'}"
			>
				<div class="flex items-start gap-3">
					<span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-warn text-xs font-bold text-white">1</span>
					<div class="min-w-0 flex-1">
						<p class="font-display text-base font-semibold text-ink">{action.title}</p>
						<p class="mt-0.5 text-sm text-mist">{action.desc}</p>
						<p class="mt-2 text-sm font-bold {action.strong ? 'text-brand-dark' : 'text-ink'}">{action.cta}</p>
					</div>
				</div>
			</a>
		{/each}
	</section>
{/if}

<!-- ═══════════ Ta semaine en un coup d'œil (dimanche soir → lundi) ═══════════ -->
{#if recap}
	<section class="recap-card mt-6 rounded-2xl border border-brand/30 bg-brand-light p-5 shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-[11px] font-bold uppercase tracking-widest text-brand-dark">Ta semaine en un coup d'œil</h2>
			<span class="text-[11px] text-mist">{recapRangeLabel()}</span>
		</div>
		<div class="mt-4 space-y-4">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<p class="text-[10px] font-bold uppercase tracking-wider text-mist">🔥 Calories moyennes</p>
					<p class="mt-0.5 font-display text-2xl font-semibold text-ink">
						{recap.calories.avg !== null ? `${fmt(recap.calories.avg)} kcal` : '—'}<span class="text-xs font-semibold text-mist"> / jour</span>
					</p>
					<p class="text-[11px] text-mist">Objectif : {fmt(recap.calories.goal)} · {recap.calories.trackedDays} / 7 jours suivis</p>
				</div>
				<div>
					<p class="text-[10px] font-bold uppercase tracking-wider text-mist">👟 Pas moyens</p>
					<p class="mt-0.5 font-display text-2xl font-semibold text-ink">
						{recap.steps.avg !== null ? fmt(recap.steps.avg) : '—'}<span class="text-xs font-semibold text-mist"> / jour</span>
					</p>
					<p class="text-[11px] text-mist">
						{recap.steps.goal !== null ? `Objectif : ${fmt(recap.steps.goal)} · ` : ''}{recap.steps.trackedDays} / 7 jours renseignés
					</p>
				</div>
			</div>
			<div class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink">
				<span>⚖️ Pesées : <strong>{recap.weighins.count} / {recap.weighins.goal}</strong>{recap.weighins.count >= recap.weighins.goal ? ' ✓' : ''}</span>
				<span>📋 Bilan : <strong>{recap.bilan.sent ? 'Envoyé ✓' : 'Non envoyé'}</strong></span>
				{#if recap.due.measurements}
					<span>📏 Mensurations : <strong>{recap.due.measurements.done ? 'Fait ✓' : 'À faire'}</strong></span>
				{/if}
				{#if recap.due.photos}
					<span>📸 Photos : <strong>{recap.due.photos.done ? 'Fait ✓' : 'À faire'}</strong></span>
				{/if}
			</div>
		</div>
		<div class="mt-4 rounded-xl border border-brand/20 bg-white/60 px-4 py-3">
			<p class="text-[11px] font-bold uppercase tracking-wider text-mist">Message de la semaine</p>
			<p class="mt-1 text-sm leading-relaxed text-ink">{recap.message}</p>
		</div>
	</section>
{/if}

<!-- ═══════════ Tracking calories ═══════════ -->
<section class="mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Tracking calories</h2>
		<span class="text-xs font-semibold text-mist">Aujourd’hui</span>
	</div>
	<p class="mt-2 font-display text-3xl font-semibold text-ink">
		{dash ? fmt(dash.tracking.kcal) : '—'}
		<span class="text-base font-semibold text-mist"> / {dash ? fmt(dash.tracking.kcalGoal) : '—'} kcal</span>
	</p>
	{#if dash && maintenanceKcal && dash.tracking.kcal > dash.tracking.kcalGoal && dash.tracking.kcal <= maintenanceKcal}
		<p class="mt-1 text-xs font-semibold text-warn">🛟 Dans ton filet de sécurité — sous ta maintenance</p>
	{/if}
	<div class="relative mt-3 h-2 overflow-hidden rounded-full bg-line">
		{#if maintenanceKcal}
			<div class="absolute inset-y-0 rounded-full bg-warn-light" style="left: {goalMarkPct}%; right: 0"></div>
		{/if}
		<div class="relative h-full rounded-full bg-brand transition-all" style="width: {kcalPct}%"></div>
		{#if maintenanceKcal && dash}
			<div class="absolute inset-y-[-2px] w-[2px] rounded bg-ink/50" style="left: {goalMarkPct}%" title="Objectif : {fmt(dash.tracking.kcalGoal)} kcal"></div>
		{/if}
	</div>
	{#if dash && maintenanceKcal}
		<p class="mt-1.5 text-right text-[11px] text-mist">Maintenance : {fmt(maintenanceKcal)} kcal</p>
	{/if}
	<a
		href="/espace/journal"
		class="mt-4 flex items-center justify-between rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white transition hover:bg-brand"
	>
		<span>Tracker mes calories</span>
		<span>→</span>
	</a>
</section>

<!-- ═══════════ Pas aujourd'hui (une valeur par jour) ═══════════ -->
{#if dash}
	<section class="mt-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Pas aujourd'hui</h2>
			{#if stepGoal !== null}
				<span class="text-xs font-semibold text-mist">Objectif : {fmt(stepGoal)}</span>
			{/if}
		</div>

		{#if todaySteps !== null}
			<p class="mt-2 font-display text-3xl font-semibold text-ink">
				{fmt(todaySteps)}
				{#if stepGoal !== null}<span class="text-base font-semibold text-mist"> / {fmt(stepGoal)}</span>{/if}
			</p>
			{#if stepGoal !== null && todaySteps >= stepGoal}
				<p class="mt-1 text-xs font-semibold text-brand-dark">Objectif atteint ✓</p>
			{:else}
				<p class="mt-1 text-xs text-mist">Bien noté — tu peux corriger à tout moment.</p>
			{/if}
		{:else}
			{#if isEvening}
				<p class="mt-2 text-sm text-ink">Combien de pas aujourd'hui ?</p>
			{:else}
				<p class="mt-2 text-sm text-mist">Pas encore renseignés aujourd'hui.</p>
			{/if}
		{/if}

		{#if !stepsOpen}
			<button
				type="button"
				onclick={openSteps}
				class="mt-3 flex items-center justify-between rounded-xl border-2 border-line px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand hover:text-brand"
			>
				<span>{todaySteps !== null ? 'Modifier mes pas' : 'Ajouter mes pas'}</span>
				<span>→</span>
			</button>
		{:else}
			<div class="mt-3 rounded-xl bg-cream/60 p-3">
				<p class="text-xs font-semibold text-ink">Combien de pas aujourd'hui ?</p>
				<input
					type="number"
					inputmode="numeric"
					min="0"
					max="150000"
					placeholder="Ex. 8742"
					bind:value={stepsValue}
					class="mt-2 w-full rounded-xl border-2 border-line bg-white px-4 py-3 text-lg font-semibold outline-none transition focus:border-brand"
				/>
				{#if stepsError}
					<p class="mt-1.5 text-xs font-semibold text-danger">{stepsError}</p>
				{/if}
				<div class="mt-3 flex items-center gap-2">
					<button
						type="button"
						onclick={saveSteps}
						disabled={stepsSaving}
						class="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
					>
						{stepsSaving ? 'Enregistrement…' : 'Enregistrer'}
					</button>
					<button
						type="button"
						onclick={() => (stepsOpen = false)}
						class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-semibold text-mist transition hover:text-ink"
					>
						Annuler
					</button>
				</div>
			</div>
		{/if}
	</section>
{/if}

<!-- ═══════════ Ma progression ═══════════ -->
<a
	href="/espace/progression"
	class="mt-4 block rounded-2xl border border-line bg-card p-5 shadow-sm transition hover:border-brand"
>
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Ma progression</h2>
		<span class="text-lg" aria-hidden="true">📈</span>
	</div>
	<div class="mt-2 flex items-baseline gap-3">
		<p class="font-display text-4xl font-semibold text-ink">{dash ? fmtWeight(dash.progression.lastWeightKg) : '—'}</p>
		{#if dash?.progression.lastWeightDate}
			<span class="text-xs text-mist">dernier poids</span>
		{/if}
	</div>
	<p class="mt-2 text-sm text-mist">
		Pesées cette semaine : <strong class="font-bold text-ink">{peseesLabel}</strong>
	</p>
	<p class="mt-3 flex items-center justify-between rounded-xl border-2 border-line px-4 py-2.5 text-sm font-bold text-ink transition group-hover:border-brand">
		<span>Voir ma progression</span>
		<span>→</span>
	</p>
</a>

<!-- ═══════════ Retours de mon coach ═══════════ -->
{#if dash?.feedback.hasCheckins}
	<section
		class="mt-4 rounded-2xl border px-5 py-4
			{dash.feedback.unread ? 'border-brand bg-brand-light shadow-sm' : 'border-line bg-card shadow-sm'}"
	>
		<div class="flex items-center justify-between gap-3">
			<h2 class="text-[11px] font-bold uppercase tracking-widest {dash.feedback.unread ? 'text-brand-dark' : 'text-mist'}">
				Retours de mon coach
			</h2>
			{#if dash.feedback.unread}
				<span class="grid h-6 min-w-6 place-items-center rounded-full bg-warn px-1.5 text-xs font-bold text-white">1</span>
			{/if}
		</div>
		{#if dash.feedback.unread}
			<p class="mt-2 font-display text-lg font-semibold text-ink">Nouveau retour disponible</p>
			{#if dash.feedback.latestWeekLabel}
				<p class="mt-0.5 text-sm text-mist">{dash.feedback.latestWeekLabel}</p>
			{/if}
			<a href="/espace/historique" class="mt-3 inline-flex items-center gap-1 text-sm font-bold text-brand-dark">
				Lire le retour <span>→</span>
			</a>
		{:else}
			<p class="mt-2 text-sm text-ink">
				{dash.feedback.latestWeekLabel
					? 'Retour consulté ✓'
					: 'Bilan envoyé ✓ — en attente du retour de ta coach'}
			</p>
			<a href="/espace/historique" class="mt-3 inline-flex items-center gap-1 text-sm font-bold text-ink">
				Voir mes retours <span>→</span>
			</a>
		{/if}
	</section>
{/if}

<style>
	/* Petite animation discrète à la première apparition du récap hebdo. */
	.recap-card {
		animation: recapIn 0.6s cubic-bezier(0.34, 1.4, 0.64, 1) both;
	}
	@keyframes recapIn {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
</style>