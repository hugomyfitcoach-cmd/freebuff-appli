import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

/**
 * Tâche planifiée : purge automatique des retours audio expirés.
 *
 * Règle de rétention (la première échéance atteinte gagne) :
 *   - 72 h après la première écoute réelle de la cliente ;
 *   - au plus tard 14 jours après la publication.
 *
 * Le nettoyage ne dépend jamais d'une ouverture de page : la purge tourne
 * chaque heure et supprime réellement le fichier du storage, puis marque la
 * ligne « expired » (le bilan texte, lui, reste conservé).
 */
const crons = cronJobs();

crons.interval(
	"purge-audios-expires",
	{ hours: 1 },
	api.media.expire,
	{ guard: "cron-purge-2026" }
);

export default crons;
