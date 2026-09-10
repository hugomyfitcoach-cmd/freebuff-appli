import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { checkinStatus } from "./schema";
import { EMAIL_RE, hashPassword, getSessionUser, normalizeEmail } from "./helpers";
import { DEFAULT_GOALS } from "./journal";

/**
 * CRM réservé au coach. Chaque fonction vérifie le rôle « coach » depuis
 * le jeton de session — même un appel direct à l'API Convex sans session
 * coach valide est refusé ici (pas seulement dans l'interface).
 */

type CheckinRow = Doc<"checkins">;
type UserRow = Doc<"users">;

async function requireCoach(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null): Promise<UserRow> {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Accès réservé au coach.");
	return user;
}

function publicUser(user: UserRow) {
	return {
		_id: user._id,
		email: user.email,
		prenom: user.prenom,
		disabled: !!user.disabled,
		createdAt: user._creationTime,
		heightCm: user.heightCm ?? null,
		birthDate: user.birthDate ?? null,
		lastSeenAt: user.lastSeenAt ?? null,
	};
}

export type ClientWithStats = {
	user: ReturnType<typeof publicUser>;
	count: number;
	waiting: number;
	latest: CheckinRow | null;
};

/** Liste des comptes clients avec leurs statistiques (bilan le plus récent en premier). */
export const listClients = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }): Promise<ClientWithStats[]> => {
		await requireCoach(ctx, sessionToken);
		const [users, checkins] = await Promise.all([
			ctx.db.query("users").filter((q) => q.eq(q.field("role"), "client")).collect(),
			ctx.db.query("checkins").collect(),
		]);
		const byUser = new Map<Id<"users">, CheckinRow[]>();
		for (const c of checkins) {
			const list = byUser.get(c.userId);
			if (list) list.push(c);
			else byUser.set(c.userId, [c]);
		}
		const rows: ClientWithStats[] = users.map((user) => {
			const list = (byUser.get(user._id) ?? []).slice().sort((a, b) => b.weekStart.localeCompare(a.weekStart));
			return {
				user: publicUser(user),
				count: list.length,
				waiting: list.filter((c) => c.status === "nouveau").length,
				latest: list[0] ?? null,
			};
		});
		// Tri par dernière connexion (les plus actifs en premier), puis par prénom.
		return rows.sort((a, b) => {
			const la = a.user.lastSeenAt ?? 0;
			const lb = b.user.lastSeenAt ?? 0;
			if (la !== lb) return lb - la;
			return a.user.prenom.localeCompare(b.user.prenom, "fr");
		});
	},
});

/** Tous les bilans d'un client (le coach peut consulter n'importe lequel). */
export const checkinsFor = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		await requireCoach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		return await ctx.db
			.query("checkins")
			.withIndex("by_user_week", (q) => q.eq("userId", userId))
			.order("desc")
			.collect();
	},
});

/** Enregistre le retour écrit du coach et change le statut du bilan. */
export const setFeedback = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		checkinId: v.id("checkins"),
		feedback: v.string(),
		status: checkinStatus,
	},
	handler: async (ctx, { sessionToken, checkinId, feedback, status }) => {
		await requireCoach(ctx, sessionToken);
		const checkin = await ctx.db.get(checkinId);
		if (!checkin) throw new ConvexError("Bilan introuvable.");
		const trimmed = feedback.trim();
		const patch: { feedback?: string; status: "nouveau" | "retour_envoye"; feedbackAt?: number } = { status };
		if (trimmed) patch.feedback = trimmed;
		if (status === "retour_envoye") patch.feedbackAt = Date.now();
		await ctx.db.patch(checkinId, patch);
		return { ok: true, status };
	},
});

/** Crée un compte client (email + mot de passe + prénom). */
export const createClient = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		email: v.string(),
		password: v.string(),
		prenom: v.string(),
	},
	handler: async (ctx, { sessionToken, email, password, prenom }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const emailClean = normalizeEmail(email);
		if (!EMAIL_RE.test(emailClean)) throw new ConvexError("Adresse email invalide.");
		const prenomClean = prenom.trim().slice(0, 60);
		if (!prenomClean) throw new ConvexError("Le prénom est requis.");
		if (password.length < 8) {
			throw new ConvexError("Le mot de passe doit faire au moins 8 caractères.");
		}
		const clash = await ctx.db
			.query("users")
			.withIndex("by_email", (q) => q.eq("email", emailClean))
			.unique();
		if (clash) throw new ConvexError("Un compte existe déjà avec cet email.");
		const id = await ctx.db.insert("users", {
			email: emailClean,
			passwordHash: await hashPassword(password),
			role: "client",
			prenom: prenomClean,
			createdBy: coach._id,
		});
		return { ok: true, userId: id };
	},
});

