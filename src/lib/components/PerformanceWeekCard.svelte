<script lang="ts">
	/**
	 * PerformanceWeekCard — vue semaine lundi → dimanche du journal.
	 *
	 * Un seul rendu, réutilisé par la carte « Performance » de l'Accueil et par
	 * la page Performance : barre de calories par jour (vert G-FLUX) + sous
	 * chaque jour 3 mini-anneaux concentriques (Glucides rose / Protéines bleu /
	 * Lipides orange — mêmes couleurs et mêmes icônes que les cartes du Journal).
	 *
	 * Règles de données (identiques au Journal / récap hebdo) :
	 *  - `totals` d'un jour = UNIQUEMENT le consommé (items planifiés exclus) ;
	 *  - `tracked: false` = journée sans données → grise, JAMAIS un zéro ;
	 *  - les jours FUTURS (postérieurs au jour local de la cliente) sont grisés
	 *    même si des données existaient — on ne mange pas demain ;
	 *  - l'échelle des barres = max(semaine, objectif) pour garder l'objectif lisible.
	 */
	import Icon from './Icon.svelte';
	import type { PerfDay, PerfGoals } from '$lib/perf';

	let {
		days,
		goals,
		/** Jour local ISO (frontière de grisage des jours futurs). */
		today,
		/** Index du jour sélectionné (page Performance) — surbrillance discrète. */
		selected = null,
		compact = false,
		onSelect,
	}: {
		days: PerfDay[];
		goals: PerfGoals;
		today: string;
		selected?: number | null;
		compact?: boolean;
		onSelect?: (index: number) => void;
	} = $props();

	/* Mêmes couleurs que les anneaux du Journal (JournalDay.svelte). */
	const MACRO_COLORS = { carbs: '#ec4899', protein: '#3b82f6', fat: '#f97316' } as const;
	const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

	const scale = $derived.by(() => {
		const maxEaten = Math.max(1, ...days.map((d) => d.totals.kcal));
		return Math.max(maxEaten, goals.kcal, 1);
	});
	const kcalPct = (d: PerfDay) => Math.min(100, (d.totals.kcal / scale) * 100);
	const macroPct = (v: number, goal: number) => (goal > 0 ? Math.min(100, (v / goal) * 100) : 0);
	const isFuture = (date: string) => date > today;
	const isToday = (date: string) => date === today;

	/** Anneaux concentriques (3 par jour, du plus petit au plus grand). */
	const RINGS = [
		{ key: 'carbs' as const, r: 5.5, sw: 2.6 },
		{ key: 'protein' as const, r: 9.5, sw: 2.6 },
		{ key: 'fat' as const, r: 13.5, sw: 2.6 },
	];
	const RING_CIRC = (r: number) => 2 * Math.PI * r;

	function dayLetter(date: string): string {
		// La semaine commence lundi (index 0 = lundi).
		const d = new Date(date + 'T12:00:00');
		const dow = d.getDay(); // 0 = dimanche
		return DAY_LETTERS[(dow + 6) % 7];
	}

	function fmt(n: number) {
		return n.toLocaleString('fr-FR');
	}

	/* ── Apparition douce (motion G-FLUX) ─────────────────────────────────
	   Au PREMIER rendu de vraies données (la carte Accueil charge la semaine
	   en async), chaque barre et chaque anneau part de 0 → valeur, avec un
	   léger décalage par jour (stagger). Uniquement transform/opacity/stroke
	   (GPU-friendly), une seule fois — aucune animation permanente. Les
	   re-rendus (page Performance, changement de semaine) n'arment rien :
	   la classe n'est posée qu'une fois, au premier passage en état armé.
	   Neutralisée sous prefers-reduced-motion (layout.css). */
	let revealed = $state(false);

	$effect(() => {
		if (!revealed) {
			/* Premier passage avec des données : on arme les keyframes « from »
			   puis on désarme au frame suivant (une seule fois par montage). */
			const id = requestAnimationFrame(() => (revealed = true));
			return () => cancelAnimationFrame(id);
		}
	});
</script>

