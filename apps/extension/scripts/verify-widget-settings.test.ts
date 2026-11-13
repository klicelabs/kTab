import { expect, test } from "bun:test";
import { DEFAULT_SETUP } from "../src/lib/constants";
import { normalizeState } from "../src/lib/storage";

test("normalizes independent widget scales and search width at hydration", () => {
	const state = structuredClone(DEFAULT_SETUP);
	state.settings.clock.enabled = false;
	state.settings.clock.dateEnabled = true;
	state.settings.clock.size = -20;
	state.settings.clock.dateSize = Number.POSITIVE_INFINITY;
	state.settings.greeting.size = 999;
	state.settings.search.width = 1200;

	const normalized = normalizeState(state);

	expect(normalized.settings.clock.enabled).toBe(false);
	expect(normalized.settings.clock.dateEnabled).toBe(true);
	expect(normalized.settings.clock.size).toBe(60);
	expect(normalized.settings.clock.dateSize).toBe(100);
	expect(normalized.settings.greeting.size).toBe(200);
	expect(normalized.settings.search.width).toBe(800);
});

test("keeps the date enabled when hydrating a legacy clock payload", () => {
	const state = structuredClone(DEFAULT_SETUP);
	const clock = state.settings.clock as Record<string, unknown>;
	delete clock.dateEnabled;
	delete clock.dateSize;

	const normalized = normalizeState(state);

	expect(normalized.settings.clock.dateEnabled).toBe(true);
	expect(normalized.settings.clock.dateSize).toBe(100);
});

test("preserves a legacy hidden clock as a hidden date", () => {
	const state = structuredClone(DEFAULT_SETUP);
	const clock = state.settings.clock as Record<string, unknown>;
	clock.enabled = false;
	delete clock.dateEnabled;

	const normalized = normalizeState(state);

	expect(normalized.settings.clock.dateEnabled).toBe(false);
});

test("enables automatic missing-thumbnail capture by default and preserves opt-out", () => {
	const defaults = normalizeState(null);
	expect(defaults.settings.thumbnailCapture.enabled).toBe(true);

	const optedOut = normalizeState({
		...structuredClone(DEFAULT_SETUP),
		settings: {
			...structuredClone(DEFAULT_SETUP.settings),
			thumbnailCapture: { enabled: false, delayMs: 2000 },
		},
	});
	expect(optedOut.settings.thumbnailCapture).toEqual({
		enabled: false,
		delayMs: 2000,
	});
});

test("defaults to the soft corner scale and rejects unknown scales", () => {
	const defaults = normalizeState(null);
	expect(defaults.settings.cornerScale).toBe("soft");

	// Persisted values round-trip ...
	const rounded = normalizeState({
		...structuredClone(DEFAULT_SETUP),
		settings: {
			...structuredClone(DEFAULT_SETUP.settings),
			cornerScale: "rounded",
		},
	});
	expect(rounded.settings.cornerScale).toBe("rounded");

	// ... corrupted values fall back to the default tier instead of breaking
	// the CSS contract (the tier attribute must always be a known value).
	const legacy = structuredClone(DEFAULT_SETUP) as Record<string, unknown>;
	(legacy.settings as Record<string, unknown>).cornerScale = "very-round";
	const repaired = normalizeState(legacy as never);
	expect(repaired.settings.cornerScale).toBe("soft");
});

test("migrates the legacy icon glass flag to the icon surface setting", () => {
	const legacy = structuredClone(DEFAULT_SETUP);
	const legacySettings = legacy.settings as unknown as Record<string, unknown>;
	delete legacySettings.iconTileSurface;
	legacySettings.iconGlassTile = true;

	expect(normalizeState(legacy).settings.iconTileSurface).toBe(true);

	legacySettings.iconTileSurface = false;
	expect(normalizeState(legacy).settings.iconTileSurface).toBe(false);
});

test("weather is off by default and rejects invalid saved locations", () => {
	const defaults = normalizeState(null);
	expect(defaults.settings.weather).toEqual({
		enabled: false,
		display: "expanded",
		appearance: "flat",
		place: "",
		latitude: null,
		longitude: null,
		dynamicAtmosphere: false,
	});

	const state = structuredClone(DEFAULT_SETUP);
	const settings = state.settings as unknown as Record<string, unknown>;
	settings.weather = {
		enabled: true,
		display: "compact",
		place: "Saquarema",
		latitude: 91,
		longitude: -42.5,
		dynamicAtmosphere: true,
	};
	const normalized = normalizeState(state);
	expect(normalized.settings.weather).toEqual({
		enabled: true,
		display: "compact",
		appearance: "flat",
		place: "",
		latitude: null,
		longitude: -42.5,
		dynamicAtmosphere: true,
	});
});

test("keeps a valid weather display and manual city coordinates", () => {
	const state = structuredClone(DEFAULT_SETUP);
	state.settings.weather = {
		enabled: true,
		display: "toolbar",
		place: " Saquarema, Brazil ",
		latitude: -22.92,
		longitude: -42.51,
		dynamicAtmosphere: true,
	};

	expect(normalizeState(state).settings.weather).toEqual({
		enabled: true,
		display: "toolbar",
		appearance: "flat",
		place: "Saquarema, Brazil",
		latitude: -22.92,
		longitude: -42.51,
		dynamicAtmosphere: true,
	});
});

test("migrates legacy weather cards and normalizes each widget appearance locally", () => {
	const state = structuredClone(DEFAULT_SETUP);
	const settings = state.settings as unknown as Record<string, unknown>;
	settings.weather = { ...DEFAULT_SETUP.settings.weather, display: "widget" };
	settings.widgets = {
		music: { enabled: true, appearance: "glass" },
		market: {
			enabled: true,
			appearance: "broken",
			tickers: ["^bvsp", "DIS", "AAPL", "TSLA"],
		},
		github: {
			enabled: true,
			appearance: "flat",
			username: " octocat! ",
			token: " secret ",
		},
	};

	const normalized = normalizeState(state);
	expect(normalized.settings.weather.display).toBe("expanded");
	expect(normalized.settings.widgets).toEqual({
		music: { enabled: true, appearance: "glass" },
		market: {
			enabled: true,
			appearance: "flat",
			tickers: ["^BVSP", "DIS", "AAPL"],
		},
		github: {
			enabled: true,
			appearance: "flat",
			username: "octocat",
			token: "secret",
		},
	});
});
