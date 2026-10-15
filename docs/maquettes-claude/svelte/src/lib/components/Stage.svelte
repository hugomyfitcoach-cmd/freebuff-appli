<script lang="ts">
  /**
   * Cadre d'affichage responsive d'un écran (390 × 844 d'origine).
   * - Mobile / PWA (largeur ≤ 640 px) : l'écran occupe toute la fenêtre. Il est mis à l'échelle
   *   proportionnellement à la largeur (jamais déformé) et sa hauteur s'adapte à la fenêtre.
   * - Bureau : écran 390 × 844 centré dans un cadre, mis à l'échelle si la fenêtre est trop basse,
   *   avec la liste des écrans à gauche.
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { screens } from '$lib/screens/registry';

  let { children } = $props();
  const BASE_W = 390;
  const BASE_H = 844;
  const MOBILE_MAX = 640;

  let vw = $state(BASE_W);
  let vh = $state(BASE_H);

  function measure() {
    vw = window.innerWidth;
    vh = window.visualViewport?.height ?? window.innerHeight;
  }
  onMount(() => {
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  });

  const mobile = $derived(vw <= MOBILE_MAX);
  // Mobile : échelle selon la largeur ; bureau : échelle selon la hauteur disponible.
  const scale = $derived(mobile ? Math.min(vw / BASE_W, 1.15) : Math.min(1, (vh - 48) / BASE_H));
  const artH = $derived(mobile ? Math.max(Math.round(vh / scale), 640) : BASE_H);
  const left = $derived(mobile ? Math.max(0, (vw - BASE_W * scale) / 2) : 0);

  const index = $derived(screens.findIndex((s) => s.slug === page.params.slug));
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'ArrowRight' && index < screens.length - 1) goto('/' + screens[index + 1].slug);
    if (e.key === 'ArrowLeft' && index > 0) goto('/' + screens[index - 1].slug);
  }
  const groups = ['Principal', 'Journal', 'Progression', 'Outils', 'Compte'];
</script>

<svelte:window onkeydown={onKey} />

{#if mobile}
  <div class="stage-mobile">
    <div
      class="artboard"
      style="position:absolute;top:0;left:{left}px;width:{BASE_W}px;height:{artH}px;transform:scale({scale});transform-origin:0 0;--gf-w:{BASE_W}px;--gf-h:{artH}px;"
    >
      {@render children()}
    </div>
  </div>
{:else}
  <div class="stage-desktop">
    <aside>
      <a class="brand" href="/"><img src="/assets/lockup-header.png" alt="G-FLUX" height="26" /></a>
      {#each groups as g}
        <h3>{g}</h3>
        {#each screens.filter((s) => s.group === g) as s}
          <a class="item" href={'/' + s.slug} aria-current={s.slug === page.params.slug ? 'page' : undefined}>{s.label}</a>
        {/each}
      {/each}
    </aside>
    <main>
      <div class="device" style="width:{BASE_W * scale}px;height:{BASE_H * scale}px;border-radius:{44 * scale}px;">
        <div
          class="artboard"
          style="width:{BASE_W}px;height:{BASE_H}px;transform:scale({scale});transform-origin:0 0;--gf-w:{BASE_W}px;--gf-h:{BASE_H}px;"
        >
          {@render children()}
        </div>
      </div>
    </main>
  </div>
  <div class="hint">← → : écran précédent / suivant</div>
{/if}
