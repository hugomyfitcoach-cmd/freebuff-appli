<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { form, data } = $props();
	const next = $derived(String(data?.next ?? ''));
</script>

<svelte:head><title>Connexion — G-Flux</title></svelte:head>

<main class="grid min-h-screen place-items-center px-4 py-10">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<img src="/logo-header.jpg" alt="G-Flux" class="mx-auto mb-4 h-11 w-auto" />
			<h1 class="font-display text-2xl font-semibold text-ink">Bienvenue</h1>
			<p class="mt-1 text-sm text-mist">Connecte-toi pour accéder à ton suivi.</p>
		</div>

		{#if form?.error}
			<div class="mb-4 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger-light px-4 py-3 text-sm text-danger"><Icon name="triangleAlert" size={16} class="shrink-0" /> {form.error}</div>
		{/if}

		<form method="POST" action="?/login" class="rounded-2xl border border-line bg-card p-6 shadow-sm">
			<input type="hidden" name="next" value={next} />
			<label for="email" class="mb-1.5 block text-sm font-semibold text-ink">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				required
				autocomplete="email"
				value={form?.email ?? ''}
				class="mb-4 w-full rounded-xl border-2 border-line bg-white px-4 py-2.5 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
			/>
			<label for="password" class="mb-1.5 block text-sm font-semibold text-ink">Mot de passe</label>
			<input
				id="password"
				name="password"
				type="password"
				required
				autocomplete="current-password"
				class="w-full rounded-xl border-2 border-line bg-white px-4 py-2.5 text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
			/>
			<button
				type="submit"
				class="mt-5 w-full rounded-xl bg-brand px-4 py-3 font-display font-semibold uppercase tracking-wide text-white transition hover:bg-brand-dark"
			>Se connecter</button>
		</form>

		<div class="mt-5 rounded-xl border border-dashed border-line bg-card/60 px-4 py-3 text-center text-xs leading-relaxed text-mist">
			Ton identifiant et ton mot de passe t'ont été envoyés par ta coach.
			<br />Après connexion, tu arrives directement sur ton espace de suivi.
		</div>
	</div>
</main>
