<script lang="ts">
	import './guide.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { recipes, newRecipes } from '$lib/data/recettes';
	import { MEMO_HTML, PROTEINES_HTML } from '$lib/data/guides-html';
	import Icon from '$lib/components/Icon.svelte';
	import { kcalMismatchWarning } from '$lib/referenceFoods';

	let { data } = $props();
	/** Client connecté (les recettes sont aussi visibles par la coach, sans « Mes repas »). */
	const isClient = $derived(data.user.role === 'client');
	const isCoach = $derived(data.user.role === 'coach');

	/* ————— ALIMENTS DE RÉFÉRENCE G-FLUX (Mission R3, coach uniquement) —————
	 * Le coach crée ses propres aliments de référence (valeurs /100 g). Ils
	 * apparaissent dans la section « Aliments de référence » des recherches
	 * (journal cliente, fiche cliente, plans de repas) avec le badge
	 * « Référence G-Flux ». Écriture réservée au coach propriétaire (Convex).
	 */
	type ReferenceFood = {
		_id: string;
		name: string;
		kcal: number;
		proteinG: number;
		carbsG: number;
		fatG: number;
	};
	let refFoods = $state<ReferenceFood[]>([]);
	let refLoading = $state(false);
	let refSaving = $state(false);
	let refMsg = $state('');
	let refMsgOk = $state(false);
	let refConfirmId = $state<string | null>(null);
	let refForm = $state({ id: '', name: '', kcal: '', proteinG: '', carbsG: '', fatG: '' });
	/** Avertissement NON bloquant : kcal ≠ 4P + 4G + 9L à plus de 15 %. */
	const refKcalWarning = $derived(
		kcalMismatchWarning({
			name: refForm.name,
			kcal: Number(refForm.kcal) || 0,
			proteinG: Number(refForm.proteinG) || 0,
			carbsG: Number(refForm.carbsG) || 0,
			fatG: Number(refForm.fatG) || 0,
		})
	);

	async function loadReferenceFoods() {
		if (!isCoach) return;
		refLoading = true;
		try {
			const r = await fetch('/api/coach/reference-foods');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			refFoods = Array.isArray(j.rows) ? j.rows : [];
		} catch (e) {
			refMsgOk = false;
			refMsg = e instanceof Error ? e.message : String(e);
		} finally {
			refLoading = false;
		}
	}

	function editReferenceFood(food: ReferenceFood) {
		refConfirmId = null;
		refForm = {
			id: food._id,
			name: food.name,
			kcal: String(food.kcal),
			proteinG: String(food.proteinG),
			carbsG: String(food.carbsG),
			fatG: String(food.fatG),
		};
	}

	function resetReferenceForm() {
		refForm = { id: '', name: '', kcal: '', proteinG: '', carbsG: '', fatG: '' };
	}

	async function saveReferenceFood() {
		if (refSaving) return;
		refSaving = true;
		refMsg = '';
		try {
			const payload = {
				...(refForm.id ? { referenceFoodId: refForm.id } : {}),
				name: refForm.name,
				kcal: Number(refForm.kcal) || 0,
				proteinG: Number(refForm.proteinG) || 0,
				carbsG: Number(refForm.carbsG) || 0,
				fatG: Number(refForm.fatG) || 0,
			};
			const r = await fetch('/api/coach/reference-foods', {
				method: refForm.id ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			refMsgOk = true;
			refMsg = refForm.id ? '✓ Aliment modifié.' : '✓ Aliment de référence créé.';
			resetReferenceForm();
			await loadReferenceFoods();
		} catch (e) {
			refMsgOk = false;
			refMsg = e instanceof Error ? e.message : String(e);
		} finally {
			refSaving = false;
		}
	}

	async function removeReferenceFood(id: string) {
		if (refSaving) return;
		refSaving = true;
		try {
			const r = await fetch(`/api/coach/reference-foods?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			refConfirmId = null;
			if (refForm.id === id) resetReferenceForm();
			refMsgOk = true;
			refMsg = '✓ Aliment supprimé — les entrées passées du journal gardent leurs valeurs.';
			await loadReferenceFoods();
		} catch (e) {
			refMsgOk = false;
			refMsg = e instanceof Error ? e.message : String(e);
		} finally {
			refSaving = false;
		}
	}

	/* ————— Ajouter une recette à « Mes repas » (journal) ————— */
	let savedRecipes = $state<Set<string>>(new Set());
	let savingRecipe = $state<string | null>(null);
	let recipeMsg = $state('');
	let recipeMsgOk = $state(false);

	onMount(async () => {
		if (!browser) return;
		if (isCoach) await loadReferenceFoods();
		if (!isClient) return;
		try {
			const r = await fetch('/api/meals');
			const j = await r.json();
			if (!j.error) {
				const ids = (j as { sourceRecipeId?: string }[])
					.filter((m) => m.sourceRecipeId)
					.map((m) => m.sourceRecipeId as string);
				if (ids.length) savedRecipes = new Set(ids);
			}
		} catch {
			// silencieux : le bouton reste disponible, l'erreur s'affichera à l'ajout
		}
	});

	async function addRecipeToMeals(index: string) {
		if (savingRecipe) return;
		savingRecipe = index;
		recipeMsg = '';
		try {
			const r = await fetch('/api/meals/recipe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ recipeIndex: index }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			const next = new Set(savedRecipes);
			next.add(index);
			savedRecipes = next;
			recipeMsgOk = true;
			recipeMsg = j.alreadyExists
				? 'Cette recette est déjà dans « Mes repas ».'
				: '✓ Recette ajoutée à « Mes repas » — retrouve-la dans ton journal.';
		} catch (e) {
			recipeMsgOk = false;
			recipeMsg = e instanceof Error ? e.message : String(e);
		} finally {
			savingRecipe = null;
		}
	}

	$effect(() => {
		if (recipeMsg) {
			const t = setTimeout(() => (recipeMsg = ''), 4000);
			return () => clearTimeout(t);
		}
	});

	type Ingredient = { name: string; qty: string };
	type Recipe = {
		index: string;
		name: string;
		kcal: number;
		prot: number;
		glucides: number;
		lipides: number;
		temps: string;
		ingredients: Ingredient[];
		steps: string[];
	};

	/** Toutes les recettes par catégorie (5 catégories "recettes" + 5 "guides spéciaux"). */
	const ALL: Record<string, Recipe[]> = { ...recipes, ...newRecipes };

	const HOME_GROUPS = [
		{
			label: 'Recettes',
			items: [
				{ id: 'petitdej', icon: 'sunrise', label: 'Petit-déjeuner', count: '20' },
				{ id: 'dejeuner', icon: 'salad', label: 'Déjeuner', count: '30' },
				{ id: 'diner', icon: 'moon', label: 'Dîner', count: '30' },
				{ id: 'snacks', icon: 'cookie', label: 'Snacks', count: '20' },
				{ id: 'desserts', icon: 'cakeSlice', label: 'Desserts allégés', count: '5' },
			],
		},
		{
			label: 'Accompagnements',
			items: [
				{ id: 'feculents', icon: 'wheat', label: 'Féculents', count: '15' },
				{ id: 'legumes', icon: 'leafyGreen', label: 'Légumes & épices', count: '15' },
			],
		},
		{
			label: 'Guides spéciaux',
			items: [
				{ id: 'volume', icon: 'soup', label: 'Repas volume', count: '10' },
				{ id: 'keto', icon: 'nut', label: 'Kéto', count: '15' },
				{ id: 'sansgl', icon: 'leaf', label: 'Sans lactose & gluten', count: '25' },
			],
		},
		{
			label: 'Références',
			items: [
				{ id: 'proteines', icon: 'drumstick', label: 'Aliments protéines dominantes', count: 'Guide' },
				{ id: 'memo', icon: 'target', label: 'Repères mémo tracking', count: 'Guide' },
			],
		},
	];

	type Tab = {
		id: string;
		label: string;
		count: string;
		chipStyle?: string;
		title?: string;
		gridClass?: 'recipe-grid' | 'dessert-grid';
	};

	const TABS: Tab[] = [
		{ id: 'petitdej', label: 'Petit-déjeuner', count: '20', title: 'Petit-déjeuner · 20 recettes · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'dejeuner', label: 'Déjeuner', count: '30', title: 'Déjeuner · 30 recettes · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'diner', label: 'Dîner', count: '30', title: 'Dîner · 30 recettes · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'snacks', label: 'Snacks', count: '20', title: 'Snacks · 20 recettes · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'desserts', label: 'Desserts allégés', count: '5', title: 'Desserts allégés · 5 recettes · Version sans sucre · 1 portion', gridClass: 'dessert-grid' },
		{ id: 'feculents', label: 'Accompagnements féculents', count: '15', title: 'Accompagnements féculents · 15 recettes · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'legumes', label: 'Accompagnements légumes', count: '15', title: 'Accompagnements légumes · 15 recettes · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'volume', label: 'Repas volume', count: '10', title: 'Repas volume · 10 recettes · Satiété maximale · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'keto', label: 'Kéto', count: '15', title: 'Kéto · 15 recettes · Bas en glucides · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'sansgl', label: 'Sans lactose & gluten', count: '25', title: 'Sans lactose & gluten · 25 recettes · Protéinées · 1 portion', gridClass: 'recipe-grid' },
		{ id: 'memo', label: 'Repères Mémo', count: 'Guide' },
		{ id: 'proteines', label: 'Protéines dominantes', count: 'Guide' },
	];

	const RECIPE_TABS = $derived(TABS.filter((t) => t.gridClass));

	let view = $state<string>('home');
	let open = $state<Set<string>>(new Set());

	function goTo(id: string) {
		view = id;
		window.scrollTo(0, 0);
	}

	function goHome() {
		view = 'home';
		window.scrollTo(0, 0);
	}

	function toggle(index: string) {
		const next = new Set(open);
		if (next.has(index)) next.delete(index);
		else next.add(index);
		open = next;
	}
</script>

<svelte:head>
	<title>Guide nutrition & recettes — G-Flux</title>
</svelte:head>

<div class="guide-root theme-light">
	{#if view === 'home'}
		<!-- ACCUEIL : choix d'une section (Nutrition.svelte) -->
		<div class="home-screen">
			<div class="w-full max-w-[560px]">
				<h1 class="home-title">Nutrition &amp; recettes</h1>
				<p class="home-sub">Choisis une catégorie</p>

				<div class="home-nav">
					{#each HOME_GROUPS as group (group.label)}
						<div class="home-group">
							<h2 class="home-group-label">{group.label}</h2>
							<div class="home-items">
								{#each group.items as item (item.id)}
									<button type="button" class="home-btn tap" onclick={() => goTo(item.id)}>
										<span class="home-btn-icon"><Icon name={item.icon} size={24} /></span>
										<span class="home-btn-text">{item.label}</span>
										<span class="home-btn-count">{item.count}</span>
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				{#if isCoach}
					<!-- ═══ ALIMENTS DE RÉFÉRENCE G-FLUX (coach) — Mission R3 ═══
					     Ces aliments apparaissent dans la section « Aliments de référence »
					     des recherches avec le badge « Référence G-Flux ». -->
					<section class="mt-8 rounded-2xl border border-line bg-white p-4" aria-labelledby="gflux-ref-title">
						<h2 id="gflux-ref-title" class="text-sm font-black text-ink">Aliments de référence G-Flux</h2>
						<p class="mt-1 text-xs text-mist">
							Tes aliments de référence (valeurs pour 100 g). Ils apparaissent en tête des
							« Aliments de référence » dans la recherche, avec le badge « Référence G-Flux ».
						</p>

						{#if refMsg}
							<p class="mt-3 rounded-xl px-3 py-2 text-xs font-semibold {refMsgOk ? 'bg-brand-light text-brand' : 'bg-red-50 text-red-600'}" role="status">{refMsg}</p>
						{/if}

						<!-- Liste -->
						{#if refLoading}
							<p class="mt-3 text-xs text-mist">Chargement…</p>
						{:else if refFoods.length === 0}
							<p class="mt-3 text-xs text-mist">Aucun aliment de référence pour le moment.</p>
						{:else}
							<ul class="mt-3 flex flex-col divide-y divide-line/60">
								{#each refFoods as food (food._id)}
									<li class="flex flex-wrap items-center gap-2 py-2">
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm font-semibold text-ink">{food.name}</p>
											<p class="text-[11px] text-mist tabular-nums">{food.kcal} kcal · P {food.proteinG} g · G {food.carbsG} g · L {food.fatG} g / 100 g</p>
										</div>
										<span class="rounded-full bg-[#FFF3D6] px-2 py-0.5 text-[9px] font-bold text-[#8A5A00]">Référence G-Flux</span>
										<button type="button" class="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink" onclick={() => editReferenceFood(food)}>Modifier</button>
										{#if refConfirmId === food._id}
											<button type="button" class="rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white" onclick={() => removeReferenceFood(food._id)}>Confirmer la suppression</button>
											<button type="button" class="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-mist" onclick={() => (refConfirmId = null)}>Annuler</button>
										{:else}
											<button type="button" class="rounded-full border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600" onclick={() => (refConfirmId = food._id)}>Supprimer</button>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						<!-- Formulaire (création / modification) -->
						<form
							class="mt-4 grid grid-cols-2 gap-2"
							onsubmit={(e) => {
								e.preventDefault();
								saveReferenceFood();
							}}
						>
							<label class="col-span-2 text-[11px] font-semibold text-mist">
								Nom de l'aliment
								<input class="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink" bind:value={refForm.name} maxlength="120" required />
							</label>
							<label class="text-[11px] font-semibold text-mist">
								kcal / 100 g
								<input class="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink tabular-nums" type="number" min="0" max="900" step="0.1" bind:value={refForm.kcal} required />
							</label>
							<label class="text-[11px] font-semibold text-mist">
								Protéines (g)
								<input class="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink tabular-nums" type="number" min="0" max="100" step="0.1" bind:value={refForm.proteinG} required />
							</label>
							<label class="text-[11px] font-semibold text-mist">
								Glucides (g)
								<input class="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink tabular-nums" type="number" min="0" max="100" step="0.1" bind:value={refForm.carbsG} required />
							</label>
							<label class="text-[11px] font-semibold text-mist">
								Lipides (g)
								<input class="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink tabular-nums" type="number" min="0" max="100" step="0.1" bind:value={refForm.fatG} required />
							</label>
							{#if refKcalWarning}
								<p class="col-span-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700" role="status">
									⚠️ Les kcal saisies s'écartent de plus de 15 % de 4P + 4G + 9L. Tu peux quand même enregistrer.
								</p>
							{/if}
							<div class="col-span-2 mt-1 flex gap-2">
								<button type="submit" class="rounded-full bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-50" disabled={refSaving}>
									{refForm.id ? 'Enregistrer la modification' : 'Créer l’aliment'}
								</button>
								{#if refForm.id}
									<button type="button" class="rounded-full border border-line px-4 py-2 text-xs font-semibold text-mist" onclick={resetReferenceForm}>Annuler</button>
								{/if}
							</div>
						</form>
					</section>
				{/if}

				<div class="home-footer">105 recettes · 5 guides · G-Flux™ Coaching</div>
			</div>
		</div>
	{:else}
		<!-- BARRE DU GUIDE (Recipes.svelte) -->
		<div class="topbar">
			<button type="button" class="home-back-btn" onclick={goHome} aria-label="Retour à toutes les sections">
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
				Toutes les sections
			</button>
			<div class="topbar-right">Guide Nutrition</div>
		</div>

		<!-- HERO (Recipes.svelte) -->
		<div class="hero-strip">
			<div class="hero-left">
				<span class="badge-count">105 recettes · 5 guides</span>
				<h1>Recettes</h1>
				<p>
					Chaque recette est calibrée pour 1 personne · 1 portion.
					Protéines ciblées, déficit intelligent, préparation rapide.
				</p>
			</div>
			<div class="hero-stats">
				<div class="hstat"><div class="hstat-num">100</div><div class="hstat-label">Recettes</div></div>
				<div class="hstat"><div class="hstat-num">5</div><div class="hstat-label">Desserts</div></div>
				<div class="hstat"><div class="hstat-num">30g+</div><div class="hstat-label">Prot. moy.</div></div>
				<div class="hstat"><div class="hstat-num">&lt;20'</div><div class="hstat-label">Prépa max</div></div>
			</div>
		</div>

		<!-- ONGLETS (pilules Recipes.svelte) -->
		<div class="nav-tabs">
			{#each TABS as tab (tab.id)}
				<button
					type="button"
					class="tab tap"
					class:active={view === tab.id}
					onclick={() => goTo(tab.id)}
				>
					{tab.label} <span class="tab-count">{tab.count}</span>
				</button>
			{/each}
		</div>

		<!-- CONTENU -->
		<div class="main">
			{#each RECIPE_TABS as cat (cat.id)}
				<div id={cat.id} class="section" class:active={view === cat.id}>
					<div class="section-title">{cat.title}</div>
					<div class={cat.gridClass}>
						{#each ALL[cat.id] as r (r.index)}
							<article class="recipe-card" class:open={open.has(r.index)}>
								<div
									class="card-header"
									role="button"
									tabindex="0"
									onclick={() => toggle(r.index)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											toggle(r.index);
										}
									}}
								>
									<div class="card-header-left">
										<div class="card-top-row">
											<div class="card-index">{r.index}</div>
											<div class="chevron" aria-hidden="true">
												<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
											</div>
										</div>
										<div class="card-name">{r.name}</div>
										<div class="card-macros">
											<div class="macro-pill kcal"><span class="val">{r.kcal}</span><span class="lbl">kcal</span></div>
											<div class="macro-pill prot"><span class="val">{r.prot}g</span><span class="lbl">prot.</span></div>
											<div class="macro-pill"><span class="val">{r.glucides}g</span><span class="lbl">glucides</span></div>
											<div class="macro-pill"><span class="val">{r.lipides}g</span><span class="lbl">lipides</span></div>
										</div>
									</div>
								</div>
								<div class="card-detail">
									<div class="time-badge"><Icon name="clock" size={16} /> {r.temps}</div>
									{#if isClient}
										<button
											type="button"
											class="gflux-add-btn tap"
											class:added={savedRecipes.has(r.index)}
											disabled={savingRecipe === r.index || savedRecipes.has(r.index)}
											onclick={() => addRecipeToMeals(r.index)}
										>
											{savedRecipes.has(r.index)
												? '✓ Dans Mes repas'
												: savingRecipe === r.index
													? 'Ajout…'
													: '＋ Ajouter à mes repas'}
										</button>
									{/if}
									<div class="detail-section">
										<div class="detail-label">Ingrédients · 1 portion</div>
										<div class="ingredients-list">
											{#each r.ingredients as ing (ing.name)}
												<div class="ingredient-row">
													<div class="ingredient-dot"></div>
													<span class="ingredient-name">{ing.name}</span>
													<span class="ingredient-qty">{ing.qty}</span>
												</div>
											{/each}
										</div>
									</div>
									<div class="detail-section">
										<div class="detail-label">Préparation</div>
										<div class="steps-list">
											{#each r.steps as s, idx (idx)}
												<div class="step-row">
													<div class="step-num">{idx + 1}</div>
													<div class="step-text">{s}</div>
												</div>
											{/each}
										</div>
									</div>
								</div>
							</article>
						{/each}
					</div>
				</div>
			{/each}

			{#if view === 'memo'}
				<div id="memo" class="section active">{@html MEMO_HTML}</div>
			{/if}
			{#if view === 'proteines'}
				<div id="proteines" class="section active">{@html PROTEINES_HTML}</div>
			{/if}
		</div>

		<!-- PIED DE PAGE -->
	{/if}

	{#if recipeMsg}
		<div class="gflux-recipe-toast {recipeMsgOk ? 'ok' : 'err'}" role="status">
			{recipeMsg}
			<button type="button" class="gflux-recipe-toast-close" aria-label="Fermer" onclick={() => (recipeMsg = '')}>✕</button>
		</div>
	{/if}

</div>
