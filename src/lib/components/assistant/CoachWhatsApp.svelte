<script lang="ts">
	import WhatsAppIcon from '$lib/components/WhatsAppIcon.svelte';

	/**
	 * ACCÈS DIRECT À HUGO (§6/§7) — action compacte en haut de l'Assistant
	 * (`variant="full"`) et raccourci discret près du champ (`variant="mini"`).
	 *
	 * SOURCE UNIQUE : `url` vient du BFF → `lib/assistant/policy.ts` → variable
	 * serveur `COACH_WHATSAPP`. Aucun numéro n'est hardcodé ici ni ailleurs.
	 * Tant que la variable n'est pas posée, le bouton reste AFFICHÉ mais non
	 * cliquable (état honnête, jamais un lien mort) — et je signale le manque.
	 *
	 * AVATAR COACH : on RÉUTILISE la source actuelle de l'application
	 * (clé localStorage `coach-avatar`, la seule existante) avec repli sur
	 * l'initiale. Aucune nouvelle photo statique créée.
	 */
	let {
		url = null,
		label = 'Accès direct à Hugo',
		variant = 'full',
	}: { url?: string | null; label?: string; variant?: 'full' | 'mini' } = $props();

	let avatar = $state<string | null>(null);

	$effect(() => {
		try {
			avatar = localStorage.getItem('coach-avatar');
		} catch {
			/* navigation privée — pas de photo à ré afficher */
		}
	});

	const ready = $derived(!!url);
</script>

{#if variant === 'full'}
	{#if ready}
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand/25 bg-brand-light px-3.5 py-2 text-[13px] font-bold text-brand-dark transition hover:bg-brand/15 active:scale-[0.98]"
		>
			<WhatsAppIcon size={17} class="text-brand" />
			<span class="whitespace-nowrap">{label}</span>
		</a>
	{:else}
		<!-- État HONNÊTE : COACH_WHATSAPP absente → AFFICHÉ mais jamais cliquable
		     (pas de lien mort, pas de numéro inventé). -->
		<span
			class="inline-flex min-h-11 cursor-default items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-[13px] font-bold text-mist"
			aria-disabled="true"
			title="WhatsApp du coach non configuré"
		>
			<WhatsAppIcon size={17} class="text-mist" />
			<span class="whitespace-nowrap">{label}</span>
		</span>
	{/if}
	<span class="relative -ml-2 shrink-0">
			{#if avatar}
				<img src={avatar} alt="Photo du coach" class="h-10 w-10 rounded-full border-2 border-white object-cover shadow-sm" />
			{:else}
				<span
					class="grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-ink text-sm font-black text-white shadow-sm"
					aria-hidden="true">H</span
				>
			{/if}
			<span
				class="absolute -bottom-0.5 -right-0.5 grid h-4.5 w-4.5 place-items-center rounded-full bg-brand text-white ring-2 ring-white"
				style:width="18px"
				style:height="18px"
			>
				<WhatsAppIcon size={11} />
			</span>
	</span>
{:else if ready}
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		class="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-bold text-mist-strong transition hover:bg-brand-light hover:text-brand-dark"
		title="Écrire à Hugo sur WhatsApp"
	>
		<WhatsAppIcon size={14} class="text-brand" />
		<span>Hugo</span>
	</a>
{/if}
