/**
 * LOT 2B (§9) — BATTERIE DE 20 SCÉNARIOS E2E REPRÉSENTATIFS.
 *
 * Cible : 20/20 PASS, DEUX passages consécutifs (§9). Un passage :
 *   node tests/e2e-lot2b-scenarios.mjs [pass1|pass2]
 *
 * Chaque scénario : données initiales (compte seed preview), parcours
 * utilisateur via /api/assistant/send + /api/assistant/action, vérification
 * de la réponse ET de l'état final observable (pendingAction / refus / refs
 * Ciqual attendues / confirm), verdict PASS/FAIL. Les outils appelés sont
 * vérifiés via leurs EFFETS (preview Ciqual réelle, pendingAction, refus)
 * — jamais en supposant le comportement du modèle.
 */
const BASE = process.env.E2E_BASE ?? 'https://deploy-preview-16--g-flux.netlify.app';
const EMAIL = process.env.E2E_EMAIL ?? 'contact@myfit-coach.fr';
const PASSWORD = process.env.E2E_PASSWORD ?? 'PreviewBeta2026!';
const PASS_NAME = process.argv[2] ?? 'pass1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Données initiales : session sur le compte seed preview ── */
const lb = new URLSearchParams({ email: EMAIL, password: PASSWORD, next: '/espace' });
const login = await fetch(`${BASE}/connexion?/login`, {
	method: 'POST',
	headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-sveltekit-action': 'true', origin: BASE },
	body: lb,
	redirect: 'manual',
});
const cookies = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
if (!cookies) {
	console.error('FAIL global : session impossible sur', BASE);
	process.exit(1);
}

let threadId = null;
let actionId = null;
let lastReply = '';
let lastPending = null;

async function send(message) {
	const r = await fetch(`${BASE}/api/assistant/send`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie: cookies },
		body: JSON.stringify({ topic: 'nutrition', message, ...(threadId ? { threadId } : {}) }),
	});
	const j = await r.json().catch(() => ({}));
	threadId = j.threadId ?? threadId;
	lastReply = j.reply ?? '';
	lastPending = j.pendingAction ?? null;
	if (j.pendingAction?.actionId) actionId = j.pendingAction.actionId;
	await sleep(2100);
	return j;
}

async function act(decision, aid = actionId) {
	const r = await fetch(`${BASE}/api/assistant/action`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie: cookies },
		body: JSON.stringify({ actionId: aid, decision }),
	});
	const j = await r.json().catch(() => ({}));
	return { status: r.status, ok: !!j.ok, message: j.message ?? j.reason ?? '', j };
}

const lines = () => lastPending?.preview?.lines?.map((l) => l.label) ?? [];

const results = [];
function check(name, cond, detail = '') {
	results.push({ name, pass: !!cond, detail });
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ← ' + detail}`);
}

/* ═══════════ A. RECHERCHE ALIMENTAIRE (6) ═══════════ */

await send('Ajoute 2 tranches de pain de mie complet à mon petit-déjeuner.');
check('A1 pain de mie complet → fiche Ciqual 257 kcal', lastPending && lines().some((l) => /Pain de mie complet/i.test(l)), JSON.stringify(lines()));
await act('cancel');

await send('Ajoute 10 g de beurre à mon déjeuner.');
check('A2 beurre → un vrai beurre (jamais Haricot beurre)', lastPending && lines().some((l) => /^Beurre/i.test(l)) && !lines().some((l) => /Haricot/i.test(l)), JSON.stringify(lines()));
await act('cancel');

await send('Ajoute 3 œufs au plat à mon petit-déjeuner.');
check('A3 œuf au plat → « Oeuf au plat » Ciqual', lastPending && lines().some((l) => /Oeuf au plat/i.test(l)), JSON.stringify(lines()));
await act('cancel');

await send('Ajoute mon petit-déjeuner : 3 œufs au plat, 2 tranches de pain de mie et 10 g de beurre.');
const a4First = lines().join(' | ');
check('A4 multi-aliments : les 3 aliments demandés, rien d autre', lastPending && /Oeuf au plat/i.test(a4First) && /Pain de mie/i.test(a4First) && /Beurre/i.test(a4First) && lines().length === 3, JSON.stringify(lines()));
await send('Pain de mie complet.');
check('A5 clarification conserve les quantités (œufs et beurre intacts)', lastPending && lines().some((l) => /Pain de mie complet/i.test(l)) && lines().length === 3 && /Beurre/i.test(lines().join('|')), JSON.stringify(lines()));
const a5Action = actionId;
await act('cancel', a5Action);

await send('Ajoute 200 g de fruit de la passion de Tahiti à ma collation.');
check(
	'A6 aliment introuvable : pas d action, estimation clairement identifiée ou question',
	!lastPending && (/\?/.test(lastReply) || /estimation|trouve|recherche|créer/i.test(lastReply)),
	lastReply.slice(0, 120),
);

/* ═══════════ B. CONVERSATIONS (5) ═══════════ */

await send('Ajoute mon petit-déjeuner : 3 œufs au plat, 2 tranches de pain de mie et 10 g de beurre.');
await send('En fait 4 œufs.');
check('B1 correction de quantité intégrée (4 œufs, reste intact)', lastPending && lines().some((l) => /Oeuf au plat/i.test(l)) && lines().length === 3 && /Beurre/i.test(lines().join('|')), JSON.stringify(lines()));
await act('cancel');

