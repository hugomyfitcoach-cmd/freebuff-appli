/**
 * Mission ÉDITEUR-DOUBLON — Jour 1 inaccessible (`each_key_duplicate`).
 *
 * Incident : dans l'éditeur coach, un circuit (superset/triset) a été créé,
 * un membre en est sorti, puis des exercices ont été déplacés. Depuis, cliquer
 * sur Jour 1 plante l'éditeur, même après rechargement :
 *   « Uncaught Error: https://svelte.dev/e/each_key_duplicate ».
 *
 * Cause : un circuit n'existe que par la CONTIGUÏTÉ de ses membres dans
 * `order`. Une référence de groupe restée sur un exercice séparé des autres
 * (membre sorti, copie insérée au milieu, glisser-déposer) produit DEUX blocs
 * portant le même identifiant ; l'éditeur cléait ces blocs par `block.group`
 * → deux clés identiques → rendu mort.
 *
 * Ces tests exécutent les VRAIES fonctions (plan canonique serveur + découpage
 * d'affichage partagé) sur la séquence de l'incident, puis vérifient la
 * tolérance à une donnée déjà abîmée et le nettoyage au prochain
 * enregistrement. Aucune migration, aucun script sur les données.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { planSessionLayout } from '../src/convex/trainingLayout.ts';
import { supersetBlocks } from '../src/lib/training.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const training = read('src/convex/training.ts');
const layout = read('src/convex/trainingLayout.ts');
const lib = read('src/lib/training.ts');
const editor = read('src/lib/components/TrainingEditor.svelte');
const runner = read('src/lib/components/SessionRunner.svelte');
const bffId = read('src/routes/api/coach/training/session-exercises/[id]/+server.ts');

/* ─────────── Simulateurs : miroirs exacts des mutations Convex ─────────── */

const rows = (ids) => ids.map((id, i) => ({ _id: id, order: i }));

const sortRows = (list) =>
	[...list].sort(
		(a, b) => a.order - b.order || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a._id.localeCompare(b._id)
	);

/** Écriture = plan canonique (miroir de `normalizeSessionLayout`). */
function save(list) {
	const plan = planSessionLayout(list);
	const clear = new Set(plan.clearGroupIds);
	const byId = new Map(list.map((r) => [r._id, r]));
	return plan.orderedIds.map((id) => {
		const r = byId.get(id);
		return { ...r, order: plan.orders.get(id), supersetGroup: clear.has(id) ? undefined : r.supersetGroup };
	});
}

/** Miroir de `setSupersetGroup` (liaison + `detachIds`). */
function link(list, orderedIds, group, detachIds = []) {
	const sorted = sortRows(list);
	const byId = new Map(sorted.map((r) => [r._id, r]));
	const chosen = new Set(orderedIds);
	const ordered = sorted.map((r) => r._id);
	const rest = ordered.filter((id) => !chosen.has(id));
	const firstPos = ordered.findIndex((id) => chosen.has(id));
	rest.splice(firstPos < 0 ? rest.length : firstPos, 0, ...orderedIds);
	const patched = rest.map((id, i) => {
		const r = byId.get(id);
		if (i >= firstPos && i < firstPos + orderedIds.length) return { ...r, order: i, supersetGroup: group };
		if (detachIds.includes(id) && r.supersetGroup === group) return { ...r, order: i, supersetGroup: undefined };
		return { ...r, order: i };
	});
	return save(patched);
}

/** Miroir de `reorderSessionExercises` (glisser-déposer). */
function move(list, orderedIds) {
	const byId = new Map(list.map((r) => [r._id, r]));
	return save(orderedIds.map((id, i) => ({ ...byId.get(id), order: i })));
}

/** Miroir de `duplicateSessionExercise` (copie isolée, juste après la source). */
function duplicate(list, srcId, newId) {
	const sorted = sortRows(list);
	const src = sorted.find((r) => r._id === srcId);
	const copy = { _id: newId, order: src.order, createdAt: (src.createdAt ?? 0) + 1 };
	const ordered = sorted.map((r) => r._id);
	ordered.splice(ordered.indexOf(srcId) + 1, 0, newId);
	const all = [...sorted, copy];
	return save(ordered.map((id, i) => ({ ...all.find((r) => r._id === id), order: i })));
}

