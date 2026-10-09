/**
 * Sonde — débugger les deux cas FAIL du bench : « ideal (module 4px) » et
 * « bruit ±80 ». On instrumente decodeMiddle/decodeRow à la main (portage du
 * décodeur EAN-13 ZXing en accès direct) pour trouver l'étape qui casse.
 */
import {
	MultiFormatReader,
	// @ts-expect-error — classe interne du UMD vendored
	HTMLCanvasElementLuminanceSource,
	HybridBinarizer,
	BinaryBitmap,
	DecodeHintType,
	BarcodeFormat,
} from '../node_modules/html5-qrcode/third_party/zxing-js.umd.js';

const L = {
	A: ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'],
	B: ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'],
	C: ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'],
} as const;
const FIRST_PARITY = ['AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB', 'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA'] as const;
function ean13Bits(code: string): string {
	const d = code.split('').map(Number);
	const p = FIRST_PARITY[d[0]];
	let bits = '101';
	for (let i = 1; i <= 6; i++) bits += (p[i - 1] === 'A' ? L.A : L.B)[d[i]];
	bits += '01010';
	for (let i = 7; i <= 12; i++) bits += L.C[d[i]];
	return bits + '101';
}
type Gray = { w: number; h: number; d: Uint8Array };
function render(opts: { code: string; modulePx: number; barsH?: number; pad?: number; noise?: number; digits?: boolean }): Gray {
	const { code, modulePx } = opts;
	const barsH = opts.barsH ?? 120;
	const pad = opts.pad ?? 10;
	const bits = ean13Bits(code);
	const W = bits.length * modulePx + 2 * pad;
	const H = barsH + 2 * pad + 26;
	const img = new Uint8Array(W * H).fill(255);
	const set = (x: number, y: number, v: number) => { if (x >= 0 && x < W && y >= 0 && y < H) img[y * W + x] = v; };
	for (let i = 0; i < bits.length; i++) {
		if (bits[i] !== '1') continue;
		for (let xm = 0; xm < modulePx; xm++) for (let y = 0; y < barsH; y++) set(pad + i * modulePx + xm, pad + y, 0);
	}
	if (opts.digits !== false) {
		const FONT: Record<string, number[]> = {
			'0': [7, 5, 5, 5, 5, 5, 7], '1': [2, 6, 2, 2, 2, 2, 7],
			'2': [7, 1, 1, 7, 4, 4, 7], '3': [7, 1, 1, 7, 1, 1, 7],
			'4': [5, 5, 5, 7, 1, 1, 1], '5': [7, 4, 4, 7, 1, 1, 7],
			'6': [7, 4, 4, 7, 5, 5, 7], '7': [7, 1, 1, 1, 1, 1, 1],
			'8': [7, 5, 5, 7, 5, 5, 7], '9': [7, 5, 5, 7, 1, 1, 7],
		};
		const gH = 7, gW = 3, scale = 2, gap = 6;
		const totalW = 13 * gW * scale + 12 * gap;
		const startX = Math.max(0, Math.round((W - totalW) / 2));
		for (let i = 0; i < 13; i++) {
			const g = FONT[code[i]];
			for (let r = 0; r < gH; r++) for (let c = 0; c < gW; c++) {
				if ((g[r] >> (gW - 1 - c)) & 1) {
					for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++)
						set(startX + i * (gW * scale + gap) + c * scale + sx, pad + barsH + 4 + Math.round(r * scale) + sy, 0);
				}
			}
		}
	}
	if (opts.noise) for (let i = 0; i < img.length; i++) {
		const n = (Math.random() * 2 - 1) * opts.noise;
		img[i] = Math.max(0, Math.min(255, Math.round(img[i] + n)));
	}
	return { w: W, h: H, d: img };
}

function decode(gray: Gray, tryHarder: boolean): { text: string | null; ms: number } {
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
	} catch { return { text: null, ms: performance.now() - t0 }; }
}

// ── Sonde A : « ideal 4px » avec et sans chiffres ──────────────────────────
for (const digits of [true, false]) {
	for (const barsH of [120, 60, 30]) {
		const g = render({ code: '3038352875035', modulePx: 4, barsH, digits });
		const r = decode(g, false);
		console.log(`ideal4  barsH=${String(barsH).padStart(3)} digits=${String(digits).padEnd(5)} w=${g.w} h=${g.h} → ${r.text ?? '—'} (${r.ms.toFixed(0)}ms)`);
	}
}
// ── Sonde B : bruit ±80 avec et sans chiffres ────────────────────────────
for (const digits of [true, false]) {
	for (const t of [0, 1, 2]) {
		const g = render({ code: '3038352875035', modulePx: 3, noise: 80, digits });
		const r = decode(g, false);
		console.log(`noise80 digits=${String(digits).padEnd(5)} essai#${t} → ${r.text ?? '—'} (${r.ms.toFixed(0)}ms)`);
	}
}
