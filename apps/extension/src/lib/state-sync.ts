import type { Settings } from "../types";

export const STATE_SYNC_CHANNEL = "ktab_state_sync";

export type RealtimeSettings = Pick<
	Settings,
	| "appearanceMode"
	| "colorScheme"
	| "accentColor"
	| "glassIntensity"
	| "cornerScale"
	| "background"
	| "dialLayout"
	| "cardAspect"
	| "tileSize"
	| "maxColumns"
	| "showTitle"
	| "iconShowLabel"
	| "iconTileSurface"
>;

export interface StateSyncMessage {
	type: "ktab-state-sync";
	senderId: string;
	sequence: number;
	settings: RealtimeSettings;
}

export function realtimeSettings(settings: Settings): RealtimeSettings {
	return {
		appearanceMode: settings.appearanceMode,
		colorScheme: settings.colorScheme,
		accentColor: settings.accentColor,
		glassIntensity: settings.glassIntensity,
		cornerScale: settings.cornerScale,
		background: settings.background,
		dialLayout: settings.dialLayout,
		cardAspect: settings.cardAspect,
		tileSize: settings.tileSize,
		maxColumns: settings.maxColumns,
		showTitle: settings.showTitle,
		iconShowLabel: settings.iconShowLabel,
		iconTileSurface: settings.iconTileSurface,
	};
}

export function realtimeSettingsSignature(settings: Settings): string {
	return JSON.stringify(realtimeSettings(settings));
}

export function createStateSyncMessage(
	senderId: string,
	sequence: number,
	settings: Settings,
): StateSyncMessage {
	return {
		type: "ktab-state-sync",
		senderId,
		sequence,
		settings: realtimeSettings(settings),
	};
}

export function isStateSyncMessage(value: unknown): value is StateSyncMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Record<string, unknown>;
	return (
		message.type === "ktab-state-sync" &&
		typeof message.senderId === "string" &&
		message.senderId.length > 0 &&
		message.senderId.length <= 100 &&
		typeof message.sequence === "number" &&
		Number.isSafeInteger(message.sequence) &&
		message.sequence > 0 &&
		!!message.settings &&
		typeof message.settings === "object" &&
		!Array.isArray(message.settings)
	);
}
