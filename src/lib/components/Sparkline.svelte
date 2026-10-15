<script lang="ts">
	/**
	 * Sparkline — mini courbe de tendance (SVG).
	 *
	 * Rendu SSR + hydratation : aucun recalcul côté client, les points
	 * ($derived) tracent directement le path. Le tracé est un SVG statique :
	 * aucune animation permanente, aucune boucle JS.
	 */

	type Point = { date: string; value: number };

	type Props = {
		points: Point[];
		color?: string;
		width?: number;
		height?: number;
		/** Valeur de référence (ex. objectif quotidien) affichée en pointillés. */
		goal?: number | null;
		/** Couleur de la ligne de référence. */
		goalColor?: string;
		/** Apparition douce (opacity + tracé qui « se dessine », 500 ms) — une
		 *  seule fois au montage, uniquement transform/opacity/clip.
		 *  Neutralisée sous prefers-reduced-motion (layout.css). */
		drawIn?: boolean;
	};

	let { points, color = '#1db954', width = 100, height = 34, goal = null, goalColor = '#9aa3ad', drawIn = false }: Props = $props();

	let seq = 0; // compteur module : id unique par instance
	let id = $state(String(++seq));

	const pts = $derived(points);
	const hasTrend = $derived(pts.length >= 2);

	const tMin = $derived(pts.length ? Date.parse(pts[0].date + 'T12:00:00') : 0);
	const tMax = $derived(pts.length ? Date.parse(pts[pts.length - 1].date + 'T12:00:00') : 1);
	const tSpan = $derived(Math.max(tMax - tMin, 1));
	// L'objectif participe à la mise à l'échelle verticale pour que sa ligne de
	// référence reste toujours visible (même si toutes les valeurs sont < ou >).
	const vMin = $derived(
		pts.length ? Math.min(...pts.map((p) => p.value), goal != null ? goal : Infinity) : goal != null ? goal : 0
	);
	const vMax = $derived(
		pts.length ? Math.max(...pts.map((p) => p.value), goal != null ? goal : -Infinity) : goal != null ? goal : 1
	);
	const vSpan = $derived(Math.max(vMax - vMin, 1e-6));

	const PAD_X = 3;
	const PAD_Y = 4;
	const xAt = $derived((t: number) => PAD_X + ((t - tMin) / tSpan) * (width - PAD_X * 2));
	const yAt = $derived((v: number) => height - PAD_Y - ((v - vMin) / vSpan) * (height - PAD_Y * 2));

	const coords = $derived.by(() =>
		pts.map((p) => ({
			x: xAt(Date.parse(p.date + 'T12:00:00')),
			y: yAt(p.value),
		}))
	);

	function monotoneSpline(c: { x: number; y: number }[]): string {
		if (!c.length) return '';
		if (c.length === 1) return `M ${c[0].x.toFixed(1)} ${c[0].y.toFixed(1)}`;
		if (c.length === 2) return `M ${c[0].x.toFixed(1)} ${c[0].y.toFixed(1)} L ${c[1].x.toFixed(1)} ${c[1].y.toFixed(1)}`;
		const n = c.length;
		const dx: number[] = [];
		const dy: number[] = [];
		const m: number[] = [];
		for (let i = 0; i < n - 1; i++) {
			dx.push(Math.max(c[i + 1].x - c[i].x, 1e-6));
			dy.push(c[i + 1].y - c[i].y);
			m.push(dy[i] / dx[i]);
		}
		const t: number[] = [m[0]];
		for (let i = 1; i < n - 1; i++) {
			if (m[i - 1] * m[i] <= 0) t.push(0);
			else t.push((m[i - 1] + m[i]) / 2);
		}
		t.push(m[n - 2]);
		for (let i = 0; i < n - 1; i++) {
			if (Math.abs(m[i]) < 1e-6) {
				t[i] = 0;
				t[i + 1] = 0;
			} else {
				const a = t[i] / m[i];
				const b = t[i + 1] / m[i];
				const s = a * a + b * b;
				if (s > 9) {
					const tau = 3 / Math.sqrt(s);
					t[i] = tau * a * m[i];
					t[i + 1] = tau * b * m[i];
				}
			}
		}
		let d = `M ${c[0].x.toFixed(1)} ${c[0].y.toFixed(1)}`;
		for (let i = 0; i < n - 1; i++) {
			const h = dx[i] / 3;
			const cp1x = c[i].x + h;
			const cp1y = c[i].y + t[i] * h;
			const cp2x = c[i + 1].x - h;
			const cp2y = c[i + 1].y - t[i + 1] * h;
			d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${c[i + 1].x.toFixed(1)} ${c[i + 1].y.toFixed(1)}`;
		}
		return d;
	}

	const line = $derived.by(() => monotoneSpline(coords));
	const area = $derived.by(() => {
		if (!pts.length) return '';
		const baseY = height - PAD_Y;
		return `${line} L ${xAt(tMax).toFixed(1)} ${baseY} L ${xAt(tMin).toFixed(1)} ${baseY} Z`;
	});
	const last = $derived(pts.length ? pts[pts.length - 1] : null);

	/* Apparition douce optionnelle : opacity + masque de gauche à droite (le
	   tracé « se dessine »). Uniquement opacity + clip-path — GPU-friendly.
	   Armé à l'hydratation (une seule fois, jamais rejoué ensuite).
	   Keyframes « from » seul : sans hydratation le graphe reste lisible. */
	let mounted = $state(false);
	$effect(() => {
		mounted = true;
	});
	const drawClass = $derived(drawIn && mounted && pts.length >= 2 ? 'spark-draw' : '');
</script>

{#if pts.length >= 1}
	<svg
		width={width}
		height={height}
		viewBox={`0 0 ${width} ${height}`}
		class="shrink-0 {drawClass}"
		role="img"
		aria-label="Tendance de la métrique dans le temps"
	>
		<defs>
			<linearGradient id={`spark-grad-${id}`} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.18" />
				<stop offset="100%" stop-color={color} stop-opacity="0" />
			</linearGradient>
		</defs>
		{#if goal != null}
			<line
				x1={PAD_X}
				y1={yAt(goal)}
				x2={width - PAD_X}
				y2={yAt(goal)}
				stroke={goalColor}
				stroke-width="1"
				stroke-dasharray="4 3"
				stroke-linecap="round"
			/>
		{/if}
		{#if hasTrend && area}
			<path d={area} fill={`url(#spark-grad-${id})`} />
		{/if}
		{#if hasTrend && line}
			<path d={line} fill="none" stroke={color} stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
		{/if}
		{#if last}
			<circle
				cx={xAt(Date.parse(last.date + 'T12:00:00'))}
				cy={yAt(last.value)}
				r="4"
				fill={color}
				stroke="#ffffff"
				stroke-width="2"
			/>
		{/if}
	</svg>
{/if}
