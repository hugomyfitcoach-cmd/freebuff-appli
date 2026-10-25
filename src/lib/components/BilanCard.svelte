<script lang="ts">
	import { answerLines } from '../labels.js';
	import type { Doc } from '../../convex/_generated/dataModel.js';
	import CoachMedia from './CoachMedia.svelte';
	import Icon from './Icon.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import type { CoachMediaItem } from '../media.js';
	import { aiDraftActive, aiDraftBadgeFromCheckin, aiDraftFormFlag } from '../coachDraftUi.js';
	import { COACH_DRAFT_CONSENT_MISSING } from '../coachDraftError.js';

	let { checkin, clientName, clientId, media = [], draftEnabled = false, draftConsent = false } = $props<{
		checkin: Doc<'checkins'>;
		clientName: string;
		clientId: string;
		media?: CoachMediaItem[];
		/** Bouton « Préparer un brouillon » — masqué si AI_COACH_DRAFT_DISABLED. */
		draftEnabled?: boolean;
		/** Consentement assistant IA enregistré sur la fiche (M5) — sinon bouton désactivé. */
		draftConsent?: boolean;
	}>();

	const lines = $derived(answerLines(checkin));
	const recap = $derived(
		[
			`Bilan ${checkin.weekLabel} — ${clientName}`,
			'',
			...lines.map((l) => `• ${l.header} : ${l.text}`),
		].join('\n')
	);
	const submittedAt = $derived(
		new Date(checkin._creationTime).toLocaleString('fr-FR', {
			weekday: 'short',
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
		})
	);
	const feedbackSentAt = $derived(
		checkin.feedbackAt
			? new Date(checkin.feedbackAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
			: null
	);
	// « Publié » = visible côté cliente. « Brouillon » = texte enregistré mais
	// jamais publié → la cliente ne voit rien (RecapBilan masque les non publiés).
	const published = $derived(checkin.status === 'retour_envoye');
	const draft = $derived(!published && (checkin.feedback ?? '').trim().length > 0);

	let copyFlash = $state(false);

	/* ── Brouillon assisté (M1) — le texte reste dans le champ, modifiable. ──
	   La génération est LECTURE SEULE côté serveur : seuls les boutons
	   « Sauvegarder le brouillon » / « Publier le retour » écrivent le retour.
	   En cas d'erreur, `feedback` n'est jamais touché : le texte déjà saisi
	   reste intact. */
	let feedback = $state(checkin.feedback ?? '');
	let draftLoading = $state(false);
	let draftError = $state('');
	/* Cause lisible renvoyée par le BFF (clé invalide, crédit épuisé, modèle
	   refusé, délai dépassé, assistant désactivé, erreur inattendue). */
	let draftServerMessage = '';
	// Confirmation G-FLUX (jamais `window.confirm`) : le texte existant reste
	// intact tant que « Remplacer » n'a pas été cliqué.
	let replaceOpen = $state(false);

	/* Le badge est PERSISTÉ avec le brouillon (`checkins.feedbackAiDraft`), donc
	   il survit à un rechargement. `aiDraftSource` garde le texte EXACT préparé
	   par l'IA (serveur ou session courante) : toute modification du champ fait
	   disparaître le badge immédiatement, sans attendre l'enregistrement. */
	let aiDraftSource = $state<string | null>(
		aiDraftBadgeFromCheckin(checkin) ? (checkin.feedback ?? '') : null
	);
	// Dès la PREMIÈRE frappe, le badge est éteint pour de bon (revenir au texte
	// d'origine via un « annuler » ne le rallume pas).
	let aiDraftTouched = $state(false);
	const aiDraftBadge = $derived(!published && aiDraftActive(aiDraftSource, feedback, aiDraftTouched));
	const aiDraftFlag = $derived(aiDraftFormFlag(aiDraftSource, feedback, published, aiDraftTouched));

	// Champ auto-extensible : hauteur mesurée sur le contenu entre 96 et 320 px,
	// puis défilement interne. La mesure et l'application se font dans la même
	// tâche → aucun saut de mise en page visible à la frappe (desktop et mobile).
	const FEEDBACK_MIN_PX = 96;
	const FEEDBACK_MAX_PX = 320;
	let feedbackEl = $state<HTMLTextAreaElement | null>(null);

	function fitFeedback() {
		const el = feedbackEl;
		if (!el) return;
		el.style.height = 'auto';
		const next = Math.max(FEEDBACK_MIN_PX, Math.min(el.scrollHeight, FEEDBACK_MAX_PX));
		el.style.height = `${next}px`;
		el.style.overflowY = el.scrollHeight > FEEDBACK_MAX_PX ? 'auto' : 'hidden';
	}

	// Réagit aux frappes ET aux changements programmatiques (injection d'un
	// brouillon, restauration après erreur) ; `resize` couvre la rotation et
	// l'apparition du clavier virtuel sur iOS/Android.
	$effect(() => {
		const text = feedback;
		if (aiDraftSource !== null && text !== aiDraftSource) aiDraftTouched = true;
		feedbackEl;
		fitFeedback();
	});

	function requestDraft() {
		if (draftLoading) return;
		// Un texte déjà présent (saisi ou brouillon précédent) ne disparaît pas
		// sans accord explicite — modale G-FLUX, pas de confirm natif.
		if (feedback.trim()) {
			replaceOpen = true;
			return;
		}
		void generateDraft();
	}

	function cancelReplace() {
		// Annuler ne touche JAMAIS au texte : on ferme, c'est tout.
		replaceOpen = false;
	}

	function confirmReplace() {
		replaceOpen = false;
		void generateDraft();
	}

	async function generateDraft() {
		if (draftLoading) return;
		draftLoading = true;
		draftError = '';
		draftServerMessage = '';
		try {
			const res = await fetch('/api/coach/draft', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ checkinId: checkin._id }),
			});
			const data = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
			if (!res.ok || typeof data.text !== 'string' || !data.text.trim()) {
				// Le serveur renvoie déjà une cause en clair, jamais un détail technique.
				draftServerMessage = typeof data.error === 'string' ? data.error.trim() : '';
				throw new Error('draft-failed');
			}
			// Seul point qui remplace le texte — uniquement après un succès.
			feedback = data.text.trim();
			// Nouveau texte de référence : le badge reste tant qu'il n'est pas
			// modifié, puis il sera persisté par « Sauvegarder le brouillon ».
			aiDraftSource = feedback;
			aiDraftTouched = false;
		} catch {
			draftError = draftServerMessage
				? `${draftServerMessage} Ton texte actuel est conservé.`
				: "Le brouillon n'a pas pu être préparé. Ton texte actuel est conservé.";
		} finally {
			draftLoading = false;
		}
	}

	/* ── Vérification du contexte (M2) — COACH UNIQUEMENT, lecture seule. ──
	   Le lien discret ouvre le contexte ASSEMBLÉ qui part dans le prompt
	   (route BFF coach → query Convex coach + appartenance). Jamais côté
	   cliente : la vue cliente n’appelle ni cette route ni cette query. */
	let contextOpen = $state(false);
	let contextLoading = $state(false);
	let contextError = $state('');
	let contextData = $state<unknown>(null);

	async function toggleContext() {
		contextOpen = !contextOpen;
		if (!contextOpen || contextData !== null) return;
		contextLoading = true;
		contextError = '';
		try {
			const res = await fetch(`/api/coach/draft/context?checkinId=${encodeURIComponent(checkin._id)}`);
			const data = (await res.json().catch(() => ({}))) as { context?: unknown };
			if (!res.ok || !data.context) throw new Error('context-failed');
			contextData = data.context;
		} catch {
			contextError = 'Les données du bilan n’ont pas pu être chargées.';
		} finally {
			contextLoading = false;
		}
	}

	async function copyRecap() {
		try {
			await navigator.clipboard.writeText(recap);
			copyFlash = true;
			window.setTimeout(() => (copyFlash = false), 1600);
		} catch {
			/* presse-papiers refusé : on laisse le bouton silencieux */
		}
	}
