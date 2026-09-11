<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { startBarcodeScanner, type BarcodeScannerHandle } from '$lib/barcodeScanner';
	import { currentLocalDay } from '$lib/currentDay.svelte';
	import { appWarm, firstVisit, isFresh, noteSync, restoreScroll, saveScroll } from '$lib/navMemory';
	import JournalDay from '$lib/components/JournalDay.svelte';
	import QuantitySheet from '$lib/components/QuantitySheet.svelte';
	import FoodImg from '$lib/components/FoodImg.svelte';
	import Icon from '$lib/components/Icon.svelte';

	type Goals = { kcal: number; carbs: number; protein: number; fat: number; maintenanceKcal?: number };
	type Entry = {
		_id: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		qtyGrams: number;
		kcal: number;
		carbs: number;
		protein: number;
		fat: number;
		meal: string;
		/** Nombre de portions consommées (recette G-FLUX) — optionnel. */
		portions?: number;
		/** Portion OFF (g) de l'aliment associé — mode « portion » en édition. */
		servingQty?: number;
		servingUnit?: string;
		/** « planned_eaten » : validé depuis un item planifié (cercle ✓ dans le Journal). */
		source?: string;
	};
	/** Item PLANIFIÉ — plan coach ou préparation cliente : grisé, 0 impact header. */
	type PlannedItem = {
		_id: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		qtyGrams: number;
		kcal: number;
		carbs: number;
		protein: number;
		fat: number;
		meal: string;
		/** « coach_plan » | « client_planned ». */
		source: string;
		servingQty?: number;
		servingUnit?: string;
	};
	type DayData = {
		date: string;
		goals: Goals;
		goalsSet: boolean;
		entries: Entry[];
		totals: { kcal: number; carbs: number; protein: number; fat: number };
		/** Items planifiés (non consommés) — gris, information secondaire uniquement. */
		planned?: PlannedItem[];
		plannedTotals?: { kcal: number; carbs: number; protein: number; fat: number };
	};
	type Food = {
		_id: string;
		offId?: string;
		name: string;
		brand?: string;
		kcal100: number;
		carbs100: number;
		protein100: number;
		fat100: number;
		imageUrl?: string;
		servingQty?: number;
		/** Aliment personnel créé par le client (base « Créés par moi »). */
		custom?: boolean;
	};
	type Meal = {
		_id: string;
		name: string;
		description?: string;
		totalWeight: number;
		kcal: number;
		carbs: number;
		protein: number;
		fat: number;	ingredients: {
						foodId?: string;
						customFoodId?: string;
						name: string;
			brand?: string;
			imageUrl?: string;
			qtyGrams: number;
			kcal: number;
			carbs: number;
			protein: number;
			fat: number;
		}[];
		/** Recette interne G-FLUX transformée en repas réutilisable. */
		sourceType?: string;
		sourceRecipeId?: string;
	};
	type MealDraftItem = { food: Food; qty: number; custom?: boolean; customFoodId?: string };

	let { data } = $props();

	const MEAL_DEFS = [
		{ id: 'petit-dej', label: 'Petit-déjeuner', icon: 'sunrise' },
		{ id: 'dejeuner', label: 'Déjeuner', icon: 'utensils' },
		{ id: 'diner', label: 'Dîner', icon: 'moon' },
		{ id: 'collation', label: 'Collations', icon: 'cookie' },
	] as const;

	/* ————— État ————— */
	/* Jour local de la cliente (jamais minuit UTC) : le Journal démarre sur la
	   VRAIE date locale. Si la journée servie par le serveur ne correspond pas
	   (minuit passé, reprise de l'app, fuseau), on ne rend jamais les entrées
	   de la veille comme celles d'aujourd'hui : journée vide + re-fetch. */
	let date = $state(untrack(() => (typeof window !== 'undefined' ? currentLocalDay() : data.today)));
	let day = $state<DayData>(untrack(() => {
		if (typeof window !== 'undefined' && data.today !== currentLocalDay()) {
			return { ...data.day, date: currentLocalDay(), entries: [], totals: { kcal: 0, carbs: 0, protein: 0, fat: 0 } };
		}
		return data.day;
	}));
	let loadingDay = $state(false);
	let error = $state('');
	let tipDismissed = $state(false);
	const TIPS = [
		'Les protéines sont les briques de ton corps : elles participent à la construction et à la réparation des muscles, mais aussi des cheveux et de la peau. Chaque régime devrait en contenir en quantité suffisante.',
		'Pèse tes aliments crus : c’est la valeur de référence des bases de données (Ciqual, Open Food Facts…).',
		'Un filet d’huile, une poignée de fromage râpé ou une « petite bouchée » comptent : tracke aussi ce qui ne « compte pas ».',
		'Ton déficit se calcule sur la semaine, pas sur la journée. Une journée haute n’annule rien.',
		'Les légumes volume (courgettes, champignons, salade…) remplissent l’assiette pour très peu de calories.',
	];
	const tip = $derived(TIPS[new Date(date + 'T12:00:00').getDay() % TIPS.length]);

	/* ————— Jour : navigation & chargement —————
	   Date locale courante (source centrale, réactive) : au passage de minuit
	   ou à la reprise de l'app, « Aujourd'hui » suit automatiquement. */
	const todayISO = $derived(currentLocalDay());
	/** Libellé ultra-compact type FOOD : « Aujourd'hui · 9 » ou « Mardi · 8 sept. » (mois abrégé, une ligne). */
	const MOIS_ABBR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const dateLabel = $derived.by(() => {
		const d = new Date(date + 'T12:00:00');
		if (date === todayISO) return `Aujourd'hui · ${d.getDate()} ${MOIS_ABBR[d.getMonth()]}`;
		return `${d.toLocaleDateString('fr-FR', { weekday: 'long' })} · ${d.getDate()} ${MOIS_ABBR[d.getMonth()]}`;
	});
	const isToday = $derived(date === todayISO);
	/** Jour FUTUR : préparation possible (ajouter/modifier/remplacer/supprimer),
	 *  mais JAMAIS de validation « Mangé » — on ne mange pas demain. */
	const isFuture = $derived(date > todayISO);
	const canEat = $derived(!isFuture);

	/* ————— Sélecteur de date — NATIF (input type=date), robuste sur tous
	   les navigateurs, aucune logique custom. max = date LOCALE du jour →
	   impossible de choisir un jour futur. ————— */
	let calOpen = $state(false);
	let calDraft = $state('');
	function openCalendar() {
		calDraft = date; // la journée déjà consultée est pré-sélectionnée
		calOpen = true;
	}
	function pickDay(d: string) {
		calOpen = false;
		if (!d) return;
		void setDate(d); // futur AUTORISÉ : planifier ses journées à l'avance
	}

	/* Changement de journée (minuit / reprise) : si on affichait « aujourd'hui »,
	   on bascule sur la nouvelle journée. Une date historique consultée n'est
	   pas arrachée pendant que la cliente travaille dessus. */
	let lastKnownToday = $state(currentLocalDay());
	$effect(() => {
		const d = currentLocalDay();
		const prev = lastKnownToday;
		lastKnownToday = d;
		if (d !== prev && date === prev) void setDate(d);
	});

	function shiftDay(n: number) {
		const d = new Date(date + 'T12:00:00');
		d.setDate(d.getDate() + n);
		setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
	}
	async function setDate(d: string) {
		date = d;
		loadingDay = true;
		error = '';
		try {
			const r = await fetch(`/api/journal?date=${d}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			day = j;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loadingDay = false;
		}
	}

	/* ————— Totaux & calculs ————— */
	const totals = $derived.by(() => {
		const t = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
		for (const e of day.entries) {
			t.kcal += e.kcal;
			t.carbs += e.carbs;
			t.protein += e.protein;
			t.fat += e.fat;
		}
		return t;
	});
	/** Filet de sécurité : maintenance > objectif — sinon le comportement actuel est conservé. */
	const maintenanceKcal = $derived(
		day.goals.maintenanceKcal && day.goals.maintenanceKcal > day.goals.kcal ? day.goals.maintenanceKcal : null
	);
	/** Échelle de la barre : la maintenance quand elle existe (zone filet comprise), sinon l'objectif. */
	const barScale = $derived(maintenanceKcal ?? day.goals.kcal);
	const kcalPct = $derived(barScale > 0 ? Math.min(100, (totals.kcal / barScale) * 100) : 0);
	const overGoal = $derived(totals.kcal > day.goals.kcal);
	const overMaintenance = $derived(!!maintenanceKcal && totals.kcal > maintenanceKcal);
	/** Teinte contextuelle des calories (filet de sécurité compris). */
	const kcalTone = $derived(overMaintenance ? '#ef4444' : overGoal ? '#f59e0b' : '#1db954');

	/* ————— Items PLANIFIÉS (plan coach + préparation cliente) —————
	   PLANIFIÉ ≠ CONSOMMÉ : ces items sont grisés et n'impactent RIEN dans le
	   header tant qu'ils ne sont pas validés « Mangé ». Les totaux consommés
	   ci-dessus ne lisent QUE day.entries (single source of truth). */
	const plannedItems = $derived(day.planned ?? []);
	const hasPlanned = $derived(plannedItems.length > 0);

	/* ————— Sélection multiple (items planifiés) ————— */
	let selMode = $state(false);
	let selIds = $state<Set<string>>(new Set());
	const allSel = $derived(hasPlanned && plannedItems.every((p) => selIds.has(p._id)));
	function enterSelMode() {
		selMode = true;
		selIds = new Set();
	}
	function exitSelMode() {
		selMode = false;
		selIds = new Set();
	}
	function toggleSel(id: string) {
		const next = new Set(selIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selIds = next;
	}
	function toggleAllSel() {
		selIds = allSel ? new Set() : new Set(plannedItems.map((p) => p._id));
	}

	/* ————— Actions sur les items planifiés ————— */
	let plannedBusy = $state(false);
	let plannedErr = $state('');

	async function refreshAfterPlanned() {
		await setDate(date); // re-fetch : header recalculé côté serveur (instantané)
	}

	/** Mangé : planned → consommé (impact immédiat : kcal + 3 macros + barre + donuts). */
	async function eatPlanned(p: PlannedItem) {
		if (plannedBusy || isFuture) return;
		plannedBusy = true;
		plannedErr = '';
		try {
			const r = await fetch('/api/journal/planned', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plannedId: p._id }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await refreshAfterPlanned();
		} catch (e) {
			plannedErr = e instanceof Error ? e.message : String(e);
		} finally {
			plannedBusy = false;
		}
	}

	/** Tout marquer comme mangé (un repas ou toute la sélection). */
	async function eatMany(ids: string[]) {
		if (plannedBusy || isFuture || ids.length === 0) return;
		plannedBusy = true;
		plannedErr = '';
		try {
			const r = await fetch('/api/journal/planned', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plannedIds: ids }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			exitSelMode();
			await refreshAfterPlanned();
		} catch (e) {
			plannedErr = e instanceof Error ? e.message : String(e);
		} finally {
			plannedBusy = false;
		}
	}

	async function deletePlanned(p: PlannedItem) {
		if (plannedBusy) return;
		plannedBusy = true;
		plannedErr = '';
		try {
			const r = await fetch(`/api/journal/planned?plannedId=${p._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await refreshAfterPlanned();
		} catch (e) {
			plannedErr = e instanceof Error ? e.message : String(e);
		} finally {
			plannedBusy = false;
		}
	}

	async function deleteManyPlanned(ids: string[]) {
		if (plannedBusy || ids.length === 0) return;
		plannedBusy = true;
		plannedErr = '';
		try {
			for (const id of ids) {
				await fetch(`/api/journal/planned?plannedId=${id}`, { method: 'DELETE' });
			}
			exitSelMode();
			await refreshAfterPlanned();
		} catch (e) {
			plannedErr = e instanceof Error ? e.message : String(e);
		} finally {
			plannedBusy = false;
		}
	}

	/* Feuille d'édition d'un item planifié */
	let editPlanned = $state<PlannedItem | null>(null);
	let plannedSheetBusy = $state(false);
	let plannedSheetErr = $state('');
	/** Remplacement en cours : la feuille de quantité rejouera l'ajout. */
	let replacingPlanned = $state<PlannedItem | null>(null);

	const editPlannedFood = $derived(
		editPlanned
			? {
					name: editPlanned.name,
					imageUrl: editPlanned.imageUrl,
					kcal100: editPlanned.qtyGrams > 0 ? (editPlanned.kcal / editPlanned.qtyGrams) * 100 : 0,
					carbs100: editPlanned.qtyGrams > 0 ? (editPlanned.carbs / editPlanned.qtyGrams) * 100 : 0,
					protein100: editPlanned.qtyGrams > 0 ? (editPlanned.protein / editPlanned.qtyGrams) * 100 : 0,
					fat100: editPlanned.qtyGrams > 0 ? (editPlanned.fat / editPlanned.qtyGrams) * 100 : 0,
					servingQty: editPlanned.servingQty,
				}
			: null
	);

	async function savePlannedQty(qtyGrams: number, meal: string) {
		if (!editPlanned) return;
		plannedSheetBusy = true;
		plannedSheetErr = '';
		try {
			// Tant que l'item est planifié : aucune valeur n'impacte le header.
			const r = await fetch('/api/journal/planned', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plannedId: editPlanned._id, qtyGrams, meal }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			editPlanned = null;
			await refreshAfterPlanned();
		} catch (e) {
			plannedSheetErr = e instanceof Error ? e.message : String(e);
		} finally {
			plannedSheetBusy = false;
		}
	}

	async function eatFromSheet() {
		if (!editPlanned) return;
		plannedSheetBusy = true;
		plannedSheetErr = '';
		try {
			const r = await fetch('/api/journal/planned', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plannedId: editPlanned._id }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			editPlanned = null;
			await refreshAfterPlanned();
		} catch (e) {
			plannedSheetErr = e instanceof Error ? e.message : String(e);
		} finally {
			plannedSheetBusy = false;
		}
	}

	async function deleteFromSheet() {
		if (!editPlanned) return;
		plannedSheetBusy = true;
		try {
			const r = await fetch(`/api/journal/planned?plannedId=${editPlanned._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			editPlanned = null;
			await refreshAfterPlanned();
		} finally {
			plannedSheetBusy = false;
		}
	}

	/** Remplacer : la feuille « Remplacer » propose la recherche → nouvel aliment.
	 *  Simplification assumée : remplacer = supprimer puis rouvrir l'ajout sur
	 *  le même repas (le template coach n'est jamais touché). */
	function replaceFromSheet() {
		if (!editPlanned) return;
		const meal = editPlanned.meal as 'petit-dej' | 'dejeuner' | 'diner' | 'collation';
		void deleteFromSheet().then(() => openLog(meal));
	}

	/* ————— Mini-barre sticky (HUD nutritionnel) ————— */
	let stickyBar = $state(false);
	let calCardEl: HTMLElement | undefined;
	let pageWrap: HTMLElement | undefined;
	/** Position/portée de la mini-barre : calée sur le conteneur du Journal. */
	let barStyle = $state({ left: 0, width: 0 });
	/** Position verticale : juste sous le header mobile (mesuré), 16 px sur desktop. */
	let barTop = $state(56);

	function macroPct(eaten: number, goal: number) {
		return goal > 0 ? Math.min(100, (eaten / goal) * 100) : 0;
	}
	function fmt(n: number) {
		return n.toLocaleString('fr-FR');
	}
	const rings = $derived([
		{ label: 'Glucides', icon: 'wheat', color: '#ec4899', eaten: totals.carbs, goal: day.goals.carbs },
		{ label: 'Protéines', icon: 'drumstick', color: '#3b82f6', eaten: totals.protein, goal: day.goals.protein },
		{ label: 'Lipides', icon: 'droplet', color: '#f97316', eaten: totals.fat, goal: day.goals.fat },
	]);
	/** HUD sticky : kcal + 3 macros, libellés abrégés pour tenir sur une ligne. */
	const stickyRings = $derived([
		{ label: 'kcal', icon: 'flame', color: kcalTone, eaten: Math.round(totals.kcal), goal: day.goals.kcal },
		...rings.map((r) => ({
			label: r.label === 'Glucides' ? 'gluc.' : r.label === 'Protéines' ? 'prot.' : 'lip.',
			icon: r.icon,
			color: r.color,
			eaten: Math.round(r.eaten),
			goal: r.goal,
		})),
	]);

	/* ————— Swipe gauche/droite (robuste) —————
	   Seuil horizontal + direction dominante + durée : un scroll vertical, un
	   tap produit ou un petit mouvement involontaire ne change JAMAIS de jour.
	   Interdit au futur : aujourd'hui reste la journée maximale. */
	let swipe = $state<{ x: number; y: number; t: number } | null>(null);
	let slideDir = $state<'left' | 'right' | null>(null); // micro-transition
	function onTouchStart(e: TouchEvent) {
		if (logOpen || qtyFood || editEntry || qtyMealSel) return;
		const t = e.touches[0];
		swipe = { x: t.clientX, y: t.clientY, t: Date.now() };
	}
	function onTouchEnd(e: TouchEvent) {
		if (!swipe) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - swipe.x;
		const dy = t.clientY - swipe.y;
		const dt = Date.now() - swipe.t;
		swipe = null;
		// Direction dominante horizontale + geste volontaire (dist/vélocité).
		if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6 || dt > 900) return;
		// Droite → jour précédent ; gauche → jour suivant (futur autorisé : planification).
		if (dx > 0) {
			void shiftDay(-1);
			slideDir = 'right';
		} else {
			void shiftDay(1);
			slideDir = 'left';
		}
		// Le contenu glisse depuis la direction du swipe puis se replace (150 ms).
		if (slideDir && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			setTimeout(() => (slideDir = null), 60);
		} else {
			slideDir = null;
		}
	}

	/* ————— Modale : recherche, favoris, repas, code-barres ————— */
	let logOpen = $state(false);
	let logMode = $state<'search' | 'barcode'>('search');
	let searchQ = $state('');
	let searchTab = $state<'produits' | 'repas' | 'crees'>('produits');
	let results = $state<Food[]>([]);
	let searching = $state(false);
	let searchError = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	async function runSearch(q: string) {
		if (q.length < 2) {
			results = [];
			return;
		}
		searching = true;
		searchError = '';
		try {
			const r = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			results = j;
		} catch (e) {
			searchError = e instanceof Error ? e.message : String(e);
			results = [];
		} finally {
			searching = false;
		}
	}
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => runSearch(searchQ.trim()), 300);
	}

	/* ————— Aliments fréquents (suggestions avant recherche) ————— */
	let recentFoods = $state<Food[]>([]);
	let recentLoaded = $state(false);

	async function loadRecent() {
		try {
			const r = await fetch('/api/foods/recent');
			const j = await r.json();
			if (!j.error) recentFoods = j;
		} catch {
			// silencieux : suggestions vides si indisponibles
		} finally {
			recentLoaded = true;
		}
	}

	async function openLog(meal?: 'petit-dej' | 'dejeuner' | 'diner' | 'collation') {
		if (meal) qtyMeal = meal;
		searchQ = '';
		results = [];
		searchError = '';
		searchTab = 'produits';
		favOnly = false;
		mealEditor = false;
		customEditor = false;
		barcodeStatus = 'idle';
		barcodeError = '';
		barcodeManual = '';
		logMode = 'search';
		logOpen = true;
		recentLoaded = false;
		loadRecent();
		loadFavorites();
		loadMeals();
		loadCustomFoods();
	}
	async function closeLog() {
		await stopScanner();
		logOpen = false;
	}

	/* ————— Favoris ————— */
	let favorites = $state<Food[]>([]);
	let favSet = $state<Set<string>>(new Set());
	let favOnly = $state(false);

	async function loadFavorites() {
		try {
			const r = await fetch('/api/favorites');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			favorites = j;
			favSet = new Set((j as Food[]).map((f) => f._id));
		} catch {
			// silencieux : les favoris restent vides
		}
	}
	async function toggleFav(food: Food) {
		try {
			const r = await fetch('/api/favorites', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ foodId: food._id }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			const next = new Set(favSet);
			if (j.favorite) next.add(food._id);
			else next.delete(food._id);
			favSet = next;
			// Toujours resynchroniser la liste (ajout depuis la recherche,
			// retrait depuis la vue favoris).
			await loadFavorites();
		} catch (e) {
			searchError = e instanceof Error ? e.message : String(e);
		}
	}

	/* ————— Repas personnalisés ————— */
	let meals = $state<Meal[]>([]);
	let mealsError = $state('');

	async function loadMeals() {
		mealsError = '';
		try {
			const r = await fetch('/api/meals');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			meals = j;
		} catch (e) {
			mealsError = e instanceof Error ? e.message : String(e);
		}
	}
	async function deleteMeal(meal: Meal) {
		if (!confirm(`Supprimer le repas « ${meal.name} » ?`)) return;
		try {
			const r = await fetch(`/api/meals/${meal._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadMeals();
		} catch (e) {
			mealsError = e instanceof Error ? e.message : String(e);
		}
	}

	/* ————— Aliments personnels (« Créés par moi ») ————— */
	let customFoods = $state<Food[]>([]);
	let customFoodsError = $state('');
	let customEditor = $state(false);
	let cfName = $state('');
	let cfBrand = $state('');
	let cfKcal = $state('');
	let cfCarbs = $state('');
	let cfProtein = $state('');
	let cfFat = $state('');
	let cfServing = $state('');
	let cfSaving = $state(false);
	let cfError = $state('');

	async function loadCustomFoods() {
		customFoodsError = '';
		try {
			const r = await fetch('/api/foods/custom');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			customFoods = (j as Food[]).map((f) => ({ ...f, custom: true }));
		} catch (e) {
			customFoodsError = e instanceof Error ? e.message : String(e);
		}
	}
	function openCustomEditor() {
		customEditor = true;
		cfName = '';
		cfBrand = '';
		cfKcal = '';
		cfCarbs = '';
		cfProtein = '';
		cfFat = '';
		cfServing = '';
		cfError = '';
	}
	function closeCustomEditor() {
		customEditor = false;
	}
	async function saveCustomFood() {
		const num = (v: string) => {
			const n = parseFloat(v.replace(',', '.'));
			return v.trim() === '' || !isFinite(n) ? undefined : n;
		};
		if (cfName.trim().length < 2) {
			cfError = 'Donne un nom à ton aliment.';
			return;
		}
		cfSaving = true;
		cfError = '';
		try {
			const r = await fetch('/api/foods/custom', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: cfName,
					brand: cfBrand.trim() || undefined,
					kcal100: num(cfKcal),
					carbs100: num(cfCarbs) ?? 0,
					protein100: num(cfProtein) ?? 0,
					fat100: num(cfFat) ?? 0,
					servingQty: num(cfServing),
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadCustomFoods();
			closeCustomEditor();
		} catch (e) {
			cfError = e instanceof Error ? e.message : String(e);
		} finally {
			cfSaving = false;
		}
	}
	async function deleteCustomFood(food: Food) {
		if (!confirm(`Supprimer l'aliment « ${food.name} » de ta base ?`)) return;
		try {
			const r = await fetch(`/api/foods/custom?id=${food._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadCustomFoods();
		} catch (e) {
			customFoodsError = e instanceof Error ? e.message : String(e);
		}
	}

	/* ————— Éditeur de repas ————— */
	let mealEditor = $state(false);
	/** Repas en cours de modification (null = création). */
	let mealEditingId = $state<string | null>(null);
	let mealName = $state('');
	let mealDesc = $state('');
	let mealItems = $state<MealDraftItem[]>([]);
	let mealSearchQ = $state('');
	let mealResults = $state<Food[]>([]);
	let mealSearching = $state(false);
	let mealSearchTimer: ReturnType<typeof setTimeout> | undefined;
	/** Fenêtre de recherche d'aliments DANS l'éditeur de repas (bouton « Ajouter un produit »). */
	let mealSearchOpen = $state(false);
	/** Mode de la fenêtre produit : recherche par nom ou scan code-barres (capsule flottante). */
	let mealSearchMode = $state<'search' | 'barcode'>('search');
	let mealSaving = $state(false);
	let mealError = $state('');

	function openMealEditor() {
		mealEditor = true;
		mealEditingId = null;
		mealName = '';
		mealDesc = '';
		mealItems = [];
		mealSearchQ = '';
		mealResults = [];
		mealError = '';
	}
	/** Édition : pré-remplit l'éditeur avec le repas existant (ingrédients « reconstruits »
	 *  depuis le snapshot — mêmes valeurs /100 g, le serveur recalcule à l'enregistrement). */
	function openMealEditorFor(meal: Meal) {
		mealEditor = true;
		mealEditingId = meal._id;
		mealName = meal.name;
		mealDesc = meal.description ?? '';
		mealItems = meal.ingredients.map((ing) => ({
			food: {
				_id: ing.foodId ?? ing.customFoodId ?? ing.name,
				name: ing.name,
				brand: ing.brand,
				imageUrl: ing.imageUrl,
				kcal100: ing.qtyGrams > 0 ? (ing.kcal / ing.qtyGrams) * 100 : 0,
				carbs100: ing.qtyGrams > 0 ? (ing.carbs / ing.qtyGrams) * 100 : 0,
				protein100: ing.qtyGrams > 0 ? (ing.protein / ing.qtyGrams) * 100 : 0,
				fat100: ing.qtyGrams > 0 ? (ing.fat / ing.qtyGrams) * 100 : 0,
				custom: !!ing.customFoodId,
			},
			qty: ing.qtyGrams,
			custom: !!ing.customFoodId,
			customFoodId: ing.customFoodId,
		}));
		mealSearchQ = '';
		mealResults = [];
		mealError = '';
	}
	function closeMealEditor() {
		void closeMealSearch(); // fenêtre produit refermée + scanner éventuellement arrêté
		mealEditor = false;
		mealEditingId = null;
	}
	let mealSearchError = $state('');
	async function runMealSearch(q: string) {
		if (q.length < 2) {
			mealResults = [];
			return;
		}
		mealSearching = true;
		mealSearchError = '';
		try {
			const r = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			mealResults = j;
		} catch (e) {
			mealSearchError = e instanceof Error ? e.message : String(e);
			mealResults = [];
		} finally {
			mealSearching = false;
		}
	}
	function onMealSearchInput() {
		clearTimeout(mealSearchTimer);
		mealSearchTimer = setTimeout(() => runMealSearch(mealSearchQ.trim()), 300);
	}
	/** Édition au gramme près : feuille de quantité partagée (identique au journal). */
	let ingEdit = $state<{ idx: number; food: Food; qty: number } | null>(null);
	function openIngredientQty(idx: number) {
		const it = mealItems[idx];
		if (!it) return;
		ingEdit = { idx, food: it.food, qty: it.qty };
	}
	function saveIngredientQty(qtyGrams: number) {
		if (!ingEdit) return;
		setIngQty(ingEdit.idx, qtyGrams);
		ingEdit = null;
	}
	function removeIngredientAt() {
		if (!ingEdit) return;
		const idx = ingEdit.idx;
		mealItems = mealItems.filter((_, i) => i !== idx);
		ingEdit = null;
	}
	/** Produit choisi (résultats de recherche OU scan code-barres) : feuille de
	 *  quantité/portion existante (comme le journal). La validation ajoute
	 *  l'ingrédient à l'éditeur de repas. */
	let mealPickedFood = $state<Food | null>(null);
	function openMealIngredientSheet(food: Food) {
		mealPickedFood = food;
		ingEdit = { idx: -1, food, qty: food.servingQty && food.servingQty > 0 ? Math.round(food.servingQty) : 100 };
	}
	/** Clic produit dans la recherche : l'écran de recherche se referme
	 *  IMMÉDIATEMENT et la feuille de portion existante s'ouvre à sa place. */
	function openIngredientPortion(foodIdx: number) {
		const food = mealResults[foodIdx];
		if (!food) return;
		mealSearchOpen = false;
		mealSearchMode = 'search';
		openMealIngredientSheet(food);
	}
	/** Sauvegarde depuis la feuille : ajout si un produit de la recherche est en attente, édition sinon. */
	function saveIngredientQty2(qtyGrams: number) {
		if (mealPickedFood) {
			mealItems = [
				...mealItems,
				{ food: mealPickedFood, qty: qtyGrams, custom: mealPickedFood.custom, customFoodId: mealPickedFood.custom ? mealPickedFood._id : undefined },
			];
			mealSearchQ = '';
			mealResults = [];
			mealSearchOpen = false; // déjà refermée au clic — filet de sécurité
			mealPickedFood = null;
			ingEdit = null;
			return;
		}
		saveIngredientQty(qtyGrams);
	}
	function setIngQty(idx: number, qty: number) {
		const items = mealItems.slice();
		items[idx] = { ...items[idx], qty: Math.min(5000, Math.max(1, qty)) };
		mealItems = items;
	}
	function removeIngredient(idx: number) {
		mealItems = mealItems.filter((_, i) => i !== idx);
	}
	const mealTotals = $derived.by(() => {
		const t = { kcal: 0, carbs: 0, protein: 0, fat: 0, weight: 0 };
		for (const it of mealItems) {
			const k = it.qty / 100;
			t.kcal += it.food.kcal100 * k;
			t.carbs += it.food.carbs100 * k;
			t.protein += it.food.protein100 * k;
			t.fat += it.food.fat100 * k;
			t.weight += it.qty;
		}
		return {
			kcal: Math.round(t.kcal),
			carbs: Math.round(t.carbs * 10) / 10,
			protein: Math.round(t.protein * 10) / 10,
			fat: Math.round(t.fat * 10) / 10,
			weight: Math.round(t.weight),
		};
	});
	async function saveMeal() {
		mealSaving = true;
		mealError = '';
		try {
			const r = await fetch(mealEditingId ? `/api/meals/${mealEditingId}` : '/api/meals', {
				method: mealEditingId ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: mealName,
					description: mealDesc.trim() || undefined,
					ingredients: mealItems.map((it) => ({
						...(it.custom ? { customFoodId: it.food._id } : { foodId: it.food._id }),
						qtyGrams: it.qty,
					})),
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadMeals();
			closeMealEditor();
			searchTab = 'repas';
		} catch (e) {
			mealError = e instanceof Error ? e.message : String(e);
		} finally {
			mealSaving = false;
		}
	}

	/* ————— Feuille de quantité (aliment) ————— */
	let qtyFood = $state<Food | null>(null);
	let qtyGrams = $state(100);
	let qtyMeal = $state<'petit-dej' | 'dejeuner' | 'diner' | 'collation'>('dejeuner');
	let qtySaving = $state(false);
	let qtyError = $state('');

	function openQty(food: Food) {
		qtyFood = food;
		qtyGrams = food.servingQty && food.servingQty > 0 ? Math.round(food.servingQty) : 100;
		qtyError = '';
	}
	async function confirmAdd(qtyGrams: number, meal: string) {
		if (!qtyFood) return;
		qtySaving = true;
		qtyError = '';
		qtyMeal = meal as 'petit-dej' | 'dejeuner' | 'diner' | 'collation';
		try {
			const r = await fetch('/api/journal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					date,
					meal,
					...(qtyFood.custom ? { customFoodId: qtyFood._id } : { foodId: qtyFood._id }),
					qtyGrams,
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			qtyFood = null;
			logOpen = false;
			searchQ = '';
			results = [];
			await setDate(date);
		} catch (e) {
			qtyError = e instanceof Error ? e.message : String(e);
		} finally {
			qtySaving = false;
		}
	}

	/* ————— Feuille de portion (repas) ————— */
	let qtyMealSel = $state<Meal | null>(null);
	let qtyPortion = $state(100);
	/** Nombre de portions (recette G-FLUX) — 1 = 100 g dans le moteur existant. */
	let qtyPortions = $state(1);
	let portionSaving = $state(false);
	let portionError = $state('');

	function openPortion(meal: Meal) {
		qtyMealSel = meal;
		qtyPortion = 100;
		qtyPortions = 1;
		portionError = '';
	}
	/** Recette G-FLUX : on raisonne en nombre de portions (1 portion = 100). */
	const isRecipeMeal = $derived(qtyMealSel?.sourceType === 'gflux_recipe');
	const portionRatio = $derived(
		qtyMealSel ? (isRecipeMeal ? qtyPortions : qtyPortion / qtyMealSel.totalWeight) : 0
	);
	const portionKcal = $derived(qtyMealSel ? Math.round(qtyMealSel.kcal * portionRatio) : 0);
	const portionMacros = $derived(
		qtyMealSel
			? {
					carbs: Math.round(qtyMealSel.carbs * portionRatio * 10) / 10,
					protein: Math.round(qtyMealSel.protein * portionRatio * 10) / 10,
					fat: Math.round(qtyMealSel.fat * portionRatio * 10) / 10,
				}
			: null
	);
	function setPortion(g: number) {
		qtyPortion = Math.min(5000, Math.max(1, g));
	}
	function setPortions(n: number) {
		qtyPortions = Math.min(10, Math.max(0.5, Math.round(n * 2) / 2));
	}
	const PORTION_CHIPS = [0.5, 1, 1.5, 2, 3];
	async function confirmAddPortion() {
		if (!qtyMealSel) return;
		portionSaving = true;
		portionError = '';
		try {
			const r = await fetch(`/api/meals/${qtyMealSel._id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					date,
					meal: qtyMeal,
					portionGrams: isRecipeMeal ? qtyPortions * 100 : qtyPortion,
					portions: isRecipeMeal ? qtyPortions : undefined,
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			qtyMealSel = null;
			logOpen = false;
			await setDate(date);
		} catch (e) {
			portionError = e instanceof Error ? e.message : String(e);
		} finally {
			portionSaving = false;
		}
	}

	/* ————— Code-barres ————— */
	let barcodeStatus = $state<'idle' | 'scanning' | 'notfound' | 'error'>('idle');
	let barcodeManual = $state('');
	let barcodeBusy = $state(false);
	let barcodeError = $state('');
	let scanner: BarcodeScannerHandle | null = null;
	let scannerBusy = false;

	/** Démarre le scanner sur le lecteur demandé : « bc-reader » (écran « Ajouter
	 *  un aliment ») ou « meal-bc-reader » (fenêtre produit de l'éditeur de
	 *  repas). Le résultat est routé vers la feuille correspondante. */
	async function startScanner(elId: string = 'bc-reader', target: 'journal' | 'meal' = 'journal') {
		if (scanner || scannerBusy || typeof document === 'undefined') return;
		const el = document.getElementById(elId);
		if (!el) return;
		scannerBusy = true;
		barcodeStatus = 'scanning';
		try {
			scanner = await startBarcodeScanner(el, (decoded) => {
				void handleScan(decoded, target);
			});
		} catch {
			barcodeStatus = 'error';
			barcodeError = 'Caméra indisponible — saisis le code-barres à la main ci-dessous.';
			if (scanner) {
				try {
					await scanner.stop();
				} catch {
					// déjà arrêté
				}
				scanner = null;
			}
		} finally {
			scannerBusy = false;
		}
	}
	async function stopScanner() {
		if (scanner) {
			try {
				await scanner.stop();
			} catch {
				// déjà arrêté
			}
			scanner = null;
		}
	}
	async function switchMode(m: 'search' | 'barcode') {
		if (m === logMode) return;
		if (m === 'barcode') {
			logMode = 'barcode';
			barcodeStatus = 'idle';
			barcodeError = '';
			barcodeManual = '';
			await tick();
			void startScanner();
		} else {
			await stopScanner();
			logMode = 'search';
		}
	}
	async function handleScan(decoded: string, target: 'journal' | 'meal' = 'journal') {
		if (scannerBusy || barcodeBusy) return;
		const code = decoded.replace(/\D/g, '');
		if (code.length < 8) return;
		await lookupCode(code, target);
	}
	async function lookupCode(code: string, target: 'journal' | 'meal' = 'journal') {
		barcodeBusy = true;
		barcodeError = '';
		try {
			const r = await fetch(`/api/foods/barcode?code=${encodeURIComponent(code)}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			if (j.length === 1) {
				await stopScanner();
				barcodeStatus = 'idle';
				if (target === 'meal') {
					// Un seul geste : scanner/fenêtre produit refermés → feuille de portion.
					mealSearchOpen = false;
					mealSearchMode = 'search';
					openMealIngredientSheet(j[0]);
				} else {
					openQty(j[0]);
				}
			} else {
				barcodeStatus = 'notfound';
				barcodeError = `Aucun produit trouvé pour le code ${code}. Cherche-le par nom, ou vérifie le code.`;
			}
		} catch (e) {
			barcodeStatus = 'error';
			barcodeError = e instanceof Error ? e.message : String(e);
		} finally {
			barcodeBusy = false;
		}
	}
	function submitManual(target: 'journal' | 'meal' = 'journal') {
		const code = barcodeManual.replace(/\D/g, '');
		if (code.length >= 8) void lookupCode(code, target);
		else barcodeError = 'Saisis un code-barres complet (8 à 14 chiffres).';
	}
	/** Capsule Recherche ⇄ Code-barres de la fenêtre produit (éditeur de repas). */
	async function switchMealSearchMode(m: 'search' | 'barcode') {
		if (m === mealSearchMode) return;
		if (m === 'barcode') {
			mealSearchMode = 'barcode';
			barcodeStatus = 'idle';
			barcodeError = '';
			barcodeManual = '';
			await tick();
			void startScanner('meal-bc-reader', 'meal');
		} else {
			await stopScanner();
			mealSearchMode = 'search';
		}
	}
	/** Fermeture de la fenêtre produit : scanner arrêté, mode réinitialisé. */
	async function closeMealSearch() {
		mealSearchOpen = false;
		mealSearchMode = 'search';
		await stopScanner();
	}

	/* ————— Édition / suppression d'une entrée ————— */
	let editEntry = $state<Entry | null>(null);
	let editSaving = $state(false);
	let editError = $state('');

	function openEdit(e: Entry) {
		editEntry = e;
		editError = '';
	}
	/* Aliment « reconstruit » depuis l'entrée pour alimenter la feuille partagée
	   (mêmes kcal/100 g — le serveur recalcule exactement pareil à l'enregistrement). */
	const editFood = $derived(
		editEntry
			? {
					name: editEntry.name,
					imageUrl: editEntry.imageUrl,
					kcal100: editEntry.qtyGrams > 0 ? (editEntry.kcal / editEntry.qtyGrams) * 100 : 0,
					carbs100: editEntry.qtyGrams > 0 ? (editEntry.carbs / editEntry.qtyGrams) * 100 : 0,
					protein100: editEntry.qtyGrams > 0 ? (editEntry.protein / editEntry.qtyGrams) * 100 : 0,
					fat100: editEntry.qtyGrams > 0 ? (editEntry.fat / editEntry.qtyGrams) * 100 : 0,
					servingQty: editEntry.servingQty,
			}
			: null
	);
	async function saveEdit(qtyGrams: number, meal: string) {
		if (!editEntry) return;
		editSaving = true;
		editError = '';
		try {
			const r = await fetch(`/api/journal/${editEntry._id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ qtyGrams, meal }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			editEntry = null;
			await setDate(date);
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
		} finally {
			editSaving = false;
		}
	}
	/** Décocher un « Mangé » : consommé → planifié (totaux retirés immédiatement). */
	async function unEatEntry() {
		if (!editEntry) return;
		editSaving = true;
		editError = '';
		try {
			const r = await fetch(`/api/journal/${editEntry._id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ unEat: true }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			editEntry = null;
			await setDate(date);
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
		} finally {
			editSaving = false;
		}
	}
	async function deleteEdit() {
		if (!editEntry) return;
		editSaving = true;
		try {
			const r = await fetch(`/api/journal/${editEntry._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			editEntry = null;
			await setDate(date);
		} catch (e) {
			editError = e instanceof Error ? e.message : String(e);
		} finally {
			editSaving = false;
		}
	}

	/* ————— Sélecteur de date natif ————— */
	/** Refresh local (non destructif) : re-fetch du jour affiché — ne change ni la date, ni les saisies. */
	let refreshingDay = $state(false);
	async function refreshDay() {
		if (refreshingDay) return;
		refreshingDay = true;
		try {
			await setDate(date);
		} finally {
			setTimeout(() => (refreshingDay = false), 500);
		}
	}

	/* Hauteur visible (visualViewport) — dimensionne l'écran « Ajouter un aliment »
	   en px réels : fiable iOS avec clavier ouvert (contrairement aux unités dvh). */
	let vvH = $state(typeof window !== 'undefined' ? Math.round(window.visualViewport?.height ?? window.innerHeight) : 700);
	let mobile = $state(typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : true);
	let refreshing = $state(false);

	/* Listes scrollables de l'écran « Ajouter un aliment » (recherche + code-barres)
	   et de la fenêtre produit de l'éditeur de repas (mêmes deux modes).
	   $state : l'$effect de fermeture du clavier doit se rattacher à chaque montage. */
	let logListEl = $state<HTMLElement | undefined>();
	let bcListEl = $state<HTMLElement | undefined>();
	let mealSearchListEl = $state<HTMLElement | undefined>();
	let mealBcListEl = $state<HTMLElement | undefined>();

	/* Clavier iOS : un vrai scroll vertical de la liste ferme le clavier (blur),
	   sans vider la recherche ni perdre les résultats ; le geste continue.
	   Seuil : ignore les micro-mouvements et les taps sur un produit. */
	function attachScrollDismiss(el: HTMLElement) {
		let lastTop = el.scrollTop;
		const onScroll = () => {
			const top = el.scrollTop;
			const dy = Math.abs(top - lastTop);
			lastTop = top;
			if (top < 8) return;
			const active = document.activeElement;
			if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => el.removeEventListener('scroll', onScroll);
	}
	$effect(() => {
		const els = [logListEl, bcListEl, mealSearchListEl, mealBcListEl].filter((e): e is HTMLElement => !!e);
		if (els.length === 0) return;
		const cleanups = els.map(attachScrollDismiss);
		return () => cleanups.forEach((c) => c());
	});

	/* Recherche ingrédient ouverte : pré-remplit le champ et lance la recherche
	   initiale, puis focalise le champ (clavier immédiat, comme « Ajouter un aliment »). */
	$effect(() => {
		if (!mealSearchOpen) return;
		mealSearchMode = 'search';
		mealSearchQ = '';
		mealResults = [];
		mealSearching = false;
		barcodeStatus = 'idle';
		barcodeError = '';
		barcodeManual = '';
		const el = document.getElementById('meal-picker-input');
		el?.focus();
	});

	onMount(() => {
		document.addEventListener('keydown', (e) => {
			if (logOpen || qtyFood || editEntry || qtyMealSel) return;
			if (e.key === 'ArrowLeft') shiftDay(-1);
			if (e.key === 'ArrowRight') shiftDay(1);
		});

		/* Clavier mobile : la hauteur de l'écran Ajouter suit le visualViewport. */
		const vv = window.visualViewport;
		const setVh = () => {
			vvH = Math.round((vv?.height ?? window.innerHeight) ?? 0);
		};
		if (vv) {
			vv.addEventListener('resize', setVh);
			vv.addEventListener('scroll', setVh);
		}
		setVh();
		const mq = window.matchMedia('(max-width: 639px)');
		const onMq = () => (mobile = mq.matches);
		mq.addEventListener('change', onMq);

		/* Rafraîchir (bouton AppShell) → re-fetch du jour, sans perdre la saisie. */
		const onRefresh = () => {
			refreshing = true;
			void setDate(date).finally(() => {
				refreshing = false;
			});
		};
		window.addEventListener('gflux:journal-refresh', onRefresh);

		/* Barre sticky : alignée sur le conteneur du Journal (largeur max centrée),
		   indépendamment de la sidebar desktop ou des marges du viewport. */
		const setBarPos = () => {
			if (!pageWrap) return;
			const r = pageWrap.getBoundingClientRect();
			barStyle.left = r.left;
			barStyle.width = r.width;
			/* Le header mobile AppShell est sticky : on mesure sa hauteur réelle
			   (safe-area / Dynamic Island incluses). Desktop : header masqué → 16 px. */
			const hdr = document.querySelector('header');
			const h = hdr ? hdr.getBoundingClientRect().height : 0;
			barTop = h > 4 ? Math.ceil(h) : 16;
		};
		setBarPos();
		window.addEventListener('resize', setBarPos);
		window.addEventListener('orientationchange', setBarPos);

		/* Jour serveur ≠ jour local (minuit, reprise, fuseau) : on charge la
		   vraie journée locale — la vue démarre déjà vide (pas de veille affichée). */
		if (data.today !== currentLocalDay()) void setDate(date);

		/* Navigation rapide : revalidation silencieuse du jour quand la donnée
		   préchargée a plus de 30 s — le rendu est déjà affiché, aucun spinner.
		   Jamais au premier montage (donnée fraîche de la navigation). */
		if (!firstVisit(ROUTE) && !isFresh(ROUTE) && appWarm()) {
			noteSync(ROUTE);
			void syncDaySilently();
		} else {
			noteSync(ROUTE);
		}
		/* Retour sur l'onglet : position de scroll restaurée (après le reset
		   scroll(0,0) que SvelteKit applique en fin de navigation). */
		const y = restoreScroll(ROUTE);
		if (y > 0) setTimeout(() => window.scrollTo(0, y), 0);

		return () => {
			if (vv) {
				vv.removeEventListener('resize', setVh);
				vv.removeEventListener('scroll', setVh);
			}
			mq.removeEventListener('change', onMq);
			window.removeEventListener('gflux:journal-refresh', onRefresh);
			window.removeEventListener('resize', setBarPos);
			window.removeEventListener('orientationchange', setBarPos);
		};
	});

	/* Sauvegarde de la position de scroll AVANT la navigation : à ce moment le
	   scroll est encore celui de l'utilisateur (le réajustement de transition
	   arrive plus tard et fausserait la valeur au démontage). */
	beforeNavigate(() => saveScroll(ROUTE));

	/* ————— Navigation rapide : identifiant de route + re-fetch silencieux ————— */
	const ROUTE = '/espace/journal';
	async function syncDaySilently() {
		try {
			const r = await fetch(`/api/journal?date=${date}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			day = j;
		} catch {
			// silencieux : on garde la donnée affichée
		}
	}

	/* Mini-barre sticky : dès que la carte nutritionnelle (rendue par JournalDay)
	   sort du viewport, on affiche le HUD compact ; il disparaît au retour en haut. */
	$effect(() => {
		const el = calCardEl;
		if (!el || typeof IntersectionObserver === 'undefined') return;
		const io = new IntersectionObserver((entries) => {
			for (const e of entries) stickyBar = !e.isIntersecting;
		}, { threshold: 0 });
		io.observe(el);
		return () => io.disconnect();
	});

	/* Verrouille le scroll du fond quand un panneau plein écran est ouvert. */
	$effect(() => {
		const locked = logOpen || !!qtyFood || !!editEntry || !!qtyMealSel;
		document.body.style.overflow = locked ? 'hidden' : '';
	});
</script>

<svelte:head><title>Journal — G-Flux</title></svelte:head>

<svelte:window ontouchstart={onTouchStart} ontouchend={onTouchEnd} />
	<!-- VUE PLEIN ÉCRAN : le gradient appartient au VIEWPORT (pas au container).
	     Halo menthe très pâle, diffus, très large — jamais une bande verte. -->
	<div
		aria-hidden="true"
		class="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(120%_55%_at_50%_0%,#ddefe4_0%,#e7f2ea_38%,rgba(244,246,244,0)_78%)]"
	></div>
	<div
		bind:this={pageWrap}
		class="relative z-10 mx-auto w-full px-4 pb-32 pt-[max(env(safe-area-inset-top),14px)] sm:px-8 md:max-w-5xl md:pt-6 lg:max-w-6xl"
	>
	<!-- Ligne de date compacte type FOOD : à gauche, cliquable (▾ = calendrier) ;
	     Refresh discret à droite (icon-only, ~44 px). UNE seule ligne, aucun gros
	     bouton ‹ › — le swipe gère la navigation entre les jours. -->
				<header class="relative z-10 mb-2 flex items-center justify-between gap-2">
				<button
					type="button"
					class="flex min-w-0 items-center gap-1 rounded-xl py-1 pl-0 pr-1.5 text-left transition hover:bg-line/40"
					onclick={openCalendar}
					title="Choisir une date"
				>
					<span class="truncate text-[19px] font-bold tracking-tight text-ink">{dateLabel}</span>
					<Icon name="chevronDown" size={16} class="shrink-0 text-mist" />
				</button>
				<div class="flex shrink-0 items-center gap-1">
					{#if hasPlanned && !selMode}
						<button
							type="button"
							onclick={enterSelMode}
							class="rounded-full border border-line px-3 py-1.5 text-[12px] font-bold text-mist transition hover:border-brand hover:text-brand"
						>Sélectionner</button>
					{:else if selMode}
						<button
							type="button"
							onclick={toggleAllSel}
							class="rounded-full border border-brand/40 bg-brand-light/50 px-3 py-1.5 text-[12px] font-bold text-brand-dark transition hover:bg-brand-light"
						>{allSel ? 'Tout désélec.' : 'Tout sélec.'}</button>
						<button
							type="button"
							onclick={exitSelMode}
							class="rounded-full px-2.5 py-1.5 text-[12px] font-bold text-mist transition hover:text-ink"
						>Annuler</button>
					{/if}
					<button
						type="button"
						onclick={refreshDay}
						class="grid h-11 w-11 place-items-center rounded-full text-mist transition hover:bg-line/40 hover:text-ink active:scale-95"
						title="Recharger la journée"
						aria-label="Recharger la journée"
					>
						<Icon name="refreshCw" size={17} class={loadingDay ? 'animate-spin' : ''} />
					</button>
				</div>
				</header>

	{#if error}
		<div class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">
			{error}
		</div>
	{/if}

	{#if plannedErr}
		<div class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">
			{plannedErr}
		</div>
	{/if}

	{#if isFuture}
		<!-- Journée FUTURE : préparation (gris = prévu, rien n'est consommé). -->
		<div class="mb-3 flex items-start gap-2 rounded-xl border border-brand/30 bg-brand-light/40 px-3 py-2.5 text-[12px] font-semibold text-brand-dark">
			<Icon name="calendarClock" size={15} class="mt-0.5 shrink-0 text-brand" />
			<span>Tu prépares cette journée à l'avance — tout est <strong>planifié</strong> (gris), rien n'est encore compté. Le jour venu, touche le cercle ✓ pour valider ce que tu as réellement mangé.</span>
		</div>
	{/if}

	<!-- Micro-transition de changement de jour (150 ms, direction du swipe) —
	     désactivée si prefers-reduced-motion. -->
	<div
		class="relative z-10 transition-opacity"
		class:opacity-40={loadingDay}
		style:transform={slideDir === 'left' ? 'translateX(-14px)' : slideDir === 'right' ? 'translateX(14px)' : 'none'}
		style:transition={slideDir ? 'transform 150ms ease-out, opacity 200ms' : 'opacity 200ms'}
	>
		<!-- Journée complète : carte calories + macros + astuce + repas.
		     Composant partagé avec la Vision 360 coach (même rendu, une seule
		     logique visuelle). Côté client : ligne cliquable → édition, items
		     planifiés grisés (cercle = Mangé), navigation future autorisée. -->
		<JournalDay
			{day}
			mode="client"
			tip={tipDismissed || isFuture ? null : tip}
			onAdd={(meal) => openLog(meal as 'petit-dej' | 'dejeuner' | 'diner' | 'collation')}
			onEntryClick={openEdit}
			onPlannedClick={(p) => {
				if (selMode) toggleSel(p._id);
				else {
					editPlanned = p;
					plannedSheetErr = '';
				}
			}}
			onToggleEat={eatPlanned}
			onEatAllMeal={(meal) => eatMany(plannedItems.filter((p) => p.meal === meal).map((p) => p._id))}
			{canEat}
			selMode={selMode && hasPlanned}
			selIds={selIds}
			onToggleSel={toggleSel}
			onCalCardMount={(el) => (calCardEl = el)}
			onTipDismiss={() => (tipDismissed = true)}
		/>
	</div>
</div>

<!-- Sélecteur de date natif : sheet compacte, <input type="date">,
     max = aujourd'hui local → aucune date future possible. -->
{#if calOpen}
	<button type="button" class="fixed inset-0 z-40 bg-ink/25" aria-label="Fermer le calendrier" onclick={() => (calOpen = false)}></button>
	<div class="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[360px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
		<p class="mb-3 text-center text-[17px] font-bold text-ink">Choisir une date</p>
		<input
			type="date"
			value={calDraft}
			onchange={(e) => pickDay(e.currentTarget.value)}
			class="w-full rounded-2xl border-2 border-line bg-cream px-3 py-3 text-center text-[17px] font-semibold text-ink outline-none transition focus:border-brand/60"
			aria-label="Choisir une date"
		/>
		<div class="mt-4 flex items-center justify-between">
			<button type="button" class="rounded-full px-3 py-2 text-[14px] font-semibold text-mist transition hover:text-ink" onclick={() => (calOpen = false)}>Annuler</button>
			<button type="button" class="rounded-full bg-brand px-5 py-2 text-[14px] font-bold text-white transition hover:bg-brand-dark" onclick={() => pickDay(todayISO)}>Aujourd'hui</button>
		</div>
	</div>
{/if}

<!-- Mini-barre sticky : HUD nutritionnel SOMBRE type FOOD (apparaît quand la zone
     nutrition sort du viewport, disparaît au retour en haut). Une seule ligne :
     kcal + glucides + protéines + lipides, rings fins, valeurs tabular-nums. -->
{#snippet miniRing(pct: number, color: string, size: number)}
	{@const r = size / 2 - 2}
	{@const c = 2 * Math.PI * r}
	<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} class="-rotate-90 shrink-0">
		<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.14)" stroke-width={Math.max(2, size / 7)} />
		<circle
			cx={size / 2}
			cy={size / 2}
			r={r}
			fill="none"
			stroke={color}
			stroke-width={Math.max(2, size / 7)}
			stroke-linecap="round"
			stroke-dasharray={c}
			stroke-dashoffset={c * (1 - Math.min(100, pct) / 100)}
		/>
	</svg>
{/snippet}

{#if stickyBar && !logOpen}
	<div
		class="pointer-events-none fixed z-30 transition-opacity duration-200"
		style:top="{barTop}px"
		style:left="{barStyle.left}px"
		style:width="{barStyle.width}px"
	>
		<div class="pointer-events-auto flex w-full items-center justify-between rounded-2xl border border-white/10 bg-ink/95 px-2 py-1.5 shadow-lg shadow-ink/25 backdrop-blur">
			{#each stickyRings as r (r.label)}
				{@const pct = macroPct(r.eaten, r.goal)}
				<div class="flex min-w-0 flex-1 items-center justify-center gap-1.5">
					{@render miniRing(pct, r.color, 20)}
					<div class="min-w-0 leading-none">
						<div class="text-[11px] font-bold tabular-nums text-white">{fmt(r.eaten)}<span class="text-[9px] font-semibold text-white/50">/{fmt(r.goal)}</span></div>
						<div class="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-white/55">{r.label}</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<!-- Bouton flottant + (au-dessus de la barre flottante, avec respiration) -->
<button
	type="button"
	class="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition hover:scale-105 hover:bg-brand-dark active:scale-95 md:bottom-6 md:right-6 md:h-16 md:w-16"
	aria-label="Ajouter un aliment"
	onclick={() => openLog()}
><Icon name="plus" size={26} /></button>

<!-- Ligne produit compacte (style FOOD) : image · nom · kcal · cœur -->
{#snippet foodRow(food: Food)}
	{@const fav = favSet.has(food._id)}
	<li class="flex items-center gap-1">
		<button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-1 pr-1 text-left transition hover:bg-line/30" onclick={() => openQty(food)}>
			{#if food.imageUrl}
				<FoodImg src={food.imageUrl} alt="" class="h-10 w-10 rounded-lg" />
			{:else}
				<div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={18} class="text-brand" /></div>
			{/if}
			<span class="min-w-0 flex-1">
				<span class="flex items-center gap-1">
					<span class="truncate text-[14px] font-semibold text-ink">{food.name}</span>
					{#if !food.custom}<span class="shrink-0 text-[9px] font-bold text-brand" title="Vérifié Open Food Facts">✓</span>{/if}
				</span>
				<span class="block text-[12px] text-mist tabular-nums">
					<strong class="font-bold text-brand">{fmt(food.kcal100)} kcal</strong> · 100 g{#if food.brand && food.brand !== 'null'} · {food.brand}{/if}
				</span>
			</span>
		</button>
		{#if !food.custom}
			<button type="button" class="grid h-10 w-10 shrink-0 place-items-center rounded-full transition {fav ? 'text-brand' : 'text-mist hover:text-brand'}" aria-label={fav ? `Retirer ${food.name} des favoris` : `Ajouter ${food.name} aux favoris`} onclick={() => toggleFav(food)}><Icon name="heart" size={18} /></button>
		{/if}
	</li>
{/snippet}

<!-- ═══════════ ÉCRAN COMPLET « Ajouter un aliment » ═══════════
     Mobile : vrai écran plein (hauteur = visualViewport, fiable avec le clavier
     ouvert) ; header + recherche + onglets fixes, seule la liste défile.
     Desktop : même panneau, centré et arrondi. -->
{#if logOpen}
	<div role="presentation" class="fixed inset-0 z-50 bg-soft sm:flex sm:items-center sm:justify-center sm:bg-ink/40 sm:p-6" onclick={(e) => { if (e.target === e.currentTarget) closeLog(); }} onkeydown={(e) => { if (e.key === 'Escape') closeLog(); }}>
		<div class="relative flex w-full flex-col overflow-hidden bg-soft sm:h-[min(92dvh,720px)] sm:max-w-lg sm:rounded-3xl sm:bg-white sm:shadow-2xl" style:height={mobile ? `${vvH}px` : undefined}>
			<!-- En-tête fixe (respire sous l'encoche en PWA installée, cf. convention safe-area de l'app) -->
			<div class="flex shrink-0 items-center justify-between border-b border-line bg-white/95 px-3 pt-[max(env(safe-area-inset-top),10px)] pb-2.5 backdrop-blur">
				<button type="button" class="grid h-9 w-9 place-items-center rounded-full text-mist transition hover:bg-line/50" aria-label="Fermer" onclick={() => closeLog()}><Icon name="x" size={20} /></button>
				<h2 class="font-display text-[15px] font-semibold text-ink">{logMode === 'barcode' ? 'Code-barres' : 'Ajouter un aliment'}</h2>
				<span class="w-9"></span>
			</div>

			{#if logMode === 'search'}
				<!-- Recherche + onglets (fixes) -->
				<div class="shrink-0 border-b border-line bg-white/95 px-2.5 pb-2 pt-2 backdrop-blur">
					<div class="flex items-center gap-2 rounded-xl border-2 border-line bg-cream px-3 py-2 focus-within:border-brand">										<Icon name="search" size={17} class="shrink-0 text-mist" />
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="search"
							class="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-mist"
							placeholder="Rechercher un produit…"
							bind:value={searchQ}
							oninput={onSearchInput}
							autofocus
						/>
						{#if searchQ}
							<button
								type="button"
								class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line/70 text-mist transition hover:bg-line"
								aria-label="Effacer la recherche"
								onclick={() => { searchQ = ''; results = []; }}
							><Icon name="x" size={13} /></button>
						{/if}
					</div>
					<div class="mt-2 flex items-center gap-1.5 overflow-x-auto">
						<button
							type="button"
							class="grid h-8 w-8 shrink-0 place-items-center rounded-full transition {favOnly ? 'bg-brand text-white' : 'bg-line/50 text-mist hover:text-ink'}"
							title={favOnly ? 'Voir tous les produits' : 'Voir mes favoris'}
							aria-label="Voir mes favoris"
							onclick={() => (favOnly = !favOnly)}
						>
							<Icon name="heart" size={16} class={favOnly ? 'text-white' : 'text-mist'} />
						</button>
						<button type="button" class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition {searchTab === 'produits' ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => { searchTab = 'produits'; favOnly = false; }}>Tous les produits</button>
						<button type="button" class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition {searchTab === 'repas' ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => (searchTab = 'repas')}>Repas</button>
						<button type="button" class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition {searchTab === 'crees' ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => (searchTab = 'crees')}>Créés par moi</button>
					</div>
				</div>

				<!-- Résultats : liste seule scrollable (pb généreux : le dernier
				     produit doit passer entièrement au-dessus de la capsule flottante) -->
				<div bind:this={logListEl} class="flex-1 overflow-y-auto overscroll-contain px-2.5 pb-24">
					{#if mealEditor}
						<!-- ═══════ Éditeur de repas ═══════ -->
						<div>
							<button type="button" class="mb-3 flex items-center gap-1 text-sm font-semibold text-mist hover:text-ink" onclick={closeMealEditor}>← Retour aux repas</button>
							<p class="mb-1 text-sm font-semibold text-ink">{mealEditingId ? 'Modifier le repas' : 'Nouveau repas'}</p>

							<input
								type="text"
								class="w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-brand"
								placeholder="Nom du repas (ex. Hachis parmentier)"
								bind:value={mealName}
							/>
							<input
								type="text"
								class="mt-2 w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm text-ink outline-none focus:border-brand"
								placeholder="Description (optionnel)"
								bind:value={mealDesc}
							/>

							<!-- Totaux live -->
							<div class="mt-3 grid grid-cols-4 gap-2">
								<div class="rounded-xl border border-line bg-white p-2 text-center">											<Icon name="flame" size={16} class="mx-auto block text-brand" />
									<span class="block text-xs font-bold text-ink">{fmt(mealTotals.kcal)}</span>
									<span class="block text-[10px] text-mist">kcal</span>
								</div>
								<div class="rounded-xl border border-line bg-white p-2 text-center">											<Icon name="wheat" size={16} class="mx-auto block" style="color:#ec4899" />
									<span class="block text-xs font-bold text-ink">{fmt(mealTotals.carbs)} g</span>
									<span class="block text-[10px] text-mist">glucides</span>
								</div>
								<div class="rounded-xl border border-line bg-white p-2 text-center">											<Icon name="drumstick" size={16} class="mx-auto block" style="color:#3b82f6" />
									<span class="block text-xs font-bold text-ink">{fmt(mealTotals.protein)} g</span>
									<span class="block text-[10px] text-mist">protéines</span>
								</div>
								<div class="rounded-xl border border-line bg-white p-2 text-center">											<Icon name="droplet" size={16} class="mx-auto block" style="color:#f97316" />
									<span class="block text-xs font-bold text-ink">{fmt(mealTotals.fat)} g</span>
									<span class="block text-[10px] text-mist">lipides</span>
								</div>
							</div>
							<p class="mt-2 text-center text-xs text-mist">Plat entier : {fmt(mealTotals.weight)} g</p>

							<!-- Ingrédients -->
							<h3 class="mb-2 mt-4 font-display text-sm font-semibold text-ink">Ingrédients</h3>
							{#if mealItems.length === 0}
								<p class="rounded-xl border-2 border-dashed border-line px-4 py-6 text-center text-sm text-mist">Aucun ingrédient pour l'instant — ajoute des produits ci-dessous.</p>
							{:else}
								<ul class="flex flex-col gap-2">												{#each mealItems as it, i (i)}
										<li class="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white p-2 text-left transition hover:border-brand" role="button" tabindex="0" onclick={() => openIngredientQty(i)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIngredientQty(i); } }}>														{#if it.food.imageUrl}
															<FoodImg src={it.food.imageUrl} alt="" class="h-10 w-10 rounded-lg" />
														{:else}
															<div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={18} class="text-brand" /></div>
														{/if}
											<span class="min-w-0 flex-1">
												<span class="block truncate text-xs font-semibold text-ink">{it.food.name}</span>
												<span class="block text-[11px] text-mist">{fmt(Math.round((it.food.kcal100 * it.qty) / 100))} kcal</span>
											</span>
											<span class="shrink-0 text-sm font-bold text-brand">{fmt(it.qty)} g</span>
											<Icon name="chevronRight" size={16} class="shrink-0 text-mist" />
										</li>
									{/each}
								</ul>
							{/if}

							<!-- Ajout de produit : même fenêtre de recherche que « Ajouter un aliment » -->
							<button type="button" class="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-brand bg-brand-light px-3 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/15" onclick={() => (mealSearchOpen = true)}>
								<Icon name="plus" size={16} strokeWidth={2.5} />
								Ajouter un produit
							</button>

							{#if mealError}
								<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{mealError}</p>
							{/if}

							<button type="button" class="mt-4 w-full rounded-full bg-brand py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={mealSaving || mealItems.length === 0 || mealName.trim().length < 2} onclick={saveMeal}>
								{mealSaving ? 'Enregistrement…' : mealEditingId ? 'Enregistrer les modifications' : 'Enregistrer le repas'}
							</button>
						</div>
					{:else if searchTab === 'repas'}
						<!-- ═══════ Mes repas ═══════ -->
						<button type="button" class="mb-3 flex w-full items-center gap-2 rounded-xl bg-brand-light px-3 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/15" onclick={openMealEditor}>
							<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white">＋</span>
							Ajouter un nouveau repas
						</button>
						{#if mealsError}
							<p class="rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{mealsError}</p>
						{:else if meals.length === 0}
							<div class="py-10 text-center">													<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light"><Icon name="utensils" size={26} class="text-brand" /></div>
								<p class="text-sm font-semibold text-ink">Aucun repas pour l'instant</p>
								<p class="mx-auto mt-1 max-w-xs text-xs text-mist">Crée tes recettes (ingrédients + quantités) : les macros de chaque portion se calculent toutes seules.</p>
							</div>
						{:else}
							<ul class="flex flex-col gap-2">
								{#each meals as meal (meal._id)}
									{@const isRecipe = meal.sourceType === 'gflux_recipe'}
									<li class="flex items-center gap-2 rounded-2xl border border-line bg-white p-2.5 shadow-sm transition hover:border-brand">
										<button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" onclick={() => openPortion(meal)}>
											{#if meal.ingredients[0]?.imageUrl}
												<FoodImg src={meal.ingredients[0].imageUrl} alt="" class="h-11 w-11 rounded-xl" />
											{:else}
												<div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light"><Icon name="soup" size={20} class="text-brand" /></div>
											{/if}
											<span class="min-w-0 flex-1">
												<span class="block truncate text-sm font-semibold text-ink">{meal.name}</span>
												<span class="block text-xs text-mist">
													<strong class="font-bold text-brand">{fmt(meal.kcal)} kcal</strong>
													{#if isRecipe}
														· <span class="rounded bg-brand-light px-1 py-0.5 text-[10px] font-bold text-brand-dark">Recette G-FLUX</span> · 1 portion
													{:else}
														· {fmt(meal.totalWeight)} g · <span class="text-[11px]">{fmt(Math.round((meal.kcal / meal.totalWeight) * 100))} kcal/100 g</span>
													{/if}
												</span>
											</span>
										</button>
										{#if !isRecipe}
											<button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mist transition hover:bg-line/70 hover:text-ink" aria-label={`Modifier ${meal.name}`} onclick={() => openMealEditorFor(meal)}><Icon name="pencil" size={15} /></button>
										{/if}
										<button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mist transition hover:bg-danger-light hover:text-danger" aria-label={`Supprimer ${meal.name}`} onclick={() => deleteMeal(meal)}><Icon name="trash" size={15} /></button>
									</li>
								{/each}
							</ul>
							<p class="mt-3 text-center text-xs text-mist">Touche un repas pour ajouter une portion au journal.</p>
						{/if}
					{:else if searchTab === 'crees'}
						<!-- ═══════ Créés par moi : aliments personnels ═══════ -->
						{#if customEditor}
							<button type="button" class="mb-3 flex items-center gap-1 text-sm font-semibold text-mist hover:text-ink" onclick={closeCustomEditor}>← Retour à mes aliments</button>
							<p class="mb-1 text-sm font-semibold text-ink">Nouvel aliment</p>
							<p class="mb-3 text-xs text-mist">Reçois-tu un plat avec une étiquette nutritionnelle ? Saisis les valeurs pour 100 g : l'aliment sera ajouté à ta base.</p>

							<input type="text" class="w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-brand" placeholder="Nom (ex. Hachis parmentier)" bind:value={cfName} />
							<input type="text" class="mt-2 w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm text-ink outline-none focus:border-brand" placeholder="Marque (optionnel)" bind:value={cfBrand} />

							<div class="mt-3 grid grid-cols-2 gap-2">
								<label class="rounded-xl border-2 border-line bg-cream px-3 py-2">
									<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Calories / 100 g</span>
									<input type="text" inputmode="decimal" class="mt-1 w-full bg-transparent text-sm font-bold text-ink outline-none" placeholder="Ex. 120" bind:value={cfKcal} />
								</label>
								<label class="rounded-xl border-2 border-line bg-cream px-3 py-2">
									<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Glucides / 100 g</span>
									<input type="text" inputmode="decimal" class="mt-1 w-full bg-transparent text-sm font-bold text-ink outline-none" placeholder="Ex. 15" bind:value={cfCarbs} />
								</label>
								<label class="rounded-xl border-2 border-line bg-cream px-3 py-2">
									<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Protéines / 100 g</span>
									<input type="text" inputmode="decimal" class="mt-1 w-full bg-transparent text-sm font-bold text-ink outline-none" placeholder="Ex. 10" bind:value={cfProtein} />
								</label>
								<label class="rounded-xl border-2 border-line bg-cream px-3 py-2">
									<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Lipides / 100 g</span>
									<input type="text" inputmode="decimal" class="mt-1 w-full bg-transparent text-sm font-bold text-ink outline-none" placeholder="Ex. 4" bind:value={cfFat} />
								</label>
							</div>

							<label class="mt-2 block rounded-xl border-2 border-line bg-cream px-3 py-2">
								<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Portion habituelle (g, optionnel)</span>
								<input type="text" inputmode="decimal" class="mt-1 w-full bg-transparent text-sm font-bold text-ink outline-none" placeholder="Ex. 200" bind:value={cfServing} />
							</label>

							{#if cfError}
								<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{cfError}</p>
							{/if}

							<button type="button" class="mt-4 w-full rounded-full bg-brand py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={cfSaving || cfName.trim().length < 2} onclick={saveCustomFood}>
								{cfSaving ? 'Enregistrement…' : 'Créer mon aliment'}
							</button>
						{:else}
							<button type="button" class="mb-3 flex w-full items-center gap-2 rounded-xl bg-brand-light px-3 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/15" onclick={openCustomEditor}>
								<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white">＋</span>
								Créer un aliment (étiquette nutritionnelle)
							</button>
							{#if customFoodsError}
								<p class="rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{customFoodsError}</p>
							{:else if customFoods.length === 0}
								<div class="py-10 text-center">
									<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light"><Icon name="soup" size={26} class="text-brand" /></div>
									<p class="text-sm font-semibold text-ink">Aucun aliment créé</p>
									<p class="mx-auto mt-1 max-w-xs text-xs text-mist">Un produit absent de la base ? Crée-le ici avec son étiquette nutritionnelle (calories, protéines, lipides…).</p>
								</div>
							{:else}
								<ul class="flex flex-col gap-2">
									{#each customFoods as food (food._id)}
										<li class="flex items-center gap-2">
											<button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-white p-2.5 text-left shadow-sm transition hover:border-brand" onclick={() => openQty(food)}>
												<div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light"><Icon name="soup" size={20} class="text-brand" /></div>
												<span class="min-w-0 flex-1">
													<span class="block truncate text-sm font-semibold text-ink">{food.name}</span>
													<span class="block text-xs text-mist"><strong class="font-bold text-brand">{fmt(food.kcal100)} kcal</strong> · 100 g{#if food.brand} · {food.brand}{/if}</span>
												</span>
											</button>
											<button type="button" class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-mist transition hover:bg-danger-light hover:text-danger" aria-label={`Supprimer ${food.name}`} onclick={() => deleteCustomFood(food)}><Icon name="trash" size={16} /></button>
										</li>
									{/each}
								</ul>
								<p class="mt-3 text-center text-xs text-mist">Touche un aliment pour l'ajouter au journal. Il apparaît aussi dans la recherche.</p>
							{/if}
						{/if}
					{:else if favOnly}
						<!-- ═══════ Favoris ═══════ -->
						{#if favorites.length === 0}
							<div class="py-10 text-center">												<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light"><Icon name="heart" size={26} class="text-brand" /></div>
								<p class="text-sm font-semibold text-ink">Aucun favori</p>											<p class="mx-auto mt-1 max-w-xs text-xs text-mist">Touche le cœur <Icon name="heart" size={13} class="inline -mt-0.5 text-brand" /> d'un produit pour le retrouver ici en un geste.</p>
							</div>
						{:else}											<ul class="flex flex-col divide-y divide-line/50">
												{#each favorites as food (food._id)}
													{@render foodRow(food)}
												{/each}
											</ul>
						{/if}
					{:else if searching && results.length === 0}
						<p class="py-10 text-center text-sm text-mist">Recherche…</p>
					{:else if searchError}
						<p class="rounded-xl border-2 border-danger bg-danger-light px-3 py-3 text-sm text-danger">{searchError}</p>
					{:else if searchQ.trim().length < 2}
						<!-- Suggestions avant toute saisie : aliments réellement utilisés (jamais inventés) -->
						{#if recentFoods.length > 0}
							<div class="flex items-baseline justify-between px-1 pb-1 pt-1.5">
								<h3 class="text-[11px] font-bold uppercase tracking-widest text-mist">Tes aliments fréquents</h3>
								<span class="text-[10px] text-mist">récemment utilisés</span>
							</div>
							<ul class="flex flex-col divide-y divide-line/50">
								{#each recentFoods as food (food._id)}
									{@render foodRow(food)}
								{/each}
							</ul>
						{:else if recentLoaded}
							<div class="py-10 text-center">
								<div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-light"><Icon name="search" size={22} class="text-brand" /></div>
								<p class="text-sm font-semibold text-ink">Recherche un produit</p>
								<p class="mx-auto mt-1 max-w-xs text-xs text-mist">Base G-Flux (780 000 aliments), code-barres, ou « Créés par moi » pour un plat avec étiquette.</p>
							</div>
						{/if}
					{:else if results.length === 0}
						<p class="py-10 text-center text-sm text-mist">Aucun résultat pour « {searchQ.trim()} ».</p>
					{:else}
						<!-- Résultats : conservés pendant une nouvelle recherche (pas de flash blanc) -->
						<ul class="flex flex-col divide-y divide-line/50 transition-opacity {searching ? 'opacity-50' : ''}">
							{#each results as food (food._id)}
								{@render foodRow(food)}
							{/each}
						</ul>
					{/if}
				</div>
			{:else}
				<!-- ═══════ Scanner code-barres (cadre portrait stable) ═══════ -->
				<div bind:this={bcListEl} class="flex-1 overflow-y-auto overscroll-contain px-3 pb-24 pt-3">
					<p class="mb-2.5 text-center text-xs text-mist">Scanne le code-barres du produit (ça marche même à distance) ou saisis-le à la main : on le retrouve dans la base G-Flux.</p>
					<div id="bc-reader" class="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border-2 bg-ink transition-colors {barcodeBusy ? 'border-brand ring-4 ring-brand/40' : 'border-line'}"></div>

					<div class="mx-auto mt-3 w-full max-w-sm">
						<div class="flex items-center gap-2 rounded-xl border-2 border-line bg-cream px-3 py-2.5 focus-within:border-brand">														<Icon name="barcode" size={18} class="shrink-0 text-mist" />
							<input
								type="text"
								inputmode="numeric"
								class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-mist"
								placeholder="Ou saisis le code (ex. 3017620422003)"
								bind:value={barcodeManual}
								onkeydown={(e) => { if (e.key === 'Enter') submitManual(); }}
							/>
						</div>
						<button type="button" class="mt-2 w-full rounded-full bg-brand py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={barcodeBusy} onclick={() => submitManual()}>
							{barcodeBusy ? 'Recherche…' : 'Rechercher le code'}
						</button>
					</div>

					{#if barcodeError}
						<p class="mx-auto mt-3 w-full max-w-sm rounded-xl bg-danger-light px-3 py-2.5 text-center text-sm text-danger">{barcodeError}</p>
					{:else if barcodeStatus === 'scanning'}
						<p class="mt-3 text-center text-xs text-mist">Caméra active — présente le code-barres à plat devant l'objectif, même à distance : dès qu'il est lu, l'encadré passe au vert.</p>
					{/if}
				</div>
			{/if}
			<!-- Capsule flottante Recherche ⇄ Code-barres (type FOOD) : positionnée
			     juste au-dessus du clavier (le conteneur suit le visualViewport),
			     ne réserve aucune place dans le flux ; la liste défile dessous. -->
			<div class="pointer-events-none absolute inset-x-0 bottom-[calc(0.625rem+env(safe-area-inset-bottom))] z-10 flex justify-center px-4">
				<div class="pointer-events-auto flex h-14 w-[55%] min-w-[190px] max-w-[260px] items-center gap-1 rounded-full bg-ink/95 p-1 shadow-lg shadow-ink/30 ring-1 ring-white/10">
					<button
						type="button"
						class="flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold transition {logMode === 'search' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'}"
						onclick={() => switchMode('search')}
					>
						<Icon name="search" size={17} />
						<span>Recherche</span>
					</button>
					<button
						type="button"
						class="flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold transition {logMode === 'barcode' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'}"
						onclick={() => switchMode('barcode')}
					>
						<Icon name="barcode" size={17} />
						<span>Code-barres</span>
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}{#if ingEdit}
	<!-- Feuille de quantité d'un INGRÉDIENT de repas : même composant que le
	     journal (grammes au pas de 1 g, portions, raccourcis, macros live). -->
	<QuantitySheet
		food={ingEdit.food}
		mealDefs={[]}
		initialQtyGrams={ingEdit.qty}
		mode={mealPickedFood ? 'add' : 'edit'}
		saving={false}
		saveLabel={mealPickedFood ? 'Ajouter au repas' : undefined}
		onSave={saveIngredientQty2}
		onDelete={mealPickedFood
			? () => { ingEdit = null; mealPickedFood = null; }
			: removeIngredientAt}
		onClose={() => { ingEdit = null; mealPickedFood = null; }}
	/>
{/if}	{#if mealSearchOpen}
	<!-- Fenêtre « Ajouter un produit » DANS l'éditeur de repas : mêmes résultats,
	     même scanner et même feuille de quantité que l'ajout au journal. Le clic
	     produit ou un scan referme CETTE fenêtre et ouvre la feuille existante. -->
	<div role="presentation" class="fixed inset-0 z-[70] bg-soft sm:flex sm:items-center sm:justify-center sm:bg-ink/40 sm:p-6" onclick={(e) => { if (e.target === e.currentTarget) void closeMealSearch(); }} onkeydown={(e) => { if (e.key === 'Escape') void closeMealSearch(); }}>
		<div class="relative flex w-full flex-col overflow-hidden bg-soft sm:h-[min(92dvh,720px)] sm:max-w-lg sm:rounded-3xl sm:bg-white sm:shadow-2xl" style:height={mobile ? `${vvH}px` : undefined}>
			<!-- En-tête fixe (safe-area top, cf. « Ajouter un aliment ») -->
			<div class="flex shrink-0 items-center justify-between border-b border-line bg-white/95 px-3 pt-[max(env(safe-area-inset-top),10px)] pb-2.5 backdrop-blur">
				<button type="button" class="grid h-9 w-9 place-items-center rounded-full text-mist transition hover:bg-line/50" aria-label="Fermer" onclick={() => void closeMealSearch()}><Icon name="x" size={20} /></button>
				<h2 class="font-display text-[15px] font-semibold text-ink">{mealSearchMode === 'barcode' ? 'Code-barres' : 'Ajouter un produit'}</h2>
				<span class="w-9"></span>
			</div>

			{#if mealSearchMode === 'search'}
				<div class="shrink-0 border-b border-line bg-white/95 px-2.5 pb-2 pt-2 backdrop-blur">
					<div class="flex items-center gap-2 rounded-xl border-2 border-line bg-cream px-3 py-2 focus-within:border-brand">
						<Icon name="search" size={17} class="shrink-0 text-mist" />
						<input
							id="meal-picker-input"
							type="search"
							class="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-mist"
							placeholder="Rechercher un produit…"
							bind:value={mealSearchQ}
							oninput={onMealSearchInput}
						/>
						{#if mealSearchQ}
							<button type="button" class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line/70 text-mist transition hover:bg-line" aria-label="Effacer la recherche" onclick={() => { mealSearchQ = ''; mealResults = []; }}><Icon name="x" size={13} /></button>
						{/if}
					</div>
				</div>
				<div bind:this={mealSearchListEl} class="flex-1 overflow-y-auto overscroll-contain px-2.5 pb-24">
					{#if mealSearching && mealResults.length === 0}
						<p class="py-10 text-center text-sm text-mist">Recherche…</p>
					{:else if mealSearchError}
						<p class="rounded-xl border-2 border-danger bg-danger-light px-3 py-3 text-sm text-danger">{mealSearchError}</p>
					{:else if mealSearchQ.trim().length < 2}
						<p class="py-10 text-center text-sm text-mist">Recherche un produit — base G-Flux (780 000 aliments) et tes aliments « Créés par moi ».</p>
					{:else if mealResults.length === 0}
						<p class="py-10 text-center text-sm text-mist">Aucun résultat pour « {mealSearchQ.trim()} ».</p>
					{:else}
						<ul class="flex flex-col divide-y divide-line/50 transition-opacity {mealSearching ? 'opacity-50' : ''}">
							{#each mealResults as food, i (food._id)}
								<li>
									<button type="button" class="flex w-full items-center gap-2 px-1 py-2 text-left transition hover:opacity-70" onclick={() => openIngredientPortion(i)}>
										{#if food.imageUrl}
											<FoodImg src={food.imageUrl} alt="" class="h-10 w-10 rounded-lg" />
										{:else}
											<div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={18} class="text-brand" /></div>
										{/if}
										<span class="min-w-0 flex-1">
											<span class="block truncate text-sm font-semibold text-ink">{food.name}</span>
											<span class="block text-xs text-mist"><strong class="font-bold text-brand">{fmt(food.kcal100)} kcal</strong> / 100 g{#if food.brand} · {food.brand}{/if}</span>
										</span>
										<span class="text-brand">＋</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{:else}
				<!-- ═══════ Scanner code-barres de la fenêtre produit (même rendu que « Ajouter un aliment ») ═══════ -->
				<div bind:this={mealBcListEl} class="flex-1 overflow-y-auto overscroll-contain px-3 pb-24 pt-3">
					<p class="mb-2.5 text-center text-xs text-mist">Scanne le code-barres du produit : dès qu'il est lu, la feuille de portion s'ouvre directement.</p>
					<div id="meal-bc-reader" class="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border-2 bg-ink transition-colors {barcodeBusy ? 'border-brand ring-4 ring-brand/40' : 'border-line'}"></div>

					<div class="mx-auto mt-3 w-full max-w-sm">
						<div class="flex items-center gap-2 rounded-xl border-2 border-line bg-cream px-3 py-2.5 focus-within:border-brand">
							<Icon name="barcode" size={18} class="shrink-0 text-mist" />
							<input
								type="text"
								inputmode="numeric"
								class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-mist"
								placeholder="Ou saisis le code (ex. 3017620422003)"
								bind:value={barcodeManual}
								onkeydown={(e) => { if (e.key === 'Enter') void lookupCode(barcodeManual.replace(/\D/g, ''), 'meal'); }}
							/>
						</div>
						<button type="button" class="mt-2 w-full rounded-full bg-brand py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={barcodeBusy} onclick={() => submitManual('meal')}>
							{barcodeBusy ? 'Recherche…' : 'Rechercher le code'}
						</button>
					</div>

					{#if barcodeError}
						<p class="mx-auto mt-3 w-full max-w-sm rounded-xl bg-danger-light px-3 py-2.5 text-center text-sm text-danger">{barcodeError}</p>
					{:else if barcodeStatus === 'scanning'}
						<p class="mt-3 text-center text-xs text-mist">Caméra active — présente le code-barres à plat devant l'objectif : dès qu'il est lu, la feuille de portion s'ouvre.</p>
					{/if}
				</div>
			{/if}

			<!-- Capsule flottante Recherche ⇄ Code-barres (identique à « Ajouter un aliment ») -->
			<div class="pointer-events-none absolute inset-x-0 bottom-[calc(0.625rem+env(safe-area-inset-bottom))] z-10 flex justify-center px-4">
				<div class="pointer-events-auto flex h-14 w-[55%] min-w-[190px] max-w-[260px] items-center gap-1 rounded-full bg-ink/95 p-1 shadow-lg shadow-ink/30 ring-1 ring-white/10">
					<button
						type="button"
						class="flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold transition {mealSearchMode === 'search' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'}"
						onclick={() => void switchMealSearchMode('search')}
					>
						<Icon name="search" size={17} />
						<span>Recherche</span>
					</button>
					<button
						type="button"
						class="flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold transition {mealSearchMode === 'barcode' ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'}"
						onclick={() => void switchMealSearchMode('barcode')}
					>
						<Icon name="barcode" size={17} />
						<span>Code-barres</span>
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Barre d'actions de la sélection multiple (items planifiés) -->
{#if selMode && hasPlanned && selIds.size > 0}
	<div class="fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
		<div class="flex w-full max-w-md items-center justify-around rounded-full border border-white/10 bg-ink/95 p-1.5 shadow-lg shadow-ink/30 backdrop-blur">
			{#if canEat}
				<button
					type="button"
					class="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
					disabled={plannedBusy}
					onclick={() => eatMany([...selIds])}
				>
					<Icon name="check" size={17} strokeWidth={3} />
					Mangé
				</button>
			{:else}
				<span class="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold text-white/50">
					<Icon name="calendarClock" size={17} />
					Jour futur
				</span>
			{/if}
			<button
				type="button"
				class="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
				disabled={plannedBusy}
				onclick={() => {
					const first = plannedItems.find((p) => selIds.has(p._id));
					if (first) {
						exitSelMode();
						editPlanned = first;
					}
				}}
			>
				<Icon name="edit" size={17} />
				Modifier
			</button>
			<button
				type="button"
				class="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold text-danger transition hover:bg-danger/20"
				disabled={plannedBusy}
				onclick={() => deleteManyPlanned([...selIds])}
			>
				<Icon name="trash" size={17} />
				Supprimer
			</button>
		</div>
	</div>
{/if}

<!-- ═══════════ Feuille quantité (item planifié) — édition ═══════════ -->
{#if editPlanned && editPlannedFood}
	<QuantitySheet
		food={editPlannedFood}
		mealDefs={MEAL_DEFS}
		initialQtyGrams={editPlanned.qtyGrams}
		initialMeal={editPlanned.meal}
		mode="planned"
		saving={plannedSheetBusy}
		error={plannedSheetErr}
		onSave={(g, meal) => savePlannedQty(g, meal)}
		onEat={eatFromSheet}
		onReplace={replaceFromSheet}
		onDelete={deleteFromSheet}
		onClose={() => { editPlanned = null; }}
	/>
{/if}

<!-- ═══════════ Feuille quantité (aliment) — ajout ═══════════ -->
{#if qtyFood}
	<QuantitySheet
		food={qtyFood}
		mealDefs={MEAL_DEFS}
		initialQtyGrams={qtyGrams}
		initialMeal={qtyMeal}
		showFav={!qtyFood.custom}
		favActive={favSet.has(qtyFood._id)}
		onToggleFav={() => { if (qtyFood) toggleFav(qtyFood); }}
		saving={qtySaving}
		error={qtyError}
		onSave={(g, meal) => confirmAdd(g, meal)}
		onClose={() => { qtyFood = null; }}
	/>
{/if}

<!-- ═══════════ Feuille portion (repas) ═══════════ -->
{#if qtyMealSel}
	<div role="presentation" class="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !portionSaving) qtyMealSel = null; }} onkeydown={(e) => { if (e.key === 'Escape' && !portionSaving) qtyMealSel = null; }}>
		<div class="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
			<div class="flex items-center gap-3">							{#if qtyMealSel.ingredients[0]?.imageUrl}
								<FoodImg src={qtyMealSel.ingredients[0].imageUrl} alt="" class="h-14 w-14 rounded-xl" eager />
							{:else}
								<div class="grid h-14 w-14 place-items-center rounded-xl bg-brand-light"><Icon name="soup" size={26} class="text-brand" /></div>
							{/if}
				<div class="min-w-0 flex-1">
					<p class="truncate font-semibold text-ink">{qtyMealSel.name}</p>
					{#if isRecipeMeal}
						<p class="text-xs text-mist">{fmt(qtyMealSel.kcal)} kcal · 1 portion</p>
					{:else}
						<p class="text-xs text-mist">{fmt(qtyMealSel.kcal)} kcal pour le plat ({fmt(qtyMealSel.totalWeight)} g)</p>
					{/if}
				</div>
			</div>

			{#if isRecipeMeal}
				<div class="mt-4 flex items-center justify-between gap-3">
					<button type="button" class="grid h-12 w-12 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand" aria-label="Moins" onclick={() => setPortions(qtyPortions - 0.5)}>−</button>
					<div class="flex-1 text-center">
						<span class="text-4xl font-bold text-ink">{String(qtyPortions).replace('.', ',')}</span>
						<span class="ml-1 text-sm text-mist">{qtyPortions === 1 ? 'portion' : 'portions'}</span>
					</div>
					<button type="button" class="grid h-12 w-12 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand" aria-label="Plus" onclick={() => setPortions(qtyPortions + 0.5)}>+</button>
				</div>
				<div class="mt-3 flex flex-wrap gap-2">
					{#each PORTION_CHIPS as p (p)}
						<button type="button" class="rounded-full border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink {qtyPortions === p ? '!border-brand !text-brand' : ''}" onclick={() => setPortions(p)}>{String(p).replace('.', ',')} {p === 1 ? 'portion' : 'portions'}</button>
					{/each}
				</div>
				<p class="mt-2 text-center text-[11px] text-mist">{String(qtyPortions).replace('.', ',')} × {fmt(qtyMealSel.kcal)} kcal</p>
			{:else}
				<div class="mt-4 flex items-center justify-between gap-3">
					<button type="button" class="grid h-12 w-12 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand" aria-label="Moins" onclick={() => setPortion(qtyPortion - 10)}>−</button>
					<div class="flex-1 text-center">
						<span class="text-4xl font-bold text-ink">{fmt(qtyPortion)}</span>
						<span class="ml-1 text-sm text-mist">g</span>
					</div>
					<button type="button" class="grid h-12 w-12 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand" aria-label="Plus" onclick={() => setPortion(qtyPortion + 10)}>+</button>
				</div>
				<div class="mt-3 flex flex-wrap gap-2">
					{#each [50, 100, 150, 200, 300] as g (g)}
						<button type="button" class="rounded-full border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink {qtyPortion === g ? '!border-brand !text-brand' : ''}" onclick={() => setPortion(g)}>{g} g</button>
					{/each}
				</div>
			{/if}

			<p class="mt-3 text-center text-sm">
				<strong class="text-lg font-bold text-brand">{fmt(portionKcal)} kcal</strong>
				<span class="text-mist"> · {fmt(portionMacros?.carbs ?? 0)} g glucides · {fmt(portionMacros?.protein ?? 0)} g protéines · {fmt(portionMacros?.fat ?? 0)} g lipides</span>
			</p>

			<div class="mt-3 grid grid-cols-4 gap-1.5">				{#each MEAL_DEFS as meal (meal.id)}
					<button type="button" class="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition {qtyMeal === meal.id ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => (qtyMeal = meal.id)}>
						<Icon name={meal.icon} size={16} class="shrink-0" />
						{meal.label.split(' ')[0]}
					</button>
				{/each}
			</div>

			{#if portionError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{portionError}</p>
			{/if}

			<button type="button" class="mt-4 w-full rounded-full bg-brand py-3.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={portionSaving} onclick={confirmAddPortion}>
				{portionSaving ? 'Ajout…' : 'Ajouter cette portion au journal'}
			</button>
		</div>
	</div>
{/if}

<!-- ═══════════ Feuille quantité (aliment) — édition ═══════════ -->
{#if editEntry && editFood}
	<QuantitySheet
		food={editFood}
		mealDefs={MEAL_DEFS}
		initialQtyGrams={editEntry.qtyGrams}
		initialMeal={editEntry.meal}
		mode="edit"
		saving={editSaving}
		error={editError}
		onSave={(g, meal) => saveEdit(g, meal)}
		onUnEat={canEat ? unEatEntry : undefined}
		onDelete={deleteEdit}
		onClose={() => { editEntry = null; }}
	/>
{/if}