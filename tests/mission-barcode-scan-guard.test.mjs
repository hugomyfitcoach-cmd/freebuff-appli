/**
 * Mission FIABILISATION SCANNER CODE-BARRES (audit → correction).
 *
 * Symptôme Mélanie : scan caméra → parfois mauvais numéro (code logistique
 * CODE_128/ITF/CODE_39 numérique, ou fausse lecture) → recherche avec un
 * code fantôme → « produit introuvable ». La saisie manuelle du VRAI EAN
 * marchait toujours.
 *
 * Correctif (100 % client, zéro Convex/OFF/schema/images) :
 *  - `normalizeProductCode` devient LE filtre : longueur GTIN 8/12/13/14 +
 *    checksum GS1 (l'ancienne formule était fausse pour 14 chiffres — poids
 *    calculés depuis la gauche) ; UPC-A réécrit en EAN-13 (préfixe 0) ;
 *  - `createScanGate` : 2 lectures IDENTIQUES rapprochées (≤ maxGapMs)
 *    avant tout callback — une frame seule ne suffit plus ; lecture
 *    invalide = rejet silencieux (jamais de recherche, jamais de message) ;
 *  - la boucle de scan et `handleScan` (côté page) passent tous deux par
 *    cette validation — BarcodeDetector COMME ZXing.
 *
 * Méthode (même convention que mission-off-name-fallback) : le VRAI code de
 * barcodeScanner.ts est extrait vers un module temporaire exécuté par node
 * (strip-types) — on teste les vraies fonctions, pas une copie.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const scanner = read('src/lib/barcodeScanner.ts');
const journal = read('src/routes/espace/journal/+page.svelte');

/* ─── Extraction du VRAI code de barcodeScanner.ts ─── */

function extractBlock(src, marker) {
	const start = src.indexOf(marker);
	assert.ok(start >= 0, `marqueur introuvable : ${marker}`);
	let depth = 0;
	for (let i = src.indexOf('{', start); i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}') {
			depth--;
			if (depth === 0) return src.slice(start, i + 1);
		}
	}
	assert.fail(`accolades non appariées : ${marker}`);
}

const tmpPath = join(__dirname, '.barcode-scan-guard-tmp.mts');
try {
	unlinkSync(tmpPath);
} catch {}
writeFileSync(
	tmpPath,
	[
		'// Extrait automatiquement de src/lib/barcodeScanner.ts — NE PAS ÉDITER',
		// Compteurs de ressources (sonde anti-fuite V3.2) — déclarés AVANT les
		// fonctions qui les utilisent, sous forme d'objet mutable : l'extraction
		// par bloc ne prend pas les `let` top-level du module.
		'const probeState = { sessionsStarted: 0, sessionsAlive: 0, cameraStreamsOpen: 0, maxConcurrentLoops: 0 };',
		'function scannerResourceProbe() { return { ...probeState }; }',
		extractBlock(scanner, 'export function normalizeProductCode'),
		extractBlock(scanner, 'function eanChecksumValid'),
		extractBlock(scanner, 'export function createScanGate'),
	].join('\n\n'),
	'utf8'
);

const { normalizeProductCode, createScanGate } = await import(pathToFileURL(tmpPath).href);

/* Nettoyage du module temporaire après la suite (même convention que off). */
after(() => {
	try {
		unlinkSync(tmpPath);
	} catch {}
});

/* ─── GTIN réels (checksums vérifiés manuellement, formule GS1 officielle) ─── */

const EAN13_OK = '4006381333931'; // EAN-13 réel (Stabilo Boss)
const EAN13_INVALID = '4006381333932'; // même produit, clé ×0 → faux
const EAN8_OK = '96385074'; // EAN-8 réel (exemple GS1/Wikipedia)
const EAN8_INVALID = '96385075';
const UPCA_OK = '036000291452'; // UPC-A réel → normalisé 0036000291452
const GTIN14_OK = '01234567890128'; // GTIN-14 réel (ex. GS1) ; l'ancien code le rejetait
const GTIN14_INVALID = '01234567890129';

