<script lang="ts">
	/**
	 * Module Entraînement — CRM coach (V1).
	 * 3 sous-onglets : Programmes (liste), Éditeur (3 colonnes), Bibliothèque.
	 * L'onglet actif et le programme en cours vivent dans l'URL (?tab=&program=)
	 * — lien partageable, retour arrière navigateur fonctionnel.
	 */
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import ExerciseLibraryBrowser from '$lib/components/ExerciseLibraryBrowser.svelte';
	import TrainingEditor from '$lib/components/TrainingEditor.svelte';
	import { type ProgramRow } from '$lib/training';

	const GOALS: { value: string; label: string }[] = [
		{ value: 'hypertrophie', label: 'Hypertrophie' },
		{ value: 'perte_de_gras', label: 'Perte de gras' },
		{ value: 'remise_en_forme', label: 'Remise en forme' },
		{ value: 'force', label: 'Force' },
		{ value: 'autre', label: 'Autre' },
	];
	const LEVELS: { value: string; label: string }[] = [
		{ value: 'debutante', label: 'Débutante' },
		{ value: 'intermediaire', label: 'Intermédiaire' },
		{ value: 'avancee', label: 'Avancée' },
	];
	const goalLabel = (v?: string) => GOALS.find((g) => g.value === v)?.label;
	const levelLabel = (v?: string) => LEVELS.find((l) => l.value === v)?.label;

	type Tab = 'programmes' | 'editeur' | 'bibliotheque';
	const tab = $derived((page.url.searchParams.get('tab') as Tab) || 'programmes');
	const programParam = $derived(page.url.searchParams.get('program'));

	/* ── Liste des programmes ── */
	let programs = $state<ProgramRow[]>([]);
	let listLoading = $state(true);
	let listErr = $state('');

	/* Filtres liste */
	let q = $state('');
	let fGoal = $state('');
	let fLevel = $state('');
	let fSpw = $state('');
	let sort = $state('recent');

	const filtered = $derived.by(() => {
		let rows = programs;
		const needle = q.trim().toLowerCase();
		if (needle) rows = rows.filter((p) => p.name.toLowerCase().includes(needle));
		if (fGoal) rows = rows.filter((p) => p.goal === fGoal);
		if (fLevel) rows = rows.filter((p) => p.level === fLevel);
		if (fSpw) rows = rows.filter((p) => String(p.sessionsPerWeek ?? '') === fSpw);
		rows = [...rows].sort((a, b) =>
			sort === 'alpha' ? a.name.localeCompare(b.name, 'fr') : b.updatedAt - a.updatedAt
		);
		return rows;
	});

	async function loadPrograms() {
		listLoading = true;
		listErr = '';
		try {
			const r = await fetch('/api/coach/training/programs');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			programs = j.items as ProgramRow[];
		} catch (e) {
			listErr = e instanceof Error ? e.message : 'Erreur de chargement.';
		} finally {
			listLoading = false;
		}
	}

	/* ── Programme ouvert dans l'éditeur ── */
	let openProgram = $state<import('$lib/training').ProgramView | null>(null);
	let openSessions = $state<import('$lib/training').SessionView[]>([]);
	let editorLoading = $state(false);
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	async function loadProgram(id: string, opts?: { silent?: boolean }) {
		// Rechargement « silencieux » (après action de l'éditeur) : ne démonte
		// PAS le composant éditeur — sélections, picker et autosave restent en place.
		if (!opts?.silent) editorLoading = true;
		try {
			const r = await fetch(`/api/coach/training/programs/${id}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			openProgram = j.program as import('$lib/training').ProgramView;
			openSessions = j.sessions as import('$lib/training').SessionView[];
		} catch (e) {
			listErr = e instanceof Error ? e.message : 'Programme introuvable.';
			openProgram = null;
			goto('/admin/entrainement?tab=programmes', { replaceState: true });
		} finally {
			editorLoading = false;
		}
	}

	/** Recharge le programme ouvert (après action structurelle de l'éditeur). */
	async function reloadProgram() {
		if (programParam) await loadProgram(programParam, { silent: true });
	}

	/* Charge la liste une fois, puis le programme si ?program= présent. */
	$effect(() => {
		void loadPrograms();
	});
	let loadedForParam = $state('');
	$effect(() => {
		if (tab === 'editeur' && programParam && loadedForParam !== programParam) {
			loadedForParam = programParam;
			void loadProgram(programParam);
		}
	});

	/* ── Navigation onglets / éditeur (URL = source de vérité) ── */
	function openTab(t: Tab) {
		goto(t === 'programmes' ? '/admin/entrainement' : `/admin/entrainement?tab=${t}`);
	}
	function openEditor(id: string) {
		goto(`/admin/entrainement?tab=editeur&program=${id}`);
	}
	function backToList() {
		openProgram = null;
		openSessions = [];
		loadedForParam = '';
		goto('/admin/entrainement?tab=programmes', { replaceState: true });
	}

	/* ── Modale de création ── */
	let createOpen = $state(false);
	let cName = $state('');
	let cDesc = $state('');
	let cGoal = $state('hypertrophie');
	let cLevel = $state('debutante');
	let cSpw = $state('3');
	let cFile = $state<File | null>(null);
	let cErr = $state('');
	let creating = $state(false);

	function openCreate() {
		cName = '';
		cDesc = '';
		cGoal = 'hypertrophie';
		cLevel = 'debutante';
		cSpw = '3';
		cFile = null;
		cErr = '';
		createOpen = true;
	}
	async function submitCreate(e: SubmitEvent) {
		e.preventDefault();
		if (cName.trim().length < 2) {
			cErr = 'Donne un nom au programme.';
			return;
		}
		creating = true;
		cErr = '';
		try {
			const form = new FormData();
			form.set('name', cName.trim());
			if (cDesc.trim()) form.set('description', cDesc.trim());
			form.set('goal', cGoal);
			form.set('level', cLevel);
			form.set('sessionsPerWeek', cSpw);
			if (cFile) form.set('image', cFile);
			const r = await fetch('/api/coach/training/programs', { method: 'POST', body: form });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			createOpen = false;
			await loadPrograms();
			openEditor(j.programId as string); // après validation → Éditeur automatiquement
		} catch (err) {
			cErr = err instanceof Error ? err.message : 'Erreur à la création.';
		} finally {
			creating = false;
		}
	}

	/* ── Actions liste (dupliquer / supprimer) ── */
	let busyId = $state<string | null>(null);
	async function duplicateProgram(id: string) {
		busyId = id;
		try {
			const r = await fetch(`/api/coach/training/programs/${id}`, { method: 'POST' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadPrograms();
		} catch (e) {
			listErr = e instanceof Error ? e.message : 'Erreur de duplication.';
		} finally {
			busyId = null;
		}
	}
	async function deleteProgram(p: ProgramRow) {
		if (!confirm(`Supprimer définitivement « ${p.name} » et toutes ses séances ?`)) return;
		busyId = p._id;
		try {
			const r = await fetch(`/api/coach/training/programs/${p._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadPrograms();
		} catch (e) {
			listErr = e instanceof Error ? e.message : 'Erreur de suppression.';
		} finally {
			busyId = null;
		}
	}

	const spwChoices = $derived([...new Set(programs.map((p) => p.sessionsPerWeek).filter((n): n is number => !!n))].sort((a, b) => a - b));
</script>

<svelte:head><title>Entraînement — CRM G-Flux</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<div class="flex gap-1 rounded-2xl border border-line bg-card p-1 shadow-sm">
		{#each [['programmes', 'Programmes'], ['editeur', 'Éditeur'], ['bibliotheque', 'Bibliothèque']] as [t, label] (t)}
			<button
				type="button"
				onclick={() => openTab(t as Tab)}
				class="rounded-xl px-4 py-1.5 text-sm font-bold transition {tab === t ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
			>
				{label}
			</button>
		{/each}
	</div>
	{#if tab === 'editeur'}
		<span class="flex items-center gap-1.5 text-xs font-semibold {saveState === 'error' ? 'text-red-600' : 'text-mist'}">
			{#if saveState === 'saving'}
				<Icon name="clock" size={13} /> Enregistrement…
			{:else if saveState === 'saved'}
				<Icon name="circleCheck" size={13} class="text-green-600" /> Enregistré
			{:else if saveState === 'error'}
				<Icon name="triangleAlert" size={13} /> Erreur d'enregistrement
			{/if}
		</span>
	{/if}
</div>

{#if tab === 'programmes'}
	<!-- ═══════════ ONGLET PROGRAMMES ═══════════ -->
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<h1 class="font-display text-2xl font-bold text-ink">Programmes d'entraînement</h1>
		<button
			type="button"
			onclick={openCreate}
			class="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-110"
		>
			<Icon name="plus" size={15} /> Nouveau programme
		</button>
	</div>

	<section class="mb-4 rounded-2xl border border-line bg-card p-4 shadow-sm">
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex min-w-56 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 focus-within:border-brand">
				<Icon name="search" size={16} class="shrink-0 text-mist" />
				<input type="search" bind:value={q} placeholder="Rechercher un programme…" class="w-full bg-transparent text-sm outline-none placeholder:text-mist" />
			</div>
			<select bind:value={fGoal} class="rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-semibold text-ink outline-none focus:border-brand">
				<option value="">Tous les objectifs</option>
				{#each GOALS as g (g.value)}<option value={g.value}>{g.label}</option>{/each}
			</select>
			<select bind:value={fLevel} class="rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-semibold text-ink outline-none focus:border-brand">
				<option value="">Tous les niveaux</option>
				{#each LEVELS as l (l.value)}<option value={l.value}>{l.label}</option>{/each}
			</select>
			<select bind:value={fSpw} class="rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-semibold text-ink outline-none focus:border-brand">
				<option value="">Toutes les fréquences</option>
				{#each spwChoices as n (n)}<option value={String(n)}>{n} séance{n > 1 ? 's' : ''}/sem.</option>{/each}
			</select>
			<select bind:value={sort} class="rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-semibold text-ink outline-none focus:border-brand">
				<option value="recent">Plus récents</option>
				<option value="alpha">Alphabétique</option>
			</select>
		</div>
	</section>

	{#if listErr}
		<p class="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{listErr}</p>
	{/if}

	{#if listLoading}
		<p class="py-16 text-center text-sm text-mist">Chargement…</p>
	{:else if filtered.length === 0}
		<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
			<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light">
				<Icon name="dumbbell" size={26} class="text-brand" />
			</div>
			<p class="font-semibold text-ink">{programs.length === 0 ? 'Aucun programme pour le moment' : 'Aucun programme ne correspond aux filtres'}</p>
			<p class="mx-auto mt-1 max-w-sm text-sm text-mist">
				{programs.length === 0 ? 'Crée ton premier programme : nom, objectif, niveau, puis compose tes séances depuis la bibliothèque.' : 'Ajuste la recherche ou les filtres.'}
			</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each filtered as p (p._id)}
				<article class="flex items-center gap-4 overflow-hidden rounded-2xl border border-line bg-card shadow-sm transition hover:border-brand">
					<span class="relative block h-20 w-32 shrink-0 bg-line/40 sm:h-24 sm:w-40">
						{#if p.imageUrl}
							<img src={p.imageUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
						{:else}
							<span class="grid h-full w-full place-items-center"><Icon name="dumbbell" size={22} class="text-mist" /></span>
						{/if}
					</span>
					<div class="min-w-0 flex-1 py-3 pr-2">
						<h2 class="truncate font-display text-lg font-bold text-ink">{p.name}</h2>
						<p class="mt-0.5 text-xs text-mist">
							{p.sessionCount} séance{p.sessionCount > 1 ? 's' : ''}
							{#if p.sessionsPerWeek} · {p.sessionsPerWeek} séance{p.sessionsPerWeek > 1 ? 's' : ''}/semaine{/if}
							{#if p.goalLabel} · {p.goalLabel}{/if}
							{#if p.levelLabel} · {p.levelLabel}{/if}
						</p>
						{#if p.description}
							<p class="mt-1 line-clamp-1 text-xs text-mist">{p.description}</p>
						{/if}
					</div>
					<div class="flex shrink-0 items-center gap-1.5 pr-3">
						<button
							type="button"
							onclick={() => openEditor(p._id)}
							class="flex items-center gap-1 rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
						>
							<Icon name="pencil" size={13} /> Modifier
						</button>
						<button
							type="button"
							title="Dupliquer"
							disabled={busyId === p._id}
							onclick={() => duplicateProgram(p._id)}
							class="rounded-xl border border-line bg-white p-2 text-mist transition hover:border-brand hover:text-brand disabled:opacity-50"
						>
							<Icon name="copy" size={15} />
						</button>
						<button
							type="button"
							title="Supprimer"
							disabled={busyId === p._id}
							onclick={() => deleteProgram(p)}
							class="rounded-xl border border-line bg-white p-2 text-mist transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
						>
							<Icon name="trash" size={15} />
						</button>
					</div>
				</article>
			{/each}
		</div>
	{/if}
{:else if tab === 'editeur'}
	<!-- ═══════════ ONGLET ÉDITEUR ═══════════ -->
	{#if !programParam}
		<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-20 text-center">
			<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light">
				<Icon name="edit" size={24} class="text-brand" />
			</div>
			<p class="font-semibold text-ink">Aucun programme ouvert</p>
			<p class="mx-auto mt-1 max-w-sm text-sm text-mist">Choisis un programme dans l'onglet « Programmes » puis clique « Modifier ».</p>
			<button type="button" onclick={() => openTab('programmes')} class="mt-4 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand">
				Voir les programmes
			</button>
		</div>
	{:else if editorLoading || !openProgram}
		<p class="py-16 text-center text-sm text-mist">Chargement du programme…</p>
	{:else}
		<TrainingEditor
			program={openProgram}
			sessions={openSessions}
			onReload={reloadProgram}
			onSaveState={(s) => (saveState = s)}
			onBack={backToList}
		/>
	{/if}
{:else}
	<!-- ═══════════ ONGLET BIBLIOTHÈQUE ═══════════ -->
	<h1 class="mb-4 font-display text-2xl font-bold text-ink">Bibliothèque d'exercices</h1>
	<ExerciseLibraryBrowser variant="page" />
{/if}

<!-- ═══════════ Modale de création ═══════════ -->
{#if createOpen}
	<div
		class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) createOpen = false;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') createOpen = false;
		}}
	>
		<div class="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-card p-6 shadow-xl">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="font-display text-xl font-bold text-ink">Nouveau programme</h2>
				<button type="button" onclick={() => (createOpen = false)} class="rounded-full p-1 text-mist transition hover:bg-line/50 hover:text-ink">
					<Icon name="x" size={18} />
				</button>
			</div>
			<form onsubmit={submitCreate} class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<label class="sm:col-span-2">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Nom du programme *</span>
					<input bind:value={cName} required placeholder="Ex. Full body débutante — 3 j/sem." class="w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand" />
				</label>
				<label class="sm:col-span-2">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Description (facultative)</span>
					<textarea bind:value={cDesc} rows="2" class="w-full resize-none rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand"></textarea>
				</label>
				<label>
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Objectif</span>
					<select bind:value={cGoal} class="w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand">
						{#each GOALS as g (g.value)}<option value={g.value}>{g.label}</option>{/each}
					</select>
				</label>
				<label>
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Niveau</span>
					<select bind:value={cLevel} class="w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand">
						{#each LEVELS as l (l.value)}<option value={l.value}>{l.label}</option>{/each}
					</select>
				</label>
				<label>
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Séances par semaine</span>
					<input type="number" bind:value={cSpw} min="1" max="7" class="w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-brand" />
				</label>
				<label>
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-widest text-mist">Image (facultative)</span>
					<input
						type="file"
						accept="image/*"
						onchange={(e) => {
							const files = (e.currentTarget as HTMLInputElement).files;
							cFile = files && files.length > 0 ? files[0] : null;
						}}
						class="w-full rounded-xl border-2 border-line bg-white px-3 py-1.5 text-sm text-mist outline-none focus:border-brand file:mr-2 file:rounded-lg file:border-0 file:bg-brand-light file:px-2 file:py-1 file:text-xs file:font-bold file:text-brand"
					/>
				</label>
				{#if cErr}
					<p class="sm:col-span-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{cErr}</p>
				{/if}
				<div class="sm:col-span-2 mt-1 flex justify-end gap-2">
					<button type="button" onclick={() => (createOpen = false)} class="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand">
						Annuler
					</button>
					<button type="submit" disabled={creating} class="rounded-full bg-brand px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60">
						{creating ? 'Création…' : 'Créer et ouvrir l\'éditeur'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
