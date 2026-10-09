/**
 * ORCHESTRATION ASSISTANT G-FLUX — V1 preview isolée.
 *
 * RÔLES :
 *  - `assistantTools.ts` : lectures déterministes + préparation des écritures ;
 *  - CE MODULE : session, feature flag, quotas/rate-limit, persistance des
 *    fils/messages, exécution des actions après confirmation ;
 *  - `lib/server/assistantAi.ts` : boucle d'outils OpenAI (clé serveur) ;
 *  - le frontend n'envoie QUE { threadId, topic, message } et ne reçoit que
 *    des données déjà calculées par le serveur (jamais l'inverse).
 *
 * GARDE-FOUS CENTRAUX (§14/§15/§31/§32) :
 *  - flag SERVEUR (`assistantEnabledFor`) + hard lock Billing revérifiés à
 *    chaque étape — le frontend ne décide jamais d'une permission ;
 *  - quota jour + anti-rafale + un seul envoi en cours, posés dans une
 *    mutation ATOMIQUE (`reserve`) avant tout appel IA ;
 *  - AUCUNE écriture sans `resolveAction(confirm)` — le modèle ne peut que
 *    préparer ; la confirmation vient du clic de la cliente ;
 *  - liste d'écritures FERMÉE (schema.ts) : objectifs, macros, objectif de
 *    pas, coachingMode et planning Coach n'y figurent pas.
 */

import { v, ConvexError } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getSessionUser, localTodayISO } from "./helpers";
import { accessStateForUser } from "./billing";
import {
	assistantEnabledFor,
	assistantLimits,
	assistantModel,
	assistantSystemPrompt,
	coachContact,
	coerceTopic,
	DISTRESS_REPLY,
	safetyScreen,
	type AssistantTopic,
} from "../lib/assistant/policy";
import { runAssistantTurn } from "../lib/server/assistantAi";
import { dispatchTool, registryToolDefs, type ToolRunState } from "./assistantRegistry";
import { refineMatch } from "./assistantTools";
import { contextFor, buildContextBlock } from "./assistantRead";
import { OpenAiUnavailableError } from "../lib/server/openai";

/** Délai maximum d'un envoi « en cours » avant déblocage automatique (ms). */
const INFLIGHT_TIMEOUT_MS = 60_000;

/**
 * Filet « annonce sans outil » : le modèle répond qu'il a (ou va) créer une
 * prévisualisation alors qu'aucun outil prepare* n'a été appelé (holder vide).
 * Déclenche UNE relance bornée exigeant l'appel d'outil (assistant.ts §6b).
 */
const ANNOUNCE_WITHOUT_TOOL_RE =
	/(pr[ée]visualisation|je (vais|viens de) (l')?(ajouter|enregistrer|pr[ée]parer)|proc[ée]der à l'ajout|je vais maintenant|un instant, s'il te plaît|un instant, je|je pr[ée]pare (ça|cela|l'ajout|le tout)|c'est (enregistré|ajouté))/i;

/**
 * Intention d'AJOUT détectée côté serveur (déterministe) : si la cliente
 * demande clairement un ajout/enregistrement et qu'aucune action n'a été
 * préparée et que la réponse ne pose aucune question de clarification, le
 * modèle a quasi certainement répondu de mémoire sans appeler l'outil.
 * → relance bornée exigeant l'appel (Lot 2B, priorité 4).
 */
const ADD_INTENT_RE =
	/\b(ajoute|ajouter|enregistre|enregistrer|note\b|mets\b|rajoute|prépare[- ]moi|petit[- ]déjeuner|déjeuner|d[îi]ner|collation)\b/i;

/**
 * Récitation de VALEURS nutritionnelles sans outil : des kcal annoncées dans
 * la réponse alors qu'aucune prévisualisation n'existe = chiffres sortis de
 * la mémoire du modèle. Les valeurs doivent venir des outils serveur (Lot 2B,
 * priorité 1 et 5) — sauf si la réponse pose une question (clarification
 * légitime qui attend le tour suivant).
 */
const VALUES_WITHOUT_TOOL_RE = /\d+(?:[.,]\d+)?\s*kcal/i;

/* ────────────────────────── Garde serveur commune ────────────────────────── */

async function requireAssistantClient(ctx: Parameters<typeof getSessionUser>[0], sessionToken?: string) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "client") throw new ConvexError("L'Assistant est réservé aux comptes clients.");
	if (!assistantEnabledFor(user.email)) throw new ConvexError("L'Assistant n'est pas activé pour ce compte.");
	if (accessStateForUser(user, Date.now()).decision === "block") {
		throw new ConvexError("Accès suspendu — mets à jour ton abonnement pour continuer.");
	}
	return user;
}

function utcDay(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Message utilisateur propre : SEULEMENT nos messages métier (jamais de stack). */
function userFacingError(e: unknown): string {
	if (e instanceof ConvexError) {
		const d = e.data as { message?: unknown } | null | undefined;
		if (d && typeof d.message === "string" && d.message.trim().length > 4) return d.message;
	}
	return "Impossible d’envoyer pour l’instant. Réessaie dans un instant.";
}

/* ──────────────────────────── Accès / flags ──────────────────────────── */

/**
 * État de l'Assistant pour CE compte — source UNIQUE lue par le layout
 * (affichage de l'onglet) et par tous les endpoints. Flag SERVEUR : masquer
 * un onglet côté frontend n'est jamais la sécurité.
 */
export const access = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		const enabled =
			!!user &&
			user.role === "client" &&
			assistantEnabledFor(user.email) &&
			accessStateForUser(user, Date.now()).decision !== "block";
		const limits = assistantLimits();
		const coach = coachContact();
		return {
			enabled,
			mode: "coaching_readonly",
			model: assistantModel(),
			limits: { textPerDay: limits.textPerDay, visionPerDay: limits.visionPerDay },
			coach: { url: coach.url, message: coach.message },
		};
	},
});