<div class="grid grid-cols-7 {compact ? 'gap-1' : 'gap-1.5'} {revealed ? '' : 'perf-armed'}">
	{#each days as d, i (d.date)}
		{@const future = isFuture(d.date)}
		{@const sel = selected === i}
		<!-- button quand sélectionnable (page Performance) ; div sinon (carte Accueil
	     elle-même cliquable — jamais de bouton imbriqué dans un lien). -->
		<svelte:element
			this={onSelect ? 'button' : 'div'}
			type={onSelect ? 'button' : undefined}
			class="flex flex-col items-center gap-1 rounded-2xl outline-none transition
				{sel ? 'bg-brand-light/70 ring-1 ring-brand/40' : onSelect ? 'hover:bg-line/30' : ''}
				{onSelect ? 'cursor-pointer active:scale-[0.97]' : ''}"
			onclick={onSelect ? () => onSelect(i) : undefined}
			aria-label={`Performance du ${d.date}`}
		>
			<span class="text-[10px] font-bold uppercase tracking-wide {future ? 'text-mist/50' : isToday(d.date) ? 'text-brand-dark' : sel ? 'text-ink' : 'text-mist'}">
				{dayLetter(d.date)}
			</span>

			<!-- Barre de calories du jour (objectif = échelle commune) -->
			<div class="flex w-full flex-1 items-end justify-center px-0.5 {compact ? 'h-14' : 'h-20'}">
				<div class="relative h-full w-full max-w-[14px] overflow-hidden rounded-full bg-line/50">
					{#if d.tracked && !future}
						<div
							class="perf-bar absolute bottom-0 left-0 w-full rounded-full transition-all duration-500
								{d.totals.kcal > goals.kcal ? 'bg-warn' : 'bg-brand'}"
							style="height: {Math.max(kcalPct(d), 4)}%; --perf-i: {i}"
						></div>
					{/if}
				</div>
			</div>

			<!-- 3 mini-anneaux macros (Glucides / Protéines / Lipides) -->
			<div class="relative {compact ? 'h-9 w-9' : 'h-11 w-11'}">
				<svg viewBox="0 0 32 32" class="{compact ? 'h-9 w-9' : 'h-11 w-11'} -rotate-90">
					{#each RINGS as ring, ringIdx (ring.key)}
						{@const fill = d.tracked && !future ? macroPct(d.totals[ring.key], goals[ring.key]) : 0}
						<circle cx="16" cy="16" r={ring.r} fill="none" stroke="#eef0ec" stroke-width={ring.sw} />
						{#if fill > 0}
							<circle
								class="perf-ring"
								cx="16"
								cy="16"
								r={ring.r}
								fill="none"
								stroke={MACRO_COLORS[ring.key]}
								stroke-width={ring.sw}
								stroke-linecap="round"
								stroke-dasharray={RING_CIRC(ring.r)}
								stroke-dashoffset={RING_CIRC(ring.r) * (1 - fill / 100)}
								style="--perf-i: {i * 3 + ringIdx}"
							/>
						{/if}
					{/each}
				</svg>
			</div>

			<!-- Valeur compacte : kcal du jour (jamais 0 inventé sur un jour sans données) -->
			<span class="text-center text-[9px] font-bold leading-none tabular-nums {d.tracked && !future ? 'text-ink' : 'text-mist/50'}">
				{#if d.tracked && !future}
					{fmt(d.totals.kcal)}
				{:else}
					—
				{/if}
			</span>
		</svelte:element>
	{/each}
</div>

{#if !compact}
	<!-- Légende discrète (une seule fois, sous la vue semaine) -->
	<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] font-semibold text-mist">
		<span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-brand"></span> Calories</span>
		<span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full" style="background:{MACRO_COLORS.carbs}"></span> Glucides</span>
		<span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full" style="background:{MACRO_COLORS.protein}"></span> Protéines</span>
		<span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full" style="background:{MACRO_COLORS.fat}"></span> Lipides</span>
		<span class="ml-auto inline-flex items-center gap-1"><Icon name="flame" size={10} class="shrink-0" /> Objectif : {fmt(goals.kcal)} kcal</span>
	</div>
{/if}

<style>
	/* Apparition douce, armée UNE fois au premier rendu des données :
	   la classe .perf-armed est posée au premier render (revealed=false) puis
	   retirée — les keyframes « from » (backwards) jouent alors 300 ms. */
	.perf-armed :global(.perf-bar) {
		animation: perf-bar-in 400ms var(--ease-soft, ease-out) backwards;
		animation-delay: calc(var(--perf-i, 0) * 30ms);
	}
	.perf-armed :global(.perf-ring) {
		animation: perf-fade 300ms var(--ease-soft, ease-out) backwards;
		animation-delay: calc(var(--perf-i, 0) * 10ms);
	}
	@keyframes perf-bar-in {
		from {
			transform: scaleY(0.001);
			opacity: 0;
		}
	}
	@keyframes perf-fade {
		from {
			opacity: 0;
		}
	}
</style>
