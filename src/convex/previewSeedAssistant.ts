/**
 * SEED ASSISTANT — cliente fictive « Sophie Martin » (§37 mission).
 *
 * BUT : pouvoir tester les CONVERSATIONS de l'Assistant sur un profil
 * réaliste (journal, objectifs, poids, pas, mensurations, historique) sans
 * JAMAIS toucher à une donnée réelle.
 *
 * GARDE-FOUS (identiques aux autres seeds de preview) :
 *  - verrou anti-production (CONVEX_CLOUD_URL) : refuse calm-jaguar-475 ;
 *  - 100 % fictif : adresse @example.com, mot de passe de démo documenté,
 *    aucune PII, aucune copie de donnée production ;
 *  - IDEMPOTENT : chaque ligne est reconnue (email / date) avant insertion —
 *    un re-seed met à jour sans jamais dupliquer ;
 *  - dates RECALCULÉES à chaque exécution relativement à aujourd'hui, la
 *    fenêtre de test reste pertinente même après plusieurs builds ;
 *  - NON BLOQUANT : un échec de ce seed n'empêche JAMAIS le seed principal ;
 *  - ADDITIF : aucune table existante n'est modifiée, aucun compte réel
 *    touché, aucune donnée de cliente.
 *
 * Alimentation : références Ciqual/ANSES embarquées (mêmes libellés
 * officiels que le Journal) — AUCUNE création d'aliment, AUCUNE base parallèle.
 */

import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { normalizeEmail, hashPassword, localTodayISO, addDaysISO } from "./helpers";
import { resolveCiqualLabel } from "./ciqual";

const PROD_URL_MARK = "calm-jaguar-475";
export const ASSISTANT_DEMO_EMAIL = normalizeEmail("sophie.martin@example.com");
export const ASSISTANT_DEMO_PASSWORD = "PreviewSophie2026!";

/** Verrou : refuse explicitement tout déploiement ressemblant à la prod. */
function assertNotProd(): void {
	const cloudUrl = process.env.CONVEX_CLOUD_URL ?? "";
	if (cloudUrl.includes(PROD_URL_MARK)) {
		throw new ConvexError("Seed ASSISTANT refusé : déploiement de production détecté.");
	}
}

type Meal = "petit-dej" | "dejeuner" | "diner" | "collation";

/**
 * Menu type de Sophie — rotation déterministe sur 7 jours (réaliste et
 * stable d'une exécution à l'autre). Libellés Ciqual VÉRIFIÉS présents dans
 * la table embarquée ; toute référence absente est simplement ignorée.
 */
const MENU: { meal: Meal; label: string; qty: number }[] = [
	{ meal: "petit-dej", label: "Pain complet ou intégral (à la farine T150)", qty: 60 },
	{ meal: "petit-dej", label: "Lait demi-écrémé, pasteurisé", qty: 250 },
	{ meal: "petit-dej", label: "Banane, chair sans peau, crue", qty: 120 },
	{ meal: "dejeuner", label: "Poulet, poitrine, viande et peau rôties/cuites au four", qty: 150 },
	{ meal: "dejeuner", label: "Riz basmati, cuit, sans sel ajouté", qty: 180 },
	{ meal: "dejeuner", label: "Tomate cerise, crue", qty: 120 },
	{ meal: "collation", label: "Fromage blanc ou spécialité laitière, aromatisé, 0% MG, avec édulcorants, sans sucres ajoutés", qty: 150 },
	{ meal: "diner", label: "Saumon fumé", qty: 100 },
	{ meal: "diner", label: "Riz blanc étuvé, cuit, sans sel ajouté", qty: 150 },
	{ meal: "diner", label: "Banane, chair sans peau, crue", qty: 100 },
];

export type SeedAssistantResult = {
	ok: boolean;
	demoEmail: string;
	demoPassword: string;
	days: number;
	entries: number;
	stepsDays: number;
	weighs: number;
	/** Preview : quotas Assistant du compte démo remis à zéro (re-seed). */
	usageReset?: boolean;
	error?: string;
};

/**
 * Crée (idempotent) Sophie Martin + 3 semaines de données de suivi.
 * `coachId` = coach fictif de la preview (déjà créé par seedCoreData).
 */
