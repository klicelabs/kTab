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

type MediaPageRequest =
	| { type: "control"; action: MediaControlAction }
	| { type: "list-outputs" }
	| { type: "set-output"; deviceId: string };

/**
 * This function is serialized into one tab only after a direct user action:
 * transport click, opening the output picker, or choosing an output.
 * Keep it self-contained so executeScript can run it in the page's MAIN world.
 */
export async function mediaPageRequest(
	request: MediaPageRequest,
): Promise<unknown> {
	const mediaElements = Array.from(
		document.querySelectorAll<HTMLMediaElement>("audio,video"),
	);
	const media =
		mediaElements.find((element) => !element.paused && !element.ended) ??
		mediaElements.find(
			(element) =>
				Boolean(element.currentSrc) || Number.isFinite(element.duration),
		) ??
		null;

	if (request.type === "list-outputs") {
		const mediaDevices = navigator.mediaDevices;
		if (!mediaDevices || typeof mediaDevices.enumerateDevices !== "function") {
			return { ok: false, devices: [], reason: "unsupported" };
		}
		try {
			const devices = (await mediaDevices.enumerateDevices())
				.filter((device) => device.kind === "audiooutput")
				.map((device) => ({
					deviceId: device.deviceId,
					label: device.label.trim(),
				}));
			return { ok: true, devices };
		} catch {
			return { ok: false, devices: [], reason: "failed" };
		}
	}

	if (request.type === "set-output") {
		if (!media) return { ok: false, reason: "no-media" };
		const sinkable = media as HTMLMediaElement & {
			setSinkId?: (deviceId: string) => Promise<void>;
			sinkId?: string;
		};
		if (typeof sinkable.setSinkId !== "function") {
			return { ok: false, reason: "unsupported" };
		}
		if (
			sinkable.sinkId === request.deviceId ||
			(request.deviceId === "" &&
				(!sinkable.sinkId || sinkable.sinkId === "default"))
		) {
			return { ok: true };
		}
		try {
			await sinkable.setSinkId(request.deviceId);
			return { ok: true };
		} catch (error) {
			const name =
				typeof error === "object" &&
				error !== null &&
				"name" in error &&
				typeof error.name === "string"
					? error.name
					: "";
			return {
				ok: false,
				reason: name === "NotAllowedError" ? "blocked" : "failed",
			};
		}
	}

	if (request.action === "play" || request.action === "pause") {
		if (media) {
			if (request.action === "play") {
				try {
					await media.play();
				} catch {
					return false;
				}
			} else {
				media.pause();
			}
			return true;
		}
		const selector =
			request.action === "play"
				? "button[aria-label*='play' i]"
				: "button[aria-label*='pause' i]";
		const button = document.querySelector<HTMLElement>(selector);
		button?.click();
		return Boolean(button);
	}

	const selectors =
		request.action === "next"
			? [
					"#movie_player .ytp-next-button",
					"button[data-testid='control-button-skip-forward']",
					"button[aria-label*='next track' i]",
					"button[aria-label*='next song' i]",
					"button[title*='next track' i]",
					"button[aria-label='Next' i]",
				]
			: [
					"#movie_player .ytp-prev-button",
					"button[data-testid='control-button-skip-back']",
					"button[aria-label*='previous track' i]",
					"button[aria-label*='previous song' i]",
					"button[title*='previous track' i]",
					"button[aria-label='Previous' i]",
				];
	const button = selectors
		.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
		.find((candidate) => !candidate.hasAttribute("disabled"));
	if (!(button instanceof HTMLElement)) return false;
	button.click();
	return true;
}

interface MediaTab {
	id?: number;
	title?: string;
	url?: string;
	favIconUrl?: string;
	audible?: boolean;
	lastAccessed?: number;
}

function hostForTab(url: string | undefined): string {
	if (!url) return "";
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function safeArtwork(value: string | undefined): string | null {
	if (!value || value.length > 2048) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

function snapshotFromTab(
	tab: MediaTab,
	playing: boolean,
): MediaSessionSnapshot | null {
	if (typeof tab.id !== "number") return null;
	const host = hostForTab(tab.url);
	return {
		tabId: tab.id,
		updatedAt: Date.now(),
		title: tab.title?.trim() || host || "Media playing",
		artist: host || "Browser tab",
		album: "",
		artwork: safeArtwork(tab.favIconUrl),
		playing,
		currentTime: 0,
		duration: 0,
		// Capabilities are attempted only after an explicit transport click.
		canNext: true,
		canPrevious: true,
	};
}

async function executeMediaPage(
	tabId: number,
	request: MediaPageRequest,
): Promise<unknown> {
	try {
		const results = await ext.scripting.executeScript({
			target: { tabId },
			world: "MAIN",
			func: mediaPageRequest,
			args: [request],
		});
		return results[0]?.result ?? null;
	} catch {
		return null;
	}
}

/** Read titles and favicons from the browser API without messaging into tabs. */
export async function queryMediaSessions(
	preferredTabId?: number,
): Promise<MediaSessionSnapshot[]> {
	let audibleTabs: MediaTab[] = [];
	try {
		audibleTabs = await ext.tabs.query({ audible: true });
	} catch {
		return [];
	}
	audibleTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
	const sessions = audibleTabs
		.map((tab) => snapshotFromTab(tab, true))
		.filter((session): session is MediaSessionSnapshot => session !== null);
	if (sessions.length > 0 || preferredTabId === undefined) return sessions;

	try {
		const pausedTab = (await ext.tabs.get(preferredTabId)) as MediaTab;
		const pausedSession = snapshotFromTab(pausedTab, false);
		return pausedSession ? [pausedSession] : [];
	} catch {
		return [];
	}
}

export async function controlMediaSession(
	tabId: number,
	action: MediaControlAction,
): Promise<boolean> {
	return (await executeMediaPage(tabId, { type: "control", action })) === true;
}

/** Inject once, and only after the user chooses a device in the output picker. */
export async function setMediaSessionOutput(
	tabId: number,
	deviceId: string,
): Promise<MediaOutputResult> {
	const result: unknown = await executeMediaPage(tabId, {
		type: "set-output",
		deviceId,
	});
	return isMediaOutputResult(result) ? result : { ok: false, reason: "failed" };
}

/** Enumerate devices once when the user opens the output picker. */
export async function enumerateMediaSessionOutputs(tabId: number): Promise<{
	ok: boolean;
	devices: MediaAudioOutputDevice[];
	reason?: string;
}> {
	const result: unknown = await executeMediaPage(tabId, {
		type: "list-outputs",
	});
	if (typeof result !== "object" || result === null || !("devices" in result)) {
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
}

function isMediaOutputResult(value: unknown): value is MediaOutputResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"ok" in value &&
		typeof value.ok === "boolean"
	);
}
