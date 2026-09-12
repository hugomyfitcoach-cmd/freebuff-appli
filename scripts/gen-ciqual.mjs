#!/usr/bin/env node
/**
 * Génère les données Ciqual embarquées (statiques, ZÉRO réseau à la recherche) :
 *
 *  - `src/convex/ciqualNames.ts`     : libellés français (source XML alim_*),
 *    signal « vocabulaire officiel » du ranking (foodRanking.rankFoods).
 *  - `src/convex/ciqualNutrients.ts` : kcal + protéines/glucides/lipides /100 g
 *    par libellé (source XLSX officiel) — signal de COHÉRENCE NUTRITIONNELLE :
 *    une fiche OFF reconnue comme générique mais très loin de la référence
 *    Ciqual est pénalisée.
 *
 * Usage : node scripts/gen-ciqual.mjs
 * Sources : table Ciqual 2025, édition FR — DOI 10.57745/RDMHWY
 * (entrepot.recherche.data.gouv.fr).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const XML_URL = 'https://entrepot.recherche.data.gouv.fr/api/access/datafile/666252';
const XLSX_URL = 'https://entrepot.recherche.data.gouv.fr/api/access/datafile/666260';
const OUT_DIR = fileURLToPath(new URL('../src/convex/', import.meta.url));

/** Nom normalisé (clé de rapprochement XML ↔ XLSX). */
function normKey(s) {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

async function download(url, dest) {
	const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
	if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status}) ${url}`);
	const buf = Buffer.from(await res.arrayBuffer());
	await writeFile(dest, buf);
	return dest;
}

/** Valeur Ciqual : texte FR (« 49,9 », « < 0,2 », « - ») → nombre ou undefined. */
function ciqualNumber(raw) {
	if (raw === undefined) return undefined;
	const t = String(raw).trim();
	if (!t || t === '-' || t === '') return undefined;
	const n = parseFloat(t.replace('<', '').replace(',', '.'));
	return Number.isFinite(n) ? n : undefined;
}

/** Lecture minimaliste du XLSX (feuille 1, cellules partagées) — zéro dépendance. */
function parseXlsx(xml, sharedStrings) {
	const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((m) => {
		const cells = {};
		for (const c of m[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
			const col = (c[1].match(/r="([A-Z]+)\d+"/) || [])[1];
			if (!col) continue;
			const t = (c[1].match(/t="(\w+)"/) || [])[1];
			const v = (c[2].match(/<v>([^<]*)<\/v>/) || [])[1];
			cells[col] = t === 's' && v !== undefined ? sharedStrings[+v] : v;
		}
		return cells;
	});
	return rows;
}

async function main() {
	const dir = join(tmpdir(), 'ciqual-gen');
	await mkdir(dir, { recursive: true });

	/* ── 1) Libellés (XML alim) → ciqualNames.ts (inchangé) ── */
	console.log('⬇️  Téléchargement', XML_URL);
	const xml = await (await fetch(XML_URL, { signal: AbortSignal.timeout(90_000) })).text();
	const names = [
		...new Set(
			[...xml.matchAll(/<alim_nom_fr>([^<]+)<\/alim_nom_fr>/g)]
				.map((m) => m[1].replace(/\s+/g, ' ').trim())
				.filter(Boolean)
		),
	].sort((a, b) => a.localeCompare(b, 'fr'));
	if (names.length < 3000) throw new Error(`Trop peu de noms extraits (${names.length}) — XML inattendu.`);
	const namesHeader = `/**
 * Noms d'aliments de la table Ciqual 2025 (ANSES) — édition française.
 *
 * Généré NE PAS ÉDITER À LA MAIN : scripts/gen-ciqual.mjs (source :
 * alim_2025_11_03.xml, DOI 10.57745/RDMHWY — entrepot.recherche.data.gouv.fr).
 * ${names.length} libellés officiels français (« Tomate verte, crue », « Riz
 * complet, cru »…) — utilisés comme signal QUALITÉ LOCAL par
 * foodRanking.rankFoods : un produit nommé exactement (préfixe mot à mot,
 * sans accents, singuliers) comme un aliment Ciqual officiel est un
 * « vocabulaire générique français fiable » et passe devant les autres à
 * niveau de correspondance égal. Aucun appel réseau à la recherche : la
 * table est embarquée ici.
 */
