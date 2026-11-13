import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyLanding } from "../src/components/newtab/empty-landing";
import { WidgetSettings } from "../src/components/newtab/settings/panes/widget-settings";
import { WeatherToolbarView } from "../src/components/newtab/weather/weather-toolbar";
import { WeatherWidgetView } from "../src/components/newtab/weather/weather-widget";
import {
	type GitHubWidgetData,
	GitHubWidgetView,
} from "../src/components/newtab/widgets/github-widget";
import { MarketWidgetView } from "../src/components/newtab/widgets/market-widget";
import {
	audioOutputOverflowDistance,
	MusicWidgetView,
} from "../src/components/newtab/widgets/music-widget";
import { DEFAULT_SETUP } from "../src/lib/constants";
import type { MediaSessionSnapshot } from "../src/lib/media-session";
import type { MarketQuote } from "../src/services/market-data";

const marketQuotes: MarketQuote[] = [
	{
		symbol: "^BVSP",
		name: "IBOVESPA",
		currency: "BRL",
		price: 125_053,
		previousClose: 126_147,
		change: -1_094,
		changePercent: -0.86,
		points: [
			{ time: 1, close: 125_200 },
			{ time: 2, close: 125_053 },
		],
	},
	{
		symbol: "DIS",
		name: "The Walt Disney Company",
		currency: "USD",
		price: 176.14,
		previousClose: 175.13,
		change: 1.01,
		changePercent: 0.58,
		points: [],
	},
	{
		symbol: "AAPL",
		name: "Apple Inc.",
		currency: "USD",
		price: 148.56,
		previousClose: 146.8,
		change: 1.76,
		changePercent: 1.2,
		points: [
			{ time: 1, close: 146.8 },
			{ time: 2, close: 148.56 },
		],
	},
];

test("renders music and GitHub widgets with independent Flat or Glass settings", () => {
	const music = renderToStaticMarkup(
		createElement(MusicWidgetView, {
			appearance: "glass",
			session: null,
			busyAction: null,
			onControl: () => undefined,
		}),
	);
	const github = renderToStaticMarkup(
		createElement(GitHubWidgetView, {
			appearance: "flat",
			username: "",
			data: null,
			status: "ready",
		}),
	);
	expect(music).toContain('data-widget="music"');
	expect(music).toContain('data-widget-size="expanded"');
	expect(music).toContain('data-widget-appearance="glass"');
	expect(music).toContain("Nothing playing");
	expect(github).toContain('data-widget="github"');
	expect(github).toContain('data-widget-size="expanded"');
	expect(github).toContain('data-widget-appearance="flat"');
	expect(github).toContain("Add a username in Settings");
});

test("music widget renders now-playing metadata, timeline and transport controls", () => {
	const session: MediaSessionSnapshot = {
		tabId: 3,
		updatedAt: 1,
		title: "People Are Strange",
		artist: "The Doors",
		album: "Strange Days",
		artwork: null,
		playing: true,
		currentTime: 19,
		duration: 133,
		canNext: true,
		canPrevious: true,
	};
	const markup = renderToStaticMarkup(
		createElement(MusicWidgetView, {
			appearance: "flat",
			session,
			busyAction: null,
			onControl: () => undefined,
		}),
	);
	expect(markup).toContain("People Are Strange");
	expect(markup).toContain("The Doors");
	expect(markup).toContain("0:19");
	expect(markup).toContain("−1:54");
	expect(markup).toContain('aria-valuenow="14"');
	expect(markup).toContain('aria-label="Pause"');
	expect(markup).toContain('aria-label="Previous track"');
	expect(markup).toContain('aria-label="Next track"');
	expect(markup).toContain("is-playing");
});