/** Miroir de `removeSessionExercise`. */
const remove = (list, id) => save(list.filter((r) => r._id !== id));

const blocksOf = (list) => supersetBlocks(sortRows(list));

/** Ce que Svelte exige : aucune clé d'{#each} en double, aucun faux circuit. */
function assertNoDuplicateKey(list, label) {
	const bs = blocksOf(list);
	const keys = bs.map((b) => b.key);
	assert.equal(new Set(keys).size, keys.length, `${label} : clés de blocs uniques (${keys.join(' | ')})`);
	assert.ok(
		bs.every((b) => !b.group || b.exercises.length >= 2),
		`${label} : un membre seul n'est jamais présenté comme un circuit`
	);
	return bs;
}

/* ═══════════════ 1. La séquence de l'incident ═══════════════ */

test('SÉQUENCE circuit → sortie d\'un membre → déplacement : jamais deux blocs de même clé', () => {
	let s = rows(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);

	// 1) Le coach crée un circuit de 4 exercices.
	s = link(s, ['e2', 'e3', 'e4', 'e5'], 'sup:aa');
	let bs = assertNoDuplicateKey(s, 'circuit créé');
	const created = bs.filter((b) => b.group === 'sup:aa');
	assert.equal(created.length, 1, 'un seul bloc de circuit');
	assert.equal(created[0].exercises.length, 4);

	// 2) Il en sort un membre (« Sortir du groupe ») : la référence part avec.
	s = link(s, ['e2', 'e3', 'e5'], 'sup:aa', ['e4']);
	bs = assertNoDuplicateKey(s, 'membre sorti');
	const afterExit = bs.filter((b) => b.group === 'sup:aa');
	assert.equal(afterExit.length, 1, 'le circuit reste UN bloc');
	assert.equal(afterExit[0].exercises.length, 3);
	assert.equal(s.find((r) => r._id === 'e4').supersetGroup, undefined, 'référence du membre sorti retirée');

	// 3) Il déplace des exercices (dont un membre du circuit).
	s = move(s, ['e1', 'e3', 'e5', 'e4', 'e6', 'e2']);
	const afterMove = assertNoDuplicateKey(s, 'après déplacement');
	assert.equal(afterMove.filter((b) => b.group === 'sup:aa').length, 1, 'le circuit ne se coupe pas au glisser-déposer');
	assert.equal(afterMove.find((b) => b.group === 'sup:aa').exercises.length, 3);
	assert.deepEqual(
		sortRows(s).map((r) => r.order),
		[0, 1, 2, 3, 4, 5],
		'positions réindexées 0..n-1'
	);
	assert.equal(s.length, 6, 'aucun exercice perdu');
});

test('SUPPRIMER un membre d\'un circuit puis déplacer : aucun doublon, aucun circuit orphelin', () => {
	let s = rows(['e1', 'e2', 'e3', 'e4']);
	s = link(s, ['e1', 'e2', 'e3'], 'sup:bb');
	s = remove(s, 'e2');
	const bs = assertNoDuplicateKey(s, 'membre supprimé');
	assert.equal(bs.filter((b) => b.group === 'sup:bb').length, 1);
	assert.equal(bs.find((b) => b.group === 'sup:bb').exercises.length, 2);

	// Il ne reste qu'un membre du groupe : la référence orpheline est retirée.
	s = remove(s, 'e1');
	const last = assertNoDuplicateKey(s, 'circuit réduit à un membre');
	assert.equal(last.filter((b) => b.group).length, 0, 'plus aucun circuit fantôme');
	assert.equal(last.length, 2, 'les exercices restants sont toujours affichés');
});

test('DUPLIQUER un membre d\'un circuit ne le coupe pas en deux blocs', () => {
	let s = rows(['e1', 'e2', 'e3', 'e4']);
	s = link(s, ['e1', 'e2', 'e3'], 'sup:cc');
	s = duplicate(s, 'e2', 'e2-copie');
	const bs = assertNoDuplicateKey(s, 'après duplication');
	assert.equal(bs.filter((b) => b.group === 'sup:cc').length, 1, 'un seul bloc de circuit');
	assert.equal(bs.find((b) => b.group === 'sup:cc').exercises.length, 3, 'le circuit garde ses 3 membres');
	assert.equal(s.length, 5, 'la copie reste affichée (aucune suppression automatique)');
});

