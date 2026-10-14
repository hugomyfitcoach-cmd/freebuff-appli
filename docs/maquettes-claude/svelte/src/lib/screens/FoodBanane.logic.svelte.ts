// Logique visuelle de l'écran « Food-Banane » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { amt: 100, tab: 'g', meal: 1, fav: false, k: 0, dir: 1, pn: 0 }; }
  renderVals() {
    const PER = [88, 20, 1, 0];
    const a = this.state.amt;
    const fmt = (x, d) => { const r = Math.round(x * Math.pow(10, d)) / Math.pow(10, d); return String(r).replace('.', ','); };
    const TABS = [['g','Grammes'],['r','Repères G-FLUX']];
    const meals = [['Petit-déjeuner', 'bfast'], ['Déjeuner', 'lunch'], ['Dîner', 'dinner'], ['Collations', 'snack']];
    const ICONS = {
      bfast: '<path d="M5 9.5h11v4.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9.5Z"/><path d="M16 11h1.2a2.3 2.3 0 0 1 0 4.600H16"/><path d="M8.500 3.500v2.500M12.500 3.500v2.500"/>',
      lunch: '<path d="M7 3v5.500a2.500 2.500 0 0 0 5 0V3M9.500 3v18"/><path d="M17.500 21V3c-2.500 1.400-3.500 4.200-3.500 8.500h3.500"/>',
      dinner: '<path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500Z"/><path d="M17.500 4v3M16 5.500h3"/>',
      snack: '<path d="M12 8.500c-1.500-1.300-6-1.500-6 3.500 0 4 2.500 8 4.500 8 .8 0 1-.5 1.500-.5s.7.5 1.500.5c2 0 4.500-4 4.500-8 0-5-4.500-4.800-6-3.500Z"/><path d="M12 8.500c0-2 .8-3.500 2.500-4.500"/>'
    };
    const portions = this.state.tab === 'p';
    const numAnim = this.state.k === 0 ? 'none' : (this.state.dir > 0 ? 'numUp' : 'numDn') + (this.state.k % 2 ? 'A' : 'B') + ' .22s cubic-bezier(.2,.8,.2,1)';
    const panAnim = this.state.pn === 0 ? 'none' : (this.state.pn % 2 ? 'panA' : 'panB') + ' .26s cubic-bezier(.2,.8,.2,1)';
    const big = portions ? fmt(a / 100, 1) : String(a);
    return {
      tabs: TABS.map((t) => ({ label: t[1], fg: this.state.tab === t[0] ? '#0d7c36' : '#7B857F', fw: this.state.tab === t[0] ? 900 : 700, pick: () => this.setState({ tab: t[0], pn: this.state.pn + 1 }) })),
      indLeft: (TABS.findIndex((t) => t[0] === this.state.tab) * 100 / TABS.length) + '%', indW: (100 / TABS.length) + '%',
      showAmount: this.state.tab !== 'r', showRepere: this.state.tab === 'r', showChips: this.state.tab === 'g',
      numAnim: numAnim, panAnim: panAnim, big: big, unit: portions ? (a / 100 === 1 ? 'portion' : 'portions') : 'g', eq: portions ? '= ' + a + ' g' : '',
      minus: () => this.setState({ amt: Math.max(10, a - (portions ? 100 : 10)), k: this.state.k + 1, dir: -1 }),
      plus: () => this.setState({ amt: a + (portions ? 100 : 10), k: this.state.k + 1, dir: 1 }),
      chips: [50, 100, 150, 200].map((g) => ({ label: g + ' g', bd: a === g ? '#1db954' : '#E3E8E5', bg: a === g ? '#e8fef0' : '#FFFFFF', fg: a === g ? '#0d7c36' : '#66716B', fw: a === g ? 900 : 700, pick: () => this.setState({ amt: g, k: this.state.k + 1, dir: g >= a ? 1 : -1 }) })),
      kcal: String(Math.round(PER[0] * a / 100)), g: fmt(PER[1] * a / 100, 1), p: fmt(PER[2] * a / 100, 1), l: fmt(PER[3] * a / 100, 1),
      meals: meals.map((m, i) => ({ label: m[0], i0: i===0, i1: i===1, i2: i===2, i3: i===3, bg: this.state.meal === i ? '#e8fef0' : '#FFFFFF', bd: this.state.meal === i ? '#1db954' : '#E9EDEA', fg: this.state.meal === i ? '#0d7c36' : '#7B857F', fw: this.state.meal === i ? 900 : 700, pick: () => this.setState({ meal: i }) })),
      fav: this.state.fav, favFill: this.state.fav ? '#ff4444' : 'none', favCol: this.state.fav ? '#ff4444' : '#0F1512', toggleFav: () => this.setState({ fav: !this.state.fav })
    };
  }
}