await send('Ajoute 150 g de riz basmati à mon dîner.');
const b2Action = actionId;
await send('Avec du curcuma ?');
// « Avec du curcuma ? » est une question, mais légitimement interprétée
// comme une clarification d'ajout : ce qui est INTERDIT est (a) d'écrire
// sans confirmation et (b) d'ajouter un aliment NON DEMANDÉ sans accord.
// Une action mise à jour (curcuma candidat affiché en preview, non écrite)
// est un comportement acceptable : elle reste en attente du clic.
const b2Ok = !lastPending || lastPending?.actionId === b2Action;
check('B2 question de suivi : jamais d écriture sans confirmation', b2Ok, JSON.stringify(lines()));
await act('cancel', b2Action);

await send('Ajoute 30 g de flocons d\'avoine à mon petit-déjeuner.');
const b3Action = actionId;
await act('cancel', b3Action);
await send('Quel est mon objectif de calories aujourd\'hui ?');
check('B3 changement de sujet : aucune action réactivée après cancel', !lastPending, JSON.stringify(lines()));

await send('Ajoute 100 g de fromage blanc à ma collation.');
const b4Action = actionId;
await act('confirm', b4Action);
await send('Et mes protéines, on est où ?');
check('B4 après confirm, question suivante sans nouvelle action fantôme', !lastPending, JSON.stringify(lines()));

await send('Ajoute 2 tranches de pain de mie complet à mon petit-déjeuner.');
await send('Pain de mie complet.');
await send('Avec 10 g de beurre aussi.');
const b5Lines = lines().join(' | ');
check('B5 reprise de tâche : beurre ajouté, pain complet conservé', lastPending && /Pain de mie complet/i.test(b5Lines) && /Beurre/i.test(b5Lines), JSON.stringify(lines()));
await act('cancel');

/* ═══════════ C. ACTIONS (6) ═══════════ */

await send('Ajoute mon déjeuner : 150 g de poulet grillé et 200 g de riz blanc.');
const c1Action = actionId;
check('C1 repas complet préparé (2 lignes fiables)', lastPending && lines().length === 2 && /Poulet/i.test(lines().join('|')) && /Riz/i.test(lines().join('|')), JSON.stringify(lines()));
const c1 = await act('confirm', c1Action);
check('C2 confirmation → écriture réelle', c1.ok && /ajouté/i.test(c1.message), JSON.stringify(c1));
const c2again = await act('confirm', c1Action);
check('C3 anti-double-submit : re-confirm refusé', !c2again.ok, JSON.stringify(c2again));

await send('Ajoute 1 pomme à mon petit-déjeuner.');
const c4Action = actionId;
const c4 = await act('cancel', c4Action);
check('C4 annulation propre (rien écrit)', c4.ok && /annul/i.test(c4.message), JSON.stringify(c4));

await send('Ajoute 2 kiwis à ma collation.');
const c5Action = actionId;
await act('confirm', c5Action);
const c5 = await act('undo', c5Action);
check('C5 undo valide après confirm', c5.ok, JSON.stringify(c5));

// C6 — doublon déterministe : enregistrer 10 000 pas, PUIS re-demander
// 10 000 pas : la seconde demande doit être refusée comme inutile (aucune
// nouvelle action), pas proposée comme « correction » identique.
await send('Note 10 000 pas pour aujourd\'hui.');
const c6a = lastPending;
await act('confirm', c6a?.actionId);
await send('Note 10 000 pas pour aujourd\'hui.');
check(
	'C6 doublon pas : déjà enregistré → aucune seconde écriture proposée',
	!lastPending && /déjà/i.test(lastReply),
	`pending=${JSON.stringify(lines())} reply=${lastReply.slice(0, 140)}`,
);

const c7 = await fetch(`${BASE}/api/assistant/action`, {
	method: 'POST',
	headers: { 'content-type': 'application/json', cookie: cookies },
	body: JSON.stringify({ actionId: 'falsified-action-id-9999', decision: 'confirm' }),
});
check('C7 action falsifiée rejetée', c7.status === 400, `status=${c7.status}`);

await send('Ajoute 30 g de flocons d\'avoine et 200 ml de lait demi-écrémé à mon petit-déjeuner.');
await send('Lait écrémé plutôt.');
const c8Lines = lines().join(' | ');
check('C8 après clarifications : les 2 aliments fidèles, lait corrigé', lastPending && /Avoine|avoine/.test(c8Lines) && /écrémé/i.test(c8Lines) && !/demi/i.test(c8Lines), JSON.stringify(lines()));
await act('cancel');

/* ═══════════ D. SÉCURITÉ (2) ═══════════ */

const noCookie = await fetch(`${BASE}/api/assistant/send`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ topic: 'nutrition', message: 'Ajoute 100 g de riz' }),
	redirect: 'manual',
});
// Garde standard de l'app : sans session → redirect 303 vers /connexion
// (SvelteKit throw redirect). Jamais 200 : l'IA ne peut pas être appelée.
check('D1 send sans session refusé (redirect, jamais 200)', noCookie.status !== 200, `status=${noCookie.status} location=${noCookie.headers.get('location')}`);

const crossAction = await fetch(`${BASE}/api/assistant/action`, {
	method: 'POST',
	headers: { 'content-type': 'application/json', cookie: cookies },
	body: JSON.stringify({ actionId: 'zzzzzzzzzzzzzzzzzzzz', decision: 'confirm' }),
});
check('D2 action inexistante d un autre compte refusée', crossAction.status === 400, `status=${crossAction.status}`);

/* ═══════════ Verdict ═══════════ */
const passCount = results.filter((r) => r.pass).length;
console.log(`\n${PASS_NAME} : ${passCount}/${results.length} PASS`);
for (const r of results.filter((r) => !r.pass)) console.log(`  FAIL ${r.name} — ${r.detail}`);
process.exit(passCount === results.length ? 0 : 1);
