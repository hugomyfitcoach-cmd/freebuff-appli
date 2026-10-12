import { query } from "./_generated/server";

const PROD_URL_MARK = "calm-jaguar-475";
const TRACE_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Never activate diagnostic tracing on production, even if the flag is set. */
export function foodTraceEnabled(): boolean {
	const deployment = process.env.CONVEX_CLOUD_URL ?? "";
	return process.env.PREVIEW_FOOD_TRACE === "1" && !!deployment && !deployment.includes(PROD_URL_MARK);
}

const FOOD_TERMS: [string, RegExp][] = [
	["poulet", /\b(poulet|volaille)\b/],
	["riz", /\b(riz)\b/],
	["avoine", /\b(avoine)\b/],
	["lait", /\b(lait)\b/],
	["beurre", /\b(beurre)\b/],
	["pain", /\b(pain)\b/],
	["oeuf", /\b(oeuf|oeufs)\b/],
	["pomme", /\b(pomme|pommes)\b/],
	["kiwi", /\b(kiwi|kiwis)\b/],
	["fromage_blanc", /\b(fromage blanc)\b/],
	["banane", /\b(banane|bananes)\b/],
	["pates", /\b(pates|spaghetti|macaroni)\b/],
	["patate", /\b(pomme de terre|pommes de terre|patate|patates)\b/],
];

function canonicalFoods(value: unknown): string[] {
	if (typeof value !== "string") return [];
	const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
	return FOOD_TERMS.filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name);
}

/** Extract only allowlisted food terms from the user message, never its raw text. */
export function summarizeRequestedFoods(text: string): string[] {
	return canonicalFoods(text).slice(0, 8);
}

/** Summarize tool arguments/results without IDs, custom labels, brands or nutrition data. */
export function summarizeFoodItems(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	return values.slice(0, 8).map((value) => {
		if (typeof value === "string") return canonicalFoods(value).join("+") || "other";
		if (!value || typeof value !== "object") return "other";
		const item = value as { name?: unknown; query?: unknown; label?: unknown; qtyGrams?: unknown; origin?: unknown };
		const foods = canonicalFoods(item.name ?? item.query ?? item.label);
		const qty = typeof item.qtyGrams === "number" && Number.isFinite(item.qtyGrams)
			? `:${Math.max(1, Math.min(5000, Math.round(item.qtyGrams)))}g`
			: "";
		const origin = ["product", "personal", "reference"].includes(String(item.origin)) ? `@${item.origin}` : "";
		return `${foods.join("+") || "other"}${qty}${origin}`;
	});
}

/** Temporary diagnostic query. It exposes only minimised food path traces. */
export const recentFoodTraces = query({
	args: {},
	handler: async (ctx) => {
		if (!foodTraceEnabled()) return { enabled: false, traces: [] };
		const rows = await ctx.db.query("assistantMessages").collect();
		rows.sort((a, b) => b.createdAt - a.createdAt);
		const cutoff = Date.now() - TRACE_RETENTION_MS;
		const traces = rows
			.filter((r) => r.createdAt >= cutoff)
			.filter((r) => r.role === "assistant" && (r as { foodTrace?: unknown }).foodTrace)
			.slice(0, 20)
			.map((r) => ({
				messageAt: r.createdAt,
				...(r as { foodTrace: { textFoods: string[]; stages: string[] } }).foodTrace,
			}));
		return { enabled: true, traces };
	},
});
