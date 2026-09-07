import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { checkinStatus } from "./schema";
import {
	EMAIL_RE,
	addDaysISO,
	daysBetweenISO,
	formatWeekLabel,
	hashPassword,
	getSessionUser,
	lastClosedBilanWeekStart,
	localTodayISO,
	normalizeEmail,
} from "./helpers";
import { DEFAULT_GOALS } from "./journal";
import { bodyFatSeries, logHeightRow } from "./metrics";
import { deleteAllForUser, setCheckinMediaVisibility } from "./media";
import { deleteIntakeForUser } from "./onboarding";

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
		startDate: user.startDate ?? null,
		coachMessage: user.coachMessage ?? null,
		coachMessageDate: user.coachMessageDate ?? null,
		onboardingEnabled: !!user.onboardingEnabled,
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

/**
 * File globale des bilans du CRM : dérivée des dates, du statut de
 * soumission et du statut du retour — rien n'est stocké, rien n'est lancé
 * manuellement. La semaine de référence des « manquants » est la dernière
 * semaine dont la fenêtre (ven. 9h → dim. 12h) est fermée.
 */
export const bilansBoard = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
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

		const isUnread = (c: CheckinRow) =>
			c.status === "retour_envoye" &&
			(c.feedbackReadAt == null || c.feedbackReadAt < (c.feedbackAt ?? c._creationTime));

		type Row = {
			userId: Id<"users">;
			prenom: string;
			weekStart: string;
			weekLabel: string;
			checkin: CheckinRow | null;
		};
		const toTreat: Row[] = [];
		const feedbackSent: Row[] = [];
		const done: Row[] = [];

		for (const u of users) {
			if (u.disabled) continue;
			for (const c of byUser.get(u._id) ?? []) {
				const row: Row = { userId: u._id, prenom: u.prenom, weekStart: c.weekStart, weekLabel: c.weekLabel, checkin: c };
				if (c.status === "nouveau") toTreat.push(row);
				else if (isUnread(c)) feedbackSent.push(row);
				else done.push(row);
			}
		}
		const desc = (a: Row, b: Row) => b.weekStart.localeCompare(a.weekStart) || a.prenom.localeCompare(b.prenom, "fr");
		toTreat.sort(desc);
		feedbackSent.sort(desc);
		done.sort(desc);

		// Bilans manquants : référence = dernière semaine de bilan fermée.
		const refWeek = lastClosedBilanWeekStart();
		const refLabel = formatWeekLabel(refWeek);
		const openFriday = addDaysISO(refWeek, 4); // vendredi d'ouverture de la fenêtre
		const submittedRefWeek = new Set(
			checkins.filter((c) => c.weekStart === refWeek).map((c) => c.userId as Id<"users">)
		);
		const missing: Row[] = [];
		for (const u of users) {
			if (u.disabled) continue;
			const startDate = u.startDate ?? localTodayISO(new Date(u._creationTime));
			// Éligible : suivie et démarrée au plus tard le vendredi d'ouverture
			// (une cliente onboardée samedi/dimanche n'est pas un « manquant »).
			if (startDate <= openFriday && !submittedRefWeek.has(u._id)) {
				missing.push({ userId: u._id, prenom: u.prenom, weekStart: refWeek, weekLabel: refLabel, checkin: null });
			}
		}
		missing.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr"));

		return {
			toTreat: toTreat.slice(0, 50),
			feedbackSent: feedbackSent.slice(0, 50),
			done: done.slice(0, 25),
			missing,
			missingWeek: { weekStart: refWeek, weekLabel: refLabel },
		};
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
		const patch: {
			feedback?: string;
			status: "nouveau" | "retour_envoye";
			feedbackAt?: number;
			feedbackReadAt?: number;
		} = { status };
		if (trimmed) patch.feedback = trimmed;
		if (status === "retour_envoye") {
			patch.feedbackAt = Date.now();
			// Une nouvelle publication relance l'état « non lu » côté cliente.
			patch.feedbackReadAt = undefined;
		} else {
			// « Enregistrer en brouillon » / retirer la publication : le texte est
			// conservé mais rien n'est visible côté cliente tant que le retour
			// n'est pas publié (RecapBilan n'affiche que les retour_envoye).
			patch.feedbackAt = undefined;
			patch.feedbackReadAt = undefined;
		}
		await ctx.db.patch(checkinId, patch);
		// Les fichiers du retour (audio + pièces jointes) suivent la visibilité :
		// publiés avec le retour, remis en brouillon quand on retire la publication.
		await setCheckinMediaVisibility(ctx, checkinId, status === "retour_envoye");
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
		startDate: v.optional(v.string()),
	},
	handler: async (ctx, { sessionToken, email, password, prenom, startDate }) => {
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
		const dateClean = startDate?.trim() ?? "";
		if (dateClean && !/^\d{4}-\d{2}-\d{2}$/.test(dateClean)) {
			throw new ConvexError("Date de démarrage invalide (format AAAA-MM-JJ).");
		}
		const id = await ctx.db.insert("users", {
			email: emailClean,
			passwordHash: await hashPassword(password),
			role: "client",
			prenom: prenomClean,
			createdBy: coach._id,
			// Date de démarrage du suivi : par défaut le jour de création du compte.
			startDate: dateClean || localTodayISO(),
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
		startDate: v.optional(v.string()),
		heightCm: v.optional(v.number()),
		onboardingEnabled: v.optional(v.boolean()),
	},
	handler: async (ctx, { sessionToken, userId, prenom, email, birthDate, startDate, heightCm, onboardingEnabled }) => {
		await requireCoach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		const patch: Partial<
			Pick<UserRow, "prenom" | "email" | "birthDate" | "startDate" | "heightCm" | "onboardingEnabled">
		> = {};
		if (onboardingEnabled !== undefined) {
			// Simple activation : on ne supprime jamais les réponses déjà envoyées
			// (réactiver l'onboarding réutilise les étapes déjà complétées).
			patch.onboardingEnabled = onboardingEnabled;
		}
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
		if (startDate !== undefined) {
			const s = startDate.trim();
			if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
				throw new ConvexError("Date de démarrage invalide (format AAAA-MM-JJ).");
			}
			patch.startDate = s || undefined;
		}
		if (heightCm !== undefined) {
			if (!isFinite(heightCm) || heightCm < 80 || heightCm > 250) {
				throw new ConvexError("Taille invalide (entre 80 et 250 cm).");
			}
			const h = Math.round(heightCm * 10) / 10;
			patch.heightCm = h;
			// Journalise dans bodyMetrics pour un historique daté de la taille.
			await logHeightRow(ctx, userId, h);
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
		const steps = await ctx.db
			.query("dailySteps")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		for (const s of steps) await ctx.db.delete(s._id);
		// Médias coach → cliente (retours audio, pièces jointes, message audio) :
		// suppression réelle des fichiers du storage + lignes de métadonnées.
		await deleteAllForUser(ctx, userId);
		await deleteIntakeForUser(ctx, userId);
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

		const [goalsRow, metrics, checkins, entries, stepsRows] = await Promise.all([
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", userId)).first(),
			ctx.db
				.query("bodyMetrics")
				.withIndex("by_user", (q) => q.eq("userId", userId))
				.order("asc")
				.collect(),
			ctx.db.query("checkins").withIndex("by_user_week", (q) => q.eq("userId", userId)).order("desc").collect(),
			ctx.db.query("diaryEntries").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").collect(),
			ctx.db.query("dailySteps").withIndex("by_user", (q) => q.eq("userId", userId)).order("asc").collect(),
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

		// Dernier relevé « utile » (poids ou mensurations) — les lignes de
		// journalisation de la taille (heightCm seul) ne comptent pas.
		const latestMetric =
			[...metrics]
				.reverse()
				.find(
					(m) =>
						m.weightKg !== undefined ||
						m.neckCm !== undefined ||
						m.waistCm !== undefined ||
						m.hipCm !== undefined
				) ?? null;
		const weightTrend = metrics
			.filter((m) => m.weightKg !== undefined)
			.map((m) => ({ date: m.date, weightKg: m.weightKg as number }));
		const firstWeight = weightTrend.length > 0 ? weightTrend[0].weightKg : null;
		const lastWeight = weightTrend.length > 0 ? weightTrend[weightTrend.length - 1].weightKg : null;

		/* ── Cockpit hebdo (onglet Bilans) ──────────────────────────────────
		   Synthèse calculée sur la semaine du bilan le plus récent (lundi →
		   dimanche), comparaisons faites sur la semaine calendaire précédente.
		   Règle : absence de donnée ≠ 0 — une journée non trackée n'entre
		   jamais dans une moyenne, et rien d'ancien n'est présenté comme neuf. */
		const round1 = (n: number) => Math.round(n * 10) / 10;
		const mean = (xs: number[]) =>
			xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
		const refCheckin = checkins[0] ?? null;

		let cockpit: {
			weekStart: string;
			weekEnd: string;
			weekLabel: string;
			weight: { avg: number | null; count: number; prevAvg: number | null; delta: number | null };
			calories: { avg: number | null; goal: number; trackedDays: number };
			steps: {
				avg: number | null;
				goal: number | null;
				trackedDays: number;
				declared: string | null;
			};
			measurements: {
				fresh: boolean;
				date: string | null;
				daysAgo: number | null;
				waistCm: number | null;
				hipCm: number | null;
				neckCm: number | null;
				deltas: { waistCm: number | null; hipCm: number | null; neckCm: number | null };
			};
			bilan: {
				status: "nouveau" | "retour_envoye";
				receivedAt: number;
				feedbackAt: number | null;
				draft: boolean;
			};
		} | null = null;

		if (refCheckin) {
			const ws = refCheckin.weekStart;
			const we = addDaysISO(ws, 6);
			const prevWs = addDaysISO(ws, -7);
			const inWeek = (d: string) => d >= ws && d <= we;
			const inPrevWeek = (d: string) => d >= prevWs && d < ws;

			// Poids : moyenne de la semaine vs moyenne de la semaine précédente
			// (deux moyennes hebdo, jamais deux pesées isolées comparées).
			const weekWeights = metrics
				.filter((m) => m.weightKg !== undefined && inWeek(m.date))
				.map((m) => m.weightKg as number);
			const prevWeights = metrics
				.filter((m) => m.weightKg !== undefined && inPrevWeek(m.date))
				.map((m) => m.weightKg as number);
			const weightAvg = mean(weekWeights);
			const prevWeightAvg = mean(prevWeights);
			const weightDelta =
				weightAvg !== null && prevWeightAvg !== null ? round1(weightAvg - prevWeightAvg) : null;

			// Calories : moyenne sur les seuls jours possédant des données +
			// couverture — une journée vide n'est jamais comptée comme 0 kcal.
			const kcalByDay = new Map<string, number>();
			for (const e of entries) {
				if (inWeek(e.date)) kcalByDay.set(e.date, (kcalByDay.get(e.date) ?? 0) + e.kcal);
			}
			const trackedDays = kcalByDay.size;
			const kcalSum = [...kcalByDay.values()].reduce((s, x) => s + x, 0);
			const kcalAvg = trackedDays > 0 ? Math.round(kcalSum / trackedDays) : null;

			// Pas : comptage quotidien quand il existe (moyenne sur les jours
			// renseignés, jamais divisée par 7) ; sinon la déclaration du bilan.
			const weekSteps = stepsRows.filter((s) => s.date >= ws && s.date <= we);
			const stepsTracked = weekSteps.length;
			const stepsAvg =
				stepsTracked > 0
					? Math.round(weekSteps.reduce((s, r) => s + r.count, 0) / stepsTracked)
					: null;
			const pasRaw = (refCheckin.answers as Record<string, unknown>).pas;
			const pas = typeof pasRaw === "string" && pasRaw ? pasRaw : null;

			// Mensurations : fraîcheur ≤ 5 jours (aujourd'hui inclus) + delta par
			// métrique vs le relevé précédent de CETTE même métrique.
			const mensRows = metrics.filter(
				(m) => m.waistCm !== undefined || m.hipCm !== undefined || m.neckCm !== undefined
			);
			const latestMens = mensRows.length > 0 ? mensRows[mensRows.length - 1] : null;
			const today = localTodayISO();
			const daysAgo = latestMens ? daysBetweenISO(today, latestMens.date) : null;
			const fresh = latestMens !== null && daysAgo !== null && daysAgo >= 0 && daysAgo <= 4;
			const deltas: { waistCm: number | null; hipCm: number | null; neckCm: number | null } = {
				waistCm: null,
				hipCm: null,
				neckCm: null,
			};
			if (latestMens) {
				const prevOf = (key: "waistCm" | "hipCm" | "neckCm") => {
					for (let i = mensRows.length - 2; i >= 0; i--) {
						if (mensRows[i][key] !== undefined) return mensRows[i][key] as number;
					}
					return null;
				};
				for (const key of ["waistCm", "hipCm", "neckCm"] as const) {
					const cur = latestMens[key];
					if (cur === undefined) continue;
					const prev = prevOf(key);
					deltas[key] = prev !== null ? round1(cur - prev) : null;
				}
			}

			cockpit = {
				weekStart: ws,
				weekEnd: we,
				weekLabel: refCheckin.weekLabel,
				weight: {
					avg: weightAvg !== null ? round1(weightAvg) : null,
					count: weekWeights.length,
					prevAvg: prevWeightAvg !== null ? round1(prevWeightAvg) : null,
					delta: weightDelta,
				},
				calories: { avg: kcalAvg, goal: goalsRow?.kcal ?? DEFAULT_GOALS.kcal, trackedDays },
				steps: {
					avg: stepsAvg,
					goal: goalsRow?.stepGoal ?? null,
					trackedDays: stepsTracked,
					declared: pas,
				},
				measurements: {
					fresh,
					date: latestMens?.date ?? null,
					daysAgo,
					waistCm: latestMens?.waistCm ?? null,
					hipCm: latestMens?.hipCm ?? null,
					neckCm: latestMens?.neckCm ?? null,
					deltas,
				},
				bilan: {
					status: refCheckin.status,
					receivedAt: refCheckin._creationTime,
					feedbackAt: refCheckin.feedbackAt ?? null,
					draft: refCheckin.status === "nouveau" && !!refCheckin.feedback?.trim(),
				},
			};
		}

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
			bodyFat: bodyFatSeries(metrics, target.heightCm ?? null),
			latestCheckin: checkins[0] ?? null,
			checkinCount: checkins.length,
			cockpit,
		};
	},
});
