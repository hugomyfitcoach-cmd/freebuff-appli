import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';
import { convexBillingSecret, getStripe, webhookSecret } from '$lib/server/stripe';
import { GRACE_PERIOD_MS } from '../../../../convex/billing.js';

/**
 * Les ids G-FLUX circulent dans les metadata Stripe (signées) : on n'accepte
 * que ce qui ressemble EXACTEMENT à un id Convex users (32 caractères
 * base64url minuscules) — autrement « utilisateur introuvable », jamais un
 * crash ni une écriture sur un id forgé.
 */
function asUserId(id: string | null | undefined): Id<'users'> | null {
	return id && /^[a-z0-9]{32}$/.test(id) ? (id as Id<'users'>) : null;
}

/**
 * WEBHOOK STRIPE (mission §10/§11) — endpoint serveur, SIGNATURE OBLIGATOIRE.
 *
 * Le payload brut est vérifié avec STRIPE_WEBHOOK_SECRET : un appel non signé
 * ou mal signé est rejeté 400 AVANT tout traitement (test 16 de la mission).
 *
 * ORDRE ET DOUBLONS : Stripe ne garantit pas l'ordre des événements. Pour
 * chaque événement on relit l'abonnement RÉEL chez Stripe puis on écrit un
 * état final idempotent (billing.syncFromStripe) — un ancien événement reçu
 * en retard ne peut donc JAMAIS réactiver un abonnement. Les doublons sont
 * des no-op (patchMeaningfullyDiffers). La grâce d'échec de paiement est
 * plafonnée (nextGraceUntil) : un invoice.payment_failed reçu deux fois ne
 * repousse JAMAIS la fin de grâce de 24 heures.
 *
 * Associativité fiable : metadata.gfluxUserId + client_reference_id (Checkout)
 * puis subscription id / stripeCustomerId (recherche en base) — jamais
 * l'email seul. La couche Convex est elle-même protégée par
 * CONVEX_BILLING_WEBHOOK_SECRET : sans lui, aucune synchro n'est possible
 * (fail-closed, aucun état Stripe écrit).
 */
export const POST: RequestHandler = async (event) => {
	const secret = webhookSecret();
	const convexSecret = convexBillingSecret();
	if (!secret || !convexSecret) {
		// Fail-closed : sans secrets configurés, on ne fait AUCUNE confiance.
		return json({ error: 'Webhook non configuré.' }, { status: 503 });
	}
	const signature = event.request.headers.get('stripe-signature');
	if (!signature) {
		return json({ error: 'Signature manquante.' }, { status: 400 });
	}
	const payload = await event.request.text(); // corps BRUT — jamais re-sérialisé
	let stripeEvent: Stripe.Event;
	try {
		stripeEvent = await getStripe().webhooks.constructEventAsync(payload, signature, secret);
	} catch {
		return json({ error: 'Signature invalide.' }, { status: 400 });
	}

	try {
		switch (stripeEvent.type) {
			case 'checkout.session.completed': {
				const session = stripeEvent.data.object as Stripe.Checkout.Session;
				if (session.mode !== 'subscription') break;
				const userId = await resolveUserFromCheckout(session, convexSecret);
				if (!userId) return json({ received: true, skipped: 'user_not_found' });
				const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
				if (subId) await syncSubscriptionToUser(userId, subId, { customerId: session.customer, clearGrace: true });
				break;
			}
			case 'invoice.paid': {
				// Paiement OK : la grâce est EFFACÉE et l'abonnement resynchronisé
				// (l'accès revient immédiatement, sans attendre autre chose).
				const invoice = stripeEvent.data.object as Stripe.Invoice;
				const userId = await resolveUserFromInvoice(invoice, convexSecret);
				if (!userId) return json({ received: true, skipped: 'user_not_found' });
				const subId = subIdFromInvoice(invoice);
				if (subId) await syncSubscriptionToUser(userId, subId, { customerId: invoice.customer, clearGrace: true });
				break;
			}
			case 'invoice.payment_failed': {
				const invoice = stripeEvent.data.object as Stripe.Invoice;
				const userId = await resolveUserFromInvoice(invoice, convexSecret);
				if (!userId) return json({ received: true, skipped: 'user_not_found' });
				const subId = subIdFromInvoice(invoice);
				if (subId) {
					// Grâce déterministe basée sur l'échec + 24 h. Le plafonnement
					// final (jamais repoussée par un doublon) est refait DANS la
					// mutation, avec l'état actuel de la base.
					await syncSubscriptionToUser(userId, subId, {
						customerId: invoice.customer,
						graceFromMs: stripeEvent.created * 1000,
					});
				}
				break;
			}
			case 'customer.subscription.updated':
			case 'customer.subscription.deleted': {
				const sub = stripeEvent.data.object as Stripe.Subscription;
				const userId = await resolveUserFromSubscription(sub, convexSecret);
				if (!userId) return json({ received: true, skipped: 'user_not_found' });
				// deleted : abonnement réellement terminé → grâce effacée ; l'état
				// relu chez Stripe (canceled) bloque l'accès s'il n'y a rien d'autre.
				const clearGrace = stripeEvent.type === 'customer.subscription.deleted';
				await syncSubscriptionToUser(userId, sub.id, {
					customerId: sub.customer,
					clearGrace,
					existingSub: sub,
				});
				break;
			}
			default:
				// Événement non géré : acquitté (200) pour éviter les retries inutiles.
				break;
		}
		return json({ received: true });
	} catch {
		// Erreur de traitement : 500 → Stripe rejouera (retry) ; l'écriture
		// idempotente rend le rejeu sûr.
		return json({ error: 'Erreur de traitement.' }, { status: 500 });
	}
};

