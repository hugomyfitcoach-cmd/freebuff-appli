/**
 * RENDU MARKDOWN SÛR — Assistant G-FLUX (V2 Lot 1).
 *
 * Le contenu des bulles vient d'un modèle de langage : il est donc traité
 * comme NON FIABLE. Ce module analyse un markdown VOLONTAIREMENT minimal
 * (**gras**, *italique*, `code`, listes, paragraphes) et produit un AST
 * typé — JAMAIS de HTML, JAMAIS d'URL cliquable.
 *
 * SÉCURITÉ XSS (mission §3) :
 *  - le rendu se fait avec des éléments Svelte natifs ({@html} est interdit
 *    dans tout le composant) : Svelte échappe tout texte par défaut ;
 *  - `<script>`, `<img onerror>`, `javascript:`… sont du TEXTE comme un autre
 *    : ils sortent du parseur sous forme de texte brut et s'affichent tels
 *    quels, sans jamais être interprétés ;
 *  - pas de liens, pas d'images, pas d'attributs construits depuis l'entrée.
 *
 * MODULE PUR (aucune dépendance, testable sans DOM — tests Lot 1).
 */

export type Inline =
	| { type: 'text'; text: string }
	| { type: 'bold'; text: string }
	| { type: 'italic'; text: string }
	| { type: 'code'; text: string };

export type Block =
	| { type: 'paragraph'; parts: Inline[] }
	| { type: 'ul'; items: Inline[][] }
	| { type: 'ol'; items: Inline[][] };

/** Bornes anti-abus : un message est court ; on borne aussi l'entrée. */
const MAX_INPUT = 4000;
const MAX_BLOCKS = 40;
const MAX_LIST_ITEMS = 12;
const MAX_LINE = 800;

const BULLET_RE = /^\s*(?:[-•*]|\u2022)\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;

/** Coupe une ligne en segments en ligne/italique/gras/code — priorité ** > * > `. */
function parseInline(line: string): Inline[] {
	const parts: Inline[] = [];
	const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line)) !== null) {
		if (m.index > last) parts.push({ type: 'text', text: line.slice(last, m.index) });
		if (m[1] !== undefined) parts.push({ type: 'bold', text: m[1] });
		else if (m[2] !== undefined) parts.push({ type: 'italic', text: m[2] });
		else if (m[3] !== undefined) parts.push({ type: 'code', text: m[3] });
		last = re.lastIndex;
		if (parts.length > 200) break; // garde-fou anti-boucle infinie
	}
	if (last < line.length) parts.push({ type: 'text', text: line.slice(last) });
	return parts.length ? parts : [{ type: 'text', text: line }];
}

/**
 * Markdown minimal → blocs typés. Les lignes vides séparent ; une suite de
 * lignes à puces devient UNE liste (ul), une suite numérotée une liste ol.
 * Un tiret de séparation `---` seul est ignoré (séparateur visuel sans valeur).
 */
export function parseRichText(input: string): Block[] {
	const clean = (input ?? '').slice(0, MAX_INPUT).replace(/\r\n?/g, '\n');
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	let ul: string[] | null = null;
	let ol: string[] | null = null;

	const flushParagraph = () => {
		if (paragraph.length && blocks.length < MAX_BLOCKS) {
			blocks.push({ type: 'paragraph', parts: parseInline(paragraph.join(' ').slice(0, MAX_LINE)) });
		}
		paragraph = [];
	};
	const flushList = () => {
		if (ul && blocks.length < MAX_BLOCKS) {
			blocks.push({ type: 'ul', items: ul.slice(0, MAX_LIST_ITEMS).map((l) => parseInline(l.slice(0, MAX_LINE))) });
		}
		if (ol && blocks.length < MAX_BLOCKS) {
			blocks.push({ type: 'ol', items: ol.slice(0, MAX_LIST_ITEMS).map((l) => parseInline(l.slice(0, MAX_LINE))) });
		}
		ul = null;
		ol = null;
	};

	for (const raw of clean.split('\n')) {
		const line = raw.trimEnd();
		if (line.trim() === '') {
			flushParagraph();
			flushList();
			continue;
		}
		if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
			// séparateur markdown ignoré (pas de <hr> nécessaire dans une bulle)
			flushParagraph();
			flushList();
			continue;
		}
		if (BULLET_RE.test(line)) {
			flushParagraph();
			if (!ul) {
				flushList();
				ul = [];
			}
			ul.push(line.replace(BULLET_RE, ''));
			continue;
		}
		if (ORDERED_RE.test(line)) {
			flushParagraph();
			if (!ol) {
				flushList();
				ol = [];
			}
			ol.push(line.replace(ORDERED_RE, ''));
			continue;
		}
		// ligne de titre markdown (#…) : le prompt l'interdit, on la neutralise
		// en simple paragraphe (le # reste du texte brut, jamais un élément).
		flushList();
		paragraph.push(line.trim());
		if (paragraph.join(' ').length > MAX_LINE) flushParagraph();
	}
	flushParagraph();
	flushList();
	return blocks;
}
