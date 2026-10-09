/**
 * Sonde v2 — quelles stratégies retournent la capture DISTANCE (IMG_2241) ?
 * Corrige le défaut v1 (médiane détruite par les fonds sombres) :
 *   - projection MAX par colonne (la barre est sombre sur toute la hauteur ;
 *     le papier est le pixel le plus clair → max = profil propre) ;
 *   - localisation du papier (run continu de colonnes claires) ;
 *   - variantes : plein cadre (léger/TH), crop app exact (×2 NN sans TH = la
 *     vraie passe 1.5 !, ×2 NN TH), crop serré (×1/×2 NN/×2 bilinéaire, TH),
 *     rotations ±2..6°, downscale plein cadre, projection 1D re-synthétisée.
 *
 *   node --experimental-strip-types tools/probe-strategies-v2.mts <PNG...>
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

function zxDecode(gray: Gray, tryHarder: boolean, eanOnly = false): { text: string | null; ms: number } {
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
	HINTS.set(DecodeHintType.POSSIBLE_FORMATS, eanOnly
		? [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]
		: [
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

function crop(g: Gray, cx: number, cy: number, cw: number, ch: number): Gray {
	const x0 = Math.max(0, cx), y0 = Math.max(0, cy);
	cw = Math.min(cw, g.w - x0); ch = Math.min(ch, g.h - y0);
	const d = new Uint8Array(cw * ch);
	for (let y = 0; y < ch; y++) d.set(g.d.subarray((y0 + y) * g.w + x0, (y0 + y) * g.w + x0 + cw), y * cw);
	return { w: cw, h: ch, d };
}

/** Plus proche voisin. */
function resampleNN(g: Gray, f: number): Gray {
	const w = Math.round(g.w * f), h = Math.round(g.h * f);
	const d = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		const sy = Math.min(g.h - 1, Math.floor(y / f));
		for (let x = 0; x < w; x++) d[y * w + x] = g.d[sy * g.w + Math.min(g.w - 1, Math.floor(x / f))];
	}
	return { w, h, d };
}

/** Bilinéaire (adoucit les marches du NN — profil de barre plus régulier). */
function resampleBilinear(g: Gray, f: number): Gray {
	const w = Math.round(g.w * f), h = Math.round(g.h * f);
	const d = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		const gy = Math.min(g.h - 1.001, (y + 0.5) / f - 0.5);
		const y0 = Math.max(0, Math.floor(gy)), dy = gy - y0;
		for (let x = 0; x < w; x++) {
			const gx = Math.min(g.w - 1.001, (x + 0.5) / f - 0.5);
			const x0 = Math.max(0, Math.floor(gx)), dx = gx - x0;
			const p00 = g.d[y0 * g.w + x0], p10 = g.d[y0 * g.w + Math.min(g.w - 1, x0 + 1)];
			const p01 = g.d[Math.min(g.h - 1, y0 + 1) * g.w + x0], p11 = g.d[Math.min(g.h - 1, y0 + 1) * g.w + Math.min(g.w - 1, x0 + 1)];
			d[y * w + x] = (p00 * (1 - dx) + p10 * dx) * (1 - dy) + (p01 * (1 - dx) + p11 * dx) * dy;
		}
	}
	return { w, h, d };
}

/** Rotation NN autour du centre, canevas élargi. */
function rotate(g: Gray, deg: number): Gray {
	const rad = (deg * Math.PI) / 180;
	const cos = Math.cos(rad), sin = Math.sin(rad);
	const w = Math.ceil(Math.abs(g.w * cos) + Math.abs(g.h * sin));
	const h = Math.ceil(Math.abs(g.w * sin) + Math.abs(g.h * cos));
	const d = new Uint8Array(w * h).fill(255);
	const cx = g.w / 2, cy = g.h / 2, ncx = w / 2, ncy = h / 2;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const sx = Math.round((x - ncx) * cos + (y - ncy) * sin + cx);
			const sy = Math.round(-(x - ncx) * sin + (y - ncy) * cos + cy);
			if (sx >= 0 && sx < g.w && sy >= 0 && sy < g.h) d[y * w + x] = g.d[sy * g.w + sx];
		}
	}
	return { w, h, d };
}

