import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Programmes d'entraînement du coach — liste (GET) / création (POST). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const rows = await convex.query(api.training.listPrograms, { sessionToken: token });
		return json({ items: rows });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Création d'un programme (JSON) ou avec image de couverture (FormData).
 * L'image est uploadée vers le storage Convex côté serveur (jamais le
 * navigateur) puis référencée par le programme.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const contentType = event.request.headers.get('content-type') ?? '';
		let name = '';
		let description: string | undefined;
		let goal: string | undefined;
		let level: string | undefined;
		let sessionsPerWeek: number | undefined;
		let imageStorageId: string | undefined;

		if (contentType.includes('multipart/form-data')) {
			const form = await event.request.formData();
			name = String(form.get('name') ?? '');
			description = (form.get('description') as string) || undefined;
			goal = (form.get('goal') as string) || undefined;
			level = (form.get('level') as string) || undefined;
			const spw = Number(form.get('sessionsPerWeek') ?? 0);
			sessionsPerWeek = spw > 0 ? spw : undefined;
			const file = form.get('image');
			if (file instanceof File && file.size > 0) {
				if (!file.type.startsWith('image/')) return json({ error: "L'image doit être un fichier image." }, { status: 400 });
				if (file.size > 12 * 1024 * 1024) return json({ error: 'Image trop lourde (max 12 Mo).' }, { status: 400 });
				const uploadUrl = await convex.mutation(api.training.generateImageUploadUrl, { sessionToken: token });
				const up = await fetch(uploadUrl, {
					method: 'POST',
					headers: { 'Content-Type': file.type || 'application/octet-stream' },
					body: new Uint8Array(await file.arrayBuffer()),
				});
				if (!up.ok) return json({ error: "Échec de l'upload de l'image." }, { status: 502 });
				imageStorageId = ((await up.json()) as { storageId: string }).storageId;
			}
		} else {
			const body = (await event.request.json()) as Record<string, unknown>;
			name = String(body.name ?? '');
			description = (body.description as string) || undefined;
			goal = (body.goal as string) || undefined;
			level = (body.level as string) || undefined;
			const spw = Number(body.sessionsPerWeek ?? 0);
			sessionsPerWeek = spw > 0 ? spw : undefined;
		}

		const res = await convex.mutation(api.training.createProgram, {
			sessionToken: token,
			name,
			description,
			goal: goal as never,
			level: level as never,
			sessionsPerWeek,
			...(imageStorageId ? { imageStorageId: imageStorageId as never } : {}),
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
