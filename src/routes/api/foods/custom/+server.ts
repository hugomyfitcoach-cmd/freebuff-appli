import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { errMsg } from '$lib/errors.js';

/** Plafond photo côté BFF (la compression cliente limite déjà à ~1600 px WebP). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Champs nutritionnels communs JSON / multipart (valeurs texte → number | undefined). */
function num(v: unknown): number | undefined {
	if (v === undefined || v === null || v === '') return undefined;
	const n = Number(v);
	return isFinite(n) ? n : undefined;
}

/** Poste le fichier sur une URL d'upload Convex → storageId (null si échec). */
async function putToStorage(
	uploadUrl: string,
	type: string,
	bytes: Uint8Array<ArrayBuffer>
): Promise<string | null> {
	const up = await fetch(uploadUrl, {
		method: 'POST',
		headers: { 'Content-Type': type || 'image/jpeg' },
		body: bytes,
	});
	if (!up.ok) return null;
	try {
		const uploaded = (await up.json()) as { storageId?: string };
		return uploaded?.storageId ?? null;
	} catch {
		return null;
	}
}

/**
 * Reçoit la photo du formulaire (multipart) : validation type/taille puis
 * dépôt sur le file storage Convex via une URL d'upload GÉNÉRÉE CÔTÉ SERVEUR
 * (le client n'appelle jamais Convex directement). Renvoie le storageId à
 * référencer sur la fiche, ou undefined si aucune photo transmise.
 * ERREUR (400) si un fichier est transmis mais invalide.
 */
async function resolvePhoto(
	token: string | undefined,
	file: FormDataEntryValue | null
): Promise<string | undefined> {
	if (!(file instanceof File) || file.size === 0) return undefined;
	if (file.size > MAX_FILE_BYTES) throw new Error('Photo trop lourde (10 Mo maximum).');
	if (!file.type.startsWith('image/')) throw new Error('Le fichier doit être une image.');
	const uploadUrl = await convex.mutation(api.photos.generateUploadUrl, { sessionToken: token });
	const bytes = new Uint8Array(await file.arrayBuffer());
	const storageId = await putToStorage(uploadUrl, file.type, bytes);
	if (!storageId) {
		throw new Error("Échec de l'envoi de la photo. Réessaie dans quelques instants.");
	}
	return storageId;
}

