import type { DashboardWidgetId } from "../types";

export type WidgetQuickAction = "refresh" | "open-audio-output";

const actionListeners = new Map<string, Set<() => void>>();

function actionKey(widgetId: DashboardWidgetId, action: WidgetQuickAction) {
	return `${widgetId}:${action}`;
}

export function subscribeWidgetAction(
	widgetId: DashboardWidgetId,
	action: WidgetQuickAction,
	listener: () => void,
): () => void {
	const key = actionKey(widgetId, action);
	const listeners = actionListeners.get(key) ?? new Set<() => void>();
	listeners.add(listener);
	actionListeners.set(key, listeners);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) actionListeners.delete(key);
	};
}

export function requestWidgetAction(
	widgetId: DashboardWidgetId,
	action: WidgetQuickAction,
): void {
	for (const listener of actionListeners.get(actionKey(widgetId, action)) ??
		[]) {
		listener();
	}
}
