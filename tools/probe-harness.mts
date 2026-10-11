/**
 * Validation du harnais + dumps visuels des images intermédiaires.
 *   node --experimental-strip-types tools/probe-harness.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
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

/* Mini PNG writer (RGB 8 bits, filtre 0) — pour inspection humaine. */
export function writePngRgb(path: string, w: number, h: number, rgb: Uint8Array): void {
	const stride = w * 3;
	const raw = Buffer.alloc((stride + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (stride + 1)] = 0;
		Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	const chunks: Buffer[] = [];
	const crcTable = (() => {
		const t = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			t[n] = c >>> 0;
		}
		return t;
	})();
	const crc32 = (b: Buffer) => {
		let c = 0xffffffff;
		for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
		chunks.push(len, td, crc);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; ihdr[9] = 2;
	chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	chunk('IHDR', ihdr);
	chunk('IDAT', deflateSync(raw));
	chunk('IEND', Buffer.alloc(0));
	writeFileSync(path, Buffer.concat(chunks));
}

export function grayToPng(path: string, g: Gray): void {
	const rgb = new Uint8Array(g.w * g.h * 3);
	for (let i = 0; i < g.w * g.h; i++) rgb[3 * i] = rgb[3 * i + 1] = rgb[3 * i + 2] = g.d[i];
	writePngRgb(path, g.w, g.h, rgb);
}

/* Décodeur PNG (copie de analyze-real-capture.mts) */
export function decodePng(path: string): Gray {
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

/* Sanity check : EAN-13 synthétique à 3 px/module DOIT être lu par le harnais. */
function synthetic(): Gray {
	const code = '3038352875035';
	const P = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
	const E = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
	const C = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1001000','1001000','1110100'];
	// ⚠️ recopie prudente : utilise les tables exactes ci-dessous
	const CL = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
	void C;
	const PARITY = ['AAAAAA','AABABB','AABBAB','AABBBA','ABAABB','ABBAAB','ABBBAA','ABABAB','ABABBA','ABBABA'];
	const bits = '101' + code.slice(1, 7).split('').map((d, i) => (PARITY[Number(code[0])][i] === 'A' ? P : E)[Number(d)]).join('') + '01010' + code.slice(7).split('').map((d) => CL[Number(d)]).join('') + '101';
	const m = 3, pad = 20, W = bits.length * m + 2 * pad, H = 120;
	const d = new Uint8Array(W * H).fill(255);
	for (let i = 0; i < bits.length; i++) {
		if (bits[i] !== '1') continue;
		for (let x = 0; x < m; x++) for (let y = 0; y < H; y++) d[y * W + pad + i * m + x] = 0;
	}
	return { w: W, h: H, d };
}

const g = synthetic();
const r = zxDecode(g, false);
console.log(`sanity synthétique 3px/module → ${r.text ?? '—'} (${r.ms.toFixed(0)} ms)`);
if (!r.text) {
	console.log('❌ HARNAIS EN PANNE — tous les résultats « — » sont suspects');
	process.exit(1);
}

/* Dumps des captures réelles pour inspection */
for (const p of process.argv.slice(2)) {
	const img = decodePng(p);
	const base = (p.split('/').pop() ?? 'img').replace(/\.PNG$/i, '');
	grayToPng(`/tmp/harness-${base}-full.png`, img);
	console.log(`dump /tmp/harness-${base}-full.png (${img.w}×${img.h})`);
}
