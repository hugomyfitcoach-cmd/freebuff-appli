// Logique visuelle de l'écran « Progress » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
  constructor(props) { super(props); this.state = { hov: {} }; }
  monotone(pts) {
    const n = pts.length;
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1].x - pts[i].x;
      m[i] = (pts[i + 1].y - pts[i].y) / dx[i];
    }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) { t[i] = 0; }
      else {
        const a = dx[i - 1], b = dx[i];
        t[i] = (3 * (a + b)) / ((2 * b + a) / m[i - 1] + (b + 2 * a) / m[i]);
      }
    }
    let d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[i].x, y0 = pts[i].y, x1 = pts[i + 1].x, y1 = pts[i + 1].y, h = dx[i] / 3;
      d += ' C' + (x0 + h).toFixed(1) + ' ' + (y0 + t[i] * h).toFixed(1) + ' ' + (x1 - h).toFixed(1) + ' ' + (y1 - t[i + 1] * h).toFixed(1) + ' ' + x1.toFixed(1) + ' ' + y1.toFixed(1);
    }
    return d;
  }
  chart(pts0, unit, dec, hk) {
    const W = 318, H = 132, pt = 20, pb = 20, px = 8;
    const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const base = new Date(2026, 8, 7);
    const dateOf = (t) => { const d = new Date(base.getTime() + t * 86400000); return d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear(); };
    const fmt = (v) => v.toFixed(dec).replace('.', ',') + ' ' + unit;
    const t0 = pts0[0].t, t1 = pts0[pts0.length - 1].t;
    let vmin = Math.min.apply(null, pts0.map((p) => p.v)), vmax = Math.max.apply(null, pts0.map((p) => p.v));
    if (vmax - vmin < 1e-9) { vmin -= 1; vmax += 1; }
    const pts = pts0.map((p) => ({ x: px + (p.t - t0) / (t1 - t0) * (W - 2 * px), y: pt + (1 - (p.v - vmin) / (vmax - vmin)) * (H - pt - pb) }));
    const line = this.monotone(pts);
    const last = pts[pts.length - 1];
    const area = line + ' L' + last.x.toFixed(1) + ' ' + H + ' L' + pts[0].x.toFixed(1) + ' ' + H + ' Z';
    const dots = pts.slice(0, pts.length - 1).map((p) => 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' h0').join(' ');
    const k = (hk === undefined || hk === null) ? pts.length - 1 : hk;
    const hp = pts[k];
    return { line, area, dots, xs: pts.map((p) => p.x), hx: hp.x.toFixed(1), hy: hp.y.toFixed(1),
      tipTop: Math.max(hp.y - 14, 34).toFixed(0), tipLeft: Math.min(Math.max(hp.x / W * 100, 18), 82).toFixed(1),
      tipVal: fmt(pts0[k].v), tipDate: dateOf(pts0[k].t), d0: dateOf(t0), d1: dateOf(t1) };
  }
  renderVals() {
    const weightRaw = [[0,1],[0.034,0.728],[0.068,0.531],[0.102,0.798],[0.138,0.798],[0.586,0.732],[0.62,0.732],[0.655,0.798],[0.725,0.596],[0.793,0.667],[0.862,0.531],[0.896,0.798],[0.93,0.93],[0.966,0],[1,0.268]];
    const weight = weightRaw.map((p) => ({ t: Math.round(p[0] * 29), v: 72.7 + p[1] * 1.5 }));
    const green = { chipBg: '#e8fef0', chipFg: '#0d7c36' };
    const orange = { chipBg: '#FFF1E6', chipFg: '#f97316' };
    const defs = [
      Object.assign({ label: 'POIDS', value: '73,1', unit: 'kg', delta: '1,1 kg', down: true, up: false, sub: 'Poids', color: '#1db954', tint: '#e8fef0', gid: 'gWeight', isWeight: true, isRuler: false, isTarget: false, manual: true, auto: false, aria: 'Courbe de poids', pts: weight, dec: 1 }, green),
      Object.assign({ label: 'TOUR DE TAILLE FINE', value: '85', unit: 'cm', delta: '5 cm', down: true, up: false, sub: 'Partie la plus fine', color: '#F97316', tint: '#FFF1E6', gid: 'gWaist', isWeight: false, isRuler: true, isTarget: false, manual: true, auto: false, aria: 'Courbe du tour de taille', pts: [{ t: 0, v: 90 }, { t: 20, v: 85 }], dec: 0 }, green),
      Object.assign({ label: 'FESSIERS', value: '107', unit: 'cm', delta: '7 cm', down: false, up: true, sub: 'Circonférence', color: '#EC4899', tint: '#FDE8F3', gid: 'gHips', isWeight: false, isRuler: true, isTarget: false, manual: true, auto: false, aria: 'Courbe des fessiers', pts: [{ t: 0, v: 100 }, { t: 20, v: 107 }], dec: 0 }, orange),
      Object.assign({ label: 'TOUR DE COU', value: '33', unit: 'cm', delta: '3 cm', down: false, up: true, sub: 'Circonférence', color: '#3B82F6', tint: '#E8F0FE', gid: 'gNeck', isWeight: false, isRuler: true, isTarget: false, manual: true, auto: false, aria: 'Courbe du tour de cou', pts: [{ t: 0, v: 30 }, { t: 20, v: 33 }], dec: 0 }, orange),
      Object.assign({ label: '% DE MASSE GRASSE ESTIMÉ', value: '35,7', unit: '%', delta: '0,5 % depuis le démarrage', down: true, up: false, sub: 'Estimation indicative — méthode US Navy', color: '#A855F7', tint: '#F3E8FF', gid: 'gFat', isWeight: false, isRuler: false, isTarget: true, manual: false, auto: true, aria: 'Courbe de masse grasse estimée', pts: [{ t: 0, v: 36.2 }, { t: 2, v: 36.2 }, { t: 20, v: 35.7 }, { t: 29, v: 35.7 }], dec: 1 }, green)
    ];
    const details = ['/poids', '/partie-fine', '/fessiers', '/cou', '/masse-grasse'];
    const hov = this.state.hov;
    return { metrics: defs.map((d, i) => {
      const c = this.chart(d.pts, d.unit, d.dec, hov[i]);
      const move = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const t = e.touches && e.touches.length ? e.touches[0] : e;
        const x = (t.clientX - r.left) / r.width * 318;
        let best = 0;
        c.xs.forEach((px, k) => { if (Math.abs(px - x) < Math.abs(c.xs[best] - x)) best = k; });
        if (this.state.hov[i] !== best) { const h = Object.assign({}, this.state.hov); h[i] = best; this.setState({ hov: h }); }
      };
      const leave = () => { const h = Object.assign({}, this.state.hov); delete h[i]; this.setState({ hov: h }); };
      return Object.assign({ detail: details[i], sheet: i === 0 ? '/sheet-poids' : '/sheet-mesures', move: move, leave: leave }, d, c);
    }) };
  }
}
