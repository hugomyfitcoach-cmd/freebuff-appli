<script lang="ts">
	/**
	 * Espace cliente — ENTRAÎNEMENT.
	 * Ouverte depuis le raccourci « Entraînement » de l'Accueil.
	 * Semaine simple (L M M J V S D, point sous les jours à séance), séance
	 * sélectionnée, prochaine séance identifiable. État vide propre si aucun
	 * programme. La vue séance (libre/guidé) vit dans SessionRunner.svelte.
	 * Déplacer / dupliquer une séance : côté coach (Vue 360) en V1.
	 */
	import { onMount, tick } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from '$lib/sheetMotion';
	import Icon from '$lib/components/Icon.svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import SessionRunner from '$lib/components/SessionRunner.svelte';

	type DaySession = {
		_id: string;
		date: string;
		status: 'planned' | 'completed' | 'cancelled';
		/** Commencée (bouton « Commencer la séance ») mais pas finalisée. */
		startedAt: number | null;
		/** Clôturée sans réalisation (« Je n'ai pas réalisé cette séance »). */
		skippedAt: number | null;
		name: string;
	};
	type NextSession = { _id: string; date: string; name: string } | null;

	let loading = $state(true);
	let err = $state('');
	let weekStart = $state('');
	let today = $state('');
	let days = $state<DaySession[]>([]);
	let nextSession = $state<NextSession>(null);
	/** Jour sélectionné dans la semaine ("yyyy-mm-dd") — ses séances, ou Repos. */
	let selectedDay = $state('');

	/** Détail d'affichage par occurrence (programme, durée estimée, exercices). */
	type DayDetail = {
		programName: string | null;
		estimatedMin: number;
		exercises: { name: string }[];
	};
	let dayDetail = $state<Record<string, DayDetail>>({});

	/** Vue séance ouverte (session runner plein écran). */
	let openScheduledId = $state<string | null>(null);
	let openSessionId = $state('');
	let history = $state<
		{ _id: string; date: string; name: string; durationMin: number | null; setsDone: number; volumeKg: number | null; difficulty: number | null; note: string | null }[]
	>([]);

	/** Jours L M M J V S D (lundi = 0). */
	const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

	function isoOf(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	}
	function mondayOf(d: Date): string {
		const x = new Date(d);
		x.setHours(0, 0, 0, 0);
		const day = x.getDay();
		x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
		return isoOf(x);
	}
	function addDays(iso: string, n: number): string {
		const d = new Date(iso + 'T12:00:00');
		d.setDate(d.getDate() + n);
		return isoOf(d);
	}
	function dateNum(iso: string): number {
		return Number(iso.slice(8, 10));
	}
	function prettyDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
		});
	}
	function dayOffset(iso: string): number {
		return Math.round((new Date(iso + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000);
	}
	function nextLabel(iso: string): string {
		const off = dayOffset(iso);
		if (off === 0) return "Aujourd'hui";
		if (off === 1) return 'Demain';
		return prettyDate(iso);
	}

	function sessionsOn(iso: string): DaySession[] {
		return days.filter((d) => d.date === iso);
	}
	function shortDay(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
	}
	function statusLabel(s: DaySession): string {
		if (s.status === 'completed') return s.skippedAt != null ? 'Non réalisée' : 'Faite';
		if (s.startedAt != null) return 'En cours';
		return 'Prévue';
	}
	function statusPill(s: DaySession): string {
		if (s.status === 'completed') return s.skippedAt != null ? 'bg-line text-mist' : 'bg-brand text-white';
		return 'bg-soft text-ink';
	}
	const weekLabel = $derived(weekStart ? `${shortDay(weekStart)} – ${shortDay(addDays(weekStart, 6))}` : '');
	const weekDoneCount = $derived(days.filter((d) => d.status === 'completed').length);
	/** Nom du programme pour la ligne d'en-tête (détail d'une séance du jour). */
	const headerProgram = $derived(
		sessionsOn(selectedDay)
			.map((s) => dayDetail[s._id]?.programName)
			.find((p): p is string => !!p) ?? null
	);
	/** Séances réalisées de la semaine affichée (cartes compactes). */
	const weekCompleted = $derived(
		weekStart ? history.filter((h) => h.date >= weekStart && h.date <= addDays(weekStart, 6)) : []
	);

	async function loadWeek(ws?: string) {
		const target = ws ?? mondayOf(new Date());
		const r = await fetch(`/api/training${target ? `?weekStart=${target}` : ''}`).then((x) => x.json());
		if (r.error) throw new Error(r.error);
		weekStart = r.weekStart as string;
		today = r.today as string;
		days = (r.days ?? []).map((d: Record<string, unknown>) => ({
			...(d as unknown as DaySession),
			startedAt: (d.startedAt as number | null) ?? null,
			skippedAt: (d.skippedAt as number | null) ?? null,
		}));
		nextSession = (r.nextSession ?? null) as NextSession;
		// Sélection par défaut : AUJOURD'HUI (ou le lundi de la semaine affichée
		// si aujourd'hui n'y est pas). Cliquer un jour affiche SES séances.
		selectedDay = today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart;
		for (const s of sessionsOn(selectedDay)) void loadDayDetail(s);
	}

	async function shiftWeek(delta: number) {
		await loadWeek(addDays(weekStart, delta * 7));
	}

	/** Charge l'affichage d'une occurrence via la route existante (lecture seule). */
	async function loadDayDetail(s: DaySession) {
		if (dayDetail[s._id]) return;
		try {
			const r = await fetch(`/api/training/session/${s._id}`).then((x) => x.json());
			if (r.error) return;
			dayDetail[s._id] = {
				programName: (r.programName as string | null) ?? null,
				estimatedMin: Number(r.estimatedMin ?? 0),
				exercises: (r.exercises ?? []).map((e: { exercise?: { name?: string } | null; name?: string }) => ({
					name: e.exercise?.name ?? e.name ?? 'Exercice',
				})),
			};
		} catch {
			/* affichage seulement : en cas d'échec, la carte reste sans détail */
		}
	}
	function pickDay(iso: string) {
		selectedDay = iso;
		for (const s of sessionsOn(iso)) void loadDayDetail(s);
	}

	async function loadSessions() {
		const r = await fetch('/api/training/history?sessions=1').then((x) => x.json()).catch(() => ({ sessions: [] }));
		history = (r.sessions ?? []) as typeof history;
	}

	function onFinished() {
		openScheduledId = null;
		void loadWeek(weekStart);
		void loadSessions();
	}

	onMount(async () => {
		try {
			await loadWeek();
			await loadSessions();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Chargement impossible.';
		} finally {
			loading = false;
		}
	});

	let runnerKey = $state(0);
	function openSession(s: DaySession) {
		openScheduledId = s._id;
		openSessionId = s._id;
		runnerKey += 1;
	}

	/** Séance à finaliser : commencée, jamais finalisée, à jour ou passée. */
	const toFinalize = $derived(
		days.find((d) => d.status === 'planned' && d.startedAt != null && d.date <= today) ?? null
	);

	/* ── Menu ••• d'une séance programmée (déplacer / dupliquer / supprimer) ──
	   Menu flottant compact ancré sous le bouton, aligné sur son bord droit.
	   Affichage seul : les actions ci-dessous sont inchangées. */
	let menuFor = $state<string | null>(null);
	/** Coin d'ancrage calculé sur le bouton ••• (px viewport). */
	let menuAnchor = $state<{ top: number; right: number; above: boolean } | null>(null);
	/** Première action du menu — focus posé à l'ouverture. */
	let firstMenuAction = $state<HTMLButtonElement | undefined>(undefined);
	const MENU_WIDTH = 220;
	/** 3 lignes de 44 px + les deux séparateurs fins. */
	const MENU_HEIGHT = 3 * 44 + 2;
	/** Hauteur réservée à la barre de navigation (capsule 5,25 rem + marge). */
	const NAV_RESERVED = 84 + 12;

	function closeMenu() {
		menuFor = null;
		menuAnchor = null;
	}

	/* Animation du menu : fondu + agrandissement 0,92 → 1 depuis le coin du
	   bouton (160 ms, courbe douce), fermeture en fondu 120 ms. Sous
	   prefers-reduced-motion : fondu seul, sans agrandissement. */
	function menuMotion(_node: Element, reduced: boolean) {
		// Svelte passe { direction } à la fermeture/ouverture ; le défaut garde
		// la signature compatible avec le typage des transitions (0 argument).
		return ({ direction }: { direction: 'in' | 'out' } = { direction: 'in' }) => ({
			duration: reduced ? 120 : direction === 'in' ? 160 : 120,
			easing: cubicOut,
			css: (t: number) =>
				reduced || direction === 'out'
					? `opacity: ${t};`
					: `opacity: ${t}; transform: scale(${(0.92 + 0.08 * t).toFixed(3)});`,
		});
	}
	let sheetFor = $state<DaySession | null>(null);
	let sheetMode = $state<'move' | 'duplicate'>('move');
	let sheetDate = $state('');
	let sheetBusy = $state(false);
	let calendarTarget = $state<DaySession | null>(null);

	function openMenuFor(s: DaySession, ev: MouseEvent) {
		ev.stopPropagation();
		if (menuFor === s._id) {
			closeMenu();
			return;
		}
		const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
		const spaceBelow = window.innerHeight - NAV_RESERVED - rect.bottom;
		// Place insuffisante en bas → le menu s'ouvre AU-DESSUS du bouton.
		const above = spaceBelow < MENU_HEIGHT + 16 && rect.top > MENU_HEIGHT + 24;
		const rawTop = above ? rect.top - MENU_HEIGHT - 6 : rect.bottom + 6;
		menuAnchor = {
			// Jamais hors écran, jamais au-dessus de la barre de navigation.
			top: Math.max(8, Math.min(rawTop, window.innerHeight - NAV_RESERVED - MENU_HEIGHT)),
			// Aligné sur le bord droit du bouton •••.
			right: Math.max(8, window.innerWidth - rect.right),
			above,
		};
		menuFor = s._id;
		void tick().then(() => firstMenuAction?.focus());
	}
	function askMove(s: DaySession) {
		sheetMode = 'move';
		sheetFor = s;
		sheetDate = s.date;
		closeMenu();
	}
	function askDuplicate(s: DaySession) {
		sheetMode = 'duplicate';
		sheetFor = s;
		sheetDate = s.date;
		closeMenu();
	}
	async function confirmSheet() {
		if (!sheetFor) return;
		sheetBusy = true;
		err = '';
		try {
			if (sheetMode === 'move') {
				const r = await fetch('/api/training/session/manage', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ scheduledId: sheetFor._id, date: sheetDate }),
				});
				const j = await r.json();
				if (j.error) throw new Error(j.error);
			} else {
				const r = await fetch('/api/training/session/manage', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ scheduledId: sheetFor._id, date: sheetDate }),
				});
				const j = await r.json();
				if (j.error) throw new Error(j.error);
			}
			sheetFor = null;
			await loadWeek(weekStart);
		} catch (e) {
			err = e instanceof Error ? e.message : 'Action impossible.';
		} finally {
			sheetBusy = false;
		}
	}
	async function confirmDelete(s: DaySession) {
		closeMenu();
		if (!confirm(`Supprimer la séance « ${s.name} » de ton planning ?`)) return;
		err = '';
		try {
			const r = await fetch(`/api/training/session/manage?scheduledId=${s._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadWeek(weekStart);
		} catch (e) {
			err = e instanceof Error ? e.message : 'Suppression impossible.';
		}
	}

	/** Jours proposés pour déplacer/dupliquer : 21 jours à partir d'aujourd'hui. */
	const dayChoices = $derived.by(() => {
		const out: string[] = [];
		for (let i = 0; i < 21; i++) out.push(addDays(today, i));
		return out;
	});
	function dayChoiceLabel(iso: string): string {
		const off = dayOffset(iso);
		const lbl = new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
		if (off === 0) return `Auj. · ${lbl}`;
		if (off === 1) return `Demain · ${lbl}`;
		return lbl;
	}
</script>

<svelte:head><title>Entraînement — G-Flux</title></svelte:head>

<!-- Échap ferme le menu ••• (toucher extérieur déjà géré par le fond). -->
<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && menuFor) closeMenu();
	}}
/>

{#if openScheduledId}
	<!-- ═══ Séance ouverte : runner plein écran (libre OU guidé) ═══ -->
	<div class="fixed inset-0 z-50 overflow-y-auto bg-soft">
		<div class="safe-top safe-bottom">
			{#key openSessionId}
				<SessionRunner scheduledId={openScheduledId} onFinished={onFinished} />
			{/key}
		</div>
	</div>
{:else}
	<div class="mx-auto w-full max-w-md pb-6 pt-1">
		<BackToHome label="Entraînement" />
		<header class="mb-4">
			<p class="text-[11px] font-black uppercase tracking-widest text-brand-deep">
				{headerProgram ? `Programme · ${headerProgram}` : 'Programme'}
			</p>
			<h1 class="mt-0.5 text-ink page-title">Entraînement</h1>
		</header>

		{#if err}
			<p class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{err}</p>
		{/if}

		{#if loading}
			<p class="py-16 text-center text-sm text-mist">Chargement…</p>
		{:else if days.length === 0 && !nextSession && history.length === 0}
			<!-- État vide propre : aucun programme pour l'instant (neutre, jamais une erreur) -->
			<div class="rounded-3xl border border-dashed border-line bg-card px-6 py-14 text-center">
				<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light">
					<Icon name="dumbbell" size={26} class="text-brand" />
				</div>
				<p class="font-display text-lg font-semibold text-ink">Aucune séance programmée pour le moment</p>
				<p class="mx-auto mt-1 max-w-xs text-sm text-mist">Ton coach ajoutera ici tes séances si ton accompagnement en prévoit.</p>
			</div>
		{:else}
			{#if toFinalize}
			<!-- ── Séance à finaliser : discret, jamais bloquant ── -->
			<button
				type="button"
				onclick={() => openSession(toFinalize)}
				class="mb-5 flex w-full items-center justify-between gap-3 rounded-3xl border border-warn/50 bg-warn-light/60 p-4 text-left shadow-sm transition hover:shadow"
			>
				<span class="min-w-0">
					<span class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-warn"><Icon name="clock" size={13} /> Séance à finaliser</span>
					<span class="mt-0.5 block truncate font-display text-lg font-semibold text-ink">{toFinalize.name}</span>
					<span class="block text-xs font-semibold capitalize text-mist">{nextLabel(toFinalize.date)} · reprendre, terminer ou corriger</span>
				</span>
				<Icon name="chevronRight" size={16} class="shrink-0 text-mist" />
			</button>
			{/if}

			<!-- ── Semaine (L M M J V S D) ── -->
			<section class="mb-5 rounded-3xl border border-line bg-card p-4 shadow-sm">
				<div class="mb-3 flex items-center justify-between gap-1">
					<button type="button" onclick={() => shiftWeek(-1)} class="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-mist transition hover:bg-line/50 hover:text-ink" aria-label="Semaine précédente">
						<Icon name="chevronLeft" size={18} />
					</button>
					<div class="min-w-0 text-center">
						<p class="text-base font-black text-ink">{weekLabel}</p>
						<p class="text-[11px] font-bold text-mist">{weekDoneCount} / {days.length} faites</p>
					</div>
					<button type="button" onclick={() => shiftWeek(1)} class="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-mist transition hover:bg-line/50 hover:text-ink" aria-label="Semaine suivante">
						<Icon name="chevronRight" size={18} />
					</button>
				</div>
				<div class="grid grid-cols-7 gap-1">
					{#each [0, 1, 2, 3, 4, 5, 6] as i (i)}
						{@const iso = addDays(weekStart, i)}
						{@const daySessions = sessionsOn(iso)}
						{@const hasPlanned = daySessions.some((s) => s.status === 'planned')}
						{@const hasDone = daySessions.some((s) => s.status === 'completed')}
						{@const isToday = iso === today}
						{@const isSelected = selectedDay === iso}
						<button
							type="button"
							onclick={() => pickDay(iso)}
							aria-pressed={isSelected}
							class="flex h-16 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 transition {isSelected
								? 'bg-ink text-white'
								: isToday
									? 'bg-brand-light text-ink'
									: 'text-ink hover:bg-line/40'}"
						>
							<span class="text-[11px] font-bold {isSelected ? 'text-white/70' : 'text-mist'}">
								{DAY_LETTERS[i]}
							</span>
							<span class="text-[17px] font-black tabular-nums leading-tight">{dateNum(iso)}</span>
							<!-- Faite = point vert plein, prévue = cercle -->
							<span class="mt-0.5 h-1.5 w-1.5 rounded-full {hasDone ? 'bg-brand' : hasPlanned ? (isSelected ? 'border border-white' : 'border border-mist') : ''}"></span>
						</button>
					{/each}
				</div>
				<div class="mt-3 flex items-center gap-4 text-xs text-mist">
					<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-brand"></span>Faite</span>
					<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full border border-mist"></span>Prévue</span>
				</div>

			</section>

			<!-- ── Carte du jour sélectionné (ou Repos) ── -->
			{#if selectedDay}
				{#if sessionsOn(selectedDay).length === 0}
					<div class="mb-4 rounded-3xl border-2 border-brand bg-card p-5 text-center shadow-sm">
						<p class="font-display text-xl font-black text-ink">Repos</p>
						<p class="mt-1 text-sm text-mist">Aucune séance prévue ce jour-là.</p>
					</div>
				{:else}
					{#each sessionsOn(selectedDay) as s (s._id)}
						{@const detail = dayDetail[s._id]}
						<div class="mb-4 rounded-3xl border-2 border-brand bg-card p-4 shadow-sm">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="text-[11px] font-bold uppercase tracking-widest text-mist">{prettyDate(s.date)}</p>
									<h2 class="mt-1 break-words font-display text-2xl font-black leading-tight text-ink">{s.name}</h2>
									{#if detail}
										<p class="mt-1 text-sm text-mist">{detail.exercises.length} exercices · ≈ {detail.estimatedMin} min</p>
									{/if}
								</div>
								<span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold {statusPill(s)}">{statusLabel(s)}</span>
							</div>
							{#if detail && detail.exercises.length > 0}
								<div class="mt-3 flex flex-col gap-1.5 text-sm text-ink">
									{#each detail.exercises.slice(0, 2) as e, i (i)}
										<span class="truncate">{e.name}</span>
									{/each}
									{#if detail.exercises.length > 2}
										<span class="text-mist">+ {detail.exercises.length - 2} autres exercices</span>
									{/if}
								</div>
							{/if}
							{#if s.status === 'completed'}
								<button type="button" onclick={() => openSession(s)} class="mt-4 min-h-11 w-full rounded-xl border border-line text-sm font-bold text-mist transition hover:text-ink">Revoir la séance</button>
							{:else}
								<button type="button" onclick={() => openSession(s)} class="mt-4 min-h-[54px] w-full rounded-2xl bg-brand px-5 text-[17px] font-black text-white shadow-sm transition hover:bg-brand-dark">Faire cette séance</button>
								{#if s.date !== today}
									<p class="mt-2 text-center text-xs text-mist">Tu peux la faire aujourd'hui : elle sera comptée à sa date réelle.</p>
								{/if}
							{/if}
							{#if s.status !== 'completed'}
								<div class="mt-2 text-center">
									<button type="button" onclick={(ev) => openMenuFor(s, ev)} class="min-h-11 px-2 text-xs font-semibold text-mist transition hover:text-ink" aria-label="Options de la séance">Déplacer / dupliquer / supprimer</button>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			{/if}

			<!-- ── Séances réalisées de la semaine ── -->
			{#if weekCompleted.length > 0}
				<section class="flex flex-col gap-2">
					{#each weekCompleted as h (h._id)}
						<div class="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3">
							<div class="min-w-0">
								<p class="truncate text-[15px] font-black text-ink">{h.name} · {new Date(h.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}</p>
								<p class="text-[13px] text-mist">
									{#if h.durationMin}{h.durationMin} min · {/if}{h.setsDone} séries{#if h.difficulty != null} · effort {h.difficulty}/5{/if}
								</p>
							</div>
							<span class="shrink-0 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-white">Faite</span>
						</div>
					{/each}
				</section>
			{:else}
				<p class="py-2 text-center text-xs text-mist">Aucune séance réalisée cette semaine.</p>
			{/if}
		{/if}
	</div>
{/if}

<!-- Menu ••• compact ancré sous le bouton (aligné sur son bord droit, ou
     au-dessus si la place manque en bas) : jamais hors écran, jamais sur la
     barre de navigation. Fermeture au toucher extérieur ou avec Échap. -->
{#if menuFor && selectedDay && menuAnchor}
	{#each sessionsOn(selectedDay) as ms (ms._id)}
		{#if ms._id === menuFor && ms.status !== 'completed'}
			<!-- Fond très légèrement assombri (sans flou) -->
			<button
				type="button"
				class="menu-backdrop fixed inset-0 z-[55] cursor-default bg-ink/10"
				aria-label="Fermer le menu"
				transition:menuMotion={prefersReducedMotion()}
				onclick={closeMenu}
			></button>
			<div
				role="menu"
				aria-label={`Options de la séance ${ms.name}`}
				transition:menuMotion={prefersReducedMotion()}
				style="top: {menuAnchor.top}px; right: {menuAnchor.right}px; width: {MENU_WIDTH}px;"
				class="menu-anchored fixed z-[56] overflow-hidden rounded-2xl border border-line bg-white shadow-xl {menuAnchor.above
					? 'origin-bottom-right'
					: 'origin-top-right'}"
			>
				<button
					type="button"
					role="menuitem"
					bind:this={firstMenuAction}
					onclick={() => askMove(ms)}
					class="flex h-11 w-full items-center gap-2.5 px-4 text-left text-[15px] font-semibold text-ink transition hover:bg-line/40"
				>
					<Icon name="calendarDays" size={16} class="shrink-0 text-mist" /> Déplacer
				</button>
				<button
					type="button"
					role="menuitem"
					onclick={() => askDuplicate(ms)}
					class="flex h-11 w-full items-center gap-2.5 border-t border-line/60 px-4 text-left text-[15px] font-semibold text-ink transition hover:bg-line/40"
				>
					<Icon name="copy" size={16} class="shrink-0 text-mist" /> Dupliquer
				</button>
				<button
					type="button"
					role="menuitem"
					onclick={() => confirmDelete(ms)}
					class="flex h-11 w-full items-center gap-2.5 border-t border-line/60 px-4 text-left text-[15px] font-semibold text-danger transition hover:bg-danger-light"
				>
					<Icon name="trash" size={16} class="shrink-0" /> Supprimer
				</button>
			</div>
		{/if}
	{/each}
{/if}

<!-- Feuille déplacer / dupliquer -->
{#if sheetFor}
	<div class="fixed inset-0 z-[60] grid place-items-end bg-ink/50 p-4 sm:place-items-center" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) sheetFor = null; }}>
		<div class="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
			<h3 class="font-display text-lg font-semibold text-ink">
				{sheetMode === 'move' ? 'Déplacer la séance' : 'Dupliquer la séance'}
			</h3>
			<p class="mt-0.5 text-sm text-mist">{sheetFor.name}</p>
			<p class="mt-3 text-[11px] font-bold uppercase tracking-wider text-mist">{sheetMode === 'move' ? 'Nouveau jour' : 'Jour de la copie'}</p>
			<div class="mt-1.5 -mx-1 flex max-h-40 gap-1.5 overflow-y-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{#each dayChoices as d (d)}
					<button
						type="button"
						onclick={() => (sheetDate = d)}
						class="shrink-0 rounded-xl border-2 px-3 py-2 text-xs font-bold transition {sheetDate === d ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:border-brand/50'}"
					>{dayChoiceLabel(d)}</button>
				{/each}
			</div>
			<div class="mt-4 grid gap-2">
				<button type="button" disabled={!sheetDate || sheetBusy} onclick={confirmSheet} class="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60">
					{sheetBusy ? 'Enregistrement…' : sheetMode === 'move' ? 'Déplacer ici' : 'Créer la copie'}
				</button>
				<button type="button" onclick={() => (sheetFor = null)} class="rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink">Annuler</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Les styles restent dans les classes utilitaires — aucune règle globale. */

	/* Mouvement réduit : fondu seul, sans agrandissement (l'animation JS
	   reçoit déjà prefersReducedMotion() ; ceinture et bretelles CSS). */
	@media (prefers-reduced-motion: reduce) {
		.menu-anchored,
		.menu-backdrop {
			animation: none;
			transition: none;
		}
	}
</style>
