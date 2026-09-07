<script lang="ts">
	type Point = { date: string; value: number };

	type Props = {
		points: Point[];
		color?: string;
		width?: number;
		height?: number;
	};

	let { points, color = '#1db954', width = 100, height = 34 }: Props = $props();

	let seq = 0; // compteur module : id unique par instance
	let id = $state(String(++seq));

	const pts = $derived(points.length >= 2 ? points : []);

	const tMin = $derived(pts.length ? Date.parse(pts[0].date + 'T12:00:00') : 0);
	const tMax = $derived(pts.length ? Date.parse(pts[pts.length - 1].date + 'T12:00:00') : 1);
	const tSpan = $derived(Math.max(tMax - tMin, 1));
	const vMin = $derived(pts.length ? Math.min(...pts.map((p) => p.value)) : 0);
	const vMax = $derived(pts.length ? Math.max(...pts.map((p) => p.value)) : 0);
	const vSpan = $derived(Math.max(vMax - vMin, 1e-6));

	const PAD_X = 3;
	const PAD_Y = 4;
	const xAt = $derived((t: number) => PAD_X + ((t - tMin) / tSpan) * (width - PAD_X * 2));
	const yAt = $derived((v: number) => height - PAD_Y - ((v - vMin) / vSpan) * (height - PAD_Y * 2));

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
	const last = $derived(pts.length ? pts[pts.length - 1] : null);
</script>

{#if pts.length >= 2}
	<svg
		width={width}
		height={height}
		viewBox={`0 0 ${width} ${height}`}
		class="shrink-0"
		role="img"
		aria-label="Tendance de la métrique dans le temps"
	>
		<defs>
			<linearGradient id={`spark-grad-${id}`} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.18" />
				<stop offset="100%" stop-color={color} stop-opacity="0" />
			</linearGradient>
		</defs>
		{#if area}
			<path d={area} fill={`url(#spark-grad-${id})`} />
		{/if}
		{#if line}
			<path d={line} fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
		{/if}
		{#if last}
			<circle
				cx={xAt(Date.parse(last.date + 'T12:00:00'))}
				cy={yAt(last.value)}
				r="2.5"
				fill={color}
				stroke="#ffffff"
				stroke-width="1.2"
			/>
		{/if}
	</svg>
{/if}