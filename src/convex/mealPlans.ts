import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getSessionUser } from "./helpers";
import { ciqualFoodSource } from "./ciqualSource";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";

/**
 * Plans de repas (coach) + planification (cliente).
 *
 * - `mealPlanTemplates`    : bibliothèque de plans de la coach (1 journée type,
 *   indépendante des clientes — le même plan sert à plusieurs clientes).
 * - `mealPlanAssignments`  : plan ↔ cliente (période + jours concernés).
 * - `plannedEntries`       : aliment planifié d'une journée précise
 *   (client_planned en écriture cliente ; coach_plan résolu par copy-on-write).
 *
 * RÈGLE ABSOLUE : planifié ≠ consommé. Rien ici ne touche `diaryEntries` :
 * un item planifié n'a AUCUN impact calories/macros tant qu'il n'est pas
 * validé « Mangé » (mutation journal.eatPlanned → diaryEntries).
 */

const MEALS = ["petit-dej", "dejeuner", "diner", "collation"] as const;
type Meal = (typeof MEALS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateISO(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isMeal(m: string): m is Meal {
	return (MEALS as readonly string[]).includes(m);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function requireCoach(ctx: Pick<QueryCtx, "db">, sessionToken: string | undefined | null) {
	const user = await getSessionUser(ctx, sessionToken);
	if (!user) throw new ConvexError("Session invalide ou expirée. Reconnecte-toi.");
	if (user.role !== "coach") throw new ConvexError("Réservé à la coach (CRM).");
	return user;
}

/* ───────────────────────── Bibliothèque (coach) ───────────────────────── */

/** Liste compacte des plans de la coach (sans les items — léger). */
export const listTemplates = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("mealPlanTemplates")
			.withIndex("by_coach_updated", (q) => q.eq("coachId", coach._id))
			.order("desc")
			.collect();
		// Nombre de clientes actuellement assignées (assignments actives).
		const counts = new Map<string, number>();
		for (const t of rows) counts.set(t._id, 0);
		const assignments = await ctx.db.query("mealPlanAssignments").collect();
		for (const a of assignments) {
			if (a.removedAt) continue;
			if (!counts.has(a.templateId)) continue;
			counts.set(a.templateId, (counts.get(a.templateId) ?? 0) + 1);
		}
		return rows.map((t) => ({
			_id: t._id,
			name: t.name,
			description: t.description,
			totalKcal: t.totalKcal,
			totalCarbs: t.totalCarbs,
			totalProtein: t.totalProtein,
			totalFat: t.totalFat,
			itemCount: t.items.length,
			createdAt: t.createdAt,
			updatedAt: t.updatedAt,
			clients: counts.get(t._id) ?? 0,
		}));
	},
});

