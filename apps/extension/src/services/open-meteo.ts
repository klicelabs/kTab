import type { WeatherReading } from "../types";

export interface WeatherLocation {
	name: string;
	admin1: string | null;
	country: string | null;
	latitude: number;
	longitude: number;
	timezone: string | null;
}

export interface WeatherLocationQueryOptions {
	language?: string;
	signal?: AbortSignal;
	fetcher?: typeof fetch;
}

export interface WeatherRequestOptions {
	signal?: AbortSignal;
	fetcher?: typeof fetch;
}

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCoordinate(value: unknown, minimum: number, maximum: number) {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= minimum &&
		value <= maximum
	);
}

async function requestJson(
	url: URL,
	options: WeatherRequestOptions,
): Promise<unknown> {
	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, REQUEST_TIMEOUT_MS);
	const abortFromCaller = () => controller.abort();
	if (options.signal?.aborted) controller.abort();
	else
		options.signal?.addEventListener("abort", abortFromCaller, { once: true });

	try {
		const response = await (options.fetcher ?? fetch)(url, {
			cache: "no-store",
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: controller.signal,
		});
		if (!response.ok)
			throw new Error(`Weather request failed (${response.status}).`);
		return await response.json();
	} catch (error) {
		if (options.signal?.aborted) throw error;
		if (timedOut) {
			throw new Error(
				"Weather request timed out. Check your connection and try again.",
			);
		}
		throw error instanceof Error
			? error
			: new Error(
					"Weather request failed. Check your connection and try again.",
				);
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", abortFromCaller);
	}
}

function normalizeLocation(value: unknown): WeatherLocation | null {
	if (!isRecord(value)) return null;
	const latitude = value.latitude;
	const longitude = value.longitude;
	if (
		typeof value.name !== "string" ||
		!value.name.trim() ||
		typeof latitude !== "number" ||
		!validCoordinate(latitude, -90, 90) ||
		typeof longitude !== "number" ||
		!validCoordinate(longitude, -180, 180)
	) {
		return null;
	}
	return {
		name: value.name.trim().slice(0, 120),
		admin1: typeof value.admin1 === "string" ? value.admin1.trim() : null,
		country: typeof value.country === "string" ? value.country.trim() : null,
		latitude,
		longitude,
		timezone: typeof value.timezone === "string" ? value.timezone : null,
	};
}

export function formatWeatherPlace(location: WeatherLocation): string {
	const parts = [location.name, location.admin1, location.country]
		.filter((part): part is string => Boolean(part?.trim()))
		.map((part) => part.trim());
	return parts
		.filter(
			(part, index) =>
				parts.findIndex(
					(item) => item.toLocaleLowerCase() === part.toLocaleLowerCase(),
				) === index,
		)
		.join(", ")
		.slice(0, 160);
}

/** Search only after an explicit submit; device geolocation is never used. */
export async function searchWeatherLocations(
	query: string,
	options: WeatherLocationQueryOptions = {},
): Promise<WeatherLocation[]> {
	const name = query.trim().slice(0, 120);
	if (name.length < 2) return [];

	const url = new URL(GEOCODING_URL);
	url.searchParams.set("name", name);
	url.searchParams.set("count", "5");
	url.searchParams.set("format", "json");
	const language =
		options.language ??
		(typeof navigator !== "undefined" ? navigator.language : "en");
	url.searchParams.set("language", language.split("-")[0].toLowerCase());

	const payload = await requestJson(url, options);
	if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
	return payload.results
		.map(normalizeLocation)
		.filter((location): location is WeatherLocation => location !== null)
		.slice(0, 5);
}

/** Fetch the current conditions for the manually selected city. */
export async function fetchCurrentWeather(
	latitude: number,
	longitude: number,
	options: WeatherRequestOptions = {},
): Promise<WeatherReading> {
	if (
		!validCoordinate(latitude, -90, 90) ||
		!validCoordinate(longitude, -180, 180)
	) {
		throw new Error("Choose a valid city before loading weather.");
	}

	const url = new URL(FORECAST_URL);
	url.searchParams.set("latitude", String(latitude));
	url.searchParams.set("longitude", String(longitude));
	url.searchParams.set("current", "temperature_2m,weather_code,is_day");
	url.searchParams.set("temperature_unit", "celsius");
	url.searchParams.set("timezone", "auto");

	const payload = await requestJson(url, options);
	const current =
		isRecord(payload) && isRecord(payload.current) ? payload.current : null;
	const temperatureC = current?.temperature_2m;
	const weatherCode = current?.weather_code;
	const isDay = current?.is_day;
	if (
		!current ||
		typeof temperatureC !== "number" ||
		!Number.isFinite(temperatureC) ||
		typeof weatherCode !== "number" ||
		!Number.isInteger(weatherCode) ||
		typeof isDay !== "number" ||
		!Number.isInteger(isDay) ||
		(isDay !== 0 && isDay !== 1)
	) {
		throw new Error(
			"Weather data was incomplete. Try refreshing the forecast.",
		);
	}

	return {
		temperatureC,
		weatherCode,
		isDay: isDay === 1,
	};
}
