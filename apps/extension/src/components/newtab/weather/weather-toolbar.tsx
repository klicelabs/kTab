import {
	describeWeatherCondition,
	weatherLocationKey,
} from "../../../lib/weather-conditions";
import { useSetupStore } from "../../../stores/setup-store";
import { useWeatherRuntimeStore } from "../../../stores/weather-runtime-store";
import {
	useWeatherMotionAllowed,
	WeatherPauseButton,
	WeatherRefreshButton,
} from "./weather-actions";

function weatherLocale(): string {
	return typeof navigator !== "undefined" && navigator.language
		? navigator.language
		: "en";
}

function formatTemperature(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
		value,
	);
}

export function WeatherToolbar() {
	const weather = useSetupStore((state) => state.settings.weather);
	const locationKey = weatherLocationKey(weather.latitude, weather.longitude);
	const reading = useWeatherRuntimeStore((state) =>
		state.locationKey === locationKey ? state.reading : null,
	);
	const error = useWeatherRuntimeStore((state) =>
		state.locationKey === locationKey ? state.error : null,
	);
	const canAnimate = useWeatherMotionAllowed();
	const locale = weatherLocale();
	const condition = reading
		? describeWeatherCondition(reading.weatherCode, reading.isDay, locale)
		: null;

	if (!weather.enabled || weather.display !== "toolbar" || !weather.place) {
		return null;
	}

	const fullText = reading
		? `${weather.place} ${formatTemperature(reading.temperatureC, locale)}°C · ${condition?.label ?? "Current conditions"}`
		: error
			? "Weather unavailable"
			: `Loading weather for ${weather.place}`;
	const showPause =
		weather.dynamicAtmosphere && condition?.atmosphere && canAnimate;

	return (
		<div className="pointer-events-auto flex min-w-0 max-w-[min(38vw,18rem)] items-center gap-1.5 text-[11px] text-white/85 leading-[1.35]">
			<span className="min-w-0 flex-1 text-pretty" title={fullText}>
				{fullText}
			</span>
			<a
				href="https://open-meteo.com/"
				target="_blank"
				rel="noopener noreferrer"
				className="shrink-0 text-white/65 underline decoration-from-font underline-offset-2 focus-visible:outline-2 focus-visible:outline-current focus-visible:outline-offset-2"
			>
				Open-Meteo
			</a>
			{error ? <WeatherRefreshButton /> : null}
			{showPause ? <WeatherPauseButton /> : null}
		</div>
	);
}
