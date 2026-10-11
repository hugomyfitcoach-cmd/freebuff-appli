/**
 * Sonde scanline — pourquoi ZXing échoue sur une image visuellement lisible ?
 * Pour chaque capture réelle :
 *   1. bande code-barres localisée (médiane de lignes → scanline 1D) ;
 *   2. binarisation par seuil d'Otsu (vs HybridBinarizer global par blocs) ;
 *   3. runs → corrélations contre le pattern EAN-13 exact de 3038352875035,
 *      balayage du point de départ, largeur de module 6..11 px, sans et avec
 *      normalisation de largeur — la corrélation max dit si l'INFO est là ;
 *   4. verdict : info présente + ZXing échoue → cause géométrique/garde
 *      quiet-zone/digit pedestal ; info absente → cause optique.
 *
 *   node --experimental-strip-types tools/probe-scanline.mts <PNG...>
 */
import { readFileSync, writeFileSync } from 'node:fs';
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

/* ── EAN-13 : tables + pattern cible ────────────────────────────────────── */
const P = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const E = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const CL = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PARITY = ['AAAAAA','AABABB','AABBAB','AABBBA','ABAABB','ABBAAB','ABBBAA','ABABAB','ABABBA','ABBABA'];
function ean13Bits(code: string): string {
	const p = PARITY[Number(code[0])];
	let b = '101';
	for (let i = 1; i <= 6; i++) b += (p[i - 1] === 'A' ? P : E)[Number(code[i])];
	b += '01010';
	for (let i = 7; i <= 12; i++) b += CL[Number(code[i])];
	return b + '101';
}
const TARGET = ean13Bits('3038352875035');

/* ── Bande + scanline médiane ───────────────────────────────────────────── */
function findBand(g: Gray): { y0: number; y1: number; x0: number; x1: number } {
	const xa = Math.round(g.w * 0.10), xb = Math.round(g.w * 0.90);
	const colW = xb - xa;
	const darkPerRow = new Float32Array(g.h);
	for (let y = 0; y < g.h; y++) {
		let n = 0;
		for (let x = xa; x < xb; x++) if (g.d[y * g.w + x] < 110) n++;
		darkPerRow[y] = n / colW;
	}
	const win = Math.max(8, Math.round(g.h * 0.08));
	let bestY = Math.round(g.h * 0.3), bestV = 0;
	for (let y = Math.round(g.h * 0.2); y + win < Math.round(g.h * 0.85); y++) {
		let s = 0;
		for (let k = 0; k < win; k++) s += darkPerRow[y + k];
		if (s / win > bestV) { bestV = s / win; bestY = y; }
	}
	const thr = bestV * 0.6;
	let y1 = bestY + win, y0 = bestY;
	while (y1 < g.h - 1 && darkPerRow[y1] > thr) y1++;
	while (y0 > 0 && darkPerRow[y0 - 1] > thr) y0--;
	const xf0 = Math.round(g.w * 0.05), xf1 = Math.round(g.w * 0.95);
	let x0 = xf1, x1 = xf0;
	for (let x = xf0; x < xf1; x++) {
		let dark = 0;
		for (let y = y0; y < y1; y++) if (g.d[y * g.w + x] < 110) dark++;
		if (dark > (y1 - y0) * 0.15) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
	}
	return { y0, y1, x0, x1 };
}

function medianScanline(g: Gray, y0: number, y1: number, x0: number, x1: number): Float32Array {
	const w = x1 - x0 + 1;
	const out = new Float32Array(w);
	const col: number[] = [];
	for (let x = 0; x < w; x++) {
		col.length = 0;
		for (let y = y0; y <= y1; y++) col.push(g.d[y * g.w + x0 + x]);
		col.sort((a, b) => a - b);
		out[x] = col[col.length >> 1];
	}
	// Lissage léger (médiane glissante 3) : anti-poussière sans casser les runs.
	const sm = new Float32Array(w);
	for (let x = 0; x < w; x++) {
		const a = out[Math.max(0, x - 1)], b = out[x], c = out[Math.min(w - 1, x + 1)];
		sm[x] = [a, b, c].sort((p, q) => p - q)[1];
	}
	return sm;
}

/* ── Otsu 1D ────────────────────────────────────────────────────────────── */
function otsu(v: Float32Array): number {
	const hist = new Float64Array(256);
	for (const x of v) hist[Math.min(255, Math.round(x))]++;
	const total = v.length;
	let sum = 0;
	for (let i = 0; i < 256; i++) sum += i * hist[i];
	let sumB = 0, wB = 0, best = 0, bestT = 128;
	for (let t = 0; t < 256; t++) {
		wB += hist[t];
		if (!wB) continue;
		const wF = total - wB;
		if (!wF) break;
		sumB += t * hist[t];
		const mB = sumB / wB, mF = (sum - sumB) / wF;
		const between = wB * wF * (mB - mF) * (mB - mF);
		if (between > best) { best = between; bestT = t; }
	}
	return bestT;
}

