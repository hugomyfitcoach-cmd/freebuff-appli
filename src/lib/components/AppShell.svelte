<script lang="ts">
	import { page, navigating } from '$app/state';
	import { invalidateAll, preloadCode, preloadData, goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import { noteSync } from '../navMemory';
	import { isStandalone } from '../pwa';

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
		badges?: { bilans?: number; retours?: number; message?: number; progression?: number };
	} = $props();

	const path = $derived(page.url.pathname);

	/* Rafraîchir : re-fetch NON destructif des données de la page (re-run des
	   load functions) — aucune saisie en cours n'est perdue. */
	let refreshing = $state(false);
	function refreshPage() {
		if (refreshing) return;
		refreshing = true;
		invalidateAll().finally(() => setTimeout(() => (refreshing = false), 500));
	}
	/* Journal : refresh ciblé (événement écouté par la page) — re-fetch du jour. */
	function refreshJournal() {
		if (refreshing) return;
		refreshing = true;
		window.dispatchEvent(new CustomEvent('gflux:journal-refresh'));
		setTimeout(() => (refreshing = false), 900);
	}

	/* Logo affiché uniquement là où il apporte de la valeur (Accueil + CRM).
	   Journal = vue nutrition PLEIN ÉCRAN : pas de header global (ni logo, ni
	   settings) — la date + Refresh forment la barre supérieure de la vue. */
	const showBrand = $derived(role === 'coach' || path === '/espace');
	/* Journal mobile : la vue gère elle-même sa barre de date (plein écran). */
	const journalFullScreen = $derived(role === 'client' && path === '/espace/journal');

	/* Menu utilisateur mobile : la déconnexion quitte le header principal. */
	let menuOpen = $state(false);
	/* G-FLUX lancée depuis son icône → installation confirmée sur cet appareil. */
	const installed = $derived(typeof window !== 'undefined' ? isStandalone() : false);
	function openInstallTutorial() {
		menuOpen = false;
		goto('/onboarding/install');
	}

	type Link = { href: string; label: string; icon?: string; accent?: boolean; badge?: number };
	/** Badge de l'Accueil = actions bilans + message du coach du jour non lu. */
	const homeBadge = $derived((badges.bilans ?? 0) + (badges.message ?? 0));

	const links = $derived<Link[]>(
		role === 'client'
			? [
					{ href: '/espace', label: 'Accueil', icon: 'home', badge: homeBadge },
					{ href: '/espace/journal', label: 'Journal', icon: 'notebook' },
					{ href: '/espace/progression', label: 'Progression', icon: 'trendingUp', badge: badges.progression ?? 0 },
					{ href: '/espace/messages', label: 'Messages', icon: 'messageCircle', badge: badges.message ?? 0 },
					{ href: '/espace/historique', label: 'Bilans & retours', icon: 'clipboardCheck', badge: badges.retours ?? 0 },
					{ href: '/espace/ressources', label: 'Ressources', icon: 'bookOpen' },
					{ href: '/recettes', label: 'Recettes & nutrition', icon: 'chefHat' },
					{ href: '/outils', label: 'Outils & calibrage', icon: 'wrench' },
				]
			: [
					{ href: '/admin', label: 'Tableau de bord', icon: 'chartBar' },
					{ href: '/admin/bilans', label: 'Bilans', icon: 'clipboardList' },
					{ href: '/admin/plans', label: 'Plans de repas', icon: 'utensils' },
					{ href: '/recettes', label: 'Guide nutrition & recettes', icon: 'chefHat' },
					{ href: '/outils', label: 'Outils & calibrage', icon: 'wrench' },
				]
	);

	function isActive(link: Link): boolean {
		// Pendant une navigation (même très courte), l'onglet cible s'active
		// immédiatement : feedback visuel instantané dès le tap.
		const target = navigating?.to?.url.pathname ?? path;
		// Accueil = uniquement la page d'accueil ; chaque onglet met en avant sa propre section.
		if (link.href === '/espace') return target === '/espace';
		if (link.href === '/admin') return target === '/admin'; // /admin/bilans a sa propre entrée
		return target === link.href || target.startsWith(link.href + '/');
	}

	/** Onglets permanents de la barre mobile en bas (cliente).
	 *  Bilans & retours restent accessibles depuis l'Accueil quand ils sont pertinents. */
	const primaryLinks = $derived(
		role === 'client'
			? ([
					{ href: '/espace', label: 'Accueil', icon: 'home', badge: homeBadge },
					{ href: '/espace/journal', label: 'Journal', icon: 'notebook' },
					{ href: '/espace/progression', label: 'Progression', icon: 'trendingUp', badge: badges.progression ?? 0 },
				] as Link[])
			: []
	);

	const mainClass = $derived(
		journalFullScreen
			? 'min-w-0 flex-1' /* plein écran : la page gère paddings/safe-area/max-width */
			: contentWidth === 'full'
				? 'min-w-0 flex-1'
				: contentWidth === 'wide'
					? 'mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6'
					: 'mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6'
	);

	/* ————— Préchargement des 3 onglets principaux —————
	   Au montage et à chaque changement d'onglet :
	   - chunks de TOUS les onglets inactifs (le JS est prêt au tap) ;
	   - données : le cache SvelteKit n'a QU'UNE SEULE entrée — on précharge la
	     destination la plus probable (l'onglet suivant dans la barre). Le tap
	     lui-même déclenche aussi un préchargement ciblé (preload-data="tap"). */
	const MAIN_TABS = ['/espace', '/espace/journal', '/espace/progression'] as const;
	function warmTabs() {
		const current = page.url.pathname;
		const others = MAIN_TABS.filter((r) => r !== current);
		for (const r of others) void preloadCode(r).catch(() => {});
		/* Données : la destination « la plus probable » — l'onglet suivant dans
		   la barre (Accueil → Journal → Progression → Accueil). */
		const idx = MAIN_TABS.indexOf(current as (typeof MAIN_TABS)[number]);
		const next = MAIN_TABS[(idx + 1) % MAIN_TABS.length] ?? others[0];
		void preloadData(next)
			.then(() => noteSync(next))
			.catch(() => {});
	}
	$effect(() => {
		if (typeof window === 'undefined') return;
		if (role !== 'client' || !page.url.pathname.startsWith('/espace')) return;
		warmTabs();
	});
	/* Après une invalidation (revalidation silencieuse), on re-précharge. */
	$effect(() => {
		if (typeof window === 'undefined') return;
		const onWarm = () => warmTabs();
		window.addEventListener('gflux:warm-tabs', onWarm);
		return () => window.removeEventListener('gflux:warm-tabs', onWarm);
	});
	/* Changement de journée (minuit / reprise de l'app) : on re-synchronise le
	   layout (dashboard, badges) et les données de la page — le préchargement
	   de la veille ne doit jamais servir de données du jour. */
	$effect(() => {
		if (typeof window === 'undefined') return;
		if (role !== 'client' || !page.url.pathname.startsWith('/espace')) return;
		const onDay = () => {
			void invalidateAll().then(() => warmTabs());
		};
		document.addEventListener('gflux:day-changed', onDay);
		return () => document.removeEventListener('gflux:day-changed', onDay);
	});
