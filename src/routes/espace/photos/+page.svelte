<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';

	const STEPS = [
		{ id: 'demarrage', label: 'Démarrage' },
		{ id: 'mois1', label: 'Mois 1' },
		{ id: 'mois2', label: 'Mois 2' },
		{ id: 'mois3', label: 'Mois 3' },
		{ id: 'mois4', label: 'Mois 4' },
		{ id: 'mois5', label: 'Mois 5' },
		{ id: 'mois6', label: 'Mois 6' },
	];

	/** Garde-fou à la sélection : un fichier lourd est de toute façon compressé avant l'envoi. */
	const MAX_FILE_BYTES = 30 * 1024 * 1024;
	/**
	 * Cible de compression : chaque photo part individuellement (jamais les 3
	 * dans une seule requête) et reste très en dessous de la limite de 6 Mo des
	 * fonctions Netlify (cause du bug « Unexpected end of JSON input »).
	 */
	const TARGET_MAX_BYTES = 2 * 1024 * 1024;
	/** Plus grand côté après redimensionnement — largeur suffisante pour un suivi visuel. */
	const MAX_EDGE = 2560;

	type Submission = {
		_id: string;
		step: string;
		date: string;
		count: number;
	};

	const STEP_LABELS: Record<string, string> = Object.fromEntries(STEPS.map((s) => [s.id, s.label]));

	let screen = $state<'intro' | 'step' | 'upload' | 'done'>('intro');
	let selectedStep = $state<string | null>(null);
	let selectedFiles = $state<File[]>([]);
	let previews = $state<string[]>([]);
	let sending = $state(false);
	let uploading = $state(false); // compression + réseau en cours (une photo en vol)
	let progressSent = $state(0);
	let progressTotal = $state(0);
	let progressLabel = $state('');
	let error = $state('');
	let submissions = $state<Submission[]>([]);
	let lastSent = $state<{ step: string; count: number } | null>(null);

	async function loadSubmissions() {
		try {
			const res = await fetch('/api/photos');
			if (!res.ok) return;
			const text = await res.text();
			if (!text) return;
			submissions = JSON.parse(text) as Submission[];
		} catch {
			/* silencieux : la liste d'envois est secondaire */
		}
	}

	function pickStep(id: string) {
		selectedStep = id;
		screen = 'upload';
	}

	function addFiles(files: FileList | null) {
		if (!files || sending) return;
		error = '';
		const incoming = Array.from(files);
		const room = 6 - selectedFiles.length;
		if (incoming.length > room) {
			error = `Tu peux envoyer jusqu’à 6 photos au total.`;
		}
		const accepted: File[] = [];
		for (const f of incoming.slice(0, room)) {
			if (!f.type.startsWith('image/')) {
				error = 'Seules les images sont acceptées.';
				continue;
			}
			if (f.size > MAX_FILE_BYTES) {
				error = `« ${f.name} » est trop volumineuse (30 Mo max).`;
				continue;
			}
			accepted.push(f);
		}
		selectedFiles = [...selectedFiles, ...accepted];
		refreshPreviews();
	}

	function removeFile(i: number) {
		if (sending) return;
		selectedFiles = selectedFiles.filter((_, idx) => idx !== i);
		refreshPreviews();
	}

	function refreshPreviews() {
		for (const p of previews) URL.revokeObjectURL(p);
		previews = selectedFiles.map((f) => URL.createObjectURL(f));
	}

	function fmtMo(bytes: number): string {
		return (bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
	}

	/**
	 * Compresse une photo côté client : redimensionnement (plus grand côté
	 * borné) + ré-encodage JPEG progressif jusqu'à ~2 Mo. Une photo EXISTANTE
	 * n'est jamais modifiée — on produit seulement une copie allégée pour
	 * l'envoi. Repli sûr : si le navigateur ne sait pas faire, on renvoie le
	 * fichier d'origine (les routes serveur gardent leurs propres garde-fous).
	 */
	async function compressImage(file: File): Promise<Blob> {
		if (file.type === 'image/gif') return file; // animation : ne pas aplatir
		if (file.size <= TARGET_MAX_BYTES && file.type !== 'image/heic' && file.type !== 'image/heif') {
			return file;
		}
		try {
			const bitmap = await createImageBitmap(file);
			const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
			const w = Math.max(1, Math.round(bitmap.width * scale));
			const h = Math.max(1, Math.round(bitmap.height * scale));
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d');
			if (!ctx) return file;
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(bitmap, 0, 0, w, h);
			bitmap.close?.();
			// Qualité dégressive jusqu'à rentrer sous la cible (~2 Mo).
			for (const q of [0.85, 0.75, 0.65, 0.5, 0.35]) {
				const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
				if (blob && blob.size <= TARGET_MAX_BYTES) return blob;
				if (blob && q === 0.35) return blob; // dernière rampe : on prend le meilleur effort
			}
			return file;
		} catch {
			return file; // décodage impossible (HEIC exotique…) : tentative avec l'original
		}
	}

	/**
	 * Envoie UNE photo (requête dédiée, jamais de lot > 6 Mo) et renvoie le
	 * storageId. Le JSON de la réponse est lu défensivement : une réponse vide
	 * ou non-JSON (erreur hébergeur) produit un message français clair, jamais
	 * l'erreur brute « Unexpected end of JSON input ».
	 */
	async function uploadOne(step: string, photo: Blob): Promise<string> {
		const form = new FormData();
		form.set('step', step);
		form.set('photo', photo, 'photo.jpg');
		let res: Response;
		try {
			res = await fetch('/api/photos', { method: 'POST', body: form });
		} catch {
			throw new Error('Connexion impossible. Vérifie ton réseau puis réessaie.');
		}
		if (res.status === 413) {
			throw new Error('Cette photo est encore trop lourde après compression. Réessaie avec une photo plus légère.');
		}
		let data: { error?: string; storageId?: string } = {};
		try {
			const text = await res.text();
			if (text) data = JSON.parse(text);
		} catch {
			// Réponse vide/non-JSON (couche hébergeur) : message lisible, pas de crash JSON.
			throw new Error('Le serveur n’a pas répondu correctement. Réessaie dans quelques instants.');
		}
		if (!res.ok || !data.storageId) {
			throw new Error(data.error || 'Envoi impossible pour le moment. Réessaie dans quelques instants.');
		}
		return data.storageId;
	}

	async function send() {
		if (sending) return; // anti double-clic : un seul envoi à la fois
		if (!selectedStep || selectedFiles.length === 0) {
			error = 'Ajoute au moins une photo avant d’envoyer.';
			return;
		}
		sending = true;
		uploading = false;
		error = '';
		progressSent = 0;
		progressTotal = selectedFiles.length;
		progressLabel = 'Préparation des photos…';
		try {
			const step = selectedStep;
			// Ordre de sélection préservé (face / profil / dos) : chaque photo est
			// compressée puis envoyée immédiatement, une par une, dans l'ordre.
			const remaining: File[] = [...selectedFiles];
			while (remaining.length > 0) {
				const file = remaining[0];
				uploading = true;
				progressLabel = `Préparation de la photo ${progressSent + 1}/${progressTotal}…`;
				const photo = await compressImage(file);
				progressLabel = `Envoi de la photo ${progressSent + 1}/${progressTotal} (${fmtMo(photo.size)} Mo)…`;
				try {
					await uploadOne(step, photo);
				} catch (e) {
					// Les photos déjà parties sont retirées de la sélection : « Envoyer »
					// ne renverra QUE les manquantes (jamais de doublon).
					selectedFiles = remaining;
					refreshPreviews();
					const dejaRecues = progressSent > 0 ? `${progressSent} photo${progressSent > 1 ? 's ont' : ' a'} déjà été reçue${progressSent > 1 ? 's' : ''} — ` : '';
					const detail = e instanceof Error ? e.message : 'Envoi impossible.';
					error = `${detail} ${dejaRecues}Appuie à nouveau sur « Envoyer » pour renvoyer les ${remaining.length} restante${remaining.length > 1 ? 's' : ''}.`;
					return; // finally remet sending à false
				}
				remaining.shift();
				selectedFiles = [...remaining];
				refreshPreviews();
				progressSent++;
				uploading = false;
			}
			lastSent = { step, count: progressTotal };
			progressLabel = '';
			screen = 'done';
			await loadSubmissions();
		} finally {
			sending = false;
			uploading = false;
		}
	}

	loadSubmissions();

	function fmtDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
	}
