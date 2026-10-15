// Logique visuelle de l'écran « Hydratation » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) {
    super(props);
    const e = (a) => a.map((x) => ({ t: x[0], ml: x[1] }));
    this.state = {
      goal: 2500, goalEdit: false, goalDraft: '2500', custom: '', open: 6, pulse: false,
      days: [
        e([['08:00',500],['10:30',250],['12:45',500],['15:30',250],['18:00',500],['20:15',100]]),
        e([['07:45',500],['10:00',250],['12:30',500],['14:15',500],['16:40',250],['18:50',500],['21:00',150]]),
        e([['08:30',250],['11:00',500],['13:40',250],['16:20',500],['19:10',300]]),
        e([['08:10',500],['10:45',500],['13:00',250],['15:20',500],['17:30',250],['19:45',500]]),
        e([['09:15',250],['11:30',500],['14:50',250],['17:10',500]]),
        e([['07:40',500],['09:50',250],['12:10',500],['14:30',500],['16:00',250],['18:20',500],['20:30',250]]),
        e([['08:05',250],['10:30',500],['13:15',250],['14:40',250]])
      ]
    };
  }
  fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); }
  add(ml) {
    ml = parseInt(ml, 10) || 0;
    if (ml <= 0 || ml > 5000) return;
    const d = new Date();
    const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const days = this.state.days.slice();
    days[6] = days[6].concat([{ t: t, ml: ml }]);
    this.setState({ days: days, custom: '', open: 6, pulse: true });
    setTimeout(() => this.setState({ pulse: false }), 340);
  }
  renderVals() {
    const s = this.state, f = (n) => this.fmt(n);
    const names = ['Mercredi 7 oct.', 'Jeudi 8 oct.', 'Vendredi 9 oct.', 'Samedi 10 oct.', 'Dimanche 11 oct.', 'Lundi 12 oct.', "Aujourd'hui · 13 oct."];
    const L = ['M', 'J', 'V', 'S', 'D', 'L', 'M'];
    const goal = s.goal;
    const tot = s.days.map((a) => a.reduce((x, y) => x + y.ml, 0));
    const today = tot[6];
    const pct = Math.round(today / goal * 100);
    const C = 301.6, H = 150;
    const rem = Math.max(goal - today, 0);
    const items = [];
    for (let i = 6; i >= 0; i--) {
      const p = Math.round(tot[i] / goal * 100);
      const n = s.days[i].length;
      items.push({
        isDay: true, isEntry: false, name: names[i], sub: n + (n > 1 ? ' prises' : ' prise'),
        total: f(tot[i]), pct: p + ' %', w: Math.min(p, 100) + '%', tc: tot[i] >= goal ? '#0d7c36' : '#0F1512',
        exp: s.open === i, rot: s.open === i ? '90deg' : '0deg', border: i === 6 ? 'none' : '1px solid #EEF1EF',
        toggle: () => this.setState({ open: this.state.open === i ? -1 : i })
      });
      if (s.open === i) s.days[i].slice().reverse().forEach((x) => items.push({ isDay: false, isEntry: true, time: x.t, ml: f(x.ml) }));
    }
    const last = s.days[6][s.days[6].length - 1];
    const gd = parseInt(s.goalDraft, 10) || 0;
    return {
      goal: f(goal), goalEdit: s.goalEdit, goalDraft: s.goalDraft,
      toggleGoal: () => this.setState({ goalEdit: !this.state.goalEdit, goalDraft: String(this.state.goal) }),
      setGoalDraft: (e) => this.setState({ goalDraft: e.target.value.replace(/\D/g, '').slice(0, 4) }),
      saveGoal: () => { const v = parseInt(this.state.goalDraft, 10) || 0; if (v >= 500 && v <= 6000) this.setState({ goal: v, goalEdit: false }); },
      goalOk: gd >= 500 && gd <= 6000 ? 1 : 0.45,
      total: f(today), pct: pct + ' %', ring: (Math.min(today / goal, 1) * C).toFixed(1) + ' ' + C,
      pop: s.pulse ? 'popA .3s ease-out' : 'none',
      status: today >= goal ? 'Objectif atteint' : 'Il reste ' + f(rem) + ' ml',
      stBg: today >= goal ? '#1db954' : '#e8fef0', stColor: today >= goal ? '#FFFFFF' : '#0d7c36',
      quick: [150, 250, 500].map((ml) => ({ ml: ml, add: () => this.add(ml) })),
      custom: s.custom, setCustom: (e) => this.setState({ custom: e.target.value.replace(/\D/g, '').slice(0, 4) }),
      addCustom: () => this.add(this.state.custom), customOk: (parseInt(s.custom, 10) || 0) > 0 ? 1 : 0.45,
      canUndo: s.days[6].length > 0, lastLabel: last ? '+' + f(last.ml) + ' ml' : '',
      undo: () => { const d = this.state.days.slice(); d[6] = d[6].slice(0, -1); this.setState({ days: d }); },
      goalBottom: Math.round(H * 0.8) + 'px',
      cols: tot.map((v, i) => ({ l: L[i], h: Math.min(Math.round(v / goal * H * 0.8), H) + 'px', bg: v >= goal ? '#1db954' : '#111A15', lc: i === 6 ? '#0d7c36' : '#0F1512', lw: i === 6 ? 900 : 700 })),
      items: items
    };
  }
}
