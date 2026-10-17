<script lang="ts">
	import { page } from '$app/state';

	/* État d'erreur clair et RÉCUPÉRABLE : quand une donnée indispensable n'a
	   pas pu être chargée (réseau coupé, Convex injoignable), la cliente peut
	   relancer le chargement sans fermer/réouvrir la PWA. */
	function retry() {
		location.reload();
	}
</script>

<svelte:head><title>Oups — G-Flux</title></svelte:head>

<div class="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
	<p class="text-[12px] font-bold uppercase tracking-[0.14em] text-mist">G-Flux</p>
	<h1 class="font-display text-[22px] font-black leading-tight tracking-tight text-ink">
		Impossible de charger cette page
	</h1>
	<p class="text-[14px] leading-relaxed text-mist">
		{page.error?.message ?? 'Une erreur est survenue. Vérifie ta connexion puis réessaie.'}
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
