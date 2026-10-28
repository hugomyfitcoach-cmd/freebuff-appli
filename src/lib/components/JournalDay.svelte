<script lang="ts">
	/**
	 * JournalDay — la journée alimentaire complète, rendue À L'IDENTIQUE
	 * dans l'espace cliente et dans la Vision 360 du CRM coach.
	 *
	 * Une seule source de vérité visuelle : carte calories (objectif /
	 * filet de sécurité / maintenance), anneaux macros, et les 4 repas avec
	 * leurs lignes alimentaires (image, nom, kcal, portion).
	 *
	 * RÈGLE ABSOLUE — PLANIFIÉ ≠ CONSOMMÉ :
	 * - `entries` (consommé) alimente le header, la barre et les donuts ;
	 * - `planned` (plan coach + préparation cliente) est affiché GRIS avec un
	 *   cercle vide et n'impacte RIEN — seul un total secondaire « prévu »
	 *   apparaît (repas + carte). Tap sur le cercle = « Mangé » (via onToggleEat).
	 * - EXCEPTION jour FUTUR uniquement : les anneaux macros affichent les
	 *   macros PRÉVUES (`plannedTotals`, même source que les kcal prévues) en
	 *   rendu atténué — pour préparer sa journée. Jamais interprétées comme
	 *   consommées : rien n'est écrit, aucune donnée réelle n'est modifiée.
	 *
	 * mode="client" : la ligne est cliquable → feuille de quantité (édition).
	 * mode="coach"  : mêmes lignes + commandes compactes − / + / supprimer.
	 */
