<script lang="ts">
	import { MOTIVATION_COLOR, type SeriePoint } from '../stats.js';
	import Icon from './Icon.svelte';

	type Point = { i: number; x: SeriePoint; v: number | null };
	type Props = { points: SeriePoint[]; height?: number };
	let { points, height = 160 }: Props = $props();

	const W = 600;
	const H = $derived(height);
	const PAD_X = 34;
	const PAD_Y = 14;

	const data: Point[] = $derived(points.map((p: SeriePoint, i: number) => ({ i, x: p, v: p.motivation })));
	const hasData = $derived(data.some((d: Point) => d.v !== null));
	const maxI = $derived(Math.max(data.length - 1, 0));

	const xAt = (i: number) => (maxI === 0 ? W / 2 : PAD_X + (i / maxI) * (W - PAD_X * 2));
	const yAt = (v: number) => H - PAD_Y - ((v - 1) / 4) * (H - PAD_Y * 2);

	const linePath = $derived.by(() => {
		if (!hasData) return '';
		const pts = data.filter((d: Point): d is Point & { v: number } => d.v !== null);
		if (pts.length === 0) return '';
		return pts
			.map((d: Point & { v: number }, k: number) => `${k === 0 ? 'M' : 'L'} ${xAt(d.i).toFixed(1)} ${yAt(d.v).toFixed(1)}`)
			.join(' ');
	});
</script>

{#if !hasData}
	<p class="flex items-center justify-center gap-1.5 py-6 text-center text-sm italic text-mist">Pas encore assez de données — complète ton premier bilan <Icon name="chartColumn" size={14} class="shrink-0" /></p>
{:else}
	<svg viewBox="0 0 {W} {H}" class="w-full" role="img" aria-label="Évolution de ta motivation semaine par semaine">
		<!-- lignes de repère 1..5 -->
		{#each [1, 2, 3, 4, 5] as level}
			<line x1={PAD_X - 4} x2={W - PAD_X} y1={yAt(level)} y2={yAt(level)} stroke="#e5e3dc" stroke-width="1" stroke-dasharray={level === 1 || level === 5 ? '0' : '3 4'} />
			<text x={PAD_X - 10} y={yAt(level) + 3.5} text-anchor="end" font-size="9" fill="#999990" font-family="Lato, sans-serif">{level}</text>
		{/each}

		{#if linePath}
			<path d={linePath} fill="none" stroke="#1db954" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
		{/if}

		{#each data.filter((d: Point) => d.v !== null) as d}
			<circle cx={xAt(d.i)} cy={yAt(d.v as number)} r="4.5" fill="#ffffff" stroke={MOTIVATION_COLOR(d.v as number)} stroke-width="2.5" />
		{/each}
	</svg>
	<div class="mt-1 flex justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-mist">
		<span>{data[0]?.x.label ?? ''}</span>
		<span>{data[data.length - 1]?.x.label ?? ''}</span>
	</div>
{/if}
