<script lang="ts">
  import { Logic } from './Main.logic.svelte';
  import './Main.css';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-main screen" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

  <div style="padding:52px 20px 0;display:flex;align-items:center;justify-content:space-between">
    <button class="press" aria-label="Fermer" style="width:44px;height:44px;padding:0;border-radius:22px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -8px rgba(15,21,18,.14);display:flex;align-items:center;justify-content:center;color:#0F1512">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </button>
    <h1 style="margin:0;font-size:18px;font-weight:900;letter-spacing:-0.01em">Ajouter un aliment</h1>
    <div style="width:44px;height:44px"></div>
  </div>

  <label class="fld" style="margin:18px 20px 0;height:52px;box-sizing:border-box;padding:0 16px;border-radius:16px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 10px 28px -12px rgba(15,21,18,.14);display:flex;align-items:center;gap:10px">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#66716B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
    <input type="text" placeholder="Rechercher un produit…" aria-label="Rechercher un produit" style="flex:1;min-width:0;border:0;outline:0;background:transparent;font-size:16px;color:#0F1512">
  </label>

  <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 14px;overflow-x:auto">
    <button class="press" aria-label="Favoris" style="flex:none;width:44px;height:44px;padding:0;border-radius:22px;border:0;background:#F3F6F4;display:flex;align-items:center;justify-content:center;color:#4A5550">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"></path></svg>
    </button>
    <a class="press" href="/search" style="flex:none;height:44px;box-sizing:border-box;padding:0 18px;border-radius:22px;background:#F3F6F4;color:#3A4540;font-size:14px;font-weight:700;display:flex;align-items:center">Tous les produits</a>
    <button class="press" aria-pressed="true" style="flex:none;height:44px;padding:0 20px;border-radius:22px;border:0;background:#1db954;color:#FFFFFF;font-size:14px;font-weight:700;box-shadow:0 8px 18px -8px rgba(23,163,73,.55)">Repas</button>
    <a class="press" href="/foods" style="flex:none;height:44px;box-sizing:border-box;padding:0 18px;border-radius:22px;background:#F3F6F4;color:#3A4540;font-size:14px;font-weight:700;display:flex;align-items:center">Créés par moi</a>
  </div>

  <div style="flex:1;min-height:0;overflow-y:auto;padding:4px 20px 150px;display:flex;flex-direction:column;gap:8px">

    <a class="press" href="/meal-edit" style="display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:18px;background:#e8fef0;border:1px solid rgba(29,185,84,.3)">
      <span style="width:40px;height:40px;border-radius:20px;background:#1db954;color:#FFFFFF;display:flex;align-items:center;justify-content:center;flex:none">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
      </span>
      <span style="font-size:16px;font-weight:700;color:#0d7c36">Ajouter un nouveau repas</span>
    </a>

    {#each v.meals as item}
      <div class="li" style="display:flex;align-items:center;gap:11px;padding:8px 6px 8px 8px;border-radius:18px;background:#FFFFFF;border:1px solid #EEF1EF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 10px 22px -14px rgba(15,21,18,.16)">
        <div style="width:44px;height:44px;border-radius:12px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center;flex:none">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12h17a8.5 8 0 0 1-17 0Z"></path><path d="M9 20.5h6"></path><path d="M8.5 4.5c0 1.2 1 1.6 1 3M12 3.5c0 1.2 1 1.6 1 3M15.5 4.5c0 1.2 1 1.6 1 3"></path></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14.500px;font-weight:700;line-height:1.22;letter-spacing:-0.005em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">{item.name}</div>
          <div style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;column-gap:8px;row-gap:5px;font-size:13px;color:#66716B">
            <span style="font-size:13px;font-weight:700;color:#0d7c36">{item.kcal} kcal</span>
            <span>{item.meta}</span>
            {#if item.recipe}
              <span style="font-size:11px;font-weight:700;color:#0d7c36;background:#e8fef0;border-radius:8px;padding:3px 8px;letter-spacing:.01em">Recette G-FLUX</span>
            {/if}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:none">
          {#if item.editable}
            <a class="press" href="/meal-edit" aria-label="Modifier le repas" style="width:40px;height:40px;border-radius:12px;background:transparent;color:#4A5550;display:flex;align-items:center;justify-content:center">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"></path><path d="M13.5 8.5l3 3"></path></svg>
            </a>
          {/if}
          <button class="press" aria-label="Supprimer le repas" onclick={item.remove} style="width:40px;height:40px;padding:0;border-radius:12px;border:0;background:transparent;color:#4A5550;display:flex;align-items:center;justify-content:center">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"></path></svg>
          </button>
        </div>
      </div>
    {/each}
  </div>

  <div style="position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(to bottom,rgba(255,255,255,0),#FFFFFF 62%);pointer-events:none"></div>

  <nav aria-label="Mode d'ajout" style="position:absolute;left:20px;right:20px;bottom:28px;height:68px;box-sizing:border-box;padding:6px;border-radius:34px;background:#111A15;box-shadow:0 18px 40px -12px rgba(15,21,18,.55),0 2px 6px rgba(15,21,18,.2);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px">
    <button aria-current="true" style="border:0;border-radius:28px;background:rgba(255,255,255,.13);color:#FFFFFF;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:12px;font-weight:700;padding:0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
      Recherche
    </button>
    <a href="/scanner" style="border:0;border-radius:28px;background:transparent;color:rgba(255,255,255,.66);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:12px;font-weight:700;padding:0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6v12M7.5 6v12M11 6v12M14.5 6v12M18 6v12M20.5 6v12"></path></svg>
      Code-barres
    </a>
    <a href="/meal-ai" style="position:relative;border:0;border-radius:28px;background:transparent;color:rgba(255,255,255,.66);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:12px;font-weight:700;padding:0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4Z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
      Repas IA
      <span style="position:absolute;top:2px;right:12px;font-size:9px;font-weight:900;letter-spacing:.04em;color:#06361B;background:#1db954;border-radius:6px;padding:2px 5px">BÊTA</span>
    </a>
  </nav>
</div>
