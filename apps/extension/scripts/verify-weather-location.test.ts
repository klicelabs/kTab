import { expect, test } from "bun:test";
import {
	FALLBACK_WEATHER_LOCATION,
	requestCurrentWeatherLocation,
	resolveWeatherLocation,
} from "../src/lib/weather-location";

test("resolves an empty weather location to the default city", () => {
	expect(
		resolveWeatherLocation({ place: "", latitude: null, longitude: null }),
	).toEqual(FALLBACK_WEATHER_LOCATION);
});

test("uses device coordinates after an explicit geolocation success", async () => {
	const geolocation = {
		getCurrentPosition(success: PositionCallback) {
			success({
				coords: { latitude: 37.32, longitude: -122.03 },
			} as GeolocationPosition);
		},
	} as Pick<Geolocation, "getCurrentPosition">;

	expect(await requestCurrentWeatherLocation(geolocation, 20)).toEqual({
		place: "Current location",
		latitude: 37.32,
		longitude: -122.03,
		source: "device",
	});
});

test("falls back to São Paulo when location permission is denied", async () => {
	const geolocation = {
		getCurrentPosition(
			_success: PositionCallback,
			error: PositionErrorCallback,
		) {
			error({ code: 1 } as GeolocationPositionError);
		},
	} as Pick<Geolocation, "getCurrentPosition">;

	expect(await requestCurrentWeatherLocation(geolocation, 20)).toMatchObject({
		...FALLBACK_WEATHER_LOCATION,
		source: "fallback",
		reason: "denied",
	});
});

test("falls back to São Paulo when device location takes too long", async () => {
	const geolocation = {
		getCurrentPosition() {
			// Simulate a browser prompt that never resolves.
		},
	} as Pick<Geolocation, "getCurrentPosition">;

	expect(await requestCurrentWeatherLocation(geolocation, 5)).toMatchObject({
		...FALLBACK_WEATHER_LOCATION,
		source: "fallback",
		reason: "timeout",
	});
});
