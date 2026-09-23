#!/usr/bin/env node
/**
 * Test de régression ciblé — Hotfix 2 :
 *   1) barcode inconnu → analyse étiquette réussie → FICHE « Créés par moi »
 *      (jamais l'écran / scanner Code-barres) ;
 *   2) champ Portion habituelle : aucun scroll programmatique pendant le
 *      focus (cause du clavier « ne répond pas » au premier tap sur iOS).
 *
 * Contrats vérifiés sur le SOURCE de +page.svelte (la transition est une
 * machine à états UI non déclenchable hors navigateur) — le script échoue si
 * quelqu'un réintroduit le retour vers Code-barres ou le scroll au focusin.
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/routes/espace/journal/+page.svelte';
const src = readFileSync(FILE, 'utf8');

let failures = 0;
const check = (cond, label) => {
	console.log(`  ${cond ? '✔' : '✘'} ${label}`);
	if (!cond) failures++;
};

/** Corps d'une fonction top-level, délimité par la déclaration suivante. */
function functionBody(name) {
	const start = src.indexOf(`function ${name}`);
	if (start === -1) return null;
	const next = src.slice(start + 1).search(/\n\t(async )?function |\n\t\/\*\* /);
	return src.slice(start, next === -1 ? undefined : start + 1 + next);
}

const analyze = functionBody('analyzeLabelFile');
const focusScroll = functionBody('focusScroll');
const createFromScan = functionBody('createFromScan');
const switchMode = functionBody('switchMode');

console.log('═══ 1) Transition barcode inconnu → fiche de création ═══');
check(Boolean(analyze), 'analyzeLabelFile trouvé');
if (analyze) {
	// Contrat de succès : ordre exact des mutations d'état après l'analyse.
	const okIdx = analyze.indexOf("createSheetOpen = false;");
	check(okIdx !== -1, 'succès : la feuille « Créer un aliment » se ferme');
	const seq = [
		['createSheetFromScan = false', 'contexte « produit non trouvé » réinitialisé'],
		["if (logMode !== 'search') {", 'mode barcode détecté explicitement'],
		['await stopScanner()', 'scanner arrêté AVANT la sortie de mode'],
		["logMode = 'search'", "sortie de l'écran Code-barres"],
		["searchTab = 'crees'", 'onglet « Créés par moi » activé'],
		['customEditor = true', "fiche de création ouverte"],
	];
	let prev = okIdx;
	for (const [needle, label] of seq) {
		const i = analyze.indexOf(needle, prev);
		check(i !== -1, `succès : ${label}`);
		if (i !== -1) prev = i;
	}
	check(!analyze.includes("switchMode('barcode')"), "succès : JAMAIS de retour au scanner (switchMode('barcode') absent du flow analyse)");
	check(/\bpendingBarcode = pendingBarcode \?\? labelCode/.test(analyze), 'barcode initial conservé puis complété par celui de la photo (jamais écrasé)');
	// Le barcode initial doit être posé au scan inconnu (flow amont intact).
	check(/pendingBarcode = code;\s*\n\s*openLabelCaptureAfterUnknownScan/.test(src), 'amont : scan inconnu → pendingBarcode posé + feuille de création guidée');
	check(/\['ai-unavailable', 'unreachable', 'timeout'\]/.test(analyze), "amont : erreur IA → message utilisateur (barcode conservé, pas d'ouverture scanner)");
}
check(Boolean(switchMode) && /if \(m === 'barcode'\) \{/.test(switchMode), 'switchMode inchangé (flux « Scanner un code-barres » préservé)');

console.log('═══ 2) Clavier Portion habituelle — stable au premier tap ═══');
check(Boolean(focusScroll), 'focusScroll trouvé');
check(Boolean(focusScroll) && !focusScroll.includes('scrollFocusedIntoView('), 'focusin : AUCUN scroll programmatique pendant le focus (cause racine iOS)');
check(/vvScrollTimer = setTimeout\(\(\) => \{[\s\S]*?\}, 200\);/.test(src), 'repositionnement clavier débounce (~200 ms, après le jolt d\'ouverture)');
const vh = src.indexOf('const setVh = () => {');
const vhBody = src.slice(vh, src.indexOf('};', vh));
check(vhBody.includes('stillOpen'), 'repositionnement uniquement si le clavier est toujours ouvert');
check(Boolean(createFromScan) && createFromScan.includes("switchMode('barcode')"), "flow C (Créer un aliment → scanner) INTACT");

console.log(failures === 0 ? '\n✅ Tous les contrats de régression sont respectés.' : `\n❌ ${failures} contrat(s) violé(s).`);
process.exit(failures === 0 ? 0 : 1);
