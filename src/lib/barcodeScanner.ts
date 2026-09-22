/**
 * Scanner code-barres haute résolution.
 *
 * Pourquoi ce module (au lieu de html5-qrcode) :
 * html5-qrcode décodait uniquement un recadrage de la taille du conteneur CSS
 * (~375 px de large à l'écran). Un code-barres tenu à distance normale occupait
 * donc trop peu de pixels pour être lu — d'où l'obligation de coller le
 * téléphone. Ici on décode l'image CAMÉRA NATIVE (jusqu'à 1280 px de large) :
 *
 *  - BarcodeDetector natif (Chrome / Android / Samsung Internet) : détection en
 *    résolution native, très rapide et longue portée, quasi gratuit en JS.
 *  - Sinon ZXing — le moteur déjà embarqué par html5-qrcode (vendored dans
 *    `html5-qrcode/third_party`) — appliqué au canvas en résolution native.
 *
 * Le décodage couvre TOUTE l'image (pas de recadrage) : le cadre affiché n'est
 * qu'un repère visuel, ce qui rend le scan beaucoup plus tolérant à la
 * distance et à l'alignement.
 */

import type { MediaTrackConstraintSet } from './barcodeTypes';

export type BarcodeScannerHandle = {
	/** Arrête la caméra + le décodage et retire les éléments injectés. */
	stop: () => Promise<void>;
};

/** Capacités utiles du track caméra (lampe/zoom), si supportées. */
export type TorchHandle = {
	toggleTorch: () => Promise<boolean>;
	hasTorch: () => boolean;
	zoom: (factor: number) => Promise<boolean>;
	hasZoom: () => boolean;
	zoomRange: { min: number; max: number; step: number } | null;
};

/**
 * La caméra est refusée / bloquée / absente (permission refusée dans le
 * navigateur, réglage iOS ou Android, aucune caméra dispo). L'appelant
 * affiche alors un message clair + « Réessayer » au lieu du générique
 * « caméra indisponible ». Les autres erreurs restent des Error classiques.
 */
export class CameraPermissionError extends Error {}

/** Vibration légère à la détection (best effort, jamais bloquant). */
function vibrateOk(): void {
	try {
		navigator.vibrate?.(35);
	} catch {
		// pas de vibration (desktop / iOS Safari) : silencieux
	}
}

/**
 * Valide un code lu : EAN-13 / EAN-8 / UPC-A (12, réécrit en 13 avec 0
 * préfixe) — checksum obligatoire. UPC-E (8 avec 0/1 en tête) accepté.
 * Retourne le code normalisé, ou null si le format ne correspond pas
 * (QR, CODE_128 interne, lecture partielle…).
 */
export function normalizeProductCode(raw: string): string | null {
	const digits = (raw ?? '').replace(/\D/g, '');
	if (digits.length === 13) {
		return eanChecksumValid(digits) ? digits : null;
	}
	if (digits.length === 12) {
		// UPC-A ⊂ EAN-13 (préfixe 0).
		const as13 = `0${digits}`;
		return eanChecksumValid(as13) ? as13 : null;
	}
	if (digits.length === 8) {
		// EAN-8 ou UPC-E (préfixe 0/1) — checksum pareil (modulo 10).
		return eanChecksumValid(digits) ? digits : null;
	}
	return null;
}

/** Checksum modulo 10 EAN/UPC (dernier chiffre = clé). */
function eanChecksumValid(d: string): boolean {
	let sum = 0;
	for (let i = 0; i < d.length - 1; i++) {
		const n = Number(d[i]);
		// De droite à gauche, poids alternés 3/1 ; d.length-1-i donne la position.
		sum += n * ((d.length - 1 - i) % 2 === 0 ? 3 : 1);
	}
	return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}

type NativeDetector = {
	detect(source: CanvasImageSource | HTMLVideoElement): Promise<{ rawValue: string }[]>;
};

/* Types minimaux du ZXing vendored dans html5-qrcode (mêmes classes que celles
   que html5-qrcode utilise en interne). */