/** Les aliments personnels du client (« Créés par moi »). */
export const GET: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const foods = await convex.query(api.customFoods.list, { sessionToken: token });
		return json(foods);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Crée un aliment personnel : valeurs pour 100 g saisies depuis l'étiquette.
 *
 * Deux corps acceptés :
 * - JSON (contrat historique, inchangé) :
 *   { name, brand?, kcal100, carbs100, protein100, fat100, fiber100?, salt100?, servingQty?, barcode?, sourceKind? }
 * - multipart/form-data : mêmes champs en texte + PHOTO OPTIONNELLE (champ
 *   `photo`) — déposée sur le storage Convex puis référencée sur la fiche.
 *   La photo reste STRICTEMENT privée : liée à CETTE fiche, jamais à la base
 *   commune ni à un autre utilisateur.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const contentType = event.request.headers.get('content-type') ?? '';
		if (contentType.includes('multipart/form-data')) {
			const form = await event.request.formData();
			let photoStorageId: string | undefined;
			try {
				photoStorageId = await resolvePhoto(token, form.get('photo'));
			} catch (e) {
				return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
			}
			const res = await convex.mutation(api.customFoods.create, {
				sessionToken: token,
				name: String(form.get('name') ?? ''),
				brand: form.get('brand') ? String(form.get('brand')) : undefined,
				kcal100: Number(form.get('kcal100')),
				carbs100: num(form.get('carbs100')) ?? 0,
				protein100: num(form.get('protein100')) ?? 0,
				fat100: num(form.get('fat100')) ?? 0,
				fiber100: num(form.get('fiber100')),
				salt100: num(form.get('salt100')),
				servingQty: num(form.get('servingQty')),
				barcode: form.get('barcode') ? String(form.get('barcode')) : undefined,
				sourceKind: form.get('sourceKind') === 'label_photo' ? 'label_photo' : undefined,
				photoStorageId: photoStorageId as never,
			});
			return json(res);
		}
		const body = await event.request.json();
		const res = await convex.mutation(api.customFoods.create, {
			sessionToken: token,
			name: String(body.name ?? ''),
			brand: body.brand ? String(body.brand) : undefined,
			kcal100: Number(body.kcal100),
			carbs100: Number(body.carbs100 ?? 0),
			protein100: Number(body.protein100 ?? 0),
			fat100: Number(body.fat100 ?? 0),
			fiber100: num(body.fiber100),
			salt100: num(body.salt100),
			servingQty: num(body.servingQty),
			barcode: body.barcode ? String(body.barcode) : undefined,
			sourceKind: body.sourceKind === 'label_photo' ? 'label_photo' : undefined,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/**
 * Modifie un aliment personnel existant : PUT ?id=…
 * Met la fiche à jour (pas de nouveau document) ; les entrées du journal déjà
 * enregistrées gardent leur snapshot d'origine.
 *
 * PHOTO (multipart uniquement) : champ `photo` = remplacement du visuel ;
 * champ `clearPhoto` = « true » pour retirer la photo sans replacement.
 * L'ancienne photo est supprimée du storage côté Convex (même transaction).
 */
export const PUT: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const id = event.url.searchParams.get('id') ?? '';
		if (!id) return json({ error: 'Aliment manquant.' }, { status: 400 });
		const contentType = event.request.headers.get('content-type') ?? '';
		if (contentType.includes('multipart/form-data')) {
			const form = await event.request.formData();
			let photoStorageId: string | undefined;
			const clearPhoto = String(form.get('clearPhoto') ?? '') === 'true';
			try {
				photoStorageId = await resolvePhoto(token, form.get('photo'));
			} catch (e) {
				return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
			}
			const res = await convex.mutation(api.customFoods.update, {
				sessionToken: token,
				customFoodId: id as never,
				name: String(form.get('name') ?? ''),
				brand: form.get('brand') ? String(form.get('brand')) : undefined,
				kcal100: Number(form.get('kcal100')),
				carbs100: num(form.get('carbs100')) ?? 0,
				protein100: num(form.get('protein100')) ?? 0,
				fat100: num(form.get('fat100')) ?? 0,
				fiber100: num(form.get('fiber100')),
				salt100: num(form.get('salt100')),
				servingQty: num(form.get('servingQty')),
				barcode: form.get('barcode') ? String(form.get('barcode')) : undefined,
				photoStorageId: photoStorageId as never,
				clearPhoto,
			});
			return json(res);
		}
		const body = await event.request.json();
		const res = await convex.mutation(api.customFoods.update, {
			sessionToken: token,
			customFoodId: id as never,
			name: String(body.name ?? ''),
			brand: body.brand ? String(body.brand) : undefined,
			kcal100: Number(body.kcal100),
			carbs100: Number(body.carbs100 ?? 0),
			protein100: Number(body.protein100 ?? 0),
			fat100: Number(body.fat100 ?? 0),
			fiber100: num(body.fiber100),
			salt100: num(body.salt100),
			servingQty: num(body.servingQty),
			barcode: body.barcode ? String(body.barcode) : undefined,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};

/** Supprime un aliment personnel : ?id=… (sa photo est retirée du storage). */
export const DELETE: RequestHandler = async (event) => {
	await requireRole(event, 'client', { next: '/espace/journal' });
	const token = event.cookies.get(SESSION_COOKIE);
	try {
		const id = event.url.searchParams.get('id') ?? '';
		if (!id) return json({ error: 'Aliment manquant.' }, { status: 400 });
		const res = await convex.mutation(api.customFoods.remove, {
			sessionToken: token,
			customFoodId: id as never,
		});
		return json(res);
	} catch (e) {
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
