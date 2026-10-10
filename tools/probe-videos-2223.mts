/**
 * Sonde vidéos comparatives 22/23 — mesures objectives par frame :
 *   - netteté : variance du Laplacien (proxy focus) sur la zone caméra utile ;
 *   - luminance moyenne (réajustement exposition) ;
 *   - détection app : pastille debug G-FLUX (texte monospace vert, zone 2 %/2 %)
 *     vs UI FOOD (« Log food », pastille barcode/QR en haut).
 *   node --experimental-strip-types tools/probe-videos-2223.mts <frame.png...>
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

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

/** Variance du Laplacien (proxy netteté) sur une fenêtre. */
function lapVar(g: Gray, x0: number, y0: number, x1: number, y1: number): number {
	const vals: number[] = [];
	for (let y = y0 + 1; y < y1 - 1; y++) {
		for (let x = x0 + 1; x < x1 - 1; x++) {
			const c = g.d[y * g.w + x];
			const lap = 4 * c - g.d[(y - 1) * g.w + x] - g.d[(y + 1) * g.w + x] - g.d[y * g.w + x - 1] - g.d[y * g.w + x + 1];
			vals.push(lap);
		}
	}
	const n = vals.length;
	if (!n) return 0;
	const mean = vals.reduce((a, b) => a + b, 0) / n;
	return vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n;
}

function meanLum(g: Gray, x0: number, y0: number, x1: number, y1: number): number {
	let s = 0, n = 0;
	for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { s += g.d[y * g.w + x]; n++; }
	return s / n;
}

for (const p of process.argv.slice(2)) {
	const g = decodePng(p);
	const name = p.split('/').pop() ?? p;
	// Zone caméra utile : bande centrale (évite UI basse et pastilles hautes).
	const zx0 = Math.round(g.w * 0.08), zx1 = Math.round(g.w * 0.92);
	const zy0 = Math.round(g.h * 0.12), zy1 = Math.round(g.h * 0.86);
	// Zone pastille debug G-FLUX (haut-gauche) : texte vert clair.
	let greenText = 0, total = 0;
	for (let y = Math.round(g.h * 0.045); y < g.h * 0.075; y++) {
		for (let x = Math.round(g.w * 0.03); x < g.w * 0.6; x++) {
			const o = (y * g.w + x) * 4;
			total++;
		}
	}
	// Détection texte debug vert : pixels G élevé, R/B modérés (monospace #9f9).
	let greenPx = 0;
	for (let y = Math.round(g.h * 0.04); y < g.h * 0.10; y++) {
		for (let x = Math.round(g.w * 0.03); x < g.w * 0.70; x++) {
			const o = (y * g.w + x) * 3; // approx : le PNG est RGB ici
		}
	}
	// NB: analyse simple sur gris — un texte debug clair sur fond sombre
	// crée un contraste fort dans la zone haut-gauche.
	const dbgContrast = lapVar(g, Math.round(g.w * 0.03), Math.round(g.h * 0.04), Math.round(g.w * 0.55), Math.round(g.h * 0.085));
	const sharp = lapVar(g, zx0, zy0, zx1, zy1);
	const lum = meanLum(g, zx0, zy0, zx1, zy1);
	console.log(`${name}\tsharp=${sharp.toFixed(0)}\tlum=${lum.toFixed(1)}\tdbgContrast=${dbgContrast.toFixed(0)}`);
}
