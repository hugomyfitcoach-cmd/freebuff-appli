<script lang="ts">
	import { page } from '$app/state';

	/* État d'erreur clair et RÉCUPÉRABLE : quand une donnée indispensable n'a
	   pas pu être chargée (réseau coupé, Convex injoignable), la cliente peut
	   relancer le chargement sans fermer/réouvrir la PWA. */
	function retry() {
		location.reload();
	}

	/* JAMAIS de message technique (message d'exception, statut HTTP, stack…) :
	   un texte français adapté au cas, compréhensible par la cliente. */
	const MESSAGES = {
		offline: 'Pas de connexion internet. Vérifie ton réseau puis réessaie.',
		unavailable: 'Le service est momentanément indisponible. Réessaie dans quelques instants.',
		generic: 'Une erreur est survenue. Réessaie dans quelques instants.'
	} as const;

	/* navigator n'existe pas côté serveur : l'état « hors ligne » est évalué
	   au montage (et suit les bascules réseau en direct), sans casser
	   l'hydratation (même premier rendu serveur/client). */
	let offline = $state(false);
	$effect(() => {
		const sync = () => {
			offline = !navigator.onLine;
		};
		sync();
		window.addEventListener('online', sync);
		window.addEventListener('offline', sync);
		return () => {
			window.removeEventListener('online', sync);
			window.removeEventListener('offline', sync);
		};
	});

	/* Cas < hors ligne > < service indisponible (503) > < autre >. */
	const message = $derived(
		offline ? MESSAGES.offline : page.status === 503 ? MESSAGES.unavailable : MESSAGES.generic
	);
</script>

<svelte:head><title>Oups — G-Flux</title></svelte:head>

<div class="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
	<p class="text-[12px] font-bold uppercase tracking-[0.14em] text-mist">G-Flux</p>
	<h1 class="font-display text-[22px] font-black leading-tight tracking-tight text-ink">
		Impossible de charger cette page
	</h1>
	<p class="text-[14px] leading-relaxed text-mist">
		{message}
	</p>
	<button
		type="button"
		class="rounded-full bg-brand px-7 py-3 text-[15px] font-bold text-white transition hover:bg-brand-dark active:scale-95"
		onclick={retry}
	>
		Réessayer
	</button>
	<a href="/espace" class="text-[13px] font-semibold text-brand underline-offset-4 hover:underline">
		Retour à l'accueil
	</a>
</div>
