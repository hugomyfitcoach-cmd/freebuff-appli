/** Sonde OCR en PGM (format natif tesseract) : lecture de la bande de chiffres. */
import { writeFile } from 'node:fs/promises';
import { createWorker } from 'tesseract.js';
import { renderEan13Gray, checksum, CODE, type Gray } from './bench-corpus.mts';

function bandPgm(gray: Gray): Buffer {
	const top = Math.floor(gray.h * 0.82);
	const h = gray.h - top;
	const header = Buffer.from(`P5\n${gray.w} ${h}\n255\n`);
	const b = Buffer.alloc(gray.w * h);
	for (let y = 0; y < h; y++) for (let x = 0; x < gray.w; x++) b[y * gray.w + x] = gray.d[(top + y) * gray.w + x];
	return Buffer.concat([header, b]);
}
const w = await createWorker('eng');
await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '6' });
for (const code of [CODE, '3760029501318']) {
	const gray = renderEan13Gray({ code, modulePx: 4 });
	const p = `/tmp/band-${code}.pgm`;
	await writeFile(p, bandPgm(gray));
	const { data } = await w.recognize(p);
	const raw = data.text.replace(/\D/g, '');
	const m13 = (data.text.match(/\d{13}/g) ?? []).find((x) => checksum(x));
	const shown = m13 ?? (raw || '—');
	console.log(`${code}: brut=${JSON.stringify(data.text)} → ${shown} conf=${data.confidence.toFixed(0)}%`);
}
await w.terminate();