/* ═══════════════ 2. Tolérance à une donnée déjà abîmée ═══════════════ */

test('SÉANCE AVEC DOUBLON EXISTANT : rendu sans erreur, rien n\'est supprimé', () => {
	// État de production : circuit découpé (a et c,d séparés par b), positions
	// identiques (c et d en order 2) — la séance plante aujourd'hui l'éditeur.
	const legacy = [
		{ _id: 'a', order: 0, supersetGroup: 'sup:xx' },
		{ _id: 'b', order: 1 },
		{ _id: 'c', order: 2, supersetGroup: 'sup:xx' },
		{ _id: 'd', order: 2, supersetGroup: 'sup:xx', createdAt: 5 },
	];
	const bs = assertNoDuplicateKey(legacy, 'donnée héritée');
	assert.equal(bs.length, 3, 'aucun exercice perdu (c et d restent groupés dans un bloc)');
	const displayed = bs.flatMap((b) => b.exercises.map((e) => e._id));
	assert.equal(displayed.length, 4, 'les 4 exercices sont affichés (dont 2 en double position)');
	assert.deepEqual([...displayed].sort(), ['a', 'b', 'c', 'd'], 'chaque élément apparaît une fois, sans perte');
	assert.equal(bs.filter((b) => b.group === 'sup:xx').length, 1, 'un seul bloc visible porte le groupe découpé');

	// Même donnée côté cliente : découpage partagé, clés de blocs uniques.
	const cliente = assertNoDuplicateKey(legacy, 'vue cliente');
	assert.equal(cliente.reduce((n, b) => n + b.exercises.length, 0), 4);
});

test('TOLÉRANCE : un élément dupliqué s\'affiche deux fois (le coach retire le surplus)', () => {
	const duplicated = [
		{ _id: 'a', order: 0, supersetGroup: 'sup:dd' },
		{ _id: 'a-bis', order: 1, supersetGroup: 'sup:dd' },
		{ _id: 'a-ter', order: 2, supersetGroup: 'sup:dd' },
		{ _id: 'z', order: 3 },
	];
	const bs = assertNoDuplicateKey(duplicated, 'circuit avec un membre dupliqué');
	assert.equal(bs.find((b) => b.group === 'sup:dd').exercises.length, 3);
	assert.equal(bs.flatMap((b) => b.exercises).length, 4, 'aucune déduplication silencieuse');

	// Le coach retire les copies une à une : 2 membres → toujours un circuit.
	const oneLeft = assertNoDuplicateKey(remove(duplicated, 'a-bis'), 'une copie retirée');
	assert.equal(oneLeft.find((b) => b.group === 'sup:dd').exercises.length, 2);

	// Dernier membre seul : le groupe n'est plus un circuit (et reste affiché).
	const after = assertNoDuplicateKey(remove(remove(duplicated, 'a-bis'), 'a'), 'surplus retiré');
	assert.equal(after.filter((b) => b.group).length, 0);
	assert.equal(after.flatMap((b) => b.exercises).length, 2, 'les 2 exercices restants sont visibles');
});

/* ═══════════════ 3. Enregistrement → données nettoyées ═══════════════ */

