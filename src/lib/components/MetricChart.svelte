<script lang="ts">
	import { onMount, tick } from 'svelte';

	let seq = 0; // compteur module : id unique par instance

	type Props = {
		values: number[];
		labels?: string[];
		color?: string;
		height?: number;
	};

	let { values, labels = [], color = '#1db954', height = 170 }: Props = $props();

	const W = 600;
	const PAD_X = 30;
	const PAD_Y = 12;

	const n = $derived(values.length);
	const vmin = $derived(values.length ? Math.min(...values) : 0);
	const vmax = $derived(values.length ? Math.max(...values) : 0);
	const span = $derived(Math.max(vmax - vmin, 1e-6));
	// marge verticale autour des données (pour que la courbe respire)
	const spanPad = $derived(span > 0 ? span * 0.18 : 1);
	const yMin = $derived(vmin - spanPad);
	const yMax = $derived(vmax + spanPad);

	const xAt = $derived((i: number) => (n <= 1 ? W / 2 : PAD_X + (i / (n - 1)) * (W - PAD_X * 2)));
	const yAt = $derived((v: number) => height - PAD_Y - ((v - yMin) / (yMax - yMin)) * (height - PAD_Y * 2));

	// Échelle Y : 3 repères "arrondis"
	const gridVals = $derived.by(() => {
		if (!values.length) return [0, 0, 0];
		const top = yMax;
		const bot = yMin;
		return [bot, (bot + top) / 2, top];
	});

	const linePath = $derived.by(() => {
		if (n === 0) return '';
		if (n === 1) return `M ${xAt(0).toFixed(1)} ${yAt(values[0]).toFixed(1)}`;
		return values
			.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
			.join(' ');
	});
	const areaPath = $derived.by(() => {
		if (n === 0) return '';
		const baseY = height - PAD_Y;
		const line = linePath;
		const lastX = xAt(n - 1).toFixed(1);
		const firstX = xAt(0).toFixed(1);
		return `${line} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
	});

	// Animation : on dessine la ligne progressivement au montage
	let pathLen = $state(0);
	let drawn = $state(false);
	onMount(async () => {
		await tick();
		const el = document.getElementById('metric-line-' + id) as SVGPathElement | null;
		if (el) pathLen = el.getTotalLength();
		await tick();
		drawn = true;
	});

	// id unique par instance (compteur au niveau du module)
	let id = $state(String(++seq));

	function fmtGrid(v: number) {
		return v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(1) : v.toFixed(1);
	}
</script>

{#if values.length === 0}
	<p class="py-8 text-center text-sm italic text-mist">Pas encore de données — enregistre ta première prise 📏</p>
{:else}
	<svg viewBox="0 0 {W} {height}" class="w-full" role="img" aria-label="Évolution de ta mesure dans le temps">
		<defs>
			<linearGradient id={'area-grad-' + id} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.22" />
				<stop offset="100%" stop-color={color} stop-opacity="0" />
			</linearGradient>
		</defs>

		{#each gridVals as gv}
			<line x1={PAD_X} x2={W - PAD_X} y1={yAt(gv)} y2={yAt(gv)} stroke="#e5e3dc" stroke-width="1" stroke-dasharray="3 4" />
			<text x={PAD_X - 8} y={yAt(gv) + 3.5} text-anchor="end" font-size="9.5" fill="#999990" font-family="Lato, sans-serif">{fmtGrid(gv)}</text>
		{/each}

		{#if areaPath}
			<path d={areaPath} fill={'url(#area-grad-' + id + ')'} />
		{/if}
		{#if linePath}
			<path
				id={'metric-line-' + id}
				d={linePath}
				fill="none"
				stroke={color}
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-dasharray={drawn ? 'none' : `${pathLen || 1} ${pathLen || 1}`}
				stroke-dashoffset={drawn ? 0 : pathLen || 1}
				style="transition: stroke-dashoffset 1s ease"
			/>
		{/if}

		<!-- dernier point : pop-in -->
		<circle
			cx={xAt(n - 1)}
			cy={yAt(values[n - 1])}
			r={drawn ? 4.5 : 0}
			fill={color}
			stroke="#ffffff"
			stroke-width="2.5"
			style="transition: r .3s ease {n === 1 ? '0s' : '.9s'}"
		/>
	</svg>
	{#if labels.length === 2}
		<div class="mt-1 flex justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-mist">
			<span>{labels[0]}</span>
			<span>{labels[1]}</span>
		</div>
	{/if}
{/if}