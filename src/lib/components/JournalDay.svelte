<script lang="ts">
	/**
	 * JournalDay — la journée alimentaire complète, rendue À L'IDENTIQUE
	 * dans l'espace cliente et dans la Vision 360 du CRM coach.
	 *
	 * Une seule source de vérité visuelle : carte calories (objectif /
	 * filet de sécurité / maintenance), anneaux macros, et les 4 repas avec
	 * leurs lignes alimentaires (image, nom, kcal, portion).
	 *
	 * mode="client" : la ligne est cliquable → feuille de quantité (édition).
	 * mode="coach"  : mêmes lignes + commandes compactes − / + / supprimer.
	 */
	import Icon from './Icon.svelte';
	import FoodImg from './FoodImg.svelte';

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
		portions?: number;
	};
	type Day = {
		date: string;
		goals: { kcal: number; carbs: number; protein: number; fat: number; maintenanceKcal?: number };
		goalsSet?: boolean;
		entries: Entry[];
		totals: { kcal: number; carbs: number; protein: number; fat: number };
	};

	let {
		day,
		mode = 'client',
		tip = null,
		onAdd,
		onEntryClick,
		onQty,
		onRemove,
		onCalCardMount,
		onTipDismiss,
	}: {
		day: Day;
		mode?: 'client' | 'coach';
		/** Astuce du jour (côté client uniquement) — affichée entre macros et repas. */
		tip?: string | null;
		onAdd?: (meal: string) => void;
		onEntryClick?: (e: Entry) => void;
		onQty?: (e: Entry, qty: number) => void;
		onRemove?: (e: Entry) => void;
		onCalCardMount?: (el: HTMLElement | undefined) => void;
		onTipDismiss?: () => void;
	} = $props();

	const MEAL_DEFS = [
		{ id: 'petit-dej', label: 'Petit-déjeuner', icon: 'sunrise' },
		{ id: 'dejeuner', label: 'Déjeuner', icon: 'utensils' },
		{ id: 'diner', label: 'Dîner', icon: 'moon' },
		{ id: 'collation', label: 'Collations', icon: 'cookie' },
	] as const;

	/** Compacité mobile cliente : paddings/tailles resserrés, coach (CRM) inchangé. */
	const compact = $derived(mode === 'client');

	let calCardEl: HTMLElement | undefined;
	// Expose l'élément « carte calories » au parent (barre sticky côté client).
	$effect(() => {
		onCalCardMount?.(calCardEl);
		return () => onCalCardMount?.(undefined);
	});

	/* ————— Totaux & calculs (logique identique à l'espace cliente) ————— */
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
	/** Teinte contextuelle des calories (filet de sécurité compris). */
	const kcalTone = $derived(overMaintenance ? '#ef4444' : overGoal ? '#f59e0b' : '#1db954');

	function mealEntries(meal: string) {
		return day.entries.filter((e) => e.meal === meal);
	}
	function mealKcal(meal: string) {
		return Math.round(mealEntries(meal).reduce((s, e) => s + e.kcal, 0));
	}
	/** Part du repas dans l'objectif calorique du jour (affichage type FOOD). */
	function mealPct(meal: string) {
		return day.goals.kcal > 0 ? Math.round((mealKcal(meal) / day.goals.kcal) * 100) : 0;
	}
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
</script>

