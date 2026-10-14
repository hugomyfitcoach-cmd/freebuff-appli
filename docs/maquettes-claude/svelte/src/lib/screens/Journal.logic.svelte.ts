// Logique visuelle de l'écran « Journal » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { day: '2026-10-13', cal: false, cy: 2026, cm: 9, cflip: 0, dir: 1, tipOpen: true, done: {}, flip: 0, scrolled: false };
  }
  data() {
    const IMG = {
      fromage: '/assets/fromage.png',
      haricots: '/assets/haricots.png',
      poulet: '/assets/poulet.png',
      frosties: '/assets/frosties.png',
      superieur: '/assets/superieur.png',
      lando: '/assets/lando.png'
    };
    const OK = { bg: '#f3fcf7', border: 'rgba(29,185,84,.3)', shadow: 'rgba(29,185,84,.35)', accent: '#1db954', text: '#0d7c36', shield: true, bell: false, pulse: false, alert: false };
    return {
      today: {
        label: "Aujourd'hui · 13 oct.",
        hero: Object.assign({}, OK, { prefix: 'Il te reste', value: '2 093', sub: '', consumed: '307', fill: '11.4%' }),
        macros: [
          { label: 'Glucides', color: '#EC4899', text: '#ec4899', pct: 19, got: '49', goal: '258' },
          { label: 'Protéines', color: '#3B82F6', text: '#3b82f6', pct: 9, got: '17', goal: '192' },
          { label: 'Lipides', color: '#F97316', text: '#f97316', pct: 4, got: '2', goal: '67' }
        ],
        meals: [
          { name: 'Petit-déjeuner', summary: '307 kcal · 13 %', items: [
            { id: 't1', name: 'Fromage blanc nature 0%MG - 1kg', kcal: '50', qty: '100 g', img: IMG.fromage },
            { id: 't2', name: 'Pain complet ou intégral (à la farine T150)', kcal: '257', qty: '110 g', img: '' } ] },
          { name: 'Déjeuner', summary: '0 kcal · 0 %', items: [] },
          { name: 'Dîner', summary: '0 kcal · 0 %', items: [] },
          { name: 'Collations', summary: '0 kcal · 0 %', items: [] }
        ]
      },
      fri: {
        label: 'vendredi · 9 oct.',
        hero: { bg: '#fff8f0', border: '#F8D9A4', shadow: 'rgba(245,158,11,.4)', accent: '#F59E0B', text: '#B45309', shield: true, bell: false, pulse: true, alert: false, prefix: 'Objectif dépassé de', value: '261', sub: 'Dans ton filet de sécurité', consumed: '2 661', fill: '98.5%' },
        macros: [
          { label: 'Glucides', color: '#EC4899', text: '#ec4899', pct: 121, got: '313', goal: '258' },
          { label: 'Protéines', color: '#3B82F6', text: '#3b82f6', pct: 107, got: '205', goal: '192' },
          { label: 'Lipides', color: '#F97316', text: '#f97316', pct: 81, got: '54', goal: '67' }
        ],
        meals: [
          { name: 'Petit-déjeuner', summary: '552 kcal · 23 %', items: [
            { id: 'f1', name: 'Fromage blanc nature 0%MG - 1kg', kcal: '200', qty: '400 g', img: IMG.fromage },
            { id: 'f2', name: 'Pain complet ou intégral (à la farine T150)', kcal: '234', qty: '100 g', img: '' },
            { id: 'f3', name: 'Chocolat noir 70 % de cacao environ, de d…', kcal: '118', qty: '20 g', img: '' } ] },
          { name: 'Déjeuner', summary: '2 109 kcal · 88 %', items: [
            { id: 'f4', name: "Haricots rouges d'aucy 250g", kcal: '240', qty: '250 g', img: IMG.haricots },
            { id: 'f5', name: 'Blanc de Poulet - Rôti à la Broche', kcal: '125', qty: '120 g', img: IMG.poulet } ] }
        ]
      },
      sat: {
        label: 'samedi · 10 oct.',
        hero: { bg: '#fff0f0', border: '#F7C4BE', shadow: 'rgba(239,68,68,.35)', accent: '#EF4444', text: '#ef4444', shield: false, bell: true, pulse: false, alert: true, prefix: 'Maintenance dépassée de', value: '405', sub: 'On ajuste ensemble — ça reste dans le cadre.', consumed: '3 105', fill: '100%' },
        macros: [
          { label: 'Glucides', color: '#EC4899', text: '#ec4899', pct: 181, got: '468', goal: '258' },
          { label: 'Protéines', color: '#3B82F6', text: '#3b82f6', pct: 75, got: '144', goal: '192' },
          { label: 'Lipides', color: '#F97316', text: '#f97316', pct: 104, got: '70', goal: '67' }
        ],
        meals: [
          { name: 'Petit-déjeuner', summary: '0 kcal · 0 %', items: [] },
          { name: 'Déjeuner', summary: '3 105 kcal · 129 %', items: [
            { id: 's1', name: 'Frosties', kcal: '263', qty: '70 g', img: IMG.frosties },
            { id: 's2', name: 'Fromage blanc nature 0%MG - 1kg', kcal: '150', qty: '300 g', img: IMG.fromage },
            { id: 's3', name: 'Blanc de Poulet - Rôti à la Broche', kcal: '62', qty: '60 g', img: IMG.poulet },
            { id: 's4', name: "Le Supérieur - à l'Etouffée - Conservation …", kcal: '127', qty: '110 g', img: IMG.superieur },
            { id: 's5', name: "Haricot vert, bouilli/cuit à l'eau", kcal: '81', qty: '300 g', img: '' },
            { id: 's6', name: 'Lando Norris Zero Sugar', kcal: '10', qty: '500 g', img: IMG.lando } ] }
        ]
      }
    };
  }
  shift(n) { const d = this.parse(this.state.day); d.setDate(d.getDate() + n); this.setState({ day: this.keyOf(d), cy: d.getFullYear(), cm: d.getMonth(), flip: this.state.flip + 1 }); }
  parse(key) { const p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  keyOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  emptyDay(key) {
    const d = this.parse(key);
    const WD = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const MO = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return {
      label: WD[d.getDay()] + ' · ' + d.getDate() + ' ' + MO[d.getMonth()],
      hero: { bg: '#f3fcf7', border: 'rgba(29,185,84,.3)', shadow: 'rgba(29,185,84,.35)', accent: '#1db954', text: '#0d7c36', shield: true, bell: false, pulse: false, alert: false, prefix: 'Il te reste', value: '2 400', sub: '', consumed: '0', fill: '0%' },
      macros: [
        { label: 'Glucides', color: '#EC4899', text: '#ec4899', pct: 0, got: '0', goal: '258' },
        { label: 'Protéines', color: '#3B82F6', text: '#3b82f6', pct: 0, got: '0', goal: '192' },
        { label: 'Lipides', color: '#F97316', text: '#f97316', pct: 0, got: '0', goal: '67' }
      ],
      meals: ['Petit-déjeuner', 'Déjeuner', 'Dîner', 'Collations'].map((n) => ({ name: n, summary: '0 kcal · 0 %', items: [] }))
    };
  }
  renderVals() {
    const MEAL_ICONS = {
      'Petit-déjeuner': '<path d="M5 9.5h11v4.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9.5Z"/><path d="M16 11h1.2a2.3 2.3 0 0 1 0 4.600H16"/><path d="M8.500 3.500v2.500M12.500 3.500v2.500"/>',
      'Déjeuner': '<path d="M7 3v5.500a2.500 2.500 0 0 0 5 0V3M9.500 3v18"/><path d="M17.500 21V3c-2.500 1.400-3.500 4.200-3.500 8.500h3.500"/>',
      'Dîner': '<path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500Z"/><path d="M17.500 4v3M16 5.500h3"/>',
      'Collations': '<path d="M12 8.500c-1.500-1.300-6-1.500-6 3.500 0 4 2.500 8 4.500 8 .8 0 1-.5 1.500-.5s.7.5 1.500.5c2 0 4.500-4 4.500-8 0-5-4.500-4.800-6-3.500Z"/><path d="M12 8.500c0-2 .8-3.500 2.500-4.500"/>'
    };
    const all = this.data();
    const TODAY = '2026-10-13';
    const KEYMAP = { '2026-10-13': 'today', '2026-10-09': 'fri', '2026-10-10': 'sat' };
    const key = KEYMAP[this.state.day];
    const cur = key ? all[key] : this.emptyDay(this.state.day);
    const done = this.state.done;
    const circ = 201;
    const f = this.state.flip % 2 ? 'B' : 'A';
    const an = { fade: 'fade' + f, ring: 'ring' + f, bar: 'bar' + f, cnt: 'cnt' + f };
    const num = (str) => parseInt(String(str).replace(/\D/g, ''), 10);
    const split = (v) => ({ k: Math.floor(v / 1000), h: Math.floor((v % 1000) / 100), t: v % 100, n: v, cls: v >= 1000 ? 'c4' : 'c1' });
    const hv = split(num(cur.hero.value));
    const shorts = ['GLUC.', 'PROT.', 'LIP.'];
    const sc = this.state.scrolled;
    return {
      an: an,
      fb: { o: sc ? 1 : 0, y: sc ? 0 : -14 },
      fbMacros: cur.macros.map((m, i) => ({
        color: m.color, text: m.text, got: m.got, goal: m.goal, short: shorts[i],
        fdash: (Math.min(m.pct, 100) / 100 * 66).toFixed(1) + ' 66'
      })),
      onScroll: (e) => {
        const on = e.target.scrollTop > 190;
        if (on !== this.state.scrolled) this.setState({ scrolled: on });
      },
      dayLabel: cur.label,
      cal: this.state.cal,
      chevRot: this.state.cal ? 180 : 0,
      toggleCal: () => { const d = this.parse(this.state.day); this.setState({ cal: !this.state.cal, cy: d.getFullYear(), cm: d.getMonth() }); },
      prevDay: () => this.shift(-1),
      nextDay: () => this.shift(1),
      monthTitle: (() => { const M = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']; const t = M[this.state.cm] + ' ' + this.state.cy; return t.charAt(0).toUpperCase() + t.slice(1); })(),
      calAnim: 'cal' + (this.state.dir > 0 ? 'R' : 'L') + (this.state.cflip % 2 ? 'B' : 'A'),
      prevMonth: () => { const m = this.state.cm - 1; this.setState({ cm: (m + 12) % 12, cy: m < 0 ? this.state.cy - 1 : this.state.cy, dir: -1, cflip: this.state.cflip + 1 }); },
      nextMonth: () => { const m = this.state.cm + 1; this.setState({ cm: m % 12, cy: m > 11 ? this.state.cy + 1 : this.state.cy, dir: 1, cflip: this.state.cflip + 1 }); },
      goToday: () => this.setState({ day: TODAY, cy: 2026, cm: 9, cal: false, flip: this.state.flip + 1 }),
      todayBg: this.state.day === TODAY ? '#F3F6F4' : '#e8fef0',
      todayFg: this.state.day === TODAY ? '#9AA39E' : '#0d7c36',
      cells: (() => {
        const cy = this.state.cy, cm = this.state.cm;
        const off = (new Date(cy, cm, 1).getDay() + 6) % 7;
        const nd = new Date(cy, cm + 1, 0).getDate();
        const out = [];
        for (let i = 0; i < off; i++) out.push({ show: false });
        for (let n = 1; n <= nd; n++) {
          const k = this.keyOf(new Date(cy, cm, n));
          const sel = k === this.state.day, tod = k === TODAY, has = !!KEYMAP[k];
          out.push({ show: true, n: n, sel: sel,
            bg: sel ? '#1db954' : 'transparent', fg: sel ? '#FFFFFF' : (tod ? '#0d7c36' : '#0F1512'), fw: (sel || tod) ? 900 : 700,
            bd: (tod && !sel) ? '1.5px solid #1db954' : '1.5px solid transparent',
            dot: has ? (sel ? '#FFFFFF' : '#1db954') : 'transparent',
            label: n + ' ' + ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][cm] + ' ' + cy,
            pick: () => this.setState({ day: k, cal: false, flip: this.state.flip + 1 }) });
        }
        return out;
      })(),
      hero: Object.assign({}, cur.hero, hv),
      macros: cur.macros.map((m, i) => Object.assign({}, m, {
        pct: m.pct + '%', n: m.pct, delay: 40 + i * 50,
        dash: (Math.min(m.pct, 100) / 100 * circ).toFixed(1) + ' ' + circ
      })),
      meals: cur.meals.map((meal, mi) => ({
        delay: 120 + mi * 50, delay2: 150 + mi * 50,
        name: meal.name,
        i0: meal.name === 'Petit-déjeuner', i1: meal.name === 'Déjeuner', i2: meal.name === 'Dîner', i3: meal.name === 'Collations',
        summary: meal.summary,
        hasItems: meal.items.length > 0,
        items: meal.items.map((it, i) => ({
          name: it.name, kcal: it.kcal, qty: it.qty, img: it.img,
          hasImg: !!it.img, noImg: !it.img,
          border: i === 0 ? 'none' : '1px solid #EEF1EF',
          ring: done[it.id] ? '#1db954' : '#DDE3DF',
          fill: done[it.id] ? '#1db954' : '#FFFFFF',
          check: done[it.id] ? 1 : 0, sc: done[it.id] ? 1 : 0.4,
          toggle: () => { const d = Object.assign({}, this.state.done); d[it.id] = !d[it.id]; this.setState({ done: d }); }
        }))
      })),
      tipOpen: this.state.tipOpen && key === 'today',
      closeTip: () => this.setState({ tipOpen: false })
    };
  }
}
