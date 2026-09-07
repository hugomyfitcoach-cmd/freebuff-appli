<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		ONBOARDING_SECTIONS,
		ONBOARDING_TOTAL_STEPS,
		requiredCountOf,
		visibleQuestions,
		type Question,
	} from '$lib/onboarding';

	/**
	 * Formulaire de démarrage G-FLUX (étape 1 de l'onboarding).
	 * Reconstruit depuis l'ancien formulaire : Prénom/Nom et écrans
	 * d'introduction supprimés (identité = compte). Sauvegarde automatique en
	 * brouillon à chaque saisie ; seule la soumission finale vaut « terminé ».
	 */
	let { data } = $props();
	const initial = $derived(
		(data.intake ?? {}) as {
			status: string | null;
			answers: Record<string, unknown>;
			submittedAt: number | null;
			accountHeightCm: number | null;
		}
	);
	const alreadySubmitted = $derived(initial.status === 'submitted');

	let answers = $state<Record<string, string | number | null>>({});
	// Préremplissage : la taille du compte (si déjà connue) évite une ressaisie.
	$effect(() => {
		const base = initial.answers ?? {};
		if (!base.heightCm && initial.accountHeightCm) base.heightCm = String(initial.accountHeightCm);
		answers = { ...(base as Record<string, string | number | null>) };
	});

	let idx = $state(0);
	let screen = $state<'wizard' | 'done'>('wizard');
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let msg = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	const section = $derived(ONBOARDING_SECTIONS[idx]);
	const progressPct = $derived(Math.round(((idx + 1) / ONBOARDING_TOTAL_STEPS) * 100));

	const isOui = (v: unknown) => v === 'oui';
	const visible = (q: Question) => !q.showWhen || answers[q.showWhen.field] === q.showWhen.value;

	function setValue(id: string, v: string | number | null) {
		if (v == null) delete answers[id];
		else answers[id] = v;
		answers = { ...answers };
		scheduleSave(false);
	}

	// Décimale « à la française » : 68,5 est stocké 68.5 (type=text + inputmode
	// decimal — type=number rejette la virgule sur plusieurs navigateurs).
	function parseDecimal(raw: string): number | null {
		const t = raw.trim().replace(/\s/g, '').replace(',', '.');
		if (t === '') return null;
		const n = Number(t);
		return Number.isFinite(n) ? n : null;
	}

	function setNumber(id: string, raw: string) {
		const n = parseDecimal(raw);
		if (n === null && raw.trim() !== '') return; // saisie invalide : on ignore
		if (n === null) delete answers[id];
		else answers[id] = n;
		answers = { ...answers };
		scheduleSave(false);
	}

	function scheduleSave(final = false) {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => save(final), final ? 0 : 450);
	}

	async function save(final: boolean) {
		const body = { status: final ? 'submitted' : 'draft', answers };
		saveState = 'saving';
		try {
			const res = await fetch('/api/onboarding', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const j = await res.json();
			if (!res.ok || j.error) throw new Error(j.error ?? 'Enregistrement impossible.');
			saveState = 'saved';
			msg = '';
		} catch (e) {
			saveState = 'error';
			msg = e instanceof Error ? e.message : 'Enregistrement impossible.';
		}
	}

	function stepError(): string {
		const qs = ONBOARDING_SECTIONS[idx].questions.filter(visible);
		const missing = qs.filter((q) => q.required && (answers[q.id] == null || String(answers[q.id]).trim() === ''));
		if (missing.length) return `Réponds à : ${missing.map((q) => q.label).join(' · ')}`;
		return '';
	}

	function next() {
		const e = stepError();
		if (e) {
			msg = e;
			return;
		}
		msg = '';
		if (idx < ONBOARDING_TOTAL_STEPS - 1) {
			idx += 1;
		} else {
			submitFinal();
		}
	}
	function back() {
		msg = '';
		if (idx > 0) idx -= 1;
	}

	async function submitFinal() {
		const all = visibleQuestions(answers).filter((x) => x.question.required && (answers[x.question.id] == null || String(answers[x.question.id]).trim() === ''));
		if (all.length) {
			msg = `Il reste des questions sans réponse (ex. ${all[0].question.label}).`;
			return;
		}
		msg = '';
		await save(true);
		if (saveState !== 'error') {
			screen = 'done';
			saveState = 'idle';
		}
	}

	async function goHome() {
		await invalidateAll();
	}
</script>

<svelte:head><title>Formulaire de démarrage — G-Flux</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<!-- En-tête -->
	<div class="mb-5">
		<p class="text-[11px] font-bold uppercase tracking-widest text-mist">Étape 1 · Formulaire de démarrage</p>
		<h1 class="font-display text-2xl font-semibold text-ink">Ton profil pour démarrer 🚀</h1>
		<p class="mt-1 text-sm text-mist">
			Réponds naturellement — c'est notre point de départ pour préparer ton accompagnement.
		</p>
	</div>

	{#if alreadySubmitted}
		<!-- Formulaire déjà soumis : on ne redemande rien, on affiche un récap simple -->
		<div class="rounded-2xl border border-line bg-card p-6 text-center shadow-sm">
			<p class="text-4xl">🙌</p>
			<h2 class="mt-2 font-display text-xl font-semibold text-ink">Formulaire déjà envoyé</h2>
			<p class="mt-1 text-sm text-mist">
				Tes réponses de démarrage sont bien arrivées
				{#if initial.submittedAt}
					(le {new Date(initial.submittedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}).
				{/if}
			</p>
			<div class="mt-4 grid gap-2 rounded-xl bg-cream/70 p-4 text-left sm:grid-cols-2">
				{#each visibleQuestions(initial.answers) as { question } (question.id)}
					<div class="rounded-lg bg-white px-3 py-2">
						<div class="text-[10px] font-bold uppercase tracking-wide text-mist">{question.label}</div>
						<div class="text-sm text-ink">{String(initial.answers[question.id] ?? '—')}</div>
					</div>
				{/each}
			</div>
			<a href="/espace" class="mt-4 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark">
				Retour à mon espace →
			</a>
		</div>
	{:else if screen === 'wizard'}
		<!-- Progression -->
		<div class="mb-3 flex items-center justify-between text-xs text-mist">
			<span>Étape {idx + 1} / {ONBOARDING_TOTAL_STEPS}</span>
			<span class="flex items-center gap-1">
				{#if saveState === 'saving'}<span class="text-mist">Enregistrement…</span>
				{:else if saveState === 'saved'}<span class="font-semibold text-brand-dark">✓ Sauvegardé</span>
				{:else if saveState === 'error'}<span class="font-semibold text-danger">Erreur — nouvelle tentative à la prochaine saisie</span>{/if}
			</span>
		</div>
		<div class="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-line">
			<div class="h-full rounded-full bg-brand transition-all duration-300" style="width: {progressPct}%"></div>
		</div>

		{#if msg}
			<p class="mb-3 rounded-xl bg-warn-light px-4 py-2.5 text-sm font-semibold text-warn">{msg}</p>
		{/if}

		{#key section.id}
			<div class="rounded-2xl border border-line bg-card p-5 shadow-sm">
				<h2 class="font-display text-lg font-semibold text-ink">{section.emoji} {section.title}</h2>
				{#if section.subtitle}<p class="mt-1 text-sm text-mist">{section.subtitle}</p>{/if}

				<div class="mt-4 space-y-5">
					{#each section.questions as q (q.id)}
						{#if visible(q)}
							<div>
								<label class="mb-1.5 block text-sm font-semibold text-ink">
									{q.label}{q.required ? ' *' : ''}
								</label>

								{#if q.kind === 'choice'}
									<div class="grid gap-2 {q.options && q.options.length > 4 ? 'grid-cols-2' : ''}">
										{#each q.options ?? [] as opt (opt.value)}
											<button
												type="button"
												onclick={() => setValue(q.id, opt.value)}
												class="rounded-xl border-2 px-3 py-2.5 text-left text-sm font-semibold transition
													{answers[q.id] === opt.value
														? 'border-brand bg-brand-light text-brand-dark'
														: 'border-line bg-white text-ink hover:border-brand/60'}"
											>
												<span>{opt.label}</span>
												{#if opt.hint}<span class="mt-0.5 block text-xs font-normal text-mist">{opt.hint}</span>{/if}
											</button>
										{/each}
									</div>

								{:else if q.kind === 'scale'}
									<div class="flex items-center gap-1 overflow-x-auto pb-1">
										{#each Array.from({ length: (q.max ?? 10) - (q.min ?? 0) + 1 }, (_, i) => (q.min ?? 0) + i) as v (v)}
											<button
												type="button"
												onclick={() => setValue(q.id, v)}
												class="shrink-0 rounded-full px-3 py-2 text-sm font-semibold transition
													{Number(answers[q.id]) === v ? 'bg-brand text-white' : 'border-2 border-line bg-white text-ink'}"
											>{v}</button>
										{/each}
									</div>
									{#if q.hint}<p class="mt-1 text-xs text-mist">{q.hint}</p>{/if}

								{:else if q.kind === 'textarea'}
									<textarea
										value={answers[q.id] ?? ''}
										oninput={(e) => setValue(q.id, (e.currentTarget as HTMLTextAreaElement).value || null)}
										rows="3"
										placeholder={q.placeholder}
										class="w-full rounded-xl border-2 border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand"
									></textarea>

								{:else if q.kind === 'number'}
									<input
										type="text"
										inputmode="decimal"
										value={answers[q.id] ?? ''}
										oninput={(e) => setNumber(q.id, (e.currentTarget as HTMLInputElement).value)}
										placeholder={q.placeholder}
										class="w-full rounded-xl border-2 border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand"
									/>
								{:else}
									<input
										type="text"
										value={answers[q.id] ?? ''}
										oninput={(e) => setValue(q.id, (e.currentTarget as HTMLInputElement).value || null)}
										placeholder={q.placeholder}
										class="w-full rounded-xl border-2 border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand"
									/>
								{/if}
							</div>
						{/if}
					{/each}
				</div>

				<div class="mt-6 flex items-center justify-between gap-3">
					<button type="button" onclick={back} disabled={idx === 0} class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-semibold text-mist transition hover:text-ink disabled:opacity-40">
						← Retour
					</button>
					{#if idx < ONBOARDING_TOTAL_STEPS - 1}
						<button type="button" onclick={next} class="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark">
							Continuer →
						</button>
					{:else}
						<button type="button" onclick={next} class="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark">
							Envoyer 🚀
						</button>
					{/if}
				</div>
			</div>
		{/key}
	{:else}
		<!-- Soumission réussie -->
		<div class="rounded-2xl border border-line bg-card p-8 text-center shadow-sm">
			<p class="text-5xl">🙌</p>
			<h2 class="mt-3 font-display text-2xl font-semibold text-ink">Merci pour tes réponses !</h2>
			<p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mist">
				C'est tout bon — ton coach prépare ton plan en se basant sur tout ce que tu viens de partager.
				Il te reste une dernière étape : tes mensurations & photos de départ.
			</p>
			<div class="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
				<a href="/espace/progression?action=mensurations" class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand hover:text-brand">
					📏 Faire mes mensurations
				</a>
				<a href="/espace/photos" class="rounded-xl border-2 border-line px-4 py-2.5 text-sm font-bold text-ink transition hover:border-brand hover:text-brand">
					📸 Ajouter mes photos
				</a>
			</div>
			<button type="button" onclick={goHome} class="mt-4 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark">
				Retour à mon espace →
			</button>
		</div>
	{/if}
</div>
