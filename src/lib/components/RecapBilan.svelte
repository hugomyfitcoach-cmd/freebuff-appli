<script lang="ts">
	import { answerLines } from '../labels.js';
	import type { Doc } from '../../convex/_generated/dataModel.js';
	import AudioPlayer from './AudioPlayer.svelte';
	import Icon from './Icon.svelte';
	import { fmtMs, fmtSize, type CoachMediaItem } from '../media.js';

	let {
		checkin,
		media = [],
	}: {
		checkin: Doc<'checkins'>;
		media?: CoachMediaItem[];
	} = $props();

	const lines = $derived(answerLines(checkin));
	const submittedAt = $derived(
		new Date(checkin._creationTime).toLocaleString('fr-FR', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
		})
	);
	// « Nouveau retour » tant que la cliente n'a pas consulté la publication.
	const unread = $derived(
		checkin.status === 'retour_envoye' &&
			(checkin.feedbackReadAt == null || checkin.feedbackReadAt < (checkin.feedbackAt ?? checkin._creationTime))
	);
	const audios = $derived(media.filter((m) => m.kind === 'audio'));
	const attachments = $derived(media.filter((m) => m.kind !== 'audio'));
	const published = $derived(checkin.status === 'retour_envoye');

	/** Première écoute réelle d'un retour audio → déclenche la rétention 72 h. */
	async function listen(mediaId: string) {
		try {
			await fetch('/api/media/listen', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaId }),
			});
		} catch {
			/* silencieux */
		}
	}
</script>

<article class="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
	<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
		<div>
			<div class="flex items-center gap-2">
				<h3 class="font-display text-base font-semibold text-ink">{checkin.weekLabel}</h3>
				{#if published}
					<span class="rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-dark">Retour reçu</span>
					{#if unread}
						<span class="rounded-full bg-warn px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Nouveau retour</span>
					{/if}
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

	<!-- Retour de la coach : texte + éventuel retour audio + pièces jointes -->
	<div class="border-t border-line bg-cream/50 px-5 py-4">
		{#if published}
			<div class="flex items-start gap-3">
				<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-lg">💬</div>
				<div class="min-w-0 flex-1">
					<div class="text-xs font-bold uppercase tracking-wide text-mist">Retour de ta coach</div>
					{#if checkin.feedback}
						<p class="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{checkin.feedback}</p>
					{/if}
					{#if !checkin.feedback && audios.length === 0}
						<p class="mt-1 text-sm text-mist">Retour envoyé sur WhatsApp.</p>
					{/if}

					<!-- Retours audio : lecteur simple ; un fichier expiré n'affiche jamais de lecteur cassé -->
					{#each audios as a (a._id)}
						<div class="mt-3 rounded-xl border border-line bg-white p-3">
							<div class="mb-1.5 flex items-center justify-between">
								<span class="inline-flex items-center gap-1.5 text-xs font-bold text-ink"><Icon name="mic" size={13} /> Retour audio de ton coach · {fmtMs(a.durationMs)}</span>
								{#if a.expired || a.status === 'expired' || !a.url}
									<span class="rounded-full bg-line/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-mist">expiré</span>
								{/if}
							</div>
							{#if a.url && !a.expired && a.status !== 'expired'}
								<AudioPlayer src={a.url} durationMs={a.durationMs} onFirstPlay={() => listen(a._id)} />
								<p class="mt-1.5 text-[11px] italic text-mist">Ce fichier sera supprimé automatiquement 72 h après ta première écoute (14 j maximum).</p>
							{:else}
								<p class="text-xs italic text-mist">🔇 Retour audio expiré — il a été supprimé automatiquement, mais ton bilan et ce texte restent disponibles.</p>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<!-- Pièces jointes (conservées dans l'historique) -->
			{#if attachments.length > 0}
				<div class="mt-4">
					<div class="text-[11px] font-bold uppercase tracking-wide text-mist">Pièces jointes</div>
					<div class="mt-2 grid gap-2 sm:grid-cols-2">
						{#each attachments as att (att._id)}
							<div class="flex items-center gap-3 rounded-xl border border-line bg-white p-2.5">
								{#if att.kind === 'image' && att.url}
									<a href={att.url} target="_blank" rel="noopener" class="shrink-0" aria-label="Agrandir l'image">
										<img src={att.url} alt={att.name} class="h-16 w-16 rounded-lg border border-line object-cover" loading="lazy" />
									</a>
								{:else}
									<span class="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-brand-light text-2xl">📄</span>
								{/if}
								<div class="min-w-0 flex-1">
									<p class="truncate text-xs font-semibold text-ink">{att.name}</p>
									<p class="text-[11px] text-mist">{att.kind === 'image' ? '🖼️ Image' : '📄 PDF'} · {fmtSize(att.size)}</p>
								</div>
								{#if att.url}
									<a href={att.url} target="_blank" rel="noopener" class="shrink-0 rounded-lg border-2 border-line px-2.5 py-1.5 text-xs font-bold text-ink transition hover:border-brand hover:text-brand">
										{att.kind === 'image' ? 'Voir' : 'Ouvrir'}
									</a>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{:else}
			<p class="text-sm italic text-mist">💬 Le retour de ta coach arrivera en fin de semaine.</p>
		{/if}
	</div>
</article>
