import { ext } from "./extension-api";

export interface MediaSessionSnapshot {
	tabId: number;
	updatedAt: number;
	title: string;
	artist: string;
	album: string;
	artwork: string | null;
	playing: boolean;
	currentTime: number;
	duration: number;
	canNext: boolean;
	canPrevious: boolean;
}

export type MediaControlAction = "play" | "pause" | "next" | "previous";

function isSnapshot(value: unknown): value is MediaSessionSnapshot {
	return (
		typeof value === "object" &&
		value !== null &&
		"tabId" in value &&
		typeof value.tabId === "number" &&
		"title" in value &&
		typeof value.title === "string" &&
		"playing" in value &&
		typeof value.playing === "boolean"
	);
}

function liveSnapshot(
	value: unknown,
	tabId: number,
): MediaSessionSnapshot | null {
	if (
		typeof value !== "object" ||
		value === null ||
		!("title" in value) ||
		typeof value.title !== "string" ||
		!("playing" in value) ||
		typeof value.playing !== "boolean"
	)
		return null;
	const record = value as Record<string, unknown>;
	return {
		tabId,
		updatedAt: Date.now(),
		title: typeof record.title === "string" ? record.title : "",
		artist: typeof record.artist === "string" ? record.artist : "",
		album: typeof record.album === "string" ? record.album : "",
		artwork: typeof record.artwork === "string" ? record.artwork : null,
		playing: record.playing === true,
		currentTime:
			typeof record.currentTime === "number" ? record.currentTime : 0,
		duration: typeof record.duration === "number" ? record.duration : 0,
		canNext: record.canNext === true,
		canPrevious: record.canPrevious === true,
	};
}

/** Prefer live audible tabs, then the most recently reported paused session. */
export async function queryMediaSessions(): Promise<MediaSessionSnapshot[]> {
	let saved: unknown = [];
	try {
		saved = await ext.runtime.sendMessage({ type: "ktab:media:list" });
	} catch {
		// The widget still works from audible tabs if the worker is restarting.
	}
	const sessions = Array.isArray(saved) ? saved.filter(isSnapshot) : [];
	let audibleTabs: Array<{ id?: number }> = [];
	try {
		audibleTabs = await ext.tabs.query({ audible: true });
	} catch {
		return sessions.sort(
			(a, b) =>
				Number(b.playing) - Number(a.playing) || b.updatedAt - a.updatedAt,
		);
	}
	const live = await Promise.all(
		audibleTabs
			.filter(
				(tab): tab is typeof tab & { id: number } => typeof tab.id === "number",
			)
			.map(async (tab) => {
				try {
					const response = await ext.tabs.sendMessage(tab.id, {
						type: "ktab:media:snapshot",
					});
					return liveSnapshot(response, tab.id);
				} catch {
					return null;
				}
			}),
	);
	const merged = new Map<number, MediaSessionSnapshot>();
	for (const session of sessions) merged.set(session.tabId, session);
	for (const session of live) {
		if (session) merged.set(session.tabId, session);
	}
	return [...merged.values()].sort(
		(a, b) =>
			Number(b.playing) - Number(a.playing) || b.updatedAt - a.updatedAt,
	);
}

export async function controlMediaSession(
	tabId: number,
	action: MediaControlAction,
): Promise<boolean> {
	try {
		return (
			(await ext.tabs.sendMessage(tabId, {
				type: "ktab:media:control",
				action,
			})) === true
		);
	} catch {
		return false;
	}
}
