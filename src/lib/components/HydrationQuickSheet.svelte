<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
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

	/* Ajout rapide d'eau depuis l'Accueil : feuille compacte, même animation que
	   la saisie rapide du poids. Enregistrement via le flux existant
	   (POST /api/hydration → hydration.addWater) — aucune logique métier ici. */

	let {
		open,
		date,
		onClose,
		onSaved,
	}: {
		open: boolean;
		/** Jour local d'enregistrement (aujourd'hui). */
		date: string;
		onClose: () => void;
		/** Appelé après une prise enregistrée (la carte est revalidée par le parent). */
		onSaved: (ml: number) => void | Promise<void>;
	} = $props();

	const PRESETS = [150, 250, 500];
	const ML_MAX = 5000;

	let custom = $state('');
	let saving = $state(false);
	let done = $state<number | null>(null);
	let error = $state('');

	/* Verrou de défilement + géométrie figée (mécanisme partagé des volets). */
	let panel = $state<HTMLElement | null>(null);
	let verrouille = false;
	let annulerLiberation: (() => void) | null = null;

	/* À chaque ouverture : saisie vide, aucun état résiduel. */
	$effect(() => {
		if (!open) return;
		custom = '';
		saving = false;
		done = null;
		error = '';
	});

	const dateLabel = $derived(
		`Aujourd'hui · ${new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`
	);

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

	async function add(ml: number) {
		// Anti double-enregistrement : un seul envoi à la fois, et plus jamais après succès.
		if (saving || done !== null) return;
		if (!Number.isInteger(ml) || ml < 1 || ml > ML_MAX) {
			error = `Quantité invalide (entre 1 et ${ML_MAX} ml).`;
			return;
		}
		saving = true;
		error = '';
		try {
			const res = await fetch('/api/hydration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ date, ml }),
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || body.error) throw new Error(body.error ?? 'Ajout impossible.');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Ajout impossible.';
			saving = false;
			return;
		}
		saving = false;
		done = ml;
		try {
			await onSaved(ml);
		} catch {
			// La prise est enregistrée : une erreur de rafraîchissement ne doit pas la masquer.
		}
		// Confirmation discrète puis fermeture (même chemin que le bouton Fermer).
		setTimeout(() => requestClose(), 650);
	}

	function submitCustom() {
		const ml = Math.round(Number(custom.replace(',', '.')));
		if (!custom.trim() || !Number.isFinite(ml)) {
			error = 'Saisis une quantité en ml.';
			return;
		}
		void add(ml);
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
			aria-labelledby="hydration-quick-title"
			bind:this={panel}
			in:fly={sheetFly()}
			out:fly={sheetFlyOut()}
			class="w-full max-w-md rounded-t-[28px] bg-white px-5 pt-5 shadow-[0_-20px_50px_-20px_rgba(15,21,18,0.35)] sm:rounded-[28px]"
			style="padding-bottom: max(env(safe-area-inset-bottom), 20px);"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 id="hydration-quick-title" class="font-display text-[20px] font-black tracking-[-0.02em] text-[#0F1512]">
						Ajouter de l'eau
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

			<div class="mt-4 grid grid-cols-3 gap-2.5">
				{#each PRESETS as q (q)}
					<button
						type="button"
						onclick={() => void add(q)}
						disabled={saving || done !== null}
						class="tap flex h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand-light text-brand-deep transition hover:bg-brand-light/80 active:scale-[0.97] disabled:opacity-60"
					>
						<span class="font-display text-[22px] font-black leading-none tracking-tight">+{q}</span>
						<span class="text-xs font-bold text-mist">ml</span>
					</button>
				{/each}
			</div>

			<div class="mt-3 flex h-[56px] items-center gap-2 rounded-[20px] border-[1.5px] border-[#E3E8E5] bg-[#F6F8F6] pl-4 pr-2 focus-within:border-brand">
				<Icon name="droplet" size={20} class="shrink-0 text-brand" />
				<input
					type="text"
					inputmode="numeric"
					enterkeyhint="done"
					autocomplete="off"
					placeholder="Autre quantité"
					aria-label="Autre quantité en millilitres"
					disabled={saving || done !== null}
					bind:value={custom}
					onkeydown={(e) => {
						if (e.key === 'Enter') submitCustom();
					}}
					class="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-bold tabular-nums text-[#0F1512] outline-none placeholder:font-semibold placeholder:text-[#B5BDB8]"
				/>
				<span class="text-[14px] font-bold text-[#7B857F]">ml</span>
				<button
					type="button"
					onclick={submitCustom}
					disabled={saving || done !== null}
					class="tap h-10 rounded-xl bg-[#111A15] px-3.5 text-[14px] font-bold text-white disabled:opacity-60"
				>
					Ajouter
				</button>
			</div>

			{#if error}
				<p role="alert" class="mt-3 rounded-xl bg-danger-light px-3 py-2 text-sm text-danger">{error}</p>
			{/if}

			<p class="mt-3 min-h-[20px] text-center text-[14px] font-semibold text-brand-dark" aria-live="polite">
				{#if done !== null}
					<Icon name="check" size={16} class="inline" /> +{done} ml ajoutés
				{:else if saving}
					Enregistrement…
				{/if}
			</p>
		</div>
	</div>
{/if}
