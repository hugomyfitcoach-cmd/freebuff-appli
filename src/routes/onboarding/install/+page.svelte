<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { goto } from '$app/navigation';
	import {
		isStandalone,
		detectPlatform,
		detectBrowser,
		canNativeInstall,
		onNativeInstallChange,
		promptNativeInstall,
		markOnboardingSeenLocally,
	} from '$lib/pwa';
	import { invalidateAll } from '$app/navigation';

	/** Étapes : choix icône → choix appareil → tutoriel → fin. */
	type Step = 'ask' | 'device' | 'tutorial' | 'done';
	let step = $state<Step>('ask');
	let platform = $state<'ios' | 'android' | null>(null);

	// Détection douce : pré-sélection de la plateforme, jamais de blocage.
	const detected = $state({ platform: detectPlatform(), browser: detectBrowser() });
	const chromiumAndroid = $derived(
		platform === 'android' &&
			(detected.browser === 'chrome' || detected.browser === 'edge' || detected.browser === 'samsung')
	);

	// Disponibilité du prompt natif Android (peut arriver à tout moment).
	let nativeReady = $state(false);
	$effect(() => {
		nativeReady = canNativeInstall();
		return onNativeInstallChange((v) => (nativeReady = v));
	});

	/* Webview intégrée (WhatsApp/Instagram/Messenger/Gmail…) : les étapes
	   d'installation y sont impossibles → on demande d'ouvrir un vrai navigateur. */
	const inApp = $derived(detected.browser === 'inapp');

	/* ───── Actions ───── */

	async function persist(status: 'skipped' | 'tutorial_completed' | 'installed_confirmed', plat?: 'ios' | 'android') {
		try {
			await fetch('/api/users/pwa-install', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status, platform: plat }),
			});
		} catch {
			/* non bloquant : la cliente continue vers l'espace quoi qu'il arrive */
		}
		markOnboardingSeenLocally();
	}

	/** « Oui, j'ai déjà l'icône » → plus jamais de tutoriel auto, retour espace. */
	async function alreadyInstalled() {
		await persist('skipped');
		await finish();
	}

	/** « Je le ferai plus tard » → espace, non re-demandé dans cette session. */
	async function later() {
		await persist('skipped');
		await finish();
	}

	async function chooseDevice(p: 'ios' | 'android') {
		platform = p;
		step = 'tutorial';
	}

	/** Android : CTA d'installation native (beforeinstallprompt). */
	let installing = $state(false);
	async function nativeInstall() {
		if (installing) return;
		installing = true;
		const res = await promptNativeInstall();
		installing = false;
		if (res === 'accepted') {
			// appinstalled fera aussi le boulot ; on confirme ici pour être immédiat.
			await persist('installed_confirmed', 'android');
			step = 'done';
		}
		// dismissed / unavailable → la cliente reste sur le tutoriel manuel.
	}

	/** Fin du parcours → espace. */
	async function finish() {
		await invalidateAll();
		goto('/espace', { replaceState: true });
	}

	/* Standalone → l'app est déjà installée sur cet appareil : JAMAIS de
	   tutoriel (règle absolue, même après logout/re-login). On enregistre la
	   confirmation réelle et on retourne à l'espace. */
	$effect(() => {
		if (isStandalone()) {
			void persist('installed_confirmed').then(() => finish());
		}
	});

	/* ───── Contenus tutoriels ───── */

	type TutorialStep = { title: string; text: string; image?: string; alt?: string };

	const iosSteps: TutorialStep[] = [
		{
			title: 'Ouvre le lien dans Safari',
			text: `Ouvre g-flux dans le navigateur Safari sur ton iPhone.`,
			image: '/tuto/ios/etape-1.jpg',
			alt: 'Étape 1 — Ouvrir G-FLUX dans Safari',
		},
		{
			title: 'En bas, appuie sur Partager',
			text: 'Si tu ne vois pas Partager, appuie sur « … » en bas de l’écran puis sur « Partager ».',
			image: '/tuto/ios/etape-2.jpg',
			alt: 'Étape 2 — Accéder au bouton Partager',
		},
		{
			title: 'Choisis « Sur l’écran d’accueil »',
			text: 'Fais défiler la liste si besoin : l’option se trouve souvent après « Copier ».',
			image: '/tuto/ios/etape-3.jpg',
			alt: 'Étape 3 — Choisir Sur l’écran d’accueil',
		},
		{
			title: 'Appuie sur « Ajouter »',
			text: 'Active « Ouvrir comme app web » si l’option est proposée, puis confirme.',
			image: '/tuto/ios/etape-4.jpg',
			alt: 'Étape 4 — Confirmer avec Ajouter',
		},
	];

	const androidSteps: TutorialStep[] = [
		{
			title: 'Ouvre le lien dans Chrome',
			text: 'Depuis ton navigateur habituel (Chrome de préférence).',
			image: '/tuto/android/etape-1.jpg',
			alt: 'Étape 1 — Ouvrir G-FLUX dans Chrome',
		},
		{
			title: 'Appuie sur le menu « ⋮ »',
			text: 'En haut à droite dans Chrome. Une bannière d’installation peut aussi apparaître directement.',
			image: '/tuto/android/etape-2.jpg',
			alt: 'Étape 2 — Ouvrir le menu du navigateur',
		},
		{
			title: 'Choisis « Installer l’application »',
			text: 'Selon ton téléphone, l’option peut s’appeler « Ajouter à l’écran d’accueil ».',
			image: '/tuto/android/etape-3.jpg',
			alt: 'Étape 3 — Choisir Installer l’application',
		},
		{
			title: 'Confirme par « Installer » ou « Ajouter »',
			text: 'Une fenêtre de confirmation s’affiche : appuie pour continuer.',
			image: '/tuto/android/etape-4.jpg',
			alt: 'Étape 4 — Confirmer l’installation',
		},
	];

	const browserHint = $derived.by(() => {
		if (!platform) return null;
		const b = detected.browser;
		if (platform === 'ios') {
			if (b === 'inapp')
				return 'Tu es dans une app (WhatsApp, Instagram…) : ouvre G-FLUX dans Safari ou Chrome pour installer l’icône.';
			if (b === 'chrome-ios')
				return 'Tu es sur Chrome : si « Ajouter à l’écran d’accueil » est disponible dans Partager, tu peux l’utiliser. Sinon, ouvre le lien dans Safari.';
			return null;
		}
		if (b === 'inapp') return 'Tu es dans une app (WhatsApp, Instagram…) : ouvre G-FLUX dans Chrome pour installer l’icône.';
		if (b === 'samsung')
			return 'Sur Samsung Internet : ouvre le menu, puis choisis l’option permettant d’ajouter G-FLUX à l’écran d’accueil (le libellé peut varier).';
		if (b === 'firefox')
			return 'Sur Firefox : ouvre le menu puis cherche « Ajouter à l’écran d’accueil ». Tu peux aussi ouvrir le lien dans Chrome.';
		return null;
	});

	const stepNum = $derived(step === 'ask' ? 1 : step === 'device' ? 2 : 3);
