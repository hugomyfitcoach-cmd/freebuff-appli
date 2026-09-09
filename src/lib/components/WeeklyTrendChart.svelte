<script lang="ts">
	/**
	 * Graphique « tendance des 7 derniers jours » partagé (CRM Vision 360).
	 *
	 * Règles communes Calories & Pas :
	 * - échelle verticale dynamique : max(valeurs, objectif, moyenne) + 12 %
	 *   de headroom — aucune barre coupée, aucun plafond collé ;
	 * - absence de donnée ≠ 0 : un jour sans saisie n'affiche aucune barre
	 *   (simple tiret discret à la ligne de base), jamais un zéro inventé ;
	 * - lignes objectif / moyenne discrètes (pointillés fins + petits labels) ;
	 * - barres fines, coins arrondis, labels de valeur compacts.
	 */
	type Bar = {
		date: string;
		/** null = journée non renseignée (≠ 0). */
		value: number | null;
		count?: number;
		isToday?: boolean;
	};

	let { bars = [], goal = null, avg = null, ariaLabel = 'Tendance hebdomadaire', fmt = (n: number) => String(n), unit = '' }: {
		bars?: Bar[];
		goal?: number | null;
		avg?: number | null;
		ariaLabel?: string;
		fmt?: (n: number) => string;
		unit?: string;
	} = $props();

	const W = 700;
	const H = 172;
	const TOP = 18;
	const BOTTOM = 26;
	const innerH = H - TOP - BOTTOM;
	const BASELINE = H - BOTTOM;

	function dayLabel(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short' });
	}
	function fullLabel(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
	}

	/** Valeur max réelle (valeurs + objectif + moyenne), puis +12 % de headroom. */
	const maxVal = $derived.by(() => {
		const vals = bars.map((b) => b.value).filter((v): v is number => v != null && v > 0);
		const base = Math.max(100, ...vals, goal ?? 0, avg ?? 0);
		return base * 1.12;
	});
	const barH = $derived((v: number) => Math.max(3, (v / maxVal) * innerH));
	const yOf = $derived((v: number) => BASELINE - barH(v));
	const goalY = $derived(goal != null && goal > 0 ? yOf(goal) : null);
	const avgY = $derived(avg != null && avg > 0 ? yOf(avg) : null);
	const tracked = $derived(bars.filter((b) => b.value != null).length);
</script>

<svelte:head></svelte:head>

<div class="overflow-x-auto">
	<svg viewBox="0 0 {W} {H}" class="h-auto w-full min-w-[560px]" role="img" aria-label={ariaLabel}>
		<!-- Barres + labels jour -->
		{#each bars as bar, i}
			{@const cx = i * 100 + 50}
			{#if bar.value != null && bar.value > 0}
				<rect
					x={cx - 12}
					y={yOf(bar.value)}
					width="24"
					height={barH(bar.value)}
					rx="4"
					fill={bar.isToday ? '#1db954' : '#7ce0a5'}
					class="wtc-bar"
					style={`animation-delay: ${i * 70}ms`}
				>
					<title>{fullLabel(bar.date)} : {fmt(bar.value)}{unit}{bar.count ? ` (${bar.count} entrée${bar.count > 1 ? 's' : ''})` : ''}</title>
				</rect>
				<text x={cx} y={yOf(bar.value) - 6} text-anchor="middle" font-size="11" font-weight="600" fill="#111110" class="wtc-value">
					{fmt(bar.value)}
				</text>
			{:else}
				<!-- Jour non renseigné : tiret discret, jamais une barre à zéro. -->
				<line x1={cx - 6} y1={BASELINE - 2} x2={cx + 6} y2={BASELINE - 2} stroke="#D5D5D2" stroke-width="2" stroke-linecap="round">
					<title>{fullLabel(bar.date)} : aucune donnée</title>
				</line>
			{/if}
			<text x={cx} y={H - 8} text-anchor="middle" font-size="10.5" fill="#999990" font-weight="600">{dayLabel(bar.date)}</text>
		{/each}

		<!-- Ligne objectif (pointillée, discrète) -->
		{#if goalY != null}
			<line x1="0" y1={goalY} x2={W - 46} y2={goalY} stroke="#111110" stroke-width="1.2" stroke-dasharray="5 4" opacity="0.55" />
			<text x={W - 42} y={goalY - 3} font-size="10.5" fill="#999990" font-weight="600">obj {fmt(goal!)}</text>
		{/if}

		<!-- Ligne moyenne (verte, légère) -->
		{#if avgY != null}
			<line x1="0" y1={avgY} x2={W - 46} y2={avgY} stroke="#1db954" stroke-width="1.4" stroke-dasharray="4 5" opacity="0.8" />
			<text x={W - 42} y={avgY - 3} font-size="10.5" fill="#1db954" font-weight="700">moy {fmt(avg!)}</text>
		{/if}

		<!-- Ligne de base -->
		<line x1="0" y1={BASELINE} x2={W} y2={BASELINE} stroke="#E4E4E0" stroke-width="1" />
	</svg>
</div>

<style>
	.wtc-bar {
		transform-origin: bottom;
		animation: wtcGrow 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
	.wtc-value {
		opacity: 0;
		animation: wtcFade 0.3s ease forwards;
	}
	@keyframes wtcGrow {
		from {
			transform: scaleY(0);
			opacity: 0;
		}
		to {
			transform: scaleY(1);
			opacity: 1;
		}
	}
	@keyframes wtcFade {
		to {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.wtc-bar,
		.wtc-value {
			animation: none;
		}
	}
</style>