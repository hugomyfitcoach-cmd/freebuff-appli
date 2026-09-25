<script lang="ts">
	/**
	 * MacroLine — aperçu compact des 3 macros dans la carte Calories de l'Accueil.
	 *
	 * Même lecture visuelle que le Journal : ordre Glucides | Protéines | Lipides,
	 * mêmes couleurs (#ec4899 / #3b82f6 / #f97316), même logique CONSOMMÉ/OBJECTIF,
	 * libellés TOUJOURS entiers (jamais tronqués). Blocs centrés type Journal :
	 * label coloré, mini-ring avec % au centre, « 52 g / 180 g » dessous.
	 *
	 * Apparition premium : au chargement, l'arc progresse fluide de 0 vers la
	 * valeur (une seule fois, keyframe « from » seul → sans hydratation l'état
	 * final reste visible, jamais de contenu masqué). Neutralisé sous
	 * prefers-reduced-motion. Uniquement stroke-dashoffset (aucun layout).
	 *
	 * Aucune donnée calculée ici : `state` (src/lib/macros.ts) est construit par
	 * la page à partir de la semaine du Journal déjà chargée (fetch existant
	 * /api/journal/week). Dépassement d'objectif : l'arc est borné à 100 %,
	 * la valeur réelle reste affichée (jamais de cassure graphique).
	 */
	import { MACRO_RING_CIRCUMFERENCE, macroRingDashOffset, type MacroLineState } from '$lib/macros';

	/** NB : le prop ne peut PAS s'appeler `state` (collision avec le rune $state). */
	let { data, animate = true }: { data: MacroLineState; animate?: boolean } = $props();

	/* Armé à l'hydratation (une seule fois, jamais rejoué ensuite) — même
	   pattern que Sparkline (.spark-draw). La classe ajoute une animation
	   « from 0 % » : l'arc part du cercle vide et progresse vers sa valeur. */
	let mounted = $state(false);
	$effect(() => {
		if (animate) mounted = true;
	});
</script>

{#if data.kind === 'loading'}
	<!-- Squelette discret : même structure que la ligne finale (label, ring, valeurs), aucun saut de layout. -->
	<div class="mt-3 border-t border-line pt-2.5" aria-hidden="true">
		<div class="grid grid-cols-3 gap-1.5 sm:gap-2">
			{#each Array(3) as _, i (i)}
				<div class="flex min-w-0 flex-col items-center">
					<div class="h-2.5 w-12 animate-pulse rounded bg-line/60"></div>
					<div class="mt-1.5 h-[34px] w-[34px] animate-pulse rounded-full bg-line/80"></div>
					<div class="mt-1.5 h-2.5 w-16 animate-pulse rounded bg-line/40"></div>
				</div>
			{/each}
		</div>
	</div>
{:else if data.kind === 'ready'}
	<div class="mt-3 border-t border-line pt-2.5">
		<div class="grid grid-cols-3 gap-1.5 sm:gap-2">
			{#each data.rings as ring (ring.key)}
				{@const over = ring.goal !== null && ring.eaten > ring.goal}
				<div
					class="flex min-w-0 flex-col items-center text-center"
					aria-label="{ring.label} : {ring.eaten} grammes consommés{ring.goal !== null ? ` sur ${ring.goal} grammes` : ''}"
				>
					<!-- Libellé EN ENTIER (whitespace-nowrap : jamais de GL… / PR… / LI…). -->
					<p class="whitespace-nowrap text-[10px] font-bold leading-none" style:color={ring.color}>
						{ring.label}{#if over}<span aria-hidden="true"> ↑</span>{/if}
					</p>
					<!-- Mini-ring (rayon 10, viewBox 24) : arc borné à 100 %, % au centre. -->
					<div class="relative mt-1.5 h-[34px] w-[34px] shrink-0">
						<svg viewBox="0 0 24 24" class="h-[34px] w-[34px] -rotate-90">
							<circle cx="12" cy="12" r="10" fill="none" stroke="#eef0ec" stroke-width="2.5" />
							{#if ring.percent > 0}
								<circle
									cx="12"
									cy="12"
									r="10"
									fill="none"
									stroke={ring.color}
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-dasharray={MACRO_RING_CIRCUMFERENCE}
									stroke-dashoffset={macroRingDashOffset(ring.percent)}
									class="macro-ring-arc {mounted ? 'macro-ring-in' : ''}"
								/>
							{/if}
						</svg>
						<span class="absolute inset-0 grid place-items-center text-[9px] font-bold leading-none tabular-nums" style:color={ring.color}>
							{Math.round(ring.percent)}%
						</span>
					</div>
					<!-- Valeurs : consommé en gras + objectif — complètes, jamais tronquées. -->
					<p class="mt-1.5 whitespace-nowrap text-[10px] leading-none text-ink">
						<strong class="font-bold tabular-nums">{ring.eaten} g</strong>
						{#if ring.goal !== null}
							<span class="text-mist"> / {ring.goal} g</span>
						{/if}
					</p>
				</div>
			{/each}
		</div>
	</div>
{/if}
<!-- État « unavailable » : rien n'est rendu — la carte reste exactement celle d'avant. -->

<style>
	/* Progression fluide de l'arc vers la valeur (700 ms, courbe premium du
	   thème). Keyframe « from » seul : sans hydratation, l'état statique EST
	   l'état final — jamais de contenu masqué (philosophie layout.css). */
	.macro-ring-in {
		animation: macro-ring-in 700ms var(--ease-premium, cubic-bezier(0.22, 1, 0.36, 1)) backwards;
	}
	@keyframes macro-ring-in {
		from {
			stroke-dashoffset: 62.832px; /* cercle vide = MACRO_RING_CIRCUMFERENCE */
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.macro-ring-in {
			animation: none;
		}
	}
</style>
