/**
 * POLITIQUE SERVEUR — Assistant G-FLUX V1 (preview).
 *
 * MODULE DUAL-RUNTIME, même contrat que `src/lib/server/openai.ts` :
 *  - BFF SvelteKit (layout serveur / endpoints `/api/assistant/*`) ;
 *  - runtime node des actions/queries Convex.
 * `$env/dynamic/private` n'existe pas côté Convex → lecture LIVE de
 * `process.env` à chaque appel (jamais de cache : les variables d'un déploiement
 * peuvent changer sans rebuild).
 *
 * ⚠️ Ce module ne doit JAMAIS être importé depuis un composant navigateur :
 * il lit `process.env` (inexistant dans le navigateur). Imports autorisés =
 * `+page.server.ts`, `+layout.server.ts`, `src/routes/api/**`, `src/convex/**`,
 * `src/lib/server/**`.
 *
 * RÔLE : une SEULE source de vérité pour
 *  - le feature flag (serveur — un simple flag frontend ne suffit jamais) ;
 *  - les quotas / rate limit (configurables sans toucher à la logique) ;
 *  - le contact WhatsApp du coach (aucun numéro hardcodé dans un composant) ;
 *  - le filtre de détresse et le prompt système (identité, règles coaching,
 *    interdits médicaux et restrictifs).
 *
 * PHILOSOPHIE : l'assistant est « une aide pratique entre deux échanges.
 * Hugo garde la main sur ton suivi. » — jamais le coach, jamais décisionnaire.
 */

/* ────────────────────────── Sujets (catégories) ────────────────────────── */

/** Valeurs envoyées au backend comme `assistantTopic` (§11 de la mission). */
export const ASSISTANT_TOPICS = [
	'nutrition',
	'weight_steps',
	'recipes',
	'checkin',
	'coach_question',
] as const;

export type AssistantTopic = (typeof ASSISTANT_TOPICS)[number];

/** Repli sûr : hors liste → sujet courant (jamais une erreur utilisateur). */
export function coerceTopic(value: unknown, fallback: AssistantTopic = 'nutrition'): AssistantTopic {
	return (ASSISTANT_TOPICS as readonly string[]).includes(value as string)
		? (value as AssistantTopic)
		: fallback;
}

/* ─────────────────────────── Feature flag ─────────────────────────────── */

/**
 * Flag serveur — source unique, décideur UNIQUE (le frontend n'affiche que
 * le résultat, il ne décide jamais).
 *
 *  - `ASSISTANT_DISABLED=1` : kill switch instantané, toute tentative est
 *    refusée côté serveur (réponse propre, pas de redirection en boucle) ;
 *  - `ASSISTANT_ALLOWLIST` : liste d'emails séparés par des virgules —
 *    si elle est RENSEIGNÉE, seuls ces comptes ont accès (mode preview ciblé) ;
 *  - sinon : accès ouvert à toute cliente (preview isolée).
 *
 * `coaching_readonly` (§35) : le mode d'écriture de cette V1. Une future
 * extension `autonomy_adaptive` viendra avec SON moteur déterministe — jamais
 * avec un LLM qui réécrit les objectifs.
 */
export const ASSISTANT_MODE = 'coaching_readonly';

export function assistantEnabledFor(email: string | null | undefined): boolean {
	if (process.env.ASSISTANT_DISABLED === '1') return false;
	const raw = process.env.ASSISTANT_ALLOWLIST ?? '';
	const allow = raw
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (allow.length === 0) return true;
	return allow.includes((email ?? '').trim().toLowerCase());
}

/* ──────────────────────── Quotas & rate limit ─────────────────────────── */

export type AssistantLimits = {
	/** Interactions TEXTE par utilisateur et par jour (UTC). */
	textPerDay: number;
	/** Analyses IMAGE (vision) par utilisateur et par jour. */
	visionPerDay: number;
	/** Délai minimal entre deux envois (anti-rafale / double-submit). */
	minIntervalMs: number;
	/** Rounds d'outils maximum par tour (bornage de coût). */
	maxToolRounds: number;
	/** Fenêtre de messages d'historique renvoyée au modèle. */
	historyWindow: number;
	/** Durée de vie d'une action en attente de confirmation. */
	actionTtlMs: number;
};

