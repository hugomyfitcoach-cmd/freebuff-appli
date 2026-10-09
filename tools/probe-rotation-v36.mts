/**
 * Sonde V3.6 — rotation 90°, zone visuelle vs zone analysée, recadrage serré.
 *
 * Mesure sur chaque capture passée en argument (frames réelles) :
 *   1. contenu par défaut : passes plein cadre (léger sans TH) et TH —
 *      détection du code horizontal vs vertical ;
 *   2. crop SERRÉ V3.5 (60 % × 18 % centré) : léger / TH ;
 *   3. crop SERRÉ re-roté 90° (t_DIR) + TH — mesure du manque de rotation
 *      après recadrage serré sur code vertical ;
 *   4. crop APP ×2 (80 % × 44 % upscalé) léger / TH ;
 *   5. synthèse : quelle zone analyse quoi, quelles orientations décrochent.
 *
 *   node --experimental-strip-types tools/probe-rotation-v36.mts <PNG...>
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

/** Rotation 90° (direction : -1 horaire, +1 antihoraire) sur une image grise. */
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

/** Crop centré proportionnel (reprenant les formules exactes V3.5/V3). */
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

/* ── Analyse complète d'une capture ─────────────────────────────────────── */
for (const p of process.argv.slice(2)) {
	const g = decodePng(p);
	const name = p.split('/').pop() ?? p;
	console.log(`\n════ ${name} (${g.w}×${g.h}) ════`);

	// Détection optimiste de l'orientation du code : compte de barres sombres
	// fines (transitions) le long des lignes et le long des colonnes.
	function transitions(isColumn: boolean): number {
		let n = 0;
		if (isColumn) {
			for (let x = 0; x < g.w; x++) {
				let prev = g.d[0 * g.w + x];
				for (let y = 1; y < g.h; y++) {
					const v = g.d[y * g.w + x];
					if ((v < 110) !== (prev < 110)) n++;
					prev = v;
				}
			}
		} else {
			for (let y = 0; y < g.h; y++) {
				let prev = g.d[y * g.w];
				for (let x = 1; x < g.w; x++) {
					const v = g.d[y * g.w + x];
					if ((v < 110) !== (prev < 110)) n++;
					prev = v;
				}
			}
		}
		return n;
	}
	const tRows = transitions(false) / g.h;  // transitions par ligne (code horizontal)
	const tCols = transitions(true) / g.w;   // transitions par colonne (code vertical)
	console.log(`transitions/ligne=${tRows.toFixed(1)} · transitions/colonne=${tCols.toFixed(1)} → orientation suspectée : ${tRows > tCols ? 'HORIZONTALE' : 'VERTICALE (90°)'}`);

	// ── 1. Plein cadre par défaut ──
	const full = zxDecode(g, false);
	const fullTh = zxDecode(g, true);
	console.log(`plein cadre léger : ${full.text ?? '—'} (${full.ms.toFixed(0)} ms) | TH : ${fullTh.text ?? '—'} (${fullTh.ms.toFixed(0)} ms)`);

	// ── 2. Crop serré V3.5 (60 % × 18 %, cy = 48 %) : léger / TH ──
	const tight = crop(g, 0.6, 0.18, 0.48);
	const tightL = zxDecode(tight, false);
	const tightTh = zxDecode(tight, true);
	console.log(`tight 60%×18% léger : ${tightL.text ?? '—'} (${tightL.ms.toFixed(0)} ms) | TH : ${tightTh.text ?? '—'} (${tightTh.ms.toFixed(0)} ms)`);

	// ── 3. Tight re-roté 90° + TH (ce que NE fait PAS le code) ──
	const tightRot = rotate90(tight, -1);
	const tightRotTh = zxDecode(tightRot, true);
	console.log(`tight rot90 TH     : ${tightRotTh.text ?? '—'} (${tightRotTh.ms.toFixed(0)} ms)`);

	// ── 4. Crop app ×2 (80 % × 44 %, cy = 48 %) : léger / TH ──
	const cw2 = Math.round(0.8 * g.w), ch2 = Math.round(0.44 * g.h);
	const cx2 = Math.round((g.w - cw2) / 2);
	const cy2 = Math.max(0, Math.round(g.h * 0.48 - ch2 / 2));
	const up = { w: cw2 * 2, h: ch2 * 2, d: new Uint8Array(cw2 * 2 * ch2 * 2) };
	// Facteur voisin le plus proche (approx) : simple nearest-neighbor ×2.
	const small = crop(g, 0.8, 0.44, 0.48);
	for (let y = 0; y < up.h; y++)
		for (let x = 0; x < up.w; x++) up.d[y * up.w + x] = small.d[Math.min(ch2 - 1, Math.floor(y / 2)) * cw2 + Math.min(cw2 - 1, Math.floor(x / 2))];
	const upL = zxDecode(up, false);
	const upTh = zxDecode(up, true);
	console.log(`crop app ×2 léger  : ${upL.text ?? '—'} (${upL.ms.toFixed(0)} ms) | TH : ${upTh.text ?? '—'} (${upTh.ms.toFixed(0)} ms)`);

	// ── 5. Crop app ROTÉ 90° TH (repèrecodec verticaux) ──
	const smallRot = rotate90(small, -1);
	const appRotTh = zxDecode(smallRot, true);
	console.log(`crop app rot90 TH  : ${appRotTh.text ?? '—'} (${appRotTh.ms.toFixed(0)} ms)`);

	// ── 6. Tight du payload tourné : la passe serrée NE re-que pas après recadrage.
	const tight2 = crop(g, 0.18, 0.6, 0.48); // bandeau vertical équivalent
	const tvTh = zxDecode(tight2, true);
	console.log(`tight VERT (18%×60%, simule code vertical) TH : ${tvTh.text ?? '—'} (${tvTh.ms.toFixed(0)} ms)`);
}
