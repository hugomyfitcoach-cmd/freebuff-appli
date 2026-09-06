import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { checkinStatus } from "./schema";
import { EMAIL_RE, hashPassword, getSessionUser, normalizeEmail } from "./helpers";

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
	return { _id: user._id, email: user.email, prenom: user.prenom, disabled: !!user.disabled, createdAt: user._creationTime };
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
		return rows.sort(
			(a, b) =>
				(b.latest?.weekStart ?? "").localeCompare(a.latest?.weekStart ?? "") ||
				a.user.prenom.localeCompare(b.user.prenom, "fr")
		);
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

/** Modifie prénom et/ou email d'un client. */
export const updateClient = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		prenom: v.optional(v.string()),
		email: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, userId, prenom, email }) => {
		await requireCoach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		const patch: Partial<Pick<UserRow, "prenom" | "email">> = {};
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
