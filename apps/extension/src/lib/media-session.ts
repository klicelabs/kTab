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

export interface MediaOutputResult {
	ok: boolean;
	reason?: "unsupported" | "no-media" | "blocked" | "failed";
}

export interface MediaAudioOutputDevice {
	deviceId: string;
	label: string;
}

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

/** Route only the selected tab's HTML media elements after the user chooses an output. */
export async function setMediaSessionOutput(
	tabId: number,
	deviceId: string,
): Promise<MediaOutputResult> {
	try {
		const result: unknown = await ext.tabs.sendMessage(tabId, {
			type: "ktab:media:set-output",
			deviceId,
		});
		if (
			typeof result === "object" &&
			result !== null &&
			"ok" in result &&
			typeof result.ok === "boolean"
		) {
			const reason = "reason" in result ? result.reason : undefined;
			return {
				ok: result.ok,
				reason:
					reason === "unsupported" ||
					reason === "no-media" ||
					reason === "blocked" ||
					reason === "failed"
						? reason
						: undefined,
			};
		}
		return { ok: false, reason: "failed" };
	} catch {
		return { ok: false, reason: "failed" };
	}
}

/** Ask the active media tab for its own origin-scoped output device IDs. */
export async function enumerateMediaSessionOutputs(tabId: number): Promise<{
	ok: boolean;
	devices: MediaAudioOutputDevice[];
	reason?: string;
}> {
	try {
		const result: unknown = await ext.tabs.sendMessage(tabId, {
			type: "ktab:media:list-outputs",
		});
		if (
			typeof result !== "object" ||
			result === null ||
			!("devices" in result)
		) {
			return { ok: false, devices: [], reason: "failed" };
		}
		const record = result as {
			ok?: unknown;
			devices?: unknown;
			reason?: unknown;
		};
		const devices = Array.isArray(record.devices)
			? record.devices.filter(
					(device): device is MediaAudioOutputDevice =>
						typeof device === "object" &&
						device !== null &&
						"deviceId" in device &&
						typeof device.deviceId === "string" &&
						"label" in device &&
						typeof device.label === "string",
				)
			: [];
		return {
			ok: record.ok === true,
			devices,
			reason: typeof record.reason === "string" ? record.reason : undefined,
		};
	} catch {
		return { ok: false, devices: [], reason: "failed" };
	}
}
