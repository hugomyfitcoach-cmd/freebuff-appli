<script lang="ts">
	/**
	 * RENDU DE BULLE ASSISTANT — markdown minimal, SANS {@html}.
	 *
	 * Le texte du modèle est passé au parseur `parseRichText` (markdown.ts)
	 * puis rendu avec des éléments Svelte natifs : tout contenu non reconnu
	 * (<script>, <img onerror>, javascript:…) est AFFICHÉ COMME TEXTE, jamais
	 * interprété. Svelte échappe chaque nœud texte par défaut — aucun HTML
	 * injecté, aucun lien créé, aucun attribut construit depuis l'entrée.
	 */
	import { parseRichText } from '$lib/assistant/markdown';

	let { text }: { text: string } = $props();

	const blocks = $derived(parseRichText(text ?? ''));
</script>

<div class="space-y-1.5">
	{#each blocks as block, bi (bi)}
		{#if block.type === 'paragraph'}
			<p class="whitespace-pre-line">{#each block.parts as part, pi (pi)}{#if part.type === 'bold'}<strong class="font-bold">{part.text}</strong>{:else if part.type === 'italic'}<em>{part.text}</em>{:else if part.type === 'code'}<code class="rounded bg-soft px-1 py-0.5 text-[13px]">{part.text}</code>{:else}{part.text}{/if}{/each}</p>
		{:else if block.type === 'ul'}
			<ul class="list-disc space-y-0.5 pl-4">
				{#each block.items as item, ii (ii)}
					<li>{#each item as part, pi (pi)}{#if part.type === 'bold'}<strong class="font-bold">{part.text}</strong>{:else if part.type === 'italic'}<em>{part.text}</em>{:else if part.type === 'code'}<code class="rounded bg-soft px-1 py-0.5 text-[13px]">{part.text}</code>{:else}{part.text}{/if}{/each}</li>
				{/each}
			</ul>
		{:else}
			<ol class="list-decimal space-y-0.5 pl-4">
				{#each block.items as item, ii (ii)}
					<li>{#each item as part, pi (pi)}{#if part.type === 'bold'}<strong class="font-bold">{part.text}</strong>{:else if part.type === 'italic'}<em>{part.text}</em>{:else if part.type === 'code'}<code class="rounded bg-soft px-1 py-0.5 text-[13px]">{part.text}</code>{:else}{part.text}{/if}{/each}</li>
				{/each}
			</ol>
		{/if}
	{/each}
</div>
