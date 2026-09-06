<script lang="ts">
	import { answerLines } from '../labels.js';
	import type { Doc } from '../../convex/_generated/dataModel.js';

	let { checkin } = $props<{ checkin: Doc<'checkins'> }>();

	const lines = $derived(answerLines(checkin));
	const submittedAt = $derived(
		new Date(checkin._creationTime).toLocaleString('fr-FR', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
		})
	);
</script>

<article class="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
	<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
		<div>
			<div class="flex items-center gap-2">
				<h3 class="font-display text-base font-semibold text-ink">{checkin.weekLabel}</h3>
				{#if checkin.status === 'retour_envoye'}
					<span class="rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-dark">Retour reçu</span>
				{:else}
					<span class="rounded-full bg-warn-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn">Bilan reçu</span>
				{/if}
			</div>
			<p class="mt-0.5 text-xs text-mist">Envoyé le {submittedAt}</p>
		</div>
	</div>

	{#if lines.length > 0}
		<div class="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-2">
			{#each lines as line}
				<div>
					<div class="text-[11px] font-bold uppercase tracking-wide text-mist">{line.header}</div>
					<div class="mt-0.5 text-sm text-ink">{line.text}</div>
				</div>
			{/each}
		</div>
	{:else}
		<p class="px-5 py-4 text-sm italic text-mist">Aucune réponse enregistrée pour cette semaine.</p>
	{/if}

	<!-- Retour de la coach -->
	<div class="border-t border-line bg-cream/50 px-5 py-4">
		{#if checkin.status === 'retour_envoye'}
			<div class="flex items-start gap-3">
				<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-lg">💬</div>
				<div class="min-w-0 flex-1">
					<div class="text-xs font-bold uppercase tracking-wide text-mist">Retour de ta coach</div>
					<p class="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">
						{checkin.feedback || 'Retour envoyé sur WhatsApp.'}
					</p>
				</div>
			</div>
		{:else}
			<p class="text-sm italic text-mist">💬 Le retour de ta coach arrivera en fin de semaine.</p>
		{/if}
	</div>
</article>
