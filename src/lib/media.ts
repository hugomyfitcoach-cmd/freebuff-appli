/* Helpers partagés coach/cliente pour les médias (audio, pièces jointes). */

export type CoachMediaItem = {
	_id: string;
	userId: string;
	source: 'checkin_feedback_audio' | 'checkin_attachment' | 'coach_message_audio';
	checkinId: string | null;
	kind: 'audio' | 'image' | 'pdf';
	mime: string;
	name: string;
	size: number;
	durationMs: number | null;
	status: 'draft' | 'published' | 'expired';
	publishedAt: number | null;
	firstListenedAt: number | null;
	createdAt: number;
	expiresAt: number | null;
	expired: boolean;
	url: string | null;
};

/** Durée en SECONDES → "4:32". */
export function fmtSec(v: number | null | undefined): string {
	if (v == null || !isFinite(v)) return '0:00';
	const s = Math.max(0, Math.round(v));
	const m = Math.floor(s / 60);
	const r = String(s % 60).padStart(2, '0');
	return `${m}:${r}`;
}

/** Durée en MILLISECONDES (métadonnées) → "4:32". */
export function fmtMs(v: number | null | undefined): string {
	if (v == null || !isFinite(v)) return '0:00';
	return fmtSec(v / 1000);
}

/**
 * Meilleur format audio disponible pour l'enregistrement vocal navigateur :
 * Opus/WebM (léger, voix ~48 kbps) en priorité, AAC/MP4 en repli (Safari).
 */
export function pickAudioMime(): string {
	if (typeof MediaRecorder === 'undefined') return '';
	const candidates = [
		'audio/webm;codecs=opus',
		'audio/webm',
		'audio/mp4;codecs=mp4a.40.2',
		'audio/mp4',
		'audio/ogg;codecs=opus',
	];
	for (const c of candidates) {
		try {
			if (MediaRecorder.isTypeSupported(c)) return c;
		} catch {
			/* ignore */
		}
	}
	return '';
}

const MAX_SIDE = 1600;
const WEBP_Q = 0.82;
const JPEG_Q = 0.85;

/**
 * Optimise une image DÈS L'UPLOAD (jamais en boucle) :
 *  - redimensionne à 1600 px max sur le côté le plus long (suffisant pour un
 *    suivi coaching), ratio conservé ;
 *  - ré-encode en WebP (repli JPEG) ~80 % — supprime au passage l'EXIF/GPS.
 *  - l'original lourd n'est jamais envoyé.
 */
export async function optimizeImageFile(file: File): Promise<{ blob: Blob; mime: string; name: string }> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
	const w = Math.max(1, Math.round(bitmap.width * scale));
	const h = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Optimisation d’image impossible.');
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();

	let blob: Blob | null = null;
	let mime = 'image/webp';
	try {
		blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_Q));
	} catch {
		/* Safari ancien */
	}
	if (!blob) {
		mime = 'image/jpeg';
		blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_Q));
	}
	if (!blob) throw new Error('Optimisation d’image impossible.');
	const dot = file.name.lastIndexOf('.');
	const base = dot > 0 ? file.name.slice(0, dot) : file.name;
	const ext = mime === 'image/webp' ? 'webp' : 'jpg';
	return { blob, mime, name: `${base}.${ext}` };
}

/** Taille lisible ("1,2 Mo", "840 Ko"). */
export function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} o`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
	return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}
