<script lang="ts">
	/**
	 * TEMPLATES COACH (CRM) — V1 volontairement simple :
	 * sélection du template → champs → Générer → aperçu → Copier.
	 *
	 * Intègre pour cette V1 :
	 *  1. Close & Bienvenue (3 situations) ;
	 *  2. Récap démarrage ;
	 *  3. Relance bilan.
	 *
	 * Volontairement NON intégrés (mission) : « Bonne réception » et
	 * « Récap appel biweekly ». Pas d'IA, pas de préremplissage automatique
	 * depuis la fiche cliente. La logique de génération vit dans le module
	 * pur src/lib/coachTemplates.ts (aucune référence Virtuagym — G-FLUX est
	 * l'outil principal).
	 */
	import Icon from '$lib/components/Icon.svelte';
	import {
		genererClose,
		genererDemarrage,
		genererRelance,
		type CloseSituation,
	} from '$lib/coachTemplates';

	type TabKey = 'close' | 'demarrage' | 'relance';
	const TABS: { key: TabKey; label: string; icon: string }[] = [
		{ key: 'close', label: 'Close & bienvenue', icon: 'partyPopper' },
		{ key: 'demarrage', label: 'Récap démarrage', icon: 'rocket' },
		{ key: 'relance', label: 'Relance bilan', icon: 'bell' },
	];

	let tab = $state<TabKey>('close');

	/* ── Close & bienvenue ── */
	const CLOSE_SITUATIONS: { key: CloseSituation; label: string; hint: string }[] = [
		{ key: 'pendant', label: "Pendant l'appel — elle démarre maintenant", hint: 'Accès + mission avant la visio' },
		{ key: 'retour', label: 'Elle revient — lancement du démarrage', hint: 'Mail + date du 1er rendez-vous, sans expliquer l\u2019onboarding' },
		{ key: 'paiement', label: 'Paiement validé — instructions de démarrage', hint: 'Connexion, onboarding, visio' },
	];
	let closeSituation = $state<CloseSituation>('pendant');
	let closePrenom = $state('');
	let closeVisio = $state('');
	let closeJourRdv = $state('');

	/* ── Récap démarrage ── */
	let dPrenom = $state('');
	let dCalMin = $state('');
	let dCalMax = $state('');
	let dMaintenance = $state('');
	let dVitesse = $state('');
	let dPas = $state('');
	let dProteines = $state('');
	let dJ7 = $state('');
	let dNote = $state('');

	/* ── Relance bilan ── */
	let rPrenom = $state('');

	/* ── Aperçu / copie ── */
	let preview = $state('');
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	function generate() {
		if (tab === 'close') {
			preview = genererClose(closeSituation, {
				prenom: closePrenom,
				visio: closeVisio,
				jourRdv: closeJourRdv,
			});
		} else if (tab === 'demarrage') {
			preview = genererDemarrage({
				prenom: dPrenom,
				calMin: dCalMin,
				calMax: dCalMax,
				maintenance: dMaintenance,
				vitesse: dVitesse,
				pas: dPas,
				proteines: dProteines,
				j7: dJ7,
				note: dNote,
			});
		} else {
			preview = genererRelance(rPrenom);
		}
	}

	async function copyMessage() {
		if (!preview) return;
		try {
			await navigator.clipboard.writeText(preview);
		} catch {
			// Repli iOS/PWA : textarea hors écran + execCommand (comme le générateur d'origine).
			const ta = document.createElement('textarea');
			ta.value = preview;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		}
		copied = true;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 2500);
	}

	const showCloseVisio = $derived(closeSituation === 'pendant' || closeSituation === 'paiement');
	const showCloseRdv = $derived(closeSituation === 'retour');
</script>

