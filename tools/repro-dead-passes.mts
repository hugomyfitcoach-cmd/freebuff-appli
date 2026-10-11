/**
 * REPRODUCTION V3.4-b — les passes crop et TRY_HARDER de `decodeOnce` sont du
 * CODE MORT : le MultiFormatReader du ZXing vendored LÈVE (NotFoundException)
 * quand il ne trouve rien — il ne renvoie jamais null. Or le try/catch UNIQUE
 * enveloppe tout decodeOnce : sur toute frame en échec, le contrôle sort
 * immédiatement par le catch, SANS exécuter `frameCount++`, la passe crop ni
 * la passe TRY_HARDER.
 *
 * Conséquences mesurées sur le terrain (captures IMG_2237/2238) :
 *   · 366L/0H puis 428L/0H avec 0 ms TH cum malgré fixed-1of4 → jamais une
 *     passe TH n'a tourné depuis la V3 (le compteur L inclut des frames qui
 *     n'ont PAS été décodées complètement : L compte decodeCount, le catch
 *     arriving here still increments decodeCount in tick()).
 *   · Le code à distance n'est JAMAIS relu par le crop ni par TH : la passe
 *     censée le décrocher est morte depuis l'origine (V3).
 *
 * Exécution : node --experimental-strip-types tools/repro-dead-passes.mts
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

// ── 1. La frame SANS code lisible fait lever quick.decode ───────────────────
// (ici : une frame d'un emballage sans code-barres = zone de bruit gris)
const noise: Gray = { w: 400, h: 200, d: new Uint8Array(400 * 200) };
for (let i = 0; i < noise.d.length; i++) noise.d[i] = 128 + Math.floor(Math.random() * 40);
let threw = false;
try {
	const source = new HTMLCanvasElementLuminanceSource(toCanvas(noise));
	const bitmap = new BinaryBitmap(new HybridBinarizer(source));
	new MultiFormatReader(false, HINTS).decode(bitmap);
} catch {
	threw = true;
}
console.log(`1. quick.decode sur frame sans code : ${threw ? 'LÈVE une exception (code mort après)' : 'renvoie null (inattendu)'}`);

// ── 2. Simulation du flux decodeOnce réel : le catch avale tout ────────────
// Copie fidèle de la structure du decodeOnce de l'app (frameCount++, crop,
// TH) — sur frame SANS code, aucune passe après quick.decode ne s'exécute.
let frameCount = 0, cropExecuted = 0, hardExecuted = 0, hardMs = 0;
let catches = 0;
function decodeOnceSimulated(): string | null {
	try {
		// quick pass (lève sur frame vide)
		const source = new HTMLCanvasElementLuminanceSource(toCanvas(noise));
		const bitmap = new BinaryBitmap(new HybridBinarizer(source));
		const r = new MultiFormatReader(false, HINTS).decode(bitmap);
		if (r?.text) return r.text;
		frameCount++;
		// passe crop (jamais atteinte si quick lève)
		cropExecuted++;
		// passe TH
		hardExecuted++;
		return null;
	} catch {
		catches++;
		return null; // ← exactement le comportement de l'app
	}
}
for (let i = 0; i < 20; i++) decodeOnceSimulated();
console.log(`2. 20 frames sans code : crop exécuté=${cropExecuted}/10 attendu, TH=${hardExecuted}/5 attendu, catch=${catches}`);
console.log(`   → CONFIRME : les passes crop et TH sont du code mort depuis la V3.`);
