<script lang="ts">
	/**
	 * MetricTrend — courbe spline monotone interactive d'une métrique (poids,
	 * tour de taille, fessiers, cou, masse grasse…), fidèle aux maquettes
	 * Claude v2 (Progress.svelte & Poids.svelte).
	 *
	 * Chaque VRAIE mesure enregistrée est un point interactif : survol (desktop)
	 * ou clic/tap/glisser (mobile) affiche la date et la valeur. Aucun point
	 * intermédiaire n'est inventé.
	 */
	type Point = { date: string; value: number };

	let {
		points,
		color = '#1db954',
		unit = '',
		height = 132,
		width = 318,
		interactive = true,
		showGridLabels = false,
		showEndpoints = false,
		activeIdx = $bindable<number | null>(null),
	}: {
		points: Point[];
		color?: string;
		unit?: string;
		height?: number;
		width?: number;
		interactive?: boolean;
		showGridLabels?: boolean;
		showEndpoints?: boolean;
		activeIdx?: number | null;
	} = $props();

	let hoverIdx = $state<number | null>(null);
	let selectedIdx = $state<number | null>(null);

	const pts = $derived(points);
	const hasTrend = $derived(pts.length >= 2);

	const tMin = $derived(pts.length ? Date.parse(pts[0].date + 'T12:00:00') : 0);
	const tMax = $derived(pts.length ? Date.parse(pts[pts.length - 1].date + 'T12:00:00') : 1);
	const tSpan = $derived(Math.max(tMax - tMin, 1));
	const vMinRaw = $derived(pts.length ? Math.min(...pts.map((p) => p.value)) : 0);
	const vMaxRaw = $derived(pts.length ? Math.max(...pts.map((p) => p.value)) : 1);
	const vMin = $derived(vMaxRaw - vMinRaw < 1e-6 ? vMinRaw - 1 : vMinRaw);
	const vMax = $derived(vMaxRaw - vMinRaw < 1e-6 ? vMaxRaw + 1 : vMaxRaw);
	const vSpan = $derived(Math.max(vMax - vMin, 1e-6));

	const PAD_X = $derived(showGridLabels ? 12 : 8);
	const PAD_TOP = $derived(showGridLabels ? 30 : height <= 64 ? 8 : 20);
	const PAD_BOTTOM = $derived(showGridLabels ? 24 : height <= 64 ? 8 : 20);

	const xAt = $derived((t: number) => PAD_X + ((t - tMin) / tSpan) * (width - PAD_X * 2));
	const yAt = $derived(
		(v: number) => PAD_TOP + (1 - (v - vMin) / vSpan) * (height - PAD_TOP - PAD_BOTTOM)
	);

	const xyPts = $derived(
		pts.map((p) => ({
			x: xAt(Date.parse(p.date + 'T12:00:00')),
			y: yAt(p.value),
		}))
	);

	function monotone(coords: { x: number; y: number }[]): string {
		const n = coords.length;
		if (n === 0) return '';
		if (n === 1) return `M${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
		const dx: number[] = [];
		const m: number[] = [];
		const t: number[] = [];
		for (let i = 0; i < n - 1; i++) {
			const d = Math.max(coords[i + 1].x - coords[i].x, 0.001);
			dx[i] = d;
			m[i] = (coords[i + 1].y - coords[i].y) / d;
		}
		t[0] = m[0];
		t[n - 1] = m[n - 2];
		for (let i = 1; i < n - 1; i++) {
			if (m[i - 1] * m[i] <= 0) {
				t[i] = 0;
			} else {
				const a = dx[i - 1];
				const b = dx[i];
				t[i] = (3 * (a + b)) / ((2 * b + a) / m[i - 1] + (b + 2 * a) / m[i]);
			}
		}
		let d = `M${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
		for (let i = 0; i < n - 1; i++) {
			const x0 = coords[i].x;
			const y0 = coords[i].y;
			const x1 = coords[i + 1].x;
			const y1 = coords[i + 1].y;
			const h = dx[i] / 3;
			d += ` C${(x0 + h).toFixed(1)} ${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)} ${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
		}
		return d;
	}

	const line = $derived.by(() => monotone(xyPts));
	const area = $derived.by(() => {
		if (xyPts.length < 2) return '';
		const last = xyPts[xyPts.length - 1];
		const first = xyPts[0];
		const baseY = showGridLabels ? height - PAD_BOTTOM : height;
		return `${line} L${last.x.toFixed(1)} ${baseY} L${first.x.toFixed(1)} ${baseY} Z`;
	});
	const dotsPath = $derived.by(() => {
		if (xyPts.length < 2) return '';
		return xyPts
			.slice(0, xyPts.length - 1)
			.map((p) => `M${p.x.toFixed(1)} ${p.y.toFixed(1)} h0`)
			.join(' ');
	});

	function fmtDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		});
	}
	function fmtNum(v: number): string {
		const rounded = Math.round(v * 10) / 10;
		return String(rounded).replace('.', ',');
	}

	const shownIdx = $derived(activeIdx ?? selectedIdx ?? hoverIdx);
	const activeK = $derived(
		pts.length ? (shownIdx !== null && pts[shownIdx] ? shownIdx : pts.length - 1) : 0
	);
	const activeCoord = $derived(xyPts[activeK] ?? { x: width / 2, y: height / 2 });
	const activePoint = $derived(pts[activeK] ?? null);

	const y0 = $derived(PAD_TOP);
	const y2 = $derived(height - PAD_BOTTOM);
	const y1 = $derived((y0 + y2) / 2);

	const gradId = `mtGrad-${Math.random().toString(36).slice(2, 9)}`;

	const tip = $derived.by(() => {
		if (!pts.length || !activePoint) return null;
		if (height <= 64 && shownIdx === null) return null;
		const xPct = (activeCoord.x / width) * 100;
		const topPx = Math.max(activeCoord.y - (showGridLabels ? 16 : 14), showGridLabels ? 40 : 34);
		return {
			left: Math.min(Math.max(xPct, 17), 83).toFixed(1),
			top: topPx.toFixed(0),
			val: `${fmtNum(activePoint.value)} ${unit}`.trim(),
			date: fmtDate(activePoint.date),
		};
	});

	function pick(i: number) {
		if (!interactive) return;
		const next = selectedIdx === i ? null : i;
		selectedIdx = next;
		activeIdx = next;
	}
	function enter(i: number) {
		if (!interactive) return;
		hoverIdx = i;
		activeIdx = i;
	}
	function handleMove(e: MouseEvent | TouchEvent) {
		if (!interactive || xyPts.length < 2) return;
		const target = e.currentTarget as HTMLElement;
		const r = target.getBoundingClientRect();
		const clientX = 'touches' in e && e.touches.length ? e.touches[0].clientX : (e as MouseEvent).clientX;
		const x = ((clientX - r.left) / Math.max(r.width, 1)) * width;
		let best = 0;
		xyPts.forEach((p, idx) => {
			if (Math.abs(p.x - x) < Math.abs(xyPts[best].x - x)) best = idx;
		});
		hoverIdx = best;
		activeIdx = best;
	}
	function handleLeave() {
		hoverIdx = null;
		if (selectedIdx === null) activeIdx = null;
	}
</script>

<div class="relative w-full" style="touch-action:pan-y" onmousemove={handleMove} ontouchmove={handleMove} ontouchstart={handleMove} onmouseleave={handleLeave} ontouchend={handleLeave}>
	{#if pts.length >= 1}
		<svg
			viewBox={`0 0 ${width} ${height}`}
			width="100%"
			height={height}
			style="display:block;overflow:visible"
			role="img"
			aria-label="Tendance de la métrique dans le temps"
		>
			<defs>
				<linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color={color} stop-opacity="0.25" />
					<stop offset="1" stop-color={color} stop-opacity="0" />
				</linearGradient>
			</defs>

			{#if height > 64}
				<line x1="0" y1={y0} x2={width} y2={y0} stroke="#EEF1EF" stroke-width="1" stroke-dasharray="3 5" />
				{#if showGridLabels}
					<text x={width - 2} y={y0} dy="-5" text-anchor="end" font-size="10.5" font-weight="700" fill="#9AA39E">{fmtNum(vMax)}</text>
				{/if}
				<line x1="0" y1={y1} x2={width} y2={y1} stroke="#EEF1EF" stroke-width="1" stroke-dasharray="3 5" />
				{#if showGridLabels}
					<text x={width - 2} y={y1} dy="-5" text-anchor="end" font-size="10.5" font-weight="700" fill="#9AA39E">{fmtNum((vMax + vMin) / 2)}</text>
				{/if}
				<line x1="0" y1={y2} x2={width} y2={y2} stroke="#EEF1EF" stroke-width="1" stroke-dasharray="3 5" />
				{#if showGridLabels}
					<text x={width - 2} y={y2} dy="-5" text-anchor="end" font-size="10.5" font-weight="700" fill="#9AA39E">{fmtNum(vMin)}</text>
				{/if}
			{/if}

			{#if hasTrend && area}
				<path class="area" d={area} fill="url(#{gradId})" />
			{/if}
			{#if hasTrend && line}
				<path class="draw" pathLength="1" d={line} fill="none" stroke={color} stroke-width={height <= 64 ? '2.6' : '3.2'} stroke-linecap="round" stroke-linejoin="round" />
			{/if}
			{#if hasTrend && dotsPath && height > 64}
				<path class="area" d={dotsPath} fill="none" stroke={color} stroke-width="9" stroke-linecap="round" />
				<path class="area" d={dotsPath} fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" />
			{/if}

			{#if hasTrend && height > 64}
				<line x1={activeCoord.x.toFixed(1)} y1={Math.max(y0 - 10, 12)} x2={activeCoord.x.toFixed(1)} y2={y2} stroke={color} stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="3 4" style="transition:x1 .15s ease,x2 .15s ease" />
				<circle cx={activeCoord.x.toFixed(1)} cy={activeCoord.y.toFixed(1)} r={showGridLabels ? 12 : 11} fill={color} fill-opacity="0.18" style="transition:cx .15s ease,cy .15s ease" />
				<circle cx={activeCoord.x.toFixed(1)} cy={activeCoord.y.toFixed(1)} r={showGridLabels ? 7 : 6.5} fill={color} stroke="#FFFFFF" stroke-width="2.5" style="transition:cx .15s ease,cy .15s ease" />
			{:else if hasTrend}
				<circle cx={activeCoord.x.toFixed(1)} cy={activeCoord.y.toFixed(1)} r="4.5" fill={color} stroke="#FFFFFF" stroke-width="2" />
			{/if}

			{#each pts as p, i (p.date)}
				{@const x = xyPts[i]?.x ?? 0}
				{@const y = xyPts[i]?.y ?? 0}
				{#if interactive}
					<circle
						cx={x}
						cy={y}
						r={14}
						fill="transparent"
						class="cursor-pointer"
						role="button"
						tabindex="-1"
						aria-label={`Point ${fmtDate(p.date)} — ${fmtNum(p.value)} ${unit}`}
						onclick={(e) => {
							e.stopPropagation();
							pick(i);
						}}
						onpointerenter={() => enter(i)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								pick(i);
							}
						}}
					/>
				{/if}
			{/each}

			{#if pts.length === 1}
				<text x={width / 2} y={height / 2 + 3} text-anchor="middle" font-size="11" fill={color} font-weight="700">
					{fmtNum(pts[0].value)} {unit}
				</text>
			{/if}
		</svg>
	{/if}

	{#if interactive && tip && hasTrend && height > 64}
		<div
			aria-live="polite"
			style="position:absolute;top:{tip.top}px;left:{tip.left}%;transform:translate(-50%,-100%);pointer-events:none;padding:7px 12px;border-radius:12px;background:#111A15;color:#FFFFFF;text-align:center;white-space:nowrap;box-shadow:0 12px 24px -10px rgba(15,21,18,.5);transition:left .15s ease,top .15s ease;z-index:10"
		>
			<div style="font-size:14px;font-weight:900;line-height:1.2">{tip.val}</div>
			<div style="font-size:11.5px;color:#C9D0CC;line-height:1.3">{tip.date}</div>
		</div>
	{/if}

	{#if showEndpoints && pts.length >= 2}
		<div style="display:flex;justify-content:space-between;padding:4px 2px 0;font-size:11.5px;color:#7B857F">
			<span>{fmtDate(pts[0].date)}</span>
			<span>{fmtDate(pts[pts.length - 1].date)}</span>
		</div>
	{/if}
</div>
