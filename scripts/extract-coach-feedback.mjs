#!/usr/bin/env node
/**
 * EXTRACTION DES RETOURS DE BILAN — sauvegarde Convex locale → Markdown.
 *
 * Objectif : produire un corpus de style lisible par un humain, SANS jamais
 * exposer de donnée cliente. Le script ne connaît QUE le schéma déclaré dans
 * `src/convex/schema.ts` :
 *
 *   checkins : { userId, weekStart, weekLabel, answers, status,
 *                feedback?, feedbackAt?, feedbackReadAt? }
 *   users    : { prenom, nom?, role, email, ... }   (lu uniquement pour
 *                                                    effacer les prénoms)
 *
 * Il ne produit QUE : le texte de `checkins.feedback`, la semaine
 * (`weekLabel`/`weekStart`) et la date de publication (`feedbackAt`, repli
 * `_creationTime`). Aucun `userId`, e-mail, nom, réponse, média ni statut de
 * lecture n'est écrit dans le fichier de sortie.
 *
 * Format d'une sauvegarde Convex : ZIP avec `<table>/documents.jsonl`
 * (un document JSON par ligne) — la lecture tolère aussi des fichiers
 * `<table>/<id>.json` et un dossier déjà décompressé.
 *
 * USAGE
 *   node scripts/extract-coach-feedback.mjs <sauvegarde.zip> [sortie.md]
 *   (sortie par défaut : /Users/hugo/Desktop/retours-coach.md)
 *
 * Aucune connexion réseau, aucun accès à un déploiement Convex.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const DEFAULT_OUT = '/Users/hugo/Desktop/retours-coach.md';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ─────────────────────────── Lecture ZIP (sans dépendance) ─────────────────────────── */

function findEndOfCentralDirectory(buf) {
	const min = Math.max(0, buf.length - 65_557);
	for (let i = buf.length - 22; i >= min; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) return i;
	}
	throw new Error("Ce fichier n'est pas un ZIP valide (fin de répertoire introuvable).");
}

/** Extrait toutes les entrées du ZIP en mémoire (nom → Buffer UTF-8). */
function readZipEntries(buf) {
	const eocd = findEndOfCentralDirectory(buf);
	const count = buf.readUInt16LE(eocd + 10);
	const dirOffset = buf.readUInt32LE(eocd + 16);
	if (count === 0xffff || dirOffset === 0xffffffff) {
		throw new Error(
			'Sauvegarde ZIP64 (ou > 4 Go) : décompresse-la puis relance le script sur le dossier extrait.'
		);
	}

	const entries = new Map();
	let ptr = dirOffset;
	for (let i = 0; i < count; i++) {
		if (buf.readUInt32LE(ptr) !== 0x02014b50) {
			throw new Error('Répertoire central du ZIP corrompu.');
		}
		const method = buf.readUInt16LE(ptr + 10);
		const compressedSize = buf.readUInt32LE(ptr + 20);
		const nameLen = buf.readUInt16LE(ptr + 28);
		const extraLen = buf.readUInt16LE(ptr + 30);
		const commentLen = buf.readUInt16LE(ptr + 32);
		const localOffset = buf.readUInt32LE(ptr + 42);
		const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
		ptr += 46 + nameLen + extraLen + commentLen;

		if (!name || name.endsWith('/') || !/\.(json|jsonl)$/i.test(name)) continue;
		if (name.startsWith('_storage/')) continue;

		if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
			throw new Error(`En-tête local illisible pour ${name}.`);
		}
		const localNameLen = buf.readUInt16LE(localOffset + 26);
		const localExtraLen = buf.readUInt16LE(localOffset + 28);
		const start = localOffset + 30 + localNameLen + localExtraLen;
		const raw = buf.subarray(start, start + compressedSize);
		let data;
		if (method === 0) data = raw;
		else if (method === 8) data = inflateRawSync(raw);
		else throw new Error(`Compression ZIP non prise en charge (méthode ${method}) pour ${name}.`);
		entries.set(name, data);
	}
	return entries;
}

/** Dossier déjà décompressé → mêmes entrées (nom relatif → Buffer). */
function readDirectoryEntries(root, prefix = '', out = new Map()) {
	for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
		const rel = join(prefix, entry.name);
		if (entry.isDirectory()) readDirectoryEntries(root, rel, out);
		else if (/\.(json|jsonl)$/i.test(entry.name) && !rel.startsWith('_storage')) {
			out.set(rel, readFileSync(join(root, rel)));
		}
	}
	return out;
}

/* ───────────────────────────── Lecture des documents ───────────────────────────── */

function parseJsonLines(text, source) {
	const docs = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			docs.push(JSON.parse(trimmed));
		} catch {
			throw new Error(`Ligne JSON invalide dans ${source} — sauvegarde incomplète ?`);
		}
	}
	return docs;
}

function parseEntry(name, buf) {
	const text = buf.toString('utf8');
	if (name.endsWith('.jsonl')) return parseJsonLines(text, name);
	try {
		const doc = JSON.parse(text);
		return Array.isArray(doc) ? doc : [doc];
	} catch {
		// Un .json non-document (manifeste, métadonnées) est ignoré sans échouer.
		return [];
	}
}

