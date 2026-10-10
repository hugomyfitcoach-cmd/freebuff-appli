/**
 * Mission V3.5 — comparaison de stratégies de décodage sur IMAGES RÉELLES
 * (captures d'écran iPhone du scanner en échec à distance, code 3038352875035).
 *
 * ⚠️ Limite honnête : une capture d'écran montre l'APERÇU (la vidéo affichée),
 * downscalée par le navigateur — les pixels du code sont donc PIREs que ce que
 * le décodeur reçoit du track 1080×1920. Une stratégie qui gagne ICI (avec
 * moins de pixels) a de fortes chances de gagner sur le flux réel.
 *
 * Stratégies comparées sur la MÊME image :
 *   S1 full frame, passe légère (sans TRY_HARDER)      ← passe 1 de l'app
 *   S2 full frame + TRY_HARDER                          ← passe 2 de l'app
 *   S3 crop app (0.8w × 0.44h) ×2 + TH                  ← passe 1.5 de l'app
 *   S4 ROI du cadre guide (3..97% × 26..70%) ×2 + TH    ← ciblage du cadre
 *   S5 BANDE HORIZONTALE : médiane de lignes du bandeau
 *      code-barres, upscalée ×2 + TH                    ← stratégie EAN dédiée
 *   S6 multirésolution : downscale ×0.5 + TH            ← antirepli flou
 *
 * Exécution : node --experimental-strip-types tools/analyze-real-capture.mts
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
	MultiFormatReader,
	// @ts-expect-error — classe interne du UMD vendored
	HTMLCanvasElementLuminanceSource,
	HybridBinarizer,
	BinaryBitmap,
	DecodeHintType,
	BarcodeFormat,
} from '../node_modules/html5-qrcode/third_party/zxing-js.umd.js';

/* ── Décodeur PNG minimal (RGBA/RGB 8 bits non entrelacé, via zlib) ─────── */
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
	if ((bitDepth !== 8 && bitDepth !== 16) || (colorType !== 6 && colorType !== 2))
		throw new Error(`PNG non supporté (depth=${bitDepth} color=${colorType})`);
	const sampleBytes = bitDepth / 8;
	const bpp = (colorType === 6 ? 4 : 3) * sampleBytes;
	const raw = inflateSync(Buffer.concat(idat));
	const stride = w * bpp;
	const px = Buffer.alloc(h * stride);
	// Dé-filtrage PNG (None/Sub/Up/Average/Paeth)
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
	// Luminance
	const g = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) {
		// 16 bits : octet de poids fort ; 8 bits : l'octet unique.
		const o = i * bpp;
		const r = sampleBytes === 2 ? px[o] : px[o];
		const gg = sampleBytes === 2 ? px[o + 2] : px[o + 1];
		const b = sampleBytes === 2 ? px[o + 4] : px[o + 2];
		g[i] = (r * 299 + gg * 587 + b * 114) / 1000;
	}
	return { w, h, d: g };
}

function readPgm(path: string): Gray {
	const buf = readFileSync(path);
	const m = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(buf.toString('binary', 0, 200));
	if (!m) throw new Error(`header PGM invalide : ${path}`);
	const w = Number(m[1]), h = Number(m[2]);
	const headerLen = m[0].length;
	return { w, h, d: new Uint8Array(buf.subarray(headerLen, headerLen + w * h)) };
}

/* ── Décodeur ZXing (canvas shim, comme les autres benchs) ──────────────── */
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

/** Zoom voisin le plus proche (facteur entier ou fractionnaire). */
function resample(g: Gray, fx: number, fy: number): Gray {
	const w = Math.round(g.w * fx), h = Math.round(g.h * fy);
	const d = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		const sy = Math.min(g.h - 1, Math.floor(y / fy));
		for (let x = 0; x < w; x++) {
			const sx = Math.min(g.w - 1, Math.floor(x / fx));
			d[y * w + x] = g.d[sy * g.w + sx];
		}
	}
	return { w, h, d };
}

