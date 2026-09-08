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

	const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
	let error = $state('');
	let submissions = $state<Submission[]>([]);
	let lastSent = $state<{ step: string; count: number } | null>(null);

	async function loadSubmissions() {
		try {
			const res = await fetch('/api/photos');
			if (res.ok) submissions = (await res.json()) as Submission[];
		} catch {
			/* silencieux : la liste d'envois est secondaire */
		}
	}

	function pickStep(id: string) {
		selectedStep = id;
		screen = 'upload';
	}

	function addFiles(files: FileList | null) {
		if (!files) return;
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
				error = `« ${f.name} » dépasse 10 Mo.`;
				continue;
			}
			accepted.push(f);
		}
		selectedFiles = [...selectedFiles, ...accepted];
		previews = selectedFiles.map((f) => URL.createObjectURL(f));
	}

	function removeFile(i: number) {
		const next = selectedFiles.filter((_, idx) => idx !== i);
		selectedFiles = next;
		previews = next.map((f) => URL.createObjectURL(f));
	}

	async function send() {
		if (!selectedStep || selectedFiles.length === 0) {
			error = 'Ajoute au moins une photo avant d’envoyer.';
			return;
		}
		sending = true;
		error = '';
		try {
			const form = new FormData();
			form.set('step', selectedStep);
			for (const f of selectedFiles) form.append('photo', f);
			const res = await fetch('/api/photos', { method: 'POST', body: form });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Envoi impossible.');
			lastSent = { step: selectedStep, count: selectedFiles.length };
			selectedFiles = [];
			previews = [];
			screen = 'done';
			await loadSubmissions();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Envoi impossible.';
		} finally {
			sending = false;
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
							<button
								type="button"
								onclick={() => removeFile(i)}
								class="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/80 text-xs text-white"
								aria-label="Retirer la photo"
							>✕</button>
							<div class="truncate px-1.5 py-1 text-[10px] text-mist">{f.name}</div>
						</div>
					{/each}
				</div>
			{/if}

			<label
				for="photo-input"
				class="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-cream px-4 py-8 text-center transition hover:border-brand"
			>
				<span class="grid place-items-center"><Icon name="upload" size={24} class="text-brand" /></span>
				<span class="mt-2 text-sm font-semibold text-ink">Clique pour choisir une photo</span>
				<span class="mt-1 text-xs text-mist">Format image · 10 Mo max · jusqu’à 6 photos</span>
				<input
					id="photo-input"
					type="file"
					accept="image/*"
					multiple
					class="sr-only"
					onchange={(e) => addFiles(e.currentTarget.files)}
				/>
			</label>

			{#if error}
				<p class="mt-3 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{error}</p>
			{/if}

			<div class="mt-5 flex items-center gap-3">
				<button
					onclick={() => (screen = 'step')}
					class="rounded-xl border-2 border-line px-4 py-3 text-sm font-semibold text-mist transition hover:border-ink hover:text-ink"
				>← Retour</button>
				<button
					onclick={send}
					disabled={sending}
					class="flex-1 rounded-xl bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
				>{sending ? 'Envoi en cours…' : 'Envoyer'}</button>
			</div>
		</section>

	{:else}
		<section class="rounded-3xl border border-brand/40 bg-brand-light p-6 text-center shadow-sm">
			<div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white"><Icon name="check" size={30} strokeWidth={2.5} /></div>
			<h2 class="mt-4 font-display text-xl font-semibold text-ink">Photos envoyées !</h2>
			<p class="mt-2 text-sm leading-relaxed text-ink">
				Ta série <strong>{STEP_LABELS[lastSent?.step ?? '']}</strong> ({lastSent?.count} photo{lastSent && lastSent.count > 1 ? 's' : ''}) a bien été
				envoyée à ta coach. Elle te confirmera la réception lors de ton prochain suivi.
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