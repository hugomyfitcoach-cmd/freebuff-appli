<script lang="ts">
  import { Logic } from './Search.logic.svelte';
  import './Search.css';

  const logic = new Logic({});
  const v: Record<string, any> = $derived(logic.renderVals());
</script>

<div class="s-search screen" style="width:var(--gf-w,390px);height:var(--gf-h,844px);box-sizing:border-box;background:#FFFFFF;display:flex;flex-direction:column;position:relative;overflow:hidden;color:#0F1512;font-family:'Lato',system-ui,sans-serif">

  <div style="padding:52px 20px 0;display:flex;align-items:center;justify-content:space-between">
    <a class="press" href="/journal" aria-label="Fermer" style="width:44px;height:44px;border-radius:22px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 8px 20px -8px rgba(15,21,18,.14);display:flex;align-items:center;justify-content:center;color:#0F1512">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </a>
    <h1 style="margin:0;font-size:18px;font-weight:900;letter-spacing:-0.01em">Ajouter un aliment</h1>
    <div style="width:44px;height:44px"></div>
  </div>

  <label class="fld" style="margin:18px 20px 0;height:52px;box-sizing:border-box;padding:0 16px;border-radius:16px;border:1px solid #E9EDEA;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 10px 28px -12px rgba(15,21,18,.14);display:flex;align-items:center;gap:10px">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#66716B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
    <input type="text" placeholder="Rechercher un produit…" aria-label="Rechercher un produit" style="flex:1;min-width:0;border:0;outline:0;background:transparent;font-size:16px;color:#0F1512">
  </label>

  <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 12px;overflow-x:auto">
    <button class="press" aria-label="Favoris" aria-pressed={v.favOn} onclick={v.toggleFav} style="flex:none;width:44px;height:44px;padding:0;border-radius:22px;border:0;background:{v.favBg};color:{v.favFg};display:flex;align-items:center;justify-content:center;box-shadow:{v.favShadow}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill={v.favFill} stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"></path></svg>
    </button>
    <button class="press" aria-pressed="true" style="flex:none;height:44px;padding:0 18px;border-radius:22px;border:0;background:#1db954;color:#FFFFFF;font-size:14px;font-weight:700;box-shadow:0 8px 18px -8px rgba(23,163,73,.55)">Tous les produits</button>
    <a class="press" href="/main" style="flex:none;height:44px;box-sizing:border-box;padding:0 20px;border-radius:22px;background:#F3F6F4;color:#3A4540;font-size:14px;font-weight:700;display:flex;align-items:center">Repas</a>
    <a class="press" href="/foods" style="flex:none;height:44px;box-sizing:border-box;padding:0 18px;border-radius:22px;background:#F3F6F4;color:#3A4540;font-size:14px;font-weight:700;display:flex;align-items:center">Créés par moi</a>
  </div>

  <div style="flex:1;min-height:0;overflow-y:auto;padding:4px 20px 150px">

    {#if v.showHabits}
      <div style="display:flex;align-items:baseline;justify-content:space-between;padding:6px 4px 12px">
        <h2 style="margin:0;font-size:12px;font-weight:900;letter-spacing:.12em;color:#66716B">TES ALIMENTS FRÉQUENTS</h2>
        <span style="font-size:13px;color:#66716B">tes habitudes</span>
      </div>
    {/if}

    <div class="li" style="border-radius:20px;border:1px solid #EEF1EF;background:#FFFFFF;box-shadow:0 1px 2px rgba(15,21,18,.04),0 12px 26px -16px rgba(15,21,18,.18);overflow:hidden">
      {#each v.items as p}
        <div style="position:relative;display:flex;align-items:center;gap:11px;padding:7px 6px 7px 10px;border-top:{p.border}"><a href="/food-detail" aria-label="Voir la fiche de {p.name}" style="position:absolute;left:0;top:0;bottom:0;right:56px;z-index:1"></a>
          {#if p.hasImg}
            <img src={p.img} alt="" style="width:44px;height:44px;border-radius:12px;object-fit:cover;flex:none;background:#F3F6F4">
          {/if}
          {#if p.noImg}
            <div style="width:44px;height:44px;border-radius:12px;background:#e8fef0;color:#1db954;display:flex;align-items:center;justify-content:center;flex:none">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 3v5.5a2.5 2.5 0 0 0 5 0V3"></path><path d="M8 3v6.5M8 11v10"></path><path d="M17 21V3c-2.5 1.2-3.5 4-3.5 8H17"></path></svg>
            </div>
          {/if}
          <div style="flex:1;min-width:0">
            <div style="font-size:14.500px;font-weight:700;line-height:1.22;letter-spacing:-0.005em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">{p.name}{#if p.verified}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1db954" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Produit vérifié" style="margin-left:6px;vertical-align:-1px"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>{/if}</div>
            <div style="margin-top:2px;font-size:12.500px;color:#66716B"><span style="font-size:13px;font-weight:700;color:#0d7c36">{p.kcal} kcal</span> · {p.meta}</div>
          </div>
          {#if p.hasHeart}
            <button class="press" aria-label="Ajouter aux favoris" onclick={p.toggle} style="position:relative;z-index:2;width:44px;height:44px;padding:0;border-radius:22px;border:0;background:transparent;color:{p.heartColor};display:flex;align-items:center;justify-content:center;flex:none">
              <svg width="24" height="24" viewBox="0 0 24 24" fill={p.heartFill} stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"></path></svg>
            </button>
          {/if}
          {#if p.noHeart}<div style="width:44px;flex:none"></div>{/if}
        </div>
      {/each}
    </div>
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
