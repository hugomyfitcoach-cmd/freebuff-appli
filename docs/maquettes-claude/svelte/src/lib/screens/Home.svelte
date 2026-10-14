<script lang="ts">
  import { Logic } from './Home.logic.svelte';
  import './Home.css';
  import BottomNav from '$lib/components/BottomNav.svelte';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-home screen" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

  <div style="position:relative;z-index:5;flex:none;background:#FFFFFF;padding:52px 20px 12px;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box">
    <a href="/home" aria-label="G-FLUX — Accueil" style="display:flex;align-items:center;height:44px"><img src="/assets/lockup-header.png" alt="G-FLUX" style="height:25px;width:auto;display:block"></a>
    <div style="display:flex;align-items:center;margin-right:-5px">
      <button class="press" aria-label="Actualiser" style="width:44px;height:44px;padding:0;border:0;background:transparent;display:flex;align-items:center;justify-content:center"><span style="width:34px;height:34px;border-radius:17px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 6px 14px -8px rgba(15,21,18,.14);display:flex;align-items:center;justify-content:center;color:#0F1512"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.2L4 9"></path><path d="M4 4v5h5"></path><path d="M4 13a8 8 0 0 0 14.5 4.2L20 15"></path><path d="M20 20v-5h-5"></path></svg></span></button>
      <a class="press" href="/recap" aria-label="Profil" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center"><span style="width:34px;height:34px;box-sizing:border-box;border-radius:17px;border:2px solid #FFFFFF;background:#e8fef0;box-shadow:0 0 0 1px rgba(29,185,84,.3),0 6px 14px -8px rgba(15,21,18,.18);display:flex;align-items:center;justify-content:center;color:#0d7c36;font-size:12.5px;font-weight:900">HG</span></a>
    </div>
  </div>

  <div aria-hidden="true" style="position:absolute;left:0;right:0;top:108px;height:18px;z-index:4;background:linear-gradient(#FFFFFF,rgba(255,255,255,0));pointer-events:none"></div>

  <div style="flex:1;min-height:0;overflow-y:auto;padding:0 0 140px">

    <div style="padding:26px 20px 0">
      <h1 style="margin:0;font-size:36px;font-weight:900;letter-spacing:-0.03em;line-height:1.05">Bonjour Hugo</h1>
      <p style="margin:8px 0 0;font-size:15px;color:#66716B">Mardi 13 octobre — voici où tu en es.</p>
    </div>

    <div style="display:flex;gap:10px;padding:20px 20px 10px;overflow-x:auto">
      <a class="press" href="/nutrition" style="flex:none;height:48px;padding:0 18px 0 8px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -10px rgba(15,21,18,.16);display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#0F1512">
        <span style="width:32px;height:32px;border-radius:16px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 14v5h10v-5"></path><path d="M7 14a4 4 0 0 1-1.2-7.8 4.6 4.6 0 0 1 8.7-1.5A4 4 0 0 1 17 14"></path></svg></span>Recettes
      </a>
      <a class="press" href="/drive" style="flex:none;height:48px;padding:0 18px 0 8px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -10px rgba(15,21,18,.16);display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#0F1512">
        <span style="width:32px;height:32px;border-radius:16px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 18a4.5 4.5 0 0 1-.4-9A5.5 5.5 0 0 1 17.6 9a4.5 4.5 0 0 1-.1 9Z"></path></svg></span>Drive
      </a>
      <a class="press" href="/bilans" style="flex:none;height:48px;padding:0 18px 0 8px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -10px rgba(15,21,18,.16);display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#0F1512">
        <span style="width:32px;height:32px;border-radius:16px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4.5" width="14" height="16" rx="2.5"></rect><path d="M9 4.5v-1h6v1"></path><path d="M9 13l2.2 2.2L15.5 11"></path></svg></span>Bilans
      </a>
      <button class="press" style="flex:none;height:48px;padding:0 18px 0 8px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -10px rgba(15,21,18,.16);display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;color:#0F1512">
        <span style="width:32px;height:32px;border-radius:16px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"></path></svg></span>Entraînement
      </button>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;padding:18px 20px 12px">
      <h2 style="margin:0;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#66716B">Aujourd'hui</h2>
      <span style="font-size:13px;color:#66716B">Mardi 13 octobre</span>
    </div>

    <div style="padding:0 20px;display:flex;flex-direction:column;gap:14px">

      <div class="card" style="padding:20px;border-radius:28px;border:1px solid #EEF1EF;background:radial-gradient(120% 90% at 100% 0%,#e8fef0 0%,rgba(234,248,239,0) 62%),#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.2)">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="width:34px;height:34px;border-radius:12px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 1.600.8 2.500 1.800 2.500C11 9 11.500 6 12 3Z"></path></svg></span>
            <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">CALORIES</span>
          </div>
          <span style="font-size:12px;font-weight:700;color:#0d7c36;background:#e8fef0;border-radius:12px;padding:6px 11px">Objectif 2&nbsp;400</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:7px;margin-top:12px">
          <span style="font-size:44px;font-weight:900;letter-spacing:-0.035em;line-height:1">0</span>
          <span style="font-size:15px;font-weight:700;color:#66716B">kcal</span>
        </div>
        <div style="margin-top:16px;height:10px;border-radius:5px;background:#eef0ec;overflow:hidden"><div style="width:0%;height:100%;border-radius:5px;background:#1db954"></div></div>
        <div style="margin-top:10px;font-size:14px;color:#66716B">Il te reste <strong style="color:#0F1512;font-weight:900">2&nbsp;400</strong> kcal</div>

        <div style="margin-top:18px;padding-top:18px;border-top:1px solid #EEF1EF;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
          {#each v.macros as m}
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
              <span style="font-size:13px;font-weight:700;color:{m.text}">{m.label}</span>
              <div style="position:relative;width:60px;height:60px">
                <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="25" fill="none" stroke="#eef0ec" stroke-width="6"></circle><circle cx="30" cy="30" r="25" fill="none" stroke={m.color} stroke-width="6" stroke-linecap="round" stroke-dasharray={m.dash} transform="rotate(-90 30 30)" style="animation:ringIn .8s cubic-bezier(.2,.8,.2,1) .1s both"></circle></svg>
                <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:{m.text}">{m.pct}</span>
              </div>
              <span style="font-size:12px;color:#66716B;text-align:center"><strong style="color:#0F1512">0&nbsp;g</strong> / {m.goal}</span>
            </div>
          {/each}
        </div>
      </div>

      <div class="press card" style="position:relative;padding:16px 18px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 14px 32px -16px rgba(15,21,18,.18)"><a href="/steps" aria-label="Voir mes pas" style="position:absolute;inset:0;border-radius:24px;z-index:1"></a>
        <div style="display:flex;align-items:stretch;gap:14px">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px;color:#1db954"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="8" cy="9" rx="2.4" ry="3.7"></ellipse><ellipse cx="16" cy="14.5" rx="2.4" ry="3.7"></ellipse><path d="M8 14.4v1.4M16 19.7v1.3"></path></svg><span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">PAS</span></div>
            <div style="margin-top:8px;font-size:36px;font-weight:900;letter-spacing:-0.03em;line-height:1">0 <span style="font-size:15px;font-weight:700;color:#66716B;letter-spacing:0">pas</span></div>
            <div style="margin-top:6px;font-size:13px;color:#66716B;white-space:nowrap">Aujourd'hui · Voir le détail</div>
          </div>
          <div style="width:118px;flex:none;display:flex;flex-direction:column;justify-content:flex-end">
            <div role="img" aria-label="7 derniers jours : deux jours renseignés" style="display:flex;align-items:flex-end;justify-content:space-between;height:56px"><span style="width:12px;height:8px;border-radius:4px;background:#eef0ec"></span><span style="width:12px;height:8px;border-radius:4px;background:#eef0ec"></span><span class="vbar" style="width:12px;height:52px;border-radius:6px;background:rgba(29,185,84,.3);animation-delay:230ms"></span><span class="vbar" style="width:12px;height:52px;border-radius:6px;background:rgba(29,185,84,.3);animation-delay:270ms"></span><span style="width:12px;height:8px;border-radius:4px;background:#eef0ec"></span><span style="width:12px;height:8px;border-radius:4px;background:#eef0ec"></span><span style="width:12px;height:8px;border-radius:4px;background:#eef0ec"></span></div>
            <div style="margin-top:6px;padding-top:5px;border-top:1px solid #EEF1EF;display:flex;justify-content:space-between;align-items:center"><span style="color:#9AA39E;display:flex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg></span><span style="font-size:11px;font-weight:900;letter-spacing:.1em;color:#9AA39E">7 J</span></div>
          </div>
        </div>
      </div>


      <div class="press card" style="position:relative;padding:16px 18px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 14px 32px -16px rgba(15,21,18,.18)"><a href="/hydratation" aria-label="Voir mon hydratation" style="position:absolute;inset:0;border-radius:24px;z-index:1"></a>
        <div style="display:flex;align-items:stretch;gap:14px">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px;color:#1db954"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5c3.2 4 6 7 6 10.5a6 6 0 0 1-12 0c0-3.500 2.800-6.500 6-10.500Z"></path></svg><span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">HYDRATATION</span></div>
            <div style="margin-top:8px;font-size:36px;font-weight:900;letter-spacing:-0.03em;line-height:1;white-space:nowrap">1&nbsp;250 <span style="font-size:15px;font-weight:700;color:#66716B;letter-spacing:0">/ 2&nbsp;500 ml</span></div>
            <div style="margin-top:6px;font-size:13px;color:#66716B;white-space:nowrap">Aujourd'hui · Voir le détail</div>
          </div>
          <div style="width:118px;flex:none;display:flex;flex-direction:column;justify-content:flex-end">
            <div role="img" aria-label="Objectif d'hydratation atteint à 50 %" style="display:flex;justify-content:flex-end"><div style="position:relative;width:56px;height:56px"><svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="23" fill="none" stroke="#eef0ec" stroke-width="6"></circle><circle cx="28" cy="28" r="23" fill="none" stroke="#1db954" stroke-width="6" stroke-linecap="round" stroke-dasharray="72.3 144.5" transform="rotate(-90 28 28)" style="animation:ringIn .8s cubic-bezier(.2,.8,.2,1) .1s both"></circle></svg><span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:#0F1512">50 %</span></div></div>
            <div style="margin-top:6px;padding-top:5px;border-top:1px solid #EEF1EF;display:flex;justify-content:space-between;align-items:center"><span style="color:#9AA39E;display:flex"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg></span><span style="font-size:11px;font-weight:900;letter-spacing:.1em;color:#9AA39E">OBJECTIF</span></div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px">
        <div class="card" style="position:relative;padding:18px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 14px 32px -16px rgba(15,21,18,.18)"><a href="/progress" aria-label="Voir la progression" style="position:absolute;inset:0;border-radius:24px;z-index:1"></a>
          <div style="display:flex;align-items:center;gap:9px;color:#1db954">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M7 20h10M5 8h14"></path><path d="M5 8l-2.500 6a3 3 0 0 0 5 0Z"></path><path d="M19 8l-2.500 6a3 3 0 0 0 5 0Z"></path></svg>
            <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">POIDS</span>
          </div>
          <div style="margin-top:14px;display:flex;align-items:baseline;gap:5px"><span style="font-size:36px;font-weight:900;letter-spacing:-0.03em;line-height:1">73,1</span><span style="font-size:16px;font-weight:700;color:#66716B">kg</span></div>
          <div style="margin-top:12px;display:inline-flex;align-items:center;gap:4px;background:#e8fef0;color:#0d7c36;border-radius:11px;padding:5px 10px;font-size:13px;font-weight:700">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"></path></svg>0,7 kg
          </div>
        </div>
        <div class="card" style="position:relative;padding:18px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 14px 32px -16px rgba(15,21,18,.18)"><a href="/cycle" aria-label="Voir mon cycle" style="position:absolute;inset:0;border-radius:24px;z-index:1"></a>
          <div style="display:flex;align-items:center;gap:9px;color:#1db954">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.500"></circle><path d="M12 9.500c-2-2-2-5 0-6.500 2 1.500 2 4.500 0 6.500ZM14.500 12c2-2 5-2 6.500 0-1.500 2-4.500 2-6.500 0ZM12 14.500c2 2 2 5 0 6.500-2-1.500-2-4.500 0-6.500ZM9.500 12c-2 2-5 2-6.500 0 1.500-2 4.500-2 6.500 0Z"></path></svg>
            <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">CYCLE</span>
          </div>
          <div style="margin-top:14px;font-size:20px;font-weight:900;letter-spacing:-0.02em;line-height:1.1">Menstruations</div>
          <div style="margin-top:6px;font-size:14px;color:#66716B">Jour <strong style="color:#0F1512">5</strong> / 23</div>
          <div style="margin-top:12px;height:6px;border-radius:3px;background:#eef0ec;overflow:hidden"><div style="width:21.7%;height:100%;border-radius:3px;background:#1db954"></div></div>
        </div>
      </div>

      <div class="card" style="position:relative;padding:20px;border-radius:28px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.2)"><a href="/progress" aria-label="Voir ma progression" style="position:absolute;inset:0;border-radius:24px;z-index:1"></a>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">MA PROGRESSION</span>
          <span style="width:32px;height:32px;border-radius:11px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"></path><path d="M15 7h6v6"></path></svg></span>
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:10px">
          <div style="display:flex;align-items:baseline;gap:6px"><span style="font-size:44px;font-weight:900;letter-spacing:-0.035em;line-height:1">73,1</span><span style="font-size:18px;font-weight:700;color:#66716B">kg</span></div>
          <svg width="158" height="64" viewBox="0 0 158 64" style="display:block;flex:none" role="img" aria-label="Courbe de poids">
            <defs><linearGradient id="sparkG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1db954" stop-opacity="0.24"></stop><stop offset="1" stop-color="#1db954" stop-opacity="0"></stop></linearGradient></defs>
            <path class="area" d={v.spark.area} fill="url(#sparkG)"></path>
            <path class="draw" pathLength="1" d={v.spark.line} fill="none" stroke="#1db954" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx={v.spark.lx} cy={v.spark.ly} r="4.5" fill="#1db954" stroke="#FFFFFF" stroke-width="2"></circle>
          </svg>
        </div>
      </div>

      <div class="card" style="position:relative;padding:20px;border-radius:28px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.2)"><a href="/performance" aria-label="Voir la performance" style="position:absolute;inset:0;border-radius:24px;z-index:1"></a>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:9px;color:#1db954">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"></path></svg>
            <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">PERFORMANCE</span>
          </div>
          <span style="display:inline-flex;align-items:center;gap:2px;height:30px;padding:0 8px 0 13px;border-radius:15px;background:#e8fef0;color:#0d7c36;font-size:13px;font-weight:900">Voir<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg></span>
        </div>
        <div style="margin-top:18px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px">
          {#each v.week as d}
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
              <span style="font-size:13px;font-weight:900;color:{d.letterColor}">{d.letter}</span>
              <div style="width:30px;height:116px;border-radius:15px;background:#eef0ec;display:flex;align-items:flex-end;overflow:hidden"><div style="width:100%;height:{d.fill};border-radius:15px;background:linear-gradient(to top,#17a349,#1db954)"></div></div>
              <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="15.500" fill="none" stroke={d.c1} stroke-width="3.5"></circle><circle cx="19" cy="19" r="10.500" fill="none" stroke={d.c2} stroke-width="3.5"></circle><circle cx="19" cy="19" r="5.500" fill="none" stroke={d.c3} stroke-width="3.5"></circle></svg>
              <span style="font-size:12px;font-weight:700;color:#66716B">{d.val}</span>
            </div>
          {/each}
        </div>
        <div style="margin-top:18px;padding-top:16px;border-top:1px solid #EEF1EF">
          <div style="display:grid;grid-template-columns:1.25fr 1fr 1fr">
            <div><div style="font-size:11px;font-weight:900;letter-spacing:.1em;color:#66716B">MOYENNE</div><div style="margin-top:3px;display:flex;align-items:baseline;gap:4px"><span style="font-size:24px;font-weight:900;letter-spacing:-0.03em;line-height:1;color:#0F1512">2&nbsp;180</span><span style="font-size:12px;font-weight:700;color:#66716B">kcal</span></div></div>
            <div style="border-left:1px solid #EEF1EF;padding-left:14px"><div style="font-size:11px;font-weight:900;letter-spacing:.1em;color:#66716B">OBJECTIF</div><div style="margin-top:3px;font-size:24px;font-weight:900;letter-spacing:-0.03em;line-height:1;color:#0F1512">2&nbsp;400</div></div>
            <div style="border-left:1px solid #EEF1EF;padding-left:14px"><div style="font-size:11px;font-weight:900;letter-spacing:.1em;color:#66716B">DÉFICIT</div><div style="margin-top:3px;display:flex;align-items:center;gap:3px;color:#0d7c36"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"></path></svg><span style="font-size:24px;font-weight:900;letter-spacing:-0.03em;line-height:1">~220</span></div></div>
          </div>
          <div style="margin-top:14px;height:6px;border-radius:3px;background:#eef0ec;overflow:hidden"><div class="hbar" style="width:91%;height:100%;border-radius:3px;background:linear-gradient(90deg,#17a349,#1db954)"></div></div>
          <div style="margin-top:8px;font-size:12px;color:#66716B">Déficit cumulé sur 1 jour renseigné · moyenne à 91&nbsp;% de l’objectif</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px">
        <div class="card" style="position:relative;padding:18px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 14px 32px -16px rgba(15,21,18,.18);display:flex;flex-direction:column"><a href="/depense" aria-label="Voir la dépense sportive" style="position:absolute;inset:0;border-radius:24px;z-index:1"></a>
          <div style="display:flex;align-items:center;gap:9px;color:#1db954">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3L5 13.500h6L10 21l8-10.500h-6Z"></path></svg>
            <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">DÉPENSE</span>
          </div>
          <div style="margin-top:14px;font-size:19px;font-weight:900;letter-spacing:-0.02em;line-height:1.15">Aucune activité</div>
          <div style="margin-top:6px;font-size:13px;line-height:1.4;color:#66716B">Ajoute une activité pour suivre ton volume de sport.</div>
          <button class="press" style="margin-top:auto;padding:14px 0 0;border:0;background:transparent;display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:#0d7c36">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Ajouter
          </button>
        </div>
        <div class="card" style="padding:18px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 14px 32px -16px rgba(15,21,18,.18)">
          <div style="display:flex;align-items:center;gap:9px;color:#1db954">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.500 8v8M17.500 8v8M3.500 10v4M20.500 10v4M6.500 12h11"></path></svg>
            <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">ENTRAÎNEMENT</span>
          </div>
          <div style="margin-top:14px;font-size:19px;font-weight:900;letter-spacing:-0.02em;line-height:1.15">Prochaine séance</div>
          <div style="margin-top:6px;font-size:13px;line-height:1.4;color:#66716B">mercredi · Haut du corps</div>
        </div>
      </div>

      <div style="padding:20px;border-radius:28px;border:1px solid rgba(29,185,84,.3);background:linear-gradient(180deg,#f3fcf7 0%,#FFFFFF 100%);box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.18)">
        <div style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#0d7c36">TES 7 DERNIERS JOURS TERMINÉS</div>
        <div style="margin-top:6px;font-size:13px;color:#66716B">mardi 6 octobre 2026 → lundi 12 octobre 2026</div>
        <div style="margin-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
          <div>
            <div style="font-size:11px;font-weight:900;letter-spacing:.1em;color:#66716B">CALORIES MOYENNES</div>
            <div style="margin-top:6px;display:flex;align-items:baseline;gap:4px"><span style="font-size:32px;font-weight:900;letter-spacing:-0.03em;line-height:1">2&nbsp;615</span><span style="font-size:13px;font-weight:700;color:#66716B">kcal / jour</span></div>
            <div style="margin-top:8px;font-size:12px;color:#66716B">Objectif : 2&nbsp;400 · 7 / 7 jours</div>
            <div style="margin-top:10px;display:flex;gap:5px">
              {#each v.dotsCal as x}<span style="width:14px;height:6px;border-radius:3px;background:{x.bg}"></span>{/each}
            </div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:900;letter-spacing:.1em;color:#66716B">PAS MOYENS</div>
            <div style="margin-top:6px;display:flex;align-items:baseline;gap:4px"><span style="font-size:32px;font-weight:900;letter-spacing:-0.03em;line-height:1">—</span><span style="font-size:13px;font-weight:700;color:#66716B">/ jour</span></div>
            <div style="margin-top:8px;font-size:12px;color:#66716B">Objectif : 10&nbsp;000 · 0 / 7 jours</div>
            <div style="margin-top:10px;display:flex;gap:5px">
              {#each v.dotsSteps as x}<span style="width:14px;height:6px;border-radius:3px;background:{x.bg}"></span>{/each}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;height:140px;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 66%);pointer-events:none"></div>

  <BottomNav variant="C" active="home" />
</div>
