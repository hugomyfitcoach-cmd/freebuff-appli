<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import BackToHome from '$lib/components/BackToHome.svelte';
	import { isFormOpen } from '$lib/week.js';

	let { data, form: action } = $props();

	// ── Session & état d'affichage ────────────────────────────────────
	const user = $derived(data?.user ?? null);
	const merci = $derived(data?.merci ?? null);
	const formOpen = $state(isFormOpen());
	let confettiDone = $state(false);

	// ── État du formulaire (mêmes données que le HTML d'origine) ──────
	let step = $state(1);
	let direction = $state<'fwd' | 'back'>('fwd');
	let ecritShake = $state(false);

	let form = $state<{
		motivation: number | null;
		adherence: string | null;
		deficit_annule: string | null;
		faim: string | null;
		hydratation: string | null;
		digestion: string | null;
		pas: string | null;
		cycle: string | null;
		evolution: string | null;
		mensurations: string | null;
		photos: string | null;
		besoin_retour: string | null;
		categorie_retour: string[];
		point_retour_ecrit: string;
		point_retour_appel: string;
		victoire: string;
	}>({
		motivation: null,
		adherence: null,
		deficit_annule: null,
		faim: null,
		hydratation: null,
		digestion: null,
		pas: null,
		cycle: null,
		evolution: null,
		mensurations: null,
		photos: null,
		besoin_retour: null,
		categorie_retour: [],
		point_retour_ecrit: '',
		point_retour_appel: '',
		victoire: '',
	});

	const progress = $derived(merci ? 100 : Math.round(((step - 1) / 8) * 100));
	const showDeficit = $derived(form.adherence === 'partiel' || form.adherence === 'non');
	const motivationColors = ['#ff4444', '#ff9500', '#f0c000', '#1DB954', '#1DB954'];

	// ── Navigation ─────────────────────────────────────────────────────
	function goTo(n: number, back = false) {
		direction = back ? 'back' : 'fwd';
		step = n;
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function goNext(from: number) {
		goTo(from + 1);
	}

	function goBack(from: number) {
		goTo(from - 1, true);
	}

	// ── Sélecteurs ─────────────────────────────────────────────────────
	function pick(key: 'motivation' | 'adherence' | 'deficit_annule' | 'faim' | 'hydratation' | 'digestion' | 'pas' | 'cycle' | 'evolution' | 'mensurations' | 'photos' | 'besoin_retour', value: number | string | null) {
		form[key] = value as never;
		if (key === 'adherence' && value === 'oui') {
			// Le bloc « déficit annulé » disparaît : on purge la réponse cachée.
			form.deficit_annule = null;
		}
	}

	function pickMotivation(value: number) {
		form.motivation = value;
	}

	function pickBesoin(value: 'rien' | 'ecrit' | 'appel') {
		form.besoin_retour = value;
		if (value !== 'ecrit') {
			form.categorie_retour = [];
			form.point_retour_ecrit = '';
		}
		if (value !== 'appel') {
			form.point_retour_appel = '';
		}
	}

	function toggleCategorie(value: string) {
		const idx = form.categorie_retour.indexOf(value);
		if (idx === -1) form.categorie_retour.push(value);
		else form.categorie_retour.splice(idx, 1);
	}

	// ── Envoi (formulaire classique → action serveur ; l'identité vient de la session) ──
	// Sérialise les réponses à chaque changement (champ caché du formulaire).
	const payloadJSON = $derived.by(() => {
		const besoinRetour = (form.besoin_retour ?? 'rien') as 'rien' | 'ecrit' | 'appel';
		const point = besoinRetour === 'appel' ? form.point_retour_appel : form.point_retour_ecrit;
		// Même structure que le payload du HTML d'origine — seules les
		// réponses réellement données sont envoyées (champs optionnels).
		const answers: Record<string, unknown> = {};
		if (form.motivation !== null) answers.motivation = form.motivation;
		if (form.adherence) answers.adherence = form.adherence;
		if (showDeficit && form.deficit_annule) answers.deficit_annule = form.deficit_annule;
		if (form.faim) answers.faim = form.faim;
		if (form.hydratation) answers.hydratation = form.hydratation;
		if (form.digestion) answers.digestion = form.digestion;
		if (form.pas) answers.pas = form.pas;
		if (form.cycle) answers.cycle = form.cycle;
		if (form.evolution) answers.evolution = form.evolution;
		if (form.mensurations) answers.mensurations = form.mensurations;
		if (form.photos) answers.photos = form.photos;
		if (form.besoin_retour) answers.besoin_retour = form.besoin_retour;
		if (form.besoin_retour === 'ecrit' && form.categorie_retour.length > 0) {
			answers.categorie_retour = form.categorie_retour;
		}
		if (point.trim()) answers.point_retour = point.trim();
		if (form.victoire.trim()) answers.victoire = form.victoire.trim();
		return JSON.stringify(answers);
	});

	function guardSubmit(event: SubmitEvent) {
		// Validation de la dernière étape avant envoi réel.
		if (form.besoin_retour === 'ecrit' && form.categorie_retour.length === 0) {
			event.preventDefault();
			ecritShake = true;
			window.setTimeout(() => (ecritShake = false), 800);
			document.getElementById('bloc-retour-detail-ecrit')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	// ── Au chargement d'un écran de remerciement → confettis (comme l'original) ──
	onMount(() => {
		if (merci && !confettiDone) {
			confettiDone = true;
			window.setTimeout(launchConfetti, 150);
		}
	});

	// ── Confettis (comme l'original) ───────────────────────────────────
	function launchConfetti() {
		const colors = ['#1DB954', '#ffd700', '#ff6b6b', '#74b9ff', '#fd79a8'];
		for (let i = 0; i < 20; i++) {
			window.setTimeout(() => {
				const dot = document.createElement('div');
				dot.className = 'confetti-dot';
				dot.style.cssText = `background:${colors[Math.floor(Math.random() * colors.length)]};left:${10 + Math.random() * 80}vw;top:30vh;width:${6 + Math.random() * 8}px;height:${6 + Math.random() * 8}px`;
				document.body.appendChild(dot);
				const tx = (Math.random() - 0.5) * 200;
				const ty = -(80 + Math.random() * 120);
				dot.animate(
					[
						{ transform: 'translate(0,0) scale(0)', opacity: 1 },
						{ transform: `translate(${tx}px,${ty}px) scale(1)`, opacity: 0 }
					],
					{ duration: 800 + Math.random() * 400, easing: 'ease-out', fill: 'forwards' }
				);
				window.setTimeout(() => dot.remove(), 1200);
			}, i * 40);
		}
	}
</script>

<div class="progress-wrap"><div class="progress-bar" style:width="{progress}%"></div></div>
<div class="progress-pct">{progress > 0 ? `${progress}%` : ''}</div>

<div class="container">
	<div class="form-header">
		<img src="/logo-header.jpg" alt="G-Flux" class="logo-img" />
	</div>

	<!-- Jamais d'impasse : retour Accueil quand le formulaire est fermé ou déjà envoyé,
	     et sortie discrète pendant les étapes du formulaire -->
	{#if !formOpen || merci}
		<div class="closed-page-back"><BackToHome label="Bilans" /></div>
	{:else}
		<div class="form-exit">
			<a href="/espace"><Icon name="arrowLeft" size={16} class="form-exit-ic" /> Accueil</a>
		</div>
	{/if}

	<!-- FERMÉ / MERCI / FORMULAIRE (route réservée aux clients connectés) -->
	{#if !formOpen}
		<div class="closed-page">
			<div class="icon"><Icon name="lock" size={44} /></div>
			<h2>Bilan fermé</h2>
			<p>Le formulaire est fermé jusqu'à vendredi.<br />Rendez-vous vendredi pour ton prochain bilan.</p>
		</div>
	{:else if merci}
		{#if merci === 'rien'}
			<div class="thank-you">
				<div class="ty-logo-wrap">
					<div class="ty-ring"></div>
					<div class="ty-ring-2"></div>
					<div class="ty-inner">
						<img src="/logo.png" alt="G-Flux" class="ty-logo-small" style="object-fit:contain;border-radius:50%;" />
					</div>
				</div>
				<h2>Parfait {user.prenom} !</h2>
				<p>Bilan bien reçu. Tant que ça avance, pas de question à se poser ni de changement à faire : on garde exactement la même dynamique.</p>
				<div class="info-msg"><Icon name="smartphone" size={17} class="info-msg-icon" /> <span>Je t'enverrai un message de bonne réception sur WhatsApp.<br />Une question dans la semaine ? Je suis dispo.</span></div>
			</div>
		{:else if merci === 'ecrit'}
			<div class="thank-you">
				<div class="ty-logo-wrap">
					<div class="ty-ring"></div>
					<div class="ty-ring-2"></div>
					<div class="ty-inner">
						<img src="/logo.png" alt="G-Flux" class="ty-logo-small" style="object-fit:contain;border-radius:50%;" />
					</div>
				</div>
				<h2>Bilan reçu {user.prenom} !</h2>
				<p>Je vais analyser tes données et préparer ton retour.</p>
				<div class="info-msg green"><Icon name="smartphone" size={17} class="info-msg-icon" /> <span>Ton retour arrive sur WhatsApp dimanche.</span></div>
			</div>
		{:else}
			<div class="thank-you">
				<div class="ty-logo-wrap">
					<div class="ty-ring"></div>
					<div class="ty-ring-2"></div>
					<div class="ty-inner">
						<img src="/logo.png" alt="G-Flux" class="ty-logo-small" style="object-fit:contain;border-radius:50%;" />
					</div>
				</div>
				<h2>Merci {user.prenom} !</h2>
				<p>Ta demande d'appel est bien reçue.</p>
				<div class="info-msg"><Icon name="phone" size={17} class="info-msg-icon" /> <span>Je te propose un appel pour la semaine prochaine directement sur WhatsApp.</span></div>
			</div>
		{/if}
	{:else}
		<!-- PAGE 1 — ACCUEIL -->
		{#if step === 1}
			<div class="page active slide-in" class:slide-in-back={direction === 'back'}>
				<div class="step-indicator">Étape 1 sur 8</div>
				<div class="step-title"><Icon name="activity" size={22} class="step-title-icon" /> Ton suivi hebdo</div>
				<div class="step-subtitle">Ça prend 2 minutes — tes données me permettent d'analyser ton flux et d'intervenir si nécessaire.</div>
				<div style="margin-top:28px">
					<div class="info-box">
						<div class="info-title">Salut {user.prenom} !</div>
						<ul>
							<li>Réponds étape par étape, en toute franchise.</li>
							<li>Tu peux modifier tes réponses jusqu'à la fin du week-end.</li>
							<li>Ton bilan est relié à ton compte — tu le retrouveras dans ton espace de suivi.</li>
						</ul>
					</div>
				</div>
				<div class="nav"><button class="btn-next" onclick={() => goNext(1)}>Commencer →</button></div>
			</div>
		{/if}

		<!-- PAGE 2 — MOTIVATION -->
		{#if step === 2}
			<div class="page active slide-in" class:slide-in-back={direction === 'back'}>
				<div class="step-indicator">Étape 2 sur 8</div>
				<div class="step-title"><Icon name="brain" size={22} class="step-title-icon" /> Ta motivation</div>
				<div style="margin-top:28px">
					<div class="field">
						<div class="field-label">Comment évalues-tu ta motivation cette semaine ?</div>
						<div class="motivation-scale">
							{#each [1, 2, 3, 4, 5] as value}
								<button
									class="motivation-btn e{value}"
									class:selected={form.motivation === value}
									onclick={() => pickMotivation(value)}
								>{value}</button>
							{/each}
						</div>
						<div class="motivation-gauge-wrap">
							<div
								class="motivation-gauge-fill"
								style:width="{form.motivation ? (form.motivation / 5) * 100 : 0}%"
								style:background={form.motivation ? motivationColors[form.motivation - 1] : undefined}
							></div>
						</div>
						<div class="motivation-labels"><span><Icon name="frown" size={14} class="motivation-icon" /> Pas motivée</span><span><Icon name="flame" size={14} class="motivation-icon" /> Ultra motivée</span></div>
					</div>
				</div>
				<div class="nav">
					<button class="btn-back" onclick={() => goBack(2)}>←</button>
					<button class="btn-next" onclick={() => goNext(2)}>Suivant →</button>
				</div>
			</div>
		{/if}

		<!-- PAGE 3 — ADHÉRENCE -->
		{#if step === 3}
			<div class="page active slide-in" class:slide-in-back={direction === 'back'}>
				<div class="step-indicator">Étape 3 sur 8</div>
				<div class="step-title"><Icon name="clipboardList" size={22} class="step-title-icon" /> Adhérence au plan</div>
				<div style="margin-top:28px">
					<div class="field">
						<div class="field-label">Sur la semaine, penses-tu avoir été globalement alignée avec ton plan calorique ?</div>
						<div class="choices">
							<button class="choice" class:selected={form.adherence === 'oui'} onclick={() => pick('adherence', 'oui')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#22c55e"></span>Oui, de façon régulière
							</button>
							<button class="choice" class:selected={form.adherence === 'partiel'} onclick={() => pick('adherence', 'partiel')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#f59e0b"></span>Partiellement (écarts / repas non maîtrisés)
							</button>
							<button class="choice" class:selected={form.adherence === 'non'} onclick={() => pick('adherence', 'non')}>
								<span class="choice-letter">C</span> <span class="tone-dot" style="background:#ef4444"></span>Non, pas du tout
							</button>
						</div>
					</div>
					{#if showDeficit}
						<div class="cond-block visible">
							<div class="field">
								<div class="field-label">Penses-tu que ces écarts ont annulé ton déficit de la semaine ?</div>
								<div class="choices">
									<button class="choice" class:selected={form.deficit_annule === 'non'} onclick={() => pick('deficit_annule', 'non')}>
										<span class="choice-letter">A</span> <span class="tone-dot" style="background:#22c55e"></span>Non, je pense être restée en déficit
									</button>
									<button class="choice" class:selected={form.deficit_annule === 'peut-etre'} onclick={() => pick('deficit_annule', 'peut-etre')}>
										<span class="choice-letter">B</span> <span class="tone-dot" style="background:#f59e0b"></span>Peut-être, je ne sais pas trop
									</button>
									<button class="choice" class:selected={form.deficit_annule === 'oui'} onclick={() => pick('deficit_annule', 'oui')}>
										<span class="choice-letter">C</span> <span class="tone-dot" style="background:#ef4444"></span>Oui, j'ai probablement annulé mon déficit
									</button>
								</div>
							</div>
						</div>
					{/if}
					<div class="field">
						<div class="field-label">As-tu ressenti une faim marquée ou des envies alimentaires difficiles à gérer ?</div>
						<div class="choices">
							<button class="choice" class:selected={form.faim === 'oui'} onclick={() => pick('faim', 'oui')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#ef4444"></span>Oui
							</button>
							<button class="choice" class:selected={form.faim === 'non'} onclick={() => pick('faim', 'non')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#22c55e"></span>Non
							</button>
						</div>
					</div>
				</div>
				<div class="nav">
					<button class="btn-back" onclick={() => goBack(3)}>←</button>
					<button class="btn-next" onclick={() => goNext(3)}>Suivant →</button>
				</div>
			</div>
		{/if}

		<!-- PAGE 4 — HYDRATATION & DIGESTION -->
		{#if step === 4}
			<div class="page active slide-in" class:slide-in-back={direction === 'back'}>
				<div class="step-indicator">Étape 4 sur 8</div>
				<div class="step-title"><Icon name="droplet" size={22} class="step-title-icon" /> Hydratation & digestion</div>
				<div style="margin-top:28px">
					<div class="field">
						<div class="field-label">Comment a été ton hydratation sur la semaine ?</div>
						<div class="choices">
							<button class="choice" class:selected={form.hydratation === 'suffisante'} onclick={() => pick('hydratation', 'suffisante')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#22c55e"></span>Suffisante et régulière
							</button>
							<button class="choice" class:selected={form.hydratation === 'variable'} onclick={() => pick('hydratation', 'variable')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#f59e0b"></span>Variable / irrégulière
							</button>
							<button class="choice" class:selected={form.hydratation === 'insuffisante'} onclick={() => pick('hydratation', 'insuffisante')}>
								<span class="choice-letter">C</span> <span class="tone-dot" style="background:#ef4444"></span>Insuffisante
							</button>
						</div>
					</div>
					<div class="field">
						<div class="field-label">Comment a été ta digestion cette semaine ?</div>
						<div class="choices">
							<button class="choice" class:selected={form.digestion === 'ok'} onclick={() => pick('digestion', 'ok')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#22c55e"></span>OK
							</button>
							<button class="choice" class:selected={form.digestion === 'perturbee'} onclick={() => pick('digestion', 'perturbee')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#f59e0b"></span>Un peu perturbée
							</button>
							<button class="choice" class:selected={form.digestion === 'ballonnements'} onclick={() => pick('digestion', 'ballonnements')}>
								<span class="choice-letter">C</span> <span class="tone-dot" style="background:#ef4444"></span>Ballonnements / inconfort fréquents
							</button>
						</div>
					</div>
				</div>
				<div class="nav">
					<button class="btn-back" onclick={() => goBack(4)}>←</button>
					<button class="btn-next" onclick={() => goNext(4)}>Suivant →</button>
				</div>
			</div>
		{/if}

		<!-- PAGE 5 — PAS & CYCLE -->
		{#if step === 5}
			<div class="page active slide-in" class:slide-in-back={direction === 'back'}>
				<div class="step-indicator">Étape 5 sur 8</div>
				<div class="step-title"><Icon name="footprints" size={22} class="step-title-icon" /> Activité & cycle</div>
				<div style="margin-top:28px">
					<div class="field">
						<div class="field-label">Nombre de pas moyen par jour (7 derniers jours) :</div>
						<div class="choices">
							<button class="choice" class:selected={form.pas === 'moins5000'} onclick={() => pick('pas', 'moins5000')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#ef4444"></span>Moins de 5 000 pas
							</button>
							<button class="choice" class:selected={form.pas === '5000-8000'} onclick={() => pick('pas', '5000-8000')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#f59e0b"></span>5 000 – 8 000
							</button>
							<button class="choice" class:selected={form.pas === '8000-10000'} onclick={() => pick('pas', '8000-10000')}>
								<span class="choice-letter">C</span> <span class="tone-dot" style="background:#22c55e"></span>8 000 – 10 000
							</button>
							<button class="choice" class:selected={form.pas === 'plus10000'} onclick={() => pick('pas', 'plus10000')}>
								<span class="choice-letter">D</span> <span class="tone-dot" style="background:#22c55e"></span>10 000+ <Icon name="footprints" size={15} class="choice-icon" />
							</button>
						</div>
					</div>
					<div class="field">
						<div class="field-label">
							Où en es-tu sur le plan hormonal / cycle ?<br /><small style="color:var(--muted);font-weight:400">Si tu ne suis pas ton cycle, base-toi sur les jours</small>
						</div>
						<div class="choices">
							<button class="choice" class:selected={form.cycle === 'regles'} onclick={() => pick('cycle', 'regles')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#ef4444"></span>Règles (J1 à J4–5)
							</button>
							<button class="choice" class:selected={form.cycle === 'folliculaire'} onclick={() => pick('cycle', 'folliculaire')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#22c55e"></span>Phase folliculaire (J5 à J14)
							</button>
							<button class="choice" class:selected={form.cycle === 'ovulation'} onclick={() => pick('cycle', 'ovulation')}>
								<span class="choice-letter">C</span> <span class="tone-dot" style="background:#f59e0b"></span>Ovulation (J14–J16)
							</button>
							<button class="choice" class:selected={form.cycle === 'luteale'} onclick={() => pick('cycle', 'luteale')}>
								<span class="choice-letter">D</span> <span class="tone-dot" style="background:#3b82f6"></span>Phase lutéale (J15 à J28)
							</button>
							<button class="choice" class:selected={form.cycle === 'menopause'} onclick={() => pick('cycle', 'menopause')}>
								<span class="choice-letter">E</span> <span class="tone-dot" style="background:#a855f7"></span>Ménopause / péri-ménopause
							</button>
							<button class="choice" class:selected={form.cycle === 'pilule'} onclick={() => pick('cycle', 'pilule')}>
								<span class="choice-letter">F</span> <span class="tone-dot" style="background:#2563eb"></span>Pilule / contraception hormonale
							</button>
							<button class="choice" class:selected={form.cycle === 'sais-pas'} onclick={() => pick('cycle', 'sais-pas')}>
								<span class="choice-letter">G</span> <span class="tone-dot" style="background:#9ca3af"></span>Je ne sais pas / peu de repères
							</button>
						</div>
					</div>
				</div>
				<div class="nav">
					<button class="btn-back" onclick={() => goBack(5)}>←</button>
					<button class="btn-next" onclick={() => goNext(5)}>Suivant →</button>
				</div>
			</div>
		{/if}

		<!-- PAGE 6 — INFO CYCLE -->
		{#if step === 6}
			<div class="page active slide-in" class:slide-in-back={direction === 'back'}>
				<div class="step-indicator">Étape 6 sur 8</div>
				<div class="step-title"><Icon name="lightbulb" size={22} class="step-title-icon" /> Bon à savoir</div>
				<div class="step-subtitle">Le corps ne réagit pas de la même façon selon le moment du cycle.</div>
				<div style="margin-top:20px">
					<div class="info-box">
						<div class="info-title">Selon ta phase :</div>
						<ul>
							<li><strong>Règles / phase lutéale</strong> → rétention d'eau, fatigue, faim parfois plus marquée</li>
							<li><strong>Ovulation</strong> → légères fluctuations possibles sur quelques jours</li>
							<li><strong>Phase folliculaire</strong> → période la plus stable pour lire la balance</li>
						</ul>
					</div>
					<p style="font-size:13px;color:var(--muted);line-height:1.6">L'important c'est la tendance sur la semaine et le mois — pas un chiffre isolé.</p>
				</div>
				<div class="nav">
					<button class="btn-back" onclick={() => goBack(6)}>←</button>
					<button class="btn-next" onclick={() => goNext(6)}>Suivant →</button>
				</div>
			</div>
		{/if}

		<!-- PAGE 7 — ÉVOLUTION CORPORELLE -->
		{#if step === 7}
			<div class="page active slide-in" class:slide-in-back={direction === 'back'}>
				<div class="step-indicator">Étape 7 sur 8</div>
				<div class="step-title"><Icon name="chartLine" size={22} class="step-title-icon" /> Évolution & suivi corporel</div>
				<div style="margin-top:28px">
					<div class="field">
						<div class="field-label">Comment as-tu perçu l'évolution de ton corps cette semaine ?</div>
						<div class="choices">
							<button class="choice" class:selected={form.evolution === 'baisse'} onclick={() => pick('evolution', 'baisse')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#22c55e"></span>En baisse / amélioration
							</button>
							<button class="choice" class:selected={form.evolution === 'stable'} onclick={() => pick('evolution', 'stable')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#9ca3af"></span>Stable
							</button>
							<button class="choice" class:selected={form.evolution === 'hausse'} onclick={() => pick('evolution', 'hausse')}>
								<span class="choice-letter">C</span> <span class="tone-dot" style="background:#ef4444"></span>En hausse / sensation de stagnation
							</button>
						</div>
					</div>
					<div class="field">
						<div class="field-label">
							Sommes-nous sur ta semaine de mensurations ? <small style="color:var(--muted);font-weight:400">(1× tous les 10–15 jours)</small>
						</div>
						<div class="choices">
							<button class="choice" class:selected={form.mensurations === 'oui'} onclick={() => pick('mensurations', 'oui')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#22c55e"></span>Oui
							</button>
							<button class="choice" class:selected={form.mensurations === 'non'} onclick={() => pick('mensurations', 'non')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#9ca3af"></span>Non
							</button>
						</div>
						{#if form.mensurations === 'oui'}
							<div class="cond-block visible">
								<div class="reminder-box"><Icon name="ruler" size={16} class="reminder-icon" /> <span>Pense à encoder tes mensurations dans l'application ce week-end. Je les vérifie quand je valide ton bilan.</span></div>
							</div>
						{/if}
					</div>
					<div class="field">
						<div class="field-label">
							Sommes-nous sur ta semaine de photos ? <small style="color:var(--muted);font-weight:400">(1× par mois)</small>
						</div>
						<div class="choices">
							<button class="choice" class:selected={form.photos === 'oui'} onclick={() => pick('photos', 'oui')}>
								<span class="choice-letter">A</span> <span class="tone-dot" style="background:#22c55e"></span>Oui
							</button>
							<button class="choice" class:selected={form.photos === 'non'} onclick={() => pick('photos', 'non')}>
								<span class="choice-letter">B</span> <span class="tone-dot" style="background:#9ca3af"></span>Non
							</button>
						</div>
						{#if form.photos === 'oui'}
							<div class="cond-block visible">
								<div class="reminder-box"><Icon name="camera" size={16} class="reminder-icon" /> <span>Pense à uploader tes photos dans l'appli ce week-end. Je les regarde quand je valide ton bilan.</span></div>
							</div>
						{/if}
					</div>
				</div>
				<div class="nav">
					<button class="btn-back" onclick={() => goBack(7)}>←</button>
					<button class="btn-next" onclick={() => goNext(7)}>Suivant →</button>
				</div>
			</div>
		{/if}

		<!-- PAGE 8 — VICTOIRES & RETOUR -->
		{#if step === 8}
			<div class="page active slide-in" class:slide-in-back={direction === 'back'}>
				<div class="step-indicator">Étape 8 sur 8</div>
				<div class="step-title"><Icon name="rocket" size={22} class="step-title-icon" /> Dernière étape</div>
				<div style="margin-top:28px">
					<div class="field">
						<div class="field-label">De quoi as-tu besoin de ma part cette semaine ?</div>
						<div class="choices">
							<button class="choice" class:selected={form.besoin_retour === 'rien'} onclick={() => pickBesoin('rien')}>
								<span class="choice-letter">A</span> <Icon name="check" size={16} class="choice-icon" />Rien, tout va bien — je continue comme ça
							</button>
							<div class="cond-subtext" style="font-style:italic;font-size:12px;color:var(--muted);margin:-8px 0 8px 36px">
								Je t'enverrai un message de bonne réception sur WhatsApp, et si un point m'interpelle je t'en ferai part.
							</div>
							<button class="choice" class:selected={form.besoin_retour === 'ecrit'} onclick={() => pickBesoin('ecrit')}>
								<span class="choice-letter">B</span> <Icon name="pencil" size={16} class="choice-icon" />Un retour écrit / vidéo
							</button>
							<button class="choice" class:selected={form.besoin_retour === 'appel'} onclick={() => pickBesoin('appel')}>
								<span class="choice-letter">C</span> <Icon name="phone" size={16} class="choice-icon" />Réserver un appel ensemble pour la semaine prochaine
							</button>
						</div>
					</div>

					{#if form.besoin_retour === 'ecrit'}
						<div class="cond-block visible" id="bloc-retour-detail-ecrit" class:shake={ecritShake}>
							<div class="field">
								<div class="field-label">
									Indique-moi sur quel point tu veux un retour précisément <small style="color:var(--muted);font-weight:400">(plusieurs choix possibles)</small>
								</div>
								<div class="choices">
									<button class="choice" class:selected={form.categorie_retour.includes('alimentation')} onclick={() => toggleCategorie('alimentation')}>
										<span class="choice-letter">A</span> <Icon name="utensils" size={16} class="choice-icon" />Alimentation
									</button>
									<button class="choice" class:selected={form.categorie_retour.includes('sport')} onclick={() => toggleCategorie('sport')}>
										<span class="choice-letter">B</span> <Icon name="dumbbell" size={16} class="choice-icon" />Sport
									</button>
									<button class="choice" class:selected={form.categorie_retour.includes('motivation')} onclick={() => toggleCategorie('motivation')}>
										<span class="choice-letter">C</span> <Icon name="brain" size={16} class="choice-icon" />Motivation
									</button>
									<button class="choice" class:selected={form.categorie_retour.includes('autre')} onclick={() => toggleCategorie('autre')}>
										<span class="choice-letter">D</span> <Icon name="pencil" size={16} class="choice-icon" />Autre
									</button>
								</div>
							</div>
							<div class="field">
								<div class="field-label">
									Précise si besoin <small style="color:var(--muted);font-weight:400">(optionnel)</small>
								</div>
								<textarea bind:value={form.point_retour_ecrit} placeholder="Détaille ton besoin..."></textarea>
							</div>
						</div>
					{/if}

					{#if form.besoin_retour === 'appel'}
						<div class="cond-block visible">
							<div class="field">
								<div class="field-label">
									As-tu déjà une idée de ce dont tu veux qu'on parle ? <small style="color:var(--muted);font-weight:400">(optionnel)</small>
								</div>
								<textarea bind:value={form.point_retour_appel} placeholder="Optionnel — décris le point en quelques mots..."></textarea>
							</div>
						</div>
					{/if}

					<div class="field" style="margin-top:8px">
						<div class="field-label">
							Y a-t-il une victoire ou une fierté à partager cette semaine ? <small style="color:var(--muted);font-weight:400">(optionnel)</small>
						</div>
						<textarea bind:value={form.victoire} placeholder="Même petite, elle compte"></textarea>
					</div>

					{#if action?.error}
					<div class="info-msg" style="border-color:var(--red);background:var(--red-l);color:var(--red)">
						<Icon name="triangleAlert" size={17} class="info-msg-icon" /> <span>{action.error}</span>
					</div>
					{/if}
				</div>
				<div class="nav">
					<button class="btn-back" onclick={() => goBack(8)}>←</button>
					<form method="POST" action="?/submit" onsubmit={guardSubmit} style="flex:1;display:block">
						<input type="hidden" name="payload" value={payloadJSON} />
						<button type="submit" class="btn-next" style="width:100%">Envoyer mon bilan →</button>
					</form>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Progress */
	.progress-wrap {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 4px;
		background: var(--border);
		z-index: 100;
	}
	.progress-bar {
		height: 100%;
		background: var(--accent);
		transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
	}
	.progress-bar::after {
		content: '';
		position: absolute;
		right: 0;
		top: 0;
		width: 8px;
		height: 4px;
		background: var(--accent);
		border-radius: 0 2px 2px 0;
		box-shadow: 0 0 8px var(--accent);
	}
	.progress-pct {
		position: fixed;
		top: 10px;
		right: 16px;
		font-family: 'Oswald', sans-serif;
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		z-index: 101;
		letter-spacing: 1px;
	}

	.container {
		max-width: 540px;
		margin: 0 auto;
		padding: 56px 20px 80px;
	}

	.form-header {
		margin-bottom: 36px;
	}
	.logo-img {
		height: 44px;
		width: auto;
		margin-bottom: 24px;
		display: block;
	}

	.step-indicator {
		font-size: 11px;
		color: var(--muted);
		font-weight: 700;
		letter-spacing: 2px;
		text-transform: uppercase;
		margin-bottom: 6px;
	}
	.step-title {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: 'Oswald', sans-serif;
		font-size: 26px;
		font-weight: 600;
		line-height: 1.2;
	}
	.step-title-icon {
		color: var(--accent);
		flex-shrink: 0;
	}
	.step-subtitle {
		margin-top: 8px;
		font-size: 13px;
		color: var(--muted);
		line-height: 1.6;
	}

	@keyframes slideInRight {
		from {
			opacity: 0;
			transform: translateX(24px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	@keyframes slideInLeft {
		from {
			opacity: 0;
			transform: translateX(-24px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	.slide-in {
		animation: slideInRight 0.3s cubic-bezier(0.4, 0, 0.2, 1) both;
	}
	.slide-in-back {
		animation: slideInLeft 0.3s cubic-bezier(0.4, 0, 0.2, 1) both;
	}
	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-6px);
		}
		75% {
			transform: translateX(6px);
		}
	}
	.shake {
		animation: shake 0.3s ease;
		border-color: var(--red) !important;
	}
	@keyframes fadeUp {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.field {
		margin-bottom: 24px;
	}
	.field-label {
		font-family: 'Oswald', sans-serif;
		font-size: 15px;
		font-weight: 500;
		margin-bottom: 12px;
		line-height: 1.4;
	}

	.choices {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		border: 2px solid var(--border);
		border-radius: 12px;
		cursor: pointer;
		background: var(--card);
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		text-align: left;
		font-size: 14px;
		font-family: 'Lato', sans-serif;
		color: var(--text);
		width: 100%;
	}
	.choice:hover {
		border-color: var(--accent);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(29, 185, 84, 0.1);
	}
	.choice.selected {
		border-color: var(--accent);
		background: #f0fdf4;
		transform: translateY(-1px);
	}
	.choice-letter {
		width: 26px;
		height: 26px;
		border-radius: 8px;
		background: var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'Oswald', sans-serif;
		font-weight: 600;
		font-size: 12px;
		flex-shrink: 0;
		transition: all 0.2s;
		color: var(--muted);
	}
	.choice.selected .choice-letter {
		background: var(--accent);
		color: #fff;
	}

	/* Motivation */
	.motivation-scale {
		display: flex;
		gap: 8px;
	}
	.motivation-btn {
		flex: 1;
		padding: 14px 0;
		border: 2px solid var(--border);
		border-radius: 12px;
		background: var(--card);
		cursor: pointer;
		font-family: 'Oswald', sans-serif;
		font-weight: 600;
		font-size: 20px;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text);
	}
	.motivation-btn:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}
	.motivation-btn.e1.selected {
		background: #fff1f0;
		border-color: #ff4444;
		color: #ff4444;
	}
	.motivation-btn.e2.selected {
		background: #fff8f0;
		border-color: #ff9500;
		color: #ff9500;
	}
	.motivation-btn.e3.selected {
		background: #fffbf0;
		border-color: #f0c000;
		color: #b08000;
	}
	.motivation-btn.e4.selected {
		background: #f0fff4;
		border-color: var(--accent);
		color: var(--accent);
	}
	.motivation-btn.e5.selected {
		background: #e8fef0;
		border-color: var(--accent);
		color: var(--accent);
		box-shadow: 0 0 0 3px rgba(29, 185, 84, 0.12);
	}
	.motivation-gauge-wrap {
		margin-top: 10px;
		height: 6px;
		background: var(--border);
		border-radius: 10px;
		overflow: hidden;
	}
	.motivation-gauge-fill {
		height: 100%;
		border-radius: 10px;
		transition:
			width 0.5s cubic-bezier(0.4, 0, 0.2, 1),
			background 0.3s;
		width: 0%;
	}
	.motivation-labels {
		display: flex;
		justify-content: space-between;
		margin-top: 6px;
		font-size: 11px;
		color: var(--muted);
	}
	.motivation-labels span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.motivation-icon {
		color: var(--muted);
	}
	.tone-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 9999px;
		flex-shrink: 0;
	}
	.choice-icon {
		color: var(--accent);
		flex-shrink: 0;
	}

	textarea {
		width: 100%;
		padding: 14px 16px;
		border: 2px solid var(--border);
		border-radius: 12px;
		font-size: 14px;
		font-family: 'Lato', sans-serif;
		color: var(--text);
		background: var(--card);
		resize: none;
		outline: none;
		min-height: 90px;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
		appearance: none;
		-webkit-appearance: none;
	}
	textarea:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(29, 185, 84, 0.1);
	}

	.info-box {
		background: var(--text);
		color: white;
		border-radius: 16px;
		padding: 20px;
		margin-bottom: 20px;
		font-size: 13px;
		line-height: 1.7;
	}
	.info-box .info-title {
		font-family: 'Oswald', sans-serif;
		font-weight: 600;
		font-size: 14px;
		margin-bottom: 10px;
		color: var(--accent);
	}
	.info-box ul {
		list-style: none;
		padding: 0;
	}
	.info-box ul li {
		padding: 3px 0 3px 16px;
		position: relative;
	}
	.info-box ul li::before {
		content: '→';
		position: absolute;
		left: 0;
		color: var(--accent);
		font-size: 11px;
	}

	.reminder-box {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		background: #fffbeb;
		border: 2px solid #fde68a;
		border-radius: 12px;
		padding: 12px 16px;
		font-size: 13px;
		line-height: 1.6;
		color: #78600a;
		margin-top: 10px;
	}
	.reminder-icon {
		color: #b45309;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.cond-block {
		overflow: hidden;
		max-height: 1200px;
		opacity: 1;
	}

	.nav {
		display: flex;
		gap: 10px;
		margin-top: 28px;
	}
	.btn-next {
		flex: 1;
		padding: 16px;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 12px;
		font-family: 'Oswald', sans-serif;
		font-weight: 600;
		font-size: 16px;
		cursor: pointer;
		transition: all 0.2s;
		letter-spacing: 0.5px;
	}
	.btn-next:hover {
		background: var(--accent-dark);
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(29, 185, 84, 0.3);
	}
	.btn-next:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.btn-back {
		padding: 16px 18px;
		background: transparent;
		color: var(--muted);
		border: 2px solid var(--border);
		border-radius: 12px;
		font-family: 'Oswald', sans-serif;
		font-weight: 600;
		font-size: 16px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-back:hover {
		border-color: var(--text);
		color: var(--text);
	}

	/* Thank you */
	.thank-you {
		text-align: center;
		padding: 32px 0;
	}
	.ty-logo-wrap {
		position: relative;
		width: 120px;
		height: 120px;
		margin: 0 auto 24px;
	}
	.ty-ring {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 3px solid transparent;
		border-top-color: var(--accent);
		border-right-color: var(--accent);
		animation: spin-ring 1.5s linear infinite;
	}
	.ty-ring-2 {
		position: absolute;
		inset: 8px;
		border-radius: 50%;
		border: 2px solid transparent;
		border-bottom-color: rgba(29, 185, 84, 0.3);
		border-left-color: rgba(29, 185, 84, 0.3);
		animation: spin-ring 2.5s linear infinite reverse;
	}
	@keyframes spin-ring {
		to {
			transform: rotate(360deg);
		}
	}
	.ty-inner {
		position: absolute;
		inset: 16px;
		border-radius: 50%;
		background: #f0fdf4;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: glow-pulse 2s 1s ease-in-out infinite;
	}
	@keyframes glow-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(29, 185, 84, 0);
		}
		50% {
			box-shadow: 0 0 0 10px rgba(29, 185, 84, 0.1);
		}
	}
	.ty-logo-small {
		height: 38px;
		width: 38px;
		object-fit: contain;
		background: transparent;
		animation: fadeUp 0.4s 0.6s ease both;
		opacity: 0;
		animation-fill-mode: both;
	}
	.thank-you h2 {
		font-family: 'Oswald', sans-serif;
		font-size: 26px;
		font-weight: 700;
		margin-bottom: 12px;
		animation: fadeUp 0.4s 0.2s ease both;
	}
	.thank-you p {
		font-size: 14px;
		color: var(--muted);
		line-height: 1.7;
		max-width: 320px;
		margin: 0 auto 10px;
		animation: fadeUp 0.4s 0.3s ease both;
	}
	.info-msg {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin-top: 16px;
		background: var(--card);
		border: 2px solid var(--border);
		border-radius: 14px;
		padding: 16px;
		font-size: 13px;
		color: var(--text);
		line-height: 1.6;
		animation: fadeUp 0.4s 0.4s ease both;
	}
	.info-msg-icon {
		color: var(--accent);
		flex-shrink: 0;
		margin-top: 2px;
	}
	.info-msg.green {
		border-color: var(--accent);
		background: var(--accent-light);
	}

	.confetti-dot {
		position: fixed;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		pointer-events: none;
		z-index: 999;
	}

	.closed-page-back {
		margin-bottom: 6px;
	}
	.form-exit {
		margin-bottom: 6px;
	}
	.form-exit a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 700;
		color: var(--muted);
		padding: 8px 10px;
		border-radius: 12px;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}
	.form-exit a:hover {
		color: var(--accent-dark);
		background: var(--bg);
	}
	.closed-page {
		text-align: center;
		padding: 60px 0;
	}
	.closed-page .icon {
		display: grid;
		place-items: center;
		margin-bottom: 20px;
		color: var(--accent);
	}
	.closed-page h2 {
		font-family: 'Oswald', sans-serif;
		font-size: 22px;
		font-weight: 600;
		margin-bottom: 12px;
	}
	.closed-page p {
		font-size: 14px;
		color: var(--muted);
		line-height: 1.6;
	}

	@media (max-width: 480px) {
		.motivation-scale {
			gap: 6px;
		}
		.motivation-btn {
			font-size: 18px;
		}
	}
</style>
