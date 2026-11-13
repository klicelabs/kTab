import { useEffect } from "react";
import { getWeatherCache, putWeatherCache } from "../../../lib/idb";
import {
	isWeatherCacheFresh,
	WEATHER_CACHE_TTL_MS,
	weatherLocationKey,
} from "../../../lib/weather-conditions";
import { scheduleWeatherIdleTask } from "../../../lib/weather-idle";
import { resolveWeatherLocation } from "../../../lib/weather-location";
import { fetchCurrentWeather } from "../../../services/open-meteo";
import { useSetupStore } from "../../../stores/setup-store";
import { useWeatherRuntimeStore } from "../../../stores/weather-runtime-store";

/** Runs one cache-first, idle-scheduled refresh loop for the selected city. */
export function WeatherRuntime() {
	const enabled = useSetupStore((state) => state.settings.weather.enabled);
	const weather = useSetupStore((state) => state.settings.weather);
	const { latitude, longitude, place } = resolveWeatherLocation(weather);
	const retryToken = useWeatherRuntimeStore((state) => state.retryToken);
	const key = weatherLocationKey(latitude, longitude);

	useEffect(() => {
		if (
			!enabled ||
			!key ||
			!place.trim() ||
			latitude === null ||
			longitude === null
		) {
			useWeatherRuntimeStore.setState({
				locationKey: null,
				reading: null,
				status: "idle",
				error: null,
			});
			return;
		}
		const selectedLatitude = latitude;
		const selectedLongitude = longitude;
		const locationKey = key;

		const controller = new AbortController();
		let disposed = false;
		let idleCancel: (() => void) | null = null;
		let refreshTimer: number | null = null;
		const previous = useWeatherRuntimeStore.getState();
		const previousReading =
			previous.locationKey === locationKey ? previous.reading : null;
		useWeatherRuntimeStore.setState({
			locationKey,
			reading: previousReading,
			status: previousReading ? "refreshing" : "loading",
			error: null,
		});

		function scheduleRefresh(delay: number, idle = true) {
			if (disposed) return;
			const queueIdle = () => {
				if (!idle) {
					void refresh();
					return;
				}
				idleCancel = scheduleWeatherIdleTask(() => {
					idleCancel = null;
					void refresh();
				});
			};
			if (delay <= 0) {
				queueIdle();
				return;
			}
			refreshTimer = window.setTimeout(queueIdle, delay);
		}

		async function refresh() {
			if (disposed) return;
			const currentState = useWeatherRuntimeStore.getState();
			const hasReading =
				currentState.locationKey === locationKey &&
				currentState.reading !== null;
			useWeatherRuntimeStore.setState({
				locationKey,
				status: hasReading ? "refreshing" : "loading",
				error: null,
			});

			try {
				const reading = await fetchCurrentWeather(
					selectedLatitude,
					selectedLongitude,
					{
						signal: controller.signal,
					},
				);
				if (disposed) return;
				const cached = { locationKey, fetchedAt: Date.now(), reading };
				useWeatherRuntimeStore.setState({
					locationKey,
					reading,
					status: "ready",
					error: null,
				});
				await putWeatherCache(cached).catch(() => undefined);
			} catch {
				if (disposed || controller.signal.aborted) return;
				useWeatherRuntimeStore.setState({
					locationKey,
					status: "error",
					error: "Unable to load weather. Check your connection and try again.",
				});
			}

			if (!disposed) scheduleRefresh(WEATHER_CACHE_TTL_MS);
		}

		async function start() {
			const cached = await getWeatherCache().catch(() => null);
			if (disposed) return;

			const matching = cached?.locationKey === locationKey ? cached : null;
			const fresh = matching ? isWeatherCacheFresh(matching.fetchedAt) : false;
			useWeatherRuntimeStore.setState({
				locationKey,
				reading: matching?.reading ?? previousReading,
				status: fresh ? "ready" : matching ? "refreshing" : "loading",
				error: null,
			});

			if (retryToken > 0 || !matching || !fresh) {
				// A cold start should show a forecast as soon as IndexedDB has been
				// checked. Idle scheduling is reserved for later background refreshes.
				scheduleRefresh(0, false);
			} else {
				const age = Date.now() - matching.fetchedAt;
				scheduleRefresh(Math.max(0, WEATHER_CACHE_TTL_MS - age));
			}
		}

		void start();

		return () => {
			disposed = true;
			controller.abort();
			idleCancel?.();
			if (refreshTimer !== null) window.clearTimeout(refreshTimer);
		};
	}, [enabled, key, latitude, longitude, place, retryToken]);

	return null;
}
