<script lang="ts">
	import Icon from './Icon.svelte';

	/* Feuille de quantité partagée AJOUT / MODIFICATION d'un aliment.
	   Une seule source de vérité : la quantité finale en grammes (qtyGrams),
	   envoyée à l'API à la sauvegarde. Le mode « Portion » (quand une portion
	   OFF fiable existe) est une aide de saisie : nombre de portions → grammes
	   → le moteur nutritionnel existant (kcal/100 g) fait le reste. */

	type MealDef = { id: string; label: string; icon: string };

	let {
		food,
		mealDefs,
		initialQtyGrams,
		initialMeal = 'dejeuner',
		mode = 'add',
		saving = false,
		error = '',
		showFav = false,
		favActive = false,
		onToggleFav,
		onSave,
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
		};
		mealDefs: readonly MealDef[];
		initialQtyGrams: number;
		initialMeal?: string;
		mode?: 'add' | 'edit';
		saving?: boolean;
		error?: string;
		showFav?: boolean;
		favActive?: boolean;
		onToggleFav?: () => void;
		onSave: (qtyGrams: number, meal: string) => void;
		onDelete?: () => void;
		onClose: () => void;
	} = $props();

	/* Portion OFF « fiable » : nombre positif raisonnable (5 g à 2 kg). */
	const hasServing = !!food.servingQty && food.servingQty > 0 && food.servingQty <= 2000;
	const servingQty = hasServing ? (food.servingQty ?? 0) : 0;

	let unitMode = $state<'g' | 'portion'>('g');
	let gramsText = $state(fmtQty(initialQtyGrams));
	let servingsText = $state(fmtQty(initialQtyGrams / (servingQty || 1)));
	let meal = $state(initialMeal);

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
	const gramsNum = $derived(
		unitMode === 'portion'
			? servingsNum == null
				? null
				: servingsNum * servingQty
			: parseNum(gramsText)
	);
	const valid = $derived(gramsNum != null && gramsNum > 0 && gramsNum <= 5000);
	const effGrams = $derived(valid ? (gramsNum ?? 0) : 0);
	const kcal = $derived(Math.round((food.kcal100 * effGrams) / 100));
	const carbs = $derived(Math.round((food.carbs100 * effGrams) / 100));
	const protein = $derived(Math.round((food.protein100 * effGrams) / 100));
	const fat = $derived(Math.round((food.fat100 * effGrams) / 100));

	function stepGrams(d: number) {
		const cur = gramsNum ?? initialQtyGrams;
		gramsText = fmtQty(Math.min(5000, Math.max(1, cur + d)));
	}
	function stepServings(d: number) {
		const cur = servingsNum ?? 1;
		servingsText = fmtQty(Math.max(0.5, cur + d));
	}
	function setGrams(g: number) {
		gramsText = fmtQty(g);
	}
	function setServings(p: number) {
		servingsText = fmtQty(p);
	}
	function switchMode(m: 'g' | 'portion') {
		unitMode = m;
		if (m === 'portion') servingsText = fmtQty((gramsNum ?? initialQtyGrams) / servingQty);
		else gramsText = fmtQty(gramsNum ?? initialQtyGrams);
	}
	function save() {
		if (!valid || gramsNum == null || saving) return;
		onSave(Math.round(gramsNum * 100) / 100, meal);
	}
</script>

<div
	role="presentation"
	class="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6"
	onclick={(e) => {
		if (e.target === e.currentTarget && !saving) onClose();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && !saving) onClose();
	}}
>
	<div class="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
		<!-- En-tête : photo + nom + portion OFF -->
		<div class="flex items-center gap-3">
			{#if food.imageUrl}
				<img src={food.imageUrl} alt="" class="h-14 w-14 shrink-0 rounded-xl object-cover" />
			{:else}
				<div class="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-light"><Icon name="utensils" size={22} class="text-brand" /></div>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="truncate font-semibold text-ink">{food.name}</p>
				<p class="text-xs text-mist">
					{fmtQty(food.kcal100)} kcal pour 100 g{#if hasServing} · 1 portion = {fmtQty(servingQty)} g{/if}
				</p>
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

		<!-- Bascule Grammes / Portions (seulement si une portion OFF fiable existe) -->
		{#if hasServing}
			<div class="mt-4 flex items-center justify-center gap-1 rounded-full bg-line/50 p-1 text-xs font-bold">
				<button
					type="button"
					class="rounded-full px-5 py-1.5 transition {unitMode === 'g' ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
					onclick={() => switchMode('g')}
				>Grammes</button>
				<button
					type="button"
					class="rounded-full px-5 py-1.5 transition {unitMode === 'portion' ? 'bg-brand text-white shadow-sm' : 'text-mist hover:text-ink'}"
					onclick={() => switchMode('portion')}
				>Portions</button>
			</div>
		{/if}

		<!-- Quantité centrale directement éditable -->
		<div class="mt-4 flex items-center justify-between gap-3">
			<button
				type="button"
				class="grid h-12 w-12 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand"
				aria-label="Moins"
				onclick={() => (unitMode === 'portion' ? stepServings(-1) : stepGrams(-10))}
			>−</button>
			<div class="flex min-w-0 flex-1 items-end justify-center gap-1">
				{#if unitMode === 'portion'}
					<input
						type="text"
						inputmode="decimal"
						aria-label="Nombre de portions"
						class="w-32 bg-transparent text-center text-4xl font-bold text-ink outline-none placeholder:text-mist"
						bind:value={servingsText}
					/>
					<span class="pb-1 text-sm text-mist">{(servingsNum ?? 0) > 1 ? 'portions' : 'portion'}</span>
				{:else}
					<input
						type="text"
						inputmode="decimal"
						aria-label="Quantité en grammes"
						class="w-32 bg-transparent text-center text-4xl font-bold text-ink outline-none placeholder:text-mist"
						bind:value={gramsText}
					/>
					<span class="pb-1 text-sm text-mist">g</span>
				{/if}
			</div>
			<button
				type="button"
				class="grid h-12 w-12 place-items-center rounded-xl border-2 border-line text-xl font-bold text-ink active:border-brand"
				aria-label="Plus"
				onclick={() => (unitMode === 'portion' ? stepServings(1) : stepGrams(10))}
			>+</button>
		</div>

		<!-- Équivalence portions → grammes -->
		{#if unitMode === 'portion' && valid}
			<p class="mt-2 text-center text-xs text-mist">
				{fmtQty(servingsNum ?? 0)} portion{(servingsNum ?? 0) > 1 ? 's' : ''} × {fmtQty(servingQty)} g =
				<strong class="font-bold text-ink">{fmtQty(gramsNum ?? 0)} g</strong>
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
				{saving ? 'Enregistrement…' : mode === 'edit' ? 'Enregistrer' : 'Ajouter au journal'}
			</button>
		</div>
	</div>
</div>