</script>

<svelte:head><title>Installer G-FLUX</title></svelte:head>

<main class="min-h-dvh bg-cream">
	<div class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
		<!-- Logo -->
		<header class="pt-[max(env(safe-area-inset-top),20px)] text-center">
			<img src="/logo-header.jpg" alt="G-FLUX™" class="mx-auto h-10 w-auto select-none" draggable="false" />
		</header>

		<!-- Retour -->
		{#if step !== 'ask'}
			<div class="mt-3">
				<button
					type="button"
					onclick={() => (step === 'tutorial' ? (step = 'device') : (step = 'ask'))}
					class="flex h-10 items-center gap-1.5 rounded-full pl-1 pr-3 text-sm font-semibold text-ink transition hover:bg-line/50"
				>
					<Icon name="arrowLeft" size={18} /> Retour
				</button>
			</div>
		{/if}

		<div class="flex flex-1 flex-col justify-center py-6">
			{#if step === 'ask'}
				<!-- ÉCRAN 1 — G-FLUX déjà installée ? -->
				<h1 class="text-center text-[28px] font-bold leading-tight text-ink">G-FLUX déjà installée&nbsp;?</h1>
				<p class="mt-3 text-center text-[15px] leading-relaxed text-mist">
					Si l’icône G-FLUX est déjà sur ton écran d’accueil, ouvre-la directement.<br class="hidden sm:block" />
					Sinon, continue le tutoriel.
				</p>

				<div class="mt-8 space-y-3">
					<button
						type="button"
						onclick={alreadyInstalled}
						class="flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-left shadow-[0_10px_30px_-18px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
					>
						<span class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-light">
							<Icon name="smartphone" size={22} class="text-brand" />
						</span>
						<span class="flex-1 text-[17px] font-bold text-ink">Oui, j’ai déjà l’icône</span>
						<Icon name="chevronRight" size={20} class="text-mist" />
					</button>

					<button
						type="button"
						onclick={() => (step = 'device')}
						class="flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-left shadow-[0_10px_30px_-18px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
					>
						<span class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-light">
							<Icon name="download" size={22} class="text-brand" />
						</span>
						<span class="flex-1 text-[17px] font-bold text-ink">Non, je l’installe maintenant</span>
						<Icon name="chevronRight" size={20} class="text-mist" />
					</button>
				</div>

				<p class="mt-8 flex items-center justify-center gap-2 text-sm text-mist">
					<Icon name="clock" size={16} /> Installation en 1 minute
				</p>

				<button
					type="button"
					onclick={later}
					class="mx-auto mt-4 rounded-full px-4 py-2 text-sm font-semibold text-mist transition hover:text-ink"
				>
					Je le ferai plus tard
				</button>
			{:else if step === 'device'}
				<!-- ÉCRAN 2 — Choisis ton téléphone -->
				<h1 class="text-center text-[28px] font-bold leading-tight text-ink">Choisis ton téléphone</h1>
				<p class="mt-2 text-center text-[15px] text-mist">On adapte les étapes selon ton appareil.</p>

				<div class="mt-8 space-y-3">
					<button
						type="button"
						onclick={() => chooseDevice('ios')}
						class="flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-left shadow-[0_10px_30px_-18px_rgba(0,0,0,0.25)] transition active:scale-[0.99] {detected.platform === 'ios'
							? 'ring-2 ring-brand/40'
							: ''}"
					>
						<span class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-light">
							<Icon name="apple" size={22} class="text-brand" />
						</span>
						<span class="flex-1">
							<span class="block text-[17px] font-bold text-ink">J’ai un iPhone</span>
							{#if detected.platform === 'ios'}<span class="text-xs font-semibold text-brand">Recommandé pour toi</span>{/if}
						</span>
						<Icon name="chevronRight" size={20} class="text-mist" />
					</button>

					<button
						type="button"
						onclick={() => chooseDevice('android')}
						class="flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-left shadow-[0_10px_30px_-18px_rgba(0,0,0,0.25)] transition active:scale-[0.99] {detected.platform === 'android'
							? 'ring-2 ring-brand/40'
							: ''}"
					>
						<span class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-light">
							<Icon name="smartphone" size={22} class="text-brand" />
						</span>
						<span class="flex-1">
							<span class="block text-[17px] font-bold text-ink">J’ai un téléphone Android</span>
							{#if detected.platform === 'android'}<span class="text-xs font-semibold text-brand">Recommandé pour toi</span>{/if}
						</span>
						<Icon name="chevronRight" size={20} class="text-mist" />
					</button>
				</div>

				<p class="mt-8 flex items-center justify-center gap-2 text-sm text-mist">
					<Icon name="clock" size={16} /> 1 minute · une seule fois
				</p>
			{:else if step === 'tutorial'}
				<!-- ÉCRANS 3-4 — Tutoriel iPhone / Android -->
				<h1 class="text-center text-[26px] font-bold leading-tight text-ink">
					Installer G-FLUX sur {platform === 'ios' ? 'iPhone' : 'Android'}
				</h1>

				{#if inApp}
					<div class="mt-6 rounded-3xl bg-warn-light p-4 text-center text-sm font-semibold text-ink">
						<Icon name="info" size={18} class="mr-1.5 inline text-warn" />
						Tu es dans une app intégrée — {platform === 'ios' ? 'ouvre G-FLUX dans Safari ou Chrome' : 'ouvre G-FLUX dans Chrome'} pour installer l’icône.
					</div>
				{:else}
					<!-- Installation native Android (beforeinstallprompt) : parcours prioritaire -->
					{#if platform === 'android' && nativeReady}
						<div class="mt-6 rounded-3xl bg-white p-5 text-center shadow-[0_10px_30px_-18px_rgba(0,0,0,0.25)]">
							<p class="text-[15px] font-semibold text-ink">Ton téléphone peut installer G-FLUX directement.</p>
							<button
								type="button"
								onclick={nativeInstall}
								disabled={installing}
								class="mt-3 w-full rounded-full bg-brand py-3.5 text-base font-bold text-white shadow-[0_14px_30px_-10px_rgba(29,185,84,0.55)] transition active:scale-[0.985] disabled:opacity-60"
							>
								{installing ? 'Installation…' : 'Installer G-FLUX'}
							</button>
							<button type="button" onclick={() => nativeReady = false} class="mt-2 text-xs font-semibold text-mist">
								Voir les étapes manuelles
							</button>
						</div>
					{:else}
						<div class="mt-6 space-y-3">
							{#if browserHint}
								<div class="rounded-2xl bg-brand-light px-4 py-3 text-[13px] font-semibold leading-relaxed text-brand-dark">
									{browserHint}
								</div>
							{/if}

							{#each (platform === 'ios' ? iosSteps : androidSteps) as s, i}
								<div class="rounded-3xl bg-white p-4 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.25)]">
									<div class="flex gap-3">
										<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-light text-sm font-bold text-brand-dark">{i + 1}</span>
										<div>
											<p class="text-[15px] font-bold text-ink">{s.title}</p>
											<p class="mt-0.5 text-[13px] leading-relaxed text-mist">{s.text}</p>
										</div>
									</div>
									{#if s.image}
										<img
											src={s.image}
											alt={s.alt ?? ''}
											width={1122}
											height={1402}
											loading={i === 0 ? 'eager' : 'lazy'}
											draggable="false"
											class="mt-3 h-auto w-full select-none rounded-2xl"
										/>
									{/if}
								</div>
							{/each}

							{#if platform === 'ios'}
								<!-- Dépannage secondaire : option absente du menu Partager -->
								<details class="rounded-2xl bg-white/60 px-4 py-3 text-[13px] text-mist">
									<summary class="cursor-pointer font-semibold text-ink">Tu ne vois pas « Sur l’écran d’accueil »&nbsp;?</summary>
									<p class="mt-2 leading-relaxed">
						Fais défiler les actions, puis « Modifier les actions » → ajoute « Sur l’écran d’accueil ». Il apparaîtra ensuite dans la liste.
									</p>
								</details>
							{/if}
						</div>

						<button
							type="button"
							onclick={async () => {
								await persist('tutorial_completed', platform ?? undefined);
								step = 'done';
							}}
							class="mt-6 w-full rounded-full bg-brand py-4 text-base font-bold text-white shadow-[0_14px_30px_-10px_rgba(29,185,84,0.55)] transition active:scale-[0.985]"
						>
							C’est bon, j’ai installé l’icône
						</button>
					{/if}
				{/if}
			{:else}
				<!-- ÉCRAN 5 — Terminé -->
				<div class="flex flex-col items-center text-center">
					<span class="grid h-16 w-16 place-items-center rounded-full bg-brand-light">
						<Icon name="circleCheck" size={34} class="text-brand" />
					</span>
					<h1 class="mt-4 text-[26px] font-bold text-ink">C’est bon&nbsp;!</h1>
					<p class="mt-2 text-[15px] leading-relaxed text-mist">
						Retourne sur ton écran d’accueil et ouvre G-FLUX depuis son icône.<br />
						À la prochaine ouverture, tout sera prêt.
					</p>
					<button
						type="button"
						onclick={finish}
						class="mt-8 w-full rounded-full bg-brand py-4 text-base font-bold text-white shadow-[0_14px_30px_-10px_rgba(29,185,84,0.55)] transition active:scale-[0.985]"
					>
						J’ai terminé
					</button>
				</div>
			{/if}
		</div>

		<!-- Progression (3 étapes) -->
		{#if step !== 'done'}
			<div class="flex items-center justify-center gap-1.5 pb-[max(env(safe-area-inset-bottom),18px)]" aria-label="Étape {stepNum} sur 3">
				{#each [1, 2, 3] as n}
					<span class="block h-2 rounded-full transition-all {n === stepNum ? 'w-5 bg-brand' : 'w-2 bg-line'}"></span>
				{/each}
			</div>
		{:else}
			<div class="pb-[max(env(safe-area-inset-bottom),18px)]"></div>
		{/if}
	</div>
</main>
