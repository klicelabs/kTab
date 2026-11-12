import { expect, test } from "bun:test";
import {
	describeWeatherCondition,
	isWeatherCacheFresh,
	WEATHER_CACHE_TTL_MS,
	weatherLocationKey,
} from "../src/lib/weather-conditions";
import {
	scheduleWeatherIdleTask,
	type WeatherIdleScheduler,
} from "../src/lib/weather-idle";
import type { WeatherLocation } from "../src/services/open-meteo";
import {
	fetchCurrentWeather,
	formatWeatherPlace,
	searchWeatherLocations,
} from "../src/services/open-meteo";

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

test("weather search sends only the submitted place and returns valid locations", async () => {
	let requestUrl: URL | null = null;
	let requestInit: RequestInit | undefined;
	const fetcher: typeof fetch = async (input, init) => {
		requestUrl = new URL(input.toString());
		requestInit = init;
		return jsonResponse({
			results: [
				{
					name: "Saquarema",
					admin1: "Rio de Janeiro",
					country: "Brasil",
					latitude: -22.92,
					longitude: -42.51,
					timezone: "America/Sao_Paulo",
				},
				{ name: "Unknown", latitude: 91, longitude: 0 },
			],
		});
	};

	const locations = await searchWeatherLocations("Saquarema, Brasil", {
		language: "pt-BR",
		fetcher,
	});

	expect(requestUrl?.origin).toBe("https://geocoding-api.open-meteo.com");
	expect(requestUrl?.searchParams.get("name")).toBe("Saquarema, Brasil");
	expect(requestUrl?.searchParams.get("count")).toBe("5");
	expect(requestUrl?.searchParams.get("language")).toBe("pt");
	expect(requestInit?.credentials).toBe("omit");
	expect(requestInit?.referrerPolicy).toBe("no-referrer");
	expect(locations).toHaveLength(1);
	const firstLocation = locations[0];
	expect(firstLocation).toBeDefined();
	if (!firstLocation) throw new Error("Expected one geocoding result.");
	expect(formatWeatherPlace(firstLocation)).toBe(
		"Saquarema, Rio de Janeiro, Brasil",
	);
});

test("weather search skips short queries and formats duplicate place parts once", async () => {
	const fetcher: typeof fetch = async () => {
		throw new Error("A short query should not make a request.");
	};
	expect(await searchWeatherLocations("x", { fetcher })).toEqual([]);

	const location: WeatherLocation = {
		name: "Paris",
		admin1: "Paris",
		country: "France",
		latitude: 48.85,
		longitude: 2.35,
		timezone: "Europe/Paris",
	};
	expect(formatWeatherPlace(location)).toBe("Paris, France");
});

test("current weather requests Celsius and maps a valid Open-Meteo response", async () => {
	let requestUrl: URL | null = null;
	const fetcher: typeof fetch = async (input) => {
		requestUrl = new URL(input.toString());
		return jsonResponse({
			current: { temperature_2m: 25.6, weather_code: 0, is_day: 1 },
		});
	};

	expect(await fetchCurrentWeather(-22.92, -42.51, { fetcher })).toEqual({
		temperatureC: 25.6,
		weatherCode: 0,
		isDay: true,
	});
	expect(requestUrl?.origin).toBe("https://api.open-meteo.com");
	expect(requestUrl?.searchParams.get("current")).toBe(
		"temperature_2m,weather_code,is_day",
	);
	expect(requestUrl?.searchParams.get("temperature_unit")).toBe("celsius");
	expect(requestUrl?.searchParams.get("timezone")).toBe("auto");
});

test("rejects invalid coordinates, HTTP errors and incomplete forecast data", async () => {
	await expect(fetchCurrentWeather(91, 0)).rejects.toThrow("valid city");
	await expect(
		fetchCurrentWeather(0, 0, { fetcher: async () => jsonResponse({}, 503) }),
	).rejects.toThrow("503");
	await expect(
		fetchCurrentWeather(0, 0, {
			fetcher: async () =>
				jsonResponse({ current: { temperature_2m: "warm" } }),
		}),
	).rejects.toThrow("incomplete");
});

test("maps WMO codes to localized conditions and only animatable weather", () => {
	expect(describeWeatherCondition(0, true, "pt-BR")).toEqual({
		label: "Ensolarado",
		icon: "clear-day",
		atmosphere: null,
	});
	expect(describeWeatherCondition(0, false, "en-US").icon).toBe("clear-night");
	expect(describeWeatherCondition(45, true, "en").atmosphere).toBe("mist");
	expect(describeWeatherCondition(73, true, "en").atmosphere).toBe("snow");
	expect(describeWeatherCondition(65, true, "en").atmosphere).toBe("rain");
	expect(describeWeatherCondition(3, true, "en").atmosphere).toBeNull();
});

test("validates city cache keys and the 30-minute freshness window", () => {
	expect(weatherLocationKey(-22.92, -42.51)).toBe("-22.920,-42.510");
	expect(weatherLocationKey(91, 0)).toBeNull();
	expect(isWeatherCacheFresh(10_000, 10_000 + WEATHER_CACHE_TTL_MS - 1)).toBe(
		true,
	);
	expect(isWeatherCacheFresh(10_000, 10_000 + WEATHER_CACHE_TTL_MS)).toBe(
		false,
	);
	expect(isWeatherCacheFresh(10_000, 9_999)).toBe(false);
});

test("schedules refreshes during idle time and cancels the queued callback", () => {
	let queued: (() => void) | null = null;
	let cancelledId = -1;
	let receivedTimeout = 0;
	const scheduler: WeatherIdleScheduler = {
		setTimeout: () => 0,
		clearTimeout: () => undefined,
		requestIdleCallback: (callback, options) => {
			queued = callback;
			receivedTimeout = options?.timeout ?? 0;
			return 17;
		},
		cancelIdleCallback: (id) => {
			cancelledId = id;
		},
	};

	let calls = 0;
	const cancel = scheduleWeatherIdleTask(() => calls++, scheduler);
	expect(receivedTimeout).toBe(4_000);
	queued?.();
	expect(calls).toBe(1);
	cancel();
	expect(cancelledId).toBe(17);
});

test("uses a cancellable timer when requestIdleCallback is unavailable", () => {
	let queued: (() => void) | null = null;
	let receivedDelay = -1;
	let clearedId = -1;
	const scheduler: WeatherIdleScheduler = {
		setTimeout: (callback, delay) => {
			queued = callback;
			receivedDelay = delay;
			return 23;
		},
		clearTimeout: (id) => {
			clearedId = id;
		},
	};

	let calls = 0;
	const cancel = scheduleWeatherIdleTask(() => calls++, scheduler);
	expect(receivedDelay).toBe(0);
	queued?.();
	expect(calls).toBe(1);
	cancel();
	expect(clearedId).toBe(23);
});
