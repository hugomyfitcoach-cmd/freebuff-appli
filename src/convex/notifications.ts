import { internalMutation, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getSessionUser } from "./helpers";

/**
 * NOTIFICATIONS COACH (CRM) — journal centralisé de l'activité cliente.
 *
 * Deux familles d'événements :
 *  1) Événements RÉELS (poids, mensurations, photos, rendez-vous, formulaire
 *     de démarrage complété) : enregistrés directement dans les mutations qui
 *     les produisent (metrics, photos, appointments, onboarding.complete) —
 *     jamais déduits à postériori, donc jamais ratés.
 *  2) Alerte DÉRIVÉE UNIQUE (aucune connexion depuis 4 jours), posée par le
 *     cron `notifications-tick` toutes les 30 minutes.
 *
 * Les types « bilan_envoye » et « bilan_manquant » ont été retirés — le tick
 * purge les lignes historiques correspondantes.
 *
 * Anti-doublons : chaque alerte dérivée porte une `dedupKey` par PÉRIODE
 * (inactivité = 1 seule alerte tant que la cliente ne revient pas). La garde
 * est relue DANS la mutation transactionnelle — un double tick n'insère
 * jamais deux fois la même ligne. L'alerte d'inactivité se RÉSOUT
 * AUTOMATIQUEMENT quand la cliente revient : le prochain `notifications-tick`
 * la marque « vue ».
 */

/** Seuil d'inactivité : aucune connexion depuis 4 jours (96 h). */
const INACTIVITY_MS = 4 * 24 * 60 * 60 * 1000;

/** Notifs dérivées conservées 90 jours, événements réels 180 jours. */
const RETENTION_DERIVED_MS = 90 * 24 * 60 * 60 * 1000;
const RETENTION_EVENTS_MS = 180 * 24 * 60 * 60 * 1000;

async function requireCoach(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

/* ═══════════════ Enregistrement interne (utilisée par les mutations métier) ═══════════════ */

/**
 * Insère une notification d'événement réel. À appeler depuis les mutations
 * métier (metrics, photos, appointments, coach.setFeedback) — les données
 * clientes sont déjà vérifiées par l'appelant : aucune revérification ici,
 * la fonction n'est pas exposée publiquement.
 */
export async function recordEvent(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">,
	kind:
		| "nouveau_poids"
		| "nouvelles_mesures"
		| "nouvelles_photos"
		| "rdv_pris"
		| "rdv_annule"
		| "rdv_replanifie"
		| "onboarding_termine",
	description: string,
	opts?: { checkinId?: Id<"checkins">; appointmentId?: Id<"appointments">; weekStart?: string }
): Promise<void> {
	await ctx.db.insert("coachNotifications", {
		userId,
		kind,
		description: description.slice(0, 300),
		read: false,
		...(opts?.checkinId ? { checkinId: opts.checkinId } : {}),
		...(opts?.appointmentId ? { appointmentId: opts.appointmentId } : {}),
		...(opts?.weekStart ? { weekStart: opts.weekStart } : {}),
	});
}

/**
 * Marque « vue » l'alerte d'inactivité ACTIVE d'une cliente (dedupKey en
 * `inact:`) — appelée quand la cliente se reconnecte. Une seule ligne
 * correspond : la garde transactionnelle du tick garantit l'unicité.
 */
export async function resolveInactivity(ctx: Pick<MutationCtx, "db">, userId: Id<"users">): Promise<void> {
	const row = await ctx.db
		.query("coachNotifications")
		.withIndex("by_dedup", (q) => q.eq("dedupKey", `inact:${userId}`))
		.first();
	if (row && !row.read) await ctx.db.patch(row._id, { read: true });
}

/* ═══════════════ Requêtes CRM (réservées au coach) ═══════════════ */

/** Journal d'activité centralisé — 150 notifications les plus récentes. */
export const list = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		await requireCoach(ctx, sessionToken);
		const rows = await ctx.db.query("coachNotifications").order("desc").take(150);
		const names = new Map<Id<"users">, string>();
		const out = [];
		for (const r of rows) {
			let prenom = names.get(r.userId);
			if (prenom === undefined) {
				const u = await ctx.db.get(r.userId);
				prenom = u ? (u.nom ? `${u.prenom} ${u.nom}` : u.prenom) : "Cliente supprimée";
				names.set(r.userId, prenom);
			}
			out.push({
				_id: r._id,
				userId: r.userId,
				prenom,
				kind: r.kind,
				description: r.description,
				read: r.read,
				createdAt: r._creationTime,
				weekStart: r.weekStart ?? null,
			});
		}
		return out;
	},
});