export const ciqualNames: string[] = [
`;
	await writeFile(join(OUT_DIR, 'ciqualNames.ts'), namesHeader + names.map((n) => '\t' + JSON.stringify(n) + ',').join('\n') + '\n];\n');
	console.log(`✅ ciqualNames.ts : ${names.length} libellés`);

	/* ── 2) Nutriments (XLSX officiel) → ciqualNutrients.ts ── */
	console.log('⬇️  Téléchargement', XLSX_URL);
	const xlsxPath = await download(XLSX_URL, join(dir, 'ciqual.xlsx'));
	const { execFileSync } = await import('node:child_process');
	execFileSync('unzip', ['-o', '-q', xlsxPath, 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', '-d', dir]);
	const ssXml = await readFileText(join(dir, 'xl/sharedStrings.xml'));
	const sharedStrings = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
		(m[1].match(/<t[^>]*>([^<]*)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')
	);
	const sheetXml = await readFileText(join(dir, 'xl/worksheets/sheet1.xml'));

	// Colonnes (en-têtes vérifiés) : G=alim_code, H=alim_nom_fr, K=kcal (Règlt UE),
	// O=protéines (Jones), Q=glucides, R=lipides — valeurs /100 g en texte FR.
	const byName = new Map();
	let withKcal = 0;
	for (const cells of parseXlsx(sheetXml, sharedStrings)) {
		const name = cells.H ? String(cells.H).replace(/\s+/g, ' ').trim() : '';
		if (!name || !cells.G) continue; // ligne d'en-tête ou incomplète
		const kcal = ciqualNumber(cells.K);
		const p = ciqualNumber(cells.O);
		const c = ciqualNumber(cells.Q);
		const f = ciqualNumber(cells.R);
		if (kcal === undefined) continue;
		withKcal++;
		// Deux aliments Ciqual peuvent partager un libellé : on garde chacun
		// (rankFoods prendra la référence la plus proche).
		const entry = { name, kcal, p, c, f };
		const key = normKey(name);
		const list = byName.get(key);
		if (list) list.push(entry);
		else byName.set(key, [entry]);
	}
	if (withKcal < 2500) throw new Error(`Trop peu d'aliments avec kcal (${withKcal}) — XLSX inattendu.`);

	const refs = [...byName.values()].flat().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
	const nutHeader = `/**
 * Références nutritionnelles Ciqual 2025 (ANSES) — kcal et macros /100 g par
 * libellé officiel français. Généré NE PAS ÉDITER À LA MAIN :
 * scripts/gen-ciqual.mjs (source : Table Ciqual 2025_FR_2025_11_03.xlsx,
 * DOI 10.57745/RDMHWY). ${refs.length} références — utilisées par
 * foodRanking.rankFoods comme signal de COHÉRENCE : une fiche reconnue
 * générique (préfixe mot à mot d'un libellé Ciqual) mais dont kcal/macros
 * s'écartent trop de toute référence correspondante est pénalisée. Zéro
 * réseau à la recherche : table embarquée.
 */
export type CiqualRef = { name: string; kcal: number; p?: number; c?: number; f?: number };
export const ciqualNutrients: CiqualRef[] = [
`;
	const body = refs
		.map((r) => `\t{ name: ${JSON.stringify(r.name)}, kcal: ${r.kcal}, p: ${r.p ?? 'undefined'}, c: ${r.c ?? 'undefined'}, f: ${r.f ?? 'undefined'} },`)
		.join('\n');
	await writeFile(join(OUT_DIR, 'ciqualNutrients.ts'), nutHeader + body + '\n];\n');
	console.log(`✅ ciqualNutrients.ts : ${refs.length} références (${withKcal} kcal renseignées)`);
}

function readFileText(p) {
	return import('node:fs/promises').then((fs) => fs.readFile(p, 'utf8'));
}

main().catch((e) => {
	console.error('⛔', e.message);
	process.exit(1);
});