/** Bande verticale candidate (densité de sombre). */
function findBandY(g: Gray): { y0: number; y1: number } {
	const xa = Math.round(g.w * 0.10), xb = Math.round(g.w * 0.90);
	const darkPerRow = new Float32Array(g.h);
	for (let y = 0; y < g.h; y++) {
		let n = 0;
		for (let x = xa; x < xb; x++) if (g.d[y * g.w + x] < 110) n++;
		darkPerRow[y] = n / (xb - xa);
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
	return { y0, y1 };
}

/** Zone horizontale du code : colonnes contenant du sombre dans la bande
 *  (les barres sont sombres sur toute la hauteur de la bande). */
function paperProfile(g: Gray, y0: number, y1: number): { x0: number; x1: number; profile: Float32Array } {
	const xa = Math.round(g.w * 0.05), xb = Math.round(g.w * 0.95);
	let x0 = xb, x1 = xa;
	const bandH = y1 - y0;
	for (let x = xa; x < xb; x++) {
		let dark = 0;
		for (let y = y0; y <= y1; y++) if (g.d[y * g.w + x] < 110) dark++;
		if (dark > bandH * 0.15) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
	}
	const profile = new Float32Array(x1 - x0 + 1);
	for (let x = x0; x <= x1; x++) {
		let m = 0;
		for (let y = y0; y <= y1; y++) m = Math.max(m, g.d[y * g.w + x]);
		profile[x - x0] = m;
	}
	return { x0, x1, profile };
}

function otsu(v: Float32Array, from: number, to: number): number {
	const hist = new Float64Array(256);
	for (let i = from; i < to; i++) hist[Math.min(255, Math.round(v[i]))]++;
	const total = to - from;
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

/** Image 1D synthétique à partir d'un profil (répliqué verticalement). */
function synthFromProfile(profile: Float32Array, rows: number): Gray {
	const w = profile.length;
	const d = new Uint8Array(w * rows);
	for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) d[y * w + x] = profile[x];
	return { w, h: rows, d };
}

function target(g: Gray, text: string | null): string {
	return text === '3038352875035' ? '✅ LU' : text ? `⚠️ ${text}` : '—';
}

for (const p of process.argv.slice(2)) {
	const g = decodePng(p);
	const name = p.split('/').pop() ?? p;
	console.log(`\n════ ${name} (${g.w}×${g.h}) ════`);
	const { y0, y1 } = findBandY(g);
	const { x0, x1, profile } = paperProfile(g, y0, y1);
	const labelW = x1 - x0 + 1;
	console.log(`bande y ${y0}..${y1} · code x ${x0}..${x1} (l=${x1 - x0 + 1}px → ${((x1 - x0 + 1) / 95).toFixed(2)} px/module dans la CAPTURE)`);

	const R = (label: string, img: Gray, th: boolean, ean = false) => {
		const r = zxDecode(img, th, ean);
		console.log(`  ${label.padEnd(52)} ${String(img.w)}×${String(img.h).padEnd(5)} ${target(img, r.text)} (${r.ms.toFixed(0)} ms)`);
		return r.text === '3038352875035';
	};
	const hits: string[] = [];

	// A — passes actuelles de l'app (référence).
	if (R('A1 plein cadre léger (passe 1)', g, false)) hits.push('A1');
	if (R('A2 plein cadre + TH (passe 2)', g, true)) hits.push('A2');
	const cw = Math.round(g.w * 0.8), ch = Math.round(g.h * 0.44);
	const cx = Math.round((g.w - cw) / 2), cy = Math.max(0, Math.round(g.h * (26 + 44 / 2) / 100 - ch / 2));
	const appCrop = crop(g, cx, cy, cw, ch);
	if (R('A3 crop app ×2 NN SANS TH (passe 1.5 réelle)', resampleNN(appCrop, 2), false)) hits.push('A3');
	if (R('A4 crop app ×2 NN + TH', resampleNN(appCrop, 2), true)) hits.push('A4');

	// B — crop serré papier (±marge), TH, ×1 / NN / bilinéaire.
	const mx = Math.round(labelW * 0.06), my = Math.max(6, Math.round((y1 - y0) * 0.3));
	const tight = crop(g, x0 - mx, y0 - my, labelW + 2 * mx, (y1 - y0) + 2 * my);
	if (R('B1 crop serré ×1 + TH', tight, true)) hits.push('B1');
	if (R('B2 crop serré ×2 NN + TH', resampleNN(tight, 2), true)) hits.push('B2');
	if (R('B3 crop serré ×2 bilinéaire + TH', resampleBilinear(tight, 2), true)) hits.push('B3');
	if (R('B4 crop serré ×2 bilinéaire SANS TH', resampleBilinear(tight, 2), false)) hits.push('B4');

	// C — rotations du crop serré ×2 bilinéaire + TH (roll main levée).
	for (const deg of [-6, -4, -2, 2, 4, 6]) {
		if (R(`C rot ${String(deg).padStart(2)}° crop serré ×2 bil + TH`, rotate(resampleBilinear(tight, 2), deg), true)) hits.push(`C${deg}`);
	}

	// D — downscale plein cadre (antirepli) + TH.
	if (R('D1 plein cadre ×0.5 + TH', resampleBilinear(g, 0.5), true)) hits.push('D1');
	if (R('D2 plein cadre ×0.75 + TH', resampleBilinear(g, 0.75), true)) hits.push('D2');

	// E — projection 1D (max) du bandeau code, ramenée à ≈2 px/module.
	const prof = profile;
	const modPx = labelW / 95;
	const f1 = 2 / modPx;
	if (f1 > 0.2 && f1 < 8) {
		const scaled = resampleBilinear(synthFromProfile(prof, 24), f1);
		if (R(`E1 projection 1D max → ×${f1.toFixed(2)} (≈2px/mod) + TH`, scaled, true, true)) hits.push('E1');
	}

	console.log(hits.length ? `  → STRATÉGIES GAGNANTES : ${hits.join(', ')}` : '  → AUCUNE stratégie ne lit le code (info absente ou géométrie hors tolérance)');
}
