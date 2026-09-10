"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { webpush } from "./webPushVendors";

/**
 * RAPPEL 12 h — envoi de la notification push (côté Convex, §30).
 *
 * Une notification système doit pouvoir partir alors que l'app est fermée :
 * le déclenchement ne peut pas vivre dans le navigateur (setTimeout, timer…).
 * Convex exécute cette action côté serveur Node, schedulée par le cron
 * `reminder-12h-tick` (toutes les 5 minutes).
 *
 * Idempotence (§26) : la mutation transactionnelle `internalMarkReminderSent`
 * fait office de verrou — elle n'aboutit qu'UNE fois par (appointment,
 * startAt). Si l'envoi réussit mais que le marquage échoue (RDV replanifié
 * entre-temps), la prochaine exécution partira du NOUVEAU startAt : pas de
 * doublon pour la même date, pas de rappel obsolète (§27).
 *
 * Permission (§24) : push uniquement si pushPermission = "granted" ET qu'un
 * abonnement existe. Sinon, le rappel reste interne (Accueil + badge) et le
 * rendez-vous fonctionne exactement pareil.
 */

type Payload = { title: string; body: string; url: string; tag: string };

/** Ligne renvoyée par internal.appointments.internalWindow (annotation explicite :
 *  évite la circularité d'inférence rows ↔ fonction référencée). */
type ReminderRow = {
	_id: string;
	clientId: string;
	date: string;
	time: string;
	kind: string;
	status: string;
	startAtMs: number;
	reminder12hSentAt: number | null;
	reminder12hForStartAt: number | null;
};

export const tick = internalAction({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const rows: ReminderRow[] = await ctx.runQuery(internal.appointments.internalWindow, { now });
		let pushed = 0;
		for (const r of rows) {
			// Fenêtre ACTIVE : entré dans les 12 h précédant le RDV, pas encore commencé.
			if (r.startAtMs - now > 12 * 3600 * 1000) continue; // pas encore dans la fenêtre (§42)
			if (r.startAtMs <= now) continue; // RDV commencé/passé → plus de rappel (§43)

			// Déjà envoyé pour CE startAt ? → rien à faire (jamais de doublon).
			if (r.reminder12hSentAt && r.reminder12hForStartAt === r.startAtMs) continue;
			// Envoyé pour un ANCIEN startAt (RDV replanifié après envoi, §27) :
			// l'état sera réarmé par le marquage ci-dessous, sans rien bloquer.

			const user = await ctx.runQuery(internal.users.internalUserById, {
				userId: r.clientId as never,
			});
			if (!user) continue;

			// Heure affichée : fuseau de la cliente (repli Europe/Paris).
			const hhmm = new Intl.DateTimeFormat("fr-FR", {
				hour: "2-digit",
				minute: "2-digit",
				timeZone: user.timeZone ?? "Europe/Paris",
			}).format(new Date(r.startAtMs));

			// 1) Verrou idempotent AVANT l'envoi : posé une seule fois par (rdv, startAt).
			const lock = await ctx.runMutation(internal.appointments.internalMarkReminderSent, {
				appointmentId: r._id as never,
				startAtMs: r.startAtMs,
			});
			if (!lock.ok) continue;

			// 2) Notification système — uniquement si permission accordée ET
			// si le client web-push est disponible (clés VAPID présentes).
			if (user.pushPermission === "granted" && webpush) {
				const wp = webpush; // capture non-null (narrowing stable dans la closure)
				const subs = await ctx.runQuery(internal.push.internalSubscriptionsOfUser, {
					userId: r.clientId as never,
				});
				if (subs.length > 0) {
					const payload: Payload = {
						title: "G-FLUX",
						body: `N'oublie pas ton rendez-vous coaching à ${hhmm}.`,
						url: "/espace/rendez-vous",
						tag: `rdv-${r._id}-${r.startAtMs}`,
					};
					await Promise.allSettled(
						subs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
							try {
								await wp.sendNotification(
									{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
									JSON.stringify(payload),
									{ TTL: 12 * 3600 }
								);
							} catch (e) {
								const code = (e as { statusCode?: number }).statusCode;
								if (code === 404 || code === 410) {
									await ctx.runMutation(internal.push.internalRemoveEndpoint, {
										endpoint: sub.endpoint,
									});
								}
							}
						})
					);
					pushed++;
				}
			}
			// Permission refusée / absente : rien ici — le rappel Accueil + badge
			// sont dérivés côté dashboard (mêmes startAt/status), jamais bloqués.
		}
		return { ok: true, considered: rows.length, pushed };
	},
});
