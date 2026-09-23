<script lang="ts">
	/**
	 * CountUp G-FLUX — count-up subtil des valeurs numériques de l'Accueil.
	 *
	 * Contrat :
	 *  - le count-up se joue UNE FOIS au montage (première valeur affichée) ;
	 *    les mises à jour ultérieures (revalidation, jour suivant) s'affichent
	 *    directement — jamais de re-comptage à chaque petit changement ;
	 *  - ne compte JAMAIS depuis 0 : départ ≈ 82 % de la valeur (et au plus
	 *    3 000 unités d'écart, borné par `distanceCap`) → gros chiffres
	 *    lisibles immédiatement, effet premium sans gimmick ;
	 *  - aucun décalage de layout : le composant ne rend qu'un <span>, la
	 *    valeur SSR = valeur finale (l'animation démarre à l'hydratation) ;
	 *  - prefers-reduced-motion : valeur finale immédiate, sans animation ;
	 *  - un seul requestAnimationFrame, annulé au démontage (pas d'intervalle
	 *    permanent, pas de travail après la fin de l'animation).
	 */
	import { prefersReducedMotion } from '$lib/motion';

	type Props = {
		/** Valeur cible (finale). */
		value: number;
		/** Mise en forme (défaut : entier, séparateur fr-FR). */
		format?: (n: number) => string;
		/** Durée totale (ms) — 300 à 700 ms recommandés. */
		duration?: number;
		/** Point de départ : `minFrom` × valeur cible (0.82 ≈ discret). */
		minFrom?: number;
		/** Écart maximal depuis la cible (ex. 4 pour un poids en kg). */
		distanceCap?: number;
	};

	let {
		value,
		format = (n: number) => Math.round(n).toLocaleString('fr-FR'),
		duration = 600,
		minFrom = 0.82,
		distanceCap = 3_000,
	}: Props = $props();

	/** Valeur affichée : null jusqu'au premier rendu client → fallback sur la
	 *  valeur finale (SSR = valeur finale, aucun contenu « faux » servi). */
	let display = $state<number | null>(null);
	const shown = $derived(display ?? value);
	let firstRun = true;
	let raf = 0;

	$effect(() => {
		const target = value;
		if (firstRun && !prefersReducedMotion() && Number.isFinite(target) && target !== 0) {
			firstRun = false;
			const from = Math.max(minFrom * target, target - distanceCap);
			if (from < target) {
				const t0 = performance.now();
				const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
				const step = (now: number) => {
					const p = Math.min(1, (now - t0) / duration);
					display = from + (target - from) * easeOut(p);
					if (p < 1) raf = requestAnimationFrame(step);
				};
				raf = requestAnimationFrame(step);
				return () => cancelAnimationFrame(raf);
			}
		}
		firstRun = false;
		display = target;
	});
</script>

<span class="tabular-nums">{format(shown)}</span>
