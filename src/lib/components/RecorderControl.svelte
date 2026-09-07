<script lang="ts">
	import { pickAudioMime, fmtSec } from '../media.js';

	/**
	 * Enregistreur vocal du coach (navigateur, MediaRecorder).
	 * - Opus/WebM en priorité (~48 kbps, voix), AAC/MP4 en repli (Safari) ;
	 * - arrêt automatique à 10 min ;
	 * - à l'arrêt, `onDone` livre { blob, mime, durationMs } — rien n'est
	 *   encore publié : le coach peut réécouter, recommencer ou supprimer.
	 */
	let {
		onDone,
		busy = false,
	}: {
		onDone: (p: { blob: Blob; mime: string; durationMs: number }) => void;
		busy?: boolean;
	} = $props();

	let phase = $state<'idle' | 'rec' | 'ready'>('idle');
	let elapsedMs = $state(0);
	let error = $state('');
	let blobUrl = $state<string | null>(null);
	let blobDur = $state(0);

	let rec: MediaRecorder | null = null;
	let stream: MediaStream | null = null;
	let chunks: Blob[] = [];
	let startAt = 0;
	let timer: ReturnType<typeof setInterval> | undefined;

	const MAX_REC_MS = 10 * 60 * 1000;

	async function start() {
		error = '';
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
			});
		} catch {
			error = 'Micro inaccessible. Autorise le micro dans ton navigateur puis réessaie.';
			return;
		}
		const mime = pickAudioMime();
		chunks = [];
		try {
			rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 });
		} catch {
			rec = new MediaRecorder(stream);
		}
		rec.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) chunks.push(e.data);
		};
		rec.onstop = () => {
			const mimeType = rec?.mimeType && rec.mimeType !== '' ? rec.mimeType : mime || 'audio/webm';
			const blob = new Blob(chunks, { type: mimeType });
			chunks = [];
			stream?.getTracks().forEach((t) => t.stop());
			stream = null;
			if (blob.size === 0) {
				error = 'Enregistrement vide. Réessaie.';
				phase = 'idle';
				return;
			}
			if (blobUrl) URL.revokeObjectURL(blobUrl);
			blobUrl = URL.createObjectURL(blob);
			blobDur = elapsedMs;
			phase = 'ready';
			onDone({ blob, mime: mimeType, durationMs: blobDur });
		};
		rec.start();
		phase = 'rec';
		startAt = Date.now();
		elapsedMs = 0;
		timer = setInterval(() => {
			elapsedMs = Date.now() - startAt;
			if (elapsedMs >= MAX_REC_MS) stop();
		}, 500);
	}

	function stop() {
		if (timer) clearInterval(timer);
		if (rec && rec.state !== 'inactive') rec.stop();
	}

	function reset() {
		if (timer) clearInterval(timer);
		if (rec && rec.state === 'recording') {
			try {
				rec.stop();
			} catch {
				/* ignore */
			}
		}
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		if (blobUrl) URL.revokeObjectURL(blobUrl);
		blobUrl = null;
		rec = null;
		phase = 'idle';
		elapsedMs = 0;
		error = '';
	}
</script>

<div class="rounded-xl border border-line bg-white p-3">
	{#if error}
		<p class="mb-2 text-xs font-semibold text-danger">{error}</p>
	{/if}

	{#if phase === 'idle'}
		<button
			type="button"
			onclick={start}
			disabled={busy}
			class="flex items-center gap-2 rounded-xl bg-brand-light px-3 py-2 text-sm font-bold text-brand-dark transition hover:bg-brand/20 disabled:opacity-60"
		>
			<span class="text-base">🎙️</span> Enregistrer un audio
		</button>
	{:else if phase === 'rec'}
		<div class="flex items-center gap-3">
			<span class="grid h-9 w-9 place-items-center rounded-full bg-danger text-white">●</span>
			<span class="font-mono text-sm font-semibold tabular-nums text-ink">{fmtSec(elapsedMs / 1000)}</span>
			<button type="button" onclick={stop} class="ml-auto rounded-xl bg-danger px-4 py-2 text-sm font-bold text-white transition hover:opacity-90">
				⏹ Arrêter
			</button>
		</div>
		<p class="mt-2 text-[11px] text-mist">Parle naturellement — arrêt automatique à 10 min. Rien n'est publié tant que tu n'as pas validé.</p>
	{:else}
		<div class="space-y-2">
			<div class="flex items-center gap-2 text-xs font-semibold text-ink">
				<span>▶ {fmtSec(blobDur / 1000)}</span>
				<span class="font-normal text-mist">— réécoute avant publication :</span>
			</div>
			{#if blobUrl}
				<audio controls src={blobUrl} preload="metadata" class="w-full" style="height:36px"></audio>
			{/if}
			<div class="flex flex-wrap gap-2">
				<button type="button" onclick={start} disabled={busy} class="rounded-xl border-2 border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand disabled:opacity-60">
					🔁 Recommencer
				</button>
				<button type="button" onclick={reset} class="rounded-xl border-2 border-danger/40 px-3 py-1.5 text-sm font-semibold text-danger transition hover:bg-danger/10">
					🗑 Supprimer
				</button>
				{#if busy}
					<span class="text-xs font-semibold text-mist">Envoi…</span>
				{/if}
			</div>
		</div>
	{/if}
</div>
