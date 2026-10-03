<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { form, data } = $props();
	const next = $derived(String(data?.next ?? ''));

	/**
	 * Switch « Espace coach / Espace client » — UX uniquement.
	 *
	 * L'authentification reste 100 % serveur (aucun changement ici) : le rôle
	 * RÉEL renvoyé par l'API après vérification email + mot de passe détermine
	 * la destination (`resolveNext` dans +page.server.ts) et `requireRole`
	 * protège chaque espace. Sélectionner « Espace coach » n'ouvre donc JAMAIS
	 * l'admin à une cliente : elle est automatiquement renvoyée vers son espace.
	 */
	type Space = 'coach' | 'client';
	let space = $state<Space>('coach');
	let showPassword = $state(false);
	let forgotHint = $state(false);
</script>

<svelte:head><title>Connexion — G-Flux</title></svelte:head>

<main
	class="relative flex min-h-dvh justify-center bg-[#f6f8f6] px-4"
	style="padding-top: max(env(safe-area-inset-top), 20px); padding-bottom: max(env(safe-area-inset-bottom), 20px)"
>
	<!-- ═══ Fond clair : formes vertes très discrètes (esprit mockup) ═══ -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
		<svg class="absolute -top-24 -left-28 h-[26rem] w-[26rem] text-brand/[0.07]" viewBox="0 0 400 400" fill="currentColor">
			<path d="M120 20 C 220 -20, 360 40, 380 150 C 395 240, 300 300, 200 320 C 90 340, 10 260, 20 160 C 27 90, 60 45, 120 20 Z" />
		</svg>
		<svg class="absolute -right-32 top-1/4 h-[30rem] w-[30rem] text-brand/[0.06]" viewBox="0 0 400 400" fill="currentColor">
			<path d="M230 10 C 330 30, 400 130, 390 230 C 380 330, 280 400, 180 380 C 80 360, 10 270, 30 170 C 50 70, 130 -10, 230 10 Z" />
		</svg>
		<svg class="absolute -bottom-28 -left-16 h-[22rem] w-[22rem] text-brand/[0.05]" viewBox="0 0 400 400" fill="currentColor">
			<path d="M200 20 C 290 40, 370 120, 360 210 C 350 300, 260 370, 160 350 C 60 330, 0 240, 20 150 C 40 60, 110 0, 200 20 Z" />
		</svg>
		<div class="absolute -top-24 left-1/3 h-80 w-80 rounded-full bg-brand/[0.05] blur-3xl"></div>
		<div class="absolute bottom-10 right-1/4 h-72 w-72 rounded-full bg-brand/[0.05] blur-3xl"></div>
		<div class="absolute left-[11%] top-[24%] h-3 w-3 rounded-full bg-brand/25"></div>
		<div class="absolute right-[13%] top-[62%] h-2.5 w-2.5 rounded-full bg-brand/20"></div>
		<div class="absolute bottom-[18%] left-[22%] h-2 w-2 rounded-full bg-brand/15"></div>
	</div>

	<!-- ═══ Carte de connexion (my-auto : centrée, mais 100 % scrollable si
	     le viewport est plus court — paysage iPhone, jamais rognée) ═══ -->
	<div class="relative my-auto w-full max-w-md">
		<div class="rounded-[28px] border border-line bg-white/95 p-6 shadow-[0_28px_80px_-32px_rgba(16,44,28,0.28)] backdrop-blur-sm sm:p-9">
			<!-- Logo -->
			<div class="mx-auto grid h-[74px] w-[74px] place-items-center rounded-full bg-brand-light shadow-[inset_0_-8px_18px_rgba(29,185,84,0.10)]">
				<img src="/icons/icon-192.png" alt="G-FLUX" class="h-11 w-11 select-none" draggable="false" />
			</div>

			<!-- Titre + sous-titre -->
			<h1 class="mt-5 text-center font-display text-[26px] font-black leading-tight tracking-tight text-ink sm:text-[30px]">Connexion à G-FLUX</h1>
			<p class="mt-2 text-center text-[15px] leading-snug text-mist">Accédez à votre espace coach ou à votre espace client.</p>

			<!-- Switch Espace coach / Espace client (UX — le rôle réel est décidé
			     par le serveur après connexion, cf. requireRole + resolveNext) -->
			<div class="mt-6 grid grid-cols-2 gap-1.5 rounded-2xl bg-soft p-1.5" role="group" aria-label="Choisir un espace">
				<button
					type="button"
					onclick={() => (space = 'coach')}
					aria-pressed={space === 'coach'}
					class="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-bold transition {space === 'coach'
						? 'bg-brand-light text-brand-deep shadow-sm ring-1 ring-brand/25'
						: 'text-mist hover:text-ink'}"
				>
					<Icon name="chartColumn" size={16} strokeWidth={2.4} /> Espace coach
				</button>
				<button
					type="button"
					onclick={() => (space = 'client')}
					aria-pressed={space === 'client'}
					class="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-bold transition {space === 'client'
						? 'bg-brand-light text-brand-deep shadow-sm ring-1 ring-brand/25'
						: 'text-mist hover:text-ink'}"
				>
					<Icon name="user" size={16} strokeWidth={2.4} /> Espace client
				</button>
			</div>

			<!-- Erreur serveur (identifiants invalides, etc.) -->
			{#if form?.error}
				<div class="mt-5 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger-light px-4 py-3 text-sm text-danger">
					<Icon name="triangleAlert" size={16} class="shrink-0" /> {form.error}
				</div>
			{/if}

			<!-- ═══ Formulaire (action serveur ?/login inchangée) ═══ -->
			<form method="POST" action="?/login" class="mt-6">
				<input type="hidden" name="next" value={next} />

				<label for="email" class="mb-1.5 block text-[13.5px] font-bold text-ink">Adresse e-mail</label>
				<div class="relative">
					<Icon name="mail" size={16} class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist" />
					<input
						id="email"
						name="email"
						type="email"
						required
						autofocus
						autocomplete="email"
						inputmode="email"
						autocapitalize="none"
						spellcheck="false"
						placeholder="votre@email.com"
						value={form?.email ?? ''}
						class="w-full rounded-xl border border-line bg-white py-3 pl-10 pr-3.5 text-[15px] text-ink outline-none transition placeholder:text-mist/70 focus:border-brand focus:ring-2 focus:ring-brand/15"
					/>
				</div>

				<label for="password" class="mb-1.5 mt-4 block text-[13.5px] font-bold text-ink">Mot de passe</label>
				<div class="relative">
					<Icon name="lock" size={16} class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist" />
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						required
						autocomplete="current-password"
						placeholder="Votre mot de passe"
						class="w-full rounded-xl border border-line bg-white py-3 pl-10 pr-11 text-[15px] text-ink outline-none transition placeholder:text-mist/70 focus:border-brand focus:ring-2 focus:ring-brand/15"
					/>
					<button
						type="button"
						onclick={() => (showPassword = !showPassword)}
						aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
						aria-pressed={showPassword}
						class="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-mist transition hover:bg-soft hover:text-ink"
					>
						<Icon name={showPassword ? 'eyeOff' : 'eye'} size={17} />
					</button>
				</div>

				<!-- Mot de passe oublié : le reset est un acte coach/support
				     (fonction existante), pas un flux self-service côté client. -->
				<div class="mt-2 flex justify-end">
					<button
						type="button"
						onclick={() => (forgotHint = !forgotHint)}
						aria-expanded={forgotHint}
						class="text-[13.5px] font-bold text-brand underline underline-offset-2 transition hover:text-brand-dark"
					>Mot de passe oublié ?</button>
				</div>
				{#if forgotHint}
					<p class="mt-2 flex items-start gap-1.5 rounded-lg bg-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink/80">
						<Icon name="info" size={13} class="mt-0.5 shrink-0 text-brand" />
						Contacte ton coach ou le support G-FLUX : un nouveau mot de passe peut être généré depuis l'espace coach.
					</p>
				{/if}

				<!-- CTA principal -->
				<button
					type="submit"
					class="group relative mt-5 w-full overflow-hidden rounded-full bg-brand py-4 pl-6 pr-16 text-[16.5px] font-black text-white shadow-[0_16px_34px_-12px_rgba(29,185,84,0.55)] transition hover:bg-brand-dark active:scale-[0.99]"
				>
					<span class="block text-center">Se connecter</span>
					<span class="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/20 transition group-hover:bg-white/30">
						<Icon name="arrowRight" size={18} />
					</span>
				</button>
			</form>

			<!-- Accès sécurisé -->
			<div class="mt-6 flex flex-col items-center gap-1 border-t border-line/70 pt-5 text-center">
				<p class="flex items-center gap-1.5 text-[13px] font-bold text-ink">
					<Icon name="lock" size={14} strokeWidth={2.4} /> Accès sécurisé
				</p>
				<p class="text-[12px] text-mist">Vos données personnelles restent protégées.</p>
			</div>
		</div>

		<!-- Signature de marque (PNG transparent, mission logo-header) -->
		<img src="/logo-header.png" alt="G-FLUX™" class="mx-auto mt-6 h-8 w-auto select-none opacity-70" draggable="false" />
	</div>
</main>
