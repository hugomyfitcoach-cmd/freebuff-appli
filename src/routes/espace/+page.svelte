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
			read: boolean;
		} | null;
		tracking: { kcal: number; kcalGoal: number; maintenanceKcal: number | null };
		steps: { today: number | null; goal: number | null; week: { date: string; count: number }[] };
		progression: {
			lastWeightKg: number | null;
			lastWeightDate: string | null;
			weighinsThisWeek: number;
			measurementsDue: boolean;
			photosDue: boolean;
			startDate: string | null;
			weightTrend: { date: string; weightKg: number }[];
		};
		bilan: { due: boolean; windowOpen: boolean };
		feedback: {
			unread: boolean;
			hasCheckins: boolean;
			latestWeekLabel: string | null;
			latestFeedbackAt: number | null;
		};
		recap: Recap | null;
		badges: { bilans: number; retours?: number; message?: number; progression: number };
	};

	import { goto, invalidateAll } from '$app/navigation';
	import { getGreeting } from '$lib/greetings';
	import AudioPlayer from '$lib/components/AudioPlayer.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import { fmtMs, type CoachMediaItem } from '$lib/media';
	import {
		CYCLE_LENGTH_OPTIONS,
		CYCLE_NO_ESTIMATE_MSGS,
		cycleState,
		phaseRanges,
		type CycleConfig,
		type CycleContra,
	} from '$lib/cycle';

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

	/* ── Message du coach du jour : « Vu » (badge non lu + mise en évidence) ── */
	let msgReadBusy = $state(false);
	async function markMsgRead() {
		if (msgReadBusy || !dash?.coachMessage || dash.coachMessage.read) return;
		msgReadBusy = true;
		try {
			const r = await fetch('/api/media/message-read', { method: 'POST' });
			if (r.ok) await invalidateAll();
		} catch {
			/* silencieux : l'utilisatrice peut réessayer */
		} finally {
			msgReadBusy = false;
		}
	}

	let { data } = $props();
	const user = $derived(data.user);
	const dash = $derived<Dashboard | null>(data.dashboard ?? null);

	/* ————— Historique « Mes retours de bilan » (mêmes données que la page Mes bilans) ————— */
	type CheckinRow = {
		_id: string;
		weekStart: string;
		weekLabel: string;
		status: string;
		feedback?: string;
		feedbackAt?: number | null;
		feedbackReadAt?: number | null;
		_creationTime: number;
	};
	const checkins = $derived<CheckinRow[]>((data.checkins ?? []) as CheckinRow[]);
	const checkinMedia = $derived((data.media ?? {}) as Record<string, CoachMediaItem[]>);
	const returned = $derived(checkins.filter((c) => c.status === 'retour_envoye'));
	/** Retours publiés mais pas encore consultés (source : feedbackReadAt vs feedbackAt). */
	const unreadReturned = $derived(
		returned.filter((c) => c.feedbackReadAt == null || c.feedbackReadAt < (c.feedbackAt ?? c._creationTime))
	);
	const isUnread = (c: CheckinRow) => unreadReturned.some((u) => u._id === c._id);
	/** Semaine du retour lue et à consulter (la plus récente non lue est mise en avant, sans contenu inline). */
	const displayedReturns = $derived(returned.filter((c) => !isUnread(c)));
	function weekRangeLabel(weekStart: string): string {
		const monday = new Date(weekStart + 'T12:00:00');
		const sunday = new Date(monday.getTime() + 6 * 86400000);
		const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
		const y = monday.getFullYear() !== new Date().getFullYear() ? ` ${monday.getFullYear()}` : '';
		if (monday.getFullYear() === sunday.getFullYear()) return `Semaine du ${fmt(monday)} au ${fmt(sunday)}${y}`;
		return `${weekStart}`;
	}
	const retourMedia = (checkinId: string) => (checkinMedia[checkinId] ?? []) as CoachMediaItem[];
	function fmtBilanDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	/* ————— Carte de cycle « Bilan de la semaine » (fuseau horaire de la cliente) ————— */
	/** Lundi local (00:00) de la semaine contenant `d`. */
	function localMonday(d: Date): Date {
		const x = new Date(d);
		x.setHours(0, 0, 0, 0);
		const day = x.getDay();
		x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
		return x;
	}
	const DAY_MS = 86400000;
	const newestUnread = $derived(unreadReturned[0] ?? null);
	/**
	 * Mise en avant d'un retour non lu : visible jusqu'au mardi (fuseau local de
	 * la cliente) de la semaine suivant celle de la publication. Passé ce délai,
	 * la carte disparaît du haut de l'Accueil — le retour reste dans l'historique.
	 */
	const retourHighlight = $derived.by(() => {
		if (!newestUnread) return null;
		const pub = new Date(newestUnread.feedbackAt ?? newestUnread._creationTime);
		const expiry = localMonday(pub);
		expiry.setDate(expiry.getDate() + 9); // mercredi 00:00 → mardi soir = dernier jour d'affichage
		if (Date.now() >= expiry.getTime()) return null;
		return newestUnread;
	});
	/** Semaine en cours (lundi local) — pour étiqueter la carte. */
	const localWeek = $derived.by(() => {
		const m = localMonday(new Date());
		const end = new Date(m.getTime() + 6 * DAY_MS);
		const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
		return `${fmt(m)} → ${fmt(end)}`;
	});
	/**
	 * État de la carte :
	 *  - 'due'     : fenêtre du bilan ouverte (ven. 9h → dim. 12h) et semaine non soumise ;
	 *  - 'retour'  : retour coach publié et non lu (mise en avant active) ;
	 *  - 'awaiting': dernier bilan soumis, en attente du retour du coach.
	 */
	const bilanCard = $derived.by<null | 'due' | 'retour' | 'awaiting'>(() => {
		if (!dash) return null;
		if (dash.bilan.due) return 'due';
		if (retourHighlight) return 'retour';
		const awaiting = checkins.find((c) => c.status === 'nouveau');
		if (awaiting) {
			// Garde anti-staleness : seule la période en cours compte (≤ 2 semaines).
			const ageDays = (Date.now() - new Date(awaiting.weekStart + 'T12:00:00').getTime()) / DAY_MS;
			if (ageDays <= 14) return 'awaiting';
		}
		return null;
	});
	/** Info éphémère après première lecture (jamais permanente). */
	const justReadReturn = $derived.by(() => {
		const read = returned.filter((c) => {
			const at = c.feedbackReadAt ?? 0;
			return at >= (c.feedbackAt ?? c._creationTime);
		});
		const maxAt = read.reduce((m, c) => Math.max(m, c.feedbackReadAt ?? 0), 0);
		if (!maxAt) return false;
		return Date.now() - maxAt < 3 * 60 * 1000;
	});
	let hintDismissed = $state(false);

	const todayLabel = $derived(
		new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase())
	);
	/** Raccourcis horizontaux de l'Accueil (désengorgent le dashboard). */
	const chips = $derived([
		{ href: '/recettes', label: 'Recettes', icon: 'chefHat', badge: 0 },
		{ href: '/espace/ressources', label: 'Ressources', icon: 'bookOpen', badge: 0 },
		{ href: '/espace/historique', label: 'Bilans', icon: 'clipboardCheck', badge: dash?.badges.bilans ?? 0 },
		{ href: '/espace/messages', label: 'Messages', icon: 'messageCircle', badge: dash?.badges.message ?? 0 },
		{ href: '/outils', label: 'Outils', icon: 'wrench', badge: 0 },
	]);
	// Salutation contextuelle (heure locale de la cliente) — stable pour la journée.
	const greeting = $derived(getGreeting(user._id, user.prenom));

	/* ————— Suivi de cycle (même moteur/formule que l'outil historique « Cycle ») ————— */
	const cycleCfg = $derived<CycleConfig | null>((data.cycle ?? null) as CycleConfig | null);
	const cycle = $derived(cycleState(cycleCfg));
	/** Couleurs de la mini-jauge (phases de la formule d'origine). */
	const PHASE_GAUGE_COLORS: Record<string, string> = {
		menses: '#eeb2c4',
		follicular: '#7ce0a5',
		ovulation: '#f2c94c',
		'luteal-early': '#b7c6f0',
		'luteal-late': '#93aee0',
	};
	let cycleOpen = $state(false);
	let cContra = $state<CycleContra>('none');
	let cNoDate = $state(false);
	let cLmp = $state('');
	let cLen = $state('28');
	let cErr = $state('');
	let cSaving = $state(false);
	function openCycleEditor() {
		const cur = cycleCfg;
		cContra = cur?.contra ?? 'none';
		cNoDate = cur ? cur.noDate : false;
		cLmp = cur?.lmp ?? '';
		cLen = String(cur?.len ?? 28);
		cErr = '';
		cycleOpen = !cycleOpen;
	}
	/** Carte Cycle : questionnaire SEULEMENT si rien n'est configuré ;
	 *  sinon → vraie page « Mon cycle » (jamais de re-questionnaire automatique). */
	function onCycleCardClick() {
		if (cycle.kind === 'empty') openCycleEditor();
		else void goto('/espace/cycle');
	}
	function pickContra(v: CycleContra) {
		cContra = v;
		if (v === 'hormonal') cNoDate = false;
	}
	async function saveCycleInfo() {
		if (cContra !== 'hormonal' && !cNoDate && !cLmp) {
			cErr = 'Indique le premier jour de tes dernières règles.';
			return;
		}
		cSaving = true;
		cErr = '';
		try {
			const res = await fetch('/api/cycle', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contra: cContra,
					noDate: cContra === 'hormonal' ? false : cNoDate,
					lmp: cContra !== 'hormonal' && !cNoDate ? cLmp : undefined,
					len: cContra !== 'hormonal' && !cNoDate ? parseInt(cLen, 10) : undefined,
				}),
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || body.error) throw new Error(body.error || "Impossible d'enregistrer.");
			cycleOpen = false;
			await invalidateAll();
		} catch (e) {
			cErr = e instanceof Error ? e.message : "Impossible d'enregistrer.";
		} finally {
			cSaving = false;
		}
	}

	/* ————— Actions à faire (priorité : fort puis normal) ————— */
	type Action = { id: string; strong: boolean; title: string; desc: string; href: string; cta: string };
	const actions = $derived.by<Action[]>(() => {
		if (!dash) return [];
		const list: Action[] = [];
		// Le bilan hebdomadaire et les nouveaux retours ont leur propre carte en
		// haut de l'Accueil (cycle : à faire → complété → retour coach) — on ne
		// les duplique pas ici.
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
	const fmtShortDate = (iso: string | null) =>
		iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
	/* Pesées de la semaine (lundi → dimanche, calcul G-FLUX serveur) — l'objectif
	   est 3 : au-delà on affiche toujours « 3/3 » (objectif atteint, pas de score). */
	const peseesCount = $derived(Math.min(dash?.progression.weighinsThisWeek ?? 0, 3));
	const peseesDone = $derived(peseesCount >= 3);
	const peseesLabel = $derived(dash ? `${peseesCount} / 3${peseesDone ? ' ✓' : ''}` : '');

	/* ————— Pas du jour (la carte ouvre la vue statistiques « Mes pas ») ————— */
	const todaySteps = $derived(dash?.steps.today ?? null);
	const stepGoal = $derived(dash?.steps.goal ?? null);

	/* ————— Mini-graphiques : pas (semaine courante) & poids (dernières pesées) ————— */
	const stepsWeekPts = $derived((dash?.steps.week ?? []).map((s) => ({ date: s.date, value: s.count })));
	const weightTrendPts = $derived(
		(dash?.progression.weightTrend ?? []).map((m) => ({ date: m.date, value: m.weightKg }))
	);
	// Tendance du poids : delta entre la première et la dernière pesée de la fenêtre.
	const weightDelta = $derived.by(() => {
		const w = dash?.progression.weightTrend ?? [];
		if (w.length < 2) return null;
		return w[w.length - 1].weightKg - w[0].weightKg;
	});
	function weightDeltaLabel(delta: number): string {
		const abs = Math.abs(delta).toFixed(1).replace('.', ',');
		if (delta < -0.05) return `↓ ${abs} kg`;
		if (delta > 0.05) return `↑ ${abs} kg`;
		return '→ stable';
	}

	/* ————— Récap hebdo (samedi + dimanche de la semaine courante) ————— */
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

	/* ————— État calorique de la carte Accueil (même moteur que le Journal :
	   filet de sécurité = maintenance > objectif). « Respecté » = bande 80–100 %
	   de l'objectif : une sous-alimentation importante n'est jamais validée. ————— */
	const kcalState = $derived.by(() => {
		if (!dash) return 'neutral';
		const kcal = dash.tracking.kcal;
		const goal = dash.tracking.kcalGoal;
		if (maintenanceKcal && kcal > maintenanceKcal) return 'over-maintenance';
		if (kcal > goal) return maintenanceKcal ? 'filet' : 'over';
		if (goal > 0 && kcal >= goal * 0.8) return 'aligned';
		return 'neutral';
	});
	const kcalBarClass = $derived(
		kcalState === 'over-maintenance'
			? 'bg-danger'
			: kcalState === 'filet' || kcalState === 'over'
				? 'bg-warn'
				: kcalState === 'aligned'
					? 'bg-brand'
					: 'bg-mist/60'
	);
	const kcalStatusClass = $derived(
		kcalState === 'over-maintenance'
			? 'text-danger'
			: kcalState === 'filet' || kcalState === 'over'
				? 'text-warn'
				: kcalState === 'aligned'
					? 'text-brand-dark'
					: 'text-mist'
	);
	const kcalStatusText = $derived.by(() => {
		if (!dash) return '';
		const kcal = dash.tracking.kcal;
		const goal = dash.tracking.kcalGoal;
		if (kcalState === 'over-maintenance') return `Maintenance dépassée · Objectif ${fmt(goal)}`;
		if (kcalState === 'filet') return `Dans ton filet de sécurité · Objectif ${fmt(goal)}`;
		if (kcalState === 'over') return `Objectif dépassé de ${fmt(kcal - goal)} · Objectif ${fmt(goal)}`;
		if (kcalState === 'aligned') return `Objectif ${fmt(goal)} respecté`;
		return `Il te reste ${fmt(Math.max(0, goal - kcal))} · Objectif ${fmt(goal)}`;
	});

	/* Pas du jour : objectif atteint = validation verte discrète (texte secondaire). */
	const stepsReached = $derived(stepGoal !== null && todaySteps !== null && todaySteps >= stepGoal);
</script>

<svelte:head><title>Accueil — G-Flux</title></svelte:head>

<!-- ═══════════ En-tête ═══════════ -->
<header class="mb-5 mt-1">
	<h1 class="font-display text-[30px] font-semibold leading-tight tracking-tight text-ink sm:text-3xl">{greeting.title}</h1>
	<p class="mt-1 text-sm text-mist">{greeting.dayLine ?? `${todayLabel} — voici où tu en es.`}</p>
</header>

<!-- ═══════════ Raccourcis horizontaux (désengorgent l'Accueil) ═══════════ -->
<nav class="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:px-0" aria-label="Raccourcis">
	{#each chips as chip (chip.href)}
		<a
			href={chip.href}
			class="group flex shrink-0 items-center gap-2 rounded-full border border-line bg-card py-1.5 pl-1.5 pr-4 text-sm font-bold text-ink shadow-sm transition hover:border-brand/60 hover:shadow"
		>
			<span class="grid h-8 w-8 place-items-center rounded-full bg-brand-light text-brand transition group-hover:bg-brand group-hover:text-white">
				<Icon name={chip.icon} size={16} class="shrink-0" />
			</span>
			{chip.label}
			{#if chip.badge > 0}
				<span class="grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white">{chip.badge}</span>
			{/if}
		</a>
	{/each}
</nav>

<!-- ═══════════ Actions prioritaires conditionnelles ═══════════ -->
{#if bilanCard || (dash?.onboarding && !dash.onboarding.done) || (dash?.coachMessage && !dash.coachMessage.read)}
	<section class="space-y-3">
		<!-- Carte bilan hebdomadaire (cycle : à faire → complété → retour coach) -->
		{#if bilanCard}
			<div
				class="overflow-hidden rounded-3xl border px-5 py-4 shadow-sm
					{bilanCard === 'due'
						? 'border-brand/50 bg-gradient-to-br from-brand-light via-brand-light/50 to-white'
						: bilanCard === 'retour'
							? 'border-brand bg-brand-light ring-1 ring-brand/30'
							: 'border-line bg-card'}"
			>
				{#if bilanCard === 'due'}
					<p class="text-[11px] font-bold uppercase tracking-widest text-brand-dark">Bilan de la semaine</p>
					<div class="mt-2 flex items-center gap-2">
						<span class="h-5 w-5 shrink-0 rounded-full border-2 border-brand/60"></span>
						<p class="font-display text-lg font-semibold text-ink">Complète ton bilan hebdomadaire</p>
					</div>
					<p class="mt-1 text-sm text-mist">À compléter avant dimanche 12h · semaine du {localWeek}</p>
					<a href="/bilan" class="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark">Faire mon bilan <span>→</span></a>
				{:else if bilanCard === 'retour'}
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-[11px] font-bold uppercase tracking-widest text-brand-dark">Nouveau retour de ton coach</p>
						{#if unreadReturned.length > 0}
							<span class="grid h-6 min-w-6 place-items-center rounded-full bg-warn px-1.5 text-xs font-bold text-white">{unreadReturned.length}</span>
						{/if}
					</div>
					<p class="mt-1 font-display text-lg font-semibold text-ink">Ton retour est disponible.</p>
					{#if retourHighlight?.weekLabel}
						<p class="mt-0.5 text-sm text-mist">{retourHighlight.weekLabel}</p>
					{/if}
					<a href="/espace/historique" class="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand">Voir mon retour <span>→</span></a>
				{:else}
					<div class="flex items-center gap-2">
						<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white"><Icon name="check" size={14} strokeWidth={2.5} /></span>
						<p class="font-display text-lg font-semibold text-ink">Bilan complété</p>
					</div>
					<p class="mt-1 text-sm text-mist">Ton bilan est bien envoyé. Ton coach prépare ton retour.</p>
					<a href="/espace/historique" class="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-dark">Voir mon bilan envoyé <span>→</span></a>
				{/if}
			</div>
		{/if}

		<!-- Message du coach NON LU : prioritaire. Une fois « Vu », il quitte l'Accueil
		     et reste consultable dans la section Messages. -->
		{#if dash?.coachMessage && !dash.coachMessage.read}
			{@const msg = dash.coachMessage}
			<div class="rounded-3xl border border-brand bg-brand-light px-5 py-4 ring-1 ring-brand/30">
				<div class="flex items-start justify-between gap-2">
					<p class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-brand-dark">
						Message de ton coach
						<span class="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Nouveau</span>
					</p>
					<button
						type="button"
						onclick={markMsgRead}
						disabled={msgReadBusy}
						class="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-brand/30 bg-white px-3 py-1 text-xs font-bold text-brand-dark transition hover:border-brand disabled:opacity-60"
					>
						<Icon name="check" size={14} class="shrink-0" /> Vu
					</button>
				</div>
				{#if msg.text}
					<p class="mt-1.5 text-[15px] leading-relaxed text-ink">{msg.text}</p>
				{/if}
				{#if msg.audio}
					{@const a = msg.audio}
					<div class="mt-2 rounded-xl bg-white/80 p-3">
						<p class="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-dark"><Icon name="mic" size={13} /> Message audio · {fmtMs(a.durationMs)}</p>
						<AudioPlayer src={a.url} durationMs={a.durationMs} onFirstPlay={() => listen(a.mediaId)} />
					</div>
				{/if}
				<p class="mt-2 text-[11px] text-mist">Une fois lu, ce message reste dans <a href="/espace/messages" class="font-semibold text-brand-dark">Messages</a>.</p>
			</div>
		{/if}

		<!-- Onboarding de démarrage (si activé par le coach et non terminé) -->
		{#if dash?.onboarding && !dash.onboarding.done}
			{@const ob = dash.onboarding}
			<div class="rounded-3xl border border-brand/40 bg-gradient-to-br from-brand-light via-brand-light/50 to-white p-5 shadow-sm">
				<h2 class="font-display text-lg font-semibold text-ink">Bienvenue dans G-FLUX</h2>
				<p class="mt-1 text-sm leading-relaxed text-mist">
					Avant de commencer, complète ces deux étapes pour que ton coach puisse préparer ton accompagnement.
				</p>

				<div class="mt-4 space-y-3">
					<div class="rounded-2xl border-2 border-line bg-white p-4 transition {ob.formDone ? 'border-brand/50' : ''}">
						<div class="flex items-center gap-3">
							<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full {ob.formDone ? 'bg-brand text-white' : 'border-2 border-mist/50 text-mist'}">
								{#if ob.formDone}<Icon name="check" size={15} strokeWidth={2.5} />{:else}<span class="text-xs font-bold">1</span>{/if}
							</span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-bold text-ink">Formulaire de démarrage</p>
								<p class="text-xs text-mist">{ob.formDone ? 'Reçu par ton coach' : 'Ton profil, tes habitudes, ton historique…'}</p>
							</div>
							{#if !ob.formDone}
								<a href="/espace/demarrage" class="shrink-0 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-dark">Commencer →</a>
							{/if}
						</div>
						{#if ob.formDone}
							<a href="/espace/demarrage" class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-brand/50 bg-white px-4 py-2.5 text-sm font-bold text-brand-dark transition hover:bg-brand-light">
								<Icon name="eye" size={16} /> Voir le formulaire envoyé
							</a>
						{/if}
					</div>

					<div class="rounded-2xl border-2 border-line bg-white p-4 transition {ob.step2.done ? 'border-brand/50' : ''}">
						<div class="flex items-center gap-3">
							<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full {ob.step2.done ? 'bg-brand text-white' : 'border-2 border-mist/50 text-mist'}">
								{#if ob.step2.done}<Icon name="check" size={15} strokeWidth={2.5} />{:else}<span class="text-xs font-bold">2</span>{/if}
							</span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-bold text-ink">Mensurations & photos</p>
								<p class="text-xs text-mist">
									{#if ob.step2.done}
										C'est fait — tes données de départ sont enregistrées.
									{:else}
										Tes données de départ pour suivre ta progression.
										{#if ob.step2.measurements}
											<span class="inline-flex items-center gap-1 font-semibold text-brand-dark"><Icon name="check" size={12} /> Mensurations</span> — photos encore à ajouter.
										{:else if ob.step2.photos}
											<span class="inline-flex items-center gap-1 font-semibold text-brand-dark"><Icon name="check" size={12} /> Photos</span> — mensurations encore à ajouter.
										{:else}
											Mensurations et photos à ajouter.
										{/if}
									{/if}
								</p>
							</div>
						</div>
						{#if !ob.step2.done}
							<div class="mt-3 flex flex-wrap gap-2">
								{#if !ob.step2.measurements}
									<a href="/espace/progression?action=mensurations" class="inline-flex items-center gap-1.5 rounded-xl border-2 border-brand/50 bg-brand-light px-3.5 py-2 text-xs font-bold text-brand-dark transition hover:bg-brand/20">
										<Icon name="ruler" size={14} /> Ajouter mes mensurations
									</a>
								{/if}
								{#if !ob.step2.photos}
									<a href="/espace/photos" class="inline-flex items-center gap-1.5 rounded-xl border-2 border-brand/50 bg-brand-light px-3.5 py-2 text-xs font-bold text-brand-dark transition hover:bg-brand/20">
										<Icon name="camera" size={14} /> Ajouter mes photos
									</a>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</section>
{/if}

<!-- ═══════════ À faire (uniquement s'il y a des actions) ═══════════ -->
{#if actions.length > 0}
	<section class="mt-4 space-y-3">
		<h2 class="px-1 text-[11px] font-bold uppercase tracking-widest text-mist">À faire</h2>
		{#each actions as action (action.id)}
			<a href={action.href} class="block rounded-3xl border px-5 py-4 transition hover:border-brand {action.strong ? 'border-brand bg-brand-light' : 'border-line bg-card shadow-sm'}">
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

<!-- ═══════════ KPI compacts « Aujourd'hui » (2 par ligne) ═══════════ -->
{#if dash}
	<section aria-label="Aujourd'hui">
		<div class="flex items-center justify-between px-1">
			<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Aujourd'hui</h2>
			<span class="text-[11px] text-mist">{todayLabel}</span>
		</div>

		<div class="mt-2 grid grid-cols-2 gap-3">
			<!-- PAS → vue statistiques « Mes pas » (7 derniers jours) -->
			<a
				href="/espace/pas"
				class="group rounded-3xl border border-line bg-card p-4 text-left shadow-sm transition hover:border-brand/50 active:scale-[0.99]"
			>
				<div class="flex items-center justify-between gap-1">
					<span class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mist"><Icon name="footprints" size={14} class="shrink-0 text-brand" /> Pas</span>
					<Icon name="chevronRight" size={15} class="shrink-0 text-mist transition group-hover:translate-x-0.5 group-hover:text-brand" />
				</div>
				<p class="mt-2 font-display text-3xl font-bold leading-none tracking-tight text-ink tabular-nums">
					{todaySteps !== null ? fmt(todaySteps) : '—'}
				</p>
				<p class="mt-1.5 flex items-center gap-1 text-xs font-semibold {stepsReached ? 'text-brand-dark' : 'text-mist'}">
					{#if stepsReached}
						<Icon name="circleCheck" size={13} class="shrink-0" />
						Objectif {fmt(stepGoal ?? 0)} atteint
					{:else if todaySteps !== null && stepGoal !== null}
						{fmt(todaySteps)} / {fmt(stepGoal)} pas
					{:else}
						Voir mes statistiques de pas
					{/if}
				</p>
			</a>

			<!-- CALORIES -->
			<a
				href="/espace/journal"
				class="group rounded-3xl border border-line bg-card p-4 shadow-sm transition hover:border-brand/50"
			>
				<div class="flex items-center justify-between gap-1">
					<span class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mist"><Icon name="flame" size={14} class="shrink-0 text-brand" /> Calories</span>
					<Icon name="chevronRight" size={15} class="shrink-0 text-mist transition group-hover:translate-x-0.5 group-hover:text-brand" />
				</div>
				<p class="mt-2 font-display text-3xl font-bold leading-none tracking-tight text-ink tabular-nums">
					{fmt(dash.tracking.kcal)} <span class="text-sm font-semibold text-mist">kcal</span>
				</p>
				<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line/70">
					<div class="h-full rounded-full transition-all duration-500 {kcalBarClass}" style="width: {kcalPct}%"></div>
				</div>
				<p class="mt-1.5 flex items-center gap-1 text-xs font-semibold {kcalStatusClass}">
					{#if kcalState === 'aligned'}
						<Icon name="circleCheck" size={13} class="shrink-0" />
					{/if}
					<span class="min-w-0 truncate">{kcalStatusText}</span>
				</p>
			</a>

			<!-- POIDS -->
			<a
				href="/espace/progression"
				class="group rounded-3xl border border-line bg-card p-4 shadow-sm transition hover:border-brand/50"
			>
				<div class="flex items-center justify-between gap-1">
					<span class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mist"><Icon name="scale" size={14} class="shrink-0 text-brand" /> Poids</span>
					<Icon name="chevronRight" size={15} class="shrink-0 text-mist transition group-hover:translate-x-0.5 group-hover:text-brand" />
				</div>
				<p class="mt-2 font-display text-3xl font-bold leading-none tracking-tight text-ink tabular-nums">
					{dash.progression.lastWeightKg !== null ? fmtWeight(dash.progression.lastWeightKg) : '—'}
				</p>
				<div class="mt-1.5 flex items-center justify-between gap-2">
					<p class="min-w-0 truncate text-xs text-mist">
						{#if weightDelta !== null}<span class="font-semibold {weightDelta <= 0.05 ? 'text-brand-dark' : 'text-mist'}">{weightDeltaLabel(weightDelta)}</span>{:else}Ta progression ici{/if}
					</p>
					{#if peseesDone}
						<span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold text-brand-dark">
							<Icon name="circleCheck" size={12} class="shrink-0" /> Pesées 3/3
						</span>
					{:else}
						<span class="shrink-0 text-[11px] font-semibold tabular-nums text-mist">Pesées {peseesCount}/3</span>
					{/if}
				</div>
			</a>

			<!-- CYCLE -->
			<button
				type="button"
				onclick={onCycleCardClick}
				class="group rounded-3xl border border-line bg-card p-4 text-left shadow-sm transition hover:border-brand/50 active:scale-[0.99]"
			>
				<div class="flex items-center justify-between gap-1">
					<span class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mist"><Icon name="flower2" size={14} class="shrink-0 text-brand" /> Cycle</span>
					<Icon name="chevronRight" size={15} class="shrink-0 text-mist transition group-hover:translate-x-0.5 group-hover:text-brand" />
				</div>
				{#if cycle.kind === 'empty'}
					<p class="mt-2 font-display text-xl font-bold leading-none tracking-tight text-ink">À configurer</p>
					<p class="mt-1.5 text-xs text-brand-dark">Touche pour renseigner ton cycle</p>
				{:else if cycle.kind === 'hormonal'}
					<p class="mt-2 font-display text-xl font-bold leading-none tracking-tight text-ink">Non concernée</p>
					<p class="mt-1.5 text-xs text-mist">Suivi adapté à ta contraception</p>
				{:else if cycle.kind === 'nodate'}
					<p class="mt-2 font-display text-xl font-bold leading-none tracking-tight text-ink">Règles irrégulières</p>
					<p class="mt-1.5 text-xs text-mist">Aucune estimation affichée</p>
				{:else}
					<p class="mt-2 font-display text-xl font-bold leading-none tracking-tight text-ink">{cycle.label}</p>
					<p class="mt-1.5 text-xs text-mist">Jour {cycle.cycleDay} / {cycle.cycleLength}</p>
				{/if}
			</button>
		</div>

		<!-- Éditeur contextuel cycle (la saisie des pas vit dans « Mes pas ») -->
		{#if cycleOpen}
			<div class="mt-3 rounded-3xl border border-line bg-card p-4 shadow-sm">
				<p class="text-sm font-bold text-ink">Es-tu sous contraception hormonale ?</p>
				<div class="mt-2 flex flex-col gap-1.5">
					<button type="button" onclick={() => pickContra('none')} class="rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition {cContra === 'none' ? 'border-brand bg-white text-ink' : 'border-line bg-white/50 text-mist hover:border-brand/60'}">Non, ou stérilet en cuivre</button>
					<button type="button" onclick={() => pickContra('iud-hormonal')} class="rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition {cContra === 'iud-hormonal' ? 'border-brand bg-white text-ink' : 'border-line bg-white/50 text-mist hover:border-brand/60'}">Stérilet hormonal (Mirena, Kyleena…)</button>
					<button type="button" onclick={() => pickContra('hormonal')} class="rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition {cContra === 'hormonal' ? 'border-brand bg-white text-ink' : 'border-line bg-white/50 text-mist hover:border-brand/60'}">Pilule, patch, anneau, implant ou injection</button>
				</div>
				{#if cContra === 'hormonal'}
					<div class="mt-3 flex items-start gap-2 rounded-xl border border-line bg-soft px-3 py-2.5">
						<Icon name="droplet" size={14} class="mt-0.5 shrink-0 text-mist" />
						<p class="text-xs leading-relaxed text-mist">{CYCLE_NO_ESTIMATE_MSGS.hormonal}</p>
					</div>
				{:else}
					<label class="mt-3 flex cursor-pointer items-start gap-2 text-sm text-ink">
						<input type="checkbox" bind:checked={cNoDate} class="mt-0.5 accent-brand" />
						<span>Je n'ai plus de règles régulières</span>
					</label>
					{#if !cNoDate}
						<div class="mt-3 grid gap-3 sm:grid-cols-2">
							<div>
								<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="c-lmp">Premier jour des dernières règles</label>
								<input id="c-lmp" type="date" bind:value={cLmp} class="w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand" />
							</div>
							<div>
								<label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist" for="c-len">Durée moyenne</label>
								<select id="c-len" bind:value={cLen} class="w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand">
									{#each CYCLE_LENGTH_OPTIONS as n}
										<option value={n}>{n} jours</option>
									{/each}
								</select>
							</div>
						</div>
						<p class="mt-2 text-[11px] leading-snug text-mist">Indique une moyenne plutôt que ton tout dernier cycle : il est normal que la durée varie de quelques jours d'un mois à l'autre.</p>
					{:else}
						<p class="mt-2 text-[11px] leading-snug text-mist">Sans date fiable, aucune estimation de phase ne sera affichée — pas de fausse précision.</p>
					{/if}
				{/if}
				{#if cErr}
					<p class="mt-2 text-xs font-semibold text-danger">{cErr}</p>
				{/if}
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<button type="button" onclick={saveCycleInfo} disabled={cSaving} class="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60 sm:flex-none sm:px-5">{cSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
					<button type="button" onclick={() => (cycleOpen = false)} class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-semibold text-mist transition hover:text-ink">Annuler</button>
				</div>
			</div>
		{/if}
	</section>
{/if}

<!-- ═══════════ Ma progression ═══════════ -->
<a href="/espace/progression" class="group mt-4 block rounded-3xl border border-line bg-card p-5 shadow-sm transition hover:border-brand">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Ma progression</h2>
		<Icon name="trendingUp" size={20} class="text-brand" />
	</div>
	<div class="mt-2 flex items-center justify-between gap-3">
		<div class="min-w-0">
			<p class="font-display text-4xl font-bold leading-none tracking-tight text-ink">{dash ? fmtWeight(dash.progression.lastWeightKg) : '—'}</p>
			{#if weightDelta !== null}
				<p class="mt-1.5 text-xs font-semibold {weightDelta <= 0.05 ? 'text-brand-dark' : 'text-mist'}">{weightDeltaLabel(weightDelta)} · dernière pesée {fmtShortDate(dash?.progression.lastWeightDate ?? null)}</p>
			{:else}
				<p class="mt-1.5 text-xs text-mist">Pesées cette semaine : <strong class="font-bold text-ink">{peseesLabel}</strong></p>
			{/if}
		</div>
		{#if weightTrendPts.length >= 2}
			<div class="shrink-0"><Sparkline points={weightTrendPts} color="#1db954" width={150} height={48} /></div>
		{:else if weightTrendPts.length === 1}
			<div class="shrink-0"><p class="rounded-xl border border-dashed border-line px-3 py-3 text-center text-[11px] leading-snug text-mist">Tendance bientôt<br />disponible</p></div>
		{/if}
	</div>
	<p class="mt-3 flex items-center justify-between rounded-xl border-2 border-line px-4 py-2.5 text-sm font-bold text-ink transition group-hover:border-brand">
		<span>Voir ma progression</span>
		<span>→</span>
	</p>
</a>

<!-- ═══════════ Récap hebdo (samedi + dimanche uniquement) ═══════════ -->
{#if recap}
	<section class="recap-card mt-4 rounded-3xl border border-brand/30 bg-brand-light p-5 shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-[11px] font-bold uppercase tracking-widest text-brand-dark">Ta semaine en un coup d'œil</h2>
			<span class="text-[11px] text-mist">{recapRangeLabel()}</span>
		</div>
		<div class="mt-4 space-y-4">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><Icon name="flame" size={12} class="shrink-0" /> Calories moyennes</p>
					<p class="mt-0.5 font-display text-2xl font-semibold text-ink">{recap.calories.avg !== null ? `${fmt(recap.calories.avg)} kcal` : '—'}<span class="text-xs font-semibold text-mist"> / jour</span></p>
					<p class="text-[11px] text-mist">Objectif : {fmt(recap.calories.goal)} · {recap.calories.trackedDays} / 7 jours suivis</p>
				</div>
				<div>
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><Icon name="footprints" size={12} class="shrink-0" /> Pas moyens</p>
					<p class="mt-0.5 font-display text-2xl font-semibold text-ink">{recap.steps.avg !== null ? fmt(recap.steps.avg) : '—'}<span class="text-xs font-semibold text-mist"> / jour</span></p>
					<p class="text-[11px] text-mist">{recap.steps.goal !== null ? `Objectif : ${fmt(recap.steps.goal)} · ` : ''}{recap.steps.trackedDays} / 7 jours renseignés</p>
				</div>
			</div>
			<div class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink">
				<span class="inline-flex items-center gap-1"><Icon name="scale" size={14} class="shrink-0" /> Pesées : <strong>{Math.min(recap.weighins.count, recap.weighins.goal)} / {recap.weighins.goal}</strong>{recap.weighins.count >= recap.weighins.goal ? ' ✓' : ''}</span>
				<span class="inline-flex items-center gap-1"><Icon name="clipboardList" size={14} class="shrink-0" /> Bilan : <strong>{recap.bilan.sent ? 'Envoyé ✓' : 'Non envoyé'}</strong></span>
			</div>
		</div>
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