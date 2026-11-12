import type { ItemOrder } from "./lib/item-order";

export interface Folder {
	id: string;
	name: string;
	order: number;
	parentId?: string | null;
}

export interface Card {
	id: string;
	folderId: string;
	title: string;
	/** Optional override; omitted cards follow the global title source. */
	titleSource?: TitleSource;
	url: string;
	favicon: string | null;
	thumbId: string | null;
	order: number;
	/** "local" for user-created cards, "browser" for imported cards. */
	origin?: "local" | "browser";
	/** Timestamp (ms) when thumbnail was captured by background script. */
	capturedAt?: number | null;
}

/** Saved bookmark title or a short site name derived from its URL. */
export type TitleSource = "saved" | "site";

export interface ThumbnailCaptureSettings {
	enabled: boolean;
	delayMs: number;
}

export type WallpaperFrequency =
	| "per-tab"
	| "hourly"
	| "daily"
	| "daylight"
	| "locked";

export interface CustomWallpaper {
	id: string;
	name: string;
}

export interface BackgroundSettings {
	type: "solid" | "gradient" | "image" | "pexels" | "wallpaper" | "none";
	color: string;
	gradientId: string | null;
	imageId: string | null;
	wallpaperId: string | null;
	/** The one user-owned wallpaper slot, or null when it is empty. */
	customWallpaper: CustomWallpaper | null;
	blur: number;
	brightness: number;
	opacity: number;
	pexelsQuery: string;
	pexelsFrequency: WallpaperFrequency;
	/** Previous frequency saved before locking — restored on unlock. */
	pexelsPreviousFrequency: WallpaperFrequency | null;
	pexelsLastFetched: number | null;
	pexelsLastPeriod: "morning" | "afternoon" | "night" | null;
	pexelsImageId: string | null;
	pexelsPosition?: "center" | "top" | "bottom" | "left" | "right";
	pexelsPhoto?: {
		id: number;
		url: string;
		photographer: string;
		photographerUrl: string;
		width: number;
		height: number;
	} | null;
}

export interface ClockSettings {
	enabled: boolean;
	/** Show the time portion of the clock widget. */
	dateEnabled: boolean;
	format24: boolean;
	showSeconds: boolean;
	size: number;
	/** Date scale as a percentage of the 20px base date size. */
	dateSize: number;
	timezone: string;
}

export interface GreetingSettings {
	enabled: boolean;
	name: string;
	/** Greeting scale as a percentage of the 34px base greeting size. */
	size: number;
}

export interface SearchSettings {
	/** Show the search field on Home; quick access is independent. */
	enabled: boolean;
	/** Allow Search from the toolbar and Ctrl/Cmd+K. */
	quickAccessEnabled: boolean;
	engine: string;
	/**
	 * Placeholder text. When empty, the UI shows a dynamic default that names
	 * the active engine (e.g. `Search with "Google"`).
	 */
	placeholder: string;
	/** Leading glyph: the engine's own logo, or a classic magnifying glass. */
	iconMode: "engine" | "search";
	/** Preferred search surface width in CSS pixels. */
	width: number;
}

/** Top-level look: rich CSS glass material vs flat surfaces. */
export type AppearanceMode = "liquid" | "classic";

/** Product material concept: Glass chrome vs Flat chrome. Mirrors AppearanceMode. */
export type MaterialMode = "glass" | "flat";

/**
 * Liquid Glass intensity: one continuous slider from Ultra Clear (0) to
 * Fully Tinted (100). Drives the whole semantic Glass system (veil density,
 * refraction strength, saturation, blur) — never a raw opacity override.
 * Calibrated default is 60: legible on arbitrary wallpapers, not a demo value.
 */
export type GlassIntensity = number;

/** System appearance mode: follow system or explicit light/dark. */
export type ColorScheme = "auto" | "light" | "dark";

