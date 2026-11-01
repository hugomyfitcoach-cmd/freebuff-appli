import { mutation, query, type MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { addDaysISO, assertCoachOwnsClient, getSessionUser, localTodayISO } from "./helpers";
import { bodyFatSeries } from "./metrics";
import { DEFAULT_GOALS, baselineLegacyGoalHistory, loadGoalHistory, upsertGoalHistoryToday } from "./journal";
import { CalibrageError, VERSION_FORMULES_CALIBRAGE } from "../lib/calibrage";
import { resultatsFiche, type EntreesFicheCalibrage } from "../lib/calibrageFiche";
import { messageDateEffetFuture } from "../lib/calibrageSaisie";
import { phaseDepuisMode, validerObjectifPhase } from "../lib/phase";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Onglet « Calibrage » du CRM — CÔTÉ COACH UNIQUEMENT (aucune donnée ni
 * écriture côté cliente dans cette mission).
 *
 * - `fiche` (lecture) : pré-remplissage des entrées du calibrage à partir des
 *   données RÉELLES de la cliente — poids (moyenne des pesées sur 7 jours,
 *   sinon dernière pesée), masse grasse (dernière estimation US Navy dérivée
 *   de `metrics.bodyFatSeries`, sinon saisie manuelle), moyenne de pas sur
 *   14 jours, réponse « sport » du formulaire de démarrage (affichée telle
 *   quelle, jamais convertie) et objectifs courants ;
 * - `apply` (écriture) : « Appliquer à la fiche » — passe par LE chemin
 *   existant des objectifs (`clientGoals` + `clientGoalHistory`, mêmes
 *   fonctions d'écriture que `journal.setClientGoals`) pour que le garde-fou
 *   du journal sur les jours passés continue de fonctionner, puis fige un
 *   instantané du calibrage dans `calibrageSnapshots`.
 *
 * Aucun calcul ici : les résultats viennent de `lib/calibrageFiche`, qui
 * n'orchestre que le module pur `lib/calibrage.ts` (source unique des
 * formules). Rien n'est jamais appliqué automatiquement.
 */

/** Repli pré-remplissage : réponse « sport » du formulaire de démarrage. */
type SportOnboarding = {
	sport: string | number | null;
	sportsDetail: string | number | null;
	sportFrequency: string | number | null;
};

function arrondi1(n: number): number {
	return Math.round(n * 10) / 10;
}

function estDateISO(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Une séance du profil sportif habituel — validateur STRICT (jamais v.any()). */
const seanceValidator = v.object({
	activiteId: v.string(),
	seancesParSemaine: v.number(),
	dureeMinutes: v.number(),
	choix: v.string()
});

/**
 * Entrées du calibrage — validateur Convex STRICT : la forme exacte attendue
 * par `resultatsFiche`, rien d'autre n'est accepté (champ inconnu refusé à la
 * frontière). La semaine type (`apportsSemaine`, 7 apports ou null) en fait
 * partie : les résultats recalculés côté serveur l'intègrent toujours.
 */
const entreesValidator = v.object({
	poidsKg: v.number(),
	mgPct: v.number(),
	pasMoyen: v.number(),
	heuresTravail: v.number(),
	ajustementTravail: v.optional(v.number()),
	adaptationPct: v.optional(v.number()),
	deficitPct: v.optional(v.number()),
	/* Phase énergétique (facultative : absent = déficit, instantanés existants
	   toujours valides) et surplus choisi, bornés par le module (0 à 20 %). */
	mode: v.optional(v.union(v.literal("deficit"), v.literal("maintenance"), v.literal("surplus"))),
	surplusPct: v.optional(v.number()),
	proteinesParKgMasseMaigre: v.optional(v.number()),
	seances: v.array(seanceValidator),
	apportsSemaine: v.array(v.union(v.number(), v.null()))
});

/* ── MÉMOIRE DU CALIBRAGE — un seul brouillon par cliente ──

   Le brouillon ne contient QUE des décisions de saisie (entrées + semaine
   type). Il n'écrit jamais clientGoals ni clientGoalHistory : seul
   « Appliquer à la fiche » écrit les objectifs. Upsert par `userId` → jamais
   deux brouillons pour la même cliente. */

/** Les brouillons peuvent être incomplets, mais leur taille reste bornée. */
function validerTailleBrouillon(inputs: EntreesFicheCalibrage): void {
	if (inputs.seances.length > 50) {
		throw new ConvexError("Brouillon invalide : 50 séances maximum.");
	}
	if (inputs.apportsSemaine.length !== 7) {
		throw new ConvexError("Brouillon invalide : 7 apports journaliers attendus.");
	}
	if (inputs.seances.some((s) => s.activiteId.length > 128 || s.choix.length > 128)) {
		throw new ConvexError("Brouillon invalide : identifiant ou choix limité à 128 caractères.");
	}
}

/** Écarts de semaine type : exactement 7 nombres finis (kcal vs objectif). */
function ecartsValides(ecarts: readonly number[]): number[] {
	if (ecarts.length !== 7 || ecarts.some((e) => typeof e !== "number" || !isFinite(e))) {
		throw new ConvexError("Semaine type invalide : 7 écarts attendus (kcal).");
	}
	return ecarts.map((e) => Math.round(e));
}

async function enregistrerBrouillon(
	ctx: Pick<MutationCtx, "db">,
	userId: Id<"users">,
	inputs: EntreesFicheCalibrage,
	ecartsSemaine: number[],
	coachId: Id<"users">,
	updatedAt: number
): Promise<number> {
	validerTailleBrouillon(inputs);
	const rows = await ctx.db
		.query("calibrageDrafts")
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
	const [premier, ...doublons] = rows;
	if (premier) {
		await ctx.db.patch(premier._id, { inputs, ecartsSemaine, updatedBy: coachId, updatedAt });
		/* Invariant « un seul brouillon » : aucun doublon n'est conservé. */
		for (const row of doublons) await ctx.db.delete(row._id);
	} else {
		await ctx.db.insert("calibrageDrafts", { userId, inputs, ecartsSemaine, updatedBy: coachId, updatedAt });
	}
	return updatedAt;
}

export const fiche = query({
	args: {
		sessionToken: v.optional(v.string()),
		/** Cliente visée (obligatoire : la fiche Calibrage vit dans sa fiche CRM). */
		userId: v.id("users"),
	},
	handler: async (ctx, { sessionToken, userId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé au coach (CRM).");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") {
			throw new ConvexError("Cliente introuvable.");
		}
		/* APPARTENANCE : seul le coach DE la cliente lit son calibrage — donc son
		   brouillon (même règle que `apply`, source unique dans helpers). */
		await assertCoachOwnsClient(ctx, target, coach);

		const today = localTodayISO();
		/* 28 jours de pas : la fenêtre courante (14 j) ET la précédente (14 j),
		   affichée en repère « précédent : X » — jamais un zéro inventé. */
		const [metricRows, stepRows, intakeRow, goalsRow, snapshotRows, draftRows] = await Promise.all([
			ctx.db.query("bodyMetrics").withIndex("by_user", (q) => q.eq("userId", userId)).order("asc").collect(),
			ctx.db
				.query("dailySteps")
				.withIndex("by_user_date", (q) => q.eq("userId", userId).gte("date", addDaysISO(today, -27)))
				.collect(),
			ctx.db.query("intakes").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
			ctx.db.query("clientGoals").withIndex("by_userId", (q) => q.eq("userId", userId)).first(),
			ctx.db.query("calibrageSnapshots").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
			ctx.db.query("calibrageDrafts").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
		]);

		/* Poids : moyenne des pesées sur 7 jours, sinon dernière pesée. Une
		   journée sans pesée n'existe pas (jamais comptée comme 0). */
		const poidsRows = metricRows
			.filter((m) => m.weightKg !== undefined)
			.map((m) => ({ date: m.date, weightKg: m.weightKg as number }));
		const recent = poidsRows.filter((p) => p.date >= addDaysISO(today, -6));
		const derniere = poidsRows.length > 0 ? poidsRows[poidsRows.length - 1] : null;
		/* « précédent » : moyenne de la fenêtre de 7 jours PRÉCÉDENTE (J-13 → J-7),
		   sinon dernière pesée antérieure à la fenêtre courante. */
		const precedenteFenetre = poidsRows.filter(
			(p) => p.date >= addDaysISO(today, -13) && p.date <= addDaysISO(today, -7)
		);
		const precedenteIsolee = poidsRows.filter((p) => p.date < addDaysISO(today, -6));
		const precedentPoids =
			precedenteFenetre.length > 0
				? arrondi1(precedenteFenetre.reduce((s, p) => s + p.weightKg, 0) / precedenteFenetre.length)
				: precedenteIsolee.length > 0
					? arrondi1(precedenteIsolee[precedenteIsolee.length - 1].weightKg)
					: null;
		const poids =
			recent.length > 0
				? {
						valeur: arrondi1(recent.reduce((s, p) => s + p.weightKg, 0) / recent.length),
						source: "moyenne7j" as const,
						nbPesees: recent.length,
						date: derniere?.date ?? null,
						precedent: precedentPoids,
					}
				: derniere
					? {
							valeur: arrondi1(derniere.weightKg),
							source: "derniere" as const,
							nbPesees: 0,
							date: derniere.date,
							precedent: precedentPoids,
						}
					: { valeur: null, source: null, nbPesees: 0, date: null, precedent: precedentPoids };

		/* Masse grasse : dernier point de la série US Navy DÉRIVÉE (même source
		   de vérité que « Ma progression » et la Vision 360), sinon saisie. */
		const bodyFat = bodyFatSeries(metricRows, target.heightCm ?? null);
		const derniereMg = bodyFat.length > 0 ? bodyFat[bodyFat.length - 1] : null;

		/* Moyenne de pas sur 14 jours — jours RENSEIGNÉS uniquement. « précédent »
		   = même moyenne sur les 14 jours d'avant (J-27 → J-14), si renseignée. */
		const pasRecents = stepRows.filter((r) => r.date >= addDaysISO(today, -13));
		const pasPrecedents = stepRows.filter((r) => r.date < addDaysISO(today, -13));
		const pasMoyen =
			pasRecents.length > 0
				? {
						valeur: arrondi1(pasRecents.reduce((s, r) => s + r.count, 0) / pasRecents.length),
						jours: pasRecents.length,
						precedent:
							pasPrecedents.length > 0
								? arrondi1(pasPrecedents.reduce((s, r) => s + r.count, 0) / pasPrecedents.length)
								: null,
					}
				: { valeur: null, jours: 0, precedent: null };

		/* Réponse « sport » du formulaire de démarrage — affichée en AIDE, telle
		   quelle (jamais convertie en profil sportif). */
		const answers = intakeRow?.answers ?? {};
		const sportOnboarding: SportOnboarding = {
			sport: answers.sport ?? null,
			sportsDetail: answers.sportsDetail ?? null,
			sportFrequency: answers.sportFrequency ?? null,
		};

		/* « précédent » MG : avant-dernière estimation US Navy (la dernière reste
		   la valeur proposée). */
		const mgPrecedente = bodyFat.length > 1 ? bodyFat[bodyFat.length - 2] : null;

		/* Instantanés : tri par création, le plus récent fait foi (repli de
		   restauration quand aucun brouillon n'existe). */
		const snapsTries = [...snapshotRows].sort((a, b) => a.createdAt - b.createdAt);
		const dernier = snapsTries.length > 0 ? snapsTries[snapsTries.length - 1] : null;
		const brouillon = draftRows.length > 0
			? [...draftRows].sort((a, b) => b.updatedAt - a.updatedAt)[0]
			: null;

		return {
			today,
			poids,
			masseGrasse: derniereMg
				? {
						valeur: derniereMg.value,
						source: "usNavy" as const,
						date: derniereMg.date,
						precedent: mgPrecedente ? mgPrecedente.value : null,
					}
				: { valeur: null, source: null, date: null, precedent: mgPrecedente ? mgPrecedente.value : null },
			pasMoyen,
			sportOnboarding,
			goals: goalsRow
				? {
						kcal: goalsRow.kcal,
						carbs: goalsRow.carbs,
						protein: goalsRow.protein,
						fat: goalsRow.fat,
						maintenanceKcal: goalsRow.maintenanceKcal ?? null,
						stepGoal: goalsRow.stepGoal ?? null,
						goalsSet: true,
					}
				: { ...DEFAULT_GOALS, maintenanceKcal: null, stepGoal: null, goalsSet: false },
			dernierCalibrage: dernier
				? { date: dernier.date, effectiveFrom: dernier.effectiveFrom, createdAt: dernier.createdAt }
				: null,
			/* MÉMOIRE : décisions en cours de saisie (brouillon) et dernier
			   calibrage appliqué (repli). La page restaure, dans cet ordre,
			   brouillon → dernier instantané → valeurs par défaut. */
			brouillon: brouillon
				? {
						entrees: brouillon.inputs,
						ecartsSemaine: brouillon.ecartsSemaine,
						updatedAt: brouillon.updatedAt,
					}
				: null,
			dernierInstantane: dernier
				? {
						date: dernier.date,
						effectiveFrom: dernier.effectiveFrom,
						createdAt: dernier.createdAt,
						entrees: dernier.inputs,
						objectifJournalierKcal: nombre(dernier.results?.objectifJournalierKcal),
					}
				: null,
		};
	},
});

export const apply = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		/** Entrées du calibrage figées dans l'instantané (recopiées telles quelles). */
		entrees: entreesValidator,
		/** Objectif appliqué (le coach peut l'ajuster avant d'appliquer). */
		kcal: v.number(),
		carbs: v.number(),
		protein: v.number(),
		fat: v.number(),
		/** Maintenance appliquée (filet de sécurité) — optionnelle. */
		maintenanceKcal: v.optional(v.number()),
		/** Date d'effet "yyyy-mm-dd" choisie par le coach. */
		effectiveFrom: v.string(),
	},
	handler: async (ctx, { sessionToken, userId, entrees, kcal, carbs, protein, fat, maintenanceKcal, effectiveFrom }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Seul le coach peut appliquer un calibrage.");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") {
			throw new ConvexError("Ce compte client n'existe pas.");
		}
		// APPARTENANCE — seul le coach DE la cliente applique un calibrage
		// (même règle que `coach.updateClient`, source unique dans helpers).
		await assertCoachOwnsClient(ctx, target, coach);
		if (
			!isFinite(kcal) || kcal < 800 || kcal > 6000 ||
			!isFinite(carbs) || carbs < 0 || carbs > 1000 ||
			!isFinite(protein) || protein < 0 || protein > 400 ||
			!isFinite(fat) || fat < 0 || fat > 300
		) {
			throw new ConvexError("Objectifs hors plage. Vérifie les valeurs (kcal 800-6000, macros en grammes).");
		}
		if (
			maintenanceKcal !== undefined &&
			maintenanceKcal !== null &&
			(!isFinite(maintenanceKcal) || maintenanceKcal > 10000)
		) {
			throw new ConvexError("Maintenance invalide : elle doit rester ≤ 10 000 kcal.");
		}
		/* Cohérence objectif / maintenance selon la PHASE : en surplus l'objectif
	   dépasse légitimement la maintenance (jusqu'à +20 %), en maintenance il
	   reste à ±5 %, en perte de gras il lui est inférieur. MÊME règle que
	   `journal.setClientGoals` et le formulaire coach ($lib/phase). */
		const phase = phaseDepuisMode(entrees.mode);
		const messagePhase = validerObjectifPhase(phase, kcal, maintenanceKcal);
		if (messagePhase) {
			throw new ConvexError(messagePhase);
		}
		if (!estDateISO(effectiveFrom)) {
			throw new ConvexError("Date d'effet invalide : format « jj/mm/aaaa » attendu (yyyy-mm-dd).");
		}
		/* Date d'effet : JAMAIS dans le futur (maximum = aujourd'hui, fuseau
		   Europe/Paris). Refus serveur clair — aucune tâche programmée : un
		   calibrage s'applique au plus tard aujourd'hui. */
		const messageDate = messageDateEffetFuture(effectiveFrom, localTodayISO());
		if (messageDate) {
			throw new ConvexError(messageDate);
		}

		/* Instantané : les RÉSULTATS sont TOUJOURS recalculés côté serveur par
		   le module (la seule source des formules) à partir des entrées validées,
		   semaine type personnalisée (`apportsSemaine`) comprise — le navigateur
		   n'envoie et ne fournit JAMAIS de résultats. */
		let resultats;
		try {
			resultats = resultatsFiche(entrees);
		} catch (e) {
			throw new ConvexError(
				e instanceof CalibrageError || e instanceof Error ? e.message : "Calibrage invalide."
			);
		}

		const existing = await ctx.db
			.query("clientGoals")
			.withIndex("by_userId", (q) => q.eq("userId", userId))
			.first();

		/* ÉCRITURE PAR LE CHEMIN EXISTANT des objectifs : même historisation
		   datée et même baseline legacy que `journal.setClientGoals` — le
		   garde-fou du journal sur les jours passées continue de fonctionner. */
		await upsertGoalHistoryToday(ctx, userId, kcal, coach._id, effectiveFrom);
		if (existing && existing.kcal !== kcal) {
			await baselineLegacyGoalHistory(ctx, userId, existing, coach._id);
		}

		if (existing) {
			const p: Partial<Doc<"clientGoals">> = { kcal, carbs, protein, fat, phase };
			if (maintenanceKcal !== undefined && maintenanceKcal !== null) p.maintenanceKcal = maintenanceKcal;
			await ctx.db.patch(existing._id, p);
		} else {
			const opt: { maintenanceKcal?: number } = {};
			if (maintenanceKcal !== undefined && maintenanceKcal !== null) opt.maintenanceKcal = maintenanceKcal;
			await ctx.db.insert("clientGoals", { userId, kcal, carbs, protein, fat, phase, ...opt });
		}

		/* Instantané du calibrage : entrées, résultats, version des formules,
		   date, auteur — ajout rétrocompatible (table dédiée). */
		await ctx.db.insert("calibrageSnapshots", {
			userId,
			inputs: entrees,
			results: {
				...resultats,
				applique: { kcal, carbs, protein, fat, maintenanceKcal: maintenanceKcal ?? null, phase, effectiveFrom },
			},
			formulaVersion: VERSION_FORMULES_CALIBRAGE,
			effectiveFrom,
			date: localTodayISO(),
			createdBy: coach._id,
			createdAt: Date.now(),
		});

		/* BROUILLON RÉALIGNÉ : la mémoire de saisie repart exactement de ce qui
		   vient d'être appliqué — une réouverture ne rejoue pas d'anciennes
		   décisions. Écrit APRÈS l'instantané : aucun impact sur les objectifs. */
		const objectif = resultats.objectifJournalierKcal;
		const ecartsAppliques = ecartsValides(
			(entrees.apportsSemaine ?? []).map((apport) =>
				typeof apport === "number" ? apport - objectif : 0
			)
		);
		const brouillonSavedAt = await enregistrerBrouillon(
			ctx,
			userId,
			entrees,
			ecartsAppliques,
			coach._id,
			Date.now()
		);

		return { ok: true, effectiveFrom, brouillonSavedAt };
	},
});

