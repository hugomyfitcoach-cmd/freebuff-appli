<script lang="ts">
	/**
	 * Graphique « tendance des 7 derniers jours » partagé (CRM Vision 360).
	 *
	 * Règles communes Calories & Pas :
	 * - échelle verticale dynamique : max(valeurs, objectif, moyenne) + 12 %
	 *   de headroom — aucune barre coupée, aucun plafond collé ;
	 * - absence de donnée ≠ 0 : un jour sans saisie n'affiche aucune barre
	 *   (simple tiret discret à la ligne de base), jamais un zéro inventé ;
	 * - tracé compact : les colonnes occupent toute la largeur utile, barres
	 *   resserrées au centre de chaque colonne (rendu dashboard) ;
	 * - labels « obj » / « moy » dans une gouttière dédiée à droite, jamais
	 *   coupés, avec placement anti-chevauchement quand les deux lignes
	 *   sont proches (l'un au-dessus, l'autre au-dessous).
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

	// Géométrie du tracé (unités du viewBox).
	const W = 760;
	const H = 176;
	const PAD_X = 8; // respiration latérale minimale
	const GUTTER = 86; // gouttière droite réservée aux labels obj / moy
	const TOP = 20; // espace au-dessus de la barre la plus haute (label de valeur)
	const BOTTOM = 26; // labels de jour
	const innerH = H - TOP - BOTTOM;
	const BASELINE = H - BOTTOM;
	const plotW = W - 2 * PAD_X - GUTTER;

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

	// Colonnes : chaque jour occupe exactement 1/n de la zone de tracé.
	const step = $derived(plotW / Math.max(1, bars.length));
	// Barre resserrée au centre : ~40 % de la colonne en largeur, écart régulier.
	const barW = $derived(Math.max(12, Math.min(30, Math.round(step * 0.3))));
	const barX = $derived((i: number) => {
		const cx = PAD_X + step * i + step / 2;
		return cx - barW / 2;
	});
	const DAY_CX = $derived((i: number) => PAD_X + step * i + step / 2);

	// Lignes de référence : labels dans la gouttière, placement anti-chevauchement.
	type RefLine = { key: 'goal' | 'avg'; label: string; y: number; base: number; color: string; dash: string; width: number; opacity: number };
	const refLines = $derived.by(() => {
		const lines: Omit<RefLine, 'base'>[] = [];
		if (goalY != null) lines.push({ key: 'goal', label: `obj ${fmt(goal!)}`, y: goalY, color: '#111110', dash: '5 4', width: 1.2, opacity: 0.5 });
		if (avgY != null) lines.push({ key: 'avg', label: `moy ${fmt(avg!)}`, y: avgY, color: '#1db954', dash: '4 5', width: 1.4, opacity: 0.85 });
		lines.sort((a, b) => a.y - b.y);
		const MIN_GAP = 12; // écart mini entre deux baselines de labels
		let prev: number | null = null;
		return lines.map((l): RefLine => {
			let base = l.y - 4; // par défaut : au-dessus de la ligne
			if (prev != null && base - prev < MIN_GAP) base = l.y + 12; // sinon : au-dessous
			if (prev != null && base - prev < MIN_GAP) base = prev + MIN_GAP; // dernier recours
			base = Math.max(10, Math.min(H - 34, base));
			prev = base;
			return { ...l, base };
		});
	});
</script>

<div class="w-full">
	<svg viewBox="0 0 {W} {H}" class="h-auto w-full" role="img" aria-label={ariaLabel}>
		<!-- Barres + labels de valeur + labels jour -->
		{#each bars as bar, i}
			{@const x = barX(i)}
			{#if bar.value != null && bar.value > 0}
				<rect
					x={x}
					y={yOf(bar.value)}
					width={barW}
					height={barH(bar.value)}
					rx={Math.min(5, barW / 2)}
					fill={bar.isToday ? '#1db954' : '#7ce0a5'}
					class="wtc-bar"
					style={`animation-delay: ${i * 70}ms`}
				>
					<title>{fullLabel(bar.date)} : {fmt(bar.value)}{unit}{bar.count ? ` (${bar.count} entrée${bar.count > 1 ? 's' : ''})` : ''}</title>
				</rect>
				<text x={x + barW / 2} y={yOf(bar.value) - 6} text-anchor="middle" font-size="11" font-weight="600" fill="#111110" class="wtc-value wtc-num">
					{fmt(bar.value)}
				</text>
			{:else}
				<!-- Jour non renseigné : tiret discret, jamais une barre à zéro. -->
				<line x1={DAY_CX(i) - 6} y1={BASELINE - 2} x2={DAY_CX(i) + 6} y2={BASELINE - 2} stroke="#D5D5D2" stroke-width="2" stroke-linecap="round">
					<title>{fullLabel(bar.date)} : aucune donnée</title>
				</line>
			{/if}
			<text x={DAY_CX(i)} y={H - 8} text-anchor="middle" font-size="10.5" fill="#999990" font-weight="600" class={bar.isToday ? 'wtc-today' : ''}>{dayLabel(bar.date)}</text>
		{/each}

		<!-- Lignes de référence + labels en gouttière (jamais coupés) -->
		{#each refLines as l}
			<line x1={PAD_X} y1={l.y} x2={W - GUTTER} y2={l.y} stroke={l.color} stroke-width={l.width} stroke-dasharray={l.dash} opacity={l.opacity} />
			<text x={W - 6} y={l.base} text-anchor="end" font-size="10" font-weight="600" fill={l.color} class="wtc-num wtc-ref {l.key === 'avg' ? 'wtc-ref-avg' : ''}">
				{l.label}
			</text>
		{/each}

		<!-- Ligne de base -->
		<line x1={PAD_X} y1={BASELINE} x2={W - PAD_X} y2={BASELINE} stroke="#E4E4E0" stroke-width="1" />
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
	/* Chiffres alignés (tabulaires) + halo blanc pour rester lisibles
	   si une ligne de référence ou une barre passe derrière. */
	.wtc-num {
		font-variant-numeric: tabular-nums;
		paint-order: stroke;
		stroke: #ffffff;
		stroke-width: 3px;
		stroke-linejoin: round;
	}
	.wtc-ref {
		letter-spacing: 0.01em;
	}
	.wtc-today {
		fill: #17a349;
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
