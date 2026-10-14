#!/usr/bin/env node
/**
 * Tests de fumée : navigation, interactions, responsive.
 * Usage : npm run build && npm run preview -- --port 4173  (autre terminal) puis  node scripts/smoke.mjs [http://localhost:4173]
 * Nécessite playwright (npm i -D playwright && npx playwright install chromium).
 */
const BASE = process.argv[2] || 'http://localhost:4173';
const pw = await import(process.env.PW_MODULE || 'playwright');
const browser = await pw.chromium.launch();
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${msg}`); if (!ok) failed++; };
const SLUGS = ['main','meal-edit','foods','food-edit','home','progress','hydratation','journal','search','drive','bilans','calibrage','nutrition','recipes','messages','depense','guide','poids','partie-fine','performance','cycle','steps','settings','recap','sheet-mesures','sheet-taille','food-detail','food-banane','scanner','meal-ai','journal-select','login','fessiers','cou','masse-grasse','sheet-poids'];

async function open(ctx, slug) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && p.errors.push(m.text()));
  await p.goto(`${BASE}/${slug}`);
  await p.waitForSelector('.artboard > *');
  return p;
}

// 1. liens internes : chaque lien <a href="/..."> des 36 écrans pointe vers un écran existant
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
  const bad = new Set();
  for (const s of SLUGS) {
    const p = await open(ctx, s);
    const hrefs = await p.$$eval('.artboard a[href]', (as) => as.map((a) => a.getAttribute('href')));
    for (const h of hrefs) if (h.startsWith('/') && !SLUGS.includes(h.slice(1))) bad.add(`${s} → ${h}`);
    await p.close();
  }
  check(!bad.size, `liens internes valides${bad.size ? ' · ' + [...bad].join(', ') : ''}`);
  await ctx.close();
}

// 2. clic sur tous les boutons de chaque écran : aucune exception
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
  let n = 0, errs = [];
  for (const s of SLUGS) {
    const p = await open(ctx, s);
    const count = await p.$$eval('.artboard button', (b) => b.length);
    for (let i = 0; i < count; i++) {
      const b = (await p.$$('.artboard button'))[i];
      if (!b) break;
      try { await b.click({ timeout: 800, force: true }); n++; } catch {}
    }
    errs.push(...p.errors.map((e) => `${s}: ${e.slice(0, 120)}`));
    await p.close();
  }
  check(!errs.length, `${n} clics sur boutons sans erreur${errs.length ? ' · ' + errs.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}

// 3. interactions précises
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
  let p = await open(ctx, 'food-detail');
  const num = () => p.evaluate(() => [...document.querySelectorAll('.artboard span')].find((e) => getComputedStyle(e).fontSize === '40px')?.textContent.trim());
  const before = await num();
  await p.click('.artboard button[aria-label="Augmenter la quantité"]');
  check((await num()) !== before, `fiche aliment : « + » change la quantité (${before} → ${await num()})`);
  await p.click('.artboard button[aria-label^="Ajouter aux favoris"], .artboard button.hb');
  check((await p.$eval('.artboard button.hb', (e) => e.getAttribute('aria-pressed'))) === 'true', 'fiche aliment : le cœur favori passe actif');
  await p.close();

  p = await open(ctx, 'scanner');
  await p.fill('.artboard input[aria-label="Code-barres"]', '3017620422003');
  await p.waitForTimeout(400);
  const bg = await p.$eval('.artboard a[aria-label="Rechercher le code"]', (e) => getComputedStyle(e).backgroundColor);
  check(bg === 'rgb(29, 185, 84)', 'scanner : la flèche devient verte avec un code complet');
  await p.click('.artboard button[aria-label="Flash"]');
  check((await p.$eval('.artboard button[aria-label="Flash"]', (e) => e.getAttribute('aria-pressed'))) === 'true', 'scanner : le flash s\'active');
  await p.click('.artboard button[aria-label="Zoom numérique"]');
  check((await p.$eval('.artboard button[aria-label="Zoom numérique"]', (e) => e.textContent.trim())) === '2×', 'scanner : zoom 1× → 2×');
  await p.close();

  p = await open(ctx, 'journal');
  const t0 = await p.$eval('.artboard', (e) => e.innerText);
  await p.click('.artboard button[aria-label="Choisir la date"]');
  check((await p.$eval('.artboard button[aria-label="Choisir la date"]', (e) => e.getAttribute('aria-expanded'))) === 'true', 'journal : le calendrier s\'ouvre');
  await p.close();

  p = await open(ctx, 'calibrage');
  await p.click('.artboard button:has-text("Cuit (dans l\'assiette)")');
  check((await p.$eval('.artboard button:has-text("Cuit (dans l\'assiette)")', (e) => e.getAttribute('aria-pressed'))) === 'true', 'calibrage : bascule Cru → Cuit');
  await p.close();

  p = await open(ctx, 'home');
  await p.click('.artboard nav a[href="/journal"]');
  await p.waitForURL('**/journal');
  check(p.url().endsWith('/journal'), 'navigation Accueil → Journal par la barre du bas (sans rechargement)');
  await p.goBack();
  await p.close();
  await ctx.close();
}

// 4. responsive
for (const [w, h, label] of [[360, 740, 'Android 360×740'], [375, 667, 'iPhone SE 375×667'], [390, 844, 'iPhone 390×844'], [430, 932, 'iPhone Pro Max 430×932'], [1280, 900, 'bureau 1280×900'], [1024, 600, 'bureau bas 1024×600']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const bad = [];
  for (const s of ['home', 'journal', 'food-banane', 'login', 'progress']) {
    const p = await open(ctx, s);
    const r = await p.$eval('.artboard', (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height, sw: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight }; });
    const mobile = w <= 640;
    if (r.sw > r.vw + 1) bad.push(`${s}: défilement horizontal`);
    if (mobile && (Math.abs(r.w - Math.min(w, 390 * 1.15)) > 2 || r.h < h - 2)) bad.push(`${s}: écran ${r.w.toFixed(0)}×${r.h.toFixed(0)}`);
    if (!mobile && r.t + r.h > h + 1) bad.push(`${s}: écran coupé en bas (${(r.t + r.h).toFixed(0)} > ${h})`);
    await p.close();
  }
  check(!bad.length, `responsive ${label}${bad.length ? ' · ' + bad.join(', ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} échec(s)` : '\nTous les tests de fumée passent.');
process.exit(failed ? 1 : 0);
