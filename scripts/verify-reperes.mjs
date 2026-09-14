/* Vérification ad hoc des repères G-FLUX (exécutée puis supprimée). */
import { reperesForFood } from '../src/lib/data/gfluxReperes.ts';

let fail = 0;
function check(name, expected, note = '') {
	const got = reperesForFood(name).map((r) => `${r.label}≈${r.grams}${r.unit}`).join(', ') || '(aucun)';
	const ok = got === expected;
	if (!ok) fail++;
	console.log(`${ok ? 'OK  ' : 'FAIL'} [${name}] → ${got}${ok ? '' : `  (attendu: ${expected}) ${note}`}`);
}

/* — Le bug signalé — */
check('Pain complet ou intégral (à la farine T150)', 'tranche≈25g');
check('Pain complet (à la farine T150)', 'tranche≈25g');
check('Pain de mie complet', 'tranche≈25g');
check('Pain aux graines de sésame', 'tranche≈25g');
check('Pain aux noix', 'tranche≈25g');
check('Pain au chocolat', 'pièce≈70g');
check('Pain d’épices', 'tranche≈25g');
check('Pain de campagne', 'tranche≈25g');
check('Baguette', '1/4 baguette≈60g, 1/2 baguette≈125g');

/* — La nature principale gagne sur le complément — */
check('Yaourt au miel', 'pot≈125g, c. à soupe≈15g');
check('Yaourt nature', 'pot≈125g, c. à soupe≈15g');
check('Poulet à l’huile d’olive', '(aucun)');
check('Filet de poulet au four', 'filet≈130g');
check('Yaourt à boire au miel', 'verre≈250ml, canette≈330ml, bouteille≈500ml');

/* — Les cuillères ne sortent que pour l’aliment lui-même — */
check('Huile d’olive', 'c. à café≈5g, c. à soupe≈15g');
check('Huile de colza', 'c. à café≈5g, c. à soupe≈15g');
check('Vinaigre balsamique', 'c. à soupe≈15ml');
check('Miel', 'c. à café≈5g, c. à soupe≈15g');
check('Miel de châtaignier', 'c. à café≈5g, c. à soupe≈15g');
check('Sirop d’érable', 'c. à café≈5g, c. à soupe≈15g');
check('Sauce tomate', 'c. à café≈5g, c. à soupe≈15g');
check('Farine d’avoine', 'c. à soupe≈10g');
check('Farine de blé T80', 'c. à soupe≈10g');
check('Farine de blé tendre ou froment T150', 'c. à soupe≈10g');
check('Fécule de maïs', 'c. à soupe≈10g');
check('Poudre d’amande', 'c. à soupe≈10g');
check('Jus d’orange', 'verre≈250ml, canette≈330ml, bouteille≈500ml');
check('Lait demi-écrémé', 'verre≈250ml, canette≈330ml, bouteille≈500ml');
check('Thé vert', 'verre≈250ml, canette≈330ml, bouteille≈500ml');
check('Eau minérale', 'verre≈250ml, canette≈330ml, bouteille≈500ml');
check('Sucre en morceaux', 'morceau≈5g');
check('Sucre blanc', 'morceau≈5g');

/* — Régressions globales de la whitelist — */
check('Œuf', 'œuf≈50g');
check('Steak haché 5%', 'steak≈125g');
check('Croissant', 'croissant≈50g');
check('Riz complet cuit', 'c. à soupe≈15g');
check('Riz basmati cru', 'c. à soupe≈12g');
check('Riz complet', '(aucun)');
check('Pâtes cuites', 'c. à soupe≈15g');
check('Lentilles vertes cuites', 'c. à soupe≈15g');
check('Pois chiches cuits', 'c. à soupe≈15g');
check('Pois chiches (farine)', '(aucun)');
check('Flocons d’avoine', 'c. à soupe≈8g');
check('Son d’avoine', 'c. à soupe≈8g');
check('Muesli', 'c. à soupe≈10g');
check('Graines de chia', 'c. à soupe≈12g');
check('Graines de lin', 'c. à soupe≈10g');
check('Purée d’amande', 'c. à soupe≈15g');
check('Beurre de cacahuète', 'c. à soupe≈15g');
check('Houmous', 'c. à soupe≈15g');
check('Confiture de fraises', 'c. à soupe≈20g');
check('Pâte à tartiner au chocolat', 'c. à soupe≈15g');
check('Compote de pomme', 'pot≈100g, c. à soupe≈15g');
check('Compote (pomme)', 'pot≈100g, c. à soupe≈15g');
check('Tomate', 'tomate≈120g');
check('Tomates cerises', 'tomate≈15g');
check('Pomme de terre', 'pomme de terre≈150g');
check('Pomme', 'pomme≈150g');
check('Pomme (Golden)', 'pomme≈150g');
check('Banane séchée', '(aucun)');
check('Banane', 'banane≈120g');
check('Amande', 'amande≈1.2g');
check('Noix', 'cerneau≈4g');
check('Noix de cajou', 'noix≈1.5g');
check('Noix de coco râpée', 'c. à soupe≈5g');
check('Olive', 'olive≈4g');
check('Huile d’olive (vierge extra)', 'c. à café≈5g, c. à soupe≈15g');
check('Beurre doux', 'portion≈10g');
check('Beurre de cacahuète (crunchy)', 'c. à soupe≈15g');
check('Jambon blanc', 'tranche≈40g');
check('Jambon cru', 'tranche≈25g');
check('Saumon fumé', 'tranche≈25g');
check('Filet de cabillaud', 'filet≈150g');
check('Pavé de saumon', 'pavé≈125g');
check('Chocolat noir 70%', 'carré≈10g');
check('Tablette de chocolat au lait', 'carré≈10g');
check('Chocolat en poudre', 'c. à soupe≈8g');
check('Mozzarella', 'boule≈125g');
check('Fromage blanc', 'pot≈200g, c. à soupe≈15g');
check('Fromage blanc 3% matière grise', 'pot≈200g, c. à soupe≈15g');
check('Fromage blanc (faisselle)', 'pot≈200g, c. à soupe≈15g');
check('Skyr nature', 'pot≈170g, c. à soupe≈15g');
check('Petit suisse', 'pot≈60g, c. à soupe≈15g');
check('Glace vanille', 'boule≈50g');
check('Glace (sandwich)', '(aucun)');
check('Coca-Cola', 'verre≈250ml, canette≈330ml, bouteille≈500ml');
check('Laitue', '(aucun)');
check('Jus de citron', 'c. à café≈5ml, c. à soupe≈15ml');
check('Vinaigre de cidre', 'c. à soupe≈15ml');
check('Salade de riz', '(aucun)');
check('Tarte aux pommes', '(aucun)');
check('', '(aucun)');
check('   ', '(aucun)');
check('Farine (T150)', 'c. à soupe≈10g');

console.log(fail === 0 ? '\nTOUS LES TESTS PASSENT ✔' : `\n${fail} ÉCHEC(S) ✘`);
process.exit(fail === 0 ? 0 : 1);
