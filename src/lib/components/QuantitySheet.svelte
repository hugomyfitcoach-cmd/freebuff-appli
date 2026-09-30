<script lang="ts">
	import Icon from './Icon.svelte';
	import FoodImg from './FoodImg.svelte';
	import { reperesForFood, unitWord } from '$lib/data/gfluxReperes';

	/* Feuille de quantité partagée AJOUT / MODIFICATION d'un aliment.
	   Une seule source de vérité : la quantité finale en grammes (qtyGrams),
	   envoyée à l'API à la sauvegarde. Les modes « Portion » (portion OFF
	   fiable) et « Repère G-FLUX » (portion usuelle interne, whitelist) sont
	   des aides de saisie : nombre de portions/repères → grammes → le moteur
	   nutritionnel existant (kcal/100 g) fait le reste.

	   FICHE PLEIN ÉCRAN (référence UX Food — comme la recherche d'aliments,
	   la fiche est une VRAIE vue dédiée, pas un bottom sheet) :
	     · mobile : fond opaque PLEIN VIEWPORT — le Journal n'est jamais visible
	       derrière, même clavier ouvert (le fond ne rétrécit pas) ; seule la
	       page suit le visualViewport (top/height en px réels) ;
	     · desktop : le même contenu en panneau centré arrondi (max-w-lg) ;
	     · hero image adaptatif en haut (jamais étiré — object-contain),
	       boutons fermer + favori en surimpression ;
	     · nom complet SANS troncature (break-words), marque, source
	       (Ciqual / Estimation IA / aliment personnalisé) en badges ;
	     · macros en 4 cartes (code couleur Journal) ;
	     · footer d'actions = FRÈRE flex de la zone scrollable : espace
	       RÉSERVÉ (jamais recouvert), opaque, safe area iOS. La quantité, les
	       macros, le repas et le CTA ne sont JAMAIS sacrifiés : densité
	       raisonnable + scroll interne de secours sur très petits écrans. */

	type MealDef = { id: string; label: string; icon: string };

	let {
		food,
		mealDefs,
		initialQtyGrams,
		initialMeal = 'dejeuner',
		mode = 'add',
		saving = false,
		error = '',
		/** Libellé du bouton principal (défaut : « Ajouter au journal » / « Enregistrer »). */
		saveLabel = undefined,
		/** « ciqual » : fiche de référence ANSES (badge officiel) · « ai » : estimation IA. */
		source,
		showFav = false,
		favActive = false,
		/** Favori possible : identité alimentaire stable (produit OFF avec _id).
		 *  Une entrée snapshot SANS foodId (Ciqual, aliment perso, repas, analyse IA)
		 *  n'expose jamais de cœur — on ne crée pas de favori incohérent. */
		favFoodId = undefined,
		onToggleFav,
		/** Positionne la fiche dans la zone visible (clavier mobile iOS). */
		sheetTop = 0,
		sheetHeight,
		onSave,
		onEat,
		onReplace,
		onUnEat,
		onDelete,
		onClose,
	}: {
		food: {
			name: string;
			brand?: string;
			imageUrl?: string;
			/** Miniature miroir G-FLUX — repli du hero si pas d'URL d'origine. */
			thumbUrl?: string;
			kcal100: number;
			carbs100: number;
			protein100: number;
			fat100: number;
			servingQty?: number;
			custom?: boolean;
			/** Garde-fou kcal↔macros : kcal OFF incohérentes, valeur recalculée affichée. */
			kcalRecalculated?: boolean;
		};
		mealDefs: readonly MealDef[];
		initialQtyGrams: number;
		initialMeal?: string;
		/** add = ajout au journal · edit = entrée consommée · planned = item planifié (gris). */
		mode?: 'add' | 'edit' | 'planned';
		saving?: boolean;
		error?: string;
		saveLabel?: string;
		/** « ciqual » : fiche de référence ANSES (badge officiel, pas de photo produit). */
		source?: 'ciqual' | 'ai';
		showFav?: boolean;
		favActive?: boolean;
		/** Identifiant alimentaire stable du favori (foodId OFF) quand il existe. */
		favFoodId?: string;
		onToggleFav?: () => void;
		/** Positionne la fiche dans la zone visible (clavier mobile iOS). */
		sheetTop?: number;
		sheetHeight?: number;
		onSave: (qtyGrams: number, meal: string) => void;
		/** Mode planned uniquement : valider « Mangé » (planned → consommé). */
		onEat?: () => void;
		/** Mode planned uniquement : remplacer par un autre aliment. */
		onReplace?: () => void;
		/** Mode edit (jour courant uniquement) : consommé → planifié (décocher). */
		onUnEat?: () => void;
		onDelete?: () => void;
		onClose: () => void;
	} = $props();

	/* Vraie page plein écran MOBILE dès que l'appelant fournit la hauteur du
	   visualViewport (Journal : sheetTop/sheetHeight en px réels — fiable avec
	   le clavier ouvert, contrairement aux unités dvh). Plans coach (desktop)
	   ne passe pas ces props → panneau centré desktop. SSR : la fiche ne se
	   rend jamais côté serveur (ouverte par une interaction) — sheetHeight y
	   est donc toujours undefined, soit le comportement desktop. */
	const mobileSheet = $derived(sheetHeight != null);

	/* Portion OFF « fiable » : nombre positif raisonnable (5 g à 2 kg). */
	const hasServing = !!food.servingQty && food.servingQty > 0 && food.servingQty <= 2000;
	const servingQty = hasServing ? (food.servingQty ?? 0) : 0;

	/* Repères G-FLUX : whitelist interne — vide si rien de fiable ne correspond
	   (aucun repère inventé, l'onglet n'est alors pas affiché). */
	const repereList = reperesForFood(food.name);
	const hasRepere = repereList.length > 0;

	/* Hero : image OFF d'ORIGINE (meilleure résolution) en priorité, repli sur
	   la miniature miroir G-FLUX (cache) — FoodImg gère la chaîne de repli. */
	const heroSrc = $derived(food.imageUrl ?? food.thumbUrl);
	/* Marque fiable : présente et jamais la chaîne « null » héritée de l'API OFF. */
	const hasBrand = $derived(!!food.brand && food.brand !== 'null');

	let unitMode = $state<'g' | 'portion' | 'repere'>('g');
	let gramsText = $state(fmtQty(initialQtyGrams));
	let servingsText = $state(fmtQty(initialQtyGrams / (servingQty || 1)));
	let repereIdx = $state(0);
	/* Nouvel aliment → 1 repère par défaut (pas de conversion des 100 g
	   d'affichage) ; quantité existante (edit/planned) → conservée. */
	let repereText = $state(fmtQty(mode === 'add' ? 1 : initialQtyGrams / (repereList[0]?.grams || 1)));
	let meal = $state(initialMeal);
	/* Saisies délibérées dans cette ouverture de fiche : une quantité
	   volontairement entrée (g/portion/repère) n'est jamais écrasée en
	   changeant d'onglet. */
	let gramsTouched = $state(false);
	let servingsTouched = $state(false);
	let repereTouched = $state(false);

	function parseNum(s: string): number | null {
		const t = s.trim().replace(',', '.');
		if (t === '' || t === '-' || t === '.' || t === '+') return null;
		const n = Number(t);
		return isFinite(n) ? n : null;
	}
	function fmtQty(n: number): string {
		if (!isFinite(n)) return '0';
		const r = Math.round(n * 10) / 10;
		return r === Math.round(r) ? String(Math.round(r)) : r.toFixed(1).replace('.', ',');
	}

	const servingsNum = $derived(parseNum(servingsText));
	const repere = $derived(repereList[repereIdx] ?? null);
	const repsNum = $derived(parseNum(repereText));
	const gramsNum = $derived(
		unitMode === 'portion'
			? servingsNum == null
				? null
				: servingsNum * servingQty
			: unitMode === 'repere'
				? repsNum == null || !repere
					? null
					: repsNum * repere.grams
				: parseNum(gramsText)
	);
	const valid = $derived(gramsNum != null && gramsNum > 0 && gramsNum <= 5000);
	const effGrams = $derived(valid ? (gramsNum ?? 0) : 0);
	const kcal = $derived(Math.round((food.kcal100 * effGrams) / 100));
	const carbs = $derived(Math.round((food.carbs100 * effGrams) / 100));
	const protein = $derived(Math.round((food.protein100 * effGrams) / 100));
	const fat = $derived(Math.round((food.fat100 * effGrams) / 100));

	/* Unité affichée à côté de la quantité centrale (accord singulier/pluriel). */
	const unitLabel = $derived(
		unitMode === 'g'
			? 'g'
			: unitMode === 'portion'
				? (servingsNum ?? 0) > 1
					? 'portions'
					: 'portion'
				: repere
					? unitWord(repsNum ?? 0, repere)
					: ''
	);
	const tabCount = $derived(1 + (hasServing ? 1 : 0) + (hasRepere ? 1 : 0));

	function stepGrams(d: number) {
		gramsTouched = true;
		const cur = gramsNum ?? initialQtyGrams;
		gramsText = fmtQty(Math.min(5000, Math.max(1, cur + d)));
	}
	function stepServings(d: number) {
		servingsTouched = true;
		const cur = servingsNum ?? 1;
		servingsText = fmtQty(Math.max(0.5, cur + d));
	}
	function stepReperes(d: number) {
		repereTouched = true;
		const cur = repsNum ?? 1;
		repereText = fmtQty(Math.max(0.5, cur + d));
	}
	function setGrams(g: number) {
		gramsTouched = true;
		gramsText = fmtQty(g);
	}
	function setServings(p: number) {
		servingsTouched = true;
		servingsText = fmtQty(p);
	}
	function setReperes(p: number) {
		repereTouched = true;
		repereText = fmtQty(p);
	}
	/* Change de repère usuel : la quantité (en repères) est recalculée pour
	   conserver le même poids en grammes. */
	function selectRepere(i: number) {
		repereTouched = true;
		repereIdx = i;
		if (unitMode === 'repere') repereText = fmtQty((gramsNum ?? initialQtyGrams) / (repere?.grams || 1));
	}
	function switchMode(m: 'g' | 'portion' | 'repere') {
		// Grammes AU moment du switch, lus AVANT de changer de mode :
		// gramsNum dépend de unitMode — lu après, il refléterait l'ancien
		// champ du nouveau mode (quantité conservée fausse).
		const g = gramsNum ?? initialQtyGrams;
		unitMode = m;
		if (m === 'portion') servingsText = fmtQty(g / servingQty);
		else if (m === 'repere') {
			// Quantité déjà choisie (saisie volontaire ou entrée existante) :
			// conservée et convertie. Sinon, nouvel aliment → 1 repère.
			if (!repereTouched) {
				repereText =
					mode !== 'add' || gramsTouched || servingsTouched
						? fmtQty(g / (repere?.grams || 1))
						: fmtQty(1);
			}
		} else gramsText = fmtQty(g);
	}
	function save() {
		if (!valid || gramsNum == null || saving) return;
		onSave(Math.round((gramsNum ?? 0) * 100) / 100, meal);
	}

	/* MODE FOCUS QUANTITÉ : pendant la saisie au clavier (quantité centrale
	   focalisée), on masque hero, choix du repas et footer d'actions — il
	   reste au-dessus du clavier : identité, onglets, quantité − / +,
	   raccourcis et cartes macros. Done / ✓ / Enter (ou tap ailleurs) fait
	   perdre le focus → retour automatique à la fiche complète. La valeur
	   saisie reste l'état local (bind:value) : JAMAIS de sauvegarde
	   automatique, l'enregistrement reste un geste explicite (CTA). Le blur
	   n'intervient que sur un geste utilisateur (Enter/✓/tap ailleurs) —
	   aucun blur programmatique au scroll, le correctif Android clavier est
	   intact (la fiche n'a aucun scroll-dismiss). */
	let qtyFocused = $state(false);
	/* FICHE FIXE : la zone de contenu ne doit jamais garder un décalage de
	   scroll — après la fermeture du clavier (validation Done/✓/Enter) ou un
	   aller-retour du mode focus, un scrollTop résiduel coupait la croix et
	   « mangeait » les vignettes repas. Re-ancrage en haut à chaque transition
	   ; la croix/favori sont HORS de la zone scrollable (toujours visibles)
	   et le hero laisse une marge pour que la fiche tienne sans scroll sur
	   les téléphones standards. */
	let scrollerEl: HTMLElement | undefined = $state();
	$effect(() => {
		if (scrollerEl) {
			void qtyFocused; // re-ancrage à chaque entrée/sortie du mode focus
			scrollerEl.scrollTop = 0;
		}
	});
	function endQtyFocus() {
		qtyFocused = false;
	}
	function qtyKeydown(e: KeyboardEvent) {
		// Enter = « valider la saisie » : ferme le clavier (blur), ne sauvegarde pas.
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
		}
	}
	/* iOS Safari : un tap sur du texte/blanc ne fait PAS perdre le focus au
	   champ (contrairement à Android). Tap ailleurs que la zone de saisie
	   (− / + / raccourcis restent interactifs sans fermer le clavier) =
	   « valider » : blur → retour à la fiche complète. Geste utilisateur réel,
	   jamais déclenché par un scroll — le correctif Android clavier est hors
	   de portée (la fiche n'a aucun scroll-dismiss). */
	function sheetPointerDown(e: PointerEvent) {
		if (!qtyFocused) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('[data-qty-zone]')) return;
		const active = document.activeElement;
		if (active instanceof HTMLInputElement) active.blur();
	}
