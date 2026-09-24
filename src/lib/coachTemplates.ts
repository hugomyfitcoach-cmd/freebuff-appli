/**
 * TEMPLATES COACH — générateurs de messages (module PUR, aucune I/O).
 *
 * Portage fidèle du générateur HTML « Templates WhatsApp — G-Flux », V1 CRM :
 *  - Close & Bienvenue (3 situations : démarrage pendant l'appel, elle revient,
 *    paiement validé) ;
 *  - Récap démarrage (plan calorique, focus nutrition, tracking G-FLUX,
 *    activité, suivi, compléments, note perso optionnelle) ;
 *  - Relance bilan (message court).
 *
 * Les anciennes références Virtuagym (deuxième appli nutrition, badge bleu,
 * « configure-la au hasard »…) sont RETIRÉES : G-FLUX (https://app.myfit-coach.fr/)
 * est l'outil principal. Format WhatsApp : les titres sont entourés
 * d'astérisques (*GRAS*) comme dans le générateur d'origine.
 *
 * Aucun préremplissage depuis la fiche cliente (V1) : tous les champs sont
 * saisis par la coach, seuls les textes sont normalisés ici.
 */

/** Lien de visio par défaut (éditable au planning — ne jamais coder côté affichage). */
export const DEFAULT_MEET_URL = 'https://meet.google.com/ajz-hoxy-tkz';

/** Application principale — unique outil de suivi. */
export const APP_URL = 'https://app.myfit-coach.fr/';
/** Mot de passe initial communiqué aux nouvelles clientes. */
export const INITIAL_PASSWORD = 'bypm2026';

/** Champs vide → repli lisible entre crochets (jamais « undefined »). */
function fill(v: string | number | null | undefined, fallback: string): string {
	const s = typeof v === 'string' ? v.trim() : v;
	if (s === null || s === undefined || s === '') return fallback;
	return String(s);
}

/* ═══════════════ CLOSE & BIENVENUE — 3 SITUATIONS ═══════════════ */

export type CloseSituation = 'pendant' | 'retour' | 'paiement';

/** Champs de la Close & Bienvenue (le champ utile dépend de la situation). */
export type CloseInput = {
	prenom: string;
	/** Situations 1 et 3 : jour + heure de la visio. */
	visio?: string;
	/** Situation 2 : jour idéal du premier rendez-vous. */
	jourRdv?: string;
};

/** Situation 1 — pendant l'appel, elle démarre maintenant. */
export function closePendant(input: CloseInput): string {
	const prenom = fill(input.prenom, '[Prénom]');
	const visio = fill(input.visio, '[jour et heure]');
	return `Bienvenue dans G-FLUX ${prenom} 👋

Comme prévu, voici ta petite mission avant notre visio :

🔐 Pour rappel, tes accès G-FLUX

👉 ${APP_URL}

Adresse mail : ton adresse mail habituelle
Mot de passe : ${INITIAL_PASSWORD}

Pense ensuite à installer G-FLUX sur l'écran d'accueil de ton téléphone si ce n'est pas déjà fait 📱

*ÉTAPE 1*
Complète ton formulaire de démarrage 📋

*ÉTAPE 2*
Renseigne tes mensurations et ajoute tes photos 📸

💻 *NOTRE VISIO*
${visio}
${DEFAULT_MEET_URL}

Si tu as des questions d'ici là, je suis dispo 💬

Let's go 🚀`;
}

/** Situation 2 — elle revient : lancement du démarrage (zéro friction, pas d'onboarding expliqué). */
export function closeRetour(input: CloseInput): string {
	const prenom = fill(input.prenom, '[Prénom]');
	const jour = fill(input.jourRdv, '[jour idéal]');
	return `Let's go ${prenom} 🚀

C'est parti pour démarrer !

1️⃣ Je vais avoir besoin de ton adresse mail pour créer ton accès et la facturation. Tu peux me l'envoyer ici ?

2️⃣ Une fois que tout est validé, je t'enverrai directement ta mission de démarrage avec tes accès à G-FLUX.

3️⃣ On fixe ensemble notre premier rendez-vous, idéalement ${jour}. Dis-moi ce qui te convient le mieux !

Hâte de commencer avec toi 🚀`;
}