test("GitHub widget renders seven by ten contributions and a five-axis activity radar", () => {
	const data: GitHubWidgetData = {
		username: "octocat",
		today: 15,
		best: 210,
		total: 10_810,
		contributions: Array.from({ length: 70 }, (_, index) => ({
			date: `2026-11-${String((index % 28) + 1).padStart(2, "0")}`,
			count: index % 5,
		})),
		radars: {
			commits: 210,
			issues: 10,
			pullRequests: 42,
			reviews: 18,
			repositories: 7,
		},
		dataScope: "public",
	};
	const markup = renderToStaticMarkup(
		createElement(GitHubWidgetView, {
			appearance: "glass",
			username: "octocat",
			data,
			status: "ready",
		}),
	);
	const { document } = parseHTML(markup);
	expect(markup).toContain('data-widget-appearance="glass"');
	expect(markup).toContain("10.81k");
	expect(markup).toContain("Last 70 days of GitHub contributions");
	expect(markup).toContain('aria-label="0 contributions on ');
	expect(
		document.querySelector("fieldset")?.querySelectorAll("button"),
	).toHaveLength(70);
	expect(markup).toContain(
		"GitHub activity radar: commits 210, issues 10, pull requests 42, reviews 18, repositories 7",
	);
	expect(markup).toContain('aria-label="PullReq: 42"');
	expect(markup).toContain("0 contributions on ");
});

test("weather toolbar stays one-line, uses the city prefix and omits provider branding", () => {
	const markup = renderToStaticMarkup(
		createElement(WeatherToolbarView, {
			weather: {
				enabled: true,
				display: "toolbar",
				appearance: "flat",
				place: "Saquarema, Rio de Janeiro, Brasil",
				latitude: -22.92,
				longitude: -42.51,
				dynamicAtmosphere: false,
			},
			reading: { temperatureC: 27, weatherCode: 0, isDay: true },
			status: "ready",
		}),
	);
	expect(markup).toContain("Saquarema");
	expect(markup).toContain("27°");
	expect(markup).toContain("whitespace-nowrap");
	expect(markup).not.toContain("Rio de Janeiro");
	expect(markup).not.toContain("Open-Meteo");
});

test("compact weather keeps the large icon above temperature, condition and city", () => {
	const markup = renderToStaticMarkup(
		createElement(WeatherWidgetView, {
			weather: {
				enabled: true,
				display: "compact",
				appearance: "flat",
				place: "Porto Da Roça I",
				latitude: -22.92,
				longitude: -42.51,
				dynamicAtmosphere: false,
			},
			reading: { temperatureC: 22, weatherCode: 61, isDay: true },
			status: "ready",
			error: null,
		}),
	);
	expect(markup).toContain('data-widget-size="compact"');
	expect(markup).toContain('data-widget-appearance="flat"');
	expect(markup).toContain("22°");
	expect(markup).toContain("Porto Da Roça I");
	expect(markup).toContain("lucide-map-pin");
	expect(markup).toContain("size-[58px]");
});

test("expanded weather uses a stronger forecast hierarchy", () => {
	const markup = renderToStaticMarkup(
		createElement(WeatherWidgetView, {
			weather: {
				enabled: true,
				display: "expanded",
				appearance: "glass",
				place: "Saquarema, Rio de Janeiro, Brasil",
				latitude: -22.92,
				longitude: -42.51,
				dynamicAtmosphere: false,
			},
			reading: { temperatureC: 22, weatherCode: 0, isDay: true },
			status: "ready",
			error: null,
		}),
	);
	expect(markup).toContain('data-widget-appearance="glass"');
	expect(markup).toContain("text-[38px]");
	expect(markup).toContain('width="19"');
	expect(markup).not.toContain("weather-condition-texture");
});

test("market view exposes the selected surface material and list rows", () => {
	const markup = renderToStaticMarkup(
		createElement(MarketWidgetView, {
			quotes: marketQuotes,
			status: "ready",
			appearance: "glass",
		}),
	);
	expect(markup).toContain('data-widget-appearance="glass"');
	expect(markup).toContain('data-market-view="list"');
	expect(markup).toContain("IBOVESPA");
	expect(markup).toContain("The Walt Disney Company");
	expect(markup).toContain("intraday trend");
});

