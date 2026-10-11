/**
 * Banc OCR final V3.3 — bande de chiffres d'un EAN-13 synthétique.
 * Tenter la lecture des chiffres imprimés avec tesseract.js (Node),
 * whitelist digits + checksum GS1.
 * Exécution : node --experimental-strip-types tools/bench-ocr-run.mts
 */
import { writeFile } from 'node:fs/promises';
import { createWorker } from 'tesseract.js';
import { renderEan13Gray, checksum, CODE, type Gray } from './bench-corpus.mts';

function grayToBmp24(gray: Gray): Uint8Array {
	const W = gray.w, H = gray.h, rowSize = Math.ceil(W * 3 / 4) * 4, px = rowSize * H, size = 54 + px;
	const buf = new Uint8Array(size).fill(0xff);
	buf[0] = 0x42; buf[1] = 0x4d;
	const w32 = (o: number, v: number) => { buf[o] = v & 0xff; buf[o + 1] = (v >>> 8) & 0xff; buf[o + 2] = (v >>> 16) & 0xff; buf[o + 3] = (v >>> 24) & 0xff; };
	const w16 = (o: number, v: number) => { buf[o] = v & 0xff; buf[o + 1] = (v >>> 8) & 0xff; };
	w32(2, size); w32(10, 54); w32(14, 40); w32(18, W); w32(22, H); w16(26, 1); w16(28, 24); w32(30, 0); w32(34, px);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const v = gray.d[(H - 1 - y) * W + x];
		const off = 54 + y * rowSize + x * 3;
		buf[off] = buf[off + 1] = buf[off + 2] = v;
	}
	return buf;
}
/** Extrait le bas de l'image (bande des chiffres imprimés). */
function digitsBand(gray: Gray): Gray {
	const top = Math.floor(gray.h * 0.82);
	const d = new Uint8Array(gray.w * (gray.h - top));
	for (let y = top; y < gray.h; y++) for (let x = 0; x < gray.w; x++) d[(y - top) * gray.w + x] = gray.d[y * gray.w + x];
	return { w: gray.w, h: gray.h - top, d };
}

const w = await createWorker('eng');
await w.setParameters({ tessedit_char_whitelist: '0123456789' });
for (const code of [CODE, '3760029501318', '7622210449283']) {
	const full = renderEan13Gray({ code, modulePx: 4 });
	const band = digitsBand(full);
	const p = `/tmp/band-${code}.bmp`;
	await writeFile(p, grayToBmp24(band));
	const t0 = Date.now();
	const { data } = await w.recognize(p);
	const ms = Date.now() - t0;
	const raw = data.text.replace(/\D/g, '');
	const m13 = (data.text.match(/\d{13}/g) ?? []).find((x) => checksum(x));
	const shown = m13 ?? (raw || '—');
	console.log(`${code} — brut="${data.text.replace(/\s+/g, ' ')}" → ${shown} (${ms} ms, conf ${data.confidence.toFixed(0)}%)`);
}
await w.terminate();
