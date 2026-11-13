import type {
	BackgroundSettings,
	ClockSettings,
	GreetingSettings,
	QuickLink,
	SearchSettings,
	Settings,
	Setup,
	ThumbnailCaptureSettings,
	WallpaperFrequency,
} from "../types";
import { FALLBACK_WEATHER_LOCATION } from "./weather-location";
export const MAX_BACKGROUND_IMAGE_BYTES = 10 * 1024 * 1024;

export interface GradientDef {
	id: string;
	label: string;
	css: string;
}

export const GRADIENTS: GradientDef[] = [
	{
		id: "aurora",
		label: "Aurora",
		css: "radial-gradient(120% 100% at 20% 0%, #3a3f8f 0%, #0a0a0c 55%), linear-gradient(160deg,#1b1f4d,#0a0a0c)",
	},
	{
		id: "sunset",
		label: "Sunset",
		css: "linear-gradient(150deg,#3a1c3d 0%,#7a3b2e 45%,#0a0a0c 100%)",
	},
	{
		id: "ocean",
		label: "Ocean",
		css: "linear-gradient(160deg,#0f2f3d 0%,#123a4a 40%,#0a0a0c 100%)",
	},
	{
		id: "graphite",
		label: "Graphite",
		css: "linear-gradient(160deg,#232326 0%,#141416 60%,#0a0a0c 100%)",
	},
	{
		id: "forest",
		label: "Forest",
		css: "linear-gradient(160deg,#122a1e 0%,#16351f 45%,#0a0a0c 100%)",
	},
	{
		id: "rose",
		label: "Rosé",
		css: "linear-gradient(150deg,#3d1c2e 0%,#4a2340 45%,#0a0a0c 100%)",
	},
	{
		id: "ember",
		label: "Ember",
		css: "linear-gradient(160deg,#3a1210 0%,#5a2312 45%,#0a0a0c 100%)",
	},
	{
		id: "mint",
		label: "Mint",
		css: "linear-gradient(160deg,#0f3a34 0%,#123f2f 45%,#0a0a0c 100%)",
	},
];

export interface WallpaperDef {
	id: string;
	label: string;
	src: string;
	thumb: string;
}

export const WALLPAPERS: WallpaperDef[] = [
	{
		id: "alpine-lake-sunbeams",
		label: "Alpine Lake Sunbeams",
		src: "/wallpapers/alpine-lake-sunbeams.avif",
		thumb: "/wallpapers/thumbs/alpine-lake-sunbeams.avif",
	},
	{
		id: "matterhorn-at-dusk",
		label: "Matterhorn at Dusk",
		src: "/wallpapers/matterhorn-at-dusk.avif",
		thumb: "/wallpapers/thumbs/matterhorn-at-dusk.avif",
	},
	{
		id: "purple-mountain-summit",
		label: "Purple Mountain Summit",
		src: "/wallpapers/purple-mountain-summit.avif",
		thumb: "/wallpapers/thumbs/purple-mountain-summit.avif",
	},
	{
		id: "tokyo-skyline",
		label: "Tokyo Skyline",
		src: "/wallpapers/tokyo-skyline.avif",
		thumb: "/wallpapers/thumbs/tokyo-skyline.avif",
	},
	{
		id: "blue-moon-mountains",
		label: "Blue Moon Mountains",
		src: "/wallpapers/blue-moon-mountains.avif",
		thumb: "/wallpapers/thumbs/blue-moon-mountains.avif",
	},
	{
		id: "red-sun-water",
		label: "Red Sun Water",
		src: "/wallpapers/red-sun-water.avif",
		thumb: "/wallpapers/thumbs/red-sun-water.avif",
	},
	{
		id: "turquoise-alpine-lake",
		label: "Turquoise Alpine Lake",
		src: "/wallpapers/turquoise-alpine-lake.avif",
		thumb: "/wallpapers/thumbs/turquoise-alpine-lake.avif",
	},
	{
		id: "mountain-lake",
		label: "Mountain Lake",
		src: "/wallpapers/mountain-lake.avif",
		thumb: "/wallpapers/thumbs/mountain-lake.avif",
	},
	{
		id: "starry-night-sky",
		label: "Starry Night Sky",
		src: "/wallpapers/starry-night-sky.avif",
		thumb: "/wallpapers/thumbs/starry-night-sky.avif",
	},
	{
		id: "violet-curves",
		label: "Violet Curves",
		src: "/wallpapers/violet-curves.avif",
		thumb: "/wallpapers/thumbs/violet-curves.avif",
	},
	{
		id: "bonsai-rock-milky-way",
		label: "Bonsai Rock Milky Way",
		src: "/wallpapers/bonsai-rock-milky-way.avif",
		thumb: "/wallpapers/thumbs/bonsai-rock-milky-way.avif",
	},
];

