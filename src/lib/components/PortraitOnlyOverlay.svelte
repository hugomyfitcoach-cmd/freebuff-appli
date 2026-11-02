<script lang="ts">
	/**
	 * COUCHE « TOURNE TON TÉLÉPHONE » (MISSION PORTRAIT).
	 *
	 * Couvre TOUTE l'app (montée dans le layout racine, donc aussi le CRM
	 * coach) uniquement sur téléphone tenu en paysage : apparition en fondu
	 * court, fond de l'app flouté + voile sombre, icône qui pivote de paysage
	 * vers portrait. Rien n'est cliquable dessous (couche plein écran,
	 * `touch-action: none`) et aucun état n'est démonté : journal, saisie en
	 * cours et feuille ouverte restent intacts.
	 */
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { portraitLock, startPortraitOnlyWatch } from '$lib/portraitOnly.svelte';

	onMount(() => startPortraitOnlyWatch());
</script>

{#if portraitLock.active}
	<div
		class="gflux-portrait-lock fixed inset-0 z-[9999] flex flex-col items-center justify-center px-8 text-center"
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="gflux-portrait-title"
		aria-describedby="gflux-portrait-desc"
		in:fade={{ duration: 150 }}
	>
		<div class="gflux-portrait-icon" aria-hidden="true">
			<svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
				<!-- Téléphone (portrait) : contour vert G-Flux, écran menthe. -->
				<rect x="30" y="16" width="36" height="64" rx="9" stroke="#1db954" stroke-width="3.5" fill="rgba(232,254,240,0.10)" />
				<rect x="35" y="24" width="26" height="44" rx="4" fill="#e8fef0" fill-opacity="0.22" />
				<path d="M43 73h10" stroke="#3ddc84" stroke-width="3" stroke-linecap="round" />
				<!-- Arc de rotation : lecture « bascule en portrait ». -->
				<path d="M20 34a30 30 0 0 1 10-12" stroke="#3ddc84" stroke-width="3" stroke-linecap="round" opacity="0.75" />
				<path d="M20 26v8h8" stroke="#3ddc84" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.75" />
			</svg>
		</div>
		<p id="gflux-portrait-title" class="gflux-portrait-title">Tourne ton téléphone</p>
		<p id="gflux-portrait-desc" class="gflux-portrait-desc">G-Flux s'utilise en mode portrait.</p>
	</div>
{/if}

<style>
	.gflux-portrait-lock {
		/* Fond de l'app flouté (préfixe -webkit- pour iOS) + voile sombre. */
		background: rgba(15, 21, 18, 0.58);
		-webkit-backdrop-filter: blur(16px) saturate(1.05);
		backdrop-filter: blur(16px) saturate(1.05);
		touch-action: none;
		overscroll-behavior: none;
		-webkit-user-select: none;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
	}
	.gflux-portrait-icon {
		transform-origin: 50% 50%;
		will-change: transform;
		animation: gflux-portrait-turn 3.4s cubic-bezier(0.35, 0.1, 0.25, 1) infinite;
	}
	.gflux-portrait-title {
		margin: 20px 0 0;
		color: #fff;
		font-size: 22px;
		font-weight: 900;
		letter-spacing: -0.02em;
		line-height: 1.15;
	}
	.gflux-portrait-desc {
		margin: 8px 0 0;
		max-width: 16rem;
		color: rgba(255, 255, 255, 0.78);
		font-size: 15px;
		font-weight: 600;
		line-height: 1.4;
	}

	/* Départ paysage (90°) → portrait (0°), puis pause avant le cycle suivant.
	   Retour rapide au paysage en fin de cycle : la boucle reste douce. */
	@keyframes gflux-portrait-turn {
		0%,
		8% {
			transform: rotate(90deg);
		}
		58%,
		90% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(90deg);
		}
	}

	/* Accessibilité : icône fixe (portrait), aucune animation. */
	@media (prefers-reduced-motion: reduce) {
		.gflux-portrait-icon {
			animation: none;
			transform: none;
		}
	}
</style>
