export function formatMarketPrice(value: number, locale?: string): string {
	return new Intl.NumberFormat(locale ?? defaultLocale(), {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	}).format(value);
}

export function formatMarketChange(value: number, locale?: string): string {
	const formatted = new Intl.NumberFormat(locale ?? defaultLocale(), {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(Math.abs(value));
	return `${value >= 0 ? "+" : "−"}${formatted}`;
}

export function formatCompactCount(value: number, locale?: string): string {
	const formatted = new Intl.NumberFormat(locale ?? defaultLocale(), {
		notation: value >= 1000 ? "compact" : "standard",
		maximumFractionDigits: 2,
	}).format(value);
	return formatted.replace(/([KMBT])$/, (suffix) => suffix.toLowerCase());
}

function defaultLocale(): string {
	return typeof navigator !== "undefined" && navigator.language
		? navigator.language
		: "en-US";
}
