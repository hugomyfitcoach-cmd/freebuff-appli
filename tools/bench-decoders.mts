/**
 * Benchmark décodeurs V3.3 — corpus synthétique reproductible : EAN-13
 * dessiné pixel par pixel (algorithme LS/GS standard) + variations de taille
 * (module px), niveau de chiffres, bruit, inclinaison.
 * Exécution : node --experimental-strip-types tools/bench-decoders.mts
 * Objectif : vérifier sur le même backend que l'app (ZXing vendored) si le
 * moteur sait lire 3038352875035 et les conditions terrains difficiles.
 */
import {
	MultiFormatReader,
	// @ts-expect-error — classes internes du UMD vendored (types partiels)
	HTMLCanvasElementLuminanceSource,
	HybridBinarizer,
	BinaryBitmap,
	DecodeHintType,
	BarcodeFormat,
} from '../node_modules/html5-qrcode/third_party/zxing-js.umd.js';

// ── Rendu EAN-13 (barres = pattern standard, chiffres stylisés) ──────────────
const L = {
	A: ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'],
	B: ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'],
	C: ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'],
} as const;
/** Patterns de parité « gauche » du 1er chiffre (GS1). */
const FIRST_PARITY = ['AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB', 'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA'] as const;

function ean13Bits(code: string): string {
	const d = code.split('').map(Number);
	const parity = FIRST_PARITY[d[0]];
	let bits = '101';
	for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'A' ? L.A : L.B)[d[i]];
	bits += '01010';
	for (let i = 7; i <= 12; i++) bits += L.C[d[i]];
	bits += '101';
	return bits;
}

type Gray = { w: number; h: number; d: Uint8Array };

function render(opts: {
	code: string;
	modulePx: number;
	barsH?: number;
	pad?: number;
	noise?: number; // ±valeur en niveaux de gris
	skewDeg?: number;
	digits?: boolean;
}): Gray {
	const { code, modulePx } = opts;
	const barsH = opts.barsH ?? 120;
	const pad = opts.pad ?? 10;
	const bits = ean13Bits(code);
	const W = bits.length * modulePx + 2 * pad;
	const H = barsH + 2 * pad + 26;
	const img = new Uint8Array(W * H).fill(255);
	const set = (x: number, y: number, v: number) => {
		if (x >= 0 && x < W && y >= 0 && y < H) img[y * W + x] = v;
	};
	const skew = opts.skewDeg ? Math.round(barsH * Math.tan((opts.skewDeg * Math.PI) / 180)) : 0;
	for (let i = 0; i < bits.length; i++) {
		if (bits[i] !== '1') continue;
		for (let xm = 0; xm < modulePx; xm++) {
			const x0 = pad + i * modulePx + xm;
			for (let y = 0; y < barsH; y++) {
				const sh = skew ? Math.round((y / barsH) * skew) : 0;
				set(x0 + sh, pad + y, 0);
			}
		}
	}
	if (opts.digits !== false) {
		// Chiffres sous les barres (police 5×7 stylisée, hauteur ~14 px, écartés).
		const FONT: Record<string, number[]> = {
			0: [7, 5, 5, 5, 5, 5, 7], 1: [2, 6, 2, 2, 2, 2, 7],
			2: [7, 1, 1, 7, 4, 4, 7], 3: [7, 1, 1, 7, 1, 1, 7],
			4: [5, 5, 5, 7, 1, 1, 1], 5: [7, 4, 4, 7, 1, 1, 7],
			6: [7, 4, 4, 7, 5, 5, 7], 7: [7, 1, 1, 1, 1, 1, 1],
			8: [7, 5, 5, 7, 5, 5, 7], 9: [7, 5, 5, 7, 1, 1, 7],
		};
		const gH = 7, gW = 3, scale = 2; // caractères ~14 px de haut
		const gap = 6;
		const totalW = 13 * gW * scale + 12 * gap;
		const startX = Math.max(0, Math.round((W - totalW) / 2));
		for (let i = 0; i < 13; i++) {
			const g = FONT[code[i]];
			for (let r = 0; r < gH; r++) {
				for (let c = 0; c < gW; c++) {
					if ((g[r] >> (gW - 1 - c)) & 1) {
						for (let sy = 0; sy < scale; sy++) {
							for (let sx = 0; sx < scale; sx++) {
								set(startX + i * (gW * scale + gap) + c * scale + sx, pad + barsH + 4 + Math.round(r * scale) + sy, 0);
							}
						}
					}
				}
			}
		}
	}
	if (opts.noise) {
		for (let i = 0; i < img.length; i++) {
			const n = (Math.random() * 2 - 1) * opts.noise;
			img[i] = Math.max(0, Math.min(255, Math.round(img[i] + n)));
		}
	}
	return { w: W, h: H, d: img };
}

