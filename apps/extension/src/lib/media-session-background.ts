import { ext } from "./extension-api";
import type { MediaSessionSnapshot } from "./media-session";

const STORAGE_KEY = "ktab.media-sessions.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, limit: number): string {
	return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function safeArtwork(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 2048) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

async function readSessions(): Promise<MediaSessionSnapshot[]> {
	const stored = await ext.storage.local.get(STORAGE_KEY);
	const value = stored[STORAGE_KEY];
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is MediaSessionSnapshot => {
		return (
			isRecord(entry) &&
			typeof entry.tabId === "number" &&
			typeof entry.title === "string" &&
			typeof entry.playing === "boolean"
		);
	});
}

async function removeTab(tabId: number): Promise<void> {
	const sessions = await readSessions();
	const next = sessions.filter((entry) => entry.tabId !== tabId);
	if (next.length !== sessions.length)
		await ext.storage.local.set({ [STORAGE_KEY]: next });
}

export function registerMediaSessionBackground() {
	ext.runtime.onMessage.addListener((message, sender) => {
		if (!isRecord(message) || typeof message.type !== "string")
			return undefined;
		if (message.type === "ktab:media:list") return readSessions();
		if (
			message.type !== "ktab:media:update" ||
			typeof sender.tab?.id !== "number"
		) {
			return undefined;
		}
		const snapshot = message.snapshot;
		if (!isRecord(snapshot) || typeof snapshot.available !== "boolean")
			return undefined;
		const tabId = sender.tab.id;
		void readSessions().then(async (sessions) => {
			if (!snapshot.available) return removeTab(tabId);
			const record: MediaSessionSnapshot = {
				tabId,
				updatedAt: Date.now(),
				title: safeText(snapshot.title, 180) || "Media playing",
				artist: safeText(snapshot.artist, 120),
				album: safeText(snapshot.album, 120),
				artwork: safeArtwork(snapshot.artwork),
				playing: snapshot.playing === true,
				currentTime:
					typeof snapshot.currentTime === "number" &&
					Number.isFinite(snapshot.currentTime)
						? snapshot.currentTime
						: 0,
				duration:
					typeof snapshot.duration === "number" &&
					Number.isFinite(snapshot.duration)
						? snapshot.duration
						: 0,
				canNext: snapshot.canNext === true,
				canPrevious: snapshot.canPrevious === true,
			};
			const next = sessions.filter((entry) => entry.tabId !== tabId);
			next.push(record);
			next.sort((a, b) => a.updatedAt - b.updatedAt);
			await ext.storage.local.set({ [STORAGE_KEY]: next.slice(-30) });
		});
		return undefined;
	});
	ext.tabs.onRemoved.addListener((tabId) => void removeTab(tabId));
}
