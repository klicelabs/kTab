/**
 * Low-level IndexedDB helpers for the kTab image database.
 *
 * This is the single source of truth for the DB schema. Both the reactive
 * image store (newtab/popup) and the background service worker import from
 * here — do not re-open "perch-db" or redefine these stores anywhere else.
 */

import type { CachedWeather, Setup } from "../types";

// "perch-db" is the legacy database name; kept so existing installs retain
// their thumbnails and backgrounds after the rename to kTab.
export const DB_NAME = "perch-db";
export const DB_VERSION = 4;
export const STORE_THUMBS = "thumbnails";
export const STORE_BG = "backgrounds";
export const STORE_ICONS = "icons";
export const STORE_WEATHER = "weather";
export const STORE_BOOKMARKS = "bookmark-tree";

export type ImageStoreName = typeof STORE_THUMBS | typeof STORE_BG;
export interface ImageWrite {
	store: ImageStoreName;
	key: string;
	value: string;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function resetDBPromise() {
	_dbPromise = null;
}

export function openIDB(): Promise<IDBDatabase> {
	if (_dbPromise) return _dbPromise;
	_dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_THUMBS))
				db.createObjectStore(STORE_THUMBS);
			if (!db.objectStoreNames.contains(STORE_BG))
				db.createObjectStore(STORE_BG);
			if (!db.objectStoreNames.contains(STORE_ICONS))
				db.createObjectStore(STORE_ICONS);
			if (!db.objectStoreNames.contains(STORE_WEATHER))
				db.createObjectStore(STORE_WEATHER);
			if (!db.objectStoreNames.contains(STORE_BOOKMARKS))
				db.createObjectStore(STORE_BOOKMARKS);
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onclose = resetDBPromise;
			db.onversionchange = () => {
				db.close();
				resetDBPromise();
			};
			resolve(db);
		};
		req.onerror = () => {
			resetDBPromise();
			reject(req.error);
		};
	});
	return _dbPromise;
}

export async function idbPut(
	store: ImageStoreName,
	key: string,
	value: string,
): Promise<void> {
	const db = await openIDB();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const tx = db.transaction(store, "readwrite");
	tx.objectStore(store).put(value, key);
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	return promise;
}
export async function putImages(images: readonly ImageWrite[]): Promise<void> {
	if (images.length === 0) return;
	const db = await openIDB();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const tx = db.transaction([STORE_THUMBS, STORE_BG], "readwrite");
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	tx.onabort = () =>
		reject(tx.error ?? new Error("Image restore transaction aborted."));
	try {
		for (const image of images) {
			tx.objectStore(image.store).put(image.value, image.key);
		}
	} catch (error) {
		reject(error);
	}
	return promise;
}
export async function idbGet(
	store: ImageStoreName,
	key: string,
): Promise<string | null> {
	const db = await openIDB();
	const { promise, resolve, reject } = Promise.withResolvers<string | null>();
	const tx = db.transaction(store, "readonly");
	const req = tx.objectStore(store).get(key);
	req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
	req.onerror = () => reject(req.error);
	return promise;
}

export async function idbDelete(
	store: ImageStoreName,
	key: string,
): Promise<void> {
	const db = await openIDB();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const tx = db.transaction(store, "readwrite");
	tx.objectStore(store).delete(key);
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	return promise;
}

/** List every stored key (used by the hydration orphan sweep for thumbs). */
export async function idbGetAllKeys(
	store: ImageStoreName,
): Promise<IDBValidKey[]> {
	const db = await openIDB();
	const { promise, resolve, reject } = Promise.withResolvers<IDBValidKey[]>();
	const tx = db.transaction(store, "readonly");
	const req = tx.objectStore(store).getAllKeys();
	tx.oncomplete = () => resolve(req.result);
	tx.onerror = () => reject(tx.error);
	return promise;
}

export async function idbClearStores(stores: ImageStoreName[]): Promise<void> {
	const db = await openIDB();
	const tx = db.transaction(stores, "readwrite");
	for (const store of stores) tx.objectStore(store).clear();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	return promise;
}

export interface CachedIconBlob {
	/** Asset URL ties the blob to the resolver record that selected it. */
	src: string;
	fetchedAt: number;
	blob: Blob;
}

/** Persist one resolved icon as an image Blob, separate from settings JSON. */
export async function putIconBlob(
	key: string,
	value: CachedIconBlob,
	shouldWrite: () => boolean = () => true,
): Promise<void> {
	const db = await openIDB();
	if (!shouldWrite()) return;
	const tx = db.transaction(STORE_ICONS, "readwrite");
	tx.objectStore(STORE_ICONS).put(value, key);
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	tx.onabort = () => reject(tx.error ?? new Error("Icon cache write aborted."));
	return promise;
}