function crop(g: Gray, cx: number, cy: number, cw: number, ch: number): Gray {
	cw = Math.min(cw, g.w - cx); ch = Math.min(ch, g.h - cy);
	const d = new Uint8Array(cw * ch);
	for (let y = 0; y < ch; y++) d.set(g.d.subarray((cy + y) * g.w + cx, (cy + y) * g.w + cx + cw), y * cw);
	return { w: cw, h: ch, d };
}

/* ── Localisation du bandeau code-barres (profil de densité sombre) ─────── */
type Band = { y0: number; y1: number; x0: number; x1: number; modulePx: number };

function findBarcodeBand(g: Gray): Band {
	// Colonnes centrales 10..90 % pour ignorer les bords de l'app.
	const xa = Math.round(g.w * 0.10), xb = Math.round(g.w * 0.90);
	const colW = xb - xa;
	const darkPerRow = new Float32Array(g.h);
	for (let y = 0; y < g.h; y++) {
		let n = 0;
		for (let x = xa; x < xb; x++) if (g.d[y * g.w + x] < 110) n++;
		darkPerRow[y] = n / colW;
	}
	// Fenêtre de hauteur ≈ 8 % de l'image : chercher la fenêtre au ratio sombre
	// max dans la moitié centrale verticale (le bandeau est dense en sombre).
	const win = Math.max(8, Math.round(g.h * 0.08));
	let bestY = Math.round(g.h * 0.3), bestV = 0;
	for (let y = Math.round(g.h * 0.2); y + win < Math.round(g.h * 0.85); y++) {
		let s = 0;
		for (let k = 0; k < win; k++) s += darkPerRow[y + k];
		const v = s / win;
		if (v > bestV) { bestV = v; bestY = y; }
	}
	// Étendre la bande verticalement tant que la densité reste > 60 % du max.
	const y0 = bestY, thr = bestV * 0.6;
	let y1 = bestY + win;
	while (y1 < g.h - 1 && darkPerRow[y1] > thr) y1++;
	let yStart = y0;
	while (yStart > 0 && darkPerRow[yStart - 1] > thr) yStart--;
	// Étendue horizontale : colonnes contenant du sombre dans la bande.
	const x0full = Math.round(g.w * 0.05), x1full = Math.round(g.w * 0.95);
	let x0 = x1full, x1 = x0full;
	for (let x = x0full; x < x1full; x++) {
		let dark = 0;
		for (let y = yStart; y < y1; y++) if (g.d[y * g.w + x] < 110) dark++;
		if (dark > (y1 - yStart) * 0.15) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
	}
	const widthPx = x1 - x0 + 1;
	// EAN-13 = 95 modules exactement (chiffres exclus).
	return { y0: yStart, y1, x0, x1, modulePx: widthPx / 95 };
}

/** S5 — bande horizontale : médiane des lignes du bandeau, ±marge, ×zoom. */
function bandImage(g: Gray, band: Band, zoom: number): Gray {
	const marge = Math.max(2, Math.round((band.y1 - band.y0) * 0.15));
	const y0 = Math.max(0, band.y0 - marge), y1 = Math.min(g.h - 1, band.y1 + marge);
	const xa = Math.max(0, band.x0 - 8), xb = Math.min(g.w - 1, band.x1 + 8);
	const w = xb - xa + 1, rows: number[] = [];
	for (let x = 0; x < w; x++) {
		const col: number[] = [];
		for (let y = y0; y <= y1; y++) col.push(g.d[y * g.w + xa + x]);
		col.sort((a, b) => a - b);
		rows.push(col[col.length >> 1]);
	}
	const h = Math.max(8, Math.round((y1 - y0 + 1) * 0.35));
	const d = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) d.set(rows, y * w);
	return resample({ w, h, d }, zoom, zoom);
}

