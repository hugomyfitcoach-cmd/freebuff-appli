<script lang="ts">
	/**
	 * TEMPLATES COACH (CRM) — refonte premium (2 colonnes, esprit mockup).
	 * La LOGIQUE DE GÉNÉRATION reste celle de src/lib/coachTemplates.ts
	 * (genererClose / genererDemarrage / genererRelance) — aucune modification
	 * métier : mêmes fonctions, mêmes champs, même copie (avec repli iOS).
	 * Ajouts purement UI : catégories en chips, scénarios en cartes, aperçu
	 * éditable, réinitialisation, modèles sauvegardés en localStorage (front
	 * uniquement) et démo préremplie pour visualiser le rendu en Preview.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import {
		genererClose,
		genererDemarrage,
		genererRelance,
		type CloseSituation,
	} from '$lib/coachTemplates';

	type ScenarioKey = 'close' | 'demarrage' | 'relance';
	type CategoryKey = 'onboarding' | 'relance' | 'rdv' | 'motivation' | 'nutrition' | 'entrainement' | 'suivi' | 'divers';

	/* ── Catégories (chips du haut) — seules les 2 dotées d'un générateur réel
	   sont actives ; les autres restent visibles mais désactivées (« Bientôt »),
	   pour poser la taxonomie du mockup sans faux boutons. ── */
	const CATEGORIES: { key: CategoryKey; label: string; icon: string; active: boolean }[] = [
		{ key: 'onboarding', label: 'Onboarding', icon: 'partyPopper', active: true },
		{ key: 'relance', label: 'Relance bilan', icon: 'bell', active: true },
		{ key: 'rdv', label: 'Rendez-vous', icon: 'calendarDays', active: false },
		{ key: 'motivation', label: 'Motivation', icon: 'heart', active: false },
		{ key: 'nutrition', label: 'Nutrition', icon: 'utensils', active: false },
		{ key: 'entrainement', label: 'Entraînement', icon: 'dumbbell', active: false },
		{ key: 'suivi', label: 'Suivi & progression', icon: 'trendingUp', active: false },
		{ key: 'divers', label: 'Divers', icon: 'plus', active: false },
	];

	/** Scénarios réels par catégorie (mêmes générateurs qu'avant). */
	const SCENARIOS: Partial<Record<CategoryKey, { key: ScenarioKey; emoji: string; label: string; hint: string }[]>> = {
		onboarding: [
			{ key: 'close', emoji: '👋', label: 'Accueillir une nouvelle cliente', hint: 'Message de bienvenue pour commencer l’accompagnement.' },
			{ key: 'demarrage', emoji: '🚀', label: 'Récap du démarrage', hint: 'Objectifs, repères et premières actions en un seul message.' },
		],
		relance: [
			{ key: 'relance', emoji: '🔔', label: 'Relancer un bilan manquant', hint: 'Rappel doux et motivant pour le bilan hebdo.' },
		],
	};

	const SCENARIO_LABEL: Record<ScenarioKey, string> = {
		close: 'Close & bienvenue',
		demarrage: 'Récap démarrage',
		relance: 'Relance bilan',
	};

	let category = $state<CategoryKey>('onboarding');
	let scenario = $state<ScenarioKey>('close');

	/* ── Close & bienvenue ── */
	const CLOSE_SITUATIONS: { key: CloseSituation; label: string; hint: string }[] = [
		{ key: 'pendant', label: "Pendant l'appel — elle démarre maintenant", hint: 'Accès + mission avant la visio' },
		{ key: 'retour', label: 'Elle revient — lancement du démarrage', hint: 'Mail + date du 1er rendez-vous, sans expliquer l\\u2019onboarding' },
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

	/* ── Aperçu / édition / copie ── */
	let preview = $state('');
	let editing = $state(false);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	function generate() {
		if (scenario === 'close') {
			preview = genererClose(closeSituation, {
				prenom: closePrenom,
				visio: closeVisio,
				jourRdv: closeJourRdv,
			});
		} else if (scenario === 'demarrage') {
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
		editing = false;
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

	/** Réinitialise les champs du scénario courant + l'aperçu. */
	function resetAll() {
		if (scenario === 'close') {
			closePrenom = '';
			closeVisio = '';
			closeJourRdv = '';
		} else if (scenario === 'demarrage') {
			dPrenom = '';
			dCalMin = '';
			dCalMax = '';
			dMaintenance = '';
			dVitesse = '';
			dPas = '';
			dProteines = '';
			dJ7 = '';
			dNote = '';
		} else {
			rPrenom = '';
		}
		preview = '';
		editing = false;
	}

	/* ── Modèles sauvegardés (localStorage, 100 % front) ── */
	type SavedModel = { id: number; label: string; text: string };
	let saved = $state<SavedModel[]>([]);
	let savedFlash = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;

	function loadSaved() {
		try {
			saved = JSON.parse(localStorage.getItem('coach-saved-templates') ?? '[]') as SavedModel[];
		} catch {
			saved = [];
		}
	}
	function persistSaved() {
		try {
			localStorage.setItem('coach-saved-templates', JSON.stringify(saved));
		} catch {
			/* quota — la liste reste en mémoire pour la session */
		}
	}
	function saveModel() {
		if (!preview) return;
		saved = [{ id: Date.now(), label: `${SCENARIO_LABEL[scenario]} · ${new Date().toLocaleDateString('fr-FR')}`, text: preview }, ...saved].slice(0, 20);
		persistSaved();
		savedFlash = true;
		clearTimeout(savedTimer);
		savedTimer = setTimeout(() => (savedFlash = false), 2500);
	}
	function removeSaved(id: number) {
		saved = saved.filter((m) => m.id !== id);
		persistSaved();
	}
	async function copySaved(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			/* silencieux */
		}
		copied = true;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 2500);
	}

	/* ── Sélection ── */
	function selectCategory(key: (typeof CATEGORIES)[number]['key']) {
		const c = CATEGORIES.find((x) => x.key === key);
		if (!c || !c.active) return; // catégories « Bientôt » : aucune action
		category = c.key;
		scenario = SCENARIOS[c.key]?.[0]?.key ?? scenario;
		editing = false;
		generate(); // aperçu immédiat (démo préremplie)
	}
	function selectScenario(key: ScenarioKey) {
		scenario = key;
		editing = false;
		generate();
	}

	const showCloseVisio = $derived(closeSituation === 'pendant' || closeSituation === 'paiement');
	const showCloseRdv = $derived(closeSituation === 'retour');
	const scenariosOfCategory = $derived(SCENARIOS[category] ?? []);

	/* Démo Preview : champs préremplis + aperçu généré au montage. */
	onMount(() => {
		loadSaved();
		closePrenom = 'Pauline';
		closeVisio = 'lundi 5 octobre à 14h30';
		generate();
	});
</script>

<svelte:head><title>Templates — CRM G-Flux</title></svelte:head>

<!-- ═══ En-tête premium ═══ -->
<div class="m-in-crm flex flex-wrap items-start justify-between gap-3" style="--m-i: 0">
	<div class="min-w-0">
		<h1 class="flex items-center gap-2.5 font-display text-2xl font-black tracking-tight text-ink">
			<span class="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-light text-brand-deep"><Icon name="messageCircle" size={20} /></span>
			Templates
		</h1>
		<p class="mt-1.5 text-sm text-mist">Gagne du temps et génère des messages personnalisés en quelques secondes.</p>
	</div>
</div>

<!-- ═══ Catégories (chips) ═══ -->
<div class="m-in-crm mt-4 flex flex-wrap items-center gap-1.5" style="--m-i: 1" role="group" aria-label="Catégories de templates">
	{#each CATEGORIES as c (c.key)}
		<button
			type="button"
			disabled={!c.active}
			title={c.active ? undefined : 'Bientôt disponible'}
			onclick={() => selectCategory(c.key)}
			aria-pressed={c.active && category === c.key}
			class="chip-crm {!c.active ? 'cursor-not-allowed opacity-45' : ''} {c.active && category === c.key ? 'active-crm' : ''}"
		>
			<Icon name={c.icon} size={13} class="mr-1 inline shrink-0 align-[-2px]" /> {c.label}
		</button>
	{/each}
</div>

<div class="m-in-crm mt-4 grid items-start gap-4 lg:grid-cols-5" style="--m-i: 2">
	<!-- ═══════════ COLONNE GAUCHE : scénario + champs + générer ═══════════ -->
	<div class="min-w-0 space-y-4 lg:col-span-3">
		<!-- Étape 1 : situation -->
		<section class="card-crm p-5">
			<div class="flex items-start gap-3">
				<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-black text-white">1</span>
				<div class="min-w-0">
					<h2 class="font-display text-[15px] font-bold text-ink">Choisis la situation</h2>
					<p class="mt-0.5 text-xs text-mist">Sélectionne le type de message que tu souhaites générer.</p>
				</div>
			</div>
			<div class="mt-4 grid gap-2.5 sm:grid-cols-2">
				{#each scenariosOfCategory as s (s.key)}
					<button
						type="button"
						onclick={() => selectScenario(s.key)}
						class="relative rounded-2xl border-2 p-4 text-center transition {scenario === s.key
							? 'border-brand bg-brand-light/50 shadow-sm'
							: 'border-line bg-white hover:border-brand/50'}"
					>
						{#if scenario === s.key}
							<span class="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-brand text-white"><Icon name="check" size={11} strokeWidth={3} /></span>
						{/if}
						<span class="text-2xl" aria-hidden="true">{s.emoji}</span>
						<span class="mt-1.5 block text-[13.5px] font-bold leading-snug text-ink">{s.label}</span>
						<span class="mt-1 block text-[11.5px] leading-snug text-mist">{s.hint}</span>
					</button>
				{/each}
			</div>

			<!-- Situations internes (scénario Close & bienvenue uniquement) -->
			{#if scenario === 'close'}
				<div class="mt-4 grid gap-2 border-t border-line pt-4">
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
			{/if}
		</section>

		<!-- Étape 2 : informations -->
		<section class="card-crm p-5">
			<div class="flex items-start gap-3">
				<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-black text-white">2</span>
				<div class="min-w-0">
					<h2 class="font-display text-[15px] font-bold text-ink">Renseigne les informations</h2>
					<p class="mt-0.5 text-xs text-mist">Ces informations seront automatiquement intégrées dans ton message.</p>
				</div>
			</div>

			<div class="mt-4">
				{#if scenario === 'close'}
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="block">
							<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Prénom de la cliente <span class="text-danger">*</span></span>
							<input type="text" bind:value={closePrenom} placeholder="Ex. Pauline" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
						</label>
						{#if showCloseVisio}
							<label class="block">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Jour et heure de la visio (optionnel)</span>
								<input type="text" bind:value={closeVisio} placeholder="Ex. lundi 5 octobre à 14h30" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
							</label>
						{/if}
						{#if showCloseRdv}
							<label class="block sm:col-span-2">
								<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Jour idéal pour le premier rendez-vous</span>
								<input type="text" bind:value={closeJourRdv} placeholder="Ex. lundi" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
							</label>
						{/if}
					</div>
				{:else if scenario === 'demarrage'}
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="block">
							<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Prénom</span>
							<input type="text" bind:value={dPrenom} placeholder="Ex. Pauline" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
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
							<input type="text" inputmode="decimal" bind:value={dVitesse} placeholder="0,25" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold tabular-nums text-ink outline-none transition focus:border-brand" />
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
							<input type="text" bind:value={dJ7} placeholder="Ex. lundi 12 octobre à 10h" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
						</label>
					</div>
					<label class="mt-4 block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Note personnalisée (optionnel)</span>
						<textarea bind:value={dNote} rows="3" placeholder="Ex. Tu m'as dit que tu mangeais peu le matin — on va travailler ça en priorité…" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand"></textarea>
					</label>
				{:else}
					<label class="block">
						<span class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-mist">Prénom de la cliente <span class="text-danger">*</span></span>
						<input type="text" bind:value={rPrenom} placeholder="Ex. Pauline" class="w-full rounded-xl border-2 border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-brand" />
					</label>
				{/if}
			</div>
		</section>

		<!-- Étape 3 : générer -->
		<section class="card-crm p-5">
			<div class="flex items-start gap-3">
				<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-[13px] font-black text-white">3</span>
				<div class="min-w-0">
					<h2 class="font-display text-[15px] font-bold text-ink">Génère ton message</h2>
					<p class="mt-0.5 text-xs text-mist">Clique sur le bouton pour créer ton message personnalisé.</p>
				</div>
			</div>
			<button type="button" onclick={generate} class="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.99]">
				<Icon name="sparkles" size={15} class="shrink-0" /> Générer le message <Icon name="chevronRight" size={14} class="shrink-0" />
			</button>
		</section>
	</div>

	<!-- ═══════════ COLONNE DROITE : aperçu + actions ═══════════ -->
	<div class="min-w-0 lg:col-span-2">
		<section class="card-crm p-5 lg:sticky lg:top-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
					<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-white"><Icon name="messageCircle" size={13} /></span>
					Aperçu du message
				</h2>
				{#if preview}
					<span class="rounded-full bg-brand-light px-2.5 py-1 text-[10.5px] font-bold text-brand-deep">Message généré</span>
				{:else}
					<span class="rounded-full bg-soft px-2.5 py-1 text-[10.5px] font-bold text-mist">En attente</span>
				{/if}
			</div>

			<!-- Bulle message (WhatsApp-like, éditable après génération) -->
			<div class="mt-3 rounded-2xl border border-brand/30 bg-brand-light/40 p-4">
				{#if preview}
					{#if editing}
						<textarea bind:value={preview} rows="10" class="w-full rounded-xl border-2 border-brand/40 bg-white px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none transition focus:border-brand"></textarea>
					{:else}
						<p class="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{preview}</p>
					{/if}
					<div class="mt-2 flex justify-end">
						<button type="button" onclick={() => (editing = !editing)} class="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-ink shadow-sm ring-1 ring-line transition hover:text-brand">
							<Icon name={editing ? 'check' : 'pencil'} size={11} class="shrink-0" /> {editing ? 'Terminé' : 'Modifier'}
						</button>
					</div>
				{:else}
					<p class="py-6 text-center text-[13px] leading-relaxed text-mist">
						Renseigne les informations puis génère ton message —<br />l'aperçu prêt à copier apparaîtra ici.
					</p>
				{/if}
			</div>

			<!-- Copier -->
			<button
				type="button"
				onclick={copyMessage}
				disabled={!preview}
				class="mt-3 flex w-full items-center justify-center gap-2 rounded-full border-2 border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand hover:text-brand disabled:opacity-40"
			>
				<Icon name={copied ? 'check' : 'copy'} size={14} class="shrink-0 {copied ? 'text-brand' : ''}" /> {copied ? 'Copié !' : 'Copier le message'}
			</button>

			<!-- Autres actions -->
			<p class="mt-4 text-[10px] font-bold uppercase tracking-wider text-mist">Autres actions</p>
			<div class="mt-2 grid grid-cols-2 gap-2">
				<button type="button" onclick={resetAll} class="inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-white px-3 py-2 text-[12.5px] font-bold text-ink transition hover:border-brand hover:text-brand">
					<Icon name="rotateCcw" size={13} class="shrink-0" /> Réinitialiser
				</button>
				<button type="button" onclick={saveModel} disabled={!preview} class="inline-flex items-center justify-center gap-1.5 rounded-full border border-line bg-white px-3 py-2 text-[12.5px] font-bold text-ink transition hover:border-brand hover:text-brand disabled:opacity-40">
					<Icon name="bookmark" size={13} class="shrink-0" /> {savedFlash ? 'Enregistré ✓' : 'Sauvegarder'}
				</button>
			</div>

			<!-- Astuce -->
			<div class="mt-4 rounded-xl bg-soft px-3.5 py-3">
				<p class="flex items-center gap-1.5 text-[11.5px] font-bold text-ink"><Icon name="lightbulb" size={13} class="shrink-0 text-warn" /> Astuce</p>
				<p class="mt-1 text-[11px] leading-relaxed text-mist">Tu peux personnaliser ce message après génération avant de le copier. « Sauvegarder » garde une copie dans ce navigateur.</p>
			</div>

			<!-- Modèles sauvegardés (localStorage) -->
			{#if saved.length > 0}
				<div class="mt-4 border-t border-line pt-3">
					<p class="text-[10px] font-bold uppercase tracking-wider text-mist">Mes modèles ({saved.length})</p>
					<ul class="mt-2 space-y-1.5">
						{#each saved as m (m.id)}
							<li class="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2">
								<span class="min-w-0 flex-1">
									<span class="block truncate text-[12px] font-bold text-ink">{m.label}</span>
									<span class="block truncate text-[11px] text-mist">{m.text.split('\n')[0]}</span>
								</span>
								<button type="button" aria-label="Copier ce modèle" title="Copier" onclick={() => copySaved(m.text)} class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-mist transition hover:bg-soft hover:text-brand"><Icon name="copy" size={13} /></button>
								<button type="button" aria-label="Supprimer ce modèle" title="Supprimer" onclick={() => removeSaved(m.id)} class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-mist transition hover:bg-danger-light hover:text-danger"><Icon name="trash" size={13} /></button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>
	</div>
</div>
