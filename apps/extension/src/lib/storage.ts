import type { PersistStorage, StorageValue } from "zustand/middleware";
import type {
	AccentColor,
	AppearanceMode,
	BackgroundSettings,
	Card,
	ColorScheme,
	CustomWallpaper,
	Folder,
	QuickLink,
	Setup,
	TitleSource,
	WallpaperFrequency,
} from "../types";
import {
	DEFAULT_QUICK_LINKS,
	DEFAULT_SEARCH,
	DEFAULT_SETUP,
	MAX_COLUMNS,
	MIN_COLUMNS,
	SEARCH_WIDTH_MAX,
	SEARCH_WIDTH_MIN,
	WALLPAPERS,
	WIDGET_SIZE_MAX,
	WIDGET_SIZE_MIN,
} from "./constants";
import { extApi } from "./extension-api";
import { writeFirstPaintSnapshot } from "./first-paint-snapshot";
import { getDescendantIds } from "./folder-tree";
import { idbDelete, STORE_BG } from "./idb";
import { buildItemOrder, repairItemOrder } from "./item-order";
import { PEXELS_MAX_QUERY_LENGTH } from "./pexels";
import { isAbsoluteHttpUrl } from "./url";
import { writeWallpaperSnapshot } from "./wallpaper-snapshot";

/**
 * Repair folder hierarchy: coerce every folder to include a valid parentId,
 * drop parent references that point to missing folders (orphans become roots),
 * and break any cycles so tree traversal always terminates.
 */
function normalizeFolders(rawFolders: unknown[]): Folder[] {
	const seen = new Set<string>();
	const folders: Folder[] = [];
	for (const [index, value] of rawFolders.entries()) {
		if (!isRecord(value)) continue;
		const id = normalizeId(value.id);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		folders.push({
			id,
			name: typeof value.name === "string" ? value.name : "Untitled folder",
			order: isFiniteNumber(value.order) ? value.order : index,
			parentId: normalizeId(value.parentId),
		});
	}

	const ids = new Set(folders.map((f) => f.id));

	// Orphaned parents → root.
	for (const folder of folders) {
		if (folder.parentId && !ids.has(folder.parentId)) folder.parentId = null;
	}

	// Break cycles: if a folder is reachable from its own subtree, detach it.
	for (const folder of folders) {
		if (
			folder.parentId &&
			getDescendantIds(folders, folder.id).includes(folder.parentId)
		) {
			folder.parentId = null;
		}
	}

	return folders;
}

function normalizeTitleSource(value: unknown): TitleSource | undefined {
	return value === "saved" || value === "site" ? value : undefined;
}
const VALID_WALLPAPER_IDS = new Set(
	WALLPAPERS.map((wallpaper) => wallpaper.id),
);
const VALID_ACCENT_COLORS: readonly AccentColor[] = [
	"blue",
	"yellow",
	"green",
	"purple",
	"pink",
];
const VALID_FREQUENCIES: readonly WallpaperFrequency[] = [
	"per-tab",
	"hourly",
	"daily",
	"daylight",
	"locked",
];
const VALID_PERIODS = ["morning", "afternoon", "night"] as const;
type DaylightPeriod = (typeof VALID_PERIODS)[number];

