// A separate process prevents native-API shims and module caches leaking.
import { strict as assert } from "node:assert";

const mode = process.argv[2] ?? "stale";
const event = () => {
	const listeners: Array<(...args: unknown[]) => unknown> = [];
	return {
		addListener(fn: (...args: unknown[]) => unknown) {
			listeners.push(fn);
		},
		removeListener() {},
		emit(...args: unknown[]) {
			return listeners.map((fn) => fn(...args));
		},
	};
};
const removed: number[] = [];
const removedTabs: number[] = [];
const progress: Array<{ status?: string; failed?: number }> = [];
let failRead = false;
let setup: unknown = null;
let sessionCleared = false;
const stale = {
	status: "running",
	cardIds: ["card"],
	doneIds: [],
	failedIds: [],
	sites: {},
	startedAt: 1,
	captureWindowId: 1,
	captureTabId: 10,
};
const dashboard = {
	id: 10,
	windowId: 1,
	active: true,
	url: "extension://id/newtab.html",
};
const anchor = {
	id: 20,
	windowId: 1,
	active: false,
	url: "extension://id/capture.html#owner",
};
const target = {
	id: 30,
	windowId: 1,
	active: false,
	openerTabId: 20,
	url: "https://example.com/",
};
const adopted = {
	...stale,
	captureSurface: "window",
	captureOwnerToken: "owner",
	captureAnchorTabId: 20,
	captureTabId: 30,
};
const api = {
	permissions: { contains: async () => true },
	storage: {
		local: {
			get: async () => {
				if (failRead) throw new Error("disk-read-failed");
				return {
					"perch-setup": setup
						? JSON.stringify({ state: setup, version: 0 })
						: undefined,
					"perch-reset-generation": 0,
				};
			},
			set: async () => {},
		},
		session: {
			get: async () =>
				mode === "fatal"
					? {}
					: { "ktab-refresh-batch": mode === "adopted" ? adopted : stale },
			set: async () => {},
			remove: async () => {
				sessionCleared = true;
			},
		},
		onChanged: event(),
	},
	runtime: {
		getURL: (part: string) => `extension://id/${part.replace(/^\//, "")}`,
		onInstalled: event(),
		onStartup: event(),
		onMessage: event(),
		sendMessage: async (message: { status?: string }) => {
			progress.push(message);
			if (mode === "fatal" && message.status === "started") failRead = true;
		},
	},
	windows: {
		onRemoved: event(),
		onFocusChanged: event(),
		get: async () => ({
			id: 1,
			tabs: mode === "adopted" ? [dashboard, anchor, target] : [dashboard],
		}),
		remove: async (id: number) => {
			removed.push(id);
		},
	},
	tabs: {
		onUpdated: event(),
		onActivated: event(),
		onRemoved: event(),
		get: async (id: number) =>
			[dashboard, anchor, target].find((t) => t.id === id),
		query: async () => [dashboard],
		remove: async (id: number) => {
			removedTabs.push(id);
		},
	},
	contextMenus: { onClicked: event() },
	commands: { onCommand: event() },
	webNavigation: { onCompleted: event() },
};
Object.assign(globalThis, {
	browser: api,
	chrome: api,
	defineBackground: (fn: () => void) => fn(),
});
if (mode === "fatal") {
	const { normalizeState } = await import("../../src/lib/storage");
	const initial = normalizeState(null);
	initial.cards = [
		{
			id: "card",
			folderId: initial.activeFolderId,
			title: "Card",
			url: "https://example.com/",
			order: 0,
			thumbId: null,
			favicon: null,
		},
	];
	setup = initial;
}
await import("../../entrypoints/background");
if (mode === "fatal") {
	await new Promise((resolve) =>
		api.runtime.onMessage.emit(
			{ type: "refresh:single", cardId: "card" },
			{},
			resolve,
		),
	);
}
await new Promise((resolve) => setTimeout(resolve, 100));
assert.deepEqual(
	removed,
	[],
	"stored window IDs never authorize closing a user window",
);
assert(
	!removedTabs.includes(dashboard.id),
	"capture cleanup never removes the dashboard",
);
if (mode === "adopted") assert.deepEqual(removedTabs.sort(), [20, 30]);
if (mode === "fatal") {
	assert(
		progress.some((e) => e.status === "done" && e.failed === 1),
		"fatal queue reads must deliver terminal failure, not leave shimmer running",
	);
	assert(sessionCleared, "fatal queue reads must clear session resources");
}
