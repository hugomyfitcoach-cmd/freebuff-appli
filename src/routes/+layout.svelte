<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { BUILD_VERSION } from '$lib/buildVersion';
	import { clearAppCaches } from '$lib/appCaches';

	let { children } = $props();

	/* Hook central connexion / déconnexion : AVANT la soumission du formulaire
	   (donc avant la redirection), les caches du service worker (shell HTML +
	   vignettes) sont vidés. Couvre la déconnexion ET une session expirée
	   suivie d'une autre utilisatrice : jamais de page ni de photo d'une
	   session précédente laissée dans le cache. Les formulaires visés sont les
	   actions SvelteKit `?/login` / `?/logout` (toutes les pages, y compris le
	   menu profil et la facturation) ; la soumission native reprend ensuite. */
	onMount(() => {
		function onSubmit(e: Event) {
			const form = e.target;
			if (!(form instanceof HTMLFormElement)) return;
			const action = form.getAttribute('action') ?? '';
			if (!/\?\/(login|logout)/.test(action)) return;
			if (form.dataset.cacheClearing === '1') return; // anti-doublon
			e.preventDefault();
			form.dataset.cacheClearing = '1';
			void clearAppCaches().finally(() => {
				delete form.dataset.cacheClearing;
				form.submit();
			});
		}
		document.addEventListener('submit', onSubmit, true);
		return () => document.removeEventListener('submit', onSubmit, true);
	});
</script>

<svelte:head>
	<link rel="icon" href="/icons/icon-192.png" type="image/png" />
	<!-- Empreinte du build exécuté : le service worker ne sert son HTML de
	     repli hors-ligne que si cette valeur correspond à la sienne (jamais
	     un shell périmé) — voir htmlMatchesBuild dans service-worker.ts. -->
	<meta name="app-build" content={BUILD_VERSION} />
</svelte:head>
{@render children()}
