import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import { applyKcalGuard } from "../lib/nutritionGuard";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Aliments créés par le client (« Créés par moi »).
 *
 * Quand un produit n'est pas dans la base (repas commandé avec étiquette
 * nutritionnelle, recette maison…), le client saisit ses valeurs pour 100 g :
 * l'aliment est alors intégré à SA base — journalisable, utilisable dans les
 * repas personnalisés, et retrouvable par recherche.
 */

async function requireClient(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") {
		throw new ConvexError("Seuls les comptes clients peuvent créer des aliments.");
	}
	return user;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ═══════════ PHOTO DE L'ALIMENT (optionnelle, privée) ═══════════
 *
 * La photo appartient à la FICHE créée par la cliente (« Créés par moi ») :
 * le fichier vit dans le file storage Convex, l'id est posé sur la ligne
 * customFoods (photoStorageId). Le client n'appelle JAMAIS le storage direct :
 * l'upload passe par le BFF (même chaîne que la photo de profil), la mutation
 * vérifie le fichier (type image, taille) et la PROPRIÉTÉ de la fiche avant
 * de basculer le champ — l'ancienne photo est supprimée du storage dans la
 * MÊME transaction. L'URL signée est résolue à la lecture, uniquement pour
 * les fiches de la cliente connectée (isolation stricte).
 */

/** Plafond large côté Convex : le BFF compresse déjà (WebP ~1600 px) et
 *  plafonne à 10 Mo comme la photo de profil. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Résout les URL photo signées pour un lot de fiches DE LA MÊME cliente. */
async function photoUrlsForOwner(
	ctx: Pick<QueryCtx, "db" | "storage">,
	rows: (Doc<"customFoods"> | null)[]
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const f of rows) {
		if (!f?.photoStorageId) continue;
		const url = await ctx.storage.getUrl(f.photoStorageId);
		if (url) out.set(f._id, url);
	}
	return out;
}

/** Enrichit les fiches personnelles de la cliente avec leur photoUrl. */
async function withPhotoUrls<T extends Doc<"customFoods">>(
	ctx: Pick<QueryCtx, "db" | "storage">,
	foods: T[]
): Promise<(T & { photoUrl?: string })[]> {
	if (!foods.length) return foods;
	const urls = await photoUrlsForOwner(ctx, foods);
	if (!urls.size) return foods;
	return foods.map((f) => {
		const photoUrl = urls.get(f._id);
		return photoUrl ? { ...f, photoUrl } : f;
	});
}

/**
 * Vérifie un fichier candidat (existant, image, taille raisonnable) avant de
 * le référencer sur une fiche. Le fichier a déjà été posé sur le storage par
 * le BFF (URL d'upload générée côté serveur).
 */
async function requireValidPhoto(ctx: MutationCtx, storageId: Id<"_storage">) {
	const meta = await ctx.storage.getMetadata(storageId);
	if (!meta) throw new ConvexError("Photo introuvable — recommence l'ajout.");
	if (!meta.contentType?.startsWith("image/")) throw new ConvexError("Le fichier doit être une image.");
	if (meta.size > MAX_PHOTO_BYTES) throw new ConvexError("Photo trop lourde (10 Mo maximum).");
}

/** Supprime une photo du storage (silencieux si déjà disparue). */
async function deletePhotoSilently(ctx: MutationCtx, storageId: Id<"_storage"> | undefined) {
	if (!storageId) return;
	try {
		await ctx.storage.delete(storageId);
	} catch {
		// déjà supprimée (remplacement rapproché) : sans effet
	}
}

function clamp(n: number, min: number, max: number, label: string): number {
	if (!isFinite(n)) throw new ConvexError(`${label} invalide.`);
	if (n < min || n > max) throw new ConvexError(`${label} doit être entre ${min} et ${max}.`);
	return round1(n);
}

/** Champs communs création / édition (validés une seule fois, mêmes règles). */
const foodFields = {
	name: v.string(),
	brand: v.optional(v.string()),
	kcal100: v.number(),
	carbs100: v.number(),
	protein100: v.number(),
	fat100: v.number(),
	/** Composés à coefficient kcal ≠ 4 + sel (information étiquette). */
	fiber100: v.optional(v.number()),
	salt100: v.optional(v.number()),
	servingQty: v.optional(v.number()),
	/**
	 * Code-barres EAN/GTIN (scan ou décodage d'étiquette) — produit emballé.
	 * Fourni → l'aliment est créé « candidat global » (globalStatus: 'candidate')
	 * : la publication dans la base globale reste une action coach/exploitation,
	 * JAMAIS automatique (règle produit : une cliente n'écrit jamais `foods`).
	 */
	barcode: v.optional(v.string()),
	/** Origine : "manual" (défaut) | "label_photo" (photo d'étiquette). */
	sourceKind: v.optional(v.string()),
};

