import { extApi } from "../lib/extension-api";

export const MACOSICONS_SETTINGS_KEY = "ktab-macosicons-settings";
const SEARCH_ENDPOINT = "https://api.macosicons.com/api/v1/search";
const REQUEST_TIMEOUT_MS = 6_000;

export interface MacOSiconsSettings {
	enabled: boolean;
	apiKey: string;
}

export const DEFAULT_MACOSICONS_SETTINGS: MacOSiconsSettings = {
	enabled: false,
	apiKey: "",
};

export interface MacOSiconsHit {
	appName: string;
	lowResPngUrl: string;
	credit: string;
	creditUrl: string;
	uploadedBy: string;
}

let settingsCache: Promise<MacOSiconsSettings> | null = null;
let changeListenerInstalled = false;

function normalizeSettings(raw: unknown): MacOSiconsSettings {
	if (!raw || typeof raw !== "object")
		return { ...DEFAULT_MACOSICONS_SETTINGS };
	const value = raw as Partial<MacOSiconsSettings>;
	return {
		enabled: value.enabled === true,
		apiKey: typeof value.apiKey === "string" ? value.apiKey.trim() : "",
	};
}

function installSettingsChangeListener(): void {
	if (changeListenerInstalled) return;
	const api = extApi();
	if (!api.storage?.onChanged) return;
	changeListenerInstalled = true;
	api.storage.onChanged.addListener((changes, areaName) => {
		if (areaName === "local" && MACOSICONS_SETTINGS_KEY in changes)
			settingsCache = null;
	});
}

export function getMacOSiconsSettings(): Promise<MacOSiconsSettings> {
	installSettingsChangeListener();
	if (settingsCache) return settingsCache;
	settingsCache = (async () => {
		const storage = extApi().storage?.local;
		if (storage) {
			try {
				const values = await storage.get(MACOSICONS_SETTINGS_KEY);
				return normalizeSettings(values[MACOSICONS_SETTINGS_KEY]);
			} catch {
				return { ...DEFAULT_MACOSICONS_SETTINGS };
			}
		}
		try {
			const raw = localStorage.getItem(MACOSICONS_SETTINGS_KEY);
			return normalizeSettings(raw ? JSON.parse(raw) : null);
		} catch {
			return { ...DEFAULT_MACOSICONS_SETTINGS };
		}
	})();
	return settingsCache;
}

export async function saveMacOSiconsSettings(
	settings: MacOSiconsSettings,
): Promise<void> {
	const normalized = normalizeSettings(settings);
	const storage = extApi().storage?.local;
	if (storage) {
		await storage.set({ [MACOSICONS_SETTINGS_KEY]: normalized });
	} else {
		localStorage.setItem(MACOSICONS_SETTINGS_KEY, JSON.stringify(normalized));
	}
	settingsCache = Promise.resolve(normalized);
}

export async function clearMacOSiconsSettings(): Promise<void> {
	const storage = extApi().storage?.local;
	if (storage) {
		await storage.remove(MACOSICONS_SETTINGS_KEY);
	} else {
		localStorage.removeItem(MACOSICONS_SETTINGS_KEY);
	}
	settingsCache = Promise.resolve({ ...DEFAULT_MACOSICONS_SETTINGS });
}

function httpsUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
}

/** Search the current macOSicons API. A key is always supplied by the user. */
export async function searchMacOSicons(
	query: string,
	apiKey: string,
	fetcher: typeof fetch = fetch,
): Promise<MacOSiconsHit | null> {
	const term = query.trim();
	const key = apiKey.trim();
	if (!term || !key) return null;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetcher(SEARCH_ENDPOINT, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": key,
			},
			body: JSON.stringify({ query: term }),
			signal: controller.signal,
		});
		if (!response.ok) return null;

		const payload = (await response.json()) as {
			hits?: Array<Record<string, unknown>>;
		};
		for (const hit of payload.hits ?? []) {
			const lowResPngUrl = httpsUrl(hit.lowResPngUrl);
			if (!lowResPngUrl) continue;
			return {
				appName: typeof hit.appName === "string" ? hit.appName : term,
				lowResPngUrl,
				credit: typeof hit.credit === "string" ? hit.credit : "",
				creditUrl: httpsUrl(hit.creditUrl) ?? "",
				uploadedBy: typeof hit.uploadedBy === "string" ? hit.uploadedBy : "",
			};
		}
		return null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
