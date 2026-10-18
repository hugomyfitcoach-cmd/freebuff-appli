<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	/**
	 * Identité coach (haut droit) : avatar / photo de profil + prénom (nom)
	 * + email. La photo est persistée CÔTÉ SERVEUR via le BFF
	 * `/api/profile/photo` (file storage Convex, `users.profilePhotoStorageId`) :
	 * c'est la même donnée que `dashboard.myCoachProfile` expose aux clientes.
	 * Elle survit donc à toute éviction des données de site du navigateur —
	 * l'ancien dépôt localStorage (volatile, perdu tous les quelques jours)
	 * n'est plus qu'une source de migration ponctuelle, jamais de vérité.
	 */
	let {
		prenom,
		nom = '',
		email = '',
	}: { prenom: string; nom?: string; email?: string } = $props();

	let avatar = $state<string | null>(null);
	let uploadError = $state<string | null>(null);

	/** Envoie un JPEG au BFF et renvoie l'URL signée servie par Convex. */
	async function uploadPhoto(blob: Blob): Promise<string | null> {
		const form = new FormData();
		form.append('photo', blob, 'photo-profil.jpg');
		const res = await fetch('/api/profile/photo', { method: 'POST', body: form });
		const data = (await res.json().catch(() => null)) as { url?: string | null } | null;
		return res.ok && data?.url ? data.url : null;
	}

	/**
	 * Migration unique de l'ancienne photo locale (localStorage) : si le serveur
	 * n'a pas encore de photo, la copie locale est envoyée une fois puis la clé
	 * disparaît — jamais deux sources de vérité.
	 */
	async function migrateLegacyPhoto(): Promise<void> {
		let legacy: string | null = null;
		try {
			legacy = localStorage.getItem('coach-avatar');
			if (!legacy) return;
			localStorage.removeItem('coach-avatar');
		} catch {
			/* navigation privée : rien à migrer */
			return;
		}
		if (avatar || !legacy.startsWith('data:image/')) return;
		try {
			const blob = await (await fetch(legacy)).blob();
			const url = await uploadPhoto(blob);
			if (url) avatar = url;
		} catch {
			/* migration impossible : la photo sera repose manuellement */
		}
	}

	$effect(() => {
		// Charge la photo serveur (puis migre l'éventuelle copie locale).
		(async () => {
			try {
				const res = await fetch('/api/profile/photo');
				const data = (await res.json().catch(() => null)) as { url?: string | null } | null;
				avatar = data?.url ?? null;
			} catch {
				avatar = null;
			}
			await migrateLegacyPhoto();
		})();
	});

	function handlePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploadError = null;
		const img = new Image();
		img.onload = () => {
			const c = document.createElement('canvas');
			c.width = 128;
			c.height = 128;
			const ctx = c.getContext('2d');
			if (!ctx) return;
			const side = Math.min(img.naturalWidth, img.naturalHeight);
			ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
			URL.revokeObjectURL(img.src);
			c.toBlob(async (blob) => {
				if (!blob) return;
				const previous = avatar;
				avatar = c.toDataURL('image/jpeg', 0.85); // aperçu immédiat
				try {
					const url = await uploadPhoto(blob);
					if (url) {
						avatar = url;
					} else {
						avatar = previous;
						uploadError = "Échec de l'envoi de la photo. Réessaie dans un instant.";
					}
				} catch {
					avatar = previous;
					uploadError = "Échec de l'envoi de la photo. Réessaie dans un instant.";
				}
			}, 'image/jpeg', 0.85);
			input.value = '';
		};
		img.onerror = () => URL.revokeObjectURL(img.src);
		img.src = URL.createObjectURL(file);
	}

	const displayName = $derived(nom ? `${prenom} ${nom}` : prenom);
	const initial = $derived(prenom.trim().charAt(0).toUpperCase() || '?');
</script>

<div class="flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-white py-1 pl-1 pr-3.5 shadow-sm">
	<label
		class="group relative block h-8 w-8 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand"
		title={uploadError ?? 'Changer la photo de profil'}
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
