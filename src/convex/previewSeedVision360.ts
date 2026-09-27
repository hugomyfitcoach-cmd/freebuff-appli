/**
 * SEED DEMO VISION 360 — données 100 % SYNTHÉTIQUES, PREVIEW UNIQUEMENT.
 *
 * Crée (idempotent) une cliente de démonstration « Demo / Vision360 »
 * (demo.vision360@example.com) avec 3 SEMAINES de données couvrant tous les
 * cas de test de la Vision 360 :
 *
 * - POIDS : plusieurs pesées par semaine, dernière pesée à des jours
 *   différents, une semaine SANS aucune pesée (comparaison indisponible
 *   propre — jamais un 0 inventé) ;
 * - PAS : semaines 7/7 et 6/7, une VRAIE valeur 0 (distincte d'une absence),
 *   une journée sans donnée ;
 * - ALIMENTATION (objectif 1 600 kcal → seuil 960) : journées normales
 *   1 500–1 700, une journée 720 (partielle), une 950 (partielle), une
 *   1 000 (exploitable, juste au-dessus), une journée TOTALEMENT absente ;
 * - PROTÉINES : cohérentes avec les mêmes journées (les partielles seront
 *   exclues des deux moyennes) ;
 * - SPORT : plusieurs activités réparties (manual) ;
 * - MENSURATIONS : 2 relevés complets successifs (deltas comparables) ;
 * - BILAN : envoyé le VENDREDI de la semaine en cours, avec données
 *   synthétiques continues après l'envoi (samedi/dimanche) pour vérifier
 *   que la Vision 360 évolue APRÈS l'envoi (photo live).
 *
 * GARDE-FOUS :
 *  - verrou anti-prod identique au seed principal (CONVEX_CLOUD_URL) ;
 *  - 100 % fictif : adresses @example.com, aucune PII réelle, aucune
 *    copie de donnée production ;
 *  - IDEMPOTENT : tout est reconnu par clés déterministes (email, dates
 *    relatives à AUJOURD'HUI recalculées à chaque seed) — un re-seed
 *    met à jour sans jamais dupliquer ;
 *  - les dates sont RECALCULÉES à chaque exécution relativement à
 *    aujourd'hui : la fenêtre de test reste toujours pertinente même
 *    après plusieurs jours/builds.
 */

import { mutation } from "./_generated/server";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { normalizeEmail, hashPassword, localTodayISO, addDaysISO } from "./helpers";

const PROD_URL_MARK = "calm-jaguar-475";
const DEMO_EMAIL = normalizeEmail("demo.vision360@example.com");
const DEMO_PASSWORD = "PreviewDemo2026!";
const DEMO_COACH_EMAIL = normalizeEmail("preview-test-coach@example.com");

/** Verrou : refuse explicitement tout déploiement ressemblant à la prod. */
function assertNotProd(): void {
	const cloudUrl = process.env.CONVEX_CLOUD_URL ?? "";
	if (cloudUrl.includes(PROD_URL_MARK)) {
		throw new ConvexError("Seed DEMO refusé : déploiement de production détecté.");
	}
}

