<script lang="ts">
	/**
	 * Dossier de la cliente (CRM coach) — notes privées et ressources partagées.
	 *
	 * Une entrée par note ou fichier, rattachée au clientId. La visibilité est
	 * par entrée : « Privé coach » (défaut, jamais envoyé) ou « Partager avec la
	 * cliente » (visible immédiatement dans sa page « Ressources »). Un seul
	 * fichier physique — la visibilité détermine simplement qui y accède.
	 */
	import Icon from './Icon.svelte';

	let {
		clientId,
		clientName = '',
	}: { clientId: string; clientName?: string } = $props();

	type Resource = {
		_id: string;
		kind: 'note' | 'file';
		title: string;
		body?: string | null;
		visibility: 'private' | 'shared';
		name?: string | null;
		mime?: string | null;
		size?: number | null;
		createdAt: number;
		updatedAt: number;
		url: string | null;
	};

	let rows = $state<Resource[]>([]);
	let loading = $state(true);
	let err = $state('');
	let ok = $state('');

	async function load() {
		loading = true;
		err = '';
		try {
			const r = await fetch(`/api/coach/resources?client=${encodeURIComponent(clientId)}`);
			const j = await r.json();
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
			const j = await r.json();
			if (!r.ok || j.error) throw new Error(j.error || "Impossible d'ajouter la note.");
			noteTitle = '';
			noteBody = '';
			noteOpen = false;
			flashOk('Note ajoutée au Dossier (privée coach par défaut).');
			await load();
		} catch (e) {
			flashErr(e);
		} finally {
			busy = false;
		}
	}

	/* ————— Nouveau fichier ————— */
	let fileOpen = $state(false);
	let fileTitle = $state('');
	let fileInput: HTMLInputElement | undefined = $state();
	let fileBusy = $state(false);
	async function uploadFile() {
		const file = fileInput?.files?.[0];
		if (!fileTitle.trim() || !file) {
			err = 'Donne un titre et choisis un fichier.';
			return;
		}
		fileBusy = true;
		err = '';
		try {
			const fd = new FormData();
			fd.append('userId', clientId);
			fd.append('title', fileTitle);
			fd.append('file', file);
			const r = await fetch('/api/coach/resources', { method: 'POST', body: fd });
			const j = await r.json();
			if (!r.ok || j.error) throw new Error(j.error || "Impossible d'ajouter le fichier.");
			fileTitle = '';
			if (fileInput) fileInput.value = '';
			fileOpen = false;
			flashOk('Document ajouté au Dossier (privé coach par défaut).');
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
			const j = await r.json();
			if (!r.ok || j.error) throw new Error(j.error || 'Mise à jour impossible.');
			flashOk(visibility === 'shared' ? 'Visible par la cliente dans « Ressources ». ✔' : 'Repassée en privé — plus visible côté cliente.');
			await load();
		} catch (e) {
			flashErr(e);
		} finally {
			busyId = null;
		}
	}
	async function remove(id: string, title: string) {
		if (!confirm(`Supprimer définitivement « ${title} » du Dossier ?`)) return;
		busyId = id;
		err = '';
		try {
			const r = await fetch(`/api/coach/resources/${id}`, { method: 'DELETE' });
			const j = await r.json();
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
	const fileKind = (r: Resource) => ((r.mime ?? '').startsWith('image/') ? 'image' : (r.mime ?? '') === 'application/pdf' ? 'pdf' : 'file');
	const kindIcon = (r: Resource) => (r.kind === 'note' ? 'fileText' : fileKind(r) === 'image' ? 'image' : 'fileText');
</script>

<div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex items-center gap-2.5">
			<span class="grid h-8 w-8 place-items-center rounded-full bg-brand-light"><Icon name="bookOpen" size={15} class="text-brand" /></span>
			<div class="min-w-0">
				<p class="text-[11px] font-bold uppercase tracking-wider text-mist">Dossier{clientName ? ` · ${clientName}` : ''}</p>
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
				placeholder="Titre (ex. Comparaison avant / après — 8 septembre)"
				bind:value={fileTitle}
				class="w-full rounded-lg border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand"
			/>
			<input
				type="file"
				bind:this={fileInput}
				class="block w-full text-sm text-mist file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
			/>
			<p class="text-[11px] text-mist">PDF, image ou document (Word, Excel, PowerPoint…) — 25 Mo max.</p>
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
			<p class="py-3 text-center text-xs text-mist">Chargement du Dossier…</p>
		{:else if rows.length === 0}
			<div class="rounded-xl border border-dashed border-line px-4 py-6 text-center">
				<p class="text-sm text-ink">Dossier vide pour l'instant</p>
				<p class="mt-0.5 text-xs text-mist">Ajoute une note privée ou un document. Tout reste « Privé coach » tant que tu ne choisis pas de le partager.</p>
			</div>
		{:else}
			{#each rows as row (row._id)}
				{@const isFile = row.kind === 'file'}
				<div class="rounded-xl border border-line bg-white p-3 transition {row.visibility === 'shared' ? 'border-brand/40' : ''}">
					<div class="flex items-start gap-2.5">
						<span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-line/60"><Icon name={kindIcon(row)} size={15} class="text-mist" /></span>
						<div class="min-w-0 flex-1">
							<p class="break-words text-sm font-bold leading-snug text-ink">{row.title}</p>
							<p class="mt-0.5 text-[11px] text-mist">
								{isFile ? (row.name ?? 'Document') : 'Note'} · {dateShort(row.createdAt)}{isFile && row.size ? ` · ${sizeLabel(row.size)}` : ''}
							</p>
							{#if !isFile && row.body}
								<p class="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink/75">{row.body}</p>
							{/if}
						</div>
						<span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide {row.visibility === 'shared' ? 'bg-brand-light text-brand-dark' : 'bg-line/70 text-mist'}">
							{row.visibility === 'shared' ? 'Partagée' : 'Privée'}
						</span>
					</div>

					{#if isFile && row.url}
						<a href={row.url} target="_blank" rel="noopener noreferrer" class="mt-2 inline-flex items-center gap-1 rounded-lg border-2 border-line px-2.5 py-1.5 text-xs font-bold text-ink transition hover:border-brand hover:text-brand">
							<Icon name="eye" size={13} class="shrink-0" /> Ouvrir
						</a>
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
