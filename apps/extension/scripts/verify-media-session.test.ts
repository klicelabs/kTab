import { afterEach, expect, test } from "bun:test";
import {
	controlMediaSession,
	enumerateMediaSessionOutputs,
	queryMediaSessions,
	setMediaSessionOutput,
} from "../src/lib/media-session";

const scope = globalThis as unknown as {
	browser?: unknown;
	chrome?: unknown;
};
const originalBrowser = scope.browser;
const originalChrome = scope.chrome;
const originalDocument = Object.getOwnPropertyDescriptor(
	globalThis,
	"document",
);
const originalNavigator = Object.getOwnPropertyDescriptor(
	globalThis,
	"navigator",
);

function installBrowserApi(value: unknown) {
	scope.browser = undefined;
	scope.chrome = value;
}

function installPage(media: Record<string, unknown>) {
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			querySelectorAll: (selector: string) =>
				selector === "audio,video" ? [media] : [],
			querySelector: () => null,
		},
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {
			mediaDevices: {
				enumerateDevices: async () => [
					{ kind: "audioinput", deviceId: "mic", label: "Microphone" },
					{ kind: "audiooutput", deviceId: "speaker", label: "Desk speakers" },
				],
			},
		},
	});
}

afterEach(() => {
	scope.browser = originalBrowser;
	scope.chrome = originalChrome;
	if (originalDocument) {
		Object.defineProperty(globalThis, "document", originalDocument);
	} else {
		Reflect.deleteProperty(globalThis, "document");
	}
	if (originalNavigator) {
		Object.defineProperty(globalThis, "navigator", originalNavigator);
	} else {
		Reflect.deleteProperty(globalThis, "navigator");
	}
});

test("reads audible tab title and favicon without messaging or injecting", async () => {
	const calls = { queries: [] as unknown[], messages: 0, scripts: 0 };
	installBrowserApi({
		tabs: {
			query: async (query: unknown) => {
				calls.queries.push(query);
				return [
					{
						id: 4,
						title: "People Are Strange - YouTube",
						url: "https://www.youtube.com/watch?v=example",
						favIconUrl: "https://www.youtube.com/s/desktop/abcdef/favicon.ico",
						audible: true,
						lastAccessed: 20,
					},
				];
			},
			sendMessage: async () => {
				calls.messages += 1;
				return null;
			},
		},
		scripting: {
			executeScript: async () => {
				calls.scripts += 1;
				return [];
			},
		},
	});

	const sessions = await queryMediaSessions();

	expect(calls.queries).toEqual([{ audible: true }]);
	expect(calls.messages).toBe(0);
	expect(calls.scripts).toBe(0);
	expect(sessions[0]).toMatchObject({
		tabId: 4,
		title: "People Are Strange - YouTube",
		artist: "youtube.com",
		artwork: "https://www.youtube.com/s/desktop/abcdef/favicon.ico",
		playing: true,
		currentTime: 0,
		duration: 0,
	});
});

test("retains a selected paused tab using the passive tabs API", async () => {
	installBrowserApi({
		tabs: {
			query: async () => [],
			get: async (tabId: number) => ({
				id: tabId,
				title: "A paused video",
				url: "https://video.example/watch/1",
				favIconUrl: "https://video.example/favicon.ico",
				audible: false,
			}),
		},
	});

	expect(await queryMediaSessions(12)).toMatchObject([
		{ tabId: 12, title: "A paused video", playing: false },
	]);
});

test("executes controls only for the requested tab and never routes output", async () => {
	const calls: { tabId: number; world: string; args: unknown[] }[] = [];
	let pauses = 0;
	let sinkChanges = 0;
	const media = {
		paused: false,
		ended: false,
		currentSrc: "https://video.example/video.mp4",
		duration: 100,
		pause: () => {
			pauses += 1;
		},
		setSinkId: async () => {
			sinkChanges += 1;
		},
	};
	installPage(media);
	installBrowserApi({
		scripting: {
			executeScript: async (details: {
				target: { tabId: number };
				world: string;
				func: (...args: never[]) => unknown;
				args: unknown[];
			}) => {
				calls.push({
					tabId: details.target.tabId,
					world: details.world,
					args: details.args,
				});
				const result = await details.func(...(details.args as never[]));
				return [{ result }];
			},
		},
	});

	expect(await controlMediaSession(9, "pause")).toBe(true);
	expect(pauses).toBe(1);
	expect(sinkChanges).toBe(0);
	expect(calls).toEqual([
		{
			tabId: 9,
			world: "MAIN",
			args: [{ type: "control", action: "pause" }],
		},
	]);
});

test("lists outputs on picker open and calls setSinkId only for selection", async () => {
	const calls: { tabId: number; world: string; args: unknown[] }[] = [];
	const sinkChanges: string[] = [];
	const media = {
		paused: false,
		ended: false,
		currentSrc: "https://video.example/video.mp4",
		duration: 100,
		sinkId: "default",
		setSinkId: async (deviceId: string) => {
			sinkChanges.push(deviceId);
		},
	};
	installPage(media);
	installBrowserApi({
		scripting: {
			executeScript: async (details: {
				target: { tabId: number };
				world: string;
				func: (...args: never[]) => unknown;
				args: unknown[];
			}) => {
				calls.push({
					tabId: details.target.tabId,
					world: details.world,
					args: details.args,
				});
				const result = await details.func(...(details.args as never[]));
				return [{ result }];
			},
		},
	});

	expect(await enumerateMediaSessionOutputs(15)).toEqual({
		ok: true,
		devices: [{ deviceId: "speaker", label: "Desk speakers" }],
	});
	expect(sinkChanges).toEqual([]);
	const result = await setMediaSessionOutput(15, "speaker");
	expect(result).toEqual({ ok: true });
	expect(sinkChanges).toEqual(["speaker"]);
	expect(calls.map(({ tabId, world }) => ({ tabId, world }))).toEqual([
		{ tabId: 15, world: "MAIN" },
		{ tabId: 15, world: "MAIN" },
	]);
});
