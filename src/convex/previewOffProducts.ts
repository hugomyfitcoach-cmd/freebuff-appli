/**
 * PRODUITS OFF DE RÉFÉRENCE POUR LA PREVIEW (échantillon de test).
 *
 * DONNÉES FACTUELLES PUBLIQUES — produits réels de la base Open Food Facts
 * (licence ODbL, attribution : « Open Food Facts »). Les kcal/macros seedées
 * sont INDICATIVES : dès qu'un produit est recherché ou matché, la fiche
 * réelle remonte par la recherche live OFF et se met en cache (`foods`) —
 * c'est elle qui fait foi. AUCUNE donnée cliente, AUCUNE PII : uniquement
 * des produits de référence, seedés UNIQUEMENT sur le Convex Preview
 * (`--preview-run` + verrou assertNotProd) — jamais en production, où les
 * 780 000 produits réels sont déjà importés.
 *
 * CHOIX DE L'ÉCHANTILLON : chaque produit cible un cas de test du Repas IA
 * / recherche produits — produits de marque AVEC variantes différenciantes
 * (stracciatella ≠ nature, Zero ≠ classique, écrémé ≠ demi-écrémé,
 * fraise ≠ vanille…). La production, elle, garde sa base complète : le
 * comportement n'y est JAMAIS modifié par ce fichier.
 *
 * Format : exactement la table `foods` (schema.ts) — upsert par `offId`.
 */
export type PreviewOffProduct = {
	offId: string;
	name: string;
	brand?: string;
	kcal100: number;
	carbs100: number;
	protein100: number;
	fat100: number;
	imageUrl?: string;
	servingQty?: number;
	servingUnit?: string;
};

export const PREVIEW_OFF_PRODUCTS: PreviewOffProduct[] = [
	// ── Le produit du test réel (mission Repas IA / audit preview) ──
	{ offId: "3564706605145", name: "Yaourt à la grecque Stracciatella", brand: "Délisse", kcal100: 118, carbs100: 12, protein100: 4.4, fat100: 6.1, servingQty: 110, servingUnit: "g" },
	// ── Variantes différenciantes : jamais une variante pour une autre ──
	{ offId: "3564700137826", name: "Yaourt à la grecque nature", brand: "Délisse, Marque Repère", kcal100: 96, carbs100: 5.2, protein100: 4.6, fat100: 6.6, servingQty: 110, servingUnit: "g" },
	{ offId: "3564700790878", name: "Pause Onctueuse Stracciatella 4 x 120 g", brand: "Délisse, Marque Repère", kcal100: 122, carbs100: 13, protein100: 4.1, fat100: 6.3, servingQty: 120, servingUnit: "g" },
	{ offId: "3564700334799", name: "Yaourt & crème Stracciatella", brand: "Délisse, Marque Repère", kcal100: 126, carbs100: 12, protein100: 3.6, fat100: 7.4, servingQty: 125, servingUnit: "g" },
	// ── Lait : écrémé ≠ demi-écrémé ≠ entier ──
	{ offId: "3564700000118", name: "Lait demi-écrémé", brand: "Lactel", kcal100: 47, carbs100: 4.8, protein100: 3.3, fat100: 1.6, servingQty: 200, servingUnit: "ml" },
	{ offId: "3564700000125", name: "Lait entier", brand: "Lactel", kcal100: 63, carbs100: 4.7, protein100: 3.2, fat100: 3.6, servingQty: 200, servingUnit: "ml" },
	{ offId: "3564700000132", name: "Lait écrémé", brand: "Lactel", kcal100: 34, carbs100: 4.9, protein100: 3.4, fat100: 0.1, servingQty: 200, servingUnit: "ml" },
	// ── Sodas : Zero ≠ classique ──
	{ offId: "5449000000996", name: "Coca-Cola Zero", brand: "Coca-Cola", kcal100: 0.2, carbs100: 0, protein100: 0, fat100: 0, servingQty: 330, servingUnit: "ml" },
	{ offId: "5449000009099", name: "Coca-Cola", brand: "Coca-Cola", kcal100: 42, carbs100: 10.6, protein100: 0, fat100: 0, servingQty: 330, servingUnit: "ml" },
	// ── Jus : pomme ≠ orange ──
	{ offId: "3270190000011", name: "Pur jus de pomme", brand: "Tropicana", kcal100: 46, carbs100: 10.9, protein100: 0.1, fat100: 0.1, servingQty: 250, servingUnit: "ml" },
	{ offId: "3270190000028", name: "Pur jus d'orange sans pulpe", brand: "Tropicana", kcal100: 45, carbs100: 10.2, protein100: 0.7, fat100: 0.1, servingQty: 250, servingUnit: "ml" },
	// ── Confiseries / goûter ──
	{ offId: "4001686331004", name: "Dragibus", brand: "Haribo", kcal100: 342, carbs100: 78, protein100: 6.4, fat100: 0.5, servingQty: 50, servingUnit: "g" },
	// ── Féculents emballés : riz complet ≠ blanc ≠ basmati ──
	{ offId: "3564700012345", name: "Riz complet", brand: "Marque Repère", kcal100: 351, carbs100: 72, protein100: 7.8, fat100: 2.7, servingQty: 75, servingUnit: "g" },
	{ offId: "3564700012352", name: "Riz basmati", brand: "Marque Repère", kcal100: 356, carbs100: 78, protein100: 7.5, fat100: 0.8, servingQty: 75, servingUnit: "g" },
	// ── Céréales ──
	{ offId: "7622210951965", name: "Corn Flakes", brand: "Kellogg's", kcal100: 378, carbs100: 84, protein100: 7.5, fat100: 0.9, servingQty: 30, servingUnit: "g" },
];
