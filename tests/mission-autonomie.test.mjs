/**
 * Mission MODE AUTONOMIE / POST-COACHING PAR CLIENTE.
 *
 * Architecture : champ ADDITIF `users.coachingMode` ("coaching" | "autonomy",
 * optionnel) — aucune migration, aucun backfill : le champ ABSENT vaut
 * "coaching" partout (repli sûr), donc toutes les clientes existantes gardent
 * EXACTEMENT leur comportement. En "autonomy" : l'app reste pleinement
 * utilisable (compte, historique, outils) mais les sollicitations de coaching
 * sont coupées (bilan hebdo, échéances mensurations/photos, rappel RDV 12 h,
 * alerte inactivité, push progression, opt-in push, compteurs bilans coach).
 * Le retour en Coaching = retrait du champ (fallback global) → aucune perte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const schema = read('src/convex/schema.ts');
const dashboard = read('src/convex/dashboard.ts');
const coach = read('src/convex/coach.ts');
const notifications = read('src/convex/notifications.ts');
const users = read('src/convex/users.ts');
const reminderPush = read('src/convex/reminderPush.ts');
const push = read('src/convex/push.ts');
const progressionPush = read('src/lib/server/progressionPush.ts');
const espacePage = read('src/routes/espace/+page.svelte');
const espaceLayout = read('src/routes/espace/+layout.svelte');
const pushOptIn = read('src/lib/components/PushOptIn.svelte');
const adminPage = read('src/routes/admin/+page.svelte');
const adminServer = read('src/routes/admin/+page.server.ts');

test('SCHEMA : champ additif optionnel coachingMode — union coaching/autonomy', () => {
	assert.ok(schema.includes('export const coachingModeKind = v.union(v.literal("coaching"), v.literal("autonomy"))'), 'union exportée');
	assert.ok(schema.includes('coachingMode: v.optional(coachingModeKind)'), 'champ optionnel sur users');
	assert.ok(!/coachingMode: v\.(literal|string)\(/.test(schema), 'jamais obligatoire');
});

test('DASHBOARD CLIENTE : fallback "coaching" + gating conditionné à autonomy uniquement', () => {
	assert.ok(dashboard.includes('const coachingMode = user.coachingMode ?? "coaching";'), 'repli sûr : champ absent = coaching');
	assert.ok(dashboard.includes('const autonomy = coachingMode === "autonomy";'), 'gating strict === "autonomy"');
});

test('DASHBOARD CLIENTE : en autonomie — bilan, échéances mensurations/photos et rappel RDV coupés', () => {
	assert.ok(dashboard.includes('const bilanDue = !autonomy && windowOpen && !currentWeekCheckin;'), 'bilan hebdo plus demandé');
	assert.ok(dashboard.includes('if (!autonomy && daysSince >= MEASUREMENTS_PERIOD_DAYS)'), 'mensurations non dues');
	assert.ok(dashboard.includes('if (!autonomy && monthsSince >= 1)'), 'photos non dues');
	assert.ok(dashboard.includes('if (nextAppt && !autonomy && nextStartMs - ts <= 12 * 3600 * 1000)'), 'rappel RDV coupé');
});

test('DASHBOARD CLIENTE : expose coachingMode + pushOptInAllowed (règle serveur pour le front)', () => {
	assert.ok(dashboard.includes('coachingMode,'), 'coachingMode renvoyé');
	assert.ok(dashboard.includes('pushOptInAllowed: !autonomy,'), 'pushOptInAllowed = !autonomy');
});

test('FRONT CLIENTE : outils conservés — seuls les sollicitations pesées x/3 disparaissent', () => {
	assert.ok(espacePage.includes("const autonomy = $derived((dash?.coachingMode ?? 'coaching') === 'autonomy');"), 'dérivé front avec fallback');
	const gates = (espacePage.match(/\{#if !autonomy\}|\{:else if !autonomy\}/g) || []).length;
	assert.ok(gates === 3, `3 gates UI (badge pesées, ligne progression, recap) — trouvé ${gates}`);
	assert.ok(espacePage.includes("coachingMode?: 'coaching' | 'autonomy';"), 'type Dashboard étendu');
	assert.ok(espacePage.includes('pushOptInAllowed?: boolean;'), 'type pushOptInAllowed');
});

test('PUSH OPT-IN : composant gated (allowed, défaut true = comportement historique)', () => {
	assert.ok(pushOptIn.includes('let { allowed = true }: { allowed?: boolean } = $props();'), 'props avec défaut');
	assert.ok(pushOptIn.includes('if (!allowed) return;'), '$effect court-circuité');
	assert.ok(pushOptIn.includes("{#if allowed && phase !== 'hidden'}"), 'bannette jamais rendue');
	assert.ok(espaceLayout.includes('allowed={data.dashboard?.pushOptInAllowed ?? true}'), 'layout passe la règle serveur');
});

test('COACH : publicUser expose le mode + updateClient écrit/retire le champ (aller-retour)', () => {
	assert.ok(coach.includes('coachingMode: user.coachingMode ?? "coaching",'), 'publicUser avec fallback');
	assert.ok(coach.includes('coachingMode: v.optional(v.union(coachingModeKind, v.null()))'), 'arg coach : coaching/autonomy/null');
	assert.ok(coach.includes('patch.coachingMode = coachingMode === "autonomy" ? "autonomy" : undefined;'), 'null → champ retiré = retour coaching');
});

test('BILANS BOARD : les clientes autonomy n’apparaissent plus (à traiter + manquants)', () => {
	assert.ok(coach.includes('if ((u.coachingMode ?? "coaching") === "autonomy") continue;'), 'skip boucle toTreat/feedbackSent');
	assert.ok(coach.includes('if ((u.coachingMode ?? "coaching") === "autonomy") return false;'), 'exclue des manquants par semaine');
});

test('NOTIFICATIONS COACH : pas d’alerte d’inactivité pour les clientes autonomy', () => {
	assert.ok(notifications.includes('if ((u.coachingMode ?? "coaching") === "autonomy") continue;'), 'skip dans tick');
});

test('RAPPEL RDV 12 H (push) : skip autonomy côté cron', () => {
	assert.ok(users.includes('coachingMode: u.coachingMode ?? "coaching",'), 'internalUserById expose le mode');
	assert.ok(reminderPush.includes('if ((user.coachingMode ?? "coaching") === "autonomy") continue;'), 'tick reminderPush skip');
});

test('PUSH PROGRESSION : coupé en autonomy (serveur, après relue snooze)', () => {
	assert.ok(push.includes('coachingMode: u.coachingMode ?? "coaching",'), 'progressionSnoozeState renvoie le mode');
	assert.ok(progressionPush.includes("if (state?.coachingMode === 'autonomy') return 0;"), 'sendProgressionPush → 0');
});

test('UI COACH : bloc STATUT D’ACCOMPAGNEMENT dans la fiche (select + explication)', () => {
	assert.ok(adminPage.includes('name="coachingMode"'), 'select présent');
	assert.ok(adminPage.includes('Statut d&#x27;accompagnement') || adminPage.includes("Statut d'accompagnement"), 'libellé du bloc');
	assert.ok(adminPage.includes('Coaching actif (défaut)'), 'option coaching par défaut');
	assert.ok(adminPage.includes('Autonomie / Post-coaching'), 'option autonomie');
	assert.ok(adminPage.includes('historique et tous ses outils'), 'explication conservée');
});

test('UI COACH : badges Autonomie (tableau clientes + en-tête Vision 360)', () => {
	assert.ok(adminPage.includes('>Autonomie</span>'), 'badge présent');
	assert.ok((adminPage.match(/>Autonomie<\/span>/g) || []).length >= 2, 'au moins tableau + 360');
});

test('UI COACH : filtre CRM Coaching/Autonomie avec compteurs', () => {
	assert.ok(adminPage.includes("'all' | 'active' | 'inactive' | 'coaching' | 'autonomy'"), 'type ClientFilter étendu');
	assert.ok(adminPage.includes('Coaching ({clientCounts.coaching})'), 'chip coaching');
	assert.ok(adminPage.includes('Autonomie ({clientCounts.autonomy})'), 'chip autonomy');
	assert.ok(adminPage.includes("clientFilter === 'coaching'"), 'branche filtre coaching');
	assert.ok(adminPage.includes("clientFilter === 'autonomy'"), 'branche filtre autonomy');
});

test('KPI COACH : totalWaiting ignore les clientes autonomy (pollution coupée)', () => {
	assert.ok(adminPage.includes("coachingModeOf(c.user) === 'autonomy' ? 0 : c.waiting"), 'compteur neutralisé');
});

test('ACTION SERVEUR : updateFiche transmet coachingMode (autonomy / null / inchangé)', () => {
	assert.ok(adminServer.includes("coachingModeRaw === 'autonomy' ? 'autonomy' : coachingModeRaw === 'coaching' ? null : undefined"), 'mapping formulaire');
	assert.ok(adminServer.includes('coachingMode,'), 'passé à la mutation');
});

test('RÉTROCOMPATIBILITÉ : le fallback "coaching" est partout (aucune cliente ne bascule)', () => {
	const dblQuotes = (src) => (src.match(/\?\? "coaching"/g) || []).length;
	const sq = (src) => (src.match(/\?\? 'coaching'/g) || []).length;
	assert.ok(dblQuotes(dashboard) >= 1, 'dashboard');
	assert.ok(dblQuotes(coach) >= 3, 'coach (publicUser, board, manquants)');
	assert.ok(dblQuotes(notifications) >= 1, 'notifications');
	assert.ok(dblQuotes(users) >= 1, 'users');
	assert.ok(dblQuotes(reminderPush) >= 1, 'reminderPush');
	assert.ok(dblQuotes(push) >= 1, 'push');
	assert.ok(sq(espacePage) >= 1, 'espace page');
	assert.ok(coach.includes('coachingMode: user.coachingMode ?? "coaching"'), 'aucun champ forcé à autonomy');
});

test('AUCUNE DONNÉE SUPPRIMÉE : le retrait du champ ne touche que coachingMode (updateClient)', () => {
	const upd = coach.slice(coach.indexOf('export const updateClient'), coach.indexOf('export const updateClientGoals') > 0 ? coach.indexOf('export const updateClientGoals') : undefined);
	assert.ok(upd.includes('patch.coachingMode'), 'seul patch du mode');
	assert.ok(!/delete.*coachingMode|remove\(\s*["']coachingMode/.test(upd), 'jamais de delete dédié');
});