/** Valide et normalise les champs saisies (identique à la création). */
function normalizeFields(fields: {
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	fiber100?: number;
	salt100?: number;
	servingQty?: number;
}) {
	const clean = fields.name.trim();
	if (clean.length < 2 || clean.length > 80) {
		throw new ConvexError("Donne un nom à ton aliment (entre 2 et 80 caractères).");
	}
	const kcal = clamp(fields.kcal100, 0, 900, "Les calories");
	const carbs = clamp(fields.carbs100, 0, 100, "Les glucides");
	const protein = clamp(fields.protein100, 0, 100, "Les protéines");
	const fat = clamp(fields.fat100, 0, 100, "Les lipides");
	if (kcal === 0 && carbs === 0 && protein === 0 && fat === 0) {
		throw new ConvexError("Renseigne au moins une valeur nutritionnelle.");
	}
	// Composés à coefficient kcal ≠ 4 + sel : plages larges, information d'étiquette.
	const fiber = fields.fiber100 !== undefined && fields.fiber100 !== null ? clamp(fields.fiber100, 0, 90, "Les fibres") : undefined;
	const salt = fields.salt100 !== undefined && fields.salt100 !== null ? clamp(fields.salt100, 0, 25, "Le sel") : undefined;
	let qty: number | undefined;
	if (fields.servingQty !== undefined && fields.servingQty !== null) {
		qty = clamp(fields.servingQty, 1, 2000, "La portion");
	}
	return { name: clean, brand: fields.brand?.trim() || undefined, kcal100: kcal, carbs100: carbs, protein100: protein, fat100: fat, fiber100: fiber, salt100: salt, servingQty: qty };
}

/**
 * Code-barres saisi (13/8 chiffres max, chiffres seuls) — EAN-13/EAN-8/UPC-A.
 */
function cleanBarcode(code: string | undefined | null): string | undefined {
	const c = (code ?? "").replace(/\D/g, "");
	return c.length >= 8 && c.length <= 14 ? c : undefined;
}

/**
 * Le code existe-t-il DÉJÀ dans la base commune (`foods`, offId = EAN/GTIN) ?
 * Si oui : la cliente peut garder l'aliment en PERSONNEL, mais JAMAIS de
 * candidat global ni de doublon (règle produit : barcode connu → pas de
 * nouveau global, et une cliente n'écrit jamais `foods`).
 */
async function barcodeExistsGlobally(ctx: MutationCtx, code: string): Promise<boolean> {
	if (!code) return false;
	const f = await ctx.db
		.query("foods")
		.withIndex("by_offId", (q) => q.eq("offId", code))
		.first();
	return f !== null;
}

/**
 * Crée un aliment personnel (valeurs pour 100 g).
 *
 * Avec un `barcode` produit emballé : l'aliment est marqué
 * `globalStatus: "candidate"` — candidat à la base globale G-FLUX, mais
 * JAMAIS publié automatiquement (aucune écriture cliente dans `foods`).
 * Sans code-barres (recette maison…) : aliment privé, statut absent.
 *
 * PHOTO (optionnelle) : `photoStorageId` = fichier DÉJÀ uploadé sur le
 * storage via le BFF (route /api/foods/custom, multipart) — vérifié ici
 * (type image, taille) puis référencé sur la fiche. Aucune URL n'est jamais
 * acceptée : seule une pièce réellement déposée par la cliente est liée.
 */
export const create = mutation({
	args: { sessionToken: v.optional(v.string()), photoStorageId: v.optional(v.id("_storage")), ...foodFields },
	handler: async (ctx, { sessionToken, barcode, sourceKind, photoStorageId, ...fields }) => {
	const user = await requireClient(ctx, sessionToken);
	const clean = normalizeFields(fields);
	const code = cleanBarcode(barcode);
	// Anti-doublon serveur : candidat UNIQUEMENT si le code est inconnu de la
	// base commune. Code déjà connu → aliment personnel simple, zéro candidat.
	const globalStatus = code && !(await barcodeExistsGlobally(ctx, code)) ? "candidate" : undefined;
	if (photoStorageId) await requireValidPhoto(ctx, photoStorageId);
	const id = await ctx.db.insert("customFoods", {
		userId: user._id,
		...clean,
		barcode: code,
		globalStatus,
		sourceKind: sourceKind === "label_photo" ? "label_photo" : "manual",
		photoStorageId,
		photoUpdatedAt: photoStorageId ? Date.now() : undefined,
		createdAt: Date.now(),
	});
	return { ok: true, customFoodId: id };
	},
});

