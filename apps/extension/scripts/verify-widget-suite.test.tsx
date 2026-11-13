import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetSettings } from "../src/components/newtab/settings/panes/widget-settings";
import { WeatherToolbarView } from "../src/components/newtab/weather/weather-toolbar";
import {
	type GitHubWidgetData,
	GitHubWidgetView,
} from "../src/components/newtab/widgets/github-widget";
import { MarketWidgetView } from "../src/components/newtab/widgets/market-widget";
import { MusicWidgetView } from "../src/components/newtab/widgets/music-widget";
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
	expect(markup).toContain('aria-label="Last 70 days of GitHub contributions"');
	expect(
		document
			.querySelector('[aria-label="Last 70 days of GitHub contributions"]')
			?.querySelectorAll("span"),
	).toHaveLength(70);
	expect(markup).toContain(
		"GitHub activity radar: commits 210, issues 10, pull requests 42, reviews 18, repositories 7",
	);
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
});

test("widget defaults remain aligned with the requested dashboard shelf", () => {
	expect(DEFAULT_SETUP.settings.widgets.music).toEqual({
		enabled: true,
		appearance: "flat",
		size: "expanded",
	});
	expect(DEFAULT_SETUP.settings.widgets.market.tickers).toEqual([
		"^BVSP",
		"DIS",
		"AAPL",
	]);
	expect(DEFAULT_SETUP.settings.widgets.github.enabled).toBe(false);
	expect(DEFAULT_SETUP.settings.widgets.github.palette).toBe("github");
});

test("compact music shows artwork, track details, and play control without expanded transport", () => {
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
			appearance: "album-blur",
			size: "compact",
			session,
			busyAction: null,
			onControl: () => undefined,
			onSetOutput: async () => ({ ok: true }),
		}),
	);
	expect(markup).toContain('data-widget-size="compact"');
	expect(markup).toContain('data-widget-appearance="album-blur"');
	expect(markup).toContain("blur-2xl");
	expect(markup).toContain("scale-125");
	expect(markup).toContain("People Are Strange");
	expect(markup).toContain('aria-label="Play"');
	expect(markup).not.toContain('role="progressbar"');
	expect(markup).not.toContain('aria-label="Choose audio output for this tab"');
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

test("compact market features one asset and a mini trend line", () => {
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
	expect(markup).toContain("intraday trend");
	expect(markup).not.toContain("The Walt Disney Company");
	expect(markup).toContain("text-flat-ink");
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
	expect(markup).toContain('aria-label="Last 70 days of GitHub contributions"');
	expect(markup).toContain("rgba(56,139,253,");
	expect(markup).not.toContain("GitHub activity radar");
});

test("market settings offer searchable one-click presets and custom tickers", () => {
	const markup = renderToStaticMarkup(createElement(WidgetSettings));
	expect(markup).toContain("Find a popular asset");
	expect(markup).toContain('aria-label="Add NVIDIA (NVDA)"');
	expect(markup).toContain('aria-label="Add Petrobras PN (PETR4.SA)"');
	expect(markup).toContain('aria-label="Add Bitcoin (BTC-USD)"');
	expect(markup).toContain("Or enter a ticker, such as IBM");
	expect(markup).toContain("Size");
});
