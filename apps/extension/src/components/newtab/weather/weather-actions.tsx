import { useReducedMotion } from "motion/react";
import { useSetupStore } from "../../../stores/setup-store";
import { useWeatherRuntimeStore } from "../../../stores/weather-runtime-store";
import { ToolbarIconButton } from "../toolbar/toolbar-icon-button";

export function useWeatherMotionAllowed() {
	return useReducedMotion() === false;
}

export function WeatherPauseButton({
	insideSurface = false,
}: {
	insideSurface?: boolean;
}) {
	const paused = useWeatherRuntimeStore((state) => state.atmospherePaused);
	const togglePaused = useWeatherRuntimeStore(
		(state) => state.toggleAtmospherePaused,
	);
	return (
		<ToolbarIconButton
			icon={paused ? "play" : "pause"}
			label={paused ? "Resume weather effects" : "Pause weather effects"}
			onClick={togglePaused}
			active={paused}
			insideSurface={insideSurface}
		/>
	);
}

export function WeatherRefreshButton({
	insideSurface = false,
}: {
	insideSurface?: boolean;
}) {
	const requestRefresh = useWeatherRuntimeStore(
		(state) => state.requestRefresh,
	);
	const place = useSetupStore((state) => state.settings.weather.place);
	return (
		<ToolbarIconButton
			icon="refresh"
			label={`Refresh weather${place ? ` for ${place}` : ""}`}
			onClick={requestRefresh}
			insideSurface={insideSurface}
		/>
	);
}