/** Lundi de la semaine d'une date ISO. */
function mondayOf(iso: string): string {
	const d = new Date(iso + "T12:00:00");
	const day = d.getDay();
	d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${dd}`;
}

type DayPlan = {
	offset: number; // jours relatifs à aujourd'hui (négatif = passé)
	/** Pesée du jour (kg) — absent = pas de pesée. */
	weight?: number;
	/** Pas du jour — undefined = AUCUNE donnée ; null interdit (0 = vraie valeur). */
	steps?: number;
	/** Total kcal du jour — undefined = journée totalement absente. */
	kcal?: number;
	/** Protéines (g) du jour. */
	protein?: number;
	/** Activité sportive : [nom, minutes, kcal estimées]. */
	sport?: [string, number, number];
};

/**
 * PLAN DE 21 JOURS — 3 semaines civiles se terminant HIER (J-1) : les
 * 7 dernières journées complètes (J-7 → J-1) contiennent toujours le jeu
 * de test quelle que soit la date de consultation.
 */
function buildPlan(todayISO: string): DayPlan[] {
	const monday = mondayOf(todayISO); // début de la semaine en cours
	// Lundi de la semaine EN COURS (J-6..J-0) et des 2 semaines précédentes.
	const w0 = monday; // semaine courante (contient les jours J-6 → J-0)
	const w1 = addDaysISO(monday, -7); // semaine précédente (J-13 → J-7)
	const w2 = addDaysISO(monday, -14); // 2 semaines avant (J-20 → J-14)

	const at = (weekISO: string, weekday: number): number => {
		// weekday : 0 = lundi … 6 = dimanche → offset en jours vs aujourd'hui
		const dateISO = addDaysISO(weekISO, weekday);
		const diff = Math.round(
			(new Date(dateISO + "T12:00:00").getTime() - new Date(todayISO + "T12:00:00").getTime()) /
				86400000
		);
		return diff;
	};

	/* SEMAINE S-2 (w2) : 7/7 jours exploitables + pesées régulières + sport */
	const s2: DayPlan[] = [
		{ offset: at(w2, 0), weight: 61.4, steps: 8100, kcal: 1540, protein: 92, sport: ["Marche sportive", 40, 180] },
		{ offset: at(w2, 1), steps: 10200, kcal: 1610, protein: 101 },
		{ offset: at(w2, 2), weight: 61.2, steps: 9400, kcal: 1665, protein: 108, sport: ["Vélo", 45, 320] },
		{ offset: at(w2, 3), steps: 7600, kcal: 1520, protein: 95 },
		{ offset: at(w2, 4), weight: 61.3, steps: 11300, kcal: 1580, protein: 99, sport: ["Musculation", 50, 260] },
		{ offset: at(w2, 5), steps: 8900, kcal: 1640, protein: 104 },
		{ offset: at(w2, 6), weight: 61.1, steps: 9800, kcal: 1600, protein: 97 },
	];

	/* SEMAINE S-1 (w1) : les jours exploitables/partiels/absents + 6/7 pas
	   + UNE semaine SANS pesée (comparaison indisponible) + vrai 0 pas. */
	const s1: DayPlan[] = [
		{ offset: at(w1, 0), steps: 9200, kcal: 1570, protein: 98, sport: ["Natation", 40, 300] },
		{ offset: at(w1, 1), steps: 0, kcal: 720, protein: 38 }, // vraie valeur 0 pas + journée PARTIELLE (720 < 960)
		{ offset: at(w1, 2), steps: 10400, kcal: 1620, protein: 106 }, // exploitable
		{ offset: at(w1, 3), steps: 8700, kcal: 1000, protein: 64 }, // juste au-dessus du seuil 960 → exploitable
		{ offset: at(w1, 4), steps: 9500, kcal: 950, protein: 55 }, // PARTIELLE (950 < 960)
		{ offset: at(w1, 5) }, // journée TOTALEMENT absente (pas de kcal, pas de pas)
		{ offset: at(w1, 6), steps: 10100, kcal: 1690, protein: 112, sport: ["Musculation", 55, 285] },
	];

	/* SEMAINE COURANTE (w0) : données du LUNDI au SATURDAY (J-6 → J-0).
	   La journée EN COURS (offset 0) contient des données PARTIELLES :
	   elles ne doivent JAMAIS entrer dans la Vision 360 (journée non
	   terminée) — c'est exactement le piège que la règle exclut. */
	const s0: DayPlan[] = [
		{ offset: at(w0, 0), weight: 60.9, steps: 8800, kcal: 1555, protein: 96 },
		{ offset: at(w0, 1), weight: 60.8, steps: 10900, kcal: 1635, protein: 105, sport: ["Cours collectif", 45, 330] },
		{ offset: at(w0, 2), weight: 60.7, steps: 9600, kcal: 1500, protein: 99 },
		{ offset: at(w0, 3), steps: 12000, kcal: 1670, protein: 110 },
		{ offset: at(w0, 4), weight: 60.6, steps: 9100, kcal: 1590, protein: 100 }, // vendredi = jour du bilan
		{ offset: at(w0, 5), steps: 8300, kcal: 1615, protein: 102 }, // samedi — APRÈS l'envoi du bilan
		{ offset: at(w0, 6), steps: 7700, kcal: 700, protein: 35 }, // dimanche EN COURS — partiel, JAMAIS compté
	];

	return [...s2, ...s1, ...s0];
}

/**
 * MENSURATIONS : 2 relevés complets successifs (J-21 et J-7) — deltas
 * comparables mesure par mesure.
 */
function buildMensurations(todayISO: string): { date: string; waistCm: number; hipCm: number; neckCm: number }[] {
	return [
		{ date: addDaysISO(todayISO, -21), waistCm: 74, hipCm: 99, neckCm: 31.5 },
		{ date: addDaysISO(todayISO, -7), waistCm: 72, hipCm: 98, neckCm: 31 },
	];
}

/** Écriture idempotente des données démo pour la cliente DEMO. */
async function seedDemoData(db: MutationCtx["db"]): Promise<{ ok: true; demoEmail: string; days: number }> {
	assertNotProd();

	const todayISO = localTodayISO();
	const now = Date.now();

	// 1) Rattachée au coach de test du seed principal (créé si absent —
	//    même compte que previewSeed, jamais un vrai compte).
	const coachId = (await db.query("users").withIndex("by_email", (q) => q.eq("email", DEMO_COACH_EMAIL)).unique())?._id;
	if (!coachId) {
		throw new ConvexError(
			"Seed DEMO : le coach de test preview-test-coach@example.com doit exister (lance previewSeed:seedPreviewData d'abord)."
		);
	}

	// 2) Cliente DEMO — idempotent par email (patch du mot de passe documenté).
	const passwordHash = await hashPassword(DEMO_PASSWORD);
	let demoId = (await db.query("users").withIndex("by_email", (q) => q.eq("email", DEMO_EMAIL)).unique())?._id;
	if (!demoId) {
		demoId = await db.insert("users", {
			email: DEMO_EMAIL,
			passwordHash,
			role: "client",
			prenom: "Demo",
			nom: "Vision360",
			createdBy: coachId,
			startDate: addDaysISO(todayISO, -21),
			heightCm: 168,
		});
	} else {
		await db.patch(demoId, { passwordHash });
	}

	// 3) Objectifs : kcal 1 600 (→ seuil 960), protéines 110 g, pas 10 000.
	const existingGoals = await db
		.query("clientGoals")
		.withIndex("by_userId", (q) => q.eq("userId", demoId))
		.first();
	if (!existingGoals) {
		await db.insert("clientGoals", { userId: demoId, kcal: 1600, carbs: 160, protein: 110, fat: 53, stepGoal: 10000 });
	} else {
		await db.patch(existingGoals._id, { kcal: 1600, protein: 110, stepGoal: 10000 });
	}

	// 4) Données journalières — TOUTES les dates portent le préfixe de la
	//    journée : on remplace les données démo de la fenêtre (21 jours) au
	//    lieu d'empiler (idempotent même si le plan évolue entre 2 seeds).
	const plan = buildPlan(todayISO);
	const windowStart = addDaysISO(todayISO, -27);
	const windowEnd = addDaysISO(todayISO, 0);

	// Données démo existantes DANS la fenêtre — nettoyées si elles ne
	// correspondent plus au plan (idempotent même si le plan évolue).
	const oldEntries = (await db.query("diaryEntries").withIndex("by_user", (q) => q.eq("userId", demoId)).collect()).filter(
		(e) => e.date >= windowStart && e.date <= windowEnd && e.source === "demo_seed"
	);
	const oldSteps = (await db.query("dailySteps").withIndex("by_user", (q) => q.eq("userId", demoId)).collect()).filter(
		(s) => s.date >= windowStart && s.date <= windowEnd
	);
	const oldSport = (await db.query("sportActivities").withIndex("by_user", (q) => q.eq("userId", demoId)).collect()).filter(
		(a) => a.date >= windowStart && a.date <= windowEnd && a.source === "manual"
	);

	// Poids / mensurations : upsert par (userId, date) — jamais de doublon.
	const planByDate = new Map(plan.map((d) => [addDaysISO(todayISO, d.offset), d]));
	const foodDates = new Set(plan.filter((d) => d.kcal !== undefined).map((d) => addDaysISO(todayISO, d.offset)));
	const stepDates = new Set(plan.filter((d) => d.steps !== undefined).map((d) => addDaysISO(todayISO, d.offset)));
	const sportDates = new Set(plan.filter((d) => d.sport).map((d) => addDaysISO(todayISO, d.offset)));

	// Nettoyage des lignes démo hors plan (date devenue absente/partielle).
	for (const e of oldEntries) {
		if (!foodDates.has(e.date)) await db.delete(e._id);
	}
	for (const s of oldSteps) {
		if (!stepDates.has(s.date)) await db.delete(s._id);
	}
	for (const a of oldSport) {
		if (!sportDates.has(a.date)) await db.delete(a._id);
	}

	for (const [dateISO, day] of planByDate) {
		// ── Poids ──
		if (day.weight !== undefined) {
			const existing = await db
				.query("bodyMetrics")
				.withIndex("by_user_date", (q) => q.eq("userId", demoId).eq("date", dateISO))
				.first();
			if (existing) await db.patch(existing._id, { weightKg: day.weight });
			else await db.insert("bodyMetrics", { userId: demoId, date: dateISO, weightKg: day.weight, createdAt: now });
		}
		// ── Pas (undefined = aucune donnée — on n'insère RIEN ce jour-là) ──
		if (day.steps !== undefined) {
			const row = oldSteps.find((s) => s.date === dateISO);
			if (row) await db.patch(row._id, { count: day.steps, manualCount: day.steps });
			else await db.insert("dailySteps", { userId: demoId, date: dateISO, count: day.steps, manualCount: day.steps, createdAt: now });
		}
		// ── Journal (2 entrées synthétiques) — undefined = journée absente ──
		if (day.kcal !== undefined) {
			const already = oldEntries.some((e) => e.date === dateISO);
			if (!already) {
				const kcal1 = Math.round(day.kcal * 0.6);
				const kcal2 = day.kcal - kcal1;
				const p1 = Math.round((day.protein ?? 0) * 0.6);
				const p2 = Math.round((day.protein ?? 0) - p1);
				await db.insert("diaryEntries", {
					userId: demoId,
					date: dateISO,
					meal: "dejeuner",
					name: "Repas démo — déjeuner (synthétique)",
					qtyGrams: 300,
					kcal: kcal1,
					carbs: Math.round(kcal1 * 0.45 / 4),
					protein: p1,
					fat: Math.round(kcal1 * 0.3 / 9),
					source: "demo_seed",
					createdAt: now,
				});
				await db.insert("diaryEntries", {
					userId: demoId,
					date: dateISO,
					meal: "diner",
					name: "Repas démo — dîner (synthétique)",
					qtyGrams: 250,
					kcal: kcal2,
					carbs: Math.round(kcal2 * 0.45 / 4),
					protein: p2,
					fat: Math.round(kcal2 * 0.3 / 9),
					source: "demo_seed",
					createdAt: now,
				});
			}
		}
		// ── Sport (manual — dépense simple, jamais liée à une séance) ──
		if (day.sport) {
			const [name, minutes, kcal] = day.sport;
			const exists = oldSport.some((a) => a.date === dateISO && a.activityNameSnapshot === `${name} (démo)`);
			if (!exists) {
				const met = 6;
				await db.insert("sportActivities", {
					userId: demoId,
					date: dateISO,
					activityId: "demo_activity",
					activityNameSnapshot: `${name} (démo)`,
					durationMinutes: minutes,
					metValue: met,
					coefficientSource: "gflux_table",
					coefficientVersion: "1",
					estimatedCalories: kcal,
					metMinutes: met * minutes,
					source: "manual",
					createdAt: now,
					updatedAt: now,
				});
			}
		}
	}

	// ── Mensurations : 2 relevés complets (upsert par date) ──
	for (const m of buildMensurations(todayISO)) {
		const existing = await db
			.query("bodyMetrics")
			.withIndex("by_user_date", (q) => q.eq("userId", demoId).eq("date", m.date))
			.first();
		if (existing) await db.patch(existing._id, { waistCm: m.waistCm, hipCm: m.hipCm, neckCm: m.neckCm });
		else await db.insert("bodyMetrics", { userId: demoId, date: m.date, waistCm: m.waistCm, hipCm: m.hipCm, neckCm: m.neckCm, createdAt: now });
	}

	// ── BILAN : envoyé le VENDREDI de la semaine en cours (figé) ──
	const weekStart = mondayOf(todayISO);
	const weekLabel = `Démo — semaine du ${weekStart}`;
	const existingCheckin = await db
		.query("checkins")
		.withIndex("by_user_week", (q) => q.eq("userId", demoId).eq("weekStart", weekStart))
		.first();
	if (!existingCheckin) {
		await db.insert("checkins", {
			userId: demoId,
			weekStart,
			weekLabel,
			answers: {
				motivation: 4,
				adherence: "oui",
				faim: "non",
				hydratation: "suffisante",
				digestion: "ok",
				pas: "8000-10000",
				evolution: "baisse",
				mensurations: "oui",
				photos: "non",
				besoin_retour: "ecrit",
				categorie_retour: ["alimentation"],
				point_retour: "Bilan démo envoyé le vendredi — les données Vision 360 doivent continuer d'évoluer (samedi/dimanche).",
				victoire: "Semaine complète de tracking (données de démonstration)",
			},
			status: "nouveau",
		});
	}

	return { ok: true, demoEmail: DEMO_EMAIL, days: plan.length };
}

/**
 * Seed DEMO Vision 360 — à exécuter UNIQUEMENT sur un déploiement PREVIEW
 * (dashboard Convex preview, ou via l'endpoint de secours du seed principal).
 * Jamais en production : verrou CONVEX_CLOUD_URL + données @example.com.
 */
export const seedVision360Demo = mutation({
	args: {},
	handler: async (ctx) => {
		return await seedDemoData(ctx.db);
	},
});

/**
 * Variante embarquée dans le seed principal (previewSeed:seedPreviewData) :
 * même verrou, exécutée automatiquement à chaque build preview — les dates
 * du plan sont recalculées relativement à aujourd'hui à chaque fois.
 */
export async function seedVision360DemoData(db: MutationCtx["db"]) {
	return await seedDemoData(db);
}
