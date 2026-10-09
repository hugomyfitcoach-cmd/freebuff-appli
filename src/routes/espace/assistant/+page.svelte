<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import CoachWhatsApp from '$lib/components/assistant/CoachWhatsApp.svelte';
import RichText from '$lib/components/assistant/RichText.svelte';
	import ActionPreviewCard from '$lib/components/assistant/ActionPreviewCard.svelte';
	import AssistantComposer from '$lib/components/assistant/AssistantComposer.svelte';
	import { TOPICS, topicDef, type TopicId } from '$lib/assistant/topics';
	import { userErrMsg } from '$lib/errors.js';

	/**
	 * ASSISTANT G-FLUX — V1 preview (§4/§5/§8–§12).
	 *
	 * Haut COMPACT (pas d’un écran de discussion géant) : titre + accroche sur deux
	 * lignes, chips horizontales, UNE card de suggestions repliable, puis la
	 * conversation. Avatar Assistant = LOGO G-FLUX (pas de personnage animé). Hugo
	 * reste présent : action WhatsApp en haut + raccourci discret au composer.
	 */
	let { data } = $props();

	type Msg = {
		role: 'user' | 'assistant';
		content: string;
		kind?: string;
		createdAt: number;
		_id?: string;
	};
	type Pending = { actionId: string; actionType: string; preview: any; createdAt: number };

	const coachUrl = $derived(data.access?.coach?.url ?? null);

	let topic = $state<TopicId>((data.history?.topic as TopicId) ?? 'nutrition');
	let threadId = $state<string | null>(data.history?.threadId ?? null);
	let messages = $state<Msg[]>((data.history?.messages as Msg[]) ?? []);
	let pendingAction = $state<Pending | null>((data.history?.pendingAction as Pending) ?? null);
	let confirmed = $state<{ actionId: string; result: string } | null>(null);

	let sending = $state(false);
	let actionBusy = $state(false);
	let errorMessage = $state('');
	let retryPayload = $state<{ text: string; imageDataUrl?: string; index: number } | null>(null);
	let cardOpen = $state(true);
	let usage = $state<{ day: string; textCount: number; visionCount: number } | null>(data.usage ?? null);
	let listEl: HTMLDivElement | null = $state(null);

	const activeTopic = $derived(topicDef(topic));
	const remaining = $derived(
		usage && data.access?.limits?.textPerDay
			? Math.max(0, data.access.limits.textPerDay - usage.textCount)
			: null
	);

	/** Message d'accueil local (jamais persisté) — tient le rôle de l'assistant. */
	const GREETING: Msg = {
		role: 'assistant',
		content:
			'Je peux t’aider pour ton suivi au quotidien : repas, poids, pas, recettes, récap.\nEt si besoin, tu peux écrire directement à Hugo. 💪',
		kind: 'greeting',
		createdAt: 0,
	};

	const visible = $derived(messages.length === 0 ? [GREETING] : messages);

	function localToday(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	function timeLabel(ts: number): string {
		return new Date(ts || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}

	/* Défilement automatique en bas de la conversation à chaque nouveau message. */
	$effect(() => {
		void visible.length;
		void sending;
		void pendingAction;
		if (typeof window === 'undefined') return;
		requestAnimationFrame(() => {
			listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
		});
	});

	/* ── Envoi ─────────────────────────────────────────────────────────── */
	async function sendMessage(raw: { text: string; imageDataUrl?: string }, fromIndex?: number) {
		const text = raw.text.trim();
		if ((!text && !raw.imageDataUrl) || sending) return;
		sending = true;
		errorMessage = '';
		retryPayload = null;
		// Reprise après échec : on retire le bulle utilisateur + message d'erreur
		// déjà affichés pour ne pas les dupliquer.
		const start = fromIndex ?? messages.length;
		if (fromIndex !== undefined) messages = messages.slice(0, fromIndex);
		messages = [...messages, { role: 'user', content: text || '📷 Photo', createdAt: Date.now() }];
		try {
			const res = await fetch('/api/assistant/send', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...(threadId ? { threadId } : {}),
					topic,
					message: text,
					today: localToday(),
					...(raw.imageDataUrl ? { imageDataUrl: raw.imageDataUrl } : {}),
				}),
			});
			const j = (await res.json()) as {
				ok?: boolean;
				reply?: string;
				kind?: string;
				threadId?: string;
				topic?: string;
				pendingAction?: Pending | null;
				usage?: { textCount: number; visionCount: number };
				reason?: string;
			};
			if (!res.ok || typeof j.reply !== 'string') {
				throw new Error(j.reason || "Impossible d'envoyer pour l'instant.");
			}
			if (j.threadId) threadId = j.threadId;
			if (j.topic) topic = (j.topic as TopicId) ?? topic;
			if (j.usage) usage = { day: usage?.day ?? localToday(), textCount: j.usage.textCount, visionCount: j.usage.visionCount };
			messages = [...messages, { role: 'assistant', content: j.reply, kind: j.kind ?? 'text', createdAt: Date.now() }];
			if (j.pendingAction) {
				pendingAction = j.pendingAction;
				confirmed = null;
			}
		} catch (e) {
			// §33 : le message de la cliente n'est JAMAIS perdu — il reste affiché
			// et un bulle d'erreur propose « Réessayer ».
			const msg = userErrMsg(e, "Je n’arrive pas à te répondre pour l’instant. Réessaie dans un instant.");
			retryPayload = { ...raw, index: start };
			messages = [...messages, { role: 'assistant', content: msg, kind: 'error', createdAt: Date.now() }];
		} finally {
			sending = false;
		}
	}

	/* ── Confirmation / annulation / undo ──────────────────────────────── */
	async function resolveAction(decision: 'confirm' | 'cancel' | 'undo') {
		if (actionBusy) return;
		const actionId = decision === 'undo' ? confirmed?.actionId : pendingAction?.actionId;
		if (!actionId) return;
		actionBusy = true;
		errorMessage = '';
		try {
			const res = await fetch('/api/assistant/action', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ actionId, decision }),
			});
			const j = (await res.json()) as { ok?: boolean; message?: string; status?: string; reason?: string };
			if (!res.ok || !j.ok || typeof j.message !== 'string') {
				throw new Error(j.reason || "Cette action n'a pas pu être traitée.");
			}
			if (decision === 'confirm') {
				confirmed = { actionId, result: j.message };
				pendingAction = null;
			} else {
				confirmed = null;
				pendingAction = null;
			}
			messages = [...messages, { role: 'assistant', content: j.message, kind: 'action', createdAt: Date.now() }];
		} catch (e) {
			errorMessage = userErrMsg(e, "Cette action n'a pas pu être traitée. Réessaie.");
		} finally {
			actionBusy = false;
		}
	}

	/* ── Suggestions ───────────────────────────────────────────────────── */
	function pickSuggestion(s: string) {
		if (s === activeTopic.whatsappSuggestion) {
			// WhatsApp configuré → ouverture directe. Sinon JAMAIS un tap mort :
			// la demande part en conversation (l'assistant répond honnêtement).
			if (coachUrl) {
				window.open(coachUrl, '_blank', 'noopener,noreferrer');
				return;
			}
		}
		void sendMessage({ text: s });
	}
