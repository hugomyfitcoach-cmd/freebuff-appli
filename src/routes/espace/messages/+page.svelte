<script lang="ts">
	import AudioPlayer from '$lib/components/AudioPlayer.svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { fmtMs } from '$lib/media';

	let { data } = $props();

	type Msg = {
		publishedAt: number;
		publishedDay: string;
		text: string | null;
		readAt: number | null;
		audio: { mediaId: string; durationMs: number | null; url: string } | null;
	};
	const messages = $derived<Msg[]>((data.messages ?? []) as Msg[]);

	function dayLabel(iso: string): string {
		const d = new Date(iso + 'T12:00:00');
		const today = new Date();
		const base = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
		if (iso === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`) {
			return `Aujourd'hui`;
		}
		return base.replace(/^./, (c) => c.toUpperCase());
	}
	function timeLabel(ts: number): string {
		return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}

	async function listen(mediaId: string) {
		try {
			await fetch('/api/media/listen', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaId }),
			});
		} catch {
			/* silencieux */
		}
	}
</script>

<svelte:head><title>Messages — G-Flux</title></svelte:head>

<BackToHome label="Messages" />

<header class="mb-5 flex items-end justify-between gap-3">
	<div>
		<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
			<Icon name="messageCircle" size={22} class="shrink-0 text-brand" /> Messages
		</h1>
		<p class="mt-1 text-sm text-mist">Les messages de ton coach, texte et audio, conservés ici.</p>
	</div>
</header>

{#if messages.length === 0}
	<div class="rounded-3xl border border-dashed border-line bg-card px-6 py-14 text-center">
		<p class="grid place-items-center"><Icon name="messageCircle" size={30} class="text-mist" /></p>
		<p class="mt-3 text-sm font-semibold text-ink">Aucun message pour l'instant</p>
		<p class="mx-auto mt-1 max-w-xs text-sm text-mist">Quand ton coach t'écrira un message (texte ou audio), tu le retrouveras ici, même après l'avoir lu.</p>
	</div>
{:else}
	<div class="space-y-3">
		{#each messages as msg (msg.publishedAt)}
			{@const isUnread = msg.readAt == null}
			<article
				class="overflow-hidden rounded-3xl border bg-card shadow-sm transition {isUnread
					? 'border-brand/50 ring-1 ring-brand/30'
					: 'border-line'}"
			>
				<div class="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
					<div class="flex items-center gap-2">
						<p class="text-sm font-bold text-ink">{dayLabel(msg.publishedDay)}</p>
						<span class="text-[11px] text-mist">· {timeLabel(msg.publishedAt)}</span>
					</div>
					{#if isUnread}
						<span class="rounded-full bg-warn px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Non lu</span>
					{:else}
						<span class="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-dark"><Icon name="check" size={10} class="shrink-0" /> Lu</span>
					{/if}
				</div>

				<div class="px-5 py-4">
					{#if msg.text}
						<p class="whitespace-pre-line text-[15px] leading-relaxed text-ink">{msg.text}</p>
					{/if}
					{#if msg.audio}
						<div class="{msg.text ? 'mt-3' : ''} rounded-2xl border border-line bg-cream/40 p-3">
							<p class="mb-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-ink"><Icon name="mic" size={13} /> Message audio · {fmtMs(msg.audio.durationMs)}</p>
							<AudioPlayer src={msg.audio.url} durationMs={msg.audio.durationMs} onFirstPlay={() => listen(msg.audio?.mediaId ?? '')} />
						</div>
					{/if}
				</div>
			</article>
		{/each}
	</div>
{/if}

<p class="mt-6 text-center text-[11px] text-mist">Les messages du jour sont éphémères sur l'Accueil, mais restent consultables ici.</p>
