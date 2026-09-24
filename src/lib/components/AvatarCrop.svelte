<script lang="ts">
	/**
	 * Recadrage AVATAR — rond visible, repositionnable et zoomable.
	 *
	 * Après sélection d'une photo de profil, la cliente voit EXACTEMENT le
	 * cercle qui sera envoyé : glisser pour recentrer, slider pour zoomer.
	 * Simple et fluide sur iPhone (pointer events, aucun recadrage serveur :
	 * le serveur reçoit déjà l'image carrée finale).
	 *
	 * Export : `getCroppedBlob()` — JPEG carré (le cercle inscrit), prêt pour
	 * le BFF /api/profile/photo.
	 */
	import { loadImageElement } from '$lib/media';

	let { file, oncancel, onsaved }: { file: File; oncancel: () => void; onsaved: (url: string) => void } = $props();

	const VIEW = 264; // côté de la zone d'aperçu (px)
	const ZOOM_MAX = 5;
	/** Zoom : 1 = l'image couvre tout juste le carré (jamais de vide),
	 * quelle que soit sa taille source (grande photo iPhone ou petite image). */
	let zoom = $state(1);
	let img: HTMLImageElement | null = null;
	let imgReady = $state(false);
	let imgError = $state(false);
	/** Centre de l'image (px écran, relatif au carré d'aperçu). */
	let cx = $state(VIEW / 2);
	let cy = $state(VIEW / 2);
	let imgW = $state(0);
	let imgH = $state(0);
	let saving = $state(false);
	let savingError = $state('');

	/** Échelle d'affichage : zoom 1 ⇒ le plus petit côté = VIEW (couverture garantie). */
	const baseScale = $derived(imgW && imgH ? VIEW / Math.min(imgW, imgH) : 1);
	const scale = $derived(baseScale * zoom);
	const dispW = $derived(imgW * scale);
	const dispH = $derived(imgH * scale);
	const halfW = $derived(dispW / 2);
	const halfH = $derived(dispH / 2);
	/** Bornes de glissement : l'image couvre toujours tout le carré. */
	const minCx = $derived(Math.min(VIEW / 2, halfW));
	const maxCx = $derived(Math.max(VIEW / 2, VIEW - halfW));
	const minCy = $derived(Math.min(VIEW / 2, halfH));
	const maxCy = $derived(Math.max(VIEW / 2, VIEW - halfH));

	$effect(() => {
		loadImageElement(file)
			.then((image) => {
				img = image;
				imgW = image.naturalWidth || 1;
				imgH = image.naturalHeight || 1;
				imgReady = true;
			})
			.catch(() => {
				imgError = true;
			});
		return () => {
			img = null;
		};
	});

	/* Glisser pour repositionner (Pointer Events — couvre tactile + souris). */
	let dragging = false;
	let px = 0;
	let py = 0;
	function clampPos() {
		cx = Math.min(maxCx, Math.max(minCx, cx));
		cy = Math.min(maxCy, Math.max(minCy, cy));
	}
	function onDown(e: PointerEvent) {
		if (!imgReady) return;
		dragging = true;
		px = e.clientX - cx;
		py = e.clientY - cy;
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}
	function onMove(e: PointerEvent) {
		if (!dragging) return;
		cx = e.clientX - px;
		cy = e.clientY - py;
		clampPos();
	}
	function onUp() {
		dragging = false;
	}
	/** Double-clic / double-tap : recentrer. */
	function recenter() {
		cx = VIEW / 2;
		cy = VIEW / 2;
		zoom = 1;
	}

	/** Rend le JPEG carré (le cercle inscrit) : aperçu = résultat exact. */
	async function getCroppedBlob(): Promise<Blob> {
		if (!img) throw new Error('no-image');
		// GÉOMÉTRIE — l'image est affichée à l'échelle `scale` avec son coin
		// supérieur gauche à (cx − halfW, cy − halfH) dans le carré d'aperçu.
		// Le point d'écran x correspond au point source (x − (cx − halfW))/scale :
		// le bord gauche du carré (x = 0) ⇒ coin source (halfW − cx)/scale. ✓
		const srcSize = Math.max(1, Math.min(imgW, imgH) / zoom); // = VIEW / scale
		const sx = (halfW - cx) / scale;
		const sy = (halfH - cy) / scale;
		const canvas = document.createElement('canvas');
		const out = Math.min(1024, Math.max(256, Math.round(srcSize))); // sortie carrée raisonnable
		canvas.width = out;
		canvas.height = out;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('canvas');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(
			img,
			Math.max(0, Math.min(Math.max(0, imgW - srcSize), sx)),
			Math.max(0, Math.min(Math.max(0, imgH - srcSize), sy)),
			Math.min(srcSize, imgW),
			Math.min(srcSize, imgH),
			0,
			0,
			out,
			out
		);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
		if (!blob) throw new Error('encode');
		return blob;
	}

	async function confirm() {
		if (!imgReady || saving) return;
		saving = true;
		savingError = '';
		try {
			const blob = await getCroppedBlob();
			const cropped = new File([blob], 'profil.jpg', { type: 'image/jpeg' });
			const fd = new FormData();
			fd.append('photo', cropped);
			const res = await fetch('/api/profile/photo', { method: 'POST', body: fd });
			const data = res.ok ? ((await res.json()) as { url?: string | null }) : null;
			if (data?.url) {
				onsaved(data.url);
			} else {
				const j = res.ok ? null : await res.json().catch(() => null);
				savingError = (j as { error?: string } | null)?.error ?? "Impossible d'enregistrer la photo. Réessaie.";
			}
		} catch {
			savingError = "Impossible d'enregistrer la photo. Réessaie.";
		} finally {
			saving = false;
		}
	}