/* ──────────────────────────── Fils & messages ──────────────────────────── */

export const threads = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const rows = await ctx.db
			.query("assistantThreads")
			.withIndex("by_user_updated", (q) => q.eq("userId", user._id))
			.order("desc")
			.take(20);
		return rows.map((t) => ({ threadId: t._id, topic: t.topic, title: t.title ?? null, lastMessageAt: t.lastMessageAt }));
	},
});

/** Historique d'un fil — fenêtre LIMITÉE (§28 : jamais tout l'historique). */
export const historyFor = query({
	args: { sessionToken: v.optional(v.string()), threadId: v.optional(v.string()) },
	handler: async (ctx, { sessionToken, threadId }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const limits = assistantLimits();
		const empty = { threadId: null as string | null, topic: "nutrition" as AssistantTopic, messages: [], pendingAction: null };
		if (!threadId || !/^[a-zA-Z0-9_-]{10,}$/.test(threadId)) return empty;
		const thread = await ctx.db.get(threadId as Id<"assistantThreads">);
		if (!thread || thread.userId !== user._id) return empty;
		const all = await ctx.db
			.query("assistantMessages")
			.withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
			.order("desc")
			.take(limits.historyWindow);
		const pending = await ctx.db
			.query("assistantActions")
			.withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "pending"))
			.order("desc")
			.first();
		const usable = pending && pending.threadId === thread._id && pending.expiresAt > Date.now() ? pending : null;
		return {
			threadId: thread._id as string,
			topic: coerceTopic(thread.topic),
			messages: all.reverse().map((m) => ({
				_id: m._id,
				role: m.role,
				content: m.content,
				kind: m.kind ?? "text",
				actionId: m.actionId ?? null,
				createdAt: m.createdAt,
			})),
			pendingAction: usable
				? { actionId: usable._id as string, actionType: usable.actionType, preview: usable.preview, createdAt: usable.createdAt }
				: null,
		};
	},
});

/* ──────────────────────── Quotas / rate limit ──────────────────────── */

/**
 * RÉSERVATION ATOMIQUE — la SEULE porte d'entrée avant un appel IA.
 * Une transaction Convex = pas de course possible : quota vérifié ET
 * incrémenté, anti-rafale posée, verrou « un envoi à la fois » posé, fil
 * créé si besoin.
 */
export const reserve = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		threadId: v.optional(v.string()),
		topic: v.string(),
		withImage: v.optional(v.boolean()),
	},
	handler: async (ctx, { sessionToken, threadId, topic, withImage }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		const limits = assistantLimits();
		const now = Date.now();
		const day = utcDay();

		const row = await ctx.db
			.query("assistantUsage")
			.withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
			.first();
		const textCount = row?.textCount ?? 0;
		const visionCount = row?.visionCount ?? 0;

		// 1) Anti double-submit : un seul envoi actif (déblocage après 60 s).
		if (row?.inFlightAt !== undefined && now - row.inFlightAt < INFLIGHT_TIMEOUT_MS) {
			throw new ConvexError("Une demande est déjà en cours — j’arrive 🙂");
		}
		// 2) Anti-rafale.
		if (row?.lastSendAt && now - row.lastSendAt < limits.minIntervalMs) {
			throw new ConvexError("Un instant, je finis ma réponse avant.");
		}
		// 3) Quotas jour (texte et image distincts, §31).
		if (textCount >= limits.textPerDay) {
			throw new ConvexError(
				`Tu as utilisé tes ${limits.textPerDay} échanges Assistant du jour. Reviens demain — Hugo reste joignable sur WhatsApp.`
			);
		}
		if (withImage) {
			if (limits.visionPerDay <= 0) throw new ConvexError("Les photos sont désactivées pour l’instant — continue en texte.");
			if (visionCount >= limits.visionPerDay) {
				throw new ConvexError(`Tu as utilisé tes ${limits.visionPerDay} photos du jour. Tu peux continuer en texte.`);
			}
		}

		// 4) Fil : créé si absent ; jamais repris s'il appartient à un autre compte.
		let thread: Doc<"assistantThreads"> | null = null;
		if (threadId && /^[a-zA-Z0-9_-]{10,}$/.test(threadId)) {
			const found = await ctx.db.get(threadId as Id<"assistantThreads">);
			if (found && found.userId === user._id) thread = found;
		}
		if (!thread) {
			const id = await ctx.db.insert("assistantThreads", {
				userId: user._id,
				topic: coerceTopic(topic),
				createdAt: now,
				lastMessageAt: now,
			});
			thread = (await ctx.db.get(id))!;
		}

		if (row) {
			await ctx.db.patch(row._id, {
				textCount: textCount + 1,
				...(withImage ? { visionCount: visionCount + 1 } : {}),
				lastSendAt: now,
				inFlightAt: now,
				updatedAt: now,
			});
		} else {
			await ctx.db.insert("assistantUsage", {
				userId: user._id,
				day,
				textCount: 1,
				visionCount: withImage ? 1 : 0,
				lastSendAt: now,
				inFlightAt: now,
				updatedAt: now,
			});
		}

		return {
			userId: user._id as string,
			threadId: thread._id as string,
			topic: coerceTopic(thread.topic, coerceTopic(topic)),
			usage: {
				textCount: textCount + 1,
				visionCount: visionCount + (withImage ? 1 : 0),
				textPerDay: limits.textPerDay,
				visionPerDay: limits.visionPerDay,
			},
		};
	},
});