</script>

<div class="flex min-h-screen">
	<!-- Sidebar desktop -->
	<aside class="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-line bg-cream md:flex">
		<div class="flex items-center gap-3 border-b border-line px-5 py-4">
			<a href={role === 'coach' ? '/admin' : '/espace'} class="flex items-center gap-3">
				<img src="/logo-header.jpg" alt="G-Flux" class="h-9 w-auto" />
			</a>
			<span class="font-display text-xs font-semibold uppercase tracking-widest text-mist">
				{role === 'coach' ? 'CRM Coach' : 'Espace client'}
			</span>
		</div>

		<nav class="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Navigation principale">
			{#each links as link (link.href)}
				<a
					href={link.href}
					data-sveltekit-prefetch
					data-sveltekit-preload-data="hover"
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

	<div class="flex min-w-0 flex-1 flex-col md:pl-64 {role === 'client' ? 'bg-soft' : ''}">
		<!-- Barre mobile : logo (Accueil) + Rafraîchir + menu utilisateur.
		     Le Journal (vue plein écran) n'affiche AUCUN header global. -->
		{#if !journalFullScreen}
		<header class="sticky top-0 z-40 border-b border-line backdrop-blur md:hidden {role === 'client' ? 'bg-soft/90' : 'bg-cream/95'}">
			<div class="flex items-center justify-between gap-2 px-4 py-2">
				{#if showBrand}
					<a href={role === 'coach' ? '/admin' : '/espace'} class="flex items-center py-0.5" aria-label="Accueil G-FLUX">
						<img src="/logo-header.jpg" alt="G-Flux" class="h-auto w-[76px]" />
					</a>
				{/if}
				<div class="ml-auto flex items-center gap-1">
					{#if role === 'client'}
						<button
							type="button"
							onclick={path === '/espace/journal' ? refreshJournal : refreshPage}
							class="grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-line/40 active:scale-95"
							title={path === '/espace/journal' ? 'Recharger la journée' : 'Actualiser les données'}
							aria-label={path === '/espace/journal' ? 'Recharger la journée' : 'Actualiser les données'}
						>
							<Icon name="refreshCw" size={18} class={refreshing ? 'animate-spin' : ''} />
						</button>
					{/if}
					<div class="relative">
						<button
							type="button"
							onclick={() => (menuOpen = !menuOpen)}
							class="grid h-10 w-10 place-items-center rounded-full border-2 border-line text-ink transition active:scale-95"
							aria-label="Menu utilisateur"
							aria-expanded={menuOpen}
						>
							<Icon name="settings" size={18} />
						</button>
						{#if menuOpen}
							<!-- Fond transparent : un tap ailleurs referme le menu -->
							<button type="button" class="fixed inset-0 z-40 cursor-default" aria-label="Fermer le menu" onclick={() => (menuOpen = false)}></button>
						<div class="absolute right-0 top-12 z-50 w-60 rounded-2xl border border-line bg-card p-2 shadow-xl shadow-ink/10">
							<div class="border-b border-line/70 px-3 py-2.5">
								<p class="truncate text-sm font-bold text-ink">{user.prenom}</p>
								<p class="truncate text-xs text-mist">{user.email}</p>
							</div>
							{#if role === 'client'}
								<button
									type="button"
									onclick={openInstallTutorial}
									class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink transition hover:bg-soft"
								>
									<Icon name="smartphone" size={16} class="shrink-0" />
									{#if installed}
										<span class="flex-1 text-left">G-FLUX est installée</span>
										<Icon name="circleCheck" size={16} class="text-brand" />
									{:else}
										<span class="flex-1 text-left">Installer G-FLUX</span>
										<Icon name="chevronRight" size={16} class="text-mist" />
									{/if}
								</button>
							{/if}
							<form method="POST" action="/connexion?/logout" class="pt-1.5">
									<button
										type="submit"
										class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger-light"
									>
										<Icon name="logOut" size={16} class="shrink-0" />
										Déconnexion
									</button>
								</form>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</header>
		{/if}

		<main class={mainClass}>
			{@render children()}
		</main>				{#if showFooter}
			<footer class="px-4 pb-6 pt-2 text-center text-[11px] text-mist/80">
				© 2026 G-FLUX — Tous droits réservés
			</footer>
		{/if}

		<!-- Espace pour la barre flottante mobile (cliente) — jamais de contenu masqué -->
		{#if role === 'client'}
			<div class="h-[calc(5.25rem+env(safe-area-inset-bottom))] shrink-0 md:hidden" aria-hidden="true"></div>
		{/if}
	</div>

	<!-- Barre de navigation mobile FLOTTANTE (Accueil · Journal · Progression) :
	     capsule arrondie, centrée, au-dessus de la safe-area — jamais collée au bord. -->
	{#if role === 'client' && primaryLinks.length > 0}
		<nav
			class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 md:hidden"
			aria-label="Navigation mobile"
			style="padding-bottom:calc(env(safe-area-inset-bottom) + 10px)"
		>
			<div class="pointer-events-auto flex w-full max-w-sm items-stretch justify-around rounded-full border border-line bg-white/95 p-1.5 shadow-lg shadow-ink/10 backdrop-blur">
				{#each primaryLinks as link (link.href)}
					{@const active = isActive(link)}
					<a
						href={link.href}
						data-sveltekit-prefetch
						data-sveltekit-preload-data="tap"
						class="relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-2 py-2 text-[11px] font-semibold transition
							{active ? 'bg-brand-light text-brand-dark' : 'text-mist hover:bg-soft hover:text-ink'}"
					>
						<Icon name={link.icon ?? 'home'} size={22} strokeWidth={active ? 2.3 : 1.9} class="transition" />
						<span>{link.label}</span>
						{#if link.badge && link.badge > 0}
							<span class="absolute right-1/2 top-0.5 grid h-4 min-w-4 -translate-x-1/2 translate-x-3 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold text-white">{link.badge}</span>
						{/if}
					</a>
				{/each}
			</div>
		</nav>
	{/if}
</div>