import Icon from './Icon.svelte';
import FoodImg from './FoodImg.svelte';
import { currentLocalDay } from '$lib/currentDay.svelte';
import {
	etatJauge,
	libellePhaseJauge,
	phaseDesObjectifs,
	type TonJauge
} from '$lib/phaseAffichage';
import { etatFibres, type BilanJourData } from '$lib/bilanJour';
import { formatDetailValue } from '$lib/foodDetailsFormat';

	type Entry = {
		_id: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		/** Miniature miroir G-FLUX (copie OFF 100 px) — prioritaire sur imageUrl. */
		thumbUrl?: string;
		/** Photo posée par la cliente sur SON aliment (« Créés par moi ») —
		 *  snapshot de l'URL signée à l'ajout, affichée comme toute image. */
		photoUrl?: string;
		qtyGrams: number;
		kcal: number;
		carbs: number;
		protein: number;
		fat: number;
		meal: string;
		portions?: number;
		/** « planned_eaten » : validé depuis un item planifié (✓ vert discret + remettre en planifié). */
		source?: string;
		/** Regroupement « repas analysé » (photo IA) : N composants d'une même
		 *  analyse → UNE carte repliable dans le Journal (client uniquement). */
		mealGroup?: string;
		/** Identité d'origine (duplication / création de repas) — snapshot sinon. */
		foodId?: string;
		customFoodId?: string;
		ciqualLabel?: string;
	};
	type Planned = {
		_id: string;
		/** Date "yyyy-mm-dd" de l'item (frontière « Mangé » : jamais au futur). */
		date: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		/** Miniature miroir G-FLUX (copie OFF 100 px) — prioritaire sur imageUrl. */
		thumbUrl?: string;
		/** Photo posée par la cliente sur SON aliment (« Créés par moi »). */
		photoUrl?: string;
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
	type Day = {
		date: string;
		/** `phase` : phase effective de la fiche (absente = perte de gras). */
		goals: { kcal: number; carbs: number; protein: number; fat: number; maintenanceKcal?: number; phase?: string };
		goalsSet?: boolean;
		entries: Entry[];
		totals: { kcal: number; carbs: number; protein: number; fat: number };
		/** Items planifiés (non consommés) du jour — grisés, zéro impact header. */
		planned?: Planned[];
		plannedTotals?: { kcal: number; carbs: number; protein: number; fat: number };
	};

	let {
		day,
		mode = 'client',
		tip = null,
		onAdd,
		/** Accès rapide « Photographier mon repas » (bouton photo à côté du +). */
		onPhoto,
		onEntryClick,
		/** Clic sur une carte macro (Glucides / Protéines / Lipides — jamais Calories) → vue détail. */
		onMacroClick,
		onPlannedClick,
		onToggleEat,
		onEatAllMeal,
		canEat = true,
		selMode = false,
		selIds,
		onToggleSel,
		onQty,
		onRemove,
		onCalCardMount,
		onMacroCardsMount,
		onTipDismiss,
		/** Bilan nutritionnel du jour (cliente) — `null` = masqué. */
		bilanJour = null,
		bilanEtat = 'inactif',
		onOpenBilanJour,
	}: {
		day: Day;
		mode?: 'client' | 'coach';
		/** Astuce du jour (côté client uniquement) — affichée entre macros et repas. */
		tip?: string | null;
		onAdd?: (meal: string) => void;
		onPhoto?: (meal: string) => void;
		onEntryClick?: (e: Entry) => void;
		/** Clic sur une carte macro (Glucides / Protéines / Lipides — jamais Calories) → vue détail. */
		onMacroClick?: (macro: 'carbs' | 'protein' | 'fat') => void;
		onPlannedClick?: (p: Planned) => void;
		/** Cercle « Mangé » d'un item planifié (planned → consommé). */
		onToggleEat?: (p: Planned) => void;
		/** « Tout marquer comme mangé » sur un repas (items planifiés du repas). */
		onEatAllMeal?: (meal: string) => void;
		/** False sur une date future : la validation « Mangé » n'est pas proposée. */
		canEat?: boolean;
		/** Mode sélection multiple (items planifiés). */
		selMode?: boolean;
		selIds?: Set<string>;
		onToggleSel?: (id: string) => void;
		onQty?: (e: Entry, qty: number) => void;
		onRemove?: (e: Entry) => void;
		onCalCardMount?: (el: HTMLElement | undefined) => void;
		onMacroCardsMount?: (el: HTMLElement | undefined) => void;
		onTipDismiss?: () => void;
		/** Bilan du jour (fibres, sucres, AGS, sel) — fourni par le Journal cliente. */
		bilanJour?: BilanJourData | null;
		/** État de la requête du bilan du jour : `inactif` = jamais demandé
		 *  (CRM coach) → aucune carte. `chargement` / `erreur` affichent la carte
		 *  immédiatement, à sa hauteur finale (R5c-sexies). */
		bilanEtat?: 'inactif' | 'chargement' | 'pret' | 'erreur';
		onOpenBilanJour?: () => void;
	} = $props();

	const MEAL_DEFS = [
		{ id: 'petit-dej', label: 'Petit-déjeuner', icon: 'sunrise' },
		{ id: 'dejeuner', label: 'Déjeuner', icon: 'utensils' },
		{ id: 'diner', label: 'Dîner', icon: 'moon' },
		{ id: 'collation', label: 'Collations', icon: 'cookie' },
	] as const;

	/** Compacité mobile cliente : paddings/tailles resserrés, coach (CRM) inchangé. */
	const compact = $derived(mode === 'client');

	/* ————— Saisie directe de la quantité (mode coach, CRM) —————
	   La valeur centrale entre − / + devient éditable au clic : input
	   numérique discret (inputmode="decimal", virgule acceptée), valeur
	   actuelle PRÉ-SÉLECTIONNÉE. Enter ou clic ailleurs valident, Échap
	   annule. Mêmes garde-fous que l'endpoint (updateEntryQtyForCoach :
	   1–5000 g) — invalide/vide → l'édition se referme SANS appel réseau.
	   Les kcal/macros sont recalculées côté serveur (loadDay rafraîchit). */
	let qtyEditId = $state<string | null>(null);
	let qtyDraft = $state('');
	let qtyEditInput: HTMLInputElement | undefined = $state();
	/** Valeur TOUT JUSTE validée (blur avant clic sur − / +) : l'incrément
	 *  part d'elle, pas d'une prop pas encore rechargée par le serveur. */
	let qtyCommitted: { id: string; val: number } | null = null;
	function openQtyEdit(e: Entry) {
		qtyEditId = e._id;
		qtyDraft = String(e.qtyGrams).replace('.', ',');
		// Sélection complète de la valeur : on tape directement par-dessus.
		setTimeout(() => {
			qtyEditInput?.focus();
			qtyEditInput?.select();
		}, 0);
	}
	function closeQtyEdit() {
		qtyEditId = null;
		qtyDraft = '';
	}
	function applyQtyEdit(e: Entry) {
		if (qtyEditId !== e._id) return; // déjà refermée (Échap) ou autre ligne
		const v = parseFloat(qtyDraft.replace(',', '.').trim());
		if (isFinite(v) && v >= 1 && v <= 5000) {
			const val = Math.round(v * 10) / 10;
			qtyCommitted = { id: e._id, val };
			if (val !== e.qtyGrams) onQty?.(e, val);
		}
		// Vide / 0 / négatif / invalide / > 5000 : refermé SANS appel réseau —
		// la ligne garde sa valeur (mêmes bornes que updateEntryQtyForCoach).
		closeQtyEdit();
	}
	/** − / + (comportement inchangé) : l'incrément part de la valeur validée
	 *  à l'instant (blur) si le coach vient de saisir un montant, sinon de la
	 *  valeur affichée — jamais d'une prop en retard sur le serveur. */
	function bumpQty(e: Entry, delta: number) {
		const base = qtyCommitted && qtyCommitted.id === e._id ? qtyCommitted.val : e.qtyGrams;
		qtyCommitted = null;
		onQty?.(e, delta < 0 ? Math.max(1, base + delta) : base + delta);
	}

	/* ————— Regroupement « repas analysé » (photo IA) —————
	 * Les composants d'une même analyse partagent `mealGroup` : ils sont
	 * retirés des listes plates et rendus comme UNE carte repliable
	 * (« 🍽️ Repas analysé · ≈ X kcal · N éléments » → tap = détail).
	 * Totaux du jour/repas INCHANGÉS : ils somment toujours les entrées. */
	type EntryGroup = { key: string; entries: Entry[]; kcal: number; protein: number };
	const groupsByMeal = $derived.by(() => {
		const map = new Map<string, EntryGroup[]>();
		const loose = new Map<string, Entry[]>();
		for (const m of MEAL_DEFS) {
			map.set(m.id, []);
			loose.set(m.id, []);
		}
		const byKey = new Map<string, Entry[]>();
		for (const e of day.entries) {
			if (e.mealGroup && mode === 'client') {
				const arr = byKey.get(e.mealGroup) ?? [];
				arr.push(e);
				byKey.set(e.mealGroup, arr);
			} else {
				loose.get(e.meal)?.push(e);
			}
		}
		for (const [key, entries] of byKey) {
			map.get(entries[0].meal)?.push({
				key,
				entries,
				kcal: entries.reduce((s, e) => s + e.kcal, 0),
				protein: entries.reduce((s, e) => s + e.protein, 0),
			});
		}
		return { map, loose };
	});
	const mealGroups = (meal: string): EntryGroup[] => groupsByMeal.map.get(meal) ?? [];
	/** Entrées hors groupe (rendu historique, une ligne par aliment). */
	const mealLooseEntries = (meal: string): Entry[] => groupsByMeal.loose.get(meal) ?? [];
	/** Cartes dépliées (tap sur une carte « repas analysé » = détail des composants). */
	let expandedGroups = $state<Set<string>>(new Set());
	function toggleGroup(key: string) {
		const next = new Set(expandedGroups);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expandedGroups = next;
	}
	/** Libellé de carte : « Poulet grillé, riz basmati… » — à partir des composants. */
	function groupLabel(g: EntryGroup): string {
		const names = g.entries.map((e) => e.name);
		if (names.length === 1) return names[0];
		if (names.length === 2) return names.join(' & ');
		return `${names[0]}, ${names[1]}…`;
	}

	let calCardEl: HTMLElement | undefined;
	let macroCardsEl: HTMLElement | undefined;
	// Expose l'élément « carte calories » au parent (barre sticky côté client).
	$effect(() => {
		onCalCardMount?.(calCardEl);
		return () => onCalCardMount?.(undefined);
	});
	// Expose les cartes macros : la barre sticky ne s'affiche qu'une fois celles-ci sorties de l'écran.
	$effect(() => {
		onMacroCardsMount?.(macroCardsEl);
		return () => onMacroCardsMount?.(undefined);
	});

	/* ————— Totaux & calculs — CONSOMMÉ UNIQUEMENT (single source of truth) ————— */
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
	/** Jour FUTUR consulté : les anneaux macros affichent les macros PRÉVUES
	 *  (plannedTotals — même source que les « kcal prévues ») en rendu atténué.
	 *  Aujourd'hui / passé : consommé uniquement, comportement inchangé.
	 *  Garde SSR : currentLocalDay() n'est lu que côté navigateur (le module
	 *  crée un $state + listeners window → jamais exécuté pendant le prerender). */
	const isFutureDay = $derived(typeof window !== 'undefined' && day.date > currentLocalDay());
	/** Source unique des macros affichées dans les anneaux : consommé, sauf
	 *  jour futur → prévu (plannedTotals). AUCUN double comptage : une même
	 *  donnée (planned OU diary) alimente kcal prévues ET macros prévues. */
	const macrosShown = $derived.by(() => {
		if (isFutureDay && day.plannedTotals) {
			return { carbs: day.plannedTotals.carbs, protein: day.plannedTotals.protein, fat: day.plannedTotals.fat };
		}
		return { carbs: totals.carbs, protein: totals.protein, fat: totals.fat };
	});
	/** Style « prévu » des anneaux : atténué / désaturé — cohérent avec les
	 *  lignes d'aliments planifiés (grisées, opacité réduite). Lié à la
	 *  PRÉSENCE de plannedTotals (API cliente uniquement) → le rendu coach
	 *  (Vision 360, API sans plannedTotals) reste strictement inchangé.
	 *  $derived (jamais lu à l'init du module) — réactivité + warning svelte éteint. */
	const macrosPlanned = $derived(isFutureDay && !!day.plannedTotals);
	/** Gris neutre unique du mode « prévu » : titres, icônes, arcs, pourcentages
	 *  et valeurs — TOUTE identité rose/bleu/orange est retirée sur jour futur,
	 *  pour être lu d'emblée comme « ceci est prévu, pas encore consommé ». */
	const PLANNED_GRAY = '#9aa19a';
	/* Items planifiés : information secondaire (JAMAIS dans les anneaux / barre). */
	const plannedItems = $derived(day.planned ?? []);
	const plannedKcalTotal = $derived(Math.round(day.plannedTotals?.kcal ?? 0));
	const remaining = $derived(Math.max(0, day.goals.kcal - totals.kcal));
	/** Phase effective de la fiche — lue telle quelle (jamais déduite des chiffres). */
	const phase = $derived(phaseDesObjectifs(day.goals));
	/** Libellé « Phase : maintenance / surplus » sous la jauge (rien en perte de gras). */
	const phaseJaugeLabel = $derived(libellePhaseJauge(phase));
	/** État de la jauge par phase — module pur partagé ($lib/phaseAffichage). */
	const jauge = $derived(
		etatJauge(phase, {
			total: totals.kcal,
			objectifKcal: day.goals.kcal,
			maintenanceKcal: day.goals.maintenanceKcal
		})
	);
	/** Filet de sécurité : perte de gras uniquement (maintenance > objectif). */
	const maintenanceKcal = $derived(jauge.filetActif ? (day.goals.maintenanceKcal ?? null) : null);
	/** Échelle de la barre : la maintenance quand elle existe (zone filet comprise), sinon l'objectif. */
	const barScale = $derived(jauge.cibleKcal);
	const kcalPct = $derived(barScale > 0 ? Math.min(100, (totals.kcal / barScale) * 100) : 0);
	const overGoal = $derived(jauge.depasse);
	const inSafetyNet = $derived(!!maintenanceKcal && totals.kcal > day.goals.kcal && totals.kcal <= maintenanceKcal);
	const overMaintenance = $derived(jauge.depasseMaintenance);
	/** Position du marqueur « Objectif » sur la barre (en % de l'échelle). */
	const goalMarkPct = $derived(barScale > 0 ? (day.goals.kcal / barScale) * 100 : 0);
	/** Teintes par ton — le rouge n'existe qu'en perte de gras. */
	const TON_COULEUR: Record<TonJauge, string> = {
		brand: '#1db954',
		neutre: '#66716b',
		warn: '#f59e0b',
		danger: '#ef4444'
	};
	/** Couche VISUELLE (refonte premium) : correspondance ton → classes.
	 *  AUCUNE logique : simple décoration dérivée de l'état de la jauge. */
	const TON_CLASSES: Record<
		TonJauge,
		{ border: string; bg: string; badge: string; icon: string; soft: string; bar: string }
	> = {
		danger: { border: 'border-danger/40', bg: 'bg-danger-light/40', badge: 'bg-danger-light', icon: 'text-danger', soft: 'text-danger/80', bar: 'bg-danger' },
		warn: { border: 'border-warn/50', bg: 'bg-warn-light/30', badge: 'bg-warn-light', icon: 'text-warn', soft: 'text-warn', bar: 'bg-warn' },
		neutre: { border: 'border-line', bg: 'bg-soft/40', badge: 'bg-soft', icon: 'text-mist', soft: 'text-mist', bar: 'bg-mist' },
		brand: { border: 'border-brand/30', bg: 'bg-brand-light/20', badge: 'bg-brand-light', icon: 'text-brand', soft: 'text-brand/80', bar: 'bg-brand' }
	};
	/** Teinte contextuelle des calories (filet de sécurité compris). */
	const kcalTone = $derived(TON_COULEUR[jauge.ton]);
	const cardTone = $derived(TON_CLASSES[jauge.ton]);

	function mealEntries(meal: string) {
		return day.entries.filter((e) => e.meal === meal);
	}
	function mealPlanned(meal: string) {
		return plannedItems.filter((p) => p.meal === meal);
	}
	function mealKcal(meal: string) {
		return Math.round(mealEntries(meal).reduce((s, e) => s + e.kcal, 0));
	}
	function mealPlannedKcal(meal: string) {
		return Math.round(mealPlanned(meal).reduce((s, p) => s + p.kcal, 0));
	}
	/** Part du repas dans l'objectif calorique du jour (affichage type FOOD) — consommé uniquement. */
	function mealPct(meal: string) {
		return day.goals.kcal > 0 ? Math.round((mealKcal(meal) / day.goals.kcal) * 100) : 0;
	}
	/** Pourcentage réel consommé/objectif — jamais plafonné à 100 (l'anneau,
	 *  lui, reste plafonné visuellement). */
	function macroPct(eaten: number, goal: number) {
		return goal > 0 ? (eaten / goal) * 100 : 0;
	}
	function fmt(n: number) {
		return n.toLocaleString('fr-FR');
	}
	const rings = $derived([
		{ label: 'Glucides', icon: 'wheat', color: '#ec4899', eaten: macrosShown.carbs, goal: day.goals.carbs },
		{ label: 'Protéines', icon: 'drumstick', color: '#3b82f6', eaten: macrosShown.protein, goal: day.goals.protein },
		{ label: 'Lipides', icon: 'droplet', color: '#f97316', eaten: macrosShown.fat, goal: day.goals.fat },
	]);
	/* Carte « Fibres » (cliente uniquement) :
	   - jour VIDE : 0 g / repère et jauge vide, comme les anneaux macros à 0 % ;
	   - jour renseigné : trois états sobres selon la couverture — jamais de rouge. */
	const fibresLine = $derived(
		compact && bilanJour
			? bilanJour.aliments > 0
				? etatFibres(bilanJour.fibres, bilanJour.repere, bilanJour.couverture)
				: etatFibres(0, bilanJour.repere, 100)
			: null
	);
	/* Mission R5c-sexies — la carte est rendue DÈS la première image côté
	   cliente, même sans donnée : elle garde sa hauteur finale pendant le
	   chargement (valeur neutre, jauge vide) et en cas d'erreur (« — », carte
	   toujours cliquable). Aucun saut de mise en page à l'arrivée des fibres.
	   `inactif` (CRM coach, aucune requête) → aucune carte, rendu inchangé. */
	const fibresCard = $derived(compact && bilanEtat !== 'inactif');
	/** Données pas encore là (hors erreur) : valeur neutre pulsée. */
	const fibresLoading = $derived(fibresCard && !fibresLine && bilanEtat !== 'erreur');
	/** Requête en échec : « — », le journal n'est jamais bloqué. */
	const fibresError = $derived(fibresCard && !fibresLine && bilanEtat === 'erreur');

	function isSel(id: string) {
		return selIds?.has(id) ?? false;
	}

	/** Priorité de chargement : les 4 PREMIÈRES entrées (réellement visibles à
	 *  l'ouverture du Journal) chargent en eager + fetchpriority high — jamais
	 *  toute la liste (le reste reste en lazy). */
	const eagerEntryIds = $derived.by(() => new Set(day.entries.slice(0, 4).map((e) => e._id)));
</script>

<!-- Carte calories — uniquement le CONSOMMÉ (les kcal prévues restent secondaires).
     Refonte PREMIUM — couche visuelle uniquement : teinte d'état + halo doux
     (dérivé de kcalTone), badge bouclier/alerte, barre fine à marqueur net.
     Aucun calcul, aucun seuil, aucun texte métier modifié. -->
<section
	bind:this={calCardEl}
	class="mb-2.5 rounded-[24px] border transition-[border-color,background-color,box-shadow] duration-300 {cardTone.border} {cardTone.bg} {compact ? 'px-[18px] py-4' : 'p-4 md:p-[18px]'}"
	style:box-shadow={`0 2px 6px rgba(16, 24, 40, 0.04), 0 18px 40px -22px ${kcalTone}59`}
>
	<div class="flex items-start justify-between {compact ? 'gap-3' : 'gap-3'} md:gap-4">
		<div class="min-w-0">
			<p class="{compact ? 'text-[15px]' : 'text-sm'} font-bold text-[#3a4540]">
				{overGoal ? (overMaintenance ? 'Maintenance dépassée de' : phase === 'perte_gras' ? 'Objectif dépassé de' : 'Au-dessus de l’objectif de') : 'Il te reste'}
			</p>
			<p class="mt-0.5 flex items-baseline gap-2">
				<span class="font-black leading-[1.05] tracking-[-0.04em] text-ink tabular-nums {compact ? 'text-[40px]' : 'text-4xl md:text-[40px]'}">
					{overGoal ? fmt(jauge.depassementKcal) : fmt(remaining)}
				</span>
				<span class="{compact ? 'text-[17px]' : 'text-[15px] md:text-[17px]'} font-bold text-mist">kcal</span>
			</p>
		</div>
		<span class="grid {compact ? 'h-[42px] w-[42px] rounded-[21px]' : 'h-10 w-10 md:h-[42px] md:w-[42px] md:rounded-[21px]'} shrink-0 place-items-center rounded-full bg-white {cardTone.badge}" style:box-shadow="0 6px 16px -8px rgba(15,21,18,0.3)" aria-hidden="true">
			<Icon name={overMaintenance ? 'bell' : overGoal && phase !== 'perte_gras' ? 'info' : 'shieldCheck'} size={compact ? 24 : 20} class={cardTone.icon} />
		</span>
	</div>
	{#if compact}
		{#if inSafetyNet || overMaintenance}
			<p class="mt-2.5 flex items-center gap-2 text-[14px] font-bold {cardTone.soft}">
				<Icon name={overMaintenance ? 'triangleAlert' : 'activity'} size={18} class="shrink-0" />
				{overMaintenance ? 'On ajuste ensemble — ça reste dans le cadre.' : 'Dans ton filet de sécurité'}
			</p>
		{/if}
	{:else}
		{#if inSafetyNet}
			<p class="mt-1 flex items-center gap-1.5 text-xs font-semibold {cardTone.soft}"><Icon name="activity" size={13} class="shrink-0" /> Dans ton filet de sécurité</p>
		{/if}
		{#if overMaintenance}
			<p class="mt-1 flex items-center gap-1.5 text-xs font-semibold {cardTone.soft}"><Icon name="triangleAlert" size={13} class="shrink-0" /> Ta journée reste dans le cadre sur la durée — on ajuste ensemble si besoin.</p>
		{/if}
	{/if}
	<div class="relative w-full overflow-hidden rounded-[5px] bg-[#e8edea] {compact ? 'mt-3.5 h-[10px]' : 'mt-3 h-2.5 md:h-[10px]'}">
		{#if maintenanceKcal}
			<!-- Zone « filet de sécurité » entre l'objectif et la maintenance -->
			<div class="absolute inset-y-0 rounded-full bg-warn-light" style="left: {goalMarkPct}%; right: 0"></div>
		{/if}
		<div class="relative h-full rounded-[5px] transition-[width] duration-500 ease-out {cardTone.bar}" style:width="{kcalPct}%"></div>
		{#if maintenanceKcal}
			<!-- Marqueur vertical de l'objectif (la cible principale) -->
			<div class="absolute top-[-3px] bottom-[-3px] w-[3px] rounded-[2px] bg-ink/50" style="left: {goalMarkPct}%" title="Objectif : {fmt(day.goals.kcal)} kcal"></div>
		{/if}
	</div>
	<div class="flex items-baseline justify-between gap-2 {compact ? 'mt-3 text-[13px]' : 'mt-3 text-[13px]'}">
		<span class="max-w-full min-w-0 break-words font-bold tabular-nums {overMaintenance ? 'text-danger' : overGoal ? 'text-warn' : 'text-brand'}">
			{fmt(Math.round(totals.kcal))} kcal consommées{#if plannedKcalTotal > 0}<span class="font-normal text-mist"> · {fmt(plannedKcalTotal)} prévues</span>{/if}
		</span>
		<span class="text-right">
			<span class="font-bold text-ink">Objectif : {fmt(day.goals.kcal)}</span>
			{#if maintenanceKcal}
				<span class="ml-1 text-mist {compact ? 'text-[13px]' : 'text-[11px]'}">· Maint. : {fmt(maintenanceKcal)}</span>
			{/if}
		</span>
	</div>
	{#if phaseJaugeLabel}
		<p class="mt-1.5 text-[11px] font-semibold text-mist">{phaseJaugeLabel}</p>
	{/if}
</section>

<!-- Macros type FOOD : le RING est l'élément visuel principal de la card.
     CONSOMMÉ / OBJECTIF — sauf jour FUTUR : macros PRÉVUES (plannedTotals,
     même source que les kcal prévues) en rendu atténué (gris + désaturé),
     jamais interprétées comme consommées (aucune écriture, aucun comptage). -->
<section bind:this={macroCardsEl} class="grid grid-cols-3 {compact ? 'mb-3.5 gap-2' : 'mb-2.5 gap-2'}">
	{#each rings as ring (ring.label)}
		{@const pct = macroPct(ring.eaten, ring.goal)}
		{@const ringFill = Math.min(100, pct)}
		{@const circ = 2 * Math.PI * 32}
		{@const macroKey = ring.label === 'Glucides' ? 'carbs' : ring.label === 'Protéines' ? 'protein' : 'fat'}
		{@const clickable = mode === 'client' && !!onMacroClick}
		<div
			class="rounded-[20px] border border-[#EEF1EF] bg-white text-center shadow-[0_1px_2px_rgba(15,21,18,0.04),0_12px_26px_-16px_rgba(15,21,18,0.18)] {compact ? 'px-1.5 pb-[11px] pt-2.5' : 'px-2 pb-2.5 pt-2.5'} {macrosPlanned ? 'opacity-60 saturate-50' : ''} {clickable ? 'cursor-pointer outline-none transition duration-150 hover:shadow-sm active:scale-[0.97]' : ''}"
			role={clickable ? 'button' : undefined}
			tabindex={clickable ? 0 : undefined}
			aria-label={clickable ? `Voir le détail des ${ring.label.toLowerCase()}` : undefined}
			onclick={clickable ? () => onMacroClick?.(macroKey) : undefined}
			onkeydown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMacroClick?.(macroKey); } } : undefined}
		>
			<div class="mb-1.5 flex items-center justify-center gap-1 px-0.5">
				<span class="font-bold {compact ? 'text-[12.5px] text-[#3A4540]' : 'text-[12.5px]'} {macrosPlanned ? 'text-mist' : 'text-ink'}">{ring.label}</span>
			</div>
			<div class="relative mx-auto {compact ? 'h-[64px] w-[64px]' : 'h-[64px] w-[64px] md:h-[84px] md:w-[84px]'}">
				<svg viewBox="0 0 76 76" class="-rotate-90 {compact ? 'h-[64px] w-[64px]' : 'h-[64px] w-[64px] md:h-[84px] md:w-[84px]'}">
					<circle cx="38" cy="38" r="32" fill="none" stroke="#eef0ec" stroke-width={compact ? 7 : 7} />
					<circle
						cx="38"
						cy="38"
						r="32"
						fill="none"
						stroke={macrosPlanned ? PLANNED_GRAY : ring.color}
						stroke-width={compact ? 7 : 7}
						stroke-linecap="round"
						stroke-dasharray={circ}
						stroke-dashoffset={circ * (1 - ringFill / 100)}
						style="transition: stroke-dashoffset .5s"
					/>
				</svg>
				<span class="absolute inset-0 grid place-items-center font-black leading-none" style:color={macrosPlanned ? PLANNED_GRAY : ring.color}>
					<span class="{compact ? 'text-[14px]' : 'text-[14px] md:text-[18px]'}">{Math.round(pct)}%</span>
				</span>		</div>
		<p class="{macrosPlanned ? 'text-mist' : 'text-ink'} {compact ? 'mt-1.5 text-[12.5px]' : 'mt-0.5 text-[12.5px]'}">
			<strong class="font-bold tabular-nums {macrosPlanned ? 'text-mist' : 'text-ink'}">{fmt(Math.round(ring.eaten))}</strong><span class="text-mist">/{fmt(ring.goal)}g</span>
		</p>
		</div>
	{/each}
</section>

<!-- Carte FIBRES DU JOUR (Missions R5c-ter / R5c-sexies) — seule carte pleine
     largeur sous les 3 cartes macros : icône, libellé / valeur, jauge et chevron.
     La CARTE ENTIÈRE est le bouton d'ouverture du volet (plus aucun lien texte).
     Couleur PROPRE aux fibres (`fibres`, sarcelle) : jamais le vert des
     calories et des repas. Jauge pleine quand la couverture est complète,
     grise quand le total est un minimum, absente quand les données sont
     insuffisantes. Jamais de rouge. Jour vide : « 0 g / repère », jauge vide.

     R5c-sexies — la carte est rendue DÈS la première image côté cliente :
     pendant le chargement la valeur est un gris neutre pulsé et la jauge est
     vide, en cas d'erreur elle affiche « — » et reste cliquable. La jauge et
     sa légende occupent une hauteur RÉSERVÉE : les fibres qui arrivent ne
     décalent jamais les repas (aucun saut de mise en page). -->
{#if fibresCard}
	<button
		type="button"
		class="mb-3.5 flex w-full items-center gap-3 rounded-[20px] border border-[#EEF1EF] bg-white px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(15,21,18,0.04),0_10px_22px_-18px_rgba(15,21,18,0.18)] transition active:scale-[0.99]"
		aria-label="Voir le bilan nutritionnel du jour"
		aria-busy={fibresLoading}
		onclick={() => onOpenBilanJour?.()}
	>
		<!-- Icône : carré pâle aux couleurs des fibres (même gabarit que les repas). -->
		<span
			aria-hidden="true"
			class="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] bg-fibres-light text-fibres-deep"
		>
			<Icon name="leaf" size={18} />
		</span>
		<!-- Centre : libellé / valeur sur une ligne, jauge pleine largeur dessous. -->
		<div class="min-w-0 flex-1">
			<div class="flex min-w-0 items-baseline justify-between gap-2">
				{#if fibresError}
					<span class="shrink-0 text-[13px] font-bold text-ink">Fibres</span>
					<span class="shrink-0 text-[13px] font-bold text-mist tabular-nums" aria-label="Fibres indisponibles"
						>—</span
					>
				{:else if fibresLoading}
					<span class="shrink-0 text-[13px] font-bold text-ink">Fibres</span>
					<span class="shrink-0 animate-pulse text-[13px] font-bold text-mist tabular-nums" aria-hidden="true">—</span>
					<span class="sr-only">Chargement des fibres</span>
				{:else if fibresLine?.mention === 'insuffisant'}
					<span class="min-w-0 flex-1 truncate text-[12px] font-semibold leading-snug text-mist">
						Fibres : pas assez de données aujourd'hui
					</span>
				{:else if fibresLine}
					<span class="shrink-0 text-[13px] font-bold text-ink">Fibres</span>
					<span class="shrink-0 text-[13px] font-bold text-ink tabular-nums">
						{#if fibresLine.mention === 'au-moins'}<span class="text-[10.5px] font-semibold text-mist"
								>au moins </span
							>{/if}{fibresLine.valeur === 0 ? '0' : formatDetailValue(fibresLine.valeur, 'g')} g{' '}<span
							class="font-semibold text-mist">/ {bilanJour?.repere} g</span
						>
					</span>
				{/if}
			</div>
			<!-- Hauteur RÉSERVÉE de la jauge : toujours présente, remplie quand
			     les données sont là — les repas ne bougent jamais. -->
			<div class="mt-1.5 h-2 w-full" aria-hidden="true">
				{#if fibresLine?.jauge}
					<div class="h-2 w-full overflow-hidden rounded-full bg-[#e8edea]">
						<div
							class="h-full rounded-full transition-[width] duration-500 ease-out {fibresLine.niveau === 'complete'
								? 'bg-fibres'
								: 'bg-mist'}"
							style:width="{fibresLine.pct}%"
						></div>
					</div>
				{:else if fibresLoading || fibresError}
					<div class="h-2 w-full overflow-hidden rounded-full bg-[#e8edea]"></div>
				{/if}
			</div>
			<!-- Légende : hauteur réservée elle aussi (état « données incomplètes »). -->
			<p class="mt-1 h-[13px] text-[10.5px] font-semibold leading-[13px] text-mist">
				{fibresLine?.niveau === 'partielle' ? 'Données incomplètes' : ''}
			</p>
		</div>
		<!-- Chevron gris, centré verticalement. -->
		<Icon name="chevronRight" size={18} class="shrink-0 self-center text-mist" />
	</button>
{/if}

<!-- Repas -->
{#each MEAL_DEFS as meal (meal.id)}
	{@const entries = mealEntries(meal.id)}
	{@const planned = mealPlanned(meal.id)}
	{@const plannedKcal = mealPlannedKcal(meal.id)}
	{#if compact}
		<!-- Type FOOD : le repas est une SECTION — titre, total kcal & % et petit + sont
		     HORS carte ; la carte blanche contient uniquement les aliments. Repas vide = aucun bloc. -->
		<section class="mb-1">			<div class="flex items-center justify-between gap-2 px-1">
				<div class="min-w-0">
					<!-- Composition MAQUETTE CLAUDE : badge 28px + titre 17px/900 +
					     métrique kcal · % sur la MÊME baseline (jamais une 2e ligne).
					     (Le gabarit « kcal sous le titre » est supprimé : l'écart vs
					     la maquette était visible sur iPhone. Les tests de compaction
					     sont mis à jour en conséquence.) -->
					<h2 class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<span aria-hidden="true" class="grid h-[28px] w-[28px] shrink-0 self-center place-items-center rounded-[9px] bg-brand-light text-brand"><Icon name={meal.icon} size={17} /></span>
						<span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span class="shrink-0 text-[17px] font-black leading-[1.1] tracking-[-0.02em] text-ink">{meal.label}</span>
						<span class="max-w-full whitespace-normal text-[12.5px] font-bold text-brand-deep tabular-nums">{#if mealKcal(meal.id) > 0 || plannedKcal === 0}{fmt(mealKcal(meal.id))} kcal · {mealPct(meal.id)} %{#if plannedKcal > 0}<span class="font-normal text-mist">· {fmt(plannedKcal)} prévues</span>{/if}{:else}<span class="inline-block font-normal text-mist">{fmt(plannedKcal)} kcal prévues</span>{/if}</span>
						</span>
					</h2>
				</div>
				<div class="flex shrink-0 items-center gap-1.5">
					{#if planned.length > 0 && canEat && onEatAllMeal}
						<button
							type="button"
							class="flex items-center gap-1 rounded-full border border-brand/40 bg-brand-light/60 px-2.5 py-1.5 text-[11px] font-bold text-brand-dark transition hover:bg-brand-light active:scale-95"
							onclick={() => onEatAllMeal(meal.id)}
						>
							<Icon name="check" size={12} />
							Tout manger
						</button>
					{/if}
					{#if onAdd}
						<div class="flex shrink-0 items-center self-center">						{#if onPhoto}
							<button
								type="button"
								class="grid h-11 w-11 place-items-center text-brand transition active:scale-90"
								aria-label={`Photographier le ${meal.label}`}
								title="Photographier mon repas"
								onclick={() => onPhoto(meal.id)}
							><span class="grid h-[30px] w-[30px] rounded-[15px] place-items-center bg-brand-light text-brand"><Icon name="camera" size={15} /></span></button>
							{/if}
							<button
								type="button"
								class="grid h-11 w-11 place-items-center text-brand transition active:scale-90"
								aria-label={`Ajouter au ${meal.label}`}
								onclick={() => onAdd(meal.id)}
							><span class="grid h-[30px] w-[30px] rounded-[15px] place-items-center bg-brand-light text-brand"><Icon name="plus" size={15} strokeWidth={2.2} /></span></button>
						</div>
					{/if}
				</div>
			</div>
			{#if mealLooseEntries(meal.id).length > 0 || mealGroups(meal.id).length > 0 || planned.length > 0}
				<!-- mt-2.5 : ~10 px d'air entre la ligne kcal/% et la carte d'aliments
				     (retour respiration demandé) — titre → kcal reste compact -->
				<div class="mt-2.5 overflow-hidden rounded-2xl border border-line bg-card">
					<div class="divide-y divide-line/60">
						{#each mealLooseEntries(meal.id) as e (e._id)}
							{@render mealRow(e)}
						{/each}
						<!-- Repas analysés (photo IA) : UNE carte repliable par analyse,
						     totaux déjà comptés dans le header (aucun double comptage) -->
						{#each mealGroups(meal.id) as g (g.key)}
							<div class="px-2 py-1.5">
								<button
									type="button"
									class="flex w-full items-center gap-2 rounded-lg text-left transition hover:bg-line/40"
									aria-expanded={expandedGroups.has(g.key)}
									onclick={() => toggleGroup(g.key)}
								>
									<!-- Provenance IA : les groupes ne contiennent QUE des analyses
						     Repas IA (mealGroup « analyse:… ») → encadré « IA » premium. -->
								<span class="relative grid shrink-0 place-items-center rounded-xl bg-brand-light {compact ? 'h-[44px] w-[44px]' : 'h-9 w-9'}">
									<span class="font-display {compact ? 'text-[11px]' : 'text-[10px]'} font-bold tracking-widest text-brand">IA</span>
									<Icon name="sparkles" size={compact ? 8 : 7} class="absolute right-0.5 top-0.5 text-brand/70" />
								</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate font-semibold text-ink {compact ? 'text-[14px]' : 'text-sm'}">🍽️ {groupLabel(g)}</span>
										<span class="block text-mist tabular-nums {compact ? 'text-[11px]' : 'text-[11px]'}">
											<strong class="font-bold text-brand">≈ {fmt(g.kcal)} kcal</strong>
											· {fmt(g.protein)} g protéines
											· {g.entries.length} élément{g.entries.length > 1 ? 's' : ''}
										</span>
									</span>
									<Icon name={expandedGroups.has(g.key) ? 'chevronDown' : 'chevronRight'} size={16} class="shrink-0 text-mist" />
								</button>
								{#if expandedGroups.has(g.key)}
									<div class="mt-1 divide-y divide-line/40 rounded-xl bg-line/20">
										{#each g.entries as e (e._id)}
											{@render mealRow(e)}
										{/each}
									</div>
								{/if}
							</div>
						{/each}
						{#each planned as p (p._id)}
							{@render plannedRow(p)}
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{:else}
		<!-- Coach (Vision 360) : structure historique inchangée -->
		<section class="mb-2.5 overflow-hidden rounded-2xl border border-line bg-card">
			<header class="flex items-center justify-between gap-2 px-3.5 pt-2.5">
				<h2 class="flex min-w-0 items-center font-display text-[15px] font-semibold text-ink">
					<Icon name={meal.icon} size={15} class="mr-1.5 shrink-0 text-brand" />{meal.label}
					{#if mealKcal(meal.id) > 0}
						<span class="ml-2 font-semibold text-brand tabular-nums text-xs">{fmt(mealKcal(meal.id))} kcal</span>
					{/if}
				</h2>
				{#if onAdd}
					<button
						type="button"
						class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand text-base font-bold text-white transition hover:bg-brand-dark"
						aria-label={`Ajouter au ${meal.label}`}
						onclick={() => onAdd(meal.id)}
					>+</button>
				{/if}
			</header>
			<div class="mt-1.5 px-1 pb-1">
				{#if entries.length === 0}
					<p class="px-2.5 py-2 text-center text-xs text-mist">Rien pour l'instant — ajoute un aliment avec « + ».</p>
				{:else}
					<div class="divide-y divide-line/60">
						{#each entries as e (e._id)}
							{@render mealRow(e)}
						{/each}
					</div>
				{/if}
			</div>
		</section>
	{/if}
{/each}

<!-- Astuce du jour (client uniquement) — tout en bas du Journal, après les repas.
     Grille : label → petit espace → texte ; ✕ ancré au coin supérieur droit. -->
{#if tip}
	<section class="relative mt-4 rounded-[20px] border-[1.5px] border-dashed border-brand/30 bg-brand-soft px-4 py-[14px]">
		{#if onTipDismiss}
			<button
				type="button"
				class="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-line/60 text-xs text-mist hover:bg-line"
				aria-label="Fermer l'astuce"
				onclick={onTipDismiss}
			>✕</button>
		{/if}
		<p class="{compact ? 'text-[9px]' : 'text-[11px]'} font-bold uppercase tracking-[0.12em] text-brand-deep">Astuce du jour</p>
		<p class="mt-1.5 {compact ? 'text-[13px]' : 'text-[15px]'} {onTipDismiss ? 'pr-8' : ''} leading-[1.45] text-ink">{tip}</p>
	</section>
{/if}

{#snippet mealRow(e: Entry)}
	{#if mode === 'client' && onEntryClick}
		<!-- Ligne compacte type FOOD : py-0.5 (client) — densité maximale
		     tout en gardant l'air autour des vignettes 44 px ; nom 14px +
		     kcal/quantité 11px intacts. -->
		<div class="flex w-full items-center {compact ? 'gap-2 px-2 py-0.5' : 'gap-2.5 px-2 py-1.5'}">
		<button
			type="button"
			class="flex min-w-0 flex-1 items-center text-left transition hover:bg-line/40 {compact ? 'gap-2' : 'gap-2.5'}"
			onclick={() => onEntryClick(e)}
		>
				{@render entryBody(e)}
				<!-- Item validé depuis un plan : check vert discret (état « Mangé ») -->
				{#if compact && e.source === 'planned_eaten'}
					<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 text-brand" title="Mangé">
						<Icon name="check" size={13} strokeWidth={3} />
					</span>
				{/if}
			</button>
			<!-- Rond de sélection type FOOD : TOUJOURS visible, vide → coché.
			     Sélection TEMPORAIRE uniquement (jamais un statut « mangé ») ;
			     le tap sur la ligne ouvre toujours la fiche de l'aliment.
			     Compact 22 px, bordure allégée 1,5 px + coche 10 px : visuellement
			     discret, toujours lisible ; after:-inset-[11px] garde la zone
			     tactile ~44 px sans changer l'apparence. -->
			<button
				type="button"
				class="relative grid {compact ? 'h-[22px] w-[22px] border-[1.5px]' : 'h-7 w-7 border-2'} shrink-0 place-items-center rounded-full transition after:absolute {compact ? 'after:-inset-[11px]' : 'after:-inset-2'} after:rounded-full after:content-[''] {isSel(e._id) ? 'border-brand bg-brand text-white' : 'border-line bg-white text-transparent'}"
				aria-label={isSel(e._id) ? 'Désélectionner' : 'Sélectionner'}
				onclick={() => onToggleSel?.(e._id)}
			>
				<Icon name="check" size={compact ? 10 : 13} strokeWidth={3} />
			</button>
		</div>
	{:else}
		<div class="flex w-full items-center {compact ? 'gap-2 px-2 py-0.5' : 'gap-2.5 px-2 py-1.5'}">
			{@render entryBody(e)}
			{#if mode === 'coach' && onQty && onRemove}
				<div class="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onclick={() => bumpQty(e, -10)}
						class="grid h-7 w-7 place-items-center rounded-lg border-2 border-line text-sm font-bold text-ink transition hover:border-brand"
						aria-label="Réduire la quantité"
					>−</button>
					<span class="w-16 text-center text-sm font-semibold text-ink tabular-nums">
						{#if qtyEditId === e._id}
							<!-- Saisie directe (mode coach) : champ discret, même largeur
							     que l'affichage — aucune mise en page qui saute. -->
							<input
								bind:this={qtyEditInput}
								type="text"
								inputmode="decimal"
								class="w-full rounded-md border-2 border-brand bg-white px-0.5 py-0.5 text-center text-sm font-semibold text-ink outline-none"
								bind:value={qtyDraft}
								aria-label="Quantité en grammes"
								onkeydown={(ev) => {
									if (ev.key === 'Enter') applyQtyEdit(e);
									else if (ev.key === 'Escape') closeQtyEdit();
								}}
								onblur={() => applyQtyEdit(e)}
							/>
						{:else}
							<button
								type="button"
								class="w-full rounded-md py-0.5 transition hover:bg-line/60"
								title="Cliquer pour saisir la quantité"
								aria-label={`Modifier la quantité (${e.qtyGrams} g)`}
								onclick={() => openQtyEdit(e)}
							>{e.qtyGrams} g</button>
						{/if}
					</span>
					<button
						type="button"
						onclick={() => bumpQty(e, 10)}
						class="grid h-7 w-7 place-items-center rounded-lg border-2 border-line text-sm font-bold text-ink transition hover:border-brand"
						aria-label="Augmenter la quantité"
					>＋</button>
					<button
						type="button"
						onclick={() => onRemove(e)}
						class="ml-1 grid h-7 w-7 place-items-center rounded-lg border-2 border-line text-danger transition hover:border-danger"
						title="Supprimer"
						aria-label="Supprimer cette entrée"
					><Icon name="trash" size={13} /></button>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

<!-- Ligne PLANIFIÉE : grisée + cercle vide — zéro impact sur le header tant que
     ce n'est pas validé « Mangé ». Rond à droite = sélection (Mangé / Supprimer
     via la barre d'actions quand le jour est arrivé) ; tap ligne = édition. -->
{#snippet plannedRow(p: Planned)}
	<div class="flex w-full items-center {compact ? 'gap-2 px-2 py-0.5' : 'gap-2.5 px-2 py-1.5'} bg-line/20">
		<button
			type="button"
			class="flex min-w-0 flex-1 items-center gap-2 text-left transition hover:bg-line/30 rounded-lg -mx-1 px-1 py-0.5"
			onclick={() => onPlannedClick?.(p)}
		>
			{#if p.thumbUrl || p.imageUrl}
				<FoodImg src={p.photoUrl ?? p.thumbUrl} fallbackSrc={p.imageUrl} alt="" eager={false} class="rounded-xl {compact ? 'h-[44px] w-[44px]' : 'h-9 w-9'} opacity-60 saturate-50" />
			{:else}
				<div class="grid shrink-0 place-items-center rounded-xl bg-brand-light/60 {compact ? 'h-[44px] w-[44px]' : 'h-9 w-9'} opacity-70"><Icon name="utensils" size={compact ? 15 : 16} class="text-brand/70" /></div>
			{/if}
			<span class="min-w-0 flex-1">
				<span class="block truncate font-semibold text-mist {compact ? 'text-[14px]' : 'text-sm'}">{p.name}</span>
				<span class="block text-mist/90 tabular-nums {compact ? 'text-[11px]' : 'text-[11px]'}">
					<span class="font-bold">{fmt(p.kcal)} kcal</span>
					· {fmt(p.qtyGrams)} g
					{#if p.source === 'coach_plan'}<span class="ml-1 rounded bg-line/60 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-mist">Coach</span>{/if}
				</span>
			</span>
		</button>
		<!-- Rond de sélection type FOOD : TOUJOURS visible, vide → coché.
		     « Mangé » est validé via la barre d'actions, jamais par ce rond.
		     Compact 22 px, bordure allégée 1,5 px + coche 10 px ;
		     after:-inset-[11px] garde la zone tactile ~44 px sans changer
		     l'apparence. -->
		<button
			type="button"
			class="relative grid {compact ? 'h-[22px] w-[22px] border-[1.5px]' : 'h-7 w-7 border-2'} shrink-0 place-items-center rounded-full transition after:absolute {compact ? 'after:-inset-[11px]' : 'after:-inset-2'} after:rounded-full after:content-[''] {isSel(p._id) ? 'border-brand bg-brand text-white' : 'border-line bg-white text-transparent'}"
			aria-label={isSel(p._id) ? 'Désélectionner' : 'Sélectionner'}
			onclick={() => onToggleSel?.(p._id)}
		>
			<Icon name="check" size={compact ? 10 : 13} strokeWidth={3} />
		</button>
	</div>
{/snippet}

{#snippet entryBody(e: Entry)}
	{#if e.thumbUrl || e.imageUrl}
		<!-- PROVENANCE Repas IA (mealGroup « analyse:… » persisté par le commit) :
		     photo conservée + mini macaron « IA » vert dans le coin — cliente
		     ET coach (composant partagé), discrètement identifiable. -->
		<span class="relative shrink-0">
			<FoodImg src={e.photoUrl ?? e.thumbUrl} fallbackSrc={e.imageUrl} alt="" eager={eagerEntryIds.has(e._id)} class="rounded-xl {compact ? 'h-[44px] w-[44px]' : 'h-9 w-9'}" />
			{#if e.mealGroup}<span class="absolute -right-1 -top-1 rounded-full bg-brand px-1 py-px text-[8px] font-bold tracking-wide text-white ring-2 ring-white/90">IA</span>{/if}
		</span>
	{:else if e.mealGroup}
		<!-- Repas IA sans photo : encadré vert pâle « IA » — même gabarit que la
		     vignette (44 px), étincelle discrète, aucune ligne texte en plus. -->
		<span class="relative grid shrink-0 place-items-center rounded-xl bg-brand-light {compact ? 'h-[44px] w-[44px]' : 'h-9 w-9'}">
			<span class="font-display {compact ? 'text-[11px]' : 'text-[10px]'} font-bold tracking-widest text-brand">IA</span>
			<Icon name="sparkles" size={7} class="absolute right-0.5 top-0.5 text-brand/70" />
		</span>
	{:else}
		<!-- Placeholder G-FLUX compact : même gabarit que la vignette (44 px),
		     icône réduite pour rester proportionnée. -->
		<div class="grid shrink-0 place-items-center rounded-xl bg-brand-light {compact ? 'h-[44px] w-[44px]' : 'h-9 w-9'}"><Icon name="utensils" size={compact ? 15 : 16} class="text-brand" /></div>
	{/if}
	<span class="min-w-0 flex-1">
		<span class="block truncate font-semibold text-ink {compact ? 'text-[14px]' : 'text-sm'}">{e.name}</span>
		<span class="block text-mist tabular-nums {compact ? 'text-[11px]' : 'text-[11px]'}">
			<strong class="font-bold text-brand">{fmt(e.kcal)} kcal</strong>
			{#if e.portions}
				· {String(e.portions).replace('.', ',')} {e.portions === 1 ? 'portion' : 'portions'}
			{:else}
				· {fmt(e.qtyGrams)} g
			{/if}
		</span>
	</span>
{/snippet}
