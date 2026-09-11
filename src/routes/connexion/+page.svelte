<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { form, data } = $props();
	const next = $derived(String(data?.next ?? ''));

	/** Fonctionnalités G-FLUX réelles présentées dans le carrousel. */
	const cards = [
		{ name: 'Nutrition', icon: 'salad', accent: 'top-4 left-3' },
		{ name: 'Journal', icon: 'notebook', accent: 'top-6 right-4' },
		{ name: 'Progression', icon: 'chartLine', accent: 'top-4 right-3' },
		{ name: 'Bilans', icon: 'clipboardCheck', accent: 'bottom-4 left-4' },
		{ name: 'Recettes', icon: 'chefHat', accent: 'top-5 left-4' },
		{ name: 'Cycle', icon: 'moon', accent: 'top-4 right-4' },
		{ name: 'Drive', icon: 'cloud', accent: 'bottom-5 right-4' },
		{ name: 'Pas', icon: 'footprints', accent: 'top-5 right-3' },
		{ name: 'Poids', icon: 'scale', accent: 'top-4 left-4' },
		{ name: 'Calories', icon: 'flame', accent: 'top-5 right-4' },
		{ name: 'Mensurations', icon: 'ruler', accent: 'bottom-4 right-5' }
	];

	let track: HTMLElement | undefined = $state();
	let active = $state(0);
	let showLogin = $state(false);

	const reducedMotion =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	function stepWidth() {
		const first = track?.firstElementChild as HTMLElement | null;
		return first ? first.offsetWidth + 12 : 1;
	}

	function onScroll() {
		if (!track) return;
		active = Math.max(0, Math.min(cards.length - 1, Math.round(track.scrollLeft / stepWidth())));
	}

	function goTo(i: number, smooth = true) {
		if (!track) return;
		const target = Math.max(0, Math.min(cards.length - 1, i));
		track.scrollTo({ left: target * stepWidth(), behavior: smooth ? 'smooth' : 'auto' });
	}

	/** Auto-défilement lent, en pause pendant l'interaction, désactivé si reduced-motion. */
	$effect(() => {
		if (!track || reducedMotion) return;
		let timer: ReturnType<typeof setTimeout>;
		let pauseUntil = 0;

		const advance = () => {
			if (Date.now() < pauseUntil) {
				timer = setTimeout(advance, 1200);
				return;
			}
			if (active >= cards.length - 1) {
				goTo(0, false);
			} else {
				goTo(active + 1, true);
			}
			timer = setTimeout(advance, 3200);
		};
		const onPointer = () => {
			pauseUntil = Date.now() + 7000;
		};
		const onVis = () => {
			clearTimeout(timer);
			if (!document.hidden) timer = setTimeout(advance, 1600);
		};

		track.addEventListener('pointerdown', onPointer);
		document.addEventListener('visibilitychange', onVis);
		timer = setTimeout(advance, 2600);

		return () => {
			clearTimeout(timer);
			track?.removeEventListener('pointerdown', onPointer);
			document.removeEventListener('visibilitychange', onVis);
		};
	});

	// Pagination intelligente : fenêtre de 5 points centrée sur la position réelle.
	const WINDOW = 5;
	const dotStart = $derived(
		Math.max(0, Math.min(active - Math.floor(WINDOW / 2), cards.length - WINDOW))
	);
	const dots = $derived(
		Array.from({ length: Math.min(WINDOW, cards.length) }, (_, i) => dotStart + i)
	);

	// Le formulaire s'ouvre automatiquement en cas d'erreur de connexion.
	$effect(() => {
		if (form?.error) showLogin = true;
	});

	// Focus du champ email à l'ouverture (le clic sur le CTA bloque l'autofocus natif).
	$effect(() => {
		if (!showLogin) return;
		const email = document.querySelector<HTMLInputElement>('#email');
		const t = setTimeout(() => email?.focus(), 60);
		return () => clearTimeout(t);
	});

	// Verrouille le scroll de fond quand le formulaire plein écran est ouvert.
	$effect(() => {
		if (showLogin) {
			document.documentElement.style.overflow = 'hidden';
			return () => {
				document.documentElement.style.overflow = '';
			};
		}
	});
</script>

<svelte:head><title>Connexion — G-Flux</title></svelte:head>

