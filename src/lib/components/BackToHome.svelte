<script lang="ts">
	/**
	 * Retour rapide vers l'ACCUEIL client G-FLUX depuis un écran secondaire.
	 * Sur mobile, AppShell affiche déjà la pilule « ‹ Accueil » dans la barre supérieure
	 * (fidèle aux maquettes Claude). Sur desktop (md+), cette pilule prend le relais.
	 */
	let { label = 'Accueil' }: { label?: string } = $props();
</script>

<a
	href="/espace"
	class="tap mb-3 hidden h-[44px] items-center gap-1 self-start rounded-[22px] border border-[#E9EDEA] bg-white pl-2.5 pr-4 text-[14px] font-bold text-[#0d7c36] shadow-[0_1px_2px_rgba(15,21,18,0.04),0_8px_20px_-8px_rgba(15,21,18,0.14)] md:inline-flex"
	aria-label="Retour à l’accueil G-FLUX — {label}"
>
	<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>
	<span>Accueil</span>
</a>
