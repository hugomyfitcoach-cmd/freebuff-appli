import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../../convex/_generated/api.js';
import { SESSION_COOKIE, requireRole, clearSessionCookie } from '$lib/server/session';
import { planForPriceId } from '$lib/server/stripe';
import { errMsg } from '$lib/errors.js';

/**
 * PARAMÈTRES cliente — page ouverte à TOUTES les clientes, même bloquée :
 * Profil / Compte (email + mot de passe) / Notifications / Déconnexion
 * restent accessibles à toutes. La carte Facturation n'est rendue QUE si
 * coachingMode === "autonomy" (décision produit UX V1) : en Coaching, aucune
 * carte Facturation, aucun lien Portal, aucun CTA abonnement — la vraie
 * barrière reste le 403 serveur des routes /api/billing/*.
 *
 * Carte Facturation (Autonomie) : état DÉRIVÉ (canAccessApp côté Convex) :
 *  - Complimentary  → « Accès à G-FLUX offert »
 *  - Actif mensuel  → « G-FLUX Autonomie · 15,90 € / mois · Actif » (+ échéance)
 *  - Actif annuel   → « G-FLUX Autonomie · 129 € / an · Actif » (+ échéance)
 *  - past_due       → alerte calme + CTA « Mettre à jour mon moyen de paiement »
 *  - bloqué/rien    → renvoi vers le paywall /espace/facturation
 */
export const load: PageServerLoad = async (event) => {
	const user = await requireRole(event, 'client', { next: '/espace' });
	const billing = user.billing;
	const subscription = billing.subscription;
	return {
		profile: { prenom: user.prenom, email: user.email },
		billing: {
			decision: billing.decision,
			coachingMode: billing.coachingMode,
			billingAccessOverride: billing.billingAccessOverride,
			subscription: subscription
				? {
						status: subscription.status,
						cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
						currentPeriodEnd: subscription.currentPeriodEnd,
						graceUntil: subscription.graceUntil,
						plan: planForPriceId(subscription.priceId),
					}
				: null,
		},
	};
};

export const actions: Actions = {
	/** Profil — prénom affiché (même mutation que l'ancien flux, aucune donnée écrasée). */
	profile: async ({ request, cookies }) => {
		const form = await request.formData();
		const prenom = String(form.get('prenom') ?? '').trim();
		if (!prenom) return fail(400, { profileError: 'Le prénom ne peut pas être vide.' });
		try {
			await convex.mutation(api.users.updateProfile, { sessionToken: cookies.get(SESSION_COOKIE), prenom });
			return { profileOk: true as const };
		} catch (e) {
			return fail(400, { profileError: errMsg(e) });
		}
	},
	/** Compte — changement de mot de passe (mutation existante, session obligatoire). */
	password: async ({ request, cookies }) => {
		const form = await request.formData();
		const currentPassword = String(form.get('currentPassword') ?? '');
		const newPassword = String(form.get('newPassword') ?? '');
		if (newPassword.length < 8) return fail(400, { passwordError: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
		try {
			await convex.mutation(api.users.changePassword, {
				sessionToken: cookies.get(SESSION_COOKIE),
				currentPassword,
				newPassword,
			});
			return { passwordOk: true as const };
		} catch (e) {
			return fail(400, { passwordError: errMsg(e) });
		}
	},
	/** Déconnexion — même handler que le menu profil (grande action dédiée). */
	logout: async ({ cookies, url }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) {
			try {
				await convex.mutation(api.users.signOut, { sessionToken: token });
			} catch {
				// session déjà expirée : on nettoie le cookie quand même
			}
		}
		clearSessionCookie({ cookies, url });
		throw redirect(303, '/connexion');
	},
};
