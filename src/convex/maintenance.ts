import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Maintenance du file storage (réservé aux opérations, jamais exposé au
 * navigateur — fonction interne uniquement).
 *
 * Supprime des blobs de `_storage` APRÈS re-vérification, dans la même
 * transaction, qu'aucun document métier ne les référence :
 * - `progressPhotos.photos[].storageId`
 * - `coachMedia.storageId`
 * - `coachResources.storageId`
 *
 * Un blob référencé (ou dont la vérification échoue) est conservé et signalé
 * dans `kept`. Sert par exemple à purger les fichiers orphelins laissés par
 * des tentatives d'upload interrompues (photo envoyée sur le storage mais
 * série jamais enregistrée).
 */
export const deleteOrphanStorage = internalMutation({
	args: { storageIds: v.array(v.id("_storage")) },
	handler: async (ctx, { storageIds }) => {
		const deleted: string[] = [];
		const kept: { storageId: string; reason: string }[] = [];

		for (const storageId of storageIds) {
			// Re-vérification transactionnelle : aucun document ne doit référencer
			// ce blob au moment de la suppression.
			let referenced = false;

			const photos = await ctx.db.query("progressPhotos").collect();
			outerPhotos: for (const row of photos) {
				for (const p of row.photos) {
					if (p.storageId === storageId) {
						referenced = true;
						break outerPhotos;
					}
				}
			}

			if (!referenced) {
				const medias = await ctx.db.query("coachMedia").collect();
				for (const row of medias) {
					if (row.storageId === storageId) {
						referenced = true;
						break;
					}
				}
			}

			if (!referenced) {
				const resources = await ctx.db.query("coachResources").collect();
				for (const row of resources) {
					if (row.storageId === storageId || row.attachments?.some((a) => a.storageId === storageId)) {
						referenced = true;
						break;
					}
				}
			}

			if (referenced) {
				kept.push({ storageId, reason: "référencé par un document métier" });
				continue;
			}

			await ctx.storage.delete(storageId);
			deleted.push(storageId);
		}

		return { deleted, kept };
	},
});