/** Rembourse la réservation quand le tour IA échoue (aucune pénalité réseau). */
export const release = mutation({
	args: { sessionToken: v.optional(v.string()), withImage: v.optional(v.boolean()) },
	handler: async (ctx, { sessionToken, withImage }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user || user.role !== "client") return { ok: false };
		const day = utcDay();
		const row = await ctx.db
			.query("assistantUsage")
			.withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
			.first();
		if (!row) return { ok: false };
		await ctx.db.patch(row._id, {
			textCount: Math.max(0, row.textCount - 1),
			...(withImage ? { visionCount: Math.max(0, row.visionCount - 1) } : {}),
			inFlightAt: undefined,
			updatedAt: Date.now(),
		});
		return { ok: true };
	},
});

/* ─────────────────────────── Persistance ─────────────────────────── */

export const commit = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		threadId: v.string(),
		topic: v.string(),
		userMessage: v.string(),
		assistantMessage: v.string(),
		kind: v.optional(v.string()),
		actionId: v.optional(v.id("assistantActions")),
		toolCalls: v.optional(v.array(v.string())),
		toolErrors: v.optional(v.array(v.string())),
		model: v.optional(v.string()),
		inputTokens: v.optional(v.number()),
		outputTokens: v.optional(v.number()),
		durationMs: v.optional(v.number()),
		estimatedCostUsd: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const user = await requireAssistantClient(ctx, args.sessionToken);
		if (!/^[a-zA-Z0-9_-]{10,}$/.test(args.threadId)) throw new ConvexError("Conversation introuvable.");
		const thread = await ctx.db.get(args.threadId as Id<"assistantThreads">);
		if (!thread || thread.userId !== user._id) throw new ConvexError("Conversation introuvable.");

		const now = Date.now();
		const t = coerceTopic(args.topic, coerceTopic(thread.topic));
		await ctx.db.insert("assistantMessages", {
			userId: user._id,
			threadId: thread._id,
			topic: t,
			role: "user",
			content: args.userMessage.slice(0, 4000),
			createdAt: now,
		});
		await ctx.db.insert("assistantMessages", {
			userId: user._id,
			threadId: thread._id,
			topic: t,
			role: "assistant",
			content: args.assistantMessage.slice(0, 4000),
			kind: args.kind ?? "text",
			...(args.actionId ? { actionId: args.actionId } : {}),
			...(args.toolCalls && args.toolCalls.length ? { toolCalls: args.toolCalls.slice(0, 12) } : {}),
			...(args.toolErrors && args.toolErrors.length ? { toolErrors: args.toolErrors.slice(0, 12) } : {}),
			createdAt: now + 1,
		});
		await ctx.db.patch(thread._id, {
			topic: t,
			lastMessageAt: now,
			title: thread.title ?? args.userMessage.slice(0, 40),
		});

		// Traçabilité IA (modèle + tokens + durée + coût estimé) — JAMAIS de
		// donnée personnelle ni de raisonnement interne (§17/§28).
		if (args.model) {
			try {
				await ctx.db.insert("aiUsageLog", {
					kind: "assistant",
					model: args.model,
					...(args.inputTokens !== undefined ? { inputTokens: args.inputTokens } : {}),
					...(args.outputTokens !== undefined ? { outputTokens: args.outputTokens } : {}),
					durationMs: args.durationMs ?? 0,
					status: args.kind === "error" ? "error" : "ok",
					...(args.estimatedCostUsd !== undefined ? { estimatedCostUsd: args.estimatedCostUsd } : {}),
					createdAt: now,
				});
			} catch {
				/* journaling best effort */
			}
		}

		// Le verrou « envoi en cours » est relâché ici (appel IA terminé).
		const day = utcDay();
		const usageRow = await ctx.db
			.query("assistantUsage")
			.withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day))
			.first();
		if (usageRow && usageRow.inFlightAt !== undefined) {
			await ctx.db.patch(usageRow._id, { inFlightAt: undefined, updatedAt: now });
		}

		return { threadId: thread._id as string, topic: t, pendingActionId: args.actionId ?? null };
	},
});

/* ────────────── Confirmation / annulation / Undo d'écriture ────────── */

type PayloadJournalAdd = {
	date: string;
	meal: string;
	components: {
		foodId?: string;
		customFoodId?: string;
		ciqualLabel?: string;
		name: string;
		qtyGrams: number;
		aiKcal100?: number;
		aiCarbs100?: number;
		aiProtein100?: number;
		aiFat100?: number;
	}[];
};

