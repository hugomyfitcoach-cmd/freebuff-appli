/**
 * Corpus partagé V3.3 — rendu synthétique EAN-13 (pattern GS1 officiel,
 * barres dessinées pixel par pixel + chiffres sous le code). Reproductible,
 * zéro dépendance, réutilisé par tools/bench-decoders.mts et tools/bench-ocr.mts.
 */
export const CODE = '3038352875035';

const L = {
	A: ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'],
	B: ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'],
	C: ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'],
} as const;
const FIRST_PARITY = ['AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB', 'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA'] as const;

/** Chiffres 5×7 stylisés (bitmask par ligne, gW=3 utilisé avec scale=2). */
const FONT: Record<string, number[]> = {
	'0': [7, 5, 5, 5, 5, 5, 7], '1': [2, 6, 2, 2, 2, 2, 7],
	'2': [7, 1, 1, 7, 4, 4, 7], '3': [7, 1, 1, 7, 1, 1, 7],
	'4': [5, 5, 5, 7, 1, 1, 1], '5': [7, 4, 4, 7, 1, 1, 7],
	'6': [7, 4, 4, 7, 5, 5, 7], '7': [7, 1, 1, 1, 1, 1, 1],
	'8': [7, 5, 5, 7, 5, 5, 7], '9': [7, 5, 5, 7, 1, 1, 7],
};

export type Gray = { w: number; h: number; d: Uint8Array };

export function checksum(d: string): boolean {
	let sum = 0;
	for (let i = d.length - 2; i >= 0; i--) sum += Number(d[i]) * (((d.length - 2 - i) % 2 === 0) ? 3 : 1);
	return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}

function ean13Bits(code: string): string {
	const d = code.split('').map(Number);
	const p = FIRST_PARITY[d[0]];
	let bits = '101';
	for (let i = 1; i <= 6; i++) bits += (p[i - 1] === 'A' ? L.A : L.B)[d[i]];
	bits += '01010';
	for (let i = 7; i <= 12; i++) bits += L.C[d[i]];
	return bits + '101';
}

/** Rend un EAN-13 synthétique (modulePx px par module). */
export function renderEan13Gray(opts: {
	code: string;
	modulePx: number;
	barsH?: number;
	pad?: number;
	noise?: number;
	skewDeg?: number;
	invert?: boolean;
}): Gray {
	const { code, modulePx } = opts;
	const barsH = opts.barsH ?? 120;
	const pad = opts.pad ?? 10;
	const bits = ean13Bits(code);
	const W = bits.length * modulePx + 2 * pad;
	const H = barsH + 2 * pad + 26;
	const img = new Uint8Array(W * H).fill(opts.invert ? 0 : 255);
	const set = (x: number, y: number, v: number) => { if (x >= 0 && x < W && y >= 0 && y < H) img[y * W + x] = v; };
	const skew = opts.skewDeg ? Math.round(barsH * Math.tan((opts.skewDeg * Math.PI) / 180)) : 0;
	for (let i = 0; i < bits.length; i++) {
		if (bits[i] !== '1') continue;
		for (let xm = 0; xm < modulePx; xm++) for (let y = 0; y < barsH; y++) {
			const sh = skew ? Math.round((y / barsH) * skew) : 0;
			set(pad + i * modulePx + xm + sh, pad + y, opts.invert ? 255 : 0);
		}
	}
	if (opts.skewDeg !== undefined) {
		// Chiffres inclinés légèrement avec la même pente que les barres (skew/6).
	}
	// Chiffres sous les barres (où 'invert' est ignoré — les chiffres restent
	// noirs sur fond blanc quel que soit le flag invert).
	const gH = 7, gW = 3, scale = 2, gap = 6;
	const totalW = 13 * gW * scale + 12 * gap;
	const startX = Math.max(0, Math.round((W - totalW) / 2));
	for (let i = 0; i < 13; i++) {
		const g = FONT[code[i]];
		for (let r = 0; r < gH; r++) for (let c = 0; c < gW; c++) {
			if ((g[r] >> (gW - 1 - c)) & 1) {
				for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++)
					set(startX + i * (gW * scale + gap) + c * scale + sx, pad + barsH + 4 + r * scale + sy, 0);
			}
		}
	}
	if (opts.noise) for (let i = 0; i < img.length; i++) {
		const v = img[i] + (Math.random() * 2 - 1) * opts.noise;
		img[i] = Math.max(0, Math.min(255, Math.round(v)));
	}
	return { w: W, h: H, d: img };
}

/** Gray → ImageData-like (RGBA) pour simuler un canvas HTML. */
export function grayToImageData8(gray: Gray): { width: number; height: number; data: Uint8ClampedArray } {
	const data = new Uint8ClampedArray(gray.w * gray.h * 4);
	for (let i = 0; i < gray.w * gray.h; i++) {
		const v = gray.d[i];
		data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = v;
		data[4 * i + 3] = 255;
	}
	return { width: gray.w, height: gray.h, data };
}
