import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getSessionUser, hashToken } from "./helpers";

/**
 * FACTURATION G-FLUX AUTONOMIE — V1 (Stripe).
 *
 * PRINCIPE FONDAMENTAL : l'accès est DÉRIVÉ, jamais stocké.
 * Aucun champ "appAccess" qui dupliquerait l'état réel : on calcule
 * `canAccessApp` à partir de :
 *   1. le mode d'accompagnement (coaching = inclus, Stripe ignoré) ;
 *   2. l'accès offert par le coach (billingAccessOverride) ;
 *   3. l'abonnement Stripe (statuts RÉELS de l'API Stripe) ;
 *   4. la grâce de 24 heures après un échec de paiement (uniquement un
 *      abonnement qui était actif et dont le RENOUVELLEMENT échoue — jamais
 *      une cliente passée de coaching à autonomie sans abonnement).
 *
 * Toute la logique de décision est PURE et testée unitairement
 * (tests/mission-billing-autonomie.test.mjs) : mêmes entrées → même décision,
 * aucun effet de bord, aucune horloge cachée (now est toujours un argument).
 */

/** Prix mensuel Autonomie (affichage paywall/paramètres — source : brief mission). */
export const AUTONOMY_MONTHLY_PRICE_EUR = 15.9;
/** Prix annuel Autonomie (affichage paywall/paramètres). */
export const AUTONOMY_YEARLY_PRICE_EUR = 129;
/**
 * Durée de grâce après un échec de paiement — DÉCISION PRODUIT : 24 HEURES
 * exactes (renouvellement d'un abonnement actif qui échoue). Un webhook
 * duplicate ne repousse JAMAIS cette échéance (plafonnement en base).
 */
export const GRACE_PERIOD_MS = 24 * 3600 * 1000;

/** Statuts d'abonnement RÉELS de l'API Stripe (jamais d'enum local incomplet). */
export const stripeSubscriptionStatusKind = v.union(
	v.literal("active"),
	v.literal("trialing"),
	v.literal("past_due"),
	v.literal("canceled"),
	v.literal("unpaid"),
	v.literal("incomplete"),
	v.literal("incomplete_expired"),
	v.literal("paused")
);

/** Accès offert par le coach — liste fermée, extensible (ex. futur "gift"). */
export const billingAccessOverrideKind = v.literal("complimentary");

/** Décision d'accès — les trois seuls états possibles, calculés serveur. */
export type AccessDecision = "allow" | "allow_with_payment_warning" | "block";

/**
 * Données minimales nécessaires au calcul — un sous-ensemble de la ligne
 * `users` (n'exige JAMAIS un document complet : testable avec un objet littéral).
 * Tous les champs sont optionnels : les clientes d'avant la facturation
 * (aucun champ Stripe) restent en "coaching" par défaut → accès inclus.
 */
export type BillingState = {
	/** "coaching" (ou champ absent) = accès inclus, Stripe ignoré. */
	coachingMode?: "coaching" | "autonomy";
	/** Accès offert par le coach. */
	billingAccessOverride?: "complimentary";
	stripeCustomerId?: string;
	stripeSubscriptionId?: string;
	stripeSubscriptionStatus?: string;
	/** Price souscrit — utile au BFF pour mapper monthly/yearly. */
	stripePriceId?: string;
	/** Fin de période payée (ms UTC) — maintient l'accès après cancellation programmée. */
	stripeCurrentPeriodEnd?: number;
	/** Stripe mettra fin à l'abonnement à la fin de la période. */
	stripeCancelAtPeriodEnd?: boolean;
	/** Fin de la grâce après échec de paiement (ms UTC) — vide = pas de grâce. */
	stripeGraceUntil?: number;
};

/** Règle 1 absolue : une cliente en coaching a TOUJOURS accès (§13 mission). */
export function isCoaching(state: BillingState): boolean {
	return (state.coachingMode ?? "coaching") === "coaching";
}

/**
 * canAccessApp — LA fonction centrale (§3 mission).
 *
 * Ordre de décision :
 *   1. coachingMode "coaching"        → ALLOW (même avec un Stripe cassé derrière)
 *   2. billingAccessOverride          → ALLOW (accès offert)
 *   3. abonnement "active"/"trialing" → ALLOW
 *      (cancel_at_period_end reste géré : tant que Stripe dit active et que la
 *      période payée n'est pas finie, l'accès continue — §9 mission)
 *   4. "past_due" + grâce non expirée → ALLOW_WITH_PAYMENT_WARNING
 *   5. sinon                          → BLOCK
 *
 * `now` est TOUJOURS passé par l'appelant (horloge injectée = testable,
 * pas d'appel Date.now() caché dans la décision).
 */
