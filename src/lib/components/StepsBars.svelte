<script lang="ts">
	/**
	 * StepsBars — graphique en barres des pas quotidiens sur une fenêtre
	 * (par défaut les 7 derniers jours), fidèle à Steps.svelte (Claude v2).
	 *
	 * Règles de données :
	 *  - `days` contient UNE entrée par jour de la fenêtre ; `count: null`
	 *    signifie « pas de donnée » — JAMAIS un zéro inventé (jour vide ≠ 0).
	 *  - L'objectif (si présent) participe à l'échelle verticale et s'affiche
	 *    en ligne pointillée discrète avec pastille verte à droite.
	 */
	type Day = { date: string; count: number | null };

	let {
		days,
		goal = null,
		height = 150,
		compact = false,
	}: {
		days: Day[];
		/** Objectif quotidien (optionnel) — ligne pointillée + légende. */
		goal?: number | null;
		height?: number;
		/** Mode compact (cockpit CRM) : labels réduits, barres plus fines. */
		compact?: boolean;
	} = $props();

	function iso(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	const windowDays = $derived.by<Day[]>(() => {
		if (days.length === 7) return days;
		const out: Day[] = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			const key = iso(d);
			const hit = days.find((x) => x.date === key);
			out.push({ date: key, count: hit ? hit.count : null });
		}
		return out;
	});

	const counts = $derived(windowDays.map((d) => d.count).filter((c): c is number => c !== null));
	const yMax = $derived(Math.max(1, ...counts, goal != null ? goal : 0) * 1.15);
	const barPct = $derived((c: number) => Math.max(5, (c / yMax) * 100));
	const goalBottomPx = $derived(
		goal !== null ? Math.min(Math.round((goal / yMax) * height), height - 10) : Math.round(height * 0.8)
	);

	const WEEK_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
	function dayLetter(date: string): string {
		return WEEK_LETTERS[new Date(date + 'T12:00:00').getDay()];
	}
	function tooltipTitle(date: string): string {
		const d = new Date(date + 'T12:00:00');
		return d
			.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
			.replace(/^./, (c) => c.toUpperCase());
	}

	let selected = $state<number | null>(null);
	let hovered = $state<number | null>(null);
	const shown = $derived(hovered ?? selected);
	function pick(i: number) {
		selected = selected === i ? null : i;
	}
	function tipClass(i: number): string {
		if (i === 0) return 'left-0 -translate-x-0';
		if (i === windowDays.length - 1) return 'right-0 translate-x-0';
		return 'left-1/2 -translate-x-1/2';
	}
	function tipStyle(i: number): string {
		const c = windowDays[i].count;
		if (c === null) return '';
		const px = (barPct(c) / 100) * height;
		return `bottom: ${Math.min(px + (compact ? 12 : 28), height)}px`;
	}
</script>

<div
	role="presentation"
	class="relative w-full select-none"
	onpointerdown={(e) => {
		if ((e.target as HTMLElement).closest('button')) return;
		selected = null;
	}}
>
	{#if goal !== null}
		<div
			class="pointer-events-none absolute left-0 right-0 z-[1] border-t-2 border-dashed border-[#1db954]/30"
			style="bottom: {goalBottomPx + 24}px"
		></div>
		<span
			class="pointer-events-none absolute right-0 z-[2] rounded-[12px] bg-[#e8fef0] px-[9px] py-[3px] text-[11px] font-black text-[#0d7c36]"
			style="bottom: {goalBottomPx + 14}px"
		>
			{goal.toLocaleString('fr-FR')}
		</span>
	{/if}

	<div class="grid grid-cols-7 gap-1">
		{#each windowDays as day, i (day.date)}
			<div class="relative flex flex-col items-center justify-end gap-1.5">
				<button
					type="button"
					class="group flex w-full flex-col items-center justify-end gap-1.5 outline-none"
					onfocus={() => (hovered = i)}
					onblur={() => (hovered = null)}
					aria-label={day.count !== null ? `${tooltipTitle(day.date)} — ${day.count.toLocaleString('fr-FR')} pas` : `${tooltipTitle(day.date)} — pas de donnée`}
					onclick={(e) => {
						e.stopPropagation();
						pick(i);
					}}
					onpointerenter={() => (hovered = i)}
					onpointerleave={() => (hovered = null)}
					onpointerup={() => (hovered = null)}
				>
					<div class="flex w-full flex-col items-center justify-end" style="height: {height}px">
						{#if day.count !== null}
							{@const px = (barPct(day.count) / 100) * height}
							{@const sel = selected === i}
							<div
								class="vbar rounded-[13px] transition-all duration-300 {sel
									? 'bg-[#1db954] shadow-[0_0_0_3px_rgba(29,185,84,0.18)]'
									: goal !== null && day.count >= goal
										? 'bg-[#1db954]'
										: 'bg-[#111A15]'}"
								style="width: {compact ? '18px' : '26px'}; height: {Math.max(px, compact ? 6 : 8)}px"
							></div>
						{:else}
							<div class="mb-0.5 text-[14px] font-black tracking-[1px] text-[#C9D0CC]">– –</div>
						{/if}
					</div>
					<span class="text-center text-[12.5px] {day.count !== null ? 'font-black text-[#0F1512]' : 'font-bold text-[#9AA39E]'}">
						{dayLetter(day.date)}
					</span>
				</button>

				{#if shown === i && day.count !== null}
					<div
						class="pointer-events-none absolute z-10 whitespace-nowrap rounded-[12px] bg-[#111A15] px-3 py-1.5 text-center shadow-[0_12px_24px_-10px_rgba(15,21,18,0.5)] {tipClass(i)}"
						style={tipStyle(i)}
					>
						<span class="block text-[13px] font-black text-white">{day.count.toLocaleString('fr-FR')} pas</span>
						<span class="block text-[11px] font-normal text-[#C9D0CC]">{tooltipTitle(day.date)}</span>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
