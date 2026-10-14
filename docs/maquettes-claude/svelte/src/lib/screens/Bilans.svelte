<script lang="ts">
  import { Logic } from './Bilans.logic.svelte';
  import './Bilans.css';
  import BottomNav from '$lib/components/BottomNav.svelte';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-bilans" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

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
        <h1 style="margin:0;font-size:34px;font-weight:900;letter-spacing:-0.03em;line-height:1.05">Mes bilans</h1>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4.5" width="14" height="16" rx="2.5"></rect><path d="M9 4.5v-1h6v1"></path><path d="M9 13l2.2 2.2L15.5 11"></path></svg>
      </div>
      <p style="margin:10px 0 0;font-size:15px;line-height:1.45;color:#66716B">2 bilans envoyés · 2 avec retour de ton coach</p>
      <button class="press" style="margin-top:18px;height:54px;padding:0 26px;border-radius:27px;border:0;background:#1db954;color:#FFFFFF;font-size:15px;font-weight:900;letter-spacing:.05em;display:inline-flex;align-items:center;gap:10px;box-shadow:0 16px 30px -12px rgba(23,163,73,.65)">
        REMPLIR LA SEMAINE
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
      </button>
    </div>

    <div style="padding:24px 20px 0">
      <div style="border-radius:28px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.2);overflow:hidden">
        <div style="padding:20px 20px 18px">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px">
            <span style="font-size:20px;font-weight:900;letter-spacing:-0.02em">S39 - 21 sept. 2026</span>
            <span style="font-size:11px;font-weight:900;letter-spacing:.08em;color:#0d7c36;background:#e8fef0;border-radius:12px;padding:6px 11px">RETOUR REÇU</span>
          </div>
          <div style="margin-top:6px;font-size:14px;color:#66716B">Envoyé le 25 sept. à 13:06</div>
        </div>
        <div style="padding:6px 20px 12px;border-top:1px solid #EEF1EF;background:#FBFCFB">
          {#each v.fields as f}
            <div style="padding:14px 0;border-top:{f.border}">
              <div style="font-size:11px;font-weight:900;letter-spacing:.1em;color:#66716B">{f.label}</div>
              <div style="margin-top:4px;font-size:17px;font-weight:700;line-height:1.35;color:#0F1512">{f.value}</div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;height:140px;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 66%);pointer-events:none"></div>

  <BottomNav variant="C" />
</div>