export function canAccessApp(state: BillingState, now: number): AccessDecision {
	// 1. COACHING → accès inclus, indépendamment de Stripe.
	if (isCoaching(state)) return "allow";

	// 2. Accès offert par le coach.
	if (state.billingAccessOverride === "complimentary") return "allow";

	// 3. Abonnement actif ou en essai. Un statut inconnu de Stripe ne bloque
	//    pas plus que ça ne permet : il tombe dans les règles suivantes.
	if (state.stripeSubscriptionStatus === "active") return "allow";
	if (state.stripeSubscriptionStatus === "trialing") return "allow";

	// Sécurité "résiliation programmée" : Stripe garde souvent `active` jusqu'à
	// la fin ; certains flux renvoient `canceled` avec une période payée en
	// cours. Tant que la fin de période payée est dans le futur, l'accès reste.
	const periodEnd = state.stripeCurrentPeriodEnd;
	if (
		typeof periodEnd === "number" &&
		now < periodEnd &&
		(state.stripeSubscriptionStatus === "active" ||
			state.stripeSubscriptionStatus === "trialing" ||
			state.stripeSubscriptionStatus === "canceled" ||
			state.stripeSubscriptionStatus === "past_due" ||
			state.stripeSubscriptionStatus === "unpaid")
	) {
		// past_due/unpaid restent dans la période payée ET couverts par la grâce
		// (règle 4) — ici on ne court-circuite que les cas franchement payés.
		if (state.stripeSubscriptionStatus === "active" || state.stripeSubscriptionStatus === "trialing" || state.stripeSubscriptionStatus === "canceled") {
			return "allow";
		}
	}

	// 4. Échec de paiement (renouvellement) + grâce de 24 h non expirée → alerte.
	if (state.stripeSubscriptionStatus === "past_due") {
		if (typeof state.stripeGraceUntil === "number" && now < state.stripeGraceUntil) {
			return "allow_with_payment_warning";
		}
		// past_due sans grâce (rattrapage d'état) → bloqué : le webhook
		// invoice.payment_failed pose toujours la grâce, ce cas ne devrait
		// exister que si la ligne a été écrite par un chemin ancien.
		return "block";
	}

	// 5. Tout le reste (canceled expiré, unpaid, incomplete*, paused, vide) → BLOCK.
	return "block";
}

/** Garde-fou webhook : ne JAMAIS faire repousser une grâce existante (§11). */
export function nextGraceUntil(current: number | undefined, failedAtMs: number): number {
	const fresh = failedAtMs + GRACE_PERIOD_MS;
	if (typeof current === "number" && current > 0) {
		return Math.max(current, fresh);
	}
	return fresh;
}

/** Le webhook doit-il écrire ? (aucun intérêt à écrire un état identique.) */
export function patchMeaningfullyDiffers(
	current: { [key: string]: unknown } | null | undefined,
	patch: Record<string, unknown>
): boolean {
	if (!current) return true;
	for (const [k, v] of Object.entries(patch)) {
		if (current[k] !== v) return true;
	}
	return false;
}

/**
 * Mapping d'une Subscription Stripe → patch users (persistance dérivée).
 * Champ optionnel = on efface (undefined) quand Stripe n'en a plus.
 * Aucune réactivation silencieuse : l'appelant relit l'état Stripe AVANT
 * d'écrire (source de vérité = l'API, jamais l'historique d'événements).
 */
export function subscriptionPatchFromStripe(sub: {
	status?: string | null;
	current_period_end?: number | null;
	cancel_at_period_end?: boolean | null;
	items?: { data?: Array<{ price?: { id?: string | null } | null }> | null };
}): {
	stripeSubscriptionStatus: string;
	stripeCurrentPeriodEnd?: number;
	stripeCancelAtPeriodEnd?: boolean;
	stripePriceId?: string;
} {
	const priceId = sub.items?.data?.[0]?.price?.id ?? undefined;
	const patch: {
		stripeSubscriptionStatus: string;
		stripeCurrentPeriodEnd?: number;
		stripeCancelAtPeriodEnd?: boolean;
		stripePriceId?: string;
	} = {
		stripeSubscriptionStatus: String(sub.status ?? "canceled"),
	};
	if (typeof sub.current_period_end === "number" && sub.current_period_end > 0) {
		patch.stripeCurrentPeriodEnd = sub.current_period_end * 1000;
	} else {
		patch.stripeCurrentPeriodEnd = undefined;
	}
	patch.stripeCancelAtPeriodEnd = sub.cancel_at_period_end === true;
	if (priceId) patch.stripePriceId = priceId;
	return patch;
}

