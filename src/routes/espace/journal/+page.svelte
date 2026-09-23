<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { startBarcodeScanner, CameraPermissionError, normalizeProductCode, type BarcodeScannerHandle, type TorchHandle } from '$lib/barcodeScanner';
	import { compressImage, detectBarcodeInDataUrl } from '$lib/labelBarcode';
	import { currentLocalDay } from '$lib/currentDay.svelte';
	import { appWarm, firstVisit, isFresh, noteSync, restoreScroll, saveScroll } from '$lib/navMemory';
	import JournalDay from '$lib/components/JournalDay.svelte';
	import QuantitySheet from '$lib/components/QuantitySheet.svelte';
	import FoodImg from '$lib/components/FoodImg.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { forceAppUpdate, needsAppUpdate } from '$lib/swUpdate';
import { FRONTEND_API_VERSION } from '$lib/apiVersion';
import { warmFoodImages } from '$lib/foodImageWarm';
import { journalTipForDay } from '$lib/data/journalTips';

	type Goals = { kcal: number; carbs: number; protein: number; fat: number; maintenanceKcal?: number };
	type Entry = {
		_id: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		/** Miniature miroir G-FLUX (copie OFF 100 px) — prioritaire sur imageUrl. */
		thumbUrl?: string;
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
		/** Regroupement « repas analysé » (photo IA) : une carte repliable au Journal. */
		mealGroup?: string;
		/** Identité d'origine (duplication / création de repas) — snapshot sinon. */
		foodId?: string;
		customFoodId?: string;
		ciqualLabel?: string;
	};
	/** Item PLANIFIÉ — plan coach ou préparation cliente : grisé, 0 impact header. */
	type PlannedItem = {
		/** Date "yyyy-mm-dd" de l'item (frontière « Mangé » : jamais au futur). */
		date: string;
		_id: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		/** Miniature miroir G-FLUX (copie OFF 100 px) — prioritaire sur imageUrl. */
		thumbUrl?: string;
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
		/** Identité d'origine (duplication / création de repas) — snapshot sinon. */
		foodId?: string;
		customFoodId?: string;
		ciqualLabel?: string;
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
		/** Garde-fou kcal↔macros : kcal OFF incohérentes, valeur recalculée affichée. */
		kcalRecalculated?: boolean;
		imageUrl?: string;
		/** Miniature miroir G-FLUX prête (copie OFF 100 px) — prioritaire sur imageUrl. */
		thumbUrl?: string;
		servingQty?: number;
		/** Aliment personnel créé par le client (base « Créés par moi »). */
		custom?: boolean;
		/** Code-barres EAN/GTIN rattaché (aliments personnels produits emballés). */
		barcode?: string;
		/** Fiche de RÉFÉRENCE Ciqual (ANSES) — _id = libellé officiel exact. */
		ciqual?: boolean;
		/** Fibres /100 g (aliments personnels, information d'étiquette). */
		fiber100?: number;
		/** Sel /100 g (aliments personnels, information d'étiquette). */
		salt100?: number;
	};	type Meal = {
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
			/** Fiche de RÉFÉRENCE Ciqual (ANSES) — libellé officiel exact. */
			ciqualLabel?: string;
			name: string;
			brand?: string;
			imageUrl?: string;
			/** Miniature miroir G-FLUX (copie OFF 100 px) — prioritaire sur imageUrl. */
			thumbUrl?: string;
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
	type MealDraftItem = { food: Food; qty: number; custom?: boolean; customFoodId?: string; ciqualLabel?: string };

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
	/* Astuce du jour : bibliothèque de 50 astuces G-FLUX (lib/data/journalTips.ts).
	   Rotation déterministe par date → identique toute la journée et à chaque
	   refresh, jamais deux jours de suite la même. */
	const tip = $derived(journalTipForDay(date));

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
	/** Demain (ISO local) — raccourci « Dupliquer ». */
	const tomorrowISO = $derived.by(() => {
		const d = new Date(todayISO + 'T12:00:00');
		d.setDate(d.getDate() + 1);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	});
	/** Libellé court d'une date ISO (« Demain », « Mer. 16 sept. »). */
	function dupLabelOf(iso: string): string {
		if (iso === todayISO) return "Aujourd'hui";
		if (iso === tomorrowISO) return 'Demain';
		const d = new Date(iso + 'T12:00:00');
		const wd = d.toLocaleDateString('fr-FR', { weekday: 'short' });
		return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d.getDate()} ${MOIS_ABBR[d.getMonth()]}`;
	}

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

	/* ————— Vue détail macro (clic carte Glucides / Protéines / Lipides) —————
	   Principe fonctionnel FOOD, rendu 100 % G-FLUX : mêmes couleurs
	   (#ec4899 / #3b82f6 / #f97316) et mêmes icônes (wheat / drumstick /
	   droplet) que les cartes du Journal. Données = entrées DÉJÀ enregistrées
	   du jour (snapshots du Journal) : aucune recherche OFF/Ciqual à
	   l'ouverture, et la somme des valeurs par aliment = total de la carte.
	   La carte Calories n'est PAS concernée — aucun détail n'existe pour elle. */
	const MACRO_LIST = [
		{ key: 'carbs', label: 'Glucides', icon: 'wheat', color: '#ec4899', field: 'carbs' },
		{ key: 'protein', label: 'Protéines', icon: 'drumstick', color: '#3b82f6', field: 'protein' },
		{ key: 'fat', label: 'Lipides', icon: 'droplet', color: '#f97316', field: 'fat' },
	] as const;
	type MacroKey = (typeof MACRO_LIST)[number]['key'];
	const MACRO_DEFS = { carbs: MACRO_LIST[0], protein: MACRO_LIST[1], fat: MACRO_LIST[2] };
	let macroDetail = $state<MacroKey | null>(null);
	/** Jamais null : fallback neutre tant que la vue est fermée (évitement de
	 *  narrowing fragile dans le template). Ne s'affiche que si `macroDetail`. */
	const macroMeta = $derived(macroDetail ? MACRO_DEFS[macroDetail] : MACRO_LIST[0]);
	const macroGoal = $derived(macroDetail ? day.goals[macroDetail] : 0);
	const macroEaten = $derived(macroDetail ? totals[macroDetail] : 0);
	const macroDetailPct = $derived(macroGoal > 0 ? Math.min(100, (macroEaten / macroGoal) * 100) : 0);
	const macroCirc = 2 * Math.PI * 22;
	/** Grammes avec 1 décimale max, virgule française (« 54,6 g »). */
	function fmtG(n: number) {
		return fmt(Math.round(n * 10) / 10);
	}
	/** Aliments consommés du jour regroupés par repas (ordre du Journal) ;
	 *  seuls les repas réellement consommés apparaissent — repas vides masqués. */
	const macroMealGroups = $derived.by(() => {
		const key = macroDetail;
		if (!key) return [];
		const field = MACRO_DEFS[key].field;
		return MEAL_DEFS.map((m) => {
			const entries = day.entries.filter((e) => e.meal === m.id);
			return { id: m.id, label: m.label, entries, total: entries.reduce((s, e) => s + e[field], 0) };
		}).filter((g) => g.entries.length > 0);
	});
	function openMacroDetail(m: MacroKey) {
		macroDetail = m;
		window.scrollTo(0, 0);
	}
	function closeMacroDetail() {
		macroDetail = null;
	}
	/* Changement de journée (swipe, calendrier, minuit) : le détail suit le jour
	   affiché → on le ferme, la cliente retrouve le Journal du nouveau jour. */
	let macroDay = date;
	$effect.pre(() => {
		if (date !== macroDay) {
			macroDay = date;
			macroDetail = null;
		}
	});

	/* ————— Items PLANIFIÉS (plan coach + préparation cliente) —————
	   PLANIFIÉ ≠ CONSOMMÉ : ces items sont grisés et n'impactent RIEN dans le
	   header tant qu'ils ne sont pas validés « Mangé ». Les totaux consommés
	   ci-dessus ne lisent QUE day.entries (single source of truth). */
	const plannedItems = $derived(day.planned ?? []);
	const hasPlanned = $derived(plannedItems.length > 0);

	/* ————— Sélection type FOOD (tous les aliments du journal : consommés + planifiés) —————
	   Rond TOUJOURS visible sur chaque ligne : vide → coché (vert). Sélection
	   TEMPORAIRE uniquement — jamais un statut « mangé ». La barre d'actions
	   apparaît dès le premier rond coché ; aucun mode « Sélectionner ». */
	let selIds = $state<Set<string>>(new Set());
	/** Union consommés + planifiés : la sélection porte sur TOUTES les lignes du Journal. */
	const allRows = $derived([...day.entries, ...plannedItems]);
	const allSel = $derived(allRows.length > 0 && allRows.every((r) => selIds.has(r._id)));
	function toggleSel(id: string) {
		const next = new Set(selIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selIds = next;
	}
	function clearSel() {
		selIds = new Set();
	}
	function toggleAllSel() {
		selIds = allSel ? new Set() : new Set(allRows.map((r) => r._id));
	}
	/** La journée change (swipe, calendrier, minuit) → la sélection est obsolète.
	 *  ⚠️ L'effet ne doit dépendre QUE de `date` : y lire `selIds` le relancerait
	 *  à chaque clic sur un rond (le Set change) et effacerait la sélection
	 *  immédiatement — le bug « sélection qui saute ». Un garde date le compare. */
	let selDay = date;
	$effect.pre(() => {
		if (date !== selDay) {
			selDay = date;
			selIds = new Set();
		}
	});
	/** Ids de la sélection, séparés par type de ligne (mêmes ids côté serveur). */
	const selEntryIds = $derived([...day.entries.filter((e) => selIds.has(e._id)).map((e) => e._id)]);
	const selPlannedIds = $derived([...plannedItems.filter((p) => selIds.has(p._id)).map((p) => p._id)]);
	/** « Mangé » : uniquement une sélection 100 % planifiée arrivée à aujourd'hui (jamais au futur, jamais du consommé). */
	const selAllEatable = $derived(
		canEat && selEntryIds.length === 0 && selPlannedIds.length > 0 && plannedItems.filter((p) => selIds.has(p._id)).every((p) => p.date <= todayISO)
	);

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
				body: JSON.stringify({ plannedId: p._id, clientDate: currentLocalDay() }),
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
				body: JSON.stringify({ plannedIds: ids, clientDate: currentLocalDay() }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			clearSel();
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
			clearSel();
			await refreshAfterPlanned();
		} catch (e) {
			plannedErr = e instanceof Error ? e.message : String(e);
		} finally {
			plannedBusy = false;
		}
	}

	/** Suppression de TOUTE la sélection : entrées via /api/journal/[id], planifiés via /api/journal/planned. */
	async function deleteSelection() {
		if (plannedBusy) return;
		if (selEntryIds.length === 0 && selPlannedIds.length === 0) return;
		plannedBusy = true;
		plannedErr = '';
		try {
			for (const id of selEntryIds) {
				await fetch(`/api/journal/${id}`, { method: 'DELETE' });
			}
			for (const id of selPlannedIds) {
				await fetch(`/api/journal/planned?plannedId=${id}`, { method: 'DELETE' });
			}
			clearSel();
			await refreshAfterPlanned();
		} catch (e) {
			plannedErr = e instanceof Error ? e.message : String(e);
		} finally {
			plannedBusy = false;
		}
	}

	/* ————— Dupliquer / Planifier la sélection vers une autre date ————— */
	let dupOpen = $state(false);
	/** false = Dupliquer (copie, future → planifié) ; true = Planifier (future imposée). */
	let planMode = $state(false);
	let dupDate = $state('');
	let dupBusy = $state(false);
	let dupErr = $state('');
	/** Libellé compact de la date choisie (« Demain », « Mer. 16 sept. »). */
	const dupDateLabel = $derived(dupDate ? dupLabelOf(dupDate) : '—');
	/** La date choisie est-elle bien future (exigé par « Planifier ») ? */
	const dupDateIsFuture = $derived(dupDate !== '' && dupDate > todayISO);

	/* Calendrier bottom-sheet type FOOD : grand mois + flèches, jour = cercle vert. */
	const MOIS_CAL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
	let calMonth = $state(0); // 0-11 : mois affiché
	let calYear = $state(0); // année affichée
	/** Grille du mois affiché (lundi → dimanche) ; null = case vide avant le 1er / après le dernier. */
	const calCells = $derived.by(() => {
		const offset = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // lundi = 0
		const count = new Date(calYear, calMonth + 1, 0).getDate();
		const cells: (number | null)[] = Array(offset).fill(null);
		for (let d = 1; d <= count; d++) cells.push(d);
		while (cells.length % 7 !== 0) cells.push(null);
		return cells;
	});
	function openDupSheet(plan = false) {
		planMode = plan;
		const d = new Date(date + 'T12:00:00');
		d.setDate(d.getDate() + 1);
		dupDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		dupErr = '';
		calMonth = d.getMonth();
		calYear = d.getFullYear();
		dupOpen = true;
	}
	function closeDupSheet() {
		dupOpen = false;
	}
	function shiftCalMonth(delta: number) {
		let m = calMonth + delta;
		let y = calYear;
		if (m < 0) {
			m = 11;
			y--;
		} else if (m > 11) {
			m = 0;
			y++;
		}
		calMonth = m;
		calYear = y;
	}
	function calDayISO(day: number): string {
		return `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}

	async function duplicateSelection() {
		// « Planifier » exige une date future ; « Dupliquer » accepte toute date.
		if (dupBusy || !/^\d{4}-\d{2}-\d{2}$/.test(dupDate)) return;
		if (planMode && !dupDateIsFuture) return;
		dupBusy = true;
		dupErr = '';
		try {
			const r = await fetch('/api/journal/duplicate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					entryIds: selEntryIds,
					plannedIds: selPlannedIds,
					targetDate: dupDate,
					clientDate: currentLocalDay(),
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			dupOpen = false;
			clearSel();
			if (dupDate === date) await refreshAfterPlanned();
		} catch (e) {
			dupErr = e instanceof Error ? e.message : String(e);
		} finally {
			dupBusy = false;
		}
	}

	/* ————— Créer un repas à partir de la sélection ————— */
	let mealCreateOpen = $state(false);
	let mealCreateName = $state('');
	let mealCreateBusy = $state(false);
	let mealCreateErr = $state('');

	function openMealCreateSheet() {
		mealCreateName = '';
		mealCreateErr = '';
		mealCreateOpen = true;
	}
	function closeMealCreateSheet() {
		mealCreateOpen = false;
	}

	/** Enregistre la sélection dans « Mes Repas » (identités OFF / Ciqual / custom préservées). */
	async function saveMealFromSelection() {
		if (mealCreateBusy) return;
		mealCreateBusy = true;
		mealCreateErr = '';
		try {
			const selected = allRows.filter((r) => selIds.has(r._id));
			const r = await fetch('/api/meals', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fromSelection: true,
					name: mealCreateName,
					ingredients: selected.map((row) => {
						const ciqual = 'ciqualLabel' in row ? row.ciqualLabel : undefined;
						const foodId = 'foodId' in row ? row.foodId : undefined;
						const customId = 'customFoodId' in row ? row.customFoodId : undefined;
						return {
							...(ciqual ? { ciqualLabel: ciqual } : foodId ? { foodId } : customId ? { customFoodId: customId } : {}),
							qtyGrams: row.qtyGrams,
							name: row.name,
							brand: row.brand,
							imageUrl: row.imageUrl,
							kcal: row.kcal,
							carbs: row.carbs,
							protein: row.protein,
							fat: row.fat,
						};
					}),
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			mealCreateOpen = false;
			clearSel();
			await loadMeals(); // « Mes Repas » rechargé : le repas est utilisable comme les autres
		} catch (e) {
			mealCreateErr = e instanceof Error ? e.message : String(e);
		} finally {
			mealCreateBusy = false;
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
				body: JSON.stringify({ plannedId: editPlanned._id, clientDate: currentLocalDay() }),
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

	/** Pourcentage réel consommé/objectif — jamais plafonné à 100 (l'anneau,
	 *  lui, reste plafonné visuellement). */
	function macroPct(eaten: number, goal: number) {
		return goal > 0 ? (eaten / goal) * 100 : 0;
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
		if (logOpen || qtyFood || editEntry || qtyMealSel || dupOpen || mealCreateOpen || macroDetail) return;
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
	/** Fiches de référence Ciqual (ANSES) du bloc « Aliments de référence » — toujours séparées des produits OFF. */
	let ciqualResults = $state<Food[]>([]);
	/** Pagination OFF (scroll infini) : reste-t-il des produits au-delà de la tranche affichée ? */
	let hasMore = $state(false);
	/** Décalage serveur de la prochaine tranche (≠ results.length : la 1ʳᵉ page peut contenir des aliments « Créés par moi » non paginés). */
	let nextOffset = $state(0);
	/** Garde-fou : une seule requête « page suivante » en vol à la fois. */
	let loadingMore = $state(false);
	/** Indication « Fais défiler pour voir plus » : visible seulement s'il
	 *  existe réellement des résultats plus bas, masquée dès le 1er scroll. */
	let showScrollHint = $state(false);
	let searching = $state(false);
	let searchError = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	/** Fiche Ciqual → Food (l'_id porté par les flux est le LIBELLÉ officiel exact ;
	 *  à l'ajout, le serveur résout les valeurs — jamais le client). */
	function ciqualToFood(h: { label: string; kcal: number; protein?: number; carbs?: number; fat?: number }): Food {
		return {
			_id: h.label,
			name: h.label,
			kcal100: h.kcal,
			carbs100: h.carbs ?? 0,
			protein100: h.protein ?? 0,
			fat100: h.fat ?? 0,
			ciqual: true,
		};
	}

	async function runSearch(q: string) {
		if (q.length < 2) {
			results = [];
			ciqualResults = [];
			hasMore = false;
			return;
		}
		searching = true;
		searchError = '';
		showScrollHint = false;
		// Nouvelle recherche : l'indication de scroll repart (elle ne se montrent
		// que s'il existe des résultats plus bas — decided par hasMore).
		// ⚠ Garde-fou contrat : le serveur renvoie { items, hasMore }. Un payload
		// inattendu (ex. ancien bundle + backend paginé pendant un déploiement,
		// ou réponse tronquée) est traité comme une ERREUR avec réessai —
		// jamais comme une liste vide silencieuse.
		const req = fetch(`/api/foods/search?q=${encodeURIComponent(q)}&v=${FRONTEND_API_VERSION}`, { signal: AbortSignal.timeout(15_000) })
			.then(async (r) => {
				const j = await r.json();
				if (j.error) throw new Error(j.error);
				if (!Array.isArray(j.items)) throw new Error('Recherche momentanément indisponible — réessaie dans un instant.');
				results = j.items as Food[];
				hasMore = !!(j as { hasMore?: boolean }).hasMore;
				nextOffset = 25;
				showScrollHint = hasMore; // il existe des résultats plus bas
			})
			.then(() => null, (e) => e as Error);
		const ciq = fetch(`/api/foods/ciqual?q=${encodeURIComponent(q)}`)
			.then(async (r) => {
				const j = await r.json();
				ciqualResults = j.error
					? []
					: (j as { label: string; kcal: number; protein?: number; carbs?: number; fat?: number }[]).map(ciqualToFood);
			})
			.then(() => null, () => 'ciqual' as const);
		const err = await req;
		await ciq;
		if (err) {
			searchError = err instanceof Error ? err.message : String(err);
			results = [];
			hasMore = false;
			nextOffset = 0;
		}
		searching = false;
	}

	/**
	 * Page suivante de produits OFF (scroll infini, +25 classés). Le bloc
	 * Ciqual n'y participe JAMAIS : fixe en tête, hors pagination. Appelé près
	 * du bas de liste par le sentinel `IntersectionObserver` du template.
	 */
	async function loadMore() {
		const q = searchQ.trim();
		if (loadingMore || !hasMore || q.length < 2) return;
		showScrollHint = false; // l'utilisateur a fait défiler : plus besoin de l'indication
		loadingMore = true;
		try {
			const r = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}&offset=${nextOffset}&limit=25`);
			const j = await r.json();
			if (!j.error) {
				const items = (j.items ?? []) as Food[];
				const seen = new Set(results.map((f) => f._id));
				results = [...results, ...items.filter((f) => !seen.has(f._id))];
				hasMore = !!(j as { hasMore?: boolean }).hasMore;
				nextOffset += 25;
			}
		} catch {
			// réseau indisponible : on réessayera au prochain déclenchement
		}
		loadingMore = false;
	}
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => runSearch(searchQ.trim()), 300);
	}

	/* ————— Scroll infini produits OFF (25 par 25) —————
	 * Un sentinel invisible en bas de liste : dès qu'il devient visible, on
	 * charge la tranche suivante. Observateur re-créé à chaque apparition du
	 * sentinel (nouvelle recherche = reset de pagination). Le bloc Ciqual est
	 * FIXE en tête : il ne fait jamais partie de la pagination.
	 * L'indication « Fais défiler » disparaît au PREMIER geste de scroll de
	 * la liste (pas seulement au chargement effectif). */
	let sentinelEl = $state<HTMLElement | undefined>();
	let mealSentinelEl = $state<HTMLElement | undefined>();
	/** Ancêtre scrollable d'un élément (le conteneur de liste). */
	function scrollParentOf(el: HTMLElement): HTMLElement | null {
		let cur: HTMLElement | null = el;
		while ((cur = cur.parentElement)) {
			const st = getComputedStyle(cur);
			if (st.overflowY === 'auto' || st.overflowY === 'scroll') return cur;
		}
		return null;
	}
	$effect(() => {
		if (!sentinelEl) return;
		const obs = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) void loadMore();
			},
			{ rootMargin: '300px 0px' }
		);
		obs.observe(sentinelEl);
		const list = scrollParentOf(sentinelEl);
		const hideHint = () => (showScrollHint = false);
		list?.addEventListener('scroll', hideHint, { passive: true, once: true });
		return () => {
			obs.disconnect();
			list?.removeEventListener('scroll', hideHint);
		};
	});
	$effect(() => {
		if (!mealSentinelEl) return;
		const obs = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) void loadMoreMeal();
			},
			{ rootMargin: '300px 0px' }
		);
		obs.observe(mealSentinelEl);
		const list = scrollParentOf(mealSentinelEl);
		const hideHint = () => (mealShowScrollHint = false);
		list?.addEventListener('scroll', hideHint, { passive: true, once: true });
		return () => {
			obs.disconnect();
			list?.removeEventListener('scroll', hideHint);
		};
	});

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
		hasMore = false;
		nextOffset = 0;
		showScrollHint = false;
		searchError = '';
		searchTab = 'produits';
		favOnly = false;
		mealEditor = false;
		customEditor = false;
		barcodeStatus = 'idle';
		barcodeError = '';
		barcodePermBlocked = false;
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
	/** Aliment en cours de modification (null = création d'un nouvel aliment). */
	let cfEditingId = $state<string | null>(null);
	let cfName = $state('');
	let cfBrand = $state('');
	let cfKcal = $state('');
	let cfCarbs = $state('');
	let cfProtein = $state('');
	let cfFat = $state('');
	let cfFiber = $state('');
	let cfSalt = $state('');
	let cfServing = $state('');
	let cfSaving = $state(false);
	let cfError = $state('');
	/** Champs signalés « à vérifier » (photo d'étiquette ambiguë). */
	let cfReview = $state<Set<string>>(new Set());
	/** Note IA (« kcal converties depuis kJ »…) affichée au-dessus du formulaire. */
	let cfAiNote = $state('');
	/** Code-barres en attente (scan ou photo) — sert d'info « candidat global ». */
	let pendingBarcode = $state<string | null>(null);

	/* ————— Bottom sheet « + Créer un aliment » (scan / étiquette / manuel) ————— */
	let createSheetOpen = $state(false);
	/** La feuille a été ouverte après un scan sans produit trouvé (contexte UX). */
	let createSheetFromScan = $state(false);
	/** Photo d'étiquette en cours d'analyse (spinner sur l'option). */
	let labelAnalyzing = $state(false);
	let labelError = $state('');
	let labelFileInput: HTMLInputElement | undefined;
	/**
	 * Étape code-barres AVANT enregistrement : 'hidden' (absente) | 'choose'
	 * (détecté sur la photo, à confirmer) | 'scan' | 'scan-found' | 'scan-absent'
	 * | 'exists' (déjà dans G-FLUX → proposer la fiche existante) | 'attached'.
	 */
	let bcStep = $state<'hidden' | 'choose' | 'scan' | 'scan-found' | 'scan-absent' | 'exists' | 'attached' | 'add'>('hidden');
	/** Code retenu pour la création : photo, scan, ou déjà rattaché. */
	let bcCode = $state<string | null>(null);
	/** Produit global/personnel EXISTANT trouvé pour ce code (anti-doublon). */
	let bcExisting = $state<ExistingBarcodeHit | null>(null);
	let bcBusy = $state(false);
	let bcError = $state('');
	/** Résolution code-barres : base commune ou fiche perso déjà créée. */
	type ExistingBarcodeHit = {
		source: 'global' | 'own';
		foodId?: string;
		customFoodId?: string;
		name: string;
		brand?: string;
		kcal100: number;
		carbs100: number;
		protein100: number;
		fat100: number;
		servingQty?: number;
		servingUnit?: string;
		kcalRecalculated?: boolean;
	};

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
		createSheetOpen = false;
		cfEditingId = null;
		pendingBarcode = null;
		bcStep = 'hidden';
		bcCode = null;
		bcExisting = null;
		cfName = '';
		cfBrand = '';
		cfKcal = '';
		cfCarbs = '';
		cfProtein = '';
		cfFat = '';
		cfFiber = '';
		cfSalt = '';
		cfServing = '';
		cfError = '';
	}
	/** Édition : pré-remplit le formulaire avec la fiche existante (sauvegarde → mise à jour). */
	function openCustomEditorFor(food: Food) {
		customEditor = true;
		cfEditingId = food._id;
		cfName = food.name;
		cfBrand = food.brand ?? '';
		cfKcal = String(food.kcal100);
		cfCarbs = String(food.carbs100);
		cfProtein = String(food.protein100);
		cfFat = String(food.fat100);
		cfFiber = food.fiber100 !== undefined ? String(food.fiber100) : '';
		cfSalt = food.salt100 !== undefined ? String(food.salt100) : '';
		cfServing = food.servingQty !== undefined ? String(food.servingQty) : '';
		cfError = '';
		/* Édition : aliment déjà rattaché → récap ; sans code → proposition
		   discrète « Ajouter un code-barres » (rattachement plus tard). */
		bcStep = food.barcode ? 'attached' : 'add';
		bcCode = food.barcode ?? null;
		bcExisting = null;
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
			/* Anti-doublon : avec un code-barres, on vérifie la base commune AVANT
			   de créer. Produit déjà connu → aucun doublon, aucun candidat : on
			   propose simplement la fiche existante. */
			let existing: ExistingBarcodeHit | null = null;
			const code = (bcCode ?? pendingBarcode ?? '').replace(/\D/g, '');
			if (!cfEditingId && code.length >= 8) {
				try {
					const rr = await fetch(`/api/foods/custom-barcode?barcode=${encodeURIComponent(code)}`);
					const jj = await rr.json();
					if (!jj.error) existing = jj as ExistingBarcodeHit | null;
				} catch {
					/* indisponible → on retombe sur la création standard */
				}
			}
			if (existing) {
				cfSaving = false;
				bcExisting = existing;
				bcCode = code;
				bcStep = 'exists';
				return;
			}
			/* Édition → PUT sur la fiche existante (pas de doublon, journal intact). */
			const r = await fetch(cfEditingId ? `/api/foods/custom?id=${cfEditingId}` : '/api/foods/custom', {
				method: cfEditingId ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: cfName,
					brand: cfBrand.trim() || undefined,
					kcal100: num(cfKcal),
					carbs100: num(cfCarbs) ?? 0,
					protein100: num(cfProtein) ?? 0,
					fat100: num(cfFat) ?? 0,
					fiber100: num(cfFiber),
					salt100: num(cfSalt),
					servingQty: num(cfServing),
					barcode: code || undefined,
					sourceKind: code ? 'label_photo' : undefined,
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			pendingBarcode = null;
			bcStep = 'hidden';
			bcCode = null;
			bcExisting = null;
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

	/* ————— Bottom sheet « + Créer un aliment » (scan / étiquette / manuel) ————— */
	function openCreateSheet() {
		labelError = '';
		createSheetFromScan = false;
		createSheetOpen = true;
	}
	function closeCreateSheet() {
		createSheetOpen = false;
		labelError = '';
	}
	/** Option « Scanner un code-barres » : bascule l'écran d'ajout en mode scan. */
	async function createFromScan() {
		createSheetOpen = false;
		searchTab = 'crees';
		await switchMode('barcode');
	}
	/** Option « Saisir manuellement » : formulaire existant (vierge). */
	function createManual() {
		pendingBarcode = null;
		bcStep = 'hidden';
		bcCode = null;
		bcExisting = null;
		cfAiNote = '';
		cfReview = new Set();
		openCustomEditor();
	}

	/**
	 * Option « Photographier une étiquette » : photo (captée ou galerie) →
	 * compression → détection barcode LOCALE (vrai décodeur) → analyse IA
	 * (serveur) → préremplissage du formulaire existant. L'IA ne crée JAMAIS
	 * l'aliment : la cliente vérifie puis valide.
	 */
	async function analyzeLabelFile(file: File) {
		labelAnalyzing = true;
		labelError = '';
		try {
			const imageDataUrl = await compressImage(file);
			// 1) Code-barres visible sur la photo ? Décodeur réel (jamais l'IA).
			const code = await detectBarcodeInDataUrl(imageDataUrl);
			// 2) Analyse Vision côté serveur (BFF → Convex → OpenAI).
			const r = await fetch('/api/foods/label-scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageDataUrl, barcode: code ?? undefined }),
			});
			const j = await r.json();
			if (!r.ok || j.ok === false) {
				throw new Error(
					['ai-unavailable', 'unreachable', 'timeout'].includes(String(j.reason))
						? "L'analyse IA est momentanément indisponible — saisis les valeurs à la main ou réessaie dans un instant."
						: String(j.reason ?? 'Analyse impossible.')
				);
			}
			const a = j.analysis as {
				name?: string; brand?: string; kcal100?: number; carbs100?: number;
				protein100?: number; fat100?: number; fiber100?: number; salt100?: number;
				servingQty?: number; kcalFromKj?: boolean; needsReview?: string[];
			};
			// 3) Préremplit le formulaire MANUEL existant (jamais de création directe).
			createSheetOpen = false;
			customEditor = true;
			cfEditingId = null;
			cfName = a.name ?? '';
			cfBrand = a.brand ?? '';
			cfKcal = a.kcal100 !== undefined ? String(a.kcal100) : '';
			cfCarbs = a.carbs100 !== undefined ? String(a.carbs100) : '';
			cfProtein = a.protein100 !== undefined ? String(a.protein100) : '';
			cfFat = a.fat100 !== undefined ? String(a.fat100) : '';
			cfFiber = a.fiber100 !== undefined ? String(a.fiber100) : '';
			cfSalt = a.salt100 !== undefined ? String(a.salt100) : '';			cfServing = a.servingQty !== undefined ? String(a.servingQty) : '';
			pendingBarcode = code ?? (j.barcode ? String(j.barcode) : null);
			// Étape code-barres AVANT validation : détecté sur la photo → à
			// confirmer ; sinon proposition discrète scanner / « Plus tard ».
			bcCode = pendingBarcode;
			bcStep = 'choose';
				const review = new Set<string>((a.needsReview ?? []).map((x) => (x === 'valeurs' ? 'kcal' : x)));
			if (!cfKcal) review.add('kcal');
			cfReview = review;
			cfAiNote = a.kcalFromKj
				? 'Étiquette en kJ : les calories ont été converties (×0,239). Vérifie la valeur.'
				: 'Valeurs lues sur ta photo — vérifie-les avant d\'enregistrer.';
			cfError = '';
		} catch (e) {
			labelError = e instanceof Error ? e.message : String(e);
		} finally {
			labelAnalyzing = false;
		}
	}

	/** « Produit inconnu » après un scan : rouvre la feuille en mode étiquette. */
	function openLabelCaptureAfterUnknownScan() {
		createSheetFromScan = true;
		labelError = '';
		createSheetOpen = true;
	}

	/* ————— Étape code-barres (post-analyse, avant enregistrement) ————— */
	/** Confirme le code lu sur la photo, ou lance le scan — facultatif. */
	function confirmBcCode() {
		if (bcCode) bcStep = 'attached';
	}
	/** Lance le scan DANS l'éditeur (le scanner est un singleton : stop d'abord). */
	async function startBcScan() {
		bcError = '';
		await stopScanner();
		logMode = 'search';
		bcStep = 'scan';
		await tick();
		void startScanner('editor-bc-reader', 'editor');
	}
	/** Code scanné dans l'éditeur : base commune connue → fiche existante ;
	 *  inconnu → rattaché à la fiche en cours (futur candidat global). */
	async function handleEditorScan(code: string) {
		bcBusy = true;
		bcError = '';
		try {
			const rr = await fetch(`/api/foods/custom-barcode?barcode=${encodeURIComponent(code)}`);
			const jj = await rr.json();
			if (jj.error) throw new Error(jj.error);
			if (jj) {
				bcExisting = jj as ExistingBarcodeHit;
				bcCode = code;
				bcStep = 'exists';
			} else {
				bcCode = code;
				bcStep = 'scan-found';
			}
	} catch (e) {
		bcError = e instanceof Error ? e.message : String(e);
		bcStep = cfEditingId ? 'add' : 'choose';
	} finally {
		bcBusy = false;
	}
	}
	/** « Plus tard » : le code reste facultatif — aliment privé, zéro candidat. */
	function skipBc() {
		bcStep = 'hidden';
		bcCode = null;
		bcExisting = null;
		pendingBarcode = null;
	}
	/** Utilise la fiche existante trouvée pour ce code (aucun doublon créé). */
	function useExistingBarcodeFood() {
		const hit = bcExisting;
		if (!hit) return;
		closeCustomEditor();
		bcStep = 'hidden';
		bcCode = null;
		bcExisting = null;
		pendingBarcode = null;
		const food: Food = {
			_id: hit.foodId ?? hit.customFoodId ?? '',
			name: hit.name,
			brand: hit.brand,
			kcal100: hit.kcal100,
			carbs100: hit.carbs100,
			protein100: hit.protein100,
			fat100: hit.fat100,
			servingQty: hit.servingQty,
			kcalRecalculated: hit.kcalRecalculated,
			custom: hit.source === 'own' ? true : undefined,
		};
		openQty(food);
	}
	/** Après « existe déjà » : en création on repart sans le code (aucun
	 *  doublon) ; en édition on garde le code scanné → rattachement privé (le
	 *  serveur ne crée jamais de candidat pour un code déjà connu). */
	function dismissExistingBarcodeFood() {
		bcExisting = null;
		if (cfEditingId) {
			bcStep = 'attached';
		} else {
			bcCode = null;
			bcStep = 'choose';
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
	/** Pagination OFF de la recherche ingrédient (scroll infini, +25). */
	let mealHasMore = $state(false);
	let mealNextOffset = $state(0);
	let mealLoadingMore = $state(false);
	/** Indication de scroll de la fenêtre produit (éditeur de repas). */
	let mealShowScrollHint = $state(false);
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
		mealItems = [];			mealSearchQ = '';
			mealResults = [];
			mealHasMore = false;
			mealNextOffset = 0;
			mealShowScrollHint = false;
			mealCiqualResults = [];
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
				_id: ing.foodId ?? ing.customFoodId ?? ing.ciqualLabel ?? ing.name,
				name: ing.name,
				brand: ing.brand,
				imageUrl: ing.imageUrl,
				kcal100: ing.qtyGrams > 0 ? (ing.kcal / ing.qtyGrams) * 100 : 0,
				carbs100: ing.qtyGrams > 0 ? (ing.carbs / ing.qtyGrams) * 100 : 0,
				protein100: ing.qtyGrams > 0 ? (ing.protein / ing.qtyGrams) * 100 : 0,
				fat100: ing.qtyGrams > 0 ? (ing.fat / ing.qtyGrams) * 100 : 0,
				custom: !!ing.customFoodId,
				ciqual: !!ing.ciqualLabel,
			},
			qty: ing.qtyGrams,
			custom: !!ing.customFoodId,
			customFoodId: ing.customFoodId,
			ciqualLabel: ing.ciqualLabel,
		}));			mealSearchQ = '';
			mealResults = [];
			mealHasMore = false;
			mealNextOffset = 0;
			mealShowScrollHint = false;
			mealCiqualResults = [];
			mealError = '';
		}
	function closeMealEditor() {
		void closeMealSearch(); // fenêtre produit refermée + scanner éventuellement arrêté
		mealEditor = false;
		mealEditingId = null;
	}	let mealSearchError = $state('');
	/** Fiches Ciqual (ANSES) du bloc « Aliments de référence » — séparées des produits OFF. */
	let mealCiqualResults = $state<Food[]>([]);	async function runMealSearch(q: string) {
		if (q.length < 2) {
			mealResults = [];
			mealCiqualResults = [];
			mealHasMore = false;
			mealNextOffset = 0;
			mealShowScrollHint = false;
			return;
		}
		mealSearching = true;
		mealSearchError = '';
		// Même séparation stricte que la recherche principale : Ciqual en tête,
		// produits OFF ensuite ; échec Ciqual silencieux.
		// ⚠ Garde-fou contrat identique à la recherche principale (voir runSearch).
		const req = fetch(`/api/foods/search?q=${encodeURIComponent(q)}&v=${FRONTEND_API_VERSION}`, { signal: AbortSignal.timeout(15_000) })
				.then(async (r) => {
					const j = await r.json();
					if (j.error) throw new Error(j.error);
					if (!Array.isArray(j.items)) throw new Error('Recherche momentanément indisponible — réessaie dans un instant.');
					mealResults = j.items as Food[];
					mealHasMore = !!(j as { hasMore?: boolean }).hasMore;
					mealNextOffset = 25;
					mealShowScrollHint = mealHasMore;
				})
				.then(() => null, (e) => e as Error);
		const ciq = fetch(`/api/foods/ciqual?q=${encodeURIComponent(q)}`)
			.then(async (r) => {
				const j = await r.json();
				mealCiqualResults = j.error ? [] : (j as { label: string; kcal: number; protein?: number; carbs?: number; fat?: number }[]).map(ciqualToFood);
			})
			.then(() => null, () => 'ciqual' as const);
		const err = await req;
		await ciq;
		if (err) {
			mealSearchError = err instanceof Error ? err.message : String(err);
			mealResults = [];
			mealHasMore = false;
			mealNextOffset = 0;
			mealShowScrollHint = false;
		}
		mealSearching = false;
	}

	/** Page suivante de produits OFF dans la recherche ingrédient (+25). */
	async function loadMoreMeal() {
		const q = mealSearchQ.trim();
		if (mealLoadingMore || !mealHasMore || q.length < 2) return;
		mealShowScrollHint = false; // l'utilisateur a fait défiler
		mealLoadingMore = true;
		try {
			const r = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}&offset=${mealNextOffset}&limit=25`);
			const j = await r.json();
			if (!j.error) {
				const items = (j.items ?? []) as Food[];
				const seen = new Set(mealResults.map((f) => f._id));
				mealResults = [...mealResults, ...items.filter((f) => !seen.has(f._id))];
				mealHasMore = !!(j as { hasMore?: boolean }).hasMore;
				mealNextOffset += 25;
			}
		} catch {
			// réseau indisponible : on réessayera au prochain déclenchement
		}
		mealLoadingMore = false;
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
	/** Clic fiche Ciqual dans la recherche : exactement le même parcours que
	 *  pour un produit OFF — fenêtre refermée, même feuille de quantité. */
	function openCiqualIngredientPortion(hitIdx: number) {
		const food = mealCiqualResults[hitIdx];
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
				{
					food: mealPickedFood,
					qty: qtyGrams,
					custom: mealPickedFood.custom,
					customFoodId: mealPickedFood.custom ? mealPickedFood._id : undefined,
					ciqualLabel: mealPickedFood.ciqual ? mealPickedFood._id : undefined,
				},
			];
			mealSearchQ = '';
			mealResults = [];
			mealHasMore = false;
			mealNextOffset = 0;
			mealShowScrollHint = false;
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
		// Préchauffage du miroir des ingrédients (fire-and-forget, jamais bloquant).
		warmFoodImages(mealItems.map((it) => it.food));
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
					...(it.ciqualLabel
						? { ciqualLabel: it.ciqualLabel } // fiche de référence Ciqual (ANSES)
						: it.custom
							? { customFoodId: it.food._id }
							: { foodId: it.food._id }),
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
		// Préchauffage du miroir (fire-and-forget) : la sélection d'un produit
		// encore sans copie G-FLUX lance la mise en cache de sa miniature —
		// l'ouverture de la feuille ne attend JAMAIS cette requête.
		warmFoodImages([food]);
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
				...(qtyFood.ciqual
					? { ciqualLabel: qtyFood._id } // fiche de référence : libellé officiel, valeurs résolues par le serveur
					: qtyFood.custom
						? { customFoodId: qtyFood._id }
						: { foodId: qtyFood._id }),
				qtyGrams,
				/** Date locale du navigateur — frontière « futur » fiable la nuit
				 *  (00 h 41 à Paris = veille côté serveur UTC). */
				clientDate: currentLocalDay(),
			}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			qtyFood = null;
			logOpen = false;
			searchQ = '';
			results = [];
			hasMore = false;
			nextOffset = 0;
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
	let barcodeStatus = $state<'idle' | 'scanning' | 'notfound' | 'error' | 'perm'>('idle');
	let barcodeManual = $state('');
	let barcodeBusy = $state(false);
	let barcodeError = $state('');
	/* Caméra refusée/bloquée : message dédié + « Réessayer » (voir startScanner). */
	let barcodePermBlocked = $state(false);
	let scanner: (BarcodeScannerHandle & TorchHandle) | null = null;
	let scannerBusy = false;
	/** Capacités caméra du scan en cours (lampe/zoom si supportés) — affiche
	 *  les contrôles sous le lecteur, best effort selon l'appareil. */
	let scannerCaps = $state<{ torch: boolean; zoom: boolean; zoomMin: number; zoomMax: number; zoomStep: number } | null>(null);
	let torchOn = $state(false);
	let zoomLevel = $state(1);

	/** Lampe torche (best effort : false sur les appareils sans torch). */
	async function toggleScannerTorch() {
		if (!scanner) return;
		const ok = await scanner.toggleTorch();
		if (ok) torchOn = !torchOn;
	}
	/** Zoom optique/numérique de la caméra (slider, best effort). */
	function applyScannerZoom() {
		void scanner?.zoom(zoomLevel);
	}

	/** Démarre le scanner sur le lecteur demandé : « bc-reader » (écran « Ajouter
	 *  un aliment ») ou « meal-bc-reader » (fenêtre produit de l'éditeur de
	 *  repas). Le résultat est routé vers la feuille correspondante. */
	async function startScanner(elId: string = 'bc-reader', target: 'journal' | 'meal' | 'editor' = 'journal') {
		if (scanner || scannerBusy || typeof document === 'undefined') return;
		const el = document.getElementById(elId);
		if (!el) return;
		scannerBusy = true;
		barcodeStatus = 'scanning';
		try {
		scanner = await startBarcodeScanner(el, (decoded) => {
			void handleScan(decoded, target);
		});
		scannerCaps = {
			torch: scanner.hasTorch(),
			zoom: scanner.hasZoom(),
			zoomMin: scanner.zoomRange?.min ?? 1,
			zoomMax: scanner.zoomRange?.max ?? 1,
			zoomStep: scanner.zoomRange?.step ?? 0.1,
		};
		torchOn = false;
		zoomLevel = scanner.zoomRange?.min ?? 1;
		} catch (e) {
			if (e instanceof CameraPermissionError) {
				/* Refus/blocage caméra : message clair + « Réessayer » + comment
				   réautoriser. La saisie manuelle reste utilisable en dessous. */
				barcodeStatus = 'perm';
				barcodePermBlocked = true;
			} else {
				barcodeStatus = 'error';
			}
			barcodeError = e instanceof Error ? e.message : 'Caméra indisponible — saisis le code-barres à la main ci-dessous.';
			if (target === 'editor') bcError = barcodeError;
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
		scannerCaps = null;
		torchOn = false;
	}
	/** « Réessayer » après un refus/blocage caméra : relance le scan sur le bon
	 *  lecteur (fenêtre produit si elle est ouverte, sinon « Ajouter un aliment »). */
	function retryScanner() {
		barcodeStatus = 'idle';
		barcodeError = '';
		barcodePermBlocked = false;
		if (mealSearchOpen) void startScanner('meal-bc-reader', 'meal');
		else void startScanner();
	}
	async function switchMode(m: 'search' | 'barcode') {
		if (m === logMode) return;
		if (m === 'barcode') {
			logMode = 'barcode';
			barcodeStatus = 'idle';
			barcodeError = '';
			barcodePermBlocked = false;
			barcodeManual = '';
			await tick();
			void startScanner();
		} else {
			await stopScanner();
			logMode = 'search';
		}
	}
	async function handleScan(decoded: string, target: 'journal' | 'meal' | 'editor' = 'journal') {
		if (scannerBusy || barcodeBusy) return;
		const code = decoded.replace(/\D/g, '');
		if (code.length < 8) return;
		if (target === 'editor') {
			// Scan lancé DEPUIS l'étape code-barres de l'éditeur d'aliment.
			await handleEditorScan(code);
			return;
		}
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
			} else if (target === 'meal') {
				barcodeStatus = 'notfound';
				barcodeError = `Aucun produit trouvé pour le code ${code}. Cherche-le par nom, ou vérifie le code.`;				} else if (aiFlags.foodLabelAi) {
					// Produit inconnu : on propose « Photographier l'étiquette » —
					// le code reste attaché au futur aliment (candidat global).
					await stopScanner();
					barcodeStatus = 'idle';
					pendingBarcode = code;
					openLabelCaptureAfterUnknownScan();
				} else {
					// Hors bêta : comportement historique (message + recherche par nom).
					barcodeStatus = 'notfound';
					barcodeError = `Aucun produit trouvé pour le code ${code}. Cherche-le par nom, ou crée-le dans « Créés par moi ».`;
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
			barcodePermBlocked = false;
			barcodeManual = '';
			await tick();
			void startScanner('meal-bc-reader', 'meal');
		} else {
			await stopScanner();
			mealSearchMode = 'search';
		}
	}

	/* ————— Photographier mon REPAS (IA → base G-FLUX → fiche visuelle) ————— */
	type AnalyzedComponent = {
		label: string;
		qtyGrams: number;
		/** "custom" · "off_imported" · "ciqual" · "ai" (estimation à valider). */
		matchSource: 'custom' | 'off_imported' | 'ciqual' | 'ai';
		foodId?: string;
		customFoodId?: string;
		ciqualLabel?: string;
		name: string;
		brand?: string;
		kcal100?: number;
		carbs100?: number;
		protein100?: number;
		fat100?: number;
		aiKcal100?: number;
		aiCarbs100?: number;
		aiProtein100?: number;
		aiFat100?: number;
		aiNote?: string;
		score?: number;
	};
	let mealPhotoOpen = $state(false);
	let mealAnalyzing = $state(false);
	let mealAnalyzed = $state<AnalyzedComponent[] | null>(null);
	let mealAnalyzedHint = $state('');
	let mealAnalyzedMeal = $state<'petit-dej' | 'dejeuner' | 'diner' | 'collation'>('dejeuner');
	let mealPhotoError = $state('');
	let mealCommitting = $state(false);
	/** Ajout d'un ingrédient oublié (huile, sauce…) : recherche dans Convex. */
	let mealAddSearchOpen = $state(false);
	let mealAddQuery = $state('');
	let mealAddResults = $state<Food[]>([]);
	let mealAddSearching = $state(false);
	let mealAddTimer: ReturnType<typeof setTimeout> | undefined;
	/** Quantité : composant en cours d'édition dans la fiche analysée. */
	let mealQtyEditIdx = $state<number | null>(null);
	let mealQtyDraft = $state('');
	let mealReplaceIdx = $state<number | null>(null);
	let mealPhotoFileInput: HTMLInputElement | undefined;

	/** Bêta IA — flags résolus CÔTÉ SERVEUR (allowlist email, pas le nom affiché).
	 *  false → aucun bouton IA, aucun badge, aucun flux : l'existant intact. */
	const aiFlags = $derived(data.aiFlags ?? { foodLabelAi: false, mealPhotoAi: false });

	function openMealPhoto(meal: 'petit-dej' | 'dejeuner' | 'diner' | 'collation' = 'dejeuner') {
		mealAnalyzedMeal = meal;
		mealAnalyzed = null;
		mealAnalyzedHint = '';
		mealPhotoError = '';
		mealQtyEditIdx = null;
		mealAddSearchOpen = false;
		mealPhotoOpen = true;
	}
	function closeMealPhoto() {
		mealPhotoOpen = false;
	}

	/** Analyse de la photo : OpenAI reconnaît les aliments + quantités, la
	 *  base G-FLUX (Convex → Ciqual) fournit la nutrition. Sans IA : rien ne
	 *  se casse — l'ajout manuel au Journal reste disponible. */
	async function analyzeMealPhoto(file: File) {
		mealAnalyzing = true;
		mealPhotoError = '';
		try {
			const imageDataUrl = await compressImage(file, 1280, 0.8);
			const r = await fetch('/api/meals/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ imageDataUrl }),
			});
			const j = await r.json();
			if (!r.ok || j.ok === false) {
				throw new Error(
					['ai-unavailable', 'unreachable', 'timeout'].includes(String(j.reason))
						? "L'analyse IA est momentanément indisponible — ajoute tes aliments par la recherche en attendant."
						: String(j.reason ?? 'Analyse impossible.')
				);
			}
			mealAnalyzed = (j.components ?? []) as AnalyzedComponent[];
			mealAnalyzedHint = j.hint ?? '';
			if (mealAnalyzed.length === 0) {
				mealPhotoError = "Aucun aliment identifié sur la photo — réessaie avec un cadrage d'ensemble, ou ajoute les aliments à la main.";
			}
		} catch (e) {
			mealPhotoError = e instanceof Error ? e.message : String(e);
		} finally {
			mealAnalyzing = false;
		}
	}

	/** Valeurs /100 g effectives d'un composant (match en priorité, estimation IA en repli). */
	function compPer100(c: AnalyzedComponent) {
		const fromMatch = c.matchSource !== 'ai';
		return {
			kcal: fromMatch ? c.kcal100 ?? 0 : c.aiKcal100 ?? 0,
			carbs: fromMatch ? c.carbs100 ?? 0 : c.aiCarbs100 ?? 0,
			protein: fromMatch ? c.protein100 ?? 0 : c.aiProtein100 ?? 0,
			fat: fromMatch ? c.fat100 ?? 0 : c.aiFat100 ?? 0,
		};
	}

	const analyzedTotals = $derived.by(() => {
		const t = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
		for (const c of mealAnalyzed ?? []) {
			const p = compPer100(c);
			const k = c.qtyGrams / 100;
			t.kcal += p.kcal * k;
			t.carbs += p.carbs * k;
			t.protein += p.protein * k;
			t.fat += p.fat * k;
		}
		return {
			kcal: Math.round(t.kcal),
			carbs: Math.round(t.carbs * 10) / 10,
			protein: Math.round(t.protein * 10) / 10,
			fat: Math.round(t.fat * 10) / 10,
		};
	});

	/** Modification de quantité — recalcul instantané (dérivé, côté client). */
	function openComponentQty(i: number) {
		const c = mealAnalyzed?.[i];
		if (!c) return;
		mealQtyEditIdx = i;
		mealQtyDraft = String(Math.round(c.qtyGrams));
	}
	function applyComponentQty() {
		if (mealQtyEditIdx === null || !mealAnalyzed) return;
		const v = Math.round(parseFloat(mealQtyDraft.replace(',', '.')));
		if (isFinite(v) && v > 0 && v <= 2000) {
			const next = mealAnalyzed.slice();
			next[mealQtyEditIdx] = { ...next[mealQtyEditIdx], qtyGrams: v };
			mealAnalyzed = next;
		}
		mealQtyEditIdx = null;
	}
	function removeComponent(i: number) {
		if (!mealAnalyzed) return;
		mealAnalyzed = mealAnalyzed.filter((_, idx) => idx !== i);
	}
	/** Remplacer un composant : rouvre la recherche d'ingrédient sur CETTE ligne. */
	function replaceComponent(i: number) {
		mealReplaceIdx = i;
		mealAddQuery = '';
		mealAddResults = [];
		mealAddSearchOpen = true;
	}
	/** Ajouter un ingrédient oublié (huile, sauce, fromage…) : même recherche. */
	function openAddIngredient() {
		mealReplaceIdx = null;
		mealAddQuery = '';
		mealAddResults = [];
		mealAddSearchOpen = true;
	}
	function onMealAddInput() {
		clearTimeout(mealAddTimer);
		mealAddTimer = setTimeout(() => runMealAddSearch(mealAddQuery.trim()), 300);
	}
	async function runMealAddSearch(q: string) {
		if (q.length < 2) {
			mealAddResults = [];
			return;
		}
		mealAddSearching = true;
		try {
			const [prodR, ciqR] = await Promise.all([
				fetch(`/api/foods/search?q=${encodeURIComponent(q)}&v=${FRONTEND_API_VERSION}`),
				fetch(`/api/foods/ciqual?q=${encodeURIComponent(q)}`),
			]);
			const prod = await prodR.json();
			const ciq = ciqR.ok ? await ciqR.json() : [];
			const ciqFoods: Food[] = (Array.isArray(ciq) ? ciq : []).map(ciqualToFood);
			const prods: Food[] = Array.isArray(prod?.items) ? prod.items : [];
			// La CIQUAL d'abord (génériques), puis les produits (déjà en base).
			mealAddResults = [...ciqFoods, ...prods].slice(0, 15);
		} catch {
			mealAddResults = [];
		} finally {
			mealAddSearching = false;
		}
	}
	/** Sélection d'un aliment (ajout ou remplacement) — quantité par défaut 10 g
	 *  pour les matières grasses, 100 g sinon. */
	function pickMealAdd(food: Food) {
		if (!mealAnalyzed) return;
		const oily = /huile|beurre|mayonn|crème|creme|sauce|vinaigrette|pesto|fromage|lard|saindoux/i.test(food.name);
		const per100 = { kcal100: food.kcal100, carbs100: food.carbs100, protein100: food.protein100, fat100: food.fat100 };
		const comp: AnalyzedComponent = {
			label: food.name,
			qtyGrams: oily ? 10 : 100,
			matchSource: food.ciqual ? 'ciqual' : food.custom ? 'custom' : 'off_imported',
			foodId: food.custom || food.ciqual ? undefined : food._id,
			customFoodId: food.custom ? food._id : undefined,
			ciqualLabel: food.ciqual ? food._id : undefined,
			name: food.name,
			brand: food.brand,
			...per100,
		};
		const next = mealAnalyzed.slice();
		if (mealReplaceIdx !== null && mealReplaceIdx < next.length) next[mealReplaceIdx] = comp;
		else next.push(comp);
		mealAnalyzed = next;
		mealAddSearchOpen = false;
		mealReplaceIdx = null;
	}

	/** « Ajouter au Journal » : les N composants en UNE requête — les règles
	 *  du Journal (snapshots serveur, planned si futur) sont appliquées telles
	 *  quelles par la mutation. Aucun aliment n'est créé, aucune pollution de
	 *  « Créés par moi » ni de la base globale. */
	async function commitAnalyzedMeal() {
		if (!mealAnalyzed || mealAnalyzed.length === 0 || mealCommitting) return;
		mealCommitting = true;
		mealPhotoError = '';
		try {
			const r = await fetch('/api/meals/commit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					date,
					meal: mealAnalyzedMeal,
					clientDate: currentLocalDay(),
					components: mealAnalyzed.map((c) => ({
						foodId: c.foodId,
						customFoodId: c.customFoodId,
						ciqualLabel: c.ciqualLabel,
						name: c.name,
						qtyGrams: c.qtyGrams,
						aiKcal100: c.matchSource === 'ai' ? c.aiKcal100 : undefined,
						aiCarbs100: c.matchSource === 'ai' ? c.aiCarbs100 : undefined,
						aiProtein100: c.matchSource === 'ai' ? c.aiProtein100 : undefined,
						aiFat100: c.matchSource === 'ai' ? c.aiFat100 : undefined,
					})),
				}),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			mealPhotoOpen = false;
			await setDate(date);
		} catch (e) {
			mealPhotoError = e instanceof Error ? e.message : String(e);
		} finally {
			mealCommitting = false;
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
				body: JSON.stringify({ unEat: true, clientDate: currentLocalDay() }),
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
	/** Refresh local (non destructif) : re-fetch du jour affiché — ne change ni la date, ni les saisies.
	 *  Mise à jour d'app disponible (SW en attente ou backend incompatible) → force la DERNIÈRE version
	 *  (même mécanique que le bandeau « nouvelle version ») au lieu d'un simple re-fetch. */
	let refreshingDay = $state(false);
	async function refreshDay() {
		if (refreshingDay) return;
		if (needsAppUpdate()) {
			refreshingDay = true;
			await forceAppUpdate(); // termine par location.reload()
			return;
		}
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
	/** Décalage vertical du visualViewport (clavier iOS : l'overlay reste dans la zone visible). */
	let vvTop = $state(0);
	let mobile = $state(typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : true);
	let refreshing = $state(false);

	/* Listes scrollables de l'écran « Ajouter un aliment » (recherche + code-barres)
	   et de la fenêtre produit de l'éditeur de repas (mêmes deux modes).
	   $state : l'$effect de fermeture du clavier doit se rattacher à chaque montage. */
	/** Formulaire « Créer / modifier un aliment » (scroll-to-focus clavier mobile). */
	let customFormEl = $state<HTMLElement | undefined>();
	let logListEl = $state<HTMLElement | undefined>();
	let bcListEl = $state<HTMLElement | undefined>();
	let mealSearchListEl = $state<HTMLElement | undefined>();
	let mealBcListEl = $state<HTMLElement | undefined>();

	/* Clavier iOS : un vrai scroll vertical de la liste ferme le clavier (blur),
	   sans vider la recherche ni perdre les résultats ; le geste continue.
	   Seuil : ignore les micro-mouvements et les taps sur un produit. */
	function attachScrollDismiss(el: HTMLElement) {
		/* On ne ferme le clavier QUE sur un geste doigt (touchstart → momentum
		   ≤ 1 s). Le défilement automatique qu'iOS applique au conteneur pour
		   révéler le champ focalisé ne doit PAS fermer le clavier. */
		let touchActive = false;
		let lastTouchEnd = 0;
		const onTouchStart = () => (touchActive = true);
		const onTouchEnd = () => {
			touchActive = false;
			lastTouchEnd = performance.now();
		};
		const onScroll = () => {
			if (el.scrollTop < 8) return;
			const recentGesture = touchActive || performance.now() - lastTouchEnd < 1000;
			if (!recentGesture) return;
			const active = document.activeElement;
			if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		el.addEventListener('touchstart', onTouchStart, { passive: true });
		el.addEventListener('touchend', onTouchEnd, { passive: true });
		el.addEventListener('touchcancel', onTouchEnd, { passive: true });
		return () => {
			el.removeEventListener('scroll', onScroll);
			el.removeEventListener('touchstart', onTouchStart);
			el.removeEventListener('touchend', onTouchEnd);
			el.removeEventListener('touchcancel', onTouchEnd);
		};
	}
	$effect(() => {
		const els = [logListEl, bcListEl, mealSearchListEl, mealBcListEl].filter((e): e is HTMLElement => !!e);
		if (els.length === 0) return;
		const cleanups = els.map(attachScrollDismiss);
		return () => cleanups.forEach((c) => c());
	});

	/* Clavier mobile : le champ qui reçoit le focus doit rester visible au-dessus
	   du clavier. Les overlays suivent déjà le visualViewport (top/height) ; on
	   scrolle ensuite le conteneur scrollable pour amener le champ dans la zone
	   utile — au-dessus de la capsule flottante « Recherche / Code-barres » et
	   du clavier. Sans ça, iOS garde le champ sous le clavier sur les champs du bas. */
	function scrollFocusedIntoView(el: HTMLElement) {
		const vv = window.visualViewport;
		const overlayTop = mobile ? (vv?.offsetTop ?? 0) : 0;
		const visibleH = mobile ? Math.round(vv?.height ?? window.innerHeight) : window.innerHeight;
		/* Marge basse : capsule flottante (~56 px) + sécurité clavier (iOS ancre
		   la saisie ~40 px au-dessus de son bord) + aire de respiration. */
		const bottomMargin = 56 + 40 + 12;
		const r = el.getBoundingClientRect();
		const targetBottom = overlayTop + visibleH - bottomMargin;
		const targetTop = overlayTop + 8;
		/* Cherche le conteneur scrollable (la liste de l'écran « Ajouter »). */
		let scroller: HTMLElement | null = el.parentElement;
		while (scroller && getComputedStyle(scroller).overflowY !== 'auto' && getComputedStyle(scroller).overflowY !== 'scroll') {
			scroller = scroller.parentElement;
		}
		if (!scroller) return;
		const delta = r.bottom - targetBottom;
		if (delta > 0) scroller.scrollTop += delta;
		else if (r.top < targetTop) scroller.scrollTop += r.top - targetTop;
	}
	/** Champ focalisé de l'éditeur « Créés par moi » : re-positionné quand le
	    clavier s'ouvre (le visualViewport change APRÈS le focus). */
	let focusedFieldEl: HTMLElement | null = null;
	function focusScroll(form: HTMLElement, target: EventTarget | null) {
		if (target instanceof HTMLElement && target !== form) {
			focusedFieldEl = target;
			scrollFocusedIntoView(target);
		}
	}
	function blurScroll(e: Event) {
		if (e.target === focusedFieldEl) focusedFieldEl = null;
	}

	/* Recherche ingrédient ouverte : pré-remplit le champ et lance la recherche
	   initiale, puis focalise le champ (clavier immédiat, comme « Ajouter un aliment »). */
	$effect(() => {
		if (!mealSearchOpen) return;
		mealSearchMode = 'search';
		mealSearchQ = '';
		mealResults = [];
		mealHasMore = false;
		mealSearching = false;
		barcodeStatus = 'idle';
		barcodeError = '';
		barcodePermBlocked = false;
		barcodeManual = '';
		const el = document.getElementById('meal-picker-input');
		el?.focus();
	});

	onMount(() => {
		document.addEventListener('keydown', (e) => {
			if (logOpen || qtyFood || editEntry || qtyMealSel || macroDetail) return;
			if (e.key === 'ArrowLeft') shiftDay(-1);
			if (e.key === 'ArrowRight') shiftDay(1);
		});

		/* Clavier mobile : la hauteur de l'écran Ajouter suit le visualViewport. */
		const vv = window.visualViewport;
		let prevVvH = Math.round((vv?.height ?? window.innerHeight) ?? 0);
		const setVh = () => {
			vvH = Math.round((vv?.height ?? window.innerHeight) ?? 0);
			vvTop = vv?.offsetTop ?? 0;
			const opened = vvH < prevVvH - 4;
			prevVvH = vvH;
			/* Le clavier vient de s'ouvrir / se déplacer : replace le champ focalisé
			   dans la zone visible (le scroll fait au focusin ne suffisait pas,
			   la hauteur visible n'était pas encore réduite). Clavier qui se ferme :
			   on arrête de suivre le champ (pas de scroll parasite au retour). */
			if (!opened) focusedFieldEl = null;
			else if (focusedFieldEl?.isConnected) scrollFocusedIntoView(focusedFieldEl);
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

		/* Mécanisme central de propagation : un plan de repas assigné par le
		   coach revalide le jour affiché — les propositions du plan apparaissent
		   sans aucune action de la cliente (polling /api/live → gflux:live-event). */
		const onLiveEvent = (e: Event) => {
			if ((e as CustomEvent<{ kind?: string }>).detail?.kind === 'plan_assigned') onRefresh();
		};
		document.addEventListener('gflux:live-event', onLiveEvent);

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
			document.removeEventListener('gflux:live-event', onLiveEvent);
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
		const locked = logOpen || !!qtyFood || !!editEntry || !!qtyMealSel || calOpen || dupOpen || mealCreateOpen;
		document.body.style.overflow = locked ? 'hidden' : '';
	});
</script>

<svelte:head><title>Journal — G-Flux</title></svelte:head>

<svelte:window ontouchstart={onTouchStart} ontouchend={onTouchEnd} onkeydown={(e) => { if (macroDetail && !logOpen && !qtyFood && !editEntry && !qtyMealSel && !dupOpen && !mealCreateOpen && e.key === 'Escape') closeMacroDetail(); }} />
	<!-- VUE PLEIN ÉCRAN : le gradient appartient au VIEWPORT (pas au container).
	     Halo menthe très pâle, diffus, très large — jamais une bande verte. -->
	<div
		aria-hidden="true"
		class="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(120%_55%_at_50%_0%,#ddefe4_0%,#e7f2ea_38%,rgba(244,246,244,0)_78%)]"
	></div>
	{#if macroDetail}
		<!-- ═══════ VUE DÉTAIL MACRO (clic carte Glucides / Protéines / Lipides) ═══════
		     Principe fonctionnel FOOD, rendu 100 % G-FLUX : mêmes couleurs et
		     icônes que le Journal, résumé + cercle + restant en haut, aliments
		     regroupés par repas. Données = entrées déjà enregistrées du jour. -->
		<div class="relative z-10 mx-auto w-full px-4 pb-32 pt-[max(env(safe-area-inset-top),14px)] sm:px-8 md:max-w-3xl md:pt-6">
			<!-- En-tête : retour au Journal du même jour + titre -->
			<header class="mb-3 flex items-center justify-between gap-2">
				<button
					type="button"
					class="grid h-11 w-11 place-items-center rounded-full text-mist transition hover:bg-line/40 hover:text-ink active:scale-95"
					aria-label="Retour au Journal"
					title="Retour au Journal"
					onclick={closeMacroDetail}
				><Icon name="chevronLeft" size={20} /></button>
				<h1 class="font-display text-[15px] font-semibold text-ink">Détail {macroMeta.label}</h1>
				<span class="w-11" aria-hidden="true"></span>
			</header>

			<!-- Résumé : cercle de progression + restant + consommé (couleur de la macro) -->
			<section class="rounded-2xl border border-line bg-card px-3 py-3">
				<div class="flex items-center gap-4">
					<div class="relative h-[96px] w-[96px] shrink-0">
						<svg viewBox="0 0 64 64" class="h-[96px] w-[96px] -rotate-90">
							<circle cx="32" cy="32" r="22" fill="none" stroke="#eef0ec" stroke-width="6" />
							<circle
								cx="32"
								cy="32"
								r="22"
								fill="none"
								stroke={macroMeta.color}
								stroke-width="6"
								stroke-linecap="round"
								stroke-dasharray={macroCirc}
								stroke-dashoffset={macroCirc * (1 - macroDetailPct / 100)}
								style="transition: stroke-dashoffset .5s"
							/>
						</svg>
						<span class="absolute inset-0 grid place-items-center font-bold leading-none tabular-nums" style:color={macroMeta.color}>
							<!-- Chiffre + % sur la MÊME baseline, groupés en un seul item
							     centré : sinon place-items-center empile les deux spans
							     sur deux lignes (chiffre au-dessus, % en dessous). -->
							<span class="flex items-baseline">
								<span class="text-[17px]">{Math.round(macroDetailPct)}</span><span class="text-[10px]">%</span>
							</span>
						</span>
					</div>
					<div class="min-w-0 flex-1">
						<p class="flex items-baseline gap-1.5">
							<span class="text-3xl font-bold leading-none tabular-nums text-ink">{fmtG(Math.max(0, macroGoal - macroEaten))}</span>
							<span class="text-[13px] font-semibold text-mist">g restants</span>
						</p>
						<p class="mt-1.5 text-[13px] font-semibold tabular-nums" style:color={macroMeta.color}>{fmtG(macroEaten)}/{fmtG(macroGoal)} g consommés</p>
					</div>
					<Icon name={macroMeta.icon} size={26} class="shrink-0" style="color:{macroMeta.color}" />
				</div>
			</section>

			<!-- Sélecteur Glucides / Protéines / Lipides -->
			<div class="mt-3 flex items-center gap-1 rounded-full bg-line/50 p-1 text-xs font-bold">
				{#each MACRO_LIST as m (m.key)}
					<button
						type="button"
						class="flex-1 rounded-full px-3 py-1.5 transition {macroDetail === m.key ? 'text-white shadow-sm' : 'text-mist hover:text-ink'}"
						style:background={macroDetail === m.key ? m.color : undefined}
						onclick={() => openMacroDetail(m.key)}
					>{m.label}</button>
				{/each}
			</div>

			<!-- Aliments regroupés par repas — uniquement les repas réellement consommés -->
			{#each macroMealGroups as group (group.id)}
				<section class="mt-4">
					<div class="flex items-baseline justify-between gap-2 px-1">
						<h2 class="text-[18px] font-bold tracking-tight text-ink">{group.label}</h2>
						<p class="text-[13px] font-semibold tabular-nums" style:color={macroMeta.color}>
							{fmtG(group.total)} g ({macroGoal > 0 ? Math.round((group.total / macroGoal) * 100) : 0} %)
						</p>
					</div>
					<div class="mt-1.5 overflow-hidden rounded-2xl border border-line bg-card">
						<div class="divide-y divide-line/60">
							{#each group.entries as e (e._id)}
								<div class="flex items-center gap-2 px-2 py-1.5">
									{#if e.thumbUrl || e.imageUrl}
										<FoodImg src={e.thumbUrl} fallbackSrc={e.imageUrl} alt="" eager={false} class="h-[52px] w-[52px] rounded-xl" />
									{:else}
										<div class="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-xl bg-brand-light"><Icon name="utensils" size={18} class="text-brand" /></div>
									{/if}
									<span class="min-w-0 flex-1">
										<span class="flex min-w-0 items-baseline gap-1.5">
											<span class="truncate text-[14px] font-semibold text-ink">{e.name}</span>
											{#if e.brand}<span class="truncate text-[12px] text-mist">{e.brand}</span>{/if}
										</span>
										<span class="mt-0.5 block text-[11px] tabular-nums text-mist">
											<strong class="font-bold" style:color={macroMeta.color}>{fmtG(e[macroMeta.field])} g</strong>
											{#if e.portions}
												· {String(e.portions).replace('.', ',')} {e.portions === 1 ? 'portion' : 'portions'}
											{:else}
												· {fmt(e.qtyGrams)} g
											{/if}
										</span>
									</span>
								</div>
							{/each}
						</div>
					</div>
				</section>
			{:else}
				<div class="mt-4 rounded-2xl border border-dashed border-line bg-card/60 px-4 py-10 text-center">
					<Icon name={macroMeta.icon} size={22} class="mx-auto text-mist" />
					<p class="mt-2 text-sm text-mist">Rien de consommé sur cette journée.</p>
				</div>
			{/each}
		</div>
	{:else}
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
					{#if selIds.size > 0}
						<!-- Type FOOD : liens texte « Tout désélectionner » / « Annuler »
						     pendant une sélection (les ronds sont toujours visibles). -->
						<button
							type="button"
							onclick={toggleAllSel}
							class="rounded-full px-2 py-1.5 text-[13px] font-bold text-brand transition hover:bg-brand/10"
						>{allSel ? 'Tout désélectionner' : 'Tout sélectionner'}</button>
						<button
							type="button"
							onclick={clearSel}
							class="rounded-full px-2 py-1.5 text-[13px] font-bold text-brand transition hover:bg-brand/10"
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
		     planifiés grisés (rond = sélection), navigation future autorisée. -->
		<JournalDay
			{day}
			mode="client"
			tip={tipDismissed || isFuture ? null : tip}
			onAdd={(meal) => openLog(meal as 'petit-dej' | 'dejeuner' | 'diner' | 'collation')}
			onEntryClick={openEdit}
			onMacroClick={openMacroDetail}
			onPlannedClick={(p) => {
				editPlanned = p;
				plannedSheetErr = '';
			}}
			onToggleEat={eatPlanned}
			onEatAllMeal={(meal) => eatMany(plannedItems.filter((p) => p.meal === meal).map((p) => p._id))}
			{canEat}
			selIds={selIds}
			onToggleSel={toggleSel}
			onCalCardMount={(el) => (calCardEl = el)}
			onTipDismiss={() => (tipDismissed = true)}
			onPhoto={aiFlags.mealPhotoAi ? (meal) => openMealPhoto(meal as 'petit-dej' | 'dejeuner' | 'diner' | 'collation') : undefined}
			/>
		</div>
	</div>
	{/if}

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

{#if stickyBar && !logOpen && !macroDetail}
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
{#if !macroDetail}
<button
	type="button"
	class="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition hover:scale-105 hover:bg-brand-dark active:scale-95 md:bottom-6 md:right-6 md:h-16 md:w-16"
	aria-label="Ajouter un aliment"
	onclick={() => openLog()}
><Icon name="plus" size={26} /></button>
{/if}

<!-- Ligne produit compacte (style FOOD) : image · nom · kcal · cœur -->
{#snippet foodRow(food: Food)}
	{@const fav = favSet.has(food._id)}
	<li class="flex items-center gap-1">
		<button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-1 pr-1 text-left transition hover:bg-line/30" onclick={() => openQty(food)}>
			{#if food.thumbUrl || food.imageUrl}
				<FoodImg src={food.thumbUrl} fallbackSrc={food.imageUrl} alt="" class="h-10 w-10 rounded-lg" />
			{:else}
				<div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={18} class="text-brand" /></div>
			{/if}
			<span class="min-w-0 flex-1">
				<span class="flex items-center gap-1">
					<span class="truncate text-[14px] font-semibold text-ink">{food.name}</span>
					{#if !food.custom}<span class="shrink-0 text-[9px] font-bold text-brand" title="Vérifié Open Food Facts">✓</span>{/if}
				</span>
				<span class="block text-[12px] text-mist tabular-nums">
					<strong class="font-bold text-brand">{fmt(food.kcal100)} kcal</strong> · 100 g{#if food.kcalRecalculated}<span class="ml-1 rounded bg-line/70 px-1 py-px text-[9px] font-semibold text-mist">Valeur recalculée</span>{/if}{#if food.brand && food.brand !== 'null'} · {food.brand}{/if}
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
	<div role="presentation" class="fixed inset-0 z-50 bg-soft sm:flex sm:items-center sm:justify-center sm:bg-ink/40 sm:p-6" style:top={mobile ? `${vvTop}px` : undefined} style:height={mobile ? `${vvH}px` : undefined} onclick={(e) => { if (e.target === e.currentTarget) closeLog(); }} onkeydown={(e) => { if (e.key === 'Escape') closeLog(); }}>
		<div class="relative flex h-full w-full flex-col overflow-hidden bg-soft sm:h-[min(92dvh,720px)] sm:max-w-lg sm:rounded-3xl sm:bg-white sm:shadow-2xl">
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
								onclick={() => { searchQ = ''; results = []; hasMore = false; nextOffset = 0; showScrollHint = false; ciqualResults = []; }}
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
										<li class="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white p-2 text-left transition hover:border-brand" role="button" tabindex="0" onclick={() => openIngredientQty(i)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIngredientQty(i); } }}>															{#if it.food.thumbUrl || it.food.imageUrl}
															<FoodImg src={it.food.thumbUrl} fallbackSrc={it.food.imageUrl} alt="" class="h-10 w-10 rounded-lg" />
														{:else}
															<div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={18} class="text-brand" /></div>
														{/if}
							<span class="min-w-0 flex-1">
								<span class="block truncate text-xs font-semibold text-ink">{it.food.name}</span>
								<span class="block text-[11px] text-mist">{fmt(Math.round((it.food.kcal100 * it.qty) / 100))} kcal{#if it.food.kcalRecalculated}<span class="ml-1 rounded bg-line/70 px-1 py-px text-[9px] font-semibold text-mist">Valeur recalculée</span>{/if}</span>
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
												<FoodImg src={meal.ingredients[0].thumbUrl} fallbackSrc={meal.ingredients[0].imageUrl} alt="" class="h-11 w-11 rounded-xl" />
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
							<!-- focusin (capture) : chaque champ du formulaire reste au-dessus du clavier. -->
							<div bind:this={customFormEl} onfocusin={(e) => focusScroll(e.currentTarget, e.target)} onfocusout={blurScroll}>
							<button type="button" class="mb-3 flex items-center gap-1 text-sm font-semibold text-mist hover:text-ink" onclick={closeCustomEditor}>← Retour à mes aliments</button>
							<p class="mb-1 text-sm font-semibold text-ink">{cfEditingId ? 'Modifier l\'aliment' : 'Nouvel aliment'}</p>
							<p class="mb-3 text-xs text-mist">{cfEditingId ? 'Mets à jour les valeurs pour 100 g : les prochains ajouts au journal utiliseront les nouvelles valeurs.' : 'Reçois-tu un plat avec une étiquette nutritionnelle ? Saisis les valeurs pour 100 g : l\'aliment sera ajouté à ta base.'}</p>

							<input type="text" class="w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-brand" placeholder="Nom (ex. Hachis parmentier)" bind:value={cfName} />
							<input type="text" class="mt-2 w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm text-ink outline-none focus:border-brand" placeholder="Marque (optionnel)" bind:value={cfBrand} />

							{#if cfAiNote}
								<p class="mt-2 flex items-start gap-1.5 rounded-xl bg-brand-light/60 px-3 py-2 text-xs text-brand-dark"><Icon name="sparkles" size={13} class="mt-0.5 shrink-0" />{cfAiNote}</p>
							{/if}

							<div class="mt-3 grid grid-cols-2 gap-2">
								<label class="rounded-xl border-2 px-3 py-2 {cfReview.has('kcal') ? 'border-warn bg-warn-light/40' : 'border-line bg-cream'}">
									<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Calories / 100 g{#if cfReview.has('kcal')}<span class="ml-1 normal-case text-warn">· à vérifier</span>{/if}</span>
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
								<label class="rounded-xl border-2 border-line bg-cream px-3 py-2">
									<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Fibres / 100 g (optionnel)</span>
									<input type="text" inputmode="decimal" class="mt-1 w-full bg-transparent text-sm font-bold text-ink outline-none" placeholder="Ex. 3" bind:value={cfFiber} />
								</label>
								<label class="rounded-xl border-2 border-line bg-cream px-3 py-2">
									<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Sel / 100 g (optionnel)</span>
									<input type="text" inputmode="decimal" class="mt-1 w-full bg-transparent text-sm font-bold text-ink outline-none" placeholder="Ex. 1,2" bind:value={cfSalt} />
								</label>
							</div>

							<label class="mt-2 block rounded-xl border-2 border-line bg-cream px-3 py-2">
								<span class="block text-[11px] font-bold uppercase tracking-wide text-mist">Portion habituelle (g, optionnel)</span>
								<input type="text" inputmode="decimal" class="mt-1 w-full bg-transparent text-sm font-bold text-ink outline-none" placeholder="Ex. 200" bind:value={cfServing} />
							</label>

							{#if bcStep === 'choose'}
								<!-- Étape code-barres (création via étiquette) : facultatif. -->
								<div class="mt-3 rounded-xl border-2 border-dashed border-line bg-cream/60 px-3 py-3">
									{#if bcCode}
										<p class="text-xs font-bold text-ink">Code-barres détecté sur la photo</p>
										<p class="mt-0.5 text-lg font-black tracking-wider text-ink">{bcCode}</p>
										<div class="mt-2 flex gap-2">
											<button type="button" class="rounded-full bg-brand px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-dark" onclick={confirmBcCode}>C'est le bon</button>
											<button type="button" class="rounded-full px-3 py-2 text-xs font-semibold text-mist transition hover:text-ink" onclick={() => { bcCode = null; bcStep = 'choose'; }}>Le corriger</button>
										</div>
									{:else}
										<p class="text-xs font-bold text-ink">Ajouter le code-barres du produit ?</p>
										<p class="mt-0.5 text-[11px] text-mist">Optionnel — aide à retrouver le produit et à l'enrichir pour tout le monde (après validation).</p>
										<div class="mt-2 flex gap-2">
											<button type="button" class="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-dark" disabled={bcBusy} onclick={startBcScan}><Icon name="barcode" size={13} />{bcBusy ? 'Recherche…' : 'Scanner le code-barres'}</button>
											<button type="button" class="rounded-full px-3 py-2 text-xs font-semibold text-mist transition hover:text-ink" onclick={skipBc}>Plus tard</button>
										</div>
									{/if}
									{#if bcError}
										<p class="mt-2 rounded-lg bg-danger-light px-2.5 py-1.5 text-xs text-danger">{bcError}</p>
									{/if}
								</div>
							{:else if bcStep === 'scan'}
								<!-- Scan DANS l'éditeur (résultat routé vers cette feuille). -->
								<div class="mt-3 overflow-hidden rounded-xl border-2 border-line">
									<div id="editor-bc-reader" class="aspect-[4/3] w-full bg-ink"></div>
								</div>
								<p class="mt-2 text-center text-xs text-mist">Vise le code-barres du produit… <button type="button" class="font-semibold text-brand hover:underline" onclick={() => { bcStep = cfEditingId ? 'add' : 'choose'; void stopScanner(); }}>Annuler</button></p>
								{#if bcError}
									<p class="mt-2 rounded-lg bg-danger-light px-2.5 py-1.5 text-xs text-danger">{bcError}</p>
								{/if}
							{:else if bcStep === 'scan-found'}
								<div class="mt-3 rounded-xl bg-brand-light/60 px-3 py-3">
									<p class="text-xs font-bold text-brand-dark">Code rattaché à ton aliment</p>
									<p class="mt-0.5 text-lg font-black tracking-wider text-ink">{bcCode}</p>
									<p class="mt-1 text-[11px] text-brand-dark">Nouveau produit : il rejoindra la base commune comme « candidat » après ta validation — jamais publié automatiquement.</p>
								</div>
							{:else if bcStep === 'exists' && bcExisting}
								<!-- Anti-doublon : ce code existe déjà → fiche existante. -->
								<div class="mt-3 rounded-xl bg-brand-light/60 px-3 py-3">
									<p class="text-sm font-bold text-brand-dark">Ce produit existe déjà dans G-FLUX.</p>
									<p class="mt-1 text-sm font-semibold text-ink">{bcExisting.name}{#if bcExisting.brand} · {bcExisting.brand}{/if}</p>
									<p class="text-xs text-mist">{fmt(bcExisting.kcal100)} kcal · P {fmt(bcExisting.protein100)} · G {fmt(bcExisting.carbs100)} · L {fmt(bcExisting.fat100)} / 100 g</p>
									<div class="mt-2 flex gap-2">
										<button type="button" class="rounded-full bg-brand px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-dark" onclick={useExistingBarcodeFood}>Utiliser la fiche existante</button>
										<button type="button" class="rounded-full px-3 py-2 text-xs font-semibold text-mist transition hover:text-ink" onclick={dismissExistingBarcodeFood}>{cfEditingId ? 'Garder ma fiche' : 'Créer quand même le mien'}</button>
									</div>
								</div>
							{:else if bcStep === 'attached' && bcCode}
								<p class="mt-2 flex items-center gap-1.5 rounded-xl bg-brand-light/60 px-3 py-2 text-xs text-brand-dark"><Icon name="barcode" size={13} class="shrink-0" />Code-barres {bcCode} rattaché à cet aliment.</p>
							{:else if bcStep === 'add'}
								<!-- Édition d'un aliment sans code : rattachement plus tard. -->
								<div class="mt-3 rounded-xl border-2 border-dashed border-line bg-cream/60 px-3 py-3">
									<p class="text-xs font-bold text-ink">Ajouter un code-barres à cet aliment ?</p>
									<p class="mt-0.5 text-[11px] text-mist">Optionnel — si le produit existe déjà dans G-FLUX, ta fiche pointera dessus (aucun doublon).</p>
									<div class="mt-2 flex gap-2">
										<button type="button" class="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-dark" disabled={bcBusy} onclick={startBcScan}><Icon name="barcode" size={13} />{bcBusy ? 'Recherche…' : 'Scanner le code-barres'}</button>
										<button type="button" class="rounded-full px-3 py-2 text-xs font-semibold text-mist transition hover:text-ink" onclick={() => (bcStep = 'hidden')}>Plus tard</button>
									</div>
									{#if bcError}
										<p class="mt-2 rounded-lg bg-danger-light px-2.5 py-1.5 text-xs text-danger">{bcError}</p>
									{/if}
								</div>
							{/if}

							{#if cfError}
								<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{cfError}</p>
							{/if}

							<button type="button" class="mt-4 w-full rounded-full bg-brand py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={cfSaving || cfName.trim().length < 2} onclick={saveCustomFood}>
								{cfSaving ? 'Enregistrement…' : cfEditingId ? 'Enregistrer les modifications' : 'Créer mon aliment'}
							</button>
							</div>
						{:else}
							<button type="button" class="mb-3 flex w-full items-center gap-2 rounded-xl bg-brand-light px-3 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/15" onclick={openCreateSheet}>
								<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white">＋</span>
								Créer un aliment
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
										<button type="button" class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-mist transition hover:bg-line/70 hover:text-ink" aria-label={`Modifier ${food.name}`} onclick={() => openCustomEditorFor(food)}><Icon name="pencil" size={15} /></button>
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
						<div class="py-10 text-center" role="status">
							<div class="mx-auto mb-3 grid h-12 w-12 animate-pulse place-items-center rounded-full bg-brand-light"><Icon name="search" size={22} class="text-brand" /></div>
							<p class="text-sm font-semibold text-ink">Recherche « {searchQ.trim()} »…</p>
							<p class="mx-auto mt-1 max-w-xs text-xs text-mist">On fouille la base (780 000 aliments) — ça ne prend que quelques secondes.</p>
						</div>
					{:else if searchError}
						<div class="rounded-xl border-2 border-danger bg-danger-light px-3 py-3 text-sm text-danger">
							<p>{searchError}</p>
							<button type="button" class="mt-2 w-full rounded-full bg-danger py-2 text-xs font-bold text-white transition hover:opacity-90" onclick={() => runSearch(searchQ.trim())}>Réessayer</button>
						</div>
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
					{:else if results.length === 0 && ciqualResults.length === 0}
						<p class="py-10 text-center text-sm text-mist">Aucun résultat pour « {searchQ.trim()} ».</p>
					{:else}
						<!-- ═══ ALIMENTS DE RÉFÉRENCE (Ciqual – ANSES) : toujours en tête,
						     strictement séparés des produits ; icône générique unique,
						     aucune photo produit, fiche entièrement cliquable. ═══ -->
						{#if ciqualResults.length > 0}
							<div class="flex items-baseline justify-between px-1 pb-1 pt-1.5">
								<h3 class="text-[11px] font-bold uppercase tracking-widest text-mist">Aliments de référence</h3>
								<span class="text-[10px] text-mist">Ciqual – ANSES</span>
							</div>
							<ul class="mb-2 flex flex-col gap-1.5">
								{#each ciqualResults as cfood (cfood._id)}
									<li>
										<button type="button" class="flex w-full items-center gap-2.5 rounded-2xl border border-line bg-white p-2 text-left shadow-sm transition hover:border-brand" onclick={() => openQty(cfood)}>
											<span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-light"><Icon name="salad" size={20} class="text-brand" /></span>
										<span class="min-w-0 flex-1">
											<span class="block truncate text-[14px] font-semibold text-ink">{cfood.name}</span>
											<span class="block text-[12px] text-mist tabular-nums"><strong class="font-bold text-brand">{fmt(cfood.kcal100)} kcal</strong> · 100 g · Idéal pour un suivi précis</span>
										</span>
											<span class="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-[9px] font-bold text-brand">Référence Ciqual – ANSES</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
						{#if results.length > 0}
							<div class="flex items-baseline justify-between px-1 pb-1 pt-1.5">
								<h3 class="text-[11px] font-bold uppercase tracking-widest text-mist">Produits</h3>
								<span class="text-[10px] text-mist">Open Food Facts</span>
							</div>
							<!-- Résultats : conservés pendant une nouvelle recherche (pas de flash blanc) -->
							<ul class="flex flex-col divide-y divide-line/50 transition-opacity {searching ? 'opacity-50' : ''}">
								{#each results as food (food._id)}
									{@render foodRow(food)}
								{/each}
							</ul>								{#if hasMore}
									<div bind:this={sentinelEl} class="h-px w-full"></div>
									{#if loadingMore}<p class="py-3 text-center text-xs text-mist">Chargement…</p>{/if}
								{/if}
							{/if}
						{/if}
					</div>
					<!-- Indication de scroll : discrète, non cliquable, disparaît dès
					     que l'utilisateur a fait défiler (voir loadMore). -->
					{#if showScrollHint}
						<div class="pointer-events-none absolute inset-x-0 bottom-[calc(5.3rem+env(safe-area-inset-bottom))] z-10 flex justify-center">
							<span class="flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-[11px] text-mist shadow-sm">
								<Icon name="chevronDown" size={12} class="animate-bounce" /> Fais défiler pour voir plus
							</span>
						</div>
					{/if}
				{:else}
				<!-- ═══════ Scanner code-barres (cadre portrait stable) ═══════ -->
				<div bind:this={bcListEl} class="flex-1 overflow-y-auto overscroll-contain px-3 pb-24 pt-3">
					<p class="mb-2.5 text-center text-xs text-mist">Scanne le code-barres du produit (ça marche même à distance) ou saisis-le à la main : on le retrouve dans la base G-Flux.</p>
					<div id="bc-reader" class="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border-2 bg-ink transition-colors {barcodeBusy ? 'border-brand ring-4 ring-brand/40' : 'border-line'}"></div>
					{#if scannerCaps && (scannerCaps.torch || scannerCaps.zoom)}
						<div class="mx-auto mt-2 flex w-full max-w-sm items-center justify-center gap-3">
							{#if scannerCaps.torch}
								<button type="button" class="grid h-10 w-10 place-items-center rounded-full border-2 transition {torchOn ? 'border-warn bg-warn-light text-warn' : 'border-line bg-white text-mist'}" aria-label={torchOn ? 'Éteindre la lampe' : 'Allumer la lampe'} onclick={toggleScannerTorch}><Icon name="sun" size={18} /></button>
							{/if}
							{#if scannerCaps.zoom}
								<input type="range" class="h-10 flex-1 accent-[var(--color-brand)]" min={scannerCaps.zoomMin} max={scannerCaps.zoomMax} step={scannerCaps.zoomStep} bind:value={zoomLevel} oninput={applyScannerZoom} aria-label="Zoom caméra" />
							{/if}
						</div>
					{/if}

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
						<div class="mx-auto mt-3 w-full max-w-sm rounded-xl bg-danger-light px-3 py-2.5 text-center text-sm text-danger">
							{#if barcodePermBlocked}
								<span class="mb-1 flex items-center justify-center gap-1.5 font-bold"><Icon name="lock" size={15} /> Accès caméra désactivé</span>
							{/if}
							<p>{barcodeError}</p>
							{#if barcodePermBlocked}
								<p class="mt-1.5 text-[11px] leading-snug text-danger/80">Si tu as refusé l'accès, réautorise la caméra dans les réglages du navigateur ou de l'appareil : icône caméra/cadenas dans la barre d'adresse, Réglages iOS → Safari (iPhone) ou Paramètres du site Chrome (Android). Le scan doit rester autorisé ensuite, sans nouvelle demande à chaque scan.</p>
								<button type="button" class="mt-2 w-full rounded-full bg-danger py-2 text-xs font-bold text-white transition hover:opacity-90" onclick={() => retryScanner()}>Réessayer</button>
							{/if}
						</div>
					{:else if barcodeStatus === 'scanning'}
						<p class="mt-3 text-center text-xs text-mist">Caméra active — présente le code-barres à plat devant l'objectif, même à distance : dès qu'il est lu, l'encadré passe au vert.</p>
					{/if}
				</div>
			{/if}
			<!-- Capsule flottante Recherche ⇄ Code-barres (type FOOD) : positionnée
			     juste au-dessus du clavier (le conteneur suit le visualViewport),
			     ne réserve aucune place dans le flux ; la liste défile dessous. -->
			<div class="pointer-events-none absolute inset-x-0 bottom-[calc(0.625rem+env(safe-area-inset-bottom))] z-10 flex justify-center px-4">
				<!-- 3 zones équilibrées quand la bêta « Repas IA » est active pour le
				     compte (méthode de TRACKING du journal — jamais une création
				     d'aliment) ; sinon capsule 2 zones inchangée. -->
				<div class="pointer-events-auto flex h-14 items-center gap-1 rounded-full bg-ink/95 p-1 shadow-lg shadow-ink/30 ring-1 ring-white/10 {aiFlags.mealPhotoAi ? 'w-[86%] max-w-[380px]' : 'w-[55%] min-w-[190px] max-w-[260px]'}">
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
					{#if aiFlags.mealPhotoAi}
						<button
							type="button"
							class="relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold text-white/70 transition hover:text-white"
							onclick={() => openMealPhoto()}
						>
							<Icon name="camera" size={17} />
							<span>Repas IA</span>
							<span class="absolute right-1.5 top-1 rounded-full bg-brand px-1 py-px text-[8px] font-bold leading-none text-white">BÊTA</span>
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
{#if mealPhotoOpen}
	<!-- ═══════════ Bottom sheet « Photographier mon repas » ═══════════
	     1. Photo (capture directe) → analyse IA (composants + quantités) ;
	     2. MATCH base G-FLUX (Convex → Ciqual) — nutrition JAMAIS inventée ;
	     3. Fiche visuelle unique : composants modifiables (quantité, remplacement,
	        suppression) + ajout d'un ingrédient oublié (huile, sauce…) ;
	     4. « Ajouter au Journal » : N composants en une requête, aucun aliment
	        créé (ni « Créés par moi », ni base globale). -->
	<div role="presentation" class="fixed inset-0 z-[75] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !mealAnalyzing && !mealCommitting) closeMealPhoto(); }} onkeydown={(e) => { if (e.key === 'Escape' && !mealAnalyzing && !mealCommitting) closeMealPhoto(); }}>
		<div class="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl sm:rounded-3xl">
			<div class="mb-3 flex items-center justify-between">
				<p class="font-display text-[17px] font-bold text-ink">Photographier mon repas</p>
				<button type="button" class="grid h-8 w-8 place-items-center rounded-full text-mist transition hover:bg-line/50" aria-label="Fermer" onclick={closeMealPhoto}><Icon name="x" size={18} /></button>
			</div>

			<!-- Choix du repas (même sélecteur que la feuille de quantité) -->
			<div class="mb-3 grid grid-cols-4 gap-1.5">
				{#each MEAL_DEFS as m (m.id)}
					<button type="button" class="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition {mealAnalyzedMeal === m.id ? 'bg-brand text-white' : 'bg-line/50 text-mist'}" onclick={() => (mealAnalyzedMeal = m.id)}>
						<Icon name={m.icon} size={15} class="shrink-0" />
						{m.label.split(' ')[0]}
					</button>
				{/each}
			</div>

			{#if !mealAnalyzed}
				<!-- Capture : gros bouton unique, analyse pendant le spinner -->
				<button type="button" class="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand/40 bg-brand-light/30 px-4 py-8 text-center transition hover:bg-brand-light/60 disabled:opacity-60" disabled={mealAnalyzing} onclick={() => mealPhotoFileInput?.click()}>
					<Icon name={mealAnalyzing ? 'sparkles' : 'camera'} size={30} class="text-brand {mealAnalyzing ? 'animate-pulse' : ''}" />
					<span class="text-sm font-bold text-ink">{mealAnalyzing ? 'Analyse de ton assiette…' : 'Prendre la photo du repas'}</span>
					<span class="max-w-xs text-xs text-mist">{mealAnalyzing ? 'On reconnaît les aliments et les quantités — encore quelques secondes.' : 'Cadre l\'assiette entière : les aliments reconnus seront proposés, tu vérifies tout avant d\'enregistrer.'}</span>
				</button>
				<p class="mt-3 text-center text-[11px] text-mist">L'IA reconnaît les aliments — la nutrition vient de la base G-FLUX (Ciqual, produits) : jamais inventée.</p>
			{:else}
				<!-- Fiche visuelle du repas analysé (une carte, N composants) -->
				<div class="mb-3 flex items-center justify-between rounded-2xl bg-ink px-4 py-3 text-white">
					<p class="flex items-center gap-2 text-[13px] font-bold tracking-wide">REPAS ANALYSÉ</p>
					<p class="text-lg font-bold text-emerald-300 tabular-nums">≈ {fmt(analyzedTotals.kcal)} kcal</p>
				<span class="rounded bg-brand-light px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-dark">Bêta</span>
				</div>

				<ul class="flex flex-col divide-y divide-line/60 rounded-2xl border border-line">
					{#each mealAnalyzed as c, i (i)}
						{@const per = compPer100(c)}
						<li class="flex items-center gap-2 px-3 py-2">
							<span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={16} class="text-brand" /></span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[14px] font-semibold text-ink">{c.name}</span>
								<span class="block text-[11px] text-mist tabular-nums">
									<strong class="text-brand">{fmt(Math.round((per.kcal * c.qtyGrams) / 100))} kcal</strong>
									{#if c.matchSource === 'ai'}
										· <span class="rounded bg-warn-light px-1 py-px font-semibold text-warn">Estimation IA</span>
									{:else if c.matchSource === 'ciqual'}
										· Réf. Ciqual
									{:else if c.matchSource === 'custom'}
										· Mes aliments
									{/if}
								</span>
							</span>
							<!-- Quantité : tap → édition, recalcul instantané -->
							<button type="button" class="shrink-0 rounded-lg border-2 border-line px-2 py-1 text-sm font-bold text-ink tabular-nums transition {mealQtyEditIdx === i ? 'border-brand text-brand' : 'hover:border-brand'}" onclick={() => openComponentQty(i)}>
								{#if mealQtyEditIdx === i}
									<input type="text" inputmode="numeric" class="w-14 bg-transparent text-right outline-none" bind:value={mealQtyDraft} onkeydown={(e) => { if (e.key === 'Enter') applyComponentQty(); }} onblur={applyComponentQty} />
								{:else}
									{fmt(Math.round(c.qtyGrams))} g
								{/if}
							</button>
							<button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mist transition hover:bg-line/70 hover:text-ink" aria-label={`Remplacer ${c.name}`} onclick={() => replaceComponent(i)}><Icon name="repeat" size={14} /></button>
							<button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mist transition hover:bg-danger-light hover:text-danger" aria-label={`Supprimer ${c.name}`} onclick={() => removeComponent(i)}><Icon name="trash" size={14} /></button>
						</li>
					{/each}
				</ul>

				{#if mealAnalyzedHint}
					<p class="mt-2 flex items-start gap-1.5 rounded-xl bg-brand-light/50 px-3 py-2 text-xs text-brand-dark"><Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" />{mealAnalyzedHint}</p>
				{/if}

				<button type="button" class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-line px-3 py-2.5 text-sm font-semibold text-mist transition hover:border-brand hover:text-brand" onclick={openAddIngredient}>
					<Icon name="plus" size={15} /> Ajouter un ingrédient
				</button>

				<!-- Totaux live (recalculés à chaque modification de quantité) -->
				<p class="mt-3 flex flex-wrap items-baseline justify-center gap-x-1 text-center text-sm">
					<span class="font-bold tabular-nums" style:color="#3b82f6">P {fmt(analyzedTotals.protein)} g</span>
					<span class="text-mist">·</span>
					<span class="font-bold tabular-nums" style:color="#ec4899">G {fmt(analyzedTotals.carbs)} g</span>
					<span class="text-mist">·</span>
					<span class="font-bold tabular-nums" style:color="#f97316">L {fmt(analyzedTotals.fat)} g</span>
				</p>
			{/if}

			{#if mealPhotoError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{mealPhotoError}</p>
			{/if}

			{#if mealAnalyzed && mealAnalyzed.length > 0}
				<button type="button" class="mt-4 w-full rounded-full bg-brand py-3.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60" disabled={mealCommitting || mealAnalyzed.length === 0} onclick={commitAnalyzedMeal}>
					{mealCommitting ? 'Ajout au journal…' : 'Ajouter au Journal'}
				</button>
				<p class="mt-2 text-center text-[11px] text-mist">Les composants restent séparés dans le journal — rien n'est créé dans tes aliments ni dans la base globale.</p>
			{/if}
		</div>
	</div>

	<!-- Recherche d'ingrédient (ajout oublié / remplacement) — fenêtre produit compacte -->
	{#if mealAddSearchOpen}
		<div role="presentation" class="fixed inset-0 z-[85] flex items-end justify-center bg-ink/40 sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget) mealAddSearchOpen = false; }} onkeydown={(e) => { if (e.key === 'Escape') (mealAddSearchOpen = false); }}>
			<div class="flex h-[80dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl sm:h-[min(80dvh,600px)] sm:rounded-3xl">
				<div class="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
					<p class="text-[15px] font-bold text-ink">{mealReplaceIdx !== null ? 'Remplacer l’ingrédient' : 'Ajouter un ingrédient'}</p>
					<button type="button" class="grid h-8 w-8 place-items-center rounded-full text-mist transition hover:bg-line/50" aria-label="Fermer" onclick={() => { mealAddSearchOpen = false; mealReplaceIdx = null; }}><Icon name="x" size={18} /></button>
				</div>
				<div class="shrink-0 border-b border-line px-3 py-2">
					<div class="flex items-center gap-2 rounded-xl border-2 border-line bg-cream px-3 py-2 focus-within:border-brand">
						<Icon name="search" size={16} class="shrink-0 text-mist" />
						<input type="search" class="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-mist" placeholder="Ex. huile d'olive, sauce tomate…" bind:value={mealAddQuery} oninput={onMealAddInput} />
					</div>
					<p class="mt-1 px-1 text-[11px] text-mist">Huile, beurre, sauce, fromage : pense aux ingrédients invisibles sur la photo.</p>
				</div>
				<div class="flex-1 overflow-y-auto px-2.5 py-2">
					{#if mealAddSearching && mealAddResults.length === 0}
						<p class="py-8 text-center text-sm text-mist">Recherche…</p>
					{:else if mealAddQuery.trim().length < 2}
						<p class="py-8 text-center text-sm text-mist">Recherche dans ta base et la base G-Flux.</p>
					{:else if mealAddResults.length === 0}
						<p class="py-8 text-center text-sm text-mist">Aucun résultat pour « {mealAddQuery.trim()} ».</p>
					{:else}
						<ul class="flex flex-col divide-y divide-line/50">
							{#each mealAddResults as f (f._id)}
								<li>
									<button type="button" class="flex w-full items-center gap-2 px-1 py-2 text-left transition hover:opacity-70" onclick={() => pickMealAdd(f)}>
										{#if f.ciqual}
											<span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="salad" size={17} class="text-brand" /></span>
										{:else}
											<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={16} class="text-brand" /></div>
										{/if}
										<span class="min-w-0 flex-1">
											<span class="block truncate text-sm font-semibold text-ink">{f.name}</span>
											<span class="block text-[11px] text-mist"><strong class="font-bold text-brand">{fmt(f.kcal100)} kcal</strong> / 100 g{#if f.brand} · {f.brand}{/if}</span>
										</span>
										<span class="text-brand">＋</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<input
		bind:this={mealPhotoFileInput}
		type="file"
		accept="image/*"
		capture="environment"
		class="hidden"
		onchange={(e) => {
			const f = (e.currentTarget as HTMLInputElement).files?.[0];
			if (f) void analyzeMealPhoto(f);
			(e.currentTarget as HTMLInputElement).value = '';
		}}
	/>
{/if}
{#if createSheetOpen}
	<!-- ═══════════ Bottom sheet « + Créer un aliment » ═══════════
	     3 points d'entrée : scanner un code-barres, photographier une étiquette
	     (IA préremplit, la cliente vérifie), ou saisir manuellement (formulaire
	     historique). Ouverte aussi APRÈS un scan sans produit trouvé. -->
	<div role="presentation" class="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6" onclick={(e) => { if (e.target === e.currentTarget && !labelAnalyzing) closeCreateSheet(); }} onkeydown={(e) => { if (e.key === 'Escape' && !labelAnalyzing) closeCreateSheet(); }}>
		<div class="w-full max-w-lg rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl sm:rounded-3xl">
			<div class="mb-3 flex items-center justify-between">
				<p class="font-display text-[17px] font-bold text-ink">Créer un aliment</p>
				<button type="button" class="grid h-8 w-8 place-items-center rounded-full text-mist transition hover:bg-line/50" aria-label="Fermer" onclick={closeCreateSheet}><Icon name="x" size={18} /></button>
			</div>
			{#if createSheetFromScan}
				<p class="mb-3 rounded-xl bg-line/40 px-3 py-2 text-xs text-mist">Produit introuvable pour ce code-barres. Photographie l'étiquette : l'app préremplit les valeurs, tu n'as plus qu'à vérifier.</p>
			{/if}

			<div class="flex flex-col gap-2">
				<button type="button" class="flex items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition hover:border-brand disabled:opacity-60" disabled={labelAnalyzing} onclick={() => createFromScan()}>
					<span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-light"><Icon name="barcode" size={19} class="text-brand" /></span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold text-ink">Scanner un code-barres</span>
						<span class="block text-xs text-mist">Produit emballé — même à distance</span>
						</span>
					<Icon name="chevronRight" size={16} class="shrink-0 text-mist" />
				</button>

				<button type="button" class="flex items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition hover:border-brand disabled:opacity-60" disabled={labelAnalyzing} onclick={() => labelFileInput?.click()}>
					<span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-light"><Icon name={labelAnalyzing ? 'sparkles' : 'camera'} size={19} class="text-brand {labelAnalyzing ? 'animate-pulse' : ''}" /></span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold text-ink">{labelAnalyzing ? 'Lecture de l\'étiquette…' : 'Photographier une étiquette'}{#if aiFlags.foodLabelAi} <span class="ml-1 rounded bg-brand-light px-1 py-px text-[9px] font-bold uppercase tracking-wide text-brand-dark align-middle">Bêta</span>{/if}</span>
						<span class="block text-xs text-mist">Le tableau nutritionnel est rempli automatiquement</span>
					</span>
					<Icon name="chevronRight" size={16} class="shrink-0 text-mist" />
				</button>

				<button type="button" class="flex items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition hover:border-brand disabled:opacity-60" disabled={labelAnalyzing} onclick={createManual}>
					<span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-light"><Icon name="pencil" size={19} class="text-brand" /></span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold text-ink">Saisir manuellement</span>
						<span class="block text-xs text-mist">Recette maison ou valeurs connues</span>
					</span>
					<Icon name="chevronRight" size={16} class="shrink-0 text-mist" />
				</button>
			</div>

			{#if labelError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{labelError}</p>
			{/if}
		</div>
	</div>
	<!-- Capture photo cachée : déclenchée par l'option étiquette (capture directe,
	     repli galerie si l'appareil ne propose pas d'appareil photo). -->
	<input
		bind:this={labelFileInput}
		type="file"
		accept="image/*"
		capture="environment"
		class="hidden"
		onchange={(e) => {
			const f = (e.currentTarget as HTMLInputElement).files?.[0];
			if (f) void analyzeLabelFile(f);
			(e.currentTarget as HTMLInputElement).value = '';
		}}
	/>
{/if}
{#if ingEdit}
	<!-- Feuille de quantité d'un INGRÉDIENT de repas : même composant que le
	     journal (grammes au pas de 1 g, portions, raccourcis, macros live). -->
	<QuantitySheet
		food={ingEdit.food}
		mealDefs={[]}
		sheetTop={mobile ? vvTop : 0}
		sheetHeight={mobile ? vvH : undefined}
		initialQtyGrams={ingEdit.qty}
		mode={mealPickedFood ? 'add' : 'edit'}
		source={mealPickedFood?.ciqual ? 'ciqual' : undefined}
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
	<div role="presentation" class="fixed inset-0 z-[70] bg-soft sm:flex sm:items-center sm:justify-center sm:bg-ink/40 sm:p-6" style:top={mobile ? `${vvTop}px` : undefined} style:height={mobile ? `${vvH}px` : undefined} onclick={(e) => { if (e.target === e.currentTarget) void closeMealSearch(); }} onkeydown={(e) => { if (e.key === 'Escape') void closeMealSearch(); }}>
		<div class="relative flex h-full w-full flex-col overflow-hidden bg-soft sm:h-[min(92dvh,720px)] sm:max-w-lg sm:rounded-3xl sm:bg-white sm:shadow-2xl">
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
							<button type="button" class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line/70 text-mist transition hover:bg-line" aria-label="Effacer la recherche"								onclick={() => { mealSearchQ = ''; mealResults = []; mealHasMore = false; mealNextOffset = 0; mealShowScrollHint = false; mealCiqualResults = []; }}><Icon name="x" size={13} /></button>
						{/if}
					</div>
				</div>
				<div bind:this={mealSearchListEl} class="flex-1 overflow-y-auto overscroll-contain px-2.5 pb-24">
					{#if mealSearching && mealResults.length === 0}
						<p class="flex items-center justify-center gap-2 py-10 text-sm text-mist" role="status">
							<Icon name="search" size={16} class="animate-pulse text-mist" /> Recherche « {mealSearchQ.trim()} »…
						</p>
					{:else if mealSearchError}
						<div class="rounded-xl border-2 border-danger bg-danger-light px-3 py-3 text-sm text-danger">
							<p>{mealSearchError}</p>
							<button type="button" class="mt-2 w-full rounded-full bg-danger py-2 text-xs font-bold text-white transition hover:opacity-90" onclick={() => runMealSearch(mealSearchQ.trim())}>Réessayer</button>
						</div>
					{:else if mealSearchQ.trim().length < 2}
						<p class="py-10 text-center text-sm text-mist">Recherche un produit — base G-Flux (780 000 aliments) et tes aliments « Créés par moi ».</p>
					{:else if mealResults.length === 0 && mealCiqualResults.length === 0}
						<p class="py-10 text-center text-sm text-mist">Aucun résultat pour « {mealSearchQ.trim()} ».</p>
					{:else}
						{#if mealCiqualResults.length > 0}
							<div class="flex items-baseline justify-between px-1 pb-1 pt-1.5">
								<h3 class="text-[11px] font-bold uppercase tracking-widest text-mist">Aliments de référence</h3>
								<span class="text-[10px] text-mist">Ciqual – ANSES</span>
							</div>
							<ul class="mb-2 flex flex-col gap-1.5">
								{#each mealCiqualResults as cfood, ci (cfood._id)}
									<li>
										<button type="button" class="flex w-full items-center gap-2.5 rounded-2xl border border-line bg-white p-2 text-left shadow-sm transition hover:border-brand" onclick={() => openCiqualIngredientPortion(ci)}>
											<span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-light"><Icon name="salad" size={20} class="text-brand" /></span>
										<span class="min-w-0 flex-1">
											<span class="block truncate text-[14px] font-semibold text-ink">{cfood.name}</span>
											<span class="block text-[12px] text-mist tabular-nums"><strong class="font-bold text-brand">{fmt(cfood.kcal100)} kcal</strong> · 100 g · Idéal pour un suivi précis</span>
										</span>
											<span class="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-[9px] font-bold text-brand">Référence Ciqual – ANSES</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
						{#if mealResults.length > 0}
							<div class="flex items-baseline justify-between px-1 pb-1 pt-1.5">
								<h3 class="text-[11px] font-bold uppercase tracking-widest text-mist">Produits</h3>
								<span class="text-[10px] text-mist">Open Food Facts</span>
							</div>
							<ul class="flex flex-col divide-y divide-line/50 transition-opacity {mealSearching ? 'opacity-50' : ''}">
								{#each mealResults as food, i (food._id)}
									<li>
										<button type="button" class="flex w-full items-center gap-2 px-1 py-2 text-left transition hover:opacity-70" onclick={() => openIngredientPortion(i)}>
											{#if food.thumbUrl || food.imageUrl}
												<FoodImg src={food.thumbUrl} fallbackSrc={food.imageUrl} alt="" class="h-10 w-10 rounded-lg" />
											{:else}
												<div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={18} class="text-brand" /></div>
											{/if}
											<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-semibold text-ink">{food.name}</span>
										<span class="block text-xs text-mist"><strong class="font-bold text-brand">{fmt(food.kcal100)} kcal</strong> / 100 g{#if food.kcalRecalculated}<span class="ml-1 rounded bg-line/70 px-1 py-px text-[9px] font-semibold text-mist">Valeur recalculée</span>{/if}{#if food.brand} · {food.brand}{/if}</span>
											</span>
											<span class="text-brand">＋</span>
										</button>
									</li>
								{/each}
								</ul>
								{#if mealHasMore}
									<div bind:this={mealSentinelEl} class="h-px w-full"></div>
									{#if mealLoadingMore}<p class="py-3 text-center text-xs text-mist">Chargement…</p>{/if}
								{/if}
						{/if}
					{/if}
				</div>
				{#if mealShowScrollHint}
					<div class="pointer-events-none absolute inset-x-0 bottom-[calc(5.3rem+env(safe-area-inset-bottom))] z-10 flex justify-center">
						<span class="flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-[11px] text-mist shadow-sm">
							<Icon name="chevronDown" size={12} class="animate-bounce" /> Fais défiler pour voir plus
						</span>
					</div>
				{/if}
			{:else}
				<!-- ═══════ Scanner code-barres de la fenêtre produit (même rendu que « Ajouter un aliment ») ═══════ -->
				<div bind:this={mealBcListEl} class="flex-1 overflow-y-auto overscroll-contain px-3 pb-24 pt-3">
					<p class="mb-2.5 text-center text-xs text-mist">Scanne le code-barres du produit : dès qu'il est lu, la feuille de portion s'ouvre directement.</p>
					<div id="meal-bc-reader" class="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border-2 bg-ink transition-colors {barcodeBusy ? 'border-brand ring-4 ring-brand/40' : 'border-line'}"></div>
					{#if scannerCaps && (scannerCaps.torch || scannerCaps.zoom)}
						<div class="mx-auto mt-2 flex w-full max-w-sm items-center justify-center gap-3">
							{#if scannerCaps.torch}
								<button type="button" class="grid h-10 w-10 place-items-center rounded-full border-2 transition {torchOn ? 'border-warn bg-warn-light text-warn' : 'border-line bg-white text-mist'}" aria-label={torchOn ? 'Éteindre la lampe' : 'Allumer la lampe'} onclick={toggleScannerTorch}><Icon name="sun" size={18} /></button>
							{/if}
							{#if scannerCaps.zoom}
								<input type="range" class="h-10 flex-1 accent-[var(--color-brand)]" min={scannerCaps.zoomMin} max={scannerCaps.zoomMax} step={scannerCaps.zoomStep} bind:value={zoomLevel} oninput={applyScannerZoom} aria-label="Zoom caméra" />
							{/if}
						</div>
					{/if}

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
						<div class="mx-auto mt-3 w-full max-w-sm rounded-xl bg-danger-light px-3 py-2.5 text-center text-sm text-danger">
							{#if barcodePermBlocked}
								<span class="mb-1 flex items-center justify-center gap-1.5 font-bold"><Icon name="lock" size={15} /> Accès caméra désactivé</span>
							{/if}
							<p>{barcodeError}</p>
							{#if barcodePermBlocked}
								<p class="mt-1.5 text-[11px] leading-snug text-danger/80">Si tu as refusé l'accès, réautorise la caméra dans les réglages du navigateur ou de l'appareil : icône caméra/cadenas dans la barre d'adresse, Réglages iOS → Safari (iPhone) ou Paramètres du site Chrome (Android). Le scan doit rester autorisé ensuite, sans nouvelle demande à chaque scan.</p>
								<button type="button" class="mt-2 w-full rounded-full bg-danger py-2 text-xs font-bold text-white transition hover:opacity-90" onclick={() => retryScanner()}>Réessayer</button>
							{/if}
						</div>
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

<!-- Barre d'actions COMPACTE type FOOD : Dupliquer · Repas · Planifier · Mangé · Supprimer.
     « Mangé » : uniquement si la sélection ne contient QUE des items planifiés arrivés
     à aujourd'hui (jamais au futur, jamais sur du consommé). -->
{#if selIds.size > 0}
	<div class="fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
		<div class="flex w-full max-w-md items-center justify-around rounded-full border border-white/10 bg-ink/95 p-1.5 shadow-lg shadow-ink/30 backdrop-blur">
			<button
				type="button"
				class="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
				onclick={() => openDupSheet(false)}
			>
				<Icon name="copy" size={17} />
				Dupliquer
			</button>
			<button
				type="button"
				class="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
				onclick={openMealCreateSheet}
			>
				<Icon name="utensils" size={17} />
				Repas
			</button>
			<button
				type="button"
				class="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
				onclick={() => openDupSheet(true)}
			>
				<Icon name="calendarClock" size={17} />
				Planifier
			</button>
			{#if selAllEatable}
				<button
					type="button"
					class="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
					disabled={plannedBusy}
					onclick={() => eatMany(selPlannedIds)}
				>
					<Icon name="check" size={17} strokeWidth={3} />
					Mangé
				</button>
			{/if}
			<button
				type="button"
				class="flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-semibold text-danger transition hover:bg-danger/20"
				disabled={plannedBusy}
				onclick={deleteSelection}
			>
				<Icon name="trash" size={17} />
				Supprimer
			</button>
		</div>
	</div>
{/if}

<!-- ═══════════ Feuille « Dupliquer » (raccourci Demain + calendrier) ═══════════ -->
{#if dupOpen}
	<button type="button" class="fixed inset-0 z-[60] bg-ink/40" aria-label="Fermer" onclick={closeDupSheet}></button>
	<div class="fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[360px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
		<p class="mb-1 text-left font-display text-[26px] font-bold tracking-tight text-ink">{planMode ? 'Planifier' : 'Dupliquer'}</p>
		<p class="mb-4 text-left text-[12px] font-semibold text-mist">
			{selIds.size} aliment{selIds.size > 1 ? 's' : ''} · mêmes quantités, mêmes repas{#if planMode} · date future uniquement{/if}
		</p>

		<!-- Calendrier type FOOD : grand mois + flèches, semaine lundi→dimanche,
		     jour choisi = cercle vert, gros bouton de confirmation en bas.
		     « Planifier » : seuls les jours futurs sont cliquables. -->
		<div class="mb-2 flex items-center justify-between">
			<p class="text-[22px] font-bold text-ink">{MOIS_CAL[calMonth]} {calYear}</p>
			<div class="flex items-center gap-1">
				<button type="button" class="grid h-9 w-9 place-items-center rounded-full text-ink transition hover:bg-line/50" aria-label="Mois précédent" onclick={() => shiftCalMonth(-1)}>
					<Icon name="chevronLeft" size={20} />
				</button>
				<button type="button" class="grid h-9 w-9 place-items-center rounded-full text-ink transition hover:bg-line/50" aria-label="Mois suivant" onclick={() => shiftCalMonth(1)}>
					<Icon name="chevronRight" size={20} />
				</button>
			</div>
		</div>
		<div class="mb-1 grid grid-cols-7 text-center text-[13px] font-bold text-mist">
			<span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span>
		</div>
		<div class="grid grid-cols-7 gap-y-1">
			{#each calCells as cell, i (i)}
				<div class="grid place-items-center">
					{#if cell}
						{@const iso = calDayISO(cell)}
						{@const isPlanBlocked = planMode && iso <= todayISO}
						<button
							type="button"
							class="grid h-10 w-10 place-items-center rounded-full text-[15px] font-semibold transition {dupDate === iso
								? 'bg-brand text-white'
								: isPlanBlocked
									? 'text-mist/50'
									: 'text-ink hover:bg-brand/10'}"
							disabled={isPlanBlocked}
							aria-label={`Choisir le ${cell} ${MOIS_CAL[calMonth]}`}
							aria-pressed={dupDate === iso}
							onclick={() => (dupDate = iso)}
						>{cell}</button>
					{/if}
				</div>
			{/each}
		</div>

		{#if dupErr}
			<p class="mt-2 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{dupErr}</p>
		{/if}
		<button
			type="button"
			class="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand px-5 py-4 text-[17px] font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
			disabled={dupBusy || (planMode ? !dupDateIsFuture : !dupDate)}
			onclick={duplicateSelection}
		>
			{dupBusy ? (planMode ? 'Planification…' : 'Duplication…') : planMode ? 'Planifier' : 'Confirmer'} · {dupDateLabel}
		</button>
	</div>
{/if}

<!-- ═══════════ Feuille « Créer un repas » (nom → Mes Repas) ═══════════ -->
{#if mealCreateOpen}
	<button type="button" class="fixed inset-0 z-[60] bg-ink/40" aria-label="Fermer" onclick={closeMealCreateSheet}></button>
	<div class="fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[360px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
		<p class="mb-1 text-center text-[17px] font-bold text-ink">Créer un repas</p>
		<p class="mb-4 text-center text-xs text-mist">{selIds.size} aliment{selIds.size > 1 ? 's' : ''} et leurs quantités seront enregistrés dans « Mes repas ».</p>
		<input
			type="text"
			class="w-full rounded-xl border-2 border-line bg-cream px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-brand"
			placeholder="Nom du repas (ex. Mon dîner protéiné)"
			bind:value={mealCreateName}
			onkeydown={(e) => { if (e.key === 'Enter' && mealCreateName.trim().length >= 2 && !mealCreateBusy) void saveMealFromSelection(); }}
		/>
		{#if mealCreateErr}
			<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{mealCreateErr}</p>
		{/if}
		<div class="mt-4 flex items-center justify-between">
			<button type="button" class="rounded-full px-3 py-2 text-[14px] font-semibold text-mist transition hover:text-ink" onclick={closeMealCreateSheet}>Annuler</button>
			<button
				type="button"
				class="rounded-full bg-brand px-5 py-2 text-[14px] font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
				disabled={mealCreateBusy || mealCreateName.trim().length < 2}
				onclick={saveMealFromSelection}
			>{mealCreateBusy ? 'Enregistrement…' : 'Enregistrer le repas'}</button>
		</div>
	</div>
{/if}

<!-- ═══════════ Feuille quantité (item planifié) — édition ═══════════ -->
{#if editPlanned && editPlannedFood}
	<QuantitySheet
		food={editPlannedFood}
		mealDefs={MEAL_DEFS}
		sheetTop={mobile ? vvTop : 0}
		sheetHeight={mobile ? vvH : undefined}
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
		sheetTop={mobile ? vvTop : 0}
		sheetHeight={mobile ? vvH : undefined}
		initialQtyGrams={qtyGrams}
		initialMeal={qtyMeal}
		source={qtyFood.ciqual ? 'ciqual' : undefined}
		showFav={!qtyFood.custom && !qtyFood.ciqual}
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
								<FoodImg src={qtyMealSel.ingredients[0].thumbUrl} fallbackSrc={qtyMealSel.ingredients[0].imageUrl} alt="" class="h-14 w-14 rounded-xl" eager />
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

			<!-- Code couleur du Journal : kcal vert · glucides rose ·
			     protéines bleu · lipides orange, séparateurs gris. -->
			<p class="mt-3 flex flex-wrap items-baseline justify-center gap-x-1 text-center text-sm">
				<strong class="text-lg font-bold text-brand">{fmt(portionKcal)} kcal</strong>
				<span class="text-mist">·</span>
				<span class="font-bold tabular-nums" style:color="#ec4899">{fmt(portionMacros?.carbs ?? 0)} g glucides</span>
				<span class="text-mist">·</span>
				<span class="font-bold tabular-nums" style:color="#3b82f6">{fmt(portionMacros?.protein ?? 0)} g protéines</span>
				<span class="text-mist">·</span>
				<span class="font-bold tabular-nums" style:color="#f97316">{fmt(portionMacros?.fat ?? 0)} g lipides</span>
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
		sheetTop={mobile ? vvTop : 0}
		sheetHeight={mobile ? vvH : undefined}
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