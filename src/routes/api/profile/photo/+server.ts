import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo (cohérent avec la mutation Convex)

/** Lit un corps JSON en tolérant une réponse vide / non-JSON (erreur hébergeur). */
async function safeJson<T>(res: Response): Promise<T | null> {
	try {
		const text = await res.text();
		if (!text) return null;
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

/** Photo de profil actuelle : URL signée Convex (null si aucune). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const url = await convex.query(api.users.getProfilePhotoUrl, { sessionToken: token });
		return json({ url: url ?? null });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Pose (ou remplace) la photo de profil. Multipart, champ `photo`.
 *
 * La COMPRESSION/RECADRAGE se fait CÔTÉ CLIENT (AvatarCrop exporte un JPEG
 * carré ≤ 1024 px) : ici, AUCUN traitement canvas — `document`/`Image`
 * n'existent pas dans la fonction Netlify et provoquaient « image is not
 * defined ». Le serveur garde ses garde-fous (type image, 10 Mo max) puis
 * transmet le fichier au file storage Convex (URL générée côté serveur) et
 * référence users.profilePhotoStorageId. Renvoie `{ ok, url }`.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const form = await event.request.formData();
		const file = form.get('photo');
		if (!(file instanceof File)) return json({ error: 'Sélectionne une photo.' }, { status: 400 });
		if (file.size > MAX_FILE_BYTES) return json({ error: 'Image trop lourde (10 Mo maximum).' }, { status: 400 });
		if (!file.type.startsWith('image/')) return json({ error: 'Le fichier doit être une image.' }, { status: 400 });

		const uploadUrl = await convex.mutation(api.photos.generateUploadUrl, { sessionToken: token });
		const bytes = new Uint8Array(await file.arrayBuffer());
		const up = await fetch(uploadUrl, {
			method: 'POST',
			headers: { 'Content-Type': file.type || 'image/jpeg' },
			body: bytes,
		});
		const uploaded = await safeJson<{ storageId?: string }>(up);
		const storageId = up.ok ? (uploaded?.storageId ?? null) : null;
		if (!storageId) {
			return json({ error: "Échec de l'envoi de la photo. Réessaie dans quelques instants." }, { status: 502 });
		}
		await convex.mutation(api.users.setProfilePhoto, { sessionToken: token, storageId: storageId as never });
		const url = await convex.query(api.users.getProfilePhotoUrl, { sessionToken: token });
		return json({ ok: true, url: url ?? null });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Retire la photo de profil (retour à l'avatar initiale). */
export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		await convex.mutation(api.users.clearProfilePhoto, { sessionToken: token });
		return json({ ok: true, url: null });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