/* ═══════ Résolution utilisateur (metadata d'abord, base en repli) ═══════ */

/** userId depuis les metadata / client_reference_id d'une Session Checkout. */
async function resolveUserFromCheckout(session: Stripe.Checkout.Session, s: string): Promise<Id<'users'> | null> {
	const raw = session.metadata?.gfluxUserId ?? (session.client_reference_id || null);
	const fromMetadata = asUserId(raw);
	if (fromMetadata) {
		const known = await convex.query(api.billing.webhookUserExists, { webhookSecret: s, userId: fromMetadata });
		if (known) return fromMetadata;
	}
	const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
	if (customerId) {
		return convex.query(api.billing.userByStripeCustomer, { webhookSecret: s, stripeCustomerId: customerId });
	}
	return null;
}

/**
 * Subscription id d'une Invoice — API Stripe récente : le champ historique
 * `subscription` a disparu au profit de parent.subscription_details.
 */
function subIdFromInvoice(invoice: Stripe.Invoice): string | null {
	const viaParent = invoice.parent;
	if (viaParent?.type === 'subscription_details') {
		const sd = viaParent.subscription_details;
		const id = typeof sd?.subscription === 'string' ? sd.subscription : sd?.subscription?.id;
		if (id) return id;
	}
	// Repli compat (ancienne sérialisation d'API) : champ subscription éventuel.
	const legacy = (invoice as unknown as { subscription?: string | { id?: string } }).subscription;
	if (typeof legacy === 'string') return legacy;
	if (legacy && typeof legacy === 'object' && typeof legacy.id === 'string') return legacy.id;
	return null;
}

/** userId depuis une Invoice : subscription id (base) puis customer (base). */
async function resolveUserFromInvoice(invoice: Stripe.Invoice, s: string): Promise<Id<'users'> | null> {
	const subId = subIdFromInvoice(invoice);
	if (subId) {
		const known = await convex.query(api.billing.userByStripeSubscription, {
			webhookSecret: s,
			stripeSubscriptionId: subId,
		});
		if (known) return known;
	}
	const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
	if (customerId) {
		return convex.query(api.billing.userByStripeCustomer, { webhookSecret: s, stripeCustomerId: customerId });
	}
	return null;
}

/** userId depuis une Subscription : metadata d'abord, puis customer (base). */
async function resolveUserFromSubscription(sub: Stripe.Subscription, s: string): Promise<Id<'users'> | null> {
	const fromMetadata = asUserId(sub.metadata?.gfluxUserId ?? null);
	if (fromMetadata) {
		const known = await convex.query(api.billing.webhookUserExists, { webhookSecret: s, userId: fromMetadata });
		if (known) return fromMetadata;
	}
	const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
	if (customerId) {
		return convex.query(api.billing.userByStripeCustomer, { webhookSecret: s, stripeCustomerId: customerId });
	}
	return null;
}

