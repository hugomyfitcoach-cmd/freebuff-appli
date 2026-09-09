<script lang="ts">
	/**
	 * Bibliothèque des plans de repas (coach).
	 * Chaque plan = une JOURNÉE type réutilisable (assignable à plusieurs clientes).
	 * L'éditeur réutilise le moteur du Journal : même recherche, mêmes kcal/100 g.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import FoodImg from '$lib/components/FoodImg.svelte';

	type PlanRow = {
		_id: string;
		name: string;
		description?: string;
		totalKcal: number;
		totalCarbs: number;
		totalProtein: number;
		totalFat: number;
		itemCount: number;
		updatedAt: number;
		clients: number;
	};
	type Food = {
		_id: string;
		name: string;
		brand?: string;
		kcal100: number;
		carbs100: number;
		protein100: number;
		fat100: number;
		imageUrl?: string;
		servingQty?: number;
		custom?: boolean;
	};
	type DraftItem = {
		key: string;
		meal: string;
		food: Food;
		qty: number;
	};
	/** Item de template brut (lecture d'un plan existant). */
	type TemplateItem = {
		meal: string;
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
	};

	const MEAL_DEFS = [
		{ id: 'petit-dej', label: 'Petit-déjeuner', icon: 'sunrise' },
		{ id: 'dejeuner', label: 'Déjeuner', icon: 'utensils' },
		{ id: 'diner', label: 'Dîner', icon: 'moon' },
		{ id: 'collation', label: 'Collations', icon: 'cookie' },
	] as const;
	const MEAL_LABEL: Record<string, string> = Object.fromEntries(MEAL_DEFS.map((m) => [m.id, m.label]));

	let plans = $state<PlanRow[]>([]);
	let loading = $state(true);
	let pageErr = $state('');
	let notice = $state('');

	/* ————— Éditeur (plein écran) ————— */
	let editorOpen = $state(false);
	let editingId = $state<string | null>(null); // null = création
	let planName = $state('');
	let planDesc = $state('');
	let items = $state<DraftItem[]>([]);
	let saving = $state(false);
	let editorErr = $state('');

	/* ————— Recherche d'aliments (moteur du Journal) ————— */
	let searchQ = $state('');
	let results = $state<Food[]>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchForMeal = $state<string>('petit-dej');

	function fmt(n: number) {
		return n.toLocaleString('fr-FR');
	}
	function fmtDate(ts: number) {
		return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
	}

	async function loadPlans() {
		loading = true;
		pageErr = '';
		try {
			const r = await fetch('/api/coach/meal-plans');
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			plans = j;
		} catch (e) {
			pageErr = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}
	onMount(loadPlans);

	function openCreate() {
		editingId = null;
		planName = '';
		planDesc = '';
		items = [];
		editorErr = '';
		searchQ = '';
		results = [];
		editorOpen = true;
	}
	async function openEdit(id: string) {
		try {
			const r = await fetch(`/api/coach/meal-plans?id=${id}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			editingId = id;
			planName = j.name;
			planDesc = j.description ?? '';
			items = (j.items as TemplateItem[]).map((it, i) => ({
				key: `e${i}`,
				meal: it.meal,
				qty: it.qtyGrams,
				food: {
					_id: it.foodId ?? it.customFoodId ?? `x${i}`,
					name: it.name,
					brand: it.brand,
					kcal100: it.qtyGrams > 0 ? (it.kcal / it.qtyGrams) * 100 : 0,
					carbs100: it.qtyGrams > 0 ? (it.carbs / it.qtyGrams) * 100 : 0,
					protein100: it.qtyGrams > 0 ? (it.protein / it.qtyGrams) * 100 : 0,
					fat100: it.qtyGrams > 0 ? (it.fat / it.qtyGrams) * 100 : 0,
					imageUrl: it.imageUrl,
				},
			}));
			editorErr = '';
			searchQ = '';
			results = [];
			editorOpen = true;
		} catch (e) {
			pageErr = e instanceof Error ? e.message : String(e);
		}
	}

	function runSearch(q: string) {
		if (q.trim().length < 2) {
			results = [];
			return;
		}
		searching = true;
		fetch(`/api/coach/search?q=${encodeURIComponent(q.trim())}`)
			.then((r) => r.json())
			.then((j) => {
				results = j.error ? [] : j;
			})
			.catch(() => (results = []))
			.finally(() => (searching = false));
	}
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => runSearch(searchQ), 300);
	}
	function addItem(food: Food) {
		items = [
			...items,
			{
				key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
				meal: searchForMeal,
				food,
				qty: food.servingQty && food.servingQty > 0 ? Math.round(food.servingQty) : 100,
			},
		];
		searchQ = '';
		results = [];
	}
	function setQty(key: string, qty: number) {
		items = items.map((it) => (it.key === key ? { ...it, qty: Math.min(5000, Math.max(1, qty)) } : it));
	}
	function setMeal(key: string, meal: string) {
		items = items.map((it) => (it.key === key ? { ...it, meal } : it));
	}
	function removeItem(key: string) {
		items = items.filter((it) => it.key !== key);
	}
	function itemKcal(it: DraftItem) {
		return Math.round((it.food.kcal100 * it.qty) / 100);
	}
	const totals = $derived.by(() => {
		const t = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
		for (const it of items) {
			const k = it.qty / 100;
			t.kcal += it.food.kcal100 * k;
			t.carbs += it.food.carbs100 * k;
			t.protein += it.food.protein100 * k;
			t.fat += it.food.fat100 * k;
		}
		return {
			kcal: Math.round(t.kcal),
			carbs: Math.round(t.carbs * 10) / 10,
			protein: Math.round(t.protein * 10) / 10,
			fat: Math.round(t.fat * 10) / 10,
		};
	});

	async function savePlan() {
		if (planName.trim().length < 2 || items.length === 0) return;
		saving = true;
		editorErr = '';
		try {
			const body = {
				name: planName.trim(),
				description: planDesc.trim() || undefined,
				items: items.map((it) => ({
					meal: it.meal,
					...(it.food.custom ? { customFoodId: it.food._id } : { foodId: it.food._id }),
					qtyGrams: it.qty,
				})),
			};
			const r = editingId
				? await fetch('/api/coach/meal-plans', {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ id: editingId, ...body }),
					})
				: await fetch('/api/coach/meal-plans', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(body),
					});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			editorOpen = false;
			notice = editingId ? 'Plan modifié.' : 'Plan créé.';
			await loadPlans();
		} catch (e) {
			editorErr = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	async function duplicatePlan(p: PlanRow) {
		try {
			const r = await fetch(`/api/coach/meal-plans/${p._id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: p._id }),
			});
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadPlans();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : String(e);
		}
	}
	async function deletePlan(p: PlanRow) {
		if (!confirm(`Supprimer le plan « ${p.name} » ? Les propositions futures cesseront pour les clientes assignées (l'historique consommé est conservé).`)) return;
		try {
			const r = await fetch(`/api/coach/meal-plans/${p._id}?id=${p._id}`, { method: 'DELETE' });
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			await loadPlans();
		} catch (e) {
			pageErr = e instanceof Error ? e.message : String(e);
		}
	}

	/** Répartition rapide : place les nouveaux items dans le repas choisi. */
	function mealCount(meal: string) {
		return items.filter((it) => it.meal === meal).length;
	}
	function mealKcalOf(meal: string) {
		return items.filter((it) => it.meal === meal).reduce((s, it) => s + itemKcal(it), 0);
	}
