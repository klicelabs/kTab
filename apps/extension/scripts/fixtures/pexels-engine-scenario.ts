import { mock } from "bun:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_BACKGROUND } from "../../src/lib/constants";
import type { BackgroundSettings } from "../../src/types";

process.env.VITE_PEXELS_PROXY_URL = "https://proxy.example/api/pexels";
// Each deliberate action gets a distinct timestamp; concurrent actions still share
// the final commit time and therefore exercise the engine's coalescing behavior.
let clock = Date.now();
Date.now = () => clock;
const settings: { background: BackgroundSettings } = {
	background: {
		...DEFAULT_BACKGROUND,
		type: "pexels" as const,
		pexelsFrequency: "per-tab" as "per-tab" | "hourly",
	},
};
interface Tab {
	settings: { background: BackgroundSettings };
}
const firstTab: Tab = { settings };
const secondTab: Tab = { settings: structuredClone(settings) };
const tabs = new AsyncLocalStorage<Tab>();
const currentTab = () => tabs.getStore() ?? firstTab;
let persistedSettings = structuredClone(settings);
const stored: Record<string, unknown> = {};
const images = new Map<string, string>();
mock.module("../../src/stores/setup-store", () => ({
	useSetupStore: {
		getState: () => ({
			settings: currentTab().settings,
			updateBackground: (patch: Partial<typeof settings.background>) => {
				Object.assign(currentTab().settings.background, patch);
			},
		}),
	},
}));
mock.module("../../src/lib/storage", () => ({
	flushPersist: async () => {
		persistedSettings = structuredClone(currentTab().settings);
	},
	getResetGeneration: () => 0,
	readSetupEnvelope: async () => ({
		settings: structuredClone(persistedSettings),
	}),
}));
mock.module("../../src/lib/idb", () => ({
	STORE_BG: "backgrounds",
	getBookmarkTree: async () => null,
	putBookmarkTree: async () => undefined,
	clearBookmarkTree: async () => undefined,
	idbGet: async (_store: string, id: string) => images.get(id) ?? null,
	idbDelete: async (_store: string, id: string) => images.delete(id),
	idbGetAllKeys: async () => [...images.keys()],
	idbPut: async (_store: string, id: string, data: string) => {
		images.set(id, data);
	},
}));
Object.defineProperty(globalThis, "chrome", {
	configurable: true,
	value: {
		storage: {
			local: {
				get: async (key: string) =>
					key === "perch-setup"
						? {
								"perch-setup": JSON.stringify({
									state: { settings: persistedSettings },
								}),
							}
						: { [key]: structuredClone(stored[key]) },
				set: async (data: Record<string, unknown>) => {
					Object.assign(stored, structuredClone(data));
				},
			},
		},
	},
});
let tail = Promise.resolve();
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: {
		locks: {
			request: (
				_name: string,
				_options: unknown,
				callback: () => Promise<void>,
			) => {
				const result = tail.then(callback);
				tail = result.catch(() => undefined);
				return result;
			},
		},
	},
});
Object.defineProperty(globalThis, "window", {
	configurable: true,
	value: { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 },
});
Object.defineProperty(globalThis, "Image", {
	configurable: true,
	value: class {
		src = "";
		decode = async () => undefined;
	},
});
Object.defineProperty(globalThis, "FileReader", {
	configurable: true,
	value: class {
		result = "";
		onload: (() => void) | null = null;
		readAsDataURL() {
			this.result = "data:image/jpeg;base64,dGVzdA==";
			this.onload?.();
		}
	},
});
const photo = (id: number) => ({
	id,
	url: `https://www.pexels.com/photo/${id}`,
	photographer: "Test photographer",
	photographerUrl: "https://www.pexels.com/@test",
	width: 6000,
	height: 4000,
	src: Object.fromEntries(
		["original", "large2x", "large", "medium", "small"].map((key) => [
			key,
			`https://images.pexels.com/photos/${id}/test.jpg`,
		]),
	),
});
let requests = 0;
let downloads = 0;
let failImage = false;
let failProxy = false;
const quotaQueries = new Set(["quota"]);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	if (String(input).includes("proxy.example")) {
		requests++;
		const { query } = JSON.parse(String(init?.body));
		if (failProxy) throw new TypeError("proxy connection failed");
		if (query === "transport") throw new TypeError("network offline");
		if (query === "empty") return Response.json({ photos: [] });
		if (quotaQueries.has(query))
			return new Response("limited", {
				status: 429,
				headers: { "Retry-After": "300" },
			});
		if (query === "slow")
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("aborted", "AbortError")),
					{ once: true },
				);
			});
		await new Promise((resolve) => setTimeout(resolve, 10));
		return Response.json({
			photos: Array.from({ length: 80 }, (_, i) =>
				photo(i + 1 + (query === "japan" ? 100 : 0)),
			),
		});
	}
	downloads++;
	if (failImage) throw new TypeError("image connection failed");
	return new Response(new Blob(["photo"], { type: "image/jpeg" }), {
		headers: { "Content-Type": "image/jpeg" },
	});
}) as typeof fetch;
const firstModule = await import("../../src/services/wallpaper");
const secondModule = await import(
	"../../src/services/wallpaper.ts?second-context"
);
const engine = {
	...firstModule,
	refreshWallpaper: (force = false) => {
		clock += 1;
		return tabs.run(firstTab, () => firstModule.refreshWallpaper(force));
	},
};
const second = {
	...secondModule,
	refreshWallpaper: (force = false) => {
		clock += 1;
		return tabs.run(secondTab, () => secondModule.refreshWallpaper(force));
	},
};
await Promise.all([
	engine.refreshWallpaper(true),
	second.refreshWallpaper(true),
]);
assert.equal(requests, 1);
assert.equal(downloads, 1);
assert.equal(
	firstTab.settings.background.pexelsImageId,
	secondTab.settings.background.pexelsImageId,
);
const firstId = settings.background.pexelsPhoto?.id;
await engine.refreshWallpaper(true);
assert.equal(requests, 1);
assert.equal(downloads, 2);
assert.notEqual(settings.background.pexelsPhoto?.id, firstId);
settings.background.pexelsFrequency = "hourly";
secondTab.settings.background.pexelsFrequency = "hourly";
await second.refreshWallpaper();
assert.equal(downloads, 2);
// A depleted provider budget for Japan must leave the already-cached Nature bag usable.
quotaQueries.add("japan");
settings.background.pexelsQuery = "Japan";
await engine.refreshWallpaper(true);
const afterJapanQuota = requests;
const beforeCachedNature = downloads;
await second.refreshWallpaper(true);
assert.equal(requests, afterJapanQuota);
assert.equal(
	downloads,
	beforeCachedNature + 1,
	"cached Nature rotates while Japan's API request is rate limited",
);
assert.equal(second.useWallpaperStatus.getState().status, "idle");
quotaQueries.delete("japan");
(stored["ktab-pexels-v1"] as { retryAt: number }).retryAt = 0;
Object.assign(
	settings.background,
	structuredClone(secondTab.settings.background),
);
const prior = settings.background.pexelsImageId;
settings.background.pexelsQuery = "empty";
await engine.refreshWallpaper(true);
assert.equal(settings.background.pexelsImageId, prior);
assert.equal(engine.useWallpaperStatus.getState().status, "empty");
settings.background.pexelsQuery = "slow";
const stale = engine.refreshWallpaper(true);
await new Promise((resolve) => setTimeout(resolve, 10));
settings.background.pexelsQuery = "Japan";
await engine.refreshWallpaper(true);
await stale;
assert.ok((settings.background.pexelsPhoto?.id ?? 0) > 100);
settings.background.pexelsQuery = "quota";
await engine.refreshWallpaper(true);
const afterQuota = requests;
await second.refreshWallpaper(true);
assert.equal(requests, afterQuota);
assert.equal(images.size, 1);
const clearBackoff = () => {
	(stored["ktab-pexels-v1"] as { retryAt: number }).retryAt = 0;
};
clearBackoff();
firstTab.settings.background.pexelsQuery = "transport";
secondTab.settings.background.pexelsQuery = "transport";
const beforeTransport = requests;
await Promise.all([
	engine.refreshWallpaper(true),
	second.refreshWallpaper(true),
]);
assert.equal(
	requests,
	beforeTransport + 1,
	"concurrent tabs share one rejected proxy fetch",
);
firstTab.settings.background.pexelsQuery = "cities";
await engine.refreshWallpaper(true);
assert.equal(
	requests,
	beforeTransport + 2,
	"a failed query does not block another theme or search",
);
// An expired batch may be reused after transport failure without retrying the API on each Next.
firstTab.settings.background.pexelsQuery = "cinematic nature landscape";
await engine.refreshWallpaper(true);
const natureQueue = (
	stored["ktab-pexels-v1"] as {
		queues: { query: string; fetchedAt: number }[];
	}
).queues.find((queue) => queue.query === "cinematic nature landscape");
assert.ok(natureQueue);
natureQueue.fetchedAt = Date.now() - 172_800_000;
failProxy = true;
const beforeStaleRequests = requests;
const beforeStaleDownloads = downloads;
await engine.refreshWallpaper(true);
await engine.refreshWallpaper(true);
assert.equal(
	requests,
	beforeStaleRequests + 1,
	"failed API refresh has shared backoff even when stale cache succeeds",
);
assert.equal(
	downloads,
	beforeStaleDownloads + 2,
	"stale cached photos remain available without fresh API calls",
);
failProxy = false;
const updatedNature = (
	stored["ktab-pexels-v1"] as {
		queues: { query: string; fetchedAt: number }[];
	}
).queues.find((queue) => queue.query === "cinematic nature landscape");
assert.ok(updatedNature);
updatedNature.fetchedAt = Date.now();
clearBackoff();
firstTab.settings.background.pexelsQuery = "image failure";
secondTab.settings.background.pexelsQuery = "image failure";
failImage = true;
const beforeFailureRequests = requests;
const beforeFailureDownloads = downloads;
const firstPrior = firstTab.settings.background.pexelsImageId;
const secondPrior = secondTab.settings.background.pexelsImageId;
await Promise.all([
	engine.refreshWallpaper(true),
	second.refreshWallpaper(true),
]);
assert.equal(requests, beforeFailureRequests + 1);
assert.equal(
	downloads,
	beforeFailureDownloads + 1,
	"image transport failure has one shared retry cooldown",
);
assert.equal(firstTab.settings.background.pexelsImageId, firstPrior);
assert.equal(secondTab.settings.background.pexelsImageId, secondPrior);
failImage = false;
secondTab.settings.background.pexelsQuery = "cinematic nature landscape";
const beforeOtherThemeDownloads = downloads;
await second.refreshWallpaper(true);
assert.equal(
	downloads,
	beforeOtherThemeDownloads + 1,
	"another cached theme can rotate during a query-scoped image cooldown",
);
assert.equal(requests, beforeFailureRequests + 1);
// Preparing a photo never changes the displayed selection or spends another API call.
firstTab.settings.background.pexelsQuery = "cinematic nature landscape";
firstTab.settings.background.pexelsFrequency = "per-tab";
secondTab.settings.background.pexelsFrequency = "per-tab";
await (await import("../../src/lib/storage")).flushPersist();
const beforePreparation = firstTab.settings.background.pexelsImageId;
const apiBeforePreparation = requests;
const downloadsBeforePreparation = downloads;
await Promise.all([
	firstModule.prepareNextWallpaper(),
	tabs.run(secondTab, () => secondModule.prepareNextWallpaper()),
]);
assert.equal(
	downloads,
	downloadsBeforePreparation + 1,
	"the successor is downloaded ahead of rotation",
);
assert.equal(firstTab.settings.background.pexelsImageId, beforePreparation);
assert.equal(requests, apiBeforePreparation);
const downloadsAfterPreparation = downloads;
const preparedId = (
	stored["ktab-pexels-v1"] as { prepared: { imageId: string } }
).prepared.imageId;
await engine.refreshWallpaper();
assert.equal(firstTab.settings.background.pexelsImageId, preparedId);
assert.notEqual(firstTab.settings.background.pexelsImageId, beforePreparation);
assert.equal(
	downloads,
	downloadsAfterPreparation,
	"rotation consumes the already downloaded photo",
);
assert.equal(
	images.size,
	1,
	"only the current image remains after consuming the prepared photo",
);
await engine.refreshWallpaper();
assert.notEqual(
	firstTab.settings.background.pexelsImageId,
	preparedId,
	"sequential new tabs rotate even less than a second apart",
);
const helpers = await import("../../src/lib/pexels");
assert.equal(
	helpers.normalizePexelsQuery("  Spider-Man   Japan "),
	"spider-man japan",
);
assert.equal(
	new URL(helpers.wallpaperImageUrl(photo(1), 1920, 1080, 1)).searchParams.get(
		"w",
	),
	"1920",
);
assert.equal(
	new URL(helpers.wallpaperImageUrl(photo(1), 3840, 2160, 2)).searchParams.get(
		"w",
	),
	"3840",
);
assert.equal(
	helpers.isPexelsPhoto({
		...photo(1),
		src: { ...photo(1).src, original: "https://evil.example/image.jpg" },
	}),
	false,
);
