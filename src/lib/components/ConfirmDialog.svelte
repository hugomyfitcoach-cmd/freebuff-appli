<script lang="ts">
	/**
	 * ConfirmDialog — confirmation obligatoire avant une action engageante
	 * (ex. « Appliquer à la fiche » de l'onglet Calibrage). Vue épurée,
	 * accessible (role dialog + aria-modal), mobile et desktop :
	 *  - `onconfirm` n'est JAMAIS appelé sans clic explicite sur « Confirmer » ;
	 *  - `oncancel` (et le bouton d'annulation / la touche Échap) ne fait QUE
	 *    fermer — aucune écriture ne part de l'annulation.
	 */
	import Icon from './Icon.svelte';

	let {
		open = false,
		title = 'Confirmer',
		message = '',
		confirmLabel = 'Confirmer',
		cancelLabel = 'Annuler',
		danger = false,
		busy = false,
		onconfirm,
		oncancel,
		children
	}: {
		open?: boolean;
		title?: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
		children?: import('svelte').Snippet;
	} = $props();

	function onKey(e: KeyboardEvent) {
		if (!open || busy) return;
		if (e.key === 'Escape') oncancel();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<button
		type="button"
		class="fixed inset-0 z-[90] cursor-pointer bg-ink/45 backdrop-blur-[2px]"
		aria-label="Fermer"
		onclick={() => !busy && oncancel()}
	></button>
	<div
		class="fixed inset-x-4 top-1/2 z-[91] mx-auto max-w-sm -translate-y-1/2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
		role="dialog"
		aria-modal="true"
		aria-label={title}
	>
		<div class="rounded-2xl bg-white p-5 shadow-2xl">
			<h4 class="flex items-center gap-2.5 font-display text-base font-bold text-ink">
				<span
					class="grid h-8 w-8 shrink-0 place-items-center rounded-xl {danger
						? 'bg-danger-light text-danger'
						: 'bg-brand-light text-brand-deep'}"
				>
					<Icon name={danger ? 'triangleAlert' : 'check'} size={15} />
				</span>
				{title}
			</h4>
			{#if message}
				<p class="mt-2 text-sm leading-relaxed text-ink">{message}</p>
			{/if}
			{#if children}
				<div class="mt-3">{@render children()}</div>
			{/if}
			<div class="mt-4 flex gap-2">
				<button
					type="button"
					onclick={() => !busy && oncancel()}
					disabled={busy}
					class="flex-1 rounded-full border-2 border-line px-3 py-2.5 text-sm font-bold text-ink transition hover:border-mist disabled:opacity-60"
				>
					{cancelLabel}
				</button>
				<button
					type="button"
					onclick={() => onconfirm()}
					disabled={busy}
					class="flex-1 rounded-full px-3 py-2.5 text-sm font-bold text-white transition disabled:opacity-60 {danger
						? 'bg-danger hover:brightness-95'
						: 'bg-brand hover:bg-brand-dark'}"
				>
					{busy ? 'En cours…' : confirmLabel}
				</button>
			</div>
		</div>
	</div>
{/if}
