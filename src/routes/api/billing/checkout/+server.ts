import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { BillingUnavailableError, getStripe, priceIdForPlan } from '$lib/server/stripe';
import { errMsg } from '$lib/errors.js';

/**
 * FACTURATION — Stripe Hosted Checkout (mission §7), route serveur authentifiée.
 *
 * Le navigateur n'envoie QUE { plan: "monthly" | "yearly" } : le priceId est
 * résolu STRICTEMENT côté serveur depuis les variables d'environnement
 * (STRIPE_PRICE_AUTONOMY_*). Accepter un priceId libre du navigateur est
 * interdit — test 15 de la mission.
 *
 * La Session Checkout est créée en mode subscription :
 * - client_reference_id = id G-FLUX de la cliente (retrouvable sans ambiguïté) ;
 * - metadata.gfluxUserId / gfluxEmail en plus ;
 * - customer : le stripeCustomerId existant est réutilisé, sinon Checkout
 *   crée le Customer et checkout.session.completed le persiste (webhook).
 * - success_url → /espace/facturation?checkout=success (le retour ne donne
 *   JAMAIS l'accès à lui seul : le webhook reste la source de vérité).
 *
 * AUTONOMIE UNIQUEMENT (décision produit) : une cliente en coaching ne doit
 * jamais créer accidentellement un abonnement Autonomie — un appel API direct
 * (sans passer par l'UI) est rejeté 403 côté serveur.
 *
 * Sans Stripe TEST configuré : 503 propre (fail-closed, jamais de LIVE).
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	let body: { plan?: unknown };
	try {
		body = await event.request.json();
	} catch {
		return json({ error: 'Requête invalide.' }, { status: 400 });
	}
	const plan = body?.plan;
	if (plan !== 'monthly' && plan !== 'yearly') {
		return json({ error: 'Choisis une offre (mensuelle ou annuelle).' }, { status: 400 });
	}
	const priceId = priceIdForPlan(plan);
	if (!priceId) {
		// Fail-closed : pas de price TEST configuré → aucun appel Stripe.
		return json({ error: 'La facturation n\u2019est pas encore active. Reviens plus tard.' }, { status: 503 });
	}
	const origin = event.url.origin;
	try {
		const user = await convex.query(api.users.resolveSession, { sessionToken: token });
		if (!user || user.role !== 'client') {
			return json({ error: 'Session invalide. Reconnecte-toi.' }, { status: 401 });
		}
		// Souscription réservée au mode Autonomie (décision produit, contrôle serveur).
		if (user.coachingMode !== 'autonomy') {
			return json({ error: 'La facturation est réservée au mode Autonomie.' }, { status: 403 });
		}
		// Customer existant de CETTE cliente uniquement (jamais un id reçu du
		// navigateur) — l'accès portal/checkout d'un autre user est impossible.
		const customerId = await convex.query(api.billing.myStripeCustomerId, { sessionToken: token });
		const stripe = getStripe();
		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',
			...(customerId ? { customer: customerId } : {}),
			line_items: [{ price: priceId, quantity: 1 }],
			client_reference_id: user._id,
			metadata: { gfluxUserId: user._id, gfluxEmail: user.email },
			subscription_data: { metadata: { gfluxUserId: user._id, gfluxEmail: user.email } },
			allow_promotion_codes: false,
			success_url: `${origin}/espace/facturation?checkout=success`,
			cancel_url: `${origin}/espace/facturation?checkout=cancel`,
		});
		if (!session.url) {
			return json({ error: 'Stripe n\u2019a pas renvoyé d\u2019URL de paiement.' }, { status: 502 });
		}
		return json({ url: session.url });
	} catch (e) {
		if (e instanceof BillingUnavailableError) {
			return json({ error: 'La facturation n\u2019est pas encore active. Reviens plus tard.' }, { status: 503 });
		}
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
