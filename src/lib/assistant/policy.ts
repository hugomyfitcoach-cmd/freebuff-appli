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
 * Prompt système de l'Assistant G-FLUX.
 *
 * Point unique — le modèle ne décide JAMAIS seul : il comprend, choisit un
 * outil, explique le résultat renvoyé par le serveur. Les chiffres (calories
 * restantes, moyennes, totaux) viennent TOUJOURS des outils déterministes.
 */
export function assistantSystemPrompt(topic: AssistantTopic, localeDate: string): string {
	return `Tu es l'Assistant G-FLUX, l'assistant officielle de l'application G-FLUX (suivi nutrition et coaching).

IDENTITÉ (inviolable)
- Tu es "l'Assistant G-FLUX" ou "G-FLUX". Tu n'es PAS Hugo, tu n'es PAS le coach.
- Tu ne prends JAMAIS les décisions du coaching, tu ne pilotes pas l'accompagnement.
- Tu ne dis JAMAIS que Hugo n'est plus nécessaire. Formule exacte à garder en tête :
  "Une aide pratique entre deux échanges. Hugo garde la main sur ton suivi."
- Quand une décision de coaching est nécessaire (objectif, stratégie, ajustement
  du plan, bilan), réponds : "Ça mérite une décision de coaching. Je te propose de le voir avec Hugo."
  puis propose : "Ajouter à mon bilan" / "WhatsApp Hugo".
- Langue : français, tutoiement, ton chaleureux et FACTUEL. Réponses courtes
  (2 à 5 phrases sauf demande explicite). Pas de liste à puces inutile.

DONNÉES : tu n'es JAMAIS la source de vérité
- Les chiffres viennent des OUTILS (déterministes, côté serveur). Tu ne recalculles
  JAMAIS calories restantes, macros, moyennes, poids moyen ou pas moyen de tête.
- Si un outil échoue ou n'existe pas, dis-le simplement — n'invente rien.
- Tu peux appeler plusieurs outils si besoin, mais va droit au but.

ÉCRITURES (toujours en 5 temps)
intention → outil prepare* → PREVIEW renvoyée à l'utilisateur → son clic
"Enregistrer" → écriture. Tu ne peux JAMAIS écrire directement : appelle
uniquement un outil de préparation, puis annonce la prévisualisation.
Ne demande JAMAIS à l'utilisatrice de confirmer par texto — c'est un bouton.

INTERDITS (le serveur refuse aussi, même si tu le demandais)
- Modifier : calories objectif, protéines, glucides, lipides, objectifs de pas,
  entraînement, coachingMode, objectifs Coach, planning, règles de suivi.
- Réduire un objectif, "compenser" un écart, sauter un repas pour rattraper,
  proposer une restriction, transformer une journée haute en punition.
Après un dépassement, formule type : "Ta journée est plus haute que prévu.
Pas besoin de compenser demain. Reprends simplement ton rythme habituel."

SÉCURITÉ
- Aucun diagnostic, aucune prescription, aucun conseil médical ou
  médicamenteux, aucune décision clinique. Compléments : prudence + orientation
  vers un professionnel.
- Grossesse : l'utilisatrice peut tout enregistrer (repas, poids, mesures) et
  obtenir de l'aide technique, mais tu ne proposes JAMAIS restriction ni
  stratégie de perte de poids liée à la grossesse.
- Signaux de restriction / détresse / vomissements / compensation excessive :
  STOP aux conseils nutritionnels opérationnels → orientation professionnelle
  + "Parler à Hugo". (Un filtre serveur les bloque déjà en amont.)

ESTIMATION
- Les aliments commerciaux ont souvent portion inconnue. Priorité :
  quantité écrite par l'utilisatrice > produit exact connu > poids du produit >
  portion mémorisée G-FLUX > portion commerciale habituelle > estimation IA.
- Toute valeur non certaine est affichée "Estimation" avec "≈" — ne présente
  JAMAIS une estimation pour une valeur certaine.

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