type ZXing = {
	MultiFormatReader: new (
		verbose: boolean,
		hints: Map<number, unknown>
	) => { decode(binaryBitmap: unknown): { text: string } };
	HTMLCanvasElementLuminanceSource: new (canvas: HTMLCanvasElement) => unknown;
	HybridBinarizer: new (source: unknown) => unknown;
	BinaryBitmap: new (binarizer: unknown) => unknown;
	DecodeHintType: { POSSIBLE_FORMATS: number; TRY_HARDER: number };
	BarcodeFormat: {
		EAN_13: number;
		EAN_8: number;
		UPC_A: number;
		UPC_E: number;
		CODE_128: number;
		ITF: number;
		CODE_39: number;
	};
};

/** Formats utiles pour de l'alimentaire (EAN/UPC + CODE_128). */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf', 'code_39'] as const;

/** Résolution de décodage maximale (largeur). 1920 px ≈ 5× html5-qrcode :
 *  c'est LE levier principal de portée — plus de pixels sur le même code
 *  barres lu à distance normale (1200/1280 en repli si refus du track). */
const RESOLUTION_LADDER = [
	{ width: 1920, height: 1080 },
	{ width: 1280, height: 720 },
] as const;
/** Cadence de décodage (ms entre deux frames). */
const FRAME_INTERVAL_MS = 70;
/** Garde anti double lecture : même code ignoré pendant 1,2 s. */
const DUPLICATE_MS = 1200;

function getNativeDetector(): NativeDetector | null {
	const w = window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeDetector };
	if (typeof w.BarcodeDetector !== 'function') return null;
	try {
		return new w.BarcodeDetector({ formats: [...FORMATS] });
	} catch {
		// Certains navigateurs n'acceptent pas la liste des formats → défauts.
		return new w.BarcodeDetector();
	}
}

/**
 * Démarre le scan dans `container` (élément déjà présent dans le DOM).
 * `onDecoded` est appelé à chaque code lu (l'appelant filtre/déduplique).
 * Les éléments <video>/repères sont injectés dans `container`.
 */