</script>

<article class="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
	<!-- En-tête du bilan -->
	<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
		<div>
			<div class="flex items-center gap-2">
				<h3 class="font-display text-base font-semibold text-ink">{checkin.weekLabel}</h3>
				{#if published}
					<span class="rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-dark">Retour envoyé</span>
				{:else if draft}
					<span class="inline-flex items-center gap-1 rounded-full bg-line/70 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-mist"><Icon name="pencil" size={11} /> Brouillon</span>
				{:else}
					<span class="rounded-full bg-warn-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn">À traiter</span>
				{/if}
			</div>
			<p class="mt-0.5 text-xs text-mist">Reçu {submittedAt}{feedbackSentAt ? ` · publié le ${feedbackSentAt}` : ''}</p>
		</div>
		<button
			type="button"
			onclick={copyRecap}
			class="rounded-lg border-2 border-line px-3 py-1.5 text-sm text-ink transition hover:border-brand hover:text-brand"
		>{copyFlash ? '✓ Copié !' : 'Copier le récap'}</button>
	</div>

	<!-- Réponses -->
	<div class="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-2">
		{#each lines as line}
			<div>
				<div class="text-[11px] font-bold uppercase tracking-wide text-mist">{line.header}</div>
				<div class="mt-0.5 text-sm text-ink">{line.text}</div>
			</div>
		{/each}
		{#if lines.length === 0}
			<p class="text-sm italic text-mist">Aucune réponse enregistrée pour cette semaine.</p>
		{/if}
	</div>

	<!-- Rédaction du retour coach — l'action préserve la Vision 360 ouverte
	     (client + section bilans dans l'URL de destination). -->
	<form method="POST" action="?/setFeedback&client={clientId}&section=bilans" class="border-t border-line bg-cream/50 px-5 py-4">
		<input type="hidden" name="checkinId" value={checkin._id} />
		<input type="hidden" name="clientId" value={clientId} />
		<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-sm font-semibold text-ink">Ton retour (visible par la cliente dans son historique)</span>
				{#if aiDraftBadge}
					<span class="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-dark">
						<Icon name="sparkles" size={11} /> Brouillon IA — à relire
					</span>
				{/if}
			</div>
			{#if draftEnabled}
				{#if draftConsent}
					<button
						type="button"
						onclick={requestDraft}
						disabled={draftLoading}
						aria-busy={draftLoading}
						class="inline-flex items-center gap-1.5 rounded-lg border-2 border-brand/40 bg-brand-light/60 px-3 py-1.5 text-xs font-bold text-brand-dark transition hover:border-brand disabled:cursor-wait disabled:opacity-60"
					>
						<Icon name="sparkles" size={13} />
						{draftLoading ? 'Préparation du brouillon…' : aiDraftSource !== null ? 'Régénérer' : 'Préparer un brouillon'}
					</button>
				{:else}
					<!-- Consentement non enregistré : bouton présent mais DÉSACTIVÉ,
						 avec le texte exact exigé — aucune génération possible. -->
					<button
						type="button"
						disabled
						aria-disabled="true"
						title={COACH_DRAFT_CONSENT_MISSING}
						class="inline-flex items-center gap-1.5 rounded-lg border-2 border-line bg-cream px-3 py-1.5 text-xs font-bold text-mist disabled:cursor-not-allowed disabled:opacity-60"
					>
						<Icon name="sparkles" size={13} /> Préparer un brouillon
					</button>
				{/if}
			{/if}
		</div>
		{#if draftEnabled && !draftConsent}
			<p class="mb-2 rounded-lg border border-warn/40 bg-warn-light/60 px-3 py-1.5 text-xs font-semibold text-warn">{COACH_DRAFT_CONSENT_MISSING}</p>
		{/if}
		{#if draftError}
			<p class="mb-2 rounded-lg border border-warn/40 bg-warn-light/60 px-3 py-1.5 text-xs font-semibold text-warn">{draftError}</p>
		{/if}
		<!-- Lien discret de vérification (M2) — contexte assemblé pour l’assistant. -->
		<div class="mb-2">
			<button
				type="button"
				onclick={toggleContext}
				class="text-[11px] font-medium text-mist underline decoration-dotted underline-offset-2 transition hover:text-ink"
			>
				{contextOpen ? 'Masquer les données envoyées à l’assistant' : 'Voir les données envoyées à l’assistant'}
			</button>
			{#if contextOpen}
				{#if contextLoading}
					<p class="mt-2 text-xs text-mist">Chargement des données…</p>
				{:else if contextError}
					<p class="mt-2 rounded-lg border border-warn/40 bg-warn-light/60 px-3 py-1.5 text-xs font-semibold text-warn">{contextError}</p>
				{:else if contextData !== null}
					<pre class="mt-2 max-h-72 overflow-auto rounded-xl border border-line bg-white px-3 py-2 text-[11px] leading-relaxed text-ink">{JSON.stringify(contextData, null, 2)}</pre>
				{/if}
			{/if}
		</div>
		<textarea
			bind:this={feedbackEl}
			name="feedback"
			bind:value={feedback}
			oninput={fitFeedback}
			rows="3"
			placeholder="Rédige ici ton retour pour cette semaine — la cliente ne le verra qu'après publication…"
			class="min-h-24 max-h-[320px] w-full resize-none overflow-hidden rounded-xl border-2 border-line bg-white px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
		></textarea>
		<input type="hidden" name="aiDraft" value={aiDraftFlag ? '1' : '0'} />
		<!-- Retour audio + pièces jointes : en brouillon tant que le retour n'est pas publié -->
		<div class="mt-3 rounded-xl border border-dashed border-line bg-white/40 p-3">
			<p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-mist"><Icon name="mic" size={12} /> Retour audio & <Icon name="paperclip" size={12} /> pièces jointes (optionnels)</p>
			<CoachMedia
				mode="feedback"
				userId={clientId}
				checkinId={checkin._id}
				existing={media}
				allowAudio
				allowAttachments
			/>
		</div>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<button
				type="submit"
				name="status"
				value="nouveau"
				class="rounded-xl border-2 border-line bg-card px-4 py-2 text-sm font-semibold text-ink transition hover:border-warn hover:text-warn"
			>
				<span class="inline-flex items-center gap-1.5"><Icon name={published ? 'undo2' : 'save'} size={15} />{published ? 'Repasser en brouillon' : 'Sauvegarder le brouillon'}</span>
			</button>
			<button
				type="submit"
				name="status"
				value="retour_envoye"
				class="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
			>
				<span class="inline-flex items-center gap-1.5"><Icon name="rocket" size={15} />{published ? 'Republier le retour' : 'Publier le retour'}</span>
			</button>
		</div>
		<p class="mt-2 text-xs text-mist">
			Un brouillon reste invisible pour la cliente. « Publier le retour » le lui envoie et affiche son
			badge jusqu'à ce qu'elle l'ait réellement ouvert.
		</p>
	</form>

	<ConfirmDialog
		open={replaceOpen}
		title="Remplacer le texte actuel ?"
		message="Le brouillon préparé par l'IA remplacera le texte présent dans le champ. Ton texte actuel ne sera pas conservé."
		confirmLabel="Remplacer"
		cancelLabel="Annuler"
		onCancel={cancelReplace}
		onConfirm={confirmReplace}
	/>
</article>
