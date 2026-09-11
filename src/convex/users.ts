import { internalQuery, mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";	import {
		EMAIL_RE,
		SESSION_TTL_MS,
		getSessionUser,
		hashPassword,
		hashToken,
		newSessionToken,
		normalizeEmail,
		validTimeZone,
		verifyPassword,
	} from "./helpers";
import { resolveInactivity } from "./notifications";

/**
 * Comptes (email + mot de passe) et sessions.
 *
 * La protection des données est vérifiée DANS chaque fonction Convex à
 * partir du jeton de session (jamais exposé au JavaScript navigateur) :
 * une requête directe sans jeton valide n'accède à rien.
 */

/** Profil d'une cliente SANS session — moteur interne uniquement (rappel 12 h). */
export const internalUserById = internalQuery({
	args: { userId: v.id("users") },
	handler: async (ctx, { userId }) => {
		const u = await ctx.db.get(userId);
		if (!u) return null;
		return { _id: u._id, role: u.role, prenom: u.prenom, timeZone: u.timeZone ?? null, pushPermission: u.pushPermission ?? null };
	},
});

/** Résout un jeton de session → profil utilisateur (ou null si invalide). */
export const resolveSession = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) return null;
		return {
			_id: user._id,
			email: user.email,
			role: user.role,
			prenom: user.prenom,
			// Statut onboarding installation PWA (survit au logout — lié au compte).
			pwaInstallStatus: user.pwaInstallStatus ?? "not_seen",
		};
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
			throw new ConvexError("Ce compte est désactivé. Contacte ton coach.");
		}
		const token = newSessionToken();
		await ctx.db.insert("sessions", {
			userId: user._id,
			tokenHash: await hashToken(token),
			expiresAt: Date.now() + SESSION_TTL_MS,
		});
		await ctx.db.patch(user._id, { lastSeenAt: Date.now() });
		return {
			token,
			user: { _id: user._id, email: user.email, role: user.role, prenom: user.prenom },
		};
	},
});

/** Met à jour la « dernière connexion » de l'utilisateur (appelé à chaque chargement d'espace). */
export const touch = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		timeZone: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, timeZone }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) return { ok: false };
		const now = Date.now();
		// Évite d'écrire à chaque requête : on ne rafraîchit que si la dernière
		// activité date de plus de 60 s.
		if (!user.lastSeenAt || now - user.lastSeenAt > 60_000) {
			await ctx.db.patch(user._id, { lastSeenAt: now });
		}
		// Une cliente de retour après une alerte d'inactivité la résout d'elle-même
		// (marquée « vue » dans le CRM) — la clé de dédup est réutilisable pour la
		// PROCHAINE période d'inactivité, jamais de doublon.
		await resolveInactivity(ctx, user._id);
		// Fuseau de la cliente (envoyé par son navigateur) : stocké pour que
		// l'expiration du message du jour suive SON minuit local, pas celui du
		// serveur. Jamais de valeur arbitraire : nom IANA validé uniquement.
		const tz = validTimeZone(timeZone);
		if (tz && user.timeZone !== tz) {
			await ctx.db.patch(user._id, { timeZone: tz });
		}
		return { ok: true };
	},
});

/**
 * Statut de l'onboarding installation PWA — lié au COMPTE (jamais supprimé
 * par un logout). Valeurs :
 * - "skipped" : la cliente a dit « j'ai déjà l'icône » ou « plus tard » ;
 * - "tutorial_completed" : elle a parcouru le tutoriel jusqu'au bout ;
 * - "installed_confirmed" : installation RÉELLEMENT confirmée (lancement en
 *   mode standalone ou événement appinstalled) — pas une simple supposition.
 * Le navigateur ne prétend jamais savoir qu'une icône existe : seul un
 * lancement standalone (ou appinstalled côté Android) confirme l'installation.
 */
export const setPwaInstall = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		status: v.union(
			v.literal("skipped"),
			v.literal("tutorial_completed"),
			v.literal("installed_confirmed")
		),
		platform: v.optional(v.union(v.literal("ios"), v.literal("android"))),
	},
	handler: async (ctx, { sessionToken, status, platform }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) return { ok: false };
		const patch: Record<string, unknown> = { pwaInstallStatus: status };
		if (platform) patch.pwaInstallPlatform = platform;
		if (status === "installed_confirmed") patch.pwaInstallConfirmedAt = Date.now();
		await ctx.db.patch(user._id, patch);
		return { ok: true };
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

/* ════ Suivi de cycle (Accueil cliente — mêmes questions/formule que l'outil historique) ════ */

/** La cliente lit sa propre configuration de cycle. */
export const myCycle = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) return null;
		return user.cycle ?? null;
	},
});

/**
 * Enregistre la configuration de cycle de la cliente connectée.
 * Les valeurs suivent exactement l'outil d'origine : contraception (3 choix),
 * « je n'ai plus de règles régulières », premier jour des dernières règles,
 * durée moyenne 21–32 jours. Aucune donnée n'est partagée avec un autre profil.
 */
export const saveCycle = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		contra: v.union(v.literal("none"), v.literal("iud-hormonal"), v.literal("hormonal")),
		noDate: v.boolean(),
		lmp: v.optional(v.string()),
		len: v.optional(v.number()),
	},
	handler: async (ctx, { sessionToken, contra, noDate, lmp, len }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");

		const updatedAt = Date.now();
		if (contra === "hormonal") {
			// Contraception qui met le cycle naturel en pause : on n'affiche aucune
			// fausse estimation — on ne conserve pas de date de règles inutile.
			await ctx.db.patch(user._id, { cycle: { contra, noDate: false, updatedAt } });
			return { ok: true };
		}

		if (noDate) {
			// Règles irrégulières / plus de règles : une estimation ne serait pas
			// fiable — on garde uniquement le choix de contraception.
			await ctx.db.patch(user._id, { cycle: { contra, noDate: true, updatedAt } });
			return { ok: true };
		}

		const lmpClean = lmp?.trim() ?? "";
		if (!/^\d{4}-\d{2}-\d{2}$/.test(lmpClean) || Number.isNaN(new Date(lmpClean + "T00:00:00").getTime())) {
			throw new ConvexError("Indique le premier jour de tes dernières règles.");
		}
		const lenN = len;
		if (typeof lenN !== "number" || !Number.isInteger(lenN) || lenN < 21 || lenN > 32) {
			throw new ConvexError("La durée moyenne du cycle doit être comprise entre 21 et 32 jours.");
		}
		await ctx.db.patch(user._id, {
			cycle: { contra, noDate: false, lmp: lmpClean, len: lenN, updatedAt },
		});
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