/* ─── A. normalizeProductCode — longueurs + checksum ─── */

test('A1. EAN-13 valide accepté et rendu tel quel', () => {
	assert.equal(normalizeProductCode(EAN13_OK), EAN13_OK);
});

test('A2. EAN-8 valide accepté', () => {
	assert.equal(normalizeProductCode(EAN8_OK), EAN8_OK);
});

test('A3. UPC-A valide accepté et réécrit en EAN-13 (préfixe 0)', () => {
	assert.equal(normalizeProductCode(UPCA_OK), `0${UPCA_OK}`);
});

test('A4. GTIN-14 valide accepté (checksum GS1 corrigé)', () => {
	assert.equal(normalizeProductCode(GTIN14_OK), GTIN14_OK);
});

test('A5. checksum faux rejeté (13, 8 et 14 chiffres)', () => {
	assert.equal(normalizeProductCode(EAN13_INVALID), null);
	assert.equal(normalizeProductCode(EAN8_INVALID), null);
	assert.equal(normalizeProductCode(GTIN14_INVALID), null);
});

test('A6. mauvais nombre de chiffres rejeté (7, 9-11, 15) + non-digits', () => {
	for (const bad of [
		'1234567', // 7
		'123456789', // 9
		'1234567890', // 10
		'12345678901', // 11
		'123456789012345', // 15
		'abc',
		'',
	]) {
		assert.equal(normalizeProductCode(bad), null, `devrait rejeter « ${bad} »`);
	}
});

test('A7. entrée nulle / undefined rejetée sans exception', () => {
	assert.equal(normalizeProductCode(null), null);
	assert.equal(normalizeProductCode(undefined), null);
});

/* ─── B. createScanGate — confirmation multi-frames ─── */

test('B1. première lecture seule → pending, AUCUNE recherche', () => {
	const gate = createScanGate(2);
	const r = gate.submit(EAN13_OK);
	assert.equal(r.verdict, 'pending');
	assert.equal(r.code, EAN13_OK);
});

test('B2. deuxième lecture identique → confirmed avec le code normalisé', () => {
	const gate = createScanGate(2);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	const r2 = gate.submit(EAN13_OK);
	assert.equal(r2.verdict, 'confirmed');
	assert.equal(r2.code, EAN13_OK);
});

