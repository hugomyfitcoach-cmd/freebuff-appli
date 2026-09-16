<script lang="ts">
	import './tools.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Icon from '$lib/components/Icon.svelte';
	import { errMsg } from '$lib/errors';
	import { planifier, getCategorieFemmeMin25, getCategorieHommeMin15, type Cat } from '$lib/cyclage';

	let { data } = $props();
	/** Retour vers l'espace client uniquement pour la cliente (le CRM coach a sa sidebar). */
	const isClient = $derived(data?.user?.role === 'client');

	/* Icônes Lucide injectées dans les blocs HTML construits en chaîne ({@html}).
	   Même famille, même stroke que le composant <Icon /> — jamais d'emoji UI. */
	const NOTE_IC_PATHS = {
		lightbulb: ['M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'],
		check: ['m16 9-5.5 5.5L8 12'],
		alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
		refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
	} as const;
	const svgIc = (name: keyof typeof NOTE_IC_PATHS, cls = '') =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="note-ic ${cls}" aria-hidden="true">${NOTE_IC_PATHS[name].map((d) => `<path d="${d}" />`).join('')}</svg>`;

	/* ═══════════════════ OUTILS « CALIBRAGE G-FLUX » ═══════════════════
	   Port fidèle du fichier HTML fourni — thème clair (palette cream).
	   ═══════════════════════════════════════════════════════════════════ */

	/* ————— Onglets ————— */
	let panel = $state('p1');
	function setPanel(p: string) {
		panel = p;
		window.scrollTo(0, 0);
	}

	/* ═══════════════════ PANEL 1 : CRU / CUIT ═══════════════════ */
	/* ratio = poids cuit / poids cru ; k = kcal pour 100 g CRU */
	const FOODS = [
		{ n: 'Riz blanc / basmati', r: 2.8, k: 355 },
		{ n: 'Pâtes', r: 2.4, k: 360 },
		{ n: 'Quinoa', r: 3.0, k: 368 },
		{ n: 'Semoule / boulgour', r: 2.6, k: 355 },
		{ n: 'Lentilles (sèches)', r: 2.5, k: 335 },
		{ n: 'Pois chiches (secs)', r: 2.4, k: 330 },
		{ n: "Flocons d'avoine (porridge)", r: 2.5, k: 370 },
		{ n: 'Poulet (filet)', r: 0.72, k: 110 },
		{ n: 'Dinde (escalope)', r: 0.74, k: 105 },
		{ n: 'Steak haché 5%', r: 0.75, k: 125 },
		{ n: 'Steak haché 15%', r: 0.72, k: 200 },
		{ n: 'Bœuf (rumsteck)', r: 0.73, k: 130 },
		{ n: 'Poisson blanc (cabillaud…)', r: 0.8, k: 80 },
		{ n: 'Saumon', r: 0.85, k: 200 },
		{ n: 'Crevettes (décortiquées)', r: 0.85, k: 90 },
	];
	let cvFood = $state(0);
	let cvDir = $state<'cru' | 'cuit'>('cru');
	let cvW = $state('');
	const cvResult = $derived.by(() => {
		const w = parseFloat(cvW);
		if (!w || w <= 0) return null;
		const f = FOODS[cvFood];
		const cru = cvDir === 'cru' ? w : w / f.r;
		const cuit = cvDir === 'cuit' ? w : w * f.r;
		const kcal = Math.round((cru * f.k) / 100);
		return {
			out: Math.round(cvDir === 'cru' ? cuit : cru),
			lab: cvDir === 'cru' ? 'équivalent cuit, dans l’assiette' : 'équivalent cru — c’est CE poids à entrer dans ton app',
			kcal,
			cru: Math.round(cru),
			food: f,
		};
	});
	function setCvDir(v: 'cru' | 'cuit') {
		cvDir = v;
	}

	/* ═══════════════════ PANEL 2 : CALORIES INVISIBLES ═══════════════════ */
	const INV = [
		{ n: "Huile d'olive (cuisson)", u: '1 c. à soupe · 10 g', k: 90 },
		{ n: "Huile d'olive (filet sur salade)", u: '1 c. à café · 5 g', k: 45 },
		{ n: 'Beurre', u: '1 noisette · 10 g', k: 75 },
		{ n: 'Vinaigrette maison', u: '1 c. à soupe · 15 g', k: 65 },
		{ n: 'Mayonnaise', u: '1 c. à soupe · 15 g', k: 105 },
		{ n: 'Ketchup', u: '1 c. à soupe · 15 g', k: 15 },
		{ n: 'Crème fraîche 30%', u: '1 c. à soupe · 15 g', k: 45 },
		{ n: 'Beurre de cacahuète', u: '1 c. à soupe · 16 g', k: 95 },
		{ n: 'Fromage râpé', u: '1 poignée · 20 g', k: 75 },
		{ n: 'Avocat', u: '½ avocat · 75 g', k: 120 },
		{ n: 'Sucre (café / thé)', u: '1 morceau · 6 g', k: 24 },
		{ n: 'Lait dans le café', u: '1 nuage · 20 ml', k: 13 },
		{ n: "Jus d'orange", u: '1 verre · 200 ml', k: 90 },
		{ n: 'Coca / soda', u: '1 verre · 250 ml', k: 105 },
		{ n: 'Sirop (grenadine, menthe…)', u: '1 verre · 3 cl de sirop', k: 75 },
		{ n: 'Vin', u: '1 verre · 125 ml', k: 105 },
		{ n: 'Carré de chocolat', u: '1 carré · 10 g', k: 55 },
		{ n: '« Juste une bouchée » du plat des enfants', u: '~1 bouchée', k: 40 },
	];
	let counts = $state<number[]>(new Array(INV.length).fill(0));
	const invTotal = $derived(counts.reduce((s, c, i) => s + c * INV[i].k, 0));
	const tbEq = $derived.by(() => {
		const kg = Math.round((invTotal * 30) / 7700 * 10) / 10;
		return `≈ ${(invTotal * 7).toLocaleString('fr-FR')} kcal / semaine — soit ~${kg.toLocaleString('fr-FR')} kg de masse grasse potentielle par mois si non tracké`;
	});
	const totalbarVisible = $derived(panel === 'p2' && invTotal > 0);
	function bump(i: number, a: number) {
		counts[i] = Math.max(0, counts[i] + a);
	}
	function resetInv() {
		counts = new Array(INV.length).fill(0);
	}

	/* ═══════════════════ PANEL 3 : PROTÉINES ═══════════════════ */
	/* Aliments à protéine dominante G-Flux.
	   p = g de protéines /100 g ; k = kcal /100 g (sauf unités).
	   slots : repas où l'aliment a sa place naturelle. */
	const P: Record<
		string,
		{
			n: string;
			ic: string;
			cat: string;
			unit?: string;
			g?: number;
			p: number;
			k: number;
			umax?: number;
			min?: number;
			max?: number;
			step?: number;
			slots: string[];
		}
	> = {
		oeuf: { n: 'Œufs entiers', ic: '🥚', cat: 'Œufs', unit: 'œuf', g: 55, p: 7, k: 75, umax: 4, slots: ['matin', 'repas', 'collation'] },
		blancs: { n: "Blancs d'œuf", ic: '🥚', cat: 'Œufs', p: 11, k: 48, min: 50, max: 250, step: 25, slots: ['matin'] },
		poulet: { n: 'Poulet (poids cru)', ic: '🍗', cat: 'Viandes', p: 22, k: 110, min: 80, max: 250, step: 10, slots: ['repas'] },
		dinde: { n: 'Dinde (poids cru)', ic: '🍗', cat: 'Viandes', p: 22, k: 105, min: 80, max: 250, step: 10, slots: ['repas'] },
		steak5: { n: 'Steak haché 5% (cru)', ic: '🥩', cat: 'Viandes', p: 21, k: 125, min: 80, max: 250, step: 10, slots: ['repas'] },
		boeuf: { n: 'Bœuf maigre (cru)', ic: '🥩', cat: 'Viandes', p: 21, k: 130, min: 80, max: 250, step: 10, slots: ['repas'] },
		filetmignon: { n: 'Filet mignon de porc (cru)', ic: '🥩', cat: 'Viandes', p: 21, k: 120, min: 80, max: 250, step: 10, slots: ['repas'] },
		jambon: { n: 'Jambon blanc', ic: '🍖', cat: 'Viandes', unit: 'tranche', g: 40, p: 7.5, k: 44, umax: 4, slots: ['matin', 'collation', 'repas'] },
		pouletTr: { n: 'Blanc de poulet en tranches', ic: '🍖', cat: 'Viandes', unit: 'tranche', g: 25, p: 5.5, k: 25, umax: 6, slots: ['matin', 'collation', 'repas'] },
		grisons: { n: 'Viande des Grisons / bresaola', ic: '🥓', cat: 'Viandes', p: 38, k: 175, min: 20, max: 80, step: 10, slots: ['collation', 'repas'] },
		blanc_poisson: { n: 'Poisson blanc (cru)', ic: '🐟', cat: 'Poissons & mer', p: 18, k: 80, min: 100, max: 280, step: 10, slots: ['repas'] },
		saumon: { n: 'Saumon (cru)', ic: '🐟', cat: 'Poissons & mer', p: 20, k: 200, min: 80, max: 220, step: 10, slots: ['repas'] },
		truite: { n: 'Truite (crue)', ic: '🐟', cat: 'Poissons & mer', p: 20, k: 120, min: 80, max: 250, step: 10, slots: ['repas'] },
		thon: { n: 'Thon en boîte (égoutté)', ic: '🐟', cat: 'Poissons & mer', p: 26, k: 110, min: 60, max: 200, step: 10, slots: ['repas', 'collation'] },
		sardines: { n: 'Sardines en boîte (égouttées)', ic: '🐟', cat: 'Poissons & mer', p: 24, k: 190, min: 60, max: 180, step: 30, slots: ['repas', 'collation'] },
		crevettes: { n: 'Crevettes', ic: '🦐', cat: 'Poissons & mer', p: 19, k: 90, min: 80, max: 250, step: 10, slots: ['repas'] },
		fb: { n: 'Fromage blanc 0%', ic: '🥣', cat: 'Laitages & whey', p: 8, k: 45, min: 100, max: 350, step: 25, slots: ['matin', 'collation'] },
		skyr: { n: 'Skyr', ic: '🥣', cat: 'Laitages & whey', p: 10.5, k: 60, min: 100, max: 350, step: 25, slots: ['matin', 'collation'] },
		grec: { n: 'Yaourt grec', ic: '🥣', cat: 'Laitages & whey', p: 9, k: 95, min: 100, max: 300, step: 25, slots: ['matin', 'collation'] },
		cottage: { n: 'Cottage cheese', ic: '🥣', cat: 'Laitages & whey', p: 11, k: 100, min: 100, max: 300, step: 25, slots: ['matin', 'collation'] },
		psuisse: { n: 'Petits-suisses 0%', ic: '🥣', cat: 'Laitages & whey', unit: 'pot', g: 60, p: 5.5, k: 30, umax: 4, slots: ['matin', 'collation'] },
		whey: { n: 'Whey', ic: '🥤', cat: 'Laitages & whey', p: 80, k: 380, min: 15, max: 60, step: 15, slots: ['matin', 'collation'] },
		tofu: { n: 'Tofu ferme', ic: '🌱', cat: 'Végétal', p: 14, k: 125, min: 100, max: 300, step: 25, slots: ['matin', 'repas'] },
		tempeh: { n: 'Tempeh', ic: '🌱', cat: 'Végétal', p: 19, k: 190, min: 80, max: 220, step: 20, slots: ['repas'] },
		seitan: { n: 'Seitan', ic: '🌱', cat: 'Végétal', p: 23, k: 125, min: 80, max: 220, step: 20, slots: ['repas'] },
		pst: { n: 'Protéines de soja texturées (sec)', ic: '🌱', cat: 'Végétal', p: 50, k: 360, min: 20, max: 80, step: 10, slots: ['repas'] },
		lent: { n: 'Lentilles cuites', ic: '🌱', cat: 'Végétal', p: 9, k: 115, min: 150, max: 350, step: 50, slots: ['repas'] },
		edam: { n: 'Edamame', ic: '🌱', cat: 'Végétal', p: 11, k: 120, min: 80, max: 250, step: 25, slots: ['collation', 'repas'] },
	};
	const P_GROUPS = $derived(
		(() => {
			const cats: string[] = [];
			const map: Record<string, string[]> = {};
			for (const key of Object.keys(P)) {
				if (!map[P[key].cat]) {
					map[P[key].cat] = [];
					cats.push(P[key].cat);
				}
				map[P[key].cat].push(key);
			}
			return cats.map((c) => ({ cat: c, keys: map[c] }));
		})(),
	);
	let prSelected = $state<Set<string>>(new Set());
	function togglePr(key: string) {
		const next = new Set(prSelected);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		prSelected = next;
	}
	let prMealsVal = $state(3);
	function setPrMeals(v: number) {
		prMealsVal = v;
	}
	let prTarget = $state('');
	let prOutHtml = $state('');
	let prOutEl = $state<HTMLDivElement | null>(null);
	$effect(() => {
		const el = prOutEl;
		if (!el) return;
		el.addEventListener('click', onPrOutClick);
		return () => el.removeEventListener('click', onPrOutClick);
	});

	type MealSlot = { key: string; ttl: string; share: number };
	type MealState = { slot: MealSlot; target: number; pool: string[]; idx: number };
	let mealState: MealState[] = [];

	function qtyLabel(f: string, qty: number): string {
		const x = P[f];
		if (x.unit) return `${qty} ${x.unit}${qty > 1 ? 's' : ''} (${qty * (x.g ?? 0)} g)`;
		if (f === 'whey') {
			const d = Math.round((qty / 30) * 10) / 10;
			return `${qty} g (${String(d).replace('.', ',')} dosette${d > 1 ? 's' : ''})`;
		}
		return `${qty} g`;
	}
	function fitFood(f: string, need: number) {
		const x = P[f];
		if (x.unit) {
			let u = Math.round(need / x.p);
			u = Math.max(1, Math.min(x.umax || 4, u));
			return { qty: u, prot: u * x.p, kcal: u * x.k };
		}
		let g = Math.round(((need / x.p) * 100) / (x.step ?? 10)) * (x.step ?? 10);
		g = Math.max(x.min ?? 0, Math.min(x.max ?? 999, g));
		return { qty: g, prot: (g * x.p) / 100, kcal: (g * x.k) / 100 };
	}
	function buildMeal(pool: string[], idx: number, target: number) {
		const lines: { n: string; q: string }[] = [];
		let totalP = 0;
		let totalK = 0;
		let need = target;
		const used: string[] = [];
		for (let n = 0; n < 3 && need > 4; n++) {
			const f = pool[(idx + n) % pool.length];
			if (used.includes(f)) break;
			used.push(f);
			const fit = fitFood(f, need);
			lines.push({ n: P[f].n, q: qtyLabel(f, fit.qty) });
			totalP += fit.prot;
			totalK += fit.kcal;
			need = target - totalP;
		}
		return { lines, p: Math.round(totalP), k: Math.round(totalK), short: target - totalP > 8 };
	}
	function renderMeals(warnMatin: boolean) {
		let html = '';
		let dayP = 0;
		if (warnMatin) {
			html += '<div class="note">' + svgIc('lightbulb', 'ic-amber') + '<div>Aucun aliment "petit-déjeuner" dans ta sélection (œufs, skyr, fromage blanc, whey…) : l’outil a utilisé tes autres sources. Ajoutes-en une si tu préfères un petit-déj classique.</div></div>';
		}
		mealState.forEach((m, mi) => {
			const built = buildMeal(m.pool, m.idx, m.target);
			dayP += built.p;
			html += `<div class="meal"><div class="head"><span class="ttl">${m.slot.ttl}</span><span class="tgt">cible ${m.target} g</span></div><ul>`
				+ built.lines.map((l) => `<li><span>${l.n}</span><span class="q">${l.q}</span></li>`).join('')
				+ `</ul><div class="sum"><span>Protéines : <b>${built.p} g</b></span><span>≈ ${built.k} kcal (sources protéinées)</span></div>`
				+ (built.short ? '<div class="sum" style="border:none;padding-top:4px;color:var(--amber)">Sélection limitée pour atteindre la cible : ajoute un aliment à l’étape 1.</div>' : '')
				+ (m.pool.length > 1 ? `<button class="swap" data-mi="${mi}">${svgIc('refresh')}<span>Une autre option</span></button>` : '')
				+ '</div>';
		});
		html += `<div class="note" style="margin-top:14px">${svgIc('check', 'ic-green')}<div><b>Total journée ≈ ${dayP} g de protéines.</b> Viandes et poissons en <b>poids cru</b>. Complète chaque repas avec tes féculents et légumes selon ton plan.</div></div>`;
		prOutHtml = html;
	}
	function prGo() {
		const target = parseFloat(prTarget);
		const selected = [...prSelected];
		if (selected.length < 3) {
			prOutHtml = '<div class="note">' + svgIc('alert') + '<div>Sélectionne au moins <b>3 aliments</b> que tu manges au quotidien (étape 1) pour construire une journée variée.</div></div>';
			return;
		}
		if (!target || target < 40 || target > 220) {
			prOutHtml = '<div class="note">' + svgIc('alert') + '<div>Entre un objectif entre <b>40</b> et <b>220</b> g (celui que Hugo t’a donné).</div></div>';
			return;
		}
		let slots: MealSlot[] = [];
		if (prMealsVal === 2) slots = [{ key: 'repas', ttl: 'Repas 1 · midi', share: 0.5 }, { key: 'repas', ttl: 'Repas 2 · soir', share: 0.5 }];
		if (prMealsVal === 3) slots = [{ key: 'matin', ttl: 'Petit-déjeuner', share: 1 / 3 }, { key: 'repas', ttl: 'Déjeuner', share: 1 / 3 }, { key: 'repas', ttl: 'Dîner', share: 1 / 3 }];
		if (prMealsVal === 4) slots = [{ key: 'matin', ttl: 'Petit-déjeuner', share: 0.28 }, { key: 'repas', ttl: 'Déjeuner', share: 0.28 }, { key: 'collation', ttl: 'Collation', share: 0.16 }, { key: 'repas', ttl: 'Dîner', share: 0.28 }];
		let warnMatin = false;
		mealState = slots.map((s, si) => {
			let pool = selected.filter((f) => P[f].slots.includes(s.key));
			if (!pool.length) {
				pool = selected;
				if (s.key === 'matin') warnMatin = true;
			}
			return { slot: s, target: Math.round(target * s.share), pool, idx: si };
		});
		renderMeals(warnMatin);
	}
	function onPrOutClick(e: Event) {
		const b = (e.target as HTMLElement).closest('button.swap') as HTMLElement | null;
		if (!b) return;
		const mi = Number(b.dataset.mi);
		const m = mealState[mi];
		if (m) {
			m.idx += 1;
			renderMeals(false);
		}
	}

	/* ═══════════════════ PANEL 4 : MA SEMAINE ═══════════════════ */
	const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
	const KCAL_FLOOR_ABS = 1200; /* plancher absolu */
	const STEPS_CAP_FACTOR = 1.4; /* rattrapage pas plafonné à +40% de l'objectif */
	const todayIdx = $derived((new Date().getDay() + 6) % 7);

	/* Préremplissage automatique — données réelles du suivi (api.tools.calibrage,
	   LECTURE SEULE : ces outils ne modifient jamais les objectifs cliente).
	   - Repères (maintenance / objectif / pas) : valeurs définies par la coach ;
	   - Kcal mangées & pas : Journal et pas réels de chaque journée — une
	     journée sans donnée reste VIDE (jamais comptée comme 0) ;
	   - Semaines passées : les repères du moment sont FIGÉS à la première
	     ouverture (stockage local) — un changement futur de la maintenance,
	     de l'objectif ou des pas ne réécrit jamais une ancienne semaine. */
	type CalDay = { date: string; kcal: number; steps: number };
	type CalData = {
		scoped: boolean;
		today: string;
		currentWeekStart: string;
		earliestWeek: string;
		profile: {
			startDate: string | null;
			weightRefKg: number | null;
			weightRefDate: string | null;
			weightRefSource: string | null;
			bodyFatRef: number | null;
			bodyFatRefDate: string | null;
		};			goals: { kcal: number; maintenanceKcal: number | null; stepGoal: number | null; goalsSet: boolean } | null;
			/** Présence du suivi de cycle — seul indicateur de sexe existant dans G-FLUX. */
			cycle?: { contra?: string } | null;
			days: CalDay[];
		};
	let calLoading = $state(true);
	let calError = $state('');
	let scoped = $state(false);
	let calToday = $state('');
	let weekStart = $state('');
	let earliestWeek = $state('');
	let liveDays = $state<CalDay[]>([]);
	type WeekReperes = { maint: string; obj: string; steps: string; savedAt: number };
	let snapshots = $state<Record<string, WeekReperes>>({});
	const CAL_KEY = 'gflux_semaine_v2';
	let wkMaint = $state('');
	let wkObj = $state('');
	let wkSteps = $state('');
	let wkAdapt = $state(false);
	let wkPlanVisible = $state(false);
	let wkPlanKg = $state('');
	let wkPlanNote = $state('');
	let wkOutVisible = $state(false);
	let wkStatsHtml = $state('');

	function mondayOf(iso: string): string {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
		if (!m) return iso;
		const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
		const day = d.getUTCDay();
		d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
		return d.toISOString().slice(0, 10);
	}
	function isoAddDays(iso: string, n: number): string {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
		if (!m) return iso;
		const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
		return d.toISOString().slice(0, 10);
	}
	const isCurrentWeek = $derived(!!calToday && weekStart === mondayOf(calToday));
	const weekDatesShown = $derived(weekStart ? Array.from({ length: 7 }, (_, i) => isoAddDays(weekStart, i)) : []);
	const liveByDate = $derived(new Map(liveDays.map((d) => [d.date, d])));

	function loadSnapshots() {
		try {
			const o = JSON.parse(window.localStorage.getItem(CAL_KEY) || 'null');
			if (o && o.v === 2 && o.snapshots && typeof o.snapshots === 'object') snapshots = o.snapshots;
		} catch {
			/* stockage indisponible */
		}
	}
	function persistSnapshots() {
		/* Filet de sécurité : ne jamais écraser un repère figé par des valeurs
		   vides (dernier état du WIP interrompu — un snapshot perdu était
		   réécrit vide, puis plus jamais refigé). */
		if (!snapshots || Object.keys(snapshots).length === 0) return;
		try {
			window.localStorage.setItem(CAL_KEY, JSON.stringify({ v: 2, snapshots }));
		} catch {
			/* stockage indisponible */
		}
	}
	/** Repères d'une semaine passée, figés à la première ouverture. */
	function snapshotFor(ws: string): WeekReperes {
		const existing = snapshots[ws];
		if (existing) return existing;
		const snap: WeekReperes = { maint: wkMaint, obj: wkObj, steps: wkSteps, savedAt: Date.now() };
		snapshots = { ...snapshots, [ws]: snap };
		persistSnapshots();
		return snap;
	}
	function shiftWeek(delta: number) {
		if (!calToday || !weekStart) return;
		const next = isoAddDays(weekStart, delta);
		if (next < earliestWeek || next > mondayOf(calToday)) return;
		weekStart = next;
		if (!isCurrentWeek) snapshotFor(weekStart);
		wkCompute();
	}
	const weekLabelShown = $derived.by(() => {
		if (!weekStart) return '';
		const s = new Date(weekStart + 'T00:00:00');
		const e = new Date(isoAddDays(weekStart, 6) + 'T00:00:00');
		const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
		if (s.getMonth() === e.getMonth()) return `Semaine du ${s.getDate()} au ${dayMonth.format(e)} ${e.getFullYear()}`;
		return `Semaine du ${dayMonth.format(s)} au ${dayMonth.format(e)} ${e.getFullYear()}`;
	});
	function dayDateLabel(iso: string): string {
		if (!iso) return '';
		return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
	}
	function isFutureDay(iso: string): boolean {
		return !!calToday && iso > calToday;
	}
	/** Valeurs réelles de la semaine affichée (Journal + pas) — vides si aucune donnée. */
	const wkKShow = $derived(
		weekDatesShown.map((date) => {
			const d = liveByDate.get(date);
			return d ? String(d.kcal) : '';
		})
	);
	const wkSShow = $derived(
		weekDatesShown.map((date) => {
			const d = liveByDate.get(date);
			return d ? String(d.steps) : '';
		})
	);
	/* Repères EFFECTIFS : semaine en cours = valeurs actuelles du suivi ;
	   semaine passée = repères figés à sa première ouverture. */
	const effMaint = $derived(isCurrentWeek ? wkMaint : weekStart ? (snapshots[weekStart]?.maint ?? '') : '');
	const effObj = $derived(isCurrentWeek ? wkObj : weekStart ? (snapshots[weekStart]?.obj ?? '') : '');
	const effSteps = $derived(isCurrentWeek ? wkSteps : weekStart ? (snapshots[weekStart]?.steps ?? '') : '');

	async function loadCalibrage() {
		calLoading = true;
		calError = '';
		try {
			/* Vue coach d'une cliente : /outils?client=<userId> transmis tel quel. */
			const r = await fetch('/api/tools/calibrage' + window.location.search);
			const j = (await r.json()) as Partial<CalData> & { error?: string };
			if (!r.ok || j.error) throw new Error(j.error || 'Chargement des données impossible.');
			scoped = !!j.scoped;
			calToday = j.today ?? '';
			earliestWeek = j.earliestWeek ?? '';
			liveDays = Array.isArray(j.days) ? j.days : [];
			if (scoped && j.goals) {
				wkMaint = j.goals.maintenanceKcal != null ? String(j.goals.maintenanceKcal) : '';
				wkObj = j.goals.goalsSet && j.goals.kcal ? String(j.goals.kcal) : '';
				wkSteps = j.goals.stepGoal != null ? String(j.goals.stepGoal) : '';
			}
			weekStart = calToday ? mondayOf(calToday) : '';
			prefillCyclage(j);
			calLoading = false;
			wkCompute();
		} catch (e) {
			calError = errMsg(e);
			calLoading = false;
			cyclageLoading = false;
		}
	}
	/* Préremplissage du cyclage depuis les données réelles du suivi —
	   aucune valeur inventée : ce qui manque est signalé comme manquant. */
	function prefillCyclage(j: Partial<CalData>) {
		cyclageLoading = false;
		if (!j.scoped || !j.profile) {
			/* Hors périmètre (coach sans cliente sélectionnée) : simulateur
			   manuel — champs laissés vides, rien n'est inventé. */
			cycSexeKnown = null;
			cycPoidsKnown = null;
			cycPctKnown = null;
			cycApportKnown = null;
			cycDateKnown = null;
			return;
		}
		const p = j.profile;
		/* Sexe : le seul indice fiable déjà présent dans G-FLUX est le suivi
		   de cycle (exclusivement féminin). Sinon : champ laissé manuel, jamais
		   déduit du prénom ou d'une supposition. */
		if (j.cycle) {
			sexe = 'femme';
			cycSexeKnown = true;
		} else {
			cycSexeKnown = false;
		}
		poids = p.weightRefKg != null ? String(p.weightRefKg) : '';
		cycPoidsKnown = p.weightRefKg != null;
		pctGraisse = p.bodyFatRef != null ? String(Math.round(p.bodyFatRef * 10) / 10) : '';
		cycPctKnown = p.bodyFatRef != null;
		apport = j.goals && j.goals.goalsSet && j.goals.kcal ? String(j.goals.kcal) : '';
		cycApportKnown = !!(j.goals && j.goals.goalsSet && j.goals.kcal);
		dateDebut = p.startDate ?? '';
		cycDateKnown = !!p.startDate;
		/* Planification générée d'emblée si toutes les données sont déjà là. */
		if (cyclageReady) generer();
	}
	function wkCompute() {
		/* La semaine en cours lit les repères actuels ; une semaine passée
		   rejoue ses repères figés — jamais les valeurs d'aujourd'hui. */
		const o = {
			maint: effMaint,
			obj: effObj,
			steps: effSteps,
			adapt: isCurrentWeek ? wkAdapt : false,
			k: wkKShow,
			s: wkSShow,
		};
		const maint = +o.maint;
		const obj = +o.obj;
		const stepsObj = +o.steps;
		if (!(maint > 0 && obj > 0 && obj < maint)) {
			wkPlanVisible = false;
			wkOutVisible = false;
			return;
		}
		/* perte planifiée, avec adaptation métabolique éventuelle */
		const f = o.adapt ? 0.88 : 1;
		const planKg = Math.round(((maint - obj) * 7 * f) / 7700 * 100) / 100;
		wkPlanKg = '~' + String(planKg).replace('.', ',') + '<small> kg</small>';
		wkPlanNote = o.adapt
			? 'Adaptation métabolique de ~12% incluse (validée avec Hugo).'
			: 'Estimation théorique — valable s’il n’y a pas d’adaptation métabolique en place depuis le début de ton déficit.';
		wkPlanVisible = true;

		const kVals = o.k.map((v) => (v === '' ? null : +v));
		const filled = kVals.filter((v) => v !== null && v > 0) as number[];
		if (!filled.length) {
			wkOutVisible = false;
			return;
		}
		const spent = filled.reduce((a, b) => a + b, 0);
		const remDays = 7 - filled.length;
		const budget = obj * 7;
		const floor = Math.max(KCAL_FLOOR_ABS, Math.round(obj * 0.8));
		let rows = '';
		if (remDays === 0) {
			const realDef = Math.max(0, maint * 7 - spent) * f;
			const realKg = Math.round((realDef / 7700) * 100) / 100;
			const diff = spent - budget;
			let endMsg: string;
			if (realKg >= planKg * 0.95) {
				endMsg = 'Semaine dans les clous. Continue exactement comme ça.';
			} else if (realKg >= 0.2) {
				endMsg = `~${Math.round(realKg * 1000)} g de perdus cette semaine : c’est sous la vitesse prévue, mais c’est une vraie perte qui se cumule — bien mieux que rien. Si ça se répète, on ajuste le plan avec Hugo.`;
			} else {
				endMsg = 'Semaine au-dessus du plan : pas de panique, pas de restriction extrême. On repart sur le plan dès lundi — c’est le mois qui compte.';
			}
			rows += `<div class="stat"><span>Total de la semaine</span><b${diff > 0 ? ' class="warn"' : ''}>${spent.toLocaleString('fr-FR')} / ${budget.toLocaleString('fr-FR')} kcal</b></div>`;
			rows += `<div class="stat"><span>Déficit réel cumulé</span><b>${Math.round(realDef).toLocaleString('fr-FR')} kcal</b></div>`;
			rows += `<div class="stat"><span>Perte estimée cette semaine</span><b>~${String(realKg).replace('.', ',')} kg</b></div>`;
			rows += `<div class="stat"><span style="flex:1">${endMsg}</span></div>`;
		} else {
			const rest = budget - spent;
			let reco = Math.round(rest / remDays / 10) * 10;
			let msg = '';
			if (reco < floor) {
				reco = floor;
				const overflow = spent + floor * remDays - budget;
				msg = `Plancher de sécurité atteint : on ne descend pas sous ${floor.toLocaleString('fr-FR')} kcal. La semaine finira à ~+${overflow.toLocaleString('fr-FR')} kcal du plan — on ne rattrape pas tout, et c’est normal : le déficit se joue sur le mois.`;
			} else if (reco > maint) {
				reco = obj;
				msg = `Tu as de la marge d’avance : reste simplement à ton objectif de ${obj.toLocaleString('fr-FR')} kcal. Pas besoin de manger plus, mais ne descends pas plus bas non plus.`;
			} else if (reco < obj) {
				msg = `Reste à ~${reco.toLocaleString('fr-FR')} kcal sur les jours restants et ta semaine retombe pile sur le plan.`;
			} else {
				msg = `Tu es légèrement sous le plan : tu peux remonter à ~${reco.toLocaleString('fr-FR')} kcal sans aucun impact sur ta perte.`;
			}
			const projDef = Math.max(0, maint * 7 - (spent + reco * remDays)) * f;
			const projKg = Math.round((projDef / 7700) * 100) / 100;
			rows += `<div class="stat"><span>Déjà mangé (${filled.length} j)</span><b${spent > obj * filled.length ? ' class="warn"' : ''}>${spent.toLocaleString('fr-FR')} kcal</b></div>`;
			rows += `<div class="stat"><span>Budget restant (${remDays} j)</span><b>${Math.max(0, rest).toLocaleString('fr-FR')} kcal</b></div>`;
			rows += `<div class="stat"><span>Cible / jour restant</span><b>~${reco.toLocaleString('fr-FR')} kcal</b></div>`;
			rows += `<div class="stat"><span>Perte projetée de la semaine</span><b>~${String(projKg).replace('.', ',')} kg</b></div>`;
			rows += `<div class="stat"><span style="flex:1">${msg}</span></div>`;
		}
		/* pas */
		if (stepsObj > 0) {
			const sVals = o.s.map((v) => (v === '' ? null : +v));
			const sFilled = sVals.filter((v) => v !== null && v > 0) as number[];
			if (sFilled.length) {
				const done = sFilled.reduce((a, b) => a + b, 0);
				const sRem = 7 - sFilled.length;
				const sTarget = stepsObj * 7;
				if (sRem === 0) {
					rows += `<div class="stat"><span>Pas de la semaine</span><b${done < sTarget ? ' class="warn"' : ''}>${done.toLocaleString('fr-FR')} / ${sTarget.toLocaleString('fr-FR')}</b></div>`;
				} else {
					let sReco = Math.round(((sTarget - done) / sRem) / 100) * 100;
					const sCap = Math.round(stepsObj * STEPS_CAP_FACTOR);
					let sMsg = '';
					if (sReco <= 0) {
						sReco = stepsObj;
						sMsg = 'Objectif pas déjà sécurisé : garde ton rythme normal.';
					} else if (sReco > sCap) {
						sReco = sCap;
						sMsg = `Inutile de courir après les pas manqués : plafonne à ${sCap.toLocaleString('fr-FR')}/jour et reprends ton rythme. La régularité bat le rattrapage.`;
					}
					rows += `<div class="stat"><span>Pas restants à répartir</span><b>${Math.max(0, sTarget - done).toLocaleString('fr-FR')}</b></div>`;
					rows += `<div class="stat"><span>Cible pas / jour restant</span><b>~${sReco.toLocaleString('fr-FR')}</b></div>`;
					if (sMsg) rows += `<div class="stat"><span style="flex:1">${sMsg}</span></div>`;
				}
			}
		}
		wkStatsHtml = rows;
		wkOutVisible = true;
	}

	/* ═══════════════════ PANEL 6 : CYCLAGE REFEED / DIET BREAK ═══════════════════ */
	/* Prérempli depuis le profil réel (loadCalibrage → prefillCyclage) : sexe,
	   poids et % de graisse de DÉPART (premier point de la série bodyFatSeries
	   — même source de vérité que « Ma progression »), apport = objectif
	   calorique du CRM, date de début = démarrage du coaching. Horizon FIXE :
	   6 mois. Les champs restent éditables (simulation) mais rien n'est jamais
	   écrit vers le suivi : l'outil n'est pas la source de vérité. */
	let sexe = $state('femme');
	let pctGraisse = $state('');
	let poids = $state('');
	let apport = $state('');
	let methode = $state('alpert');
	let dateDebut = $state('');
	let cyclageLoading = $state(true);
	let cyclageErr = $state('');
	let cyclageVisible = $state(false);
	/* Provenance de chaque donnée préremplie (null = pas encore chargé). */
	let cycSexeKnown = $state<boolean | null>(null);
	let cycPoidsKnown = $state<boolean | null>(null);
	let cycPctKnown = $state<boolean | null>(null);
	let cycApportKnown = $state<boolean | null>(null);
	let cycDateKnown = $state<boolean | null>(null);
	let outMasseMaigre = $state('—');
	let outEA = $state('—');
	let outCategorie = $state('—');
	let outRefeedLine = $state('');
	let outBreakLine = $state('');
	let outOfGridWarn = $state(false);
	let planTableHtml = $state('');
	const showMethode = $derived(sexe === 'homme' && !isNaN(parseFloat(pctGraisse)) && parseFloat(pctGraisse) < 15);
	/* Donnée manquante = réellement absente du profil de la cliente
	   (null avant chargement — jamais signalée à tort). */
	const cycSexeMissing = $derived(cycSexeKnown === false);
	const cycPoidsMissing = $derived(cycPoidsKnown === false);
	const cycPctMissing = $derived(cycPctKnown === false);
	const cycApportMissing = $derived(cycApportKnown === false);
	const cycDateMissing = $derived(cycDateKnown === false);
	const dateDebutLabel = $derived(
		dateDebut && /^\d{4}-\d{2}-\d{2}$/.test(dateDebut)
			? new Date(dateDebut + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
			: '—'
	);
	const cyclageReady = $derived(!!poids && !!pctGraisse && !!apport && !!dateDebut);

	/* Grille reprise telle quelle de la formation « La science de la perte de graisse rapide » */
	function getCategorie(sexeV: string, pct: number, ea: number, methodeV: string): Cat {
		if (sexeV === 'femme') {
			if (pct > 35) {
				return {
					label: 'Femme >35% graisse',
					refeedPlanned: false,
					refeedNote: '2-3 jours non planifiés si nécessaire',
					breakWeeks: 10,
					breakRangeLabel: '8-12 semaines',
				};
			}
			if (pct >= 25) {
				return {
					label: 'Femme 25-35% graisse',
					refeedPlanned: false,
					refeedNote: '2-3 jours non planifiés si nécessaire',
					breakWeeks: 8,
					breakRangeLabel: '6-10 semaines',
				};
			}
			return getCategorieFemmeMin25(ea);
		} else {
			if (pct > 25) {
				return {
					label: 'Homme >25% graisse',
					refeedPlanned: false,
					refeedNote: '2-3 jours non planifiés si nécessaire',
					breakWeeks: 10,
					breakRangeLabel: '8-12 semaines',
				};
			}
			if (pct >= 15) {
				return {
					label: 'Homme 15-25% graisse',
					refeedPlanned: false,
					refeedNote: '2-3 jours non planifiés si nécessaire',
					breakWeeks: 8,
					breakRangeLabel: '6-10 semaines',
				};
			}
		return getCategorieHommeMin15(methodeV);
	}
}

	function fmtDate(d: Date) {
		return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
	}
	function addDays(date: Date, n: number) {
		const d = new Date(date);
		d.setDate(d.getDate() + n);
		return d;
	}
	/** Recalcul manuel (bouton) — la première génération part du préremplissage. */
	function regenerer() {
		cyclageVisible = false;
		generer();
	}
	function generer() {
		const sexeV = sexe;
		const poidsV = parseFloat(poids);
		const pct = parseFloat(pctGraisse);
		const apportV = parseFloat(apport);
		const methodeV = methode;
		const dateDebutStr = dateDebut;

		if (!poidsV || !pct || !apportV || !dateDebutStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateDebutStr)) {
			cyclageErr = 'Donnée manquante pour générer la planification (poids de départ, % de graisse, apport calorique ou date de début).';
			cyclageVisible = false;
			return;
		}
		cyclageErr = '';

		const masseMaigre = poidsV * (1 - pct / 100);
		/* « Dépense totale de sport » retirée : EA = apport / masse maigre,
		   exactement comme l'ancien défaut du champ (dépense = 0). */
		const ea = apportV / masseMaigre;
		const cat = getCategorie(sexeV, pct, ea, methodeV);

		outMasseMaigre = masseMaigre.toFixed(1) + ' kg';
		outEA = ea.toFixed(1) + ' kcal/kg MM';
		outCategorie = cat.label;

		if (cat.outOfGrid) {
			outRefeedLine = '';
			outOfGridWarn = true;
		} else {
			outRefeedLine = '<b>Refeed :</b> ' + (cat.refeedNote || '—');
			outOfGridWarn = false;
		}
		outBreakLine = '<b>Diet break :</b> 7 jours toutes les ' + cat.breakWeeks + ' semaines (plage de référence : ' + cat.breakRangeLabel + ')';

		const dateDebutObj = new Date(dateDebutStr + 'T00:00:00');

		const blocks = planifier(cat);

		planTableHtml = blocks
			.map((b) => {
				const start = addDays(dateDebutObj, b.startDay);
				const end = addDays(dateDebutObj, b.endDay);
				const label = b.phase === 'break' ? 'Diet break' : b.phase === 'refeed' ? 'Refeed' : 'Déficit';
				const extraNote = b.phase === 'refeed' ? ' <span class="pill-note">non obligatoire</span>' : '';
				const pillClass = b.phase === 'break' ? 'break' : b.phase === 'refeed' ? 'refeed' : 'deficit';
				const nbJours = b.endDay - b.startDay + 1;
				return `<tr><td>${nbJours} j</td><td>${fmtDate(start)}${nbJours > 1 ? ' → ' + fmtDate(end) : ''}</td>` +
					`<td><span class="phase-pill ${pillClass}">${label}</span>${extraNote}</td></tr>`;
			})
			.join('');

		cyclageVisible = true;
	}

	/* ————— Init : données réelles du suivi + historique local des repères ————— */
	onMount(() => {
		if (browser) {
			loadSnapshots();
			void loadCalibrage();
		}
	});
</script>

<svelte:head>
	<title>Outils &amp; calibrage — G-Flux</title>
</svelte:head>

<div class="tools-root">
	<div class="wrap">
		{#if isClient}
			<a href="/espace" class="tools-back"><Icon name="arrowLeft" size={16} class="shrink-0" /> Accueil</a>
		{/if}
		<header>
			<h1>Calibrage</h1>
			<p class="sub">
				Des outils bonus pour y voir plus clair : tracker juste, comprendre ton déficit et piloter ta
				semaine. Ils complètent ton plan G-Flux — ils ne le remplacent pas.
			</p>
		</header>

		<div class="tabs" role="tablist">
			<button type="button" class="tab" class:active={panel === 'p1'} onclick={() => setPanel('p1')}>Cru ⇄ Cuit</button>
			<button type="button" class="tab" class:active={panel === 'p2'} onclick={() => setPanel('p2')}>Calories invisibles</button>
			<button type="button" class="tab" class:active={panel === 'p3'} onclick={() => setPanel('p3')}>Mes protéines</button>
			<button type="button" class="tab" class:active={panel === 'p4'} onclick={() => setPanel('p4')}>Ma semaine</button>
			<button type="button" class="tab tab-highlight" class:active={panel === 'p6'} onclick={() => setPanel('p6')}>Cyclage</button>
		</div>

		<!-- ═══════ PANEL 1 : CRU / CUIT ═══════ -->
		<section class="panel" class:active={panel === 'p1'}>
			<div class="note">
				<Icon name="triangleAlert" size={16} class="note-ic ic-amber" /><div><b>L'erreur n°1 du tracking :</b> peser cuit mais entrer le poids dans l'app comme si c'était cru (ou l'inverse). Sur le riz, ça peut fausser ta journée de 200&nbsp;kcal.</div>
			</div>
			<div class="card">
				<h2>Convertisseur cru ⇄ cuit</h2>
				<p class="hint">Choisis l'aliment, indique ce que tu as pesé : l'outil te donne l'équivalent et les calories réelles.</p>

				<label for="cvFood">Aliment</label>
				<select id="cvFood" bind:value={cvFood}>
					{#each FOODS as f, i (f.n)}
						<option value={i}>{f.n}</option>
					{/each}
				</select>

				<div class="glabel">J'ai pesé…</div>
				<div class="seg">
					<button type="button" class:on={cvDir === 'cru'} onclick={() => setCvDir('cru')}>Cru (avant cuisson)</button>
					<button type="button" class:on={cvDir === 'cuit'} onclick={() => setCvDir('cuit')}>Cuit (dans l'assiette)</button>
				</div>

				<label for="cvW">Poids pesé (g)</label>
				<input id="cvW" type="number" bind:value={cvW} inputmode="numeric" placeholder="ex. 100" min="0" />

				{#if cvResult}
					<div class="result">
						<div class="big">{cvResult.out}<small> g</small></div>
						<div class="lab">{cvResult.lab}</div>
						<div class="kcal">Soit <b>{cvResult.kcal} kcal</b> ({cvResult.cru} g cru × {cvResult.food.k} kcal/100 g)</div>
					</div>
				{/if}
			</div>
			<div class="card">
				<h2>À entrer dans ton app</h2>
				<p class="hint" style="margin-bottom:0">Règle G-Flux : tracke toujours le <b style="color:var(--green)">poids cru</b> pour les féculents et les viandes. C'est la valeur de référence des bases de données (Ciqual, MyFitnessPal…). Si tu as pesé cuit, utilise le convertisseur ci-dessus pour retrouver le poids cru.</p>
			</div>
		</section>

		<!-- ═══════ PANEL 2 : CALORIES INVISIBLES ═══════ -->
		<section class="panel" class:active={panel === 'p2'}>
			<div class="note">
				<Icon name="triangleAlert" size={16} class="note-ic ic-amber" /><div><b>Ce qui n'est pas pesé existe quand même.</b> Coche ce que tu ajoutes dans une journée normale sans le tracker, et regarde le total en bas.</div>
			</div>
			<div class="card">
				<h2>Compteur de calories invisibles</h2>
				<p class="hint">Appuie sur + pour chaque ajout d'une journée type. Le total s'affiche en bas de l'écran.</p>
				<div class="items">
					{#each INV as it, i (it.n)}
						<div class="item" class:picked={counts[i] > 0}>
							<div class="nm"><b>{it.n}</b><span>{it.u}</span></div>
							<div class="kc">{it.k} kcal</div>
							<div class="ctr">
								<button type="button" aria-label="moins" onclick={() => bump(i, -1)}>−</button>
								<span class="n">{counts[i]}</span>
								<button type="button" aria-label="plus" onclick={() => bump(i, 1)}>+</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- ═══════ PANEL 3 : PROTÉINES ═══════ -->
		<section class="panel" class:active={panel === 'p3'}>
			<div class="card">
				<h2>1 · Mes sources de protéines</h2>
				<p class="hint">Sélectionne uniquement les aliments que tu manges <b style="color:var(--green)">vraiment</b> au quotidien. C'est avec eux qu'on construit ta journée.</p>
				<div class="checks">
					{#each P_GROUPS as g (g.cat)}
						<div class="cathead">{g.cat}</div>
						{#each g.keys as key (key)}
							<button type="button" class="chk" class:on={prSelected.has(key)} onclick={() => togglePr(key)}>
								{P[key].ic} {P[key].n.replace(/ \(.*\)/, '')}
							</button>
						{/each}
					{/each}
				</div>
			</div>
			<div class="card">
				<h2>2 · Ma journée</h2>
				<label for="prTarget">Mon objectif protéines — celui défini avec Hugo (g / jour)</label>
				<input id="prTarget" type="number" bind:value={prTarget} inputmode="numeric" placeholder="ex. 90" min="40" max="220" />
				<p class="hint" style="margin:8px 0 0">Ce chiffre se trouve dans ton plan personnalisé. Tu ne le retrouves pas ? Demande-le à Hugo sur WhatsApp avant de remplir.</p>

				<div class="glabel">Mes repas</div>
				<div class="seg">
					<button type="button" class:on={prMealsVal === 2} onclick={() => setPrMeals(2)}>2 repas</button>
					<button type="button" class:on={prMealsVal === 3} onclick={() => setPrMeals(3)}>3 repas</button>
					<button type="button" class:on={prMealsVal === 4} onclick={() => setPrMeals(4)}>3 + collation</button>
				</div>

				<button type="button" class="cta" onclick={prGo}>Construire ma journée</button>
			</div>
			<div bind:this={prOutEl}>{@html prOutHtml}</div>
		</section>

		<!-- ═══════ PANEL 4 : MA SEMAINE ═══════ -->
		<section class="panel" class:active={panel === 'p4'}>
			<div class="note">
				<Icon name="lightbulb" size={16} class="note-ic ic-amber" /><div><b>Une journée haute n'annule rien.</b> Ton déficit se calcule sur la semaine, pas sur la journée. Cet outil te dit comment moduler les jours restants — sans jamais descendre trop bas.</div>
			</div>
			<div class="card">
				<h2>1 · Mes repères — définis par Hugo</h2>
				{#if calLoading}
					<p class="hint">Chargement de tes données…</p>
				{:else if calError}
					<div class="note"><Icon name="triangleAlert" size={16} class="note-ic ic-amber" /><div>{calError}</div></div>
				{:else}
					{#if !scoped}<p class="hint">Vue coach générique — sélectionne une cliente depuis le CRM (?client=…) pour préremplir ses données réelles.</p>{/if}
					<p class="hint">Lus automatiquement dans ton suivi G-FLUX (objectifs définis par Hugo dans le CRM). Pour changer un chiffre : demande à Hugo, il l'ajuste dans ton suivi.</p>
					<label for="wkMaint">Ma maintenance (kcal / jour)</label>
					<input id="wkMaint" type="number" class="ro" readonly bind:value={wkMaint} placeholder="—" />
					{#if scoped && !wkMaint}<p class="missnote">Maintenance non définie — Hugo peut la renseigner dans le CRM (objectifs).</p>{/if}
					<label for="wkObj">Mon objectif (kcal / jour)</label>
					<input id="wkObj" type="number" class="ro" readonly bind:value={wkObj} placeholder="—" />
					{#if scoped && !wkObj}<p class="missnote">Objectif calorique non défini — Hugo peut le renseigner dans le CRM (objectifs).</p>{/if}
					<label for="wkSteps">Mon objectif de pas (par jour)</label>
					<input id="wkSteps" type="number" class="ro" readonly bind:value={wkSteps} placeholder="—" />
					{#if scoped && !wkSteps}<p class="missnote">Objectif de pas non défini — Hugo peut le renseigner dans le CRM (objectifs).</p>{/if}
				{/if}
				<div class="glabel">Adaptation métabolique</div>
				<div class="checks">
					<button type="button" class="chk" class:on={wkAdapt} onclick={() => { wkAdapt = !wkAdapt; wkCompute(); }}><Icon name="settings" size={16} class="shrink-0" /> Appliquer ~12% d'adaptation — uniquement si validé avec Hugo</button>
				</div>
				{#if wkPlanVisible}
					<div class="result">
						<div class="big">{@html wkPlanKg}</div>
						<div class="lab">de perte estimée par semaine si tu suis ton plan</div>
						<div class="kcal" style="font-size:12px;color:var(--muted)">{wkPlanNote}</div>
					</div>
				{/if}
			</div>
			<div class="card">
				<h2>{isCurrentWeek ? '2 · Ma semaine en cours' : '2 · Semaine historique'}</h2>
				<div class="wknav">
					<button type="button" class="navbtn" aria-label="Semaine précédente" disabled={!weekStart || weekStart <= earliestWeek} onclick={() => shiftWeek(-7)}><Icon name="chevronLeft" size={16} /></button>
					<span class="wklabel">{weekLabelShown}</span>
					<button type="button" class="navbtn" aria-label="Semaine suivante" disabled={!weekStart || isCurrentWeek} onclick={() => shiftWeek(7)}><Icon name="chevronRight" size={16} /></button>
				</div>
				<p class="hint">
					{#if isCurrentWeek}Rempli automatiquement depuis ton Journal et tes pas de chaque journée. Les jours à venir restent vides.{:else}Semaine passée : calories et pas réels de l'époque, avec les repères qui étaient en vigueur. Jamais réécrite.{/if}
				</p>
				<div class="wkgrid">
					<span class="h"></span><span class="h">Kcal mangées</span><span class="h">Pas faits</span>
					{#each DAYS as d, i (d)}
						<span class="d">{d}<small class="ddate">{dayDateLabel(weekDatesShown[i] ?? '')}</small></span>
						<input type="number" readonly class="ro" placeholder="—" min="0" class:today={isCurrentWeek && i === todayIdx} class:future={isFutureDay(weekDatesShown[i] ?? '')} value={wkKShow[i]} />
						<input type="number" readonly class="ro" placeholder="—" min="0" class:today={isCurrentWeek && i === todayIdx} class:future={isFutureDay(weekDatesShown[i] ?? '')} value={wkSShow[i]} />
					{/each}
				</div>
			</div>
			{#if wkOutVisible}
				<div class="card">
					<h2>3 · Comment moduler le reste de la semaine</h2>
					{@html wkStatsHtml}
				</div>
			{/if}
		</section>

		<!-- ═══════ PANEL 6 : CYCLAGE REFEED / DIET BREAK ═══════ -->
		<section class="panel" class:active={panel === 'p6'}>
			<div class="card">
				<h2>Planification refeed / diet break</h2>
				<p class="hint">Basée sur la grille de cyclage calorique selon le % de graisse et la disponibilité énergétique — préremplie depuis le profil réel de la cliente.</p>

				{#if cyclageLoading}
					<p class="hint">Chargement des données…</p>
				{:else}
					<div class="row">
						<div class="field">
							<label for="sexe">Sexe</label>
							<select id="sexe" bind:value={sexe}>
								<option value="femme">Femme</option>
								<option value="homme">Homme</option>
							</select>
							{#if cycSexeMissing}<p class="missnote">Sexe non renseigné dans le profil — à sélectionner manuellement.</p>{/if}
						</div>
						<div class="field">
							<label for="dateDebut">Date de début du coaching</label>
							<input id="dateDebut" type="date" bind:value={dateDebut} />
							{#if cycDateMissing}<p class="missnote">Date de démarrage du coaching non renseignée — Hugo peut la définir dans la fiche CRM de la cliente.</p>{/if}
						</div>
					</div>

					<div class="row">
						<div class="field">
							<label for="poids">Poids de départ (kg)</label>
							<input id="poids" type="number" bind:value={poids} placeholder="—" step="0.1" />
							{#if cycPoidsMissing}<p class="missnote">Aucune pesée enregistrée — Hugo peut ajouter les mensurations de départ dans le suivi de la cliente.</p>{/if}
						</div>
						<div class="field">
							<label for="pctGraisse">% de graisse de départ</label>
							<input id="pctGraisse" type="number" bind:value={pctGraisse} placeholder="—" step="0.1" />
							{#if cycPctMissing}<p class="missnote">% de graisse de départ non calculable — mensurations de départ incomplètes (tour de cou / taille / fessiers attendus).</p>{/if}
						</div>
					</div>

					<div class="row">
						<div class="field">
							<label for="apport">Apport calorique prévu (kcal/j)</label>
							<input id="apport" type="number" bind:value={apport} placeholder="—" step="10" />
							{#if cycApportMissing}<p class="missnote">Objectif calorique non défini — Hugo peut le renseigner dans le CRM (objectifs).</p>{/if}
						</div>
						<div class="field">
							<label>Horizon de planification</label>
							<div class="horizon">6 mois à partir du {dateDebutLabel}</div>
						</div>
					</div>

					{#if showMethode}
						<label for="methode">Méthode de calcul du déficit</label>
						<select id="methode" bind:value={methode}>
							<option value="alpert">Alpert</option>
							<option value="macdonald">Macdonald</option>
						</select>
					{/if}

					{#if cyclageErr && !cyclageVisible}
						<div class="note"><Icon name="triangleAlert" size={16} class="note-ic ic-amber" /><div>{cyclageErr}</div></div>
					{/if}

					<button type="button" class="cta" onclick={regenerer}>Recalculer la planification</button>
				{/if}
			</div>

			{#if cyclageVisible}
				<div class="cyclage-result visible">
					<div class="card">
						<h2>Profil calculé</h2>
						<div class="summary-grid">
							<div class="summary-item">
								<div class="summary-label">Masse maigre</div>
								<div class="summary-value">{outMasseMaigre}</div>
							</div>
							<div class="summary-item">
								<div class="summary-label">Disponibilité énergétique</div>
								<div class="summary-value accent">{outEA}</div>
							</div>
						</div>
						<div class="category-tag">{outCategorie}</div>
						<p class="cadence-line">{@html outRefeedLine}</p>
						<p class="cadence-line">{@html outBreakLine}</p>
						{#if outOfGridWarn}
							<div class="note" style="display:flex"><Icon name="triangleAlert" size={16} class="note-ic ic-amber" /><div>Disponibilité énergétique en dessous de 20 kcal/kg de masse maigre — hors de la grille de référence. Ne pas extrapoler une cadence automatique : à valider manuellement, cas par cas.</div></div>
						{/if}
					</div>

					<div class="card">
						<h2>Calendrier de planification</h2>
						<table id="planTable">
							<thead><tr><th>Période</th><th>Dates</th><th>Phase</th></tr></thead>
							<tbody>{@html planTableHtml}</tbody>
						</table>
						<p class="cycle-principle">Grille de départ, pas une règle automatique — évaluez toujours la situation globale de la coachée avant d'appliquer.</p>
					</div>

					<div class="card">
						<h2>Comment faire un diet break (7 jours)</h2>
						<ul class="howto">
							<li><b>Calories :</b> retour à ta maintenance calorique (le chiffre que Hugo t'a donné) — ce n'est pas un surplus.</li>
							<li><b>Protéines :</b> inchangées, 1,6 à 2,2 g/kg de poids.</li>
							<li><b>Lipides :</b> peuvent être un peu plus élevés que d'habitude, autour de 0,7 à 1 g/kg.</li>
							<li><b>Glucides :</b> le reste des calories — c'est là que la hausse se fait principalement.</li>
							<li><b>Ce que ça n'est pas :</b> une semaine "cheat" à volonté. Garde tes bonnes habitudes — protéines à chaque repas, légumes, structure globale des repas.</li>
							<li><b>Tracking :</b> pas obligatoire de tout peser au gramme si tu es à l'aise — sauf si ton % de graisse est déjà bas, où mieux vaut continuer à suivre précisément.</li>
							<li><b>À quoi ça sert :</b> souffler, rebooster ta motivation, et surtout t'entraîner à manger à ta maintenance — c'est la diète que tu utiliseras pour stabiliser ton poids plus tard, pas celle du déficit.</li>
						</ul>
					</div>

					<div class="card">
						<h2>Comment faire un refeed (2-3 jours)</h2>
						<ul class="howto">
							<li><b>Calories :</b> au moins ta maintenance calorique, léger surplus possible.</li>
							<li><b>Protéines :</b> modérées, 1,6 à 2 g/kg.</li>
							<li><b>Lipides :</b> au minimum — garde-les vraiment bas pendant ces jours-là.</li>
							<li><b>Glucides :</b> l'essentiel de tes calories vient de là. Privilégie des sources faciles à digérer et pauvres en fibres/graisses : riz, pâtes, pain, pommes de terre. Pas plus de 100-120g de sucres simples sur la journée.</li>
							<li><b>Ce que ça n'est pas :</b> un "cheat day". Reste structurée sur les repas, seule la quantité de glucides change vraiment.</li>
							<li><b>À quoi ça sert :</b> relancer tes stocks de glycogène et calmer ta faim — pas faire une pause complète comme le diet break.</li>
						</ul>
					</div>
				</div>
			{/if}
		</section>

		<footer>
			Quantités indicatives (sources : Ciqual ANSES). Ton plan personnalisé prime toujours.<br />
			© 2026 G-FLUX — Tous droits réservés
		</footer>
	</div>

	<!-- Total bar (calories invisibles) -->
	<div class="totalbar" class:show={totalbarVisible}>
		<div class="inner">
			<div>
				<div class="t1">Calories invisibles / jour</div>
				<div class="t2"><span>{invTotal}</span> <small>kcal</small></div>
				<div class="eq">{tbEq}</div>
			</div>
			<button type="button" onclick={resetInv}>Réinitialiser</button>
		</div>
	</div>
</div>