/**
 * Tests MISSION — Fix coach profile photo disappearing.
 *
 * CAUSE DÉMONTRÉE : la photo du coach n'était stockée QUE dans le localStorage
 * du navigateur du CRM (clé « coach-avatar ») — aucune écriture serveur n'était
 * possible (`users.setProfilePhoto` refusait les comptes coach, le BFF
 * `/api/profile/photo` aussi). Toute éviction des données de site (PWA iOS sous
 * pression de stockage, nettoyage manuel, navigation privée) la faisait donc
 * disparaître au bout de 1-2 jours, et l'initiale revenait.
 *
 * CORRECTIF : la photo vit dans le file storage Convex (`users.profilePhotoStorageId`)
 * via le BFF — le localStorage n'est plus qu'une migration ponctuelle.
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

const coachIdentity = read('src/lib/components/CoachIdentity.svelte');
const users = read('src/convex/users.ts');
const photoRoute = read('src/routes/api/profile/photo/+server.ts');

/* ─── 1) Le CRM ne stocke plus la photo en localStorage ─── */

test('CoachIdentity : aucune persistance localStorage (la photo ne peut plus disparaître)', () => {
	assert.doesNotMatch(coachIdentity, /localStorage\.setItem/, 'jamais d\'écriture localStorage');
	assert.match(coachIdentity, /avatar = data\?\.url \?\? null/, 'la source d\'affichage est la réponse serveur');
});

test('CoachIdentity : migration unique de l\'ancienne photo locale (lecture + suppression de la clé)', () => {
	assert.match(coachIdentity, /localStorage\.removeItem\('coach-avatar'\)/, 'la clé volatile est purgée après migration');
	assert.match(coachIdentity, /uploadPhoto/, 'l\'ancienne copie locale rejoint le stockage serveur');
});

test('CoachIdentity : upload via le BFF /api/profile/photo (jamais Convex directement)', () => {
	assert.match(coachIdentity, /fetch\('\/api\/profile\/photo'/);
	assert.match(coachIdentity, /new FormData\(\)/);
	assert.doesNotMatch(coachIdentity, /convex\/browser/, 'aucun appel Convex depuis le composant');
});

/* ─── 2) Le serveur accepte le compte coach ─── */

test('users.setProfilePhoto : le compte coach peut enregistrer sa photo (garde client-only retirée)', () => {
	assert.doesNotMatch(users, /Réservé aux comptes clients/, 'plus de refus du rôle coach');
	assert.match(users, /ctx\.db\.patch\(user\._id, \{ profilePhotoStorageId: storageId \}\)/, 'persistance durable dans users.profilePhotoStorageId');
});

test('BFF /api/profile/photo : ouvert aux rôles client et coach', () => {
	for (const method of ['GET', 'POST', 'DELETE']) {
		const start = photoRoute.indexOf(`export const ${method}`);
		assert.ok(start > 0, `${method} présent`);
		const body = photoRoute.slice(start, photoRoute.indexOf('\n};', start));
		assert.match(body, /requireRole\(event, \['client', 'coach'\]\)/, `${method} accepte coach + client`);
	}
});

test('BFF : générateur d\'URL d\'upload par rôle (photos=client, media=coach)', () => {
	assert.match(photoRoute, /api\.media\.generateUploadUrl/);
	assert.match(photoRoute, /api\.photos\.generateUploadUrl/);
});

/* ─── 3) La photo du coach est lisible par les clientes (même source) ─── */

test('myCoachProfile expose profilePhotoUrl depuis users.profilePhotoStorageId', () => {
	const dashboard = read('src/convex/dashboard.ts');
	const start = dashboard.indexOf('export const myCoachProfile');
	assert.ok(start > 0, 'requête présente');
	const body = dashboard.slice(start, dashboard.indexOf('\n});', start));
	assert.match(body, /coach\.profilePhotoStorageId/);
	assert.match(body, /ctx\.storage\.getUrl\(coach\.profilePhotoStorageId\)/);
});

/* ─── 4) Confidentialité : la photo n'entre pas dans le cache du service worker ─── */

test('Service worker : les URLs de photo de profil (non marquées gflux-food) ne sont jamais cachées', () => {
	const sw = read('src/service-worker.ts');
	assert.match(sw, /isFoodImgTagged/, 'seules les vignettes alimentaires marquées sont cachées');
	assert.match(sw, /purgePrivateImages/, 'purge de confidentialité à l\'activation');
	const foodImgTag = read('src/lib/foodImgTag.ts');
	assert.match(foodImgTag, /FOOD_IMG_TAG = 'gflux-food'/);
	assert.doesNotMatch(users, /tagFoodImgUrl/, 'la photo de profil garde l\'URL nue (non marquée)');
});
