<script lang="ts">
	/**
	 * Média d'un exercice — composant UNIQUE de rendu média (toutes sources).
	 *
	 * Reçoit une représentation média NORMALISÉE (src/lib/media/exerciseMedia.ts)
	 * et choisit le renderer : vidéo bouclée (animation.mp4 G-FLUX) ou image
	 * (GIF ExerciseDB, poster legacy). L'expérience est visuellement homogène :
	 * un « GIF premium » sans contrôles natifs, sans bouton play, sans son.
	 *
	 * PERFORMANCE (bibliothèque à plusieurs centaines d'exercices) :
	 *  - images : `loading="lazy"` ;
	 *  - vidéos : IntersectionObserver — la carte hors écran ne télécharge
	 *    que les métadonnées (`preload="metadata"`), la lecture ne démarre
	 *    QUE quand la carte entre dans la zone visible (+150 px de marge),
	 *    et la vidéo est mise en PAUSE dès qu'elle en sort. Économie de
	 *    bande passante, mémoire et batterie — iPhone / Safari / PWA inclus ;
	 *  - muted + playsinline + loop : lecture automatique autorisée sur
	 *    iOS/Safari, jamais de son, jamais d'interface de lecteur.
	 *
	 * Fallback propre : si la source principale échoue (404/réseau), on tente
	 * l'URL de secours normalisée (ex. poster legacy), puis l'état discret
	 * « Média indisponible » — affiché UNIQUEMENT quand aucune source valide
	 * n'existe réellement.
	 */
	import { normalizeExerciseMedia, type ExerciseMediaInput } from '$lib/media/exerciseMedia';
	import Icon from '$lib/components/Icon.svelte';

	let {
		media,
		alt = '',
		loading = 'lazy',
		aspect = 'auto',
		class: klass = ''
	}: {
		/** Exercice (champs médias bruts) ou média déjà normalisé — la normalisation est idempotente. */
		media?: ExerciseMediaInput;
		alt?: string;
		loading?: 'eager' | 'lazy';
		/** 'square' = cadre carré auto-portant (fiche détail) ; 'auto' = remplit le parent. */
		aspect?: 'auto' | 'square';
		class?: string;
	} = $props();

	const m = $derived(normalizeExerciseMedia(media));

	// Étage courant : source principale → secours → indisponible.
	// Réinitialisé quand les médias de l'exercice changent (synchro à chaud).
	let stage = $state<'media' | 'fallback' | 'unavailable'>('media');
	let signature = $state('');
	$effect(() => {
		const sig = `${m.src ?? ''}|${m.fallbackSrc ?? ''}`;
		if (sig !== signature) {
			signature = sig;
			stage = m.available ? 'media' : 'unavailable';
		}
	});

	const currentSrc = $derived(stage === 'fallback' ? m.fallbackSrc : m.src);
	const currentKind = $derived(stage === 'fallback' ? m.fallbackKind : m.kind);
	const unavailable = $derived(
		!m.src || stage === 'unavailable' || (stage === 'fallback' && !m.fallbackSrc)
	);

	function onFail() {
		if (stage === 'media' && m.fallbackSrc && m.fallbackSrc !== m.src) stage = 'fallback';
		else stage = 'unavailable';
	}

	/* ── Lecture au scroll (vidéos uniquement) ── */
	let container = $state<HTMLElement | undefined>(undefined);
	let videoEl = $state<HTMLVideoElement | undefined>(undefined);
	let inView = $state(false);

	$effect(() => {
		if (currentKind !== 'video') return;
		const el = container;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => {
				inView = entries.some((e) => e.isIntersecting);
			},
			{ rootMargin: '150px' }
		);
		io.observe(el);
		return () => io.disconnect();
	});

	$effect(() => {
		const v = videoEl;
		if (!v) return;
		if (inView) v.play().catch(() => {});
		else v.pause();
	});
</script>

{#if unavailable}
	<div class="flex h-full w-full flex-col items-center justify-center gap-1 bg-line/30 text-mist {klass}">
		<Icon name="dumbbell" size={22} class="opacity-60" />
		<span class="px-1 text-center text-[10px] leading-tight opacity-80">Média indisponible</span>
	</div>
{:else}
	<div
		bind:this={container}
		class="{aspect === 'square' ? 'aspect-square w-full overflow-hidden' : 'h-full w-full'} {klass}"
	>
		{#if currentKind === 'video' && currentSrc}
			<!-- Animation G-FLUX (MP4) — « GIF premium » : boucle silencieuse, sans contrôles. -->
			<video
				bind:this={videoEl}
				src={currentSrc}
				aria-label={alt}
				class="h-full w-full object-cover"
				muted
				loop
				playsinline
				autoplay
				preload="metadata"
				onerror={onFail}
			></video>
		{:else if currentSrc}
			<img src={currentSrc} {alt} {loading} class="h-full w-full object-cover" onerror={onFail} />
		{/if}
	</div>
{/if}
