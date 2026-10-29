<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { lockScroll, unlockScroll } from '$lib/scrollLock';
	import {
		freezeSheetForExit,
		onSheetExitEnd,
		sheetFade,
		sheetFadeOut,
		sheetFly,
		sheetFlyOut
	} from '$lib/sheetMotion';
	import { checkWeightKg, parseWeightKg, saveWeightKg } from '$lib/weightLog';

	/* Saisie rapide du poids depuis l'Accueil : feuille compacte, clavier décimal,
	   enregistrement via le flux existant (saveWeightKg → /api/metrics). Une seule
	   pesée par date : si elle existe déjà, la feuille propose de la modifier. */

	let {
		open,
		date,
		lastKg,
		lastDate,
		onClose,
		onSaved,
	}: {
		open: boolean;
		/** Date de la pesée (aujourd'hui, date locale). */
		date: string;
		/** Dernier poids connu (indicatif). */
		lastKg: number | null;
		lastDate: string | null;
		onClose: () => void;
		onSaved: (kg: number, date: string) => void | Promise<void>;
	} = $props();

	let value = $state('');
	let saving = $state(false);
	let done = $state(false);
	let error = $state('');

	/* Verrou de défilement + géométrie figée (mécanisme partagé des volets). */
	let panel = $state<HTMLElement | null>(null);
	let verrouille = false;
	let annulerLiberation: (() => void) | null = null;

	const fmtKg = (n: number) => String(n).replace('.', ',');
	const isToday = $derived(lastDate === date && lastKg !== null);
	const dateLabel = $derived(
		`Aujourd'hui · ${new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`
	);
	const lastLabel = $derived(
		lastKg !== null && lastDate
			? `Dernière pesée : ${fmtKg(lastKg)} kg · ${new Date(lastDate + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
			: 'Première pesée enregistrée ici.'
	);

	/* À chaque ouverture : saisie vide, ou valeur du jour pré-remplie pour modification.
	   untrack : ne réinitialise pas la saisie quand les données de l'Accueil changent. */
	$effect(() => {
		if (!open) return;
		untrack(() => {
			value = isToday && lastKg !== null ? fmtKg(lastKg) : '';
			saving = false;
			done = false;
			error = '';
		});
	});

	/* Fermeture : la géométrie du volet est figée AVANT le premier frame de
	   sortie (hauteur, marge safe-area en pixels) et le verrou n'est rendu au
	   document qu'APRÈS la fin du fondu. Pendant l'animation, le body reste
	   `position: fixed` : plus de recalcul de mise en page, donc plus de saut
	   du contenu ni de fond assombri qui réapparaît. */
	function requestClose() {
		if (saving || !open) return;
		const rendreStyles = freezeSheetForExit(panel);
		annulerLiberation?.();
		annulerLiberation = onSheetExitEnd(panel, () => {
			annulerLiberation = null;
			rendreStyles();
			if (verrouille) {
				verrouille = false;
				unlockScroll();
			}
		});
		onClose();
	}

	/* Ouverture (ou réouverture pendant la sortie) : verrou posé une seule fois,
	   libération en attente annulée. */
	$effect(() => {
		if (!open) return;
		annulerLiberation?.();
		annulerLiberation = null;
		if (verrouille) return;
		verrouille = true;
		lockScroll();
	});

	/* Filet : fermeture décidée par le parent, jamais passée par requestClose(). */
	$effect(() => {
		if (open || !verrouille || annulerLiberation) return;
		annulerLiberation = onSheetExitEnd(panel, () => {
			annulerLiberation = null;
			if (!verrouille) return;
			verrouille = false;
			unlockScroll();
		});
	});

	onDestroy(() => {
		annulerLiberation?.();
		annulerLiberation = null;
		if (!verrouille) return;
		verrouille = false;
		unlockScroll();
	});

	async function submit() {
		// Anti double-enregistrement : un seul envoi à la fois, et plus jamais après succès.
		if (saving || done) return;
		const kg = parseWeightKg(value);
		const msg = checkWeightKg(kg);
		if (kg === undefined || msg) {
			error = msg ?? 'Saisis ton poids en kg.';
			return;
		}
		saving = true;
		error = '';
		try {
			await saveWeightKg(date, kg);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			saving = false;
			return;
		}
		saving = false;
		done = true;
		try {
			await onSaved(kg, date);
		} catch {
			// La pesée est enregistrée : une erreur de rafraîchissement ne doit pas la masquer.
		}
		// Confirmation discrète puis fermeture (même chemin que le bouton Fermer).
		setTimeout(() => requestClose(), 650);
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') requestClose();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div
		role="presentation"
		in:fade={sheetFade()}
		out:fade={sheetFadeOut()}
		class="fixed inset-0 z-[60] flex items-end justify-center bg-[#0F1512]/38 backdrop-blur-sm sm:items-center sm:p-6"
		onclick={(e) => {
			if (e.target === e.currentTarget) requestClose();
		}}
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="weight-quick-title"
			bind:this={panel}
			in:fly={sheetFly()}
			out:fly={sheetFlyOut()}
			class="w-full max-w-md rounded-t-[28px] bg-white px-5 pt-5 shadow-[0_-20px_50px_-20px_rgba(15,21,18,0.35)] sm:rounded-[28px]"
			style="padding-bottom: max(env(safe-area-inset-bottom), 20px);"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 id="weight-quick-title" class="font-display text-[20px] font-black tracking-[-0.02em] text-[#0F1512]">
						Enregistrer mon poids
					</h2>
					<p class="mt-0.5 text-[13px] font-semibold capitalize text-[#66716B]">{dateLabel}</p>
				</div>
				<button
					type="button"
					class="-mr-2 -mt-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#66716B] hover:bg-[#F6F8F6]"
					aria-label="Fermer"
					onclick={requestClose}
				>
					<Icon name="x" size={20} />
				</button>
			</div>

			{#if isToday}
				<p class="mt-3 rounded-xl bg-brand-light px-3 py-2 text-[13px] font-semibold text-brand-dark">
					Une pesée existe déjà aujourd'hui : tu peux la corriger ici.
				</p>
			{/if}

			<label
				class="mt-4 flex h-[68px] items-center gap-3 rounded-[20px] border-[1.5px] border-[#E3E8E5] bg-[#F6F8F6] px-4 focus-within:border-brand"
			>
				<Icon name="scale" size={22} class="shrink-0 text-brand" />
				<input
					type="text"
					inputmode="decimal"
					enterkeyhint="done"
					autocomplete="off"
					placeholder="—"
					aria-label="Poids en kilogrammes"
					disabled={saving || done}
					bind:value
					onkeydown={(e) => {
						if (e.key === 'Enter') void submit();
					}}
					class="min-w-0 flex-1 border-0 bg-transparent font-display text-[34px] font-black tabular-nums text-[#0F1512] outline-none placeholder:text-[#B5BDB8]"
				/>
				<span class="text-[18px] font-bold text-[#7B857F]">kg</span>
			</label>

			<p class="mt-2.5 text-[13px] text-[#66716B]">{lastLabel}</p>

			{#if error}
				<p role="alert" class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{error}</p>
			{/if}

			<button
				type="button"
				disabled={saving || done}
				onclick={() => void submit()}
				class="tap mt-5 flex h-[56px] w-full items-center justify-center gap-2 rounded-[28px] bg-[#111A15] text-[16px] font-bold text-white shadow-[0_14px_28px_-12px_rgba(15,21,18,0.5)] transition hover:bg-[#0F1512] disabled:opacity-70"
			>
				{#if done}
					<Icon name="check" size={18} /> Pesée enregistrée
				{:else if saving}
					Enregistrement…
				{:else}
					{isToday ? 'Modifier ma pesée' : 'Enregistrer ma pesée'}
				{/if}
			</button>

			<a
				href="/espace/progression?detail=weightKg"
				onclick={requestClose}
				class="mt-4 block text-center text-[14px] font-semibold text-brand-dark underline-offset-4 hover:underline"
			>
				Voir mon historique
			</a>
		</div>
	</div>
{/if}
