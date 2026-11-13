import { Icon } from "@ktab/ui/icons/icon";
import {
	describeWeatherCondition,
	weatherLocationKey,
} from "../../../lib/weather-conditions";
import { shortWeatherCity } from "../../../lib/weather-display";
import { useSetupStore } from "../../../stores/setup-store";
import { useWeatherRuntimeStore } from "../../../stores/weather-runtime-store";
import type { WeatherReading, WeatherSettings } from "../../../types";
import { GlassSurface } from "../toolbar/glass-surface";
import { WeatherIcon } from "./weather-icon";

export function WeatherToolbar() {
	const weather = useSetupStore((state) => state.settings.weather);
	const locationKey = weatherLocationKey(weather.latitude, weather.longitude);
	const reading = useWeatherRuntimeStore((state) =>
		state.locationKey === locationKey ? state.reading : null,
	);
	const status = useWeatherRuntimeStore((state) =>
		state.locationKey === locationKey ? state.status : "loading",
	);
	return (
		<WeatherToolbarView weather={weather} reading={reading} status={status} />
	);
}

export function WeatherToolbarView({
	weather,
	reading,
	status,
}: {
	weather: WeatherSettings;
	reading: WeatherReading | null;
	status: string;
}) {
	const locale =
		typeof navigator !== "undefined" && navigator.language
			? navigator.language
			: "en";
	const condition = reading
		? describeWeatherCondition(reading.weatherCode, reading.isDay, locale)
		: null;
	if (!weather.enabled || weather.display !== "toolbar" || !weather.place) {
		return null;
	}

	const city = shortWeatherCity(weather.place);
	const temperature = reading
		? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
				reading.temperatureC,
			)
		: null;
	return (
		<div
			className="group/weather-toolbar relative isolate inline-flex max-w-[min(38vw,13rem)] items-center justify-center px-1.5 py-1 text-[11px] text-white/90"
			title={`${city}${temperature ? ` ${temperature}°` : ""}${condition ? ` · ${condition.label}` : ""}`}
		>
			<GlassSurface
				aria-hidden="true"
				variant="toolbar"
				shape="section"
				shadowless
				className="pointer-events-none absolute inset-[-4px] z-0 opacity-0 transition-opacity duration-150 group-focus-within/weather-toolbar:opacity-100 group-hover/weather-toolbar:opacity-100"
			/>
			<span className="relative z-10 inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap">
				{condition ? (
					<WeatherIcon icon={condition.icon} size={15} />
				) : (
					<Icon
						name="sun-moon"
						size={15}
						strokeWidth={1.6}
						aria-hidden="true"
					/>
				)}
				<span className="truncate">{city}</span>
				{temperature ? (
					<span className="shrink-0 tabular-nums">{temperature}°</span>
				) : null}
			</span>
			<span className="sr-only" role="status">
				{status === "error" ? "Weather unavailable." : ""}
			</span>
		</div>
	);
}
