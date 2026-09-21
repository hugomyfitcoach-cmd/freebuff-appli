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
 *     de démarrage envoyé) : enregistrés directement dans les mutations qui
 *     les produisent (metrics, photos, appointments, onboarding.save) —
 *     jamais déduits à postériori, donc jamais ratés.
 *  2) Alerte DÉRIVÉE UNIQUE (aucune connexion depuis 4 jours), posée par le
 *     cron `notifications-tick` toutes les 30 minutes.
 *
 * L'ancien type « bilan_manquant » a été retiré — le tick purge les lignes
 * historiques correspondantes. « bilan_envoye » est RÉINTRODUIT : un bilan
 * hebdo soumis par une cliente est un événement RÉEL enregistré dans la
 * transaction de `checkins.submit` — le coach le voit dans son journal et son
 * badge CRM vit en temps réel (mécanisme central de propagation).
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
/** Événements cliente du poller conservés 7 jours (signal éphémère). */
const CLIENT_EVENTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function requireCoach(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

/* ═══════════════ Enregistrement interne (utilisée par les mutations métier) ═══════════════ */

/**
 * Insère une notification d'événement réel. À appeler depuis les mutations
 * métier (metrics, photos, appointments, onboarding.save, checkins.submit) —
 * les données clientes sont déjà vérifiées par l'appelant : aucune
 * revérification ici, la fonction n'est pas exposée publiquement.
 */
export async function recordEvent(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">,
	kind:
		| "nouveau_poids"
		| "nouvelles_mesures"
		| "nouvelles_photos"
		| "bilan_envoye"
		| "plan_assigned"
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
	// Signal temps réel : toute nouvelle notification fait avancer le compteur
	// meta que le poller CRM relit toutes les 5 s (badge live sans refresh).
	await bumpCoachEvents(ctx);
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

/* ═══════ Événements cliente (poller, delta ?since=) ═══════ */

/**
 * Enregistre un événement destiné à la cliente — à appeler dans la transaction
 * métier de tout flux coach → cliente qui dépasse le simple badge : la page
 * concernée doit être rafraîchie automatiquement (ex. plan de repas assigné →
 * propositions du Journal). Le poller relit les lignes créées depuis son
 * dernier check et invalide la donnée concernée.
 */
export async function recordClientEvent(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">,
	kind: string,
	label?: string
): Promise<void> {
	await ctx.db.insert("clientEvents", { userId, kind, ...(label ? { label: label.slice(0, 120) } : {}), createdAt: Date.now() });
}

/* ═══════ Signal temps réel (mécanisme central de propagation) ═══════ */

/** Clé de la ligne meta portant le compteur d'événements coach. */
const COACH_EVENTS_META_KEY = "coach_events";

/**
 * Relié à CHAQUE insertion de notification coach : le poller client lit cette
 * valeur (entier cumulé dans la table meta, infrastructure pure) — toute
 * augmentation = « un événement est arrivé » → relecture du journal + badge.
 * Comparer deux entiers (avant/après) suffit : la purge et les marquages de
 * lecture ne touchent jamais ce compteur, donc jamais de faux positif.
 */
export async function bumpCoachEvents(ctx: Pick<MutationCtx, "db">): Promise<void> {
	const row = await ctx.db
		.query("meta")
		.withIndex("by_key", (q) => q.eq("key", COACH_EVENTS_META_KEY))
		.first();
	if (row) await ctx.db.patch(row._id, { version: (row.version ?? 0) + 1 });
	else await ctx.db.insert("meta", { key: COACH_EVENTS_META_KEY, version: 1 });
}

/** Version du signal coach (événements cumulés) — lue par le poller (5 s). */
export const seenCoachEventsVersion = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		await requireCoach(ctx, sessionToken);
		const row = await ctx.db
			.query("meta")
			.withIndex("by_key", (q) => q.eq("key", COACH_EVENTS_META_KEY))
			.first();
		return { version: row?.version ?? 0 };
	},
});

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

/** Compteur d'événements cliente créés depuis `since` (ms) — polling delta. */
export const newClientEvents = query({
	args: { sessionToken: v.optional(v.string()), since: v.number() },
	handler: async (ctx, { sessionToken, since }) => {
		const user = await requireClientOfEvents(ctx, sessionToken);
		const rows = await ctx.db
			.query("clientEvents")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.take(20);
		return rows.filter((r) => r.createdAt > since).map((r) => ({ kind: r.kind, label: r.label ?? null, createdAt: r.createdAt }));
	},
});

async function requireClientOfEvents(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("Réservé à l'espace cliente.");
	return user;
}

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
			// Type « bilan_manquant » retiré : les lignes historiques déjà en base
			// sont supprimées au premier tick suivant (cast string : le type ne
			// porte plus ce littéral).
			if ((r.kind as string) === "bilan_manquant") {
				await ctx.db.delete(r._id);
				continue;
			}
			const isDerived = r.kind === "inactivite";
			const ttl = isDerived ? RETENTION_DERIVED_MS : RETENTION_EVENTS_MS;
			if (now - r._creationTime > ttl) await ctx.db.delete(r._id);
		}

		/* ── 3) Purge des événements cliente du poller (7 jours) ───────── */
		const oldEvents = await ctx.db
			.query("clientEvents")
			.withIndex("by_user")
			.filter((q) => q.lt(q.field("createdAt"), now - CLIENT_EVENTS_TTL_MS))
			.take(500);
		for (const e of oldEvents) await ctx.db.delete(e._id);

		return { ok: true };
	},
});
