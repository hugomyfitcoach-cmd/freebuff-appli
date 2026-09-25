<script lang="ts">
	/**
	 * MacroLine — aperçu compact des 3 macros dans la carte Calories de l'Accueil.
	 *
	 * Même lecture visuelle que le Journal : ordre Glucides | Protéines | Lipides,
	 * mêmes couleurs (#ec4899 / #3b82f6 / #f97316), même logique CONSOMMÉ/OBJECTIF.
	 * Version miniaturisée : mini-ring + valeur consommée + objectif — compréhensible
	 * en un coup d'œil, sans surcharger la carte ni casser la grille 2 colonnes.
	 *
	 * Aucune donnée calculée ici : `state` (src/lib/macros.ts) est construit par
	 * la page à partir de la semaine du Journal déjà chargée (fetch existant
	 * /api/journal/week). Dépassement d'objectif : l'arc est borné à 100 %,
	 * la valeur réelle reste affichée (jamais de cassure graphique).
	 */
	import { MACRO_RING_CIRCUMFERENCE, macroRingDashOffset, type MacroLineState } from '$lib/macros';

	let { state }: { state: MacroLineState } = $props();
</script>

{#if state.kind === 'loading'}
	<!-- Squelette discret : même hauteur que la ligne finale, aucun saut de layout. -->
	<div class="mt-3 border-t border-line pt-2.5" aria-hidden="true">
		<div class="grid grid-cols-3 gap-2">
			{#each Array(3) as _, i (i)}
				<div class="flex items-center gap-2">
					<div class="h-7 w-7 shrink-0 animate-pulse rounded-full bg-line/80"></div>
					<div class="min-w-0 space-y-1">
						<div class="h-2 w-10 animate-pulse rounded bg-line/60"></div>
						<div class="h-2 w-8 animate-pulse rounded bg-line/40"></div>
					</div>
				</div>
			{/each}
		</div>
	</div>
{:else if state.kind === 'ready'}
	<div class="mt-3 border-t border-line pt-2.5">
		<div class="grid grid-cols-3 gap-1.5 sm:gap-2">
			{#each state.rings as ring (ring.key)}
				{@const over = ring.goal !== null && ring.eaten > ring.goal}
				<div class="flex min-w-0 items-center gap-1.5" aria-label="{ring.label} : {ring.eaten} grammes consommés{ring.goal !== null ? ` sur ${ring.goal} grammes` : ''}">
					<!-- Mini-ring (rayon 10, viewBox 24) : arc borné à 100 %, valeurs réelles affichées. -->
					<div class="relative h-7 w-7 shrink-0">
						<svg viewBox="0 0 24 24" class="h-7 w-7 -rotate-90">
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
									style="transition: stroke-dashoffset .5s"
								/>
							{/if}
						</svg>
					</div>
					<div class="min-w-0 leading-tight">
						<p class="truncate text-[10px] font-bold uppercase tracking-wide" style:color={ring.color}>
							{ring.label}{#if over}<span aria-hidden="true"> ↑</span>{/if}
						</p>
						<p class="truncate text-[11px] font-semibold tabular-nums text-ink">
							{ring.eaten} g
							{#if ring.goal !== null}
								<span class="font-normal text-mist">/ {ring.goal}</span>
							{/if}
						</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
<!-- État « unavailable » : rien n'est rendu — la carte reste exactement celle d'avant. -->
