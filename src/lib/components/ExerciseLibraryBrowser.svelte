<script lang="ts">
	/**
	 * Navigateur de la bibliothèque d'exercices G-FLUX — réutilisé par :
	 *  - l'onglet « Bibliothèque » du module Entraînement (variant="page") ;
	 *  - le picker « + Ajouter un exercice » de l'éditeur (variant="picker").
	 *
	 * Même backend que la page de validation (/api/coach/exercises) : recherche
	 * texte, filtres groupe musculaire / équipement / bodyPart / source,
	 * pagination « Charger plus ». Le frontend ne dépend d'AUCUNE URL source
	 * codée en dur : uniquement les champs du modèle G-FLUX.
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
		cues?: string[];
		mistakes?: string[];
		levels?: string[];
		breathing?: { eccentric?: string; concentric?: string };
		posterUrl?: string;
		animationUrl?: string;
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
		byBodyPart: [string, number][];
	};

	let {
		variant = 'page',
		onAdd,
		addedIds,
	}: {
		/** "page" = grille + fiche détaillée ; "picker" = lignes compactes + bouton ajouter. */
		variant?: 'page' | 'picker';
		/** Picker uniquement : appelé quand le coach ajoute un exercice. */
		onAdd?: (ex: ExerciseView) => void;
		/** Picker uniquement : ids venant d'être ajoutés (feedback « ajouté ✓ »). */
		addedIds?: Set<string>;
	} = $props();

	const PAGE_SIZE = 24;

	let stats = $state<Stats | null>(null);
	let items = $state<ExerciseView[]>([]);
	let total = $state(0);
	let hasMore = $state(false);
	let offset = $state(0);
	let loading = $state(true);
	let pageErr = $state('');

	let q = $state('');
	let muscleGroup = $state('');
	let equipment = $state('');
	let bodyPart = $state('');
	let source = $state('');
	let applied = $state({ q: '', muscleGroup: '', equipment: '', bodyPart: '', source: '' });

	let detail = $state<ExerciseView | null>(null);

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => search(true), 300);
	}

	function toggleFilter(kind: 'muscle' | 'equipment' | 'bodyPart' | 'source', value: string) {
		if (kind === 'muscle') muscleGroup = muscleGroup === value ? '' : value;
		else if (kind === 'equipment') equipment = equipment === value ? '' : value;
		else if (kind === 'bodyPart') bodyPart = bodyPart === value ? '' : value;
		else source = source === value ? '' : value;
		search(true);
	}

	async function loadStats() {
		const r = await fetch('/api/coach/exercises/stats');
		const j = await r.json();
		if (!j.error) stats = j as Stats;
	}

	async function search(reset: boolean) {
		loading = true;
		pageErr = '';
		try {
			if (reset) {
				applied = { q: q.trim(), muscleGroup, equipment, bodyPart, source };
				offset = 0;
			}
			const params = new URLSearchParams();
			if (applied.q) params.set('q', applied.q);
			if (applied.muscleGroup) params.set('muscleGroup', applied.muscleGroup);
			if (applied.equipment) params.set('equipment', applied.equipment);
			if (applied.bodyPart) params.set('bodyPart', applied.bodyPart);
			if (applied.source) params.set('source', applied.source);
			params.set('offset', String(offset));
			params.set('limit', String(PAGE_SIZE));
			const r = await fetch(`/api/coach/exercises?${params.toString()}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			const page = j as { items: ExerciseView[]; total: number; hasMore: boolean };
			items = reset ? page.items : [...items, ...page.items];
			total = page.total;
			hasMore = page.hasMore;
		} catch (e) {
			pageErr = e instanceof Error ? e.message : 'Erreur de chargement.';
		} finally {
			loading = false;
		}
	}

	async function openDetail(ex: ExerciseView) {
		detail = ex;
		try {
			const r = await fetch(`/api/coach/exercises/${ex._id}`);
			const j = await r.json();
			if (!j.error) detail = j as ExerciseView;
		} catch {
			/* la fiche de la liste reste affichée */
		}
	}

	onMount(() => {
		loadStats();
		search(true);
	});

	const activeFilters = $derived(
		[applied.muscleGroup, applied.equipment, applied.bodyPart, applied.source].filter(Boolean).length
	);
</script>

<div class="flex flex-col gap-3">
	<!-- Recherche -->
	<div class="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 focus-within:border-brand">
		<Icon name="search" size={17} class="shrink-0 text-mist" />
		<input
			type="search"
			bind:value={q}
			oninput={onSearchInput}
			placeholder="Rechercher un exercice (ex. squat, curl)…"
			class="w-full bg-transparent text-sm outline-none placeholder:text-mist"
		/>
		{#if q || activeFilters > 0}
			<button
				type="button"
				onclick={() => {
					q = '';
					muscleGroup = '';
					equipment = '';
					bodyPart = '';
					source = '';
					search(true);
				}}
				class="shrink-0 text-mist transition hover:text-ink"
				title="Réinitialiser les filtres"
			>
				<Icon name="x" size={16} />
			</button>
		{/if}
	</div>

	<!-- Filtres (chips avec compteurs, issus des facettes) -->
	{#if stats}
		<div class="flex flex-col gap-2">
			<div class="flex flex-wrap gap-1.5">
				{#each stats.byMuscleGroup.slice(0, 12) as [name, count] (name)}
					<button
						type="button"
						onclick={() => toggleFilter('muscle', name)}
						class="rounded-full border px-2.5 py-1 text-xs font-semibold transition {muscleGroup === name
							? 'border-brand bg-brand text-white'
							: 'border-line bg-white text-ink hover:border-brand'}"
					>
						{name} <span class="tabular-nums opacity-70">{count}</span>
					</button>
				{/each}
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each stats.byEquipment.slice(0, 10) as [name, count] (name)}
					<button
						type="button"
						onclick={() => toggleFilter('equipment', name)}
						class="rounded-full border px-2.5 py-1 text-xs font-semibold transition {equipment === name
							? 'border-brand bg-brand text-white'
							: 'border-line bg-white text-ink hover:border-brand'}"
					>
						{name} <span class="tabular-nums opacity-70">{count}</span>
					</button>
				{/each}
			</div>
			{#if variant === 'page' && stats.byBodyPart.length > 0}
				<div class="flex flex-wrap gap-1.5">
					{#each stats.byBodyPart as [name, count] (name)}
						<button
							type="button"
							onclick={() => toggleFilter('bodyPart', name)}
							class="rounded-full border px-2.5 py-1 text-xs font-semibold transition {bodyPart === name
								? 'border-brand bg-brand text-white'
								: 'border-line bg-white text-ink hover:border-brand'}"
						>
							{name} <span class="tabular-nums opacity-70">{count}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<p class="text-xs text-mist tabular-nums">
		{total} exercice{total > 1 ? 's' : ''}{#if applied.q} pour « {applied.q} »{/if}{#if loading} · chargement…{/if}
	</p>

	{#if pageErr}
		<p class="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{pageErr}</p>
	{:else if items.length === 0 && !loading}
		<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-12 text-center">
			<div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-light">
				<Icon name="dumbbell" size={22} class="text-brand" />
			</div>
			<p class="font-semibold text-ink">Aucun exercice trouvé</p>
			<p class="mt-1 text-sm text-mist">Ajuste la recherche ou les filtres.</p>
		</div>
	{:else if variant === 'picker'}
		<!-- ── Mode picker : lignes compactes à ajouter à la séance ── -->
		<ul class="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
			{#each items as ex (ex._id)}
				<li class="flex items-center gap-3 px-3 py-2 transition hover:bg-brand-light/40">
					<button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" onclick={() => openDetail(ex)}>							<span class="relative block h-11 w-14 shrink-0 overflow-hidden rounded-lg bg-line/40">
								<ExerciseMedia media={ex} class="h-full w-full object-cover" />
							</span>
						<span class="min-w-0">
							<span class="block truncate text-[13px] font-semibold text-ink">{ex.name}</span>
							<span class="block truncate text-[11px] text-mist">{ex.muscleGroup ?? '—'}{ex.equipment ? ` · ${ex.equipment}` : ''}</span>
						</span>
					</button>
					<button
						type="button"
						onclick={() => onAdd?.(ex)}
						class="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-bold transition {(addedIds?.has(ex._id) ?? false)
							? 'bg-green-100 text-green-700'
							: 'bg-brand text-white hover:brightness-110'}"
					>
						{#if addedIds?.has(ex._id)}
							<Icon name="check" size={13} /> ajouté
						{:else}
							<Icon name="plus" size={13} /> ajouter
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<!-- ── Mode page : grille de cartes ── -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{#each items as ex (ex._id)}
				<button
					type="button"
					onclick={() => openDetail(ex)}
					class="flex flex-col overflow-hidden rounded-2xl border border-line bg-card text-left shadow-sm transition hover:border-brand"
				>
					<div class="relative aspect-[4/3] w-full bg-line/40">
						<ExerciseMedia media={ex} class="h-full w-full object-cover" />
					</div>
					<div class="flex min-w-0 flex-1 flex-col gap-0.5 p-2.5">
						<span class="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">{ex.name}</span>
						<span class="text-[11px] text-mist">{ex.muscleGroup ?? '—'}{ex.equipment ? ` · ${ex.equipment}` : ''}</span>
					</div>
				</button>
			{/each}
		</div>
	{/if}

	{#if hasMore && !loading}
		<button
			type="button"
			onclick={() => {
				offset += PAGE_SIZE;
				search(false);
			}}
			class="mx-auto rounded-full border border-line bg-card px-5 py-2 text-sm font-semibold text-ink shadow-sm transition hover:border-brand"
		>
			Charger plus
		</button>
	{/if}
</div>

<!-- ── Fiche détaillée (modale) ── -->
{#if detail}
	<div
		class="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) detail = null;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') detail = null;
		}}
	>
		<div class="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-card p-5 shadow-xl">
			<div class="mb-3 flex items-start justify-between gap-3">
				<h3 class="font-display text-lg font-bold text-ink">{detail.name}</h3>
				<button type="button" onclick={() => (detail = null)} class="shrink-0 rounded-full p-1 text-mist transition hover:bg-line/50 hover:text-ink">
					<Icon name="x" size={18} />
				</button>
			</div>
			<!-- Média principal UNIQUE en haut de fiche : animation.mp4 G-FLUX
			     (ou GIF ExerciseDB) — même média que la recherche, aucun doublon. -->
			<ExerciseMedia
				media={detail}
				alt={`Animation ${detail.name}`}
				loading="eager"
				class="mb-3 max-h-72 w-full rounded-2xl bg-line/30 object-cover"
			/>
			<div class="mb-3 flex flex-wrap gap-1.5">
				{#if detail.muscleGroup}<span class="rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-semibold text-brand">{detail.muscleGroup}</span>{/if}
				{#if detail.equipment}<span class="rounded-full bg-line/50 px-2.5 py-1 text-[11px] font-semibold text-ink">{detail.equipment}</span>{/if}
				{#if detail.bodyPart}<span class="rounded-full bg-line/50 px-2.5 py-1 text-[11px] font-semibold text-ink">{detail.bodyPart}</span>{/if}
				{#if detail.category}<span class="rounded-full bg-line/50 px-2.5 py-1 text-[11px] font-semibold text-ink">{detail.category}</span>{/if}
			</div>
			{#if detail.secondaryMuscles?.length}
				<p class="mb-2 text-xs text-mist"><span class="font-semibold text-ink">Muscles secondaires :</span> {detail.secondaryMuscles.join(', ')}</p>
			{/if}
			{#if detail.levels?.length}
				<p class="mb-2 text-xs text-mist"><span class="font-semibold text-ink">Niveaux :</span> {detail.levels.join(' · ')}</p>
			{/if}
			{#if detail.cues?.length}
				<p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-mist">Repères</p>
				<ul class="mb-3 list-disc space-y-1 pl-5 text-sm text-ink">
					{#each detail.cues as cue}
						<li>{cue}</li>
					{/each}
				</ul>
			{/if}
			{#if detail.mistakes?.length}
				<p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-mist">Erreurs à éviter</p>
				<ul class="mb-3 list-disc space-y-1 pl-5 text-sm text-ink">
					{#each detail.mistakes as mistake}
						<li>{mistake}</li>
					{/each}
				</ul>
			{/if}
			{#if detail.breathing?.eccentric || detail.breathing?.concentric}
				<p class="mb-3 rounded-xl bg-line/30 px-3 py-2 text-xs text-ink">
					<span class="font-semibold">Respiration :</span>
					{#if detail.breathing.eccentric} inspiration — {detail.breathing.eccentric}{/if}
					{#if detail.breathing.eccentric && detail.breathing.concentric} · {/if}
					{#if detail.breathing.concentric} expiration — {detail.breathing.concentric}{/if}
				</p>
			{/if}
			{#if detail.instructions?.length}
				<p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-mist">Exécution</p>
				<ol class="mb-3 list-decimal space-y-1 pl-5 text-sm text-ink">
					{#each detail.instructions as step}
						<li>{step}</li>
					{/each}
				</ol>
			{/if}
			<p class="border-t border-line pt-2 text-[10px] leading-relaxed text-mist">
				{detail.sourceLabel}{#if detail.licenseNote} · {detail.licenseNote}{/if} · id {detail.gfluxExerciseId}
			</p>
		</div>
	</div>
{/if}