<!-- Carte calories -->
<section bind:this={calCardEl} class="mb-2 rounded-2xl border border-line bg-card {compact ? 'px-3 py-2' : 'p-4'}">
	{#if compact}
		<!-- Dense type FOOD : statut + valeur sur une seule ligne -->
		<div class="flex items-center justify-between gap-2">
			<p class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[13px] font-semibold text-ink">
				<span class="truncate">{overGoal ? (overMaintenance ? 'Maintenance dépassée de' : 'Objectif dépassé de') : 'Il te reste'}</span>
				<span class="font-bold leading-none text-ink tabular-nums text-2xl">
					{overGoal ? (overMaintenance ? fmt(totals.kcal - (maintenanceKcal ?? day.goals.kcal)) : fmt(totals.kcal - day.goals.kcal)) : fmt(remaining)}
				</span>
				<span class="font-semibold text-mist text-[12px]">kcal</span>
			</p>
			<Icon name="flame" size={18} class="shrink-0 text-brand" />
		</div>
		{#if inSafetyNet || overMaintenance}
			<p class="mt-1 flex items-center gap-1 text-[11px] font-semibold {overMaintenance ? 'text-danger/80' : 'text-warn'}">
				<Icon name="lifeBuoy" size={11} class="shrink-0" />
				{overMaintenance ? 'On ajuste ensemble — ça reste dans le cadre.' : 'Dans ton filet de sécurité'}
			</p>
		{/if}
	{:else}
		<div class="flex items-start justify-between gap-3">
			<p class="text-sm text-ink">
				{overGoal ? (overMaintenance ? 'Maintenance dépassée de' : 'Objectif dépassé de') : 'Il te reste'}
				<span class="block font-bold leading-tight text-ink text-3xl">
					{overGoal ? (overMaintenance ? fmt(totals.kcal - (maintenanceKcal ?? day.goals.kcal)) : fmt(totals.kcal - day.goals.kcal)) : fmt(remaining)}<span class="ml-1 font-semibold text-mist text-base">kcal</span>
				</span>
			</p>
			<Icon name="flame" size={26} class="mt-0.5 text-brand" />
		</div>
		{#if inSafetyNet}
			<p class="mt-0.5 flex items-center gap-1 text-xs font-semibold text-warn"><Icon name="lifeBuoy" size={13} class="shrink-0" /> Dans ton filet de sécurité</p>
		{/if}
		{#if overMaintenance}
			<p class="mt-0.5 text-xs font-semibold text-danger/80">Ta journée reste dans le cadre sur la durée — on ajuste ensemble si besoin.</p>
		{/if}
	{/if}
	<div class="relative mt-2 w-full overflow-hidden rounded-full bg-line/70 {compact ? 'h-1' : 'mt-3 h-2'}">
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
	<div class="flex items-baseline justify-between gap-2 {compact ? 'mt-1 text-[11px]' : 'mt-1.5 text-xs'}">
		<span class="font-semibold tabular-nums {overMaintenance ? 'text-danger' : overGoal ? 'text-warn' : 'text-brand'}">{fmt(Math.round(totals.kcal))} kcal consommées</span>
		<span class="text-right">
			<span class="font-semibold text-ink">Objectif : {fmt(day.goals.kcal)}</span>
			{#if maintenanceKcal}
				<span class="ml-1 text-mist {compact ? 'text-[10px]' : 'text-[11px]'}">· Maint. : {fmt(maintenanceKcal)}</span>
			{/if}
		</span>
	</div>
	<div class="inline-flex items-center gap-1 rounded-full bg-danger-light font-semibold text-danger {compact ? 'mt-1 px-2 py-0.5 text-[10px]' : 'mt-2 px-2.5 py-1 text-[11px]'}">
		<Icon name="clock" size={compact ? 10 : 12} /> 0 kcal brûlées
	</div>
</section>

<!-- Macros (fines, type FOOD : ring = indicateur, pas l'élément dominant) -->
<section class="grid grid-cols-3 {compact ? 'mb-1.5 gap-1' : 'mb-2.5 gap-2'}">
	{#each rings as ring (ring.label)}
		{@const pct = macroPct(ring.eaten, ring.goal)}
		{@const circ = 2 * Math.PI * 20}
		<div class="rounded-2xl border border-line bg-card text-center {compact ? 'px-1 pb-1 pt-1.5' : 'px-2 pb-2 pt-2.5'}">
			<div class="mb-0.5 flex items-center justify-between">
				<span class="font-bold text-ink {compact ? 'text-[9px]' : 'text-[10px]'}">{ring.label}</span>
				<Icon name={ring.icon} size={compact ? 11 : 14} class="shrink-0" style="color:{ring.color}" />
			</div>
			<div class="relative mx-auto {compact ? 'h-10 w-10' : 'h-[76px] w-[76px] md:h-[84px] md:w-[84px]'}">
				<svg viewBox="0 0 64 64" class="-rotate-90 {compact ? 'h-10 w-10' : 'h-[76px] w-[76px] md:h-[84px] md:w-[84px]'}">
					<circle cx="32" cy="32" r="20" fill="none" stroke="#eef0ec" stroke-width={compact ? 4 : 8} />
					<circle
						cx="32"
						cy="32"
						r="20"
						fill="none"
						stroke={ring.color}
						stroke-width={compact ? 4 : 8}
						stroke-linecap="round"
						stroke-dasharray={circ}
						stroke-dashoffset={circ * (1 - pct / 100)}
						style="transition: stroke-dashoffset .5s"
					/>
				</svg>
				<span class="absolute inset-0 grid place-items-center font-bold leading-none" style:color={ring.color}>
					<span class="{compact ? 'text-[11px]' : 'text-[15px] md:text-[17px]'}">{Math.round(pct)}%</span>
				</span>
			</div>
			<p class="text-ink {compact ? 'mt-0.5 text-[9px]' : 'mt-2 text-[11px]'}">
				<strong class="font-bold tabular-nums">{fmt(Math.round(ring.eaten))}</strong><span class="text-mist">/{fmt(ring.goal)}g</span>
			</p>
		</div>
	{/each}
</section>

<!-- Astuce du jour (client uniquement, secondaire et compacte) -->
{#if tip}
	<section class="rounded-2xl border border-dashed border-brand/40 bg-brand-light/40 {compact ? 'mb-1.5 px-3 py-1.5' : 'mb-2.5 px-3.5 py-2.5'}">
		<div class="flex items-center justify-between">
			<span class="text-[9px] font-bold uppercase tracking-widest text-brand">Astuce du jour</span>
			{#if onTipDismiss}
				<button
					type="button"
					class="grid h-6 w-6 place-items-center rounded-full bg-line/60 text-xs text-mist hover:bg-line"
					aria-label="Fermer l'astuce"
					onclick={onTipDismiss}
				>✕</button>
			{/if}
		</div>
		<p class="{compact ? 'mt-0.5 text-[12px]' : 'mt-1 text-[13px]'} leading-snug text-ink">{tip}</p>
	</section>
{/if}

<!-- Repas -->
{#each MEAL_DEFS as meal (meal.id)}
	{@const entries = mealEntries(meal.id)}
	<section class="overflow-hidden rounded-2xl border border-line bg-card {compact ? 'mb-1.5' : 'mb-2.5'}">
		<header class="flex items-center justify-between gap-2 {compact ? 'px-3 pb-1 pt-2' : 'px-3.5 pt-2.5'}">
			{#if compact}
				<!-- Type FOOD : titre + kcal & % en secondaire vert -->
				<div class="min-w-0">
					<h2 class="flex min-w-0 items-center font-display text-[15px] font-semibold text-ink">
						<Icon name={meal.icon} size={14} class="mr-1.5 shrink-0 text-brand" />{meal.label}
					</h2>
					<p class="mt-0.5 text-[10px] font-semibold tabular-nums text-brand">{fmt(mealKcal(meal.id))} kcal · {mealPct(meal.id)} %</p>
				</div>
			{:else}
				<h2 class="flex min-w-0 items-center font-display text-[15px] font-semibold text-ink">
					<Icon name={meal.icon} size={15} class="mr-1.5 shrink-0 text-brand" />{meal.label}
					{#if mealKcal(meal.id) > 0}
						<span class="ml-2 font-semibold text-brand tabular-nums text-xs">{fmt(mealKcal(meal.id))} kcal</span>
					{/if}
				</h2>
			{/if}
			{#if onAdd}
				<button
					type="button"
					class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand text-base font-bold text-white transition hover:bg-brand-dark"
					aria-label={`Ajouter au ${meal.label}`}
					onclick={() => onAdd(meal.id)}
				>+</button>
			{/if}
		</header>
		<div class="{compact ? 'mt-1 px-1 pb-0.5' : 'mt-1.5 px-1 pb-1'}">
			{#if entries.length === 0}
				<p class="px-2.5 text-center text-xs text-mist {compact ? 'py-1.5' : 'py-2'}">Rien pour l'instant — ajoute un aliment avec « + ».</p>
			{:else}
				<div class="divide-y divide-line/60">
					{#each entries as e (e._id)}
						{#if mode === 'client' && onEntryClick}
							<button
								type="button"
								class="flex w-full items-center text-left transition hover:bg-line/40 {compact ? 'gap-2.5 px-2 py-1.5' : 'gap-2.5 px-2 py-1.5'}"
								onclick={() => onEntryClick(e)}
							>
								{@render entryBody(e)}
							</button>
						{:else}
							<div class="flex w-full items-center {compact ? 'gap-2.5 px-2 py-1.5' : 'gap-2.5 px-2 py-1.5'}">
								{@render entryBody(e)}
								{#if mode === 'coach' && onQty && onRemove}
									<div class="flex shrink-0 items-center gap-1">
										<button
											type="button"
											onclick={() => onQty(e, Math.max(1, e.qtyGrams - 10))}
											class="grid h-7 w-7 place-items-center rounded-lg border-2 border-line text-sm font-bold text-ink transition hover:border-brand"
											aria-label="Réduire la quantité"
										>−</button>
										<span class="w-16 text-center text-sm font-semibold text-ink">{e.qtyGrams} g</span>
										<button
											type="button"
											onclick={() => onQty(e, e.qtyGrams + 10)}
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
					{/each}
				</div>
			{/if}
		</div>
	</section>
{/each}

{#snippet entryBody(e: Entry)}
	{#if e.imageUrl}
		<FoodImg src={e.imageUrl} alt="" eager={false} class="rounded-xl {compact ? 'h-12 w-12' : 'h-9 w-9'}" />
	{:else}
		<div class="grid shrink-0 place-items-center rounded-xl bg-brand-light {compact ? 'h-12 w-12' : 'h-9 w-9'}"><Icon name="utensils" size={compact ? 18 : 16} class="text-brand" /></div>
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