test('ENREGISTREMENT : positions réindexées et références de circuit orphelines retirées', () => {
	const legacy = [
		{ _id: 'a', order: 0, supersetGroup: 'sup:xx' },
		{ _id: 'b', order: 0 },
		{ _id: 'c', order: 2, supersetGroup: 'sup:xx' },
		{ _id: 'd', order: 2, supersetGroup: 'sup:yy' }, // groupe orphelin (1 membre)
		{ _id: 'e', order: 9 },
	];
	const saved = save(legacy);

	assert.equal(saved.length, legacy.length, 'aucune ligne supprimée');
	assert.deepEqual(
		sortRows(saved).map((r) => r.order),
		[0, 1, 2, 3, 4],
		'positions réindexées 0..n-1, sans doublon'
	);

	const counts = new Map();
	for (const r of saved) if (r.supersetGroup) counts.set(r.supersetGroup, (counts.get(r.supersetGroup) ?? 0) + 1);
	assert.deepEqual([...counts.keys()], ['sup:xx'], 'la référence orpheline a été retirée');
	assert.ok([...counts.values()].every((n) => n >= 2), 'aucun groupe à membre unique');

	const ordered = sortRows(saved).map((r) => r._id);
	const members = ordered.filter((id) => saved.find((r) => r._id === id).supersetGroup === 'sup:xx');
	const first = ordered.indexOf(members[0]);
	assert.deepEqual(
		ordered.slice(first, first + members.length),
		members,
		'les membres du circuit sont contigus après enregistrement'
	);

	// La mise en page est stable : un second enregistrement ne change plus rien.
	assert.deepEqual(save(saved), saved, 'opération idempotente');
});

/* ═══════════════ 4. Le code porte bien le correctif ═══════════════ */

/** Texte d'une mutation exportée (jusqu'à la déclaration suivante). */
function exportBlock(name) {
	const start = training.indexOf(`export const ${name} = mutation({`);
	assert.ok(start >= 0, `mutation ${name} présente`);
	const rest = training.slice(start + 10);
	const end = rest.search(/\nexport (const|async function|function) /);
	return rest.slice(0, end < 0 ? rest.length : end);
}

test('CONVEX : toutes les écritures structurelles appliquent la mise en page canonique', () => {
	for (const name of [
		'addSessionExercise',
		'reorderSessionExercises',
		'duplicateSessionExercise',
		'removeSessionExercise',
		'setSupersetGroup',
	]) {
		assert.ok(
			exportBlock(name).includes('normalizeSessionLayout'),
			`${name} : groupe recollé + positions réindexées dans la même transaction`
		);
	}
	assert.ok(layout.includes('export function planSessionLayout'), 'plan pur et testable');
	assert.ok(!training.includes('renormalizeExerciseOrders'), 'ancienne normalisation (ordres seuls) remplacée');
	assert.ok(
		training.includes('Exercices en double dans le groupe'),
		'un identifiant ne peut pas être référencé deux fois dans le même groupe'
	);
	assert.ok(training.includes('supersetGroup: undefined'), 'délier = retirer la référence');
});

test('UI : blocs de circuit clés par `block.key` (jamais le groupe seul)', () => {
	assert.ok(lib.includes('key: `${b.group}#${n}`'), 'clé = groupe + occurrence');
	assert.ok(lib.includes('iso-${i}'), 'clé de secours indexée pour les exercices isolés');
	assert.ok(editor.includes('as block (block.key)'), 'éditeur : clé unique garantie');
	assert.ok(runner.includes('as block (block.key)'), 'cliente : clé unique garantie');
	assert.ok(!editor.includes('(block.group ??'), 'plus de clé d\'{#each} sur le groupe');
	assert.ok(!/as block, bi \(bi\)/.test(runner), 'plus de bloc indexé sans identifiant');
	assert.ok(runner.includes('`tour-${st.order}-${stIdx}`'), 'séries : clé unique même si `order` est dupliqué');
});

test('BFF + ÉDITEUR : la sortie d\'un membre est atomique (détachement dans le même appel)', () => {
	assert.ok(bffId.includes('detachIds'), 'le BFF transmet les membres sortis');
	assert.ok(editor.includes('detachIds'), 'l\'éditeur détache dans le même PATCH');
	assert.ok(/reorderSuperset\(selectedExercise!\.supersetGroup!, rest, \[selectedExercise!\._id\]\)/.test(editor), 'sortie = 1 appel');
});

test('AUCUNE MIGRATION : schéma inchangé, champ toujours optionnel', () => {
	const schema = read('src/convex/schema.ts');
	assert.ok(schema.includes('supersetGroup: v.optional(v.string())'), 'champ optionnel conservé');
	assert.ok(!layout.includes('ctx.db.delete'), 'le module de mise en page ne supprime rien');
	assert.ok(!layout.includes('delete('), 'aucune suppression dans la mise en page');
});
