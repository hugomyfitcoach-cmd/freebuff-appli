<script lang="ts">
  let { data } = $props();
  const Screen = $derived(data.Screen);
</script>

<svelte:head><title>{data.info.label} · G-FLUX</title></svelte:head>
{#key data.info.slug}
  <Screen />
{/key}
