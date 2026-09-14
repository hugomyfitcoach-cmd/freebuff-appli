<script lang="ts">
	import Icon from './Icon.svelte';
	import FoodImg from './FoodImg.svelte';
	import { reperesForFood, unitWord } from '$lib/data/gfluxReperes';

	/* Feuille de quantité partagée AJOUT / MODIFICATION d'un aliment.
	   Une seule source de vérité : la quantité finale en grammes (qtyGrams),
	   envoyée à l'API à la sauvegarde. Les modes « Portion » (portion OFF
	   fiable) et « Repère G-FLUX » (portion usuelle interne, whitelist) sont
	   des aides de saisie : nombre de portions/repères → grammes → le moteur
	   nutritionnel existant (kcal/100 g) fait le reste. */

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
		/** « ciqual » : fiche de référence ANSES (badge officiel, pas de photo produit). */
		source,
		showFav = false,
		favActive = false,
		onToggleFav,
		/** Positionne la feuille dans la zone visible (clavier mobile iOS). */
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
			imageUrl?: string;
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
		source?: 'ciqual';
		showFav?: boolean;
		favActive?: boolean;
		onToggleFav?: () => void;
		/** Positionne la feuille dans la zone visible (clavier mobile iOS). */
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

	/* Portion OFF « fiable » : nombre positif raisonnable (5 g à 2 kg). */
	const hasServing = !!food.servingQty && food.servingQty > 0 && food.servingQty <= 2000;
	const servingQty = hasServing ? (food.servingQty ?? 0) : 0;

	/* Repères G-FLUX : whitelist interne — vide si rien de fiable ne correspond
	   (aucun repère inventé, l'onglet n'est alors pas affiché). */
	const repereList = reperesForFood(food.name);
	const hasRepere = repereList.length > 0;

	let unitMode = $state<'g' | 'portion' | 'repere'>('g');
	let gramsText = $state(fmtQty(initialQtyGrams));
	let servingsText = $state(fmtQty(initialQtyGrams / (servingQty || 1)));
	let repereIdx = $state(0);
	/* Nouvel aliment → 1 repère par défaut (pas de conversion des 100 g
	   d'affichage) ; quantité existante (edit/planned) → conservée. */
	let repereText = $state(fmtQty(mode === 'add' ? 1 : initialQtyGrams / (repereList[0]?.grams || 1)));
	let meal = $state(initialMeal);
	/* Saisies délibérées dans cette ouverture de feuille : une quantité
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
</script>

<div
	role="presentation"
	class="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6"
	style:top={sheetTop ? `${sheetTop}px` : undefined}
	style:height={sheetHeight ? `${sheetHeight}px` : undefined}
	onclick={(e) => {
		if (e.target === e.currentTarget && !saving) onClose();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && !saving) onClose();
	}}
>
	<div class="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" style:max-height={sheetHeight ? `min(92dvh, ${sheetHeight}px)` : undefined}>
		<!-- En-tête : photo + nom + portion OFF -->
		<div class="flex items-center gap-3">
		{#if food.imageUrl}
			<FoodImg src={food.imageUrl} alt="" class="h-14 w-14 rounded-xl" eager />
		{:else}
			<div class="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-light"><Icon name="utensils" size={22} class="text-brand" /></div>
		{/if}
			<div class="min-w-0 flex-1">
				<p class="truncate font-semibold text-ink">{food.name}</p>
				<p class="text-xs text-mist">
					{fmtQty(food.kcal100)} kcal pour 100 g{#if hasServing} · 1 portion = {fmtQty(servingQty)} g{/if}{#if repere && unitMode === 'repere'} · 1 {unitWord(1, repere)} ≈ {fmtQty(repere.grams)} {repere.unit}{/if}
				</p>
				{#if food.kcalRecalculated}
					<!-- Garde-fou kcal↔macros : kcal OFF aberrantes → calculées depuis les macros. -->
					<span class="mt-0.5 inline-block rounded-full bg-line/70 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-mist">Valeur recalculée</span>
				{/if}
				{#if source === 'ciqual'}
					<span class="mt-0.5 inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold text-brand">Référence Ciqual – ANSES</span>
					<p class="mt-0.5 text-xs text-mist">Idéal pour un suivi précis</p>
				{/if}
			</div>
			{#if showFav}
				<button
					type="button"
					class="grid h-9 w-9 shrink-0 place-items-center rounded-full transition {favActive ? 'text-brand' : 'text-mist hover:text-brand'}"
					aria-label="Favori"
					onclick={onToggleFav}
				><Icon name="heart" size={18} /></button>
			{/if}
		</div>

		<!-- Bascule Grammes / Portions (si portion OFF fiable) / Repères G-FLUX
		     (si un repère usuel correspond) — onglets dynamiques. -->
		{#if tabCount > 1}
			<div class="mt-4 flex items-center justify-center gap-1 rounded-full bg-line/50 p-1 text-xs font-bold {tabCount > 2 ? 'gap-0.5 px-0.5' : ''}">
				<button
					type="button"
					class="rounded-full px-5 py-1.5 transition {unitMode === 'g' ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
					onclick={() => switchMode('g')}
				>Grammes</button>
				{#if hasServing}
					<button
						type="button"
						class="rounded-full px-5 py-1.5 transition {unitMode === 'portion' ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
						onclick={() => switchMode('portion')}
					>Portions</button>
				{/if}
				{#if hasRepere}
					<button
						type="button"
						class="rounded-full px-5 py-1.5 transition {unitMode === 'repere' ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
						onclick={() => switchMode('repere')}
					>Repères G-FLUX</button>
				{/if}
			</div>
		{/if}

		<!-- Quantité centrale directement éditable -->
		<div class="mt-4 flex items-center justify-between gap-3">
			<button
				type="button"
				class="grid h-12 w-12 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand"
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
						oninput={() => (servingsTouched = true)}
					/>
					<span class="pb-1 text-sm text-mist">{unitLabel}</span>
				{:else if unitMode === 'repere'}
					<input
						type="text"
						inputmode="decimal"
						aria-label="Nombre de repères"
						class="w-32 bg-transparent text-center text-4xl font-bold text-ink outline-none placeholder:text-mist"
						bind:value={repereText}
						oninput={() => (repereTouched = true)}
					/>
					<span class="pb-1 text-sm text-mist">{unitLabel}</span>
				{:else}
					<input
						type="text"
						inputmode="decimal"
						aria-label="Quantité en grammes"
						class="w-32 bg-transparent text-center text-4xl font-bold text-ink outline-none placeholder:text-mist"
						bind:value={gramsText}
						oninput={() => (gramsTouched = true)}
					/>
					<span class="pb-1 text-sm text-mist">g</span>
				{/if}
			</div>
			<button
				type="button"
				class="grid h-12 w-12 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand"
				aria-label="Plus"
				onclick={() => (unitMode === 'portion' ? stepServings(1) : unitMode === 'repere' ? stepReperes(1) : stepGrams(10))}
			>+</button>
		</div>

		<!-- Équivalence portions / repères → grammes (+ mention indicative) -->
		{#if unitMode === 'portion' && valid}
			<p class="mt-2 text-center text-xs text-mist">
				{fmtQty(servingsNum ?? 0)} portion{(servingsNum ?? 0) > 1 ? 's' : ''} × {fmtQty(servingQty)} g =
				<strong class="font-bold text-ink">{fmtQty(gramsNum ?? 0)} g</strong>
			</p>
		{:else if unitMode === 'repere' && repere && valid}
			<p class="mt-2 text-center text-xs text-mist">
				{fmtQty(repsNum ?? 0)} {unitWord(repsNum ?? 1, repere)} × {fmtQty(repere.grams)} {repere.unit} =
				<strong class="font-bold text-ink">{fmtQty(gramsNum ?? 0)} {repere.unit}</strong>
				<span class="mt-0.5 block text-[10px]">Valeur indicative</span>
			</p>
		{/if}

		<!-- Raccourcis rapides -->
		<div class="mt-3 flex flex-wrap justify-center gap-2">
			{#if unitMode === 'portion'}
				{#each [0.5, 1, 1.5, 2] as p (p)}
					<button
						type="button"
						class="rounded-full border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink {servingsNum === p ? '!border-brand !text-brand' : ''}"
						onclick={() => setServings(p)}
					>{fmtQty(p)} portion{p > 1 ? 's' : ''}</button>
				{/each}
			{:else if unitMode === 'repere'}
				{#if repereList.length > 1}
					<!-- Sélecteur du repère usuel (même style que les raccourcis) -->
					{#each repereList as r, i (r.label)}
						<button
							type="button"
							class="rounded-full px-3.5 py-1.5 text-xs font-bold transition {i === repereIdx ? 'bg-brand text-white shadow-sm' : 'border-2 border-line text-ink hover:border-brand hover:text-brand'}"
							onclick={() => selectRepere(i)}
						>{r.label}</button>
					{/each}
				{:else if repere}
					{#each [1, 2, 3, 4] as p (p)}
						<button
							type="button"
							class="rounded-full border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink {repsNum === p ? '!border-brand !text-brand' : ''}"
							onclick={() => setReperes(p)}
						>{fmtQty(p)} {unitWord(p, repere)}</button>
					{/each}
				{/if}
			{:else}
				{#each [50, 100, 150, 200] as g (g)}
					<button
						type="button"
						class="rounded-full border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink {gramsNum === g ? '!border-brand !text-brand' : ''}"
						onclick={() => setGrams(g)}
					>{g} g</button>
				{/each}
			{/if}
		</div>

		<!-- Macros recalculées en direct -->
		<p class="mt-3 text-center text-sm">
			<strong class="text-lg font-bold text-brand">{valid ? fmtQty(kcal) : '—'} kcal</strong>
			<span class="text-mist">
				· {valid ? fmtQty(carbs) : '—'} g glucides · {valid ? fmtQty(protein) : '—'} g protéines · {valid ? fmtQty(fat) : '—'} g lipides
			</span>
		</p>

		<!-- Choix du repas -->
		<div class="mt-3 grid grid-cols-4 gap-1.5">
			{#each mealDefs as m (m.id)}
				<button
					type="button"
					class="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition {meal === m.id ? 'bg-brand text-white' : 'bg-line/50 text-mist'}"
					onclick={() => (meal = m.id)}
				>
					<Icon name={m.icon} size={16} class="shrink-0" />
					{m.label.split(' ')[0]}
				</button>
			{/each}
		</div>

		{#if error}
			<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{error}</p>
		{/if}

		<!-- Actions -->
		{#if mode === 'planned'}
			<!-- Item PLANIFIÉ : Mangé = action principale (bascule immédiate vers
	     consommé) ; la quantité s'enregistre sans consommer ; Remplacer et
	     Supprimer ne touchent que CE jour (jamais le template coach). -->
			<div class="mt-4 flex gap-2">
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
			<div class="mt-4 flex gap-2">
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
					class="flex-1 rounded-full bg-brand px-3 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
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
</div>