test("widget defaults remain aligned with the requested dashboard shelf", () => {
	expect(DEFAULT_SETUP.settings.widgets.music).toEqual({
		enabled: true,
		appearance: "album-blur",
		size: "expanded",
	});
	expect(DEFAULT_SETUP.settings.weather.appearance).toBe("atmospheric");
	expect(DEFAULT_SETUP.settings.widgets.market.appearance).toBe("oled");
	expect(DEFAULT_SETUP.settings.widgets.github.appearance).toBe("oled");
	expect(DEFAULT_SETUP.settings.widgets.market.tickers).toEqual([
		"^BVSP",
		"DIS",
		"AAPL",
	]);
	expect(DEFAULT_SETUP.settings.widgets.github.enabled).toBe(false);
	expect(DEFAULT_SETUP.settings.widgets.github.palette).toBe("github");
});

test("compact music always uses full-bleed art with a progressive blurred footer", () => {
	const session: MediaSessionSnapshot = {
		tabId: 7,
		updatedAt: 1,
		title: "People Are Strange",
		artist: "The Doors",
		album: "Strange Days",
		artwork: "https://example.com/cover.jpg",
		playing: false,
		currentTime: 19,
		duration: 133,
		canNext: true,
		canPrevious: true,
	};
	const markup = renderToStaticMarkup(
		createElement(MusicWidgetView, {
			appearance: "flat",
			size: "compact",
			session,
			busyAction: null,
			onControl: () => undefined,
			onSetOutput: async () => ({ ok: true }),
		}),
	);
	expect(markup).toContain('data-widget-size="compact"');
	expect(markup).toContain('data-widget-appearance="flat"');
	expect(markup).toContain("object-cover");
	expect(markup).toContain("h-[48%]");
	expect(markup).toContain("backdrop-blur-sm");
	expect(markup).toContain("bg-gradient-to-b");
	expect(markup).toContain(
		"mask-image:linear-gradient(to bottom, transparent 0%, black 60%, black 100%)",
	);
	expect(markup).toContain(
		"-webkit-mask-image:linear-gradient(to bottom, transparent 0%, black 60%, black 100%)",
	);
	expect(markup).toContain("rounded-full");
	expect(markup).not.toContain("blur-2xl");
	expect(markup).toContain("People Are Strange");
	expect(markup).not.toContain("The Doors");
	expect(markup).toContain('aria-label="Previous track"');
	expect(markup).toContain('aria-label="Play"');
	expect(markup).toContain('aria-label="Next track"');
	expect(markup).toContain('aria-label="Choose audio output for this tab"');
	expect(markup).not.toContain('role="progressbar"');
});

test("compact music without artwork has no dark gradient band", () => {
	const markup = renderToStaticMarkup(
		createElement(MusicWidgetView, {
			appearance: "glass",
			size: "compact",
			session: null,
			busyAction: null,
			onControl: () => undefined,
		}),
	);
	expect(markup).toContain('data-widget-appearance="glass"');
	expect(markup).toContain("Nothing playing");
	expect(markup).not.toContain("bg-gradient-to-b");
	expect(markup).not.toContain("mask-image:");
});

test("audio device marquee only activates when the full label exceeds its viewport", () => {
	expect(audioOutputOverflowDistance(120, 140)).toBe(0);
	expect(audioOutputOverflowDistance(240, 140)).toBe(100);
});

