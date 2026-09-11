import { redirect } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { convex } from '$lib/server/convex';
import { api } from '../../convex/_generated/api.js';	import { SESSION_COOKIE, requireRole } from '$lib/server/session';
	import { errMsg } from '$lib/errors.js';
	import { sendPushToUser } from '$lib/server/push.js';	export const load: PageServerLoad = async (event) => {
	await requireRole(event, 'coach', { next: '/admin' });
	const token = event.cookies.get(SESSION_COOKIE);

	const clients = await convex.query(api.coach.listClients, { sessionToken: token });
	const bilansBoard = await convex.query(api.coach.bilansBoard, { sessionToken: token });

	const param = event.url.searchParams.get('client');
	// Le tiroir 360° ne s'ouvre que si l'on clique sur « 360° » d'un·e client·e précis·e
	// (?client=…) — jamais automatiquement à l'arrivée sur /admin. Sinon il se
	// rouvre sans cesse sur le premier client et on ne peut plus revenir à la liste.
	const selectedId = param && clients.some((c: { user: { _id: string } }) => c.user._id === param) ? param : null;
	// Semaine d'origine quand le 360 est ouvert depuis la vue globale « Bilans »
	// (?week=yyyy-mm-dd) — sert au lien retour « Tous les bilans » de l'onglet Bilans.
	const weekParam = /^\d{4}-\d{2}-\d{2}$/.test(event.url.searchParams.get('week') ?? '') ? event.url.searchParams.get('week') : null;

	const view = selectedId
		? await convex.query(api.coach.client360, { sessionToken: token, userId: selectedId as never })
		: null;
	const checkins = selectedId
		? await convex.query(api.coach.checkinsFor, { sessionToken: token, userId: selectedId as never })
		: [];
	const photos = selectedId
		? await convex.query(api.photos.listForCoach, { sessionToken: token, userId: selectedId as never })
		: [];
	// Médias coach → cliente (audios, pièces jointes) de la cliente affichée.
	const media = selectedId
		? await convex.query(api.media.forUser, { sessionToken: token, userId: selectedId as never })
		: [];
	// Onboarding de démarrage : formulaire initial + statuts des deux étapes.
	const onboardingView = selectedId
		? await convex.query(api.onboarding.coachView, { sessionToken: token, userId: selectedId as never })
		: null;
	// Journal CRM des messages du coach envoyés (historique daté, lu/non lu, réécoute).
	const messageLog = selectedId
		? await convex.query(api.coach.messageLog, { sessionToken: token, userId: selectedId as never })
		: [];

	// Message global (Tableau de bord) : état actif, destinataires et lectures —
	// null quand aucun message global n'est en cours.
	const globalMessage = await convex
		.query(api.dashboard.activeCoachBroadcast, { sessionToken: token })
		.catch(() => null);
	// État de connexion Google Calendar du coach (email + scopes — jamais de token).
	const google = await convex.query(api.googleCalendar.status, { sessionToken: token }).catch(() => null);
	const googleBanner =
		event.url.searchParams.get('google') === 'ok'
			? 'google-ok'
			: event.url.searchParams.get('google') === 'error'
				? `google-error:${event.url.searchParams.get('reason') ?? 'Erreur inconnue'}`
				: null;

	return {
		clients,
		bilansBoard,
		selectedId,
		weekParam,
		view,
		checkins,
		photos,
		media,
		onboardingView,
		messageLog,
		globalMessage,
		google,
		googleBanner,
		form: null as null | { action: string; error?: string; ok?: string },
	};
};

function back(event: { url: URL }, clientId?: string | null): never {
	const q = clientId ? `?client=${encodeURIComponent(clientId)}` : '';
	throw redirect(303, `/admin${q}`);
}

