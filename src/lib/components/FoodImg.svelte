<script lang="ts">
	/**
	 * FoodImg — vignette alimentaire performante (UNE logique pour Recherche,
	 * Journal, plans et CRM).
	 *
	 * Chaîne de sources :
	 *   1. `src` fourni = copie miroir G-FLUX (storage Convex) quand elle
	 *      existe (thumbUrl attaché côté backend) — quasi instantané via
	 *      cache navigateur + PWA ;
	 *   2. sinon échec de la miroir → miniature OFF 100 px dérivée
	 *      (offThumb100) puis URL OFF d'origine — premier cache miss
	 *      uniquement ;
	 *   3. échec/absent → placeholder neutre (jamais d'icône cassée, jamais
	 *      de blocage : nom/calories restent cliquables sans l'image).
	 *
	 * - `loading=lazy` + `decoding=async` par défaut ; `eager` +
	 *   `fetchpriority=high` UNIQUEMENT pour les premières lignes réellement
	 *   visibles (ne jamais tout mettre en eager) ;
	 * - dimensions imposées par la classe (h-… w-…) → aucun layout shift ;
	 * - un seul repli, jamais de boucle ni de requêtes agressives.
	 */
	import { offThumb100 } from '$lib/foodImage';

	let {
		src,
		fallbackSrc,
		alt = '',
		class: cls = '',
		eager = false,
	}: {
		/** Source prioritaire : URL miroir G-FLUX (thumbUrl) si dispo. */
		src?: string;
		/** Source de repli technique : URL OFF (dérivée auto en 100 px). */
		fallbackSrc?: string;
		alt?: string;
		class?: string;
		eager?: boolean;
	} = $props();

	let failed = $state(false);
	/** Tentative en cours sur la source secondaire (repli OFF dérivé). */
	let tryingFallback = $state(false);

	// La source miroir disparaît/réapparaît (attachement asynchrone côté
	// backend, propagation Convex) → on retente proprement, sans boucle.
	$effect(() => {
		failed = false;
		tryingFallback = false;
	});

	const fallbackResolved = $derived(offThumb100(fallbackSrc) ?? fallbackSrc);

	/** La source principale a échoué → repli miniature OFF 100 px dérivée. */
	function onPrimaryError() {
		if (!tryingFallback && fallbackResolved && fallbackResolved !== src) {
			tryingFallback = true;
			return;
		}
		failed = true;
	}

	/** La source de repli a échoué à son tour → placeholder. */
	function onFallbackError() {
		failed = true;
	}
</script>

<div class="relative shrink-0 overflow-hidden bg-line/50 {cls}" aria-hidden={alt ? undefined : true} role={alt ? 'img' : undefined}>
	{#if !failed && tryingFallback && fallbackResolved}
		<!-- Repli OFF 100 px (miroir absente ou échouée) -->
		<img
			src={fallbackResolved}
			{alt}
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			fetchpriority={eager ? 'high' : 'auto'}
			referrerpolicy="no-referrer"
			class="absolute inset-0 h-full w-full object-cover"
			onerror={onFallbackError}
		/>
	{:else if !failed && src}
		<!-- Priorité : copie miroir G-FLUX (thumbUrl) -->
		<img
			{src}
			{alt}
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			fetchpriority={eager ? 'high' : 'auto'}
			referrerpolicy="no-referrer"
			class="absolute inset-0 h-full w-full object-cover"
			onerror={onPrimaryError}
		/>
	{:else if !failed && fallbackResolved}
		<!-- Pas encore de miroir : miniature OFF 100 px dérivée directement -->
		<img
			src={fallbackResolved}
			{alt}
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			fetchpriority={eager ? 'high' : 'auto'}
			referrerpolicy="no-referrer"
			class="absolute inset-0 h-full w-full object-cover"
			onerror={onFallbackError}
		/>
	{/if}
</div>
