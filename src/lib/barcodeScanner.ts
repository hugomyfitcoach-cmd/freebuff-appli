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
/** Durée du flash vert du cadre après une lecture (ms). */
const GREEN_FLASH_MS = 900;
/** Bordure des coins du cadre (blanc au repos, vert au flash). */
const WHITE_BORDER = '4px solid rgba(255,255,255,.92)';
const GREEN_BORDER = '4px solid rgba(74,222,128,1)';
/**
 * Cadre guide affiché — volontairement LARGE et centré légèrement au-dessus
 * du milieu (esprit « capture Food ») : le décodage porte sur TOUTE l'image,
 * le cadre n'est qu'un repère. Un cadre trop petit poussait les clientes à
 * « viser » le code au centre et à coller le téléphone — l'inverse de
 * l'objectif (reconnaissance rapide, à distance normale, cadrage approximatif).
 */
const FRAME_LEFT_RIGHT_PCT = 3;
const FRAME_TOP_PCT = 26;
const FRAME_HEIGHT_PCT = 44;

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

	// -- Focus continu (iPhone / Safari en priorité) --------------------------
	// Sans ça, l'iPhone fige la mise au point sur l'infini : un code-barres à
	// 15–25 cm reste FLOU et indécodable, même en haute résolution. Best effort
	// et silencieux : selon l'appareil, focusMode/pointsOfInterest peuvent être
	// absents des capabilities (on essaie les deux, on ignore tout échec).
	try {
		const track = stream.getVideoTracks()[0];
		const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackConstraintSet & {
			focusMode?: string[];
			pointsOfInterest?: unknown;
		};
		if (Array.isArray(caps.focusMode)) {
			const modes = caps.focusMode as string[];
			// continuous = autofocus permanent ; sinon single-shot pour déclencher
			// au moins une mise au point au démarrage du scan.
			const mode = modes.includes('continuous') ? 'continuous' : modes.includes('single-shot') ? 'single-shot' : null;
			if (mode) await track.applyConstraints({ advanced: [{ focusMode: mode } as unknown as MediaTrackConstraintSet] });
		}
		if (caps.pointsOfInterest !== undefined) {
			// Point d'intérêt au centre du cadre guide (x,y normalisés 0–1) :
			// oriente l'exposition/autofocus là où la cliente place le produit.
			await track.applyConstraints({
				advanced: [
					{ pointsOfInterest: { x: 0.5, y: (FRAME_TOP_PCT + FRAME_HEIGHT_PCT / 2) / 100 } } as unknown as MediaTrackConstraintSet,
				],
			});
		}
	} catch {
		// Focus non pilotable (ancien iOS, desktop…) : le décodage reste tel quel.
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
		left: `${FRAME_LEFT_RIGHT_PCT}%`,
		right: `${FRAME_LEFT_RIGHT_PCT}%`,
		top: `${FRAME_TOP_PCT}%`,
		height: `${FRAME_HEIGHT_PCT}%`,
	} as CSSStyleDeclaration);
	// Voile sombre autour du cadre (repère visuel clair, décode toute l'image).
	const dim = document.createElement('div');
	Object.assign(dim.style, {
		position: 'absolute',
		left: '0',
		top: '0',
		width: '100%',
		height: `${FRAME_TOP_PCT}%`,
		background: 'rgba(0,0,0,.38)',
	} as Partial<CSSStyleDeclaration>);
	frame.append(dim);
	const dim2 = document.createElement('div');
	Object.assign(dim2.style, {
		position: 'absolute',
		left: '0',
		bottom: '0',
		width: '100%',
		height: `${100 - FRAME_TOP_PCT - FRAME_HEIGHT_PCT}%`,
		background: 'rgba(0,0,0,.38)',
	} as Partial<CSSStyleDeclaration>);
	frame.append(dim2);
	for (const side of ['left', 'right'] as const) {
		const sideDim = document.createElement('div');
		Object.assign(sideDim.style, {
			position: 'absolute',
			[side]: '0',
			top: `${FRAME_TOP_PCT}%`,
			bottom: `${100 - FRAME_TOP_PCT - FRAME_HEIGHT_PCT}%`,
			width: `${FRAME_LEFT_RIGHT_PCT}%`,
			background: 'rgba(0,0,0,.38)',
		} as Partial<CSSStyleDeclaration>);
		frame.append(sideDim);
	}
	// Coins : mémorisés avec leurs côtés bordés pour le flash vert.
	const cornerDefs: { styles: Partial<CSSStyleDeclaration>; sides: ('Top' | 'Right' | 'Bottom' | 'Left')[] }[] = [
		{ styles: { left: '0', top: '0', borderLeft: WHITE_BORDER, borderTop: WHITE_BORDER }, sides: ['Left', 'Top'] },
		{ styles: { right: '0', top: '0', borderRight: WHITE_BORDER, borderTop: WHITE_BORDER }, sides: ['Right', 'Top'] },
		{ styles: { left: '0', bottom: '0', borderLeft: WHITE_BORDER, borderBottom: WHITE_BORDER }, sides: ['Left', 'Bottom'] },
		{ styles: { right: '0', bottom: '0', borderRight: WHITE_BORDER, borderBottom: WHITE_BORDER }, sides: ['Right', 'Bottom'] },
	];
	const corners: { el: HTMLDivElement; sides: ('Top' | 'Right' | 'Bottom' | 'Left')[] }[] = [];
	for (const def of cornerDefs) {
		const c = document.createElement('div');
		Object.assign(c.style, {
			position: 'absolute',
			width: '34px',
			height: '34px',
			borderRadius: '6px',
		} as Partial<CSSStyleDeclaration>);
		Object.assign(c.style, def.styles as Partial<CSSStyleDeclaration>);
		corners.push({ el: c, sides: def.sides });
		frame.append(c);
	}
	guide.append(frame);
	container.append(video, guide);

	// -- Feedback visuel « code lu » : le cadre passe franchement au vert ------
	// (lueur + coins verts) pendant GREEN_FLASH_MS. Déclenché au même moment
	// que la vibration : la cliente SAIT instantanément que c'est reconnu,
	// même si la feuille produit met un instant à s'ouvrir.
	let greenTimer: ReturnType<typeof setTimeout> | null = null;
	let lastGreenAt = 0;
	function flashGreen(): void {
		const now = Date.now();
		if (now - lastGreenAt < GREEN_FLASH_MS) return; // déjà vert : pas de clignotement
		lastGreenAt = now;
		frame.style.boxShadow = '0 0 0 4px rgba(34,197,94,.55), 0 0 36px 12px rgba(34,197,94,.35)';
		for (const c of corners) {
			for (const side of c.sides) c.el.style.setProperty(`border${side}`, GREEN_BORDER);
		}
		if (greenTimer) clearTimeout(greenTimer);
		greenTimer = setTimeout(() => {
			frame.style.boxShadow = '';
			for (const c of corners) {
				for (const side of c.sides) c.el.style.setProperty(`border${side}`, WHITE_BORDER);
			}
		}, GREEN_FLASH_MS);
	}

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
			// Passe 1 rapide (TRY_HARDER=false) — cadence élevée.
			const quick = new zxingMod.MultiFormatReader(false, hints);
			const bitmap = new zxingMod.BinaryBitmap(new zxingMod.HybridBinarizer(source));
			const result = quick.decode(bitmap);
			if (result?.text) return result.text;
			// Passe 2 : une frame sur 4 seulement, TRY_HARDER=true — plus coûteux
			// (rotations/contrastes difficiles) mais décroche les codes tenus à
			// distance ou légèrement flous que la passe rapide rate.
			frameCount++;
			if (frameCount % 4 !== 0) return null;
			hints.set(zxingMod.DecodeHintType.TRY_HARDER, true);
			const harder = new zxingMod.MultiFormatReader(false, hints);
			const bitmap2 = new zxingMod.BinaryBitmap(new zxingMod.HybridBinarizer(source));
			const result2 = harder.decode(bitmap2);
			return result2 ? result2.text : null;
		} catch {
			return null;
		}
	};

	// Garde anti double lecture : un même code qui reste sous l'objectif
	// quelques frames ne déclenche pas plusieurs ouverture de feuille.
	let lastCode = '';
	let lastCodeAt = 0;
	/** Compteur de frames (ZXing : une passe TRY_HARDER toutes les 4 frames). */
	let frameCount = 0;

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
						flashGreen();
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
			if (greenTimer) clearTimeout(greenTimer);
			if (stream) for (const t of stream.getTracks()) t.stop();
			container.replaceChildren();
		},
		...torch,
	};
}
