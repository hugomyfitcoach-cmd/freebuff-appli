import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo par photo
const MAX_FILES = 6;

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

/** POST d'un fichier sur une URL d'upload Convex → storageId (null si échec). */
async function putToStorage(uploadUrl: string, type: string, bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
	const up = await fetch(uploadUrl, {
		method: 'POST',
		headers: { 'Content-Type': type || 'image/jpeg' },
		body: bytes,
	});
	if (!up.ok) return null;
	const uploaded = await safeJson<{ storageId?: string }>(up);
	return uploaded?.storageId ?? null;
}

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
 * Reçoit UNE photo (multipart : champ `step` + champ `photo`) : elle est
 * uploadée sur le file storage Convex (via une URL générée côté serveur) puis
 * la série mono-photo est enregistrée. Renvoie `{ ok, storageId, count }`.
 *
 * Le client envoie ses photos UNE PAR UNE dans l'ordre de sélection — chaque
 * requête reste très en dessous de la limite de 6 Mo des fonctions Netlify
 * (une requête de lot dépassait silencieusement cette limite : réponse vide,
 * « Unexpected end of JSON input » côté cliente, photos jamais reçues).
 *
 * Rétrocompatibilité : un POST multi-fichiers (champs `photo` multiples) est
 * toujours accepté avec le comportement historique (un seul `submit` à la fin).
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
		for (const file of files) {
			if (file.size > MAX_FILE_BYTES) {
				return json({ error: `« ${file.name} » dépasse 10 Mo.` }, { status: 400 });
			}
			if (!file.type.startsWith('image/')) {
				return json({ error: `« ${file.name} » n’est pas une image.` }, { status: 400 });
			}
		}

		if (files.length === 1) {
			// ── Mode mono-photo (client à jour) : une requête = une photo. ──
			const file = files[0];
			const uploadUrl = await convex.mutation(api.photos.generateUploadUrl, { sessionToken: token });
			const bytes = new Uint8Array(await file.arrayBuffer());
			const storageId = await putToStorage(uploadUrl, file.type, bytes);
			if (!storageId) {
				return json({ error: `Échec de l’envoi de « ${file.name} ». Réessaie dans quelques instants.` }, { status: 502 });
			}
			const res = await convex.mutation(api.photos.submitOne, {
				sessionToken: token,
				step,
				// Id<_storage> validé par Convex ; cast équivalent au mode lot (`as never`).
				storageId: storageId as never,
				label: file.name || 'photo.jpg',
			});
			return json({ ok: true, storageId, count: res.count });
		}

		// ── Mode lot (rétrocompatibilité) : tous les fichiers, un seul `submit`. ──
		const photos: { storageId: string; label: string }[] = [];
		for (const file of files) {
			const uploadUrl = await convex.mutation(api.photos.generateUploadUrl, { sessionToken: token });
			const bytes = new Uint8Array(await file.arrayBuffer());
			const storageId = await putToStorage(uploadUrl, file.type, bytes);
			if (!storageId) {
				return json({ error: `Échec de l’upload de « ${file.name} ». Réessaie dans quelques instants.` }, { status: 502 });
			}
			photos.push({ storageId, label: file.name });
		}
		await convex.mutation(api.photos.submit, {
			sessionToken: token,
			step,
			photos: photos as never,
		});
		return json({ ok: true, count: photos.length });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
