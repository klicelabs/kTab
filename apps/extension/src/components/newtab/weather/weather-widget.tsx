import { Icon } from "@ktab/ui/icons/icon";
import { useEffect, useState } from "react";
import {
	describeWeatherCondition,
	weatherLocationKey,
} from "../../../lib/weather-conditions";
import {
	nextSunEvent,
	shortWeatherCity,
	upcomingWeatherHours,
	weatherAtmosphere,
} from "../../../lib/weather-display";
import { resolveWeatherLocation } from "../../../lib/weather-location";
import { subscribeWidgetAction } from "../../../lib/widget-actions";
import { useSetupStore } from "../../../stores/setup-store";
import { useWeatherRuntimeStore } from "../../../stores/weather-runtime-store";
import type { WeatherReading, WeatherSettings } from "../../../types";
import { WidgetSurface } from "../widgets/widget-surface";
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

function formatTemperature(value: number | null | undefined, locale: string) {
	return typeof value === "number"
		? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
		: "–";
}

export function WeatherWidget() {
	const weather = useSetupStore((state) => state.settings.weather);
	useEffect(() => {
		if (!weather.enabled) return;
		return subscribeWidgetAction("weather", "refresh", () =>
			useWeatherRuntimeStore.getState().requestRefresh(),
		);
	}, [weather.enabled]);
	const location = resolveWeatherLocation(weather);
	const locationKey = weatherLocationKey(location.latitude, location.longitude);
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
	const canAnimate = useWeatherMotionAllowed();
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), 60_000);
		return () => window.clearInterval(timer);
	}, []);
	const locale = weatherLocale();
	const condition = reading
		? describeWeatherCondition(reading.weatherCode, reading.isDay, locale)
		: null;
	if (
		!weather.enabled ||
		(weather.display !== "compact" &&
			weather.display !== "expanded" &&
			weather.display !== "widget")
	) {
		return null;
	}
	const location = resolveWeatherLocation(weather);

	const expanded =
		weather.display === "expanded" || weather.display === "widget";
	const atmosphere = reading
		? weatherAtmosphere(reading, now)
		: { time: "day" as const, condition: "clear" as const };
	const hours = reading ? upcomingWeatherHours(reading, 5, now) : [];
	const sun = reading ? nextSunEvent(reading, now) : null;
	const forecast = [
		...hours.map((hour) => ({
			key: hour.time,
			label: hour.time.slice(11, 13) || "Now",
			icon: describeWeatherCondition(hour.weatherCode, hour.isDay, locale).icon,
			temperature: hour.temperatureC,
		})),
		...(sun
			? [
					{
						key: `sun-${sun.label}`,
						label: sun.time,
						icon: "clear-day" as const,
						temperature: sun.temperatureC,
					},
				]
			: []),
	];
	while (forecast.length < 6) {
		forecast.push({
			key: `forecast-${forecast.length}`,
			label: "–",
			icon: "clear-day",
			temperature: null,
		});
	}
	const secondaryInk = "dashboard-widget-muted";
	const showPause =
		weather.dynamicAtmosphere && condition?.atmosphere && canAnimate;

	return (
		<WidgetSurface
			name="weather"
			size={expanded ? "expanded" : "compact"}
			appearance={weather.appearance ?? "flat"}
			data-time={atmosphere.time}
			data-condition={atmosphere.condition}
			className="relative p-3"
		>
			{expanded ? (
				<div className="relative z-10 grid h-full min-h-0 grid-rows-[1fr_auto] gap-1">
					<div className="flex min-h-0 items-start justify-between gap-2 pt-0.5">
						<div className="flex min-w-0 flex-col">
							<p className="max-w-[185px] truncate font-semibold text-[13px] leading-[1.1]">
								{shortWeatherCity(location.place)}
							</p>
							<p className="mt-1 font-light text-[38px] leading-[0.92] tracking-[-0.045em]">
								{reading
									? `${formatTemperature(reading.temperatureC, locale)}°`
									: "–°"}
							</p>
						</div>
						<div className="flex min-w-0 max-w-[148px] flex-col items-end pt-1 text-end">
							{condition ? (
								<WeatherIcon icon={condition.icon} size={25} />
							) : (
								<Icon name="sun-moon" size={23} aria-hidden="true" />
							)}
							<div className="mt-0.5 flex max-w-full items-center justify-end gap-1">
								<p
									className="truncate text-[12px] leading-[1.15]"
									title={error ?? undefined}
								>
									{condition?.label ??
										(error ? "Forecast unavailable" : "Loading forecast…")}
								</p>
								{error ? <WeatherRefreshButton insideSurface /> : null}
							</div>
							<p
								className={`mt-1 whitespace-nowrap text-[11px] leading-none ${secondaryInk}`}
							>
								H:{formatTemperature(reading?.highC, locale)}° L:
								{formatTemperature(reading?.lowC, locale)}°
							</p>
						</div>
					</div>
					<div className="grid grid-cols-6 items-end gap-1.5 border-white/15 border-t pt-2">
						{forecast.map((hour) => (
							<div
								key={hour.key}
								className="flex min-w-0 flex-col items-center gap-1.5"
							>
								<span
									className="dashboard-widget-muted max-w-full truncate text-[10px] leading-none"
									title={hour.label}
								>
									{hour.label}
								</span>
								<WeatherIcon icon={hour.icon} size={19} />
								<span className="font-medium text-[11px] leading-none">
									{formatTemperature(hour.temperature, locale)}°
								</span>
							</div>
						))}
					</div>
				</div>
			) : (
				<div className="relative z-10 h-full min-h-0">
					<div className="absolute top-0 right-0 grid size-[58px] place-items-center">
						{condition ? (
							<WeatherIcon icon={condition.icon} size={58} />
						) : (
							<Icon name="sun-moon" size={52} aria-hidden="true" />
						)}
					</div>
					<div className="absolute right-0 bottom-0 left-0 flex max-w-[136px] flex-col items-start gap-1">
						<p className="font-semibold text-[43px] leading-[0.9] tracking-[-0.035em]">
							{reading
								? `${formatTemperature(reading.temperatureC, locale)}°`
								: "–°"}
						</p>
						<p
							className="line-clamp-2 text-[13px] leading-[1.15]"
							title={error ?? condition?.label ?? undefined}
						>
							{condition?.label ??
								(error ? "Unavailable" : "Loading forecast…")}
						</p>
						<div className="flex min-w-0 max-w-full items-center gap-1 text-[11px] leading-none">
							<Icon name="map-pin" size={14} aria-hidden="true" />
							<span className="truncate">
								{shortWeatherCity(location.place)}
							</span>
						</div>
					</div>
					{error || showPause ? (
						<div className="absolute top-0 left-0 flex items-center gap-1">
							{error ? <WeatherRefreshButton insideSurface /> : null}
							{showPause ? <WeatherPauseButton insideSurface /> : null}
						</div>
					) : null}
				</div>
			)}
			<span className="sr-only" role="status">
				{status === "loading"
					? "Loading weather forecast."
					: status === "refreshing"
						? "Refreshing weather."
						: status === "error"
							? (error ?? "Weather forecast unavailable.")
							: ""}
			</span>
		</WidgetSurface>
	);
}
