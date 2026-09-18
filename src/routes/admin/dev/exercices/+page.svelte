<script lang="ts">
	/**
	 * OUTIL DE VALIDATION du socle Entraînement (pas le futur CRM Coach) :
	 * vérifier que la bibliothèque G-FLUX d'exercices est correctement
	 * importée et exploitable — total, recherche, filtres, miniatures, fiche.
	 *
	 * Le frontend ne dépend d'AUCUNE URL source codée en dur : tout passe par
	 * les champs du modèle G-FLUX (mediaUrl, thumbnailUrl, sourceLabel…).
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ExerciseMedia from '$lib/components/ExerciseMedia.svelte';

	type ExerciseView = {
		_id: string;
		gfluxExerciseId: string;
		name: string;
		sourceName?: string;
		muscleGroup?: string;
		secondaryMuscles?: string[];
		bodyPart?: string;
		equipment?: string;
		category?: string;
		instructions?: string[];
		mediaUrl?: string;
		thumbnailUrl?: string;
		sourceMediaUrl?: string;
		mediaUrls?: string[];
		source: string;
		sourceLabel: string;
		sourceExerciseId?: string;
		licenseNote?: string;
		active: boolean;
		hidden: boolean;
		system: boolean;
		createdAt: number;
		updatedAt: number;
	};

	type Stats = {
		total: number;
		active: number;
		hidden: number;
		custom: number;
		bySource: [string, number][];
		byMuscleGroup: [string, number][];
		byEquipment: [string, number][];
	};

	type Page = { items: ExerciseView[]; total: number; hasMore: boolean };

	const PAGE_SIZE = 24;

	let stats = $state<Stats | null>(null);
	let items = $state<ExerciseView[]>([]);
	let total = $state(0);
	let hasMore = $state(false);
	let offset = $state(0);
	let loading = $state(true);
	let pageErr = $state('');

	/* Filtres (l'appli relance la recherche à chaque changement) */
	let q = $state('');
	let muscleGroup = $state('');
	let equipment = $state('');
	let source = $state('');
	let includeHidden = $state(false);
	/* Derniers filtres appliqués (pour « Charger plus » sans régression). */
	let applied = $state({ q: '', muscleGroup: '', equipment: '', source: '', includeHidden: false });

	/* Fiche détaillée */
	let detail = $state<ExerciseView | null>(null);
	let detailLoading = $state(false);

	async function loadStats() {
		const r = await fetch('/api/coach/exercises/stats');
		const j = await r.json();
		if (j.error) throw new Error(j.error);
		stats = j as Stats;
	}

	async function search(reset: boolean) {
		loading = true;
		pageErr = '';
		try {
			if (reset) {
				applied = { q: q.trim(), muscleGroup, equipment, source, includeHidden };
				offset = 0;
			}
			const params = new URLSearchParams();
			if (applied.q) params.set('q', applied.q);
			if (applied.muscleGroup) params.set('muscleGroup', applied.muscleGroup);
			if (applied.equipment) params.set('equipment', applied.equipment);
			if (applied.source) params.set('source', applied.source);
			if (applied.includeHidden) params.set('includeHidden', '1');
			params.set('offset', String(offset));
			params.set('limit', String(PAGE_SIZE));
			const r = await fetch(`/api/coach/exercises?${params.toString()}`);
			const j = (await r.json()) as Page & { error?: string };
			if (j.error) throw new Error(j.error);
			items = offset === 0 ? j.items : [...items, ...j.items];
			total = j.total;
			hasMore = j.hasMore;
		} catch (e) {
			pageErr = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		offset = items.length;
		await search(false);
	}

	/** Recherche "live" : petit délai pour ne pas requêter à chaque frappe. */
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => search(true), 300);
	}

	function toggleFilters(source2: string, value: string) {
		if (source2 === 'muscle') muscleGroup = muscleGroup === value ? '' : value;
		if (source2 === 'equipment') equipment = equipment === value ? '' : value;
		if (source2 === 'source') source = source === value ? '' : value;
		search(true);
	}

	async function openDetail(ex: ExerciseView) {
		detailLoading = true;
		try {
			const r = await fetch(`/api/coach/exercises/${ex._id}?id=${ex._id}`);
			const j = await r.json();
			detail = j.error ? ex : (j as ExerciseView);
		} catch {
			detail = ex;
		} finally {
			detailLoading = false;
		}
	}

	async function toggleHidden(ex: ExerciseView) {
		try {
			const r = await fetch(`/api/coach/exercises/${ex._id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: ex._id, hidden: !ex.hidden }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			items = items.map((it) => (it._id === ex._id ? { ...it, hidden: !ex.hidden } : it));
			if (detail?._id === ex._id) detail = { ...detail, hidden: !ex.hidden };
			await loadStats();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : String(e);
		}
	}

	function fmtDate(ts: number) {
		return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
	}

	onMount(async () => {
		try {
			await loadStats();
			await search(true);
		} catch (e) {
			pageErr = e instanceof Error ? e.message : String(e);
			loading = false;
		}
	});
</script>

<svelte:head><title>Exercices (validation) — CRM G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<header class="mb-5">
		<p class="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-brand">
			<Icon name="info" size={13} /> Outil de validation — socle Entraînement
		</p>
		<h1 class="font-display text-2xl font-semibold text-ink">Bibliothèque d'exercices G-FLUX</h1>
		<p class="mt-0.5 text-sm text-mist">
			Vérification des données importées — ce n'est ni la bibliothèque coach finale, ni le CRM.
		</p>
	</header>

	{#if pageErr}
		<p class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{pageErr}</p>
	{/if}

	<!-- ── Statistiques globales ── -->
	{#if stats}
		<section class="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
			<div class="rounded-2xl border border-line bg-card p-3 text-center shadow-sm">
				<span class="block font-display text-2xl font-bold text-ink tabular-nums">{stats.total}</span>
				<span class="block text-[11px] text-mist">exercices en base</span>
			</div>
			<div class="rounded-2xl border border-line bg-card p-3 text-center shadow-sm">
				<span class="block font-display text-2xl font-bold text-brand tabular-nums">{stats.active}</span>
				<span class="block text-[11px] text-mist">actifs (visibles)</span>
			</div>
			<div class="rounded-2xl border border-line bg-card p-3 text-center shadow-sm">
				<span class="block font-display text-2xl font-bold text-ink tabular-nums">{stats.hidden}</span>
				<span class="block text-[11px] text-mist">masqués</span>
			</div>
			<div class="rounded-2xl border border-line bg-card p-3 text-center shadow-sm">
				<span class="block font-display text-2xl font-bold text-ink tabular-nums">{stats.custom}</span>
				<span class="block text-[11px] text-mist">créés coach</span>
			</div>
		</section>
	{/if}

	<!-- ── Recherche + filtres ── -->
	<section class="mb-4 rounded-2xl border border-line bg-card p-4 shadow-sm">
		<div class="flex items-center gap-2">
			<Icon name="search" size={17} class="shrink-0 text-mist" />
			<input
				type="search"
				bind:value={q}
				oninput={onSearchInput}
				placeholder="Rechercher un exercice (ex. squat, curl)…"
				class="w-full rounded-xl border-2 border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"
			/>
		</div>

		{#if stats}
			{#if stats.byMuscleGroup.length > 0}
				<p class="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-widest text-mist">Groupe musculaire</p>
				<div class="flex flex-wrap gap-1.5">
					{#each stats.byMuscleGroup as [name, count] (name)}
						<button
							type="button"
							onclick={() => toggleFilters('muscle', name)}
							class="rounded-full border px-2.5 py-1 text-xs font-semibold transition {muscleGroup === name
								? 'border-brand bg-brand text-white'
								: 'border-line bg-white text-ink hover:border-brand'}"
						>
							{name} <span class="tabular-nums opacity-70">{count}</span>
						</button>
					{/each}
				</div>
			{/if}
			{#if stats.byEquipment.length > 0}
				<p class="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-widest text-mist">Équipement</p>
				<div class="flex flex-wrap gap-1.5">
					{#each stats.byEquipment as [name, count] (name)}
						<button
							type="button"
							onclick={() => toggleFilters('equipment', name)}
							class="rounded-full border px-2.5 py-1 text-xs font-semibold transition {equipment === name
								? 'border-brand bg-brand text-white'
								: 'border-line bg-white text-ink hover:border-brand'}"
						>
							{name} <span class="tabular-nums opacity-70">{count}</span>
						</button>
					{/each}
				</div>
			{/if}
			{#if stats.bySource.length > 1}
				<p class="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-widest text-mist">Source</p>
				<div class="flex flex-wrap gap-1.5">
					{#each stats.bySource as [name, count] (name)}
						<button
							type="button"
							onclick={() => toggleFilters('source', name)}
							class="rounded-full border px-2.5 py-1 text-xs font-semibold transition {source === name
								? 'border-brand bg-brand text-white'
								: 'border-line bg-white text-ink hover:border-brand'}"
						>
							{name} <span class="tabular-nums opacity-70">{count}</span>
						</button>
					{/each}
				</div>
			{/if}
		{/if}

		<label class="mt-3 flex cursor-pointer items-center gap-2 text-xs text-mist">
			<input type="checkbox" bind:checked={includeHidden} onchange={() => search(true)} class="accent-brand" />
			Afficher aussi les exercices masqués
		</label>
	</section>

	<!-- ── Résultats ── -->
	<p class="mb-2 text-xs text-mist tabular-nums">
		{total} exercice{total > 1 ? 's' : ''} correspond{total > 1 ? 'ent' : ''}{#if applied.q} à « {applied.q} »{/if}
	</p>

	{#if loading && items.length === 0}
		<p class="py-16 text-center text-sm text-mist">Chargement…</p>
	{:else if items.length === 0}
		<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
			<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light">
				<Icon name="dumbbell" size={26} class="text-brand" />
			</div>
			<p class="font-semibold text-ink">Aucun exercice trouvé</p>
			<p class="mx-auto mt-1 max-w-sm text-sm text-mist">
				La bibliothèque est peut-être vide : lance <code class="rounded bg-line/60 px-1">npm run import:exercises</code> pour importer la banque open ExerciseDB.
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{#each items as ex (ex._id)}
				<button
					type="button"
					onclick={() => openDetail(ex)}
					class="flex flex-col overflow-hidden rounded-2xl border border-line bg-card text-left shadow-sm transition hover:border-brand"
				>
					<div class="relative aspect-[4/3] w-full bg-line/40">
						<ExerciseMedia src={ex.thumbnailUrl} fallbackUrl={ex.mediaUrl} class="h-full w-full object-cover" />
						{#if ex.hidden}
							<span class="absolute right-1.5 top-1.5 rounded-full bg-ink/80 px-1.5 py-0.5 text-[9px] font-bold text-white">masqué</span>
						{/if}
					</div>
					<div class="flex min-w-0 flex-1 flex-col gap-0.5 p-2.5">
						<span class="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">{ex.name}</span>
						<span class="text-[11px] text-mist">{ex.muscleGroup ?? '—'}{ex.equipment ? ` · ${ex.equipment}` : ''}</span>
					</div>
				</button>
			{/each}
		</div>

		{#if hasMore}
			<div class="mt-4 text-center">
				<button
					type="button"
					onclick={loadMore}
					disabled={loading}
					class="rounded-full border-2 border-line bg-white px-5 py-2.5 text-sm font-bold text-ink transition hover:border-brand disabled:opacity-60"
				>
					{loading ? 'Chargement…' : `Charger plus (${total - items.length} restants)`}
				</button>
			</div>
		{/if}
	{/if}
</div>

<!-- ═══════ Fiche exercice (données disponibles) ═══════ -->
{#if detail || detailLoading}
	<button type="button" class="fixed inset-0 z-[60] cursor-pointer bg-ink/50" aria-label="Fermer la fiche" onclick={() => (detail = null)}></button>
	<div class="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-2xl overflow-y-auto rounded-t-3xl border-t border-line bg-card p-5 shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[28rem] sm:rounded-l-3xl sm:rounded-tr-none">
		{#if detailLoading && !detail}
			<p class="py-16 text-center text-sm text-mist">Chargement…</p>
		{:else if detail}
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h3 class="font-display text-lg font-semibold text-ink">{detail.name}</h3>
					{#if detail.sourceName && detail.sourceName !== detail.name}
						<p class="text-xs text-mist">Nom source : {detail.sourceName}</p>
					{/if}
				</div>
				<button type="button" onclick={() => (detail = null)} class="rounded-lg px-2 py-1 text-lg text-mist hover:text-ink" aria-label="Fermer">✕</button>
			</div>

			<div class="mt-3 flex flex-wrap gap-1.5">
				{#if detail.muscleGroup}<span class="rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold text-brand">{detail.muscleGroup}</span>{/if}
				{#if detail.equipment}<span class="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink">{detail.equipment}</span>{/if}
				{#if detail.bodyPart}<span class="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink">{detail.bodyPart}</span>{/if}
				{#if detail.category}<span class="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink">{detail.category}</span>{/if}
			</div>

			<ExerciseMedia
				src={detail.mediaUrl ?? detail.thumbnailUrl}
				fallbackUrl={detail.sourceMediaUrl}
				alt={`Illustration ${detail.name}`}
				loading="eager"
				class="mt-3 max-h-64 w-full rounded-xl border border-line object-contain"
			/>

			{#if detail.secondaryMuscles && detail.secondaryMuscles.length > 0}
				<p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-mist">Muscles secondaires</p>
				<p class="text-sm text-ink">{detail.secondaryMuscles.join(', ')}</p>
			{/if}

			{#if detail.instructions && detail.instructions.length > 0}
				<p class="mt-3 text-[11px] font-bold uppercase tracking-widest text-mist">Instructions</p>
				<ol class="mt-1 list-decimal space-y-1.5 pl-4 text-sm text-ink">
					{#each detail.instructions as step, i (i)}
						<li>{step}</li>
					{/each}
				</ol>
			{/if}

			<p class="mt-4 text-[11px] leading-relaxed text-mist">
				<Icon name="info" size={11} class="mr-1 inline" />
				Source : <strong>{detail.sourceLabel}</strong>{#if detail.sourceExerciseId} · id source <code class="rounded bg-line/60 px-1">{detail.sourceExerciseId}</code>{/if}
				{#if detail.licenseNote} · {detail.licenseNote}{/if}<br />
				G-FLUX : <code class="rounded bg-line/60 px-1">{detail.gfluxExerciseId}</code> · MAJ {fmtDate(detail.updatedAt)}
			</p>

			<button
				type="button"
				onclick={() => detail && toggleHidden(detail)}
				class="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full border-2 border-line px-3 py-2.5 text-sm font-bold text-ink transition hover:border-brand"
			>
				<Icon name={detail.hidden ? 'eye' : 'eyeOff'} size={15} />
				{detail.hidden ? 'Afficher dans la bibliothèque' : 'Masquer de la bibliothèque'}
			</button>
		{/if}
	</div>
{/if}