</script>

<svelte:head><title>Photos de suivi — G-Flux</title></svelte:head>

<div class="mx-auto max-w-lg">
	<BackToHome label="Photos de suivi" />

	{#if screen === 'intro'}
		<section class="rounded-3xl border border-line bg-card p-6 shadow-sm">
			<div class="space-y-3 text-sm leading-relaxed text-ink">
				<p>Bienvenue dans l’espace de dépôt de tes photos de suivi.</p>
				<p>Elles ne seront jamais utilisées ou partagées sans ton autorisation explicite.</p>
				<p>Tu peux faire ces photos pour suivre visuellement ta progression.</p>
				<p>L’objectif n’est pas de juger, mais de voir les petits changements invisibles sur la balance.</p>
				<p>Merci de bien remplir les infos suivantes pour qu’on puisse bien suivre ton évolution ensemble.</p>
			</div>
			<button
				onclick={() => (screen = 'step')}
				class="mt-6 w-full rounded-xl bg-ink px-4 py-3.5 font-semibold text-white transition hover:opacity-90"
			>Suivant →</button>
		</section>

	{:else if screen === 'step'}
		<section class="rounded-3xl border border-line bg-card p-6 shadow-sm">
			<p class="font-display text-lg font-semibold text-ink">À quelle étape correspond cette série de photos ?</p>
			<div class="mt-4 space-y-2">
				{#each STEPS as s, i}
					<button
						onclick={() => pickStep(s.id)}
						class="flex w-full items-center gap-3 rounded-xl border-2 border-line bg-white px-4 py-3 text-left transition hover:border-brand"
					>
						<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-line font-display text-xs font-semibold text-mist">
							{String.fromCharCode(65 + i)}
						</span>
						<span class="text-sm font-semibold text-ink">{s.label}</span>
						<span class="ml-auto text-mist">→</span>
					</button>
				{/each}
			</div>
		</section>

	{:else if screen === 'upload'}
		<section class="rounded-3xl border border-line bg-card p-6 shadow-sm">
			<p class="font-display text-lg font-semibold text-ink">
				Photos — <span class="text-brand">{STEP_LABELS[selectedStep ?? '']}</span>
			</p>
			<p class="mt-1 text-sm text-mist">Télécharge les 2 ou 3 photos que tu souhaites partager (idéalement : face / profil / dos).</p>

			{#if selectedFiles.length > 0}
				<div class="mt-4 grid grid-cols-3 gap-2">
					{#each selectedFiles as f, i (f.name + i)}
						<div class="relative overflow-hidden rounded-xl border-2 border-brand bg-cream">
							<img src={previews[i]} alt={f.name} class="h-28 w-full object-cover" />
							{#if !sending}
								<button
									type="button"
									onclick={() => removeFile(i)}
									class="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/80 text-xs text-white"
									aria-label="Retirer la photo"
								>✕</button>
							{/if}
							<div class="truncate px-1.5 py-1 text-[10px] text-mist">{f.name}</div>
						</div>
					{/each}
				</div>
			{/if}

			<label
				for="photo-input"
				class="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-cream px-4 py-8 text-center transition hover:border-brand"
				class:pointer-events-none={sending}
				class:opacity-60={sending}
			>
				<span class="grid place-items-center"><Icon name="upload" size={24} class="text-brand" /></span>
				<span class="mt-2 text-sm font-semibold text-ink">Clique pour choisir une photo</span>
				<span class="mt-1 text-xs text-mist">Format image · jusqu’à 6 photos · envoyées une par une</span>
				<input
					id="photo-input"
					type="file"
					accept="image/*"
					multiple
					class="sr-only"
					disabled={sending}
					onchange={(e) => addFiles(e.currentTarget.files)}
				/>
			</label>

			{#if error}
				<p class="mt-3 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{error}</p>
			{/if}

			{#if sending}
				<div class="mt-4" role="status" aria-live="polite">
					<p class="text-xs font-semibold text-ink">{progressLabel}</p>
					<div class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-line">
						<div
							class="h-full rounded-full bg-brand transition-all duration-300"
							style={`width: ${progressTotal > 0 ? Math.round((progressSent / progressTotal) * 100) : 0}%`}
						></div>
					</div>
					<p class="mt-1 text-[11px] text-mist">{progressSent} / {progressTotal} photo{progressTotal > 1 ? 's' : ''} envoyée{progressSent > 1 ? 's' : ''}</p>
				</div>
			{/if}

			<div class="mt-5 flex items-center gap-3">
				<button
					onclick={() => (screen = 'step')}
					disabled={sending}
					class="rounded-xl border-2 border-line px-4 py-3 text-sm font-semibold text-mist transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
				>← Retour</button>
				<button
					onclick={send}
					disabled={sending}
					class="flex-1 rounded-xl bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
				>{sending ? 'Envoi en cours…' : 'Envoyer'}</button>
			</div>
		</section>

	{:else}
		<section class="rounded-3xl border border-brand/40 bg-brand-light p-6 text-center shadow-sm">
			<div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white"><Icon name="check" size={30} strokeWidth={2.5} /></div>
			<h2 class="mt-4 font-display text-xl font-semibold text-ink">Photos envoyées !</h2>
			<p class="mt-2 text-sm leading-relaxed text-ink">
				Ta série <strong>{STEP_LABELS[lastSent?.step ?? '']}</strong> ({lastSent?.count} photo{lastSent && lastSent.count > 1 ? 's' : ''}) a bien été
				envoyée à ton coach. Il te confirmera la réception lors de ton prochain suivi.
			</p>
			<button
				onclick={() => (screen = 'intro')}
				class="mt-5 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
			>Faire une autre série</button>
		</section>
	{/if}

	{#if screen === 'done' && submissions.length > 0}
		<section class="mt-4 rounded-3xl border border-line bg-card p-5 shadow-sm">
			<h3 class="flex items-center gap-1.5 font-display text-sm font-semibold text-ink"><Icon name="upload" size={15} class="shrink-0 text-brand" /> Mes séries envoyées</h3>
			<ul class="mt-3 space-y-2">
				{#each submissions as s}
					<li class="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-2.5 text-sm">
						<span class="font-semibold text-ink">{STEP_LABELS[s.step] ?? s.step}</span>
						<span class="inline-flex items-center gap-1 text-xs text-mist">{fmtDate(s.date)} · {s.count} photo{s.count > 1 ? 's' : ''} <Icon name="check" size={12} class="text-brand" /></span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
