<script lang="ts">
	/**
	 * FoodImg — vignette alimentaire performante.
	 * - placeholder neutre (fond) tant que l'image n'est pas chargée → aucun flash blanc ;
	 * - `loading=lazy` + `decoding=async` par défaut ; `eager` pour les premières lignes visibles ;
	 * - dimensions imposées par la classe (h-… w-…) → aucun layout shift ;
	 * - échec de chargement → le placeholder reste (jamais d'icône cassée).
	 */
	let {
		src,
		alt = '',
		class: cls = '',
		eager = false,
	}: {
		src?: string;
		alt?: string;
		class?: string;
		eager?: boolean;
	} = $props();

	let failed = $state(false);
	$effect(() => {
		failed = false;
	});
</script>

<div class="relative shrink-0 overflow-hidden bg-line/50 {cls}" aria-hidden={alt ? undefined : true} role={alt ? 'img' : undefined}>
	{#if src && !failed}
		<img
			{src}
			{alt}
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			fetchpriority={eager ? 'high' : 'auto'}
			referrerpolicy="no-referrer"
			class="absolute inset-0 h-full w-full object-cover"
			onerror={() => (failed = true)}
		/>
	{/if}
</div>