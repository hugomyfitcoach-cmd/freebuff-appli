import type { PageServerLoad } from "./$types";
import { convex } from "$lib/server/convex";
import { api } from "../../../convex/_generated/api.js";
import { SESSION_COOKIE, requireRole } from "$lib/server/session";

/**
 * « Mon hydratation » — objectif + historique par jour.
 * Source unique : hydrationEntries + hydrationGoals (mêmes données que
 * l'Accueil et le CRM coach). Non bloquant : un backend déployé sans le
 * module renvoie null — l'écran affiche son état vide, jamais d'erreur 500.
 */
export const load: PageServerLoad = async (event) => {
  await requireRole(event, "client", { next: "/espace/hydratation" });
  const token = event.cookies.get(SESSION_COOKIE);
  const history = await convex
    .query(api.hydration.myHistory, { sessionToken: token })
    .catch(() => null);
  return { history };
};
