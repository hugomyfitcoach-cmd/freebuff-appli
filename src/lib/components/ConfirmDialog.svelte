<script lang="ts">
	/**
	 * CONFIRMATION AUX COULEURS DE G-FLUX — remplace `window.confirm` natif.
	 *
	 * Feuille ancrée en bas sur mobile, boîte centrée sur desktop, mêmes
	 * transitions et mêmes jetons de couleur que les feuilles de saisie de
	 * l'application (`sheetMotion`). Le focus part sur « Annuler » : une
	 * action destructive ne se déclenche jamais sur une touche Entrée réflexe.
	 * Échap et clic sur le fond annulent (le texte existant n'est jamais perdu).
	 *
	 * Confirmation obligatoire avant une action engageante (ex. « Appliquer à
	 * la fiche » de l'onglet Calibrage) :
	 *  - la confirmation n'est JAMAIS appelée sans clic explicite, et reste
	 *    inerte pendant `busy` (écriture en cours) ;
	 *  - l'annulation (bouton, Échap, fond) ne fait QUE fermer — aucune
	 *    écriture ne part de l'annulation.
	 *
	 * Les deux orthographes de callback coexistent dans l'application
	 * (`onConfirm`/`onCancel` pour la carte bilan, `onconfirm`/`oncancel` pour
	 * le calibrage) : les deux sont acceptées.
	 */
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import { sheetFade, sheetFly } from '../sheetMotion.js';

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
		onConfirm: onConfirmProp,
		onCancel: onCancelProp,
		children,
	}: {
		open?: boolean;
		title?: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
		busy?: boolean;
		onconfirm?: () => void;
		oncancel?: () => void;
		onConfirm?: () => void;
		onCancel?: () => void;
		children?: import('svelte').Snippet;
	} = $props();

	// Une seule implémentation pour les deux conventions d'appel.
	const onConfirm = $derived(onConfirmProp ?? onconfirm ?? (() => {}));
	const onCancel = $derived(onCancelProp ?? oncancel ?? (() => {}));

	const titleId = $props.id();
	const messageId = `${titleId}-message`;

	let cancelButton = $state<HTMLButtonElement>();
	let confirmButton = $state<HTMLButtonElement>();

	// Le focus entre dans la modale à l'ouverture et revient au déclencheur
	// à la fermeture (clavier et lecteurs d'écran restent dans le contexte).
	$effect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		cancelButton?.focus();
		return () => previous?.focus?.();
	});

	function onKeydown(event: KeyboardEvent) {
		if (!open || busy) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			onCancel();
			return;
		}
		// Piège à focus simple : deux boutons seulement, aucun ne s'échappe.
		if (event.key === 'Tab') {
			event.preventDefault();
			if (document.activeElement === cancelButton) confirmButton?.focus();
			else cancelButton?.focus();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div
		role="presentation"
		transition:fade={sheetFade()}
		class="fixed inset-0 z-[90] flex items-end justify-center bg-[#0F1512]/45 backdrop-blur-sm sm:items-center sm:p-6"
		onclick={(event) => {
			if (event.target === event.currentTarget) onCancel();
		}}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={message ? messageId : undefined}
			transition:fly={sheetFly()}
			class="w-full max-w-sm rounded-t-[28px] border border-line bg-card px-5 pt-5 shadow-[0_-20px_50px_-20px_rgba(15,21,18,0.35)] sm:rounded-[28px]"
			style="padding-bottom: max(env(safe-area-inset-bottom), 20px);"
		>
			<div class="flex items-start gap-3">
				<span
					class="grid h-11 w-11 shrink-0 place-items-center rounded-2xl {danger
						? 'bg-danger-light text-danger'
						: 'bg-brand-light text-brand-deep'}"
				>
					<Icon name={danger ? 'triangleAlert' : 'sparkles'} size={20} />
				</span>
				<div class="min-w-0 flex-1">
					<h2 id={titleId} class="font-display text-[17px] font-black leading-tight tracking-[-0.01em] text-ink">
						{title}
					</h2>
					{#if message}
						<p id={messageId} class="mt-1 text-[13px] leading-relaxed text-mist">{message}</p>
					{/if}
				</div>
			</div>

			{#if children}
				<div class="mt-3">{@render children()}</div>
			{/if}

			<div class="mt-5 flex gap-2">
				<button
					bind:this={cancelButton}
					type="button"
					onclick={() => !busy && onCancel()}
					disabled={busy}
					class="flex-1 rounded-xl border-2 border-line bg-card px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-mist focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-60"
				>
					{cancelLabel}
				</button>
				<button
					bind:this={confirmButton}
					type="button"
					onclick={() => !busy && onConfirm()}
					disabled={busy}
					aria-busy={busy}
					class="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60 {danger
						? 'bg-danger hover:brightness-95'
						: 'bg-brand hover:bg-brand-dark'}"
				>
					{#if busy}En cours…{:else}{confirmLabel}{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