/** Un document « bilan » au sens du schéma (jamais un utilisateur/session). */
function isCheckinDocument(doc) {
	return (
		!!doc &&
		typeof doc === 'object' &&
		!Array.isArray(doc) &&
		typeof doc.weekStart === 'string' &&
		ISO_RE.test(doc.weekStart) &&
		!!doc.answers &&
		typeof doc.answers === 'object' &&
		!Array.isArray(doc.answers) &&
		!('email' in doc) &&
		!('passwordHash' in doc)
	);
}

/** Prénoms/noms des CLIENTES — uniquement pour les effacer du texte exporté. */
function clientNames(doc) {
	if (!doc || typeof doc !== 'object' || doc.role !== 'client') return [];
	const out = [];
	for (const key of ['prenom', 'nom']) {
		const value = doc[key];
		if (typeof value !== 'string') continue;
		for (const part of value.split(/[\s-]+/)) {
			const clean = part.trim();
			if (clean.length >= 3) out.push(clean);
		}
	}
	return out;
}

/** Retire e-mails, téléphones et prénoms de clientes du texte du coach. */
function redact(text, names) {
	let out = String(text)
		.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
		.replace(/\b(?:\+?\d[\s.-]?){9,14}\d\b/g, '[téléphone]');
	for (const name of names) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '[prénom]');
	}
	return out.trim();
}

function formatDate(ms) {
	if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
	return new Intl.DateTimeFormat('fr-FR', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		timeZone: 'Europe/Paris',
	}).format(new Date(ms));
}

/* ─────────────────────────────────── Programme ─────────────────────────────────── */

function main() {
	const zipPath = process.argv[2];
	if (!zipPath) {
		console.error('Usage : node scripts/extract-coach-feedback.mjs <sauvegarde.zip> [sortie.md]');
		process.exit(1);
	}
	if (!existsSync(zipPath)) {
		console.error(`Sauvegarde introuvable : ${zipPath}`);
		process.exit(1);
	}
	const outPath = process.argv[3] ?? DEFAULT_OUT;

	const isDir = statSync(zipPath).isDirectory();
	const entries = isDir ? readDirectoryEntries(zipPath) : readZipEntries(readFileSync(zipPath));

	const checkins = [];
	const names = new Set();
	for (const [name, buf] of entries) {
		if (/\.jsonl$/i.test(name) && !/(^|\/)checkins\/documents\.jsonl$/i.test(name) && !/checkins/i.test(name)) {
			// Les gros exports ne contiennent qu'un documents.jsonl par table :
			// on ne décode que ce qui peut porter des bilans ou des prénoms.
			if (!/users/i.test(name)) continue;
		}
		for (const doc of parseEntry(name, buf)) {
			if (isCheckinDocument(doc)) checkins.push(doc);
			for (const n of clientNames(doc)) names.add(n);
		}
	}

	if (checkins.length === 0) {
		console.error(
			'Aucun bilan trouvé — vérifie que la sauvegarde contient bien checkins/documents.jsonl (export Convex complet).'
		);
		process.exit(2);
	}

	let skippedDrafts = 0;
	let skippedEmpty = 0;
	const rows = [];
	const seen = new Set();
	for (const c of checkins) {
		const feedback = typeof c.feedback === 'string' ? c.feedback.trim() : '';
		if (!feedback) {
			skippedEmpty += 1;
			continue;
		}
		// Un brouillon jamais publié n'est pas un exemple de retour envoyé.
		if (c.status !== 'retour_envoye') {
			skippedDrafts += 1;
			continue;
		}
		const text = redact(feedback, names);
		if (!text) continue;
		const week = typeof c.weekLabel === 'string' && c.weekLabel.trim() ? c.weekLabel.trim() : `Semaine du ${c.weekStart}`;
		const at = typeof c.feedbackAt === 'number' ? c.feedbackAt : c._creationTime;
		const key = `${c.weekStart}|${text}`;
		if (seen.has(key)) continue;
		seen.add(key);
		rows.push({ week, weekStart: c.weekStart, date: formatDate(at), text });
	}
	rows.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.text.localeCompare(b.text));

	const generatedAt = new Intl.DateTimeFormat('fr-FR', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: 'Europe/Paris',
	}).format(new Date());

	const parts = [
		'# Retours de bilan — corpus de style',
		'',
		'> Fichier local, non versionné. Il ne contient QUE le texte des retours du coach,',
		'> avec la semaine et la date de publication. Aucun identifiant, nom, e-mail ni',
		'> réponse de cliente. Les e-mails, téléphones et prénoms de clientes ont été retirés.',
		'> Vérifie visuellement avant de le partager comme exemples de style.',
		'',
		`*Généré le ${generatedAt} — ${rows.length} retour(s) publié(s).*`,
		'',
	];
	for (const row of rows) {
		parts.push('---', '', `## ${row.week}${row.date ? ` — publié le ${row.date}` : ''}`, '', row.text, '');
	}
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, parts.join('\n'), 'utf8');

	console.error(
		`${rows.length} retour(s) publié(s) écrit(s) dans ${outPath}` +
			`${skippedDrafts ? ` — ${skippedDrafts} brouillon(s) non publié(s) ignoré(s)` : ''}` +
			`${skippedEmpty ? ` — ${skippedEmpty} bilan(s) sans retour ignoré(s)` : ''}.`
	);
}

main();