test("passive media tab data does not pretend to have track progress", () => {
	const session: MediaSessionSnapshot = {
		tabId: 8,
		updatedAt: 1,
		title: "A video is playing",
		artist: "youtube.com",
		album: "",
		artwork: "https://www.youtube.com/favicon.ico",
		playing: true,
		currentTime: 0,
		duration: 0,
		canNext: true,
		canPrevious: true,
	};
	const markup = renderToStaticMarkup(
		createElement(MusicWidgetView, {
			appearance: "flat",
			session,
			busyAction: null,
			onControl: () => undefined,
		}),
	);

	expect(markup).toContain("Playing in youtube.com");
	expect(markup).not.toContain('aria-label="Track progress"');
	expect(markup).not.toContain("−0:00");
});

test("compact market lists up to three assets without a loose sparkline", () => {
	const markup = renderToStaticMarkup(
		createElement(MarketWidgetView, {
			quotes: marketQuotes,
			status: "ready",
			appearance: "flat",
			size: "compact",
		}),
	);
	expect(markup).toContain('data-widget-size="compact"');
	expect(markup).toContain('data-market-view="compact"');
	expect(markup).toContain("^BVSP");
	expect(markup).toContain("The Walt Disney Company");
	expect(markup).not.toContain("intraday trend");
	expect(markup.match(/<li/g)).toHaveLength(3);
	expect(markup).toContain("text-flat-ink");
});

test("compact market gives its primary asset a clear price and mini chart", () => {
	const markup = renderToStaticMarkup(
		createElement(MarketWidgetView, {
			quotes: marketQuotes.slice(0, 1),
			status: "ready",
			appearance: "oled",
			size: "compact",
		}),
	);
	expect(markup).toContain('data-widget-appearance="oled"');
	expect(markup.match(/<li/g)).toHaveLength(1);
	expect(markup).toContain("text-[18px]");
	expect(markup).toContain("intraday trend");
	expect(markup).toContain('aria-label="Show chart for ^BVSP, IBOVESPA"');
});

test("compact GitHub uses the selected palette for the mini heatmap", () => {
	const data: GitHubWidgetData = {
		username: "octocat",
		today: 15,
		best: 210,
		total: 10_810,
		contributions: Array.from({ length: 70 }, (_, index) => ({
			date: `2026-11-${String((index % 28) + 1).padStart(2, "0")}`,
			count: index % 5,
		})),
		radars: {
			commits: 210,
			issues: 10,
			pullRequests: 42,
			reviews: 18,
			repositories: 7,
		},
		dataScope: "public",
	};
	const markup = renderToStaticMarkup(
		createElement(GitHubWidgetView, {
			appearance: "flat",
			size: "compact",
			palette: "blue",
			username: "octocat",
			data,
			status: "ready",
		}),
	);
	expect(markup).toContain('data-widget-size="compact"');
	expect(markup).toContain("Today");
	expect(markup).toContain("Last 70 days of GitHub contributions");
	expect(markup).toContain('aria-label="0 contributions on ');
	expect(markup).toContain("rgba(56,139,253,");
	expect(markup).not.toContain("GitHub activity radar");
});

test("market settings use a searchable asset combobox and keep custom tickers", () => {
	const markup = renderToStaticMarkup(createElement(WidgetSettings));
	expect(markup).toContain("Find an asset");
	expect(markup).toContain('aria-label="Search popular market assets"');
	expect(markup).toContain("Search company or ticker");
	expect(markup).toContain("Or enter a ticker, such as IBM");
	expect(markup).toContain("Size");
	expect(markup).toContain("OLED");
});

test("empty folder suggestions use the shared app-icon engine", () => {
	const markup = renderToStaticMarkup(
		createElement(EmptyLanding, {
			folderName: "Favorites",
			onAdd: () => undefined,
		}),
	);
	const { document } = parseHTML(markup);
	expect(document.querySelectorAll(".icon-app-tile")).toHaveLength(4);
	expect(markup).toContain("Nothing here yet");
	expect(markup).toContain("Add a favorite to Favorites, or choose one below.");
	for (const name of ["Google", "YouTube", "GitHub", "ChatGPT"]) {
		expect(markup).toContain(`Add ${name} to`);
	}
});
