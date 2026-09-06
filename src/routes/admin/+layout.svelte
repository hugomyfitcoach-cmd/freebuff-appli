<script lang="ts">
	import AppShell from '$lib/components/AppShell.svelte';

	let { children, data } = $props();
</script>

<svelte:head><title>CRM — G-Flux</title></svelte:head>

<AppShell role="coach" user={data.user} contentWidth="wide">
	{@render children()}
</AppShell>
