// Logique visuelle de l'écran « Fessiers » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { hov: null }; }
  monotone(pts) {
    const n = pts.length;
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].x - pts[i].x; m[i] = (pts[i + 1].y - pts[i].y) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) { t[i] = 0; }
      else { const a = dx[i - 1], b = dx[i]; t[i] = (3 * (a + b)) / ((2 * b + a) / m[i - 1] + (b + 2 * a) / m[i]); }
    }
    let d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[i].x, y0 = pts[i].y, x1 = pts[i + 1].x, y1 = pts[i + 1].y, h = dx[i] / 3;
      d += ' C' + (x0 + h).toFixed(1) + ' ' + (y0 + t[i] * h).toFixed(1) + ' ' + (x1 - h).toFixed(1) + ' ' + (y1 - t[i + 1] * h).toFixed(1) + ' ' + x1.toFixed(1) + ' ' + y1.toFixed(1);
    }
    return d;
  }
  renderVals() {
    const PTS = [{t:0,v:100},{t:20,v:107}];
    const UNIT = 'cm', DEC = 0, EDIT = true;
    const W = 340, H = 214, pt = 30, pb = 24, px = 12;
    const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const base = new Date(2026, 8, 7);
    const dateOf = (t) => { const d = new Date(base.getTime() + t * 86400000); return d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear(); };
    const num = (v) => v.toFixed(DEC).replace('.', ',');
    const t0 = PTS[0].t, t1 = PTS[PTS.length - 1].t;
    let vmin = Math.min.apply(null, PTS.map((p) => p.v)), vmax = Math.max.apply(null, PTS.map((p) => p.v));
    if (vmax - vmin < 1e-9) { vmin -= 1; vmax += 1; }
    const ys = (v) => pt + (1 - (v - vmin) / (vmax - vmin)) * (H - pt - pb);
    const pts = PTS.map((p) => ({ x: px + (p.t - t0) / (t1 - t0) * (W - 2 * px), y: ys(p.v) }));
    const line = this.monotone(pts);
    const last = pts[pts.length - 1];
    const area = line + ' L' + last.x.toFixed(1) + ' ' + (H - pb) + ' L' + pts[0].x.toFixed(1) + ' ' + (H - pb) + ' Z';
    const dots = pts.slice(0, pts.length - 1).map((p) => 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' h0').join(' ');
    const k = this.state.hov === null ? PTS.length - 1 : this.state.hov;
    const hp = pts[k];
    const diff = k > 0 ? PTS[k].v - PTS[k - 1].v : null;
    const move = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const tt = e.touches && e.touches.length ? e.touches[0] : e;
      const x = (tt.clientX - r.left) / r.width * W;
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = i; });
      if (this.state.hov !== best) this.setState({ hov: best });
    };
    return {
      line: line, area: area, dots: dots, hx: hp.x.toFixed(1), hy: hp.y.toFixed(1),
      move: move, leave: () => this.setState({ hov: null }),
      tipTop: Math.max(hp.y - 16, 40).toFixed(0), tipLeft: Math.min(Math.max(hp.x / W * 100, 17), 83).toFixed(1),
      tipVal: num(PTS[k].v) + ' ' + UNIT, tipDate: dateOf(PTS[k].t),
      big: num(PTS[k].v), unit: UNIT, bigDate: dateOf(PTS[k].t),
      hasDiff: diff !== null, dUp: diff !== null && diff > 1e-9, dDown: diff !== null && diff < -1e-9, dFlat: diff !== null && Math.abs(diff) <= 1e-9,
      diffTxt: diff === null ? '' : (Math.abs(diff) <= 1e-9 ? '0' : num(Math.abs(diff))) + ' ' + UNIT,
      g0: num(vmax), g1: num((vmax + vmin) / 2), g2: num(vmin), y0: pt, y1: (pt + (H - pb)) / 2, y2: H - pb,
      d0: dateOf(t0), d1: dateOf(t1),
      rows: PTS.map((p, i) => ({ date: dateOf(p.t), value: num(p.v) + ' ' + UNIT, bg: i === k ? '#FDF1F7' : '#FFFFFF', edit: EDIT, border: i ? '1px solid #EEF1EF' : 'none',
        pick: () => this.setState({ hov: i }) }))
    };
  }
}