/* ── Protocole sur une image réelle ─────────────────────────────────────── */
function analyze(name: string, g: Gray): void {
	console.log(`\n════ ${name} — ${g.w}×${g.h} ════`);
	const band = findBarcodeBand(g);
	const modulePx = band.modulePx.toFixed(2);
	const bandH = band.y1 - band.y0;
	console.log(`bande code-barres: x ${band.x0}..${band.x1} (l=${band.x1 - band.x0 + 1}px) y ${band.y0}..${band.y1} (h=${bandH}px) → ≈ ${modulePx} px/module`);

	const S = (label: string, img: Gray, th: boolean) => {
		const r = zxDecode(img, th);
		const ok = r.text === '3038352875035' ? '✅ LU' : r.text ? `⚠️ autre: ${r.text}` : '—';
		console.log(`  ${label.padEnd(46)} ${String(Math.round(img.w))}×${String(Math.round(img.h)).padEnd(5)} ${ok} (${r.ms.toFixed(0)} ms)`);
		return r.text === '3038352875035';
	};

	// S1/S2/S3 — exactement les passes de l'app.
	const s1 = S('S1 plein cadre léger (passe 1 app)', g, false);
	const s2 = S('S2 plein cadre + TRY_HARDER (passe 2)', g, true);
	const cw = Math.round(g.w * 0.8), ch = Math.round(g.h * 0.44);
	const cx = Math.round((g.w - cw) / 2), cy = Math.max(0, Math.round(g.h * (26 + 44 / 2) / 100 - ch / 2));
	const s3 = S('S3 crop app 0.8×0.44 ×2 (passe 1.5)', resample(crop(g, cx, cy, cw, ch), 2, 2), true);

	// S4 — ROI = cadre guide (3..97 % largeur, 26..70 % hauteur) ×2.
	const r4 = crop(g, Math.round(g.w * 0.03), Math.round(g.h * 0.26), Math.round(g.w * 0.94), Math.round(g.h * 0.44));
	const s4 = S('S4 ROI cadre guide ×2', resample(r4, 2, 2), true);

	// S5 — bande horizontale (médiane), ×1 / ×2 / ×3.
	const s5a = S('S5 bande horizontale ×1', bandImage(g, band, 1), true);
	const s5b = S('S5 bande horizontale ×2', bandImage(g, band, 2), true);
	const s5c = S('S5 bande horizontale ×3', bandImage(g, band, 3), true);

	// S6 — multirésolution : downscale puis TH (antirepli flou/sur-échantillonné).
	const s6 = S('S6 downscale ×0.5 + TH', resample(g, 0.5, 0.5), true);

	// S7 — bande au zoom où le module ≈ 2 px (optimum ZXing mesuré en V3.3).
	const idealZoom = band.modulePx > 0.5 ? 2 / band.modulePx : 1;
	if (idealZoom > 0.6 && idealZoom < 12) {
		S(`S7 bande ramenée à ≈2px/module (zoom ×${idealZoom.toFixed(2)})`, bandImage(g, band, idealZoom), true);
	}
	const n = [s1, s2, s3, s4, s5a, s5b, s5c, s6].filter(Boolean).length;
	console.log(`  → ${n}/8 stratégies lisent le code`);
}

/* ── Exécution ──────────────────────────────────────────────────────────── */
const PNGS = process.argv.slice(2).filter((p) => p.endsWith('.PNG') || p.endsWith('.png'));
const PGMS = process.argv.slice(2).filter((p) => p.endsWith('.pgm'));
for (const p of PNGS) analyze(p.split('/').pop() ?? p, decodePng(p));
for (const p of PGMS) analyze(p.split('/').pop() ?? p, readPgm(p));
if (PNGS.length === 0 && PGMS.length === 0) {
	// Défaut : frames PGM déjà extraites de la vidéo terrain (si présentes).
	for (let i = 0; i < 10; i++) {
		try { analyze(`vid-frame-${i}.pgm`, readPgm(`/tmp/vid-frame-${i}.pgm`)); } catch { break; }
	}
}
