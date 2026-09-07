import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Upload d'un média coach → cliente (audio de retour, pièce jointe, audio de
 * message). Le fichier est envoyé sur le file storage Convex via une URL
 * d'upload courte durée, puis enregistré en MÉTADONNÉES (brouillon) — il ne
 * devient visible côté cliente qu'à la publication explicite du retour ou du
 * message. Les images sont déjà optimisées côté navigateur avant cet appel.
 */

const SOURCES = new Set(['checkin_feedback_audio', 'checkin_attachment', 'coach_message_audio']);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 Mo (audio voix ~48 kbps : très en dessous)
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // entrée avant optimisation (faite côté client)
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-wav', 'video/webm']);

function kindOf(mime: string, name: string): 'audio' | 'image' | 'pdf' | null {
	const lower = name.toLowerCase();
	if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
	if (AUDIO_TYPES.has(mime)) return 'audio';
	if (mime.startsWith('image/') || IMAGE_TYPES.has(mime)) return 'image';
	return null;
}

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const source = String(form.get('source') ?? '');
		const checkinId = String(form.get('checkinId') ?? '') || undefined;
		const file = form.getAll('file').find((f): f is File => f instanceof File);
		if (!userId || !SOURCES.has(source)) return json({ error: 'Paramètres invalides.' }, { status: 400 });
		if (source !== 'coach_message_audio' && !checkinId) {
			return json({ error: 'Ce fichier doit être lié à un bilan.' }, { status: 400 });
		}
		if (!file || file.size === 0) return json({ error: 'Aucun fichier reçu.' }, { status: 400 });

		const kind = kindOf(file.type, file.name);
		if (!kind) {
			return json(
				{ error: 'Format non accepté. Images : JPG/PNG/WebP. Documents : PDF. Audio : enregistrement vocal.' },
				{ status: 400 }
			);
		}
		const max = kind === 'audio' ? MAX_AUDIO_BYTES : kind === 'image' ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
		if (file.size > max) {
			const label = kind === 'audio' ? '25 Mo' : kind === 'image' ? '12 Mo' : '15 Mo';
			return json({ error: `« ${file.name} » dépasse ${label}.` }, { status: 400 });
		}

		// 1) URL d'upload courte durée + POST du fichier → storageId.
		const uploadUrl = await convex.mutation(api.media.generateUploadUrl, { sessionToken: token });
		const bytes = new Uint8Array(await file.arrayBuffer());
		const up = await fetch(uploadUrl, {
			method: 'POST',
			headers: { 'Content-Type': file.type || 'application/octet-stream' },
			body: bytes,
		});
		if (!up.ok) return json({ error: `Échec de l'upload de « ${file.name} ».` }, { status: 502 });
		const { storageId } = (await up.json()) as { storageId: string };

		// 2) Métadonnées — brouillon, invisible côté cliente tant qu'on ne publie pas.
		const res = await convex.mutation(api.media.record, {
			sessionToken: token,
			userId: userId as never,
			source: source as never,
			...(checkinId ? { checkinId: checkinId as never } : {}),
			kind: kind as never,
			storageId: storageId as never,
			mime: file.type || 'application/octet-stream',
			name: file.name || (kind === 'audio' ? 'message-audio' : 'piece-jointe'),
			size: file.size,
			durationMs: kind === 'audio' ? Number(form.get('durationMs') ?? 0) || undefined : undefined,
		});
		return json({ ok: true, mediaId: res.mediaId });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
