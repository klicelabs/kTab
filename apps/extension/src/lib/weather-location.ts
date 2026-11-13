import type { WeatherSettings } from "../types";

export const FALLBACK_WEATHER_LOCATION = {
	place: "São Paulo, Brazil",
	latitude: -23.5505,
	longitude: -46.6333,
} as const;

export interface ResolvedWeatherLocation {
	place: string;
	latitude: number;
	longitude: number;
}

export function resolveWeatherLocation(
	weather: Pick<WeatherSettings, "place" | "latitude" | "longitude">,
): ResolvedWeatherLocation {
	const place = weather.place.trim();
	const latitude = weather.latitude;
	const longitude = weather.longitude;
	if (
		place &&
		typeof latitude === "number" &&
		Number.isFinite(latitude) &&
		latitude >= -90 &&
		latitude <= 90 &&
		typeof longitude === "number" &&
		Number.isFinite(longitude) &&
		longitude >= -180 &&
		longitude <= 180
	) {
		return { place, latitude, longitude };
	}
	return FALLBACK_WEATHER_LOCATION;
}

export type CurrentWeatherLocationResult =
	| (ResolvedWeatherLocation & { source: "device" })
	| (typeof FALLBACK_WEATHER_LOCATION & {
			source: "fallback";
			reason: "denied" | "timeout" | "unavailable";
	  });

/** Call only after a direct user action; denied and slow requests recover to São Paulo. */
export function requestCurrentWeatherLocation(
	geolocation:
		| Pick<Geolocation, "getCurrentPosition">
		| undefined = typeof navigator !== "undefined"
		? navigator.geolocation
		: undefined,
	timeoutMs = 5_000,
): Promise<CurrentWeatherLocationResult> {
	if (!geolocation) {
		return Promise.resolve({
			...FALLBACK_WEATHER_LOCATION,
			source: "fallback",
			reason: "unavailable",
		});
	}

	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: CurrentWeatherLocationResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const timer = setTimeout(
			() =>
				finish({
					...FALLBACK_WEATHER_LOCATION,
					source: "fallback",
					reason: "timeout",
				}),
			timeoutMs,
		);
		try {
			geolocation.getCurrentPosition(
				(position) =>
					finish({
						place: "Current location",
						latitude: position.coords.latitude,
						longitude: position.coords.longitude,
						source: "device",
					}),
				(error) =>
					finish({
						...FALLBACK_WEATHER_LOCATION,
						source: "fallback",
						reason:
							error.code === 1
								? "denied"
								: error.code === 3
									? "timeout"
									: "unavailable",
					}),
				{
					enableHighAccuracy: false,
					maximumAge: 15 * 60 * 1_000,
					timeout: timeoutMs,
				},
			);
		} catch {
			finish({
				...FALLBACK_WEATHER_LOCATION,
				source: "fallback",
				reason: "unavailable",
			});
		}
	});
}
