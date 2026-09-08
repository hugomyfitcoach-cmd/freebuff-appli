<script lang="ts">
	import './guide.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { recipes, newRecipes } from '$lib/data/recettes';
	import { MEMO_HTML, PROTEINES_HTML } from '$lib/data/guides-html';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
	/** Client connecté (les recettes sont aussi visibles par la coach, sans « Mes repas »). */
	const isClient = $derived(data.user.role === 'client');

	/* ————— Ajouter une recette à « Mes repas » (journal) ————— */
	let savedRecipes = $state<Set<string>>(new Set());
	let savingRecipe = $state<string | null>(null);
	let recipeMsg = $state('');
	let recipeMsgOk = $state(false);

	onMount(async () => {
		if (!browser || !isClient) return;
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
				{ id: 'petitdej', icon: '☀️', label: 'Petit-déjeuner', count: '20' },
				{ id: 'dejeuner', icon: '🥗', label: 'Déjeuner', count: '30' },
				{ id: 'diner', icon: '🌙', label: 'Dîner', count: '30' },
				{ id: 'snacks', icon: '🫐', label: 'Snacks', count: '20' },
				{ id: 'desserts', icon: '🍮', label: 'Desserts allégés', count: '5' },
			],
		},
		{
			label: 'Accompagnements',
			items: [
				{ id: 'feculents', icon: '🍚', label: 'Féculents', count: '15' },
				{ id: 'legumes', icon: '🫑', label: 'Légumes & épices', count: '15' },
			],
		},
		{
			label: 'Guides spéciaux',
			items: [
				{ id: 'volume', icon: '🥣', label: 'Repas volume', count: '10' },
				{ id: 'keto', icon: '🥑', label: 'Kéto', count: '15' },
				{ id: 'sansgl', icon: '🌿', label: 'Sans lactose & gluten', count: '25' },
			],
		},
		{
			label: 'Références',
			items: [
				{ id: 'proteines', icon: '💪', label: 'Aliments protéines dominantes', count: 'Guide' },
				{ id: 'memo', icon: '🎯', label: 'Repères mémo tracking', count: 'Guide' },
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
		{ id: 'memo', label: 'Repères Mémo', count: 'Guide', chipStyle: 'background:rgba(251,191,36,0.15);color:#fbbf24;border-color:rgba(251,191,36,0.3)' },
		{ id: 'proteines', label: 'Protéines dominantes', count: 'Guide', chipStyle: 'background:rgba(248,113,113,0.12);color:#f87171;border-color:rgba(248,113,113,0.3)' },
	];

	const RECIPE_TABS = $derived(TABS.filter((t) => t.gridClass));

	let view = $state<string>('home');
	let open = $state<Set<string>>(new Set());

	/** Thème du guide : 'dark' (fichier d'origine) ou 'light' (palette cream G-Flux). */
	let theme = $state<'dark' | 'light'>('dark');

	const logo = $derived(theme === 'light' ? '/logo-header.jpg' : '/logo-guide.png');

	$effect(() => {
		if (browser) window.localStorage.setItem('gflux_guide_theme', theme);
	});

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
	}

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
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="guide-root" class:theme-light={theme === 'light'}>
	{#if view === 'home'}
		<!-- ACCUEIL : choix d'une section -->
		<div class="home-screen">
			<div class="home-logo">
				<img src={logo} alt="G-Flux" style="height:56px;width:auto;display:block;" />
			</div>
			<div class="home-title">Guide Complet<br />Nutrition & Recettes</div>
			<div class="home-sub">Sélectionne une section pour commencer</div>

			<div class="home-nav">
				{#each HOME_GROUPS as group (group.label)}
					<div class="home-group">
						<div class="home-group-label">{group.label}</div>
						<div class="home-items">
							{#each group.items as item (item.id)}
								<button type="button" class="home-btn" onclick={() => goTo(item.id)}>
									<span class="home-btn-icon">{item.icon}</span>
									<span class="home-btn-text">{item.label}</span>
									<span class="home-btn-count">{item.count}</span>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<div class="home-footer">105 recettes · 5 guides · G-Flux™ Coaching</div>
		</div>
	{:else}
		<!-- BARRE DU GUIDE -->
		<div class="topbar">
			<div class="logo">
				<img src={logo} alt="G-Flux" style="height:32px;width:auto;display:block;" />
			</div>
			<button type="button" class="home-back-btn" onclick={goHome}>← Accueil</button>
			<div class="topbar-right">
				<span class="badge-count">105 recettes · 5 guides</span>
				<span>Guide Nutrition</span>
			</div>
		</div>

		<!-- HERO -->
		<div class="hero-strip">
			<div class="hero-left">
				<h1>Recettes G-Flux™</h1>
				<p>
					Chaque recette est calibrée pour 1 personne · 1 portion.<br />
					Protéines ciblées, déficit intelligent, préparation rapide.
				</p>
			</div>
			<div class="hero-stats">
				<div class="hstat"><div class="hstat-num">100</div><div class="hstat-label">Recettes</div></div>
				<div class="hstat"><div class="hstat-num">5</div><div class="hstat-label">Desserts</div></div>
				<div class="hstat"><div class="hstat-num">30g+</div><div class="hstat-label">Protéines moy.</div></div>
				<div class="hstat"><div class="hstat-num">&lt;20'</div><div class="hstat-label">Prépa max</div></div>
			</div>
		</div>

		<!-- ONGLETS -->
		<div class="nav-tabs">
			{#each TABS as tab (tab.id)}
				<button
					type="button"
					class="tab"
					class:active={view === tab.id}
					onclick={() => goTo(tab.id)}
				>
					{tab.label} <span class="tab-count" style={tab.chipStyle}>{tab.count}</span>
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
										<div class="card-index">{r.index}</div>
										<div class="card-name">{r.name}</div>
										<div class="card-macros">
											<div class="macro-pill kcal"><span class="val">{r.kcal}</span><span class="lbl">kcal</span></div>
											<div class="macro-pill prot"><span class="val">{r.prot}g</span><span class="lbl">prot.</span></div>
											<div class="macro-pill"><span class="val">{r.glucides}g</span><span class="lbl">glucides</span></div>
											<div class="macro-pill"><span class="val">{r.lipides}g</span><span class="lbl">lipides</span></div>
										</div>
									</div>
									<div class="chevron">▾</div>
								</div>									<div class="card-detail">
										<div class="time-badge"><Icon name="clock" size={13} /> {r.temps}</div>
										{#if isClient}
											<button
												type="button"
												class="gflux-add-btn"
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
		<div class="footer">
			<div class="footer-brand">
				<img src={logo} alt="G-Flux" style="height:24px;width:auto;vertical-align:middle;margin-right:8px;" />
				Coaching
			</div>
			<div class="footer-copy">GH Online Fit Trainer Ltd · myfit-coach.fr</div>
		</div>
	{/if}

	{#if recipeMsg}
		<div class="gflux-recipe-toast {recipeMsgOk ? 'ok' : 'err'}" role="status">
			{recipeMsg}
			<button type="button" class="gflux-recipe-toast-close" aria-label="Fermer" onclick={() => (recipeMsg = '')}>✕</button>
		</div>
	{/if}

	<!-- Bascule de thème (clair / sombre) -->
	<button
		type="button"
		class="theme-toggle"
		aria-pressed={theme === 'light'}
		onclick={toggleTheme}
		title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
	>
		{#if theme === 'dark'}
			<Icon name="sun" size={16} /> Mode clair
		{:else}
			<Icon name="moon" size={16} /> Mode sombre
		{/if}
	</button>
</div>
