/**
 * Tests MISSION — Show coach photo everywhere on client side.
 *
 * Le coach est représenté dans l'app cliente aux emplacements suivants :
 *   1. Accueil — carte « Ton coach » (message du jour ET message global,
 *      même carte : le message global atterrit dans coachMessage) ;
 *   2. Retours de bilan — historique ET détail (RecapBilan, composant unique) ;
 *   3. Page Messages — chaque message du coach.
 * Les badges (compteurs numériques) et les notifications push (icône d'app)
 * ne portent aucune représentation du coach — rien à y remplacer.
 *
 * Garanties testées : chaque emplacement utilise le composant COMMUN
 * CoachAvatar (photo du coach + repli initiale identique partout), alimenté
 * par l'unique source de données `dashboard.myCoachProfile` (photo du coach
 * rattaché à la cliente, sinon celle du compte coach).
 *
 * Exécution : npm test (node --test --experimental-strip-types)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const accueil = read('src/routes/espace/+page.svelte');
const messagesPage = read('src/routes/espace/messages/+page.svelte');
const historique = read('src/routes/espace/historique/+page.svelte');
const recap = read('src/lib/components/RecapBilan.svelte');
const avatar = read('src/lib/components/CoachAvatar.svelte');
const dashboard = read('src/convex/dashboard.ts');

/** Tous les fichiers .svelte de l'app cliente (espace + composants partagés). */
function svelteFiles(dir) {
	const out = [];
	for (const name of readdirSync(join(root, dir))) {
		const p = join(dir, name);
		if (statSync(join(root, p)).isDirectory()) out.push(...svelteFiles(p));
		else if (name.endsWith('.svelte')) out.push(p);
	}
	return out;
}

/* ─── 1) Inventaire : les emplacements recensés utilisent le composant commun ─── */

test('Emplacements recensés : avatar coach UNIQUEMENT via CoachAvatar', () => {
	// Le composant commun est utilisé exactement aux emplacements recensés :
	// carte « Ton coach » (Accueil, message du jour + message global),
	// retours de bilan (RecapBilan = historique + détail), page Messages.
	assert.match(accueil, /import CoachAvatar from/, 'Accueil — carte « Ton coach »');
	assert.match(accueil, /<CoachAvatar /);
	assert.match(recap, /import CoachAvatar from/, 'Retours de bilan (historique + détail)');
	assert.match(recap, /<CoachAvatar /);
	assert.match(messagesPage, /import CoachAvatar from/, 'Page Messages');
	assert.match(messagesPage, /<CoachAvatar /);
	// Historique alimente RecapBilan avec la même source de données.
	assert.match(historique, /coach=\{data\.coach\}/, 'historique transmet le coach au retour');
});

test('Aucune initiale coach codée en dur hors du composant commun', () => {
	// L'app cliente (espace) n'a AUCUN avatar coach parallèle : seul CoachAvatar
	// décide photo / repli initiale. (CoachIdentity, en-tête du CRM, affiche la
	// photo du coach elle-même — hors périmètre cliente.)
	let coachAvatarUsages = 0;
	for (const f of svelteFiles('src/routes/espace')) {
		const src = read(f);
		const usages = (src.match(/<CoachAvatar /g) ?? []).length;
		if (usages > 0) assert.match(src, /import CoachAvatar from/, `${f} : import du composant commun`);
		coachAvatarUsages += usages;
		assert.doesNotMatch(src, /alt="Avatar de/i, `${f} : pas d'avatar coach parallèle`);
	}
	coachAvatarUsages += (recap.match(/<CoachAvatar /g) ?? []).length;
	// Inventaire recensé — 3 usages, tous via le composant commun :
	// carte « Ton coach » (Accueil, message du jour + message global),
	// retours de bilan (RecapBilan = historique + détail), page Messages.
	assert.equal(coachAvatarUsages, 3, 'exactement les emplacements recensés utilisent CoachAvatar');
});

/* ─── 2) Une seule source de données pour tous les écrans ─── */

test('Tous les écrans consomment dashboard.myCoachProfile (prénom + photo)', () => {
	for (const [src, label] of [
		[accueil, 'Accueil'],
		[messagesPage, 'Messages'],
		[historique, 'Historique'],
	]) {
		assert.match(src, /myCoachProfile|data\.coach/, `${label} : identité coach issue de myCoachProfile`);
	}
	// Mêmes props à chaque emplacement : photo d'abord, repli initiale du prénom.
	assert.match(accueil, /url=\{coachProfile\?\.profilePhotoUrl \?\? null\} name=\{coachProfile\?\.prenom \?\? 'Coach'\}/);
	assert.match(messagesPage, /url=\{coachProfile\?\.profilePhotoUrl \?\? null\} name=\{coachProfile\?\.prenom \?\? 'Coach'\}/);
	assert.match(recap, /url=\{coach\?\.profilePhotoUrl \?\? null\} name=\{coach\?\.prenom \?\? 'Coach'\}/);
});

test('myCoachProfile : coach rattaché (createdBy) en priorité, sinon le compte coach', () => {
	const start = dashboard.indexOf('export const myCoachProfile');
	assert.ok(start > 0, 'requête présente');
	const body = dashboard.slice(start, dashboard.indexOf('\n});', start));
	assert.match(body, /me\.createdBy/, 'lien coach → cliente exploité');
	assert.match(body, /q\.eq\(q\.field\("role"\), "coach"\)/, 'repli sur le compte coach');
	assert.match(body, /ctx\.storage\.getUrl\(coach\.profilePhotoStorageId\)/, 'photo CRM servie aux clientes');
});

/* ─── 3) Repli initiale identique partout, jamais d'image cassée ─── */

test('CoachAvatar : repli initiale du prénom, identique quel que soit l\'écran', () => {
	assert.match(avatar, /const initial = \$derived\(\(name\.trim\(\)\.charAt\(0\) \|\| 'C'\)\.toUpperCase\(\)\)/);
	assert.match(avatar, /\{#if url\}/);
	assert.match(avatar, /role="img"/);
	assert.match(avatar, /rounded-full/, 'forme ronde conservée');
});
