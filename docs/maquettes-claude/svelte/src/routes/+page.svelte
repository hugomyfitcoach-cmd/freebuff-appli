<script lang="ts">
  import { screens } from '$lib/screens/registry';
  const groups = ['Principal', 'Journal', 'Progression', 'Outils', 'Compte'];
</script>

<svelte:head><title>G-FLUX · 35 écrans Svelte</title></svelte:head>

<main class="index">
  <header>
    <img src="/assets/lockup-header.png" alt="G-FLUX" height="34" />
    <h1>35 écrans · Svelte 5 / SvelteKit 2</h1>
    <p>
      Conversion visuelle des maquettes validées. Données fictives conservées pour la prévisualisation.
      Les boutons de navigation fonctionnent d'un écran à l'autre ; touches ← → pour passer à l'écran précédent / suivant.
    </p>
    <p class="start"><a class="cta" href="/home">Ouvrir l'accueil</a></p>
  </header>

  {#each groups as g}
    <section>
      <h2>{g}</h2>
      <ul>
        {#each screens.filter((s) => s.group === g) as s}
          <li>
            <a href={'/' + s.slug}>
              <img src={'/thumbs/' + s.slug + '.png'} alt="" loading="lazy" width="195" height="422" />
              <span>{s.label}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</main>
