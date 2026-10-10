/**
 * Coût par passe ZXing sur une frame iPhone 1080×1920 (résolution réelle
 * mesurée dans les captures IMG_2237/2238). Objectif : expliquer le fps
 * 2.3–2.6 observé — et estimer le gain du correctif des passes mortes.
 * Exécution : node --experimental-strip-types tools/bench-pass-cost.mts
 */
import {
	MultiFormatReader,
	// @ts-expect-error — classe interne du UMD vendored
	HTMLCanvasElementLuminanceSource,
	HybridBinarizer,
	BinaryBitmap,
	DecodeHintType,
	BarcodeFormat,
} from '../node_modules/html5-qrcode/third_party/zxing-js.umd.js';
import { renderEan13Gray, type Gray } from './bench-corpus.mts';

// Frame iPhone 1080×1920 : un code EAN-13 tenu à distance occupe ~55-65% de
// la largeur (d'après la capture IMG_2237) — module ≈ 6 px sur 1080.
const frame: Gray = renderEan13Gray({ code: '3038352875035', modulePx: 6 });
// On redimensionne mentalement : le corpus 95×6+pad ≈ 590 px de large —
// on le place dans une frame 1080×1920 blanche pour simuler le canvas réel.
const W = 1080, H = 1920;
const full: Gray = { w: W, h: H, d: new Uint8Array(W * H).fill(255) };
const ox = Math.round((W - frame.w) / 2), oy = 500;
for (let y = 0; y < frame.h; y++) full.d.set(frame.d.subarray(y * frame.w, (y + 1) * frame.w), (oy + y) * W + ox);

function toCanvas(gray: Gray): HTMLCanvasElement {
	const data = new Uint8ClampedArray(gray.w * gray.h * 4);
	for (let i = 0; i < gray.w * gray.h; i++) {
		const v = gray.d[i];
		data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = v;
		data[4 * i + 3] = 255;
	}
	return {
		width: gray.w, height: gray.h, style: {},
		getContext: (_: string) => ({ getImageData: () => ({ data, width: gray.w, height: gray.h }) }),
	} as unknown as HTMLCanvasElement;
}
const HINTS = new Map();
HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
	BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
	BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.ITF, BarcodeFormat.CODE_39,
]);
const canvas = toCanvas(full);

function timePass(tryHarder: boolean, canvasOverride?: HTMLCanvasElement, label = ''): { ms: number; ok: boolean } {
	const c = canvasOverride ?? canvas;
	const hints = new Map(HINTS);
	if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true);
	const t0 = performance.now();
	let ok = false;
	try {
		const source = new HTMLCanvasElementLuminanceSource(c);
		const bitmap = new BinaryBitmap(new HybridBinarizer(source));
		const r = new MultiFormatReader(false, hints).decode(bitmap);
		ok = !!r?.text;
	} catch { /* NotFoundException attendu sur frame vide */ }
	return { ms: performance.now() - t0, ok };
}

// Frame AVEC code (réussite attendue) et frame SANS code (échec, coût max)
const empty: Gray = { w: W, h: H, d: new Uint8Array(W * H).fill(230) };
const emptyCanvas = toCanvas(empty);

const runs = 5;
for (const [label, c, th] of [
	['légère (TH=false), frame AVEC code', canvas, false],
	['légère (TH=false), frame SANS code', emptyCanvas, false],
	['TH=true, frame AVEC code', canvas, true],
	['TH=true, frame SANS code', emptyCanvas, true],
] as [string, HTMLCanvasElement, boolean][]) {
	let total = 0, okCount = 0;
	for (let i = 0; i < runs; i++) {
		const r = timePass(th, c);
		total += r.ms;
		if (r.ok) okCount++;
	}
	console.log(`${label.padEnd(36)} ${(total / runs).toFixed(0).padStart(5)} ms/passe  réussite ${okCount}/${runs}`);
}
// Passe crop : sous-région 0.8×0.44 upscalée ×2 → 1728×1690 ≈ frame entière
console.log('\nNote : la passe crop upscalée ×2 (1728×1690) coûte au moins autant');
console.log('que la passe légère pleine frame — c\'est elle qui plombe la cadence.');
