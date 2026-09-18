<script lang="ts">
	/**
	 * Éditeur de programme — vue 3 colonnes (ergonomie type VirtuaGym, design
	 * G-FLUX) :
	 *   gauche   : structure du programme (séances, drag & drop, dupliquer…) ;
	 *   centre   : exercices de la séance sélectionnée (drag & drop, ajout,
	 *              aperçu compact de la prescription) ;
	 *   droite   : fiche de prescription de l'exercice sélectionné (séries,
	 *              reps/plage, charge, RIR, repos, tempo, notes ; mode temps).
	 *
	 * Sauvegarde : AUTOSAVE — chaque champ texte est debouncé (600 ms) vers le
	 * BFF ; les actions structurelles (ajouter/dupliquer/supprimer/réordonner)
	 * écrivent immédiatement puis rechargent le programme complet (fiabilité).
	 * Les écritures ciblées (PATCH) évitent d'écraser un champ en cours de
	 * frappe ailleurs.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import ExerciseMedia from '$lib/components/ExerciseMedia.svelte';
	import ExerciseLibraryBrowser from '$lib/components/ExerciseLibraryBrowser.svelte';
	import {
		type SessionView,
		type SessionExerciseView,
		type ProgramView,
		exercisePreview,
		repsLabel,
		parseRepsField,
	} from '$lib/training';

	type Props = {
		program: ProgramView;
		sessions: SessionView[];
		/** Remonte l'état de sauvegarde à la page (indicateur discret). */
		onSaveState?: (s: 'idle' | 'saving' | 'saved' | 'error') => void;
		/** Recharge le programme complet côté page (après action structurelle). */
		onReload: () => Promise<void>;
		/** Retour à la liste des programmes. */
		onBack: () => void;
	};

	let { program, sessions, onSaveState, onReload, onBack }: Props = $props();

	let selectedSessionId = $state<string | null>(null);
	let selectedExerciseId = $state<string | null>(null);
	let pickerOpen = $state(false);
	let addedIds = $state(new Set<string>());
	let actionErr = $state('');

	/* Champs du programme en édition (init une fois par programme) */
	let programKey = $state('');
	let pName = $state('');
	let pDesc = $state('');
	let pGoal = $state('');
	let pLevel = $state('');
	let pSpw = $state<string>('');
	$effect(() => {
		if (programKey !== program._id) {
			programKey = program._id;
			pName = program.name;
			pDesc = program.description ?? '';
			pGoal = program.goal ?? '';
			pLevel = program.level ?? '';
			pSpw = program.sessionsPerWeek ? String(program.sessionsPerWeek) : '';
			selectedSessionId = sessions[0]?._id ?? null;
			selectedExerciseId = null;
		}
	});

	const selectedSession = $derived(sessions.find((s) => s._id === selectedSessionId) ?? null);
	const selectedExercise = $derived(
		selectedSession?.exercises.find((e) => e._id === selectedExerciseId) ?? null
	);

	function selectSession(id: string) {
		selectedSessionId = id;
		selectedExerciseId = null;
	}

	/* ── Sauvegarde : état + helpers ── */
	let saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	function saveState(s: 'idle' | 'saving' | 'saved' | 'error') {
		onSaveState?.(s);
	}
	async function send(method: string, url: string, body?: unknown): Promise<unknown | null> {
		saveState('saving');
		try {
			const r = await fetch(url, {
				method,
				headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok || j.error) throw new Error(j.error ?? 'Erreur de sauvegarde.');
			saveState('saved');
			actionErr = '';
			return j;
		} catch (e) {
			saveState('error');
			actionErr = e instanceof Error ? e.message : 'Erreur de sauvegarde.';
			return null;
		}
	}

	/** Debounce par clé (une frappe = un PATCH planifié). */
	function debounced(key: string, fn: () => Promise<unknown> | void, delay = 600) {
		const prev = saveTimers.get(key);
		if (prev) clearTimeout(prev);
		saveTimers.set(
			key,
			setTimeout(() => {
				saveTimers.delete(key);
				void fn();
			}, delay)
		);
	}

	/* ── Champs du programme (autosave) ── */
	function patchProgram(fields: Record<string, unknown>) {
		void send('PATCH', `/api/coach/training/programs/${program._id}`, fields);
	}
	function onProgramField(key: 'name' | 'description' | 'goal' | 'level' | 'sessionsPerWeek') {
		debounced(`prog-${key}`, () => {
			if (key === 'sessionsPerWeek') {
				const n = Number(pSpw);
				return send('PATCH', `/api/coach/training/programs/${program._id}`, {
					sessionsPerWeek: pSpw === '' || !Number.isFinite(n) || n < 1 ? null : Math.min(7, Math.round(n)),
				});
			}
			const value = key === 'description' ? pDesc : key === 'name' ? pName : pGoal || null;
			const payloadKey = key === 'goal' ? 'goal' : key === 'level' ? 'level' : key;
			const payload =
				key === 'level'
					? pLevel || null
					: value;
			return send('PATCH', `/api/coach/training/programs/${program._id}`, { [payloadKey]: payload });
		});
	}

	/* ── Séances ── */
	async function addSession() {
		const res = (await send('POST', `/api/coach/training/sessions?programId=${program._id}`, {})) as
			| { sessionId?: string }
			| null;
		if (res) {
			await onReload();
			if (res.sessionId) selectSession(res.sessionId);
		}
	}
	function renameSessionDebounced(id: string, name: string) {
		debounced(`sess-${id}`, () => send('PATCH', `/api/coach/training/sessions/${id}`, { name }));
	}
	async function duplicateSession(id: string) {
		const res = (await send('POST', `/api/coach/training/sessions/${id}`)) as { sessionId?: string } | null;
		if (res) {
			await onReload();
			if (res.sessionId) selectSession(res.sessionId);
		}
	}
	async function deleteSession(id: string) {
		const s = sessions.find((x) => x._id === id);
		const label = s ? `« ${s.name} »` : 'cette séance';
		if (!confirm(`Supprimer ${label} et tous ses exercices ?`)) return;
		if (await send('DELETE', `/api/coach/training/sessions/${id}`)) {
			if (selectedSessionId === id) {
				selectedSessionId = null;
				selectedExerciseId = null;
			}
			await onReload();
		}
	}

	/* ── Drag & drop séances (HTML5 natif) ── */
	let dragSessionId = $state<string | null>(null);
	let dragOverSessionId = $state<string | null>(null);
	function onSessionDragStart(e: DragEvent, id: string) {
		dragSessionId = id;
		e.dataTransfer?.setData('text/plain', id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	function onSessionDragOver(e: DragEvent, id: string) {
		if (!dragSessionId || dragSessionId === id) return;
		e.preventDefault();
		dragOverSessionId = id;
	}
	async function onSessionDrop(e: DragEvent, targetId: string) {
		e.preventDefault();
		dragOverSessionId = null;
		const srcId = dragSessionId;
		dragSessionId = null;
		if (!srcId || srcId === targetId) return;
		const ids = sessions.map((s) => s._id).filter((id) => id !== srcId);
		const idx = ids.indexOf(targetId);
		ids.splice(idx < 0 ? ids.length : idx, 0, srcId);
		// Mise à jour locale immédiate (feedback), écriture puis reload.
		await send('PUT', '/api/coach/training/sessions', { programId: program._id, orderedIds: ids });
		await onReload();
	}

	/* ── Exercices de la séance ── */
	async function openPicker() {
		if (!selectedSessionId) {
			actionErr = 'Sélectionne d’abord une séance dans la colonne de gauche.';
			return;
		}
		addedIds = new Set();
		pickerOpen = true;
	}
	async function addFromLibrary(exerciseId: string) {
		if (!selectedSessionId || addedIds.has(exerciseId)) return;
		addedIds = new Set([...addedIds, exerciseId]);
		if (await send('POST', '/api/coach/training/session-exercises', { sessionId: selectedSessionId, exerciseId })) {
			await onReload();
		}
	}
	async function duplicateExercise(id: string) {
		if (await send('POST', `/api/coach/training/session-exercises/${id}`)) await onReload();
	}
	async function removeExercise(id: string) {
		if (!confirm('Retirer cet exercice de la séance ?')) return;
		if (selectedExerciseId === id) selectedExerciseId = null;
		if (await send('DELETE', `/api/coach/training/session-exercises/${id}`)) await onReload();
	}

	/* ── Drag & drop exercices ── */
	let dragExId = $state<string | null>(null);
	let dragOverExId = $state<string | null>(null);
	function onExDragStart(e: DragEvent, id: string) {
		if (!selectedSession) return;
		dragExId = id;
		e.dataTransfer?.setData('text/plain', id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	function onExDragOver(e: DragEvent, id: string) {
		if (!dragExId || dragExId === id) return;
		e.preventDefault();
		dragOverExId = id;
	}
	async function onExDrop(e: DragEvent, targetId: string) {
		e.preventDefault();
		dragOverExId = null;
		const srcId = dragExId;
		dragExId = null;
		if (!srcId || !selectedSession || srcId === targetId) return;
		const ids = selectedSession.exercises.map((x) => x._id).filter((x) => x !== srcId);
		const idx = ids.indexOf(targetId);
		ids.splice(idx < 0 ? ids.length : idx, 0, srcId);
		await send('PUT', '/api/coach/training/session-exercises', { sessionId: selectedSession._id, orderedIds: ids });
		await onReload();
	}

	/* ── Prescription de l'exercice sélectionné ── */
	function patchExercise(id: string, fields: Record<string, unknown>) {
		void send('PATCH', `/api/coach/training/session-exercises/${id}`, fields);
	}
	function setMode(mode: 'reps' | 'time') {
		if (!selectedExercise) return;
		patchExercise(selectedExercise._id, { mode });
		void onReload();
	}
	function onTempoInput() {
		if (!selectedExercise) return;
		const id = selectedExercise._id;
		debounced(`tempo-${id}`, () => patchExercise(id, { tempo: selectedExercise?.tempo ?? null }));
	}
	function onCoachNoteInput() {
		if (!selectedExercise) return;
		const id = selectedExercise._id;
		debounced(`note-${id}`, () => patchExercise(id, { coachNote: selectedExercise?.coachNote ?? null }));
	}
	function onTechniqueInput() {
		if (!selectedExercise) return;
		const id = selectedExercise._id;
		debounced(`tech-${id}`, () => patchExercise(id, { techniqueNote: selectedExercise?.techniqueNote ?? null }));
	}

	/* ── Séries ── */
	async function addSet() {
		if (!selectedExercise) return;
		if (await send('POST', '/api/coach/training/sets', { sessionExerciseId: selectedExercise._id })) await onReload();
	}
	async function duplicateSet(setId: string) {
		if (await send('POST', `/api/coach/training/sets/${setId}`)) await onReload();
	}
	async function deleteSet(setId: string) {
		if (await send('DELETE', `/api/coach/training/sets/${setId}`)) await onReload();
	}
	/** Reps : champ unique « 8-12 » ou « 10 » → PATCH repsMin/repsMax. */
	function onRepsInput(setId: string, raw: string) {
		debounced(`reps-${setId}`, () => {
			const parsed = parseRepsField(raw);
			if (!parsed) return; // saisie en cours — rien n'est envoyé tant que ce n'est pas valide
			return send('PATCH', '/api/coach/training/sets', {
				setId,
				repsMin: parsed.repsMin,
				repsMax: parsed.repsMax,
			});
		});
	}
	function onSetNumberInput(setId: string, field: 'targetWeight' | 'targetRir' | 'restSeconds' | 'durationSeconds', raw: string) {
		debounced(`set-${field}-${setId}`, () => {
			const t = raw.trim().replace(',', '.');
			const n = Number(t);
			return send('PATCH', '/api/coach/training/sets', {
				setId,
				[field]: t === '' || !Number.isFinite(n) ? null : n,
			});
		});
	}
</script>

<div class="flex flex-col gap-4">
	<!-- ── En-tête programme (édition directe) ── -->
	<div class="flex flex-wrap items-center gap-3">
		<button
			type="button"
			onclick={onBack}
			class="flex items-center gap-1 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink shadow-sm transition hover:border-brand"
		>
			<Icon name="arrowLeft" size={14} /> Programmes
		</button>
		<input
			bind:value={pName}
			oninput={() => onProgramField('name')}
			aria-label="Nom du programme"
			class="min-w-48 flex-1 rounded-xl border-2 border-transparent bg-transparent px-2 py-1 font-display text-xl font-bold text-ink outline-none transition hover:border-line focus:border-brand focus:bg-white"
		/>
		<select bind:value={pGoal} onchange={() => onProgramField('goal')} class="rounded-xl border border-line bg-card px-2.5 py-1.5 text-xs font-semibold text-ink outline-none focus:border-brand">
			<option value="">Objectif…</option>
			<option value="hypertrophie">Hypertrophie</option>
			<option value="perte_de_gras">Perte de gras</option>
			<option value="remise_en_forme">Remise en forme</option>
			<option value="force">Force</option>
			<option value="autre">Autre</option>
		</select>
		<select bind:value={pLevel} onchange={() => onProgramField('level')} class="rounded-xl border border-line bg-card px-2.5 py-1.5 text-xs font-semibold text-ink outline-none focus:border-brand">
			<option value="">Niveau…</option>
			<option value="debutante">Débutante</option>
			<option value="intermediaire">Intermédiaire</option>
			<option value="avancee">Avancée</option>
		</select>
		<label class="flex items-center gap-1.5 text-xs font-semibold text-mist">
			<span class="whitespace-nowrap">séances/sem.</span>
			<input
				type="number"
				min="1"
				max="7"
				bind:value={pSpw}
				oninput={() => onProgramField('sessionsPerWeek')}
				class="w-14 rounded-xl border border-line bg-card px-2 py-1.5 text-center text-xs font-semibold text-ink tabular-nums outline-none focus:border-brand"
			/>
		</label>
	</div>

	{#if actionErr}
		<p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{actionErr}</p>
	{/if}

	<!-- ── 3 colonnes ── -->
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
		<!-- COLONNE GAUCHE — structure -->
		<section class="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
			<header class="flex items-center justify-between border-b border-line bg-line/30 px-3 py-2.5">
				<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Séances</h2>
				<button
					type="button"
					onclick={addSession}
					class="flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110"
				>
					<Icon name="plus" size={12} /> Ajouter
				</button>
			</header>
			<ul class="max-h-[62vh] overflow-y-auto p-2">
				{#each sessions as s, i (s._id)}
					<li
						draggable="true"
						ondragstart={(e) => onSessionDragStart(e, s._id)}
						ondragover={(e) => onSessionDragOver(e, s._id)}
						ondragleave={() => (dragOverSessionId === s._id ? (dragOverSessionId = null) : null)}
						ondrop={(e) => onSessionDrop(e, s._id)}
						class="group mb-1 rounded-xl border transition {selectedSessionId === s._id
							? 'border-brand bg-brand-light/60'
							: 'border-transparent hover:border-line'} {dragOverSessionId === s._id ? 'border-t-2 border-t-brand' : ''}"
					>
						<div class="flex items-center gap-1 px-2 py-2">
							<Icon name="rows3" size={13} class="cursor-grab shrink-0 text-mist" />
							<button type="button" class="min-w-0 flex-1 text-left" onclick={() => selectSession(s._id)}>
								<span class="block truncate text-[13px] font-bold text-ink">{s.name}</span>
								<span class="block text-[10px] text-mist">{s.exercises.length} exercice{s.exercises.length > 1 ? 's' : ''}</span>
							</button>								<span class="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
									<button
										type="button"
										title="Renommer"
										class="rounded-lg p-1 text-mist transition hover:bg-white hover:text-brand"
										onclick={() => {
											const name = prompt('Nom de la séance :', s.name);
											if (name && name.trim()) renameSessionDebounced(s._id, name.trim());
										}}
									>
										<Icon name="pencil" size={13} />
									</button>
								<button
									type="button"
									title="Dupliquer"
									class="rounded-lg p-1 text-mist transition hover:bg-white hover:text-brand"
									onclick={() => duplicateSession(s._id)}
								>
									<Icon name="copy" size={13} />
								</button>
								<button
									type="button"
									title="Supprimer"
									class="rounded-lg p-1 text-mist transition hover:bg-white hover:text-red-600"
									onclick={() => deleteSession(s._id)}
								>
									<Icon name="trash" size={13} />
								</button>
							</span>
						</div>
					</li>
				{/each}
				{#if sessions.length === 0}
					<li class="px-3 py-6 text-center text-xs text-mist">Aucune séance — clique « Ajouter ».</li>
				{/if}
			</ul>
		</section>

		<!-- COLONNE CENTRALE — exercices de la séance -->
		<section class="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
			<header class="flex items-center justify-between border-b border-line bg-line/30 px-3 py-2.5">
				<h2 class="min-w-0 truncate text-[11px] font-bold uppercase tracking-widest text-mist">
					{selectedSession ? selectedSession.name : 'Exercices'}
				</h2>
				<button
					type="button"
					onclick={openPicker}
					class="flex shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110"
				>
					<Icon name="plus" size={12} /> Ajouter un exercice
				</button>
			</header>

			{#if !selectedSession}
				<div class="px-6 py-16 text-center">
					<div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-light">
						<Icon name="layers" size={22} class="text-brand" />
					</div>
					<p class="text-sm font-semibold text-ink">Choisis une séance</p>
					<p class="mt-1 text-xs text-mist">Sélectionne un jour à gauche pour voir ses exercices.</p>
				</div>
			{:else if selectedSession.exercises.length === 0}
				<div class="px-6 py-16 text-center">
					<div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-light">
						<Icon name="dumbbell" size={22} class="text-brand" />
					</div>
					<p class="text-sm font-semibold text-ink">Séance vide</p>
					<p class="mt-1 text-xs text-mist">« Ajouter un exercice » ouvre la bibliothèque G-FLUX.</p>
				</div>
			{:else}
				<ul class="max-h-[62vh] overflow-y-auto p-2">
					{#each selectedSession.exercises as ex (ex._id)}
						<li
							draggable="true"
							ondragstart={(e) => onExDragStart(e, ex._id)}
							ondragover={(e) => onExDragOver(e, ex._id)}
							ondragleave={() => (dragOverExId === ex._id ? (dragOverExId = null) : null)}
							ondrop={(e) => onExDrop(e, ex._id)}
							class="group mb-1 rounded-xl border transition {selectedExerciseId === ex._id
								? 'border-brand bg-brand-light/60'
								: 'border-transparent hover:border-line'} {dragOverExId === ex._id ? 'border-t-2 border-t-brand' : ''}"
						>
							<div class="flex items-center gap-2.5 px-2 py-2">
								<Icon name="rows3" size={13} class="cursor-grab shrink-0 text-mist" />
								<button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 text-left" onclick={() => (selectedExerciseId = ex._id)}>
									<span class="relative block h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-line/40">
										<ExerciseMedia src={ex.exercise?.thumbnailUrl} fallbackUrl={ex.exercise?.mediaUrl} class="h-full w-full object-cover" />
									</span>
									<span class="min-w-0">
										<span class="block truncate text-[13px] font-semibold text-ink">{ex.exercise?.name ?? 'Exercice supprimé'}</span>
										<span class="block truncate text-[11px] text-mist">{exercisePreview(ex)}</span>
									</span>
								</button>
								<span class="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
									<button
										type="button"
										title="Dupliquer"
										class="rounded-lg p-1 text-mist transition hover:bg-white hover:text-brand"
										onclick={() => duplicateExercise(ex._id)}
									>
										<Icon name="copy" size={13} />
									</button>
									<button
										type="button"
										title="Retirer"
										class="rounded-lg p-1 text-mist transition hover:bg-white hover:text-red-600"
										onclick={() => removeExercise(ex._id)}
									>
										<Icon name="trash" size={13} />
									</button>
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- COLONNE DROITE — prescription -->
		<section class="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
			{#if !selectedExercise}
				<div class="px-6 py-16 text-center">
					<div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-light">
						<Icon name="target" size={22} class="text-brand" />
					</div>
					<p class="text-sm font-semibold text-ink">Prescription</p>
					<p class="mt-1 text-xs text-mist">Clique un exercice pour régler séries, reps, charge, RIR et repos.</p>
				</div>
			{:else}
				<div class="max-h-[66vh] overflow-y-auto p-4">
					<!-- Fiche bibliothèque -->
					<div class="mb-3 flex items-start gap-3">
					<span class="relative block h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-line/40">
						<ExerciseMedia
							src={selectedExercise.exercise?.mediaUrl ?? selectedExercise.exercise?.thumbnailUrl}
							fallbackUrl={selectedExercise.exercise?.sourceMediaUrl}
							loading="eager"
							class="h-full w-full object-cover"
						/>
						</span>
						<div class="min-w-0">
							<h3 class="font-display text-base font-bold leading-tight text-ink">{selectedExercise.exercise?.name ?? 'Exercice supprimé'}</h3>
							<p class="mt-0.5 text-[11px] text-mist">
								{selectedExercise.exercise?.muscleGroup ?? '—'}{selectedExercise.exercise?.equipment ? ` · ${selectedExercise.exercise.equipment}` : ''}
							</p>
						</div>
					</div>

					<!-- Mode -->
					<div class="mb-3 flex gap-1.5">
						<button
							type="button"
							onclick={() => setMode('reps')}
							class="flex-1 rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition {selectedExercise.mode === 'reps'
								? 'border-brand bg-brand text-white'
								: 'border-line bg-white text-ink hover:border-brand'}"
						>
							Répétitions
						</button>
						<button
							type="button"
							onclick={() => setMode('time')}
							class="flex-1 rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition {selectedExercise.mode === 'time'
								? 'border-brand bg-brand text-white'
								: 'border-line bg-white text-ink hover:border-brand'}"
						>
							Temps
						</button>
					</div>

					<!-- Séries -->
					{#if selectedExercise.mode === 'reps'}
						<table class="mb-2 w-full text-xs">
							<thead>
								<tr class="text-[10px] uppercase tracking-wider text-mist">
									<th class="w-6 pb-1 text-left font-bold">#</th>
									<th class="pb-1 text-left font-bold">Reps</th>
									<th class="pb-1 text-left font-bold">Charge</th>
									<th class="pb-1 text-left font-bold">RIR</th>
									<th class="pb-1 text-left font-bold">Repos</th>
									<th class="w-12 pb-1"></th>
								</tr>
							</thead>
							<tbody>
								{#each selectedExercise.sets as st, i (st._id)}
									<tr class="border-t border-line/60">
										<td class="py-1 pr-1 font-bold text-mist tabular-nums">{i + 1}</td>
										<td class="py-1 pr-1">
											<input
												value={repsLabel(st)}
												placeholder="8-12"
												oninput={(e) => onRepsInput(st._id, (e.currentTarget as HTMLInputElement).value)}
												class="w-16 rounded-lg border border-line bg-white px-1.5 py-1 tabular-nums outline-none focus:border-brand"
											/>
										</td>
										<td class="py-1 pr-1">
											<input
												type="number"
												step="0.5"
												min="0"
												value={st.targetWeight ?? ''}
												placeholder="kg"
												oninput={(e) => onSetNumberInput(st._id, 'targetWeight', (e.currentTarget as HTMLInputElement).value)}
												class="w-16 rounded-lg border border-line bg-white px-1.5 py-1 tabular-nums outline-none focus:border-brand"
											/>
										</td>
										<td class="py-1 pr-1">
											<input
												type="number"
												min="0"
												max="5"
												value={st.targetRir ?? ''}
												placeholder="—"
												oninput={(e) => onSetNumberInput(st._id, 'targetRir', (e.currentTarget as HTMLInputElement).value)}
												class="w-12 rounded-lg border border-line bg-white px-1.5 py-1 tabular-nums outline-none focus:border-brand"
											/>
										</td>
										<td class="py-1 pr-1">
											<input
												type="number"
												min="0"
												step="5"
												value={st.restSeconds ?? ''}
												placeholder="s"
												oninput={(e) => onSetNumberInput(st._id, 'restSeconds', (e.currentTarget as HTMLInputElement).value)}
												class="w-14 rounded-lg border border-line bg-white px-1.5 py-1 tabular-nums outline-none focus:border-brand"
											/>
										</td>
										<td class="py-1">
											<span class="flex items-center gap-0.5">
												<button type="button" title="Dupliquer la série" class="rounded p-0.5 text-mist transition hover:text-brand" onclick={() => duplicateSet(st._id)}>
													<Icon name="copy" size={12} />
												</button>
												<button type="button" title="Supprimer la série" class="rounded p-0.5 text-mist transition hover:text-red-600" onclick={() => deleteSet(st._id)}>
													<Icon name="x" size={12} />
												</button>
											</span>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<button
							type="button"
							onclick={addSet}
							class="mb-4 flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-brand transition hover:border-brand"
						>
							<Icon name="plus" size={12} /> Ajouter une série
						</button>
					{:else}
						<!-- Mode temps — minimal (circuit/cardio futur) -->
						<div class="mb-2 space-y-2">
							{#each selectedExercise.sets as st, i (st._id)}
								<div class="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs">
									<span class="font-bold text-mist tabular-nums">Tour {i + 1}</span>
									<label class="flex items-center gap-1">
										<span class="text-mist">durée</span>
										<input
											type="number"
											min="1"
											value={st.durationSeconds ?? ''}
											placeholder="60"
											oninput={(e) => onSetNumberInput(st._id, 'durationSeconds', (e.currentTarget as HTMLInputElement).value)}
											class="w-16 rounded-lg border border-line px-1.5 py-1 tabular-nums outline-none focus:border-brand"
										/>
										<span class="text-mist">s</span>
									</label>
									<label class="flex items-center gap-1">
										<span class="text-mist">repos</span>
										<input
											type="number"
											min="0"
											value={st.restSeconds ?? ''}
											placeholder="30"
											oninput={(e) => onSetNumberInput(st._id, 'restSeconds', (e.currentTarget as HTMLInputElement).value)}
											class="w-14 rounded-lg border border-line px-1.5 py-1 tabular-nums outline-none focus:border-brand"
										/>
										<span class="text-mist">s</span>
									</label>
									<span class="ml-auto flex items-center gap-0.5">
										<button type="button" title="Dupliquer" class="rounded p-0.5 text-mist transition hover:text-brand" onclick={() => duplicateSet(st._id)}>
											<Icon name="copy" size={12} />
										</button>
										<button type="button" title="Supprimer" class="rounded p-0.5 text-mist transition hover:text-red-600" onclick={() => deleteSet(st._id)}>
											<Icon name="x" size={12} />
										</button>
									</span>
								</div>
							{/each}
						</div>
						<button
							type="button"
							onclick={addSet}
							class="mb-4 flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-brand transition hover:border-brand"
						>
							<Icon name="plus" size={12} /> Ajouter un tour
						</button>
					{/if}

					<!-- Tempo + notes -->
					<label class="mb-2 block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Tempo (facultatif, ex. 3-1-1-0)</span>
						<input
							value={selectedExercise.tempo ?? ''}
							oninput={(e) => {
								selectedExercise.tempo = (e.currentTarget as HTMLInputElement).value;
								onTempoInput();
							}}
							class="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
						/>
					</label>
					<label class="mb-2 block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Consigne technique</span>
						<textarea
							rows="2"
							value={selectedExercise.techniqueNote ?? ''}
							oninput={(e) => {
								selectedExercise.techniqueNote = (e.currentTarget as HTMLTextAreaElement).value;
								onTechniqueInput();
							}}
							class="w-full resize-none rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
						></textarea>
					</label>
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Note coach</span>
						<textarea
							rows="2"
							value={selectedExercise.coachNote ?? ''}
							oninput={(e) => {
								selectedExercise.coachNote = (e.currentTarget as HTMLTextAreaElement).value;
								onCoachNoteInput();
							}}
							class="w-full resize-none rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
						></textarea>
					</label>

					{#if selectedExercise.exercise?.instructions?.length}
						<details class="mt-4 border-t border-line pt-3">
							<summary class="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-mist">Exécution (bibliothèque)</summary>
							<ol class="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink">
								{#each selectedExercise.exercise.instructions as step}
									<li>{step}</li>
								{/each}
							</ol>
						</details>
					{/if}
				</div>
			{/if}
		</section>
	</div>
</div>

<!-- ── Picker bibliothèque (modale) ── -->
{#if pickerOpen}
	<div
		class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) pickerOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') pickerOpen = false;
		}}
	>
		<div class="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-card shadow-xl">
			<header class="flex items-center justify-between border-b border-line px-5 py-3">
				<h3 class="font-display text-lg font-bold text-ink">Ajouter un exercice — {selectedSession?.name}</h3>
				<button type="button" onclick={() => (pickerOpen = false)} class="rounded-full p-1 text-mist transition hover:bg-line/50 hover:text-ink">
					<Icon name="x" size={18} />
				</button>
			</header>
			<div class="min-h-0 flex-1 overflow-y-auto p-5">
				<ExerciseLibraryBrowser variant="picker" {addedIds} onAdd={(ex) => addFromLibrary(ex._id)} />
			</div>
		</div>
	</div>
{/if}
