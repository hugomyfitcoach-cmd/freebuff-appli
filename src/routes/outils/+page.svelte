<script lang="ts">
	import './tools.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

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
			html += '<div class="note">💡<div>Aucun aliment "petit-déjeuner" dans ta sélection (œufs, skyr, fromage blanc, whey…) : l’outil a utilisé tes autres sources. Ajoutes-en une si tu préfères un petit-déj classique.</div></div>';
		}
		mealState.forEach((m, mi) => {
			const built = buildMeal(m.pool, m.idx, m.target);
			dayP += built.p;
			html += `<div class="meal"><div class="head"><span class="ttl">${m.slot.ttl}</span><span class="tgt">cible ${m.target} g</span></div><ul>`
				+ built.lines.map((l) => `<li><span>${l.n}</span><span class="q">${l.q}</span></li>`).join('')
				+ `</ul><div class="sum"><span>Protéines : <b>${built.p} g</b></span><span>≈ ${built.k} kcal (sources protéinées)</span></div>`
				+ (built.short ? '<div class="sum" style="border:none;padding-top:4px;color:var(--amber)">Sélection limitée pour atteindre la cible : ajoute un aliment à l’étape 1.</div>' : '')
				+ (m.pool.length > 1 ? `<button class="swap" data-mi="${mi}">↻ Une autre option</button>` : '')
				+ '</div>';
		});
		html += `<div class="note" style="margin-top:14px">✅<div><b>Total journée ≈ ${dayP} g de protéines.</b> Viandes et poissons en <b>poids cru</b>. Complète chaque repas avec tes féculents et légumes selon ton plan.</div></div>`;
		prOutHtml = html;
	}
	function prGo() {
		const target = parseFloat(prTarget);
		const selected = [...prSelected];
		if (selected.length < 3) {
			prOutHtml = '<div class="note">⚠️<div>Sélectionne au moins <b>3 aliments</b> que tu manges au quotidien (étape 1) pour construire une journée variée.</div></div>';
			return;
		}
		if (!target || target < 40 || target > 220) {
			prOutHtml = '<div class="note">⚠️<div>Entre un objectif entre <b>40</b> et <b>220</b> g (celui que Hugo t’a donné).</div></div>';
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

	let wkMaint = $state('');
	let wkObj = $state('');
	let wkSteps = $state('');
	let wkAdapt = $state(false);
	let wkK = $state<string[]>(['', '', '', '', '', '', '']);
	let wkS = $state<string[]>(['', '', '', '', '', '', '']);
	let wkPlanVisible = $state(false);
	let wkPlanKg = $state('');
	let wkPlanNote = $state('');
	let wkOutVisible = $state(false);
	let wkStatsHtml = $state('');

	const wkStore = {
		load(): Record<string, unknown> {
			try {
				return JSON.parse(window.localStorage.getItem('gflux_semaine') || '{}');
			} catch {
				return {};
			}
		},
		save(o: Record<string, unknown>) {
			try {
				window.localStorage.setItem('gflux_semaine', JSON.stringify(o));
			} catch {
				/* stockage indisponible */
			}
		},
	};
	function wkRead() {
		return {
			maint: wkMaint,
			obj: wkObj,
			steps: wkSteps,
			adapt: wkAdapt,
			k: [...wkK],
			s: [...wkS],
		};
	}
	function wkRestore() {
		const o = wkStore.load();
		if (typeof o.maint === 'string') wkMaint = o.maint;
		if (typeof o.obj === 'string') wkObj = o.obj;
		if (typeof o.steps === 'string') wkSteps = o.steps;
		if (o.adapt) wkAdapt = true;
		if (Array.isArray(o.k)) (o.k as string[]).forEach((v, i) => { if (v) wkK[i] = v; });
		if (Array.isArray(o.s)) (o.s as string[]).forEach((v, i) => { if (v) wkS[i] = v; });
	}
	function wkCompute() {
		const o = wkRead();
		wkStore.save(o);
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
	function wkReset() {
		wkK = ['', '', '', '', '', '', ''];
		wkS = ['', '', '', '', '', '', ''];
		wkCompute();
	}

	/* ═══════════════════ PANEL 5 : CYCLE ═══════════════════ */
	const CONTENT: Record<
		string,
		{
			label: string;
			blurb: string;
			dims: { t: string; s: string; x: string }[];
			warn: string | null;
			why: string;
		}
	> = {
		menses: {
			label: 'Menstruations',
			blurb: 'Ton corps entame un nouveau cycle. Faim et énergie sont généralement proches de la normale.',
			dims: [
				{ t: 'Faim', s: 'normal', x: 'Normale, parfois légèrement diminuée.' },
				{ t: 'Dépense énergétique', s: 'normal', x: 'Dans la normale.' },
				{ t: 'Poids / rétention d’eau', s: 'normal', x: 'La rétention accumulée en fin de cycle précédent redescend généralement.' },
				{ t: 'Douleurs / crampes', s: 'up', x: "Fréquentes en tout début de règles, liées aux prostaglandines. N'indique rien sur ta progression." },
				{ t: 'Entraînement', s: 'normal', x: 'Aucune restriction. Adapte seulement si crampes ou fatigue marquée.' },
				{ t: 'Digestion', s: 'up', x: 'Ballonnements et transit modifié fréquents à cette période.' },
			],
			warn: null,
			why: 'Au tout début des règles, l’œstrogène et la progestérone sont tous les deux au plus bas du cycle — c’est justement la chute de la progestérone qui déclenche les règles. Les deux hormones recommencent à remonter progressivement dans les jours qui suivent.',
		},
		follicular: {
			label: 'Phase folliculaire',
			blurb: "Période généralement stable sur la faim, l'énergie et l'entraînement.",
			dims: [
				{ t: 'Faim', s: 'normal', x: 'Normale et stable pour la majorité des femmes.' },
				{ t: 'Dépense énergétique', s: 'normal', x: 'Dans la normale, phase de référence basse du cycle.' },
				{ t: 'Poids / rétention d’eau', s: 'normal', x: 'Généralement au plus bas du cycle.' },
				{ t: 'Entraînement', s: 'normal', x: 'Aucune restriction particulière liée au cycle.' },
				{ t: 'Température', s: 'normal', x: 'Basse et stable.' },
			],
			warn: null,
			why: "L'œstrogène augmente progressivement, produit par les follicules en développement dans l'ovaire. La progestérone, elle, reste basse pendant toute cette phase.",
		},
		ovulation: {
			label: 'Ovulation estimée',
			blurb: 'Tu es probablement proche de ton pic ovulatoire estimé — pas une certitude, une estimation.',
			dims: [
				{ t: 'Faim', s: 'normal', x: 'Normale ; une légère baisse est parfois rapportée.' },
				{ t: 'Dépense énergétique', s: 'normal', x: 'Dans la normale.' },
				{ t: 'Poids / rétention d’eau', s: 'normal', x: 'Stable.' },
				{ t: 'Entraînement', s: 'normal', x: 'Aucune restriction. Certaines femmes rapportent un pic d’énergie, non garanti.' },
				{ t: 'Température', s: 'watch', x: 'Début de la légère hausse post-ovulatoire.' },
			],
			warn: null,
			why: "L'œstrogène atteint son pic juste avant l'ovulation, ce qui déclenche la libération de l'hormone LH et l'ovulation elle-même. Juste après, la progestérone commence tout juste à augmenter.",
		},
		'luteal-early': {
			label: 'Phase lutéale précoce',
			blurb: 'La température corporelle peut légèrement augmenter. Rien à changer si tu te sens bien.',
			dims: [
				{ t: 'Faim', s: 'normal', x: 'Peut commencer à augmenter légèrement chez certaines femmes.' },
				{ t: 'Dépense énergétique', s: 'up', x: 'Peut très légèrement augmenter (quelques dizaines de kcal, parfois rien).' },
				{ t: 'Poids / rétention d’eau', s: 'up', x: 'Début de rétention possible chez certaines femmes.' },
				{ t: 'Entraînement', s: 'normal', x: 'Aucune restriction si tu te sens bien. Ajuste au ressenti, pas à la date.' },
				{ t: 'Température', s: 'up', x: 'Plus élevée qu’en folliculaire — tu peux avoir plus chaud à l’effort.' },
			],
			warn: null,
			why: "La progestérone continue de monter, sécrétée par le follicule qui vient de libérer l'ovule. L'œstrogène remonte aussi, plus modérément. C'est la première fois du cycle où les deux hormones sont élevées en même temps.",
		},
		'luteal-late': {
			label: 'Phase lutéale tardive',
			blurb: "Faim, rétention d'eau et sommeil peuvent être plus marqués chez certaines femmes. Ce n'est pas automatique.",
			dims: [
				{ t: 'Faim', s: 'up', x: 'Souvent en hausse — de l’ordre de 100 à 300 kcal/j chez beaucoup de femmes, parfois plus, parfois pas du tout.' },
				{ t: 'Dépense énergétique', s: 'up', x: 'Légèrement plus élevée, mais bien moins que la hausse de la faim.' },
				{ t: 'Poids / rétention d’eau', s: 'watch', x: 'Rétention la plus marquée du cycle — en moyenne modérée, parfois 2 à 3 kg chez certaines. C’est de l’eau, pas de la graisse.' },
				{ t: 'Humeur', s: 'up', x: "Irritabilité et sensibilité émotionnelle plus marquées chez certaines femmes. Ce n'est pas un manque de contrôle." },
				{ t: 'Entraînement', s: 'normal', x: 'Si fatigue, crampes ou sommeil dégradé : autorégule (charge -5 à -10 % si besoin). Sinon, rien à changer.' },
				{ t: 'Sommeil', s: 'up', x: 'Souvent le moment le plus propice aux perturbations du sommeil.' },
				{ t: 'Digestion', s: 'up', x: 'Ballonnements et transit modifié fréquents.' },
				{ t: 'Cravings', s: 'up', x: 'Les plus fréquents du cycle. Une portion planifiée plutôt qu’une interdiction totale.' },
			],
			warn: 'Ne modifie pas ton plan alimentaire uniquement parce que la balance augmente pendant quelques jours, et ne réduis pas brutalement tes calories : une variation rapide du poids n’est pas une variation de masse grasse.',
			why: "L'œstrogène et la progestérone atteignent leur pic puis chutent nettement dans les derniers jours si aucune grossesse ne débute. C'est cette chute — plus que le niveau élevé qui précède — qui est associée à la plupart des symptômes prémenstruels : faim, sommeil, humeur, rétention d'eau.",
		},
	};

	function getCyclePhase(lmpStr: string, cycleLength: number) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const lmp = new Date(lmpStr + 'T00:00:00');
		const diffDays = Math.floor((today.getTime() - lmp.getTime()) / 86400000);
		const cycleDay = (((diffDays % cycleLength) + cycleLength) % cycleLength) + 1;

		const ovulationDay = Math.max(cycleLength - 14, 8);
		const mensesEnd = 5;
		const lutealLength = cycleLength - ovulationDay;
		const lutealMid = ovulationDay + Math.round(lutealLength / 2);

		let key: string;
		if (cycleDay <= mensesEnd) key = 'menses';
		else if (cycleDay < ovulationDay - 2) key = 'follicular';
		else if (cycleDay <= ovulationDay + 1) key = 'ovulation';
		else if (cycleDay <= lutealMid) key = 'luteal-early';
		else key = 'luteal-late';

		return { cycleDay, cycleLength, key, ovulationDay };
	}

	type ContraVal = 'none' | 'iud-hormonal' | 'hormonal';
	let contra = $state<ContraVal>('none');
	let cycleMode = $state<'inputs' | 'hormonal' | 'nodate'>('inputs');
	let lmp = $state('');
	let len = $state('28');
	let lmpErr = $state(false);
	const shortCycle = $derived(parseInt(len, 10) < 24);
	let cycleResultVisible = $state(false);
	let dayLabel = $state('');
	let phaseLabel = $state('');
	let blurb = $state('');
	let dimsHtml = $state('');
	let warnVisible = $state(false);
	let warnText = $state('');
	let whyText = $state('');
	let switchPct = $state('50%');
	let markerVisible = $state(false);
	let markerX = $state(0);
	let markerY = $state(0);
	let markerLabelY = $state(0);
	let markerLabelText = $state('');
	let cyclePathEl = $state<SVGPathElement | null>(null);

	function setContra(v: ContraVal) {
		contra = v;
		cycleResultVisible = false;
		cycleMode = v === 'hormonal' ? 'hormonal' : 'inputs';
	}
	function submitCycle() {
		const lenN = parseInt(len, 10);
		if (!lmp) {
			lmpErr = true;
			return;
		}
		lmpErr = false;
		const data = getCyclePhase(lmp, lenN);
		const c = CONTENT[data.key];
		dayLabel = 'Jour ' + data.cycleDay + ' de ton cycle';
		phaseLabel = c.label;
		blurb = c.blurb;
		dimsHtml = c.dims
			.map(
				(d) =>
					`<div class="dim"><div class="dim-head"><span class="dim-title">${d.t}</span>` +
					`<span class="dim-state ${d.s}">${d.s === 'up' ? 'EN HAUSSE' : d.s === 'watch' ? 'À SURVEILLER' : 'NORMAL'}</span></div>` +
					`<div class="dim-text">${d.x}</div></div>`,
			)
			.join('');
		warnVisible = !!c.warn;
		warnText = c.warn || '';
		whyText = c.why || '';
		switchPct = (((data.ovulationDay - 1) / data.cycleLength) * 100).toFixed(1) + '%';
		cycleResultVisible = true;

		/* La géométrie du tracé est calculée au prochain frame : Svelte applique
		   la classe .visible entre-temps (le panneau était en display:none). */
		requestAnimationFrame(() => {
			if (!cyclePathEl) return;
			const pathLength = cyclePathEl.getTotalLength();
			cyclePathEl.style.strokeDasharray = String(pathLength);
			cyclePathEl.style.transition = 'none';
			cyclePathEl.style.strokeDashoffset = String(pathLength);
			void cyclePathEl.getBoundingClientRect();
			cyclePathEl.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(.65,0,.35,1)';
			requestAnimationFrame(() => {
				if (cyclePathEl) cyclePathEl.style.strokeDashoffset = '0';
			});
			const fraction = (data.cycleDay - 1) / data.cycleLength;
			const point = cyclePathEl.getPointAtLength(fraction * pathLength);
			markerX = point.x;
			markerY = point.y;
			markerLabelY = point.y > 30 ? point.y - 14 : point.y + 24;
			markerLabelText = 'J' + data.cycleDay;
			markerVisible = false;
			void cyclePathEl.getBoundingClientRect();
			requestAnimationFrame(() => {
				markerVisible = true;
			});
		});
	}

	/* ═══════════════════ PANEL 6 : CYCLAGE REFEED / DIET BREAK ═══════════════════ */
	let sexe = $state('femme');
	let pctGraisse = $state('');
	let poids = $state('');
	let apport = $state('');
	let depense = $state('0');
	let methode = $state('alpert');
	let dateDebut = $state('');
	let dureeSemaines = $state('12');
	let cyclageErr = $state('');
	let cyclageVisible = $state(false);
	let outMasseMaigre = $state('—');
	let outEA = $state('—');
	let outCategorie = $state('—');
	let outRefeedLine = $state('');
	let outBreakLine = $state('');
	let outOfGridWarn = $state(false);
	let planTableHtml = $state('');
	const showMethode = $derived(sexe === 'homme' && !isNaN(parseFloat(pctGraisse)) && parseFloat(pctGraisse) < 15);

	type Cat = {
		label: string;
		refeedPlanned: boolean;
		refeedNote: string | null;
		breakWeeks: number;
		breakRangeLabel: string;
		refeedIntervalDays?: number | null;
		refeedDurationDays?: number;
		outOfGrid?: boolean;
	};

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
			let refeedIntervalDays: number | null;
			let refeedLabel: string | null;
			if (ea > 30) {
				refeedIntervalDays = 17;
				refeedLabel = '2-3 jours tous les 14-21 jours (EA > 30 kcal/kg MM)';
			} else if (ea >= 24) {
				refeedIntervalDays = 10;
				refeedLabel = '2-3 jours tous les 7-14 jours (EA 24-30 kcal/kg MM)';
			} else if (ea >= 20) {
				refeedIntervalDays = 7;
				refeedLabel = '2-3 jours tous les 7 jours (grille : 5-7 jours, plancher de 7j appliqué)';
			} else {
				refeedIntervalDays = null;
				refeedLabel = null;
			}
			return {
				label: 'Femme <25% graisse',
				refeedPlanned: refeedIntervalDays !== null,
				refeedIntervalDays,
				refeedDurationDays: 3,
				refeedNote: refeedLabel,
				breakWeeks: 5,
				breakRangeLabel: '4-6 semaines',
				outOfGrid: refeedIntervalDays === null,
			};
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
			const refeedIntervalDays = methodeV === 'alpert' ? 17 : 10;
			const refeedLabel =
				methodeV === 'alpert'
					? '2-3 jours tous les 14-21 jours (déficit basé sur le calcul de Alpert)'
					: '2-3 jours tous les 7-14 jours (déficit basé sur le calcul de Macdonald)';
			return {
				label: 'Homme <15% graisse',
				refeedPlanned: true,
				refeedIntervalDays,
				refeedDurationDays: 3,
				refeedNote: refeedLabel,
				breakWeeks: 7,
				breakRangeLabel: '6-8 semaines',
			};
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
	function generer() {
		const sexeV = sexe;
		const poidsV = parseFloat(poids);
		const pct = parseFloat(pctGraisse);
		const apportV = parseFloat(apport);
		const depenseHebdo = parseFloat(depense) || 0;
		const depenseJ = depenseHebdo / 7;
		const methodeV = methode;
		const dateDebutStr = dateDebut;
		const duree = parseInt(dureeSemaines, 10);

		if (!poidsV || !pct || !apportV || !dateDebutStr || !duree) {
			cyclageErr = 'Merci de remplir tous les champs nécessaires (poids, % graisse, apport, date, durée).';
			return;
		}
		cyclageErr = '';

		const masseMaigre = poidsV * (1 - pct / 100);
		const ea = (apportV - depenseJ) / masseMaigre;
		const cat = getCategorie(sexeV, pct, ea, methodeV);
		const refeedDur = cat.refeedDurationDays ?? 3;

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
		const totalDays = duree * 7;
		const phases = new Array<string>(totalDays);

		for (let d = 0; d < totalDays; d++) {
			const week = Math.floor(d / 7);
			const isBreakWeek = cat.breakWeeks > 0 && (week + 1) % cat.breakWeeks === 0;
			phases[d] = isBreakWeek ? 'break' : 'deficit';
		}

		function nextBreakStart(fromDay: number) {
			for (let i = fromDay; i < totalDays; i++) {
				if (phases[i] === 'break' && (i === 0 || phases[i - 1] !== 'break')) return i;
			}
			return Infinity;
		}

		if (cat.refeedPlanned && !cat.outOfGrid) {
			let counter = 0;
			let d = 0;
			while (d < totalDays) {
				if (phases[d] === 'break') {
					counter = 0;
					d++;
					continue;
				}
				counter++;
				const intervalApplique = Math.max(cat.refeedIntervalDays ?? 0, 7);
				if (counter >= intervalApplique) {
					const breakStart = nextBreakStart(d);
					if (breakStart - d < refeedDur + 7) {
						d++;
						continue;
					}
					for (let k = 0; k < refeedDur && d + k < totalDays; k++) {
						if (phases[d + k] !== 'break') phases[d + k] = 'refeed';
					}
					d += refeedDur;
					counter = 0;
					continue;
				}
				d++;
			}
		}

		const blocks: { phase: string; startDay: number; endDay: number }[] = [];
		let blockStart = 0;
		for (let d = 1; d <= totalDays; d++) {
			if (d === totalDays || phases[d] !== phases[blockStart]) {
				blocks.push({ phase: phases[blockStart], startDay: blockStart, endDay: d - 1 });
				blockStart = d;
			}
		}

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

	/* ————— Init : restauration de la semaine + état du cycle ————— */
	onMount(() => {
		if (browser) {
			wkRestore();
			wkCompute();
		}
	});
</script>

<svelte:head>
	<title>Outils &amp; calibrage — G-Flux</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="tools-root">
	<div class="wrap">
		<header>
			<div class="brand">
				<img src="/logo-outils.png" alt="G-FLUX™" class="brandlogo" />
			</div>
			<h1>Calibrage <em>G-Flux</em></h1>
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
			<button type="button" class="tab tab-highlight" class:active={panel === 'p5'} onclick={() => setPanel('p5')}>Cycle</button>
			<button type="button" class="tab tab-highlight" class:active={panel === 'p6'} onclick={() => setPanel('p6')}>Cyclage</button>
		</div>

		<!-- ═══════ PANEL 1 : CRU / CUIT ═══════ -->
		<section class="panel" class:active={panel === 'p1'}>
			<div class="note">
				⚠️<div><b>L'erreur n°1 du tracking :</b> peser cuit mais entrer le poids dans l'app comme si c'était cru (ou l'inverse). Sur le riz, ça peut fausser ta journée de 200&nbsp;kcal.</div>
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
				⚠️<div><b>Ce qui n'est pas pesé existe quand même.</b> Coche ce que tu ajoutes dans une journée normale sans le tracker, et regarde le total en bas.</div>
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
				💡<div><b>Une journée haute n'annule rien.</b> Ton déficit se calcule sur la semaine, pas sur la journée. Cet outil te dit comment moduler les jours restants — sans jamais descendre trop bas.</div>
			</div>
			<div class="card">
				<h2>1 · Mes repères — définis avec Hugo</h2>
				<p class="hint">Ces deux chiffres viennent de ton plan de démarrage. Pas sûre ? Demande à Hugo avant de remplir.</p>
				<label for="wkMaint">Ma maintenance (kcal / jour)</label>
				<input id="wkMaint" type="number" bind:value={wkMaint} inputmode="numeric" placeholder="ex. 2000" min="1200" max="4000" oninput={wkCompute} />
				<label for="wkObj">Mon objectif (kcal / jour)</label>
				<input id="wkObj" type="number" bind:value={wkObj} inputmode="numeric" placeholder="ex. 1500" min="1000" max="4000" oninput={wkCompute} />
				<label for="wkSteps">Mon objectif de pas (par jour)</label>
				<input id="wkSteps" type="number" bind:value={wkSteps} inputmode="numeric" placeholder="ex. 8000" min="2000" max="30000" oninput={wkCompute} />
				<div class="glabel">Adaptation métabolique</div>
				<div class="checks">
					<button type="button" class="chk" class:on={wkAdapt} onclick={() => { wkAdapt = !wkAdapt; wkCompute(); }}>⚙️ Appliquer ~12% d'adaptation — uniquement si validé avec Hugo</button>
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
				<h2>2 · Ma semaine en cours</h2>
				<p class="hint">Remplis chaque jour passé avec tes calories réelles et tes pas. Laisse vide les jours à venir.</p>
				<div class="wkgrid">
					<span class="h"></span><span class="h">Kcal mangées</span><span class="h">Pas faits</span>
					{#each DAYS as d, i (d)}
						<span class="d">{d}</span>
						<input type="number" inputmode="numeric" placeholder="—" min="0" class:today={i === todayIdx} bind:value={wkK[i]} oninput={wkCompute} />
						<input type="number" inputmode="numeric" placeholder="—" min="0" class:today={i === todayIdx} bind:value={wkS[i]} oninput={wkCompute} />
					{/each}
				</div>
				<button type="button" class="wkreset" onclick={wkReset}>Nouvelle semaine (efface les saisies)</button>
			</div>
			{#if wkOutVisible}
				<div class="card">
					<h2>3 · Comment moduler le reste de la semaine</h2>
					{@html wkStatsHtml}
				</div>
			{/if}
		</section>

		<!-- ═══════ PANEL 5 : CYCLE ═══════ -->
		<section class="panel" class:active={panel === 'p5'}>
			<div class="note">
				💡<div><b>Le cycle donne du contexte à tes sensations.</b> Il ne dicte pas ce que tu dois faire — fie-toi d'abord à ton ressenti, pas au calendrier.</div>
			</div>
			<div class="card">
				<h2>Où en es-tu dans ton cycle ?</h2>
				<p class="hint">Quelques informations suffisent pour une estimation. Aucune donnée n'est conservée.</p>

				<div class="glabel">Es-tu sous contraception hormonale ?</div>
				<div class="seg stack">
					<button type="button" class:on={contra === 'none'} onclick={() => setContra('none')}>Non, ou stérilet en cuivre</button>
					<button type="button" class:on={contra === 'iud-hormonal'} onclick={() => setContra('iud-hormonal')}>Stérilet hormonal (Mirena, Kyleena…)</button>
					<button type="button" class:on={contra === 'hormonal'} onclick={() => setContra('hormonal')}>Pilule, patch, anneau, implant ou injection</button>
				</div>

				{#if cycleMode === 'inputs'}
					<div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--border);">
						<div class="row">
							<div class="field">
								<label for="lmp" style="margin:0 0 7px;min-height:2.3em;">Premier jour des dernières règles</label>
								<input id="lmp" type="date" bind:value={lmp} style:border-color={lmpErr ? 'var(--amber)' : ''} />
							</div>
							<div class="field">
								<label for="len" style="margin:0 0 7px;min-height:2.3em;">Durée moyenne</label>
								<select id="len" bind:value={len}>
									{#each Array.from({ length: 12 }, (_, i) => i + 21) as n (n)}
										<option value={n}>{n} jours</option>
									{/each}
								</select>
							</div>
						</div>
						<p class="microhint">Indique une moyenne plutôt que ton tout dernier cycle : il est normal que la durée varie de quelques jours d'un mois à l'autre.</p>
						<p class="fielderr" class:show={lmpErr}>Sélectionne une date pour voir ton estimation.</p>
						{#if shortCycle}
							<p class="microhint">Un cycle de moins de 24 jours sort de la plage habituelle — si c'est nouveau chez toi, ça vaut la peine d'en parler à ton médecin. L'estimation ci-dessous reste affichée, mais avec une fiabilité réduite.</p>
						{/if}
						<p class="microhint">Cycle irrégulier ou en périménopause ? Cette estimation devient moins fiable — utilise-la comme repère large, pas comme une certitude.</p>
						<p class="microhint">
							<button type="button" class="linklike" onclick={() => { cycleMode = 'nodate'; cycleResultVisible = false; }}>Je n'ai plus de règles régulières</button>
						</p>
						<button type="button" class="cta" onclick={submitCycle}>Voir mon estimation</button>
					</div>
				{:else if cycleMode === 'hormonal'}
					<div>
						<div class="hormonal-msg">
							Sous ce type de contraception, ton cycle hormonal naturel est mis en pause — il n'y a pas de vraies phases à identifier, et t'en montrer une serait te donner une fausse précision.
							<br /><br />
							Les principes de base restent valables : <b>mange à ta faim réelle</b>, <b>ne panique pas</b> face à une variation de poids ponctuelle, et <b>adapte l'entraînement à ton ressenti</b> plutôt qu'à un calendrier.
						</div>
					</div>
				{:else}
					<div>
						<div class="hormonal-msg">
							Pas de souci. Sans date de règles fiable, une estimation de phase ne serait pas fiable non plus — mieux vaut ne pas t'en donner une plutôt que de te donner une fausse précision.
							<br /><br />
							Les principes de base restent valables : <b>mange à ta faim réelle</b>, <b>ne panique pas</b> face à une variation de poids ponctuelle, et <b>adapte l'entraînement à ton ressenti</b> plutôt qu'au calendrier.
						</div>
						<p class="microhint">
							<button type="button" class="linklike" onclick={() => { cycleMode = 'inputs'; }}>J'ai finalement une date à indiquer</button>
						</p>
					</div>
				{/if}

				<div class="cycle-result" class:visible={cycleResultVisible}>
					<div class="cycle-result-inner">
							<div class="day-label">{dayLabel}</div>
							<div class="phase-label">{phaseLabel}</div>
							<p class="blurb">{blurb}</p>

							<svg viewBox="0 0 480 130" id="curveSvg">
								<defs>
									<linearGradient id="curveGradient" x1="0" y1="0" x2="1" y2="0">
									<stop offset="0%" style="stop-color:var(--green)" />
									<stop offset={switchPct} style="stop-color:var(--green)" />
									<stop offset={switchPct} style="stop-color:var(--amber)" />
									<stop offset="100%" style="stop-color:var(--amber)" />
									</linearGradient>
								</defs>
								<line x1="8" y1="110" x2="472" y2="110" class="curve-axis" stroke-width="1" />
								<text x="8" y="126" class="axis-label">Règles</text>
								<text x="232" y="126" class="axis-label" text-anchor="middle">Ovulation estimée</text>
								<text x="472" y="126" class="axis-label" text-anchor="end">Prémenstruel</text>
								<path
									id="curvePath"
									class="curve-path"
									bind:this={cyclePathEl}
									d="M8,82 C 75,26 130,18 172,48 C 198,68 210,82 232,52 C 258,14 292,22 328,44 C 372,70 408,44 472,82"
								/>
								<g id="markerGroup" class:visible={markerVisible}>
									<circle id="pulseCircle" cx={markerX} cy={markerY} r="5" fill="none" stroke-width="1.5" />
									<circle id="dotCircle" cx={markerX} cy={markerY} r="5" />
									<text id="markerLabel" class="marker-label" text-anchor="middle" x={markerX} y={markerLabelY}>{markerLabelText}</text>
								</g>
							</svg>

							<div class="legend">
								<span><i style="background:var(--green)"></i> Dominante œstrogène</span>
								<span><i style="background:var(--amber)"></i> Dominante progestérone</span>
								<span class="legend-note">(simplifié)</span>
							</div>

							<div class="dims">{@html dimsHtml}</div>

							<p class="why-label">Pourquoi ?</p>
							<p class="why-text">{whyText}</p>

							{#if warnVisible}
								<div class="note" style="display:flex">⚠️<div>{warnText}</div></div>
							{/if}

							<p class="microhint" style="margin-top:16px">Estimation basée sur ton cycle déclaré. Le jour d'ovulation réel peut varier — considère ceci comme un repère, pas une certitude.</p>
						<p class="cycle-principle">Le cycle donne du contexte à tes sensations. Il ne dicte pas ce que tu dois faire.</p>
					</div>
				</div>
			</div>
		</section>

		<!-- ═══════ PANEL 6 : CYCLAGE REFEED / DIET BREAK ═══════ -->
		<section class="panel" class:active={panel === 'p6'}>
			<div class="card">
				<h2>Planification refeed / diet break</h2>
				<p class="hint">Basé sur la grille de cyclage calorique selon le % de graisse et la disponibilité énergétique.</p>

				<label for="sexe">Sexe</label>
				<select id="sexe" bind:value={sexe}>
					<option value="femme">Femme</option>
					<option value="homme">Homme</option>
				</select>

				<div class="row">
					<div class="field">
						<label for="poids">Poids de départ (kg)</label>
						<input id="poids" type="number" bind:value={poids} placeholder="60" step="0.1" />
					</div>
					<div class="field">
						<label for="pctGraisse">% de graisse de départ</label>
						<input id="pctGraisse" type="number" bind:value={pctGraisse} placeholder="23" step="0.1" />
					</div>
				</div>

				<div class="row">
					<div class="field">
						<label for="apport">Apport calorique prévu (kcal/j)</label>
						<input id="apport" type="number" bind:value={apport} placeholder="1450" step="10" />
					</div>
					<div class="field">
						<label for="depense">Dépense totale de sport / semaine (kcal)</label>
						<input id="depense" type="number" bind:value={depense} placeholder="0" step="10" />
					</div>
				</div>

				{#if showMethode}
					<label for="methode">Méthode de calcul du déficit</label>
					<select id="methode" bind:value={methode}>
						<option value="alpert">Alpert</option>
						<option value="macdonald">Macdonald</option>
					</select>
				{/if}

				<div class="row">
					<div class="field">
						<label for="dateDebut">Date de début</label>
						<input id="dateDebut" type="date" bind:value={dateDebut} />
					</div>
					<div class="field">
						<label for="dureeSemaines">Durée du programme (semaines)</label>
						<input id="dureeSemaines" type="number" bind:value={dureeSemaines} placeholder="12" step="1" />
					</div>
				</div>

				{#if cyclageErr}
					<div class="note">⚠️<div>{cyclageErr}</div></div>
				{/if}

				<button type="button" class="cta" onclick={generer}>Générer la planification</button>
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
							<div class="note" style="display:flex">⚠️<div>Disponibilité énergétique en dessous de 20 kcal/kg de masse maigre — hors de la grille de référence. Ne pas extrapoler une cadence automatique : à valider manuellement, cas par cas.</div></div>
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
			<b>La Méthode G-Flux™</b> · myfit-coach.fr
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