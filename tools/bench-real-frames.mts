/**
 * Décodage ZXing sur frames RÉELLES de la vidéo terrain (PGM 1206×2622,
 * écran iPhone 1206×2622 — ces frames sont l'APERÇU affiché, pas le flux
 * décodeur, voir limites). Exécution :
 *   node --experimental-strip-types tools/bench-real-frames.mts
 */
import { readFileSync } from 'node:fs';
import {
	MultiFormatReader,
	// @ts-expect-error — classe interne du UMD vendored
	HTMLCanvasElementLuminanceSource,
	HybridBinarizer,
	BinaryBitmap,
	DecodeHintType,
	BarcodeFormat,
} from '../node_modules/html5-qrcode/third_party/zxing-js.umd.js';

type Pgm = { w: number; h: number; d: Buffer };
function readPgm(path: string): Pgm {
	const buf = readFileSync(path);
	// Header P5 "P5\nw h\n255\n" (tolère espaces multiples)
	const m = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(buf.toString('binary', 0, 200));
	if (!m) throw new Error(`header PGM invalide : ${path}`);
	const w = Number(m[1]), h = Number(m[2]);
	const headerLen = m[0].length;
	return { w, h, d: buf.subarray(headerLen, headerLen + w * h) };
}

function decode(gray: Pgm, tryHarder: boolean): { text: string | null; ms: number; err?: string } {
	const data = new Uint8ClampedArray(gray.w * gray.h * 4);
	for (let i = 0; i < gray.w * gray.h; i++) {
		const v = gray.d[i];
		data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = v;
		data[4 * i + 3] = 255;
	}
	const canvas = {
		width: gray.w, height: gray.h, style: {},
		getContext: (_: string) => ({ getImageData: () => ({ data, width: gray.w, height: gray.h }) }),
	} as unknown as HTMLCanvasElement;
	const HINTS = new Map();
	HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
		BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
		BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.ITF, BarcodeFormat.CODE_39,
	]);
	if (tryHarder) HINTS.set(DecodeHintType.TRY_HARDER, true);
	const reader = new MultiFormatReader(false, HINTS);
	const t0 = performance.now();
	try {
		const source = new HTMLCanvasElementLuminanceSource(canvas);
		const bitmap = new BinaryBitmap(new HybridBinarizer(source));
		const result = reader.decode(bitmap);
		return { text: result?.text ?? null, ms: performance.now() - t0 };
	} catch (e) {
		return { text: null, ms: performance.now() - t0, err: `${e}`.slice(0, 60) };
	}
}

/** Recadrage central ×2 (comme la passe 1.5 ZXing de l'app : 0.8 w × 0.44 h). */
function cropCenter(gray: Pgm): Pgm {
	const cw = Math.round(gray.w * 0.8), ch = Math.round(gray.h * 0.44);
	const cx = Math.round((gray.w - cw) / 2), cy = Math.round((gray.h - ch) / 2 - gray.h * 0.03);
	const d = Buffer.alloc(cw * ch);
	for (let y = 0; y < ch; y++) {
		gray.d.copy(d, y * cw, (cy + y) * gray.w + cx, (cy + y) * gray.w + cx + cw);
	}
	return { w: cw, h: ch, d };
}

for (let i = 0; i < 10; i++) {
	const gray = readPgm(`/tmp/vid-frame-${i}.pgm`);
	const full = decode(gray, false);
	const fullTh = decode(gray, true);
	const crop = decode(cropCenter(gray), true);
	console.log(
		`frame ${i}: full=${full.text ?? '—'} (${full.ms.toFixed(0)}ms)  fullTH=${fullTh.text ?? '—'} (${fullTh.ms.toFixed(0)}ms)  cropTH=${crop.text ?? '—'} (${crop.ms.toFixed(0)}ms)`
	);
}