/** Un plan complet (éditeur coach). */
export const getTemplate = query({
	args: { sessionToken: v.optional(v.string()), templateId: v.id("mealPlanTemplates") },
	handler: async (ctx, { sessionToken, templateId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const t = await ctx.db.get(templateId);
		if (!t || t.coachId !== coach._id) throw new ConvexError("Plan introuvable.");
		return t;
	},
});

/** Valide un item de plan (aliment de la base ou aliment personnel d'UNE cliente).
 *  Normalise le retour : customFoods n'a pas d'imageUrl. */
async function resolveItemFood(
	ctx: QueryCtx,
	foodId: Id<"foods"> | undefined,
	customFoodId: Id<"customFoods"> | undefined
): Promise<{ name: string; brand?: string; imageUrl?: string; kcal100: number; carbs100: number; protein100: number; fat100: number }> {
	if (foodId) {
		const f = await ctx.db.get(foodId);
		if (!f) throw new ConvexError("Un aliment du plan n'existe plus dans la base.");
		return { name: f.name, brand: f.brand, imageUrl: f.imageUrl, kcal100: f.kcal100, carbs100: f.carbs100, protein100: f.protein100, fat100: f.fat100 };
	}
	if (customFoodId) {
		const f = await ctx.db.get(customFoodId);
		if (!f) throw new ConvexError("Un aliment personnel du plan n'existe plus.");
		return { name: f.name, brand: f.brand, imageUrl: undefined, kcal100: f.kcal100, carbs100: f.carbs100, protein100: f.protein100, fat100: f.fat100 };
	}
	throw new ConvexError("Un item du plan n'a aucun aliment.");
}

type ItemInput = {
	meal: string;
	foodId?: Id<"foods">;
	customFoodId?: Id<"customFoods">;
	/** Fiche de RÉFÉRENCE Ciqual (ANSES) : libellé officiel exact — exclusif. */
	ciqualLabel?: string;
	qtyGrams: number;
};

/** Construit le snapshot des items + totaux (source unique pour create/update). */
async function buildSnapshot(ctx: QueryCtx, items: ItemInput[]) {
	if (items.length === 0) throw new ConvexError("Ajoute au moins un aliment au plan.");
	if (items.length > 60) throw new ConvexError("Maximum 60 aliments par plan.");
	const snapshot: {
		meal: string;
		foodId?: Id<"foods">;
		customFoodId?: Id<"customFoods">;
		ciqualLabel?: string;
		name: string;
		brand?: string;
		imageUrl?: string;
		qtyGrams: number;
		kcal: number;
		carbs: number;
		protein: number;
		fat: number;
	}[] = [];
	let totalKcal = 0;
	let totalCarbs = 0;
	let totalProtein = 0;
	let totalFat = 0;
	for (const it of items) {
		if (!isMeal(it.meal)) throw new ConvexError("Repas invalide dans le plan.");
		if (!isFinite(it.qtyGrams) || it.qtyGrams <= 0 || it.qtyGrams > 5000) {
			throw new ConvexError("Quantité invalide (entre 1 et 5000 g).");
		}
		// Fiche de RÉFÉRENCE Ciqual (additif) : valeurs officielles /100 g résolues
		// côté serveur — aucune donnée OFF lue, modifiée ou fusionnée.
		const ciqualFood = it.ciqualLabel ? ciqualFoodSource(it.ciqualLabel) : null;
		if (it.ciqualLabel && !ciqualFood) {
			throw new ConvexError("Une référence Ciqual du plan n'existe plus.");
		}
		const food = ciqualFood ?? (await resolveItemFood(ctx, it.foodId, it.customFoodId));
		const k = it.qtyGrams / 100;
		const row = {
			meal: it.meal,
			foodId: ciqualFood ? undefined : (it.foodId ?? undefined),
			customFoodId: ciqualFood ? undefined : (it.customFoodId ?? undefined),
			ciqualLabel: ciqualFood ? it.ciqualLabel : undefined,
			name: food.name,
			brand: food.brand,
			imageUrl: food.imageUrl,
			qtyGrams: it.qtyGrams,
			kcal: Math.round(food.kcal100 * k),
			carbs: round1(food.carbs100 * k),
			protein: round1(food.protein100 * k),
			fat: round1(food.fat100 * k),
		};
		snapshot.push(row);
		totalKcal += row.kcal;
		totalCarbs += row.carbs;
		totalProtein += row.protein;
		totalFat += row.fat;
	}
	return {
		items: snapshot,
		totalKcal: Math.round(totalKcal),
		totalCarbs: round1(totalCarbs),
		totalProtein: round1(totalProtein),
		totalFat: round1(totalFat),
	};
}

/** Crée un plan (bibliothèque coach). */
export const createTemplate = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		name: v.string(),
		description: v.optional(v.string()),
		items: v.array(
			v.object({
				meal: v.string(),
				foodId: v.optional(v.id("foods")),
				customFoodId: v.optional(v.id("customFoods")),
				ciqualLabel: v.optional(v.string()),
				qtyGrams: v.number(),
			})
		),
	},
	handler: async (ctx, { sessionToken, name, description, items }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const clean = name.trim();
		if (clean.length < 2 || clean.length > 80) {
			throw new ConvexError("Donne un nom au plan (entre 2 et 80 caractères).");
		}
		if (description && description.trim().length > 300) {
			throw new ConvexError("Description trop longue (300 caractères max).");
		}
		const snap = await buildSnapshot(ctx, items);
		const now = Date.now();
		const templateId = await ctx.db.insert("mealPlanTemplates", {
			coachId: coach._id,
			name: clean,
			description: description?.trim() || undefined,
			...snap,
			createdAt: now,
			updatedAt: now,
		});
		return { ok: true, templateId };
	},
});

/** Modifie un plan : n'affecte JAMAIS les journées déjà planifiées/consommées (snapshot). */
export const updateTemplate = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		templateId: v.id("mealPlanTemplates"),
		name: v.string(),
		description: v.optional(v.string()),
		items: v.array(
			v.object({
				meal: v.string(),
				foodId: v.optional(v.id("foods")),
				customFoodId: v.optional(v.id("customFoods")),
				ciqualLabel: v.optional(v.string()),
				qtyGrams: v.number(),
			})
		),
	},
	handler: async (ctx, { sessionToken, templateId, name, description, items }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const t = await ctx.db.get(templateId);
		if (!t || t.coachId !== coach._id) throw new ConvexError("Plan introuvable.");
		const clean = name.trim();
		if (clean.length < 2 || clean.length > 80) {
			throw new ConvexError("Donne un nom au plan (entre 2 et 80 caractères).");
		}
		if (description && description.trim().length > 300) {
			throw new ConvexError("Description trop longue (300 caractères max).");
		}
		const snap = await buildSnapshot(ctx, items);
		await ctx.db.patch(templateId, {
			name: clean,
			description: description?.trim() || undefined,
			...snap,
			updatedAt: Date.now(),
		});
		return { ok: true };
	},
});

