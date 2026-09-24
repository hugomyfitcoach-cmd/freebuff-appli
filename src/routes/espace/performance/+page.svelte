<script lang="ts">
	/**
	 * Performance — semaine du Journal (lundi → dimanche), vue G-FLUX native.
	 *
	 * - Semaine en cours par défaut, navigation semaine précédente / suivante ;
	 * - Diagramme par jour : calories + glucides + protéines + lipides (mêmes
	 *   couleurs que le Journal) — un jour sans données n'est JAMAIS un zéro ;
	 * - Sélection d'un jour : calories consommées / objectif + % et les 3
	 *   cartes circulaires macros du Journal (les % peuvent dépasser 100 %) ;
	 * - Récap hebdo : moyennes sur les jours RÉELLEMENT renseignés seulement ;
	 * - Graisse théorique estimée : déficit = maintenance cumulée − calories
	 *   réellement consommées (≈ 7 700 kcal = 1 kg), JAMAIS à partir de
	 *   l'objectif ; masqué si la maintenance n'est pas disponible.
	 *
	 * Données : uniquement le journal existant (lecture pure) + objectifs
	 * courants + maintenance existante. Aucun aliment recalculé.
	 */
	import { untrack } from 'svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PerformanceWeekCard from '$lib/components/PerformanceWeekCard.svelte';
	import { currentLocalDay } from '$lib/currentDay.svelte';

	import type { PerfWeek } from '$lib/perf';

	let { data } = $props();

	/* ————— Semaine affichée + navigation (lundi → dimanche, fuseau cliente) ————— */
	const todayISO = $derived(currentLocalDay() || data.today);
	let week = $state<PerfWeek>(untrack(() => data.week));
	let loading = $state(false);
	let error = $state('');

	/**
	 * ⚠️ PAS de re-synchronisation automatique depuis `data.week` ici : un
	 * $effect qui comparait `data.week.start` à `week.start` réécrasait la
	 * semaine chargée par `gotoWeek` (précédente/suivante) avec la semaine
	 * courante du serveur — la navigation « ne collait » jamais. La navigation
	 * locale est la seule source de vérité de la vue ; `isCurrentWeek` suit
	 * réactivement le jour local (currentLocalDay) pour l'état des boutons.
	 */

	function shiftISO(iso: string, days: number): string {
		const d = new Date(iso + 'T12:00:00');
		d.setDate(d.getDate() + days);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	async function gotoWeek(delta: number) {
		const target = shiftISO(week.start, delta * 7);
		loading = true;
		error = '';
		try {
			const r = await fetch(`/api/journal/week?start=${target}`);
			const j = await r.json();
			if (j.error) throw new Error(j.error);
			week = j as PerfWeek;
			selectedDay = null; // retour au défaut (aujourd'hui / 1er jour renseigné)
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	/** Semaine courante (pour masquer « suivante » quand on est déjà dessus). */
	const currentWeekStart = $derived.by(() => {
		const d = new Date(todayISO + 'T12:00:00');
		const dow = d.getDay();
		d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	});
	const isCurrentWeek = $derived(week.start === currentWeekStart);

	const MOIS_ABBR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const weekLabel = $derived.by(() => {
		const a = new Date(week.start + 'T12:00:00');
		const b = new Date(week.end + 'T12:00:00');
		return `${a.getDate()} ${MOIS_ABBR[a.getMonth()]} – ${b.getDate()} ${MOIS_ABBR[b.getMonth()]}`;
	});

	/* ————— Jour sélectionné (défaut : aujourd'hui si dans la semaine) ————— */
	/** Défaut : aujourd'hui si dans la semaine, sinon le 1er jour renseigné, sinon lundi. */
	const defaultSelected = $derived.by(() => {
		const idx = week.days.findIndex((d) => d.date === todayISO);
		if (idx >= 0) return idx;
		const firstTracked = week.days.findIndex((d) => d.tracked);
		return firstTracked >= 0 ? firstTracked : 0;
	});
	let selectedDay = $state<number | null>(null);
	const selected = $derived.by(() => {
		if (selectedDay !== null) return week.days[selectedDay] ?? null;
		return week.days[defaultSelected] ?? null;
	});
	const selectedLabel = $derived.by(() => {
		if (!selected) return '';
		const d = new Date(selected.date + 'T12:00:00');
		const wd = d.toLocaleDateString('fr-FR', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase());
		if (selected.date === todayISO) return `Aujourd'hui · ${d.getDate()} ${MOIS_ABBR[d.getMonth()]}`;
		return `${wd} · ${d.getDate()} ${MOIS_ABBR[d.getMonth()]}`;
	});

	/* ————— Calculs du jour sélectionné (identiques au Journal) ————— */
	const selKcalPct = $derived(selected && week.goals.kcal > 0 ? (selected.totals.kcal / week.goals.kcal) * 100 : 0);
	const macroPct = (eaten: number, goal: number) => (goal > 0 ? (eaten / goal) * 100 : 0);
	function fmt(n: number) {
		return n.toLocaleString('fr-FR');
	}
	/** Grammes avec 1 décimale max, virgule française (comme le Journal). */
	function fmtG(n: number) {
		return fmt(Math.round(n * 10) / 10);
	}

	/* ————— Récap hebdo : moyennes sur les jours renseignés UNIQUEMENT ————— */
	const trackedDays = $derived(week.days.filter((d) => d.tracked && d.date <= todayISO));
	const avg = $derived.by(() => {
		if (trackedDays.length === 0) return null;
		const sum = trackedDays.reduce(
			(acc, d) => {
				acc.kcal += d.totals.kcal;
				acc.carbs += d.totals.carbs;
				acc.protein += d.totals.protein;
				acc.fat += d.totals.fat;
				return acc;
			},
			{ kcal: 0, carbs: 0, protein: 0, fat: 0 }
		);
		const n = trackedDays.length;
		return {
			kcal: Math.round(sum.kcal / n),
			carbs: Math.round((sum.carbs / n) * 10) / 10,
			protein: Math.round((sum.protein / n) * 10) / 10,
			fat: Math.round((sum.fat / n) * 10) / 10,
		};
	});

	/* ————— Graisse théorique estimée (maintenance disponible uniquement) —————
	   déficit cumulé = (maintenance × jours renseignés) − calories consommées.
	   ≈ 7 700 kcal = 1 kg de graisse. JAMAIS calculée à partir de l'objectif. */
	const KCAL_PER_KG = 7700;
	const maintenance = $derived(
		week.goals.maintenanceKcal && week.goals.maintenanceKcal > week.goals.kcal ? week.goals.maintenanceKcal : null
	);
	const theoreticalFatKg = $derived.by(() => {
		if (!maintenance || trackedDays.length === 0) return null;
		const maintenanceTotal = maintenance * trackedDays.length;
		const eatenTotal = trackedDays.reduce((s, d) => s + d.totals.kcal, 0);
		const deficit = maintenanceTotal - eatenTotal;
		if (deficit <= 0) return null;
		return Math.round((deficit / KCAL_PER_KG) * 100) / 100;
	});

	/* ————— Cartes circulaires macros (mêmes couleurs/icônes que le Journal) ————— */
	const rings = $derived.by(() => {
		const t = selected?.totals ?? { kcal: 0, carbs: 0, protein: 0, fat: 0 };
		return [
			{ label: 'Glucides', icon: 'wheat', color: '#ec4899', eaten: t.carbs, goal: week.goals.carbs },
			{ label: 'Protéines', icon: 'drumstick', color: '#3b82f6', eaten: t.protein, goal: week.goals.protein },
			{ label: 'Lipides', icon: 'droplet', color: '#f97316', eaten: t.fat, goal: week.goals.fat },
		];
	});
	const RING_CIRC = 2 * Math.PI * 22;
</script>

<svelte:head><title>Performance — G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-xl pb-28">
	<BackToHome label="Performance" />

	<!-- En-tête + navigation semaine -->
	<div class="flex items-center gap-3">
		<div class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-light">
			<Icon name="chartColumn" size={22} class="text-brand" />
		</div>
		<div class="min-w-0 flex-1">
			<h1 class="font-display text-2xl font-semibold tracking-tight text-ink">Performance</h1>
			<p class="text-sm text-mist">Ta semaine dans le Journal — jours futurs grisés, jours sans données ignorés.</p>
		</div>
	</div>

	<!-- Sélecteur de semaine -->
	<section class="mt-4 flex items-center justify-between gap-2 rounded-2xl border border-line bg-card px-2 py-2 shadow-sm">
		<button
			type="button"
			class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-mist transition hover:bg-line/50 hover:text-ink"
			aria-label="Semaine précédente"
			onclick={() => void gotoWeek(-1)}
			disabled={loading}
		>
			<Icon name="chevronLeft" size={18} />
		</button>
		<div class="min-w-0 text-center">
			<p class="truncate text-[11px] font-bold uppercase tracking-widest text-mist">
				{isCurrentWeek ? 'Semaine en cours' : `Semaine du ${week.start}`}
			</p>
			<p class="font-display text-lg font-bold leading-tight tracking-tight text-ink tabular-nums">{weekLabel}</p>
		</div>
		<button
			type="button"
			class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-mist transition hover:bg-line/50 hover:text-ink disabled:opacity-30"
			aria-label="Semaine suivante"
			onclick={() => void gotoWeek(1)}
			disabled={loading || isCurrentWeek}
		>
			<Icon name="chevronRight" size={18} />
		</button>
	</section>

	{#if error}
		<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{error}</p>
	{/if}

	<!-- Diagramme semaine (calories + 3 anneaux macros par jour) -->
	<section class="mt-3 rounded-3xl border border-line bg-card p-4 shadow-sm">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Lundi → dimanche</h2>
			{#if loading}<Icon name="refreshCw" size={14} class="animate-spin text-mist" />{/if}
		</div>
		<div class="mt-3">
			<PerformanceWeekCard
				days={week.days}
				goals={week.goals}
				today={todayISO}
				selected={selected ? week.days.findIndex((d) => d.date === selected.date) : null}
				onSelect={(i) => (selectedDay = i)}
			/>
		</div>
		<p class="mt-2 px-1 text-[11px] text-mist">Touche un jour pour voir son détail.</p>
	</section>

	<!-- Détail du jour sélectionné -->
	{#if selected}
		<section class="mt-3 rounded-3xl border border-line bg-card p-4 shadow-sm">
			<div class="flex items-center justify-between gap-2">
				<h2 class="font-display text-lg font-semibold tracking-tight text-ink">{selectedLabel}</h2>
				{#if selected.tracked}
					<span class="rounded-full bg-brand-light px-2.5 py-1 text-[11px] font-bold text-brand-dark tabular-nums">
						{Math.round(selKcalPct)} % de l'objectif
					</span>
				{/if}
			</div>

			{#if !selected.tracked}
				<div class="mt-3 flex items-center gap-2 rounded-2xl border border-dashed border-line bg-soft px-3.5 py-3">
					<Icon name="info" size={16} class="shrink-0 text-mist" />
					<p class="text-sm text-mist">Aucune donnée enregistrée ce jour-là — rien n'est compté comme zéro.</p>
				</div>
			{:else}
				<!-- Calories -->
				<div class="mt-3">
					<div class="flex items-baseline justify-between gap-2">
						<p class="flex items-center gap-1.5 text-sm font-bold text-ink">
							<Icon name="flame" size={15} class="shrink-0 text-brand" /> Calories
						</p>
						<p class="text-sm tabular-nums">
							<strong class="font-bold text-ink">{fmt(selected.totals.kcal)}</strong>
							<span class="font-semibold text-mist"> / {fmt(week.goals.kcal)} kcal</span>
						</p>
					</div>
					<div class="mt-1.5 h-2 overflow-hidden rounded-full bg-line/70">
						<div
							class="h-full rounded-full transition-all duration-500 {selected.totals.kcal > week.goals.kcal ? 'bg-warn' : 'bg-brand'}"
							style="width: {Math.min(100, selKcalPct)}%"
						></div>
					</div>
				</div>

				<!-- Macros : mêmes cartes circulaires que le Journal (% > 100 % possibles) -->
				<div class="mt-4 grid grid-cols-3 gap-2">
					{#each rings as ring (ring.label)}
						{@const pct = macroPct(ring.eaten, ring.goal)}
						{@const fill = Math.min(100, pct)}
						<div class="rounded-2xl border border-line bg-card px-1.5 pb-2 pt-2 text-center">
							<div class="mb-2 flex items-center justify-between px-0.5">
								<span class="text-[10px] font-bold text-ink">{ring.label}</span>
								<Icon name={ring.icon} size={12} class="shrink-0" style="color:{ring.color}" />
							</div>
							<div class="relative mx-auto h-[76px] w-[76px]">
								<svg viewBox="0 0 64 64" class="h-[76px] w-[76px] -rotate-90">
									<circle cx="32" cy="32" r="22" fill="none" stroke="#eef0ec" stroke-width="4" />
									{#if fill > 0}
										<circle
											cx="32"
											cy="32"
											r="22"
											fill="none"
											stroke={ring.color}
											stroke-width="4"
											stroke-linecap="round"
											stroke-dasharray={RING_CIRC}
											stroke-dashoffset={RING_CIRC * (1 - fill / 100)}
											style="transition: stroke-dashoffset .5s"
										/>
									{/if}
								</svg>
								<span class="absolute inset-0 grid place-items-center font-bold leading-none text-[15px]" style:color={ring.color}>
									{Math.round(pct)} %
								</span>
							</div>
							<p class="mt-1.5 text-[10px] text-ink">
								<strong class="font-bold tabular-nums">{fmtG(ring.eaten)}</strong><span class="text-mist">/{fmt(ring.goal)} g</span>
							</p>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	<!-- Récap hebdomadaire -->
	<section class="mt-3 rounded-3xl border border-line bg-card p-4 shadow-sm">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-[11px] font-bold uppercase tracking-widest text-mist">Récap de la semaine</h2>
			<span class="text-[11px] font-semibold text-mist tabular-nums">{trackedDays.length} / 7 jours renseignés</span>
		</div>

		{#if avg}
			<div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-2xl bg-soft px-3 py-2.5">
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><Icon name="flame" size={11} class="shrink-0" /> kcal moy.</p>
					<p class="mt-0.5 font-display text-xl font-bold tabular-nums leading-tight text-ink">{fmt(avg.kcal)}</p>
					<p class="text-[10px] text-mist">Objectif {fmt(week.goals.kcal)}</p>
				</div>
				<div class="rounded-2xl bg-soft px-3 py-2.5">
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:#ec4899"></span> Glucides</p>
					<p class="mt-0.5 font-display text-xl font-bold tabular-nums leading-tight text-ink">{fmtG(avg.carbs)}<span class="text-xs font-semibold text-mist"> g</span></p>
					<p class="text-[10px] text-mist">Objectif {fmt(week.goals.carbs)} g</p>
				</div>
				<div class="rounded-2xl bg-soft px-3 py-2.5">
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:#3b82f6"></span> Protéines</p>
					<p class="mt-0.5 font-display text-xl font-bold tabular-nums leading-tight text-ink">{fmtG(avg.protein)}<span class="text-xs font-semibold text-mist"> g</span></p>
					<p class="text-[10px] text-mist">Objectif {fmt(week.goals.protein)} g</p>
				</div>
				<div class="rounded-2xl bg-soft px-3 py-2.5">
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist"><span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:#f97316"></span> Lipides</p>
					<p class="mt-0.5 font-display text-xl font-bold tabular-nums leading-tight text-ink">{fmtG(avg.fat)}<span class="text-xs font-semibold text-mist"> g</span></p>
					<p class="text-[10px] text-mist">Objectif {fmt(week.goals.fat)} g</p>
				</div>
			</div>
		{:else}
			<div class="mt-3 flex items-center gap-2 rounded-2xl border border-dashed border-line bg-soft px-3.5 py-3">
				<Icon name="info" size={16} class="shrink-0 text-mist" />
				<p class="text-sm text-mist">Aucun jour renseigné sur cette semaine pour l'instant.</p>
			</div>
		{/if}

		<!-- Perte de graisse théorique estimée (maintenance disponible uniquement, sinon masqué) -->
		{#if theoreticalFatKg !== null && maintenance}
			<div class="mt-3 rounded-2xl border border-line bg-soft px-3.5 py-3">
				<p class="flex items-center gap-1.5 text-sm font-semibold text-ink">
					<Icon name="scale" size={15} class="shrink-0 text-brand" />
					Perte de graisse théorique estimée à ce stade de la semaine : <strong class="font-bold">{String(theoreticalFatKg).replace('.', ',')} kg</strong>
				</p>
				<p class="mt-1 text-[11px] leading-snug text-mist">
					Estimation indicative calculée uniquement sur les jours renseignés de la semaine, selon le déficit calorique cumulé à l'instant T.
				</p>
			</div>
		{/if}

		<p class="mt-3 flex items-start gap-1.5 px-1 text-xs leading-relaxed text-mist">
			<Icon name="lightbulb" size={13} class="mt-0.5 shrink-0" />
			<span>Les moyennes sont calculées sur les jours réellement renseignés : une journée sans saisie n'est jamais comptée comme 0 kcal.</span>
		</p>
	</section>
</div>
