export type WeatherIconName =
	| "clear-day"
	| "clear-night"
	| "partly-cloudy-day"
	| "partly-cloudy-night"
	| "overcast"
	| "drizzle"
	| "rain"
	| "snow"
	| "fog"
	| "thunderstorms";

export type WeatherAtmosphereKind = "rain" | "snow" | "mist";

export interface WeatherCondition {
	label: string;
	icon: WeatherIconName;
	atmosphere: WeatherAtmosphereKind | null;
}

function labelFor(code: number, isDay: boolean, portuguese: boolean): string {
	if (code === 0)
		return portuguese
			? isDay
				? "Ensolarado"
				: "Céu limpo"
			: isDay
				? "Sunny"
				: "Clear";
	if (code === 1)
		return portuguese ? "Predominantemente limpo" : "Mostly clear";
	if (code === 2) return portuguese ? "Parcialmente nublado" : "Partly cloudy";
	if (code === 3) return portuguese ? "Nublado" : "Overcast";
	if (code === 45 || code === 48) return portuguese ? "Neblina" : "Fog";
	if (code === 51 || code === 56)
		return portuguese ? "Garoa fraca" : "Light drizzle";
	if (code === 53) return portuguese ? "Garoa moderada" : "Drizzle";
	if (code === 55 || code === 57)
		return portuguese ? "Garoa intensa" : "Dense drizzle";
	if (code === 61 || code === 66)
		return portuguese ? "Chuva fraca" : "Light rain";
	if (code === 63) return portuguese ? "Chuva moderada" : "Rain";
	if (code === 65 || code === 67)
		return portuguese ? "Chuva intensa" : "Heavy rain";
	if (code === 71) return portuguese ? "Neve fraca" : "Light snow";
	if (code === 73 || code === 77) return portuguese ? "Neve" : "Snow";
	if (code === 75) return portuguese ? "Neve intensa" : "Heavy snow";
	if (code === 80) return portuguese ? "Pancadas fracas" : "Light showers";
	if (code === 81) return portuguese ? "Pancadas de chuva" : "Rain showers";
	if (code === 82) return portuguese ? "Pancadas fortes" : "Heavy showers";
	if (code === 85 || code === 86)
		return portuguese ? "Pancadas de neve" : "Snow showers";
	if (code === 95) return portuguese ? "Trovoadas" : "Thunderstorms";
	if (code === 96 || code === 99)
		return portuguese ? "Trovoadas com granizo" : "Thunderstorms with hail";
	return portuguese ? "Condição atual" : "Current conditions";
}

export function describeWeatherCondition(
	code: number,
	isDay: boolean,
	locale: string,
): WeatherCondition {
	const portuguese = locale.toLowerCase().startsWith("pt");
	let icon: WeatherIconName;
	let atmosphere: WeatherAtmosphereKind | null = null;

	if (code === 0) icon = isDay ? "clear-day" : "clear-night";
	else if (code === 1 || code === 2) {
		icon = isDay ? "partly-cloudy-day" : "partly-cloudy-night";
	} else if (code === 3) icon = "overcast";
	else if (code === 45 || code === 48) {
		icon = "fog";
		atmosphere = "mist";
	} else if ([51, 53, 55, 56, 57].includes(code)) {
		icon = "drizzle";
		atmosphere = "rain";
	} else if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
		icon = "rain";
		atmosphere = "rain";
	} else if ([71, 73, 75, 77, 85, 86].includes(code)) {
		icon = "snow";
		atmosphere = "snow";
	} else if ([95, 96, 99].includes(code)) {
		icon = "thunderstorms";
		atmosphere = "rain";
	} else {
		icon = "overcast";
	}

	return { label: labelFor(code, isDay, portuguese), icon, atmosphere };
}

export function weatherLocationKey(
	latitude: number | null,
	longitude: number | null,
): string | null {
	if (
		typeof latitude !== "number" ||
		!Number.isFinite(latitude) ||
		latitude < -90 ||
		latitude > 90 ||
		typeof longitude !== "number" ||
		!Number.isFinite(longitude) ||
		longitude < -180 ||
		longitude > 180
	) {
		return null;
	}
	return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

export const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

export function isWeatherCacheFresh(
	fetchedAt: number,
	now = Date.now(),
): boolean {
	const age = now - fetchedAt;
	return Number.isFinite(fetchedAt) && age >= 0 && age < WEATHER_CACHE_TTL_MS;
}