test('B3. deux lectures différentes → compteur réinitialisé (pending)', () => {
	const gate = createScanGate(2);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	// Code différent mais valide : le compteur repart à 1.
	assert.equal(gate.submit(UPCA_OK).verdict, 'pending');
	// La valeur d'origine relue une seule fois ne reconfirme pas.
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	// Et la deuxième relecture consécutive confirme.
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

test('B4. lecture invalide intercalée → rejet silencieux + compteur remis à zéro', () => {
	const gate = createScanGate(2);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	// Code logistique CODE_128/ITF numérique (longueur non GTIN) ou checksum faux.
	assert.deepEqual(gate.submit('246802468'), { verdict: 'rejected', code: '' });
	assert.deepEqual(gate.submit(EAN13_INVALID).verdict, { verdict: 'rejected', code: '' }.verdict);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending'); // il faut 2 bonnes lectures à nouveau
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

test('B5. deux lectures valides séparées de trop longtemps → recompte (gap max)', () => {
	const gate = createScanGate(2, 50);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	const t0 = Date.now();
	while (Date.now() - t0 < 80) {
		// attente active > maxGapMs (50 ms) : la 2e lecture est trop tardive
	}
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending', 'la 2e lecture hors délai doit recompter');
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

test('B6. required=1 (usage futur) se comporte comme avant la porte', () => {
	const gate = createScanGate(1);
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

test('B7. reset() remet la confirmation à zéro', () => {
	const gate = createScanGate(2);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	gate.reset();
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
});

/* —── Mission scanner V3 : fenêtre glissante (2 lectures parmi 4 en 1200 ms) ──— */

test('V3.1. fenêtre glissante : 2 lectures identiques parmi les 4 dernières confirment même avec lectures ratées', () => {
	const gate = createScanGate(2, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	// Lecture « ratée » (frame illisible → decodeOnce renvoie null : rien
	// n'est soumis) simulée par un autre code valide différent — non, on
	// garde le scénario RÉEL : une frame sans détection n'appelle PAS submit.
	// Donc : 2e lecture identique rapprochée = confirmation, inchangé.
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

test('V3.2. deux décodages RÉELS exigés : une seule lecture ne suffit jamais', () => {
	const gate = createScanGate(2, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	assert.equal(gate.submit(EAN8_OK).verdict, 'pending'); // alternance : fenêtre vidée
	assert.equal(gate.submit(EAN8_OK).verdict, 'confirmed'); // 2 lectures réelles du 2e code
});

test('V3.3. fenêtre de 1200 ms : la 2e lecture à +900 ms confirme (ancien gap 700 ms échouait)', () => {
	const gate = createScanGate(2, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	const t0 = Date.now();
	while (Date.now() - t0 < 900) {
		// attente active 900 ms : < 1200 ms → la fenêtre glissante accepte
	}
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

test('V3.4. au-delà de la fenêtre (1350 ms) : recompte depuis zéro', () => {
	const gate = createScanGate(2, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	const t0 = Date.now();
	while (Date.now() - t0 < 1350) {
		// attente active > fenêtre
	}
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending', 'hors fenêtre : recompte');
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

test('V3.5. après confirmation, la fenêtre repart de zéro (deux produits successifs)', () => {
	const gate = createScanGate(2, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
	// Produit suivant : la confirmation précédente est consommée.
	assert.equal(gate.submit(EAN8_OK).verdict, 'pending');
	assert.equal(gate.submit(EAN8_OK).verdict, 'confirmed');
});

test('V3.6. faux positifs : alternance rapide de codes VALIDES différents jamais confirmée', () => {
	const gate = createScanGate(2, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	assert.equal(gate.submit(EAN8_OK).verdict, 'pending'); // vide la fenêtre
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending'); // 1re lecture seule
	assert.equal(gate.submit(EAN8_OK).verdict, 'pending'); // vide encore
	// Aucun des deux codes n'a jamais atteint 2 lectures consécutives.
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
});

/* —── Mission V3.2 : MODE B (1 lecture, expérimental, Preview uniquement) ──— */

test('V3.2-B1. mode B : UNE seule lecture valide suffit (required=1, checksum conservé)', () => {
	const gate = createScanGate(1, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed', '1 lecture valide = confirmation immédiate');
});

test('V3.2-B2. mode B : checksum et formats restent STRICTS (code invalide rejeté)', () => {
	const gate = createScanGate(1, 1200);
	assert.deepEqual(gate.submit(EAN13_INVALID), { verdict: 'rejected', code: '' });
	assert.deepEqual(gate.submit('246802468'), { verdict: 'rejected', code: '' });
	assert.equal(gate.submit(EAN8_OK).verdict, 'confirmed');
});

test('V3.2-B3. mode B : deux codes successifs distincts = deux détections (fenêtre consommée)', () => {
	const gate = createScanGate(1, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
	assert.equal(gate.submit(EAN8_OK).verdict, 'confirmed');
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

test('V3.2-B4. le mode A reste le défaut : createScanGate(2, …) exigé par la boucle hors mode B', () => {
	// La boucle choisit required=1 SEULEMENT en mode B (garde PROD + opt-in) :
	assert.match(scanner, /createScanGate\(1, SCAN_CONFIRM_GAP_MS\) : createScanGate\(2, SCAN_CONFIRM_GAP_MS\)/);
	assert.match(scanner, /resolveScanMode\(\)/);
});

test('V3.2-B5. le mode B est impossible en production (garde de build CONTEXT)', () => {
	// ⚠️ import.meta.env.PROD vaut TRUE sur une Deploy Preview Netlify (build
	// de production Vite) : la garde est le flag de build __SCANNER_EXPERIMENT__,
	// calculé dans vite.config.ts depuis le CONTEXTE NETLIFY (deploy-preview /
	// branch-deploy uniquement), PAS depuis PROD.
	assert.match(scanner, /!__SCANNER_EXPERIMENT__\) return 'A'/);
	const resolve = extractBlock(scanner, 'function resolveScanMode');
	assert.match(resolve, /env === 'B' \? 'B' : 'A'/);
});

test('V3.2-B6. la garde de build est le CONTEXTE NETLIFY, pas import.meta.env.PROD', () => {
	// Le flag __SCANNER_EXPERIMENT__ doit être défini dans vite.config.ts à
	// partir de CONTEXT (deploy-preview | branch-deploy | dev), jamais de PROD :
	// une Deploy Preview est un build Vite de production (PROD=true).
	const viteCfg = read('vite.config.ts');
	assert.match(viteCfg, /__SCANNER_EXPERIMENT__/);
	assert.match(viteCfg, /CONTEXT === 'deploy-preview'/);
	assert.match(viteCfg, /CONTEXT === 'branch-deploy'/);
	assert.match(viteCfg, /NODE_ENV !== 'production'/);
	// Aucune garde résiduelle sur PROD dans le module :
	assert.doesNotMatch(scanner, /!import\.meta\.env\.PROD \? 'B'/);
});

test('V3.2-D1. mode debug : opt-in URL, jamais en production, aucune image', () => {
	assert.match(scanner, /scannerDebug.*=== '1'/);
	assert.match(scanner, /__SCANNER_EXPERIMENT__ && new URLSearchParams/);
	// Aucune télémétrie réseau dans le module (fetch déjà interdit par C3) :
	assert.doesNotMatch(scanner, /telemetry|analytics|sentry/i);
});

test('V3.7. lecture invalide au milieu : rejet silencieux + fenêtre vidée (2 lectures réelles exigées après)', () => {
	const gate = createScanGate(2, 1200);
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	assert.deepEqual(gate.submit(EAN13_INVALID), { verdict: 'rejected', code: '' });
	assert.equal(gate.submit(EAN13_OK).verdict, 'pending');
	assert.equal(gate.submit(EAN13_OK).verdict, 'confirmed');
});

/* ─── C. Câblage page + invariant moteurs + périmètre ─── */

test('C1. handleScan utilise normalizeProductCode (fin de validation côté page)', () => {
	assert.match(journal, /async function handleScan\([\s\S]{0,600}normalizeProductCode\(decoded\)/, 'handleScan doit valider via normalizeProductCode');
	assert.doesNotMatch(journal, /const code = decoded\.replace\(\/\\D\/g, ''\);\s*\n\s*if \(code\.length < 8\) return;/, 'la validation faible (length>=8) doit avoir disparu de handleScan');
});

test('C2. BarcodeDetector et ZXing passent par la même validation (boucle unique gate.submit)', () => {
	// La porte est branchée dans la boucle de scan, au-dessus des deux moteurs :
	// decodeOnce() (qui choisit BarcodeDetector OU ZXing) → gate.submit → onDecoded.
	// Mission V3.2 : la porte est sélectionnée par mode (A = required 2, B = 1),
	// le défaut reste 2 lectures (mode A). L'invariant de la boucle unique tient.
	assert.match(scanner, /const gate = scanMode === 'B' \? createScanGate\(1, SCAN_CONFIRM_GAP_MS\) : createScanGate\(2, SCAN_CONFIRM_GAP_MS\)/);
	const iSubmit = scanner.indexOf('gate.submit(text)');
	const iCall = scanner.indexOf('onDecoded(res.code)');
	assert.ok(iSubmit >= 0, 'gate.submit(text) doit exister dans la boucle de scan');
	assert.ok(iCall > iSubmit, 'onDecoded ne doit être appelé qu APRÈS le passage dans la porte');
	assert.equal(scanner.indexOf('onDecoded('), iCall, 'aucun autre appel direct de onDecoded (lecture brute interdite)');
	// onDecoded n'est plus appelé directement sur une lecture brute :
	assert.doesNotMatch(scanner, /onDecoded\(text\)/);
});

/* —── Mission V3.2 : ralentissement après plusieurs scans ──— */

test('V3.2-R1. stop() est idempotent : boucle/flux/timers nettoyés une seule fois', () => {
	// Double stop() ne doit ni planter ni décrémenter deux fois la sonde :
	assert.ok(scanner.includes('if (stopped) return; // idempotent'));
	assert.match(scanner, /sessionsAlive = Math\.max\(0, sessionsAlive - 1\)/);
});

test('V3.2-R2. la sonde de ressources existe et est exposée (mémoire, pas réseau)', () => {
	assert.match(scanner, /export function scannerResourceProbe/);
	assert.match(scanner, /resources: scannerResourceProbe\(\)/);
	// Aucun envoi réseau : la sonde est purement locale (invariant C3).
	assert.doesNotMatch(scanner, /telemetry|analytics|sentry/i);
});

test('V3.2-R3. échec d ouverture caméra : la session n entre jamais en boucle (compteur corrigé)', () => {
	assert.ok(scanner.includes('if (!stream) {'));
	assert.ok(scanner.includes('sessionsAlive--')); // décrément avant tout throw
});

test('V3.2-R4. la référence média du <video> est libérée au stop (srcObject = null)', () => {
	assert.ok(scanner.includes('if (video.srcObject) video.srcObject = null;'));
});

test('V3.2-R5. quitter le Journal arrête le scanner (aucune session en arrière-plan)', () => {
	const journal = read('src/routes/espace/journal/+page.svelte');
	// beforeNavigate appelle stopScanner() : la caméra et la boucle ne
	// survivent pas à la navigation (cumul de sessions = ralentissements).
	const iNav = journal.indexOf('beforeNavigate(');
	const iStop = journal.indexOf('void stopScanner();', iNav);
	assert.ok(iNav >= 0 && iStop > iNav && iStop - iNav < 500, 'stopScanner() doit être appelé dans beforeNavigate');
});

test('V3.2-R6. comptage caméra cohérent : un seul getUserMedia par session, décrémenté au stop', () => {
	// Un seul increment par getUserMedia réussi...
	assert.equal((scanner.match(/cameraStreamsOpen\+\+/g) ?? []).length, 1);
	// ...et un seul décrément au stop (idempotence via stopped).
	assert.equal((scanner.match(/cameraStreamsOpen = Math\.max\(0, cameraStreamsOpen - 1\)/g) ?? []).length, 1);
});

test('C3. la porte n appelle ni fetch, ni OFF (module pur côté client, zéro réseau)', () => {
	// Aucun appel réseau dans le module : la recherche reste dans lookupCode.
	assert.doesNotMatch(scanner, /fetch\(|openfoodfacts|XMLHttpRequest|axios/i);
});

test('C4. zéro changement Convex / OFF / schema / images (périmètre respecté)', () => {
	const off = read('src/convex/off.ts');
	const schema = read('src/convex/schema.ts');
	// Marqueurs du fallback OFF de dc3468d toujours en place (non régressé) :
	assert.match(off, /function resolveProductName/);
	assert.match(off, /const name = resolveProductName\(p\);/);
	// Le fallback client récent (fallback récemment corrigé) reste branché :
	assert.match(journal, /\/api\/foods\/barcode\?code=/);
});

test('C5. saisie manuelle inchangée (ne passe PAS par la porte caméra)', () => {
	// submitManual garde sa logique (≥ 8 chiffres → lookupCode), inchangée :
	assert.match(journal, /function submitManual\(target: 'journal' \| 'meal' = 'journal'\) \{\s*\n\t\tconst code = barcodeManual\.replace\(\/\\D\/g, ''\);\s*\n\t\tif \(code\.length >= 8\) void lookupCode\(code, target\);/);
	// handleScan n'est PAS le chemin de la saisie manuelle :
	assert.doesNotMatch(journal, /function submitManual[\s\S]{0,200}normalizeProductCode/);
});

/* ─── Mission V3.4 : TRY_HARDER adaptatif (ZXing uniquement, Preview opt-in) ── */

test('V3.4-S1. la stratégie TH est résolue au démarrage : native → pas de passe TH', () => {
	// BarcodeDetector présent → thStrategy = 'native' : shouldTryHarder() n'est
	// JAMAIS appelé (décodeur natif, pas de ZXing). Invariant moteur unique.
	assert.match(scanner, /if \(native\) return 'native';/);
});

test('V3.4-S2. les trois stratégies ZXing existent avec les seuils calibrés', () => {
	assert.match(scanner, /'fixed-1of4' \| 'adaptive-boost' \| 'adaptive-cooldown' \| 'native'/);
	assert.match(scanner, /TH_BOOST_AFTER_FRAMES = 8/);
	assert.match(scanner, /TH_COOLDOWN_AFTER_FRAMES = 12/);
	assert.match(scanner, /TH_PERIOD = 4/);
});

test('V3.4-S3. l activation boost/cooldown est opt-in Preview uniquement (?scannerTH=)', () => {
	assert.match(scanner, /__SCANNER_EXPERIMENT__ && typeof window !== 'undefined'/);
	assert.match(scanner, /get\('scannerTH'\)/);
	assert.match(scanner, /return 'fixed-1of4';/); // défaut invariant
});

test('V3.4-S4. instrumentation complète exposée dans debugInfo (moteur + passes + coût)', () => {
	// La pastille expose la stratégie active, le nombre de frames légères et
	// profondes, et le coût cumulé TH — requis pour le protocole terrain.
	for (const field of ['zxingLightFrames', 'zxingHardFrames', 'zxingHardMs', 'thStrategy']) {
		assert.ok(scanner.includes(`${field}:`), `debugInfo doit exposer ${field}`);
	}
	// La passe TH mesure son coût réel (performance.now) : pas d'estimation.
	assert.match(scanner, /const tHard0 = performance\.now\(\)/);
	assert.match(scanner, /hardMsTotal \+= performance\.now\(\) - tHard0/);
});

test('V3.4-S5. la boucle réinitialise l absence de lecture (sans fuite mémoire)', () => {
	assert.match(scanner, /if \(text\) consecutiveNoRead = 0;/);
	assert.match(scanner, /else consecutiveNoRead\+\+;/);
});

/* ─── Mission V3.4-b : correctif des passes mortes (NotFoundException) ─── */

test('V3.4-B1. chaque passe ZXing a son propre try/catch (les passes crop et TH s exécutent réellement)', () => {
	// BUG historique démontré (tools/repro-dead-passes.mts) : le MultiFormatReader
	// LÈVE NotFoundException au lieu de renvoyer null ; l'unique try/catch de
	// decodeOnce court-circuitait crop + TRY_HARDER sur toute frame en échec —
	// preuve terrain 428L/0H · 0 ms TH cum. Trois try/catch distincts requis.
	const decode = extractBlock(scanner, 'const decodeOnce =');
	assert.match(decode, /catch \{\s*\/\/ NotFoundException : rien lu cette frame/);
	assert.match(decode, /catch \{\s*\/\/ NotFoundException sur le crop/);
	assert.match(decode, /hardMsTotal \+= performance\.now\(\) - tHard0;/g);
	// Le compteur TH est incrémenté dans les DEUX chemins (succès ET NotFound) :
	assert.equal((decode.match(/hardFrames\+\+/g) ?? []).length, 2);
});

test('V3.5-S2. la passe bande serrée n affecte ni la passe 1 ni la passe TH (référence conservée)', () => {
	// La passe V3.5 ne tourne QUE sur les frames SANS passe TH (et jamais en
	// natif : elle est dans la branche ZXing), et a ses propres try/catch :
	// le défaut hors opt-in est bit-identique à V3.4-b.
	const decode = extractBlock(scanner, 'const decodeOnce =');
	assert.match(decode, /if \(cropExperiment && !shouldTryHarder\(\)\)/);
	assert.match(decode, /const tightReader = new zxingMod\.MultiFormatReader\(false, hints\)/);
	// Compteurs propres (pas de mélange avec hardFrames) :
	assert.match(decode, /tightFrames\+\+/);
	assert.match(decode, /tightMs \+= performance\.now\(\) - tTight0/);
});

test('V3.5-S3. instrumentation bande serrée exposée (pastille + debugInfo)', () => {
	for (const field of ['cropExperiment', 'tightFrames', 'tightMs']) {
		assert.ok(scanner.includes(`${field},`), `debugInfo doit exposer ${field}`);
	}
	// La pastille affiche le coût quand l'expérimentation est active.
	assert.match(scanner, /tight \$\{d\.tightFrames\}p \(\$\{d\.tightMs/);
});

test('V3.5-S4. frame dump : opt-in TRIPLE, aucun envoi réseau, téléchargement manuel seul', () => {
	// ?scannerDebug=1&scannerFrameDump=1 ET garde Preview ; capture dans une
	// variable locale (aucun fetch/XHR/sendBeacon) ; sortie par <a download>.
	assert.match(scanner, /__SCANNER_EXPERIMENT__ && debugEnabled && new URLSearchParams\(window\.location\.search\)\.get\('scannerFrameDump'\) === '1'/);
	const decode = extractBlock(scanner, 'const decodeOnce =');
	assert.match(decode, /if \(frameDumpEnabled\) \{[\s\S]{0,220}toDataURL\('image\/png'\)/);
	assert.match(scanner, /a\.download = `gflux-frame-/);
	// Aucune transmission : pas d'appel réseau dans le fichier scanner.
	assert.doesNotMatch(scanner, /fetch\(|XMLHttpRequest|sendBeacon|navigator\.sendBeacon/);
});

test('V3.5-S5. captureLastFrame est absente du handle sans frameDump (interface optionnelle)', () => {
	assert.match(scanner, /captureLastFrame: frameDumpEnabled \? \(\) => lastFrameDataUrl : undefined/);
});

test('V3.4-B2. msSinceFirstFrame : métrique indépendante du temps de manipulation', () => {
	// 162 968 ms mesuré = temps depuis startBarcodeScanner (2 min 43 s de
	// manipulation), PAS le délai de reconnaissance. La nouvelle base part de
	// la 1re frame caméra décodable.
	assert.match(scanner, /firstFrameAt === null \? null : Math\.max\(0, firstValidAt - firstFrameAt\)/);
	assert.match(scanner, /if \(firstFrameAt === null\) firstFrameAt = Date\.now\(\);/);
	// La pastille affiche les DEUX bases (délai réel + temps de session) :
	assert.match(scanner, /msSinceFirstFrame \?\? '—'\} ms \(session \$\{d\.msToFirstValid/);
});

/* ─── Mission V3.5 : passe « bande serrée » (expérimentation, Preview opt-in) ── */

test('V3.5-S1. la passe bande serrée est opt-in (?scannerCrop=tight) ET gardée par le build Preview', () => {
	// Démonstration tools/probe-strategies-v2.mts sur IMG_2243 : seul le crop
	// serré ×1 + TH décode le code à distance. L'activation est double-gardée :
	// le flag __SCANNER_EXPERIMENT__ (Preview) ET le paramètre d'URL explicite.
	assert.match(scanner, /__SCANNER_EXPERIMENT__ &&\s*typeof window/);
	assert.match(scanner, /get\('scannerCrop'\) === 'tight'/);
});
