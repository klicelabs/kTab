import { create } from "zustand";
import {
	type PersistOptions,
	persist,
	type StorageValue,
} from "zustand/middleware";
import { extApi } from "../lib/extension-api";

/**
 * Persisted resolution cache for the icon system (see lib/icon-resolver.ts).
 *
 * One record per domain: the best icon asset found (site manifest,
 * apple-touch icon, rel-icon, SVGL brand art) or a negative result so a
 * dead-end site is never re-probed on every dashboard open.
 *
 * Storage: chrome.storage.local under `ktab-icon-cache` (small JSON
 * envelope, entries capped). The 10 MiB account envelope is shared, so the
 * cache stores METADATA only (asset URLs, treatment class) — never image
 * bytes. Bytes ride the browser HTTP cache between sessions; a cold entry
 * costs one throttled fetch.
 */

export const ICON_CACHE_STORAGE_KEY = "ktab-icon-cache";

/** Positive results live two weeks; stale entries re-probe lazily. */
export const ICON_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Negative results are remembered for three days to avoid probing churn. */
export const ICON_CACHE_NEGATIVE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Hard ceiling: at ~250 bytes/entry this stays well under 160 KB. */
export const ICON_CACHE_MAX_ENTRIES = 600;

export type IconTreatment = "glyph" | "full";

export type IconSource =
	| "macosicons"
	| "svgl"
	| "shadow-touch"
	| "manifest"
	| "rel-icon"
	| "simple-icons"
	| "google-favicon"
	| "provider"
	| "probe";

export interface IconCacheEntry {
	kind: "image" | "svg" | "none";
	source: IconSource;
	/** Image URL (kind "image") or SVGL route (kind "svg"); "" when none. */
	src: string;
	/** Raster composition class: full = paint edge-to-edge, glyph = centered. */
	treatment: IconTreatment;
	/**
	 * Natural pixel size of the source asset (0 = unknown, or vector).
	 * The renderer uses it to size a mark at its native resolution: a
	 * high-res logo fills the tile, a 32px favicon is never upscaled into
	 * a blur.
	 */
	width: number;
	height: number;
	/** Creator attribution retained for macOSicons assets. */
	credit?: string;
	creditUrl?: string;
	uploadedBy?: string;
	/** To be re-probed past this stamp. */
	fetchedAt: number;
}

type IconRecordMap = Record<string, IconCacheEntry>;

/** The only slice persisted (partialize): keep this shape, not the store. */
type IconPersistedState = { records: IconRecordMap };

interface IconCacheState {
	records: IconRecordMap;
	model: (domainKey: string, entry: IconCacheEntry | null) => void;
	remove: (domainKey: string) => void;
}

/* ── storage adapter (per-key, own debounce — never touches perch-setup) ── */

let _writeTimer: ReturnType<typeof setTimeout> | null = null;

function fallbackToLocalStorage(): boolean {
	return !extApi()?.storage?.local;
}

function readEnvelope(): unknown | null {
	if (fallbackToLocalStorage()) {
		try {
			const raw = localStorage.getItem(ICON_CACHE_STORAGE_KEY);
			return raw ? (JSON.parse(raw) as unknown) : null;
		} catch {
			return null;
		}
	}
	return null;
}

const iconCacheAdapter = {
	getItem: async (): Promise<unknown | null> => {
		if (!fallbackToLocalStorage()) {
			try {
				const data = await extApi().storage.local.get(ICON_CACHE_STORAGE_KEY);
				return data[ICON_CACHE_STORAGE_KEY] ?? null;
			} catch {
				return null;
			}
		}
		return readEnvelope();
	},
	setItem: async (value: unknown): Promise<void> => {
		if (_writeTimer) clearTimeout(_writeTimer);
		await new Promise<void>((resolve) => {
			_writeTimer = setTimeout(() => {
				_writeTimer = null;
				const payload = JSON.stringify(value);
				if (fallbackToLocalStorage()) {
					try {
						localStorage.setItem(ICON_CACHE_STORAGE_KEY, payload);
					} catch {
						// Best-effort: the in-memory store stays authoritative.
					}
					resolve();
					return;
				}
				extApi()
					.storage.local.set({ [ICON_CACHE_STORAGE_KEY]: value })
					.then(() => resolve())
					.catch(() => resolve());
			}, 400);
		});
	},
};

/** Repair one deserialized record; unknown shapes are dropped. */
function sanitizeEntry(raw: unknown): IconCacheEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const value = raw as Partial<IconCacheEntry> & Record<string, unknown>;
	if (value.kind !== "image" && value.kind !== "svg" && value.kind !== "none")
		return null;
	if (typeof value.src !== "string" || typeof value.fetchedAt !== "number")
		return null;
	if (value.treatment !== "glyph" && value.treatment !== "full") return null;
	if (!isKnownIconSource(value.source)) return null;
	return {
		kind: value.kind,
		source: value.source,
		src: value.kind === "none" ? "" : value.src,
		treatment: value.kind === "image" ? value.treatment : "glyph",
		width: typeof value.width === "number" ? value.width : 0,
		height: typeof value.height === "number" ? value.height : 0,
		credit: typeof value.credit === "string" ? value.credit : undefined,
		creditUrl: typeof value.creditUrl === "string" ? value.creditUrl : undefined,
		uploadedBy: typeof value.uploadedBy === "string" ? value.uploadedBy : undefined,
		fetchedAt: value.fetchedAt,
	};
}

const KNOWN_SOURCES: readonly IconSource[] = [
	"macosicons",
	"svgl",
	"shadow-touch",
	"manifest",
	"rel-icon",
	"simple-icons",
	"google-favicon",
	"provider",
	"probe",
];

