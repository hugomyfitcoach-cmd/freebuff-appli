#!/usr/bin/env node
/** Régénère static/thumbs/*.png (vignettes de l'index). Usage : node scripts/thumbs.mjs [http://localhost:4173] */
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:4173';
const pw = await import(process.env.PW_MODULE || 'playwright');
const SLUGS = ['main','meal-edit','foods','food-edit','home','progress','journal','search','drive','bilans','calibrage','nutrition','recipes','messages','depense','guide','poids','partie-fine','performance','cycle','steps','settings','recap','sheet-mesures','sheet-taille','food-detail','food-banane','scanner','meal-ai','journal-select','login','fessiers','cou','masse-grasse','sheet-poids'];
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 0.7 });
fs.mkdirSync('static/thumbs', { recursive: true });
for (const s of SLUGS) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/${s}`);
  await p.waitForSelector('.artboard > *');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1500);
  // Chromium headless ignore var() dans counter-reset : on fige les compteurs animés pour la vignette.
  await p.evaluate(() => {
    const st = document.createElement('style'); let css = '';
    document.querySelectorAll('.c1,.c4').forEach((e, i) => {
      const g = (n) => getComputedStyle(e).getPropertyValue(n).trim();
      const txt = e.classList.contains('c4') ? `${g('--k')}\u00a0${g('--h')}${String(g('--t')).padStart(2, '0')}` : g('--n');
      e.setAttribute('data-thumb', txt);
    });
    st.textContent = '.c1::before,.c4::before{content:attr(data-thumb)!important}';
    document.head.appendChild(st);
  });
  await p.screenshot({ path: `static/thumbs/${s}.png` });
  await p.close();
}
await browser.close();
console.log('vignettes générées');
