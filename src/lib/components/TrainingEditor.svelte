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
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { displayExerciseName, exerciseInstructions } from '$lib/exerciseFr';
	import {
		type SessionView,
		type SessionExerciseView,
		type ProgramView,
		type ProgramRow,
		exercisePreview,
		repsLabel,
		parseRepsField,
		supersetBlocks,
		supersetLabel,
		newSupersetId,
		importNoticeLabel,
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

	/* ── Dialogues G-FLUX — AUCUNE boîte native (prompt / confirm / alert) ── */
	let renameSessionFor = $state<SessionView | null>(null);
	let renameValue = $state('');
	let deleteSessionFor = $state<SessionView | null>(null);
	let removeExerciseFor = $state<SessionExerciseView | null>(null);
	let dialogBusy = $state(false);
	/** Noms renommés localement : visibles IMMÉDIATEMENT (liste + titre), sans reload. */
	let sessionNames = $state<Record<string, string>>({});

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
		clearSel(); // jamais d'ids d'une autre séance dans une liaison
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
	/** Nom affiché d'une séance (renommage optimiste si en cours). */
	function sessionName(s: SessionView): string {
		return sessionNames[s._id] ?? s.name;
	}
	function openRenameSession(s: SessionView) {
		renameSessionFor = s;
		renameValue = sessionName(s);
	}
	/** Renommer : mise à jour LOCALE immédiate puis PATCH debouncé (aucun reload). */
	function confirmRenameSession() {
		const target = renameSessionFor;
		const name = renameValue.trim();
		renameSessionFor = null;
		if (!target || !name) return;
		sessionNames[target._id] = name;
		debounced(`sess-${target._id}`, () => send('PATCH', `/api/coach/training/sessions/${target._id}`, { name }));
	}
	async function duplicateSession(id: string) {
		const res = (await send('POST', `/api/coach/training/sessions/${id}`)) as { sessionId?: string } | null;
		if (res) {
			await onReload();
			if (res.sessionId) selectSession(res.sessionId);
		}
	}
	function deleteSession(id: string) {
		deleteSessionFor = sessions.find((x) => x._id === id) ?? null;
	}
	async function confirmDeleteSession() {
		const target = deleteSessionFor;
		if (!target) return;
		dialogBusy = true;
		try {
			if (await send('DELETE', `/api/coach/training/sessions/${target._id}`)) {
				if (selectedSessionId === target._id) {
					selectedSessionId = null;
					selectedExerciseId = null;
				}
				deleteSessionFor = null;
				await onReload();
			}
		} finally {
			dialogBusy = false;
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

	/* ── Import d'exercices d'une séance dans plusieurs séances ──
	   Le volet réutilise les données de l'éditeur : liste des programmes du
	   coach, programme complet de la séance SOURCE (exercices + séries pour
	   l'aperçu) et séances du programme courant pour les cibles. L'écriture est
	   UNE mutation Convex : copie indépendante, source jamais modifiée. */
	let importOpen = $state(false);
	let importPrograms = $state<ProgramRow[]>([]);
	let importProgramId = $state('');
	let importSourceSessions = $state<SessionView[]>([]);
	let importSessionId = $state('');
	let importPicked = $state<Set<string>>(new Set());
	let importTargets = $state<Set<string>>(new Set());
	let importPosition = $state<'start' | 'end'>('start');
	let importPhase = $state<'keep' | 'echauffement'>('echauffement');
	let importBusy = $state(false);
	let importErr = $state('');
	let importNotice = $state('');
	/** Le programme courant est déjà assigné : rappel après import. */
	let importAssigned = $state(false);

	const importSourceExercises = $derived(
		importSourceSessions.find((s) => s._id === importSessionId)?.exercises ?? []
	);
	const importAllPicked = $derived(
		importSourceExercises.length > 0 && importPicked.size === importSourceExercises.length
	);

	function toggleImportPick(id: string) {
		const next = new Set(importPicked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		importPicked = next;
	}
	function toggleImportAll() {
		importPicked = importAllPicked ? new Set() : new Set(importSourceExercises.map((e) => e._id));
	}
	function toggleImportTarget(id: string) {
		const next = new Set(importTargets);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		importTargets = next;
	}
	/** Position : « Au début » (défaut) échauffe, « À la fin » garde la phase. */
	function setImportPosition(p: 'start' | 'end') {
		importPosition = p;
		importPhase = p === 'start' ? 'echauffement' : 'keep';
	}

	async function openImport() {
		if (!selectedSessionId) {
			actionErr = 'Sélectionne d’abord une séance dans la colonne de gauche.';
			return;
		}
		importOpen = true;
		importErr = '';
		importNotice = '';
		importBusy = false;
		importPrograms = [];
		importProgramId = '';
		importSourceSessions = [];
		importSessionId = '';
		importPicked = new Set();
		importTargets = new Set([selectedSessionId]); // séance courante cochée par défaut
		importPosition = 'start';
		importPhase = 'echauffement';
		try {
			const [pr, ar] = await Promise.all([
				fetch('/api/coach/training/programs'),
				fetch('/api/coach/training/assignments'),
			]);
			const pj = await pr.json();
			if (pj.error) throw new Error(pj.error);
			importPrograms = (pj.items ?? []) as ProgramRow[];
			// Rappel d'assignation : toute assignation active de CE programme.
			const aj = await ar.json().catch(() => ({}));
			const rows = Array.isArray(aj.items) ? aj.items : [];
			importAssigned = rows.some(
				(a: { sourceProgramId?: string; removedAt?: number | null }) =>
					a.sourceProgramId === program._id && !a.removedAt
			);
		} catch (e) {
			importErr = e instanceof Error ? e.message : 'Erreur de chargement.';
		}
	}

	async function pickImportProgram(id: string) {
		importProgramId = id;
		importSourceSessions = [];
		importSessionId = '';
		importPicked = new Set();
		if (!id) return;
		try {
			const r = await fetch(`/api/coach/training/programs/${id}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			importSourceSessions = (j.sessions ?? []) as SessionView[];
			const first = importSourceSessions[0];
			if (first) selectImportSession(first._id);
		} catch (e) {
			importErr = e instanceof Error ? e.message : 'Programme introuvable.';
		}
	}

	/** Séance source choisie : tous ses exercices cochés par défaut. */
	function selectImportSession(id: string) {
		importSessionId = id;
		const s = importSourceSessions.find((x) => x._id === id);
		importPicked = new Set((s?.exercises ?? []).map((e) => e._id));
	}

	async function submitImport() {
		if (!importSessionId) {
			importErr = 'Choisis la séance source.';
			return;
		}
		if (importPicked.size === 0) {
			importErr = 'Sélectionne au moins un exercice.';
			return;
		}
		if (importTargets.size === 0) {
			importErr = 'Sélectionne au moins une séance cible.';
			return;
		}
		importBusy = true;
		importErr = '';
		try {
			const r = await fetch('/api/coach/training/import-exercises', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sourceSessionId: importSessionId,
					sessionExerciseIds: [...importPicked],
					targetSessionIds: [...importTargets],
					position: importPosition,
					phaseMode: importPhase,
				}),
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok || j.error) throw new Error(j.error ?? 'Erreur d’import.');
			const n = Number(j.exerciseCount ?? importPicked.size);
			const k = Number(j.sessionCount ?? importTargets.size);
			importNotice = importNoticeLabel(n, k);
			saveState('saved');
			importOpen = false;
			await onReload();
		} catch (e) {
			importErr = e instanceof Error ? e.message : 'Erreur d’import.';
		} finally {
			importBusy = false;
		}
	}
	async function duplicateExercise(id: string) {
		if (await send('POST', `/api/coach/training/session-exercises/${id}`)) await onReload();
	}
	function removeExercise(id: string) {
		removeExerciseFor = selectedSession?.exercises.find((x) => x._id === id) ?? null;
	}
	async function confirmRemoveExercise() {
		const target = removeExerciseFor;
		if (!target) return;
		dialogBusy = true;
		try {
			if (selectedExerciseId === target._id) selectedExerciseId = null;
			if (await send('DELETE', `/api/coach/training/session-exercises/${target._id}`)) {
				removeExerciseFor = null;
				await onReload();
			}
		} finally {
			dialogBusy = false;
		}
	}

	/* ── Supersets / trisets : sélection multiple + liaison ──
	   Le champ supersetGroup (additif, optionnel) est écrit via PATCH
	   { superset: { orderedIds, group } } → api.training.setSupersetGroup.
	   Lier = tous les ids sélectionnés reçoivent un NOUVEL identifiant de
	   groupe ; délier = chaque membre redevient un exercice isolé. */
	let selIds = $state<Set<string>>(new Set());
	const selCount = $derived(selIds.size);

	function toggleSel(id: string) {
		const next = new Set(selIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selIds = next;
	}
	function clearSel() {
		selIds = new Set();
	}

	/** Lier : 1 bloc unique = tous les membres reçoivent le MÊME identifiant. */
	async function linkSelection() {
		if (!selectedSession || selCount < 2) return;
		const orderedIds = [...selIds];
		const group = newSupersetId();
		if (await send('PATCH', `/api/coach/training/session-exercises/${orderedIds[0]}`, { superset: { orderedIds, group } })) {
			clearSel();
			await onReload();
		}
	}

	/** Délier : chaque membre du groupe redevient un exercice isolé. */
	async function unlinkGroup(group: string) {
		if (!selectedSession) return;
		const members = selectedSession.exercises.filter((x) => x.supersetGroup === group).map((x) => x._id);
		if (members.length === 0) return;
		if (await send('PATCH', `/api/coach/training/session-exercises/${members[0]}`, { superset: { orderedIds: members, group: null } })) {
			clearSel();
			await onReload();
		}
	}

	/**
	 * Réordonne le groupe : membres contigus dans l'ordre demandé.
	 * `detachIds` retire l'appartenance DANS LA MÊME opération (sortie d'un
	 * membre) : aucun aller-retour où il garderait une référence orpheline.
	 */
	async function reorderSuperset(group: string, orderedIds: string[], detachIds?: string[]) {
		if (!selectedSession || orderedIds.length < 2) return;
		const superset = detachIds?.length ? { orderedIds, group, detachIds } : { orderedIds, group };
		if (await send('PATCH', `/api/coach/training/session-exercises/${orderedIds[0]}`, { superset })) {
			clearSel();
			await onReload();
		}
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

	/* ── Prescription de l'exercice sélectionné ──
	   Deux chemins, une seule source de vérité (la requête rechargée) :
	   • `patchExercise` : champs TEXTE déboundés (tempo, consignes) — la valeur
	     est déjà dans le champ en cours de frappe, aucun rechargement pour ne
	     pas déplacer le curseur ;
	   • `saveExercise` / `saveSet` : valeurs qui pilotent l'APERÇU de la liste
	     (séries, mode, phase) — écriture AWAITÉE puis rechargement, donc la
	     liste affiche la nouvelle valeur sans recharger la page. */
	function patchExercise(id: string, fields: Record<string, unknown>) {
		void send('PATCH', `/api/coach/training/session-exercises/${id}`, fields);
	}
	async function saveExercise(id: string, fields: Record<string, unknown>) {
		const res = await send('PATCH', `/api/coach/training/session-exercises/${id}`, fields);
		if (res !== null) await onReload();
		return res;
	}
	async function saveSet(body: Record<string, unknown>) {
		const res = await send('PATCH', '/api/coach/training/sets', body);
		if (res !== null) await onReload();
		return res;
	}
	async function setMode(mode: 'reps' | 'time') {
		if (!selectedExercise) return;
		const id = selectedExercise._id;
		selectedExercise.mode = mode; // retour visuel immédiat (la requête confirme)
		await saveExercise(id, { mode });
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
			return saveSet({
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
			return saveSet({
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

	<!-- Résultat de l'import : message court + rappel d'assignation -->
	{#if importNotice}
		<div class="flex flex-wrap items-start gap-2 rounded-xl border border-brand/40 bg-brand-light/60 px-3 py-2">
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<p class="flex items-center gap-1.5 text-sm font-bold text-brand-deep">
					<Icon name="circleCheck" size={15} /> {importNotice}
				</p>
				{#if importAssigned}
					<p class="text-[12px] font-semibold text-ink">Réassigne le programme pour que ta cliente reçoive la modification.</p>
				{/if}
			</div>
			<button
				type="button"
				onclick={() => (importNotice = '')}
				aria-label="Fermer le message"
				class="shrink-0 rounded-full p-0.5 text-brand-deep/70 transition hover:bg-white hover:text-ink"
			>
				<Icon name="x" size={14} />
			</button>
		</div>
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
								<span class="block truncate text-[13px] font-bold text-ink">{sessionName(s)}</span>
								<span class="block text-[10px] text-mist">{s.exercises.length} exercice{s.exercises.length > 1 ? 's' : ''}</span>
							</button>								<span class="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
									<button
										type="button"
										title="Renommer"
										class="rounded-lg p-1 text-mist transition hover:bg-white hover:text-brand"
										onclick={() => openRenameSession(s)}
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
			<header class="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-line/30 px-3 py-2.5">
				<h2 class="min-w-0 truncate text-[11px] font-bold uppercase tracking-widest text-mist">
					{selectedSession ? sessionName(selectedSession) : 'Exercices'}
				</h2>
				<span class="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onclick={openImport}
						class="flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110"
					>
						<Icon name="filePlus" size={12} /> Importer des exercices
					</button>
					<button
						type="button"
						onclick={openPicker}
						class="flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110"
					>
						<Icon name="plus" size={12} /> Ajouter un exercice
					</button>
				</span>
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
				</div>			{:else}
				{#snippet ExRow(ex: SessionExerciseView, inGroup: boolean)}
					<li
						draggable="true"
						ondragstart={(e) => onExDragStart(e, ex._id)}
						ondragover={(e) => onExDragOver(e, ex._id)}
						ondragleave={() => (dragOverExId === ex._id ? (dragOverExId = null) : null)}
						ondrop={(e) => onExDrop(e, ex._id)}
						class="group mb-1 rounded-xl border transition {selectedExerciseId === ex._id
							? 'border-brand bg-white shadow-sm'
							: inGroup
								? 'border-line bg-white'
								: 'border-transparent hover:border-line'} {dragOverExId === ex._id ? 'border-t-2 border-t-brand' : ''}"
					>
						<div class="flex items-center gap-2.5 px-2 py-2">
							<Icon name="rows3" size={13} class="cursor-grab shrink-0 text-mist" />
							<!-- Contrôle de sélection superset (coche discrète, esprit Virtuagym) -->
							<button
								type="button"
								role="checkbox"
								aria-checked={selIds.has(ex._id)}
								aria-label="Sélectionner pour un superset"
								title="Sélectionner pour un superset"
								onclick={() => toggleSel(ex._id)}
								class="grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition {selIds.has(ex._id)
									? 'border-brand bg-brand text-white'
									: 'border-line bg-white text-transparent hover:border-brand/60'}"
							>
								<Icon name="check" size={11} strokeWidth={3} />
							</button>
							<button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 text-left" onclick={() => (selectedExerciseId = ex._id)}>
								<span class="relative block h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-line/40">
									<ExerciseMedia media={ex.exercise ?? undefined} class="h-full w-full object-cover" />
								</span>
								<span class="min-w-0">
									<span class="block truncate text-[13px] font-semibold text-ink">{displayExerciseName(ex.exercise?.name) || 'Exercice supprimé'}</span>
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
				{/snippet}

				<!-- Bannière d'action superset (sélection active) — esprit Virtuagym :
				     sélectionner plusieurs cartes puis « Lier ». -->
				{#if selCount > 0}
					<div class="m-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/40 bg-brand-light/60 px-3 py-2">
						<p class="text-[12.5px] font-bold text-ink">
							{selCount} exercice{selCount > 1 ? 's' : ''} sélectionné{selCount > 1 ? 's' : ''}
							<span class="font-semibold text-mist">— 2 minimum pour lier</span>
						</p>
						<span class="flex items-center gap-1.5">
							<button
								type="button"
								onclick={linkSelection}
								disabled={selCount < 2}
								class="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
							>
								<Icon name="link" size={13} /> Créer un superset
							</button>
							<button type="button" onclick={clearSel} class="rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-brand">Annuler</button>
						</span>
					</div>
				{/if}

				<ul class="max-h-[62vh] overflow-y-auto p-2">
					<!-- Clé de bloc TOUJOURS unique (`groupe#occurrence` / `iso-index`) :
					     une séance héritée avec un circuit découpé s'affiche au lieu de
					     planter (`each_key_duplicate`). Rien n'est supprimé : le coach
					     retire lui-même le surplus, l'enregistrement normalise la suite. -->
					{#each supersetBlocks(selectedSession.exercises) as block (block.key)}
						<!-- Bloc superset : carte englobante premium (groupe visible d'un coup d'œil) -->
						{#if block.group}
							<li class="mb-2.5 rounded-2xl border-2 border-brand/35 bg-brand-light/25 p-1.5">
								<div class="flex items-center justify-between gap-2 px-1.5 pb-1 pt-0.5">
									<p class="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-brand-deep">
										<Icon name="link" size={12} strokeWidth={2.6} /> {supersetLabel(block.exercises.length)}
										<span class="font-bold normal-case tracking-normal text-mist">· enchaîner les {block.exercises.length} exercices avec un minimum de repos</span>
									</p>
									<span class="flex items-center gap-0.5">
										{#if block.exercises.length > 2}
											<button
												type="button"
												title="Réordonner le groupe (1er → dernier)"
												class="rounded-lg p-1 text-mist transition hover:bg-white hover:text-brand"
												onclick={() => reorderSuperset(block.group!, [...block.exercises.slice(1).map((x) => x._id), block.exercises[0]._id])}
											>
												<Icon name="rotateCcw" size={13} />
											</button>
										{/if}
										<button
											type="button"
											title="Délier le groupe"
											class="rounded-lg p-1 text-mist transition hover:bg-white hover:text-danger"
											onclick={() => unlinkGroup(block.group!)}
										>
											<Icon name="unlink" size={13} />
										</button>
									</span>
								</div>
								<ul>
									{#each block.exercises as ex (ex._id)}
										{@render ExRow(ex, true)}
									{/each}
								</ul>
							</li>
						{:else}
							{@render ExRow(block.exercises[0], false)}
						{/if}
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
							media={selectedExercise.exercise ?? undefined}
							loading="eager"
							class="h-full w-full object-cover"
						/>
						</span>
						<div class="min-w-0">
							<h3 class="font-display text-base font-bold leading-tight text-ink">{displayExerciseName(selectedExercise.exercise?.name) || 'Exercice supprimé'}</h3>
							<p class="mt-0.5 text-[11px] text-mist">
								{selectedExercise.exercise?.muscleGroup ?? '—'}{selectedExercise.exercise?.equipment ? ` · ${selectedExercise.exercise.equipment}` : ''}
							</p>
							{#if selectedExercise.supersetGroup && selectedSession}
								{@const members = selectedSession.exercises.filter((x) => x.supersetGroup === selectedExercise.supersetGroup)}
								{#if members.length > 1}
									<p class="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-0.5 text-[10.5px] font-bold text-brand-deep">
										<Icon name="link" size={11} strokeWidth={2.6} /> {supersetLabel(members.length)} · n° {members.findIndex((m) => m._id === selectedExercise._id) + 1}/{members.length}
									</p>
									<button
										type="button"
										title="Retirer cet exercice du superset"
										class="ml-1.5 inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[10.5px] font-bold text-mist transition hover:border-danger hover:text-danger"
										onclick={() => {
											const rest = members.filter((m) => m._id !== selectedExercise!._id).map((m) => m._id);
										// Le membre sorti est détaché dans le même appel : jamais de
										// référence orpheline qui découperait le circuit en deux.
										if (rest.length >= 2)
											void reorderSuperset(selectedExercise!.supersetGroup!, rest, [selectedExercise!._id]);
										else void unlinkGroup(selectedExercise!.supersetGroup!);
										}}
									>
										<Icon name="unlink" size={10} /> Sortir du groupe
									</button>
								{/if}
							{/if}
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

					<!-- Phase du parcours (échauffement / principal / finisher) -->
					<label class="mb-2 block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Phase du parcours</span>
						<select
							value={selectedExercise.phase ?? 'principal'}
							onchange={(e) => {
								if (!selectedExercise) return;
								const v = (e.currentTarget as HTMLSelectElement).value as 'echauffement' | 'principal' | 'finisher';
								const id = selectedExercise._id;
								selectedExercise.phase = v; // affichage immédiat (la requête confirme)
								void saveExercise(id, { phase: v === 'principal' ? null : v });
							}}
							class="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
						>
							<option value="echauffement">🔥 Échauffement</option>
							<option value="principal">💪 Entraînement principal</option>
							<option value="finisher">⚡ Finisher / mobilité</option>
						</select>
						<p class="mt-0.5 text-[10px] text-mist">Un seul parcours côté cliente : les phases s'affichent dans l'ordre (échauffement → principal → finisher).</p>
					</label>

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

					{#if exerciseInstructions(selectedExercise.exercise).length}
						<details class="mt-4 border-t border-line pt-3">
							<summary class="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-mist">Exécution (bibliothèque)</summary>
							<ol class="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink">
								{#each exerciseInstructions(selectedExercise.exercise) as step}
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
				<h3 class="font-display text-lg font-bold text-ink">Ajouter un exercice — {selectedSession ? sessionName(selectedSession) : ''}</h3>
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

<!-- ── Import d'exercices d'une séance (volet) ── -->
{#if importOpen}
	<div
		class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget && !importBusy) importOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape' && !importBusy) importOpen = false;
		}}
	>
		<div class="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-card shadow-xl">
			<header class="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
				<div class="min-w-0">
					<h3 class="font-display text-lg font-bold text-ink">Importer des exercices</h3>
					<p class="text-xs text-mist">
						Copie indépendante dans les séances choisies — la séance source n'est pas modifiée.
					</p>
				</div>
				<button
					type="button"
					disabled={importBusy}
					onclick={() => (importOpen = false)}
					class="rounded-full p-1 text-mist transition hover:bg-line/50 hover:text-ink disabled:opacity-50"
					aria-label="Fermer"
				>
					<Icon name="x" size={18} />
				</button>
			</header>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
				{#if importErr}
					<p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{importErr}</p>
				{/if}

				<!-- 1. Programme puis séance source -->
				<section>
					<h4 class="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-mist">Séance source</h4>
					<div class="grid gap-2 sm:grid-cols-2">
						<select
							value={importProgramId}
							onchange={(e) => pickImportProgram((e.currentTarget as HTMLSelectElement).value)}
							aria-label="Programme source"
							class="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
						>
							<option value="">Choisir un programme…</option>
							{#each importPrograms as p (p._id)}<option value={p._id}>{p.name}</option>{/each}
						</select>
						<select
							value={importSessionId}
							onchange={(e) => selectImportSession((e.currentTarget as HTMLSelectElement).value)}
							disabled={importSourceSessions.length === 0}
							aria-label="Séance source"
							class="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-50"
						>
							<option value="">Choisir une séance…</option>
							{#each importSourceSessions as s (s._id)}<option value={s._id}>{sessionName(s)}</option>{/each}
						</select>
					</div>
				</section>

				<!-- 2. Exercices de la séance source (tous cochés par défaut) -->
				{#if importSessionId}
					<section>
						<div class="mb-1.5 flex items-center justify-between gap-2">
							<h4 class="text-[10px] font-bold uppercase tracking-widest text-mist">
								Exercices ({importPicked.size}/{importSourceExercises.length})
							</h4>
							{#if importSourceExercises.length > 0}
								<button
									type="button"
									onclick={toggleImportAll}
									class="text-[11px] font-bold text-brand transition hover:text-brand-dark"
								>
									{importAllPicked ? 'Tout décocher' : 'Tout cocher'}
								</button>
							{/if}
						</div>
						{#if importSourceExercises.length === 0}
							<p class="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-mist">
								Cette séance n'a aucun exercice à importer.
							</p>
						{:else}
							<ul class="max-h-56 overflow-y-auto rounded-xl border border-line bg-white">
								{#each importSourceExercises as ex (ex._id)}
									<li class="border-b border-line/60 last:border-0">
										<label class="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition hover:bg-brand-light/40">
											<input
												type="checkbox"
												checked={importPicked.has(ex._id)}
												onchange={() => toggleImportPick(ex._id)}
												class="h-4 w-4 shrink-0 accent-[var(--brand)]"
											/>
											<span class="min-w-0 flex-1">
												<span class="block truncate text-[13px] font-semibold text-ink">{displayExerciseName(ex.exercise?.name) || 'Exercice supprimé'}</span>
												<span class="block truncate text-[11px] text-mist">{exercisePreview(ex)}</span>
											</span>
										</label>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/if}

				<!-- 3. Séances cibles du programme en cours -->
				<section>
					<h4 class="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-mist">
						Séances cibles ({importTargets.size}/{sessions.length})
					</h4>
					<div class="grid gap-1.5 sm:grid-cols-2">
						{#each sessions as s (s._id)}
							<label
								class="flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 text-[12.5px] font-semibold text-ink transition {importTargets.has(s._id)
									? 'border-brand bg-brand-light/50'
									: 'border-line bg-white hover:border-brand/60'}"
							>
								<input
									type="checkbox"
									checked={importTargets.has(s._id)}
									onchange={() => toggleImportTarget(s._id)}
									class="h-4 w-4 shrink-0 accent-[var(--brand)]"
								/>
								<span class="min-w-0 flex-1 truncate">{sessionName(s)}</span>
								<span class="shrink-0 text-[10px] font-bold text-mist">{s.exercises.length} ex.</span>
							</label>
						{/each}
					</div>
					{#if sessions.length === 0}
						<p class="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-mist">
							Ce programme n'a aucune séance.
						</p>
					{/if}
				</section>

				<!-- 4. Position et phase -->
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="block">
						<p class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Position</p>
						<span class="flex gap-1.5">
							<button
								type="button"
								onclick={() => setImportPosition('start')}
								class="flex-1 rounded-xl border-2 px-2 py-1.5 text-xs font-bold transition {importPosition === 'start'
									? 'border-brand bg-brand text-white'
									: 'border-line bg-white text-ink hover:border-brand'}"
							>
								Au début
							</button>
							<button
								type="button"
								onclick={() => setImportPosition('end')}
								class="flex-1 rounded-xl border-2 px-2 py-1.5 text-xs font-bold transition {importPosition === 'end'
									? 'border-brand bg-brand text-white'
									: 'border-line bg-white text-ink hover:border-brand'}"
							>
								À la fin
							</button>
						</span>
					</div>
					<div class="block">
						<p class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Phase</p>
						<span class="flex gap-1.5">
							<button
								type="button"
								onclick={() => (importPhase = 'keep')}
								class="flex-1 rounded-xl border-2 px-2 py-1.5 text-xs font-bold transition {importPhase === 'keep'
									? 'border-brand bg-brand text-white'
									: 'border-line bg-white text-ink hover:border-brand'}"
							>
								Garder la phase d'origine
							</button>
							<button
								type="button"
								onclick={() => (importPhase = 'echauffement')}
								class="flex-1 rounded-xl border-2 px-2 py-1.5 text-xs font-bold transition {importPhase === 'echauffement'
									? 'border-brand bg-brand text-white'
									: 'border-line bg-white text-ink hover:border-brand'}"
							>
								Forcer Échauffement
							</button>
						</span>
					</div>
				</div>
			</div>

			<footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
				<p class="text-[11px] font-semibold text-mist">
					{importPicked.size} exercice{importPicked.size > 1 ? 's' : ''} → {importTargets.size} séance{importTargets.size > 1 ? 's' : ''}
				</p>
				<span class="flex items-center gap-1.5">
					<button
						type="button"
						disabled={importBusy}
						onclick={() => (importOpen = false)}
						class="rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-bold text-ink transition hover:border-brand disabled:opacity-50"
					>
						Annuler
					</button>
					<button
						type="button"
						disabled={importBusy || !importSessionId || importPicked.size === 0 || importTargets.size === 0}
						onclick={submitImport}
						class="flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
					>
						<Icon name="filePlus" size={13} /> {importBusy ? 'Import…' : 'Importer'}
					</button>
				</span>
			</footer>
		</div>
	</div>
{/if}

<!-- ── Dialogues G-FLUX (remplacent prompt / confirm natifs) ── -->
<ConfirmDialog
	open={!!renameSessionFor}
	title="Renommer la séance"
	message="Le nouveau nom apparaît immédiatement dans la liste et le titre."
	confirmLabel="Renommer"
	onconfirm={confirmRenameSession}
	oncancel={() => (renameSessionFor = null)}
>
	<input
		type="text"
		bind:value={renameValue}
		aria-label="Nom de la séance"
		class="w-full rounded-xl border-2 border-line px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-brand"
	/>
</ConfirmDialog>

<ConfirmDialog
	open={!!deleteSessionFor}
	title="Supprimer la séance ?"
	message={deleteSessionFor ? `« ${sessionName(deleteSessionFor)} » et tous ses exercices seront supprimés.` : ''}
	confirmLabel="Supprimer"
	danger
	busy={dialogBusy}
	onconfirm={confirmDeleteSession}
	oncancel={() => (deleteSessionFor = null)}
/>

<ConfirmDialog
	open={!!removeExerciseFor}
	title="Retirer cet exercice ?"
	message={removeExerciseFor ? `${displayExerciseName(removeExerciseFor.exercise?.name) || 'Cet exercice'} sera retiré de la séance.` : ''}
	confirmLabel="Retirer"
	danger
	busy={dialogBusy}
	onconfirm={confirmRemoveExercise}
	oncancel={() => (removeExerciseFor = null)}
/>
