<script lang="ts">
  import { Logic } from './Progress.logic.svelte';
  import './Progress.css';
  import BottomNav from '$lib/components/BottomNav.svelte';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-progress screen" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

  <div style="padding:52px 20px 0;display:flex;align-items:center;justify-content:space-between">
    <a class="press" href="/home" aria-label="Retour à l'accueil" style="height:44px;box-sizing:border-box;padding:0 18px 0 10px;border-radius:22px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -8px rgba(15,21,18,.14);display:flex;align-items:center;gap:4px;font-size:15px;font-weight:700;color:#0F1512">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>
      Accueil
    </a>
    <div style="display:flex;align-items:center;gap:10px">
      <button class="press" aria-label="Actualiser" style="width:44px;height:44px;padding:0;border-radius:22px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -8px rgba(15,21,18,.14);display:flex;align-items:center;justify-content:center;color:#0F1512">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.2L4 9"></path><path d="M4 4v5h5"></path><path d="M4 13a8 8 0 0 0 14.5 4.2L20 15"></path><path d="M20 20v-5h-5"></path></svg>
      </button>
      <button class="press" aria-label="Profil" style="width:44px;height:44px;padding:0;border-radius:22px;border:2px solid #FFFFFF;background:#e8fef0;box-shadow:0 0 0 1px rgba(29,185,84,.3),0 8px 20px -8px rgba(15,21,18,.18);display:flex;align-items:center;justify-content:center;color:#0d7c36;font-size:15px;font-weight:900">HG</button>
    </div>
  </div>

  <div style="flex:1;min-height:0;overflow-y:auto;padding:0 0 140px">

    <div style="padding:24px 20px 0">
      <div style="display:flex;align-items:center;gap:10px">
        <h1 style="margin:0;font-size:34px;font-weight:900;letter-spacing:-0.03em;line-height:1.05">Ma progression</h1>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"></path><path d="M15 7h6v6"></path></svg>
      </div>
      <p style="margin:10px 0 0;font-size:15px;line-height:1.45;color:#66716B">Poids, mensurations et masse grasse estimée — touche une courbe pour la détailler.</p>
    </div>

    <div style="padding:22px 20px 0;display:flex;flex-direction:column;gap:16px">

      <div class="card" style="padding:18px 20px;border-radius:26px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 16px 36px -18px rgba(15,21,18,.2)">
        <div style="display:flex;align-items:center;gap:14px">
          <span style="width:48px;height:48px;border-radius:16px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center;flex:none"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16.500L16.500 4l3.500 3.500L7.500 20Z"></path><path d="M8 12.500l2 2M11 9.500l1.500 1.500M14 6.500l2 2"></path></svg></span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">TAILLE</div>
            <div style="margin-top:2px;display:flex;align-items:baseline;gap:5px"><span style="font-size:32px;font-weight:900;letter-spacing:-0.03em;line-height:1.1">173</span><span style="font-size:16px;font-weight:700;color:#66716B">cm</span></div>
          </div>
          <a class="press" href="/sheet-taille" style="flex:none;height:44px;box-sizing:border-box;display:flex;align-items:center;padding:0 20px;border-radius:22px;border:1px solid #DDE3DF;background:#FFFFFF;font-size:15px;font-weight:700;color:#0F1512">Modifier</a>
        </div>
        <p style="margin:12px 0 0;font-size:13px;line-height:1.45;color:#66716B">La taille est renseignée une seule fois — elle reste associée à ton profil.</p>
      </div>

      {#each v.metrics as c}
        <div class="card" style="position:relative;border-radius:28px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.2);overflow:hidden"><a href={c.detail} aria-label="Voir le détail et l'historique" style="position:absolute;left:0;right:0;top:0;height:150px;z-index:1"></a>
          <div style="padding:20px 20px 4px">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">{c.label}</span>
              <span style="width:34px;height:34px;border-radius:12px;background:{c.tint};color:{c.color};display:flex;align-items:center;justify-content:center">
                {#if c.isWeight}<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M7 20h10M5 8h14"></path><path d="M5 8l-2.500 6a3 3 0 0 0 5 0Z"></path><path d="M19 8l-2.500 6a3 3 0 0 0 5 0Z"></path></svg>{/if}
                {#if c.isRuler}<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16.500L16.500 4l3.500 3.500L7.500 20Z"></path><path d="M8 12.500l2 2M11 9.500l1.500 1.500M14 6.500l2 2"></path></svg>{/if}
                {#if c.isTarget}<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.500"></circle><circle cx="12" cy="12" r="4.500"></circle><circle cx="12" cy="12" r="1" fill="currentColor"></circle></svg>{/if}
              </span>
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;flex-wrap:wrap;gap:10px 12px">
              <div style="display:flex;align-items:baseline;gap:6px"><span style="font-size:48px;font-weight:900;letter-spacing:-0.04em;line-height:1">{c.value}</span><span style="font-size:18px;font-weight:700;color:#66716B">{c.unit}</span></div>
              <span style="display:inline-flex;align-items:center;gap:4px;border-radius:12px;padding:6px 11px;font-size:13px;font-weight:700;background:{c.chipBg};color:{c.chipFg}">
                {#if c.down}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"></path></svg>{/if}
                {#if c.up}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"></path></svg>{/if}
                {c.delta}
              </span>
            </div>
            <div style="margin-top:6px;font-size:14px;color:#66716B">{c.sub}</div>
          </div>

          <div style="padding:6px 18px 6px">
            <div style="position:relative;touch-action:pan-y" onmousemove={c.move} ontouchmove={c.move} ontouchstart={c.move} onmouseleave={c.leave} ontouchend={c.leave}>
              <svg viewBox="0 0 318 132" width="100%" height="132" style="display:block;overflow:visible" role="img" aria-label={c.aria}>
                <defs><linearGradient id={c.gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color={c.color} stop-opacity="0.24"></stop><stop offset="1" stop-color={c.color} stop-opacity="0"></stop></linearGradient></defs>
                <line x1="0" y1="20" x2="318" y2="20" stroke="#EEF1EF" stroke-width="1" stroke-dasharray="3 5"></line>
                <line x1="0" y1="66" x2="318" y2="66" stroke="#EEF1EF" stroke-width="1" stroke-dasharray="3 5"></line>
                <line x1="0" y1="112" x2="318" y2="112" stroke="#EEF1EF" stroke-width="1" stroke-dasharray="3 5"></line>
                <path class="area" d={c.area} fill="url(#{c.gid})"></path>
                <path class="draw" pathLength="1" d={c.line} fill="none" stroke={c.color} stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>
                <path class="area" d={c.dots} fill="none" stroke={c.color} stroke-width="9" stroke-linecap="round"></path>
                <path class="area" d={c.dots} fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round"></path>
                <line x1={c.hx} y1="12" x2={c.hx} y2="112" stroke={c.color} stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="3 4" style="transition:x1 .15s ease,x2 .15s ease"></line>
                <circle cx={c.hx} cy={c.hy} r="11" fill={c.color} fill-opacity="0.18" style="transition:cx .15s ease,cy .15s ease"></circle>
                <circle cx={c.hx} cy={c.hy} r="6.5" fill={c.color} stroke="#FFFFFF" stroke-width="2.5" style="transition:cx .15s ease,cy .15s ease"></circle>
              </svg>
              <div aria-live="polite" style="position:absolute;top:{c.tipTop}px;left:{c.tipLeft}%;transform:translate(-50%,-100%);pointer-events:none;padding:7px 12px;border-radius:12px;background:#111A15;color:#FFFFFF;text-align:center;white-space:nowrap;box-shadow:0 12px 24px -10px rgba(15,21,18,.5);transition:left .15s ease,top .15s ease"><div style="font-size:14px;font-weight:900;line-height:1.2">{c.tipVal}</div><div style="font-size:11.5px;color:#C9D0CC;line-height:1.3">{c.tipDate}</div></div>
            </div>
            <div style="display:flex;justify-content:space-between;padding:4px 2px 0;font-size:11.5px;color:#7B857F"><span>{c.d0}</span><span>{c.d1}</span></div>
          </div>

          {#if c.manual}
            <a class="press" href={c.sheet} style="width:100%;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:16px 20px;border:0;border-top:1px solid #EEF1EF;background:#FFFFFF;font-size:15px;font-weight:700;color:#0F1512;text-align:left">
              <span style="width:28px;height:28px;border-radius:14px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center;flex:none"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg></span>
              <span style="flex:1">Enregistrer une valeur</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA39E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>
            </a>
          {/if}
          {#if c.auto}
            <div style="display:flex;align-items:flex-start;gap:12px;padding:16px 20px;border-top:1px solid #EEF1EF;background:#FBFCFB">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9AA39E" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><path d="M9 18h6M10 21h4"></path><path d="M12 3a6 6 0 0 0-3.500 10.900c.6.5 1 1.200 1 2.100h5c0-.9.4-1.600 1-2.100A6 6 0 0 0 12 3Z"></path></svg>
              <span style="font-size:13px;line-height:1.5;color:#66716B">Calcul automatique depuis tes mensurations — impossible à modifier. Touche la courbe pour voir l'historique.</span>
            </div>
          {/if}
        </div>
      {/each}

      <div style="padding:16px 20px;border-radius:22px;background:#FFF6EE;border:1px solid #FDE3CC;font-size:13px;line-height:1.5;color:#8A4A12">Estimation sensible aux conditions de mesure. La tendance compte plus qu'un chiffre isolé.</div>
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;height:140px;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 66%);pointer-events:none"></div>

  <BottomNav variant="C" active="progress" />
</div>
