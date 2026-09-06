<script lang="ts">
	import AppShell from '$lib/components/AppShell.svelte';

	let { children, data } = $props();
</script>

<svelte:head><title>Mon espace — G-Flux</title></svelte:head>

<AppShell role="client" user={data.user} contentWidth="std" showFooter>
	{@render children()}
</AppShell>
