<script lang="ts">
	/**
	 * Média d'un exercice G-FLUX avec FALLBACK PROPRE — jamais d'icône
	 * d'image cassée. Si l'URL principale échoue (404/403/réseau), on tente
	 * l'URL de secours (`fallbackUrl`, ex. sourceMediaUrl), puis un état
	 * « Média indisponible » (icône) est affiché.
	 *
	 * Réutilisé partout où un média d'exercice est affiché : grille de
	 * bibliothèque, picker, fiche détaillée, prescription.
	 */
	import Icon from '$lib/components/Icon.svelte';

	let {
		src,
		fallbackUrl,
		alt = '',
		loading = 'lazy',
		class: klass = ''
	}: {
		src?: string;
		/** URL de secours tentée si `src` échoue (ex. sourceMediaUrl). */
		fallbackUrl?: string;
		alt?: string;
		loading?: 'eager' | 'lazy';
		class?: string;
	} = $props();

	let current = $state<string | undefined>(src);
	let stage: 'media' | 'fallback' | 'unavailable' = $state(src ? 'media' : fallbackUrl ? 'fallback' : 'unavailable');

	// Réagit si la source change (ex. média fraîchement hébergé, rechargement).
	$effect(() => {
		current = src;
		stage = src ? 'media' : fallbackUrl ? 'fallback' : 'unavailable';
	});

	function onFail() {
		if (stage === 'media' && fallbackUrl && fallbackUrl !== src) {
			stage = 'fallback';
			current = fallbackUrl;
		} else {
			stage = 'unavailable';
			current = undefined;
		}
	}
</script>

{#if stage === 'unavailable'}
	<div class="flex h-full w-full flex-col items-center justify-center gap-1 bg-line/30 text-mist {klass}">
		<Icon name="dumbbell" size={22} class="opacity-60" />
		<span class="px-1 text-center text-[10px] leading-tight opacity-80">Média indisponible</span>
	</div>
{:else if current}
	<img src={current} {alt} {loading} class={klass} onerror={onFail} />
{/if}
