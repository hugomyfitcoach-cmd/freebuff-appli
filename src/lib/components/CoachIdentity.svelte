<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	/**
	 * Identité coach (haut droit) : avatar / photo de profil + prénom (nom)
	 * + email. 100 % frontend : la photo est recadrée en carré 128 px puis
	 * persistée en localStorage (clé partagée avec le dashboard, « coach-avatar »)
	 * — aucun backend, aucune écriture de données.
	 */
	let {
		prenom,
		nom = '',
		email = '',
	}: { prenom: string; nom?: string; email?: string } = $props();

	let avatar = $state<string | null>(null);

	$effect(() => {
		// Restaure la photo persistée (client uniquement, après hydratation).
		try {
			avatar = localStorage.getItem('coach-avatar');
		} catch {
			/* navigation privée — aperçu de session seul */
		}
	});

	function handlePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const img = new Image();
		img.onload = () => {
			const c = document.createElement('canvas');
			c.width = 128;
			c.height = 128;
			const ctx = c.getContext('2d');
			if (!ctx) return;
			const side = Math.min(img.naturalWidth, img.naturalHeight);
			ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
			const url = c.toDataURL('image/jpeg', 0.85);
			try {
				localStorage.setItem('coach-avatar', url);
			} catch {
				/* quota dépassé — l'aperçu reste actif pour la session */
			}
			avatar = url;
			URL.revokeObjectURL(img.src);
		};
		img.onerror = () => URL.revokeObjectURL(img.src);
		img.src = URL.createObjectURL(file);
		input.value = '';
	}

	const displayName = $derived(nom ? `${prenom} ${nom}` : prenom);
	const initial = $derived(prenom.trim().charAt(0).toUpperCase() || '?');
</script>

<div class="flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-white py-1 pl-1 pr-3.5 shadow-sm">
	<label
		class="group relative block h-8 w-8 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand"
		title="Changer la photo de profil"
	>
		<span class="sr-only">Changer la photo de profil</span>
		{#if avatar}
			<img src={avatar} alt="Avatar de {prenom}" class="h-8 w-8 rounded-full object-cover ring-1 ring-line" />
		{:else}
			<span class="grid h-8 w-8 place-items-center rounded-full bg-brand text-[13px] font-black text-white">{initial}</span>
		{/if}
		<!-- Indicateur d'édition discret -->
		<span class="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-white text-ink shadow-sm ring-1 ring-line transition group-hover:bg-brand group-hover:text-white" aria-hidden="true">
			<Icon name="camera" size={8} strokeWidth={2.8} />
		</span>
		<input type="file" accept="image/*" class="hidden" onchange={handlePick} aria-label="Changer la photo de profil" />
	</label>
	<span class="hidden min-w-0 leading-tight sm:block">
		<span class="block truncate text-[13px] font-bold text-ink">{displayName}</span>
		<span class="block truncate text-[10.5px] font-medium text-mist">{email || 'Coach G-FLUX'}</span>
	</span>
</div>