/** Duplique un plan (copie indépendante, nom suffixé). */
export const duplicateTemplate = mutation({
	args: { sessionToken: v.optional(v.string()), templateId: v.id("mealPlanTemplates") },
	handler: async (ctx, { sessionToken, templateId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const t = await ctx.db.get(templateId);
		if (!t || t.coachId !== coach._id) throw new ConvexError("Plan introuvable.");
		const now = Date.now();
		const newId = await ctx.db.insert("mealPlanTemplates", {
			coachId: coach._id,
			name: `${t.name} (copie)`.slice(0, 80),
			description: t.description,
			items: t.items,
			totalKcal: t.totalKcal,
			totalCarbs: t.totalCarbs,
			totalProtein: t.totalProtein,
			totalFat: t.totalFat,
			createdAt: now,
			updatedAt: now,
		});
		return { ok: true, templateId: newId };
	},
});

/**
 * Supprime un plan de la bibliothèque. Les assignments actives sont marquées
 * retirées : les propositions FUTURES cessent, l'historique consommé reste.
 */
export const deleteTemplate = mutation({
	args: { sessionToken: v.optional(v.string()), templateId: v.id("mealPlanTemplates") },
	handler: async (ctx, { sessionToken, templateId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const t = await ctx.db.get(templateId);
		if (!t || t.coachId !== coach._id) throw new ConvexError("Plan introuvable.");
		const assignments = await ctx.db
			.query("mealPlanAssignments")
			.withIndex("by_template", (q) => q.eq("templateId", templateId))
			.collect();
		for (const a of assignments) {
			if (!a.removedAt) await ctx.db.patch(a._id, { removedAt: Date.now() });
			// Les propositions futures issues de CE plan cessent pour chaque cliente.
			await deleteFutureCoachPlanItems(ctx, a.userId, templateId);
		}
		await ctx.db.delete(templateId);
		return { ok: true };
	},
});

/* ───────────────────────── Assignations (coach) ───────────────────────── */

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** Assignations d'une cliente (actives + retirées), avec le nom du plan. */
export const assignmentsForClient = query({
	args: { sessionToken: v.optional(v.string()), userId: v.id("users") },
	handler: async (ctx, { sessionToken, userId }) => {
		await requireCoach(ctx, sessionToken);
		const rows = await ctx.db
			.query("mealPlanAssignments")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.order("desc")
			.collect();
		const out = [];
		for (const a of rows) {
			const t = await ctx.db.get(a.templateId);
			out.push({
				_id: a._id,
				templateId: a.templateId,
				templateName: t?.name ?? "(plan supprimé)",
				totalKcal: t?.totalKcal ?? 0,
				startDate: a.startDate,
				endDate: a.endDate,
				weekdays: a.weekdays ?? WEEKDAYS,
				removedAt: a.removedAt ?? null,
				createdAt: a.createdAt,
			});
		}
		return out;
	},
});

/**
 * Assigne un plan à une cliente : remplace l'assignation active précédente
 * (marquée retirée — son historique reste intact) par la nouvelle période.
 */
export const assignTemplate = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		templateId: v.id("mealPlanTemplates"),
		startDate: v.string(),
		endDate: v.string(),
		/** Jours concernés [1..7] (lundi..dimanche) — tous par défaut. */
		weekdays: v.optional(v.array(v.number())),
	},
	handler: async (ctx, { sessionToken, userId, templateId, startDate, endDate, weekdays }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") throw new ConvexError("Client introuvable.");
		const t = await ctx.db.get(templateId);
		if (!t || t.coachId !== coach._id) throw new ConvexError("Plan introuvable.");
		if (!isValidDateISO(startDate) || !isValidDateISO(endDate)) {
			throw new ConvexError("Dates invalides.");
		}
		if (endDate < startDate) throw new ConvexError("La date de fin précède la date de début.");
		if (daysInclusive(startDate, endDate) > 400) {
			throw new ConvexError("Période trop longue (400 jours maximum).");
		}
		const days = weekdays && weekdays.length > 0 ? [...new Set(weekdays)].filter((d) => WEEKDAYS.includes(d)).sort() : WEEKDAYS;

		// Un seul plan actif à la fois : on retire les assignations actives.
		const existing = await ctx.db
			.query("mealPlanAssignments")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		for (const a of existing) {
			if (!a.removedAt) await ctx.db.patch(a._id, { removedAt: Date.now() });
		}
		await ctx.db.insert("mealPlanAssignments", {
			userId,
			templateId,
			coachId: coach._id,
			startDate,
			endDate,
			weekdays: days,
			createdAt: Date.now(),
		});
		return { ok: true };
	},
});