/** Read a cached icon Blob for a domain. */
export async function getIconBlob(key: string): Promise<CachedIconBlob | null> {
	const db = await openIDB();
	const tx = db.transaction(STORE_ICONS, "readonly");
	const req = tx.objectStore(STORE_ICONS).get(key);
	const { promise, resolve, reject } =
		Promise.withResolvers<CachedIconBlob | null>();
	req.onsuccess = () => {
		const value = req.result as CachedIconBlob | undefined;
		resolve(
			value &&
				typeof value.src === "string" &&
				typeof value.fetchedAt === "number" &&
				value.blob instanceof Blob
				? value
				: null,
		);
	};
	req.onerror = () => reject(req.error);
	return promise;
}

/** Remove every locally cached resolved icon. */
export async function clearIconBlobs(): Promise<void> {
	const db = await openIDB();
	const tx = db.transaction(STORE_ICONS, "readwrite");
	tx.objectStore(STORE_ICONS).clear();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	return promise;
}

/** Keep a single current-condition snapshot; no weather history is retained. */
export async function putWeatherCache(value: CachedWeather): Promise<void> {
	const db = await openIDB();
	const tx = db.transaction(STORE_WEATHER, "readwrite");
	tx.objectStore(STORE_WEATHER).put(value, "current");
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	tx.onabort = () =>
		reject(tx.error ?? new Error("Weather cache write aborted."));
	return promise;
}

/** Read the last cached condition, validating the stored payload first. */
export async function getWeatherCache(): Promise<CachedWeather | null> {
	const db = await openIDB();
	const tx = db.transaction(STORE_WEATHER, "readonly");
	const request = tx.objectStore(STORE_WEATHER).get("current");
	const { promise, resolve, reject } =
		Promise.withResolvers<CachedWeather | null>();
	request.onsuccess = () => {
		const value = request.result as CachedWeather | undefined;
		const reading = value?.reading;
		resolve(
			typeof value?.locationKey === "string" &&
				Number.isFinite(value.fetchedAt) &&
				typeof reading?.temperatureC === "number" &&
				Number.isFinite(reading.temperatureC) &&
				Number.isInteger(reading.weatherCode) &&
				typeof reading.isDay === "boolean"
				? value
				: null,
		);
	};
	request.onerror = () => reject(request.error);
	return promise;
}

/** Remove the single cached weather reading, for reset and privacy cleanup. */
export async function clearWeatherCache(): Promise<void> {
	const db = await openIDB();
	const tx = db.transaction(STORE_WEATHER, "readwrite");
	tx.objectStore(STORE_WEATHER).clear();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	tx.onabort = () =>
		reject(tx.error ?? new Error("Weather cache clear aborted."));
	return promise;
}

export type BookmarkTreeSnapshot = Pick<
	Setup,
	"cards" | "folders" | "itemOrder"
>;

/** Store the bookmark tree separately from the small settings envelope. */
export async function putBookmarkTree(
	value: BookmarkTreeSnapshot,
): Promise<void> {
	const db = await openIDB();
	const tx = db.transaction(STORE_BOOKMARKS, "readwrite");
	tx.objectStore(STORE_BOOKMARKS).put(value, "current");
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	tx.onabort = () =>
		reject(tx.error ?? new Error("Bookmark tree write aborted."));
	return promise;
}

/** Read the single persisted bookmark tree; callers normalize its records. */
export async function getBookmarkTree(): Promise<BookmarkTreeSnapshot | null> {
	const db = await openIDB();
	const tx = db.transaction(STORE_BOOKMARKS, "readonly");
	const request = tx.objectStore(STORE_BOOKMARKS).get("current");
	const { promise, resolve, reject } =
		Promise.withResolvers<BookmarkTreeSnapshot | null>();
	request.onsuccess = () => {
		const value = request.result as BookmarkTreeSnapshot | undefined;
		resolve(
			value && Array.isArray(value.cards) && Array.isArray(value.folders)
				? value
				: null,
		);
	};
	request.onerror = () => reject(request.error);
	return promise;
}

/** Remove the tree during a confirmed full reset. */
export async function clearBookmarkTree(): Promise<void> {
	const db = await openIDB();
	const tx = db.transaction(STORE_BOOKMARKS, "readwrite");
	tx.objectStore(STORE_BOOKMARKS).clear();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	tx.oncomplete = () => resolve();
	tx.onerror = () => reject(tx.error);
	tx.onabort = () =>
		reject(tx.error ?? new Error("Bookmark tree clear aborted."));
	return promise;
}

/** Generate a prefixed, collision-resistant image id. */
function imageId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Save a thumbnail data URL and return its generated key. */
export async function saveThumbnail(dataUrl: string): Promise<string> {
	const id = imageId("thumb");
	await idbPut(STORE_THUMBS, id, dataUrl);
	return id;
}

/** Save a background image data URL and return its generated key. */
export async function saveBackground(dataUrl: string): Promise<string> {
	const id = imageId("bg");
	await idbPut(STORE_BG, id, dataUrl);
	return id;
}

/** Write an image under a specific key (used when restoring a backup). */
export async function putImage(
	store: ImageStoreName,
	key: string,
	dataUrl: string,
): Promise<void> {
	await idbPut(store, key, dataUrl);
}
