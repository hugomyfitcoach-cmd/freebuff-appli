// Logique visuelle de l'écran « Home » — convertie depuis la maquette (état + valeurs dérivées). Données fictives conservées.
// @ts-nocheck — code d'origine (JS) conservé tel quel pour garantir un rendu identique ; à typer à l'intégration.
import { DCLogic } from '$lib/dc/DCLogic.svelte';

export class Logic extends DCLogic {
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
  renderVals() {
    const W = 158, H = 64, pt = 8, pb = 8, px = 5;
    const raw = [[0,1],[0.034,0.728],[0.068,0.531],[0.102,0.798],[0.138,0.798],[0.586,0.732],[0.62,0.732],[0.655,0.798],[0.725,0.596],[0.793,0.667],[0.862,0.531],[0.896,0.798],[0.93,0.93],[0.966,0],[1,0.268]];
    const pts = raw.map((p) => ({ x: px + p[0] * (W - 2 * px), y: pt + (1 - p[1]) * (H - pt - pb) }));
    const line = this.monotone(pts);
    const last = pts[pts.length - 1];
    const area = line + ' L' + last.x.toFixed(1) + ' ' + H + ' L' + pts[0].x.toFixed(1) + ' ' + H + ' Z';
    const week = ['L','M','M','J','V','S','D'].map((l, i) => ({
      letter: l,
      letterColor: i === 1 ? '#0d7c36' : '#9AA39E',
      fill: i === 0 ? '91%' : '0%',
      c1: i === 0 ? '#F97316' : '#E8ECE9',
      c2: i === 0 ? '#3B82F6' : '#E8ECE9',
      c3: i === 0 ? '#EC4899' : '#E8ECE9',
      val: i === 0 ? '2 180' : '—'
    }));
    const dots = (on) => [0,1,2,3,4,5,6].map(() => ({ bg: on ? '#1db954' : '#E4E9E6' }));
    return {
      spark: { line, area, lx: last.x, ly: last.y },
      week,
      dotsCal: dots(true),
      dotsSteps: dots(false),
      macros: [
        { label: 'Glucides', color: '#EC4899', text: '#ec4899', pct: '0%', goal: '258 g', dash: '0 157' },
        { label: 'Protéines', color: '#3B82F6', text: '#3b82f6', pct: '0%', goal: '192 g', dash: '0 157' },
        { label: 'Lipides', color: '#F97316', text: '#f97316', pct: '0%', goal: '67 g', dash: '0 157' }
      ]
    };
  }
}
