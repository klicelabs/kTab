import { create } from "zustand";
import type { WeatherReading } from "../types";

export type WeatherRuntimeStatus =
	| "idle"
	| "loading"
	| "ready"
	| "refreshing"
	| "error";

interface WeatherRuntimeState {
	locationKey: string | null;
	reading: WeatherReading | null;
	status: WeatherRuntimeStatus;
	error: string | null;
	retryToken: number;
	atmospherePaused: boolean;
	requestRefresh: () => void;
	toggleAtmospherePaused: () => void;
}

export const useWeatherRuntimeStore = create<WeatherRuntimeState>((set) => ({
	locationKey: null,
	reading: null,
	status: "idle",
	error: null,
	retryToken: 0,
	atmospherePaused: false,
	requestRefresh: () => set((state) => ({ retryToken: state.retryToken + 1 })),
	toggleAtmospherePaused: () =>
		set((state) => ({ atmospherePaused: !state.atmospherePaused })),
}));
