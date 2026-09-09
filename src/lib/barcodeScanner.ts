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

export type BarcodeScannerHandle = {
	/** Arrête la caméra + le décodage et retire les éléments injectés. */
	stop: () => Promise<void>;
};

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

/** Résolution de décodage maximale (largeur). 1280 px ≈ 3,4× html5-qrcode. */
const MAX_DECODE_WIDTH = 1280;
/** Cadence de décodage (ms entre deux frames). */
const FRAME_INTERVAL_MS = 70;

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
): Promise<BarcodeScannerHandle> {
	container.replaceChildren();

	let stopped = false;
	let stream: MediaStream | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let decoding = false;
	let zxingMod: ZXing | null = null;
	let nativeDetector: NativeDetector | null = null;

	// -- Caméra : recule (résolution native) pour maximiser la portée. ------
	stream = await navigator.mediaDevices.getUserMedia({
		audio: false,
		video: {
			facingMode: 'environment',
			width: { ideal: 1920 },
			height: { ideal: 1080 },
		},
	});
	if (stopped) {
		for (const t of stream.getTracks()) t.stop();
		return { stop: async () => {} };
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
		const scale = Math.min(1, MAX_DECODE_WIDTH / nw);
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

	// Boucle de scan (avec garde anti-chevauchement).
	const tick = async () => {
		if (stopped) return;
		if (!decoding) {
			decoding = true;
			try {
				if (!vw && video.videoWidth) resizeCanvas();
				const text = await decodeOnce();
				if (!stopped && text) onDecoded(text);
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

	return {
		stop: async () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			if (stream) for (const t of stream.getTracks()) t.stop();
			container.replaceChildren();
		},
	};
}
