<script lang="ts">
	import { fmtSec } from '../media.js';

	/**
	 * Lecteur audio compact réutilisable (cliente + CRM) : play/pause,
	 * progression, durée, vitesses 1×/1.25×/1.5×. `onFirstPlay` est appelé une
	 * seule fois, à la première lecture réelle (marquage « première écoute »).
	 */
	let {
		src,
		durationMs = null,
		onFirstPlay,
		accent = 'brand',
	}: {
		src: string;
		durationMs?: number | null;
		onFirstPlay?: () => void;
		accent?: 'brand' | 'ink';
	} = $props();

	let audio = $state<HTMLAudioElement | null>(null);
	let playing = $state(false);
	let current = $state(0);
	let dur = $state(0);
	let rate = $state(1);
	let marked = $state(false);

	const total = $derived(dur > 0 ? dur : (durationMs ?? 0) / 1000);

	async function toggle() {
		if (!audio) return;
		if (audio.paused) {
			try {
				if (audio.readyState < 1) audio.load();
				await audio.play();
			} catch {
				/* lecture bloquée : silencieux */
			}
		} else {
			audio.pause();
		}
	}

	function onPlay() {
		playing = true;
		if (!marked) {
			marked = true;
			onFirstPlay?.();
		}
	}
	function onPause() {
		playing = false;
	}
	function onTime() {
		if (audio) current = audio.currentTime;
	}
	function onMeta() {
		if (audio && isFinite(audio.duration)) dur = audio.duration;
	}
	function seek(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value);
		current = v;
		if (audio) audio.currentTime = v;
	}
	function setRate(r: number) {
		rate = r;
		if (audio) audio.playbackRate = r;
	}
</script>

<audio
	bind:this={audio}
	src={src}
	preload="metadata"
	onplay={onPlay}
	onpause={onPause}
	onended={onPause}
	ontimeupdate={onTime}
	onloadedmetadata={onMeta}
	oncanplay={() => (dur = dur || audio?.duration || 0)}
	class="hidden"
></audio>

<div class="flex items-center gap-2">
	<button
		type="button"
		onclick={toggle}
		aria-label={playing ? 'Pause' : 'Écouter'}
		class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition hover:opacity-90 {accent === 'brand' ? 'bg-brand' : 'bg-ink'}"
	>
		{playing ? '⏸' : '▶'}
	</button>
	<div class="min-w-0 flex-1">
		<input
			type="range"
			min="0"
			max={total || 1}
			step="0.1"
			value={current}
			oninput={seek}
			aria-label="Progression"
			class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand"
		/>
		<div class="mt-0.5 flex items-center justify-between text-[11px] text-mist">
			<span>{fmtSec(current)} / {fmtSec(total)}</span>
			<span class="flex items-center gap-1">
				{#each [1, 1.25, 1.5] as r (r)}
					<button
						type="button"
						onclick={() => setRate(r)}
						class="rounded px-1 py-px font-semibold transition {rate === r ? 'bg-brand-light text-brand-dark' : 'text-mist hover:text-ink'}"
					>{r === 1 ? '1×' : `${r}×`}</button>
				{/each}
			</span>
		</div>
	</div>
</div>