/** Retire le plan d'une cliente : les propositions futures cessent, l'historique reste. */
export const removeAssignment = mutation({
	args: { sessionToken: v.optional(v.string()), assignmentId: v.id("mealPlanAssignments") },
	handler: async (ctx, { sessionToken, assignmentId }) => {
		const coach = await requireCoach(ctx, sessionToken);
		const a = await ctx.db.get(assignmentId);
		if (!a) throw new ConvexError("Assignation introuvable.");
		const target = await ctx.db.get(a.userId);
		if (!target || target.role !== "client" || a.coachId !== coach._id) {
			throw new ConvexError("Assignation introuvable.");
		}
		if (!a.removedAt) await ctx.db.patch(assignmentId, { removedAt: Date.now() });
		// Les propositions FUTURES issues de ce plan cessent immédiatement :
		// on supprime les items coach_plan NON consommés des dates à venir.
		// L'historique (passé + déjà consommé → diaryEntries) reste intact, et
		// les planifications personnelles (client_planned) ne sont JAMAIS touchées.
		await deleteFutureCoachPlanItems(ctx, a.userId, a.templateId);
		return { ok: true };
	},
});

/** Supprime les items coach_plan non consommés d'un template pour les dates ≥ aujourd'hui. */
async function deleteFutureCoachPlanItems(
	ctx: MutationCtx,
	userId: Id<"users">,
	templateId: Id<"mealPlanTemplates">
): Promise<void> {
	const today = localTodayOfTs(Date.now());
	const rows = await ctx.db
		.query("plannedEntries")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
	for (const r of rows) {
		if (r.source !== "coach_plan") continue;
		if (r.templateId !== templateId) continue;
		if (r.date < today) continue; // historique : jamais supprimé
		await ctx.db.delete(r._id);
	}
}

function daysInclusive(startISO: string, endISO: string): number {
	const ms = (iso: string) => {
		const [y, m, d] = iso.split("-").map(Number);
		return Date.UTC(y, m - 1, d);
	};
	return Math.round((ms(endISO) - ms(startISO)) / 86400000) + 1;
}

/* ───────────────── Résolution plan → items planifiés (cliente) ───────────────── */

export type PlannedItemDoc = Doc<"plannedEntries">;

/**
 * Matérialise (copy-on-write) les items du plan coach ACTIF pour (cliente, date).
 *
 * Une date matérialisée une fois ne se régénère plus : la cliente peut ensuite
 * modifier / supprimer / remplacer / valider les items sans jamais toucher au
 * template. Les dates passées ne sont JAMAIS résolues (historique stable).
 * À appeler par l'endpoint AVANT journal.getDay (une mutation Convex ne peut
 * pas être déclenchée depuis une query).
 */
export const ensurePlanForDate = mutation({
	args: { sessionToken: v.optional(v.string()), date: v.string() },
	handler: async (ctx, { sessionToken, date }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user || user.role !== "client") return { ok: false };
		if (!isValidDateISO(date)) return { ok: false };
		await resolveCoachPlanForDate(ctx, user._id, date);
		return { ok: true };
	},
});

/**
 * Résout (copy-on-write) les items du plan coach ACTIF pour (user, date) :
 * pour chaque date concernée on matérialise une fois les items du template
 * dans `plannedEntries` (source coach_plan) — la cliente peut ensuite les
 * modifier/supprimer/valider sans jamais toucher au template.
 *
 * Règles :
 * - l'assignation doit couvrir la date (start/end/weekday, non retirée) ;
 * - une date PASSÉE n'est jamais résolue (l'historique n'est jamais reconstruit) ;
 * - items déjà matérialisés pour la même clé template → aucun doublon ;
 * - un template modifié par la coach n'affecte que les dates PAS ENCORE matérialisées.
 */
