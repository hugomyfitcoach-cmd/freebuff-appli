<script lang="ts">
	/**
	 * Dossier de la cliente (CRM coach) — notes privées et ressources partagées.
	 *
	 * Une entrée par note ou document, rattachée au clientId. La visibilité est
	 * par entrée : « Privé coach » (défaut, jamais envoyé) ou « Partager avec la
	 * cliente » (visible immédiatement dans sa page « Ressources »).
	 *
	 * Une entrée « Document » peut porter 1 à 5 fichiers/photos envoyés ensemble
	 * (même carte, chaque pièce jointe reste ouvable individuellement) plus une
	 * description facultative. Les anciennes entrées à un fichier unique restent
	 * affichées et fonctionnelles à l'identique.
	 */
	import Icon from './Icon.svelte';

	let {
		clientId,
		clientName = '',
	}: { clientId: string; clientName?: string } = $props();

	type Attachment = {
		storageId: string;
		mime: string;
		name: string;
		size: number;
		url: string | null;
	};
	type Resource = {
		_id: string;
		kind: 'note' | 'file';
		title: string;
		body?: string | null;
		visibility: 'private' | 'shared';
		name?: string | null;
		mime?: string | null;
		size?: number | null;
		attachmentsWithUrls?: Attachment[] | null;
		createdAt: number;
		updatedAt: number;
		url: string | null;
	};

	let rows = $state<Resource[]>([]);
	let loading = $state(true);
	let err = $state('');
	let ok = $state('');

	/**
	 * Lit un corps JSON en tolérant une réponse vide / non-JSON (couche hébergeur :
	 * fonction tuée avant toute réponse → corps vide, crash « Unexpected end of
	 * JSON input » sur response.json()). Renvoie un objet neutre : l'appelant
	 * affiche son message d'erreur propre au lieu de planter sur le parsing.
	 */
	async function readJson<T = Record<string, unknown>>(r: Response): Promise<T> {
		try {
			const text = await r.text();
			return (text ? JSON.parse(text) : {}) as T;
		} catch {
			return {} as T;
		}
	}

	async function load() {
		loading = true;
		err = '';
		try {
			const r = await fetch(`/api/coach/resources?client=${encodeURIComponent(clientId)}`);
			const j = await readJson<{ rows?: Resource[]; error?: string }>(r);
			if (!r.ok || j.error) throw new Error(j.error || 'Chargement impossible.');
			rows = j.rows ?? [];
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}
	$effect(() => {
		if (clientId) load();
	});
	function flashErr(e: unknown) {
		err = e instanceof Error ? e.message : String(e);
		ok = '';
	}
	function flashOk(msg: string) {
		ok = msg;
		err = '';
		setTimeout(() => (ok = ''), 4000);
	}

	/* ————— Nouvelle note ————— */
	let noteOpen = $state(false);
	let noteTitle = $state('');
	let noteBody = $state('');
	let busy = $state(false);
	async function addNote() {
		if (!noteTitle.trim() || !noteBody.trim()) {
			err = 'Titre et contenu requis.';
			return;
		}
		busy = true;
		err = '';
		try {
			const r = await fetch('/api/coach/resources', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: clientId, kind: 'note', title: noteTitle, body: noteBody }),
			});
			const j = await readJson<{ error?: string }>(r);
			if (!r.ok || j.error) throw new Error(j.error || "Impossible d'ajouter la note.");
			noteTitle = '';
			noteBody = '';
			noteOpen = false;
			flashOk('Note ajoutée au Drive (privée coach par défaut).');
			await load();
		} catch (e) {
			flashErr(e);
		} finally {
			busy = false;
		}
	}

	/* ————— Nouveau document (1 à 5 fichiers/photos + description facultative) ————— */
	const MAX_FILES = 5;
	let fileOpen = $state(false);
	let fileTitle = $state('');
	let fileDesc = $state('');
	let fileInput: HTMLInputElement | undefined = $state();
	let pickedFiles = $state<File[]>([]);
	let fileBusy = $state(false);

	function syncPicked() {
		const list = Array.from(fileInput?.files ?? []);
		pickedFiles = list.slice(0, MAX_FILES);
		if (list.length > MAX_FILES) {
			// Le navigateur n'autorise pas d'écraser l'input à la volée sans perdre
			// la sélection : on garde les 5 premiers et on prévient.
			err = '5 fichiers maximum — seuls les 5 premiers ont été gardés.';
			ok = '';
		}
	}
	function removePicked(index: number) {
		pickedFiles = pickedFiles.filter((_, i) => i !== index);
		if (fileInput) fileInput.value = '';
		// Reconstruit une DataTransfer pour garder des File réels dans l'input.
		const dt = new DataTransfer();
		for (const f of pickedFiles) dt.items.add(f);
		if (fileInput && dt.files.length > 0) fileInput.files = dt.files;
	}
	async function uploadFile() {
		if (!fileTitle.trim() || pickedFiles.length === 0) {
			err = 'Donne un titre et choisis au moins un fichier.';
			return;
		}
		fileBusy = true;
		err = '';
		try {
			// ROOT CAUSE corrigée : le POST multipart historique envoyait TOUS les
			// fichiers d'un coup PAR la fonction serveur (BFF). Au-delà de quelques
			// Mo, Netlify tuait la requête avant toute réponse → corps vide → crash
			// « Unexpected end of JSON input » sur response.json(). Désormais chaque
			// fichier part DIRECTEMENT vers le storage Convex (byte-passing, une
			// requête = un fichier, jamais la limite de la fonction), puis UNE seule
			// entrée Drive est créée avec les storageIds (JSON minuscule).
			const uploaded: { storageId: string; mime: string; name: string; size: number }[] = [];
			for (const f of pickedFiles) {
				const urlRes = await fetch('/api/coach/resources/upload-url', { method: 'POST' });
				const urlJ = await readJson<{ error?: string; uploadUrl?: string }>(urlRes);
				if (!urlRes.ok || !urlJ.uploadUrl) {
					throw new Error(urlJ.error || "Préparation de l'envoi impossible. Réessaie dans quelques instants.");
				}
				const up = await fetch(urlJ.uploadUrl, {
					method: 'POST',
					headers: { 'Content-Type': f.type || 'application/octet-stream' },
					body: f,
				});
				const upJ = await readJson<{ error?: string; storageId?: string }>(up);
				if (!up.ok || !upJ.storageId) {
					throw new Error(upJ.error || `Échec de l'envoi de « ${f.name} ». Réessaie dans quelques instants.`);
				}
				uploaded.push({ storageId: upJ.storageId, mime: f.type || 'application/octet-stream', name: f.name, size: f.size });
			}
			// UNE seule entrée pour l'ensemble (visibilité par défaut : privée coach).
			const r = await fetch('/api/coach/resources', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: clientId,
					kind: 'file',
					title: fileTitle,
					...(fileDesc.trim() ? { description: fileDesc } : {}),
					attachments: uploaded,
				}),
			});
			const j = await readJson<{ error?: string; ok?: boolean }>(r);
			if (!r.ok || j.error) throw new Error(j.error || "Impossible d'ajouter le document.");
			fileTitle = '';
			fileDesc = '';
			pickedFiles = [];
			if (fileInput) fileInput.value = '';
			fileOpen = false;
			flashOk('Document ajouté au Drive (privé coach par défaut).');
			await load();
		} catch (e) {
			flashErr(e);
		} finally {
			fileBusy = false;
		}
	}

	/* ————— Actions ————— */
	let busyId = $state<string | null>(null);
	async function setVisibility(id: string, visibility: 'private' | 'shared') {
		busyId = id;
		err = '';
		try {
			const r = await fetch(`/api/coach/resources/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ visibility }),
			});
			const j = await readJson<{ error?: string }>(r);
			if (!r.ok || j.error) throw new Error(j.error || 'Mise à jour impossible.');
			flashOk(visibility === 'shared' ? 'Visible par la cliente dans « Drive ». ✔' : 'Repassée en privé — plus visible côté cliente.');
			await load();
		} catch (e) {
			flashErr(e);
		} finally {
			busyId = null;
		}
	}
	async function remove(id: string, title: string) {
		if (!confirm(`Supprimer définitivement « ${title} » du Drive ?`)) return;
		busyId = id;
		err = '';
		try {
			const r = await fetch(`/api/coach/resources/${id}`, { method: 'DELETE' });
			const j = await readJson<{ error?: string; ok?: boolean }>(r);
			if (!r.ok || j.error) throw new Error(j.error || 'Suppression impossible.');
			flashOk('Entrée supprimée.');
			await load();
		} catch (e) {
			flashErr(e);
		} finally {
			busyId = null;
		}
	}

	function dateShort(ts: number): string {
		return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
	}
	function sizeLabel(bytes?: number | null): string {
		if (!bytes) return '';
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
		return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
	}
	/** Pièces jointes « aplaties » : forme historique (1 fichier) + attachments. */
	function rowFiles(r: Resource): Attachment[] {
		if (r.kind !== 'file') return [];
		const atts = r.attachmentsWithUrls ?? [];
		if (atts.length > 0) return atts;
		if (r.url && r.name) {
			return [{ storageId: '', mime: r.mime ?? '', name: r.name, size: r.size ?? 0, url: r.url }];
		}
		return [];
	}
	const isImage = (mime?: string | null) => (mime ?? '').startsWith('image/');
	const kindIcon = (r: Resource) => (r.kind === 'note' || !isImage(r.mime) ? 'fileText' : 'image');
</script>

<div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex items-center gap-2.5">
			<span class="grid h-8 w-8 place-items-center rounded-full bg-brand-light"><Icon name="cloud" size={15} class="text-brand" /></span>
			<div class="min-w-0">
				<p class="text-[11px] font-bold uppercase tracking-wider text-mist">Drive{clientName ? ` · ${clientName}` : ''}</p>
				<p class="mt-0.5 text-xs text-mist">Notes privées coach + ressources partagées avec la cliente</p>
			</div>
		</div>
		<div class="flex gap-1.5">
			<button
				type="button"
				onclick={() => { noteOpen = !noteOpen; fileOpen = false; err = ''; }}
				class="rounded-lg border-2 border-line px-2.5 py-1.5 text-xs font-bold text-ink transition hover:border-brand hover:text-brand"
			>{noteOpen ? 'Annuler' : '+ Note'}</button>
			<button
				type="button"
				onclick={() => { fileOpen = !fileOpen; noteOpen = false; err = ''; }}
				class="rounded-lg bg-ink px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-brand"
			>{fileOpen ? 'Annuler' : '+ Document'}</button>
		</div>
	</div>

	{#if noteOpen}
		<div class="mt-3 space-y-2 rounded-xl border border-line bg-cream/50 p-3">
			<input
				type="text"
				placeholder="Titre de la note (ex. Récap de notre appel)"
				bind:value={noteTitle}
				class="w-full rounded-lg border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand"
			/>
			<textarea
				placeholder="Contenu (réservé à la coach tant que tu ne partages pas l'entrée)"
				rows="3"
				bind:value={noteBody}
				class="w-full rounded-lg border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand"
			></textarea>
			<div class="flex justify-end">
				<button
					type="button"
					disabled={busy}
					onclick={addNote}
					class="rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
				>{busy ? 'Ajout…' : 'Ajouter la note'}</button>
			</div>
		</div>
	{/if}

	{#if fileOpen}
		<div class="mt-3 space-y-2 rounded-xl border border-line bg-cream/50 p-3">
			<input
				type="text"
				placeholder="Titre (ex. Comparaison photos septembre)"
				bind:value={fileTitle}
				class="w-full rounded-lg border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand"
			/>
			<input
				type="file"
				multiple
				accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*"
				bind:this={fileInput}
				onchange={syncPicked}
				class="block w-full text-sm text-mist file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
			/>
			{#if pickedFiles.length > 0}
				<ul class="space-y-1">
					{#each pickedFiles as f, i (f.name + f.size + i)}
						<li class="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5">
							<Icon name="fileText" size={13} class="shrink-0 text-mist" />
							<span class="min-w-0 flex-1 truncate text-xs text-ink">{f.name}</span>
							<span class="shrink-0 text-[11px] text-mist">{sizeLabel(f.size)}</span>
							<button
								type="button"
								onclick={() => removePicked(i)}
								class="shrink-0 rounded p-0.5 text-mist transition hover:text-danger"
								aria-label={`Retirer ${f.name}`}
							><Icon name="x" size={13} /></button>
						</li>
					{/each}
				</ul>
			{/if}
			<textarea
				placeholder="Description (facultatif) — ex. Comparaison face / profil / dos, 92 kg"
				rows="2"
				bind:value={fileDesc}
				class="w-full rounded-lg border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand"
			></textarea>
			<p class="text-[11px] text-mist">PDF, image ou document (Word, Excel, PowerPoint…) — 25 Mo max par fichier · 5 fichiers maximum par entrée.</p>
			<div class="flex justify-end">
				<button
					type="button"
					disabled={fileBusy}
					onclick={uploadFile}
					class="rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
				>{fileBusy ? 'Upload…' : 'Ajouter le document'}</button>
			</div>
		</div>
	{/if}

	{#if err}<p class="mt-2 rounded-lg bg-danger-light px-3 py-2 text-xs font-semibold text-danger">{err}</p>{/if}
	{#if ok}<p class="mt-2 rounded-lg bg-brand-light px-3 py-2 text-xs font-semibold text-brand-dark">{ok}</p>{/if}

	<div class="mt-3 space-y-2">
		{#if loading}
			<p class="py-3 text-center text-xs text-mist">Chargement du Drive…</p>
		{:else if rows.length === 0}
			<div class="rounded-xl border border-dashed border-line px-4 py-6 text-center">
				<p class="text-sm text-ink">Drive vide pour l'instant</p>
				<p class="mt-0.5 text-xs text-mist">Ajoute une note privée ou un document. Tout reste « Privé coach » tant que tu ne choisis pas de le partager.</p>
			</div>
		{:else}
			{#each rows as row (row._id)}
				{@const files = rowFiles(row)}
				{@const totalSize = files.reduce((s, f) => s + (f.size || 0), 0)}
				<div class="rounded-xl border border-line bg-white p-3 transition {row.visibility === 'shared' ? 'border-brand/40' : ''}">
					<div class="flex items-start gap-2.5">
						<span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-line/60"><Icon name={kindIcon(row)} size={15} class="text-mist" /></span>
						<div class="min-w-0 flex-1">
							<p class="break-words text-sm font-bold leading-snug text-ink">{row.title}</p>
							<p class="mt-0.5 text-[11px] text-mist">
								{row.kind === 'note' ? 'Note' : files.length > 1 ? `${files.length} fichiers` : 'Document'} · {dateShort(row.createdAt)}{totalSize ? ` · ${sizeLabel(totalSize)}` : ''}
							</p>
							{#if row.body}
								<p class="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink/75">{row.body}</p>
							{/if}
						</div>
						<span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide {row.visibility === 'shared' ? 'bg-brand-light text-brand-dark' : 'bg-line/70 text-mist'}">
							{row.visibility === 'shared' ? 'Partagée' : 'Privée'}
						</span>
					</div>

					{#if files.length > 0}
						<ul class="mt-2 space-y-1">
							{#each files as f, i (f.storageId + f.name + i)}
								{@const img = isImage(f.mime)}
								<li>
									{#if f.url}
										<a
											href={f.url}
											target="_blank"
											rel="noopener noreferrer"
											download={f.name}
											class="flex w-full items-center gap-2 rounded-lg border-2 border-line px-2.5 py-1.5 text-left transition hover:border-brand"
										>
											<Icon name={img ? 'image' : 'fileText'} size={13} class="shrink-0 text-mist" />
											<span class="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{f.name}</span>
											{#if f.size}<span class="shrink-0 text-[11px] text-mist">{sizeLabel(f.size)}</span>{/if}
											<Icon name="eye" size={13} class="shrink-0 text-mist" />
										</a>
									{:else}
										<div class="flex w-full items-center gap-2 rounded-lg border-2 border-line px-2.5 py-1.5">
											<Icon name={img ? 'image' : 'fileText'} size={13} class="shrink-0 text-mist" />
											<span class="min-w-0 flex-1 truncate text-xs font-semibold text-mist">{f.name}</span>
											{#if f.size}<span class="shrink-0 text-[11px] text-mist">{sizeLabel(f.size)}</span>{/if}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					<div class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-2.5">
						{#if row.visibility === 'private'}
							<button
								type="button"
								disabled={busyId === row._id}
								onclick={() => setVisibility(row._id, 'shared')}
								class="rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
							><Icon name="eye" size={12} class="mr-1 inline shrink-0" />Partager avec la cliente</button>
						{:else}
							<button
								type="button"
								disabled={busyId === row._id}
								onclick={() => setVisibility(row._id, 'private')}
								class="rounded-lg border-2 border-line px-2.5 py-1.5 text-[11px] font-bold text-mist transition hover:border-mist hover:text-ink disabled:opacity-60"
							>Repasser en privé</button>
						{/if}
						<button
							type="button"
							disabled={busyId === row._id}
							onclick={() => remove(row._id, row.title)}
							class="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-mist transition hover:text-danger"
						><Icon name="trash" size={13} class="shrink-0" /> Supprimer</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
