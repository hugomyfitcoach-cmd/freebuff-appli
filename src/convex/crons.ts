import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

/**
 * Tâches planifiées G-FLUX.
 *
 * 1) Purge des retours audio expirés (chaque heure).
 * 2) RAPPEL 12 h des rendez-vous confirmés (toutes les 5 minutes) :
 *    l'envoi vit côté backend (action Convex) pour que la notification parte
 *    même quand l'app de la cliente est fermée — jamais un timer navigateur.
 *    Idempotence garantie par appointments.internalMarkReminderSent (§26) :
 *    un job exécuté plusieurs fois n'envoie jamais deux fois le même rappel.
 */
const crons = cronJobs();

crons.interval(
	"purge-audios-expires",
	{ hours: 1 },
	api.media.expire,
	{ guard: "cron-purge-2026" }
);

crons.interval("reminder-12h-tick", { minutes: 5 }, internal.reminderPush.tick, {});

export default crons;
