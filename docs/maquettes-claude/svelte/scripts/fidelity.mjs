#!/usr/bin/env node
/**
 * Test de fidélité : pour chacun des 35 écrans, compare
 *   (A) le rendu de RÉFÉRENCE : la maquette d'origine (reference/maquettes/*.dc.html) évaluée avec sa propre
 *       logique (état initial) puis rendue telle quelle dans Chromium ;
 *   (B) le rendu SVELTE de la route correspondante.
 * Comparaison : structure DOM, balises, attributs, styles en ligne, textes, et position/taille (rect) de chaque élément.
 *
 * Usage :  npm run build && npm run preview -- --port 4173   (autre terminal)
 *          npm i -D playwright && npx playwright install chromium     (une fois)
 *          node scripts/fidelity.mjs [http://localhost:4173] [Home Journal ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://localhost:4173';
const only = process.argv.slice(2).filter((a) => !a.startsWith('http'));
const pw = await import(process.env.PW_MODULE || 'playwright');
const refDir = path.join(root, 'reference/maquettes');
const names = fs.readdirSync(refDir).filter((f) => f.endsWith('.dc.html')).map((f) => f.replace('.dc.html', ''));

// ---- polices locales (fontsource) intégrées en data-URI pour la page de référence
function fontCss() {
  let css = '';
  for (const w of [400, 700, 900]) {
    const dir = path.join(root, 'node_modules/@fontsource/lato');
    let c = fs.readFileSync(path.join(dir, `${w}.css`), 'utf8');
    c = c.replace(/url\(\.\/files\/([^)]+\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(dir, 'files', f)).toString('base64')})`);
    c = c.replace(/src:[^;]*format\("woff"\)[^;]*;/g, (m) => m); // woff de repli conservé tel quel (non chargé)
    css += c + '\n';
  }
  return css;
}
const FONTS = fontCss();

// ---- évaluateur de la syntaxe des maquettes ({{ }}, sc-for, sc-if) -> HTML statique
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function compile(body) {
  const TOK = /<sc-for\b([^>]*)>|<\/sc-for>|<sc-if\b([^>]*)>|<\/sc-if>/gs;
  let code = '';
  let pos = 0;
  const scope = [];
  const ref = (e) => {
    e = e.trim();
    const r = e.split('.')[0];
    return scope.includes(r) || r === '$index' ? e : `v.${e}`;
  };
  const lit = (s) => '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
  const emit2 = (s) => {
    let c = '';
    const re = /(\s)([\w:-]+)="([^"]*)"|\{\{\s*([^}]*?)\s*\}\}/g;
    let p = 0, m;
    while ((m = re.exec(s))) {
      if (m[2] !== undefined) {
        const val = m[3];
        if (!val.includes('{{')) continue;
        c += `out+=${lit(s.slice(p, m.index))};`;
        const whole = val.match(/^\{\{\s*([^}]*?)\s*\}\}$/);
        if (whole) c += `out+=A(${JSON.stringify(m[1] + m[2])},${ref(whole[1])});`;
        else {
          const inner = val.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (x, e) => `\u0003${ref(e)}\u0004`);
          const ps = inner.split(/\u0003|\u0004/);
          c += 'out+=' + lit(m[1] + m[2] + '="') + '+' + ps.map((q, i) => (i % 2 ? `escA(${q})` : lit(q))).join('+') + '+' + lit('"') + ';';
        }
        p = m.index + m[0].length;
      } else {
        c += `out+=${lit(s.slice(p, m.index))};out+=esc(${ref(m[4])});`;
        p = m.index + m[0].length;
      }
    }
    c += `out+=${lit(s.slice(p))};`;
    return c;
  };
  let m;
  while ((m = TOK.exec(body))) {
    code += emit2(body.slice(pos, m.index));
    pos = TOK.lastIndex;
    const t = m[0];
    if (t.startsWith('<sc-for')) {
      const list = t.match(/list="\{\{\s*([^}]*?)\s*\}\}"/)[1];
      const as = t.match(/\bas="(\w+)"/)[1];
      code += `for(const [$index,${as}] of (${ref(list)}||[]).entries()){`;
      scope.push(as);
    } else if (t.startsWith('<sc-if')) {
      const val = t.match(/value="\{\{\s*([^}]*?)\s*\}\}"/)[1];
      code += `if(${ref(val)}){`;
    } else if (t === '</sc-for>') { scope.pop(); code += '}'; }
    else code += '}';
  }
  code += emit2(body.slice(pos));
  return new Function('v', 'esc', 'escA', 'A', `let out='';${code}return out;`);
}
function A(name, val) {
  if (/^\s(aria|data)-/.test(name) && typeof val === 'boolean') return `${name}="${val}"`;
  if (typeof val === 'function' || val === undefined || val === null || val === false) return '';
  if (val === true) return `${name}=""`.replace(/^(\s*)/, '$1');
  return `${name}="${escA(val)}"`;
}
class DCLogicShim { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, p); } }
function referenceHtml(name) {
  const t = fs.readFileSync(path.join(refDir, name + '.dc.html'), 'utf8');
  const helm = t.match(/<helmet>(.*?)<\/helmet>/s)[1];
  const css = helm.match(/<style>(.*?)<\/style>/s)[1];
  let body = t.match(/<x-dc>(.*?)<\/x-dc>/s)[1].replace(/<helmet>.*?<\/helmet>/s, '').trim();
  const script = t.match(/<script type="text\/x-dc"[^>]*>(.*?)<\/script>/s)[1];
  const Component = new Function('DCLogic', script + '\nreturn Component;')(DCLogicShim);
  const vals = new Component({}).renderVals();
  const html = compile(body)(vals, esc, escA, (n, v) => A(n, v));
  const fixed = html.replace(/\b([A-Z][A-Za-z]*(?:-[A-Za-z]+)*)\.dc\.html/g, (_, n) => '/' + n.toLowerCase()).replace(/\.\.\/assets\//g, '/assets/');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${FONTS}\n${css}\n*{animation:none!important;transition:none!important}</style></head><body>${fixed}</body></html>`;
}

// ---- sérialisation commune (exécutée dans la page)
const SERIALIZE = `(rootSel) => {
  const root = document.querySelector(rootSel);
  const o = root.getBoundingClientRect();
  const out = [];
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const walk = (el) => {
    const r = el.getBoundingClientRect();
    const attrs = {};
    for (const a of el.attributes) {
      if (/^on/.test(a.name) || a.name === 'selected') continue;
      let v = a.value;
      if (a.name === 'class') v = v.split(/\\s+/).filter((c) => !/^s-[a-z-]+$/.test(c)).join(' ');
      if (a.name === 'style') {
        v = v.replace(/width:\\s*var\\(--gf-w,\\s*390px\\)/, 'width:390px').replace(/height:\\s*var\\(--gf-h,\\s*844px\\)/, 'height:844px');
        const t = document.createElement('div');
        t.style.cssText = v;
        v = t.style.cssText.split(';').map((x) => x.trim()).filter(Boolean).sort().join(';');
      }
      if (/^-?\\d+\\.\\d+$/.test(v)) v = String(parseFloat(v));
      if (a.name === 'value' && /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName)) continue;
      if (v === '' && a.name === 'class') continue;
      attrs[a.name] = v;
    }
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) attrs.__value = el.value;
    const sorted = {};
    for (const k of Object.keys(attrs).sort()) sorted[k] = attrs[k];
    out.push({ tag: el.tagName.toLowerCase(), attrs: sorted, text: norm(text), rect: [r.left - o.left, r.top - o.top, r.width, r.height].map((x) => Math.round(x * 2) / 2) });
    for (const c of el.children) walk(c);
  };
  walk(root);
  return out;
}`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 920 } });
let fail = 0;
for (const name of names) {
  if (only.length && !only.includes(name)) continue;
  const slug = name.toLowerCase();
  const html = referenceHtml(name);
  const pa = await ctx.newPage();
  await pa.route('**/__ref.html', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await pa.goto(`${BASE}/__ref.html`);
  await pa.evaluate(() => document.fonts.ready);
  const ref = await pa.evaluate(`(${SERIALIZE})('body > *:first-child')`);
  await pa.close();
  const pb = await ctx.newPage();
  const errors = [];
  pb.on('pageerror', (e) => errors.push(String(e)));
  pb.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await pb.goto(`${BASE}/${slug}`);
  await pb.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  await pb.evaluate(() => document.fonts.ready);
  await pb.waitForSelector('.artboard > *');
  const got = await pb.evaluate(`(${SERIALIZE})('.artboard > *:first-child')`);
  await pb.close();
  const diffs = [];
  if (ref.length !== got.length) diffs.push(`nombre d'éléments : réf ${ref.length} / svelte ${got.length}`);
  for (let i = 0; i < Math.min(ref.length, got.length) && diffs.length < 6; i++) {
    const a = ref[i], b = got[i];
    if (a.tag !== b.tag) { diffs.push(`#${i} balise ${a.tag} ≠ ${b.tag}`); break; }
    const ka = JSON.stringify(a.attrs), kb = JSON.stringify(b.attrs);
    if (ka !== kb) diffs.push(`#${i} <${a.tag}> attributs\n   réf: ${ka.slice(0, 300)}\n   svl: ${kb.slice(0, 300)}`);
    else if (a.text !== b.text) diffs.push(`#${i} <${a.tag}> texte « ${a.text.slice(0, 60)} » ≠ « ${b.text.slice(0, 60)} »`);
    else if (!(a.rect[2] === 0 && a.rect[3] === 0 && b.rect[2] === 0 && b.rect[3] === 0) && a.rect.some((x, k) => Math.abs(x - b.rect[k]) > 1)) diffs.push(`#${i} <${a.tag}> rect ${a.rect} ≠ ${b.rect}`);
  }
  const ok = !diffs.length && !errors.length;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'ÉCART'} ${name.padEnd(15)} ${ref.length} éléments${errors.length ? ' · erreurs console: ' + errors.slice(0, 2).join(' | ') : ''}`);
  diffs.forEach((d) => console.log('     ' + d));
}
await browser.close();
console.log(fail ? `\n${fail} écran(s) avec écart` : '\nTous les écrans sont identiques à la référence.');
process.exit(fail ? 1 : 0);
