import type { DashboardWidgetId } from "../types";

export const DEFAULT_WIDGET_ORDER: DashboardWidgetId[] = [
	"weather",
	"music",
	"market",
	"github",
];

const WIDGET_IDS = new Set<DashboardWidgetId>(DEFAULT_WIDGET_ORDER);

export function normalizeWidgetOrder(
	value: unknown,
	fallback: readonly DashboardWidgetId[] = DEFAULT_WIDGET_ORDER,
): DashboardWidgetId[] {
	const candidates = Array.isArray(value) ? value : [];
	const next: DashboardWidgetId[] = [];
	for (const candidate of candidates) {
		if (
			typeof candidate === "string" &&
			WIDGET_IDS.has(candidate as DashboardWidgetId) &&
			!next.includes(candidate as DashboardWidgetId)
		) {
			next.push(candidate as DashboardWidgetId);
		}
	}
	for (const id of fallback) {
		if (WIDGET_IDS.has(id) && !next.includes(id)) next.push(id);
	}
	return next;
}

export function moveWidget(
	order: readonly DashboardWidgetId[],
	active: DashboardWidgetId,
	target: DashboardWidgetId,
	after = false,
): DashboardWidgetId[] {
	const next = normalizeWidgetOrder(order);
	const from = next.indexOf(active);
	const targetIndex = next.indexOf(target);
	if (from < 0 || targetIndex < 0 || active === target) return next;
	const [moving] = next.splice(from, 1);
	if (!moving) return next;
	let insertAt = targetIndex + (after ? 1 : 0);
	if (from < insertAt) insertAt -= 1;
	next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, moving);
	return next;
}
