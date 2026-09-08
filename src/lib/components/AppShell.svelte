<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	type Role = 'client' | 'coach';
	type SessionUser = { prenom: string; email: string; role: Role };

	let {
		children,
		role,
		user,
		contentWidth = 'std',
		showFooter = false,
		badges = {},
	}: {
		children: Snippet;
		role: Role;
		user: SessionUser;
		contentWidth?: 'std' | 'wide' | 'full';
		showFooter?: boolean;
		badges?: { bilans?: number; progression?: number };
	} = $props();

	const path = $derived(page.url.pathname);

	type Link = { href: string; label: string; icon?: string; accent?: boolean; badge?: number };
	const links = $derived<Link[]>(
		role === 'client'
			? [
					{ href: '/espace', label: 'Accueil', icon: 'home' },
					{ href: '/espace/journal', label: 'Journal', icon: 'notebook' },
					{ href: '/espace/progression', label: 'Progression', icon: 'trendingUp', badge: badges.progression ?? 0 },
					{ href: '/espace/historique', label: 'Bilans', icon: 'clipboardCheck', badge: badges.bilans ?? 0 },
					{ href: '/recettes', label: 'Recettes & nutrition', icon: 'chefHat' },
					{ href: '/outils', label: 'Outils & calibrage', icon: 'wrench' },
				]
			: [
					{ href: '/admin', label: 'Tableau de bord', icon: 'chartBar' },
					{ href: '/recettes', label: 'Guide nutrition & recettes', icon: 'chefHat' },
					{ href: '/outils', label: 'Outils & calibrage', icon: 'wrench' },
				]
	);

	function isActive(link: Link): boolean {
		// Accueil = uniquement la page d'accueil ; chaque onglet met en avant sa propre section.
		if (link.href === '/espace') return path === '/espace';
		if (link.href === '/admin') return path === '/admin' || path.startsWith('/admin/');
		return path === link.href || path.startsWith(link.href + '/');
	}

	/** Onglets permanents de la barre mobile en bas (cliente).
	 *  Bilans & retours restent accessibles depuis l'Accueil quand ils sont pertinents. */
	const primaryLinks = $derived(
		role === 'client'
			? ([
					{ href: '/espace', label: 'Accueil', icon: 'home' },
					{ href: '/espace/journal', label: 'Journal', icon: 'notebook' },
					{ href: '/espace/progression', label: 'Progression', icon: 'trendingUp', badge: badges.progression ?? 0 },
				] as Link[])
			: []
	);

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
					{#if link.icon}<Icon name={link.icon} size={18} class="shrink-0" />{/if}
					<span class="flex-1">{link.label}</span>
					{#if link.badge && link.badge > 0}
						<span class="grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1 text-[11px] font-bold text-white">{link.badge}</span>
					{/if}
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
				</a>				<div class="flex items-center gap-2">
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
		</header>

		<main class={mainClass}>
			{@render children()}
		</main>

		{#if showFooter}
			<footer class="border-t border-line py-6 text-center text-xs text-mist">
				Suivi coaching <strong class="text-ink">G-Flux</strong> — pense à remplir ton bilan chaque fin de semaine
			</footer>
		{/if}

		<!-- Espace pour la barre de navigation mobile fixe (cliente) -->
		{#if role === 'client'}
			<div class="h-[calc(4rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" aria-hidden="true"></div>
		{/if}
	</div>

	<!-- Barre de navigation mobile fixe en bas (Accueil · Journal · Progression) -->
	{#if role === 'client' && primaryLinks.length > 0}
		<nav
			class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur md:hidden"
			aria-label="Navigation mobile"
			style="padding-bottom:env(safe-area-inset-bottom)"
		>
			<div class="mx-auto grid w-full max-w-md grid-cols-3">
				{#each primaryLinks as link (link.href)}
					<a
						href={link.href}
						class="relative flex flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-semibold transition {isActive(link) ? 'text-brand' : 'text-mist hover:text-ink'}"
					>
						<Icon name={link.icon ?? 'home'} size={23} strokeWidth={isActive(link) ? 2.3 : 2} />
						{link.label}
						{#if link.badge && link.badge > 0}
							<span class="absolute right-1/2 top-1 ml-3 grid h-4 min-w-4 translate-x-1/2 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold text-white">{link.badge}</span>
						{/if}
					</a>
				{/each}
			</div>
		</nav>
	{/if}
</div>