/** Situation 3 — paiement validé : instructions de démarrage. */
export function closePaiement(input: CloseInput): string {
	const prenom = fill(input.prenom, '[Prénom]');
	const visio = fill(input.visio, '[jour et heure]');
	return `C'est parti ${prenom} 🚀

Voici les prochaines étapes :

1️⃣ Connecte-toi à G-FLUX

👉 ${APP_URL}

Adresse mail : celle utilisée lors de ton inscription
Mot de passe : ${INITIAL_PASSWORD}

Une fois connectée, pense à installer G-FLUX sur l'écran d'accueil de ton téléphone 📱

2️⃣ Avant notre visio, complète ton onboarding :

→ formulaire de démarrage
→ mensurations + photos

3️⃣ Notre visio

${visio}

👉 ${DEFAULT_MEET_URL}

Pendant la visio, je te ferai un rapide tour complet de l'outil pour que tu saches bien l'utiliser au quotidien 💪

Des questions d'ici là, je suis là !`;
}

/** Génère le message Close & Bienvenue selon la situation choisie. */
export function genererClose(situation: CloseSituation, input: CloseInput): string {
	if (situation === 'retour') return closeRetour(input);
	if (situation === 'paiement') return closePaiement(input);
	return closePendant(input);
}

/* ═══════════════ RÉCAP DÉMARRAGE ═══════════════ */

export type DemarrageInput = {
	prenom: string;
	calMin: string;
	calMax: string;
	maintenance: string;
	vitesse: string;
	pas: string;
	proteines: string;
	/** Date (libelle libre) du point J+7. */
	j7: string;
	/** Note personnalisée optionnelle — absente ou vide = bloc omis. */
	note?: string;
};

export function genererDemarrage(input: DemarrageInput): string {
	const prenom = fill(input.prenom, '[Prénom]');
	const calMin = fill(input.calMin, '[X]');
	const calMax = fill(input.calMax, '[X]');
	const maintenance = fill(input.maintenance, '[X]');
	const vitesse = fill(input.vitesse, '[X]');
	const pas = fill(input.pas, '[X]');
	const proteines = fill(input.proteines, '[X]');
	const j7 = fill(input.j7, '[date J+7]');
	const note = (input.note ?? '').trim();

	return `Hey ${prenom} 👋

Super visio aujourd'hui — voilà ton récap personnalisé 🎯

🔥 *TON PLAN CALORIQUE*

Fourchette objectif : *${calMin} – ${calMax} kcal / jour*

Maintenance : *${maintenance} kcal*

Si tu remontes à cette valeur une journée, tu ne prends pas et tu ne perds pas. C'est ton filet de sécurité.

Vitesse de perte estimée : *~${vitesse} kg de gras / semaine*


🥩 *TON FOCUS NUTRITION*

Protéines cibles : *${proteines} g / jour minimum*

→ Répartis-les sur 2 à 3 portions dans la journée
→ Complète ensuite avec ce que tu veux
→ Joue sur le volume alimentaire pour te caler


📱 *TON TRACKING DANS G-FLUX*

→ Pour faciliter ton tracking, utilise en priorité les repères G-FLUX lorsqu'ils sont disponibles

→ Pour les produits emballés, tu peux utiliser le code-barres ou photographier directement l'étiquette nutritionnelle

→ Repas IA est également disponible si tu veux photographier directement ton assiette : c'est une option pour gagner du temps, tu vérifies simplement les aliments et quantités proposés avant de les ajouter

→ G-FLUX mémorise progressivement tes portions habituelles et tu peux mettre tes aliments réguliers en favoris pour aller encore plus vite


🚶 *TON ACTIVITÉ*

Objectif : *${pas} pas / jour*

→ Tu peux compléter ou corriger tes pas à tout moment, même plusieurs jours après. Pas besoin de penser à les renseigner tous les jours.


📋 *TON SUIVI*

→ 3 pesées / semaine, idéalement le matin dans les mêmes conditions
→ Mensurations tous les 15 jours
→ Ton bilan hebdomadaire est à compléter directement dans G-FLUX


💊 *MES RECOMMANDATIONS COMPLÉMENTS*

→ Vitamine D3 — 1000 à 2000 UI / jour (matin avec un repas)

→ Oméga-3 — 1 à 2 g d'EPA+DHA / jour (au repas)

→ Magnésium bisglycinate ou citrate — 300 mg le soir${note ? `

📝 *NOTE PERSO*

${note}` : ''}

On se retrouve le *${j7}* pour le point J+7 📞

Des questions d'ici là ? Je suis dispo 👊`;
}

/* ═══════════════ RELANCE BILAN ═══════════════ */

/** Message très court, dans l'esprit du générateur d'origine. */
export function genererRelance(prenom: string): string {
	return `Hello ${fill(prenom, '[Prénom]')} 👋 tout va bien ? Je n'ai pas vu ton bilan passer cette semaine — si RAS on continue comme ça ✅`;
}