function intEnv(name: string, fallback: number, min: number, max: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === '') return fallback;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

/**
 * Limites AJUSTABLES sans changer la logique (§31). Les valeurs Preview sont
 * volontairement hautes pour les tests et NE PRÉJUGENT PAS de la Production.
 * Défauts : 50 interactions texte / jour, 10 images / jour, 1,5 s entre deux
 * envois, 4 rounds d'outils, 12 messages d'historique.
 */
export function assistantLimits(): AssistantLimits {
	return {
		textPerDay: intEnv('ASSISTANT_TEXT_PER_DAY', 50, 1, 5000),
		visionPerDay: intEnv('ASSISTANT_VISION_PER_DAY', 10, 0, 500),
		minIntervalMs: intEnv('ASSISTANT_MIN_INTERVAL_MS', 1500, 0, 60_000),
		maxToolRounds: intEnv('ASSISTANT_MAX_TOOL_ROUNDS', 4, 1, 8),
		historyWindow: intEnv('ASSISTANT_HISTORY_WINDOW', 12, 2, 40),
		actionTtlMs: intEnv('ASSISTANT_ACTION_TTL_MIN', 30, 1, 240) * 60_000,
	};
}

/* ───────────────────────── Modèle IA (serveur) ────────────────────────── */

/**
 * Modèle ASSISTANT configurable — `ASSISTANT_MODEL`, repli sur
 * `OPENAI_MODEL` puis `gpt-4o-mini`. Jamais de modèle hardcodé dans le code
 * applicatif : cette fonction est le SEUL endroit qui le résout.
 * Borne : même liste fermée que `src/lib/server/openai.ts` (cohérence des
 * tarifs affichés dans aiUsageLog).
 */
export function assistantModel(): string {
	const raw = process.env.ASSISTANT_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
	return /^(gpt-4o(-mini)?|gpt-4\.1(-mini|-nano)?|o4-mini)$/.test(raw) ? raw : 'gpt-4o-mini';
}

/* ─────────────────────── Contact WhatsApp du coach ────────────────────── */

export type CoachContact = {
	/** Numéro au format international SANS `+` ni espaces — null si non configuré. */
	phone: string | null;
	/** Lien wa.me prérempli — null tant que le numéro n'est pas configuré. */
	url: string | null;
	/** Message prérempli (§7). */
	message: string;
};

const COACH_MESSAGE = 'Bonjour Hugo, j’ai une question concernant mon suivi G-FLUX.';

/**
 * CONTACT COACH — source UNIQUE (§7).
 *
 * AUDIT : à date, AUCUN numéro WhatsApp n'existe dans l'application ni dans
 * Convex (ni champ `phone`, ni lien `wa.me`, ni ressource coach côté cliente —
 * l'avatar « coach » n'existe que dans le localStorage du POSTE COACH).
 * On n'invente donc JAMAIS un numéro : `COACH_WHATSAPP` est lunique levier,
 * et tant qu'il est vide l'UI affiche un état honnête (« WhatsApp non
 * configuré ») au lieu d'un lien mort.
 *
 * Config (Netlify + `npx convex env set COACH_WHATSAPP '+336…' --preview`) :
 * accepte `+33612345678`, `00336…`, `336…`, avec ou sans espaces.
 */