</script>

<div class="fixed inset-0 z-[70] flex flex-col bg-ink/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Cadrer ma photo">
	<div class="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-4">
		<h2 class="mb-4 text-center font-display text-lg font-bold text-white">Cadrer ma photo</h2>
		{#if imgError}
			<p class="rounded-xl bg-white/90 p-4 text-center text-sm font-semibold text-ink">
				Cette image n'a pas pu être chargée. Essaie une autre photo.
			</p>
			<button type="button" onclick={oncancel} class="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-bold text-ink">Retour</button>
		{:else}
			<div class="mx-auto" style:width="{VIEW}px" style:height="{VIEW}px">
				<div
					class="relative touch-none select-none overflow-hidden rounded-2xl bg-ink"
					style:width="{VIEW}px"
					style:height="{VIEW}px"
					onpointerdown={onDown}
					onpointermove={onMove}
					onpointerup={onUp}
					onpointercancel={onUp}
					ondblclick={recenter}
					role="img"
					aria-label="Zone de cadrage — glisse pour positionner ton visage dans le cercle"
				>
					{#if img && imgReady}
						<img
							src={img.src}
							alt=""
							draggable="false"
							class="pointer-events-none absolute origin-top-left"
							style:width="{dispW}px"
							style:height="{dispH}px"
							style:left="{cx - halfW}px"
							style:top="{cy - halfH}px"
						/>
					{:else}
						<div class="grid h-full place-items-center text-sm text-white/70">Chargement…</div>
					{/if}
					<!-- Rond visible : voile au-dehors, cercle limpide au-dedans -->
					<div
						class="pointer-events-none absolute inset-0"
						style="background: radial-gradient(circle at center, transparent 0, transparent {VIEW / 2 - 1.5}px, rgba(0,0,0,.55) {VIEW / 2 - 0.5}px);"
					></div>
					<div class="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/90"></div>
				</div>
			</div>
			<p class="mt-3 text-center text-xs text-white/80">Glisse la photo et zoome : le cercle montre l'aperçu exact.</p>
			<div class="mt-3 flex items-center gap-3 px-2">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0 text-white/80"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /><path d="M8 11h6" /></svg>
				<input
					type="range"
					min="1"
					max={ZOOM_MAX}
					step="0.01"
					bind:value={zoom}
					oninput={clampPos}
					class="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/30 accent-white"
					aria-label="Zoom"
				/>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0 text-white/80"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /><path d="M8 11h6M11 8v6" /></svg>
			</div>
			{#if savingError}
				<p class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-center text-xs font-semibold text-danger">{savingError}</p>
			{/if}
			<div class="mt-4 flex gap-3">
				<button type="button" onclick={oncancel} disabled={saving} class="flex-1 rounded-xl border-2 border-white/40 px-4 py-3 text-sm font-bold text-white transition active:scale-[.98] disabled:opacity-60">Annuler</button>
				<button type="button" onclick={confirm} disabled={saving || !imgReady} class="flex-1 rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition active:scale-[.98] disabled:opacity-60">
					{saving ? 'Enregistrement…' : 'Utiliser cette photo'}
				</button>
			</div>
		{/if}
	</div>
</div>