export async function startBarcodeScanner(
	container: HTMLElement,
	onDecoded: (text: string) => void
): Promise<BarcodeScannerHandle & TorchHandle> {
	container.replaceChildren();

	let stopped = false;
	let stream: MediaStream | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let decoding = false;
	let zxingMod: ZXing | null = null;
	let nativeDetector: NativeDetector | null = null;

	// -- Caméra : recule (résolution native) pour maximiser la portée. ------
	// UN SEUL getUserMedia par scan : si la permission est déjà accordée, le
	// navigateur répond immédiatement SANS redemander (autorisation persistante
	// sur Chrome/Android ; sur iOS/Safari c'est l'OS qui re-consulte à chaque
	// session — l'app ne peut ni l'éviter ni la contourner). Pas de query
	// `permissions` préalable : inutile quand c'est déjà accordé, non fiable
	// sur Safari, et le prompt DOIT partir d'un geste utilisateur (le clic).
	// Ladder de résolution : certains tracks refusent 1920 → repli 1280.
	let lastError: unknown = null;
	for (const res of RESOLUTION_LADDER) {
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					facingMode: 'environment',
					width: { ideal: res.width },
					height: { ideal: res.height },
				},
			});
			break;
		} catch (e) {
			lastError = e;
		}
	}
	if (!stream) {
		const e = lastError;
		const name = e instanceof DOMException ? e.name : '';
		if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') {
			throw new CameraPermissionError(
				name === 'NotFoundError'
					? "Aucune caméra accessible n'a été trouvée sur cet appareil."
					: "L'accès à la caméra est refusé ou bloqué pour ce site."
			);
		}
		throw e instanceof Error ? e : new Error('Caméra indisponible.');
	}
	if (stopped) {
		for (const t of stream.getTracks()) t.stop();
		return {
			stop: async () => {},
			toggleTorch: async () => false,
			hasTorch: () => false,
			zoom: async () => false,
			hasZoom: () => false,
			zoomRange: null,
		};
	}

	// -- Éléments visuels ----------------------------------------------------
	// La vidéo remplit TOUJOURS le conteneur (cadre portrait stable, même si
	// la source caméra est paysage) : object-fit cover + position absolute.
	const video = document.createElement('video');
	video.playsInline = true;
	video.muted = true;
	video.setAttribute('muted', '');
	video.setAttribute('autoplay', '');
	video.srcObject = stream;
	Object.assign(video.style, {
		position: 'absolute',
		inset: '0',
		width: '100%',
		height: '100%',
		objectFit: 'cover',
		display: 'block',
	} as CSSStyleDeclaration);

	// Repères : 4 coins + bande centrale (purement indicatif — le décodage
	// porte sur toute l'image).
	const guide = document.createElement('div');
	Object.assign(guide.style, {
		position: 'absolute',
		inset: '0',
		pointerEvents: 'none',
	} as CSSStyleDeclaration);
	const frame = document.createElement('div');
	Object.assign(frame.style, {
		position: 'absolute',
		left: '6%',
		right: '6%',
		top: '33%',
		height: '34%',
	} as CSSStyleDeclaration);
	// Voile sombre autour du cadre (repère visuel clair, décode toute l'image).
	const dim = document.createElement('div');
	Object.assign(dim.style, {
		position: 'absolute',
		left: '0',
		top: '0',
		width: '100%',
		height: '33%',
		background: 'rgba(0,0,0,.38)',
	} as Partial<CSSStyleDeclaration>);
	frame.append(dim);
	const dim2 = document.createElement('div');
	Object.assign(dim2.style, {
		position: 'absolute',
		left: '0',
		bottom: '0',
		width: '100%',
		height: '33%',
		background: 'rgba(0,0,0,.38)',
	} as Partial<CSSStyleDeclaration>);
	frame.append(dim2);
	for (const side of ['left', 'right'] as const) {
		const sideDim = document.createElement('div');
		Object.assign(sideDim.style, {
			position: 'absolute',
			[side]: '0',
			top: '33%',
			bottom: '33%',
			width: '6%',
			background: 'rgba(0,0,0,.38)',
		} as Partial<CSSStyleDeclaration>);
		frame.append(sideDim);
	}
	for (const styles of [
		{ left: '0', top: '0', borderLeft: '3px solid rgba(255,255,255,.9)', borderTop: '3px solid rgba(255,255,255,.9)' },
		{ right: '0', top: '0', borderRight: '3px solid rgba(255,255,255,.9)', borderTop: '3px solid rgba(255,255,255,.9)' },
		{ left: '0', bottom: '0', borderLeft: '3px solid rgba(255,255,255,.9)', borderBottom: '3px solid rgba(255,255,255,.9)' },
		{ right: '0', bottom: '0', borderRight: '3px solid rgba(255,255,255,.9)', borderBottom: '3px solid rgba(255,255,255,.9)' },
	]) {
		const c = document.createElement('div');
		Object.assign(c.style, {
			position: 'absolute',
			width: '26px',
			height: '26px',
			borderRadius: '4px',
		} as Partial<CSSStyleDeclaration>);
		Object.assign(c.style, styles as Partial<CSSStyleDeclaration>);
		frame.append(c);
	}
	guide.append(frame);
	container.append(video, guide);

	// -- Moteur de décodage ---------------------------------------------------
	nativeDetector = getNativeDetector();
	if (!nativeDetector) {
		// ZXing (déjà présent via html5-qrcode) : import différé, seulement
		// quand on en a besoin et uniquement côté navigateur.
		zxingMod = (await import('html5-qrcode/third_party/zxing-js.umd')) as unknown as ZXing;
	}

	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('Canvas 2D indisponible.');

	// Canvas en résolution native (largeur plafonnée pour la perf).
	let vw = 0;
	let vh = 0;
	const resizeCanvas = () => {
		const nw = video.videoWidth || 0;
		const nh = video.videoHeight || 0;
		if (!nw || !nh) return;
		const scale = Math.min(1, 1920 / nw);
		vw = Math.round(nw * scale);
		vh = Math.round(nh * scale);
		canvas.width = vw;
		canvas.height = vh;
	};

	// Décode une frame. Retourne le texte lu, ou null.
	const decodeOnce = async (): Promise<string | null> => {
		if (video.readyState < 2 || video.paused || video.videoWidth === 0) return null;
		if (nativeDetector) {
			try {
				const codes = await nativeDetector.detect(video);
				return codes.length > 0 ? codes[0].rawValue : null;
			} catch {
				return null;
			}
		}
		if (!zxingMod || !vw || !vh) return null;
		try {
			ctx.drawImage(video, 0, 0, vw, vh);
			const source = new zxingMod.HTMLCanvasElementLuminanceSource(canvas);
			const bitmap = new zxingMod.BinaryBitmap(new zxingMod.HybridBinarizer(source));
			const hints = new Map<number, unknown>();
			hints.set(zxingMod.DecodeHintType.POSSIBLE_FORMATS, [
				zxingMod.BarcodeFormat.EAN_13,
				zxingMod.BarcodeFormat.EAN_8,
				zxingMod.BarcodeFormat.UPC_A,
				zxingMod.BarcodeFormat.UPC_E,
				zxingMod.BarcodeFormat.CODE_128,
				zxingMod.BarcodeFormat.ITF,
				zxingMod.BarcodeFormat.CODE_39,
			]);
			hints.set(zxingMod.DecodeHintType.TRY_HARDER, false);
			const reader = new zxingMod.MultiFormatReader(false, hints);
			const result = reader.decode(bitmap);
			return result ? result.text : null;
		} catch {
			return null;
		}
	};

	// Garde anti double lecture : un même code qui reste sous l'objectif
	// quelques frames ne déclenche pas plusieurs ouverture de feuille.
	let lastCode = '';
	let lastCodeAt = 0;

	// Boucle de scan (avec garde anti-chevauchement).
	const tick = async () => {
		if (stopped) return;
		if (!decoding) {
			decoding = true;
			try {
				if (!vw && video.videoWidth) resizeCanvas();
				const text = await decodeOnce();
				if (!stopped && text) {
					const now = Date.now();
					if (text === lastCode && now - lastCodeAt < DUPLICATE_MS) {
						// même code tout juste lu : on ignore
					} else {
						lastCode = text;
						lastCodeAt = now;
						vibrateOk();
						onDecoded(text);
					}
				}
			} catch {
				// Frame illisible → on continue.
			} finally {
				decoding = false;
			}
		}
		timer = setTimeout(tick, FRAME_INTERVAL_MS);
	};

	await video.play().catch(() => {
		// Autoplay refusé : on attend un geste — l'ouverture du scan EST un geste.
	});
	video.addEventListener('loadedmetadata', resizeCanvas, { once: true });
	tick();

	// -- Lampe + zoom (best effort, selon capacités du track) ----------------
	const track = stream.getVideoTracks()[0];
	const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackConstraintSet & { torch?: boolean; zoom?: { min: number; max: number; step?: number } };
	const hasTorch = caps.torch === true;
	const zoomCap = typeof caps.zoom === 'object' && caps.zoom ? caps.zoom : null;
	let torchOn = false;
	const torch: TorchHandle = {
		hasTorch: () => hasTorch,
		async toggleTorch() {
			if (!hasTorch || !track) return false;
			try {
				torchOn = !torchOn;
				await track.applyConstraints({ advanced: [{ torch: torchOn } as unknown as MediaTrackConstraintSet] });
				return true;
			} catch {
				torchOn = false;
				return false;
			}
		},
		hasZoom: () => !!zoomCap,
		zoomRange: zoomCap ? { min: zoomCap.min, max: zoomCap.max, step: zoomCap.step ?? 0.1 } : null,
		async zoom(factor: number) {
			if (!zoomCap || !track) return false;
			try {
				const z = Math.min(zoomCap.max, Math.max(zoomCap.min, factor));
				await track.applyConstraints({ advanced: [{ zoom: z } as unknown as MediaTrackConstraintSet] });
				return true;
			} catch {
				return false;
			}
		},
	};

	return {
		stop: async () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			if (stream) for (const t of stream.getTracks()) t.stop();
			container.replaceChildren();
		},
		...torch,
	};
}
