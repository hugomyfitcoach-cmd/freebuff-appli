/**
 * TEST E2E PREVIEW — analyse d'étiquette IA sur la Deploy Preview.
 *
 * 1. Génère un PNG de test 800×600 (fond crème + barres, évoquant une
 *    étiquette) en pur Node — aucune dépendance.
 * 2. Connexion (identifiants de test preview, cf. previewSeed.ts).
 * 3. POST /api/foods/label-scan → OpenAI est réellement appelé (action
 *    Convex runtime node). Coût : quelques tokens, image factice.
 *
 * Usage : node scripts/test-label-preview.mjs [url-preview]
 */
import { deflateSync } from 'node:zlib';

const PREVIEW = process.argv[2] ?? 'https://deploy-preview-1--g-flux.netlify.app';

/* ── 1. PNG de test ─────────────────────────────────────────────── */
const W = 800;
const H = 600;
const T = new Int32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	T[n] = c;
}
const crc32 = (buf) => {
	let c = -1;
	for (const x of buf) c = T[(c ^ x) & 255] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const t = Buffer.from(type);
	const c = Buffer.alloc(4);
	c.writeUInt32BE(crc32(Buffer.concat([t, data])));
	return Buffer.concat([len, t, data, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // RGB
const rowLen = 1 + W * 3;
const raw = Buffer.alloc(H * rowLen);
for (let y = 0; y < H; y++) {
	const off = y * rowLen;
	raw[off] = 0; // filtre none
	for (let x = 0; x < W; x++) {
		const p = off + 1 + x * 3;
		if (y < 70) {
			raw[p] = 250; raw[p + 1] = 249; raw[p + 2] = 244; // bande claire
		} else if (y < 110) {
			raw[p] = 20; raw[p + 1] = 20; raw[p + 2] = 20; // bande sombre (texte)
		} else if (Math.floor(x / 40) % 2 === 0) {
			raw[p] = 255; raw[p + 1] = 255; raw[p + 2] = 255;
		} else {
			raw[p] = 247; raw[p + 1] = 245; raw[p + 2] = 240;
		}
	}
}
const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk('IHDR', ihdr),
	chunk('IDAT', deflateSync(raw)),
	chunk('IEND', Buffer.alloc(0)),
]);
const dataUrl = 'data:image/png;base64,' + png.toString('base64');

/* ── 2. Connexion preview ───────────────────────────────────────── */
const login = await fetch(`${PREVIEW}/connexion?/login`, {
	method: 'POST',
	headers: { Origin: PREVIEW, 'Content-Type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams({ email: 'contact@myfit-coach.fr', password: 'PreviewBeta2026!' }),
	redirect: 'manual',
});
const setCookies = login.headers.getSetCookie?.() ?? [];
const cookie = setCookies.map((s) => s.split(';')[0]).join('; ');
console.log('login:', login.status, cookie ? '→ session OK' : '→ PAS DE COOKIE');
if (!cookie) process.exit(1);

/* ── 3. Analyse d'étiquette (vrai appel OpenAI côté Convex) ─────── */
const res = await fetch(`${PREVIEW}/api/foods/label-scan`, {
	method: 'POST',
	headers: { Origin: PREVIEW, 'Content-Type': 'application/json', Cookie: cookie },
	body: JSON.stringify({ imageDataUrl: dataUrl }),
});
const j = await res.json();
console.log('label-scan: HTTP', res.status, JSON.stringify(j).slice(0, 400));
