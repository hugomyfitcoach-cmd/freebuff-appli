<script lang="ts">
	import { answerLines } from '../labels.js';
	import type { Doc } from '../../convex/_generated/dataModel.js';

	let { checkin, clientName, clientId } = $props<{
		checkin: Doc<'checkins'>;
		clientName: string;
		clientId: string;
	}>();

	const lines = $derived(answerLines(checkin));
	const recap = $derived(
		[
			`📋 Bilan ${checkin.weekLabel} — ${clientName}`,
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

	let copyFlash = $state(false);

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
				{#if checkin.status === 'nouveau'}
					<span class="rounded-full bg-warn-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn">À traiter</span>
				{:else}
					<span class="rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-dark">Retour envoyé</span>
				{/if}
			</div>
			<p class="mt-0.5 text-xs text-mist">Reçu {submittedAt}{feedbackSentAt ? ` · retour envoyé le ${feedbackSentAt}` : ''}</p>
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

	<!-- Éditeur du retour coach (POST vers /admin?/setFeedback) -->
	<form method="POST" action="/admin?/setFeedback" class="border-t border-line bg-cream/50 px-5 py-4">
		<input type="hidden" name="checkinId" value={checkin._id} />
		<input type="hidden" name="clientId" value={clientId} />
		<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
			<span class="text-sm font-semibold text-ink">Ton retour (visible par la cliente dans son historique)</span>
			<div class="flex overflow-hidden rounded-lg border-2 border-line text-sm" role="radiogroup" aria-label="Statut du retour">
				<label class="cursor-pointer">
					<input type="radio" name="status" value="nouveau" checked={checkin.status === 'nouveau'} class="peer sr-only" />
					<span class="block bg-card px-3 py-1.5 text-ink transition peer-checked:bg-ink peer-checked:text-white">À traiter</span>
				</label>
				<label class="cursor-pointer">
					<input type="radio" name="status" value="retour_envoye" checked={checkin.status === 'retour_envoye'} class="peer sr-only" />
					<span class="block bg-card px-3 py-1.5 text-ink transition peer-checked:bg-brand peer-checked:text-white">Retour envoyé</span>
				</label>
			</div>
		</div>
		<textarea
			name="feedback"
			placeholder="Rédige ici ton retour pour cette semaine — le client le verra dans « Mes bilans »…"
			class="min-h-24 w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
		>{checkin.feedback ?? ''}</textarea>
		<div class="mt-2 flex items-center gap-3">
			<button type="submit" class="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark">
				Enregistrer le retour
			</button>
			<span class="text-xs text-mist">Passer à « Retour envoyé » verrouille le bilan pour cette semaine.</span>
		</div>
	</form>
</article>