function parseJson<T>(raw: string | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

/** Exécute UNE action confirmée — écritures réelles, JAMAIS par le modèle. */
async function executeConfirmed(
	ctx: MutationCtx,
	sessionToken: string | undefined,
	action: Doc<"assistantActions">
): Promise<{ result: string; newValue?: string }> {
	const payload = parseJson<Record<string, unknown>>(action.payload, {});
	switch (action.actionType) {
		case "journal_add": {
			const p = payload as unknown as PayloadJournalAdd;
			const res = (await ctx.runMutation(api.meals.commitAnalyzedMeal, {
				sessionToken,
				date: p.date,
				meal: p.meal,
				components: p.components.map((c) => ({
					...(c.foodId ? { foodId: c.foodId as Id<"foods"> } : {}),
					...(c.customFoodId ? { customFoodId: c.customFoodId as Id<"customFoods"> } : {}),
					...(c.ciqualLabel ? { ciqualLabel: c.ciqualLabel } : {}),
					name: c.name,
					qtyGrams: c.qtyGrams,
					...(c.aiKcal100 !== undefined ? { aiKcal100: c.aiKcal100 } : {}),
					...(c.aiCarbs100 !== undefined ? { aiCarbs100: c.aiCarbs100 } : {}),
					...(c.aiProtein100 !== undefined ? { aiProtein100: c.aiProtein100 } : {}),
					...(c.aiFat100 !== undefined ? { aiFat100: c.aiFat100 } : {}),
				})),
				requestId: `assistant:${action._id}`,
			})) as { ok: boolean; created: number; mealGroup: string };
			return {
				result: res.created > 0 ? `${res.created} aliment(s) ajouté(s) au journal` : "Déjà enregistré",
				newValue: JSON.stringify({ mealGroup: res.mealGroup, created: res.created }),
			};
		}
		case "journal_remove": {
			const ids = (payload.entryIds ?? []) as string[];
			for (const id of ids) {
				await ctx.runMutation(api.journal.removeEntry, { sessionToken, entryId: id as Id<"diaryEntries"> });
			}
			return { result: `${ids.length} aliment(s) retiré(s) du journal` };
		}
		case "steps": {
			await ctx.runMutation(api.steps.setSteps, {
				sessionToken,
				date: String(payload.date),
				count: Number(payload.count),
			});
			return { result: `${Number(payload.count).toLocaleString("fr-FR")} pas enregistrés` };
		}
		case "weight":
		case "measurement": {
			await ctx.runMutation(api.metrics.upsert, {
				sessionToken,
				date: String(payload.date),
				...(payload.weightKg !== undefined ? { weightKg: Number(payload.weightKg) } : {}),
				...(payload.neckCm !== undefined ? { neckCm: Number(payload.neckCm) } : {}),
				...(payload.waistCm !== undefined ? { waistCm: Number(payload.waistCm) } : {}),
				...(payload.hipCm !== undefined ? { hipCm: Number(payload.hipCm) } : {}),
			});
			return { result: "Mesure enregistrée" };
		}
		case "coach_question": {
			const user = await getSessionUser(ctx, sessionToken);
			if (!user) throw new ConvexError("Session invalide.");
			const now = Date.now();
			const id = await ctx.db.insert("coachQuestions", {
				userId: user._id,
				text: String(payload.text ?? "").slice(0, 600),
				destination: payload.destination === "bilan" ? "bilan" : "note",
				status: "open",
				...(payload.weekStart ? { weekStart: String(payload.weekStart) } : {}),
				threadId: action.threadId,
				createdAt: now,
				updatedAt: now,
			});
			return {
				result:
					payload.destination === "bilan" ? "Question ajoutée à ton prochain bilan" : "Question notée pour Hugo",
				newValue: JSON.stringify({ questionId: id }),
			};
		}
		default:
			throw new ConvexError("Action non supportée.");
	}
}

/** Annule une écriture déjà confirmée quand c'est raisonnable (§17 Undo). */
async function undoConfirmed(
	ctx: MutationCtx,
	sessionToken: string | undefined,
	action: Doc<"assistantActions">
): Promise<string> {
	const payload = parseJson<Record<string, unknown>>(action.payload, {});
	const previous = parseJson<Record<string, unknown> | null>(action.previousValue, null);
	const next = parseJson<Record<string, unknown> | null>(action.newValue, null);
	switch (action.actionType) {
		case "journal_add": {
			const group = next?.mealGroup;
			if (!group) return "Rien à annuler";
			const rows = await ctx.db
				.query("diaryEntries")
				.withIndex("by_group", (q) => q.eq("mealGroup", String(group)))
				.collect();
			let n = 0;
			for (const r of rows) {
				if (r.userId !== action.userId) continue;
				await ctx.db.delete(r._id);
				n++;
			}
			return n > 0 ? `${n} aliment(s) retiré(s) (annulé)` : "Rien à annuler";
		}
		case "journal_remove": {
			const entries = (previous?.entries ?? []) as Record<string, unknown>[];
			let n = 0;
			for (const e of entries) {
				const copy = { ...e } as Record<string, unknown>;
				delete copy._id;
				delete copy._creationTime;
				await ctx.db.insert("diaryEntries", {
					...(copy as unknown as Omit<Doc<"diaryEntries">, "_id" | "_creationTime">),
					userId: action.userId,
					createdAt: Date.now(),
				});
				n++;
			}
			return `${n} aliment(s) restauré(s)`;
		}
		case "steps": {
			const date = String(payload.date);
			const row = await ctx.db
				.query("dailySteps")
				.withIndex("by_user_date", (q) => q.eq("userId", action.userId).eq("date", date))
				.first();
			const prevCount = previous && typeof previous.count === "number" ? previous.count : null;
			if (prevCount === null) {
				if (row) await ctx.db.delete(row._id);
				return "Saisie de pas annulée";
			}
			await ctx.runMutation(api.steps.setSteps, { sessionToken, date, count: prevCount });
			return "Valeur de pas restaurée";
		}
		case "weight":
		case "measurement": {
			const date = String(payload.date);
			const row = await ctx.db
				.query("bodyMetrics")
				.withIndex("by_user_date", (q) => q.eq("userId", action.userId).eq("date", date))
				.first();
			if (!row) return "Rien à annuler";
			const p = (previous ?? {}) as Record<string, number | null>;
			const patch: Partial<Doc<"bodyMetrics">> = {};
			patch.weightKg = p.weightKg ?? undefined;
			patch.neckCm = p.neckCm ?? undefined;
			patch.waistCm = p.waistCm ?? undefined;
			patch.hipCm = p.hipCm ?? undefined;
			if (Object.values(patch).every((x) => x === undefined)) await ctx.db.delete(row._id);
			else await ctx.db.patch(row._id, patch);
			return "Mesure restaurée";
		}
		case "coach_question": {
			const id = next?.questionId;
			if (id) await ctx.db.delete(id as Id<"coachQuestions">);
			return "Question retirée";
		}
		default:
			throw new ConvexError("Action non supportée.");
	}
}

/**
 * CONFIRMATION / ANNULATION / UNDO — le SEUL chemin d'écriture de l'Assistant.
 * `decision` vient du clic de la cliente ; le payload reste celui calculé par
 * le serveur (le client n'envoie qu'un `actionId`).
 */
export const resolveAction = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		actionId: v.string(),
		decision: v.union(v.literal("confirm"), v.literal("cancel"), v.literal("undo")),
	},
	handler: async (ctx, { sessionToken, actionId, decision }) => {
		const user = await requireAssistantClient(ctx, sessionToken);
		if (!/^[a-zA-Z0-9_-]{10,}$/.test(actionId)) throw new ConvexError("Action introuvable.");
		const doc = await ctx.db.get(actionId as Id<"assistantActions">);
		if (!doc || doc.userId !== user._id) throw new ConvexError("Action introuvable.");
		const now = Date.now();

		if (decision === "cancel") {
			if (doc.status !== "pending") throw new ConvexError("Cette action n’est plus en attente.");
			if (doc.expiresAt < now) {
				await ctx.db.patch(doc._id, { status: "expired", resolvedAt: now });
				throw new ConvexError("Cette prévisualisation a expiré — refais la demande.");
			}
			await ctx.db.patch(doc._id, { status: "cancelled", resolvedAt: now });
			return { ok: true as const, status: "cancelled" as const, message: "Annulé — rien n’a été enregistré." };
		}

		if (decision === "undo") {
			if (doc.status !== "confirmed") throw new ConvexError("Rien à annuler sur cette action.");
			if (now - (doc.resolvedAt ?? now) > assistantLimits().actionTtlMs) {
				throw new ConvexError("Annulation impossible trop tard — Hugo peut corriger si besoin.");
			}
			const message = await undoConfirmed(ctx, sessionToken, doc);
			await ctx.db.patch(doc._id, { status: "undone", resolvedAt: now, result: message });
			return { ok: true as const, status: "undone" as const, message };
		}

		// confirm — JAMAIS d'écriture implicite.
		if (doc.status !== "pending") throw new ConvexError("Cette action a déjà été traitée.");
		if (doc.expiresAt < now) {
			await ctx.db.patch(doc._id, { status: "expired", resolvedAt: now });
			throw new ConvexError("Cette prévisualisation a expiré — refais la demande.");
		}
		const { result, newValue } = await executeConfirmed(ctx, sessionToken, doc);
		await ctx.db.patch(doc._id, {
			status: "confirmed",
			resolvedAt: now,
			result,
			...(newValue ? { newValue } : {}),
		});
		return { ok: true as const, status: "confirmed" as const, message: result };
	},
});