<svelte:head><title>Templates — CRM G-Flux</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<header class="mb-5">
		<h1 class="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
			<Icon name="messageCircle" size={22} class="text-brand" /> Templates
		</h1>
		<p class="mt-0.5 text-sm text-mist">Génère tes messages en 30 secondes — sélection, champs, Copier.</p>
	</header>

	<!-- Sélecteur de template (style onglets du générateur) -->
	<nav class="mb-5 flex flex-wrap gap-2" aria-label="Choix du template">
		{#each TABS as t (t.key)}
			<button
				type="button"
				onclick={() => { tab = t.key; preview = ''; }}
				class="flex items-center gap-1.5 rounded-full border-2 px-4 py-2 text-sm font-bold transition {tab === t.key
					? 'border-brand bg-brand text-white'
					: 'border-line bg-white text-ink hover:border-brand'}"
			>
				<Icon name={t.icon} size={15} class="shrink-0" />
				{t.label}
			</button>
		{/each}
	</nav>

	<!-- ═══════════ CLOSE & BIENVENUE ═══════════ -->
	{#if tab === 'close'}
		<section class="rounded-2xl border border-line bg-card p-4 shadow-sm">
			<h2 class="mb-3 text-[11px] font-bold uppercase tracking-widest text-mist">Situation</h2>
			<div class="grid gap-2">
				{#each CLOSE_SITUATIONS as s (s.key)}
					<button
						type="button"
						onclick={() => (closeSituation = s.key)}
						class="flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition {closeSituation === s.key
							? 'border-brand bg-brand-light/60'
							: 'border-line bg-white hover:border-brand/50'}"
					>
						<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold {closeSituation === s.key ? 'bg-brand text-white' : 'bg-line text-mist'}">
							{CLOSE_SITUATIONS.indexOf(s) + 1}
						</span>
						<span class="min-w-0">
							<span class="block text-sm font-bold text-ink">{s.label}</span>
							<span class="block text-[11px] text-mist">{s.hint}</span>
						</span>
					</button>
				{/each}
			</div>
		</section>

		<section class="mt-4 rounded-2xl border border-line bg-card p-4 shadow-sm">
			<h2 class="mb-3 text-[11px] font-bold uppercase tracking-widest text-mist">Informations</h2>
			<label class="block">
				<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Prénom</span>
				<input type="text" bind:value={closePrenom} placeholder="Sophie" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
			</label>
			{#if showCloseVisio}
				<label class="mt-3 block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Jour et heure de la visio</span>
					<input type="text" bind:value={closeVisio} placeholder="ex : lundi 28 avril à 14h15" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
				</label>
			{/if}
			{#if showCloseRdv}
				<label class="mt-3 block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Jour idéal pour le premier rendez-vous</span>
					<input type="text" bind:value={closeJourRdv} placeholder="ex : lundi" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
				</label>
			{/if}
		</section>
	{/if}

	<!-- ═══════════ RÉCAP DÉMARRAGE ═══════════ -->
	{#if tab === 'demarrage'}
		<section class="rounded-2xl border border-line bg-card p-4 shadow-sm">
			<h2 class="mb-3 text-[11px] font-bold uppercase tracking-widest text-mist">Informations cliente</h2>
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Prénom</span>
					<input type="text" bind:value={dPrenom} placeholder="Sophie" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
				</label>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Objectif calorique MIN (kcal)</span>
					<input type="number" inputmode="numeric" bind:value={dCalMin} placeholder="1700" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand" />
				</label>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Objectif calorique MAX (kcal)</span>
					<input type="number" inputmode="numeric" bind:value={dCalMax} placeholder="1900" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand" />
				</label>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Maintenance calorique</span>
					<input type="number" inputmode="numeric" bind:value={dMaintenance} placeholder="2100" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand" />
				</label>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Vitesse de perte estimée (kg/sem)</span>
					<input type="text" inputmode="decimal" bind:value={dVitesse} placeholder="0,27" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand" />
				</label>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Objectif pas / jour</span>
					<input type="number" inputmode="numeric" bind:value={dPas} placeholder="8000" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand" />
				</label>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Protéines cibles (g/jour)</span>
					<input type="number" inputmode="numeric" bind:value={dProteines} placeholder="140" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand" />
				</label>
				<label class="block">
					<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Date appel J+7</span>
					<input type="text" bind:value={dJ7} placeholder="ex : lundi 28 avril à 10h" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
				</label>
			</div>
		</section>

		<section class="mt-4 rounded-2xl border border-line bg-card p-4 shadow-sm">
			<h2 class="mb-2 text-[11px] font-bold uppercase tracking-widest text-mist">Note personnalisée (optionnel)</h2>
			<p class="mb-2 rounded-xl bg-brand-light px-3 py-2 text-[11px] leading-relaxed text-brand-dark">
				Ajoute ici tout ce que tu veux inclure de spécifique à cette cliente — contexte particulier, ajustement, encouragement perso…
			</p>
			<textarea bind:value={dNote} rows="4" placeholder="Ex : Tu m'as dit que tu mangeais peu le matin — on va travailler ça en priorité…" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand"></textarea>
		</section>
	{/if}

	<!-- ═══════════ RELANCE BILAN ═══════════ -->
	{#if tab === 'relance'}
		<section class="rounded-2xl border border-line bg-card p-4 shadow-sm">
			<h2 class="mb-3 text-[11px] font-bold uppercase tracking-widest text-mist">Relance bilan manquant</h2>
			<label class="block">
				<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Prénom</span>
				<input type="text" bind:value={rPrenom} placeholder="Sophie" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
			</label>
		</section>
	{/if}

	<!-- Actions -->
	<div class="mt-5 flex gap-2">
		<button type="button" onclick={generate} class="flex-1 rounded-xl bg-brand px-4 py-3.5 text-sm font-bold text-white transition hover:bg-brand-dark">
			Générer le message →
		</button>
		<button
			type="button"
			onclick={copyMessage}
			disabled={!preview}
			class="rounded-xl border-2 border-brand px-4 py-3.5 text-sm font-bold text-brand transition hover:bg-brand hover:text-white disabled:opacity-40"
		>
			{copied ? '✅ Copié !' : 'Copier le message'}
		</button>
	</div>

	<!-- Aperçu (style générateur : bloc sombre, texte WhatsApp) -->
	{#if preview}
		<section class="mt-5 overflow-hidden rounded-2xl bg-ink shadow-lg">
			<div class="h-[3px] w-full bg-brand"></div>
			<div class="p-5">
				<p class="mb-3 text-[10px] font-bold uppercase tracking-widest text-brand">📱 Message prêt à copier</p>
				<p class="whitespace-pre-wrap text-[13.5px] leading-relaxed text-white/85">{preview}</p>
			</div>
		</section>
	{/if}
</div>
