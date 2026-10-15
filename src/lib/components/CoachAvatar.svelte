<script lang="ts">
	/**
	 * Avatar du coach : photo de profil du CRM si disponible, sinon initiale
	 * sur fond menthe G-FLUX (repli élégant, jamais une image cassée).
	 */
	let {
		url = null,
		name = 'Coach',
		size = 36,
	}: {
		url?: string | null;
		name?: string;
		size?: number;
	} = $props();

	const initial = $derived((name.trim().charAt(0) || 'C').toUpperCase());
	const style = $derived(`width:${size}px;height:${size}px;`);
	const initialStyle = $derived(`${style}font-size:${Math.round(size * 0.42)}px;`);
</script>

{#if url}
	<img
		src={url}
		alt={`Photo de ${name}`}
		loading="lazy"
		{style}
		class="shrink-0 rounded-full border-2 border-white object-cover shadow-[0_0_0_1px_rgba(29,185,84,0.3)]"
	/>
{:else}
	<span
		role="img"
		aria-label={`Avatar de ${name}`}
		style={initialStyle}
		class="grid shrink-0 place-items-center rounded-full border-2 border-white bg-gradient-to-br from-brand-light to-brand/25 font-display font-black text-brand-dark shadow-[0_0_0_1px_rgba(29,185,84,0.3)]"
	>
		{initial}
	</span>
{/if}