/** Modifie la fiche d'un client (prénom, email, date de naissance, taille). */
export const updateClient = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		prenom: v.optional(v.string()),
		email: v.optional(v.string()),
		birthDate: v.optional(v.string()),
		heightCm: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, userId, prenom, email, birthDate, heightCm }) => {
		await requireCoach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		const patch: Partial<Pick<UserRow, "prenom" | "email" | "birthDate" | "heightCm">> = {};
		if (prenom !== undefined) {
			const clean = prenom.trim().slice(0, 60);
			if (!clean) throw new ConvexError("Le prénom ne peut pas être vide.");
			patch.prenom = clean;
		}
		if (email !== undefined) {
			const emailClean = normalizeEmail(email);
			if (!EMAIL_RE.test(emailClean)) throw new ConvexError("Adresse email invalide.");
			const clash = await ctx.db
				.query("users")
				.withIndex("by_email", (q) => q.eq("email", emailClean))
				.unique();
			if (clash && clash._id !== userId) {
				throw new ConvexError("Un autre compte utilise déjà cet email.");
			}
			patch.email = emailClean;
		}
		if (birthDate !== undefined) {
			const b = birthDate.trim();
			if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
				throw new ConvexError("Date de naissance invalide (format AAAA-MM-JJ).");
			}
			patch.birthDate = b || undefined;
		}
		if (heightCm !== undefined) {
			if (!isFinite(heightCm) || heightCm < 80 || heightCm > 250) {
				throw new ConvexError("Taille invalide (entre 80 et 250 cm).");
			}
			patch.heightCm = Math.round(heightCm * 10) / 10;
		}
		if (Object.keys(patch).length > 0) await ctx.db.patch(userId, patch);
		return { ok: true };
	},
});

/** Réinitialise le mot de passe d'un client (le coach lui communique le nouveau). */
export const resetPassword = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		newPassword: v.string(),
	},
	handler: async (ctx, { sessionToken, userId, newPassword }) => {
		await requireCoach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		if (newPassword.length < 8) {
			throw new ConvexError("Le mot de passe doit faire au moins 8 caractères.");
		}
		await ctx.db.patch(userId, { passwordHash: await hashPassword(newPassword) });
		// Invalide les sessions existantes de ce client.
		const sessions = await ctx.db
			.query("sessions")
			.filter((q) => q.eq(q.field("userId"), userId))
			.collect();
		for (const s of sessions) await ctx.db.delete(s._id);
		return { ok: true };
	},
});

/** Supprime un compte client et tous ses bilans (action confirmée dans l'UI). */
export const removeClient = mutation({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		await requireCoach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		const rows = await ctx.db
			.query("checkins")
			.withIndex("by_user_week", (q) => q.eq("userId", userId))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
		const sessions = await ctx.db
			.query("sessions")
			.filter((q) => q.eq(q.field("userId"), userId))
			.collect();
		for (const s of sessions) await ctx.db.delete(s._id);
		// Journal alimentaire + objectifs du client.
		const goals = await ctx.db
			.query("clientGoals")
			.withIndex("by_userId", (q) => q.eq("userId", userId))
			.collect();
		for (const g of goals) await ctx.db.delete(g._id);
		const entries = await ctx.db
			.query("diaryEntries")
			.withIndex("by_user_date", (q) => q.eq("userId", userId))
			.collect();
		for (const e of entries) await ctx.db.delete(e._id);
		await ctx.db.delete(userId);
		return { ok: true, removedCheckins: rows.length };
	},
});

/**
 * Vue 360° d'un client pour le CRM : fiche, objectifs, journal des 7 derniers
 * jours (avec totaux quotidiens), suivi corporel (dernière prise + tendance
 * poids) et dernier bilan reçu. Tout au même endroit, en une requête.
 */
export const client360 = query({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
	},
	handler: async (ctx, { sessionToken, userId }) => {
		await requireCoach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");

		const [goalsRow, metrics, checkins, entries] = await Promise.all([
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", userId)).first(),
			ctx.db
				.query("bodyMetrics")
				.withIndex("by_user", (q) => q.eq("userId", userId))
				.order("asc")
				.collect(),
			ctx.db.query("checkins").withIndex("by_user_week", (q) => q.eq("userId", userId)).order("desc").collect(),
			ctx.db.query("diaryEntries").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(400),
		]);

		// Les 7 derniers jours (aujourd'hui compris), clés "yyyy-mm-dd" locales serveur.
		const days: string[] = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date();
			d.setDate(d.getDate() - i);
			days.push(d.toISOString().slice(0, 10));
		}
		const daySet = new Set(days);
		const byDay = new Map<string, { kcal: number; carbs: number; protein: number; fat: number; count: number }>();
		for (const day of days) {
			byDay.set(day, { kcal: 0, carbs: 0, protein: 0, fat: 0, count: 0 });
		}
		for (const e of entries) {
			if (!daySet.has(e.date)) continue;
			const acc = byDay.get(e.date)!;
			acc.kcal += e.kcal;
			acc.carbs += e.carbs;
			acc.protein += e.protein;
			acc.fat += e.fat;
			acc.count += 1;
		}
		const week = days.map((date) => {
			const acc = byDay.get(date)!;
			return {
				date,
				kcal: Math.round(acc.kcal),
				carbs: Math.round(acc.carbs * 10) / 10,
				protein: Math.round(acc.protein * 10) / 10,
				fat: Math.round(acc.fat * 10) / 10,
				count: acc.count,
			};
		});

		const latestMetric = metrics.length > 0 ? metrics[metrics.length - 1] : null;
		const weightTrend = metrics
			.filter((m) => m.weightKg !== undefined)
			.map((m) => ({ date: m.date, weightKg: m.weightKg as number }));
		const firstWeight = weightTrend.length > 0 ? weightTrend[0].weightKg : null;
		const lastWeight = weightTrend.length > 0 ? weightTrend[weightTrend.length - 1].weightKg : null;

		return {
			user: publicUser(target),
			goals: goalsRow ?? { userId, ...DEFAULT_GOALS },
			goalsSet: !!goalsRow,
			week,
			weekAvgKcal:
				week.reduce((s, d) => s + d.kcal, 0) / Math.max(1, week.filter((d) => d.count > 0).length),
			latestMetric,
			weightTrend,
			firstWeight,
			lastWeight,
			latestCheckin: checkins[0] ?? null,
			checkinCount: checkins.length,
		};
	},
});
