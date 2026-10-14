// Logique visuelle de l'écran « Performance » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { sel: 1 }; }
  renderVals() {
    const C = [94.2, 72.3, 50.3, 28.3];
    const DAYS = [
      { l: 'L', full: 'Lundi · 12 oct.', kcal: 2180, pct: [91, 100, 61, 79], kc: '2 180', chip: '91 % de l\'objectif', cur: '2 180', m: [['Glucides', '#EC4899', '#ec4899', 100, '286', '258'], ['Protéines', '#3B82F6', '#3b82f6', 61, '118', '192'], ['Lipides', '#F97316', '#f97316', 79, '53', '67']] },
      { l: 'M', full: 'Aujourd\'hui · 13 oct.', kcal: 873, pct: [36, 50, 21, 29], kc: '873', chip: '36 % de l\'objectif', cur: '873', m: [['Glucides', '#EC4899', '#ec4899', 50, '127,9', '258'], ['Protéines', '#3B82F6', '#3b82f6', 21, '40,2', '192'], ['Lipides', '#F97316', '#f97316', 29, '19,7', '67']] },
      { l: 'M' }, { l: 'J' }, { l: 'V' }, { l: 'S' }, { l: 'D' }
    ];
    const cols = ['#1db954', '#EC4899', '#3B82F6', '#F97316'];
    const cur = DAYS[this.state.sel];
    return {
      days: DAYS.map((d, i) => {
        const has = !!d.kcal;
        const on = i === this.state.sel;
        const ds = has ? d.pct.map((p, k) => (Math.min(p, 100) / 100 * C[k]).toFixed(1) + ' ' + C[k]) : ['0 1', '0 1', '0 1', '0 1'];
        return {
          l: d.l, has: has, empty: !has, kc: has ? d.kc : '–',
          fill: has ? Math.round(Math.min(d.kcal / 2400, 1) * 100) + '%' : '0%',
          bg: on ? '#e8fef0' : 'transparent', bd: on ? 'rgba(29,185,84,.3)' : 'transparent',
          lc: on ? '#0d7c36' : '#7B857F',
          d1: ds[0], d2: ds[1], d3: ds[2], d4: ds[3],
          pick: () => { if (has) this.setState({ sel: i }); },
          label: 'Voir le détail du ' + (d.full || d.l)
        };
      }),
      full: cur.full, chip: cur.chip, cur: cur.cur, curPct: Math.min(cur.kcal / 2400 * 100, 100).toFixed(1) + '%',
      macros: cur.m.map((m) => ({ label: m[0], color: m[1], text: m[2], got: m[4], goal: m[5], pct: m[3] + '%', dash: (m[3] / 100 * 201).toFixed(1) + ' 201' }))
    };
  }
}
