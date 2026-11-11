import { clearIconBlobs, getIconBlob, putIconBlob } from "./idb";

/** Stay under macOSicons' 30-day maximum cache window. */
export const ICON_BLOB_MAX_AGE_MS = 29 * 24 * 60 * 60 * 1000;
const ICON_BLOB_MAX_BYTES = 2 * 1024 * 1024;

const objectUrls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
const latestSrcByDomain = new Map<string, string>();
let cacheEpoch = 0;

function cacheKey(domainKey: string, src: string): string {
	return `${domainKey}\u0000${src}`;
}

export function getCachedIconObjectUrl(
	domainKey: string,
	src: string,
): string | null {
	return objectUrls.get(cacheKey(domainKey, src)) ?? null;
}

/**
 * Hydrate a selected icon from IndexedDB, or fetch and cache it as a Blob.
 * Once an object URL is in this page's memory map, later tiles can use it
 * synchronously on their first render.
 */
export function getIconObjectUrl(
	domainKey: string,
	src: string,
): Promise<string | null> {
	const key = cacheKey(domainKey, src);
	if (domainKey) latestSrcByDomain.set(domainKey, src);
	const inMemory = objectUrls.get(key);
	if (inMemory) return Promise.resolve(inMemory);
	const active = pending.get(key);
	if (active) return active;
	if (!domainKey || !/^https:\/\//i.test(src)) return Promise.resolve(null);

	const epoch = cacheEpoch;
	const task = (async () => {
		try {
			const cached = await getIconBlob(domainKey).catch(() => null);
			if (epoch !== cacheEpoch) return null;
			if (
				cached?.src === src &&
				Date.now() - cached.fetchedAt < ICON_BLOB_MAX_AGE_MS
			) {
				const url = URL.createObjectURL(cached.blob);
				objectUrls.set(key, url);
				return url;
			}

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 6_000);
			let blob: Blob;
			try {
				const response = await fetch(src, {
					credentials: "omit",
					signal: controller.signal,
				});
				if (!response.ok) return null;
				blob = await response.blob();
			} finally {
				clearTimeout(timer);
			}
			if (
				blob.size === 0 ||
				blob.size > ICON_BLOB_MAX_BYTES ||
				!blob.type.startsWith("image/")
			)
				return null;
			if (epoch !== cacheEpoch || latestSrcByDomain.get(domainKey) !== src)
				return null;

			await putIconBlob(
				domainKey,
				{ src, fetchedAt: Date.now(), blob },
				() =>
					epoch === cacheEpoch && latestSrcByDomain.get(domainKey) === src,
			).catch(() => undefined);
			if (epoch !== cacheEpoch) return null;
			const url = URL.createObjectURL(blob);
			objectUrls.set(key, url);
			return url;
		} catch {
			return null;
		} finally {
			pending.delete(key);
		}
	})();
	pending.set(key, task);
	return task;
}

/** Clear the local blob cache and invalidate any write already in flight. */
export async function clearIconBlobCache(): Promise<void> {
	cacheEpoch += 1;
	for (const url of objectUrls.values()) URL.revokeObjectURL(url);
	objectUrls.clear();
	pending.clear();
	latestSrcByDomain.clear();
	await clearIconBlobs();
}