/* ── SAUVEGARDE AUTOMATIQUE DU BROUILLON (mémoire du calibrage) ──
   Réservée au coach PROPRIÉTAIRE de la cliente (assertCoachOwnsClient).
   N'écrit QUE `calibrageDrafts` : aucun objectif, aucun historique, aucun
   instantané — « Appliquer à la fiche » reste la SEULE écriture des objectifs. */

export const saveDraft = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
		entrees: entreesValidator,
		ecartsSemaine: v.array(v.number()),
	},
	handler: async (ctx, { sessionToken, userId, entrees, ecartsSemaine }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé au coach (CRM).");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") {
			throw new ConvexError("Cliente introuvable.");
		}
		await assertCoachOwnsClient(ctx, target, coach);
		const savedAt = await enregistrerBrouillon(
			ctx,
			userId,
			entrees,
			ecartsValides(ecartsSemaine),
			coach._id,
			Date.now()
		);
		return { ok: true, savedAt };
	},
});

/** « Repartir des valeurs par défaut » : efface le brouillon de la cliente. */
export const clearDraft = mutation({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
	},
	handler: async (ctx, { sessionToken, userId }) => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé au coach (CRM).");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") {
			throw new ConvexError("Cliente introuvable.");
		}
		await assertCoachOwnsClient(ctx, target, coach);
		const rows = await ctx.db
			.query("calibrageDrafts")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
		return { ok: true, cleared: rows.length };
	},
});

