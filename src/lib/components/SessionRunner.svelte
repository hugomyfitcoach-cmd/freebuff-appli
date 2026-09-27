<script lang="ts">
	/**
	 * SessionRunner — réalisation d'une séance (espace cliente).
	 *
	 * DEUX MODES, UNE SEULE ÉCRITURE (api/training/log → trainingSetLogs) :
	 * - MODE LIBRE : toute la séance déroulée, saisie directe charges/reps,
	 *   validation par série, « Terminer la séance » toujours disponible.
	 * - MODE GUIDÉ : un exercice à la fois, une série à la fois, animation,
	 *   objectif, pré-remplissage, timer repos / timer durée, « Série terminée ».
	 *
	 * Flux de fin : « Terminer la séance » → (confirm partiel éventuel) →
	 * résumé local (durée, exercices, séries, volume, progression) → option
	 * difficulté/note → « Enregistrer et fermer » poste TOUT en une mutation.
	 * Une séance déjà réalisée s'ouvre en résumé lecture seule.
	 */
	import { onMount, onDestroy } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { loadScheduledSession, SESSION_LOAD_ERROR_MESSAGE } from '$lib/sessionLoad';

	type ExSet = {
		order: number;
		repsMin: number | null;
		repsMax: number | null;
		targetWeight: number | null;
		targetRir: number | null;
		restSeconds: number | null;
		durationSeconds: number | null;
	};
	type Ex = {
		_id: string;
		order: number;
		mode: 'reps' | 'time';
		phase: string;
		tempo: string | null;
		coachNote: string | null;
		techniqueNote: string | null;
		exercise: {
			_id: string;
			gfluxExerciseId: string;
			name: string;
			muscleGroup: string | null;
			equipment: string | null;
			mediaUrl: string | null;
			posterUrl: string | null;
			animationUrl: string | null;
			instructions: string[] | null;
		} | null;
		sets: ExSet[];
		lastPerformance: { date: string; reps: number | null; weightKg: number | null; durationSeconds: number | null } | null;
		suggestedReps: number | null;
		suggestedWeight: number | null;
		loggedSets: { setOrder: number; reps: number | null; weightKg: number | null; durationSeconds: number | null; done: boolean }[];
		isFirstTime: boolean;
	};
	type Data = {
		scheduled: {
			_id: string;
			date: string;
			status: string;
			completedAt: number | null;
			durationMin: number | null;
			startedAt: number | null;
			skippedAt: number | null;
			durationSource: string | null;
		};
		session: { _id: string; name: string };
		programName: string | null;
		estimatedMin: number;
		exercises: Ex[];
	};

	let { scheduledId, onFinished }: { scheduledId: string; onFinished?: () => void } = $props();

	/* ── État général ── */
	let data = $state<Data | null>(null);
	let loading = $state(true);
	let err = $state('');
	/** mode : 'libre' | 'guide' | 'recap' (résumé de fin / lecture seule). */
	let mode = $state<'libre' | 'guide' | 'recap'>('libre');
	let startedAt = $state(Date.now());
	let saving = $state(false);
	let alreadyCompleted = $state(false);

	/* ── Saisie du mode libre : [exerciseId][setOrder] → brouillon ──
	   ⚠ Svelte 5 : le template ne doit JAMAIS écrire dans un état pendant le
	   rendu (state_unsafe_mutation — le flush de mise à jour du DOM meurt et
	   l'écran reste sur « Chargement… » malgré loading=false). D'où :
	   - buildDraft : PUR (aucune écriture) — valeurs par défaut calculées ;
	   - getDraft : PUR (lecture seule) — utilisable dans le template ;
	   - ensureDraft : ÉCRIT — réservé aux gestionnaires d'événements ;
	   - applyLoadedSession préremplit tous les brouillons à l'assignation des
	     données (contexte asynchrone, pas pendant un rendu). */
	type Draft = { reps: string; weight: string; duration: string; done: boolean };
	let drafts = $state<Record<string, Draft>>({});
	function draftKey(exId: string, setOrder: number): string {
		return `${exId}:${setOrder}`;
	}
	function buildDraft(ex: Ex, setOrder: number): Draft {
		const logged = ex.loggedSets.find((l) => l.setOrder === setOrder);
		return {
			reps: String(logged?.reps ?? ex.suggestedReps ?? ''),
			weight:
				logged?.weightKg != null ? String(logged.weightKg) : ex.suggestedWeight != null ? String(ex.suggestedWeight) : '',
			duration: String(logged?.durationSeconds ?? ex.sets[setOrder]?.durationSeconds ?? ''),
			done: logged?.done ?? false,
		};
	}
	/** Pur — appelable dans le template (aucune écriture, jamais). */
	function getDraft(ex: Ex, setOrder: number): Draft {
		return drafts[draftKey(ex._id, setOrder)] ?? buildDraft(ex, setOrder);
	}
	/** Écriture — UNIQUEMENT depuis un gestionnaire d'événement (jamais le rendu). */
	function ensureDraft(ex: Ex, setOrder: number): Draft {
		const k = draftKey(ex._id, setOrder);
		if (!drafts[k]) drafts[k] = buildDraft(ex, setOrder);
		return drafts[k];
	}

	/** Répercute localement une série sauvegardée (source du résumé). */
	function markLocal(ex: Ex, setOrder: number, values: { reps?: number; weightKg?: number; durationSeconds?: number }, done: boolean) {
		const found = ex.loggedSets.find((l) => l.setOrder === setOrder);
		if (found) {
			found.reps = values.reps ?? null;
			found.weightKg = values.weightKg ?? null;
			found.durationSeconds = values.durationSeconds ?? null;
			found.done = done;
		} else {
			ex.loggedSets.push({ setOrder, reps: values.reps ?? null, weightKg: values.weightKg ?? null, durationSeconds: values.durationSeconds ?? null, done });
		}
		const d = drafts[draftKey(ex._id, setOrder)];
		if (d) d.done = done;
	}

	/* ── Mode guidé ── */
	let gExIdx = $state(0);
	let gSetIdx = $state(0);
	let gReps = $state('');
	let gWeight = $state('');
	let gDuration = $state('');
	let guidedDone = $state(0);
	let guidedTotal = $state(1);
	const gEx = $derived(data?.exercises[gExIdx] ?? null);
	const gSet = $derived(gEx?.sets[gSetIdx] ?? null);

	/* ── Timers (durée + repos) — un seul à la fois ── */
	type TimerKind = 'duration' | 'rest' | null;
	let timerKind = $state<TimerKind>(null);
	let timerTotal = $state(0);
	let timerLeft = $state(0);
	let timerPaused = $state(false);
	let interval: ReturnType<typeof setInterval> | null = null;

	function stopTimer() {
		if (interval) clearInterval(interval);
		interval = null;
		timerKind = null;
		timerPaused = false;
	}
	function startTimer(kind: Exclude<TimerKind, null>, seconds: number, onDone?: () => void) {
		stopTimer();
		timerKind = kind;
		timerTotal = Math.max(1, Math.round(seconds));
		timerLeft = timerTotal;
		timerPaused = false;
		interval = setInterval(() => {
			if (timerPaused) return;
			timerLeft -= 1;
			if (timerLeft <= 0) {
				stopTimer();
				onDone?.();
			}
		}, 1000);
	}
	function fmtTimer(s: number): string {
		const m = Math.floor(s / 60);
		const r = s % 60;
		return `${m}:${String(r).padStart(2, '0')}`;
	}
	onDestroy(() => stopTimer());

	/* ── Chrono global de séance (temps écoulé depuis startedAt) ──
	   startedAt est PERSISTÉ backend (survit verrouillage/fond) : le chrono
	   repart de l'horodatage réel à la reprise. La durée finale enregistrée
	   est celle-ci (même base que detectedDurationMin) — aucun doublon. */
	let elapsedNow = $state(Date.now());
	let elapsedInterval: ReturnType<typeof setInterval> | null = null;
	function startElapsed() {
		elapsedNow = Date.now();
		if (elapsedInterval) return;
		elapsedInterval = setInterval(() => (elapsedNow = Date.now()), 1000);
	}
	function stopElapsed() {
		if (elapsedInterval) clearInterval(elapsedInterval);
		elapsedInterval = null;
	}
	const elapsedLabel = $derived.by(() => {
		if (!sessionStarted) return '';
		const s = Math.max(0, Math.floor((elapsedNow - startedAt) / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = s % 60;
		return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
	});

	/* ── Résumé de fin ── */
	let recap = $state<null | {
		durationMin: number;
		setsDone: number;
		setsTotal: number;
		exDone: number;
		exTotal: number;
		volumeKg: number;
		progression: string | null;
	}>(null);
	let difficulty = $state<number | null>(null);
	let clientNote = $state('');
	let finishing = $state(false);
	let confirmPartial = $state(false);
	/* Réouverture d'une séance terminée par erreur (depuis le récap lecture
	   seule). `reopenAccumulatedMin` = temps réellement travaillé avant
	   l'erreur : ajouté à la nouvelle fenêtre au moment de re-terminer — le
	   temps mort entre les deux ouvertures n'est JAMAIS compté. */
	let reopenConfirm = $state(false);
	let reopening = $state(false);
	let reopenAccumulatedMin = $state(0);

	/* ── Démarrage RÉEL (bouton « Commencer la séance ») — ouvrir/consulter
	   la séance ne démarre RIEN. startedAt est persisté backend (survit au
	   verrouillage iPhone / PWA en arrière-plan) ; côté front, il sert à
	   afficher le temps écoulé. Séance déjà commencée → reprise. ── */
	let sessionStarted = $state(false);
	async function startRealSession() {
		try {
			const r = await fetch('/api/training', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ scheduledId }),
			}).then((x) => x.json());
			if (!r.error && r.startedAt) {
				sessionStarted = true;
				// L'horloge locale repart de l'horodatage PERSISTÉ (jamais d'un
				// chrono dépendant du cycle de vie de la page).
				startedAt = r.startedAt;
				startElapsed(); // chrono global visible dans le header
			}
		} catch {
			/* silencieux : la séance reste utilisable, la durée sera déclinée
			   au moment de « Terminer » (saisie manuelle possible) */
				sessionStarted = false;
		}
	}

	/* ── Confirmation de durée (uniquement après « Terminer la séance ») ──
	   Durée manifestement étrange (< 10 min ou > 150 min) → panneau léger,
	   fermable, ne bloque JAMAIS l'app, aucune perte de données. ── */
	let durationConfirm = $state<null | { detectedMin: number }>(null);
	let manualDurationInput = $state('');
	const DURATION_MIN_THRESHOLD = 10;
	const DURATION_MAX_THRESHOLD = 150;

	/* ── Chargement (timeout + 1 retry — plus JAMAIS de spinner infini) ──
	   loadScheduledSession garantit un état final en temps fini : succès,
	   erreur applicative ou échec transport après UNE seule relance. Le
	   signal est posé par un contrôleur local annulé au démontage — un
	   changement d'écran ne peut laisser aucun état suspendu derrière lui. */
	let loadController: AbortController | null = null;

	/** Échappatoire utilisateur : le bouton « Cela prend trop de temps » affiche
	 *  l'erreur + Réessayer/Retour sans attendre le timeout de chargement. */
	let diagForced = $state(false);

	function applyLoadedSession(r: Data) {
		data = r;
		guidedTotal = data.exercises.reduce((n, e) => n + e.sets.length, 0) || 1;
		// Préremplissage des brouillons AVANT le premier rendu du mode libre :
		// getDraft restera ainsi purement lisible pendant le rendu (Svelte 5 —
		// aucune écriture d'état dans un effet de template).
		const prefilled: Record<string, Draft> = {};
		for (const ex of r.exercises) {
			for (const st of ex.sets) {
				prefilled[draftKey(ex._id, st.order)] = buildDraft(ex, st.order);
			}
		}
		drafts = prefilled;
		if (data.scheduled.status === 'completed') {
			alreadyCompleted = true;
			mode = 'recap';
			buildRecap(data.scheduled.durationMin ?? null);
		} else if (data.scheduled.startedAt) {
			// Reprise d'une séance commencée (app fermée, verrouillage…) — et
			// reprise APRÈS réouverture d'une séance terminée par erreur. Dans
			// les deux cas startedAt PERSISTÉ backend est la base du chrono ;
			// une réouverture l'ayant réarmé, le chrono repart de zéro.
			sessionStarted = true;
			startedAt = data.scheduled.startedAt;
			startElapsed();
		}
	}

	async function loadSession() {
		loadController?.abort();
		loadController = new AbortController();
		const ctl = loadController;
		loading = true;
		err = '';
		data = null;
		try {
			await loadScheduledSession(scheduledId, {
				signal: ctl.signal,
				setState: (s) => {
					if (ctl.signal.aborted) return; // démontage : jamais de setState après
					if (s.kind === 'success') {
						applyLoadedSession(s.data as Data);
					} else {
						// Erreur applicative (séance introuvable…) OU transport :
						// message lisible, jamais de stack technique.
						err = s.message || SESSION_LOAD_ERROR_MESSAGE;
					}
				},
			});
		} catch (e) {
			if (ctl.signal.aborted) return; // démontage / rechargement : silence
			err = SESSION_LOAD_ERROR_MESSAGE;
		} finally {
			if (!ctl.signal.aborted) loading = false; // GARANTI après succès ou échec définitif
		}
	}

	onMount(() => {
		void loadSession();
	});

	onDestroy(() => {
		loadController?.abort();
		loadController = null;
		stopElapsed();
	});

	/* ── Écriture d'une série (LES DEUX MODES) ── */
	async function saveSet(
		ex: Ex,
		setOrder: number,
		payload: { reps?: number; weightKg?: number; durationSeconds?: number },
		done: boolean
	) {
		await fetch('/api/training/log', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				scheduledId,
				sessionExerciseId: ex._id,
				setOrder,
				...(payload.reps !== undefined ? { reps: payload.reps } : {}),
				...(payload.weightKg !== undefined ? { weightKg: payload.weightKg } : {}),
				...(payload.durationSeconds !== undefined ? { durationSeconds: payload.durationSeconds } : {}),
				done,
			}),
		});
		markLocal(ex, setOrder, payload, done);
	}

	/** Mode libre : coche/valide une série avec les valeurs du brouillon. */
	async function toggleFreeSet(ex: Ex, setOrder: number) {
		const d = ensureDraft(ex, setOrder);
		const next = !d.done;
		d.done = next;
		saving = true;
		err = '';
		try {
			await saveSet(
				ex,
				setOrder,
				ex.mode === 'time'
					? { durationSeconds: Number(d.duration) || ex.sets[setOrder]?.durationSeconds || undefined }
					: {
							reps: Number(d.reps) || undefined,
							weightKg: d.weight.trim() ? Number(d.weight.replace(',', '.')) : undefined,
						},
				next
			);
			// Série VALIDÉE → repos automatique comme en guidé (même moteur de
			// timer, jamais en chevauchant une durée de série en cours) : sauf
			// toute dernière série de la séance, et seulement si un repos est
			// prescrit. Décocher ne relance rien.
			if (next) {
				const isLastSet = setOrder >= ex.sets.length - 1;
				const exIdx = data?.exercises.findIndex((e) => e._id === ex._id) ?? -1;
				const isLastEx = exIdx === (data?.exercises.length ?? 1) - 1;
				const rest = ex.sets[setOrder]?.restSeconds ?? 0;
				if (!(isLastSet && isLastEx) && rest > 0) startTimer('rest', rest);
			}
		} catch {
			d.done = !next;
			err = "Impossible d'enregistrer — réessaie.";
		} finally {
			saving = false;
		}
	}

	/* ── Navigation guidée ── */
	function startGuided() {
		mode = 'guide';
		gExIdx = 0;
		gSetIdx = 0;
		guidedDone = 0;
		loadGuidedDraft();
		// Le mode guidé démarre aussi la séance RÉELLE (même logique métier :
		// startedAt persisté backend, durée partagée entre les deux modes).
		if (!sessionStarted) void startRealSession();
	}
	function loadGuidedDraft() {
		if (!gEx) return;
		const logged = gEx.loggedSets.find((l) => l.setOrder === gSetIdx);
		gReps = String(logged?.reps ?? gEx.suggestedReps ?? '');
		gWeight = logged?.weightKg != null ? String(logged.weightKg) : gEx.suggestedWeight != null ? String(gEx.suggestedWeight) : '';
		gDuration = String(logged?.durationSeconds ?? gSet?.durationSeconds ?? '');
		// Exercice en durée : le compte à rebours démarre automatiquement.
		if (gEx.mode === 'time' && gSet?.durationSeconds) {
			startTimer('duration', gSet.durationSeconds);
		} else {
			stopTimer();
		}
	}
	function prevStep() {
		if (!data) return;
		if (gSetIdx > 0) {
			gSetIdx -= 1;
		} else if (gExIdx > 0) {
			gExIdx -= 1;
			gSetIdx = Math.max((data.exercises[gExIdx]?.sets.length ?? 1) - 1, 0);
		} else {
			return;
		}
		loadGuidedDraft();
	}
	function nextStep() {
		if (!data || !gEx) return;
		if (gSetIdx < gEx.sets.length - 1) {
			gSetIdx += 1;
			loadGuidedDraft();
		} else if (gExIdx < data.exercises.length - 1) {
			gExIdx += 1;
			gSetIdx = 0;
			loadGuidedDraft();
		}
		// Dernière étape : reste sur place — « Terminer la séance » prend le relais.
	}
	async function validateGuidedSet() {
		if (!gEx) return;
		saving = true;
		err = '';
		try {
			await saveSet(
				gEx,
				gSetIdx,
				gEx.mode === 'time'
					? { durationSeconds: Number(gDuration) || gSet?.durationSeconds || undefined }
					: {
							reps: Number(gReps) || undefined,
							weightKg: gWeight.trim() ? Number(gWeight.replace(',', '.')) : undefined,
						},
				true
			);
			guidedDone += 1;
			stopTimer();
			// Repos automatique (sil on n'est pas à la toute fin), puis série suivante.
			const rest = gSet?.restSeconds ?? 0;
			const isLastSet = gSetIdx >= gEx.sets.length - 1;
			const isLastEx = gExIdx >= (data?.exercises.length ?? 1) - 1;
			if (!(isLastSet && isLastEx) && rest > 0) {
				startTimer('rest', rest, () => nextStep());
			} else {
				nextStep();
			}
		} catch {
			err = "Impossible d'enregistrer la série — réessaie.";
		} finally {
			saving = false;
		}
	}
	function skipRest() {
		stopTimer();
		nextStep();
	}

	/* ── Fin de séance ──
	   Séance « manifestement incomplète » : aucune série validée, ou très peu
	   (< 25 % du programme) → confirmation renforcée avant Terminer. */
	const FEW_SETS_RATIO = 0.25;
	const totalSets = $derived(data?.exercises.reduce((n, e) => n + e.sets.length, 0) ?? 0);
	function completionStatus(): { exDone: number; exTotal: number; setsDone: number; setsTotal: number } {
		if (!data) return { exDone: 0, exTotal: 0, setsDone: 0, setsTotal: 0 };
		let exDone = 0;
		let setsDone = 0;
		for (const ex of data.exercises) {
			const doneSets = ex.loggedSets.filter((l) => l.done).length;
			if (doneSets > 0) exDone += 1;
			setsDone += doneSets;
		}
		return { exDone, exTotal: data.exercises.length, setsDone, setsTotal: totalSets };
	}
	function buildRecap(actualDurationMin: number | null) {
		if (!data) return;
		const st = completionStatus();
		let volume = 0;
		for (const ex of data.exercises) {
			for (const l of ex.loggedSets) {
				if (l.done) volume += (l.weightKg ?? 0) * (l.reps ?? 0);
			}
		}
		// Durée = fenêtre en cours (+ temps réellement accumulé avant une
		// réouverture d'erreur — le temps mort inter-ouvertures n'est jamais
		// compté). `actualDurationMin` (saisie/correction manuelle) reste la
		// valeur reine quand la cliente la fournit.
		const durationMin = actualDurationMin ?? Math.max(1, Math.round((Date.now() - startedAt) / 60000) + reopenAccumulatedMin);
		// Progression notable : une charge > dernière perf sur un exercice.
		let progression: string | null = null;
		for (const ex of data.exercises) {
			if (!ex.lastPerformance?.weightKg) continue;
			const best = Math.max(
				...ex.loggedSets.filter((l) => l.done && l.weightKg != null).map((l) => l.weightKg as number),
				0
			);
			if (best > ex.lastPerformance.weightKg) {
				progression = `${ex.exercise?.name ?? 'Un exercice'} : ${best} kg — de mieux en mieux !`;
				break;
			}
		}
		recap = { durationMin, setsDone: st.setsDone, setsTotal: st.setsTotal, exDone: st.exDone, exTotal: st.exTotal, volumeKg: volume, progression };
	}

	/** Étape 1 : « Terminer la séance » → résumé local.
	 * Séance manifestement incomplète (aucune série validée, ou très peu par
	 * rapport au programme) → confirmation RENFORCÉE : un faux « Terminer »
	 * n'enregistre jamais une séance vide sans avertissement explicite. */
	function requestFinish() {
		if (!data) return;
		const st = completionStatus();
		const sparse = st.setsDone === 0 || (totalSets > 0 && st.setsDone / totalSets < FEW_SETS_RATIO);
		if (st.exDone < st.exTotal || sparse) {
			confirmPartial = true;
			return;
		}
		openRecap();
	}
	function confirmFinishPartial() {
		confirmPartial = false;
		openRecap();
	}

	/** Ouvre le récap — avec confirmation si la durée détectée est étrange. */
	function openRecap() {
		stopElapsed(); // le chrono global s'arrête ici — la durée enregistrée est figée
		const detected = detectedDurationMin();
		if (detected < DURATION_MIN_THRESHOLD || detected > DURATION_MAX_THRESHOLD) {
			// Panneau léger, uniquement à ce moment — jamais bloquant, fermable.
			durationConfirm = { detectedMin: detected };
			return;
		}
		buildRecap(null);
		mode = 'recap';
		stopTimer();
	}
	/** Durée détectée : fenêtre en cours (+ temps réellement accumulé avant
	 *  une réouverture d'erreur — le temps mort inter-ouvertures est exclu). */
	function detectedDurationMin(): number {
		const ms = sessionStarted ? Date.now() - startedAt : Date.now() - startedAt;
		return Math.max(1, Math.round(ms / 60000) + reopenAccumulatedMin);
	}
	function acceptDetectedDuration() {
		durationConfirm = null;
		buildRecap(null);
		mode = 'recap';
		stopTimer();
	}
	function chooseSuggestedDuration(min: number) {
		durationConfirm = null;
		buildRecap(min);
		mode = 'recap';
		stopTimer();
	}
	function applyManualDuration() {
		const n = Math.round(Number(manualDurationInput.replace(',', '.')));
		if (!Number.isFinite(n) || n < 1 || n > 600) return;
		durationConfirm = null;
		buildRecap(n);
		mode = 'recap';
		stopTimer();
	}

	/** « Je n'ai pas réalisé cette séance » — clôture sans dépense sportive. */
	async function skipSession() {
		finishing = true;
		err = '';
		try {
			durationConfirm = null;
			await fetch(`/api/training/session/${scheduledId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ skipped: true }),
			});
			onFinished?.();
		} catch {
			err = "Impossible d'enregistrer — réessaie.";
		} finally {
			finishing = false;
		}
	}

	/* ── Réouverture d'une séance terminée PAR ERREUR (rattrapage) ──
	   L'occurrence (scheduledId) reste LA MÊME : statut completed → planned,
	   séries déjà renseignées conservées, dépense sportive liée supprimée
	   (la complétion suivante en recrée UNE seule, recalculée). startedAt est
	   réarmé côté backend à l'instant de la réouverture → le chrono repart de
	   zéro et le temps écoulé entre les deux ouvertures n'est JAMAIS compté
	   comme durée d'entraînement. Aucune nouvelle séance, aucun doublon. */
	async function reopenFinishedSession() {
		if (reopening) return;
		reopening = true;
		err = '';
		try {
			const r = await fetch(`/api/training/session/${scheduledId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ reopen: true }),
			}).then((x) => x.json());
			if (r.error) throw new Error(r.error);
			// Rechargement complet de la MÊME occurrence (mêmes séries).
			// startedAt backend repart de maintenant (nouvelle fenêtre active) ;
			// le temps déjà accumulé est conservé côté front pour être ré-ajouté
			// à la re-complétion — le temps mort inter-ouvertures reste exclu.
			reopenAccumulatedMin = Number(r.accumulatedMin ?? 0);
			alreadyCompleted = false;
			recap = null;
			mode = 'libre';
			reopenConfirm = false;
			await loadSession();
		} catch {
			// La feuille reste ouverte : l'erreur est affichée dedans, la
			// cliente peut réessayer sans rien perdre.
			err = "Impossible de rouvrir la séance — réessaie.";
		} finally {
			reopening = false;
		}
	}

	/** Étape 2 : « Enregistrer et fermer » → POST unique (durée + difficulté + note). */
	async function saveAndClose() {
		finishing = true;
		err = '';
		try {
			const durationMin = recap?.durationMin ?? Math.max(1, Math.round((Date.now() - startedAt) / 60000) + reopenAccumulatedMin);
			await fetch(`/api/training/session/${scheduledId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					durationMin,
					...(difficulty != null ? { difficulty } : {}),
					...(clientNote.trim() ? { note: clientNote.trim() } : {}),
				}),
			});
			onFinished?.();
		} catch {
			err = 'Impossible de terminer la séance — réessaie.';
		} finally {
			finishing = false;
		}
	}
	function closeRunner() {
		// Séance déjà réalisée : lecture seule → simple retour.
		onFinished?.();
	}

	/* ── Affichage helpers ── */
	const PHASE_LABELS: Record<string, string> = {
		echauffement: 'Échauffement',
		principal: 'Entraînement principal',
		finisher: 'Finisher',
	};
	const PHASE_ORDER: Record<string, number> = { echauffement: 0, principal: 1, finisher: 2 };
	function phasesOf(exs: Ex[]): string[] {
		const set = new Set(exs.map((e) => e.phase ?? 'principal'));
		return [...set].sort((a, b) => (PHASE_ORDER[a] ?? 1) - (PHASE_ORDER[b] ?? 1));
	}
	function repsLabel(s: ExSet | undefined): string {
		if (!s) return '—';
		if (s.repsMin != null && s.repsMax != null && s.repsMin !== s.repsMax) return `${s.repsMin}–${s.repsMax}`;
		if (s.repsMin != null) return String(s.repsMin);
		if (s.repsMax != null) return String(s.repsMax);
		return '—';
	}
	function fmtKg(n: number): string {
		return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
	}
	function lastPerfLabel(ex: Ex): string | null {
		if (!ex.lastPerformance) return null;
		const p = ex.lastPerformance;
		if (ex.mode === 'time') {
			return p.durationSeconds ? `Dernière fois : ${p.durationSeconds} s` : null;
		}
		const bits: string[] = [];
		if (p.reps != null) bits.push(`${p.reps} reps`);
		if (p.weightKg != null) bits.push(`${fmtKg(p.weightKg)} kg`);
		return bits.length ? `Dernière fois : ${bits.join(' × ')}` : null;
	}
	function mediaFor(ex: Ex): string | null {
		return ex.exercise?.animationUrl ?? ex.exercise?.mediaUrl ?? null;
	}
	/** Vidéo du mouvement (.mp4/.webm) — sinon null (gif/image statique). */
	function mediaVideo(ex: Ex): string | null {
		const u = ex.exercise?.animationUrl ?? ex.exercise?.mediaUrl ?? null;
		return u && /\.(mp4|webm|mov)(\?|$)/i.test(u) ? u : null;
	}
	/** Image à afficher : gif si média animé gif, poster derrière une vidéo. */
	function mediaImage(ex: Ex): string | null {
		const u = ex.exercise?.animationUrl ?? ex.exercise?.mediaUrl ?? null;
		if (u && /\.(mp4|webm|mov)(\?|$)/i.test(u)) return ex.exercise?.posterUrl ?? null;
		return u ?? ex.exercise?.posterUrl ?? null;
	}

	/* ── Aperçu plein écran du mouvement (vignette cliquable) ── */
	let previewEx = $state<Ex | null>(null);
</script>

<div class="mx-auto w-full max-w-md px-4 pb-8 pt-3">
	<!-- ═══════════ RECAP (résumé de fin / séance déjà réalisée) ═══════════ -->
	{#if mode === 'recap' && recap}
		<div class="pt-2 text-center">
			<div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand text-white">
				<Icon name="check" size={30} strokeWidth={2.5} />
			</div>
			<h1 class="mt-3 font-display text-2xl font-bold text-ink">Séance terminée !</h1>
			<p class="mt-1 text-sm text-mist">{data?.session.name}</p>

			<div class="mt-5 grid grid-cols-3 gap-2">
				<div class="rounded-2xl border border-line bg-card p-3">
					<p class="font-display text-xl font-bold text-ink">{recap.durationMin}</p>
					<p class="text-[11px] font-semibold uppercase tracking-wide text-mist">min</p>
				</div>
				<div class="rounded-2xl border border-line bg-card p-3">
					<p class="font-display text-xl font-bold text-ink">{recap.exDone}/{recap.exTotal}</p>
					<p class="text-[11px] font-semibold uppercase tracking-wide text-mist">exercices</p>
				</div>
				<div class="rounded-2xl border border-line bg-card p-3">
					<p class="font-display text-xl font-bold text-ink">{recap.setsDone}</p>
					<p class="text-[11px] font-semibold uppercase tracking-wide text-mist">séries</p>
				</div>
			</div>
			{#if recap.volumeKg > 0}
				<p class="mt-3 rounded-xl bg-brand-light px-4 py-2.5 text-sm font-semibold text-brand-dark">
					{Math.round(recap.volumeKg).toLocaleString('fr-FR')} kg déplacés au total
				</p>
			{/if}
			{#if recap.progression}
				<p class="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-warn-light px-4 py-2.5 text-sm font-semibold text-ink">
					<Icon name="trophy" size={15} class="text-warn" /> {recap.progression}
				</p>
			{/if}
			{#if alreadyCompleted}
				<p class="mt-3 rounded-xl bg-line/40 px-4 py-2.5 text-sm font-semibold text-mist">
					{recap.setsDone}/{recap.setsTotal} séries réalisées
				</p>
			{/if}

			{#if !alreadyCompleted}
				<!-- Durée : modifiable avant validation (durée cohérente = aucune friction) -->
				<button
					type="button"
					onclick={() => {
						manualDurationInput = String(recap?.durationMin ?? '');
						durationConfirm = { detectedMin: recap?.durationMin ?? 0 };
					}}
					class="mx-auto mt-2 block text-xs font-semibold text-mist transition hover:text-ink"
				>
					Modifier la durée
				</button>
				<!-- Option légère : difficulté ressentie + note -->
				<div class="mt-5 rounded-2xl border border-line bg-card p-4 text-left">
					<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Difficulté ressentie</p>
					<div class="mt-2 flex justify-between gap-1.5">
						{#each [1, 2, 3, 4, 5] as d (d)}
							<button
								type="button"
								onclick={() => (difficulty = difficulty === d ? null : d)}
								class="h-10 flex-1 rounded-xl border-2 text-sm font-bold transition {difficulty === d
									? 'border-brand bg-brand text-white'
									: 'border-line text-mist hover:border-brand/50'}"
							>{d}</button>
						{/each}
					</div>
					<p class="mt-0.5 text-[10px] text-mist">1 = très facile · 5 = très dur</p>
					<label class="mt-3 block">
						<span class="text-[11px] font-bold uppercase tracking-widest text-mist">Une note pour ton coach (facultatif)</span>
						<textarea
							bind:value={clientNote}
							rows="2"
							class="mt-1 w-full resize-none rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"
						></textarea>
					</label>
					{#if err}
						<p class="mt-2 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{err}</p>
					{/if}
					<button
						type="button"
						disabled={finishing}
						onclick={saveAndClose}
						class="mt-3 w-full rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
					>
						{finishing ? 'Enregistrement…' : 'Enregistrer et fermer'}
					</button>
				</div>
			{:else}
				<!-- Séance réalisée (lecture seule) : correction d'erreur possible,
				     action discrète — la réouverture exige une confirmation. -->
				<button
					type="button"
					onclick={() => (reopenConfirm = true)}
					disabled={reopening}
					class="mt-3 w-full rounded-xl border-2 border-line bg-card px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-brand disabled:opacity-60"
				>
					<Icon name="pencil" size={14} class="mr-1 inline text-mist" /> Reprendre / modifier la séance
				</button>
				<button
					type="button"
					onclick={closeRunner}
					class="mt-2 w-full rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-brand"
				>
					Retour à l'entraînement
				</button>
			{/if}
		</div>
	{:else if loading}
		<div class="pt-10 text-center">
			<p class="text-sm text-mist">Chargement de la séance…</p>
			<button
				type="button"
				onclick={() => (diagForced = true)}
				class="mx-auto mt-6 block rounded-xl border-2 border-line px-4 py-2 text-xs font-semibold text-mist"
			>
				Cela prend trop de temps
			</button>
		</div>
		{#if diagForced}
			<div class="pt-10 text-center">
				<p class="mx-auto max-w-xs rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm font-medium text-danger">{SESSION_LOAD_ERROR_MESSAGE}</p>
				<button type="button" onclick={loadSession} class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark">
					<Icon name="rotateCcw" size={15} /> Réessayer
				</button>
				<button type="button" onclick={closeRunner} class="mt-2 w-full rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink">Retour</button>
			</div>
		{/if}
	{:else if err && !data}
		<div class="pt-10 text-center">
			<div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-danger-light">
				<Icon name="triangleAlert" size={22} class="text-danger" />
			</div>
			<p class="mx-auto max-w-xs rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm font-medium text-danger">{err}</p>
			<button
				type="button"
				onclick={loadSession}
				class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark"
			>
				<Icon name="rotateCcw" size={15} /> Réessayer
			</button>
			<button type="button" onclick={closeRunner} class="mt-2 w-full rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink">Retour</button>
		</div>
	{:else if data}
		<!-- ═══════════ HEADER séance ═══════════ -->
		<div class="mb-4 flex items-start justify-between gap-3">
			<div class="min-w-0">
				<h1 class="truncate font-display text-2xl font-semibold text-ink">{data.session.name}</h1>
				<p class="mt-0.5 flex items-center gap-2 text-sm text-mist">
					<span class="flex items-center gap-1"><Icon name="clock" size={13} /> ≈ {data.estimatedMin} min</span>
					{#if data.programName}<span class="truncate">· {data.programName}</span>{/if}
				</p>
				{#if sessionStarted && elapsedLabel}
					<!-- Séance en cours : chrono global visible en permanence + accès direct à la fin -->
					<div class="mt-2 flex items-center gap-2">
						<span class="inline-flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold text-brand-dark">
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-brand"></span>
							Séance en cours · {elapsedLabel}
						</span>
						<button
							type="button"
							onclick={requestFinish}
							class="rounded-full bg-ink px-3 py-1 text-[11px] font-bold text-white transition hover:bg-brand"
						>
							Terminer
						</button>
					</div>
				{/if}
			</div>
			<button
				type="button"
				onclick={closeRunner}
				class="rounded-full p-1.5 text-mist transition hover:bg-line/50 hover:text-ink"
				aria-label="Fermer"
			>
				<Icon name="x" size={18} />
			</button>
		</div>

		{#if err}
			<p class="mb-3 rounded-xl border-2 border-danger bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{err}</p>
		{/if}

		{#if mode === 'libre' && timerKind === 'rest'}
			<!-- ── Repos (mode manuel) : compte à rebours de la série validée — Passer/fermer, jamais bloquant ── -->
			<div class="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-brand/40 bg-brand-light/60 px-4 py-3">
				<p class="flex items-center gap-2 text-sm font-bold text-ink">
					<span class="h-2 w-2 animate-pulse rounded-full bg-brand"></span>
					Repos · <span class="tabular-nums">{fmtTimer(timerLeft)}</span>
				</p>
				<button type="button" onclick={stopTimer} class="rounded-full bg-ink px-3 py-1 text-[11px] font-bold text-white transition hover:bg-brand">
					Passer
				</button>
			</div>
		{/if}

		<!-- ═══════════ MODE LIBRE ═══════════ -->
		{#if mode === 'libre'}
			{#each phasesOf(data.exercises) as phase (phase)}
				<section class="mb-5">
					{#if phasesOf(data.exercises).length > 1}
						<h2 class="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-mist">
							<Icon name={phase === 'echauffement' ? 'flame' : phase === 'finisher' ? 'zap' : 'dumbbell'} size={13} class="text-brand" />
							{PHASE_LABELS[phase] ?? phase}
						</h2>
					{/if}
					{#each data.exercises.filter((e) => (e.phase ?? 'principal') === phase) as ex (ex._id)}
						{@const doneCount = ex.loggedSets.filter((l) => l.done).length}
						<article class="mb-3 overflow-hidden rounded-2xl border border-line bg-card shadow-sm {doneCount === ex.sets.length && ex.sets.length > 0 ? 'opacity-70' : ''}">
							<div class="flex items-start gap-3 p-3.5">
								{#if mediaFor(ex)}
									<!-- Vignette cliquable → aperçu plein écran du mouvement -->
									<button
										type="button"
										onclick={() => (previewEx = ex)}
										class="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-line/40"
										aria-label={`Voir le mouvement : ${ex.exercise?.name ?? 'exercice'}`}
									>
										{#if mediaVideo(ex)}
											<video src={mediaVideo(ex)!} autoplay muted loop playsinline poster={ex.exercise?.posterUrl ?? ''} class="h-full w-full object-cover"></video>
										{:else if ex.exercise?.posterUrl || ex.exercise?.mediaUrl}
											<img src={(ex.exercise?.animationUrl ?? ex.exercise?.mediaUrl)!} alt="" loading="lazy" class="h-full w-full object-cover" />
										{/if}
										{#if mediaVideo(ex)}
											<span class="absolute right-0.5 bottom-0.5 grid h-4 w-4 place-items-center rounded-full bg-ink/70 text-white"><Icon name="play" size={8} /></span>
										{/if}
									</button>
								{:else}
									<div class="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-line/40">
										<span class="grid h-full w-full place-items-center"><Icon name="dumbbell" size={18} class="text-mist" /></span>
									</div>
								{/if}
								<div class="min-w-0 flex-1">
									<h3 class="truncate text-sm font-bold text-ink">{ex.exercise?.name ?? 'Exercice'}</h3>
									<p class="text-xs text-mist">
										{ex.mode === 'time'
											? `${ex.sets.length} × ${ex.sets[0]?.durationSeconds ?? '?'} s`
											: `${ex.sets.length} × ${repsLabel(ex.sets[0])} reps`}
										{#if ex.sets[0]?.restSeconds} · repos {ex.sets[0].restSeconds} s{/if}
									</p>
									{#if lastPerfLabel(ex)}
										<p class="mt-0.5 text-[11px] font-semibold text-brand-dark">{lastPerfLabel(ex)}</p>
									{/if}
									{#if mediaFor(ex)}
										<button type="button" onclick={() => (previewEx = ex)} class="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-brand-dark transition hover:text-ink">
											<Icon name="play" size={10} /> Voir le mouvement
										</button>
									{/if}
								</div>
								<span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold {doneCount === ex.sets.length && ex.sets.length > 0 ? 'bg-brand text-white' : 'bg-line/70 text-mist'}">
									{doneCount}/{ex.sets.length}
								</span>
							</div>

							{#if ex.isFirstTime}
								<p class="mx-3.5 mb-2 rounded-lg bg-brand-light px-3 py-1.5 text-[11px] font-medium text-brand-dark">
									Indique la charge utilisée aujourd'hui. Elle sera mémorisée pour ta prochaine séance.
								</p>
							{/if}
							{#if ex.coachNote}
								<p class="mx-3.5 mb-2 rounded-lg bg-warn-light px-3 py-1.5 text-[11px] text-ink">💬 {ex.coachNote}</p>
							{/if}

							<!-- Séries : saisie directe -->
							<div class="border-t border-line/60">
								{#each ex.sets as st (st.order)}
									{@const d = getDraft(ex, st.order)}
									<div class="flex items-center gap-2 px-3.5 py-2 {st.order > 0 ? 'border-t border-line/40' : ''}">
										<button
											type="button"
											onclick={() => toggleFreeSet(ex, st.order)}
											class="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition {d.done
												? 'border-brand bg-brand text-white'
												: 'border-line text-mist hover:border-brand'}"
											aria-label={d.done ? 'Série validée' : 'Valider la série'}
										>
											{#if d.done}<Icon name="check" size={14} strokeWidth={2.5} />{/if}
										</button>
										<span class="w-12 shrink-0 text-xs font-bold text-ink">Série {st.order + 1}</span>
										{#if ex.mode === 'time'}
											<div class="flex flex-1 items-center gap-1.5">
												<input
													type="number"
													inputmode="numeric"
													bind:value={d.duration}
													disabled={d.done}
													class="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm tabular-nums outline-none focus:border-brand disabled:opacity-60"														placeholder="{st.durationSeconds ?? 60}s"
												/>
												<span class="text-xs font-semibold text-mist">s</span>
											</div>
										{:else}
											<div class="flex flex-1 items-center gap-1.5">
												<input
													type="number"
													inputmode="numeric"
													bind:value={d.reps}
													disabled={d.done}
													class="w-full min-w-0 rounded-lg border border-line bg-white px-2 py-1.5 text-sm tabular-nums outline-none focus:border-brand disabled:opacity-60"
													placeholder="{repsLabel(st)}"
												/>
												<span class="text-xs font-semibold text-mist">reps</span>
												<input
													type="text"
													inputmode="decimal"
													bind:value={d.weight}
													disabled={d.done}
													class="w-full min-w-0 rounded-lg border border-line bg-white px-2 py-1.5 text-sm tabular-nums outline-none focus:border-brand disabled:opacity-60"
													placeholder="kg"
												/>
												<span class="text-xs font-semibold text-mist">kg</span>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</article>
					{/each}
				</section>
			{/each}

			<!-- Barre d'actions mode libre -->
			<div class="sticky bottom-3 z-10 mt-2 grid gap-2">
				{#if sessionStarted}
					<button
						type="button"
						disabled={saving}
						onclick={requestFinish}
						class="w-full rounded-2xl bg-brand px-5 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-brand-dark disabled:opacity-60"
					>
						Terminer la séance
					</button>
				{:else}
					<!-- Démarrage RÉEL : un tap explicite (consulter ne démarre rien) →
					     startedAt persisté backend (survit au verrouillage/fond). -->
					<button
						type="button"
						onclick={startRealSession}
						class="w-full rounded-2xl bg-brand px-5 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-brand-dark"
					>
						<Icon name="play" size={14} class="mr-1 inline" /> Commencer la séance
					</button>
				{/if}
				<button
					type="button"
					onclick={startGuided}
					class="w-full rounded-2xl border-2 border-line bg-card px-5 py-3 text-sm font-semibold text-ink transition hover:border-brand"
				>
					<Icon name="play" size={14} class="mr-1 inline" /> Commencer en mode guidé
				</button>
			</div>
		{/if}

		<!-- ═══════════ MODE GUIDÉ ═══════════ -->
		{#if mode === 'guide' && gEx}
			{@const isRest = timerKind === 'rest'}
			{@const isDuration = timerKind === 'duration'}

			<!-- Progression -->
			<p class="mb-2 text-center text-xs font-semibold text-mist">
				Exercice {gExIdx + 1}/{data.exercises.length}{#if gEx.exercise} · {gEx.exercise.name}{/if}
			</p>

			<div class="rounded-3xl border border-line bg-card p-5 shadow-sm">
				{#if isRest}
					<!-- ── TIMER REPOS ── -->
					<p class="text-center text-[11px] font-bold uppercase tracking-widest text-mist">Repos</p>
					<div class="my-10 text-center">
						<p class="font-display text-6xl font-bold tabular-nums text-ink">{fmtTimer(timerLeft)}</p>
					</div>
					<div class="grid grid-cols-2 gap-2">
						<button
							type="button"
							onclick={() => (timerPaused = !timerPaused)}
							class="rounded-xl border-2 border-line px-4 py-3 text-sm font-semibold text-ink transition hover:border-brand"
						>
							<Icon name={timerPaused ? 'play' : 'pause'} size={15} class="mr-1 inline" />
							{timerPaused ? 'Reprendre' : 'Pause'}
						</button>
						<button
							type="button"
							onclick={skipRest}
							class="rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white transition hover:bg-brand"
						>
							Passer le repos →
						</button>
					</div>
				{:else}
					<!-- ── SÉRIE EN COURS ── -->
					<button
						type="button"
						onclick={() => (previewEx = gEx)}
						class="mx-auto mb-4 block h-28 w-28 overflow-hidden rounded-2xl bg-line/30"
						aria-label={`Voir le mouvement : ${gEx.exercise?.name ?? 'exercice'}`}
					>
						{#if mediaVideo(gEx)}
							<video src={mediaVideo(gEx)!} autoplay muted loop playsinline poster={gEx.exercise?.posterUrl ?? ''} class="h-full w-full object-cover"></video>
						{:else if mediaFor(gEx)}
							<img src={mediaFor(gEx)!} alt="" class="h-full w-full object-cover" />
						{:else}
							<span class="grid h-full w-full place-items-center"><Icon name="dumbbell" size={26} class="text-mist" /></span>
						{/if}
					</button>
					<h2 class="text-center font-display text-xl font-bold text-ink">{gEx.exercise?.name ?? 'Exercice'}</h2>
					<p class="mt-1 text-center text-sm font-semibold text-brand-dark">
						Série {gSetIdx + 1}/{gEx.sets.length}
						{#if gEx.mode === 'time'}
							· Objectif : {gSet?.durationSeconds ?? '?'} s
						{:else}																			· Objectif : {repsLabel(gSet ?? undefined)} reps{#if gSet?.targetWeight} · {fmtKg(gSet.targetWeight)} kg visés{/if}
						{/if}
					</p>

					{#if gEx.mode === 'time' && isDuration}
						<!-- Timer durée (exercice au temps) -->
						<div class="my-8 text-center">
							<p class="font-display text-6xl font-bold tabular-nums text-ink">{fmtTimer(timerLeft)}</p>
							<button
								type="button"
								onclick={() => (timerPaused = !timerPaused)}
								class="mt-3 rounded-full border-2 border-line px-4 py-2 text-xs font-semibold text-ink"
							>
								<Icon name={timerPaused ? 'play' : 'pause'} size={13} class="mr-1 inline" />
								{timerPaused ? 'Reprendre' : 'Pause'}
							</button>
						</div>
					{:else}
						<!-- Saisie reps / charge (préremplies) -->
						<div class="mx-auto mt-6 grid max-w-xs grid-cols-2 gap-3">
							<label class="text-center">
								<span class="block text-[10px] font-bold uppercase tracking-widest text-mist">Reps faites</span>
								<input
									type="number"
									inputmode="numeric"
									bind:value={gReps}
									class="mt-1 w-full rounded-xl border-2 border-line bg-white px-3 py-3 text-center font-display text-2xl font-bold tabular-nums outline-none focus:border-brand"
								/>
							</label>
							<label class="text-center">
								<span class="block text-[10px] font-bold uppercase tracking-widest text-mist">Charge (kg)</span>
								<input
									type="text"
									inputmode="decimal"
									bind:value={gWeight}
									class="mt-1 w-full rounded-xl border-2 border-line bg-white px-3 py-3 text-center font-display text-2xl font-bold tabular-nums outline-none focus:border-brand"
								/>
							</label>
						</div>
					{/if}

					{#if gEx.isFirstTime && gSetIdx === 0 && gEx.mode === 'reps'}
						<p class="mt-4 rounded-xl bg-brand-light px-3 py-2 text-center text-[11px] font-medium text-brand-dark">
							Indique la charge utilisée aujourd'hui. Elle sera mémorisée pour ta prochaine séance.
						</p>
					{/if}
					{#if lastPerfLabel(gEx) && gSetIdx === 0}
						<p class="mt-2 text-center text-xs font-semibold text-mist">{lastPerfLabel(gEx)}</p>
					{/if}

					<div class="mt-6 grid gap-2">
						{#if gEx.mode === 'time' && isDuration}
							<button
								type="button"
								disabled={saving}
								onclick={() => {
									// Fin du timer (ou anticipée) : la série est validée telle quelle.
									gDuration = String(gSet?.durationSeconds ?? '');
									void validateGuidedSet();
								}}
								class="w-full rounded-xl bg-brand px-5 py-3.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
							>
								Série terminée ✓
							</button>
						{:else}
							<button
								type="button"
								disabled={saving}
								onclick={validateGuidedSet}
								class="w-full rounded-xl bg-brand px-5 py-3.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
							>
								{saving ? 'Enregistrement…' : 'Série terminée ✓'}
							</button>
						{/if}
						<div class="grid grid-cols-2 gap-2">
							<button type="button" onclick={prevStep} class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brand">← Précédent</button>
							<button type="button" onclick={nextStep} class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-brand">Passer →</button>
						</div>
					</div>
				{/if}
			</div>

			{#if sessionStarted}
				<button
					type="button"
					onclick={requestFinish}
					class="mt-4 w-full rounded-xl border-2 border-line bg-card px-5 py-3 text-sm font-semibold text-ink transition hover:border-brand"
				>
					Terminer la séance
				</button>
			{:else}
				<button
					type="button"
					onclick={startRealSession}
					class="mt-4 w-full rounded-xl border-2 border-brand bg-brand px-5 py-3 text-sm font-bold text-white transition hover:bg-brand-dark"
				>
					<Icon name="play" size={14} class="mr-1 inline" /> Commencer la séance
				</button>
			{/if}
			<p class="mt-2 text-center text-[11px] text-mist">{guidedDone}/{guidedTotal} séries validées en mode guidé</p>
		{/if}
	{/if}
</div>

<!-- ═══ Aperçu plein écran du mouvement (vignette cliquable) — vidéo en boucle, muette, X + retour immédiat. Ne bloque jamais la saisie en cours. ═══ -->
{#if previewEx}
	<div
		class="fixed inset-0 z-[70] flex flex-col bg-ink/90"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-label={previewEx.exercise?.name ?? 'Aperçu du mouvement'}
		onclick={(e) => {
			if (e.target === e.currentTarget) previewEx = null;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') previewEx = null;
		}}
	>
		<div class="flex items-center justify-between px-4 pt-4">
			<p class="min-w-0 truncate font-display text-lg font-semibold text-white">{previewEx.exercise?.name ?? 'Exercice'}</p>
			<button
				type="button"
				onclick={() => (previewEx = null)}
				class="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
				aria-label="Fermer l'aperçu"
			>
				<Icon name="x" size={20} />
			</button>
		</div>
		<button
			type="button"
			class="flex flex-1 items-center justify-center p-4"
			onclick={() => (previewEx = null)}
			aria-label="Fermer l'aperçu"
		>
			<div class="relative max-h-[70vh] w-full max-w-md overflow-hidden rounded-3xl bg-black">
				{#if mediaVideo(previewEx)}						<video
							src={mediaVideo(previewEx)!}
							autoplay
							muted
							loop
							playsinline
							poster={previewEx.exercise?.posterUrl ?? ''}
							class="max-h-[70vh] w-full object-contain"
						></video>
				{:else if mediaFor(previewEx)}
					<img src={mediaFor(previewEx)!} alt="" class="max-h-[70vh] w-full object-contain" />
				{/if}
			</div>
		</button>
		{#if previewEx.exercise?.instructions?.length}
			<div class="max-h-32 overflow-y-auto px-6 pb-6">
				<ul class="space-y-1 text-xs leading-relaxed text-white/80">
					{#each previewEx.exercise.instructions as line, i (i)}
						<li>{i + 1}. {line}</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}

<!-- ═══ Confirmation de durée (uniquement après « Terminer la séance », si durée étrange). Panneau léger : fermable, ne bloque JAMAIS l'app, aucune perte de données, jamais une notification globale. ═══ -->
{#if durationConfirm}
	<div
		class="fixed inset-0 z-[65] grid place-items-end bg-ink/50 p-4 sm:place-items-center"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) durationConfirm = null;
		}}
	>
		<div class="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
			<h3 class="font-display text-lg font-semibold text-ink">Confirmer la durée</h3>
			<p class="mt-1 text-sm text-mist">
				G-FLUX a détecté {durationConfirm.detectedMin} min. Ça te semble juste ?
			</p>
			<div class="mt-4 grid grid-cols-2 gap-2">
				<button type="button" onclick={() => chooseSuggestedDuration(45)} class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand">45 min</button>
				<button type="button" onclick={() => chooseSuggestedDuration(60)} class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand">60 min</button>
			</div>
			<label class="mt-3 block">
				<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Modifier la durée (min)</span>
				<input
					type="number"
					inputmode="numeric"
					min="1"
					max="600"
					bind:value={manualDurationInput}
					class="w-full rounded-xl border-2 border-line px-3 py-2.5 text-sm tabular-nums outline-none focus:border-brand"
				/>
			</label>
			<div class="mt-4 grid gap-2">
				<button type="button" onclick={applyManualDuration} disabled={!manualDurationInput} class="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60">Valider cette durée</button>
				<button type="button" onclick={acceptDetectedDuration} class="rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-brand">Garder {durationConfirm.detectedMin} min</button>
				<button type="button" disabled={finishing} onclick={skipSession} class="rounded-xl px-5 py-2.5 text-sm font-semibold text-mist transition hover:text-danger disabled:opacity-60">Je n'ai pas réalisé cette séance</button>
			</div>
		</div>
	</div>
{/if}

<!-- Confirmation « terminer une séance incomplète » : avertissement RENFORCÉ si aucune série validée — un faux « Terminer » ne doit jamais passer sans un vrai choix. Bouton primaire = continuer (action sûre par défaut). -->
{#if confirmPartial && data}
	<div
		class="fixed inset-0 z-[60] grid place-items-end bg-ink/50 p-4 sm:place-items-center"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) confirmPartial = false;
		}}
	>
		<div class="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
			{#if completionStatus().setsDone === 0}
				<h3 class="font-display text-lg font-semibold text-ink">Terminer sans aucune série ?</h3>
				<p class="mt-1 rounded-xl bg-warn-light px-3 py-2.5 text-sm font-medium text-ink">
					Tu n'as pas encore terminé toutes tes séries. Veux-tu vraiment terminer cette séance ?
				</p>
			{:else}
				<h3 class="font-display text-lg font-semibold text-ink">Terminer quand même ?</h3>
				<p class="mt-1 text-sm text-mist">
					{completionStatus().exDone} exercices sur {completionStatus().exTotal} renseignés · {completionStatus().setsDone}/{completionStatus().setsTotal} séries. Ta séance sera enregistrée telle quelle.
				</p>
			{/if}
			<div class="mt-4 grid gap-2">
				<button
					type="button"
					onclick={() => (confirmPartial = false)}
					class="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
				>
					Continuer ma séance
				</button>
				<button type="button" onclick={confirmFinishPartial} class="rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-danger hover:text-danger">
					Terminer quand même
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Confirmation de RÉOUVERTURE d'une séance terminée par erreur : la même séance repasse « en cours », séries conservées, aucun doublon — jamais automatique. -->
{#if reopenConfirm && data}
	<div
		class="fixed inset-0 z-[60] grid place-items-end bg-ink/50 p-4 sm:place-items-center"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) reopenConfirm = false;
		}}
	>
		<div class="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
			<h3 class="font-display text-lg font-semibold text-ink">Reprendre la séance ?</h3>
			<p class="mt-1 text-sm text-mist">
				Ta séance repasse « en cours » : corrige ou complète tes séries, puis termine-la à nouveau. C'est LA MÊME séance — rien n'est dupliqué, l'historique sera simplement mis à jour.
			</p>
			{#if err}
				<p class="mt-2 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{err}</p>
			{/if}
			<div class="mt-4 grid gap-2">
				<button
					type="button"
					disabled={reopening}
					onclick={reopenFinishedSession}
					class="rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
				>
					{reopening ? 'Réouverture…' : 'Oui, reprendre la séance'}
				</button>
				<button type="button" onclick={() => (reopenConfirm = false)} class="rounded-xl border-2 border-line px-5 py-2.5 text-sm font-semibold text-ink">
					Annuler
				</button>
			</div>
		</div>
	</div>
{/if}
