<script lang="ts">
	/**
	 * TrainingPanel — section « Entraînement » de la Vision 360 (CRM coach).
	 *
	 * Coach : assigner / remplacer / prolonger / retirer un programme, déplacer /
	 * dupliquer / annuler une occurrence (•••), suivre l'adhérence, les
	 * charges (dernière / meilleure / évolution) et les notes clientes.
	 * Le programme assigné est une COPIE indépendante du modèle — remplacer
	 * n'annule QUE les séances futures ; l'historique réalisé reste intact.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { displayExerciseName } from '$lib/exerciseFr';
	import {
		parisTodayISO,
		trainingStatus,
		trainingAdherence,
		TRAINING_STATUS_LABELS,
		formatLoggedSet,
		progressionDeltaLabel,
		type TrainingStatusKey,
	} from '$lib/trainingProgress';
	import {
		defaultOpenWeekIndex,
		groupSessionsByWeek,
		programEndBadge,
		programWeekCount,
		sessionDurationMin,
	} from '$lib/trainingWeeks';

	let { userId }: { userId: string } = $props();

	type AssignmentRow = {
		_id: string;
		programId: string;
		programName: string;
		sourceProgramId: string | null;
		startDate: string;
		endDate: string;
		weekdays: number[];
		removedAt: number | null;
		plannedCount: number;
		completedCount: number;
		adherence: number | null;
		nextDate: string | null;
	};
	type Summary = {
		active: { assignmentId: string; programId: string; programName: string; startDate: string; endDate: string; weekdays: number[]; weekNumber: number } | null;
		today: string;
		weekStart: string;
		plannedCount: number;
		completedCount: number;
		adherence: number | null;
		thisWeek: { _id: string; date: string; status: string; name: string }[];
		lastCompleted: { _id: string; date: string; name: string; durationMin: number | null; difficulty: number | null; note: string | null } | null;
		nextSession: { _id: string; date: string; name: string } | null;
		recentNotes: { _id: string; date: string; name: string; difficulty: number | null; note: string | null }[];
	};
	type ScheduledRow = {
		_id: string;
		sessionId: string;
		sessionName?: string;
		date: string;
		status: string;
		completedAt: number | null;
		skippedAt: number | null;
		startedAt: number | null;
		/** Durée enregistrée par la cliente — prioritaire sur le chrono. */
		durationMin: number | null;
		difficulty: number | null;
		note: string | null;
	};

	/** Statuts calculés (jamais stockés) — la refonte visuelle viendra en T3. */
	const today = parisTodayISO();
	const STATUS_TONE: Record<TrainingStatusKey, string> = {
		done: 'bg-brand-light text-brand-dark',
		notDone: 'bg-danger-light text-danger',
		missed: 'bg-danger-light text-danger',
		planned: 'bg-line/50 text-mist',
		cancelled: 'bg-line/40 text-mist line-through',
	};
	function statusOf(s: ScheduledRow): TrainingStatusKey {
		return trainingStatus(s, today);
	}
	/** Note dépliée depuis la liste (une seule à la fois). */
	let openNote = $state<string | null>(null);
	/** Semaine dépliée (une seule à la fois) — la semaine en cours par défaut. */
	let openWeek = $state<number | null>(null);

	let loading = $state(true);
	let err = $state('');
	let msg = $state('');

	let summary = $state<Summary | null>(null);
	let assignments = $state<AssignmentRow[]>([]);
	let activeAssignment = $state<AssignmentRow | null>(null);
	let scheduled = $state<ScheduledRow[]>([]);

	/* ── Vue par semaine + en-tête du programme (T3) ──
	   Tout est DÉRIVÉ : adhérence (trainingAdherence) et statuts (trainingStatus)
	   viennent de src/lib/trainingProgress.ts — aucun nouveau calcul stocké. */
	const adherence = $derived(trainingAdherence(scheduled, today));
	const weekGroups = $derived(
		groupSessionsByWeek(scheduled, summary?.active?.startDate ?? '', summary?.active?.endDate ?? '', today)
	);
	const endBadge = $derived(summary?.active ? programEndBadge(summary.active.endDate, today) : null);

	/* ── Programmes modèles (bibliothèque coach) ── */
	type ProgramRow = { _id: string; name: string; sessionCount: number; sessionsPerWeek?: number | null };
	let programs = $state<ProgramRow[]>([]);

	/* ── Formulaire d'assignation ── */
	let assignOpen = $state(false);
	let assignProgramId = $state('');
	let assignStart = $state(new Date().toISOString().slice(0, 10));
	let assignWeeks = $state('4');
	let assignDays = $state<number[]>([]);
	const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
	let assignBusy = $state(false);

	/** Jours conseillés (précochés) selon la fréquence du programme choisi. */
	const SUGGESTED: Record<number, number[]> = { 1: [3], 2: [2, 5], 3: [1, 3, 6], 4: [1, 2, 4, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7] };
	function suggestDays(sessionCount: number): number[] {
		return SUGGESTED[Math.min(sessionCount, 7)] ?? [1, 3, 5];
	}

	/* ── Prolongation ── */
	let extendWeeks = $state('4');
	let extendBusy = $state(false);

	/* ── Actions d'une occurrence (détail déplié) ── */
	let moveFor = $state<ScheduledRow | null>(null);
	let moveDate = $state('');
	let dupFor = $state<ScheduledRow | null>(null);
	let dupDate = $state('');

	/* ── Remplacement ── */
	let replaceOpen = $state(false);
	let replaceProgramId = $state('');
	let replaceStart = $state(new Date().toISOString().slice(0, 10));
	let replaceWeeks = $state('4');
	let replaceDays = $state<number[]>([]);
	let replaceBusy = $state(false);

	/* ── Historique par exercice ── */
	/** Ligne « Charges & progression » : départ (1re séance) → actuel (dernière). */
	type ExRow = {
		exerciseId: string;
		name: string;
		sessions: number;
		unit: 'kg' | 'reps' | 's';
		startDate: string;
		startValue: number | null;
		currentDate: string;
		currentValue: number | null;
		delta: number | null;
	};
	let tracked = $state<ExRow[]>([]);
	let exDetail = $state<null | { exerciseId: string; name: string; last: { date: string; reps: number | null; weightKg: number | null; durationSeconds: number | null; mode: string } | null; best: { date: string; reps: number | null; weightKg: number | null; durationSeconds: number | null; mode: string } | null; timeline: { date: string; weightKg: number | null }[] }>(null);
	let exLoading = $state('');

	/* ── Détail des séries d'une séance réalisée (lecture seule) ── */
	type SessionDetail = {
		_id: string;
		date: string;
		sessionName: string;
		note: string | null;
		difficulty: number | null;
		durationMin: number | null;
		exercises: {
			exerciseId: string;
			name: string;
			mode: string;
			sets: { setOrder: number; reps: number | null; weightKg: number | null; durationSeconds: number | null; mode: string }[];
			volumeKg: number | null;
		}[];
		volumeKg: number | null;
	};
	let sessionDetail = $state<SessionDetail | null>(null);
	let sessionDetailBusy = $state(false);

	async function loadSessionDetail(scheduledSessionId: string) {
		sessionDetailBusy = true;
		try {
			const r = await fetch(`/api/coach/training/session-detail?scheduledSessionId=${scheduledSessionId}`).then((x) => x.json());
			sessionDetail = r?.error ? null : (r as SessionDetail);
		} catch {
			sessionDetail = null;
		} finally {
			sessionDetailBusy = false;
		}
	}

	// Une pastille ouverte sur une « Réalisée » charge ses séries (jamais pour les autres).
	$effect(() => {
		const id = openNote;
		const row = id ? scheduled.find((x) => x._id === id) : null;
		if (!row || trainingStatus(row, today) !== 'done') {
			sessionDetail = null;
			return;
		}
		void loadSessionDetail(row._id);
	});

	async function loadAll() {
		loading = true;
		err = '';
		try {
			const [s, a, p] = await Promise.all([
				fetch(`/api/coach/training/summary?userId=${userId}`).then((r) => r.json()),
				fetch(`/api/coach/training/assignments?userId=${userId}`).then((r) => r.json()),
				fetch('/api/coach/training/programs').then((r) => r.json()),
			]);
			if (s.error) throw new Error(s.error);
			summary = s as Summary;
			assignments = (a.items ?? []) as AssignmentRow[];
			activeAssignment = assignments.find((x) => !x.removedAt) ?? null;
			programs = (p.items ?? []) as ProgramRow[];
			if (activeAssignment) {
				const d = await fetch(`/api/coach/training/assignments?assignmentId=${activeAssignment._id}`).then((r) => r.json());
				scheduled = (d.sessions ?? []) as ScheduledRow[];
			} else {
				scheduled = [];
			}
			// La semaine en cours s'ouvre par défaut, les autres restent repliées.
			openWeek = defaultOpenWeekIndex(
				groupSessionsByWeek(scheduled, summary?.active?.startDate ?? '', summary?.active?.endDate ?? '', today)
			);
			const window = summary?.active ? `&from=${summary.active.startDate}&to=${summary.active.endDate}` : '';
			const t = await fetch(`/api/coach/training/exercise-history?userId=${userId}${window}`).then((r) => r.json());
			tracked = (t.exercises ?? []) as ExRow[];
		} catch (e) {
			err = e instanceof Error ? e.message : 'Chargement impossible.';
		} finally {
			loading = false;
		}
	}
	onMount(loadAll);

	function fmtISO(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
	}
	/** Jour court de la pastille : « lun. 5 ». */
	function fmtDay(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
	}
	/** Durée réelle d'une séance terminée (« 42 min »), null si inconnue. */
	function durationLabel(s: ScheduledRow): string | null {
		const min = sessionDurationMin(s);
		return min == null ? null : `${min} min`;
	}
	function fmtKg(n: number): string {
		return String(Number.isInteger(n) ? n : Math.round(n * 10) / 10).replace('.', ',');
	}
	/** Valeur d'une progression dans l'unité de l'exercice (kg, reps ou secondes). */
	function valueLabel(value: number | null, unit: string): string {
		if (value == null) return '—';
		if (unit === 's') return `${value} s`;
		if (unit === 'reps') return `${value} reps`;
		return `${fmtKg(value)} kg`;
	}
	/** Vert si hausse, gris si stable, orange si baisse. */
	function deltaTone(delta: number | null): string {
		if (delta == null || delta === 0) return 'text-mist';
		return delta > 0 ? 'text-brand-dark' : 'text-warn';
	}

	function toggleDay(list: number[], d: number): number[] {
		return list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort((a, b) => a - b);
	}

	/* ── Assigner / remplacer ── */
	function openAssign(replace: boolean) {
		if (replace && activeAssignment) {
			replaceProgramId = '';
			replaceStart = new Date().toISOString().slice(0, 10);
			replaceWeeks = '4';
			replaceOpen = true;
		} else {
			assignProgramId = '';
			assignStart = new Date().toISOString().slice(0, 10);
			assignWeeks = '4';
			assignDays = [];
			assignOpen = true;
		}
	}
	function pickAssignProgram() {
		const p = programs.find((x) => x._id === assignProgramId);
		assignDays = suggestDays(p?.sessionCount ?? 3);
	}
	async function submitAssign() {
		assignBusy = true;
		err = '';
		msg = '';
		try {
			const r = await fetch('/api/coach/training/assignments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					userId,
					sourceProgramId: assignProgramId,
					startDate: assignStart,
					weeks: Number(assignWeeks),
					weekdays: assignDays,
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			assignOpen = false;
			msg = `Programme assigné — ${j.sessionsCreated} séance(s) planifiée(s).`;
			await loadAll();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Assignation impossible.';
		} finally {
			assignBusy = false;
		}
	}
	function pickReplaceProgram() {
		const p = programs.find((x) => x._id === replaceProgramId);
		replaceDays = suggestDays(p?.sessionCount ?? 3);
	}
	async function submitReplace() {
		if (!activeAssignment) return;
		replaceBusy = true;
		err = '';
		msg = '';
		try {
			const r = await fetch('/api/coach/training/assignments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					userId,
					sourceProgramId: replaceProgramId,
					startDate: replaceStart,
					weeks: Number(replaceWeeks),
					weekdays: replaceDays,
					replacesAssignmentId: activeAssignment._id,
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			replaceOpen = false;
			msg = 'Programme remplacé — les séances passées et l\u2019historique réalisé restent intacts.';
			await loadAll();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Remplacement impossible.';
		} finally {
			replaceBusy = false;
		}
	}
	async function removeAssignment() {
		if (!activeAssignment) return;
		if (!confirm('Retirer le programme ? Les séances non réalisées disparaissent du planning de ta cliente — les séances réalisées et tout l\u2019historique restent intacts.')) return;
		try {
			const r = await fetch(`/api/coach/training/assignments?assignmentId=${activeAssignment._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			msg = 'Programme retiré.';
			await loadAll();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Retrait impossible.';
		}
	}
	async function extend() {
		if (!activeAssignment) return;
		extendBusy = true;
		try {
			const r = await fetch('/api/coach/training/assignments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ assignmentId: activeAssignment._id, weeks: Number(extendWeeks) }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			msg = `Programme prolongé de ${extendWeeks} semaine(s).`;
			await loadAll();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Prolongation impossible.';
		} finally {
			extendBusy = false;
		}
	}

	/* ── ••• occurrences ── */
	async function moveOccurrence() {
		if (!moveFor) return;
		try {
			const r = await fetch('/api/coach/training/assignments', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ scheduledId: moveFor._id, date: moveDate }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			moveFor = null;
			await loadAll();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Déplacement impossible.';
		}
	}
	async function duplicateOccurrence() {
		if (!dupFor) return;
		try {
			const r = await fetch('/api/coach/training/assignments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ duplicate: true, scheduledId: dupFor._id, date: dupDate }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			dupFor = null;
			await loadAll();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Duplication impossible.';
		}
	}
	async function cancelOccurrence(s: ScheduledRow, cancel: boolean) {
		try {
			const r = await fetch('/api/coach/training/assignments', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ scheduledId: s._id, cancel }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadAll();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Action impossible.';
		}
	}

	/* ── Historique par exercice ── */
	async function openExercise(ex: ExRow) {
		exLoading = ex.exerciseId;
		try {
			const r = await fetch(`/api/coach/training/exercise-history?userId=${userId}&exerciseId=${ex.exerciseId}`).then((x) => x.json());
			exDetail = { exerciseId: ex.exerciseId, name: displayExerciseName(ex.name), last: r.last ?? null, best: r.best ?? null, timeline: r.timeline ?? [] };
		} finally {
			exLoading = '';
		}
	}
	const maxTimeline = $derived(exDetail ? Math.max(...exDetail.timeline.map((t) => t.weightKg ?? 0), 1) : 1);
</script>

<div class="rounded-2xl border border-line bg-card px-5 py-4 shadow-sm">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h3 class="flex items-center gap-1.5 font-display text-base font-semibold text-ink">
			<Icon name="dumbbell" size={17} class="shrink-0 text-brand" /> Entraînement
		</h3>
		<div class="flex items-center gap-1.5">
			{#if activeAssignment}
				<button type="button" onclick={() => openAssign(true)} class="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand">Remplacer</button>
				<button type="button" onclick={removeAssignment} class="rounded-lg border-2 border-line px-3 py-1.5 text-xs font-semibold text-danger transition hover:border-danger">Retirer</button>
			{:else}
				<button type="button" onclick={() => openAssign(false)} disabled={programs.length === 0} class="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50" title={programs.length === 0 ? 'Crée d\u2019abord un programme dans le module Entraînement.' : ''}>
					Assigner un programme
				</button>
			{/if}
			<a href="/admin/entrainement" class="rounded-lg border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand">Programmes →</a>
		</div>
	</div>

	{#if msg}<p class="mt-3 rounded-lg bg-brand-light px-3 py-2 text-xs font-semibold text-ink">{msg}</p>{/if}
	{#if err}<p class="mt-3 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{err}</p>{/if}

	{#if loading}
		<p class="py-8 text-center text-sm text-mist">Chargement…</p>
	{:else if !activeAssignment && assignments.length === 0}
		<div class="mt-4 rounded-xl border border-dashed border-line px-4 py-10 text-center">
			<p class="text-sm font-semibold text-ink">Aucun programme assigné</p>
			<p class="mx-auto mt-1 max-w-sm text-xs text-mist">
				Assigne un programme : une copie indépendante est créée pour cette cliente, les séances apparaissent dans son espace « Entraînement ».
			</p>
			{#if programs.length === 0}
				<p class="mt-3 text-xs text-mist">Crée d'abord un programme dans le <a href="/admin/entrainement" class="font-semibold text-brand underline">module Entraînement</a>.</p>
			{:else}
				<button type="button" onclick={() => openAssign(false)} class="mt-3 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-dark">Assigner un programme</button>
			{/if}
		</div>
	{:else}
		<!-- ── En-tête du programme (carte blanche) ── -->
		{#if summary?.active}
			<div class="mt-4 min-w-0 rounded-2xl border border-line bg-white p-4 shadow-sm">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Programme actif</p>
					<span class="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold text-brand-dark">
						Semaine {weekGroups.find((w) => w.isCurrent)?.index ?? weekGroups.length} sur {weekGroups.length || programWeekCount(summary.active.startDate, summary.active.endDate)}
					</span>
				</div>
				<p class="mt-1 break-words font-display text-lg font-semibold text-ink">{summary.active.programName}</p>
				<p class="mt-0.5 text-xs text-ink">
					Du <strong>{fmtISO(summary.active.startDate)}</strong> au <strong>{fmtISO(summary.active.endDate)}</strong>
					· {summary.active.weekdays.map((d) => DAY_LABELS[d - 1]).join(' ')}
				</p>
				<div class="mt-3 grid grid-cols-3 gap-1.5 text-center">
					<div class="min-w-0 rounded-lg bg-cream/70 px-1.5 py-2">
						<p class="font-display text-base font-bold text-ink">{adherence.done}<span class="text-xs font-semibold text-mist">/{adherence.past}</span></p>
						<p class="text-[10px] font-semibold uppercase leading-tight tracking-wide text-mist">réalisées / passées</p>
					</div>
					<div class="min-w-0 rounded-lg bg-cream/70 px-1.5 py-2">
						<p class="font-display text-base font-bold {adherence.percent == null ? 'text-mist' : adherence.percent >= 80 ? 'text-brand-dark' : 'text-warn'}">
							{adherence.percent == null ? '—' : `${adherence.percent} %`}
						</p>
						<p class="text-[10px] font-semibold uppercase leading-tight tracking-wide text-mist">adhérence</p>
					</div>
					<div class="min-w-0 rounded-lg bg-cream/70 px-1.5 py-2">
						<p class="break-words font-display text-[13px] font-bold leading-tight {endBadge?.tone === 'warn' ? 'text-warn' : endBadge?.tone === 'over' ? 'text-mist' : 'text-ink'}">
							{endBadge?.label ?? '—'}
						</p>
						<p class="text-[10px] font-semibold uppercase leading-tight tracking-wide text-mist">fin de programme</p>
					</div>
				</div>

				<!-- Durée de la prolongation + Prolonger (contrôles existants) -->
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<label class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-mist">
						Durée
						<select bind:value={extendWeeks} class="rounded-lg border-2 border-line bg-white px-2 py-1.5 text-xs font-semibold text-ink outline-none focus:border-brand">
							{#each [2, 4, 6, 8, 12] as w (w)}<option value={String(w)}>{w} semaines</option>{/each}
						</select>
					</label>
					<button type="button" onclick={extend} disabled={extendBusy} class="rounded-lg border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand disabled:opacity-50">
						{extendBusy ? 'Prolongation…' : 'Prolonger'}
					</button>
				</div>
			</div>
		{/if}

		<!-- ── Dernière séance + note cliente ── -->
		{#if summary?.lastCompleted}
			<div class="mt-3 rounded-xl border border-line p-3.5">
				<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Dernière séance · {fmtISO(summary.lastCompleted.date)}</p>
				<p class="mt-0.5 text-sm font-semibold text-ink">
					{summary.lastCompleted.name}
					{#if summary.lastCompleted.durationMin} · {summary.lastCompleted.durationMin} min{/if}
					{#if summary.lastCompleted.difficulty != null}
						<span class="ml-1 inline-flex items-center gap-0.5">
							{#each [1, 2, 3, 4, 5] as d (d)}
								<span class="inline-block h-1.5 w-1.5 rounded-full {d <= (summary.lastCompleted?.difficulty ?? 0) ? 'bg-brand' : 'bg-line'}"></span>
							{/each}
						</span>
					{/if}
				</p>
				{#if summary.lastCompleted.note}
					<p class="mt-1 rounded-lg bg-warn-light px-2.5 py-1.5 text-xs text-ink">💬 {summary.lastCompleted.note}</p>
				{/if}
			</div>
		{:else if summary?.nextSession}
			<div class="mt-3 rounded-xl border border-line p-3.5">
				<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Prochaine séance</p>
				<p class="mt-0.5 text-sm font-semibold text-ink">{summary.nextSession.name} · <span class="capitalize">{fmtISO(summary.nextSession.date)}</span></p>
			</div>
		{/if}

		<!-- ── Retours de la cliente (recentNotes) ── -->
		{#if summary?.recentNotes?.length}
			<details class="mt-3" open>
				<summary class="cursor-pointer text-xs font-semibold text-mist hover:text-ink">Retours de la cliente ({summary.recentNotes.length})</summary>
				<ul class="mt-2 flex flex-col gap-1.5">
					{#each summary.recentNotes as n (n._id)}
						<li class="rounded-lg border border-line px-3 py-2 text-xs">
							<p class="flex flex-wrap items-center gap-1.5">
								<span class="font-semibold capitalize text-ink">{fmtISO(n.date)}</span>
								<span class="text-mist">· {n.name}</span>
								{#if n.difficulty != null}
									<span class="rounded-full bg-warn-light px-1.5 py-0.5 text-[10px] font-bold text-ink">Effort {n.difficulty}/5</span>
								{/if}
							</p>
							{#if n.note}<p class="mt-1 whitespace-pre-line text-ink">💬 {n.note}</p>{/if}
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		<!-- ── Vue par semaine (une ligne par semaine du programme) ── -->
		{#if weekGroups.length > 0}
			<div class="mt-3">
				<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Vue par semaine</p>
				<div class="mt-2 space-y-1.5">
					{#each weekGroups as w (w.index)}
						<div class="min-w-0 overflow-hidden rounded-xl border {w.isCurrent ? 'border-brand/50 bg-brand-light/20' : 'border-line bg-white'}">
							<button
								type="button"
								onclick={() => (openWeek = openWeek === w.index ? null : w.index)}
								aria-expanded={openWeek === w.index}
								class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
							>
								<span class="min-w-0 truncate text-xs font-semibold {w.isCurrent ? 'text-brand-dark' : 'text-ink'}">
									Semaine {w.index} · {w.label}
									{#if w.isCurrent}<span class="ml-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold text-white">en cours</span>{/if}
								</span>
								<span class="shrink-0 text-[10px] font-semibold tabular-nums text-mist">{w.done}/{w.sessions.length}</span>
							</button>
							{#if openWeek === w.index}
								<div class="space-y-1 border-t border-line/70 px-2 py-2">
									{#each w.sessions as s (s._id)}
										<div class="min-w-0">
											<button
												type="button"
												onclick={() => (openNote = openNote === s._id ? null : s._id)}
												aria-expanded={openNote === s._id}
												aria-label="Voir le détail de la séance"
												data-status={statusOf(s)}
												class="flex w-full min-w-0 flex-col gap-1 rounded-lg border border-line bg-white px-2.5 py-2 text-left text-xs transition hover:border-brand/50"
											>
												<span class="flex min-w-0 items-baseline justify-between gap-2">
													<span class="min-w-0 flex-1 truncate font-bold uppercase tracking-wide text-ink">{s.sessionName ?? 'Séance'}</span>
													<span class="shrink-0 text-[10px] font-semibold capitalize text-mist">{fmtDay(s.date)}</span>
												</span>
												<span class="flex flex-wrap items-center gap-1.5">
													<span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold {STATUS_TONE[statusOf(s)]}">{TRAINING_STATUS_LABELS[statusOf(s)]}</span>
													{#if statusOf(s) === 'done'}
														{#if durationLabel(s)}<span class="text-[10px] font-semibold text-mist">{durationLabel(s)}</span>{/if}
														{#if s.difficulty != null}<span class="text-[10px] font-semibold text-mist">Effort {s.difficulty}/5</span>{/if}
													{/if}
												</span>
											</button>
											{#if openNote === s._id}
												<div class="mt-1 rounded-lg bg-brand-light/40 px-2.5 py-2 text-[11px] text-ink">
													{#if s.difficulty != null}
														<p class="font-semibold">Effort {s.difficulty}/5</p>
													{/if}
													{#if s.note}
														<p class="mt-0.5 whitespace-pre-line">💬 {s.note}</p>
													{:else}
														<p class="mt-0.5 text-mist">Aucune note de la cliente.</p>
													{/if}
													{#if statusOf(s) === 'done'}
														<div class="mt-1.5 border-t border-brand/20 pt-1.5">
															{#if sessionDetailBusy}
																<p class="text-mist">Chargement des séries…</p>
															{:else if sessionDetail && sessionDetail._id === s._id}
																{#if sessionDetail.exercises.length === 0}
																	<p class="text-mist">Aucune série enregistrée.</p>
																{:else}
																	<ul class="space-y-1">
																		{#each sessionDetail.exercises as ex (ex.exerciseId)}
																			<li class="min-w-0">
																				<p class="break-words font-semibold">{displayExerciseName(ex.name)}</p>
																				<p class="break-words text-mist">
																					{ex.sets.map(formatLoggedSet).join(' · ')}{#if ex.volumeKg != null}<span class="whitespace-nowrap"> · {fmtKg(ex.volumeKg)} kg</span>{/if}
																				</p>
																			</li>
																		{/each}
																	</ul>
																	{#if sessionDetail.volumeKg != null}
																		<p class="mt-1 font-semibold">Volume total : {fmtKg(sessionDetail.volumeKg)} kg</p>
																	{/if}
																{/if}
															{/if}
														</div>
													{/if}
													<div class="mt-2 flex flex-wrap gap-1.5">
														<button type="button" onclick={() => { moveFor = s; moveDate = s.date; }} class="rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-semibold text-ink transition hover:border-brand">Déplacer</button>
														<button type="button" onclick={() => { dupFor = s; dupDate = s.date; }} class="rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-semibold text-ink transition hover:border-brand">Dupliquer</button>
														{#if s.status === 'planned'}
															<button type="button" onclick={() => cancelOccurrence(s, true)} class="rounded-lg border border-danger/40 bg-white px-2 py-1 text-[10px] font-semibold text-danger transition hover:border-danger">Annuler</button>
														{:else}
															<button type="button" onclick={() => cancelOccurrence(s, false)} class="rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-semibold text-ink transition hover:border-brand">Restaurer</button>
														{/if}
													</div>
												</div>
											{/if}
										</div>
									{/each}
									{#if w.sessions.length === 0}
										<p class="px-1 py-1 text-[11px] text-mist">Aucune séance cette semaine.</p>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- ── Charges & progression (départ → actuel, écart, séances) ── -->
		{#if tracked.length > 0}
			<details class="mt-3">
				<summary class="cursor-pointer text-xs font-semibold text-mist hover:text-ink">Charges & progression par exercice ({tracked.length})</summary>
				<div class="mt-2 space-y-1">
					{#each tracked as ex (ex.exerciseId)}
						<button
							type="button"
							onclick={() => openExercise(ex)}
							class="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-xs transition hover:border-brand/60"
						>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-semibold text-ink">{displayExerciseName(ex.name)}</span>
								<span class="mt-0.5 block text-[10px] leading-snug text-mist">
									{valueLabel(ex.startValue, ex.unit)}
									<span class="capitalize">({fmtISO(ex.startDate)})</span>
									→ {valueLabel(ex.currentValue, ex.unit)}
									<span class="capitalize">({fmtISO(ex.currentDate)})</span>
									· {ex.sessions} séance{ex.sessions > 1 ? 's' : ''}
								</span>
							</span>
							<span class="shrink-0 text-[11px] font-bold tabular-nums {deltaTone(ex.delta)}">{progressionDeltaLabel(ex)}</span>
						</button>
					{/each}
				</div>
			</details>
		{/if}

		<!-- ── Historique des programmes retirés ── -->
		{#if assignments.filter((a) => a.removedAt).length > 0}
			<details class="mt-3">
				<summary class="cursor-pointer text-xs font-semibold text-mist hover:text-ink">Historique des programmes retirés ({assignments.filter((a) => a.removedAt).length})</summary>
				<ul class="mt-2 flex flex-col gap-1.5">
					{#each assignments.filter((a) => a.removedAt) as a (a._id)}
						<li class="rounded-lg border border-line px-3 py-2 text-xs text-mist">
							<strong class="text-ink">{a.programName}</strong> · {fmtISO(a.startDate)} → {fmtISO(a.endDate)}
							· {a.completedCount} séance(s) réalisée(s)
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
</div>

<!-- ── Détail d'un exercice (dernière / meilleure / courbe) ── -->
{#if exDetail}
	<button type="button" class="fixed inset-0 z-[70] cursor-pointer bg-ink/50" aria-label="Fermer" onclick={() => (exDetail = null)}></button>
	<div class="fixed inset-x-0 bottom-0 z-[70] mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:rounded-l-3xl">
		<div class="flex items-center justify-between">
			<h4 class="font-display text-base font-semibold text-ink">{exDetail.name}</h4>
			<button type="button" onclick={() => (exDetail = null)} class="rounded-lg px-2 py-1 text-lg text-mist hover:text-ink" aria-label="Fermer">✕</button>
		</div>
		<div class="mt-3 grid grid-cols-2 gap-2">
			<div class="rounded-xl border border-line p-3">
				<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Dernière perf</p>
				{#if exDetail.last}
					<p class="mt-1 text-sm font-bold text-ink">
						{exDetail.last.mode === 'time'
							? `${exDetail.last.durationSeconds ?? '—'} s`
							: `${exDetail.last.reps ?? '—'} reps × ${exDetail.last.weightKg != null ? fmtKg(exDetail.last.weightKg) + ' kg' : '—'}`}
					</p>
					<p class="text-[11px] text-mist capitalize">{fmtISO(exDetail.last.date)}</p>
				{:else}
					<p class="mt-1 text-sm text-mist">—</p>
				{/if}
			</div>
			<div class="rounded-xl border border-line p-3">
				<p class="text-[10px] font-bold uppercase tracking-widest text-mist">Meilleure perf</p>
				{#if exDetail.best}
					<p class="mt-1 text-sm font-bold text-ink">
						{exDetail.best.mode === 'time'
							? `${exDetail.best.durationSeconds ?? '—'} s`
							: `${exDetail.best.reps ?? '—'} reps × ${exDetail.best.weightKg != null ? fmtKg(exDetail.best.weightKg) + ' kg' : '—'}`}
					</p>
					<p class="text-[11px] text-mist capitalize">{fmtISO(exDetail.best.date)}</p>
				{:else}
					<p class="mt-1 text-sm text-mist">—</p>
				{/if}
			</div>
		</div>
		{#if exDetail.timeline.length > 1}
			<p class="mt-4 text-[10px] font-bold uppercase tracking-widest text-mist">Évolution (meilleure charge / jour)</p>
			<div class="mt-2 flex h-28 items-end gap-1">
				{#each exDetail.timeline as t (t.date)}
					<div class="flex-1" title="{t.date} : {t.weightKg != null ? fmtKg(t.weightKg) + ' kg' : 'sans charge'}">
						<div class="w-full rounded-t bg-brand/80" style="height: {Math.max(4, ((t.weightKg ?? 0) / maxTimeline) * 100)}%"></div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="mt-4 text-xs text-mist">Pas encore assez de séances pour tracer une évolution.</p>
		{/if}
	</div>
{/if}

<!-- ── Modale ASSIGNER ── -->
{#if assignOpen}
	<button type="button" class="fixed inset-0 z-[70] cursor-pointer bg-ink/50" aria-label="Fermer" onclick={() => (assignOpen = false)}></button>
	<div class="fixed inset-x-0 bottom-0 z-[70] mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:rounded-l-3xl">
		<div class="flex items-center justify-between">
			<h4 class="font-display text-base font-semibold text-ink">Assigner un programme</h4>
			<button type="button" onclick={() => (assignOpen = false)} class="rounded-lg px-2 py-1 text-lg text-mist hover:text-ink" aria-label="Fermer">✕</button>
		</div>
		<label class="mt-4 block">
			<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Programme</span>
			<select bind:value={assignProgramId} onchange={pickAssignProgram} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand">
				<option value="" disabled>Sélectionner…</option>
				{#each programs as p (p._id)}
					<option value={p._id}>{p.name} · {p.sessionCount} séance(s)</option>
				{/each}
			</select>
		</label>
		<div class="mt-3 grid grid-cols-2 gap-2">
			<label class="block">
				<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Début</span>
				<input type="date" bind:value={assignStart} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand" />
			</label>
			<label class="block">
				<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Durée</span>
				<select bind:value={assignWeeks} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand">
					{#each [3, 4, 6, 8, 12] as w (w)}<option value={String(w)}>{w} semaines</option>{/each}
				</select>
			</label>
		</div>
		<fieldset class="mt-3">
			<legend class="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-mist">Jours de séance (modifiable)</legend>
			<div class="flex gap-1.5">
				{#each [1, 2, 3, 4, 5, 6, 7] as d (d)}
					<button
						type="button"
						onclick={() => (assignDays = toggleDay(assignDays, d))}
						class="grid h-9 w-9 place-items-center rounded-full border-2 text-xs font-bold transition {assignDays.includes(d) ? 'border-brand bg-brand text-white' : 'border-line text-mist hover:border-brand'}"
					>{DAY_LABELS[d - 1]}</button>
				{/each}
			</div>
		</fieldset>
		<p class="mt-3 text-[11px] leading-snug text-mist">
			Une <strong class="text-ink">copie indépendante</strong> du programme est créée : le modifier ensuite ne changera pas ce que ta cliente suit. Les séances se placent en boucle sur les jours cochés.
		</p>
		<button
			type="button"
			onclick={submitAssign}
			disabled={assignBusy || !assignProgramId || assignDays.length === 0}
			class="mt-4 w-full rounded-full bg-brand px-3 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
		>
			{assignBusy ? 'Assignation…' : 'Assigner ce programme'}
		</button>
	</div>
{/if}

<!-- ── Modale REMPLACER ── -->
{#if replaceOpen && activeAssignment}
	<button type="button" class="fixed inset-0 z-[70] cursor-pointer bg-ink/50" aria-label="Fermer" onclick={() => (replaceOpen = false)}></button>
	<div class="fixed inset-x-0 bottom-0 z-[70] mx-auto w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:rounded-l-3xl">
		<div class="flex items-center justify-between">
			<h4 class="font-display text-base font-semibold text-ink">Remplacer le programme</h4>
			<button type="button" onclick={() => (replaceOpen = false)} class="rounded-lg px-2 py-1 text-lg text-mist hover:text-ink" aria-label="Fermer">✕</button>
		</div>
		<p class="mt-2 rounded-lg bg-warn-light px-3 py-2 text-[11px] leading-snug text-ink">
			Les séances <strong>futures non réalisées</strong> du programme actuel sont annulées. Les séances déjà réalisées, leurs charges, reps, notes et tout l'historique de progression sont <strong>conservés</strong>.
		</p>
		<label class="mt-3 block">
			<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Nouveau programme</span>
			<select bind:value={replaceProgramId} onchange={pickReplaceProgram} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand">
				<option value="" disabled>Sélectionner…</option>
				{#each programs as p (p._id)}
					<option value={p._id}>{p.name} · {p.sessionCount} séance(s)</option>
				{/each}
			</select>
		</label>
		<div class="mt-3 grid grid-cols-2 gap-2">
			<label class="block">
				<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Nouveau début</span>
				<input type="date" bind:value={replaceStart} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand" />
			</label>
			<label class="block">
				<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Durée</span>
				<select bind:value={replaceWeeks} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand">
					{#each [3, 4, 6, 8, 12] as w (w)}<option value={String(w)}>{w} semaines</option>{/each}
				</select>
			</label>
		</div>
		<fieldset class="mt-3">
			<legend class="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-mist">Jours de séance</legend>
			<div class="flex gap-1.5">
				{#each [1, 2, 3, 4, 5, 6, 7] as d (d)}
					<button
						type="button"
						onclick={() => (replaceDays = toggleDay(replaceDays, d))}
						class="grid h-9 w-9 place-items-center rounded-full border-2 text-xs font-bold transition {replaceDays.includes(d) ? 'border-brand bg-brand text-white' : 'border-line text-mist hover:border-brand'}"
					>{DAY_LABELS[d - 1]}</button>
				{/each}
			</div>
		</fieldset>
		<button
			type="button"
			onclick={submitReplace}
			disabled={replaceBusy || !replaceProgramId || replaceDays.length === 0}
			class="mt-4 w-full rounded-full bg-brand px-3 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
		>
			{replaceBusy ? 'Remplacement…' : 'Remplacer (futures annulées, historique conservé)'}
		</button>
	</div>
{/if}

<!-- ── Feuille DÉPLACER ── -->
{#if moveFor}
	<button type="button" class="fixed inset-0 z-[70] cursor-pointer bg-ink/50" aria-label="Fermer" onclick={() => (moveFor = null)}></button>
	<div class="fixed inset-x-0 bottom-0 z-[70] mx-auto w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:rounded-l-3xl">
		<h4 class="font-display text-base font-semibold text-ink">Déplacer la séance</h4>
		<label class="mt-3 block">
			<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Nouvelle date</span>
			<input type="date" bind:value={moveDate} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand" />
		</label>
		<div class="mt-4 grid gap-2">
			<button type="button" disabled={!moveDate} onclick={moveOccurrence} class="rounded-full bg-brand px-3 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60">Déplacer ici</button>
			<button type="button" onclick={() => (moveFor = null)} class="rounded-full border-2 border-line px-3 py-2.5 text-sm font-semibold text-ink">Annuler</button>
		</div>
	</div>
{/if}

<!-- ── Feuille DUPLIQUER ── -->
{#if dupFor}
	<button type="button" class="fixed inset-0 z-[70] cursor-pointer bg-ink/50" aria-label="Fermer" onclick={() => (dupFor = null)}></button>
	<div class="fixed inset-x-0 bottom-0 z-[70] mx-auto w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:rounded-l-3xl">
		<h4 class="font-display text-base font-semibold text-ink">Dupliquer la séance</h4>
		<label class="mt-3 block">
			<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Date de la copie</span>
			<input type="date" bind:value={dupDate} class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm outline-none focus:border-brand" />
		</label>
		<div class="mt-4 grid gap-2">
			<button type="button" disabled={!dupDate} onclick={duplicateOccurrence} class="rounded-full bg-brand px-3 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60">Créer la copie</button>
			<button type="button" onclick={() => (dupFor = null)} class="rounded-full border-2 border-line px-3 py-2.5 text-sm font-semibold text-ink">Annuler</button>
		</div>
	</div>
{/if}
