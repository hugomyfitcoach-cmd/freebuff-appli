<script lang="ts">
	import RecorderControl from './RecorderControl.svelte';
	import AudioPlayer from './AudioPlayer.svelte';
	import { fmtMs, fmtSize, optimizeImageFile, type CoachMediaItem } from '../media.js';

	/**
	 * Zone média d'un retour de bilan ou du message du coach :
	 *  - enregistrement audio (réécoute avant toute publication) ;
	 *  - pièces jointes (images optimisées dès la sélection, PDF) ;
	 *  - liste des fichiers existants avec leur état (brouillon invisible
	 *    cliente / publié / expiré) et suppression des brouillons.
	 *
	 * `mode="feedback"`   → lié à un bilan : la publication du retour publie
	 *                       automatiquement ses médias (setFeedback).
	 * `mode="message"`    → audio du message du coach : le brouillon enregistré
	 *                       est exposé via `stagedAudioId`, publié à l'envoi.
	 */
	let {
		mode,
		userId,
		checkinId = null,
		existing = [],
		allowAudio = true,
		allowAttachments = false,
		stagedAudioId = $bindable(null),
	}: {
		mode: 'feedback' | 'message';
		userId: string;
		checkinId?: string | null;
		existing?: CoachMediaItem[];
		allowAudio?: boolean;
		allowAttachments?: boolean;
		stagedAudioId?: string | null;
	} = $props();

	let items = $state<CoachMediaItem[]>([...existing]);
	let busy = $state(false);
	let error = $state('');
	let recorderKey = $state(0);

	const audioSource = $derived(mode === 'message' ? 'coach_message_audio' : 'checkin_feedback_audio');
	const audioLabel = $derived(mode === 'message' ? 'Message audio' : 'Retour audio');

	async function api<T = { ok: boolean; error?: string }>(url: string, init?: RequestInit): Promise<T> {
		const res = await fetch(url, init);
		const data = (await res.json()) as T & { error?: string };
		if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Opération impossible.');
		return data;
	}

	async function deleteExisting(mediaId: string) {
		try {
			await api(`/api/coach/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
			items = items.filter((m) => m._id !== mediaId);
			if (stagedAudioId === mediaId) stagedAudioId = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Suppression impossible.';
		}
	}

	/** Un seul audio « en préparation » par contexte : on retire les anciens brouillons. */
	async function clearDraftAudio() {
		for (const m of items.filter((i) => i.kind === 'audio' && i.status === 'draft' && i.source === audioSource)) {
			try {
				await api(`/api/coach/media/${encodeURIComponent(m._id)}`, { method: 'DELETE' });
			} catch {
				/* on continue */
			}
		}
		items = items.filter((i) => !(i.kind === 'audio' && i.status === 'draft' && i.source === audioSource));
	}

	async function uploadBlob(file: Blob, kind: 'audio' | 'image' | 'pdf', name: string, mime: string, durationMs?: number) {
		const form = new FormData();
		form.set('userId', userId);
		form.set('source', kind === 'audio' ? audioSource : 'checkin_attachment');
		if (checkinId && mode === 'feedback') form.set('checkinId', checkinId);
		form.set('file', file, name);
		if (durationMs != null) form.set('durationMs', String(durationMs));
		const data = await api<{ ok: boolean; mediaId: string }>('/api/coach/media', { method: 'POST', body: form });
		return data.mediaId;
	}

	async function onAudioDone(p: { blob: Blob; mime: string; durationMs: number }) {
		error = '';
		busy = true;
		try {
			await clearDraftAudio();
			const mediaId = await uploadBlob(p.blob, 'audio', mode === 'message' ? 'message-audio' : 'retour-audio', p.mime, p.durationMs);
			const preview = URL.createObjectURL(p.blob);
			items = [
				...items.filter((i) => !(i.kind === 'audio' && i.source === audioSource && i.status === 'draft')),
				{
					_id: mediaId,
					userId,
					source: audioSource as CoachMediaItem['source'],
					checkinId,
					kind: 'audio',
					mime: p.mime,
					name: audioLabel,
					size: p.blob.size,
					durationMs: p.durationMs,
					status: 'draft',
					publishedAt: null,
					firstListenedAt: null,
					createdAt: Date.now(),
					expiresAt: null,
					expired: false,
					url: preview,
				},
			];
			if (mode === 'message') stagedAudioId = mediaId;
			recorderKey++;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Envoi impossible.';
		} finally {
			busy = false;
		}
	}

	async function onAttach(files: FileList | null) {
		if (!files || files.length === 0) return;
		error = '';
		busy = true;
		try {
			for (const file of Array.from(files)) {
				let toSend: Blob = file;
				let name = file.name;
				let mime = file.type;
				if (file.type.startsWith('image/')) {
					if (file.size > 12 * 1024 * 1024) throw new Error(`« ${file.name} » est trop lourd (max 12 Mo).`);
					const opt = await optimizeImageFile(file);
					toSend = opt.blob;
					mime = opt.mime;
					name = opt.name;
				} else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
					if (file.size > 15 * 1024 * 1024) throw new Error(`« ${file.name} » dépasse 15 Mo.`);
				} else {
					throw new Error('Formats acceptés : images (JPG/PNG/WebP) ou PDF.');
				}
				const mediaId = await uploadBlob(toSend, mime === 'application/pdf' ? 'pdf' : 'image', name, mime);
				items = [
					...items,
					{
						_id: mediaId,
						userId,
						source: 'checkin_attachment',
						checkinId,
						kind: mime === 'application/pdf' ? 'pdf' : 'image',
						mime,
						name,
						size: toSend.size,
						durationMs: null,
						status: 'draft',
						publishedAt: null,
						firstListenedAt: null,
						createdAt: Date.now(),
						expiresAt: null,
						expired: false,
						url: null,
					},
				];
			}
			if (inputEl) inputEl.value = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Ajout impossible.';
		} finally {
			busy = false;
		}
	}

	let inputEl: HTMLInputElement | undefined = $state();
</script>

{#if error}
	<p class="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger">{error}</p>
{/if}

<!-- Fichiers existants -->
{#if items.length > 0}
	<ul class="mt-2 space-y-2">
		{#each items as item (item._id)}
			<li class="rounded-xl border border-line bg-white p-2.5">
				{#if item.kind === 'audio'}
					<div class="mb-1.5 flex flex-wrap items-center justify-between gap-1">
						<span class="text-xs font-bold text-ink">🎙️ {item.name} · {fmtMs(item.durationMs)}</span>
						<span class="flex items-center gap-1">
							{#if item.status === 'published'}
								<span class="rounded-full bg-brand-light px-1.5 py-px text-[10px] font-bold uppercase text-brand-dark">publié</span>
							{:else if item.status === 'expired'}
								<span class="rounded-full bg-line/70 px-1.5 py-px text-[10px] font-bold uppercase text-mist">expiré</span>
							{:else}
								<span class="rounded-full bg-warn-light px-1.5 py-px text-[10px] font-bold uppercase text-warn">brouillon</span>
							{/if}
							{#if item.status !== 'expired' && (item.status === 'draft' || mode === 'message')}
								<button type="button" onclick={() => deleteExisting(item._id)} class="text-xs text-danger hover:underline" aria-label="Supprimer">🗑</button>
							{/if}
						</span>
					</div>
					{#if item.url && !item.expired}
						<AudioPlayer src={item.url} durationMs={item.durationMs} />
					{:else}
						<p class="text-xs italic text-mist">🔇 {audioLabel} expiré — le fichier a été supprimé automatiquement.</p>
					{/if}
				{:else}
					<div class="flex items-center gap-3">
						{#if item.kind === 'image' && item.url}
							<a href={item.url} target="_blank" rel="noopener" class="shrink-0">
								<img src={item.url} alt={item.name} class="h-14 w-14 rounded-lg border border-line object-cover" />
							</a>
						{:else}
							<span class="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-brand-light text-xl">📄</span>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-semibold text-ink">{item.name}</p>
							<p class="text-[11px] text-mist">{item.kind === 'image' ? '🖼️ Image' : '📄 PDF'} · {fmtSize(item.size)}</p>
						</div>
						<div class="flex shrink-0 items-center gap-1.5">
							{#if item.status === 'published'}
								<span class="rounded-full bg-brand-light px-1.5 py-px text-[10px] font-bold uppercase text-brand-dark">publié</span>
							{:else}
								<span class="rounded-full bg-warn-light px-1.5 py-px text-[10px] font-bold uppercase text-warn">brouillon</span>
							{/if}
							{#if item.url}
								<a href={item.url} target="_blank" rel="noopener" class="rounded-lg border-2 border-line px-2 py-1 text-[11px] font-bold text-ink transition hover:border-brand hover:text-brand">
									{item.kind === 'image' ? 'Voir' : 'Ouvrir'}
								</a>
							{/if}
							{#if item.status === 'draft'}
								<button type="button" onclick={() => deleteExisting(item._id)} class="text-xs text-danger hover:underline" aria-label="Supprimer">🗑</button>
							{/if}
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<!-- Actions : audio + pièces jointes -->
<div class="mt-2 flex flex-wrap items-center gap-2">
	{#if allowAudio}
		<div class="flex-1 basis-56">
			{#key recorderKey}
				<RecorderControl onDone={onAudioDone} {busy} />
			{/key}
		</div>
	{/if}
	{#if allowAttachments}
		<label
			class="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-line px-3 py-2 text-sm font-semibold text-mist transition hover:border-brand hover:text-brand {busy ? 'pointer-events-none opacity-60' : ''}"
		>
			<span>📎</span> Ajouter une pièce jointe
			<input bind:this={inputEl} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" multiple class="hidden" onchange={(e) => onAttach((e.currentTarget as HTMLInputElement).files)} />
		</label>
	{/if}
</div>
{#if mode === 'feedback'}
	<p class="mt-2 text-[11px] leading-snug text-mist">
		Un enregistrement en brouillon reste invisible pour la cliente — il sera joint au retour quand tu cliqueras sur « Publier ».
	</p>
{/if}
