// Logique visuelle de l'écran « Steps » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { view: 'main', today: '', saved: false, week: ['', '', '10000', '10000', '', '', ''], draft: ['', '', '10000', '10000', '', '', ''] }; }
  renderVals() {
    const L = ['M', 'M', 'J', 'V', 'S', 'D', 'L'];
    const names = ['Mardi 6 oct.', 'Mercredi 7 oct.', 'Jeudi 8 oct.', 'Vendredi 9 oct.', 'Samedi 10 oct.', 'Dimanche 11 oct.', 'Lundi 12 oct.'];
    const short = ['mar', 'mer', 'jeu', 'ven', 'sam', 'dim', 'lun'];
    const dates = ['6 oct.', '7 oct.', '8 oct.', '9 oct.', '10 oct.', '11 oct.', '12 oct.'];
    const vals = this.state.week.map((v) => parseInt(v, 10) || 0);
    const filled = vals.filter((v) => v > 0).length;
    const total = vals.reduce((a, b) => a + b, 0);
    const avg = filled ? Math.round(total / filled) : 0;
    let best = 0;
    vals.forEach((v, i) => { if (v > vals[best]) best = i; });
    const H = 150;
    const s = this.state;
    const today = s.today;
    return {
      main: s.view === 'main', weekView: s.view === 'week',
      today: today, setToday: (e) => this.setState({ today: e.target.value.replace(/\D/g, ''), saved: false }),
      saveToday: () => this.setState({ saved: true, today: '' }),
      saved: s.saved,
      goalBottom: Math.round(H * 0.8) + 'px',
      cols: vals.map((v, i) => ({
        l: L[i], has: v > 0, none: v <= 0,
        h: Math.min(Math.round(v / 10000 * H * 0.8 * 1.05), H) + 'px',
        lc: v > 0 ? '#0F1512' : '#9AA39E', lw: v > 0 ? 900 : 700
      })),
      total: String(total), avg: String(avg), best: filled ? String(vals[best]) : '–', bestDay: filled ? names[best] : '', filled: filled + ' / 7 jours renseignés',
      openWeek: () => this.setState({ view: 'week', draft: this.state.week.slice() }),
      closeWeek: () => this.setState({ view: 'main' }),
      saveWeek: () => this.setState({ view: 'main', week: this.state.draft.slice() }),
      rows: s.draft.map((v, i) => ({ d: short[i], date: dates[i], value: v, border: i ? '1px solid #EEF1EF' : 'none',
        set: (e) => { const w = this.state.draft.slice(); w[i] = e.target.value.replace(/\D/g, ''); this.setState({ draft: w }); } }))
    };
  }
}
