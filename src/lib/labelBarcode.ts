/**
 * Lecture de code-barres DANS une photo (côté navigateur) — utilisée par le
 * flux « Photographier une étiquette » : si un code-barres est visible sur la
 * photo, il est décodé par le VRAI décodeur (ZXing, déjà embarqué via
 * html5-qrcode — le même moteur que le scanner) et transmis au backend avec
 * l'image. On ne demande JAMAIS à OpenAI de deviner un numéro.
 *
 * La photo est d'abord redimensionnée/compresée (JPEG ≤ 1400 px, qualité 0.82)
 * : upload léger, analyse Vision plus rapide, tokens économisés.
 */

type ZXing = {
	MultiFormatReader: new (
		verbose: boolean,
		hints: Map<number, unknown>
	) => { decode(binaryBitmap: unknown): { text: string } };
	HTMLCanvasElementLuminanceSource: new (canvas: HTMLCanvasElement) => unknown;
	HybridBinarizer: new (source: unknown) => unknown;
	BinaryBitmap: new (binarizer: unknown) => unknown;
	DecodeHintType: { POSSIBLE_FORMATS: number; TRY_HARDER: number };
	BarcodeFormat: { EAN_13: number; EAN_8: number; UPC_A: number; UPC_E: number };
};

/** Redimensionne + compresse une photo en JPEG (dataURL) — max 1400 px. */
export async function compressImage(file: File | Blob, maxSide = 1400, quality = 0.82): Promise<string> {
	const bitmap = await createImageBitmap(file);
	try {
		const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
		const w = Math.max(1, Math.round(bitmap.width * scale));
		const h = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas indisponible.');
		ctx.drawImage(bitmap, 0, 0, w, h);
		return canvas.toDataURL('image/jpeg', quality);
	} finally {
		bitmap.close();
	}
}

/** Détecte un code-barres EAN/UPC dans un dataURL (JPEG/PNG). Retourne null si absent/illisible. */
export async function detectBarcodeInDataUrl(dataUrl: string): Promise<string | null> {
	try {
		const ZX = (await import('html5-qrcode/third_party/zxing-js.umd')) as unknown as ZXing;
		const img = new Image();
		img.src = dataUrl;
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('image'));
		});
		const canvas = document.createElement('canvas');
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		ctx.drawImage(img, 0, 0);
		const source = new ZX.HTMLCanvasElementLuminanceSource(canvas);
		const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(source));
		const hints = new Map<number, unknown>();
		hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
			ZX.BarcodeFormat.EAN_13,
			ZX.BarcodeFormat.EAN_8,
			ZX.BarcodeFormat.UPC_A,
			ZX.BarcodeFormat.UPC_E,
		]);
		hints.set(ZX.DecodeHintType.TRY_HARDER, true);
		const reader = new ZX.MultiFormatReader(false, hints);
		const digits = (reader.decode(bitmap)?.text ?? '').replace(/\D/g, '');
		return digits.length >= 8 && digits.length <= 14 ? digits : null;
	} catch {
		return null; // pas de code lisible : jamais bloquant
	}
}