/**
 * Modifie un aliment personnel existant (propriétaire uniquement).
 * Ne touche qu'à la fiche : les entrées du journal déjà enregistrées
 * conservent leur snapshot (nom, marque, valeurs) tel quel.
 *
 * PHOTO : `photoStorageId` (remplacement) ou `clearPhoto: true` (retrait)
 * — l'ancienne photo est supprimée du storage dans la même transaction,
 * jamais d'orphelin. Aucun autre champ n'est touché par ces options.
 */
export const update = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		customFoodId: v.id("customFoods"),
		/** Remplace la photo (fichier déjà uploadé via le BFF). */
		photoStorageId: v.optional(v.id("_storage")),
		/** Retire la photo (sans replacement). */
		clearPhoto: v.optional(v.boolean()),
		...foodFields,
	},
	handler: async (ctx, { sessionToken, customFoodId, barcode, sourceKind, photoStorageId, clearPhoto, ...fields }) => {
		const user = await requireClient(ctx, sessionToken);
		const food = await ctx.db.get(customFoodId);
		if (!food || food.userId !== user._id) throw new ConvexError("Aliment introuvable.");
		const patch = normalizeFields(fields);
	const code = cleanBarcode(barcode);
	// Le barcode d'origine reste prioritaire : l'édition ne doit pas pouvoir
	// « dé-candidater » un produit emballé en effaçant son code par erreur.
	// Rattachement « Ajouter un code-barres » : candidat seulement si le code
	// est inconnu de la base commune (jamais de doublon global).
	const finalCode = code ?? food.barcode;
	const globalStatus =
		food.globalStatus === "candidate" ||
		(finalCode !== undefined && !(await barcodeExistsGlobally(ctx, finalCode)))
			? "candidate"
			: food.globalStatus;
	await ctx.db.patch(customFoodId, {
		...patch,
		barcode: finalCode,
		globalStatus,
	});
	// PHOTO — après le patch des champs nutritionnels (mêmes règles que la
	// photo de profil : validation du fichier, ancienne copie supprimée).
	const oldPhoto = food.photoStorageId;
	if (photoStorageId) {
		await requireValidPhoto(ctx, photoStorageId);
		if (photoStorageId !== oldPhoto) {
			await ctx.db.patch(customFoodId, { photoStorageId, photoUpdatedAt: Date.now() });
			await deletePhotoSilently(ctx, oldPhoto);
		}
	} else if (clearPhoto && oldPhoto) {
		await ctx.db.patch(customFoodId, { photoStorageId: undefined, photoUpdatedAt: Date.now() });
		await deletePhotoSilently(ctx, oldPhoto);
	}
	return { ok: true, customFoodId };
	},
});

/** Les aliments personnels du client (du plus récent au plus ancien), avec photoUrl si photo. */
export const list = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("customFoods")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.collect();
		return withPhotoUrls(ctx, rows);
	},
});

/** Supprime un aliment personnel (propriétaire uniquement) — sa photo avec lui. */
export const remove = mutation({
	args: { sessionToken: v.optional(v.string()), customFoodId: v.id("customFoods") },
	handler: async (ctx, { sessionToken, customFoodId }) => {
		const user = await requireClient(ctx, sessionToken);
		const food = await ctx.db.get(customFoodId);
		if (!food || food.userId !== user._id) throw new ConvexError("Aliment introuvable.");
		// La photo appartient à CETTE fiche : supprimée du storage en même temps
		// que la ligne (les snapshots journal gardent leur imageUrl — affichage
		// historique, mais l'URL signée Convex cessera de répondre : FoodImg
		// retombe sur son placeholder, jamais d'écran cassé).
		await deletePhotoSilently(ctx, food.photoStorageId);
		await ctx.db.delete(customFoodId);
		return { ok: true };
	},
});

/** Aliments personnels par ids (pour reconstituer des résultats de recherche). */
export const byIds = query({
	args: { sessionToken: v.optional(v.string()), ids: v.array(v.id("customFoods")) },
	handler: async (ctx, { sessionToken, ids }) => {
		const user = await requireClient(ctx, sessionToken);
		const foods = await Promise.all(ids.map((id) => ctx.db.get(id)));
		return withPhotoUrls(ctx, foods.filter((f): f is Doc<"customFoods"> => f !== null && f.userId === user._id));
	},
});

