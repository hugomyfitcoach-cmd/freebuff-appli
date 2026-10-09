/**
 * MOTEUR DE CONVERSATION — Assistant G-FLUX (SERVEUR UNIQUEMENT).
 *
 * Même discipline que `src/lib/server/openai.ts` :
 *  - la clé OpenAI ne quitte JAMAIS ce module (jamais PUBLIC_*, jamais loguée) ;
 *  - modèle configurable (`ASSISTANT_MODEL`, repli `OPENAI_MODEL`) — un seul
 *    endroit le résout, aucun hardcodage dans le code applicatif ;
 *  - timeout propre + erreur métier (jamais de stack exposée à la cliente) ;
 *  - traçabilité : modèle, tokens, durée, coût estimé renvoyés à l'appelant.
 *
 * BOUCLE D'OUTILS : le modèle propose des appels, LE SERVEUR les exécute
 * (couche `convex/assistantTools.ts`) et renvoie les résultats. Le modèle
 * n'écrit jamais rien lui-même et n'est jamais la source de vérité des
 * données (§20/§21).
 *
 * Format : API Chat Completions (boucle d'outils stable et documentée).
 */

import { OpenAiUnavailableError } from './openai';
import type { AiUsage } from './openai';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/** Tarifs publics USD / 1M tokens (même table que openai.ts — borne le coût). */
const PRICES: Record<string, { input: number; output: number }> = {
	'gpt-4o-mini': { input: 0.15, output: 0.6 },
	'gpt-4o': { input: 2.5, output: 10 },
	'gpt-4.1-mini': { input: 0.4, output: 1.6 },
	'gpt-4.1-nano': { input: 0.1, output: 0.4 },
	'o4-mini': { input: 1.1, output: 4.4 },
};

function envModel(): string {
	const m = process.env.ASSISTANT_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
	return /^(gpt-4o(-mini)?|gpt-4\.1(-mini|-nano)?|o4-mini)$/.test(m) ? m : 'gpt-4o-mini';
}

export type ToolDef = {
	type: 'function';
	function: { name: string; description: string; parameters: Record<string, unknown> };
};

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

type ChatMsg =
	| { role: 'system' | 'user'; content: string }
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
	| { role: 'tool'; tool_call_id: string; content: string };

export type TurnResult = {
	text: string;
	usage: AiUsage;
	/** Noms des outils appelés pendant ce tour (traçabilité minimale). */
	toolCalls: string[];
};

function priceOf(model: string) {
	return PRICES[model] ?? PRICES['gpt-4o-mini'];
}

function aggregateUsage(model: string, chunks: { input?: number; output?: number }[], durationMs: number): AiUsage {
	const inputTokens = chunks.reduce((a, c) => a + (c.input ?? 0), 0) || undefined;
	const outputTokens = chunks.reduce((a, c) => a + (c.output ?? 0), 0) || undefined;
	const p = priceOf(model);
	const estimatedCostUsd =
		inputTokens !== undefined && outputTokens !== undefined
			? Math.round(((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * 100000) / 100000
			: undefined;
	return { model, inputTokens, outputTokens, durationMs, estimatedCostUsd };
}

async function callChat(messages: ChatMsg[], tools: ToolDef[], toolChoice: 'auto' | 'none'): Promise<{
	content: string;
	toolCalls: ToolCall[];
	usage: { input?: number; output?: number };
}> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) throw new OpenAiUnavailableError("L'assistant IA n'est pas configuré sur le serveur.");
	const model = envModel();
	const started = Date.now();
	let res: Response;
	try {
		res = await fetch(CHAT_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				messages,
				max_tokens: 1400,
				temperature: 0.3,
				...(tools.length ? { tools, tool_choice: toolChoice } : {}),
			}),
			signal: AbortSignal.timeout(40_000),
		});
	} catch (e) {
		const name = e instanceof Error ? e.name : '';
		throw new OpenAiUnavailableError(
			name === 'TimeoutError' ? "L'assistant a dépassé le délai." : "Service d'assistant momentanément indisponible."
		);
	}
	if (!res.ok) {
		let detail = '';
		try {
			const j = (await res.json()) as { error?: { message?: string } };
			detail = typeof j.error?.message === 'string' ? ` — ${j.error.message.slice(0, 140)}` : '';
		} catch {
			/* corps non JSON : on reste générique */
		}
		throw new OpenAiUnavailableError(`Service d'assistant indisponible (HTTP ${res.status})${detail}.`);
	}
	const raw = (await res.json()) as {
		choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
		usage?: { prompt_tokens?: number; completion_tokens?: number };
	};
	void started;
	const msg = raw.choices?.[0]?.message;
	if (!msg) throw new OpenAiUnavailableError("Réponse de l'assistant vide.");
	return {
		content: typeof msg.content === 'string' ? msg.content : '',
		toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
		usage: { input: raw.usage?.prompt_tokens, output: raw.usage?.completion_tokens },
	};
}

/**
 * Un tour complet : boucle d'outils bornée (`maxRounds`) puis réponse finale
 * forcée (`tool_choice: 'none'`) — jamais de boucle infinie, jamais de coût
 * non borné.
 */
export async function runAssistantTurn(opts: {
	system: string;
	history: { role: 'user' | 'assistant'; content: string }[];
	userText: string;
	/** Description d'une photo jointe (Repas IA) — optionnelle. */
	imageHint?: string;
	tools: ToolDef[];
	callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
	maxRounds: number;
}): Promise<TurnResult> {
	const model = envModel();
	const started = Date.now();
	const chunks: { input?: number; output?: number }[] = [];
	const called: string[] = [];

	const userContent = opts.imageHint ? `${opts.userText}\n\n[Photo jointe : ${opts.imageHint}]` : opts.userText;
	const messages: ChatMsg[] = [
		{ role: 'system', content: opts.system },
		...opts.history.map((m) => ({ role: m.role, content: m.content }) as ChatMsg),
		{ role: 'user', content: userContent },
	];

	let finalText = '';
	for (let round = 0; round <= opts.maxRounds; round++) {
		const forceFinal = round >= opts.maxRounds;
		const r = await callChat(messages, opts.tools, forceFinal ? 'none' : 'auto');
		chunks.push(r.usage);
		if (r.toolCalls.length === 0 || forceFinal) {
			finalText = r.content.trim();
			break;
		}
		messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls });
		for (const tc of r.toolCalls) {
			const name = tc.function?.name ?? '';
			called.push(name);
			let args: Record<string, unknown> = {};
			try {
				const parsed: unknown = JSON.parse(tc.function?.arguments || '{}');
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
			} catch {
				args = {};
			}
			let out: unknown;
			try {
				out = await opts.callTool(name, args);
			} catch (e) {
				// Un outil en échec ne casse JAMAIS la conversation : le modèle
				// le sait et propose une réponse honnête.
				out = { ok: false, reason: e instanceof Error ? e.message.slice(0, 200) : 'error' };
			}
			messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out ?? { ok: true }) });
		}
	}

	if (!finalText) throw new OpenAiUnavailableError("Réponse de l'assistant vide.");
	return { text: finalText.slice(0, 4000), usage: aggregateUsage(model, chunks, Date.now() - started), toolCalls: called };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Les DÉFINITIONS D'OUTILS vivent désormais dans `src/convex/assistantRegistry.ts`
 * (source unique Lot 2 : schémas + types + exécuteurs). Ce module ne garde que
 * la boucle d'exécution générique `runAssistantTurn`.
 * ────────────────────────────────────────────────────────────────────────── */