export const actions: Actions = {
	createClient: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '');
		const prenom = String(form.get('prenom') ?? '');
		const nom = String(form.get('nom') ?? '');
		const password = String(form.get('password') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const res = await convex.mutation(api.coach.createClient, {
				sessionToken: token,
				email,
				password,
				prenom,
				...(nom.trim() ? { nom } : {}),
			});
			return { action: 'createClient', ok: `Compte créé : ${prenom.trim()} (${email.trim()}). Pense à lui transmettre ses identifiants.`, userId: res.userId };
		} catch (e) {
			return fail(400, { action: 'createClient', error: errMsg(e) });
		}
	},
	updateFiche: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const prenom = String(form.get('prenom') ?? '');
		const nom = String(form.get('nom') ?? '');
		const email = String(form.get('email') ?? '');
		const birthDate = String(form.get('birthDate') ?? '');
		const startDate = String(form.get('startDate') ?? '');
		const gsheetUrl = String(form.get('gsheetUrl') ?? '');
		const heightRaw = String(form.get('heightCm') ?? '');
		// Checkbox + jumeau caché (0) : présent dans tous les cas → vrai toggle.
		const onboardingEnabled = String(form.get('onboardingEnabled') ?? '0') === '1';
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.updateClient, {
				sessionToken: token,
				userId: userId as never,
				prenom,
				...(nom.trim() ? { nom } : { nom: '' }),
				email,
				birthDate,
				startDate,
				gsheetUrl,
				heightCm: heightRaw ? Number(heightRaw) : undefined,
				onboardingEnabled,
			});
			return { action: 'updateFiche', ok: 'Fiche client mise à jour.', clientId: userId };
		} catch (e) {
			return fail(400, { action: 'updateFiche', error: errMsg(e), clientId: userId });
		}
	},
	setOnboarding: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const enabled = String(form.get('enabled') ?? '0') === '1';
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.onboarding.setEnabled, {
				sessionToken: token,
				userId: userId as never,
				enabled,
			});
			return {
				action: 'setOnboarding',
				ok: enabled
					? 'Onboarding activé — la cliente verra le parcours de démarrage à sa prochaine visite.'
					: 'Onboarding désactivé — aucun parcours n’est affiché. Les réponses déjà envoyées restent conservées.',
				clientId: userId,
			};
		} catch (e) {
			return fail(400, { action: 'setOnboarding', error: errMsg(e), clientId: userId });
		}
	},
	rename: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const prenom = String(form.get('prenom') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.updateClient, { sessionToken: token, userId: userId as never, prenom });
			return { action: 'rename', ok: 'Prénom mis à jour.' };
		} catch (e) {
			return fail(400, { action: 'rename', error: errMsg(e) });
		}
	},
	updateEmail: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const email = String(form.get('email') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.updateClient, { sessionToken: token, userId: userId as never, email });
			return { action: 'updateEmail', ok: 'Email mis à jour.' };
		} catch (e) {
			return fail(400, { action: 'updateEmail', error: errMsg(e) });
		}
	},
	resetPassword: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const newPassword = String(form.get('newPassword') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.coach.resetPassword, { sessionToken: token, userId: userId as never, newPassword });
			return { action: 'resetPassword', ok: 'Mot de passe réinitialisé. Communique-le à la cliente (ses sessions ouvertes ont été fermées).' };
		} catch (e) {
			return fail(400, { action: 'resetPassword', error: errMsg(e) });
		}
	},
	removeClient: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		if (confirm !== 'on') {
			return fail(400, { action: 'removeClient', error: 'Coche la case de confirmation pour supprimer.' });
		}
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const res = await convex.mutation(api.coach.removeClient, { sessionToken: token, userId: userId as never });
			return { action: 'removeClient', ok: `Client supprimé (${res.removedCheckins} bilan(s) retiré(s)).` };
		} catch (e) {
			return fail(400, { action: 'removeClient', error: errMsg(e) });
		}
	},
	setCoachMessage: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const clear = String(form.get('clear') ?? '') === '1';
		// « Effacer » vide tout (texte + audio). Sinon on garde le texte tapé et,
		// si un audio vient d'être enregistré, on le publie via audioId.
		const message = clear ? '' : String(form.get('message') ?? '');
		const rawAudio = String(form.get('audioId') ?? '');
		const audioId = clear ? undefined : (rawAudio || undefined);
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const res = await convex.mutation(api.dashboard.setCoachMessage, {
				sessionToken: token,
				userId: userId as never,
				message,
				...(audioId ? { audioId: audioId as never } : {}),
				removeAudio: clear,
			});
			const parts = [];
			if (res.hasText) parts.push('texte');
			if (res.hasAudio) parts.push('audio');
			const what = parts.length ? `Message ${parts.join(' + ')} publié pour aujourd'hui` : 'Message du coach supprimé';
			// Notification push (uniquement à la publication — jamais à l'effacement).
			if (parts.length > 0) {
				const preview = message.trim().slice(0, 90) || "Un message audio t'attend.";
				await sendPushToUser(
					userId,
					{ title: 'Nouveau message de ton coach', body: preview, url: '/espace', tag: 'coach-message' },
					token
				);
			}
			return { action: 'setCoachMessage', ok: `${what} — visible en haut du dashboard de la cliente.`, clientId: userId };
		} catch (e) {
			return fail(400, { action: 'setCoachMessage', error: errMsg(e), clientId: userId });
		}
	},
	/**
	 * Message global (Tableau de bord) : même notification, même carte, même
	 * journal que la Vision 360 — seule la logistique change (toutes les
	 * clientes actives d'un coup, retrait possible, anti-doublon côté Convex).
	 */
	sendGlobalMessage: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const message = String(form.get('message') ?? '');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const res = await convex.mutation(api.dashboard.sendCoachBroadcast, {
				sessionToken: token,
				message,
			});
			// MÊME notification push que la Vision 360 (même titre, même tag) :
			// la cliente voit un « Message de ton coach » comme les autres jours.
			const preview = message.trim().slice(0, 90) || 'Un message t\'attend.';
			let pushes = 0;
			for (const userId of res.sentTo) {
				pushes += await sendPushToUser(
					userId,
					{ title: 'Nouveau message de ton coach', body: preview, url: '/espace', tag: 'coach-message' },
					token
				);
			}
			const dest = res.count > 1 ? `${res.count} clientes actives` : '1 cliente active';
			return {
				action: 'sendGlobalMessage',
				ok: `Message global envoyé à ${dest} — il apparaît comme un « Message coach du jour » classique${pushes > 0 ? `, ${pushes} notification(s) envoyée(s)` : ''}.`,
			};
		} catch (e) {
			return fail(400, { action: 'sendGlobalMessage', error: errMsg(e) });
		}
	},
	withdrawGlobalMessage: async (event) => {
		await requireRole(event, 'coach');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const res = await convex.mutation(api.dashboard.withdrawCoachBroadcast, { sessionToken: token });
			return {
				action: 'withdrawGlobalMessage',
				ok: res.removed > 0
					? `Message global retiré — il a disparu de l'accueil de ${res.removed} cliente(s).`
					: 'Message global déjà retiré.',
			};
		} catch (e) {
			return fail(400, { action: 'withdrawGlobalMessage', error: errMsg(e) });
		}
	},
	setFeedback: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const checkinId = String(form.get('checkinId') ?? '');
		const clientId = String(form.get('clientId') ?? '');
		const feedback = String(form.get('feedback') ?? '');
		const status = String(form.get('status') ?? 'nouveau');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			const isPublish = status === 'retour_envoye';
			await convex.mutation(api.coach.setFeedback, {
				sessionToken: token,
				checkinId: checkinId as never,
				feedback,
				status: isPublish ? 'retour_envoye' : 'nouveau',
			});
			const ok = isPublish
				? 'Retour publié — visible par la cliente dans « Mes bilans », badge actif jusqu’à sa lecture.'
				: feedback.trim()
					? 'Brouillon enregistré — invisible pour la cliente tant que tu n’as pas publié.'
					: 'Bilan conservé en « À traiter ».';
			// Notification push à la publication du retour (jamais pour un brouillon).
			if (isPublish) {
				await sendPushToUser(
					clientId,
					{
						title: 'Retour de ton coach',
						body: 'Ton retour de bilan est disponible — retrouve-le dans « Mes bilans ».',
						url: '/espace/historique',
						tag: 'coach-feedback',
					},
					token
				);
			}
			return { action: 'setFeedback', ok, clientId };
		} catch (e) {
			return fail(400, { action: 'setFeedback', error: errMsg(e) });
		}
	},
	setGoals: async (event) => {
		await requireRole(event, 'coach');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const num = (k: string) => Number(form.get(k));
		const token = event.cookies.get(SESSION_COOKIE);
		// Maintenance calorique : champ facultatif — vide = on garde la valeur existante.
		const rawMaintenance = String(form.get('maintenanceKcal') ?? '').trim();
		const maintenanceKcal = rawMaintenance === '' ? undefined : Number(rawMaintenance);
		const clearMaintenance = form.get('clearMaintenance') === '1';
		// Objectif quotidien de pas : champ facultatif — vide = on garde l'existant.
		const rawStepGoal = String(form.get('stepGoal') ?? '').trim();
		const stepGoal = rawStepGoal === '' ? undefined : Number(rawStepGoal);
		const clearStepGoal = form.get('clearStepGoal') === '1';
		try {
			await convex.mutation(api.journal.setClientGoals, {
				sessionToken: token,
				userId: userId as never,
				kcal: num('kcal'),
				carbs: num('carbs'),
				protein: num('protein'),
				fat: num('fat'),
				maintenanceKcal,
				clearMaintenance,
				stepGoal,
				clearStepGoal,
			});
			return { action: 'setGoals', ok: 'Objectifs journaliers enregistrés.', clientId: userId };
		} catch (e) {
			return fail(400, { action: 'setGoals', error: errMsg(e), clientId: userId });
		}
	},
	googleDisconnect: async (event) => {
		await requireRole(event, 'coach');
		const token = event.cookies.get(SESSION_COOKIE);
		try {
			await convex.mutation(api.googleCalendar.disconnect, { sessionToken: token });
			return { action: 'googleDisconnect', ok: 'Google Calendar déconnecté — les tokens chiffrés ont été supprimés.' };
		} catch (e) {
			return fail(400, { action: 'googleDisconnect', error: errMsg(e) });
		}
	},
};
