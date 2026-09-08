import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/**
 * Dossier de la cliente (CRM coach) — notes privées + ressources partagées.
 *
 * GET  : contenu complet du Dossier d'une cliente (privé + partagé).
 * POST : ajoute une entrée. Par défaut la visibilité est « Privé coach » ;
 *        le partage avec la cliente se fait via PATCH (visibilité = shared).
 *        Deux formes :
 *          - multipart/form-data : fichier (PDF, image, document…) → stocké sur
 *            le storage Convex, une seule copie physique ;
 *          - application/json     : note textuelle { kind:'note', title, body }.
 */
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 Mo
const FILE_TYPES = new Set([
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/heic',
	'text/plain',
	'text/markdown',
	'text/csv',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.ms-powerpoint',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const EXT_OK = /\.(pdf|jpg|jpeg|png|webp|gif|heic|txt|md|csv|doc|docx|xls|xlsx|ppt|pptx)$/i;

export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const userId = event.url.searchParams.get('client') ?? '';
		if (!userId) return json({ error: 'Cliente requise.' }, { status: 400 });
		const rows = await convex.query(api.resources.coachResources, {
			sessionToken: token,
			userId: userId as never,
		});
		return json({ rows });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'coach');
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const contentType = event.request.headers.get('content-type') ?? '';
		if (contentType.startsWith('multipart/')) {
			const form = await event.request.formData();
			const userId = String(form.get('userId') ?? '');
			const title = String(form.get('title') ?? '').trim();
			const file = form.getAll('file').find((f): f is File => f instanceof File);
			if (!userId || !title) return json({ error: 'Titre et cliente requis.' }, { status: 400 });
			if (!file || file.size === 0) return json({ error: 'Aucun fichier reçu.' }, { status: 400 });
			const typeOk = FILE_TYPES.has(file.type) || EXT_OK.test(file.name);
			if (!typeOk) {
				return json(
					{ error: 'Format non accepté pour le Dossier : PDF, image ou document (Word, Excel, PowerPoint, texte…).' },
					{ status: 400 }
				);
			}
			if (file.size > MAX_FILE_BYTES) return json({ error: `« ${file.name} » dépasse 25 Mo.` }, { status: 400 });

			// 1) Upload du fichier → storage Convex (une seule copie physique).
			const uploadUrl = await convex.mutation(api.media.generateUploadUrl, { sessionToken: token });
			const bytes = new Uint8Array(await file.arrayBuffer());
			const up = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': file.type || 'application/octet-stream' },
				body: bytes,
			});
			if (!up.ok) return json({ error: `Échec de l'upload de « ${file.name} ».` }, { status: 502 });
			const { storageId } = (await up.json()) as { storageId: string };

			// 2) Entrée du Dossier (visibilité par défaut : privée coach).
			const res = await convex.mutation(api.resources.addResource, {
				sessionToken: token,
				userId: userId as never,
				kind: 'file',
				title,
				storageId: storageId as never,
				mime: file.type || 'application/octet-stream',
				name: file.name.slice(0, 200),
				size: file.size,
			});
			return json({ ok: true, resourceId: res.resourceId });
		}

		// Note textuelle.
		const body = await event.request.json().catch(() => ({}));
		const userId = String(body?.userId ?? '');
		const title = String(body?.title ?? '').trim();
		const content = String(body?.body ?? '').trim();
		if (!userId || !title) return json({ error: 'Titre et cliente requis.' }, { status: 400 });
		if (!content) return json({ error: 'Écris le contenu de la note.' }, { status: 400 });
		const res = await convex.mutation(api.resources.addResource, {
			sessionToken: token,
			userId: userId as never,
			kind: 'note',
			title,
			body: content,
		});
		return json({ ok: true, resourceId: res.resourceId });
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
