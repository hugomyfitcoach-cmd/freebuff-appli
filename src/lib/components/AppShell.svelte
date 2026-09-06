<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	type Role = 'client' | 'coach';
	type SessionUser = { prenom: string; email: string; role: Role };

	let {
		children,
		role,
		user,
		contentWidth = 'std',
		showFooter = false,
	}: {
		children: Snippet;
		role: Role;
		user: SessionUser;
		contentWidth?: 'std' | 'wide' | 'full';
		showFooter?: boolean;
	} = $props();

	const path = $derived(page.url.pathname);

	type Link = { href: string; label: string; icon?: string; accent?: boolean };
	const links = $derived<Link[]>(
		role === 'client'
			? [
					{ href: '/espace', label: 'Mon suivi', icon: '📊' },
					{ href: '/espace/journal', label: 'Journal', icon: '📔' },
					{ href: '/espace/progression', label: 'Progression', icon: '📈' },
					{ href: '/espace/historique', label: 'Mes bilans', icon: '🗂️' },
					{ href: '/recettes', label: 'Recettes & nutrition', icon: '🍳' },
					{ href: '/outils', label: 'Outils & calibrage', icon: '🧰' },
				]
			: [
					{ href: '/admin', label: 'Tableau de bord', icon: '📋' },
					{ href: '/recettes', label: 'Guide nutrition & recettes', icon: '🍳' },
					{ href: '/outils', label: 'Outils & calibrage', icon: '🧰' },
				]
	);

	function isActive(link: Link): boolean {
		if (link.href === '/espace') return path === '/espace' || path.startsWith('/espace/');
		if (link.href === '/admin') return path === '/admin' || path.startsWith('/admin/');
		return path === link.href || path.startsWith(link.href + '/');
	}

	const mainClass = $derived(
		contentWidth === 'full'
			? 'min-w-0 flex-1'
			: contentWidth === 'wide'
				? 'mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6'
				: 'mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6'
	);
</script>

<div class="flex min-h-screen">
	<!-- Sidebar desktop -->
	<aside class="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-line bg-cream md:flex">
		<div class="flex items-center gap-3 border-b border-line px-5 py-4">
			<a href={role === 'coach' ? '/admin' : '/espace'} class="flex items-center gap-3">
				<img src="/logo-header.jpg" alt="G-Flux" class="h-8 w-auto" />
			</a>
			<span class="font-display text-xs font-semibold uppercase tracking-widest text-mist">
				{role === 'coach' ? 'CRM Coach' : 'Espace client'}
			</span>
		</div>

		<nav class="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Navigation principale">
			{#each links as link (link.href)}
				<a
					href={link.href}
					class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition
						{isActive(link) ? 'bg-ink text-white' : 'text-ink hover:bg-line/60'}"
				>
					{#if link.icon}<span class="text-base leading-none">{link.icon}</span>{/if}
					<span>{link.label}</span>
				</a>
			{/each}

			{#if role === 'client'}
				<div class="pt-3">
					<a
						href="/bilan"
						class="block rounded-xl bg-brand px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-brand-dark"
					>Bilan de la semaine →</a>
				</div>
			{/if}
		</nav>

		<div class="border-t border-line px-4 py-4">
			<div class="mb-3 truncate text-xs text-mist">
				Salut, <strong class="font-semibold text-ink">{user.prenom}</strong>
				<div class="truncate">{user.email}</div>
			</div>
			<form method="POST" action="/connexion?/logout">
				<button
					type="submit"
					class="w-full rounded-lg border-2 border-line px-3 py-2 text-sm font-semibold text-ink transition hover:border-danger hover:text-danger"
				>Déconnexion</button>
			</form>
		</div>
	</aside>

	<div class="flex min-w-0 flex-1 flex-col md:pl-64">
		<!-- Barre mobile -->
		<header class="sticky top-0 z-40 border-b border-line bg-cream/95 backdrop-blur md:hidden">
			<div class="flex items-center justify-between gap-2 px-4 py-2.5">
				<a href={role === 'coach' ? '/admin' : '/espace'} class="flex items-center gap-2">
					<img src="/logo-header.jpg" alt="G-Flux" class="h-7 w-auto" />
				</a>
				<div class="flex items-center gap-2">
					{#if role === 'client'}
						<a
							href="/bilan"
							class="rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white"
						>Bilan →</a>
					{/if}
					<form method="POST" action="/connexion?/logout">
						<button
							type="submit"
							class="rounded-lg border-2 border-line px-2.5 py-1.5 text-xs font-semibold text-ink"
						>Quitter</button>
					</form>
				</div>
			</div>
			<nav class="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Navigation mobile">
				{#each links as link (link.href)}
					<a
						href={link.href}
						class="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition
							{isActive(link) ? 'bg-ink text-white' : 'bg-line/50 text-ink'}"
					>{link.icon} {link.label}</a>
				{/each}
			</nav>
		</header>

		<main class={mainClass}>
			{@render children()}
		</main>

		{#if showFooter}
			<footer class="border-t border-line py-6 text-center text-xs text-mist">
				Suivi coaching <strong class="text-ink">G-Flux</strong> — pense à remplir ton bilan chaque fin de semaine 💪
			</footer>
		{/if}
	</div>
</div>