/** Un client (coaching ou autonomie) — le coach lui-même n'est jamais facturé. */
export function isBillableUser(user: Pick<Doc<"users">, "role">): boolean {
	return user.role === "client";
}

/* ═══════════════ Fonctions Convex (accès + synchro Stripe) ═══════════════ */

/** État d'accès SÉRIALISABLE renvoyé au BFF SvelteKit (garde + affichage). */
export type AccessState = {
	decision: AccessDecision;
	coachingMode: "coaching" | "autonomy";
	billingAccessOverride: "complimentary" | null;
	subscription: {
		status: string | null;
		cancelAtPeriodEnd: boolean;
		/** Fin de période payée (ms UTC) — « prendra fin le … » / prochaine échéance. */
		currentPeriodEnd: number | null;
		/** Fin de grâce (ms UTC) — non null ⇒ bannière « paiement à régulariser ». */
		graceUntil: number | null;
		/** Price Stripe souscrit — le BFF le mappe en monthly/yearly via ses env. */
		priceId: string | null;
	} | null;
};

/** État d'accès de la cliente connectée — LA source de vérité du guard serveur. */
export const accessState = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }): Promise<AccessState | null> => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user) return null;
		return accessStateForUser(user, Date.now());
	},
});

/** Calcule l'état d'accès d'une ligne users — partagé par la query et le CRM coach. */
export function accessStateForUser(user: BillingState, now: number): AccessState {
	const override: "complimentary" | null = user.billingAccessOverride ?? null;
	const hasStripe =
		typeof user.stripeSubscriptionStatus === "string" || typeof user.stripeSubscriptionId === "string";
	return {
		decision: canAccessApp({ ...user, billingAccessOverride: override ?? undefined }, now),
		coachingMode: (user.coachingMode ?? "coaching") as "coaching" | "autonomy",
		billingAccessOverride: override,
		subscription: hasStripe
			? {
					status: user.stripeSubscriptionStatus ?? null,
					cancelAtPeriodEnd: user.stripeCancelAtPeriodEnd === true,
					currentPeriodEnd: user.stripeCurrentPeriodEnd ?? null,
					graceUntil: user.stripeGraceUntil ?? null,
					priceId: user.stripePriceId ?? null,
				}
			: null,
	};
}

/**
 * Les fonctions ci-dessous sont appelées par le BFF SvelteKit. Le Convex
 * deployé n'a qu'une seule passerelle HTTP "public" — les fonctions webhook
 * sont donc PUBLIques mais protégées par un secret partagé Convex/BFF
 * (CONVEX_BILLING_WEBHOOK_SECRET, posé via `npx convex env set`), exactement
 * comme le bootstrap coach (COACH_BOOTSTRAP_CODE). Sans le secret : null/false
 * /refus — aucune donnée ne traverse. L'appelant réel reste le webhook Stripe
 * signé ; ce secret protège la couche Convex contre tout autre appelant.
 */
const WEBHOOK_SECRET_ENV = "CONVEX_BILLING_WEBHOOK_SECRET";

function webhookSecretMatches(expected: string): boolean {
	const configured = process.env[WEBHOOK_SECRET_ENV];
	return typeof configured === "string" && configured.length > 0 && configured === expected;
}

/** Customer Stripe de la cliente connectée (Checkout/Portal — lu en base). */
export const myStripeCustomerId = query({
	args: { sessionToken: v.optional(v.string()) },
	handler: async (ctx, { sessionToken }) => {
		const user = await getSessionUser(ctx, sessionToken);
		if (!user || user.role !== "client") return null;
		return user.stripeCustomerId ?? null;
	},
});

/** WEBHOOK — le userId des metadata Checkout existe-t-il encore ? */
export const webhookUserExists = query({
	args: { webhookSecret: v.string(), userId: v.id("users") },
	handler: async (ctx, { webhookSecret, userId }) => {
		if (!webhookSecretMatches(webhookSecret)) return false;
		return !!(await ctx.db.get(userId));
	},
});

