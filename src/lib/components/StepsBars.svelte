<script lang="ts">
	/**
	 * StepsBars — graphique en barres des pas quotidiens sur une fenêtre
	 * (par défaut les 7 derniers jours). Réutilisé côté cliente (« Mes pas »)
	 * et côté CRM (cockpit Vision 360) — une seule implémentation.
	 *
	 * Règles de données :
	 *  - `days` contient UNE entrée par jour de la fenêtre ; `count: null`
	 *    signifie « pas de donnée » — JAMAIS un zéro inventé (jour vide ≠ 0).
	 *  - L'objectif (si présent) participe à l'échelle verticale et s'affiche
	 *    en ligne pointillée discrète.
	 *
	 * Interactions : hover (desktop) et tap/clic (mobile) affichent un tooltip
	 * date + valeur ; un tap « épingle » la sélection (nouveau tap ou clic hors
	 * barres la referme). Le tooltip ne sort jamais de la carte (clampé).
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

	/* ————— Fenêtre de 7 jours (si absente du parent, on la construit) ————— */
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
	const yMax = $derived(Math.max(1, ...counts, goal != null ? goal : 0) * 1.08);
	const barPct = $derived((c: number) => Math.max(4, (c / yMax) * 100));

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

	/* ————— Sélection / survol ————— */
	let selected = $state<number | null>(null);
	let hovered = $state<number | null>(null);
	const shown = $derived(hovered ?? selected);
	function pick(i: number) {
		selected = selected === i ? null : i;
	}
	/** Position du tooltip : jamais débordant à gauche/droite. */
	function tipClass(i: number): string {
		if (i === 0) return 'left-0 -translate-x-0';
		if (i === windowDays.length - 1) return 'right-0 translate-x-0';
		return 'left-1/2 -translate-x-1/2';
	}
	function tipStyle(i: number): string {
		const c = windowDays[i].count;
		if (c === null) return '';
		const px = (barPct(c) / 100) * height;
		return `bottom: ${Math.min(px + (compact ? 10 : 14), height - 34)}px`;
	}
</script>	<div
		role="presentation"
		class="relative w-full select-none"
		onpointerdown={(e) => {
			if ((e.target as HTMLElement).closest('button')) return;
			selected = null;
		}}
	>
	{#if goal !== null}
		<!-- Ligne d'objectif : discrète, jamais au-dessus des barres. -->
		<div
			class="pointer-events-none absolute inset-x-0 z-[1]"
			style="bottom: {barPct(goal)}%; margin-bottom: {compact ? 14 : 18}px"
		>
			<div class="flex items-center gap-1.5">
				<div class="h-0 flex-1 border-t-2 border-dashed border-brand/50"></div>
				<span class="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-dark">{goal.toLocaleString('fr-FR')}</span>
			</div>
		</div>
	{/if}

	<div class="flex items-end gap-1" style="height: {height}px">
		{#each windowDays as day, i (day.date)}
			<div class="relative flex h-full flex-1 flex-col justify-end">
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
					{#if day.count !== null}
						{@const px = (barPct(day.count) / 100) * height}
						{@const sel = selected === i}
						<div
							class="w-full max-w-[22px] rounded-full transition-all duration-200 {sel
								? 'bg-brand shadow-[0_0_0_3px_rgba(29,185,84,0.15)]'
								: 'bg-ink group-hover:bg-brand/70'}"
							style="height: {Math.max(px, compact ? 5 : 7)}px"
						></div>
					{:else}
						<div class="mb-0.5 w-full max-w-[22px] rounded-full border-2 border-dashed border-mist/40" style="height: {compact ? 4 : 6}px"></div>
					{/if}
					<span class="text-center text-[10px] font-bold uppercase tracking-wide {day.count !== null ? 'text-ink' : 'text-mist/60'}">{dayLetter(day.date)}</span>
				</button>

				{#if shown === i && day.count !== null}
					<div
						class="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-center shadow-lg {tipClass(i)}"
						style={tipStyle(i)}
					>
						<span class="block text-[11px] font-bold text-white">{day.count.toLocaleString('fr-FR')} pas</span>
						<span class="block text-[10px] font-normal text-white/70">{tooltipTitle(day.date)}</span>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>