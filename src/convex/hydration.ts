import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { dateISOInTimeZone, getSessionUser } from "./helpers";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * HYDRATATION — suivi de la consommation d'eau par cliente (Application cliente
 * + CRM coach). Construit sur le même principe que `steps.ts` :
 *
 * — Une seule source de vérité : la table `hydrationEntries`, lue par
 *   l'application cliente (Journal de l'eau) ET le CRM coach (Vision 360).
 *   Aucune deuxième base, aucune donnée fictive.
 * — Dates "yyyy-mm-dd" calculées CÔTÉ CLIENTE (fuseau local du navigateur ;
 *   la cliente saisit où elle vit) et lui sont transmises au serveur, même
 *   convention que dailySteps.date, appointments, mealLogs… Le serveur
 *   revalide le format mais ne re-déchire jamais la date : il ferait une
 *   erreur de fuseau du make-serve (UTC vs Europe/Paris).
 * — Droits :
 *     • la cliente ne lit et n'écrit QUE ses propres lignes ;
 *     • le coach ne lit QUE via la vérification de rôle coach (modèle
 *       d'accès du CRM, comme coach.listClients / checkinsFor).
 * — Heal Goal : la cliente définit son objectif (500–6 000 ml). Encadrement
 *   coach-driven : pas de changement d'objectif par le coach dans V1 (comme
 *   stepGoal, une évolution coach-driven reste possible).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HYDRATION_GOAL_MIN = 500;
export const HYDRATION_GOAL_MAX = 6000;
export const ML_MAX = 5000;

async function requireClient(
  ctx: Pick<MutationCtx, "db">,
  sessionToken: string | undefined | null,
) {
  const user = await getSessionUser(ctx, sessionToken);
  if (!user)
    throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
  if (user.role !== "client") {
    throw new ConvexError(
      "Seuls les comptes clients peuvent enregistrer leur hydratation.",
    );
  }
  return user;
}

/** Objectif applicable : la ligne du user, sinon 2500 par défaut (maquette). */
async function getGoal(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
): Promise<number> {
  const row = await ctx.db
    .query("hydrationGoals")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return row?.goalMl ?? 2500;
}

async function upsertGoal(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  goalMl: number,
): Promise<void> {
  const row = await ctx.db
    .query("hydrationGoals")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (row) await ctx.db.patch(row._id, { goalMl });
  else {
    await ctx.db.insert("hydrationGoals", {
      userId,
      goalMl,
      updatedAt: Date.now(),
    });
  }
}

/** Objectifs d'hydratation — 1 ligne par cliente (la cliente la modifie elle-même). */

/**
 * Client — écran Hydratation : objectif + historique par date (desc ; une
 * seule ligne par jour, agrégats calculés ici — jamais des pages 30 j de
 * données brutes vers le navigateur).
 */
export const myHistory = query({
  args: {
    sessionToken: v.optional(v.string()),
    dates: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { sessionToken, dates }) => {
    const user = await getSessionUser(ctx, sessionToken);
    if (!user || user.role !== "client")
      throw new ConvexError("Session invalide.");
    const goal = await getGoal(ctx, user._id);
    const allRaw = await ctx.db
      .query("hydrationEntries")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
    // Europe/Paris est la référence métier commune au Journal et à l'Hydratation.
    // Le filtre optionnel `dates` de l'écran (historique paginé) s'applique
    // en plus de la borne « pas de donnée future ».
    const today = dateISOInTimeZone(Date.now(), "Europe/Paris");
    const notFuture = (r: { date: string }) => r.date <= today;
    const filtered = (
      dates ? allRaw.filter((r) => dates.includes(r.date)) : allRaw
    ).filter(notFuture);
    const byDate = new Map<string, number>();
    for (const r of filtered)
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.ml);
    return {
      goalMl: goal,
      days: [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([date, ml]) => ({ date, ml })),
      // Les dernières prises en clair (annulation + détail horaire du jour).
      lastEntries: allRaw.slice(0, 30).map((r) => ({
        _id: r._id,
        date: r.date,
        ml: r.ml,
        createdAt: r.createdAt,
      })),
    };
  },
});

/** Client — enregistre une consommation (raccourci 150/250/500 ou saisie). */
export const addWater = mutation({
  args: {
    sessionToken: v.optional(v.string()),
    date: v.string(),
    ml: v.number(),
  },
  handler: async (ctx, { sessionToken, date, ml }) => {
    const user = await requireClient(ctx, sessionToken);
    if (!DATE_RE.test(date)) throw new ConvexError("Date invalide.");
    if (!Number.isInteger(ml) || ml <= 0 || ml > ML_MAX) {
      throw new ConvexError("Quantité du jour invalide (entre 1 et 5000 ml).");
    }
    await ctx.db.insert("hydrationEntries", {
      userId: user._id,
      date,
      ml,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Client — supprime une saisie (cœur/tablette : annuler une erreur). */
export const deleteEntry = mutation({
  args: {
    sessionToken: v.optional(v.string()),
    entryId: v.id("hydrationEntries"),
  },
  handler: async (ctx, { sessionToken, entryId }) => {
    const user = await requireClient(ctx, sessionToken);
    const row = await ctx.db.get(entryId);
    if (!row) throw new ConvexError("Saisie introuvable.");
    // Appartenance stricte : mêmes enregistrements que sa propre écran.
    if (row.userId !== user._id) throw new ConvexError("Action non autorisée.");
    await ctx.db.delete(entryId);
    return { ok: true };
  },
});

/** Client — personnalise l'objectif quotidien (500–6 000 ml). */
export const saveGoal = mutation({
  args: { sessionToken: v.optional(v.string()), goalMl: v.number() },
  handler: async (ctx, { sessionToken, goalMl }) => {
    const user = await requireClient(ctx, sessionToken);
    if (
      !Number.isInteger(goalMl) ||
      goalMl < HYDRATION_GOAL_MIN ||
      goalMl > HYDRATION_GOAL_MAX
    ) {
      throw new ConvexError("Objectif invalide (entre 500 et 6000 ml).");
    }
    await upsertGoal(ctx, user._id, goalMl);
    return { ok: true };
  },
});

/**
 * Coach — historique d'hydratation d'une cliente.
 *
 * Garde-fous — MEME modèle d'accès que le reste du CRM mono-coach :
 * — session coach requise (requireCoach équivalent) ;
 * — la cible doit être une cliente existante (comme coach.checkinsFor).
 * Les données renvoyées sont celles de la table hydrationEntries —
 * exactement les mêmes enregistrements que l'écran cliente : aucune copie,
 * aucune donnée dérivée.
 */
export const clientHydration = query({
  args: { sessionToken: v.optional(v.string()), clientId: v.id("users") },
  handler: async (ctx, { sessionToken, clientId }) => {
    const coach = await getSessionUser(ctx, sessionToken);
    if (!coach || coach.role !== "coach")
      throw new ConvexError("Accès réservé au coach.");
    const client = await ctx.db.get(clientId);
    if (!client || client.role !== "client")
      throw new ConvexError("Cliente introuvable.");
    const goal = await getGoal(ctx, clientId);
    const rows = await ctx.db
      .query("hydrationEntries")
      .withIndex("by_user", (q) => q.eq("userId", clientId))
      .order("desc")
      .collect();
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.ml);
    const days = [...byDate.entries()].map(([date, ml]) => ({ date, ml }));
    return {
      goalMl: goal,
      days,
    };
  },
});
