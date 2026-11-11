import { extApi } from "./extension-api";

export const WALLPAPER_STATE_KEY = "ktab-pexels-v1";
export const WALLPAPER_LOCK_NAME = "ktab-pexels-refresh";

/** Reset shares the refresh lock, so a prior download cannot repopulate a completed wipe. */
export async function resetWallpaperCache(
	reset: () => Promise<void>,
): Promise<void> {
	const clear = async () => {
		await extApi().storage.local.remove(WALLPAPER_STATE_KEY);
		await reset();
	};
	if (typeof navigator !== "undefined" && navigator.locks) {
		await navigator.locks.request(WALLPAPER_LOCK_NAME, clear);
	} else {
		await clear();
	}
}
