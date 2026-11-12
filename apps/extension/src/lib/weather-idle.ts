export interface WeatherIdleScheduler {
	setTimeout: (callback: () => void, delay: number) => number;
	clearTimeout: (id: number) => void;
	requestIdleCallback?: (
		callback: () => void,
		options?: IdleRequestOptions,
	) => number;
	cancelIdleCallback?: (id: number) => void;
}

/** Run weather refresh work during idle time, with a timer fallback. */
export function scheduleWeatherIdleTask(
	callback: () => void,
	scheduler: WeatherIdleScheduler = window,
): () => void {
	if (typeof scheduler.requestIdleCallback === "function") {
		const idleId = scheduler.requestIdleCallback(callback, { timeout: 4_000 });
		return () => scheduler.cancelIdleCallback?.(idleId);
	}

	const timeoutId = scheduler.setTimeout(callback, 0);
	return () => scheduler.clearTimeout(timeoutId);
}
