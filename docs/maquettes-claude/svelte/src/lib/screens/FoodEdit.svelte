<script lang="ts">
  import { Logic } from './FoodEdit.logic.svelte';
  import './FoodEdit.css';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-food-edit" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

  <div style="padding:52px 20px 0;display:flex;align-items:center;justify-content:space-between">
    <a class="press" href="/foods" aria-label="Retour à mes aliments" style="height:44px;box-sizing:border-box;padding:0 18px 0 10px;border-radius:22px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -8px rgba(15,21,18,.14);display:flex;align-items:center;gap:4px;font-size:15px;font-weight:700;color:#0F1512">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>
      Mes aliments
    </a>
    <span style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#66716B">Ajouter un aliment</span>
  </div>

  <div style="padding:22px 20px 0">
    <h1 style="margin:0;font-size:30px;font-weight:900;letter-spacing:-0.02em;line-height:1.1">Modifier l'aliment</h1>
    <p style="margin:8px 0 0;font-size:14px;line-height:1.45;color:#66716B">Saisis les valeurs pour 100 g : l'aliment sera ajouté à ta base.</p>
  </div>

  <div style="flex:1;min-height:0;overflow-y:auto;padding:18px 20px 130px;display:flex;flex-direction:column;gap:12px">

    <div style="display:flex;align-items:center;gap:14px;padding:14px;border-radius:20px;background:#FFFFFF;border:1px solid #EEF1EF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 28px -14px rgba(15,21,18,.16)">
      <div style="width:76px;height:76px;border-radius:20px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center;flex:none">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
      </div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:14px;font-weight:700">Photo de l'aliment <span style="font-weight:400;color:#66716B">(optionnel)</span></div>
        <button class="press" style="height:40px;border-radius:14px;border:0;background:#1db954;color:#FFFFFF;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;padding:0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
          Prendre une photo
        </button>
        <button class="press" style="height:40px;border-radius:14px;border:1px solid #E1E6E3;background:#FFFFFF;color:#0F1512;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;padding:0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2.5"></rect><circle cx="9" cy="10" r="1.5"></circle><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"></path></svg>
          Choisir dans la galerie
        </button>
      </div>
    </div>

    {#each v.textFields as f}
      <label class="fld" style="display:block;box-sizing:border-box;padding:11px 16px 12px;border-radius:18px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 10px 24px -14px rgba(15,21,18,.14)">
        <span style="display:block;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#66716B">{f.label} <span style="text-transform:none;letter-spacing:0;font-weight:400">{f.opt}</span></span>
        <input type="text" value={f.value} oninput={f.set} placeholder={f.placeholder} style="display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:0;border:0;outline:0;background:transparent;font-size:17px;font-weight:700;color:#0F1512">
      </label>
    {/each}

    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
      {#each v.numFields as n}
        <label class="fld" style="display:block;box-sizing:border-box;padding:11px 16px 12px;border-radius:18px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 10px 24px -14px rgba(15,21,18,.14);grid-column:{n.span}">
          <span style="display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#66716B">
            <span style="width:8px;height:8px;border-radius:4px;background:{n.dot};flex:none"></span>{n.label}
          </span>
          <span style="display:flex;align-items:baseline;gap:6px;margin-top:3px">
            <input type="text" inputmode="decimal" value={n.value} oninput={n.set} placeholder={n.placeholder} style="display:block;width:100%;min-width:0;box-sizing:border-box;padding:0;border:0;outline:0;background:transparent;font-size:19px;font-weight:900;color:#0F1512">
            <span style="font-size:13px;color:#66716B;flex:none">{n.unit}</span>
          </span>
          <span style="display:block;margin-top:2px;font-size:11px;color:#66716B">{n.opt}</span>
        </label>
      {/each}
    </div>
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;padding:34px 20px 30px;box-sizing:border-box;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 42%)">
    <a class="press" href="/foods" style="height:58px;border-radius:29px;background:#1db954;color:#FFFFFF;font-size:17px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 16px 30px -12px rgba(23,163,73,.65)">Enregistrer l'aliment</a>
  </div>
</div>