export async function seedAssistantDemoData(
	db: MutationCtx["db"],
	coachId: Id<"users">
): Promise<SeedAssistantResult> {
	assertNotProd();
	const now = Date.now();
	const today = localTodayISO();
	const passwordHash = await hashPassword(ASSISTANT_DEMO_PASSWORD);

	/* 1) Compte — hash réappliqué (self-healing : le mot de passe documenté
	      fonctionne toujours, même après N builds). */
	let userId = (await db.query("users").withIndex("by_email", (q) => q.eq("email", ASSISTANT_DEMO_EMAIL)).unique())?._id;
	if (!userId) {
		userId = await db.insert("users", {
			email: ASSISTANT_DEMO_EMAIL,
			passwordHash,
			role: "client",
			prenom: "Sophie",
			nom: "Martin",
			createdBy: coachId,
			startDate: addDaysISO(today, -30),
			heightCm: 166,
		});
	} else {
		await db.patch(userId, { passwordHash });
	}

	/* 2) Objectifs Coach (LECTURE SEULE pour l'Assistant — seule la cliente
	      ne peut pas les changer, c'est le CRM qui les pose). */
	const goals = await db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", userId)).first();
	if (!goals) {
		await db.insert("clientGoals", {
			userId,
			kcal: 1950,
			carbs: 210,
			protein: 120,
			fat: 65,
			maintenanceKcal: 2300,
			stepGoal: 9000,
		});
	}
	const history = await db.query("clientGoalHistory").withIndex("by_user", (q) => q.eq("userId", userId)).first();
	if (!history) {
		await db.insert("clientGoalHistory", {
			userId,
			kcal: 1950,
			effectiveFrom: addDaysISO(today, -30),
			createdBy: coachId,
			createdAt: now,
		});
	}

	/* 3) PAS — 21 jours (une journée sans donnée volontaire : « vide ≠ 0 »). */
	let stepsDays = 0;
	for (let i = 20; i >= 0; i--) {
		const date = addDaysISO(today, -i);
		if (i === 9) continue; // journée sans donnée (cas réaliste)
		const existing = await db
			.query("dailySteps")
			.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
			.first();
		const count = 6200 + ((i * 977) % 4200); // 6 200 → 10 399, déterministe
		if (existing) {
			if (existing.count !== count) await db.patch(existing._id, { count, manualCount: count });
		} else {
			await db.insert("dailySteps", { userId, date, count, manualCount: count, createdAt: now });
		}
		stepsDays++;
	}

	/* 4) POIDS — 3 semaines, 4 pesées (perte progressive, réaliste). */
	let weighs = 0;
	for (const [i, delta] of [
		[20, 0],
		[14, -0.4],
		[7, -0.9],
		[0, -1.3],
	] as const) {
		const date = addDaysISO(today, -i);
		const weightKg = Math.round((68.6 + delta) * 10) / 10;
		const existing = await db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
			.first();
		if (existing) {
			if (existing.weightKg !== weightKg) await db.patch(existing._id, { weightKg });
		} else {
			await db.insert("bodyMetrics", { userId, date, weightKg, createdAt: now });
		}
		weighs++;
	}

	/* 5) MENSURATIONS — 2 relevés (comparables, pour « Comparer mes jours »). */
	for (const [i, waist] of [
		[20, 76.5],
		[0, 74.8],
	] as const) {
		const date = addDaysISO(today, -i);
		const existing = await db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
			.first();
		if (existing) {
			if (existing.waistCm !== waist) await db.patch(existing._id, { waistCm: waist, hipCm: 98.2, neckCm: 32.4 });
		} else {
			await db.insert("bodyMetrics", {
				userId,
				date,
				waistCm: waist,
				hipCm: 98.2,
				neckCm: 32.4,
				createdAt: now,
			});
		}
	}

	/* 5b) QUOTAS Assistant — re-seed = journée de test A NEUF.
	      Sans ça, la batterie E2E épuise les 50 échanges du jour et tous les
	      scénarios suivants échouent en cascade sur les builds réutilisés.
	      Le compte de QUOTA n'est pas une donnée cliente : le remettre à zéro
	      sur preview est sans conséquence (gated assertNotProd). */
	const usageRows = await db.query("assistantUsage").withIndex("by_user_day", (q) => q.eq("userId", userId)).collect();
	for (const row of usageRows) await db.delete(row._id);

	/* 6) JOURNAL — 7 derniers jours, rotation du menu Ciqual. */
	let entries = 0;
	for (let d = 6; d >= 0; d--) {
		const date = addDaysISO(today, -d);
		const existing = await db
			.query("diaryEntries")
			.withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", date))
			.collect();
		if (existing.length > 0) continue;
		for (const [k, item] of MENU.entries()) {
			// Rotation : chaque jour met l'accent sur un sous-ensemble (realisme).
			if ((d + k) % 5 === 4) continue;
			const ref = resolveCiqualLabel(item.label);
			if (!ref) continue; // référence absente → simplement ignorée
			await db.insert("diaryEntries", {
				userId,
				date,
				meal: item.meal,
				name: ref.label,
				qtyGrams: item.qty,
				kcal: Math.round((ref.kcal * item.qty) / 100),
				carbs: Math.round(((ref.carbs ?? 0) * item.qty) / 100 * 10) / 10,
				protein: Math.round(((ref.protein ?? 0) * item.qty) / 100 * 10) / 10,
				fat: Math.round(((ref.fat ?? 0) * item.qty) / 100 * 10) / 10,
				createdAt: now,
			});
			entries++;
		}
	}

	return {
		ok: true,
		demoEmail: ASSISTANT_DEMO_EMAIL,
		demoPassword: ASSISTANT_DEMO_PASSWORD,
		days: 21,
		entries,
		stepsDays,
		weighs,
		usageReset: true,
	};
}