<main class="flex min-h-dvh flex-col bg-cream">
	<div class="mx-auto flex w-full max-w-md flex-1 flex-col px-5">
		<!-- Logo -->
		<header
			class="pt-[max(env(safe-area-inset-top),20px)]"
			aria-label="G-FLUX"
		>
			<img
				src="/logo-header.jpg"
				alt="G-FLUX™"
				class="mx-auto h-14 w-auto select-none"
				draggable="false"
			/>
		</header>

		<!-- Carrousel + pagination -->
		<div class="flex flex-1 flex-col justify-center pt-4 pb-12">
			<div
				bind:this={track}
				onscroll={onScroll}
				class="scrollable -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-[9%] py-2"
				role="region"
				aria-roledescription="carrousel"
				aria-label="Découvre G-FLUX"
			>
				{#each cards as card, i (card.name)}
					<article
						class="flex h-64 w-[72%] shrink-0 snap-center flex-col rounded-[28px] border border-line/70 bg-white p-4 transition-shadow duration-300 {active === i
							? 'shadow-[0_18px_40px_-16px_rgba(0,0,0,0.18)]'
							: 'shadow-[0_8px_24px_-16px_rgba(0,0,0,0.12)]'}"
						aria-roledescription="carte"
						aria-label={card.name}
					>
						<!-- Illustration -->
						<div class="relative flex flex-1 items-center justify-center">
							<div
								class="absolute h-24 w-24 rounded-full bg-gradient-to-br from-brand-light to-[#d3f3df] shadow-[inset_0_-6px_14px_rgba(23,163,73,0.12)]"
							></div>
							<div class="absolute rounded-full bg-brand/10 blur-xl h-20 w-20"></div>
							<div class="relative text-brand drop-shadow-sm">
								<Icon name={card.icon} size={52} />
							</div>
							<span
								class="absolute h-1.5 w-1.5 rounded-full bg-brand/35 {card.accent}"
								aria-hidden="true"
							></span>
							<span
								class="absolute right-3 bottom-6 h-1 w-1 rounded-full bg-brand/25"
								aria-hidden="true"
							></span>
						</div>

						<!-- Titre -->
						<h2 class="mt-3 text-center text-[17px] font-bold text-ink">{card.name}</h2>

						<!-- Chip icône -->
						<div class="mt-3 flex justify-center">
							<span class="flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand-light">
								<Icon name={card.icon} size={16} class="text-brand-dark" />
							</span>
						</div>
					</article>
				{/each}
			</div>

			<!-- Pagination -->
			<div class="mt-6 flex items-center justify-center gap-1.5" role="tablist" aria-label="Position du carrousel">
				{#each dots as d}
					<button
						type="button"
						aria-label={`Carte ${d + 1} sur ${cards.length}`}
						aria-current={d === active ? 'true' : undefined}
						onclick={() => goTo(d)}
						class="flex h-6 w-5 items-center justify-center"
					>
						<span
							class="block rounded-full transition-all duration-300 {d === active
								? 'h-2 w-5 bg-brand'
								: 'h-2 w-2 bg-line'}"
						></span>
					</button>
				{/each}
			</div>
		</div>

		<!-- CTA unique -->
		<footer class="pb-[max(env(safe-area-inset-bottom),28px)] pt-1">
			<button
				type="button"
				onclick={() => (showLogin = true)}
				class="relative w-full rounded-full bg-brand py-4 pl-6 pr-14 text-base font-bold text-white shadow-[0_14px_30px_-10px_rgba(29,185,84,0.55)] transition active:scale-[0.985]"
			>
				<span class="block text-center">Se connecter</span>
				<span
					class="absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/15"
				>
					<Icon name="arrowRight" size={18} />
				</span>
			</button>
		</footer>
	</div>
</main>

<!-- Écran plein : saisie des identifiants (logique d'authentification inchangée) -->
{#if showLogin}
	<div class="fixed inset-0 z-50 flex flex-col bg-cream">
		<div class="pt-[max(env(safe-area-inset-top),14px)]">
			<div class="flex items-center justify-between px-4">
				<span class="w-11"></span>
				<h1 class="text-sm font-bold uppercase tracking-wider text-ink">Connexion</h1>
				<button
					type="button"
					onclick={() => (showLogin = false)}
					class="flex h-11 w-11 items-center justify-center rounded-full text-mist transition hover:text-ink"
					aria-label="Fermer"
				>
					<Icon name="x" size={22} />
				</button>
			</div>
		</div>

		<div class="mx-auto w-full max-w-sm flex-1 overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),28px)] pt-8">
			<img
				src="/logo-header.jpg"
				alt="G-FLUX™"
				class="mx-auto mb-8 h-8 w-auto select-none"
				draggable="false"
			/>
			{#if form?.error}
				<div
					class="mb-4 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger-light px-4 py-3 text-sm text-danger"
				>
					<Icon name="triangleAlert" size={16} class="shrink-0" /> {form.error}
				</div>
			{/if}
			<form method="POST" action="?/login" class="rounded-2xl border border-line bg-card p-5 shadow-sm">
				<input type="hidden" name="next" value={next} />
				<label for="email" class="mb-1.5 block text-sm font-semibold text-ink">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					autofocus
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
					class="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3.5 font-bold text-white transition active:scale-[0.99]"
				>
					Se connecter
					<Icon name="arrowRight" size={18} />
				</button>
			</form>
		</div>
	</div>
{/if}