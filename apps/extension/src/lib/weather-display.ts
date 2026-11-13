import type { WeatherHour, WeatherReading } from "../types";

export type WeatherTimeTone = "night" | "dawn" | "day" | "sunset";
export type WeatherConditionTone =
	| "clear"
	| "clouds"
	| "fog"
	| "rain"
	| "snow"
	| "storm"
	| "wind";

export interface WeatherAtmosphere {
	time: WeatherTimeTone;
	condition: WeatherConditionTone;
}

function localParts(
	date: Date,
	timezone?: string | null,
): Record<string, string> {
	const formatter = new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		...(timezone ? { timeZone: timezone } : {}),
	});
	return Object.fromEntries(
		formatter.formatToParts(date).map(({ type, value }) => [type, value]),
	);
}

function localMinutes(date: Date, timezone?: string | null): number {
	const parts = localParts(date, timezone);
	return Number(parts.hour) * 60 + Number(parts.minute);
}

function clockMinutes(value: string | null | undefined): number | null {
	if (!value) return null;
	const match = value.match(/(?:T|^)(\d{2}):(\d{2})/);
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function clockDistance(first: number, second: number): number {
	const distance = Math.abs(first - second);
	return Math.min(distance, 1440 - distance);
}

export function weatherAtmosphere(
	reading: WeatherReading,
	now = new Date(),
): WeatherAtmosphere {
	const current = localMinutes(now, reading.timezone);
	const sunrise = clockMinutes(reading.sunrise);
	const sunset = clockMinutes(reading.sunset);
	const time: WeatherTimeTone =
		sunrise !== null && clockDistance(current, sunrise) <= 70
			? "dawn"
			: sunset !== null && clockDistance(current, sunset) <= 80
				? "sunset"
				: reading.isDay
					? "day"
					: "night";
	const code = reading.weatherCode;
	const condition: WeatherConditionTone =
		code >= 95
			? "storm"
			: code >= 71 && code <= 86
				? "snow"
				: code >= 51 && code <= 82
					? "rain"
					: code === 45 || code === 48
						? "fog"
						: (reading.windSpeedKmh ?? 0) >= 35
							? "wind"
							: code >= 1 && code <= 3
								? "clouds"
								: "clear";
	return { time, condition };
}

function timeKey(date: Date, timezone?: string | null): string {
	const parts = localParts(date, timezone);
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
}

export function upcomingWeatherHours(
	reading: WeatherReading,
	count = 5,
	now = new Date(),
): WeatherHour[] {
	const hourly = reading.hourly ?? [];
	if (hourly.length === 0) return [];
	const nextHour = timeKey(
		new Date(now.getTime() + 60 * 60 * 1000),
		reading.timezone,
	);
	const future = hourly.filter((hour) => hour.time >= nextHour);
	return (future.length > 0 ? future : hourly).slice(0, count);
}

export function nextSunEvent(
	reading: WeatherReading,
	now = new Date(),
): { label: "Sunrise" | "Sunset"; time: string; temperatureC: number } | null {
	const sunriseMinutes = clockMinutes(reading.sunrise);
	const sunsetMinutes = clockMinutes(reading.sunset);
	if (sunriseMinutes === null && sunsetMinutes === null) return null;
	const current = localMinutes(now, reading.timezone);
	const sunriseIsNext =
		sunriseMinutes !== null &&
		(sunsetMinutes === null ||
			(current < sunriseMinutes && current < sunsetMinutes) ||
			current >= sunsetMinutes);
	const value = sunriseIsNext ? reading.sunrise : reading.sunset;
	if (!value) return null;
	const time = value.match(/(?:T|^)(\d{2}:\d{2})/)?.[1];
	if (!time) return null;
	const hourly = reading.hourly ?? [];
	const closest = hourly.reduce<WeatherHour | null>((best, hour) => {
		const minutes = clockMinutes(hour.time);
		if (minutes === null) return best;
		if (!best) return hour;
		const bestMinutes = clockMinutes(best.time) ?? 0;
		return clockDistance(
			minutes,
			sunriseIsNext ? (sunriseMinutes ?? 0) : (sunsetMinutes ?? 0),
		) <
			clockDistance(
				bestMinutes,
				sunriseIsNext ? (sunriseMinutes ?? 0) : (sunsetMinutes ?? 0),
			)
			? hour
			: best;
	}, null);
	return {
		label: sunriseIsNext ? "Sunrise" : "Sunset",
		time,
		temperatureC: closest?.temperatureC ?? reading.temperatureC,
	};
}

export function shortWeatherCity(place: string): string {
	return place.split(",")[0]?.trim() || place.trim();
}
