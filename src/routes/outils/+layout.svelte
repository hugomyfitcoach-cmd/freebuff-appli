<script lang="ts">
	import AppShell from '$lib/components/AppShell.svelte';

	let { children, data } = $props();
</script>

<svelte:head><title>Outils &amp; calibrage — G-Flux</title></svelte:head>

<AppShell role={data.user.role} user={data.user} contentWidth="full">
	{@render children()}
</AppShell>