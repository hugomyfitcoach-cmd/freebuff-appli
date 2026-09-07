<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { startBarcodeScanner, type BarcodeScannerHandle } from '$lib/barcodeScanner';
	import QuantitySheet from '$lib/components/QuantitySheet.svelte';

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
	};
	type DayData = {
		date: string;
		goals: Goals;
		goalsSet: boolean;
		entries: Entry[];
		totals: { kcal: number; carbs: number; protein: number; fat: number };
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
		fat: number;
		ingredients: {
			foodId?: string;
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
		{ id: 'petit-dej', label: 'Petit-déjeuner', icon: '🌅' },
		{ id: 'dejeuner', label: 'Déjeuner', icon: '🍽️' },
		{ id: 'diner', label: 'Dîner', icon: '🌙' },
		{ id: 'collation', label: 'Collations', icon: '🍎' },
	] as const;

	/* ————— État ————— */
	let date = $state(untrack(() => data.today));
	let day = $state<DayData>(untrack(() => data.day));
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

	/* ————— Jour : navigation & chargement ————— */
	const todayISO = $derived((() => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	})());
	const dateLabel = $derived.by(() => {
		const d = new Date(date + 'T12:00:00');
		const base = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
		if (date === todayISO) return `Aujourd'hui · ${base}`;
		return base;
	});
	const isToday = $derived(date === todayISO);

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
	const remaining = $derived(Math.max(0, day.goals.kcal - totals.kcal));
	/** Filet de sécurité : maintenance > objectif — sinon le comportement actuel est conservé. */
	const maintenanceKcal = $derived(
		day.goals.maintenanceKcal && day.goals.maintenanceKcal > day.goals.kcal ? day.goals.maintenanceKcal : null
	);
	/** Échelle de la barre : la maintenance quand elle existe (zone filet comprise), sinon l'objectif. */
	const barScale = $derived(maintenanceKcal ?? day.goals.kcal);
	const kcalPct = $derived(barScale > 0 ? Math.min(100, (totals.kcal / barScale) * 100) : 0);
	const overGoal = $derived(totals.kcal > day.goals.kcal);
	const inSafetyNet = $derived(!!maintenanceKcal && totals.kcal > day.goals.kcal && totals.kcal <= maintenanceKcal);
	const overMaintenance = $derived(!!maintenanceKcal && totals.kcal > maintenanceKcal);
	/** Position du marqueur « Objectif » sur la barre (en % de l'échelle). */
	const goalMarkPct = $derived(barScale > 0 ? (day.goals.kcal / barScale) * 100 : 0);

	function mealEntries(meal: string) {
		return day.entries.filter((e) => e.meal === meal);
	}
	function mealKcal(meal: string) {
		return Math.round(mealEntries(meal).reduce((s, e) => s + e.kcal, 0));
	}
	function macroPct(eaten: number, goal: number) {
		return goal > 0 ? Math.min(100, (eaten / goal) * 100) : 0;
	}
	function fmt(n: number) {
		return n.toLocaleString('fr-FR');
	}
	const rings = $derived([
		{ label: 'Glucides', icon: '🌾', color: '#ec4899', eaten: totals.carbs, goal: day.goals.carbs },
		{ label: 'Protéines', icon: '💧', color: '#3b82f6', eaten: totals.protein, goal: day.goals.protein },
		{ label: 'Lipides', icon: '🫒', color: '#f97316', eaten: totals.fat, goal: day.goals.fat },
	]);

	/* ————— Swipe gauche/droite ————— */
	let touchX = $state<number | null>(null);
	function onTouchStart(e: TouchEvent) {
		if (logOpen || qtyFood || editEntry || qtyMealSel) return;
		touchX = e.touches[0].clientX;
	}
	function onTouchEnd(e: TouchEvent) {
		if (touchX === null) return;
		const dx = e.changedTouches[0].clientX - touchX;
		touchX = null;
		if (Math.abs(dx) > 60) shiftDay(dx < 0 ? 1 : -1);
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

	async function openLog(meal?: 'petit-dej' | 'dejeuner' | 'diner' | 'collation') {
		if (meal) qtyMeal = meal;
		searchQ = '';
		results = [];
		searchTab = 'produits';
		favOnly = false;
		mealEditor = false;
		customEditor = false;
		barcodeStatus = 'idle';
		barcodeError = '';
		barcodeManual = '';
		logMode = 'search';
		logOpen = true;
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
	let mealName = $state('');
	let mealDesc = $state('');
	let mealItems = $state<MealDraftItem[]>([]);
	let mealSearchQ = $state('');
	let mealResults = $state<Food[]>([]);
	let mealSearching = $state(false);
	let mealSearchTimer: ReturnType<typeof setTimeout> | undefined;
	let mealSaving = $state(false);
	let mealError = $state('');

	function openMealEditor() {
		mealEditor = true;
		mealName = '';
		mealDesc = '';
		mealItems = [];
		mealSearchQ = '';
		mealResults = [];
		mealError = '';
	}
	function closeMealEditor() {
		mealEditor = false;
	}
	async function runMealSearch(q: string) {
		if (q.length < 2) {
			mealResults = [];
			return;
		}
		mealSearching = true;
		try {
			const r = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}`);
			const j = await r.json();
			if (!j.error) mealResults = j;
		} catch {
			mealResults = [];
		} finally {
			mealSearching = false;
		}
	}
	function onMealSearchInput() {
		clearTimeout(mealSearchTimer);
		mealSearchTimer = setTimeout(() => runMealSearch(mealSearchQ.trim()), 300);
	}
	function addIngredient(food: Food) {
		mealItems = [
			...mealItems,
			{
				food,
				qty: food.servingQty && food.servingQty > 0 ? Math.round(food.servingQty) : 100,
				custom: food.custom,
				customFoodId: food.custom ? food._id : undefined,
			},
		];
		mealSearchQ = '';
		mealResults = [];
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
			const r = await fetch('/api/meals', {
				method: 'POST',
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

	async function startScanner() {
		if (scanner || scannerBusy || typeof document === 'undefined') return;
		const el = document.getElementById('bc-reader');
		if (!el) return;
		scannerBusy = true;
		barcodeStatus = 'scanning';
		try {
			scanner = await startBarcodeScanner(el, (decoded) => {
				void handleScan(decoded);
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
	async function handleScan(decoded: string) {
		if (scannerBusy || barcodeBusy) return;
		const code = decoded.replace(/\D/g, '');
		if (code.length < 8) return;
		await lookupCode(code);
	}
	async function lookupCode(code: string) {
		barcodeBusy = true;
		barcodeError = '';
		try {
			const r = await fetch(`/api/foods/barcode?code=${encodeURIComponent(code)}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			if (j.length === 1) {
				await stopScanner();
				barcodeStatus = 'idle';
				openQty(j[0]);
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
	function submitManual() {
		const code = barcodeManual.replace(/\D/g, '');
		if (code.length >= 8) void lookupCode(code);
		else barcodeError = 'Saisis un code-barres complet (8 à 14 chiffres).';
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
	let datePicker = $state<HTMLInputElement | null>(null);
	function openDatePicker() {
		if (datePicker) {
			datePicker.value = date;
			datePicker.showPicker?.();
			datePicker.focus();
		}
	}

	onMount(() => {
		document.addEventListener('keydown', (e) => {
			if (logOpen || qtyFood || editEntry || qtyMealSel) return;
			if (e.key === 'ArrowLeft') shiftDay(-1);
			if (e.key === 'ArrowRight') shiftDay(1);
		});

		/* Clavier mobile : ajuste la hauteur de la modale pour que la liste de
		   résultats et la barre Recherche/Code-barres restent visibles au-dessus
		   du clavier (comme une app native). --kb = hauteur du clavier en px. */
		const setKb = () => {
			const vv = window.visualViewport;
			if (!vv) return;
			const kb = Math.max(0, window.innerHeight - vv.height);
			document.documentElement.style.setProperty('--kb', `${kb}px`);
		};
		const vv = window.visualViewport;
		if (vv) {
			vv.addEventListener('resize', setKb);
			vv.addEventListener('scroll', setKb);
			setKb();
		}
	});
</script>

<svelte:head><title>Journal — G-Flux</title></svelte:head>

<svelte:window ontouchstart={onTouchStart} ontouchend={onTouchEnd} />

<div class="mx-auto w-full max-w-2xl px-3 pb-28 pt-4 sm:px-6">
	<!-- En-tête : date + navigation -->
	<header class="mb-4 flex items-center justify-between gap-2">
		<button
			type="button"
			class="grid h-10 w-10 place-items-center rounded-full border-2 border-line bg-card text-xl font-bold text-ink transition hover:border-brand"
			aria-label="Jour précédent"
			onclick={() => shiftDay(-1)}
		>‹</button>
		<button
			type="button"
			class="rounded-full px-4 py-2 text-center font-display text-base font-semibold capitalize text-ink transition hover:bg-line/50"
			onclick={openDatePicker}
			title="Choisir une date"
		>
			{dateLabel} <span class="ml-1 text-xs text-mist">▾</span>
		</button>
		<button
			type="button"
			class="grid h-10 w-10 place-items-center rounded-full border-2 border-line bg-card text-xl font-bold text-ink transition hover:border-brand"
			aria-label="Jour suivant"
			onclick={() => shiftDay(1)}
		>›</button>
		<input
			bind:this={datePicker}
			type="date"
			class="sr-only"
			onchange={(e) => {
				const v = (e.currentTarget as HTMLInputElement).value;
				if (v) setDate(v);
			}}
		/>
	</header>

	{#if error}
		<div class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">
			{error}
		</div>
	{/if}

	<div class="transition-opacity" class:opacity-40={loadingDay}>
		<!-- Carte calories -->
		<section class="mb-3 rounded-2xl border border-line bg-card p-5 shadow-sm">
			<div class="flex items-start justify-between gap-3">
				<p class="text-sm text-ink">
					{overGoal ? (overMaintenance ? 'Maintenance dépassée de' : 'Objectif dépassé de') : 'Il te reste'}
					<span class="block text-4xl font-bold leading-tight text-ink">
						{overGoal ? (overMaintenance ? fmt(totals.kcal - (maintenanceKcal ?? day.goals.kcal)) : fmt(totals.kcal - day.goals.kcal)) : fmt(remaining)}<span class="ml-1 text-base font-semibold text-mist">kcal</span>
					</span>
				</p>
				<span class="text-3xl" aria-hidden="true">🔥</span>
			</div>
			{#if inSafetyNet}
				<p class="mt-1 text-xs font-semibold text-warn">🛟 Dans ton filet de sécurité — tu restes sous ta maintenance</p>
			{/if}
			{#if overMaintenance}
				<p class="mt-1 text-xs font-semibold text-danger/80">Ta journée reste dans le cadre sur la durée — on ajuste ensemble si besoin.</p>
			{/if}
			<div class="relative mt-4 h-2.5 w-full overflow-hidden rounded-full bg-line/70">
				{#if maintenanceKcal}
					<!-- Zone « filet de sécurité » entre l'objectif et la maintenance -->
					<div class="absolute inset-y-0 rounded-full bg-warn-light" style="left: {goalMarkPct}%; right: 0"></div>
				{/if}
				<div
					class="relative h-full rounded-full transition-all duration-500 {overMaintenance ? 'bg-danger' : overGoal ? 'bg-warn' : 'bg-brand'}"
					style:width="{kcalPct}%"
				></div>
				{#if maintenanceKcal}
					<!-- Marqueur vertical de l'objectif (la cible principale) -->
					<div class="absolute inset-y-[-3px] w-[2px] rounded bg-ink/60" style="left: {goalMarkPct}%" title="Objectif : {fmt(day.goals.kcal)} kcal"></div>
				{/if}
			</div>
			<div class="mt-2 flex items-baseline justify-between gap-2 text-xs">
				<span class="font-semibold {overMaintenance ? 'text-danger' : overGoal ? 'text-warn' : 'text-brand'}">{fmt(Math.round(totals.kcal))} kcal consommées</span>
				<span class="text-right">
					<span class="font-semibold text-ink">Objectif : {fmt(day.goals.kcal)}</span>
					{#if maintenanceKcal}
						<span class="ml-1 text-[11px] text-mist">· Maintenance : {fmt(maintenanceKcal)}</span>
					{/if}
				</span>
			</div>
			<div class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-danger-light px-3 py-1.5 text-xs font-semibold text-danger">
				<span aria-hidden="true">⏱</span> 0 kcal brûlées
			</div>
		</section>

		<!-- Macros -->
		<section class="mb-3 grid grid-cols-3 gap-3">
			{#each rings as ring (ring.label)}
				{@const pct = macroPct(ring.eaten, ring.goal)}
				{@const circ = 2 * Math.PI * 26}
				<div class="rounded-2xl border border-line bg-card p-3 text-center shadow-sm">
					<div class="mb-1 flex items-center justify-between">
						<span class="text-[11px] font-bold text-ink">{ring.label}</span>
						<span class="text-sm" aria-hidden="true">{ring.icon}</span>
					</div>
					<div class="relative mx-auto h-16 w-16">
						<svg viewBox="0 0 64 64" class="h-16 w-16 -rotate-90">
							<circle cx="32" cy="32" r="26" fill="none" stroke="#eef0ec" stroke-width="7" />
							<circle
								cx="32"
								cy="32"
								r="26"
								fill="none"
								stroke={ring.color}
								stroke-width="7"
								stroke-linecap="round"
								stroke-dasharray={circ}
								stroke-dashoffset={circ * (1 - pct / 100)}
								style="transition: stroke-dashoffset .5s"
							/>
						</svg>
						<span class="absolute inset-0 grid place-items-center text-sm font-bold" style:color={ring.color}>
							{Math.round(pct)}%
						</span>
					</div>
					<p class="mt-2 text-xs text-ink">
						<strong class="font-bold">{fmt(Math.round(ring.eaten))}</strong><span class="text-mist">/{fmt(ring.goal)}g</span>
					</p>
				</div>
			{/each}
		</section>

		<!-- Astuce du jour -->
		{#if !tipDismissed}
			<section class="mb-3 rounded-2xl border-2 border-dashed border-brand/40 bg-brand-light/50 p-4">
				<div class="flex items-center justify-between">
					<span class="text-[11px] font-bold uppercase tracking-widest text-brand">Astuce du jour</span>
					<button
						type="button"
						class="grid h-6 w-6 place-items-center rounded-full bg-line/60 text-xs text-mist hover:bg-line"
						aria-label="Fermer l'astuce"
						onclick={() => (tipDismissed = true)}
					>✕</button>
				</div>
				<p class="mt-1 text-sm leading-relaxed text-ink">{tip}</p>
			</section>
		{/if}

		<!-- Repas -->
		{#each MEAL_DEFS as meal (meal.id)}
			{@const entries = mealEntries(meal.id)}
			<section class="mb-3 rounded-2xl border border-line bg-card shadow-sm">
				<header class="flex items-center justify-between px-4 pt-4">
					<h2 class="font-display text-base font-semibold text-ink">
						<span class="mr-1.5" aria-hidden="true">{meal.icon}</span>{meal.label}
					</h2>
					<button
						type="button"
						class="grid h-7 w-7 place-items-center rounded-lg bg-brand text-base font-bold text-white transition hover:bg-brand-dark"
						aria-label={`Ajouter au ${meal.label}`}
						onclick={() => { qtyMeal = meal.id; openLog(meal.id); }}
					>+</button>
				</header>
				{#if mealKcal(meal.id) > 0}
					<p class="px-4 pt-1 text-xs font-semibold text-brand">{fmt(mealKcal(meal.id))} kcal</p>
				{/if}
				<div class="p-2">
					{#if entries.length === 0}
						<p class="px-2 py-3 text-center text-xs text-mist">Rien pour l'instant — ajoute un aliment avec « + ».</p>
					{:else}
						{#each entries as e (e._id)}
							<button
								type="button"
								class="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-line/40"
								onclick={() => openEdit(e)}
							>
								{#if e.imageUrl}
									<img src={e.imageUrl} alt="" class="h-10 w-10 shrink-0 rounded-lg object-cover" loading="lazy" />
								{:else}
									<div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light text-lg">🍴</div>
								{/if}
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-semibold text-ink">{e.name}</span>
									<span class="block text-xs text-mist">
										<strong class="font-bold text-brand">{fmt(e.kcal)} kcal</strong>
										{#if e.portions}
											· {String(e.portions).replace('.', ',')} {e.portions === 1 ? 'portion' : 'portions'}
										{:else}
											· {fmt(e.qtyGrams)} g
										{/if}
									</span>
								</span>
							</button>
						{/each}
					{/if}
				</div>
			</section>
		{/each}

		<p class="mt-6 text-center text-xs text-mist">
			Glisse le journal à gauche/droite (ou utilise les chevrons) pour changer de jour.
		</p>
	</div>
</div>

<!-- Bouton flottant + -->
<button
	type="button"
	class="fixed bottom-6 right-6 z-40 grid h-16 w-16 place-items-center rounded-full bg-brand text-3xl font-bold text-white shadow-lg shadow-brand/30 transition hover:scale-105 hover:bg-brand-dark active:scale-95"
	aria-label="Ajouter un aliment"
	onclick={() => openLog()}
>+</button>

<!-- ═══════════ Modale « Ajouter un aliment » ═══════════ -->
{#if logOpen}
	<div role="presentation" class="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget) closeLog(); }} onkeydown={(e) => { if (e.key === 'Escape') closeLog(); }}>
		<div class="flex h-[calc(100dvh-var(--kb,0px))] w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-3xl">
			<!-- En-tête -->
			<div class="flex items-center justify-between border-b border-line px-4 py-3">
				<button type="button" class="grid h-8 w-8 place-items-center rounded-full text-lg text-mist hover:bg-line/50" aria-label="Fermer" onclick={() => closeLog()}>✕</button>
				<h2 class="font-display text-base font-semibold text-ink">{logMode === 'barcode' ? 'Code-barres' : 'Ajouter un aliment'}</h2>
				<span class="w-8"></span>
			</div>

			{#if logMode === 'search'}
				<!-- Recherche + onglets -->
				<div class="border-b border-line p-3">
					<div class="flex items-center gap-2 rounded-xl border-2 border-line bg-cream px-3 py-2.5 focus-within:border-brand">
						<span class="text-mist" aria-hidden="true">🔍</span>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="search"
							class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-mist"
							placeholder="Rechercher un produit…"
							bind:value={searchQ}
							oninput={onSearchInput}
							autofocus
						/>
					</div>
					<div class="mt-2 flex items-center gap-2 overflow-x-auto">
						<button
							type="button"
							class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-base transition {favOnly ? 'bg-brand text-white' : 'bg-line/50 text-mist hover:text-ink'}"
							title={favOnly ? 'Voir tous les produits' : 'Voir mes favoris'}
							aria-label="Voir mes favoris"
							onclick={() => (favOnly = !favOnly)}
						>{favOnly ? '♥' : '♡'}</button>
						<button type="button" class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition {searchTab === 'produits' ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => { searchTab = 'produits'; favOnly = false; }}>Tous les produits</button>
						<button type="button" class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition {searchTab === 'repas' ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => (searchTab = 'repas')}>Repas</button>
						<button type="button" class="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition {searchTab === 'crees' ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => (searchTab = 'crees')}>Créés par moi</button>
					</div>
				</div>

				<!-- Résultats -->
				<div class="flex-1 overflow-y-auto p-3">
					{#if mealEditor}
						<!-- ═══════ Éditeur de repas ═══════ -->
						<div>
							<button type="button" class="mb-3 flex items-center gap-1 text-sm font-semibold text-mist hover:text-ink" onclick={closeMealEditor}>← Retour aux repas</button>

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
								<div class="rounded-xl border border-line bg-white p-2 text-center">
									<span class="block text-sm" aria-hidden="true">🔥</span>
									<span class="block text-xs font-bold text-ink">{fmt(mealTotals.kcal)}</span>
									<span class="block text-[10px] text-mist">kcal</span>
								</div>
								<div class="rounded-xl border border-line bg-white p-2 text-center">
									<span class="block text-sm" aria-hidden="true">🌾</span>
									<span class="block text-xs font-bold text-ink">{fmt(mealTotals.carbs)} g</span>
									<span class="block text-[10px] text-mist">glucides</span>
								</div>
								<div class="rounded-xl border border-line bg-white p-2 text-center">
									<span class="block text-sm" aria-hidden="true">💧</span>
									<span class="block text-xs font-bold text-ink">{fmt(mealTotals.protein)} g</span>
									<span class="block text-[10px] text-mist">protéines</span>
								</div>
								<div class="rounded-xl border border-line bg-white p-2 text-center">
									<span class="block text-sm" aria-hidden="true">🫒</span>
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
								<ul class="flex flex-col gap-2">
									{#each mealItems as it, i (it.food._id)}
										<li class="flex items-center gap-2 rounded-xl border border-line bg-white p-2">
											{#if it.food.imageUrl}
												<img src={it.food.imageUrl} alt="" class="h-10 w-10 shrink-0 rounded-lg object-cover" loading="lazy" />
											{:else}
												<div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light text-lg">🍴</div>
											{/if}
											<span class="min-w-0 flex-1">
												<span class="block truncate text-xs font-semibold text-ink">{it.food.name}</span>
												<span class="block text-[11px] text-mist">{fmt(Math.round((it.food.kcal100 * it.qty) / 100))} kcal</span>
											</span>
											<div class="flex shrink-0 items-center gap-1">
												<button type="button" class="grid h-7 w-7 place-items-center rounded-lg border border-line text-sm font-bold text-ink" aria-label="Moins" onclick={() => setIngQty(i, it.qty - 10)}>−</button>
												<span class="w-12 text-center text-xs font-bold text-ink">{fmt(it.qty)} g</span>
												<button type="button" class="grid h-7 w-7 place-items-center rounded-lg border border-line text-sm font-bold text-ink" aria-label="Plus" onclick={() => setIngQty(i, it.qty + 10)}>+</button>
												<button type="button" class="ml-1 grid h-7 w-7 place-items-center rounded-lg text-sm text-mist hover:bg-danger-light hover:text-danger" aria-label="Retirer l'ingrédient" onclick={() => removeIngredient(i)}>✕</button>
											</div>
										</li>
									{/each}
								</ul>
							{/if}

							<!-- Mini-recherche pour ajouter un produit -->
							<div class="mt-3 rounded-xl border-2 border-line bg-cream px-3 py-2.5 focus-within:border-brand">
								<input
									type="search"
									class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-mist"
									placeholder="Ajouter un produit…"
									bind:value={mealSearchQ}
									oninput={onMealSearchInput}
								/>
							</div>
							{#if mealSearching}
								<p class="py-3 text-center text-xs text-mist">Recherche…</p>
							{:else if mealResults.length > 0}
								<ul class="mt-2 flex flex-col gap-1.5">
									{#each mealResults as food (food._id)}
										<li>
											<button type="button" class="flex w-full items-center gap-2 rounded-xl border border-line bg-white p-2 text-left transition hover:border-brand" onclick={() => addIngredient(food)}>
												{#if food.imageUrl}
													<img src={food.imageUrl} alt="" class="h-9 w-9 shrink-0 rounded-lg object-cover" loading="lazy" />
												{:else}
													<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-light text-base">🍴</div>
												{/if}
												<span class="min-w-0 flex-1">
													<span class="block truncate text-xs font-semibold text-ink">{food.name}</span>
													<span class="block text-[11px] text-mist">{fmt(food.kcal100)} kcal / 100 g</span>
												</span>
												<span class="text-sm text-brand">＋</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}

							{#if mealError}
								<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{mealError}</p>
							{/if}

							<button type="button" class="mt-4 w-full rounded-full bg-brand py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={mealSaving || mealItems.length === 0 || mealName.trim().length < 2} onclick={saveMeal}>
								{mealSaving ? 'Enregistrement…' : 'Enregistrer le repas'}
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
							<div class="py-10 text-center">
								<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light text-2xl">🍽️</div>
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
												<img src={meal.ingredients[0].imageUrl} alt="" class="h-11 w-11 shrink-0 rounded-xl object-cover" loading="lazy" />
											{:else}
												<div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light text-xl">🍲</div>
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
										<button type="button" class="shrink-0 grid h-8 w-8 place-items-center rounded-lg text-sm text-mist transition hover:bg-danger-light hover:text-danger" aria-label={`Supprimer ${meal.name}`} onclick={() => deleteMeal(meal)}>🗑</button>
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
									<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light text-2xl">🍲</div>
									<p class="text-sm font-semibold text-ink">Aucun aliment créé</p>
									<p class="mx-auto mt-1 max-w-xs text-xs text-mist">Un produit absent de la base ? Crée-le ici avec son étiquette nutritionnelle (calories, protéines, lipides…).</p>
								</div>
							{:else}
								<ul class="flex flex-col gap-2">
									{#each customFoods as food (food._id)}
										<li class="flex items-center gap-2">
											<button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-white p-2.5 text-left shadow-sm transition hover:border-brand" onclick={() => openQty(food)}>
												<div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light text-xl">🍲</div>
												<span class="min-w-0 flex-1">
													<span class="block truncate text-sm font-semibold text-ink">{food.name}</span>
													<span class="block text-xs text-mist"><strong class="font-bold text-brand">{fmt(food.kcal100)} kcal</strong> · 100 g{#if food.brand} · {food.brand}{/if}</span>
												</span>
											</button>
											<button type="button" class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm text-mist transition hover:bg-danger-light hover:text-danger" aria-label={`Supprimer ${food.name}`} onclick={() => deleteCustomFood(food)}>🗑</button>
										</li>
									{/each}
								</ul>
								<p class="mt-3 text-center text-xs text-mist">Touche un aliment pour l'ajouter au journal. Il apparaît aussi dans la recherche.</p>
							{/if}
						{/if}
					{:else if favOnly}
						<!-- ═══════ Favoris ═══════ -->
						{#if favorites.length === 0}
							<div class="py-10 text-center">
								<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light text-2xl">♥</div>
								<p class="text-sm font-semibold text-ink">Aucun favori</p>
								<p class="mx-auto mt-1 max-w-xs text-xs text-mist">Touche le cœur ♡ d'un produit pour le retrouver ici en un geste.</p>
							</div>
						{:else}
							<ul class="flex flex-col gap-2">
								{#each favorites as food (food._id)}
									<li class="flex items-center gap-2">
										<button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-white p-2.5 text-left shadow-sm transition hover:border-brand" onclick={() => openQty(food)}>
											{#if food.imageUrl}
												<img src={food.imageUrl} alt="" class="h-11 w-11 shrink-0 rounded-xl object-cover" loading="lazy" />
											{:else}
												<div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light text-xl">🍴</div>
											{/if}
											<span class="min-w-0 flex-1">
												<span class="block truncate text-sm font-semibold text-ink">{food.name}</span>
												<span class="block text-xs text-mist"><strong class="font-bold text-brand">{fmt(food.kcal100)} kcal</strong> · 100 g</span>
											</span>
										</button>
										<button type="button" class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-brand transition hover:bg-brand-light" aria-label={`Retirer ${food.name} des favoris`} onclick={() => toggleFav(food)}>♥</button>
									</li>
								{/each}
							</ul>
						{/if}
					{:else if searching}
						<p class="py-10 text-center text-sm text-mist">Recherche…</p>
					{:else if searchError}
						<p class="rounded-xl border-2 border-danger bg-danger-light px-3 py-3 text-sm text-danger">{searchError}</p>
					{:else if searchQ.trim().length < 2}
						<p class="py-10 text-center text-sm text-mist">Tape au moins 2 lettres pour chercher un produit (base G-Flux, 780 000 aliments).</p>
					{:else if results.length === 0}
						<p class="py-10 text-center text-sm text-mist">Aucun résultat pour « {searchQ.trim()} ».</p>
					{:else}
						<ul class="flex flex-col gap-2">
							{#each results as food (food._id)}
								{@const fav = favSet.has(food._id)}
								<li class="flex items-center gap-2">
									<button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-white p-2.5 text-left shadow-sm transition hover:border-brand" onclick={() => openQty(food)}>
										{#if food.imageUrl}
											<img src={food.imageUrl} alt="" class="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
										{:else}
											<div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-light text-xl">🍴</div>
										{/if}
										<span class="min-w-0 flex-1">
											<span class="flex items-center gap-1">
												<span class="truncate text-sm font-semibold text-ink">{food.name}</span>
												{#if !food.custom}<span class="shrink-0 text-[10px] font-bold text-brand" title="Vérifié Open Food Facts">✓</span>{/if}
											</span>
											<span class="block text-xs text-mist">
												<strong class="font-bold text-brand">{fmt(food.kcal100)} kcal</strong> · 100 g{#if food.brand} · {food.brand}{/if}
											</span>
										</span>
									</button>
									{#if !food.custom}
										<button type="button" class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg transition {fav ? 'text-brand' : 'text-mist hover:text-brand'}" aria-label={fav ? `Retirer ${food.name} des favoris` : `Ajouter ${food.name} aux favoris`} onclick={() => toggleFav(food)}>{fav ? '♥' : '♡'}</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{:else}
				<!-- ═══════ Scanner code-barres ═══════ -->
				<div class="flex-1 overflow-y-auto p-3">
					<p class="mb-3 text-center text-xs text-mist">Scanne le code-barres du produit (ça marche même à distance) ou saisis-le à la main : on le retrouve dans la base G-Flux.</p>
					<div id="bc-reader" class="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl border-2 bg-ink/5 transition-colors {barcodeBusy ? 'border-brand ring-4 ring-brand/40' : 'border-line'}"></div>

					<div class="mx-auto mt-3 w-full max-w-sm">
						<div class="flex items-center gap-2 rounded-xl border-2 border-line bg-cream px-3 py-2.5 focus-within:border-brand">
							<span class="text-mist" aria-hidden="true">🔢</span>
							<input
								type="text"
								inputmode="numeric"
								class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-mist"
								placeholder="Ou saisis le code (ex. 3017620422003)"
								bind:value={barcodeManual}
								onkeydown={(e) => { if (e.key === 'Enter') submitManual(); }}
							/>
						</div>
						<button type="button" class="mt-2 w-full rounded-full bg-brand py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={barcodeBusy} onclick={submitManual}>
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

			<!-- Barre flottante : Recherche ⇄ Code-barres -->
			<div class="px-3 py-3">
				<div class="mx-auto flex max-w-[280px] items-center gap-1 rounded-full bg-ink/95 p-1 shadow-lg shadow-ink/20">
					<button type="button" class="flex-1 rounded-full py-2 text-center text-xs font-semibold transition {logMode === 'search' ? 'bg-white/90 text-ink' : 'text-white/70 hover:text-white'}" onclick={() => switchMode('search')}>
						<span class="block text-base leading-none" aria-hidden="true">🔍</span>
						<span class="mt-0.5 block">Recherche</span>
					</button>
					<button type="button" class="flex-1 rounded-full py-2 text-center text-xs font-semibold transition {logMode === 'barcode' ? 'bg-white/90 text-ink' : 'text-white/70 hover:text-white'}" onclick={() => switchMode('barcode')}>
						<span class="block text-base leading-none" aria-hidden="true">📷</span>
						<span class="mt-0.5 block">Code-barres</span>
					</button>
				</div>
			</div>
		</div>
	</div>
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
			<div class="flex items-center gap-3">
				{#if qtyMealSel.ingredients[0]?.imageUrl}
					<img src={qtyMealSel.ingredients[0].imageUrl} alt="" class="h-14 w-14 rounded-xl object-cover" />
				{:else}
					<div class="grid h-14 w-14 place-items-center rounded-xl bg-brand-light text-2xl">🍲</div>
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

			<div class="mt-3 grid grid-cols-4 gap-1.5">
				{#each MEAL_DEFS as meal (meal.id)}
					<button type="button" class="rounded-xl px-2 py-2 text-[11px] font-semibold transition {qtyMeal === meal.id ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => (qtyMeal = meal.id)}>
						{meal.icon}<br />{meal.label.split(' ')[0]}
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
		onDelete={deleteEdit}
		onClose={() => { editEntry = null; }}
	/>
{/if}