/** Extrait le canal luminance (approximation : moyenne RGB simple — l'image est
 *  des bars noires sur blanc + chiffres, la précision couleur est non critique). */
function grayToImageData8(gray: Gray): { width: number; height: number; data: Uint8ClampedArray } {
	const data = new Uint8ClampedArray(gray.w * gray.h * 4);
	for (let i = 0; i < gray.w * gray.h; i++) {
		const v = gray.d[i];
		data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = v;
		data[4 * i + 3] = 255;
	}
	return { width: gray.w, height: gray.h, data };
}

/** Adapte le canvas HTML minimal attendu par HTMLCanvasElementLuminanceSource. */
function fakeCanvas(gray: Gray, opts: { mirrored?: boolean; rotate?: 'cw' | 'ccw' | undefined } = {}): HTMLCanvasElement {
	const { width, height, data } = grayToImageData8(gray);
	const ctx = {
		getImageData: (sx: number, sy: number, sw: number, sh: number) => {
			// Retourne les pixels demandés (source est déjà prête).
			void sx; void sy; void sw; void sh;
			return { data: new Uint8ClampedArray(data.buffer.slice(0)), width, height };
		},
	};
	// Prototypage minimal — le UMD vendored lit surtout width/height et getImageData.
	return {
		width, height,
		style: {},
		getContext: (_: string) => ctx,
	} as unknown as HTMLCanvasElement;
}

const HINTS = new Map();
HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
	BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
	BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.ITF, BarcodeFormat.CODE_39,
]);
const HINTS_TH = new Map(HINTS);
HINTS_TH.set(DecodeHintType.TRY_HARDER, true);

function decodeZxing(gray: Gray, tryHarder: boolean): { text: string | null; ms: number } {
	const reader = new MultiFormatReader(false, tryHarder ? HINTS_TH : HINTS);
	const canvas = fakeCanvas(gray);
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

// ── Scénarios ───────────────────────────────────────────────────────────────
const CODE = '3038352875035';
const scenarios = [
	{ name: 'ideal (module 4px)', gen: { code: CODE, modulePx: 4 } },
	{ name: 'module 3px',        gen: { code: CODE, modulePx: 3 } },
	{ name: 'module 2px',        gen: { code: CODE, modulePx: 2 } },
	{ name: 'module 1px (hard)', gen: { code: CODE, modulePx: 1 } },
	{ name: 'bruit ±40',         gen: { code: CODE, modulePx: 3, noise: 40 } },
	{ name: 'bruit ±80',         gen: { code: CODE, modulePx: 3, noise: 80 } },
	{ name: 'skew 2°',           gen: { code: CODE, modulePx: 3, skewDeg: 2 } },
	{ name: 'skew 5°',           gen: { code: CODE, modulePx: 3, skewDeg: 5 } },
	{ name: 'sans chiffres',     gen: { code: CODE, modulePx: 3, digits: false } },
	{ name: '1px + bruit ±60',   gen: { code: CODE, modulePx: 1, noise: 60 } },
];
console.log(`code de test : ${CODE} (checksum ${checksum(CODE) ? 'OK' : 'KO'})\n`);
let pass = 0, total = 0, missed: string[] = [];
for (const s of scenarios) {
	for (const th of [false, true]) {
		const gray = render(s.gen as never);
		const { text, ms } = decodeZxing(gray, th);
		total++;
		const ok = text === CODE;
		if (ok) pass++;
		else missed.push(`${s.name} (tryHarder=${th}) → lu: ${text ?? '—'}`);
		console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(20)} tryHarder=${String(th).padEnd(5)} ${ms.toFixed(0).padStart(4)} ms${text && text !== CODE ? `  → LU: ${text}` : ''}`);
	}
}
console.log(`\n${pass}/${total} réussis.`);
if (missed.length) console.log('\nÉchecs :');
for (const m of missed) console.log('  · ' + m);

function checksum(d: string): boolean {
	let sum = 0;
	for (let i = d.length - 2; i >= 0; i--) sum += Number(d[i]) * ((d.length - 2 - i) % 2 === 0 ? 3 : 1);
	return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}
