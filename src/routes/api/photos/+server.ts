import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo par photo
const MAX_FILES = 6;

/** Métadonnées des envois du client (confirmation uniquement). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/photos' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const subs = await convex.query(api.photos.mySubmissions, { sessionToken: token });
		return json(subs);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Reçoit une série de photos : multipart avec un champ `step` + plusieurs
 * champs de fichiers. Chaque fichier est uploadé sur le file storage Convex
 * (via une URL générée côté serveur), puis la série est enregistrée.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/photos' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const form = await event.request.formData();
		const step = String(form.get('step') ?? '');
		const files = form.getAll('photo').filter((f): f is File => f instanceof File);
		if (files.length === 0) return json({ error: 'Sélectionne au moins une photo.' }, { status: 400 });
		if (files.length > MAX_FILES) {
			return json({ error: `Envoie au maximum ${MAX_FILES} photos.` }, { status: 400 });
		}

		const photos: { storageId: string; label: string }[] = [];
		for (const file of files) {
			if (file.size > MAX_FILE_BYTES) {
				return json({ error: `« ${file.name} » dépasse 10 Mo.` }, { status: 400 });
			}
			if (!file.type.startsWith('image/')) {
				return json({ error: `« ${file.name} » n’est pas une image.` }, { status: 400 });
			}
			// 1) URL d'upload courte durée.
			const uploadUrl = await convex.mutation(api.photos.generateUploadUrl, { sessionToken: token });
			// 2) POST du fichier dessus → storageId.
			const bytes = new Uint8Array(await file.arrayBuffer());
			const up = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': file.type },
				body: bytes,
			});
			if (!up.ok) return json({ error: `Échec de l’upload de « ${file.name} ».` }, { status: 502 });
			const { storageId } = (await up.json()) as { storageId: string };
			photos.push({ storageId, label: file.name });
		}

		// 3) Enregistre la série.
		const res = await convex.mutation(api.photos.submit, {
			sessionToken: token,
			step,
			photos: photos as never,
		});
		return json({ ok: true, count: res.count });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};