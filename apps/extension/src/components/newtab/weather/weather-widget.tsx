import { Icon } from "@ktab/ui/icons/icon";
import { useEffect, useState } from "react";
import { glassForeground } from "../../../lib/glass";
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
import { useSetupStore } from "../../../stores/setup-store";
import { useWeatherRuntimeStore } from "../../../stores/weather-runtime-store";
import type { WeatherReading, WeatherSettings } from "../../../types";
import { useAppearance } from "../appearance-provider";
import {
	useWeatherMotionAllowed,
	WeatherPauseButton,
	WeatherRefreshButton,
} from "./weather-actions";
import { WeatherIcon } from "./weather-icon";
import { WidgetSurface } from "../widgets/widget-surface";

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

function ClockOverlay({ tone }: { tone: string }) {
	const overlays: Record<string, string> = {
		dawn: "bg-[radial-gradient(ellipse_at_90%_0%,rgba(255,210,158,.22),transparent_56%)]",
		day: "bg-[radial-gradient(ellipse_at_92%_4%,rgba(213,241,255,.15),transparent_58%)]",
		sunset:
			"bg-[radial-gradient(ellipse_at_90%_4%,rgba(255,184,135,.22),transparent_58%)]",
		night:
			"bg-[radial-gradient(ellipse_at_88%_2%,rgba(147,176,242,.13),transparent_55%)]",
	};
	return (
		<div
			aria-hidden="true"
			className={`pointer-events-none absolute inset-0 z-0 rounded-[inherit] ${overlays[tone] ?? overlays.day}`}
		/>
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
			weather.display !== "widget") ||
		!weather.place
	) {
		return null;
	}

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
	const secondaryInk = isLiquid
		? glassForeground("secondary")
		: "text-white/65";
	const showPause =
		weather.dynamicAtmosphere && condition?.atmosphere && canAnimate;

	return (
		<WidgetSurface
			name="weather"
			size={expanded ? "wide" : "square"}
			appearance={weather.appearance ?? "flat"}
			data-time={atmosphere.time}
			data-condition={atmosphere.condition}
			className="relative p-3"
		>
			{weather.appearance === "glass" ? (
				<ClockOverlay tone={atmosphere.time} />
			) : null}
			{expanded ? (
				<div className="relative z-10 grid h-full min-h-0 grid-rows-[1fr_auto] gap-1">
					<div className="flex min-h-0 items-start justify-between gap-2 pt-0.5">
						<div className="flex min-w-0 flex-col">
							<p className="max-w-[185px] truncate font-semibold text-[13px] leading-[1.1]">
								{shortWeatherCity(weather.place)}
							</p>
							<p className="mt-1 font-light text-[38px] leading-[0.92] tracking-[-0.045em]">
								{reading
									? `${formatTemperature(reading.temperatureC, locale)}°`
									: "–°"}
							</p>
						</div>
						<div className="flex min-w-0 max-w-[128px] flex-col items-end pt-1 text-end">
							{condition ? (
								<WeatherIcon icon={condition.icon} size={22} />
							) : (
								<Icon name="sun-moon" size={20} aria-hidden="true" />
							)}
							<p className="mt-0.5 max-w-full truncate text-[10px] leading-[1.1]">
								{condition?.label ??
									(error ? "Forecast unavailable" : "Loading forecast…")}
							</p>
							<p
								className={`mt-1 whitespace-nowrap text-[9px] leading-none ${secondaryInk}`}
							>
								H:{formatTemperature(reading?.highC, locale)}° L:
								{formatTemperature(reading?.lowC, locale)}°
							</p>
						</div>
					</div>
					<div className="grid grid-cols-6 items-end gap-1 border-white/15 border-t pt-2">
						{forecast.map((hour) => (
							<div
								key={hour.key}
								className="flex min-w-0 flex-col items-center gap-1"
							>
								<span
									className="max-w-full truncate text-[8px] text-white/70 leading-none"
									title={hour.label}
								>
									{hour.label}
								</span>
								<WeatherIcon icon={hour.icon} size={15} />
								<span className="font-medium text-[9px] leading-none">
									{formatTemperature(hour.temperature, locale)}°
								</span>
							</div>
						))}
					</div>
				</div>
			) : (
				<div className="relative z-10 flex h-full min-h-0 flex-col justify-between pt-0.5">
					<div className="flex min-w-0 flex-col">
						<p className="truncate font-semibold text-[13px] leading-[1.1]">
							{shortWeatherCity(weather.place)}
						</p>
						<p className="mt-1 font-light text-[43px] leading-[0.9] tracking-[-0.045em]">
							{reading
								? `${formatTemperature(reading.temperatureC, locale)}°`
								: "–°"}
						</p>
					</div>
					<div className="flex min-w-0 items-end justify-between gap-1">
						<div className="flex min-w-0 items-center gap-1.5">
							{condition ? (
								<WeatherIcon icon={condition.icon} size={20} />
							) : (
								<Icon name="sun-moon" size={18} aria-hidden="true" />
							)}
							<span className="truncate text-[10px] leading-none">
								{condition?.label ?? (error ? "Unavailable" : "Loading…")}
							</span>
						</div>
						<span
							className={`shrink-0 whitespace-nowrap text-[9px] leading-none ${secondaryInk}`}
						>
							H:{formatTemperature(reading?.highC, locale)}° L:
							{formatTemperature(reading?.lowC, locale)}°
						</span>
					</div>
					{error || showPause ? (
						<div className="absolute top-0 right-0 flex items-center gap-1">
							{error ? <WeatherRefreshButton insideSurface /> : null}
							{showPause ? <WeatherPauseButton insideSurface /> : null}
						</div>
					) : null}
				</div>
			)}
			<span className="sr-only" role="status">
				{status === "refreshing" ? "Refreshing weather." : ""}
			</span>
		</WidgetSurface>
	);
}