</script>

<svelte:head><title>Assistant — G-Flux</title></svelte:head>

<!-- ── En-tête COMPACT (§4) : titre + accroche, jamais 25 % de l'écran ── -->
<header class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
	<div class="min-w-0">
		<h1 class="font-display text-[24px] font-black leading-tight text-ink sm:text-[26px]">Assistant G-FLUX</h1>
		<p class="mt-1 text-[13px] font-medium leading-snug text-mist">
			Une aide pratique entre deux échanges.<br class="sm:hidden" />
			Hugo garde la main sur ton suivi.
		</p>
	</div>
	<CoachWhatsApp url={coachUrl} />
</header>

<!-- ── Catégories : chips horizontales, UNE seule sélection (§8) ── -->
<div class="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Catégories de l’assistant">
	{#each TOPICS as t (t.id)}
		{@const active = t.id === topic}
		<button
			type="button"
			role="tab"
			aria-selected={active}
			class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-bold transition
				{active
				? 'border-brand/40 bg-brand-light text-brand-dark shadow-sm'
				: 'border-line bg-white text-mist-strong hover:border-ink/20 hover:text-ink'}"
			onclick={() => {
				topic = t.id;
				cardOpen = true;
			}}
		>
			<Icon name={t.icon} size={16} class={active ? 'text-brand' : 'text-mist'} />
			{t.label}
		</button>
	{/each}
</div>

<!-- ── Card de suggestions : UNE card, mise à jour au changement (§9) ── -->
<section class="mt-3 overflow-hidden rounded-3xl border border-line bg-card shadow-sm">
	<button
		type="button"
		class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-soft/60"
		aria-expanded={cardOpen}
		onclick={() => (cardOpen = !cardOpen)}
	>
		<span class="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-brand-light text-brand">
			<Icon name={activeTopic.icon} size={18} />
		</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-[15px] font-black text-ink">{activeTopic.label}</span>
			<span class="block truncate text-[12px] text-mist">{activeTopic.subtitle}</span>
		</span>
		<Icon name="chevronDown" size={18} class="shrink-0 text-mist transition {cardOpen ? 'rotate-180' : ''}" />
	</button>

	{#if cardOpen}
		<div class="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2">
			{#each activeTopic.suggestions as s (s)}
				<button
					type="button"
					class="flex min-h-11 items-center justify-between gap-2 rounded-2xl border border-line bg-white px-3.5 py-2.5 text-left text-[13px] font-semibold text-ink transition hover:border-brand/40 hover:bg-brand-soft disabled:opacity-60"
					disabled={sending}
					onclick={() => pickSuggestion(s)}
				>
					<span class="min-w-0 truncate">{s}</span>
					<Icon name="chevronRight" size={15} class="shrink-0 text-mist" />
				</button>
			{/each}
		</div>
	{/if}
</section>

<!-- ── Conversation (§10) ── -->
<div bind:this={listEl} class="mt-4 max-h-[52vh] min-h-[26vh] space-y-3 overflow-y-auto px-0.5 pb-1 md:max-h-[56vh]">
	<p class="flex items-center gap-3 text-[11px] font-semibold text-mist" aria-hidden="true">
		<span class="h-px flex-1 bg-line"></span>
		Aujourd’hui
		<span class="h-px flex-1 bg-line"></span>
	</p>

	{#each visible as msg, i (msg.createdAt + ':' + i)}
		{#if msg.role === 'assistant'}
			<div class="flex items-start gap-2.5">
				<img src="/logo.png" alt="G-FLUX" class="mt-0.5 h-8 w-8 shrink-0 rounded-full object-contain" />
				<div class="min-w-0 max-w-[85%]">
					<div
						class="rounded-3xl rounded-tl-lg border border-line bg-white px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink shadow-sm
						{msg.kind === 'error' ? 'border-danger/40 bg-danger-light' : msg.kind === 'safety' ? 'border-warn/40 bg-warn-light' : ''}"
					>
						<RichText text={msg.content} />
						{#if msg.kind === 'error'}
							<button
								type="button"
								class="mt-2 rounded-full border border-danger/40 bg-white px-3 py-1.5 text-[12px] font-bold text-danger transition hover:bg-danger/10 disabled:opacity-60"
					disabled={sending || !retryPayload}
					onclick={() => retryPayload && sendMessage(retryPayload, retryPayload.index)}
							>
								Réessayer
							</button>
						{/if}
					</div>
					{#if msg.createdAt}
						<p class="mt-1 pl-1 text-[10.5px] text-mist">{timeLabel(msg.createdAt)}</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="flex justify-end">
				<div class="min-w-0 max-w-[85%]">
					<div class="rounded-3xl rounded-br-lg bg-brand-light px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink">
						{msg.content}
					</div>
					<p class="mt-1 pr-1 text-right text-[10.5px] text-mist">{timeLabel(msg.createdAt)}</p>
				</div>
			</div>
		{/if}
	{/each}

	{#if pendingAction}
		<div class="pl-10">
			<ActionPreviewCard
				preview={pendingAction.preview}
				status="pending"
				busy={actionBusy}
				onconfirm={() => resolveAction('confirm')}
				oncancel={() => resolveAction('cancel')}
			/>
		</div>
	{/if}

	{#if sending}
		<div class="flex items-start gap-2.5">
			<img src="/logo.png" alt="G-FLUX" class="mt-0.5 h-8 w-8 shrink-0 rounded-full object-contain" />
			<div class="rounded-3xl rounded-tl-lg border border-line bg-white px-3.5 py-2.5 text-[13px] font-bold text-mist-strong shadow-sm">
				G-FLUX analyse<span class="inline-flex w-4 justify-start">
					<span class="animate-bounce [animation-delay:0ms]">.</span><span class="animate-bounce [animation-delay:120ms]">.</span><span
						class="animate-bounce [animation-delay:240ms]">.</span
					>
				</span>
			</div>
		</div>
	{/if}
</div>

{#if errorMessage}
	<p class="mt-2 rounded-2xl border border-danger/30 bg-danger-light px-3 py-2 text-[12.5px] font-semibold text-danger" role="alert">
		{errorMessage}
	</p>
{/if}

{#if confirmed && !pendingAction}
	<div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand/30 bg-brand-light px-3 py-2">
		<p class="min-w-0 truncate text-[12.5px] font-bold text-brand-dark">{confirmed.result}</p>
		<button
			type="button"
			class="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-line bg-white px-3 text-[12px] font-bold text-mist-strong transition hover:text-ink disabled:opacity-60"
			disabled={actionBusy}
			onclick={() => resolveAction('undo')}
		>
			<Icon name="undo" size={13} /> Annuler
		</button>
	</div>
{/if}

{#if remaining !== null && remaining <= 5}
	<p class="mt-2 text-[11.5px] text-mist">
		{remaining === 0
			? 'Tu as utilisé tes échanges Assistant du jour — reviens demain.'
			: `${remaining} échange${remaining > 1 ? 's' : ''} Assistant restant${remaining > 1 ? 's' : ''} aujourd’hui.`}
	</p>
{/if}

<!-- ── Composer fixe en bas (§10) ── -->
<div class="sticky bottom-[calc(6.5rem_+_env(safe-area-inset-bottom))] z-30 mt-3 md:bottom-4">
	<AssistantComposer
		sending={sending}
		disabled={sending}
		whatsappUrl={coachUrl}
		onsend={(p) => sendMessage(p)}
	/>
</div>