function isDaylightPeriod(value: unknown): value is DaylightPeriod {
	return VALID_PERIODS.some((period) => period === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePexelsCredit(
	value: unknown,
): BackgroundSettings["pexelsPhoto"] {
	if (
		!isRecord(value) ||
		!isFiniteNumber(value.id) ||
		typeof value.photographer !== "string" ||
		typeof value.url !== "string" ||
		typeof value.photographerUrl !== "string" ||
		!isFiniteNumber(value.width) ||
		!isFiniteNumber(value.height)
	)
		return null;
	try {
		for (const link of [value.url, value.photographerUrl]) {
			const url = new URL(link);
			if (
				url.protocol !== "https:" ||
				!(url.hostname === "pexels.com" || url.hostname.endsWith(".pexels.com"))
			)
				return null;
		}
	} catch {
		return null;
	}
	return {
		id: value.id,
		url: value.url,
		photographer: value.photographer.slice(0, 150),
		photographerUrl: value.photographerUrl,
		width: value.width,
		height: value.height,
	};
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isWallpaperFrequency(value: unknown): value is WallpaperFrequency {
	return (
		typeof value === "string" &&
		(VALID_FREQUENCIES as readonly string[]).includes(value)
	);
}

function normalizeId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const id = value.trim();
	return id.length > 0 ? id : null;
}

function normalizeAppearanceMode(
	value: unknown,
	fallback: AppearanceMode,
): AppearanceMode {
	if (value === "liquid") return "liquid";
	if (value === "classic" || value === "flat") return "classic";
	return fallback;
}

function normalizeColorScheme(
	value: unknown,
	fallback: ColorScheme,
): ColorScheme {
	if (value === "auto" || value === "light" || value === "dark") {
		return value;
	}
	return fallback;
}

function normalizeAccentColor(
	value: unknown,
	fallback: AccentColor,
): AccentColor {
	return typeof value === "string" &&
		(VALID_ACCENT_COLORS as readonly string[]).includes(value)
		? (value as AccentColor)
		: fallback;
}

/** Clamp the Glass intensity slider to its 0…100 contract. */
function normalizeGlassIntensity(value: unknown, fallback: number): number {
	if (!isFiniteNumber(value)) return fallback;
	return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeBoundedNumber(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	if (!isFiniteNumber(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function cloneQuickLinks(items: readonly QuickLink[]): QuickLink[] {
	return items.map((item) => ({ ...item }));
}

/** Keep Quick Links ordered and future-editable while rejecting corrupt rows. */
function normalizeQuickLinks(
	rawValue: unknown,
	defaults: readonly QuickLink[],
): QuickLink[] {
	if (!Array.isArray(rawValue)) return cloneQuickLinks(defaults);
	const seen = new Set<string>();
	const items: QuickLink[] = [];
	for (const value of rawValue) {
		if (!isRecord(value)) continue;
		const id = normalizeId(value.id);
		const label = normalizeId(value.label);
		const url = typeof value.url === "string" ? value.url.trim() : "";
		if (!id || !label || !isAbsoluteHttpUrl(url) || seen.has(id)) continue;
		seen.add(id);
		items.push({ id, label, url });
	}
	// An explicit empty list is a valid user choice (for example, after
	// removing the final Quick Link). Only a non-empty but wholly invalid
	// payload falls back to the curated defaults for recovery.
	return items.length > 0 || rawValue.length === 0
		? items
		: cloneQuickLinks(defaults);
}

function normalizeSettings(
	rawValue: unknown,
	defaults: Setup["settings"],
): Setup["settings"] {
	const raw = isRecord(rawValue) ? rawValue : {};
	const thumbnail = isRecord(raw.thumbnailCapture) ? raw.thumbnailCapture : {};
	const clock = isRecord(raw.clock) ? raw.clock : {};
	const greeting = isRecord(raw.greeting) ? raw.greeting : {};
	const search = isRecord(raw.search) ? raw.search : {};
	const quickLinks = isRecord(raw.quickLinks) ? raw.quickLinks : {};
	const weather = isRecord(raw.weather) ? raw.weather : {};
	const weatherLatitude =
		typeof weather.latitude === "number" &&
		Number.isFinite(weather.latitude) &&
		weather.latitude >= -90 &&
		weather.latitude <= 90
			? weather.latitude
			: null;
	const weatherLongitude =
		typeof weather.longitude === "number" &&
		Number.isFinite(weather.longitude) &&
		weather.longitude >= -180 &&
		weather.longitude <= 180
			? weather.longitude
			: null;
	return {
		tileSize:
			raw.tileSize === "small" ||
			raw.tileSize === "medium" ||
			raw.tileSize === "large"
				? raw.tileSize
				: defaults.tileSize,
		maxColumns: normalizeBoundedNumber(
			raw.maxColumns,
			defaults.maxColumns,
			MIN_COLUMNS,
			MAX_COLUMNS,
		),
		showTitle: normalizeBoolean(raw.showTitle, defaults.showTitle),
		showDeleteButton: normalizeBoolean(
			raw.showDeleteButton,
			defaults.showDeleteButton,
		),
		openInNewTab: normalizeBoolean(raw.openInNewTab, defaults.openInNewTab),
		dialLayout:
			raw.dialLayout === "icon" || raw.dialLayout === "card"
				? raw.dialLayout
				: defaults.dialLayout,
		cardAspect:
			raw.cardAspect === "square" ||
			raw.cardAspect === "horizontal" ||
			raw.cardAspect === "vertical"
				? raw.cardAspect
				: defaults.cardAspect,
		iconShowLabel: normalizeBoolean(raw.iconShowLabel, defaults.iconShowLabel),
		iconTileSurface: normalizeBoolean(
			raw.iconTileSurface ?? raw.iconGlassTile,
			defaults.iconTileSurface,
		),
		defaultTitleSource:
			normalizeTitleSource(raw.defaultTitleSource) ??
			defaults.defaultTitleSource,
		thumbnailCapture: {
			enabled: normalizeBoolean(
				thumbnail.enabled,
				defaults.thumbnailCapture.enabled,
			),
			delayMs: normalizeBoundedNumber(
				thumbnail.delayMs,
				defaults.thumbnailCapture.delayMs,
				100,
				10_000,
			),
		},
		background: normalizeBackground(raw.background, defaults.background),
		clock: {
			enabled: normalizeBoolean(clock.enabled, defaults.clock.enabled),
			dateEnabled:
				typeof clock.dateEnabled === "boolean"
					? clock.dateEnabled
					: normalizeBoolean(clock.enabled, defaults.clock.dateEnabled),
			format24: normalizeBoolean(clock.format24, defaults.clock.format24),
			showSeconds: normalizeBoolean(
				clock.showSeconds,
				defaults.clock.showSeconds,
			),
			size: normalizeBoundedNumber(
				clock.size,
				defaults.clock.size,
				WIDGET_SIZE_MIN,
				WIDGET_SIZE_MAX,
			),
			dateSize: normalizeBoundedNumber(
				clock.dateSize,
				defaults.clock.dateSize,
				WIDGET_SIZE_MIN,
				WIDGET_SIZE_MAX,
			),
			timezone: normalizeString(clock.timezone, defaults.clock.timezone),
		},
		greeting: {
			enabled: normalizeBoolean(greeting.enabled, defaults.greeting.enabled),
			name: normalizeString(greeting.name, defaults.greeting.name),
			size: normalizeBoundedNumber(
				greeting.size,
				defaults.greeting.size,
				WIDGET_SIZE_MIN,
				WIDGET_SIZE_MAX,
			),
		},
		search: {
			enabled: normalizeBoolean(search.enabled, DEFAULT_SEARCH.enabled),
			quickAccessEnabled: normalizeBoolean(
				search.quickAccessEnabled,
				DEFAULT_SEARCH.quickAccessEnabled,
			),
			engine: normalizeString(search.engine, DEFAULT_SEARCH.engine),
			placeholder: normalizeString(
				search.placeholder,
				DEFAULT_SEARCH.placeholder,
			),
			iconMode:
				search.iconMode === "search" || search.iconMode === "engine"
					? search.iconMode
					: DEFAULT_SEARCH.iconMode,
			width: normalizeBoundedNumber(
				search.width,
				DEFAULT_SEARCH.width,
				SEARCH_WIDTH_MIN,
				SEARCH_WIDTH_MAX,
			),
		},
		quickLinks: {
			enabled: normalizeBoolean(
				quickLinks.enabled,
				defaults.quickLinks.enabled,
			),
			items: normalizeQuickLinks(
				quickLinks.items,
				defaults.quickLinks.items.length > 0
					? defaults.quickLinks.items
					: DEFAULT_QUICK_LINKS,
			),
		},
		weather: {
			enabled: normalizeBoolean(weather.enabled, defaults.weather.enabled),
			display:
				weather.display === "toolbar" || weather.display === "widget"
					? weather.display
					: defaults.weather.display,
			place:
				weatherLatitude !== null && weatherLongitude !== null
					? normalizeString(weather.place, defaults.weather.place)
							.trim()
							.slice(0, 160)
					: "",
			latitude: weatherLatitude,
			longitude: weatherLongitude,
			dynamicAtmosphere: normalizeBoolean(
				weather.dynamicAtmosphere,
				defaults.weather.dynamicAtmosphere,
			),
		},
		appearanceMode: normalizeAppearanceMode(
			raw.appearanceMode,
			defaults.appearanceMode,
		),
		colorScheme: normalizeColorScheme(raw.colorScheme, defaults.colorScheme),
		accentColor: normalizeAccentColor(raw.accentColor, defaults.accentColor),
		glassIntensity: normalizeGlassIntensity(
			raw.glassIntensity,
			defaults.glassIntensity,
		),
		cornerScale:
			raw.cornerScale === "discreet" ||
			raw.cornerScale === "soft" ||
			raw.cornerScale === "rounded"
				? raw.cornerScale
				: defaults.cornerScale,
	};
}

function normalizeCustomWallpapers(raw: unknown): CustomWallpaper[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const normalized: CustomWallpaper[] = [];
	for (const entry of raw) {
		const wallpaper = normalizeCustomWallpaperEntry(entry);
		if (!wallpaper || seen.has(wallpaper.id)) continue;
		seen.add(wallpaper.id);
		normalized.push(wallpaper);
	}
	return normalized;
}

function normalizeCustomWallpaperEntry(raw: unknown): CustomWallpaper | null {
	if (!isRecord(raw)) return null;
	const id = normalizeId(raw.id);
	const name = normalizeId(raw.name);
	return id && name ? { id, name } : null;
}

/**
 * Read the new single-slot shape while keeping older array-based installs
 * usable. The active legacy image wins when possible; otherwise the newest
 * valid array entry becomes the slot.
 */
function normalizeCustomWallpaper(
	raw: Record<string, unknown>,
	activeImageId: string | null,
): CustomWallpaper | null {
	const hasSingleSlot = Object.hasOwn(raw, "customWallpaper");
	const single = normalizeCustomWallpaperEntry(raw.customWallpaper);
	if (single) return single;
	if (hasSingleSlot && raw.customWallpaper === null) return null;

	const legacy = normalizeCustomWallpapers(raw.customWallpapers);
	return (
		legacy.find((wallpaper) => wallpaper.id === activeImageId) ??
		legacy.at(-1) ??
		null
	);
}

export interface CustomWallpaperMigration {
	legacyIds: string[];
	retainedId: string | null;
}

function getRawBackground(rawState: unknown): Record<string, unknown> | null {
	if (!isRecord(rawState) || !isRecord(rawState.settings)) return null;
	const background = rawState.settings.background;
	return isRecord(background) ? background : null;
}

/** Describe legacy custom image keys so hydration/import can remove leftovers. */
export function getCustomWallpaperMigration(
	rawState: unknown,
): CustomWallpaperMigration {
	const raw = getRawBackground(rawState);
	if (!raw) return { legacyIds: [], retainedId: null };

	const legacy = normalizeCustomWallpapers(raw.customWallpapers);
	const single = normalizeCustomWallpaperEntry(raw.customWallpaper);
	const activeImageId = normalizeId(raw.imageId);
	const retained = Object.hasOwn(raw, "customWallpaper")
		? single
		: (legacy.find((wallpaper) => wallpaper.id === activeImageId) ??
			legacy.at(-1) ??
			null);

	return {
		legacyIds: legacy.map((wallpaper) => wallpaper.id),
		retainedId: retained?.id ?? null,
	};
}

/**
 * Remove image blobs that belonged to the old custom-wallpaper array. The
 * retained slot is never touched, and cleanup is best-effort so a storage
 * hiccup cannot prevent the user's settings from hydrating or importing.
 */
export async function cleanupLegacyCustomWallpaperImages(
	rawState: unknown,
): Promise<void> {
	const { legacyIds, retainedId } = getCustomWallpaperMigration(rawState);
	await Promise.all(
		legacyIds
			.filter((id) => id !== retainedId)
			// Explicitly return each cleanup promise; failures remain non-blocking.
			.map((id) => idbDelete(STORE_BG, id).catch(() => undefined)),
	);
}

function normalizeBackground(
	rawValue: unknown,
	defaults: BackgroundSettings,
): BackgroundSettings {
	const raw = isRecord(rawValue) ? rawValue : {};
	const rawType = raw.type;
	const type =
		rawType === "solid" ||
		rawType === "gradient" ||
		rawType === "image" ||
		rawType === "pexels" ||
		rawType === "wallpaper" ||
		rawType === "none"
			? rawType
			: null;
	const migratedUnsplash = rawType === "unsplash";
	const imageId = normalizeId(raw.imageId);
	const wallpaperId = normalizeId(raw.wallpaperId);
	const normalizedType =
		migratedUnsplash || type === null
			? migratedUnsplash
				? "pexels"
				: defaults.type
			: type;
	const incompleteImage = normalizedType === "image" && !imageId;
	const effectiveType = incompleteImage ? defaults.type : normalizedType;
	const customWallpaper = normalizeCustomWallpaper(raw, imageId);
	const effectiveCustomWallpaper =
		customWallpaper ??
		(effectiveType === "image" && imageId
			? { id: imageId, name: "Uploaded wallpaper" }
			: null);
	const savedPexelsQuery =
		typeof raw.pexelsQuery === "string" ? raw.pexelsQuery : "";
	const migratedPexelsQuery =
		savedPexelsQuery === "cinematic city skyline architecture 4k"
			? "cinematic city 4k"
			: savedPexelsQuery === "minimalist landscape clean composition 4k"
				? "minimalist landscape 4k"
				: savedPexelsQuery;
	const normalizedWallpaperId =
		rawType === "wallpaper" &&
		effectiveType === "wallpaper" &&
		!incompleteImage &&
		wallpaperId &&
		VALID_WALLPAPER_IDS.has(wallpaperId)
			? wallpaperId
			: effectiveType === "wallpaper"
				? defaults.wallpaperId
				: null;
	const frequency = isWallpaperFrequency(raw.pexelsFrequency)
		? raw.pexelsFrequency
		: migratedUnsplash
			? "daily"
			: defaults.pexelsFrequency;
	const previousFrequency = isWallpaperFrequency(raw.pexelsPreviousFrequency)
		? raw.pexelsPreviousFrequency
		: null;
	const lastPeriod = isDaylightPeriod(raw.pexelsLastPeriod)
		? raw.pexelsLastPeriod
		: null;
	const finiteOrDefault = (
		value: unknown,
		fallback: number,
		min: number,
		max: number,
	): number => {
		if (!isFiniteNumber(value)) return fallback;
		return Math.min(max, Math.max(min, value));
	};

	return {
		type: effectiveType,
		color: typeof raw.color === "string" ? raw.color : defaults.color,
		gradientId: normalizeId(raw.gradientId),
		imageId:
			effectiveType === "image"
				? (effectiveCustomWallpaper?.id ?? imageId)
				: null,
		wallpaperId: normalizedWallpaperId,
		customWallpaper: effectiveCustomWallpaper,
		blur: finiteOrDefault(raw.blur, defaults.blur, 0, 20),
		brightness: finiteOrDefault(raw.brightness, defaults.brightness, 40, 140),
		opacity: finiteOrDefault(raw.opacity, defaults.opacity, 20, 100),
		pexelsQuery:
			migratedPexelsQuery.trim() && migratedPexelsQuery !== "curated wallpaper"
				? migratedPexelsQuery.slice(0, PEXELS_MAX_QUERY_LENGTH)
				: defaults.pexelsQuery,
		pexelsFrequency: frequency,
		pexelsPreviousFrequency: previousFrequency,
		pexelsLastFetched:
			isFiniteNumber(raw.pexelsLastFetched) && raw.pexelsLastFetched >= 0
				? raw.pexelsLastFetched
				: null,
		pexelsLastPeriod: lastPeriod,
		pexelsImageId: normalizeId(raw.pexelsImageId),
		pexelsPosition:
			raw.pexelsPosition === "top" ||
			raw.pexelsPosition === "bottom" ||
			raw.pexelsPosition === "left" ||
			raw.pexelsPosition === "right"
				? raw.pexelsPosition
				: "center",
		pexelsPhoto: normalizePexelsCredit(raw.pexelsPhoto),
	};
}

/**
 * Normalize raw state from chrome.storage.local, filling in missing keys
 * with defaults. Handles migration from the legacy format.
 */
export function normalizeState(
	rawState: Partial<Setup> | null | undefined,
): Setup {
	const source: Partial<Setup> = isRecord(rawState)
		? (rawState as Partial<Setup>)
		: {};

	const defaults = structuredClone(DEFAULT_SETUP);
	const normalizedFolders =
		Array.isArray(source.folders) && source.folders.length > 0
			? normalizeFolders(source.folders)
			: [];

	const state: Setup = {
		...defaults,
		...source,
		folders:
			normalizedFolders.length > 0
				? normalizedFolders
				: structuredClone(defaults.folders),
		cards: [],
		settings: normalizeSettings(source.settings, defaults.settings),
	};

	// Ensure activeFolderId is valid
	if (!state.folders.find((f) => f.id === state.activeFolderId)) {
		state.activeFolderId = state.folders[0]?.id || "default";
	}

	// Cards are untrusted persisted data too. Normalize their identity before
	// repairing parents/order: duplicate ids would make React keys and item
	// order references ambiguous (P6), while malformed records used to survive
	// until a later property access.
	const seenCardIds = new Set<string>();
	const rawCards = Array.isArray(source.cards) ? source.cards : [];
	state.cards = rawCards.flatMap((raw, index): Card[] => {
		if (!isRecord(raw)) return [];
		const id = normalizeId(raw.id);
		const folderId = normalizeId(raw.folderId);
		const url = typeof raw.url === "string" ? raw.url : "";
		if (!id || !folderId || seenCardIds.has(id) || !isAbsoluteHttpUrl(url)) {
			return [];
		}
		seenCardIds.add(id);
		const origin = raw.origin === "browser" ? "browser" : "local";
		return [
			{
				id,
				folderId,
				title: typeof raw.title === "string" ? raw.title : url,
				url,
				favicon: typeof raw.favicon === "string" ? raw.favicon : null,
				thumbId: normalizeId(raw.thumbId),
				order: isFiniteNumber(raw.order) ? raw.order : index,
				titleSource: normalizeTitleSource(raw.titleSource),
				origin,
				capturedAt:
					isFiniteNumber(raw.capturedAt) && raw.capturedAt >= 0
						? raw.capturedAt
						: null,
			},
		];
	});

	// H5/M11: cards pointing at missing folders are invisible in the grid
	// (nothing renders a container that does not exist) yet survive into
	// exports. Remap them to the default folder so the user sees them again.
	const folderIds = new Set(state.folders.map((f) => f.id));
	state.cards = state.cards.map((card) => {
		if (folderIds.has(card.folderId)) return card;
		return { ...card, folderId: state.activeFolderId };
	});

	// Migrate to the unified item-order model. Legacy payloads have no
	// `itemOrder`; backfill folders-first so existing installs see no change.
	// Runs after card filtering so no key can dangle at a dropped card.
	state.itemOrder =
		source.itemOrder !== undefined
			? repairItemOrder(source.itemOrder, state.folders, state.cards)
			: buildItemOrder(state.folders, state.cards);

	return state;
}

// --- Coalesced persist ---

// Persistent keys from the Perch era — kept verbatim so existing installs
// keep their data after the rename to kTab.
export const RESET_GENERATION_KEY = "perch-reset-generation";
export const PERSIST_GENERATION_KEY = "__perchResetGeneration";

function normalizeResetGeneration(value: unknown): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: 0;
}

let _resetGeneration = 0;
let _resetGenerationLoaded = true;
let _resetGenerationReady = Promise.resolve();
if (extApi() && extApi().storage?.local) {
	_resetGenerationLoaded = false;
	_resetGenerationReady = chrome.storage.local
		.get(RESET_GENERATION_KEY)
		.then((data) => {
			_resetGeneration = normalizeResetGeneration(data[RESET_GENERATION_KEY]);
		})
		.catch(() => undefined)
		.finally(() => {
			_resetGenerationLoaded = true;
		});
	extApi().storage.onChanged?.addListener((changes, area) => {
		if (area !== "local") return;
		const next = normalizeResetGeneration(
			changes[RESET_GENERATION_KEY]?.newValue,
		);
		if (next > _resetGeneration) _resetGeneration = next;
	});
}

interface PendingSetItem {
	name: string;
	value: StorageValue<Setup>;
	generation: number;
}

interface PendingResolver {
	resolve: () => void;
	reject: (reason?: unknown) => void;
}

let _pendingSetItem: PendingSetItem | null = null;
let _pendingResolvers: PendingResolver[] = [];
let _setItemTimer: ReturnType<typeof setTimeout> | null = null;
let _inFlightWrite: Promise<void> | null = null;
let _lastWrittenJSON: string | null = null;
// storage.onChanged can fire before storage.local.set resolves. Register each
// outgoing value before calling set, and consume its echo in the page listener.
// A count handles repeated writes of identical snapshots.
const _ownWriteEchoes = new Map<string, number>();

export function consumeOwnWriteEcho(raw: string): boolean {
	const count = _ownWriteEchoes.get(raw);
	if (!count) return false;
	if (count === 1) _ownWriteEchoes.delete(raw);
	else _ownWriteEchoes.set(raw, count - 1);
	return true;
}

function discardOwnWriteEcho(raw: string): void {
	consumeOwnWriteEcho(raw);
}
export type PersistHealth = "ok" | "unsaved" | "failed";

type PersistenceErrorListener = (error: unknown) => void;
const _persistenceErrorListeners = new Set<PersistenceErrorListener>();

/**
 * Subscribe to persistence failures without coupling the storage layer to a
 * particular UI. The app uses this for one restrained temporary toast.
 */
function reportPersistenceError(error: unknown): void {
	console.warn("[ktab] persistence failed", error);
	setPersistHealth("failed");
	for (const listener of _persistenceErrorListeners) {
		try {
			listener(error);
		} catch (listenerError) {
			console.error("[ktab] persistence error listener failed", listenerError);
		}
	}
}

// P5-A (decision A): quota/persist health surface. A queued-but-unwritten
// state is "unsaved" (the user's change exists only in memory); a rejected
// write is "failed" (explicitly surfaced, never silent); a landed write is
// "ok". Quota is preflighted BEFORE the write so a >95%-full store fails
// with an explicit quota error instead of a truncated payload.
type PersistHealthListener = (health: PersistHealth) => void;
const _persistHealthListeners = new Set<PersistHealthListener>();

export function subscribeToPersistHealth(
	listener: PersistHealthListener,
): () => void {
	_persistHealthListeners.add(listener);
	return () => _persistHealthListeners.delete(listener);
}

export function getPersistHealth(): PersistHealth {
	return _persistHealth;
}

let _persistHealth: PersistHealth = "ok";

function setPersistHealth(health: PersistHealth): void {
	if (_persistHealth === health) return;
	_persistHealth = health;
	for (const listener of _persistHealthListeners) {
		try {
			listener(health);
		} catch (listenerError) {
			console.error("[ktab] persist health listener failed", listenerError);
		}
	}
}

/** Bytes-in-use preflight; null when the browser does not report usage. */
async function quotaUsageBytes(keys: string | null): Promise<number | null> {
	try {
		const info = await extApi().storage.local.getBytesInUse?.(keys);
		return typeof info === "number" ? info : null;
	} catch {
		return null;
	}
}

/** chrome.storage.local quota; navigator estimate as a coarse fallback. */
const LOCAL_QUOTA_BYTES = 10 * 1024 * 1024; // 10 MiB per MV3 spec

async function isQuotaExhausted(
	name: string,
	payloadBytes: number,
): Promise<boolean> {
	const [used, replaced] = await Promise.all([
		quotaUsageBytes(null),
		quotaUsageBytes(name),
	]);
	if (used === null) return false; // cannot know -> do not block writes
	// storage.local.set replaces this key's value. Subtract its current size
	// before adding the new payload; otherwise large existing setups are
	// counted twice and Firefox can reject ordinary settings changes early.
	return used - (replaced ?? 0) + payloadBytes > LOCAL_QUOTA_BYTES * 0.95;
}

function _doWrite(
	name: string,
	value: StorageValue<Setup>,
	generation: number,
): Promise<void> {
	const json = JSON.stringify({
		...value,
		[PERSIST_GENERATION_KEY]: generation,
	});
	const previous = _inFlightWrite ?? Promise.resolve();
	const write = previous
		.catch(() => undefined)
		.then(async () => {
			const payloadBytes = new TextEncoder().encode(json).byteLength;
			// P5-A: fail explicitly on a nearly-full store instead of letting
			// the write truncate/vanish silently inside the browser.
			if (await isQuotaExhausted(name, payloadBytes)) {
				throw new DOMException(
					"Storage quota nearly full — state not saved.",
					"QuotaExceededError",
				);
			}
			// A reset received while quota/predecessor writes were awaited must
			// not promote an old snapshot into the new generation.
			if (generation < _resetGeneration) {
				throw new Error("Setup changed generation before persistence");
			}
			// polish/wallpaper-flash: mirror the wallpaper choice to read-fast
			// localStorage on the same tick as the chrome write, so the next
			// newtab can paint frame 1 without waiting for async hydration.
			// Best-effort (never throws); chrome.storage stays source of truth.
			writeWallpaperSnapshot(value.state.settings.background);
			// polish/first-paint-snapshot: mirror the display-affecting flags
			// on the same tick, so the next newtab seeds its first render.
			// Best-effort (never throws); chrome.storage stays source of truth.
			writeFirstPaintSnapshot(value.state);
			_ownWriteEchoes.set(json, (_ownWriteEchoes.get(json) ?? 0) + 1);
			try {
				await extApi().storage.local.set({ [name]: json });
			} catch (error) {
				discardOwnWriteEcho(json);
				throw error;
			}
		})
		.then(() => {
			_lastWrittenJSON = json;
			setPersistHealth("ok");
		})
		.catch((error: unknown) => {
			reportPersistenceError(error);
			throw error;
		});
	const tracked = write.finally(() => {
		if (_inFlightWrite === tracked) _inFlightWrite = null;
	});
	_inFlightWrite = tracked;
	return tracked;
}

/**
 * Immediately flush any pending coalesced write to chrome.storage.
 * Returns a promise that resolves when the write completes.
 */
export function flushPersist(): Promise<void> {
	if (!_resetGenerationLoaded) {
		return _resetGenerationReady.then(() => flushPersist());
	}
	if (_setItemTimer) clearTimeout(_setItemTimer);
	_setItemTimer = null;
	const snap = _pendingSetItem;
	_pendingSetItem = null;
	const resolvers = _pendingResolvers;
	_pendingResolvers = [];
	if (!snap) return _inFlightWrite ?? Promise.resolve();
	const write = _doWrite(snap.name, snap.value, snap.generation);
	write.then(
		() => {
			resolvers.forEach(({ resolve }) => {
				resolve();
			});
		},
		(error) => {
			resolvers.forEach(({ reject }) => {
				reject(error);
			});
		},
	);
	return write;
}
/**
 * Cancel queued writes and wait for all writes already in the write chain.
 * Reset uses this narrow boundary before deleting persisted state.
 */
export async function cancelPendingPersist(): Promise<void> {
	await _resetGenerationReady;
	if (_setItemTimer) clearTimeout(_setItemTimer);
	_setItemTimer = null;
	_pendingSetItem = null;
	const resolvers = _pendingResolvers;
	_pendingResolvers = [];
	resolvers.forEach(({ resolve }) => {
		resolve();
	});
	while (_inFlightWrite) {
		const inFlight = _inFlightWrite;
		await inFlight.catch(() => undefined);
	}
}

/** Advance the shared reset barrier before deleting persisted setup data. */
export async function beginReset(): Promise<void> {
	await _resetGenerationReady;
	const next = _resetGeneration + 1;
	await extApi().storage.local.set({ [RESET_GENERATION_KEY]: next });
	_resetGeneration = next;
}

export function getResetGeneration(): number {
	return _resetGeneration;
}

/**
 * Read the persisted setup envelope for a non-page context (the background
 * service worker) while honoring the reset-generation protocol (N1).
 * Returns null when the envelope is older than the current generation —
 * exactly how page hydration treats stale writes — so post-reset saves can
 * never resurrect dead state.
 */
export async function readSetupEnvelope(name: string): Promise<Setup | null> {
	if (!extApi() || !extApi().storage?.local) return null;
	if (!_resetGenerationLoaded) await _resetGenerationReady;
	const data = await extApi().storage.local.get([name, RESET_GENERATION_KEY]);
	if (!data[name]) return null;
	const resetGeneration = normalizeResetGeneration(data[RESET_GENERATION_KEY]);
	_resetGeneration = Math.max(_resetGeneration, resetGeneration);
	try {
		const parsed = JSON.parse(data[name] as string) as StorageValue<Setup> &
			Record<string, unknown>;
		const persistedGeneration = normalizeResetGeneration(
			parsed[PERSIST_GENERATION_KEY],
		);
		if (persistedGeneration < resetGeneration) return null;
		return normalizeState(parsed.state as Partial<Setup>);
	} catch {
		// Corrupt envelope: quarantine semantics match the page adapter (D2) —
		// the caller treats it as "nothing stored" and the next write replaces it.
		return null;
	}
}

/**
 * Persist the setup envelope for a non-page context with the current
 * generation stamped (N1). The write chain is local to the calling context,
 * not a cross-context transaction. Async captures may supply their original
 * generation so a reset cannot promote an old snapshot into the new setup.
 */
export async function writeSetupEnvelope(
	name: string,
	setup: Setup,
	expectedGeneration?: number,
): Promise<void> {
	if (!extApi() || !extApi().storage?.local) return;
	if (!_resetGenerationLoaded) await _resetGenerationReady;
	const value: StorageValue<Setup> = { state: setup };
	await _doWrite(name, value, expectedGeneration ?? _resetGeneration);
}

/**
 * Returns the JSON string of the last successfully completed write,
 * used by the cross-tab sync guard to detect our own echoes.
 */
export function getLastWrittenJSON(): string | null {
	return _lastWrittenJSON;
}

function hasCustomWallpaperMigration(rawState: unknown): boolean {
	const raw = getRawBackground(rawState);
	return Boolean(
		raw &&
			(Array.isArray(raw.customWallpapers) ||
				!Object.hasOwn(raw, "customWallpaper")),
	);
}

/** Persist the normalized shape once so the legacy array does not linger. */
async function persistCustomWallpaperMigration(
	name: string,
	parsed: StorageValue<Setup>,
	normalized: Setup,
): Promise<void> {
	const migrated = { ...parsed, state: normalized };
	if (!extApi() || !extApi().storage?.local) {
		if (typeof localStorage !== "undefined") {
			try {
				localStorage.setItem(name, JSON.stringify(migrated));
			} catch (error) {
				reportPersistenceError(error);
			}
		}
		return;
	}
	if (!_resetGenerationLoaded) await _resetGenerationReady;
	await _doWrite(name, migrated, _resetGeneration);
}

// Flush pending writes before the tab closes or hides.
if (typeof window !== "undefined") {
	const onFlush = () => {
		void flushPersist().catch(() => undefined);
	};
	window.addEventListener("beforeunload", onFlush);
	window.addEventListener("pagehide", onFlush);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			void flushPersist().catch(() => undefined);
		}
	});
}

/**
 * Zustand persist storage adapter backed by extApi().storage.local.
 * Uses chrome.* API directly since it's always available in extension pages.
 *
 * Writes are coalesced — rapid setItem calls are debounced so only the
 * latest snapshot is persisted. Call `flushPersist()` to force an
 * immediate write (e.g. on slider release).
 */
export const chromeStorageAdapter: PersistStorage<Setup> = {
	getItem: async (name: string): Promise<StorageValue<Setup> | null> => {
		if (!extApi() || !extApi().storage?.local) {
			const raw =
				typeof localStorage !== "undefined" ? localStorage.getItem(name) : null;
			if (!raw) return null;
			try {
				const parsed = JSON.parse(raw) as StorageValue<Setup>;
				const rawState = parsed.state;
				const shouldMigrate = hasCustomWallpaperMigration(rawState);
				const normalized = normalizeState(rawState as Partial<Setup>);
				parsed.state = normalized;
				await cleanupLegacyCustomWallpaperImages(rawState);
				if (shouldMigrate) {
					await persistCustomWallpaperMigration(name, parsed, normalized);
				}
				return parsed;
			} catch {
				return null;
			}
		}
		const data = await extApi().storage.local.get([name, RESET_GENERATION_KEY]);
		if (!data[name]) return null;
		const resetGeneration = normalizeResetGeneration(
			data[RESET_GENERATION_KEY],
		);
		_resetGeneration = Math.max(_resetGeneration, resetGeneration);
		// D2: parse symmetrically with the localStorage branch. A corrupt
		// value is quarantined (overwritten with the default envelope) and
		// reported instead of silently degrading the session: unguarded
		// JSON.parse rejection used to be absorbed by zustand, leaving the
		// app on defaults with hasHydrated=false and the bad bytes alive.
		let parsed: StorageValue<Setup> & Record<string, unknown>;
		try {
			parsed = JSON.parse(data[name] as string) as StorageValue<Setup> &
				Record<string, unknown>;
		} catch (error) {
			reportPersistenceError(error);
			try {
				await extApi().storage.local.remove(name);
			} catch {
				// Quarantine is best-effort; the null return still applies.
			}
			return null;
		}
		const persistedGeneration = normalizeResetGeneration(
			parsed[PERSIST_GENERATION_KEY],
		);
		if (persistedGeneration < resetGeneration) return null;
		delete parsed[PERSIST_GENERATION_KEY];
		const rawState = parsed.state;
		const shouldMigrate = hasCustomWallpaperMigration(rawState);
		const normalized = normalizeState(rawState as Partial<Setup>);
		parsed.state = normalized;
		await cleanupLegacyCustomWallpaperImages(rawState);
		if (shouldMigrate) {
			try {
				await persistCustomWallpaperMigration(name, parsed, normalized);
			} catch (error) {
				reportPersistenceError(error);
			}
		}
		return parsed;
	},
	setItem: async (name: string, value: StorageValue<Setup>): Promise<void> => {
		if (!extApi() || !extApi().storage?.local) {
			if (typeof localStorage !== "undefined") {
				try {
					localStorage.setItem(name, JSON.stringify(value));
				} catch (error) {
					reportPersistenceError(error);
				}
			}
			return;
		}
		if (!_resetGenerationLoaded) await _resetGenerationReady;
		_pendingSetItem = { name, value, generation: _resetGeneration };
		if (_setItemTimer) clearTimeout(_setItemTimer);
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		// Zustand intentionally does not await storage writes. Keep the rejection
		// observable to explicit callers such as flushPersist, while marking this
		// background promise handled so a failed preference does not become an
		// unhandled-rejection console error.
		void promise.catch(() => undefined);
		_pendingResolvers.push({ resolve, reject });
		// P5-A: the change now exists only in memory (200ms coalesce + write).
		setPersistHealth("unsaved");
		_setItemTimer = setTimeout(() => {
			const snap = _pendingSetItem;
			_pendingSetItem = null;
			_setItemTimer = null;
			const resolvers = _pendingResolvers;
			_pendingResolvers = [];
			if (!snap) {
				resolvers.forEach(({ resolve }) => {
					resolve();
				});
				return;
			}
			_doWrite(snap.name, snap.value, snap.generation).then(
				() => {
					resolvers.forEach(({ resolve }) => {
						resolve();
					});
				},
				(error) => {
					resolvers.forEach(({ reject }) => {
						reject(error);
					});
				},
			);
		}, 200);
		return promise;
	},
	removeItem: async (name: string): Promise<void> => {
		if (!extApi() || !extApi().storage?.local) {
			if (typeof localStorage !== "undefined") {
				localStorage.removeItem(name);
			}
			return;
		}
		await extApi().storage.local.remove(name);
	},
};
