import { expect, test } from "bun:test";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
	clearBookmarkTree,
	clearWeatherCache,
	DB_NAME,
	DB_VERSION,
	getBookmarkTree,
	getIconBlob,
	getWeatherCache,
	getWidgetCache,
	idbGet,
	openIDB,
	putBookmarkTree,
	putWeatherCache,
	putWidgetCache,
	STORE_BG,
	STORE_BOOKMARKS,
	STORE_ICONS,
	STORE_THUMBS,
	STORE_WEATHER,
	STORE_WIDGETS,
} from "../src/lib/idb";

Object.defineProperty(globalThis, "indexedDB", {
	configurable: true,
	value: fakeIndexedDB,
});

async function deleteDatabase(): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () =>
			reject(new Error("IndexedDB delete was blocked."));
	});
}

async function createVersionTwoDatabase(): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 2);
		request.onupgradeneeded = () => {
			const database = request.result;
			database.createObjectStore(STORE_THUMBS);
			database.createObjectStore(STORE_BG);
			database.createObjectStore(STORE_ICONS);
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const transaction = database.transaction(
				[STORE_THUMBS, STORE_BG, STORE_ICONS],
				"readwrite",
			);
			transaction.objectStore(STORE_THUMBS).put("keep", "existing-thumb");
			transaction.objectStore(STORE_BG).put("keep", "existing-background");
			transaction.objectStore(STORE_ICONS).put(
				{
					src: "https://example.com/icon.svg",
					fetchedAt: 10,
					blob: new Blob(["icon"]),
				},
				"existing-icon",
			);
			transaction.oncomplete = () => {
				database.close();
				resolve();
			};
			transaction.onerror = () => reject(transaction.error);
		};
	});
}

test("upgrades retain assets and add weather and third-party widget caches", async () => {
	await deleteDatabase();
	await createVersionTwoDatabase();

	const database = await openIDB();
	expect(database.version).toBe(DB_VERSION);
	expect([...database.objectStoreNames]).toEqual([
		STORE_BG,
		STORE_BOOKMARKS,
		STORE_ICONS,
		STORE_THUMBS,
		STORE_WEATHER,
		STORE_WIDGETS,
	]);
	expect(await idbGet(STORE_THUMBS, "existing-thumb")).toBe("keep");
	expect(await idbGet(STORE_BG, "existing-background")).toBe("keep");
	expect((await getIconBlob("existing-icon"))?.blob.size).toBe(4);

	const cached = {
		locationKey: "-22.920,-42.510",
		fetchedAt: 1234,
		reading: { temperatureC: 26, weatherCode: 0, isDay: true },
	};
	await putWeatherCache(cached);
	expect(await getWeatherCache()).toEqual(cached);
	await clearWeatherCache();
	expect(await getWeatherCache()).toBeNull();
	await putWidgetCache("market:^BVSP", {
		fetchedAt: 4321,
		value: [{ symbol: "^BVSP", price: 125_053 }],
	});
	expect(await getWidgetCache("market:^BVSP")).toEqual({
		fetchedAt: 4321,
		value: [{ symbol: "^BVSP", price: 125_053 }],
	});
	const bookmarkTree = {
		folders: [{ id: "home", name: "Home", order: 0, parentId: null }],
		cards: [],
		itemOrder: { home: [] },
	};
	await putBookmarkTree(bookmarkTree);
	expect(await getBookmarkTree()).toEqual(bookmarkTree);
	await clearBookmarkTree();
	expect(await getBookmarkTree()).toBeNull();
	database.close();
});
