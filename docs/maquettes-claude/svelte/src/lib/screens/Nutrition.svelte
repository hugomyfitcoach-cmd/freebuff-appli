<script lang="ts">
  import { Logic } from './Nutrition.logic.svelte';
  import './Nutrition.css';
  import BottomNav from '$lib/components/BottomNav.svelte';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-nutrition" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

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

  <div style="flex:1;min-height:0;overflow-y:auto;padding:0 0 150px">

    <div style="padding:24px 20px 0">
      <h1 style="margin:0;font-size:34px;font-weight:900;letter-spacing:-0.03em;line-height:1.05">Nutrition &amp; recettes</h1>
      <p style="margin:10px 0 0;font-size:15px;line-height:1.45;color:#66716B">Choisis une catégorie</p>
    </div>

    <div style="padding:26px 20px 0">
      <h2 style="margin:0;padding-bottom:12px;border-bottom:1px solid #EEF1EF;font-size:12px;font-weight:900;letter-spacing:.14em;color:#66716B">RECETTES</h2>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M10 5l2-2 2 2"></path><path d="M6.500 15a5.500 5.500 0 0 1 11 0"></path><path d="M3 18h18"></path><path d="M5 21h3M10.500 21h3M16 21h3"></path><path d="M4.500 10.500l1.500 1.200M19.500 10.500L18 11.700"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Petit-déjeuner</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">20</span>
        </a>

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.500 12.500h17a8.500 7.500 0 0 1-17 0Z"></path><path d="M7.500 12c-1.300-3 .5-5.500 3.500-5.500 1.500 0 2 1.200 3.500 1.200 2 0 3 1.500 2.500 4.300"></path><path d="M9.500 6.500C10 4.500 11.500 3.500 13.500 3.500c.8 0 1.500.3 2 .8"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Déjeuner</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">30</span>
        </a>

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.500A8.500 8.500 0 1 1 9.500 4a7 7 0 0 0 10.500 10.500Z"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Dîner</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">30</span>
        </a>

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.500 12.500A8.500 8.500 0 1 1 11.500 3.500a3.500 3.500 0 0 0 4 4 3 3 0 0 0 5 5Z"></path><path d="M8.500 9h.01M8 14h.01M13 15.500h.01M12.500 11h.01M16.500 16h.01" stroke-width="2.4"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Snacks</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">20</span>
        </a>

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20v-4.500h16V20Z"></path><path d="M6 15.500C6 11 8.500 8 12 8s6 3 6 7.500"></path><path d="M12 8V5"></path><path d="M8.500 18h7"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Desserts allégés</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">5</span>
        </a>
      </div>
    </div>

    <div style="padding:30px 20px 0">
      <h2 style="margin:0;padding-bottom:12px;border-bottom:1px solid #EEF1EF;font-size:12px;font-weight:900;letter-spacing:.14em;color:#66716B">ACCOMPAGNEMENTS</h2>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21V8"></path><path d="M12 3.500c1.300 1.500 1.300 3 0 4.500-1.300-1.500-1.300-3 0-4.500Z"></path><path d="M12 12c-3 0-4.500-1.800-4.500-4.500 3 0 4.500 1.800 4.500 4.500Z"></path><path d="M12 12c3 0 4.500-1.800 4.500-4.500-3 0-4.500 1.800-4.500 4.500Z"></path><path d="M12 16.500c-3 0-4.500-1.800-4.500-4.500 3 0 4.500 1.800 4.500 4.500Z"></path><path d="M12 16.500c3 0 4.500-1.800 4.500-4.500-3 0-4.500 1.800-4.500 4.500Z"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Féculents</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">15</span>
        </a>

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19C5 10.500 10 5 19.500 4.500 19.500 14 14.500 19 5 19Z"></path><path d="M5 19l9-9"></path><path d="M9.500 15H13M12 12.500h3"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Légumes &amp; épices</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">15</span>
        </a>
      </div>
    </div>

    <div style="padding:30px 20px 0">
      <h2 style="margin:0;padding-bottom:12px;border-bottom:1px solid #EEF1EF;font-size:12px;font-weight:900;letter-spacing:.14em;color:#66716B">GUIDES SPÉCIAUX</h2>
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.500 12h17a8.500 8 0 0 1-17 0Z"></path><path d="M9 20.500h6"></path><path d="M8.500 4.500c0 1.200 1 1.600 1 3M12 3.500c0 1.200 1 1.600 1 3M15.500 4.500c0 1.200 1 1.600 1 3"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Repas volume</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">10</span>
        </a>

        <a class="press" href="/recipes" style="display:flex;align-items:center;gap:14px;padding:12px 16px 12px 12px;border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -16px rgba(15,21,18,.18)">
          <span style="width:46px;height:46px;border-radius:15px;background:#F3F6F4;color:#0F1512;display:flex;align-items:center;justify-content:center;flex:none"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 11.500c0 5 2.500 7.500 6 9 3.500-1.500 6-4 6-9Z"></path><path d="M5 11.500c0-3.500 3-6 7-6s7 2.500 7 6Z"></path><path d="M12 5.500V3"></path><path d="M12 14v3"></path></svg></span>
          <span style="flex:1;font-size:17px;font-weight:700">Kéto</span>
          <span style="min-width:30px;box-sizing:border-box;text-align:center;font-size:14px;font-weight:900;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:6px 11px">15</span>
        </a>
      </div>
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;height:140px;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 66%);pointer-events:none"></div>

  <BottomNav variant="C" />
</div>