/* ── HISTORIQUE DES OBJECTIFS (lecture seule) ──
   Liste des changements d'objectifs, du plus récent au plus ancien, fondée
   sur les DEUX sources existantes : l'historique daté `clientGoalHistory`
   (une ligne par changement) et les instantanés `calibrageSnapshots` (origine
   « Calibrage » + détail figé). Réutilise `loadGoalHistory` (journal) et la
   même lecture `calibrageSnapshots.by_user` que `fiche`. AUCUNE écriture ici. */

export type DetailInstantaneCalibrage = {
	poidsKg: number | null;
	mgPct: number | null;
	pasMoyen: number | null;
	heuresTravail: number | null;
	ajustementTravail: number | null;
	adaptationPct: number | null;
	deficitPct: number | null;
	/** Phase du calibrage — null pour un instantané antérieur (lu « déficit »). */
	mode: string | null;
	surplusPct: number | null;
	sportSemaineKcal: number | null;
	coefficient: number | null;
	metabolismeBaseKcal: number | null;
	maintenanceKcal: number | null;
	maintenanceFiletKcal: number | null;
	objectifJournalierKcal: number | null;
	budgetSemaineKcal: number | null;
	deficitSemaineKcal: number | null;
	perteGraisseKg: number | null;
};

export type LigneHistoriqueObjectifs = {
	id: string;
	/** Date d'effet "yyyy-mm-dd". */
	effectiveFrom: string;
	createdAt: number;
	/** Objectif calorique appliqué (kcal/jour). */
	kcal: number;
	/** Maintenance appliquée — null si non historisée (saisie manuelle). */
	maintenanceKcal: number | null;
	/** Macros du jour type en grammes — null si non historisées (saisie manuelle). */
	macros: { glucidesG: number; proteinesG: number; lipidesG: number } | null;
	origine: "calibrage" | "manuelle";
	/** Détail de l'instantané — lignes « Calibrage » uniquement. */
	detail: DetailInstantaneCalibrage | null;
};

