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
 *        Trois formes :
 *          - application/json     : note textuelle { kind:'note', title, body } ;
 *          - application/json     : documents { kind:'file', title, description?,
 *            attachments:[{storageId,mime,name,size}] } — chaque fichier a été
 *            posté DIRECTEMENT sur le storage Convex par le navigateur (URL
 *            obtenue via /api/coach/resources/upload-url). Le BFF ne transporte
 *            plus d'octets : c'est la correction du bug « Unexpected end of
 *            JSON input » sur multi-upload (payload > limite des fonctions
 *            Netlify → réponse vide) ;
 *          - multipart/form-data  : forme historique (fichier(s) relayés par le
 *            BFF) — conservée en repli pour les clients encore en ligne.
 */
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 Mo par fichier
const MAX_FILES = 5; // pièces jointes par entrée Drive
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
		if (!contentType.startsWith('multipart/')) {
			const body = await event.request.json().catch(() => ({}));
			const userId = String(body?.userId ?? '');
			const title = String(body?.title ?? '').trim();
			const description = String(body?.description ?? '').trim();
			const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

			// ── Entrée fichiers : storageIds déjà uploadés DIRECTEMENT sur le storage ──
			if (attachments.length > 0) {
				if (!userId || !title) return json({ error: 'Titre et cliente requis.' }, { status: 400 });
				if (attachments.length > MAX_FILES) return json({ error: '5 fichiers maximum par entrée Drive.' }, { status: 400 });
				const clean: { storageId: string; mime: string; name: string; size: number }[] = [];
				for (const a of attachments) {
					const storageId = typeof a?.storageId === 'string' ? a.storageId : '';
					const name = typeof a?.name === 'string' ? a.name.trim() : '';
					const mime = typeof a?.mime === 'string' ? a.mime.trim() : '';
					const size = Number(a?.size ?? 0);
					// Garde de format (UX) : un id manifestement invalide renvoie un
					// message lisible plutôt qu'un « Server Error » opaque — le format
					// définitif reste revalidé par la mutation addResource (Convex).
					if (!/^[a-z0-9]{20,64}$/i.test(storageId)) {
						return json(
							{ error: `« ${name || 'Pièce jointe'} » : envoi incomplet — renvoie le fichier.` },
							{ status: 400 }
						);
					}
					if (!name) return json({ error: 'Pièce jointe sans nom — renvoie les fichiers.' }, { status: 400 });
					if (size > MAX_FILE_BYTES) return json({ error: `« ${name} » dépasse 25 Mo.` }, { status: 400 });
					clean.push({ storageId, mime: mime || 'application/octet-stream', name: name.slice(0, 200), size });
				}
				// 2) UNE seule entrée du Dossier pour l'ensemble (visibilité par défaut : privée coach).
				const res = await convex.mutation(api.resources.addResource, {
					sessionToken: token,
					userId: userId as never,
					kind: 'file',
					title,
					...(description ? { body: description } : {}),
					attachments: clean as never,
				});
				return json({ ok: true, resourceId: res.resourceId });
			}

			// Note textuelle.
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
		}

		// ── Forme historique (repli) : multipart relayé par le BFF, octets inclus ──
		{
			const form = await event.request.formData();
			const userId = String(form.get('userId') ?? '');
			const title = String(form.get('title') ?? '').trim();
			const description = String(form.get('description') ?? '').trim();
			const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
			if (!userId || !title) return json({ error: 'Titre et cliente requis.' }, { status: 400 });
			if (files.length === 0) return json({ error: 'Aucun fichier reçu.' }, { status: 400 });
			if (files.length > MAX_FILES) return json({ error: `5 fichiers maximum par entrée Drive.` }, { status: 400 });
			for (const file of files) {
				const typeOk = FILE_TYPES.has(file.type) || EXT_OK.test(file.name);
				if (!typeOk) {
					return json(
						{ error: `« ${file.name} » : format non accepté pour le Drive (PDF, image ou document Word, Excel, PowerPoint, texte…).` },
						{ status: 400 }
					);
				}
				if (file.size > MAX_FILE_BYTES) return json({ error: `« ${file.name} » dépasse 25 Mo.` }, { status: 400 });
			}

			// 1) Upload de chaque fichier → storage Convex (une seule copie physique chacun).
			const attachments: { storageId: string; mime: string; name: string; size: number }[] = [];
			for (const file of files) {
				const uploadUrl = await convex.mutation(api.media.generateUploadUrl, { sessionToken: token });
				const bytes = new Uint8Array(await file.arrayBuffer());
				const up = await fetch(uploadUrl, {
					method: 'POST',
					headers: { 'Content-Type': file.type || 'application/octet-stream' },
					body: bytes,
				});
				if (!up.ok) return json({ error: `Échec de l'upload de « ${file.name} ».` }, { status: 502 });
				const { storageId } = (await up.json()) as { storageId: string };
				attachments.push({ storageId, mime: file.type || 'application/octet-stream', name: file.name.slice(0, 200), size: file.size });
			}

			// 2) UNE seule entrée du Dossier pour l'ensemble (visibilité par défaut : privée coach).
			const res = await convex.mutation(api.resources.addResource, {
				sessionToken: token,
				userId: userId as never,
				kind: 'file',
				title,
				...(description ? { body: description } : {}),
				attachments: attachments as never,
			});
			return json({ ok: true, resourceId: res.resourceId });
		}
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
