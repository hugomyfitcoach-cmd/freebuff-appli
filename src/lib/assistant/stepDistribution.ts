/** Deterministic helpers for preparing exact multi-day step entries. */
export type StepDistributionRequest = { total: number; days: number };

export function parseStepDistributionRequest(text: string): StepDistributionRequest | null {
	const match = text.match(/\b([0-9][0-9 .\u00a0\u202f]*)\s*pas\b[\s\S]*?\b(\d{1,2})\s+derniers?\s+jours?\b[\s\S]*?\b(?:r[eé]partis?|r[eé]partir|distribu[eé]s?|distribuer)\b[\s\S]*?\b(\d{1,2})\s+jours?\b/i);
	if (!match || !/\b(?:enregistre|enregistrer|ajoute|ajouter|saisis|saisir|note)\b/i.test(text)) return null;
	const total = Number(match[1].replace(/[ .\u00a0\u202f]/g, ''));
	const sourceDays = Number(match[2]);
	const targetDays = Number(match[3]);
	if (!Number.isSafeInteger(total) || total <= 0 || sourceDays !== targetDays || targetDays < 2 || targetDays > 14) return null;
	return { total, days: targetDays };
}

/** Distributes every step exactly, giving remainder steps to earliest dates. */
export function distributeSteps(total: number, days: number): number[] {
	if (!Number.isSafeInteger(total) || total < 0 || !Number.isInteger(days) || days < 1 || days > 14 || total > days * 150_000) {
		throw new RangeError('Répartition de pas invalide.');
	}
	const each = Math.floor(total / days);
	const remainder = total % days;
	return Array.from({ length: days }, (_, index) => each + (index < remainder ? 1 : 0));
}