/** WEBHOOK — userId d'après un subscription id Stripe (invoices : pas de metadata). */
export const userByStripeSubscription = query({
	args: { webhookSecret: v.string(), stripeSubscriptionId: v.string() },
	handler: async (ctx, { webhookSecret, stripeSubscriptionId }) => {
		if (!webhookSecretMatches(webhookSecret)) return null;
		const row = await ctx.db
			.query("users")
			.filter((q) => q.eq(q.field("stripeSubscriptionId"), stripeSubscriptionId))
			.first();
		return row?.role === "client" ? row._id : null;
	},
});

/** WEBHOOK — userId d'après un Customer id Stripe (index by_stripeCustomer). */
export const userByStripeCustomer = query({
	args: { webhookSecret: v.string(), stripeCustomerId: v.string() },
	handler: async (ctx, { webhookSecret, stripeCustomerId }) => {
		if (!webhookSecretMatches(webhookSecret)) return null;
		const rows = await ctx.db
			.query("users")
			.withIndex("by_stripeCustomer", (q) => q.eq("stripeCustomerId", stripeCustomerId))
			.collect();
		return rows.find((u) => u.role === "client")?._id ?? null;
	},
});

/**
 * SYNCHRO WEBHOOK — état final idempotent (§10 mission), mutation protégée
 * par CONVEX_BILLING_WEBHOOK_SECRET.
 *
 * L'appelant (BFF) relit TOUJOURS l'abonnement réel chez Stripe AVANT d'appeler
 * cette mutation : l'état écrit est celui de l'API au moment du traitement,
 * jamais celui (potentiellement périmé) de l'événement. Réécrire le même état
 * est un no-op (patchMeaningfullyDiffers) ⇒ double livraison inoffensive.
 * Un ancien événement reçu en retard ne peut PAS réactiver un abonnement :
 * il réécrit simplement l'état réel actuel lu chez Stripe.
 * `graceUntilMs: null` efface la grâce (invoice.paid) ; un nombre la pose ;
 * `undefined` laisse le champ inchangé (événements sans impact grâce).
 */
export const syncFromStripe = mutation({
	args: {
		webhookSecret: v.string(),
		userId: v.id("users"),
		eventType: v.string(),
		stripeCustomerId: v.optional(v.string()),
		subscription: v.object({
			id: v.union(v.string(), v.null()),
			status: stripeSubscriptionStatusKind,
			currentPeriodEndMs: v.union(v.number(), v.null()),
			cancelAtPeriodEnd: v.boolean(),
			priceId: v.union(v.string(), v.null()),
		}),
		graceUntilMs: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, { webhookSecret, userId, eventType, stripeCustomerId, subscription, graceUntilMs }) => {
		if (!webhookSecretMatches(webhookSecret)) return { ok: false, reason: "forbidden" };
		const user = await ctx.db.get(userId);
		if (!user) return { ok: false, reason: "user_gone" };

		const patch: Record<string, unknown> = {
			stripeSubscriptionStatus: subscription.status,
			stripeSubscriptionId: subscription.id ?? undefined,
			stripeCurrentPeriodEnd: subscription.currentPeriodEndMs ?? undefined,
			stripeCancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
			stripePriceId: subscription.priceId ?? undefined,
		};
		// Grâce : posée (échec) ou effacée (paiement OK) — JAMAIS prolongée :
		// la nouvelle échéance ne remplace l'existante que si elle est POSTÉRIEURE
		// (même sémantique que nextGraceUntil, appliquée ici sur l'état réel de la
		// base ⇒ un invoice.payment_failed reçu en double ne repousse rien).
		if (graceUntilMs === null) {
			patch.stripeGraceUntil = undefined;
		} else if (typeof graceUntilMs === "number") {
			const existing = user.stripeGraceUntil;
			patch.stripeGraceUntil = typeof existing === "number" && existing > graceUntilMs ? existing : graceUntilMs;
		} else {
			delete patch.stripeGraceUntil; // undefined : champ inchangé
		}
		// Le Customer est persisté dès qu'on le connaît (Checkout/Portal/webhook).
		if (stripeCustomerId && user.stripeCustomerId !== stripeCustomerId) {
			patch.stripeCustomerId = stripeCustomerId;
		}

		if (!patchMeaningfullyDiffers(user as unknown as Record<string, unknown>, patch)) {
			return { ok: true, skipped: true, eventType };
		}
		await ctx.db.patch(userId, patch);
		return { ok: true, skipped: false, eventType };
	},
});
