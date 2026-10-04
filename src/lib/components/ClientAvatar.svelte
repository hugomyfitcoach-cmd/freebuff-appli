<script lang="ts">
	/**
	 * Avatar cliente des vues coach — PHOTO DE PROFIL si la cliente en a une
	 * (système existant `users.profilePhotoStorageId`, résolu en lecture par
	 * `coach.listClients` / `coach.bilansBoard`), sinon l'initiale actuelle
	 * (première lettre du prénom). JAMAIS les photos de progression.
	 */
	let {
		name,
		url = null,
		class: klass = 'h-9 w-9 text-sm',
		fallbackClass = '',
		fallbackStyle = '',
	}: {
		name: string;
		url?: string | null;
		class?: string;
		/** Classes additionnelles du repli initiale (dégradé, couleurs…). */
		fallbackClass?: string;
		fallbackStyle?: string;
	} = $props();

	/** Même initiale qu'avant la refonte : première lettre du prénom. */
	const initial = $derived(name.trim().charAt(0).toUpperCase() || '?');
</script>

{#if url}
	<img
		src={url}
		alt="Photo de profil de {name}"
		class="{klass} shrink-0 rounded-full object-cover"
		loading="lazy"
	/>
{:else}
	<span class="avatar-crm {klass} {fallbackClass}" style={fallbackStyle} aria-hidden="true">{initial}</span>
{/if}
