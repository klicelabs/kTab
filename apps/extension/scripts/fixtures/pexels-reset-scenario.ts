import { mock } from "bun:test";
import assert from "node:assert/strict";

process.env.VITE_PEXELS_PROXY_URL = "https://proxy.example/api/pexels";
const images = new Map<string, string>([["uploaded-photo", "private image"]]);
const values: Record<string, unknown> = {};
type ChangeListener = (
	changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
	area: string,
) => void;
const listeners: ChangeListener[] = [];
let notifyReset = () => {};
const resetStarted = new Promise<void>((resolve) => {
	notifyReset = resolve;
});
Object.defineProperty(globalThis, "chrome", {
	configurable: true,
	value: {
		storage: {
			local: {
				get: async (keys: string | string[]) =>
					Object.fromEntries(
						(Array.isArray(keys) ? keys : [keys]).map((key) => [
							key,
							values[key],
						]),
					),
				set: async (data: Record<string, unknown>) => {
					const changes: Record<
						string,
						{ oldValue?: unknown; newValue?: unknown }
					> = {};
					for (const [key, value] of Object.entries(data)) {
						changes[key] = { oldValue: values[key], newValue: value };
						values[key] = structuredClone(value);
					}
					for (const listener of listeners) listener(changes, "local");
					if ("perch-reset-generation" in data) notifyReset();
				},
				remove: async (key: string) => {
					delete values[key];
				},
				getBytesInUse: async () => 100,
			},
			onChanged: {
				addListener: (fn: ChangeListener) => listeners.push(fn),
				removeListener: () => {},
			},
		},
	},
});
mock.module("../../src/lib/idb", () => ({
	STORE_BG: "backgrounds",
	STORE_THUMBS: "thumbnails",
	getBookmarkTree: async () => null,
	putBookmarkTree: async () => undefined,
	clearBookmarkTree: async () => undefined,
	idbDelete: async (_store: string, id: string) => images.delete(id),
	idbGet: async (_store: string, id: string) => images.get(id) ?? null,
	idbGetAllKeys: async () => [...images.keys()],
	idbPut: async (_store: string, id: string, data: string) => {
		images.set(id, data);
	},
}));
mock.module("../../src/stores/image-store", () => ({
	useImageStore: {
		getState: () => ({
			clearAll: async () => {
				images.clear();
			},
		}),
	},
}));
let tail = Promise.resolve();
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: {
		locks: {
			request: (
				_name: string,
				optionsOrCallback: unknown,
				callback?: () => Promise<void>,
			) => {
				const action =
					typeof optionsOrCallback === "function"
						? optionsOrCallback
						: callback;
				if (typeof action !== "function")
					throw new Error("Missing lock callback");
				const result = tail.then(() => action());
				tail = result.then(
					() => undefined,
					() => undefined,
				);
				return result;
			},
		},
	},
});
Object.defineProperty(globalThis, "window", {
	configurable: true,
	value: {
		innerWidth: 1920,
		innerHeight: 1080,
		devicePixelRatio: 1,
		addEventListener: () => {},
		removeEventListener: () => {},
	},
});
Object.defineProperty(globalThis, "document", {
	configurable: true,
	value: {
		visibilityState: "visible",
		addEventListener: () => {},
		removeEventListener: () => {},
	},
});
let notifyDecode = () => {};
let releaseDecode = () => {};
const decoding = new Promise<void>((resolve) => {
	notifyDecode = resolve;
});
const decodeGate = new Promise<void>((resolve) => {
	releaseDecode = resolve;
});
Object.defineProperty(globalThis, "Image", {
	configurable: true,
	value: class {
		src = "";
		async decode() {
			notifyDecode();
			await decodeGate;
		}
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
let apiCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
	if (String(input).includes("proxy.example")) {
		apiCalls++;
		return Response.json({
			photos: [
				{
					id: 1,
					url: "https://www.pexels.com/photo/1",
					photographer: "Photographer",
					photographerUrl: "https://www.pexels.com/@photographer",
					width: 6000,
					height: 4000,
					src: Object.fromEntries(
						["original", "large2x", "large", "medium", "small"].map((key) => [
							key,
							"https://images.pexels.com/photos/1/photo.jpg",
						]),
					),
				},
			],
		});
	}
	return new Response(new Blob(["photo"], { type: "image/jpeg" }), {
		headers: { "Content-Type": "image/jpeg" },
	});
}) as typeof fetch;
const { useSetupStore } = await import("../../src/stores/setup-store");
const { flushPersist } = await import("../../src/lib/storage");
await useSetupStore.persist.rehydrate();
useSetupStore.getState().updateBackground({
	type: "pexels",
	pexelsQuery: "private search",
	pexelsFrequency: "daily",
});
await flushPersist();
values["ktab-pexels-v1"] = {
	version: 1,
	queues: [],
	recent: [123],
	current: null,
	retryAt: 0,
};
const engine = await import("../../src/services/wallpaper");
const refreshing = engine.refreshWallpaper(true);
await decoding;
const resetting = useSetupStore.getState().resetAll();
await resetStarted;
releaseDecode();
await Promise.all([refreshing, resetting]);
assert.equal(
	values["ktab-pexels-v1"],
	undefined,
	"reset removes query queue and recent history",
);
assert.equal(
	images.size,
	0,
	"reset removes all image bytes without in-flight resurrection",
);
assert.notEqual(useSetupStore.getState().settings.background.type, "pexels");
assert.equal(JSON.stringify(values).includes("private search"), false);
await engine.refreshWallpaper();
assert.equal(apiCalls, 1);
assert.equal(values["ktab-pexels-v1"], undefined);