function nombre(value: unknown): number | null {
	return typeof value === "number" && isFinite(value) ? value : null;
}

function detailInstantane(snap: Doc<"calibrageSnapshots">): DetailInstantaneCalibrage {
	const i = snap.inputs ?? {};
	const r = snap.results ?? {};
	return {
		poidsKg: nombre(i.poidsKg),
		mgPct: nombre(i.mgPct),
		pasMoyen: nombre(i.pasMoyen),
		heuresTravail: nombre(i.heuresTravail),
		ajustementTravail: nombre(i.ajustementTravail),
		adaptationPct: nombre(i.adaptationPct),
		deficitPct: nombre(i.deficitPct),
		mode: typeof i.mode === "string" ? i.mode : null,
		surplusPct: nombre(i.surplusPct),
		sportSemaineKcal: nombre(r.sportSemaineKcal),
		coefficient: nombre(r.coefficient),
		metabolismeBaseKcal: nombre(r.metabolismeBaseKcal),
		maintenanceKcal: nombre(r.maintenanceKcal),
		maintenanceFiletKcal: nombre(r.maintenanceFiletKcal),
		objectifJournalierKcal: nombre(r.objectifJournalierKcal),
		budgetSemaineKcal: nombre(r.budgetSemaineKcal),
		deficitSemaineKcal: nombre(r.deficitSemaineKcal),
		perteGraisseKg: nombre(r.perteGraisseKg),
	};
}

