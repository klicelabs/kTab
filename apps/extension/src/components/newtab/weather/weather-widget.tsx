import { Icon } from "@ktab/ui/icons/icon";
import { glassForeground } from "../../../lib/glass";
import {
	describeWeatherCondition,
	weatherLocationKey,
} from "../../../lib/weather-conditions";
import { useSetupStore } from "../../../stores/setup-store";
import { useWeatherRuntimeStore } from "../../../stores/weather-runtime-store";
import type { WeatherReading, WeatherSettings } from "../../../types";
import { useAppearance } from "../appearance-provider";
import { GlassSurface } from "../toolbar/glass-surface";
import {
	useWeatherMotionAllowed,
	WeatherPauseButton,
	WeatherRefreshButton,
} from "./weather-actions";
import { WeatherIcon } from "./weather-icon";

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

export function WeatherWidget() {
	const weather = useSetupStore((state) => state.settings.weather);
	const locationKey = weatherLocationKey(weather.latitude, weather.longitude);
	const reading = useWeatherRuntimeStore((state) =>
		state.locationKey === locationKey ? state.reading : null,
	);
	const status = useWeatherRuntimeStore((state) =>
		state.locationKey === locationKey ? state.status : "loading",
	);
	const error = useWeatherRuntimeStore((state) =>
		state.locationKey === locationKey ? state.error : null,
	);
	return (
		<WeatherWidgetView
			weather={weather}
			reading={reading}
			status={status}
			error={error}
		/>
	);
}

export function WeatherWidgetView({
	weather,
	reading,
	status,
	error,
}: {
	weather: WeatherSettings;
	reading: WeatherReading | null;
	status: "idle" | "loading" | "ready" | "refreshing" | "error";
	error: string | null;
}) {
	const { isLiquid } = useAppearance();
	const canAnimate = useWeatherMotionAllowed();
	const locale = weatherLocale();
	const condition = reading
		? describeWeatherCondition(reading.weatherCode, reading.isDay, locale)
		: null;

	if (!weather.enabled || weather.display !== "widget" || !weather.place) {
		return null;
	}

	const secondaryInk = isLiquid
		? glassForeground("secondary")
		: "text-muted-foreground";
	const showPause =
		weather.dynamicAtmosphere && condition?.atmosphere && canAnimate;

	return (
		<GlassSurface
			variant="surface"
			shape="section"
			className="inline-flex min-w-[13rem] max-w-full gap-3 px-4 py-3"
		>
			{condition ? (
				<WeatherIcon icon={condition.icon} size={52} />
			) : (
				<Icon name="sun-moon" size={38} strokeWidth={1.5} aria-hidden="true" />
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex min-w-0 items-baseline justify-between gap-3">
					<p
						className="min-w-0 flex-1 break-words font-medium text-[13px] leading-[1.35]"
						title={weather.place}
					>
						{weather.place}
					</p>
					{reading ? (
						<p className="shrink-0 whitespace-nowrap font-medium text-2xl tabular-nums leading-none">
							{formatTemperature(reading.temperatureC, locale)}°C
						</p>
					) : null}
				</div>
				<div className="flex min-w-0 items-center justify-between gap-2">
					<p className={`min-w-0 text-[12px] leading-[1.4] ${secondaryInk}`}>
						{condition?.label ??
							(error ? "Weather unavailable" : "Loading forecast…")}
					</p>
					<a
						href="https://open-meteo.com/"
						target="_blank"
						rel="noopener noreferrer"
						className={`shrink-0 text-[11px] leading-[1.4] underline decoration-from-font underline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--ktab-accent)] focus-visible:outline-offset-2 ${secondaryInk}`}
					>
						Open-Meteo
					</a>
				</div>
			</div>
			{error || showPause ? (
				<div className="flex shrink-0 flex-col items-center">
					{error ? <WeatherRefreshButton insideSurface /> : null}
					{showPause ? <WeatherPauseButton insideSurface /> : null}
				</div>
			) : null}
			<span className="sr-only" role="status">
				{status === "refreshing" ? "Refreshing weather." : ""}
			</span>
		</GlassSurface>
	);
}
