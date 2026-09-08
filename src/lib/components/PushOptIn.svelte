<script lang="ts">
	import Icon from './Icon.svelte';
	import { pushSupported, subscribeToPush, watchPushSubscriptionChange } from '$lib/push';

	/**
	 * Activation discrète des notifications push (côté cliente).
	 * - Permission déjà accordée → on s'abonne silencieusement ;
	 * - permission non décidée → bannette « Activer » / « Plus tard » /
	 *   « Ne plus demander » (choix mémorisé localement) ;
	 * - permission refusée → rien, le badge interne continue de fonctionner.
	 */
	const DECLINED_KEY = 'gflux_push_declined';

	let phase = $state<'hidden' | 'idle' | 'busy'>('hidden');
	let declined = $state(false);

	$effect(() => {
		if (!pushSupported()) return;
		watchPushSubscriptionChange();
		try {
			declined = localStorage.getItem(DECLINED_KEY) === '1';
		} catch {
			declined = false;
		}
		if (Notification.permission === 'granted') {
			void subscribeToPush();
			return;
		}
		if (Notification.permission === 'default' && !declined) {
			phase = 'idle';
		}
	});

	async function enable() {
		if (phase !== 'idle') return;
		phase = 'busy';
		try {
			const perm = await Notification.requestPermission();
			if (perm === 'granted') {
				await subscribeToPush();
				phase = 'hidden';
			} else if (perm === 'denied') {
				try {
					localStorage.setItem(DECLINED_KEY, '1');
				} catch {
					/* silencieux */
				}
				phase = 'hidden';
			} else {
				phase = 'idle';
			}
		} finally {
			if (phase === 'busy') phase = 'idle';
		}
	}

	function later() {
		phase = 'hidden';
	}

	function never() {
		declined = true;
		phase = 'hidden';
		try {
			localStorage.setItem(DECLINED_KEY, '1');
		} catch {
			/* silencieux */
		}
	}
</script>

{#if phase !== 'hidden'}
	<div
		role="status"
		class="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-md rounded-2xl border border-line bg-white p-4 shadow-lg sm:bottom-6"
	>
		<p class="flex items-center gap-2 text-sm font-bold text-ink">
			<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-light text-brand-dark"><Icon name="bell" size={16} /></span>
			Restons en lien
		</p>
		<p class="mt-1 text-xs leading-relaxed text-mist">
			Active les notifications pour recevoir le message de ton coach et tes retours de bilan, même quand l'app est fermée.
		</p>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<button
				type="button"
				onclick={enable}
				disabled={phase === 'busy'}
				class="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
			>
				{phase === 'busy' ? 'Activation…' : 'Activer'}
			</button>
			<button type="button" onclick={later} class="rounded-xl border-2 border-line px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand">
				Plus tard
			</button>
			<button type="button" onclick={never} class="ml-auto text-xs font-semibold text-mist underline-offset-2 hover:underline">
				Ne plus demander
			</button>
		</div>
	</div>
{/if}