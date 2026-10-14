<script lang="ts">
  import { Logic } from './Recipes.logic.svelte';
  import './Recipes.css';
  import BottomNav from '$lib/components/BottomNav.svelte';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-recipes" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

  <div style="padding:52px 20px 0;display:flex;align-items:center;justify-content:space-between">
    <a class="press" href="/nutrition" aria-label="Retour à toutes les sections" style="height:44px;box-sizing:border-box;padding:0 18px 0 10px;border-radius:22px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -8px rgba(15,21,18,.14);display:flex;align-items:center;gap:4px;font-size:15px;font-weight:700;color:#0F1512">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>
      Toutes les sections
    </a>
    <span style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">GUIDE NUTRITION</span>
  </div>

  <div style="flex:1;min-height:0;overflow-y:auto;padding:0 0 150px">

    <div style="padding:24px 20px 0">
      <span style="display:inline-block;font-size:11px;font-weight:900;letter-spacing:.1em;color:#0d7c36;background:#e8fef0;border:1px solid rgba(29,185,84,.3);border-radius:14px;padding:7px 12px">105 RECETTES · 5 GUIDES</span>
      <h1 style="margin:14px 0 0;font-size:38px;font-weight:900;letter-spacing:-0.035em;line-height:1.05">Recettes</h1>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#66716B">Chaque recette est calibrée pour 1 personne · 1 portion. Protéines ciblées, déficit intelligent, préparation rapide.</p>
    </div>

    <div style="margin:22px 20px 0;padding:18px 6px;border-radius:24px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 16px 36px -18px rgba(15,21,18,.2);display:grid;grid-template-columns:repeat(4,minmax(0,1fr))">
      <div style="text-align:center"><div style="font-size:30px;font-weight:900;letter-spacing:-0.03em;color:#0d7c36">100</div><div style="margin-top:4px;font-size:10.5px;font-weight:700;letter-spacing:.08em;color:#66716B">RECETTES</div></div>
      <div style="text-align:center;border-left:1px solid #EEF1EF"><div style="font-size:30px;font-weight:900;letter-spacing:-0.03em;color:#0d7c36">5</div><div style="margin-top:4px;font-size:10.5px;font-weight:700;letter-spacing:.08em;color:#66716B">DESSERTS</div></div>
      <div style="text-align:center;border-left:1px solid #EEF1EF"><div style="font-size:30px;font-weight:900;letter-spacing:-0.03em;color:#0d7c36">30g+</div><div style="margin-top:4px;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:#66716B">PROT. MOY.</div></div>
      <div style="text-align:center;border-left:1px solid #EEF1EF"><div style="font-size:30px;font-weight:900;letter-spacing:-0.03em;color:#0d7c36">&lt;20'</div><div style="margin-top:4px;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:#66716B">PRÉPA MAX</div></div>
    </div>

    <div style="display:flex;gap:8px;padding:22px 20px 4px;overflow-x:auto">
      <button class="press" style="flex:none;height:46px;padding:0 10px 0 18px;border-radius:23px;border:1px solid #E9EDEA;background:#FFFFFF;color:#3A4540;font-size:13px;font-weight:900;letter-spacing:.06em;display:flex;align-items:center;gap:10px">PETIT-DÉJEUNER <span style="font-size:13px;letter-spacing:0;color:#0d7c36;background:#e8fef0;border-radius:12px;padding:4px 9px">20</span></button>
      <button class="press" aria-pressed="true" style="flex:none;height:46px;padding:0 10px 0 18px;border-radius:23px;border:0;background:#1db954;color:#FFFFFF;font-size:13px;font-weight:900;letter-spacing:.06em;display:flex;align-items:center;gap:10px;box-shadow:0 8px 18px -8px rgba(23,163,73,.55)">DÉJEUNER <span style="font-size:13px;letter-spacing:0;color:#0d7c36;background:#FFFFFF;border-radius:12px;padding:4px 9px">30</span></button>
      <button class="press" style="flex:none;height:46px;padding:0 10px 0 18px;border-radius:23px;border:1px solid #E9EDEA;background:#FFFFFF;color:#3A4540;font-size:13px;font-weight:900;letter-spacing:.06em;display:flex;align-items:center;gap:10px">DÎNER <span style="font-size:13px;letter-spacing:0;color:#0d7c36;background:#e8fef0;border-radius:12px;padding:4px 9px">30</span></button>
    </div>

    <div style="padding:22px 20px 0">
      <div style="display:flex;align-items:center;gap:12px;padding-bottom:14px">
        <span style="width:4px;height:20px;border-radius:2px;background:#1db954"></span>
        <h2 style="margin:0;font-size:12px;font-weight:900;letter-spacing:.12em;color:#3A4540">DÉJEUNER · 30 RECETTES · 1 PORTION</h2>
      </div>

      <div style="border-radius:28px;border:1px solid rgba(29,185,84,.3);background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.2);overflow:hidden">
        <div style="padding:20px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;font-weight:900;letter-spacing:.16em;color:#0d7c36">DJ-01</span>
            <button class="press" onclick={v.toggle} aria-label="Replier ou déplier la recette" aria-expanded={v.ariaOpen} style="width:36px;height:36px;padding:0;border-radius:18px;border:0;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate({v.chevRot});transition:transform .2s"><path d="M6 15l6-6 6 6"></path></svg>
            </button>
          </div>
          <h3 style="margin:8px 0 0;font-size:23px;font-weight:900;letter-spacing:-0.025em;line-height:1.2">Bowl poulet rôti quinoa épinards citron</h3>
          <div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:8px">
            <span style="border-radius:14px;background:#e8fef0;border:1px solid rgba(29,185,84,.3);padding:8px 13px;font-size:14px;color:#66716B"><strong style="color:#0d7c36;font-weight:900">443</strong> kcal</span>
            <span style="border-radius:14px;background:#e8fef0;border:1px solid rgba(29,185,84,.3);padding:8px 13px;font-size:14px;color:#66716B"><strong style="color:#0d7c36;font-weight:900">44.4g</strong> prot.</span>
            <span style="border-radius:14px;background:#F3F6F4;border:1px solid #E6EBE8;padding:8px 13px;font-size:14px;color:#66716B"><strong style="color:#0F1512;font-weight:900">39.3g</strong> glucides</span>
            <span style="border-radius:14px;background:#F3F6F4;border:1px solid #E6EBE8;padding:8px 13px;font-size:14px;color:#66716B"><strong style="color:#0F1512;font-weight:900">11.6g</strong> lipides</span>
          </div>
        </div>

        {#if v.open}
          <div style="padding:20px;border-top:1px solid #E6EBE8;background:#F7F9F8">
            <span style="display:inline-flex;align-items:center;gap:8px;border-radius:14px;background:#e8fef0;border:1px solid rgba(29,185,84,.3);padding:9px 14px;font-size:15px;font-weight:700;color:#0d7c36">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>20 min
            </span>
            <button class="press" style="margin-top:14px;width:100%;height:54px;border-radius:18px;border:1.5px solid #1db954;background:#e8fef0;color:#0d7c36;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.500 4.500L19 7.500"></path></svg>Dans Mes repas
            </button>

            <div style="margin-top:24px;font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">INGRÉDIENTS · 1 PORTION</div>
            <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
              {#each v.ingredients as g}
                <div style="display:flex;align-items:center;gap:12px;height:50px;box-sizing:border-box;padding:0 16px;border-radius:15px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 8px 18px -14px rgba(15,21,18,.2)">
                  <span style="width:8px;height:8px;border-radius:4px;background:#1db954;flex:none"></span>
                  <span style="flex:1;font-size:16px">{g.name}</span>
                  <span style="font-size:15px;font-weight:900;color:#0d7c36">{g.qty}</span>
                </div>
              {/each}
            </div>

            <div style="margin-top:26px;font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">PRÉPARATION</div>
            <div style="margin-top:14px;display:flex;flex-direction:column;gap:16px">
              {#each v.steps as s}
                <div style="display:flex;align-items:flex-start;gap:14px">
                  <span style="width:34px;height:34px;border-radius:17px;background:#e8fef0;border:1.5px solid rgba(29,185,84,.3);color:#0d7c36;font-size:14px;font-weight:900;display:flex;align-items:center;justify-content:center;flex:none">{s.n}</span>
                  <span style="padding-top:5px;font-size:16px;line-height:1.5;color:{s.color}">{s.text}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;height:140px;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 66%);pointer-events:none"></div>

  <BottomNav variant="C" />
</div>