/** Badge CRM : nombre de notifications « à consulter » (non lues). */
export const unreadCount = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("coachNotifications")
			.withIndex("by_read", (q) => q.eq("read", false))
			.collect();
		return rows.length;
	},
});

/**
 * Marque une notification comme « vue ». Idempotent : vue deux fois = un
 * seul changement d'état. Retourne le userId pour la navigation du client.
 */
export const markRead = mutation({
	args: { sessionToken: v.optional(v.string()), notificationId: v.id("coachNotifications") },
	handler: async (ctx, { sessionToken, notificationId }) => {
		await requireCoach(ctx, sessionToken);
		const row = await ctx.db.get(notificationId);
		if (!row) throw new ConvexError("Notification introuvable.");
		if (!row.read) await ctx.db.patch(notificationId, { read: true });
		return { ok: true, userId: row.userId as Id<"users"> };
	},
});

/** « Tout marquer comme vu » — un patch par ligne non lue (limite 500). */
export const markAllRead = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("coachNotifications")
			.withIndex("by_read", (q) => q.eq("read", false))
			.take(500);
		for (const r of rows) await ctx.db.patch(r._id, { read: true });
		return { ok: true, marked: rows.length };
	},
});

/* ═══════════════ Tick dérivé (cron, toutes les 30 minutes) ═══════════════ */

/**
 * Alerte « aucune connexion depuis 4 jours » :
 * - UNE SEULE alerte par période : la ligne porte la dedupKey `inact:<userId>`
 *   tant que la cliente n'est pas revenue — les ticks suivants sont ignorés ;
 * - RÉSOLUTION AUTOMATIQUE : dès que la cliente se reconnecte (lastSeenAt
 *   récent), l'alerte non lue est marquée « vue » — sans doublon, la clé est
 *   réutilisable pour la PROCHAINE période d'inactivité ;
 * - Les clientes sans aucune connexion connue (lastSeenAt vide) ne génèrent
 *   jamais d'alerte : rien ne prouve qu'elles se sont déjà connectées.
 */
export const tick = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const users = await ctx.db.query("users").filter((q) => q.eq(q.field("role"), "client")).collect();

		/* ── 1) Inactivité (≥ 4 jours) ───────────────────────────────────── */
		for (const u of users) {
			if (u.disabled) continue;
			const key = `inact:${u._id}`;
			const existing = await ctx.db
				.query("coachNotifications")
				.withIndex("by_dedup", (q) => q.eq("dedupKey", key))
				.first();
			if (u.lastSeenAt && now - u.lastSeenAt >= INACTIVITY_MS) {
				// Cliente inactive : une seule alerte par période (dedupKey).
				if (!existing) {
					const jours = Math.floor((now - u.lastSeenAt) / (24 * 60 * 60 * 1000));
					await ctx.db.insert("coachNotifications", {
						userId: u._id,
						kind: "inactivite",
						description: `Aucune connexion depuis ${jours} jours.`,
						read: false,
						dedupKey: key,
					});
				}
			} else if (existing && !existing.read) {
				// Cliente revenue (ou jamais revenue) : l'alerte se résout d'elle-même.
				await ctx.db.patch(existing._id, { read: true });
			}
		}

		/* ── 2) Purge : notifications trop anciennes + types retirés ─────── */
		const all = await ctx.db.query("coachNotifications").collect();
		for (const r of all) {
			// Types « bilan_envoye » / « bilan_manquant » retirés : les lignes
			// historiques déjà en base sont supprimées au premier tick suivant.
			// (cast string : le type ne porte plus ces littéraux.)
			if ((r.kind as string) === "bilan_envoye" || (r.kind as string) === "bilan_manquant") {
				await ctx.db.delete(r._id);
				continue;
			}
			const isDerived = r.kind === "inactivite";
			const ttl = isDerived ? RETENTION_DERIVED_MS : RETENTION_EVENTS_MS;
			if (now - r._creationTime > ttl) await ctx.db.delete(r._id);
		}
		return { ok: true };
	},
});
