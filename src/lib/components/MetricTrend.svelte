<script lang="ts">
	/**
	 * MetricTrend — mini-courbe interactive d'une métrique (poids, tour de
	 * taille, fessiers, cou, masse grasse…). Chaque VRAIE mesure enregistrée
	 * est un point interactif : survol (desktop) ou clic/tap (mobile) affiche
	 * la date et la valeur. Aucun point intermédiaire n'est inventé.
	 *
	 * Mobile : un tap sélectionne le point et laisse le tooltip affiché
	 * (nouveau tap sur un autre point, ou clic en dehors du composant via
	 * onpointerleave, referme). Desktop : hover = tooltip.
	 *
	 * Le clic sur un point ne remonte JAMAIS au parent (stopPropagation) —
	 * utile quand la courbe est posée sur une carte cliquable.
	 */
	type Point = { date: string; value: number };

	let {
		points,
		color = '#1db954',
		unit = '',
		height = 64,
		width = 240,
		interactive = true,
	}: {
		points: Point[];
		color?: string;
		unit?: string;
		/** Hauteur du rendu (largeur = 100% du conteneur, ratio width:height). */
		height?: number;
		/** Largeur nominale du viewBox — l'échelle SVG adapte au conteneur. */
		width?: number;
		interactive?: boolean;
	} = $props();

	let hoverIdx = $state<number | null>(null);
	/** Sélection épinglée par tap/clic (mobile) : survit au pointerleave. */
	let selectedIdx = $state<number | null>(null);

	const pts = $derived(points);
	const hasTrend = $derived(pts.length >= 2);

	const tMin = $derived(pts.length ? Date.parse(pts[0].date + 'T12:00:00') : 0);
	const tMax = $derived(pts.length ? Date.parse(pts[pts.length - 1].date + 'T12:00:00') : 1);
	const tSpan = $derived(Math.max(tMax - tMin, 1));
	const vMin = $derived(pts.length ? Math.min(...pts.map((p) => p.value)) : 0);
	const vMax = $derived(pts.length ? Math.max(...pts.map((p) => p.value)) : 1);
	// Légère marge verticale pour que le point max/min ne touche pas les bords.
	const vSpan = $derived(Math.max(vMax - vMin, 1e-6));
	const pad = $derived(vSpan * 0.15);

	const PAD_X = 8;
	const PAD_Y = 10;
	const xAt = $derived((t: number) => PAD_X + ((t - tMin) / tSpan) * (width - PAD_X * 2));
	const yAt = $derived((v: number) => height - PAD_Y - ((v - (vMin - pad)) / (vSpan + pad * 2)) * (height - PAD_Y * 2));

	const line = $derived.by(() =>
		pts
			.map((p, i) => {
				const x = xAt(Date.parse(p.date + 'T12:00:00'));
				const y = yAt(p.value);
				return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join(' ')
	);
	const area = $derived.by(() => {
		if (!pts.length) return '';
		const baseY = height - PAD_Y;
		return `${line} L ${xAt(tMax).toFixed(1)} ${baseY} L ${xAt(tMin).toFixed(1)} ${baseY} Z`;
	});

	function fmtDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
	}
	/**
	 * Position de la bulle en % du conteneur :
	 *  - axe X clampé (14–86 %) pour ne jamais déborder à gauche/droite ;
	 *  - si le point est dans le tiers haut du graphique, la bulle s'affiche
	 *    SOUS le point (sinon elle sortirait par le haut du viewport/carte).
	 */
	const shownIdx = $derived(selectedIdx ?? hoverIdx);
	const tip = $derived.by(() => {
		if (shownIdx === null || !pts[shownIdx]) return null;
		const p = pts[shownIdx];
		const xPct = (xAt(Date.parse(p.date + 'T12:00:00')) / width) * 100;
		const yPct = (yAt(p.value) / height) * 100;
		return { left: Math.min(Math.max(xPct, 14), 86), top: Math.max(yPct, 6), below: yPct < 30, p };
	});
	const hovered = $derived(shownIdx !== null ? pts[shownIdx] : null);

	function pick(i: number) {
		if (!interactive) return;
		selectedIdx = selectedIdx === i ? null : i;
	}
	function enter(i: number) {
		if (interactive) hoverIdx = i;
	}
</script>

<div class="relative w-full">
	{#if pts.length >= 1}			<svg
			viewBox={`0 0 ${width} ${height}`}
			class="w-full shrink-0"
			role="img"
			aria-label="Tendance de la métrique dans le temps"
			onpointerleave={() => (hoverIdx = null)}
		>
			{#if hasTrend && area}
				<path d={area} fill={color} opacity="0.12" />
			{/if}
			{#if hasTrend && line}
				<path d={line} fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
			{/if}
			{#each pts as p, i (p.date)}
				{@const x = xAt(Date.parse(p.date + 'T12:00:00'))}
				{@const y = yAt(p.value)}
				{#if interactive}
					<!-- Zone tactile élargie (invisible) : pas besoin d'un tap pixel-perfect -->
					<circle cx={x} cy={y} r={12} fill="transparent" class="cursor-pointer" role="button" tabindex="-1" aria-label={`Point ${fmtDate(p.date)} — ${String(p.value).replace('.', ',')} ${unit}`} onclick={(e) => { e.stopPropagation(); pick(i); }} onpointerenter={() => enter(i)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); } }} />
				{/if}
				<circle
					cx={x}
					cy={y}
					r={i === pts.length - 1 ? 4 : shownIdx === i ? 5 : 3}
					fill={color}
					stroke="#ffffff"
					stroke-width="1.5"
					class="pointer-events-none transition-all"
					{...shownIdx === i ? { 'data-selected': 'true' } : {}}
				/>
			{/each}
			{#if pts.length === 1}
				<text
					x={width / 2}
					y={height / 2 + 3}
					text-anchor="middle"
					font-size="9"
					fill={color}
					font-weight="600"
				>{String(pts[0].value).replace('.', ',')}{unit}</text>
			{/if}
		</svg>
	{/if}

	{#if interactive && tip && hovered}
		<div
			class="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-center text-[11px] font-semibold text-white shadow-lg"
			class:below={tip.below}
			class:above={!tip.below}
			style="left: {tip.left}%; top: {tip.top}%"
		>
			<span class="block">{String(hovered.value).replace('.', ',')} {unit}</span>
			<span class="block text-[10px] font-normal text-white/70">{fmtDate(hovered.date)}</span>
		</div>
	{/if}
</div>

<style>
	.below {
		transform: translateX(-50%) translateY(6px);
	}
	.above {
		transform: translateX(-50%) translateY(calc(-100% - 6px));
	}
</style>