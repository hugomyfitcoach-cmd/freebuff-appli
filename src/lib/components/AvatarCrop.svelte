<script lang="ts">
	/**
	 * Recadrage AVATAR — modal fixe centrée, rond visible, pan/zoom au doigt.
	 *
	 * iPhone d'abord :
	 *  - modal `position: fixed` PLEIN ÉCRAN, centrée verticalement, avec
	 *    safe-area (encoche + barre home) — indépendante du scroll de la page.
	 *    NB : ce composant doit être monté HORS du <header backdrop-blur>
	 *    d'AppShell (un backdrop-filter fait du header le « containing block »
	 *    des position:fixed descendants → modal coincée en haut sur iPhone) ;
	 *  - PAN tactile : Touch Events NON PASSIFS (preventDefault) + bornes
	 *    anti-zone-vide — l'image couvre toujours tout le carré, le glisser
	 *    4 directions fonctionne, le zoom est conservé, 2 doigts = pinch ;
	 *  - export = aperçu exact : le JPEG est le carré inscrit dans le cercle,
	 *    calculé avec le MÊME repère que l'affichage (scale + cx + cy).
	 */
	import { loadImageElement } from '$lib/media';

	let { file, oncancel, onsaved }: { file: File; oncancel: () => void; onsaved: (url: string) => void } = $props();

	/** Côté de la zone d'aperçu : s'adapte aux petits écrans, modal compacte
	 *  (jamais plus haute que l'écran iPhone, y compris avec clavier). */
	const VIEW = $state(
		typeof document !== 'undefined' ? Math.max(200, Math.min(280, Math.floor(window.innerWidth) - 96)) : 248
	);
	const ZOOM_MAX = 5;
	/** Zoom : 1 = l'image couvre tout juste le carré (jamais de vide). */
	let zoom = $state(1);
	let img: HTMLImageElement | null = null;
	let imgW = $state(0);
	let imgH = $state(0);
	let loadState = $state<'loading' | 'ready' | 'error'>('loading');
	let saving = $state(false);
	let savingError = $state('');

	/** Échelle d'affichage : zoom 1 ⇒ le plus petit côté = VIEW (couverture garantie). */
	const baseScale = $derived(imgW && imgH ? VIEW / Math.min(imgW, imgH) : 1);
	const scale = $derived(baseScale * zoom);
	const dispW = $derived(imgW * scale);
	const dispH = $derived(imgH * scale);
	const halfW = $derived(dispW / 2);
	const halfH = $derived(dispH / 2);

	/** Centre de l'image (px écran, relatif au carré d'aperçu). */
	let cx = $state(VIEW / 2);
	let cy = $state(VIEW / 2);

	/**
	 * Bornes ANTI-ZONE-VIDE — l'image couvre TOUJOURS tout le carré :
	 *   bord gauche ≤ 0   ⇒ cx ≤ halfW ;
	 *   bord droit  ≥ VIEW ⇒ cx ≥ VIEW − halfW.
	 * (L'ancien clamp était inversé — min(VIEW/2, halfW) — et verrouillait
	 *  cx/cy au centre : le pan était annulé à chaque mouvement.)
	 */
	function clampPos() {
		if (dispW <= VIEW) cx = VIEW / 2;
		else cx = Math.min(halfW, Math.max(VIEW - halfW, cx));
		if (dispH <= VIEW) cy = VIEW / 2;
		else cy = Math.min(halfH, Math.max(VIEW - halfH, cy));
	}

	/* ————— Chargement robuste : objectURL → timeout → dataURL → erreur ————— */
	let currentUrl: string | null = null; // objectURL détenue (révoquée au démontage)
	let loadTimer: ReturnType<typeof setTimeout> | null = null;
	let attempt = 0;

	function clearTimer() {
		if (loadTimer) {
			clearTimeout(loadTimer);
			loadTimer = null;
		}
	}
	function revokeUrl() {
		if (currentUrl) {
			try {
				URL.revokeObjectURL(currentUrl);
			} catch {
				/* déjà révoquée */
			}
			currentUrl = null;
		}
	}
	function fileToDataUrl(f: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(String(r.result));
			r.onerror = () => reject(new Error('format-image'));
			r.readAsDataURL(f);
		});
	}

	/**
	 * Grosses photos iPhone (4032 px et +) : pré-redimensionnement à 3000 px
	 * max AVANT le recadrage — limite la mémoire des canvas sur iOS et rend
	 * le glisser plus fluide. L'orientation EXIF est déjà appliquée par le
	 * navigateur au rendu de l'<img> (Safari 13.1+, comportement standard).
	 */
	async function downscaleHuge(image: HTMLImageElement): Promise<HTMLImageElement> {
		const max = Math.max(image.naturalWidth, image.naturalHeight);
		if (max <= 3500) return image;
		const k = 3000 / max;
		const w = Math.max(1, Math.round(image.naturalWidth * k));
		const h = Math.max(1, Math.round(image.naturalHeight * k));
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const ctx = c.getContext('2d');
		if (!ctx) return image;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(image, 0, 0, w, h);
		const url = c.toDataURL('image/jpeg', 0.92);
		return await loadImageElement(url); // dataURL : aucun souci de révocation
	}

	async function load(mode: 'url' | 'dataurl', f: File | Blob, my: number) {
		loadState = 'loading';
		clearTimer();
		if (mode === 'url') revokeUrl();
		// Filet anti-blocage : si le décodage n'aboutit pas, on retente une
		// fois en dataURL (décodage garanti sur Safari) puis on affiche une
		// erreur douce. AUCUNE boucle infinie : le compteur `attempt` invalide
		// toute tentative périmée.
		loadTimer = setTimeout(() => {
			if (my !== attempt || loadState === 'ready') return;
			if (mode === 'url') void load('dataurl', f, my);
			else loadState = 'error';
		}, mode === 'url' ? 8000 : 12000);
		try {
			let src: string;
			if (mode === 'url') {
				currentUrl = URL.createObjectURL(f);
				src = currentUrl;
			} else {
				src = await fileToDataUrl(f);
			}
			const image = await loadImageElement(src);
			if (my !== attempt) return; // tentative périmée (annulation / nouvelle photo)
			const normalized = await downscaleHuge(image).catch(() => image);
			if (my !== attempt) return;
			clearTimer();
			img = normalized;
			imgW = image.naturalWidth || 1;
			imgH = image.naturalHeight || 1;
			cx = VIEW / 2;
			cy = VIEW / 2;
			zoom = 1;
			loadState = 'ready';
		} catch {
			if (my !== attempt) return;
			if (mode === 'url') {
				void load('dataurl', f, my); // repli immédiat : décodage garanti
			} else {
				loadState = 'error';
			}
		}
	}

	$effect(() => {
		const f = file;
		const my = ++attempt;
		if (f) void load('url', f, my);
		return () => {
			attempt++; // invalide les tentatives en vol
			clearTimer();
			revokeUrl();
			img = null;
		};
	});

	/* ————— PAN tactile — Safari iOS d'abord —————
	 * Touch Events avec { passive: false } : preventDefault() doit pouvoir
	 * empêcher la page de scroller/rubber-bander sous le doigt. Pointer
	 * Events (souris uniquement) pour le desktop. Deux doigts = pincement.
	 * Le delta est RELATIF (clientX − ancre) : le décalage du conteneur
	 * s'annule, aucun besoin de getBoundingClientRect. */
	let dragging = false;
	let pinching = false;
	let px = 0;
	let py = 0;
	let pinchDist = 0;
	let pinchZoom = 1;
	let lastTapAt = 0;

	function anchor(x: number, y: number) {
		px = x - cx;
		py = y - cy;
	}
	function touchSpan(t: TouchList): number {
		return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
	}
	function touchMid(t: TouchList): { x: number; y: number } {
		return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
	}
	/** Double-clic / double-tap : recentrer. */
	function recenter() {
		cx = VIEW / 2;
		cy = VIEW / 2;
		zoom = 1;
	}

	function panSurface(node: HTMLElement) {
		function onTouchStart(e: TouchEvent) {
			if (loadState !== 'ready') return;
			if (e.touches.length === 1) {
				const now = Date.now();
				if (now - lastTapAt < 320) {
					recenter(); // double-tap
					dragging = false;
					lastTapAt = 0;
					e.preventDefault();
					return;
				}
				lastTapAt = now;
				dragging = true;
				pinching = false;
				anchor(e.touches[0].clientX, e.touches[0].clientY);
			} else if (e.touches.length === 2) {
				dragging = true;
				pinching = true;
				pinchDist = touchSpan(e.touches);
				pinchZoom = zoom; // le zoom courant est conservé comme base
				const m = touchMid(e.touches);
				anchor(m.x, m.y);
			}
			e.preventDefault(); // JAMAIS de scroll de page pendant le cadrage
		}
		function onTouchMove(e: TouchEvent) {
			if (!dragging) return;
			if (pinching && e.touches.length >= 2) {
				if (pinchDist > 0) {
					zoom = Math.min(ZOOM_MAX, Math.max(1, pinchZoom * (touchSpan(e.touches) / pinchDist)));
				}
				const m = touchMid(e.touches);
				cx = m.x - px;
				cy = m.y - py;
			} else if (e.touches.length === 1 && !pinching) {
				cx = e.touches[0].clientX - px;
				cy = e.touches[0].clientY - py;
			} else {
				return;
			}
			clampPos(); // bornes anti-zone-vide appliquées à CHAQUE frame
			e.preventDefault();
		}
		function onTouchEnd(e: TouchEvent) {
			if (e.touches.length === 0) {
				dragging = false;
				pinching = false;
			} else if (e.touches.length === 1 && pinching) {
				// Pincement terminé : on repart du doigt restant sans à-coup.
				pinching = false;
				anchor(e.touches[0].clientX, e.touches[0].clientY);
			}
		}
		function onPointerDown(e: PointerEvent) {
			// Souris uniquement : le tactile passe par Touch Events (plus fiable
			// sur iOS — pointer capture y est capricieux).
			if (e.pointerType !== 'mouse' || loadState !== 'ready') return;
			dragging = true;
			pinching = false;
			anchor(e.clientX, e.clientY);
			node.setPointerCapture?.(e.pointerId);
		}
		function onPointerMove(e: PointerEvent) {
			if (!dragging || pinching || e.pointerType !== 'mouse') return;
			cx = e.clientX - px;
			cy = e.clientY - py;
			clampPos();
		}
		function onPointerUp(e: PointerEvent) {
			if (e.pointerType !== 'mouse') return;
			dragging = false;
			if (node.hasPointerCapture?.(e.pointerId)) node.releasePointerCapture(e.pointerId);
		}
		node.addEventListener('touchstart', onTouchStart, { passive: false });
		node.addEventListener('touchmove', onTouchMove, { passive: false });
		node.addEventListener('touchend', onTouchEnd);
		node.addEventListener('touchcancel', onTouchEnd);
		node.addEventListener('pointerdown', onPointerDown);
		node.addEventListener('pointermove', onPointerMove);
		node.addEventListener('pointerup', onPointerUp);
		node.addEventListener('pointercancel', onPointerUp);
		node.addEventListener('dblclick', recenter);
		return {
			destroy() {
				node.removeEventListener('touchstart', onTouchStart);
				node.removeEventListener('touchmove', onTouchMove);
				node.removeEventListener('touchend', onTouchEnd);
				node.removeEventListener('touchcancel', onTouchEnd);
				node.removeEventListener('pointerdown', onPointerDown);
				node.removeEventListener('pointermove', onPointerMove);
				node.removeEventListener('pointerup', onPointerUp);
				node.removeEventListener('pointercancel', onPointerUp);
				node.removeEventListener('dblclick', recenter);
			}
		};
	}

	/** × / Annuler / Échap : fermeture immédiate, AUCUN upload. */
	function close() {
		if (!saving) oncancel();
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	/** Zoom contrôlé : applique la valeur PUIS recale le cadre (pas de frame avec vide). */
	function onZoomInput(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value);
		zoom = Math.min(ZOOM_MAX, Math.max(1, v));
		clampPos();
	}

	$effect(() => {
		// Verrouille le scroll de la page tant que la modal est ouverte.
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	});

	/** Rend le JPEG carré (le cercle inscrit) : aperçu = résultat exact. */
	async function getCroppedBlob(): Promise<Blob> {
		if (!img) throw new Error('no-image');
		// GÉOMÉTRIE — l'image est affichée à l'échelle `scale`, coin supérieur
		// gauche à (cx − halfW, cy − halfH). Le bord gauche du carré (x = 0)
		// correspond au point source (halfW − cx)/scale ; côté = VIEW/scale.
		// MÊME repère que l'affichage : scale + cx + cy, rien d'autre.
		const srcSize = Math.max(1, Math.min(imgW, imgH) / zoom); // = VIEW / scale
		const sx = (halfW - cx) / scale;
		const sy = (halfH - cy) / scale;
		const canvas = document.createElement('canvas');
		const out = Math.min(1024, Math.max(256, Math.round(srcSize)));
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
		if (loadState !== 'ready' || saving) return;
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

<svelte:window onkeydown={onKeydown} />

<!-- Modal FIXE plein écran : centrée dans le viewport (dvh), padding
     safe-area iOS, indépendante du scroll de la page derrière. -->
<div
	class="fixed inset-0 z-[80] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
	aria-label="Cadrer ma photo"
	style="padding-top:calc(env(safe-area-inset-top) + 1rem);padding-bottom:calc(env(safe-area-inset-bottom) + 1rem)"
>
	<!-- Carte centrée : jamais plus haute que la modal (max-h-full), jamais coupée. -->
	<div class="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-card shadow-2xl shadow-ink/30">
		<!-- En-tête : titre + fermeture × (immédiate, aucun upload) -->
		<div class="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
			<h2 class="font-display text-base font-bold text-ink">Cadrer ma photo</h2>
			<button
				type="button"
				onclick={close}
				class="grid h-9 w-9 place-items-center rounded-full text-mist transition hover:bg-soft active:scale-95"
				aria-label="Fermer"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
			</button>
		</div>

		<!-- Aperçu + zoom : seule zone scrollable si l'écran est très court. -->
		<div class="flex min-h-0 flex-col items-center gap-2.5 overflow-y-auto overscroll-contain px-4 pb-3 pt-3">
			<div class="relative shrink-0 overflow-hidden rounded-2xl bg-ink" style:width="{VIEW}px" style:height="{VIEW}px">
				{#if loadState === 'ready' && img}
					<!-- Surface de PAN : Touch Events non passifs (action) + souris.
					     touch-action:none ⇒ iOS ne détourne pas le doigt pour scroller. -->
					<div
						use:panSurface
						class="absolute inset-0 touch-none select-none"
						role="img"
						aria-label="Zone de cadrage — glisse pour positionner ton visage dans le cercle"
					>
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
					</div>
				{:else if loadState === 'loading'}
					<div class="grid h-full w-full place-items-center">
						<span class="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white"></span>
					</div>
				{:else}
					<div class="grid h-full w-full place-items-center px-6 text-center text-sm font-semibold text-white/85">
						Cette photo n'a pas pu être chargée. Réessaie avec une autre image.
					</div>
				{/if}
				<!-- Rond de cadrage : voile au-dehors, cercle net au-dedans -->
				<div
					class="pointer-events-none absolute inset-0"
					style="background: radial-gradient(circle at center, transparent 0, transparent {VIEW / 2 - 1.5}px, rgba(0,0,0,.55) {VIEW / 2 - 0.5}px);"
				></div>
				<div class="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/90"></div>
			</div>

			{#if loadState === 'ready'}
				<div class="flex w-full items-center gap-3 px-1">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0 text-mist"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /><path d="M8 11h6" /></svg>
					<input
						type="range"
						min="1"
						max={ZOOM_MAX}
						step="0.01"
						value={zoom}
						oninput={onZoomInput}
						class="h-2 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand"
						aria-label="Zoom"
					/>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0 text-mist"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /><path d="M8 11h6M11 8v6" /></svg>
				</div>
				<p class="text-center text-xs text-mist">Glisse la photo dans le cercle et zoome — l'aperçu est exact.</p>
			{/if}
			{#if savingError}
				<p class="w-full rounded-xl bg-danger-light px-3 py-2 text-center text-xs font-semibold text-danger">{savingError}</p>
			{/if}
		</div>

		<!-- Actions TOUJOURS visibles (hors zone scrollable, au-dessus de la
		     barre home grâce au padding safe-area de la modal). -->
		<div class="flex shrink-0 w-full gap-3 px-4 pb-4 pt-1">
			<button type="button" onclick={close} disabled={saving} class="flex-1 rounded-xl border-2 border-line px-4 py-3 text-sm font-bold text-ink transition hover:border-mist active:scale-[.98] disabled:opacity-60">Annuler</button>
			<button
				type="button"
				onclick={confirm}
				disabled={saving || loadState !== 'ready'}
				class="flex-[1.4] rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-dark active:scale-[.98] disabled:opacity-60"
			>
				{saving ? 'Enregistrement…' : 'Utiliser cette photo'}
			</button>
		</div>
	</div>
</div>
