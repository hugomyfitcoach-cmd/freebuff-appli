/* Vérification du cyclage refeed / diet break (panel 6 « Outils »).
 *
 * Teste la logique pure extraite dans src/lib/cyclage.ts :
 * - la grille de catégories (seuils % de graisse, paliers d'EA, méthodes) ;
 * - le découpage de l'horizon 26 semaines en Déficit / Refeed / Diet break,
 *   comparé bloc par bloc à des séquences attendues calculées à la main
 *   (règles : break une semaine toutes les N semaines — week 0 = semaine 1 ;
 *   refeed tous les `interval` jours de déficit, plancher 7 jours, jamais
 *   collé à un break — marge `refeedDur + 7` jours avant le prochain break —
 *   et refeed écrasé par le break en cas de chevauchement) ;
 * - des invariants structurels (182 jours, breaks de 7 jours, refeeds de
 *   3 jours, jamais de refeed adjacent à un break).
 *
 * Usage : node scripts/verify-cyclage.mjs
 */
import { getCategorie, getCategorieFemmeMin25, getCategorieHommeMin15, planifier, HORIZON_WEEKS } from '../src/lib/cyclage.ts';

let fail = 0;
function check(name, got, expected) {
	const ok = got === expected;
	if (!ok) fail++;
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `\n      obtenu : ${got}\n      attendu : ${expected}`}`);
}

/* Séquence compacte : d12-27 = déficit jours 12→27, r9-11 = refeed, b28-34 = break. */
const seq = (cat) =>
	planifier(cat)
		.map((b) => `${b.phase[0]}${b.startDay}-${b.endDay}`)
		.join(', ');

/* ————— Grille de catégories ————— */
check('Femme 36% → >35%', getCategorie('femme', 36, 25, 'alpert').label, 'Femme >35% graisse');
check('Femme 35% → 25-35%', getCategorie('femme', 35, 25, 'alpert').label, 'Femme 25-35% graisse');
check('Femme 25% → 25-35%', getCategorie('femme', 25, 25, 'alpert').label, 'Femme 25-35% graisse');
check('Femme 24.9% → <25%', getCategorie('femme', 24.9, 25, 'alpert').label, 'Femme <25% graisse');
check('Homme 25.1% → >25%', getCategorie('homme', 25.1, 25, 'alpert').label, 'Homme >25% graisse');
check('Homme 25% → 15-25%', getCategorie('homme', 25, 25, 'alpert').label, 'Homme 15-25% graisse');
check('Homme 15% → 15-25%', getCategorie('homme', 15, 25, 'alpert').label, 'Homme 15-25% graisse');
check('Homme 14.9% → <15%', getCategorie('homme', 14.9, 25, 'alpert').label, 'Homme <15% graisse');

/* Paliers d'EA (femme <25 %). */
check('EA 31 → interval 17', getCategorieFemmeMin25(31).refeedIntervalDays, 17);
check('EA 30 → interval 10 (borne >30 stricte)', getCategorieFemmeMin25(30).refeedIntervalDays, 10);
check('EA 24 → interval 10', getCategorieFemmeMin25(24).refeedIntervalDays, 10);
check('EA 23.9 → interval 7', getCategorieFemmeMin25(23.9).refeedIntervalDays, 7);
check('EA 20 → interval 7', getCategorieFemmeMin25(20).refeedIntervalDays, 7);
check('EA 19.9 → hors grille', getCategorieFemmeMin25(19.9).outOfGrid, true);
check('Hors grille → pas de refeed planifié', getCategorieFemmeMin25(19.9).refeedPlanned, false);

/* Méthode (homme <15 %). */
check('Alpert → interval 17', getCategorieHommeMin15('alpert').refeedIntervalDays, 17);
check('Macdonald → interval 10', getCategorieHommeMin15('macdonald').refeedIntervalDays, 10);

/* ————— Découpage : catégories sans refeed planifié ————— */
/* F >35 % : breaks semaines 10 et 20 (jours 28-34 et 63-69... non : S10 → jours 63-69). */
check(
	'F >35% : breaks S10/S20, sinon déficit',
	seq(getCategorie('femme', 40, 25, 'alpert')),
	'd0-62, b63-69, d70-132, b133-139, d140-181'
);
/* F 25-35 % : breaks S8, S16, S24. */
check(
	'F 25-35% : breaks S8/S16/S24',
	seq(getCategorie('femme', 30, 25, 'alpert')),
	'd0-48, b49-55, d56-104, b105-111, d112-160, b161-167, d168-181'
);
/* Hors grille (EA < 20) : refeedPlanned=false → breaks purs. */
check(
	'F <25% EA 15 (hors grille) : breaks S5/S10/S15/S20/S25',
	seq(getCategorie('femme', 22, 15, 'alpert')),
	'd0-27, b28-34, d35-62, b63-69, d70-97, b98-104, d105-132, b133-139, d140-167, b168-174, d175-181'
);

/* ————— Découpage : femme <25 % avec refeeds (interval 10, break S5/S10/S15/S20/S25) ————— */
check(
	'F <25% EA 28 : refeeds t=9,44,79,114,149 puis 175-181 sans refeed',
	seq(getCategorie('femme', 22, 28, 'alpert')),
	'd0-8, r9-11, d12-27, b28-34, d35-43, r44-46, d47-62, b63-69, d70-78, r79-81, d82-97, b98-104, d105-113, r114-116, d117-132, b133-139, d140-148, r149-151, d152-167, b168-174, d175-181'
);

/* ————— Découpage : homme <15 % ————— */
check(
	'Homme <15% Alpert : refeeds t=16,65,114,163 (skip à 7j du break)',
	seq(getCategorie('homme', 12, 25, 'alpert')),
	'd0-15, r16-18, d19-41, b42-48, d49-64, r65-67, d68-90, b91-97, d98-113, r114-116, d117-139, b140-146, d147-162, r163-165, d166-181'
);
check(
	'Homme <15% Macdonald : refeeds plus rapprochés + refeed terminal tronqué à 2 j',
	seq(getCategorie('homme', 12, 25, 'macdonald')),
	'd0-8, r9-11, d12-20, r21-23, d24-41, b42-48, d49-57, r58-60, d61-69, r70-72, d73-90, b91-97, d98-106, r107-109, d110-118, r119-121, d122-139, b140-146, d147-155, r156-158, d159-167, r168-170, d171-179, r180-181'
);

/* ————— Invariants structurels, toutes catégories ————— */
const cats = [
	['femme', 40, 25, 'alpert'],
	['femme', 30, 25, 'alpert'],
	['femme', 22, 15, 'alpert'],
	['femme', 22, 22, 'alpert'],
	['femme', 22, 28, 'alpert'],
	['femme', 22, 35, 'alpert'],
	['homme', 30, 25, 'alpert'],
	['homme', 20, 25, 'alpert'],
	['homme', 12, 25, 'alpert'],
	['homme', 12, 25, 'macdonald'],
];
for (const [s, pct, ea, m] of cats) {
	const cat = getCategorie(s, pct, ea, m);
	const blocks = planifier(cat);
	const total = blocks.reduce((n, b) => n + (b.endDay - b.startDay + 1), 0);
	check(`[${cat.label} ea=${ea}] couvre exactement 182 jours`, total, HORIZON_WEEKS * 7);
	check(
		`[${cat.label} ea=${ea}] blocs contigus et ordonnés`,
		String(blocks.every((b, i) => i === 0 || blocks[i - 1].endDay + 1 === b.startDay)),
		'true'
	);
	check(
		`[${cat.label} ea=${ea}] breaks de 7 jours pleines semaines`,
		String(blocks.filter((b) => b.phase === 'break').every((b) => b.startDay % 7 === 0 && b.endDay - b.startDay + 1 === 7)),
		'true'
	);
	check(
		`[${cat.label} ea=${ea}] refeeds ≤ 3 jours`,
		String(blocks.filter((b) => b.phase === 'refeed').every((b) => b.endDay - b.startDay + 1 <= 3)),
		'true'
	);
	check(
		`[${cat.label} ea=${ea}] aucun refeed adjacent à un break`,
		String(blocks.every((b, i) => i === 0 || blocks[i - 1].phase !== 'refeed' || b.phase !== 'break')),
		'true'
	);
}

/* ————— Helpers de rendu ————— */
import { addDays, fmtDate } from '../src/lib/cyclage.ts';
check('addDays + 6 jours', fmtDate(addDays(new Date('2026-09-01T00:00:00'), 6)), '07 sept. 2026');
const src = new Date('2026-09-01T00:00:00Z');
addDays(src, 10);
check('addDays ne mute pas la date source', src.toISOString().slice(0, 10), '2026-09-01');

console.log(fail === 0 ? '\nTous les cas sont OK.' : `\n${fail} cas en échec.`);
process.exit(fail === 0 ? 0 : 1);