/** Curated semantic accent palette used for interactive emphasis. */
export type AccentColor = "blue" | "yellow" | "green" | "purple" | "pink";

/** Speed Dial display mode: full cards vs app-launcher icons. */
export type DialLayout = "card" | "icon";

/**
 * Shared corner roundness for the semantic shape roles (panel, section,
 * surface, control, pill and the search field). Toolbar capsules and card
 * thumbnails keep their own intentional geometry and do not follow this.
 */
export type CornerScale = "discreet" | "soft" | "rounded";

/** Card shape in card layout. Vertical is taller than wide (Vivaldi-style). */
export type CardAspect = "square" | "horizontal" | "vertical";

/** A small, ordered destination shown above the bookmark library. */
export interface QuickLink {
	id: string;
	label: string;
	url: string;
}

/** Quick Links stay grouped so future editing/reordering needs no schema split. */
export interface QuickLinksSettings {
	enabled: boolean;
	items: QuickLink[];
}

export interface WeatherSettings {
	enabled: boolean;
	display: "toolbar" | "widget";
	place: string;
	latitude: number | null;
	longitude: number | null;
	dynamicAtmosphere: boolean;
}

export interface WeatherReading {
	temperatureC: number;
	weatherCode: number;
	isDay: boolean;
}

export interface CachedWeather {
	locationKey: string;
	fetchedAt: number;
	reading: WeatherReading;
}

export interface Settings {
	tileSize: "small" | "medium" | "large";
	maxColumns: number;
	showTitle: boolean;
	/**
	 * @deprecated The hover delete button was removed; deletion lives in the
	 * context menu. Kept so stored settings still normalize.
	 */
	showDeleteButton: boolean;
	openInNewTab: boolean;
	/** Speed Dial display mode. */
	dialLayout: DialLayout;
	/** Card aspect ratio (card layout only). */
	cardAspect: CardAspect;
	/** Show the site title under the icon in icon layout. */
	iconShowLabel: boolean;
	/**
	 * Wrap each Icon-mode tile (icon + label) in one translucent glass panel.
	 * Exclusive to the icon layout, off by default: the bare Home-Screen
	 * silhouette is the shipped identity and the glass layer doubles the
	 * page's backdrop-filter surface count (opt-in material).
	 */
	iconTileSurface: boolean;
	/** Default display title source in both Card and Icon layouts. */
	defaultTitleSource: TitleSource;
	thumbnailCapture: ThumbnailCaptureSettings;
	background: BackgroundSettings;
	clock: ClockSettings;
	greeting: GreetingSettings;
	search: SearchSettings;
	quickLinks: QuickLinksSettings;
	weather: WeatherSettings;
	appearanceMode: AppearanceMode;
	colorScheme: ColorScheme;
	accentColor: AccentColor;
	/** Liquid Glass intensity 0 (Ultra Clear) … 100 (Fully Tinted). */
	glassIntensity: GlassIntensity;
	/** Shared corner roundness for the semantic shape roles. */
	cornerScale: CornerScale;
}

export interface Setup {
	folders: Folder[];
	cards: Card[];
	activeFolderId: string;
	settings: Settings;
	/**
	 * Unified per-container display order (`containerId -> ["card:id",
	 * "folder:id"]`). The source of truth for mixed folder/bookmark ordering;
	 * legacy `order` fields are reindexed from it. Absent in legacy payloads
	 * and backfilled on load (folders-first) by `normalizeState`.
	 */
	itemOrder?: ItemOrder;
}

/** A curated site shown in the "Recommended sites" section of the add-favorite dialog. */
export interface SiteSuggestion {
	name: string;
	url: string;
}

// ── SVGL API ─────────────────────────────────────────────────────────────────

export type SVGLThemeOptions = { dark: string; light: string };

export interface SVGLItem {
	id: number;
	title: string;
	category: string | string[];
	route: string | SVGLThemeOptions;
	url: string;
}