export const historique = query({
	args: {
		sessionToken: v.optional(v.string()),
		userId: v.id("users"),
	},
	handler: async (ctx, { sessionToken, userId }): Promise<LigneHistoriqueObjectifs[]> => {
		const coach = await getSessionUser(ctx, sessionToken);
		if (!coach || coach.role !== "coach") {
			throw new ConvexError("Réservé au coach (CRM).");
		}
		const target = await ctx.db.get(userId);
		if (!target || target.role !== "client") {
			throw new ConvexError("Cliente introuvable.");
		}
		/* Seul le coach DE la cliente accède à son historique — autorisation
		   vérifiée côté serveur, comme les autres requêtes du coach. */
		if (target.createdBy && target.createdBy !== coach._id) {
			throw new ConvexError("Accès réservé au coach de cette cliente.");
		}

		const [historyRows, snapshotRows] = await Promise.all([
			loadGoalHistory(ctx, userId),
			ctx.db.query("calibrageSnapshots").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
		]);

		/* Instantané par (date d'effet, objectif appliqué) — la DERNIÈRE
		   application d'une même date fait foi (règle « la dernière gagne » de
		   l'historique daté). */
		const snapByKey = new Map<string, Doc<"calibrageSnapshots">>();
		const snapsTries = [...snapshotRows].sort((a, b) => a.createdAt - b.createdAt);
		for (const s of snapsTries) {
			const appl = (s.results?.applique ?? {}) as Record<string, unknown>;
			snapByKey.set(`${s.effectiveFrom}|${nombre(appl.kcal)}`, s);
		}

		const lignes: LigneHistoriqueObjectifs[] = [];
		const snapsUtilises = new Set<string>();
		for (const h of historyRows) {
			const snap = snapByKey.get(`${h.effectiveFrom}|${h.kcal}`) ?? null;
			if (snap) snapsUtilises.add(String(snap._id));
			const appl = snap ? ((snap.results?.applique ?? {}) as Record<string, unknown>) : {};
			lignes.push({
				id: String(h._id),
				effectiveFrom: h.effectiveFrom,
				createdAt: h.createdAt,
				kcal: h.kcal,
				maintenanceKcal: snap ? nombre(appl.maintenanceKcal) : null,
				macros: snap
					? {
							glucidesG: nombre(appl.carbs) ?? 0,
							proteinesG: nombre(appl.protein) ?? 0,
							lipidesG: nombre(appl.fat) ?? 0,
						}
					: null,
				origine: snap ? "calibrage" : "manuelle",
				detail: snap ? detailInstantane(snap) : null,
			});
		}
		/* Instantanés sans ligne d'historique appariée (réapplication le même
		   jour, ligne remplacée par une saisie manuelle) : tracés en lignes
		   « Calibrage » — aucun changement d'objectif n'est perdu. */
		for (const s of snapsTries) {
			if (snapsUtilises.has(String(s._id))) continue;
			const appl = (s.results?.applique ?? {}) as Record<string, unknown>;
			lignes.push({
				id: String(s._id),
				effectiveFrom: s.effectiveFrom,
				createdAt: s.createdAt,
				kcal: nombre(appl.kcal) ?? 0,
				maintenanceKcal: nombre(appl.maintenanceKcal),
				macros: {
					glucidesG: nombre(appl.carbs) ?? 0,
					proteinesG: nombre(appl.protein) ?? 0,
					lipidesG: nombre(appl.fat) ?? 0,
				},
				origine: "calibrage",
				detail: detailInstantane(s),
			});
		}

		lignes.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt - a.createdAt);
		return lignes;
	},
});

export type { EntreesFicheCalibrage };