export async function resolveCoachPlanForDate(
	ctx: MutationCtx,
	userId: Id<"users">,
	date: string
): Promise<void> {
	const today = localTodayOfTs(Date.now());
	if (date < today) return; // passé : jamais régénéré
	// Assignation active couvrant la date ?
	const assignments = await ctx.db
		.query("mealPlanAssignments")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.order("desc")
		.collect();
	const weekday = isoWeekday(date);
	const active = assignments.find(
		(a) =>
			!a.removedAt &&
			a.startDate <= date &&
			date <= a.endDate &&
			(a.weekdays ?? WEEKDAYS).includes(weekday)
	);
	if (!active) return;
	const template = await ctx.db.get(active.templateId);
	if (!template) return;

	// Items déjà matérialisés pour cette date.
	const existing = await ctx.db
		.query("plannedEntries")
		.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
		.collect();
	const existingKeys = new Set(
		existing.filter((e) => e.source === "coach_plan").map((e) => e.templateItemKey ?? e.name)
	);

	for (let i = 0; i < template.items.length; i++) {
		const item = template.items[i];
		const key = templateItemKey(item, i);
		if (existingKeys.has(key)) continue;
		await ctx.db.insert("plannedEntries", {
			userId,
			date,
			meal: item.meal,
			source: "coach_plan",
			templateId: template._id,
			templateItemKey: key,
			name: item.name,
			brand: item.brand,
			imageUrl: item.imageUrl,
			qtyGrams: item.qtyGrams,
			kcal: item.kcal,
			carbs: item.carbs,
			protein: item.protein,
			fat: item.fat,
			foodId: item.foodId,
			customFoodId: item.customFoodId,
			ciqualLabel: item.ciqualLabel,
			createdAt: Date.now(),
		});
	}
}

/** Clé stable d'un item de template (index + repas + nom). */
function templateItemKey(item: { meal: string; name: string }, index: number): string {
	return `${index}:${item.meal}:${item.name}`;
}

/** Jour ISO local d'un timestamp (le serveur vit dans le fuseau de la coach —
 *  la résolution ne sert qu'à borner « pas de résolution dans le passé »). */
function localTodayOfTs(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 1 = lundi … 7 = dimanche (iso). */
function isoWeekday(dateISO: string): number {
	const [y, m, d] = dateISO.split("-").map(Number);
	const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return day === 0 ? 7 : day;
}

/** Mini-plan d'une date pour l'UI cliente (bandeau) — léger, sans items. */
export const activePlanForClientDate = query({
	args: { sessionToken: v.optional(v.string()), date: v.string() },
	handler: async (ctx, { sessionToken, date }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user || user.role !== "client") return null;
		if (!isValidDateISO(date)) return null;
		const assignments = await ctx.db
			.query("mealPlanAssignments")
			.withIndex("by_user", (q) => q.eq("userId", user._id))
			.order("desc")
			.collect();
		const weekday = isoWeekday(date);
		const active = assignments.find(
			(a) =>
				!a.removedAt &&
				a.startDate <= date &&
				date <= a.endDate &&
				(a.weekdays ?? WEEKDAYS).includes(weekday)
		);
		if (!active) return null;
		const t = await ctx.db.get(active.templateId);
		if (!t) return null;
		return {
			assignmentId: active._id,
			templateId: t._id,
			name: t.name,
			totalKcal: t.totalKcal,
			startDate: active.startDate,
			endDate: active.endDate,
		};
	},
});

/** Aperçu lecture-seul d'un plan pour la cliente (« Voir le plan » côté coach
 *  et éventuellement côté cliente) : le template coach reste en lecture seule. */
export const templatePreview = query({
	args: { sessionToken: v.optional(v.string()), templateId: v.id("mealPlanTemplates") },
	handler: async (ctx, { sessionToken, templateId }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) throw new ConvexError("Session invalide ou expirée.");
		const t = await ctx.db.get(templateId);
		if (!t) throw new ConvexError("Plan introuvable.");
		if (user.role !== "coach" && t.coachId !== user._id) {
			// Cliente : uniquement les plans qui lui sont assignés.
			const assigned = await ctx.db
				.query("mealPlanAssignments")
				.withIndex("by_user", (q) => q.eq("userId", user._id))
				.collect();
			if (!assigned.some((a) => a.templateId === templateId)) {
				throw new ConvexError("Ce plan ne t'est pas assigné.");
			}
		}
		return {
			_id: t._id,
			name: t.name,
			description: t.description,
			items: t.items,
			totalKcal: t.totalKcal,
			totalCarbs: t.totalCarbs,
			totalProtein: t.totalProtein,
			totalFat: t.totalFat,
		};
	},
});