</script>

<!-- ═══ FICHE ALIMENT = VRAIE VUE PLEIN ÉCRAN OPAQUE ═══
     Fond opaque plein viewport : le Journal n'est JAMAIS visible derrière,
     même clavier ouvert (le fond ne rétrécit pas — seule la page de contenu
     suit le visualViewport). Même principe que l'écran « Ajouter un aliment ». -->
<div
	role="presentation"
	class="fixed inset-0 z-[60] bg-white sm:flex sm:items-center sm:justify-center sm:p-6"
	onkeydown={(e) => {
		if (e.key === 'Escape' && !saving) onClose();
	}}
>
	<div
		class="absolute inset-x-0 top-0 mx-auto flex w-full max-w-lg flex-col overflow-hidden bg-white sm:relative sm:top-auto sm:h-[min(92dvh,720px)] sm:rounded-[2rem] sm:shadow-2xl"
		style:top={mobileSheet ? `${sheetTop}px` : undefined}
		style:height={mobileSheet ? `${sheetHeight}px` : undefined}
	>
		<!-- Zone défilante : hero → identité → quantité → macros → choix du repas.
	     Le footer d'actions est un FRÈRE (flex, hors flux de scroll) : espace
	     réservé, aucun bouton ne peut recouvrir le contenu, même clavier ouvert. -->
		<!-- ─── Contrôles flottants : HORS de la zone scrollable ───
	     Croix (et favori) toujours visibles — aucun mini-scroll résiduel ne
	     peut les faire disparaître ; visibles aussi pendant le mode focus. -->
		<div class="absolute right-3 top-3 z-10 flex items-center gap-2">
			{#if showFav && favFoodId}
				<!-- Favori = cœur ENTIÈREMENT REMPLI en vert (fill), même logique qu'avant. -->
				<button
					type="button"
					class="grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-md backdrop-blur transition {favActive ? 'text-brand' : 'text-mist hover:text-brand'}"
					aria-label={favActive ? 'Retirer des favoris' : 'Ajouter aux favoris'}
					onclick={onToggleFav}
				>
					<svg viewBox="0 0 24 24" width="18" height="18" class={favActive ? 'text-brand' : ''} fill={favActive ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
					</svg>
				</button>
			{/if}
			<!-- Fermeture : toujours atteignable, contraste garanti. -->
			<button
				type="button"
				class="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-mist shadow-md backdrop-blur transition hover:text-ink"
				aria-label="Fermer"
				onclick={() => { if (!saving) onClose(); }}
			>
				<Icon name="x" size={18} />
			</button>
		</div>
		<div role="presentation" class="min-h-0 flex-1 overflow-y-auto overscroll-contain" bind:this={scrollerEl} onpointerdown={sheetPointerDown}>
		<!-- MODE FOCUS QUANTITÉ : le clavier s'ouvre → hero/repas/actions masqués,
	     il reste identité compacte + quantité + raccourcis + macros au-dessus
	     du clavier ; Done / ✓ / Enter ou tap ailleurs restaure la fiche. -->
			{#if !qtyFocused}
		<!-- ─── Hero : image adaptative de l'aliment (référence UX Food) ───
		     Hauteur dynamique : confortable sur écran standard, réduite sur
		     petit écran (plafond 26dvh / 200 px — marge pour que la fiche
		     tienne SANS scroll sur téléphone standard). object-contain via
		     FoodImg : JAMAIS d'étirement ni de recadrage ; fond cream si
		     l'image est plus petite que la zone ; placeholder G-FLUX. -->
			<div class="relative shrink-0 bg-cream">
				<div class="h-[min(26dvh,200px)] sm:h-[200px]">
					{#if heroSrc}
						<FoodImg src={food.imageUrl} fallbackSrc={food.thumbUrl} alt={food.name} class="h-full w-full" fit="contain" eager />
					{:else}
						<!-- Placeholder G-FLUX : grande tuile neutre, jamais d'icône cassée. -->
						<div class="grid h-full w-full place-items-center">
							<div class="grid h-20 w-20 place-items-center rounded-3xl bg-brand-light">
								<Icon name="utensils" size={34} class="text-brand" />
							</div>
						</div>					{/if}
				</div>
			</div>
			{/if}

			<!-- ─── Identité : nom complet (JAMAIS tronqué) + marque + référence ─── -->
			<div class="px-5 {qtyFocused ? 'pt-14' : 'pt-4'}">
				<h2 class="break-words text-[17px] font-bold leading-snug text-ink">{food.name}</h2>
				{#if qtyFocused}
					<!-- Mode focus : le nom reste visible au-dessus du clavier, la ligne
				     kcal/100g et les badges sont masqués pour garder la quantité,
				     les raccourcis et les macros dans la zone visible. -->
					<div class="h-2"></div>
				{:else}
					<p class="mt-0.5 text-[13px] leading-snug text-mist">
						{#if hasBrand}<span class="font-semibold text-ink/80">{food.brand}</span> · {/if}{fmtQty(food.kcal100)} kcal pour 100 g{#if hasServing} · 1 portion = {fmtQty(servingQty)} g{/if}{#if repere && unitMode === 'repere'} · 1 {unitWord(1, repere)} ≈ {fmtQty(repere.grams)} {repere.unit}{/if}
					</p>
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
					{#if source === 'ciqual'}
						<span class="inline-flex items-center gap-1 rounded-full bg-brand-light px-2.5 py-1 text-[10px] font-bold text-brand">Référence Ciqual – ANSES</span>
					{/if}
					{#if source === 'ai'}
						<span class="inline-flex items-center gap-1 rounded-full bg-[#eef2ff] px-2.5 py-1 text-[10px] font-bold text-[#4f46e5]">Estimation IA</span>
					{/if}
					{#if food.custom}
						<span class="inline-flex items-center gap-1 rounded-full bg-line/70 px-2.5 py-1 text-[10px] font-bold text-mist">Aliment personnalisé</span>
					{/if}
					{#if food.kcalRecalculated}
						<!-- Garde-fou kcal↔macros : kcal OFF aberrantes → calculées depuis les macros. -->
						<span class="inline-flex items-center gap-1 rounded-full bg-line/70 px-2.5 py-1 text-[10px] font-semibold text-mist">Valeur recalculée</span>
					{/if}
					</div>
				{/if}
			</div>

			<!-- ─── Saisie de quantité (logique inchangée) ─── -->
			<div class="px-5">
				<!-- Bascule Grammes / Portions (si portion OFF fiable) / Repères G-FLUX
			     (si un repère usuel correspond) — onglets dynamiques. -->
				{#if tabCount > 1}
					<div class="mt-4 flex items-center justify-center gap-1 rounded-full bg-line/50 p-1 text-xs font-bold {tabCount > 2 ? 'gap-0.5 px-0.5' : ''}">
						<button
							type="button"
							class="rounded-full px-5 py-2 transition {unitMode === 'g' ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
							onclick={() => { if (!qtyFocused) switchMode('g'); }}
						>Grammes</button>
						{#if hasServing}
							<button
								type="button"
								class="rounded-full px-5 py-2 transition {unitMode === 'portion' ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
								onclick={() => { if (!qtyFocused) switchMode('portion'); }}
							>Portions</button>
						{/if}
						{#if hasRepere}
							<button
								type="button"
								class="rounded-full px-5 py-2 transition {unitMode === 'repere' ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
								onclick={() => { if (!qtyFocused) switchMode('repere'); }}
							>Repères G-FLUX</button>
						{/if}
					</div>
				{/if}

				<!-- Quantité centrale directement éditable -->
				<div class="mt-3 flex items-center justify-between gap-3" data-qty-zone>
					<button
						type="button"
						class="grid h-11 w-11 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand"
						aria-label="Moins"
						onclick={() => (unitMode === 'portion' ? stepServings(-1) : unitMode === 'repere' ? stepReperes(-1) : stepGrams(-10))}
					>−</button>
					<div class="flex min-w-0 flex-1 items-end justify-center gap-1">
						{#if unitMode === 'portion'}
							<input
								type="text"
								inputmode="decimal"
								aria-label="Nombre de portions"
								class="w-32 bg-transparent text-center text-4xl font-bold text-ink outline-none placeholder:text-mist"
								bind:value={servingsText}
								onfocus={() => (qtyFocused = true)}
								onblur={endQtyFocus}
								oninput={() => (servingsTouched = true)}
								onkeydown={qtyKeydown}
								enterkeyhint="done"
							/>
							<span class="pb-1 text-sm text-mist">{unitLabel}</span>
						{:else if unitMode === 'repere'}
							<input
								type="text"
								inputmode="decimal"
								aria-label="Nombre de repères"
								class="w-32 bg-transparent text-center text-4xl font-bold text-ink outline-none placeholder:text-mist"
								bind:value={repereText}
								onfocus={() => (qtyFocused = true)}
								onblur={endQtyFocus}
								oninput={() => (repereTouched = true)}
								onkeydown={qtyKeydown}
								enterkeyhint="done"
							/>
							<span class="pb-1 text-sm text-mist">{unitLabel}</span>
						{:else}
							<input
								type="text"
								inputmode="decimal"
								aria-label="Quantité en grammes"
								class="w-32 bg-transparent text-center text-4xl font-bold text-ink outline-none placeholder:text-mist"
								bind:value={gramsText}
								onfocus={() => (qtyFocused = true)}
								onblur={endQtyFocus}
								oninput={() => (gramsTouched = true)}
								onkeydown={qtyKeydown}
								enterkeyhint="done"
							/>
							<span class="pb-1 text-sm text-mist">g</span>
						{/if}
					</div>
					<button
						type="button"
						class="grid h-11 w-11 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand"
						aria-label="Plus"
						onclick={() => (unitMode === 'portion' ? stepServings(1) : unitMode === 'repere' ? stepReperes(1) : stepGrams(10))}
					>+</button>
				</div>

				<!-- Équivalence portions / repères → grammes (+ mention indicative) -->
				{#if unitMode === 'portion' && valid}
					<p class="mt-2.5 text-center text-xs text-mist">
						{fmtQty(servingsNum ?? 0)} portion{(servingsNum ?? 0) > 1 ? 's' : ''} × {fmtQty(servingQty)} g =
						<strong class="font-bold text-ink">{fmtQty(gramsNum ?? 0)} g</strong>
					</p>
				{:else if unitMode === 'repere' && repere && valid}
					<p class="mt-2.5 text-center text-xs text-mist">
						{fmtQty(repsNum ?? 0)} {unitWord(repsNum ?? 1, repere)} × {fmtQty(repere.grams)} {repere.unit} =
						<strong class="font-bold text-ink">{fmtQty(gramsNum ?? 0)} {repere.unit}</strong>
						<span class="mt-0.5 block text-[10px]">Valeur indicative</span>
					</p>
				{/if}

				<!-- Raccourcis rapides -->
				<div class="mt-3 flex flex-wrap justify-center gap-2" data-qty-zone>
					{#if unitMode === 'portion'}
						{#each [0.5, 1, 1.5, 2] as p (p)}
							<button
								type="button"
								class="rounded-full border-2 border-line px-3.5 py-2 text-xs font-semibold text-ink {servingsNum === p ? '!border-brand !text-brand' : ''}"
								onclick={() => setServings(p)}
							>{fmtQty(p)} portion{p > 1 ? 's' : ''}</button>
						{/each}
					{:else if unitMode === 'repere'}
						{#if repereList.length > 1}
							<!-- Sélecteur du repère usuel (même style que les raccourcis) -->
							{#each repereList as r, i (r.label)}
								<button
									type="button"
									class="rounded-full px-3.5 py-2 text-xs font-bold transition {i === repereIdx ? 'bg-brand text-white shadow-sm' : 'border-2 border-line text-ink hover:border-brand hover:text-brand'}"
									onclick={() => selectRepere(i)}
								>{r.label}</button>
							{/each}
						{:else if repere}
							{#each [1, 2, 3, 4] as p (p)}
								<button
									type="button"
									class="rounded-full border-2 border-line px-3.5 py-2 text-xs font-semibold text-ink {repsNum === p ? '!border-brand !text-brand' : ''}"
									onclick={() => setReperes(p)}
								>{fmtQty(p)} {unitWord(p, repere)}</button>
							{/each}
						{/if}
					{:else}
						{#each [50, 100, 150, 200] as g (g)}
							<button
								type="button"
								class="rounded-full border-2 border-line px-3.5 py-2 text-xs font-semibold text-ink {gramsNum === g ? '!border-brand !text-brand' : ''}"
								onclick={() => setGrams(g)}
							>{g} g</button>
						{/each}
					{/if}
				</div>
			</div>

			<!-- ─── Macros en 4 cartes (code couleur du Journal) ───
			     vert kcal · rose glucides · bleu protéines · orange lipides. -->
			<div class="mt-4 px-5 pb-4">
				<div class="grid grid-cols-4 gap-2">
					<div class="rounded-xl bg-cream px-1 py-2.5 text-center">
						<p class="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide text-brand"><Icon name="flame" size={11} class="shrink-0" />Calories</p>
						<p class="mt-0.5 text-[17px] font-bold leading-none text-brand tabular-nums">{valid ? fmtQty(kcal) : '—'}</p>
						<p class="text-[9px] font-semibold text-mist">kcal</p>
					</div>
					<div class="rounded-xl bg-cream px-1 py-2.5 text-center">
						<p class="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide" style:color="#ec4899"><Icon name="wheat" size={11} class="shrink-0" />Glucides</p>
						<p class="mt-0.5 text-[17px] font-bold leading-none tabular-nums" style:color="#ec4899">{valid ? fmtQty(carbs) : '—'}</p>
						<p class="text-[9px] font-semibold text-mist">g</p>
					</div>
					<div class="rounded-xl bg-cream px-1 py-2.5 text-center">
						<p class="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide" style:color="#3b82f6"><Icon name="drumstick" size={11} class="shrink-0" />Protéines</p>
						<p class="mt-0.5 text-[17px] font-bold leading-none tabular-nums" style:color="#3b82f6">{valid ? fmtQty(protein) : '—'}</p>
						<p class="text-[9px] font-semibold text-mist">g</p>
					</div>
					<div class="rounded-xl bg-cream px-1 py-2.5 text-center">
						<p class="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide" style:color="#f97316"><Icon name="droplet" size={11} class="shrink-0" />Lipides</p>
						<p class="mt-0.5 text-[17px] font-bold leading-none tabular-nums" style:color="#f97316">{valid ? fmtQty(fat) : '—'}</p>
						<p class="text-[9px] font-semibold text-mist">g</p>
					</div>
				</div>

				{#if !qtyFocused}
				<!-- Choix du repas (masqué en mode focus quantité) -->
				<div class="mt-3 grid grid-cols-4 gap-2">
					{#each mealDefs as m (m.id)}
						<button
							type="button"
							class="flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[12px] font-semibold transition {meal === m.id ? 'bg-brand text-white' : 'bg-line/50 text-mist'}"
							onclick={() => (meal = m.id)}
						>
							<Icon name={m.icon} size={16} class="shrink-0" />
							{m.label.split(' ')[0]}
						</button>
					{/each}
				</div>
				{/if}
			</div>
		</div>

		{#if !qtyFocused}

		<!-- ─── Footer d'actions : barre SOLIDE intégrée à la fiche ───
	     FRÈRE flex de la zone scrollable : espace réservé, fond blanc opaque +
	     séparateur — jamais de contenu visible derrière (l'ancien sticky +
	     dégradé transparent laissait passer les boutons repas sous
	     Supprimer/Enregistrer). Safe area iOS en bas. -->
		<div class="shrink-0 border-t border-line bg-white px-5 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
			{#if error}
				<p class="mb-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{error}</p>
			{/if}
			{#if mode === 'planned'}
				<!-- Item PLANIFIÉ : Mangé = action principale (bascule immédiate vers
		     consommé) ; la quantité s'enregistre sans consommer ; Remplacer et
		     Supprimer ne touchent que CE jour (jamais le template coach). -->
				<div class="flex gap-2">
					<button
						type="button"
						class="flex-1 rounded-full bg-brand px-3 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
						disabled={saving || !valid}
						onclick={() => { if (gramsNum != null) onSave(Math.round(gramsNum * 100) / 100, meal); }}
					>
						{saving ? 'Enregistrement…' : 'Enregistrer la quantité'}
					</button>
				</div>
				<div class="mt-2 flex gap-2">
					{#if onEat}
						<!-- « Mangé » : uniquement le jour même — on ne mange jamais demain. -->
						<button
							type="button"
							class="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ink px-3 py-3 text-sm font-bold text-white transition hover:bg-ink/85 disabled:opacity-60"
							disabled={saving}
							onclick={onEat}
						>
							<Icon name="check" size={16} strokeWidth={3} />
							Mangé
						</button>
					{/if}
					{#if onReplace}
						<button
							type="button"
							class="flex-1 rounded-full border-2 border-line px-3 py-3 text-sm font-bold text-ink transition hover:border-brand hover:text-brand"
							disabled={saving}
							onclick={onReplace}
						>Remplacer</button>
					{/if}
					{#if onDelete}
						<button
							type="button"
							class="rounded-full border-2 border-danger px-4 py-3 text-sm font-bold text-danger transition hover:bg-danger-light"
							disabled={saving}
							onclick={onDelete}
						>Supprimer</button>
					{/if}
				</div>
			{:else}
				<div class="flex gap-2">
					{#if mode === 'edit'}
						<button
							type="button"
							class="flex-1 rounded-full border-2 border-danger px-3 py-3 text-sm font-bold text-danger transition hover:bg-danger-light"
							disabled={saving}
							onclick={onDelete}
						>Supprimer</button>
					{/if}
					<button
						type="button"
						class="flex-[2] rounded-full bg-brand px-3 py-3.5 text-[15px] font-bold text-white shadow-lg shadow-brand/30 transition hover:bg-brand-dark disabled:opacity-60"
						disabled={saving || !valid}
						onclick={save}
					>
						{saving ? 'Enregistrement…' : saveLabel ?? (mode === 'edit' ? 'Enregistrer' : 'Ajouter au journal')}
					</button>
				</div>
				{#if mode === 'edit' && onUnEat}
					<!-- Décocher un « Mangé » validé par erreur : retire immédiatement
		     kcal/macros des totaux (recalcul parfaitement réversible). -->
					<button
						type="button"
						class="mt-2 w-full rounded-full border-2 border-line px-3 py-2.5 text-sm font-bold text-mist transition hover:border-brand hover:text-brand"
						disabled={saving}
						onclick={onUnEat}
					>↩︎ Remettre en planifié</button>
				{/if}
			{/if}
		</div>
		{/if}
	</div>
</div>