/**
 * Grid tile widths per size. Heights are DERIVED from CARD_ASPECT_RATIO —
 * these height values feed only fallbacks/icon layout. Small was bumped so it
 * no longer reads as a cramped thumbnail.
 */
export const TILE_SIZE_DIMENSIONS: Record<
	string,
	{ width: number; height: number }
> = {
	small: { width: 132, height: 146 },
	medium: { width: 160, height: 176 },
	large: { width: 196, height: 216 },
};

/**
 * Card height as a multiple of the tile width, per aspect choice.
 *
 * Vivaldi's Speed Dial cards are slightly TALLER than wide — the thumbnail is
 * landscape and the footer sits beneath it, so the whole card lands just over
 * 1:1. This ratio is applied to the tile WIDTH and is identical across the
 * Small / Medium / Large size variants, so the proportions never change when
 * the grid size is toggled.
 */
export const CARD_ASPECT_RATIO: Record<string, number> = {
	horizontal: 0.82,
	square: 1,
	vertical: 1.12,
};

/** Uniform footer height (favicon + site name + breathing room). */
export const CARD_FOOTER_HEIGHT_PX = 30;

export const GRID_GAP_PX = 22;
export const GRID_PADDING_X_PX = 24;
export const MIN_COLUMNS = 4;
export const MAX_COLUMNS = 10;

/** User-facing scale bounds shared by the widget controls and storage repair. */
export const WIDGET_SIZE_MIN = 60;
export const WIDGET_SIZE_MAX = 200;
export const SEARCH_WIDTH_MIN = 420;
export const SEARCH_WIDTH_MAX = 800;
export const DEFAULT_SEARCH_WIDTH = 672;

export const DEFAULT_THUMBNAIL_CAPTURE: ThumbnailCaptureSettings = {
	enabled: true,
	delayMs: 1200,
};

export const DEFAULT_BACKGROUND: BackgroundSettings = {
	type: "wallpaper",
	color: "#0A0A0C",
	gradientId: null,
	imageId: null,
	wallpaperId: "tokyo-skyline",
	customWallpaper: null,
	blur: 0,
	brightness: 100,
	opacity: 100,
	pexelsQuery: "cinematic nature landscape 4k",
	pexelsFrequency: "daily" as WallpaperFrequency,
	pexelsPreviousFrequency: null,
	pexelsLastFetched: null,
	pexelsLastPeriod: null,
	pexelsImageId: null,
	pexelsPosition: "center",
	pexelsPhoto: null,
};

/**
 * Clean theme-aware surface for the "none" background: no image, just a
 * quiet tinted gradient that glass widgets sit on. Shared by BackgroundLayer
 * and the frame-1 prehydrate shim so both paint the same recipe.
 */
export function cleanSurfaceCss(dark: boolean): string {
	return dark
		? "linear-gradient(180deg,#17191f,#0f1116)"
		: "linear-gradient(180deg,#f6f7fa,#e9edf3)";
}

export const DEFAULT_CLOCK: ClockSettings = {
	enabled: true,
	dateEnabled: true,
	format24: true,
	showSeconds: false,
	size: 200,
	dateSize: 100,
	timezone: "auto",
};

export const DEFAULT_GREETING: GreetingSettings = {
	enabled: true,
	name: "",
	size: 100,
};

