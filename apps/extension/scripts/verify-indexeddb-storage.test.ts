import { expect, test } from "bun:test";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { DEFAULT_SETUP } from "../src/lib/constants";
import { getBookmarkTree, openIDB, STORE_BOOKMARKS } from "../src/lib/idb";

Object.defineProperty(globalThis, "indexedDB", {
	configurable: true,
	value: fakeIndexedDB,
});

const values = new Map<string, unknown>();
const local = {
	async get(keys: string | string[] | Record<string, unknown>) {
		const requested = Array.isArray(keys)
			? keys
			: typeof keys === "string"
				? [keys]
				: Object.keys(keys);
		return Object.fromEntries(
			requested.flatMap((key) =>
				values.has(key) ? [[key, values.get(key)]] : [],
			),
		);
	},
	async set(items: Record<string, unknown>) {
		for (const [key, value] of Object.entries(items)) values.set(key, value);
	},
	async remove(keys: string | string[]) {
		for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
	},
	async getBytesInUse(keys: string | string[] | null) {
		const selected =
			keys === null ? [...values.keys()] : Array.isArray(keys) ? keys : [keys];
		return selected.reduce(
			(total, key) =>
				total +
				(values.has(key)
					? new TextEncoder().encode(String(values.get(key))).byteLength
					: 0),
			0,
		);
	},
};

(globalThis as Record<string, unknown>).chrome = {
	storage: {
		local,
		onChanged: {
			addListener: () => undefined,
			removeListener: () => undefined,
		},
	},
};
(globalThis as Record<string, unknown>).localStorage = {
	getItem: (key: string) => (values.get(key) as string | undefined) ?? null,
	setItem: (key: string, value: string) => void values.set(key, value),
	removeItem: (key: string) => void values.delete(key),
} as Storage;

const { chromeStorageAdapter, readSetupEnvelope } = await import(
	"../src/lib/storage"
);

test("legacy bookmark data migrates to IndexedDB before chrome storage is compacted", async () => {
	await openIDB();
	const state = structuredClone(DEFAULT_SETUP);
	state.folders = [{ id: "home", name: "Home", order: 0, parentId: null }];
	state.activeFolderId = "home";
	state.cards = [
		{
			id: "bookmark-1",
			folderId: "home",
			title: "A very large bookmark collection entry",
			url: "https://example.com/",
			favicon: null,
			thumbId: null,
			order: 0,
		},
	];
	state.itemOrder = { home: ["card:bookmark-1"] };
	values.set("perch-setup", JSON.stringify({ state, version: 0 }));

	const hydrated = await chromeStorageAdapter.getItem("perch-setup");
	expect(hydrated?.state.cards.map((card) => card.id)).toEqual(["bookmark-1"]);
	expect((await getBookmarkTree())?.folders[0]?.id).toBe("home");
	expect((await openIDB()).objectStoreNames.contains(STORE_BOOKMARKS)).toBe(
		true,
	);

	const compacted = JSON.parse(values.get("perch-setup") as string) as {
		state: { cards: unknown[]; folders: unknown[]; settings: unknown };
	};
	expect(compacted.state.cards).toEqual([]);
	expect(compacted.state.folders).toEqual([]);
	expect(compacted.state.settings).toBeDefined();

	const nextState = structuredClone(hydrated?.state ?? DEFAULT_SETUP);
	const firstCard = nextState.cards[0];
	if (!firstCard) throw new Error("Expected the migrated bookmark to remain.");
	nextState.cards[0] = { ...firstCard, title: "Renamed locally" };
	await chromeStorageAdapter.setItem("perch-setup", {
		state: nextState,
		version: 0,
	});
	const stored = JSON.parse(values.get("perch-setup") as string) as {
		state: { cards: unknown[] };
	};
	expect(stored.state.cards).toEqual([]);
	expect((await readSetupEnvelope("perch-setup"))?.cards[0]?.title).toBe(
		"Renamed locally",
	);
});
