import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { convex } from "$lib/server/convex";
import { api } from "../../../convex/_generated/api.js";
import { SESSION_COOKIE, requireRole } from "$lib/server/session";
import { errMsg } from "$lib/errors.js";

/**
 * HYDRATATION — BFF cliente : lecture (historique + objectif) et écriture
 * (prises d'eau 1–5000 ml ; objectif 500–6000 ml ; suppression d'une prise).
 * Toutes les dates sont calculées CÔTÉ CLIENTE (fuseau local du navigateur)
 * puis validées au serveur : la cliente ne saisit jamais une journée future.
 * GET : objectif + historique journalier (MÊMES données que le CRM coach —
 *      table hydrationEntries ; aucune deuxième base de données).
 * POST : ajouter une prise / supprimer une entrée / modifier l'objectif.
 */

/** Date locale "yyyy-mm-dd" — la même convention que /api/steps. */
function localTodayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const GET: RequestHandler = async (event) => {
  await requireRole(event, "client", { next: "/espace" });
  const token = event.cookies.get(SESSION_COOKIE);
  try {
    const history = await convex.query(api.hydration.myHistory, {
      sessionToken: token,
    });
    return json(history);
  } catch (e) {
    return json({ error: errMsg(e) }, { status: 400 });
  }
};

export const POST: RequestHandler = async (event) => {
  await requireRole(event, "client", { next: "/espace" });
  const token = event.cookies.get(SESSION_COOKIE);
  try {
    const body = await event.request.json();

    /* ── Objectif quotidien (500–6000 ml, validation Convex de toute façon) ── */
    if (body.goalMl !== undefined) {
      const goal = Number(body.goalMl);
      const res = await convex.mutation(api.hydration.saveGoal, {
        sessionToken: token,
        goalMl: goal,
      });
      return json(res);
    }

    /* ── Suppression d'une prise (cœur-long press de l'historique) ── */
    if (body.entryId) {
      if (typeof body.entryId !== "string") throw new Error("Saisie invalide.");
      const res = await convex.mutation(api.hydration.deleteEntry, {
        sessionToken: token,
        entryId: body.entryId as never, // Convex valide le format Id côté serveur
      });
      return json(res);
    }

    /* ── Ajout d'une prise d'eau ── */
    const ml = Number(body.ml);
    if (!Number.isInteger(ml) || ml < 1 || ml > 5000)
      throw new Error("Quantité invalide (entre 1 et 5000 ml).");
    // Date locale cliente : body.date optionnel, sinon aujourd'hui local.
    // Garde-fou : jamais de conso DANS LE FUTUR (tolérance ±1 jour fuseau).
    let date =
      typeof body.date === "string" && body.date ? body.date : localTodayISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date invalide.");
    if (date < localTodayISO(-1) || date > localTodayISO(1))
      throw new Error("Date trop éloignée (futur ou passé lointain interdit).");
    const res = await convex.mutation(api.hydration.addWater, {
      sessionToken: token,
      date,
      ml,
    });
    return json(res);
  } catch (e) {
    return json({ error: errMsg(e) }, { status: 400 });
  }
};