export interface SearchEngineDef {
	id: string;
	label: string;
	/** Query template; "%s" is replaced with the URL-encoded search terms. */
	queryUrl: string;
	/** Origin used to derive the engine's favicon for the in-input logo. */
	homepage: string;
}

export const SEARCH_ENGINES: SearchEngineDef[] = [
	{
		id: "google",
		label: "Google",
		queryUrl: "https://www.google.com/search?q=%s",
		homepage: "https://www.google.com",
	},
	{
		id: "bing",
		label: "Bing",
		queryUrl: "https://www.bing.com/search?q=%s",
		homepage: "https://www.bing.com",
	},
	{
		id: "duckduckgo",
		label: "DuckDuckGo",
		queryUrl: "https://duckduckgo.com/?q=%s",
		homepage: "https://duckduckgo.com",
	},
	{
		id: "brave",
		label: "Brave",
		queryUrl: "https://search.brave.com/search?q=%s",
		homepage: "https://search.brave.com",
	},
	{
		id: "ecosia",
		label: "Ecosia",
		queryUrl: "https://www.ecosia.org/search?q=%s",
		homepage: "https://www.ecosia.org",
	},
];

export const DEFAULT_SEARCH: SearchSettings = {
	enabled: true,
	quickAccessEnabled: true,
	engine: "google",
	placeholder: "",
	iconMode: "engine",
	width: DEFAULT_SEARCH_WIDTH,
};

/** Common destinations shown to first-time users above their bookmark grid. */
export const DEFAULT_QUICK_LINKS: readonly QuickLink[] = [
	{ id: "google", label: "Google", url: "https://www.google.com" },
	{ id: "youtube", label: "YouTube", url: "https://www.youtube.com" },
	{ id: "gmail", label: "Gmail", url: "https://mail.google.com" },
	{ id: "github", label: "GitHub", url: "https://github.com" },
	{ id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com" },
	{ id: "wikipedia", label: "Wikipedia", url: "https://www.wikipedia.org" },
	{ id: "spotify", label: "Spotify", url: "https://open.spotify.com" },
	{ id: "reddit", label: "Reddit", url: "https://www.reddit.com" },
];

export const DEFAULT_SETTINGS: Settings = {
	tileSize: "medium",
	maxColumns: 7,
	showTitle: true,
	showDeleteButton: true,
	openInNewTab: false,
	dialLayout: "card",
	cardAspect: "vertical",
	iconShowLabel: true,
	/** Icon + label tile surfaces are opt-in; the bare launcher look ships. */
	iconTileSurface: false,
	defaultTitleSource: "saved",
	quickLinks: {
		enabled: true,
		items: DEFAULT_QUICK_LINKS.map((link) => ({ ...link })),
	},
	thumbnailCapture: { ...DEFAULT_THUMBNAIL_CAPTURE },
	background: { ...DEFAULT_BACKGROUND },
	clock: { ...DEFAULT_CLOCK },
	greeting: { ...DEFAULT_GREETING },
	search: { ...DEFAULT_SEARCH },
	weather: {
		enabled: false,
		display: "expanded",
		appearance: "flat",
		...FALLBACK_WEATHER_LOCATION,
		dynamicAtmosphere: false,
	},
	widgets: {
		music: { enabled: true, appearance: "flat", size: "expanded" },
		market: {
			enabled: true,
			appearance: "flat",
			size: "expanded",
			tickers: ["^BVSP", "DIS", "AAPL"],
		},
		github: {
			enabled: false,
			appearance: "flat",
			size: "expanded",
			palette: "github",
			username: "",
			token: "",
		},
	},
	appearanceMode: "liquid",
	colorScheme: "auto",
	accentColor: "blue",
	/** Calibrated middle default: survives arbitrary wallpapers (see glass.ts). */
	glassIntensity: 60,
	/** "soft" reproduces the shipped panel geometry for existing installs. */
	cornerScale: "soft",
};

export const DEFAULT_SETUP: Setup = {
	folders: [{ id: "default", name: "Home", order: 0, parentId: null }],
	cards: [],
	activeFolderId: "default",
	settings: { ...DEFAULT_SETTINGS },
};
