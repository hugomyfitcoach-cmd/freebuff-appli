/**
 * Tests MISSION — Messages du coach : « J'ai lu », avatar du coach, lecture seule.
 *
 * 1. Ouvrir la page Messages ne marque RIEN comme lu (loader sans mutation) ;
 * 2. « J'ai lu » est un geste explicite (Accueil + Messages) qui revalide le
 *    badge de navigation puis la page ;
 * 3. L'avatar du coach est partagé (Accueil, Messages, retours de bilan) ;
 * 4. La requête d'identité coach est en LECTURE SEULE (aucune écriture).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const messagesLoader = read('src/routes/espace/messages/+page.server.ts');
const messagesPage = read('src/routes/espace/messages/+page.svelte');
const accueil = read('src/routes/espace/+page.svelte');
const accueilLoader = read('src/routes/espace/+page.server.ts');
const recap = read('src/lib/components/RecapBilan.svelte');
const historique = read('src/routes/espace/historique/+page.svelte');
const avatar = read('src/lib/components/CoachAvatar.svelte');
const dashboard = read('src/convex/dashboard.ts');

/* ─── 1) Lecture seule à l'ouverture de Messages ─── */

test('Messages : le loader ne marque jamais un message comme lu', () => {
	assert.doesNotMatch(messagesLoader, /markAllCoachMessagesRead|markCoachMessageRead/, 'aucune mutation de lecture au chargement');
});

/* ─── 2) Geste explicite « J'ai lu » ─── */

test('« J\'ai lu » : présent sur l\'Accueil et sur Messages, jamais sur le simple affichage', () => {
	assert.match(accueil, /J'ai lu/, 'bouton Accueil');
	assert.match(messagesPage, /J'ai lu/, 'bouton Messages');
	assert.match(accueil, /onclick=\{markMsgRead\}/, 'Accueil relié à markMsgRead');
	assert.match(messagesPage, /onclick=\{markRead\}/, 'Messages relié à markRead');
});

test('« J\'ai lu » : appelle la route de lecture puis rafraîchit le badge de navigation', () => {
	for (const src of [accueil, messagesPage]) {
		assert.match(src, /fetch\('\/api\/media\/message-read'/, 'route de lecture réelle');
		assert.match(src, /refreshNotificationsNow\(\);/, 'badge recalculé sans attendre le poll');
	}
});

test('Accueil : la carte sort en fondu (out:fade) quand le message est lu', () => {
	assert.match(accueil, /import \{ fade \} from 'svelte\/transition'/);
	assert.match(accueil, /out:fade=\{\{ duration: 220 \}\}/);
});

/* ─── 3) Avatar du coach partagé ─── */

test('Avatar : composant unique réutilisé par Accueil, Messages et retours de bilan', () => {
	assert.match(accueil, /import CoachAvatar from/);
	assert.match(messagesPage, /import CoachAvatar from/);
	assert.match(recap, /import CoachAvatar from/);
	assert.match(historique, /coach=\{data\.coach\}/, 'historique transmet le coach au retour');
});

test('Avatar : repli élégant (initiale) si aucune photo, jamais une image cassée', () => {
	assert.match(avatar, /\{#if url\}/);
	assert.match(avatar, /\{initial\}/);
	assert.match(avatar, /role="img"/);
});

test('Libellé « Ton coach » affiché à côté de l\'avatar', () => {
	assert.match(accueil, /Ton coach/);
	assert.match(messagesPage, /Ton coach/);
	assert.match(recap, /Ton coach/);
});

/* ─── 4) Requête d'identité coach : lecture seule ─── */

test('myCoachProfile : requête Convex en lecture seule (aucun patch / insert / delete)', () => {
	const start = dashboard.indexOf('export const myCoachProfile');
	assert.ok(start > 0, 'requête présente');
	const end = dashboard.indexOf('\n});', start);
	const body = dashboard.slice(start, end);
	assert.match(body, /requireClient\(ctx, sessionToken\)/, 'accès réservé aux clientes connectées');
	assert.doesNotMatch(body, /ctx\.db\.(patch|insert|delete|replace)/, 'aucune écriture');
});

test('Loaders : myCoachProfile est non bloquant (repli null, jamais d\'erreur de page)', () => {
	assert.match(accueilLoader, /myCoachProfile[\s\S]*?\.catch\(\(\) => null\)/);
	assert.match(messagesLoader, /myCoachProfile[\s\S]*?\.catch\(\(\) => null\)/);
});
