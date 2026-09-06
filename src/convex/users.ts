import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
	EMAIL_RE,
	SESSION_TTL_MS,
	getSessionUser,
	hashPassword,
	hashToken,
	newSessionToken,
	normalizeEmail,
	verifyPassword,
} from "./helpers";

/**
 * Comptes (email + mot de passe) et sessions.
 *
 * La protection des données est vérifiée DANS chaque fonction Convex à
 * partir du jeton de session (jamais exposé au JavaScript navigateur) :
 * une requête directe sans jeton valide n'accède à rien.
 */

/** Résout un jeton de session → profil utilisateur (ou null si invalide). */
export const resolveSession = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) return null;
		return { _id: user._id, email: user.email, role: user.role, prenom: user.prenom };
	},
});

/** Connexion email + mot de passe → crée une session, renvoie le jeton brut. */
export const signIn = mutation({
	args: { email: v.string(), password: v.string() },
	handler: async (ctx, { email, password }) => {
		const user = await ctx.db
			.query("users")
			.withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
			.unique();
		if (!user || !(await verifyPassword(user.passwordHash, password))) {
			throw new ConvexError("Email ou mot de passe incorrect.");
		}
		if (user.disabled) {
			throw new ConvexError("Ce compte est désactivé. Contacte ta coach.");
		}
		const token = newSessionToken();
		await ctx.db.insert("sessions", {
			userId: user._id,
			tokenHash: await hashToken(token),
			expiresAt: Date.now() + SESSION_TTL_MS,
		});
		return {
			token,
			user: { _id: user._id, email: user.email, role: user.role, prenom: user.prenom },
		};
	},
});

/** Déconnexion : invalide la session courante. */
export const signOut = mutation({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		if (!sessionToken) return;
		const tokenHash = await hashToken(sessionToken);
		const row = await ctx.db
			.query("sessions")
			.withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
			.unique();
		if (row) await ctx.db.delete(row._id);
	},
});

/** Change le mot de passe de l'utilisateur connecté. */
export const changePassword = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		currentPassword: v.string(),
		newPassword: v.string(),
	},
	handler: async (ctx, { sessionToken, currentPassword, newPassword }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		if (!(await verifyPassword(user.passwordHash, currentPassword))) {
			throw new ConvexError("Le mot de passe actuel est incorrect.");
		}
		if (newPassword.length < 8) {
			throw new ConvexError("Le nouveau mot de passe doit faire au moins 8 caractères.");
		}
		await ctx.db.patch(user._id, { passwordHash: await hashPassword(newPassword) });
		return { ok: true };
	},
});

/** Le client met à jour son prénom affiché. */
export const updateProfile = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		prenom: v.string(),
	},
	handler: async (ctx, { sessionToken, prenom }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
		const clean = prenom.trim().slice(0, 60);
		if (!clean) throw new ConvexError("Le prénom ne peut pas être vide.");
		await ctx.db.patch(user._id, { prenom: clean });
		return { ok: true };
	},
});

/**
 * Crée le premier compte coach (bootstrap).
 * Possible UNIQUEMENT tant qu'aucun coach n'existe, et avec le code secret
 * stocké dans la variable d'environnement Convex COACH_BOOTSTRAP_CODE
 * (`npx convex env set COACH_BOOTSTRAP_CODE '…' --prod`).
 */
export const bootstrapCoach = mutation({
	args: {
		email: v.string(),
		password: v.string(),
		prenom: v.string(),
		code: v.string(),
	},
	handler: async (ctx, { email, password, prenom, code }) => {
		const hasCoach = await ctx.db
			.query("users")
			.filter((q) => q.eq(q.field("role"), "coach"))
			.first();
		if (hasCoach) throw new ConvexError("Un compte coach existe déjà.");
		const expected = process.env.COACH_BOOTSTRAP_CODE;
		if (!expected || code !== expected) {
			throw new ConvexError("Code de bootstrap invalide ou non configuré.");
		}
		const emailClean = normalizeEmail(email);
		if (!EMAIL_RE.test(emailClean)) throw new ConvexError("Adresse email invalide.");
		if (password.length < 8) {
			throw new ConvexError("Le mot de passe doit faire au moins 8 caractères.");
		}
		const prenomClean = prenom.trim().slice(0, 60) || "Coach";
		const id = await ctx.db.insert("users", {
			email: emailClean,
			passwordHash: await hashPassword(password),
			role: "coach",
			prenom: prenomClean,
		});
		return { ok: true, userId: id };
	},
});
