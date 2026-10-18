<script lang="ts">
	import { answerLines } from '../labels.js';
	import type { Doc } from '../../convex/_generated/dataModel.js';
	import CoachMedia from './CoachMedia.svelte';
	import Icon from './Icon.svelte';
	import type { CoachMediaItem } from '../media.js';

	let { checkin, clientName, clientId, media = [], draftEnabled = false } = $props<{
		checkin: Doc<'checkins'>;
		clientName: string;
		clientId: string;
		media?: CoachMediaItem[];
		/** Bouton « Préparer un brouillon » — masqué si AI_COACH_DRAFT_DISABLED. */
		draftEnabled?: boolean;
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
	let draftGenerated = $state(false);
	let draftError = $state('');

	async function generateDraft() {
		if (draftLoading) return;
		// Un texte déjà présent (saisi ou brouillon précédent) ne disparaît pas
		// sans accord explicite.
		if (feedback.trim()) {
			const replace = window.confirm(
				'Remplacer le texte actuel par un brouillon ? Ton texte actuel sera remplacé dans le champ.'
			);
			if (!replace) return;
		}
		draftLoading = true;
		draftError = '';
		try {
			const res = await fetch('/api/coach/draft', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ checkinId: checkin._id }),
			});
			const data = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
			if (!res.ok || typeof data.text !== 'string' || !data.text.trim()) {
				throw new Error('draft-failed');
			}
			// Seul point qui remplace le texte — uniquement après un succès.
			feedback = data.text.trim();
			draftGenerated = true;
		} catch {
			draftError = "Le brouillon n'a pas pu être préparé. Ton texte actuel est conservé.";
		} finally {
			draftLoading = false;
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
				{#if draftGenerated}
					<span class="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-dark">
						<Icon name="sparkles" size={11} /> Brouillon IA — à relire
					</span>
				{/if}
			</div>
			{#if draftEnabled}
				<button
					type="button"
					onclick={generateDraft}
					disabled={draftLoading}
					class="inline-flex items-center gap-1.5 rounded-lg border-2 border-brand/40 bg-brand-light/60 px-3 py-1.5 text-xs font-bold text-brand-dark transition hover:border-brand disabled:cursor-wait disabled:opacity-60"
				>
					<Icon name="sparkles" size={13} />
					{draftLoading ? 'Préparation…' : draftGenerated ? 'Régénérer' : 'Préparer un brouillon'}
				</button>
			{/if}
		</div>
		{#if draftError}
			<p class="mb-2 rounded-lg border border-warn/40 bg-warn-light/60 px-3 py-1.5 text-xs font-semibold text-warn">{draftError}</p>
		{/if}
		<textarea
			name="feedback"
			bind:value={feedback}
			placeholder="Rédige ici ton retour pour cette semaine — la cliente ne le verra qu'après publication…"
			class="min-h-24 w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
		></textarea>
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
</article>