/* ──────────────────────────── Le tour « send » ──────────────────────────── */

type PendingAction = { actionId: string; actionType: string; preview: unknown };

/**
 * ENVOI — action Convex (runtime réseau) :
 * réservation atomique → écran de sécurité → contexte limité → boucle
 * d'outils OpenAI (le serveur exécute) → persistance.
 */
export const send = action({
	args: {
		sessionToken: v.optional(v.string()),
		threadId: v.optional(v.string()),
		topic: v.string(),
		message: v.string(),
		/** Date locale du navigateur (fuseau horaire de la cliente). */
		today: v.optional(v.string()),
		/** Photo (dataURL) — optionnelle, réutilise la pipeline Repas IA. */
		imageDataUrl: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const text = (args.message ?? "").trim().slice(0, 4000);
		const withImage = typeof args.imageDataUrl === "string" && args.imageDataUrl.startsWith("data:image/");
		if (!withImage && text.length < 1) throw new ConvexError("Écris un message 🙂");
		if (withImage && args.imageDataUrl!.length > 5_000_000) {
			throw new ConvexError("Photo trop lourde — réessaie avec un cadrage plus serré.");
		}

		// 1) Réservation atomique (session + flag + quota + anti-spam + fil).
		const reservation = (await ctx.runMutation(api.assistant.reserve, {
			sessionToken: args.sessionToken,
			...(args.threadId ? { threadId: args.threadId } : {}),
			topic: args.topic,
			withImage,
		})) as {
			userId: string;
			threadId: string;
			topic: AssistantTopic;
			usage: { textCount: number; visionCount: number; textPerDay: number; visionPerDay: number };
		};

		const threadId = reservation.threadId;
		let topic: AssistantTopic = coerceTopic(reservation.topic, coerceTopic(args.topic));

		try {
			const today = args.today && /^\d{4}-\d{2}-\d{2}$/.test(args.today) ? args.today : localTodayISO();

			// 2) Écran de sécurité DÉTERMINISTE (avant tout coût IA, §24).
			if (text && safetyScreen(text).level === "distress") {
				await ctx.runMutation(api.assistant.commit, {
					sessionToken: args.sessionToken,
					threadId,
					topic,
					userMessage: text,
					assistantMessage: DISTRESS_REPLY,
					kind: "safety",
				});
				return {
					ok: true as const,
					threadId,
					topic,
					reply: DISTRESS_REPLY,
					kind: "safety" as const,
					pendingAction: null,
					usage: reservation.usage,
				};
			}

			// 3) Photo jointe → MÊME pipeline Repas IA (aucun nouveau fournisseur).
			let imageHint = "";
			if (withImage) {
				try {
					const r = (await ctx.runAction(api.aiAnalysis.analyzeMeal, {
						sessionToken: args.sessionToken,
						imageDataUrl: args.imageDataUrl,
					})) as { ok: boolean; components?: { name: string; qtyGrams: number }[] };
					if (r.ok && r.components?.length) {
						imageHint = r.components.map((c) => `${c.name} (${c.qtyGrams} g)`).join(", ");
					}
				} catch {
					imageHint = "";
				}
			}

			// 4) Contexte LIMITÉ : fenêtre récente seulement (§28).
			const history = (await ctx.runQuery(api.assistant.historyFor, {
				sessionToken: args.sessionToken,
				threadId,
			})) as { messages: { role: "user" | "assistant"; content: string }[] };
			const context = history.messages
				.slice(-Math.max(2, assistantLimits().historyWindow - 2))
				.map((m) => ({ role: m.role, content: m.content }));

			// 5) Bloc CONTEXTE serveur (Lot 2) — compact, données à jour, injecté
			// au system prompt. Échec → contexte vide, la boucle reste fonctionnelle.
			let system = assistantSystemPrompt(topic, today);
			try {
				const ctxData = (await ctx.runQuery(api.assistantRead.contextFor, {
					sessionToken: args.sessionToken,
					...(today ? { date: today } : {}),
				})) as Parameters<typeof buildContextBlock>[0];
				const block = buildContextBlock(ctxData);
				if (block) system = `${system}\n\n${block}`;
			} catch {
				/* contexte indisponible : on continue sans */
			}

			// 5b) LOT 2B — CLARIFICATION DÉTERMINISTE (Bug 2) : message court,
			// sans verbe d'ajout ni question, alors qu'une action journal_add est
			// EN ATTENTE et raffine une de ses lignes (« pain de mie complet »).
			// Le SERVEUR applique la mise à jour lui-même : lignes/quantités déjà
			// données conservées, recalcul par le pipeline verrouillé — la mémoire
			// de la tâche ne repose PAS sur le modèle. Retour anticipé : aucun
			// appel IA, zéro hallucination possible sur ce chemin.
			const trimmed = text.trim();
			const tokCount = trimmed.split(/\s+/).filter(Boolean).length;
			if (
				trimmed.length >= 4 &&
				tokCount <= 8 &&
				// Une QUESTION courte est acceptée : si elle raffine une ligne
				// existante ("Avec du curcuma ?" raffine le riz — « Curcuma » est
				// un nouveau NOM, donc PAS de raffinement et chemins normaux), le
				// serveur répond sans dérive de contexte. Si elle ne raffine RIEN,
				// elle part dans la boucle IA classique (vraie question).
				!ADD_INTENT_RE.test(trimmed) &&
				!/\b(delete|supprime|retire|enlève|annule)\b/i.test(trimmed)
			) {
				try {
					const open = (await ctx.runQuery(api.assistantTools.latestPendingJournalAdd, {
						sessionToken: args.sessionToken,
						threadId,
					})) as { actionId: string; preview: { title: string; lines: { label: string }[] } } | null;
					if (open && open.preview.lines.some((l) => refineMatch(l.label, trimmed))) {
						const upd = (await ctx.runMutation(api.assistantTools.updatePendingJournalEntry, {
							sessionToken: args.sessionToken,
							threadId,
							topic,
							items: [{ name: trimmed.replace(/[.,;!?]+$/, "").slice(0, 80) }],
						})) as { actionId: string; preview: { title: string; lines: { label: string; detail?: string }[] }; changed: { from: string; to: string; qtyGrams: number }[] };
						if (upd.changed.length > 0) {
							const swap = upd.changed
								.map((c) => `« ${c.from} » → « ${c.to} » (${c.qtyGrams} g conservés)`)
								.join(", ");
							const replyC = `C'est mis à jour : ${swap}. Le reste ne change pas — clique sur « Enregistrer » pour valider.`;
							await ctx.runMutation(api.assistant.commit, {
								sessionToken: args.sessionToken,
								threadId,
								topic,
								userMessage: text,
								assistantMessage: replyC,
								kind: "text",
								...(upd.actionId ? { actionId: upd.actionId as Id<"assistantActions"> } : {}),
								model: assistantModel(),
								durationMs: 0,
							});
							return {
								ok: true as const,
								threadId,
								topic,
								reply: replyC,
								kind: "text" as const,
								pendingAction: {
									actionId: upd.actionId,
									actionType: "journal_add" as const,
									preview: upd.preview,
								},
								usage: { ...reservation.usage, durationMs: 0 },
							};
						}
					}					} catch {
						// Clarification ratée → chemins normaux (IA). Aucune écriture
						// partielle possible : la mutation patche ATOMIQUEMENT.
					}
				}

			// 6) Boucle d'outils — REGISTRE (Lot 2) : le serveur exécute, le
			// modèle reformule. Les actions 'prepare' alimentent holder.pending.
			const holder: { pending: PendingAction | null } = { pending: null };
			const state: ToolRunState = { sessionToken: args.sessionToken, threadId, topic, today, userText: text };
				const toolErrors: string[] = [];
				const callTool = async (name: string, a: Record<string, unknown>): Promise<unknown> => {
					const out = await dispatchTool(ctx, name, a, state);
					// §9 (diagnostic batterie) — les échecs d'outil avalés par le
					// registre sont TRACÉS : le modèle se remitte souvent en texte
					// de description (« J'ai trouvé… ») sans action ; sans trace,
					// l'échec est invisible. Tracé limité (12, preview only).
					if (out && typeof out === "object" && (out as { ok?: unknown }).ok === false) {
						const reason = String((out as { reason?: unknown }).reason ?? "?").slice(0, 120);
						toolErrors.push(`${name}: ${reason}`);
					}
				// Le sujet suit les outils meta (setTopic) via l'état partagé.
				topic = coerceTopic(state.topic, topic);
				// Toute action 'prepare' qui revient avec un actionId devient la
				// pendingAction du tour (comportement V1 inchangé).
				const withAction = out as { actionId?: unknown; preview?: unknown } | null;
				if (withAction && typeof withAction.actionId === "string" && withAction.actionId.length >= 10) {
					// LOT 2B — la mise à jour REMPLACE la pendingAction du tour (une
					// seule preview affichée : l'ancienne version devient obsolète).
					holder.pending = {
						actionId: withAction.actionId,
						actionType: /JournalRemoval/.test(name)
							? "journal_remove"
							: /Measurement/.test(name)
								? "measurement"
								: /CoachQuestion/.test(name)
									? "coach_question"
									: "journal_add",
						preview: withAction.preview,
					};
				}
				return out;
			};

			let reply: string;
			let toolCalls: string[] = [];
			let usage: {
				inputTokens?: number;
				outputTokens?: number;
				durationMs: number;
				estimatedCostUsd?: number;
			} = { durationMs: 0 };
			try {
				const turn = await runAssistantTurn({
					system,
					history: context,
					userText: text || "(photo jointe)",
					...(imageHint ? { imageHint } : {}),
					tools: registryToolDefs(),
					callTool,
					maxRounds: assistantLimits().maxToolRounds,
				});
				reply = turn.text;
				toolCalls = turn.toolCalls;
				usage = {
					...(turn.usage.inputTokens !== undefined ? { inputTokens: turn.usage.inputTokens } : {}),
					...(turn.usage.outputTokens !== undefined ? { outputTokens: turn.usage.outputTokens } : {}),
					durationMs: turn.usage.durationMs,
					...(turn.usage.estimatedCostUsd !== undefined ? { estimatedCostUsd: turn.usage.estimatedCostUsd } : {}),
				};
				// 6b) Filets « réponse sans outil » — déclencheurs déterministes,
				// relance d'UN tour borné (maxRounds 1) exigeant l'appel adapté :
				//  - annonce sans outil OU intention d'ajout restée sans action
				//    → relance PRÉPARATION (update si action en attente) ;
				//  - kcal récitées sans outil sur une QUESTION DE LECTURE
				//    → relance LECTURE (getToday/getPeriodRecap) — JAMAIS prepare
				//    (bug constaté : une question « combien de kcal » fabriquait
				//    une action d'ajout fantôme avec un aliment de l'historique).
				const addIntent = ADD_INTENT_RE.test(text);
				const noQuestion = !reply.includes("?");
				const announce = ANNOUNCE_WITHOUT_TOOL_RE.test(reply);
				const recites = VALUES_WITHOUT_TOOL_RE.test(reply);
				const readToolUsed = /getToday|getPeriodRecap|getJournalEntries/.test(toolCalls.join(","));
				let retryKind: "prepare" | "read" | null = null;
				if (!holder.pending && (announce || (addIntent && noQuestion))) retryKind = "prepare";
				else if (!holder.pending && recites && noQuestion && !addIntent && !readToolUsed) retryKind = "read";
				if (retryKind) {
					// LOT 2B — relance INFORMÉE : si une action journal_add est en
					// attente sur ce fil, le serveur fournit ses lignes au modèle et
					// exige updateJournalEntry (compléter la tâche, ne pas la refaire).
					let pendingState = "";
					if (retryKind === "prepare") {
						try {
						const open = (await ctx.runQuery(api.assistantTools.latestPendingJournalAdd, {
							sessionToken: args.sessionToken,
							threadId,
						})) as { actionId: string; preview: { title: string; lines: { label: string; detail?: string }[] } } | null;
						if (open) {
							const lines = open.preview.lines.map((l) => `- ${l.label}${l.detail ? ` (${l.detail})` : ""}`).join("\n");
							pendingState = `\n\n[SYSTÈME] Une prévisualisation est DÉJÀ en attente (${open.preview.title}) :\n${lines}\n→ La dernière demande est une CLARIFICATION de cette tâche : appelle MAINTENANT updateJournalEntry avec SEULEMENT les aliments concernés (name ; qtyGrams seulement si la quantité change — sans qtyGrams la quantité déjà préparée est conservée). Les autres lignes restent intactes. N'appelle PAS prepareJournalEntry et ne redemande AUCUNE information déjà présente ci-dessus.`;
						}						} catch {
							/* état indisponible : relance standard */
						}
					}
					const retryInstruction =
						retryKind === "read"
							? "\n\n[SYSTÈME] Ta réponse précédente donnait des valeurs chiffrées SANS avoir consulté les données. Appelle MAINTENANT getToday (ou getPeriodRecap si la question porte sur une période) et réponds UNIQUEMENT à partir des chiffres renvoyés par l'outil. N'utilise JAMAIS prepareJournalEntry pour une simple question."
							: "\n\n[SYSTÈME] Le tour précédent n'a appelé AUCUN outil de préparation alors que la demande l'exigeait." + (pendingState || "\n\n[SYSTÈME] Appelle MAINTENANT l'outil prepare* adapté avec EXACTEMENT les éléments demandés (noms, quantités, unités) — sans reformuler la demande.");
					const retry = await runAssistantTurn({
						system: `${system}${retryInstruction}`,
						history: [
							...context,
							{ role: "user" as const, content: text || "(photo jointe)" },
							{ role: "assistant" as const, content: reply },
						],
						userText: retryKind === "read" ? "(relance système : consulte les données réelles maintenant)" : "(relance système : appelle l'outil de préparation maintenant)",
						tools: registryToolDefs(),
						callTool,
						// LOT 2B (C1 batterie) — 2 rounds : un premier appel d'outil
						// peut échouer (ID fabriqué du modèle → « réf. inconnue ») :
						// le round suivant, informé de l'erreur d'outil, appelle
						// correctement searchFood/prepare AU LIEU de réciter.
						maxRounds: retryKind === "prepare" ? 2 : 1,
					});
					reply = retry.text;
					toolCalls = [...toolCalls, ...retry.toolCalls];
					usage = {
						inputTokens: (usage.inputTokens ?? 0) + (retry.usage.inputTokens ?? 0),
						outputTokens: (usage.outputTokens ?? 0) + (retry.usage.outputTokens ?? 0),
						durationMs: usage.durationMs + retry.usage.durationMs,
						...(usage.estimatedCostUsd !== undefined || retry.usage.estimatedCostUsd !== undefined
							? { estimatedCostUsd: (usage.estimatedCostUsd ?? 0) + (retry.usage.estimatedCostUsd ?? 0) }
							: {}),
					};
				}
			} catch (e) {
				if (!(e instanceof OpenAiUnavailableError)) throw e;
				// Panne IA : quota remboursé, message humain + « Réessayer » (§33).
				await ctx.runMutation(api.assistant.release, { sessionToken: args.sessionToken, withImage });
				await ctx.runMutation(api.assistant.commit, {
					sessionToken: args.sessionToken,
					threadId,
					topic,
					userMessage: text || "(message)",
					assistantMessage: e.message,
					kind: "error",
					model: assistantModel(),
					durationMs: 0,
				});
				return {
					ok: false as const,
					threadId,
					topic,
					reply: e.message,
					kind: "error" as const,
					pendingAction: null,
					usage: reservation.usage,
				};
			}

			// 6) Persistance (messages + action éventuelle + libération verrou).
			const pending = holder.pending;
			await ctx.runMutation(api.assistant.commit, {
				sessionToken: args.sessionToken,
				threadId,
				topic,
				userMessage: text || "(photo jointe)",
				assistantMessage: reply,
				kind: "text",
				...(pending ? { actionId: pending.actionId as Id<"assistantActions"> } : {}),
				toolCalls,
				...(toolErrors.length ? { toolErrors: toolErrors.slice(0, 12) } : {}),
				model: assistantModel(),
				...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
				...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
				durationMs: usage.durationMs,
				...(usage.estimatedCostUsd !== undefined ? { estimatedCostUsd: usage.estimatedCostUsd } : {}),
			});

			return {
				ok: true as const,
				threadId,
				topic,
				reply,
				kind: "text" as const,
				pendingAction: pending,
				usage: reservation.usage,				};
		} catch (e) {
			// Échec inattendu : remboursement de la réservation + relâche verrou.
			await ctx.runMutation(api.assistant.release, { sessionToken: args.sessionToken, withImage });
			throw new ConvexError(userFacingError(e));
		}
	},
});