/* ── Corrélation scanline binaire ↔ pattern cible ───────────────────────── */
function bestCorrelation(bits: Uint8Array, target: string, modulePx: number) {
	const L = target.length;
	const startGuard = [1, 0, 1];
	let best = { score: -2, off: -1, m: 0 };
	for (let m = modulePx - 2; m <= modulePx + 2; m += 0.25) {
		for (let off = 0; off + L * m < bits.length; off += 0.5) {
			// Sanity : le guard doit commencer par barre.
			if (bits[Math.round(off)] !== 1) continue;
			let match = 0;
			for (let i = 0; i < L; i++) {
				const x = Math.round(off + (i + 0.5) * m);
				if (x >= bits.length) { match = -L; break; }
				if (bits[x] === Number(target[i])) match++;
			}
			const score = match / L;
			if (score > best.score) best = { score, off, m };
		}
	}
	return best;
}

/* ── Extraction de runs ─────────────────────────────────────────────────── */
function runsFromBits(bits: Uint8Array): { len: number; val: number }[] {
	const runs: { len: number; val: number }[] = [];
	let cur = bits[0], n = 0;
	for (const b of bits) {
		if (b === cur) n++;
		else { runs.push({ len: n, val: cur }); cur = b; n = 1; }
	}
	runs.push({ len: n, val: cur });
	return runs;
}

/* ── Analyse complète d'une capture ─────────────────────────────────────── */
for (const p of process.argv.slice(2)) {
	const g = decodePng(p);
	const name = p.split('/').pop() ?? p;
	console.log(`\n════ ${name} (${g.w}×${g.h}) ════`);
	const band = findBand(g);
	console.log(`bande: x ${band.x0}..${band.x1} (l=${band.x1 - band.x0 + 1}, ≈${((band.x1 - band.x0 + 1) / 95).toFixed(2)} px/module) y ${band.y0}..${band.y1}`);

	// Statistiques de luminance du bandeau : l'info est-elle contrastée ?
	const scan = medianScanline(g, band.y0, band.y1, band.x0, band.x1);
	let mn = 255, mx = 0;
	for (const v of scan) { if (v < mn) mn = v; if (v > mx) mx = v; }
	const t = otsu(scan);
	console.log(`scanline: min=${mn.toFixed(0)} max=${mx.toFixed(0)} contraste=${(mx - mn).toFixed(0)} seuil Otsu=${t}`);
	const bits = new Uint8Array(scan.length);
	for (let i = 0; i < scan.length; i++) bits[i] = scan[i] < t ? 1 : 0;

	// Runs du guard : mesure de la largeur de module réelle.
	const runs = runsFromBits(bits);
	const nRuns = runs.length;
	console.log(`runs: ${nRuns} (EAN-13 complet ≈ 59)`);
	const moduleEst = (band.x1 - band.x0 + 1) / 95;

	// Corrélation contre le pattern cible.
	const best = bestCorrelation(bits, TARGET, moduleEst);
	console.log(`corrélation max avec EAN-13 3038352875035: ${(best.score * 100).toFixed(1)} % (off=${best.off.toFixed(0)}, m=${best.m.toFixed(2)})`);

	// Décomposition par tiers (garde/gauche/droit) pour localiser la casse.
	const L3 = Math.floor(TARGET.length / 3);
	for (const [label, from, to] of [['garde+gauche', 0, L3], ['centre+droite', L3, TARGET.length]] as const) {
		const sub = TARGET.slice(from, to);
		let bestSub = { score: -2, off: 0, m: 0 };
		for (let m = moduleEst - 2; m <= moduleEst + 2; m += 0.25) {
			for (let off = 0; off + sub.length * m < bits.length; off += 0.5) {
				if (bits[Math.round(off)] !== 1) continue;
				let match = 0;
				for (let i = 0; i < sub.length; i++) {
					const x = Math.round(off + (i + 0.5) * m);
					if (x >= bits.length) { match = -sub.length; break; }
					if (bits[x] === Number(sub[i])) match++;
				}
				const sc = match / sub.length;
				if (sc > bestSub.score) bestSub = { score: sc, off, m };
			}
		}
		console.log(`  corrélation ${label.padEnd(14)}: ${(bestSub.score * 100).toFixed(1)} %`);
	}

	// Référence : ZXing sur le même crop (rappel).
	const crop = { w: band.x1 - band.x0 + 1, h: band.y1 - band.y0 + 1, d: new Uint8Array((band.x1 - band.x0 + 1) * (band.y1 - band.y0 + 1)) };
	for (let y = 0; y < crop.h; y++)
		for (let x = 0; x < crop.w; x++) crop.d[y * crop.w + x] = g.d[(band.y0 + y) * g.w + band.x0 + x];
	const r1 = zxDecode(crop, false);
	const r2 = zxDecode(crop, true);
	console.log(`ZXing crop bande seul: léger=${r1.text ?? '—'} TH=${r2.text ?? '—'}`);
}
