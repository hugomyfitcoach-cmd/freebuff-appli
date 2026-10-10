/**
 * Sonde v3 — la capture DISTANCE contient-elle l'information EAN-13 ?
 *   1. carte ASCII du taux d'alternance sombre/clair (signature d'un code-barres)
 *      → localisation visuelle exacte du bandeau dans la capture ;
 *   2. balayage exhaustif de fenêtres (x0, y0, l, h) avec décodage ZXing TH
 *      sur crop bilinéaire ×2 — recherche d'UN crop lisible ;
 *   3. corrélation 1D du profil MAX (projection sur colonnes) contre le
 *      pattern cible — mesure de présence d'information indépendante de ZXing.
 *
 *   node --experimental-strip-types tools/probe-distance-v3.mts <PNG...>
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

function crop(g: Gray, x0: number, y0: number, cw: number, ch: number): Gray {
	x0 = Math.max(0, x0); y0 = Math.max(0, y0);
	cw = Math.min(cw, g.w - x0); ch = Math.min(ch, g.h - y0);
	const d = new Uint8Array(cw * ch);
	for (let y = 0; y < ch; y++) d.set(g.d.subarray((y0 + y) * g.w + x0, (y0 + y) * g.w + x0 + cw), y * cw);
	return { w: cw, h: ch, d };
}

function resampleBilinear(g: Gray, f: number): Gray {
	const w = Math.round(g.w * f), h = Math.round(g.h * f);
	const d = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		const gy = Math.min(g.h - 1.001, (y + 0.5) / f - 0.5);
		const sy0 = Math.max(0, Math.floor(gy)), dy = gy - sy0;
		for (let x = 0; x < w; x++) {
			const gx = Math.min(g.w - 1.001, (x + 0.5) / f - 0.5);
			const sx0 = Math.max(0, Math.floor(gx)), dx = gx - sx0;
			const p00 = g.d[sy0 * g.w + sx0], p10 = g.d[sy0 * g.w + Math.min(g.w - 1, sx0 + 1)];
			const p01 = g.d[Math.min(g.h - 1, sy0 + 1) * g.w + sx0], p11 = g.d[Math.min(g.h - 1, sy0 + 1) * g.w + Math.min(g.w - 1, sx0 + 1)];
			d[y * w + x] = (p00 * (1 - dx) + p10 * dx) * (1 - dy) + (p01 * (1 - dx) + p11 * dx) * dy;
		}
	}
	return { w, h, d };
}

/* EAN-13 tables */
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

/** Corrélation d'un profil binaire 1D contre le pattern cible (balayage). */
function bestCorr(prof: Float32Array, thr: number, modulePx: number): { score: number; m: number; off: number } {
	const bits = new Uint8Array(prof.length);
	for (let i = 0; i < prof.length; i++) bits[i] = prof[i] < thr ? 1 : 0;
	const L = TARGET.length;
	let best = { score: -2, m: 0, off: -1 };
	for (let m = modulePx * 0.5; m <= modulePx * 1.5; m += 0.2) {
		for (let off = 0; off + L * m < bits.length; off += 1) {
			if (!bits[Math.round(off)]) continue;
			let match = 0;
			for (let i = 0; i < L; i++) {
				const x = Math.round(off + (i + 0.5) * m);
				if (x >= bits.length) { match = -L; break; }
				if (bits[x] === Number(TARGET[i])) match++;
			}
			const sc = match / L;
			if (sc > best.score) best = { score: sc, m, off };
		}
	}
	return best;
}

function otsuRange(v: Float32Array): number {
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

for (const p of process.argv.slice(2)) {
	const g = decodePng(p);
	const name = p.split('/').pop() ?? p;
	console.log(`\n════ ${name} (${g.w}×${g.h}) ════`);

	// 1. Carte ASCII du taux d'alternance (fenêtres 64×64, pas 32).
	console.log('carte d\u2019alternance (0-9 = transitions/64px dans la fenêtre ; "#" = dense) :');
	const cell = 64;
	for (let cy = Math.round(g.h * 0.25); cy + cell < Math.round(g.h * 0.85); cy += cell) {
		let row = '';
		for (let cx = Math.round(g.w * 0.05); cx + cell < Math.round(g.w * 0.95); cx += cell) {
			// Profil max de la cellule, seuil local, compte des transitions.
			const prof = new Float32Array(cell);
			for (let x = 0; x < cell; x++) {
				let m = 0;
				for (let y = 0; y < cell; y++) m = Math.max(m, g.d[(cy + y) * g.w + cx + x]);
				prof[x] = m;
			}
			const t = otsuRange(prof);
			let trans = 0;
			for (let x = 1; x < cell; x++) if ((prof[x] < t) !== (prof[x - 1] < t)) trans++;
			row += trans >= 18 ? '#' : trans >= 12 ? '+' : trans >= 6 ? '-' : '.';
		}
		console.log(`y${String(cy).padStart(4)}  ${row}`);
	}

	// 2. Balayage exhaustif de fenêtres + TH (crop bilinéaire ×2).
	console.log('balayage fenêtres (TH, crop ×2)…');
	const hits: string[] = [];
	let tried = 0;
	const t0all = performance.now();
	for (let x0 = 120; x0 + 350 <= 1100; x0 += 60) {
		for (const wdw of [350, 500, 700, 950]) {
			for (let y0 = 1000; y0 + 120 <= 1600; y0 += 60) {
				for (const hgt of [120, 200, 300, 420]) {
					const c = crop(g, x0, y0, wdw, hgt);
					if (c.w < 200 || c.h < 60) continue;
					const r = zxDecode(resampleBilinear(c, 2), true);
					tried++;
					if (r.text === '3038352875035') {
						hits.push(`x${x0}+${wdw} y${y0}+${hgt}`);
						if (hits.length <= 5) console.log(`  ✅ LU : crop x${x0}..${x0 + wdw} y${y0}..${y0 + hgt} (${r.ms.toFixed(0)} ms)`);
					}
				}
			}
		}
	}
	console.log(`  ${tried} fenêtres testées en ${((performance.now() - t0all) / 1000).toFixed(0)} s → ${hits.length} lecture(s)`);
	if (hits.length > 5) console.log(`  … +${hits.length - 5} autres`);

	// 3. Corrélation 1D sur la zone la plus prometteuse (centrale).
	for (const [label, y0, y1] of [['bande 1100-1350', 1100, 1350], ['bande 1150-1400', 1150, 1400]] as const) {
		const prof = new Float32Array(Math.round(g.w * 0.9));
		const xa = Math.round(g.w * 0.05);
		for (let x = 0; x < prof.length; x++) {
			let m = 0;
			for (let y = y0; y <= y1; y++) m = Math.max(m, g.d[y * g.w + xa + x]);
			prof[x] = m;
		}
		const t = otsuRange(prof);
		const bc = bestCorr(prof, t, 8.2);
		console.log(`corrélation 1D max (${label}, seuil ${t}): ${(bc.score * 100).toFixed(1)} % @ m=${bc.m.toFixed(1)} (hasard ≈ 50 %)`);
	}
}