/**
 * Barcodes d'un lot d'aliments personnels de la cliente (40 ids max).
 * Utilisé par le pré-remplissage de la portion mémorisée — isole STRICTEMENT
 * les lignes appartenant à la cliente (get n'est jamais suffisant seul).
 */
export const barcodesByIds = query({
	args: { sessionToken: v.optional(v.string()), ids: v.array(v.id("customFoods")) },
	handler: async (ctx, { sessionToken, ids }) => {
		const user = await requireClient(ctx, sessionToken);
		const out: Record<string, string> = {};
		for (const id of ids.slice(0, 40)) {
			const f = await ctx.db.get(id);
			if (f && f.userId === user._id && f.barcode) out[id] = f.barcode;
		}
		return out;
	},
});

/**
 * Recherche un aliment personnel PAR CODE-BARRES (exact, chez la cliente).
 * Retourne null si absent — l'appelant retombe alors sur la base globale
 * (`foods.by_offId`) puis sur la photo d'étiquette.
 */
export const byBarcode = query({
	args: { sessionToken: v.optional(v.string()), barcode: v.string() },
	handler: async (ctx, { sessionToken, barcode }) => {
		const user = await requireClient(ctx, sessionToken);
		const code = barcode.replace(/\D/g, "");
		if (!code) return null;
		return (
			(await ctx.db
				.query("customFoods")
				.withIndex("by_barcode", (q) => q.eq("barcode", code))
				// ISOLATION : l'index est global (toutes clientes) — la lecture
				// reste STRICTEMENT limitée aux aliments personnels de la cliente.
				.filter((q) => q.eq(q.field("userId"), user._id))
				.first()) ?? null
		);
	},
});

/**
 * Résolution code-barres AVANT création (anti-doublon) : base commune d'abord
 * (`foods`, offId = EAN/GTIN — produits OFF importés), puis les aliments
 * personnels de la cliente. `null` = code inconnu → la création produira un
 * aliment personnel + un simple CANDIDAT global (jamais de publication auto).
 *
 * Règle produit : si le code existe déjà, la cliente NE crée NI doublon
 * global NI candidat — on lui propose la fiche existante.
 */
export const byBarcodeGlobal = query({
	args: { sessionToken: v.optional(v.string()), barcode: v.string() },
	handler: async (ctx, { sessionToken, barcode }) => {
		const user = await requireClient(ctx, sessionToken);
		const code = barcode.replace(/\D/g, "");
		if (!code) return null;
		// 1) Base commune (780k produits OFF importés) — kcal sous garde-fou.
		const f = await ctx.db
			.query("foods")
			.withIndex("by_offId", (q) => q.eq("offId", code))
			.first();
		if (f) {
			const g = applyKcalGuard(f);
			return {
				source: "global" as const,
				foodId: f._id,
				name: f.name,
				brand: f.brand,
				kcal100: g.kcal100,
				carbs100: f.carbs100,
				protein100: f.protein100,
				fat100: f.fat100,
				servingQty: f.servingQty,
				servingUnit: f.servingUnit,
				kcalRecalculated: g.kcalRecalculated || undefined,
			};
		}
		// 2) Déjà créé par cette cliente ("Plus tard" d'une fois précédente…).
		const own = await ctx.db
			.query("customFoods")
			.withIndex("by_barcode", (q) => q.eq("barcode", code))
			.filter((q) => q.eq(q.field("userId"), user._id))
			.first();
		if (own) {
			return {
				source: "own" as const,
				customFoodId: own._id,
				name: own.name,
				brand: own.brand,
				kcal100: own.kcal100,
				carbs100: own.carbs100,
				protein100: own.protein100,
				fat100: own.fat100,
				servingQty: own.servingQty,
				// Rescan d'un produit créé par la cliente : sa photo suit la fiche.
				photoUrl: own.photoStorageId ? ((await ctx.storage.getUrl(own.photoStorageId)) ?? undefined) : undefined,
			};
		}
		return null;
	},
});

/**
 * Candidats globaux en attente de revue (réservé coach — brique du futur
 * enrichissement de la base globale, aucun automatisme).
 */
export const globalCandidates = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		if (coach.role !== "coach") throw new ConvexError("Réservé à la coach.");
		const rows = await ctx.db.query("customFoods").collect();
		return rows.filter((r) => r.globalStatus === "candidate" && r.barcode);
	},
});