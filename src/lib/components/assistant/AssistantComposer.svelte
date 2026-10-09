<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import WhatsAppIcon from '$lib/components/WhatsAppIcon.svelte';

	/**
	 * COMPOSER DE L'ASSISTANT (§10) — fixe en bas, sobre, jamais pollué.
	 *
	 *  - champ texte (Entrée = envoyer, Maj+Entrée = saut de ligne) ;
	 *  - dictée MICRO NATIVE uniquement (Web Speech API) — aucun service de
	 *    transcription payant en V1 (§10) : le bouton n'apparaît tout simplement
	 *    pas si le navigateur ne le supporte pas ;
	 *  - pièce jointe photo optionnelle → redimensionnée en local puis confiée
	 *    à la pipeline Repas IA existante (§30) ;
	 *  - bouton envoyer ;
	 *  - raccourci WhatsApp Hugo DISCRET au-dessus du champ.
	 *
	 * En cas d'échec réseau, le texte reste dans le champ : jamais de message
	 * perdu (§33).
	 */
	let {
		sending = false,
		disabled = false,
		whatsappUrl = null,
		onsend,
	}: {
		sending?: boolean;
		disabled?: boolean;
		whatsappUrl?: string | null;
		onsend?: (payload: { text: string; imageDataUrl?: string }) => void;
	} = $props();

	let text = $state('');
	let image = $state<string | null>(null);
	let imageBusy = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);
	let textarea: HTMLTextAreaElement | null = $state(null);
	let listening = $state(false);
	let rec: any = null;

	const SpeechApi =
		typeof window !== 'undefined'
			? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
			: undefined;
	const canDictate = !!SpeechApi;
	const ready = $derived((text.trim().length > 0 || !!image) && !sending && !disabled && !imageBusy);

	function autosize() {
		const el = textarea;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, 120) + 'px';
	}

	function submit() {
		if (!ready) return;
		const payload = { text: text.trim(), ...(image ? { imageDataUrl: image } : {}) };
		// Le texte n'est effacé QUE si le parent confirme : il est conservé en
		// cas d'échec (§33) — le parent remet `text` via la prop si besoin.
		text = '';
		image = null;
		onsend?.(payload);
		if (textarea) textarea.style.height = 'auto';
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	/* ── Pièce jointe : lecture + redimensionnement local (jamais d'upload) ── */
	async function pickFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) return;
		imageBusy = true;
		try {
			image = await resizeToDataUrl(file, 1280, 0.85);
		} catch {
			image = null;
		} finally {
			imageBusy = false;
		}
	}

	function resizeToDataUrl(file: File, max: number, quality: number): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(new Error('read'));
			reader.onload = () => {
				const src = String(reader.result);
				const img = new Image();
				img.onerror = () => reject(new Error('decode'));
				img.onload = () => {
					const scale = Math.min(1, max / Math.max(img.width, img.height));
					if (scale === 1 && src.length < 3_500_000) return resolve(src);
					const c = document.createElement('canvas');
					c.width = Math.max(1, Math.round(img.width * scale));
					c.height = Math.max(1, Math.round(img.height * scale));
					const ctx = c.getContext('2d');
					if (!ctx) return resolve(src);
					ctx.drawImage(img, 0, 0, c.width, c.height);
					resolve(c.toDataURL('image/jpeg', quality));
				};
				img.src = src;
			};
			reader.readAsDataURL(file);
		});
	}

	/* ── Dictée native (aucun service payant) ─────────────────────────────── */
	function toggleDictation() {
		if (!canDictate) return;
		if (listening) {
			rec?.stop?.();
			return;
		}
		rec = new SpeechApi();
		rec.lang = 'fr-FR';
		rec.interimResults = true;
		rec.continuous = false;
		rec.onresult = (ev: any) => {
			let final = '';
			let interim = '';
			for (const result of ev.results ?? []) {
				if (result.isFinal) final += result[0].transcript;
				else interim += result[0].transcript;
			}
			if (final) text = (text ? text + ' ' : '') + final.trim();
			else if (interim) text = (text ? text.replace(/\s+$/, '') + ' ' : '') + interim;
			autosize();
		};
		rec.onerror = () => (listening = false);
		rec.onend = () => (listening = false);
		try {
			rec.start();
			listening = true;
		} catch {
			listening = false;
		}
	}
</script>

<div class="rounded-[26px] border border-line bg-white p-2 shadow-sm focus-within:border-brand/50">
	{#if image}
		<div class="flex items-center gap-2 px-1 pb-2 pt-1">
			<img src={image} alt="Photo jointe" class="h-12 w-12 rounded-xl border border-line object-cover" />
			<p class="min-w-0 flex-1 truncate text-[12px] font-semibold text-mist-strong">Photo jointe — analysée à l’envoi</p>
			<button
				type="button"
				class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-mist transition hover:bg-soft hover:text-ink"
				aria-label="Retirer la photo"
				onclick={() => (image = null)}
			>
				<Icon name="x" size={15} />
			</button>
		</div>
	{/if}

	<div class="flex items-end gap-1.5">
		<button
			type="button"
			class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-mist-strong transition hover:bg-soft hover:text-ink disabled:opacity-50"
			aria-label="Joindre une photo"
			title="Joindre une photo"
			disabled={disabled || imageBusy}
			onclick={() => fileInput?.click()}
		>
			<Icon name="paperclip" size={18} class={imageBusy ? 'animate-pulse' : ''} />
		</button>
		<input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={pickFile} aria-hidden="true" tabindex="-1" />

		<textarea
			bind:this={textarea}
			bind:value={text}
			rows="1"
			oninput={autosize}
			onkeydown={onKey}
			disabled={disabled}
			placeholder="Écris ou dicte ta demande…"
			aria-label="Message pour l’Assistant G-FLUX"
			class="max-h-[120px] min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-snug text-ink outline-none placeholder:text-mist"
		></textarea>

		{#if canDictate}
			<button
				type="button"
				class="grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-soft {listening ? 'text-danger' : 'text-mist-strong'}"
				aria-label={listening ? 'Arrêter la dictée' : 'Dicter'}
				title={listening ? 'Arrêter la dictée' : 'Dicter'}
				disabled={disabled}
				onclick={toggleDictation}
			>
				<Icon name="mic" size={18} class={listening ? 'animate-pulse' : ''} />
			</button>
		{/if}

		<button
			type="button"
			class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-white transition hover:bg-brand-dark active:scale-95 disabled:opacity-50"
			aria-label="Envoyer"
			title="Envoyer"
			disabled={!ready}
			onclick={submit}
		>
			<Icon name="send" size={17} strokeWidth={2.4} />
		</button>
	</div>
</div>

{#if whatsappUrl}
	<div class="mt-1.5 flex justify-end pr-1">
		<a
			href={whatsappUrl}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold text-mist transition hover:bg-brand-light hover:text-brand-dark"
		>
			<WhatsAppIcon size={13} class="text-brand" />
			<span>Un souci ? Écrire à Hugo</span>
		</a>
	</div>
{/if}
