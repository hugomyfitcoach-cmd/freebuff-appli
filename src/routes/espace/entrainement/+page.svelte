<script lang="ts">
	/**
	 * Espace cliente — ENTRAÎNEMENT.
	 * Ouverte depuis le raccourci « Entraînement » de l'Accueil.
	 * Semaine simple (L M M J V S D, point sous les jours à séance), séance
	 * sélectionnée, prochaine séance identifiable. État vide propre si aucun
	 * programme. La vue séance (libre/guidé) vit dans SessionRunner.svelte.
	 * Déplacer / dupliquer une séance : côté coach (Vue 360) en V1.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SessionRunner from '$lib/components/SessionRunner.svelte';

	type DaySession = { _id: string; date: string; status: 'planned' | 'completed' | 'cancelled'; name: string };
	type NextSession = { _id: string; date: string; name: string } | null;

	let loading = $state(true);
	let err = $state('');
	let weekStart = $state('');
	let today = $state('');
	let days = $state<DaySession[]>([]);
	let nextSession = $state<NextSession>(null);
	let selected = $state<DaySession | null>(null);

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

	/** Jour courant de la semaine affichée (0-6) — l'aujourd'hui est surligné. */
	const selectedIso = $derived(selected?.date ?? '');
	function sessionsOn(iso: string): DaySession[] {
		return days.filter((d) => d.date === iso);
	}

	async function loadWeek(ws?: string) {
		const target = ws ?? mondayOf(new Date());
		const r = await fetch(`/api/training${target ? `?weekStart=${target}` : ''}`).then((x) => x.json());
		if (r.error) throw new Error(r.error);
		weekStart = r.weekStart as string;
		today = r.today as string;
		days = r.days as DaySession[];
		nextSession = (r.nextSession ?? null) as NextSession;
		// Sélection par défaut : la prochaine séance si elle est dans la semaine,
		// sinon aujourd'hui (même sans séance), sinon le 1er jour.
		const upcoming = days.find((d) => d.status === 'planned');
		if (upcoming) selected = upcoming;
		else if (today >= weekStart && today <= addDays(weekStart, 6)) selected = null;
		else selected = null;
	}

	async function shiftWeek(delta: number) {
		await loadWeek(addDays(weekStart, delta * 7));
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
		selected = s;
		openScheduledId = s._id;
		openSessionId = s._id;
		runnerKey += 1;
	}

	/* ── Menu ••• d'une séance programmée (déplacer / dupliquer / supprimer) ── */
	let menuFor = $state<string | null>(null);
	let sheetFor = $state<DaySession | null>(null);
	let sheetMode = $state<'move' | 'duplicate'>('move');
	let sheetDate = $state('');
	let sheetBusy = $state(false);
	let calendarTarget = $state<DaySession | null>(null);

	function openMenuFor(s: DaySession, ev: MouseEvent) {
		ev.stopPropagation();
		menuFor = menuFor === s._id ? null : s._id;
	}
	function askMove(s: DaySession) {
		sheetMode = 'move';
		sheetFor = s;
		sheetDate = s.date;
		menuFor = null;
	}
	function askDuplicate(s: DaySession) {
		sheetMode = 'duplicate';
		sheetFor = s;
		sheetDate = s.date;
		menuFor = null;
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
		menuFor = null;
		if (!confirm(`Supprimer la séance « ${s.name} » de ton planning ?`)) return;
		err = '';
		try {
			const r = await fetch(`/api/training/session/manage?scheduledId=${s._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			if (selected?._id === s._id) selected = null;
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
	<div class="mx-auto w-full max-w-md px-4 pb-6 pt-1">
		<header class="mb-4">
			<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
				<Icon name="dumbbell" size={22} class="text-brand" /> Entraînement
			</h1>
			<p class="mt-0.5 text-sm text-mist">Ta séance, tu la fais, c'est noté.</p>
		</header>

		{#if err}
			<p class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{err}</p>
		{/if}

		{#if loading}
			<p class="py-16 text-center text-sm text-mist">Chargement…</p>
		{:else if days.length === 0 && !nextSession && history.length === 0}
			<!-- État vide propre : aucun programme pour l'instant -->
			<div class="rounded-3xl border border-dashed border-line bg-card px-6 py-14 text-center">
				<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light">
					<Icon name="dumbbell" size={26} class="text-brand" />
				</div>
				<p class="font-display text-lg font-semibold text-ink">Aucune séance programmée pour le moment</p>
				<p class="mx-auto mt-1 max-w-xs text-sm text-mist">Ton coach te prépare un programme — il apparaîtra ici dès qu'il sera assigné.</p>
			</div>
		{:else}
			<!-- ── Prochaine séance ── -->
			{#if nextSession}
				<button
					type="button"
					onclick={() => {
						const s = days.find((d) => d._id === nextSession!._id);
						if (s) openSession(s);
						else openSession({ _id: nextSession!._id, date: nextSession!.date, status: 'planned', name: nextSession!.name });
					}}
					class="mb-5 w-full overflow-hidden rounded-3xl border border-brand/40 bg-gradient-to-br from-brand-light via-brand-light/60 to-white p-5 text-left shadow-sm transition hover:shadow"
				>
					<p class="text-[11px] font-bold uppercase tracking-widest text-brand-dark">Prochaine séance</p>
					<p class="mt-1.5 font-display text-xl font-semibold text-ink">{nextSession.name}</p>
					<p class="mt-0.5 text-sm font-semibold capitalize text-ink">{nextLabel(nextSession.date)}</p>
					<span class="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white">
						<Icon name="play" size={14} /> Voir la séance
					</span>
				</button>
			{/if}

			<!-- ── Semaine (L M M J V S D) ── -->
			<section class="mb-5 rounded-3xl border border-line bg-card p-4 shadow-sm">
				<div class="mb-3 flex items-center justify-between">
					<h2 class="font-display text-base font-semibold text-ink">Cette semaine</h2>
					<div class="flex items-center gap-1">
						<button type="button" onclick={() => shiftWeek(-1)} class="rounded-lg p-1.5 text-mist transition hover:bg-line/50 hover:text-ink" aria-label="Semaine précédente">
							<Icon name="chevronLeft" size={16} />
						</button>
						<button type="button" onclick={() => shiftWeek(1)} class="rounded-lg p-1.5 text-mist transition hover:bg-line/50 hover:text-ink" aria-label="Semaine suivante">
							<Icon name="chevronRight" size={16} />
						</button>
					</div>
				</div>
				<div class="grid grid-cols-7 gap-1">
					{#each [0, 1, 2, 3, 4, 5, 6] as i (i)}
						{@const iso = addDays(weekStart, i)}
						{@const daySessions = sessionsOn(iso)}
						{@const hasPlanned = daySessions.some((s) => s.status === 'planned')}
						{@const hasDone = daySessions.some((s) => s.status === 'completed')}
						{@const isToday = iso === today}
						<button
							type="button"
							onclick={() => (selected = daySessions[0] ?? null)}
							class="flex flex-col items-center rounded-xl px-0.5 pb-1.5 pt-2 transition {selectedIso === iso
								? 'bg-ink text-white'
								: isToday
									? 'bg-brand-light text-ink'
									: 'text-ink hover:bg-line/40'}"
						>
							<span class="text-[10px] font-bold uppercase tracking-wide {selectedIso === iso ? 'text-white/70' : 'text-mist'}">
								{DAY_LETTERS[i]}
							</span>
							<span class="mt-0.5 text-sm font-bold tabular-nums">{dateNum(iso)}</span>
							<!-- Indicateur : point (prévue) / point plein vert (faite) -->
							<span class="mt-1 h-1.5 w-1.5 rounded-full {hasDone ? 'bg-brand' : hasPlanned ? 'bg-ink/30' : 'bg-transparent'} {selectedIso === iso && !hasDone && !hasPlanned ? (selectedIso === iso ? 'bg-white/40' : '') : ''}"></span>
						</button>
					{/each}
				</div>

				<!-- Séances du jour sélectionné -->
				{#if selectedIso}
					<div class="mt-3 border-t border-line/70 pt-3">
						{#if sessionsOn(selectedIso).length === 0}
							<p class="py-1 text-center text-sm text-mist">Pas de séance ce jour-là.</p>
						{:else}
							{#each sessionsOn(selectedIso) as s (s._id)}
							<div
								role="button"
								tabindex="0"
								onclick={() => openSession(s)}
								onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSession(s); } }}
								class="mb-2 flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-left transition hover:border-brand/60 last:mb-0"
							>
								<span class="min-w-0">
									<span class="block truncate text-sm font-bold text-ink">{s.name}</span>
									<span class="text-xs text-mist">{s.status === 'completed' ? 'Séance réalisée ✓' : 'À faire'}</span>
								</span>
								{#if s.status === 'completed'}
									<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-white">
										<Icon name="check" size={15} strokeWidth={2.5} />
									</span>
								{:else}
									<div class="flex shrink-0 items-center gap-1">
										<button
											type="button"
											onclick={(ev) => openMenuFor(s, ev)}
											class="rounded-full px-1.5 py-1 font-bold text-mist transition hover:bg-line/60 hover:text-ink"
											aria-label="Options de la séance"
										>•••</button>
										<button
											type="button"
											onclick={() => openSession(s)}
											class="grid h-8 w-8 place-items-center rounded-full bg-ink text-white"
											aria-label="Commencer la séance"
										>
											<Icon name="play" size={13} />
										</button>
									</div>
								{/if}
							</div>
						{/each}
						{/if}
					</div>
				{/if}
			</section>

			<!-- ── Historique des séances ── -->
			<section class="rounded-3xl border border-line bg-card p-4 shadow-sm">
				<h2 class="mb-2 flex items-center gap-2 font-display text-base font-semibold text-ink">
					<Icon name="listChecks" size={16} class="text-brand" /> Mes séances réalisées
				</h2>
				{#if history.length === 0}
					<p class="py-2 text-sm text-mist">Ta première séance apparaîtra ici.</p>
				{:else}
					{#each history as h (h._id)}
						<div class="flex items-center justify-between gap-3 border-b border-line/60 py-2.5 text-sm last:border-0">
							<div class="min-w-0">
								<p class="truncate font-semibold text-ink">{h.name}</p>
								<p class="text-xs text-mist capitalize">
									{prettyDate(h.date)}
									{#if h.durationMin} · {h.durationMin} min{/if}
									{#if h.volumeKg} · {Math.round(h.volumeKg).toLocaleString('fr-FR')} kg au total{/if}
								</p>
							</div>
							<span class="shrink-0 rounded-full bg-brand-light px-2.5 py-1 text-xs font-bold text-brand-dark">{h.setsDone} séries</span>
						</div>
					{/each}
				{/if}
			</section>
		{/if}
	</div>
{/if}

<!-- Menus ••• (déplacer / dupliquer / supprimer) -->
{#if menuFor && selectedIso}
	<button type="button" class="fixed inset-0 z-[55] cursor-default" aria-label="Fermer le menu" onclick={() => (menuFor = null)}></button>
	{#each sessionsOn(selectedIso) as ms (ms._id)}
		{#if ms._id === menuFor && ms.status !== 'completed'}
			<div class="fixed inset-x-4 bottom-24 z-[56] mx-auto max-w-xs overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
				<button type="button" onclick={() => askMove(ms)} class="block w-full px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-line/40">
					<Icon name="calendarDays" size={15} class="mr-2 inline text-mist" /> Déplacer
				</button>
				<button type="button" onclick={() => askDuplicate(ms)} class="block w-full border-t border-line/60 px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-line/40">
					<Icon name="copy" size={15} class="mr-2 inline text-mist" /> Dupliquer
				</button>
				<button type="button" onclick={() => confirmDelete(ms)} class="block w-full border-t border-line/60 px-4 py-3 text-left text-sm font-semibold text-danger hover:bg-danger-light">
					<Icon name="trash" size={15} class="mr-2 inline" /> Supprimer
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
</style>