function isKnownIconSource(value: unknown): value is IconSource {
	return (
		typeof value === "string" &&
		(KNOWN_SOURCES as readonly string[]).includes(value)
	);
}

function sanitizeRecords(raw: unknown): IconRecordMap {
	if (!raw || typeof raw !== "object") return {};
	const map: IconRecordMap = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!key) continue;
		const entry = sanitizeEntry(value);
		if (entry) map[key] = entry;
	}
	return map;
}

/** Evict expired + over-cap entries: oldest stamp leaves first. */
function pruneRecords(records: IconRecordMap): IconRecordMap {
	const now = Date.now();
	const next: IconRecordMap = {};
	for (const [key, entry] of Object.entries(records)) {
		const ttl =
			entry.kind === "none" ? ICON_CACHE_NEGATIVE_TTL_MS : ICON_CACHE_TTL_MS;
		if (now - entry.fetchedAt < ttl) next[key] = entry;
	}
	const keys = Object.keys(next);
	if (keys.length <= ICON_CACHE_MAX_ENTRIES) return next;
	const ordered = keys.sort((a, b) => next[a].fetchedAt - next[b].fetchedAt);
	for (let i = 0; i < keys.length - ICON_CACHE_MAX_ENTRIES; i += 1) {
		delete next[ordered[i]];
	}
	return next;
}

function isFresh(entry: IconCacheEntry | undefined): boolean {
	if (!entry) return false;
	const ttl =
		entry.kind === "none" ? ICON_CACHE_NEGATIVE_TTL_MS : ICON_CACHE_TTL_MS;
	return Date.now() - entry.fetchedAt < ttl;
}

const iconPersistOptions: PersistOptions<IconCacheState, IconPersistedState> = {
	name: ICON_CACHE_STORAGE_KEY,
	storage: {
		getItem: async (): Promise<StorageValue<IconPersistedState> | null> => {
			const envelope = (await iconCacheAdapter.getItem()) as
				| { state?: { records?: unknown } }
				| null
				| undefined;
			if (!envelope || typeof envelope !== "object") return null;
			if (!envelope.state || !("records" in envelope.state)) return null;
			return { state: { records: sanitizeRecords(envelope.state.records) } };
		},
		setItem: async (
			_name: string,
			value: StorageValue<IconPersistedState>,
		): Promise<void> => {
			await iconCacheAdapter.setItem(value);
		},
		removeItem: async (): Promise<void> => {
			await iconCacheAdapter.setItem({ state: { records: {} } });
		},
	},
	partialize: (s) => ({ records: s.records }),
	merge: (persisted, current) => {
		const saved = sanitizeRecords(
			(persisted as IconPersistedState | null)?.records,
		);
		return { ...current, records: saved };
	},
};

export const useIconCacheStore = create<IconCacheState>()(
	persist(
		(set) => ({
			records: {},
			model: (domainKey, entry) =>
				set((state) => {
					if (!domainKey) return state;
					const records = { ...state.records };
					if (entry) records[domainKey] = entry;
					else delete records[domainKey];
					return { records: pruneRecords(records) };
				}),
			remove: (domainKey) =>
				set((state) => {
					if (!(domainKey in state.records)) return state;
					const records = { ...state.records };
					delete records[domainKey];
					return { records };
				}),
		}),
		iconPersistOptions,
	),
);

/* ── resolution scheduler: idle-time, throttled, single-flight per domain ── */

const PROBE_CONCURRENCY = 2;
const PROBE_IDLE_TIMEOUT_MS = 2500;

const pendingQueue = new Map<string, string>();
const sourceByResolvedKey = new Map<string, string>();
const activeProbes = new Set<string>();
let idleScheduled = false;
let lastProbeAt = 0;

function scheduleIdle(drain: () => void): void {
	if (idleScheduled) return;
	idleScheduled = true;
	const run = () => {
		idleScheduled = false;
		drain();
	};
	if (typeof window === "undefined") {
		setTimeout(run, 50);
		return;
	}
	if ("requestIdleCallback" in window) {
		window.requestIdleCallback(run, { timeout: PROBE_IDLE_TIMEOUT_MS });
	} else {
		setTimeout(run, 350);
	}
}

function drainQueue(store: (key: string, url: string) => Promise<void>): void {
	for (const [key, url] of pendingQueue) {
		if (activeProbes.size >= PROBE_CONCURRENCY) return;
		pendingQueue.delete(key);
		activeProbes.add(key);
		const spacing = Math.max(0, 220 - (Date.now() - lastProbeAt));
		setTimeout(() => {
			lastProbeAt = Date.now();
			sourceByResolvedKey.delete(key);
			store(key, url).finally(() => {
				activeProbes.delete(key);
				scheduleIdle(() => drainQueue(store));
			});
		}, spacing);
	}
}

/**
 * Ask the background resolver to upgrade every domain in the queue. Callers
 * pass the resolve function bound to the store, keeping this module free of
 * importing the (heavier) resolver until first use.
 */
export function enqueueIconResolution(
	domainKey: string,
	url: string,
	resolve: (key: string, url: string) => Promise<void>,
): void {
	if (pendingQueue.has(domainKey) || activeProbes.has(domainKey)) return;
	pendingQueue.set(domainKey, url);
	scheduleIdle(() => drainQueue(resolve));
}

/** True when a fresh record already answers for this domain. */
export function hasFreshRecord(
	records: IconRecordMap,
	domainKey: string,
): boolean {
	return isFresh(records[domainKey]);
}
