<script lang="ts">
  import '@fontsource/lato/400.css';
  import '@fontsource/lato/700.css';
  import '@fontsource/lato/900.css';
  import '$lib/styles/tokens.css';
  import '$lib/styles/dc-base.css';
  import '$lib/styles/app.css';
  import { page } from '$app/state';
  import Stage from '$lib/components/Stage.svelte';

  let { children } = $props();
  const isScreen = $derived(!!page.params.slug);
</script>

{#if isScreen}
  <Stage>{@render children()}</Stage>
{:else}
  {@render children()}
{/if}