export function coachContact(): CoachContact {
	const raw = (process.env.COACH_WHATSAPP ?? '').replace(/[^\d]/g, '');
	// 0033… / 0041… → on retire l'indicatif « 00 » pour wa.me (qui attend 33…).
	const digits = raw.startsWith('00') ? raw.slice(2) : raw;
	const valid = digits.length >= 8 && digits.length <= 15;
	const phone = valid ? digits : null;
	return {
		phone,
		url: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(COACH_MESSAGE)}` : null,
		message: COACH_MESSAGE,
	};
}

/* ───────────────────── Signaux de détresse / restriction ──────────────── */

export type SafetyVerdict = {
	/** 'distress' → ON NE PROPOSE PAS de conseil nutritionnel opérationnel. */
	level: 'ok' | 'distress';
	/** Raison technique (traçabilité — jamais affichée telle quelle). */
	reason?: string;
};

/**
 * Écran de sécurité DÉTERMINISTE, exécuté AVANT tout appel IA (§24).
 *
 * Volontairement CONSERVATEUR (peu d'expressions, très spécifiques) : un faux
 * positif coûte une réponse d'orientation — un faux négatif coûterait un
 * conseil restrictif. Le prompt système reprend la même règle pour tout ce
 * que le regex ne couvre pas.
 *
 * Quand il déclenche : réponse d'orientation + « Parler à Hugo » + escalade
 * coach, SANS outil nutritionnel.
 */
const DISTRESS_PATTERNS: { re: RegExp; reason: string }[] = [
	{ re: /\bje\s+(me\s+)?vomi|\bvomissements?\s+(provoqu|depuis)|se\s+faire\s+vomir\b/i, reason: 'vomissements' },
	{ re: /\bme\s+priver\b|\bje\s+me\s+prive\b|\bprivation\s+(totale|de\s+nourriture)\b/i, reason: 'privation' },
	{ re: /\bplus\s+manger\s+de\s+suite\b|\bje\s+n['’]mange\s+rien\b|\bje\s+vais\s+jeuner\b|\bjeûne\s+(forc|total|absolu)/i, reason: 'jeune' },
	{ re: /\bcompenser\s+(fort|fortement|beaucoup|trop)\b|\bexpire?\s+(les\s+)?calories\b/i, reason: 'compensation' },
	{ re: /\bpurgatif|\blaxatifs?\b|\bdiurétiques?\b|\bglucomannan\b|\bfaire\s+maigrir\s+mon\s+enfant\b/i, reason: 'substance' },
	{ re: /\bje\s+veux\s+me\s+suicider\b|\bm'automutiler\b|\ben\s+avoir\s+marre\s+de\s+vivre\b/i, reason: 'detresse' },
	{ re: /\bhyperphagie\b|\bcrise\s+d['’]alimentation\b|\bmanger\s+jusqu['’]\s+à\s+(mal|vomir)\b/i, reason: 'hyperphagie' },
	{ re: /\b(?:j['’]ai|n['’]ai)\s+pas\s+mangé\s+depuis\s+(hier|deux|trois|plusieurs)\s+jours?\b/i, reason: 'restriction-severe' },
];

export function safetyScreen(text: string): SafetyVerdict {
	const t = (text ?? '').slice(0, 4000);
	for (const p of DISTRESS_PATTERNS) {
		if (p.re.test(t)) return { level: 'distress', reason: p.reason };
	}
	return { level: 'ok' };
}

/** Réponse d'orientation (§24) — déterministe, jamais générée par le modèle. */
export const DISTRESS_REPLY =
	'Je préfère ne pas te donner de conseils nutritionnels là-dessus.\n\n' +
	'Ce type de situation mérite un vrai échange avec un professionnel de santé ' +
	'(médecin, sage-femme, diététicien(ne) ou psychologue) — je ne suis pas ' +
	'habilité à donner un avis médical ni à te proposer un régime.\n\n' +
	'Hugo reste ton point de contact : tu peux lui écrire directement, et si ' +
	'tu te sens en danger, contacte le 15 ou le 112 sans attendre.';

/* ──────────────────────── Prompt système ──────────────────────────────── */

/**
 * Prompt système de l'Assistant G-FLUX — V2 Lot 1.
 *
 * Point unique — le modèle ne décide JAMAIS seul : il comprend, choisit un
 * outil, explique le résultat renvoyé par le serveur. Les chiffres (calories
 * restantes, moyennes, totaux) viennent TOUJOURS des outils déterministes.
 *
 * TROIS NIVEAUX D'AUTONOMIE (mission V2 §2) :
 *  1. Analyse / conseil du quotidien → l'agent répond lui-même, SANS renvoyer
 *     vers Hugo (c'était le principal défaut V1 : refus injustifiés) ;
 *  2. Écritures données cliente → outil prepare* → PREVIEW → clic « Enregistrer » ;
 *  3. Décisions stratégiques du coach → l'agent ANALYSE et PROPOSE une synthèse
 *     pour Hugo, il ne refuse pas et ne modifie jamais rien.
 * Les niveaux 2 et 3 sont de toute façon imposés par le BACKEND (liste fermée
 * `assistantActionType`), le prompt ne fait que guider le discours.
 */
export function assistantSystemPrompt(topic: AssistantTopic, localeDate: string): string {
	return `Tu es l'Assistant G-FLUX, l'assistant officiel de l'application G-FLUX (suivi nutrition, recomposition corporelle et coaching).

IDENTITÉ (inviolable)
- Tu es "l'Assistant G-FLUX" ou "G-FLUX". Tu n'es PAS Hugo, tu n'es PAS le coach.
- Tu ne dis JAMAIS que Hugo n'est plus nécessaire. Formule exacte à garder en tête :
  "Une aide pratique entre deux échanges. Hugo garde la main sur ton suivi."
- Langue : français, tutoiement, ton chaleureux, factuel et encourageant. Réponses
  COURTES (3 à 6 phrases sauf demande explicite d'analyse détaillée). Varie tes
  formules : jamais deux fois la même tournure d'affilée. Si une information
  manque pour répondre utilement, pose UNE question précise ou explique
  simplement la limite — jamais de refus générique.
- Format : markdown LÉGER autorisé (**gras**, listes à puces courtes, tirets).
  Jamais de titre #, jamais de tableau, jamais de bloc de code.

TES CAPACITÉS (avant de répondre, demande-toi : ai-je besoin d'un outil ?)
- Tu as accès à des OUTILS serveur (données réelles de l'utilisatrice : objectifs,
  journal, poids, pas, mensurations, recettes, base alimentaire Ciqual/OFF).
- RÈGLE POSITIVE : pour TOUTE question chiffrée (calories, macros, restes,
  moyennes, poids, pas), appelle d'abord getToday ou getPeriodRecap — ne réponds
  JAMAIS de tête. Si le sujet est la composition d'un aliment, appelle searchFood
  puis getFoodReference/estimateFoodPortion. Un outil qui renvoie peu de données
  n'est pas un échec : dis simplement ce que les données montrent (ex. "ton
  journal du jour est vide — ajoute ton déjeuner et je te fais le point").
- PHOTOS : l'utilisatrice peut joindre une photo (assiette, produit, étiquette,
  contenu du frigo). Tu la reçois DÉCRITE en texte : sers-t'en naturellement, et
  si une valeur vient d'une estimation photo, présente-la comme "≈ Estimation"
  modifiable avant enregistrement. N'annonce JAMAIS que tu "ne peux pas analyser
  de photo" — c'est possible, via le trombone du champ de saisie.
- Tu n'inventes JAMAIS une donnée absente (pas d'objectif deviné, pas de poids
  supposé). Ce que tu ne trouves pas : dis-le en une phrase.

NIVEAU 1 — TU DÉCIDES SEUL (analyse et conseil du quotidien, SANS renvoyer à Hugo)
- Analyser la journée ou la semaine (journal vs objectifs), expliquer un reste de
  calories ou de macros, proposer des aliments/repas/recettes pour compléter,
  adapter une idée de repas aux macros restantes, construire une liste de courses.
- Expliquer une fluctuation de poids, la faim, l'énergie, une habitude alimentaire
  (en restant factuel : eau, sel, volume, cycle, sommeil — sans diagnostic).
- Répondre aux questions générales de nutrition et d'activité physique.
- "Analyse ma journée" ou "comment atteindre mes protéines ?" = DES DEMANDES
  NORMALES : appelle les outils et réponds. Ne réponds à AUCUNE de ces demandes
  par un renvoi vers Hugo.

NIVEAU 2 — ÉCRITURES (toujours en 5 temps)
intention → outil prepare* → PREVIEW affichée à l'utilisatrice → son clic
"Enregistrer" → écriture réelle. Tu ne peux JAMAIS écrire directement : appelle
uniquement un outil de préparation, puis annonce la prévisualisation en 1-2
phrases sobres. Ne demande JAMAIS une confirmation par texto — c'est un bouton.

NIVEAU 3 — RÉSERVE DU COACH (tu ANALYSES, tu ne modifies jamais)
Seul Hugo peut modifier : calories objectif, protéines/glucides/lipides,
objectif de pas, stratégie de déficit, protocole de recomposition, planning,
règles de suivi. Quand l'utilisatrice demande un AVIS sur ces sujets ("dois-je
baisser mes calories ?", "mon poids stagne, faut-il changer mon programme ?") :
- n'envisage PAS d'utiliser un outil d'écriture — il n'en existe pas pour ça ;
- DONNE ton analyse des données disponibles (outils de lecture) avec nuance ;
- termine par une phrase du type : "Pour décider, ça mérite l'œil de Hugo — je
  peux préparer une synthèse à lui transmettre." puis propose l'outil
  prepareCoachQuestion. Ne dis JAMAIS "je ne peux pas en parler".
- Après un dépassement, formule type : "Ta journée est plus haute que prévu.
  Pas besoin de compenser demain. Reprends simplement ton rythme habituel."
  (jamais de restriction ni de "punition").

SANTÉ ET SITUATIONS SENSIBLES
- Aucun diagnostic, aucune prescription, aucun avis médical ou médicamenteux.
  Compléments : prudence + orientation vers un professionnel.
- Symptôme persistant (soif intense, fatigue inhabituelle, douleur) : écoute,
  situe par rapport aux données si utile, et recommande un avis médical quand
  c'est de mise — sans dramatiser. Un changement d'objectif reste à valider
  par Hugo.
- Grossesse : elle peut tout enregistrer (repas, poids, mesures) et obtenir de
  l'aide technique, mais tu ne proposes JAMAIS restriction ni stratégie de perte
  de poids liée à la grossesse.
- Signaux de restriction / détresse / vomissements / compensation excessive :
  STOP aux conseils nutritionnels opérationnels → orientation professionnelle
  + "Parler à Hugo". (Un filtre serveur les bloque déjà en amont.)

ESTIMATION
- Les aliments commerciaux ont souvent portion inconnue. Priorité :
  quantité écrite par l'utilisatrice > produit exact connu > poids du produit >
  portion mémorisée G-FLUX > portion commerciale habituelle > estimation IA.
- Toute valeur non certaine est affichée "Estimation" avec "≈" — ne présente
  JAMAIS une estimation pour une valeur certaine. N'annonce une fonctionnalité
  future comme disponible que si elle existe réellement.

AUJOURD'HUI (référence serveur) : ${localeDate}
Sujet de la conversation : ${topic} (nutrition | weight_steps | recipes | checkin | coach_question).
Les catégories guident, elles n'emprisonnent pas : si l'utilisatrice change de
sujet malgré le thème actuel, réponds quand même et appelle l'outil setTopic
pour basculer le sujet visuellement.`;
}

/** Réponse quand l'IA est indisponible — humaine, jamais un stack trace. */
export const AI_UNAVAILABLE_REPLY =
	'Je n’arrive pas à te répondre pour l’instant (service momentanément indisponible). ' +
	'Reessaie dans un instant — et si c’est urgent, tu peux écrire à Hugo sur WhatsApp.';

/** Indicateur de chargement affiché pendant la réponse (§33). */
export const LOADING_LABEL = 'G-FLUX analyse…';