/* ═══════ Synchro : état relu chez Stripe, écrit idempotent ═══════ */

type SyncOpts = {
	customerId?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
	/** Échec de paiement : grâce déterministe = cet instant + 24 h jours (plafonnée en base). */
	graceFromMs?: number;
	/** Efface la grâce (paiement OK, abonnement supprimé). */
	clearGrace?: boolean;
	/** Objet Subscription déjà reçu dans l'événement (évite une relecture). */
	existingSub?: Stripe.Subscription;
};

const STATUSES = [
	'active',
	'trialing',
	'past_due',
	'canceled',
	'unpaid',
	'incomplete',
	'incomplete_expired',
	'paused',
] as const;

/**
 * Relit l'abonnement RÉEL chez Stripe (sauf si fourni) puis écrit l'état via
 * billing.syncFromStripe — source de vérité = l'API, jamais l'événement.
 */
async function syncSubscriptionToUser(userId: Id<'users'>, subscriptionId: string, opts: SyncOpts): Promise<void> {
	const s = convexBillingSecret();
	if (!s) return; // fail-closed (vérifié plus tôt, ceinture + bretelles)
	const stripe = getStripe();
	const customerId =
		typeof opts.customerId === 'string'
			? opts.customerId
			: opts.customerId && !('deleted' in opts.customerId)
				? opts.customerId.id
				: undefined;
	let sub = opts.existingSub;
	if (!sub) {
		try {
			sub = await stripe.subscriptions.retrieve(subscriptionId);
		} catch {
			// Abonnement introuvable (supprimé + purgé) : état final = terminé.
			await convex.mutation(api.billing.syncFromStripe, {
				webhookSecret: s,
				userId,
				eventType: 'subscription_unreachable',
				stripeCustomerId: customerId,
				subscription: {
					id: subscriptionId,
					status: 'canceled',
					currentPeriodEndMs: null,
					cancelAtPeriodEnd: false,
					priceId: null,
				},
				graceUntilMs: opts.clearGrace ? null : undefined,
			});
			return;
		}
	}
	// API récente : la fin de période vit sur le subscription item.
	const item = sub.items?.data?.[0];
	const periodEndSec = (item as { current_period_end?: number | null } | undefined)?.current_period_end ?? null;
	const priceId = item?.price?.id ?? null;
	// Grâce : échec de RENOUVELLEMENT → failedAt + 24 HEURES (GRACE_PERIOD_MS).
	// Ne s'applique qu'à un abonnement existant : une souscription initiale
	// échouée reste incomplete (jamais past_due) et une cliente sans abonnement
	// (ex. passage coaching → autonomie) ne reçoit AUCUN événement → hard lock
	// immédiat, sans grâce. La mutation PLAFONNE ensuite au max de l'existant
	// en base : un doublon ne repousse JAMAIS les 24 h. Paiement OK /
	// suppression → null (effacée) ;
	// sinon undefined (champ inchangé).
	const graceUntilMs =
		opts.clearGrace === true
			? (null as number | null)
			: opts.graceFromMs !== undefined
				? opts.graceFromMs + GRACE_PERIOD_MS
				: undefined;
	await convex.mutation(api.billing.syncFromStripe, {
		webhookSecret: s,
		userId,
		eventType: 'subscription_sync',
		stripeCustomerId: customerId ?? (typeof sub.customer === 'string' ? sub.customer : sub.customer?.id),
		subscription: {
			id: sub.id,
			status: (STATUSES as readonly string[]).includes(sub.status)
				? (sub.status as (typeof STATUSES)[number])
				: 'canceled',
			currentPeriodEndMs: periodEndSec != null && periodEndSec > 0 ? periodEndSec * 1000 : null,
			cancelAtPeriodEnd: sub.cancel_at_period_end === true,
			priceId,
		},
		graceUntilMs,
	});
}
