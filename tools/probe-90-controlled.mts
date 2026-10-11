/**
 * Sonde 90° CONTRÔLÉE — répondant à la question « tight coupe-t-il un code à 90° ? »
 *
 * Principe : on prend le PAYLOAD horizontal qui décode déjà dans le crop tight
 * V3.5 (60 %×18 %, cy 48 %) d'une capture donnée (IMG_2243 : décode
 * 3038352875035 par tight + TH), on le recompose dans une frame synthétique
 * 1206×2622 (fond gris uniforme, bande centrée à y=48 %), et on mesure CHAQUE
 * passe du pipeline de barcodeScanner.ts sur :
 *   A = frame avec code HORIZONTAL ;
 *   B = la même frame tournée CW 90° (code VERTICAL, comme sur une canette).
 *
 * C'est un test MÉCANISTE : le payload est identique, seule l'orientation
 * change. Les frames brutes caméra (frame dump) restent nécessaires pour
 * la confirmation terrain.
 *
 *   node --experimental-strip-types tools/probe-90-controlled.mts <PNG...>
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
	MultiFormatReader,
	// @ts-expect-error — interne UMD vendored
	HTMLCanvasElementLuminanceSource,
	HybridBinarizer,
	BinaryBitmap,
	DecodeHintType,
	BarcodeFormat,
} from '../node_modules/html5-qrcode/third_party/zxing-js.umd.js';

type Gray = { w: number; h: number; d: Uint8Array };

function decodePng(path: string): Gray {
	const buf = readFileSync(path);
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`pas un PNG : ${path}`);
	let off = 8;
	let w = 0, h = 0, bitDepth = 0, colorType = 0;
	const idat: Buffer[] = [];
	while (off < buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString('ascii', off + 4, off + 8);
		const data = buf.subarray(off + 8, off + 8 + len);
		if (type === 'IHDR') {
			w = data.readUInt32BE(0); h = data.readUInt32BE(4);
			bitDepth = data[8]; colorType = data[9];
		} else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
		off += 12 + len;
	}
	const sampleBytes = bitDepth / 8;
	const bpp = (colorType === 6 ? 4 : 3) * sampleBytes;
	const raw = inflateSync(Buffer.concat(idat));
	const stride = w * bpp;
	const px = Buffer.alloc(h * stride);
	for (let y = 0; y < h; y++) {
		const f = raw[y * (stride + 1)];
		const src = y * (stride + 1) + 1;
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? px[y * stride + x - bpp] : 0;
			const b = y > 0 ? px[(y - 1) * stride + x] : 0;
			const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
			let v = raw[src + x];
			if (f === 1) v += a;
			else if (f === 2) v += b;
			else if (f === 3) v += (a + b) >> 1;
			else if (f === 4) {
				const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			px[y * stride + x] = v & 0xff;
		}
	}
	const g = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		const o = i * bpp;
		const r = px[o];
		const gg = sampleBytes === 2 ? px[o + 2] : px[o + 1];
		const b = sampleBytes === 2 ? px[o + 4] : px[o + 2];
		g[i] = (r * 299 + gg * 587 + b * 114) / 1000;
	}
	return { w, h, d: g };
}

/** Crop centré proportionnel, formules exactes du scanner (V3 / V3.5). */
function crop(g: Gray, wFrac: number, hFrac: number, cyFrac: number): Gray {
	const cw = Math.round(g.w * wFrac);
	const ch = Math.round(g.h * hFrac);
	const cx = Math.round((g.w - cw) / 2);
	const cy = Math.max(0, Math.round(g.h * cyFrac - ch / 2));
	const out = { w: cw, h: ch, d: new Uint8Array(cw * ch) };
	for (let y = 0; y < ch; y++)
		for (let x = 0; x < cw; x++) out.d[y * cw + x] = g.d[(cy + y) * g.w + cx + x];
	return out;
}

function rotate90(g: Gray, dir: 1 | -1): Gray {
	const w = g.w, h = g.h;
	const out = { w: h, h: w, d: new Uint8Array(w * h) };
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (dir === 1) out.d[x * h + (h - 1 - y)] = g.d[y * w + x];
			else out.d[(w - 1 - x) * w + y] = g.d[y * w + x];
		}
	}
	return out;
}

function zxDecode(gray: Gray, tryHarder: boolean): { text: string | null; ms: number } {
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
	} catch {
		return { text: null, ms: performance.now() - t0 };
	}
}

/** Recompose : fond gris uniforme 1206×2622 + bande (png constitutif) collée centrée à cyFrac. */
function compose(src: Gray, cyFrac: number): Gray {
	const band = crop(src, 0.6, 0.18, cyFrac);
	const out = { w: 1206, h: 2622, d: new Uint8Array(1206 * 2622) };
	out.d.fill(190);
	const y0 = Math.round(out.h * cyFrac - band.h / 2);
	const x0 = Math.round((out.w - band.w) / 2);
	for (let y = 0; y < band.h; y++)
		for (let x = 0; x < band.w; x++) out.d[(y0 + y) * out.w + x0 + x] = band.d[y * band.w + x];
	return out;
}

const pngPath = process.argv[2];
if (!pngPath) {
	console.error('usage : node --experimental-strip-types tools/probe-90-controlled.mts <PNG de référence (code horizontal dans le crop tight 60%×18% cy=48%)>');
	process.exit(1);
}
const src = decodePng(pngPath);
const sanCheck = zxDecode(crop(src, 0.6, 0.18, 0.48), true);
if (!sanCheck.text) {
	console.error('La capture fournie ne décode PAS dans le crop tight 60%×18% cy=48% : elle ne peut pas servir de payload de référence.');
	process.exit(1);
}
console.log(`payload de référence : ${sanCheck.text} (extrait de ${pngPath.split('/').pop()})\n`);

const A = compose(src, 0.48);      // code HORIZONTAL
const B = rotate90(A, 1);          // la MÊME frame tournée CW 90° → code VERTICAL

for (const [label, g, codeOrientation] of [
	['A — code HORIZONTAL', A, 'horizontal'],
	['B — même frame CW90 : code VERTICAL (canette)', B, 'vertical'],
] as const) {
	console.log(`════ ${label} (${g.w}×${g.h}) ════`);
	const row = (name: string, t: string | null, ms: number) =>
		console.log(`${name.padEnd(34)} ${t ? `✅ ${t}` : '—'}  (${ms.toFixed(0)} ms)`);
	const f0 = zxDecode(g, false);
	row('plein cadre léger (passe 1)', f0.text, f0.ms);
	const fT = zxDecode(g, true);
	row('plein cadre TH (passe 2)', fT.text, fT.ms);
	const tight = crop(g, 0.6, 0.18, 0.48);
	const tT = zxDecode(tight, true);
	row('tight 60%×18% TH (V3.5)', tT.text, tT.ms);
	const tightRot = zxDecode(rotate90(tight, -1), true);
	row('tight rot90 TH (non implémenté)', tightRot.text, tightRot.ms);
	const vert = zxDecode(crop(g, 0.18, 0.6, 0.48), true);
	row('tight VERT 18%×60% TH', vert.text, vert.ms);
	const fullH = zxDecode(crop(g, 0.6, 1.0, 0.5), true);
	row('contrôle 60%×100% TH (si ✅ = troncature)', fullH.text, fullH.ms);
	console.log('');
}
