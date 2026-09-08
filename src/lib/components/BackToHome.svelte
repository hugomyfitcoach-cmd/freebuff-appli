<script lang="ts">
	import Icon from './Icon.svelte';

	/**
	 * Retour rapide vers l'ACCUEIL client G-FLUX depuis un écran secondaire.
	 * Ouvre toujours la route /espace (jamais history.back()) — comportement
	 * prévisible, identique sur desktop et mobile. Complémentaire de la bottom
	 * navigation mobile (qui reste la navigation principale).
	 *
	 * Usage : <BackToHome label="Photos de suivi" />
	 */
	let { label = 'Accueil' }: { label?: string } = $props();
</script>

<a
	href="/espace"
	class="group mb-4 inline-flex min-h-11 items-center gap-1.5 self-start rounded-xl pr-2 text-sm font-bold text-ink transition hover:text-brand-dark"
	aria-label="Retour à l’accueil G-FLUX"
>
	<span class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mist transition group-hover:bg-line/50 group-hover:text-ink">
		<Icon name="arrowLeft" size={19} />
	</span>
	<span>{label}</span>
</a>