</script>

<svelte:head><title>Plans de repas — CRM G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<header class="mb-5 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-2xl font-semibold text-ink">Plans de repas</h1>
			<p class="mt-0.5 text-sm text-mist">Bibliothèque de journées types — assignables à plusieurs clientes.</p>
		</div>
		<button
			type="button"
			onclick={openCreate}
			class="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
		>
			<Icon name="plus" size={16} />
			Créer un plan
		</button>
	</header>

	{#if pageErr}
		<p class="mb-4 rounded-xl border-2 border-danger bg-danger-light px-4 py-3 text-sm text-danger">{pageErr}</p>
	{:else if notice}
		<p class="mb-4 rounded-xl border border-brand/40 bg-brand-light px-4 py-3 text-sm font-semibold text-ink">{notice}</p>
	{/if}

	{#if loading}
		<p class="py-16 text-center text-sm text-mist">Chargement…</p>
	{:else if plans.length === 0}
		<div class="rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
			<div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-brand-light"><Icon name="utensils" size={26} class="text-brand" /></div>
			<p class="font-semibold text-ink">Aucun plan pour l'instant</p>
			<p class="mx-auto mt-1 max-w-sm text-sm text-mist">Crée ta première journée type (ex. « Plan 1 800 kcal ») puis assigne-la à tes clientes depuis leur Vision 360.</p>
		</div>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each plans as p (p._id)}
				<li class="rounded-2xl border border-line bg-card p-4 shadow-sm">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<h2 class="font-display text-lg font-semibold text-ink">{p.name}</h2>
							<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] tabular-nums">
								<span class="font-bold text-brand">{fmt(p.totalKcal)} kcal</span>
								<span class="text-mist">G {fmt(p.totalCarbs)} g</span>
								<span class="text-mist">P {fmt(p.totalProtein)} g</span>
								<span class="text-mist">L {fmt(p.totalFat)} g</span>
								<span class="text-mist">· {p.itemCount} aliments</span>
							</div>
							<p class="mt-1 text-[11px] text-mist">
								Modifié le {fmtDate(p.updatedAt)}
								{#if p.clients > 0}· assigné à {p.clients} cliente{p.clients > 1 ? 's' : ''}{/if}
							</p>
						</div>
						<div class="flex flex-wrap items-center gap-1.5">
							<button type="button" onclick={() => openEdit(p._id)} class="flex items-center gap-1 rounded-lg border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand">
								<Icon name="pencil" size={13} /> Ouvrir
							</button>
							<button type="button" onclick={() => duplicatePlan(p)} class="flex items-center gap-1 rounded-lg border-2 border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand" title="Dupliquer">
								<Icon name="copy" size={13} /> Dupliquer
							</button>
							<a href={`/admin?client-plan=${p._id}`} class="flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand" title="Assigner depuis la fiche d'une cliente">
								<Icon name="users" size={13} /> Assigner
							</a>
							<button type="button" onclick={() => deletePlan(p)} class="grid h-8 w-8 place-items-center rounded-lg border-2 border-line text-danger transition hover:border-danger" title="Supprimer">
								<Icon name="trash" size={13} />
							</button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- ═══════ Éditeur de plan (réutilise le moteur du Journal) ═══════ -->
{#if editorOpen}
	<div class="fixed inset-0 z-50 overflow-y-auto bg-soft">
		<div class="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
			<header class="mb-4 flex items-center justify-between gap-3">
				<h2 class="font-display text-xl font-semibold text-ink">{editingId ? 'Modifier le plan' : 'Nouveau plan'}</h2>
				<button type="button" onclick={() => (editorOpen = false)} class="grid h-10 w-10 place-items-center rounded-full text-mist transition hover:bg-line/50" aria-label="Fermer"><Icon name="x" size={20} /></button>
			</header>

			<label class="block">
				<span class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-mist">Nom du plan *</span>
				<input type="text" bind:value={planName} placeholder="Ex. Plan 1 800 kcal" class="w-full rounded-xl border-2 border-line bg-white px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-brand" />
			</label>
			<label class="mt-2 block">
				<span class="mb-1 block text-[11px] font-bold uppercase tracking-wider text-mist">Description (optionnel)</span>
				<input type="text" bind:value={planDesc} placeholder="Ex. journée type sans produit laitier" class="w-full rounded-xl border-2 border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand" />
			</label>

			<!-- Résumé nutritionnel du TEMPLATE (valeurs PRÉVUES du plan, pas une consommation) -->
			<div class="mt-4 grid grid-cols-4 gap-2">
				<div class="rounded-xl border border-line bg-white p-2 text-center">
					<Icon name="flame" size={16} class="mx-auto block text-brand" />
					<span class="block text-sm font-bold text-ink">{fmt(totals.kcal)}</span>
					<span class="block text-[10px] text-mist">kcal</span>
				</div>
				<div class="rounded-xl border border-line bg-white p-2 text-center">
					<span class="mx-auto block text-sm font-bold text-ink">{fmt(totals.carbs)} g</span>
					<span class="block text-[10px] text-mist">glucides</span>
				</div>
				<div class="rounded-xl border border-line bg-white p-2 text-center">
					<span class="mx-auto block text-sm font-bold text-ink">{fmt(totals.protein)} g</span>
					<span class="block text-[10px] text-mist">protéines</span>
				</div>
				<div class="rounded-xl border border-line bg-white p-2 text-center">
					<span class="mx-auto block text-sm font-bold text-ink">{fmt(totals.fat)} g</span>
					<span class="block text-[10px] text-mist">lipides</span>
				</div>
			</div>

			<!-- Repas du plan -->
			<div class="mt-4 flex flex-col gap-3">
				{#each MEAL_DEFS as meal (meal.id)}
					{@const mealItems = items.filter((it) => it.meal === meal.id)}
					<section class="rounded-2xl border border-line bg-card p-3">
						<div class="mb-2 flex items-center justify-between gap-2">
							<h3 class="flex items-center gap-1.5 text-sm font-bold text-ink">
								<Icon name={meal.icon} size={15} class="text-brand" />
								{meal.label}
								{#if mealItems.length > 0}<span class="text-[11px] font-semibold text-brand tabular-nums">{fmt(mealKcalOf(meal.id))} kcal</span>{/if}
							</h3>
							<button type="button" class="rounded-full border border-brand/40 px-2.5 py-1 text-[11px] font-bold text-brand transition hover:bg-brand-light" onclick={() => { searchForMeal = meal.id; document.getElementById('plan-search')?.focus(); }}>
								+ Ajouter
							</button>
						</div>
						{#if mealItems.length === 0}
							<p class="rounded-xl border border-dashed border-line px-3 py-3 text-center text-xs text-mist">Aucun aliment — utilise « + Ajouter ».</p>
						{:else}
							<ul class="flex flex-col divide-y divide-line/60">
								{#each mealItems as it (it.key)}
									<li class="flex items-center gap-2 py-1.5">
										{#if it.food.imageUrl}
											<FoodImg src={it.food.imageUrl} alt="" class="h-9 w-9 rounded-lg" />
										{:else}
											<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={15} class="text-brand" /></div>
										{/if}
										<span class="min-w-0 flex-1">
											<span class="block truncate text-[13px] font-semibold text-ink">{it.food.name}</span>
											<span class="block text-[11px] text-mist tabular-nums"><strong class="text-brand">{fmt(itemKcal(it))} kcal</strong> · {fmt(it.qty)} g</span>
										</span>
										<div class="flex shrink-0 items-center gap-1">
											<button type="button" class="grid h-7 w-7 place-items-center rounded-lg border border-line text-sm font-bold text-ink" aria-label="Moins" onclick={() => setQty(it.key, it.qty - 10)}>−</button>
											<span class="w-12 text-center text-xs font-bold tabular-nums text-ink">{fmt(it.qty)} g</span>
											<button type="button" class="grid h-7 w-7 place-items-center rounded-lg border border-line text-sm font-bold text-ink" aria-label="Plus" onclick={() => setQty(it.key, it.qty + 10)}>+</button>
											<select bind:value={it.meal} onchange={() => setMeal(it.key, it.meal)} class="ml-1 rounded-lg border border-line bg-white px-1 py-1 text-[10px] text-mist outline-none" aria-label="Repas">
												{#each MEAL_DEFS as m (m.id)}
													<option value={m.id}>{m.label.split(' ')[0]}</option>
												{/each}
											</select>
											<button type="button" class="ml-0.5 grid h-7 w-7 place-items-center rounded-lg text-mist hover:bg-danger-light hover:text-danger" aria-label="Retirer" onclick={() => removeItem(it.key)}>✕</button>
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			</div>

			<!-- Recherche d'aliments (moteur du Journal : base OFF + coach) -->
			<div class="sticky bottom-0 mt-4 bg-soft pb-4 pt-2">
				<div class="flex items-center gap-2 rounded-xl border-2 border-line bg-white px-3 py-2.5 focus-within:border-brand">
					<Icon name="search" size={17} class="shrink-0 text-mist" />
					<input
						id="plan-search"
						type="search"
						class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-mist"
						placeholder={`Rechercher un aliment pour « ${MEAL_LABEL[searchForMeal] ?? searchForMeal} »…`}
						bind:value={searchQ}
						oninput={onSearchInput}
					/>
				</div>
				{#if searching}
					<p class="py-2 text-center text-xs text-mist">Recherche…</p>
				{:else if results.length > 0}
					<ul class="mt-2 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
						{#each results as food (food._id)}
							<li>
								<button type="button" class="flex w-full items-center gap-2 rounded-xl border border-line bg-white p-2 text-left transition hover:border-brand" onclick={() => addItem(food)}>
									{#if food.imageUrl}
										<FoodImg src={food.imageUrl} alt="" class="h-9 w-9 rounded-lg" />
									{:else}
										<div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-light"><Icon name="utensils" size={15} class="text-brand" /></div>
									{/if}
									<span class="min-w-0 flex-1">
										<span class="block truncate text-[13px] font-semibold text-ink">{food.name}</span>
										<span class="block text-[11px] text-mist">{fmt(Math.round(food.kcal100))} kcal / 100 g{#if food.brand} · {food.brand}{/if}</span>
									</span>
									<span class="text-brand">＋</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if editorErr}
				<p class="mt-2 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{editorErr}</p>
			{/if}

			<div class="mt-2 flex gap-2">
				<button type="button" onclick={() => (editorOpen = false)} class="flex-1 rounded-full border-2 border-line px-3 py-3 text-sm font-bold text-ink transition hover:border-brand">Annuler</button>
				<button
					type="button"
					class="flex-[2] rounded-full bg-brand px-3 py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
					disabled={saving || planName.trim().length < 2 || items.length === 0}
					onclick={savePlan}
				>
					{saving ? 'Enregistrement…' : 'Enregistrer le plan'}
				</button>
			</div>
		</div>
	</div>
{/if}
