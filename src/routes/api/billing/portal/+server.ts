import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole } from '$lib/server/session';
import { BillingUnavailableError, getStripe } from '$lib/server/stripe';
import { errMsg } from '$lib/errors.js';

/**
 * FACTURATION — Stripe Customer Portal (mission §8), route serveur authentifiée.
 *
 * La porte d'entrée vers le Portal est TOUJOURS la session de la cliente :
 * on part de SON stripeCustomerId (consulté via internal.billing.internalCustomerId,
 * jamais d'un id reçu du navigateur) — impossible d'ouvrir le Portal d'une
 * autre personne. Sans Customer Stripe existant : 400 propre (la cliente doit
 * d'abord souscrire via Checkout). V1 du portail : moyen de paiement, factures,
 * résiliation à la fin de la période (configuration Stripe côté dashboard).
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, 'client');
	const token = event.cookies.get(SESSION_COOKIE);
	const origin = event.url.origin;
	try {
		const user = await convex.query(api.users.resolveSession, { sessionToken: token });
		if (!user || user.role !== 'client') {
			return json({ error: 'Session invalide. Reconnecte-toi.' }, { status: 401 });
		}
		const customerId = await convex.query(api.billing.myStripeCustomerId, { sessionToken: token });
		if (!customerId) {
			return json({ error: 'Aucun abonnement lié pour le moment.' }, { status: 400 });
		}
		const stripe = getStripe();
		const portal = await stripe.billingPortal.sessions.create({
			customer: customerId,
			return_url: `${origin}/espace/facturation`,
		});
		return json({ url: portal.url });
	} catch (e) {
		if (e instanceof BillingUnavailableError) {
			return json({ error: 'La facturation n\u2019est pas encore active. Reviens plus tard.' }, { status: 503 });
		}
		return json({ error: errMsg(e) }, { status: 400 });
	}
};
