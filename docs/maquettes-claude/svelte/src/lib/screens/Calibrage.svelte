<script lang="ts">
  import { Logic } from './Calibrage.logic.svelte';
  import './Calibrage.css';
  import BottomNav from '$lib/components/BottomNav.svelte';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-calibrage" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

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
      <h1 style="margin:0;font-size:34px;font-weight:900;letter-spacing:-0.03em;line-height:1.05">Calibrage</h1>
      <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#66716B">Des outils bonus pour y voir plus clair : tracker juste, comprendre ton déficit et piloter ta semaine. Ils complètent ton plan G-Flux — ils ne le remplacent pas.</p>
    </div>

    <div style="padding:20px 20px 0;display:flex;flex-wrap:wrap;gap:8px">
      <button class="press" aria-pressed="true" style="height:44px;padding:0 18px;border-radius:22px;border:0;background:#1db954;color:#FFFFFF;font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;box-shadow:0 8px 18px -8px rgba(23,163,73,.55)">Cru
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"></path></svg>Cuit</button>
      <button class="press" style="height:44px;padding:0 18px;border-radius:22px;border:0;background:#F3F6F4;color:#3A4540;font-size:14px;font-weight:700">Calories invisibles</button>
      <button class="press" style="height:44px;padding:0 18px;border-radius:22px;border:0;background:#F3F6F4;color:#3A4540;font-size:14px;font-weight:700">Mes protéines</button>
      <button class="press" style="height:44px;padding:0 18px;border-radius:22px;border:0;background:#F3F6F4;color:#3A4540;font-size:14px;font-weight:700">Ma semaine</button>
      <button class="press" style="height:44px;padding:0 18px;border-radius:22px;border:0;background:#F3F6F4;color:#3A4540;font-size:14px;font-weight:700">Cyclage</button>
    </div>

    <div style="padding:18px 20px 0;display:flex;flex-direction:column;gap:16px">

      <div style="display:flex;gap:14px;padding:18px;border-radius:24px;border:1px solid #F6D5B4;background:#FFF5EA">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C2570C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;margin-top:1px"><path d="M12 4l9 16H3Z"></path><path d="M12 10v4M12 17v.5"></path></svg>
        <div style="font-size:15px;line-height:1.5;color:#3A2A18"><strong style="color:#ff9500;font-weight:900">L'erreur n°1 du tracking :</strong> peser cuit mais entrer le poids dans l'app comme si c'était cru (ou l'inverse). Sur le riz, ça peut fausser ta journée de 200 kcal.</div>
      </div>

      <div style="padding:22px 20px 22px;border-radius:28px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.2)">
        <div style="display:flex;align-items:center;gap:10px">
          <h2 style="margin:0;font-size:21px;font-weight:900;letter-spacing:-0.02em">Convertisseur cru</h2>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"></path></svg>
          <h2 style="margin:0;font-size:21px;font-weight:900;letter-spacing:-0.02em">cuit</h2>
        </div>
        <p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:#66716B">Choisis l'aliment, indique ce que tu as pesé : l'outil te donne l'équivalent et les calories réelles.</p>

        <div style="margin-top:20px;font-size:11px;font-weight:900;letter-spacing:.12em;color:#66716B">ALIMENT</div>
        <label class="fld" style="position:relative;margin-top:8px;display:block;height:56px;box-sizing:border-box;border-radius:18px;border:1px solid #E9EDEA;background:#F7F9F8">
          <select aria-label="Aliment" style="appearance:none;-webkit-appearance:none;width:100%;height:100%;box-sizing:border-box;padding:0 48px 0 18px;border:0;outline:0;background:transparent;border-radius:18px;font-size:17px;font-weight:700;color:#0F1512">
            <option>Riz blanc / basmati</option>
          </select>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#66716B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="position:absolute;right:18px;top:18px;pointer-events:none"><path d="M6 9l6 6 6-6"></path></svg>
        </label>

        <div style="margin-top:20px;font-size:11px;font-weight:900;letter-spacing:.12em;color:#66716B">J'AI PESÉ…</div>
        <div style="margin-top:8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
          <button class="press" onclick={v.pickRaw} aria-pressed={v.rawOn} style="height:54px;padding:0 6px;border-radius:18px;border:1.5px solid {v.rawBorder};background:{v.rawBg};color:{v.rawFg};font-size:14.5px;font-weight:700">Cru (avant cuisson)</button>
          <button class="press" onclick={v.pickCooked} aria-pressed={v.cookedOn} style="height:54px;padding:0 6px;border-radius:18px;border:1.5px solid {v.cookedBorder};background:{v.cookedBg};color:{v.cookedFg};font-size:14.5px;font-weight:700">Cuit (dans l'assiette)</button>
        </div>

        <label for="poids" style="display:block;margin-top:20px;font-size:11px;font-weight:900;letter-spacing:.12em;color:#66716B">POIDS PESÉ (G)</label>
        <div class="fld" style="margin-top:8px;height:56px;box-sizing:border-box;border-radius:18px;border:1px solid #E9EDEA;background:#F7F9F8">
          <input id="poids" type="text" inputmode="decimal" placeholder="ex. 100" style="width:100%;height:100%;box-sizing:border-box;padding:0 18px;border:0;outline:0;background:transparent;border-radius:18px;font-size:17px;font-weight:700;color:#0F1512">
        </div>
      </div>

      <div style="padding:22px 20px;border-radius:28px;border:1px solid rgba(29,185,84,.3);background:linear-gradient(180deg,#f3fcf7 0%,#FFFFFF 100%);box-shadow:0 1px 2px rgba(15,21,18,.04),0 18px 40px -18px rgba(15,21,18,.16)">
        <h2 style="margin:0;font-size:20px;font-weight:900;letter-spacing:-0.02em">À entrer dans ton app</h2>
        <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:#3A4540">Règle G-Flux : tracke toujours le <strong style="color:#0d7c36;font-weight:900">poids cru</strong> pour les féculents et les viandes. C'est la valeur de référence des bases de données (Ciqual, MyFitnessPal...). Si tu as pesé cuit, utilise le convertisseur ci-dessus pour retrouver le poids cru.</p>
      </div>

      <div style="text-align:center;font-size:12px;color:#9AA39E;padding:4px 0 0">© 2026 G-FLUX · Tous droits réservés</div>
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;height:140px;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 66%);pointer-events:none"></div>

  <BottomNav variant="C" />
</div>
