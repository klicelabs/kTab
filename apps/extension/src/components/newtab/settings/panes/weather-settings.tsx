import { Input } from "@ktab/ui/components/input";
import { Switch } from "@ktab/ui/components/switch";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { clearWeatherCache } from "../../../../lib/idb";
import { cn } from "../../../../lib/utils";
import {
	formatWeatherPlace,
	searchWeatherLocations,
	type WeatherLocation,
} from "../../../../services/open-meteo";
import { useSetupStore } from "../../../../stores/setup-store";
import { SectionCard } from "../shared/section-card";
import { SelectRow } from "../shared/select-row";
import { SettingRow } from "../shared/setting-row";
import { SettingsAction } from "../shared/settings-action";
import { SettingsExpandable } from "../shared/settings-expandable";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_INPUT,
	SETTINGS_RADIUS,
	SETTINGS_SWITCH,
} from "../shared/settings-tokens";

const WEATHER_DISPLAY_OPTIONS = [
	{ value: "widget", label: "Widget shelf" },
	{ value: "toolbar", label: "Toolbar text" },
] as const;

export function WeatherEnabledSwitch({
	enabled,
	onChange,
}: {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<Switch
			className={SETTINGS_SWITCH}
			aria-label="Show weather"
			checked={enabled}
			onCheckedChange={onChange}
		/>
	);
}

function WeatherEnableControl({
	enabled,
	onChange,
}: {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<SettingRow
			label="Weather"
			icon="sun-moon"
			tooltip="Show current conditions for a city you choose."
		>
			<WeatherEnabledSwitch enabled={enabled} onChange={onChange} />
		</SettingRow>
	);
}

export function WeatherSettings() {
	const weather = useSetupStore((state) => state.settings.weather);
	const updateWeather = useSetupStore((state) => state.updateWeather);
	const [query, setQuery] = useState("");
	const [locations, setLocations] = useState<WeatherLocation[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [message, setMessage] = useState("");
	const searchController = useRef<AbortController | null>(null);
	const queryId = useId();
	const messageId = useId();

	useEffect(
		() => () => {
			searchController.current?.abort();
		},
		[],
	);

	useEffect(() => {
		if (weather.enabled) return;
		searchController.current?.abort();
		setIsSearching(false);
	}, [weather.enabled]);

	async function handleSearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const searchTerm = query.trim();
		if (searchTerm.length < 2) {
			setLocations([]);
			setMessage("Enter at least two characters to search for a city.");
			return;
		}

		searchController.current?.abort();
		const controller = new AbortController();
		searchController.current = controller;
		setIsSearching(true);
		setLocations([]);
		setMessage("Searching for places…");
		try {
			const results = await searchWeatherLocations(searchTerm, {
				signal: controller.signal,
			});
			if (controller.signal.aborted) return;
			setLocations(results);
			setMessage(
				results.length > 0
					? `${results.length} ${results.length === 1 ? "place" : "places"} found.`
					: "No places found. Try adding a country, such as Paris, France.",
			);
		} catch {
			if (controller.signal.aborted) return;
			setMessage("Unable to search. Check your connection and try again.");
		} finally {
			if (searchController.current === controller) {
				searchController.current = null;
				setIsSearching(false);
			}
		}
	}

	function chooseLocation(location: WeatherLocation) {
		const place = formatWeatherPlace(location);
		searchController.current?.abort();
		setIsSearching(false);
		setLocations([]);
		setQuery("");
		setMessage(`Weather location set to ${place}.`);
		updateWeather({
			place,
			latitude: location.latitude,
			longitude: location.longitude,
		});
	}

	function clearLocation() {
		updateWeather({ place: "", latitude: null, longitude: null });
		setMessage("Weather location cleared.");
		void clearWeatherCache().catch(() => undefined);
	}

	return (
		<SectionCard>
			<WeatherEnableControl
				enabled={weather.enabled}
				onChange={(enabled) => updateWeather({ enabled })}
			/>

			<SettingsExpandable expanded={weather.enabled} label="Weather options">
				<SelectRow
					label="Display"
					icon="layout"
					value={weather.display}
					options={WEATHER_DISPLAY_OPTIONS}
					onChange={(display) => updateWeather({ display })}
				/>

				{weather.place ? (
					<div className="grid min-w-0 gap-1 px-1.5 py-2.5">
						<div className="flex min-w-0 items-center gap-2">
							<span className="min-w-0 flex-1 font-medium text-[13px] text-neutral-900 leading-[1.35] dark:text-neutral-100">
								Selected city
							</span>
							<SettingsAction onClick={clearLocation}>
								Clear city
							</SettingsAction>
						</div>
						<p className="min-w-0 break-words text-[13px] text-neutral-600 leading-[1.4] dark:text-neutral-300">
							{weather.place}
						</p>
					</div>
				) : null}

				<form
					className="grid min-w-0 gap-2 px-1.5 py-2.5"
					onSubmit={(event) => void handleSearch(event)}
					aria-busy={isSearching}
				>
					<label
						htmlFor={queryId}
						className="font-medium text-[13px] text-neutral-900 leading-[1.35] dark:text-neutral-100"
					>
						City or postal code
					</label>
					<div className="flex min-w-0 items-center gap-2">
						<Input
							id={queryId}
							name="weather-city"
							type="search"
							autoComplete="off"
							maxLength={120}
							placeholder="e.g. Saquarema, Brazil"
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setLocations([]);
								setMessage("");
								searchController.current?.abort();
							}}
							aria-describedby={messageId}
							className={cn(
								"h-9 min-w-0 flex-1 px-3 text-sm",
								SETTINGS_RADIUS.control,
								SETTINGS_INPUT,
							)}
						/>
						<SettingsAction
							type="submit"
							icon="search"
							disabled={isSearching}
							className="h-9"
						>
							Search
						</SettingsAction>
					</div>
					<p
						id={messageId}
						role="status"
						aria-live="polite"
						className="min-h-4 text-pretty text-[12px] text-neutral-500 leading-[1.4] dark:text-neutral-400"
					>
						{message}
					</p>
					{locations.length > 0 ? (
						<ul className="grid min-w-0 gap-1" aria-label="City search results">
							{locations.map((location) => {
								const place = formatWeatherPlace(location);
								return (
									<li key={`${location.latitude},${location.longitude}`}>
										<button
											type="button"
											onClick={() => chooseLocation(location)}
											className={cn(
												"block min-h-10 w-full px-3 py-2 text-start text-[13px] text-neutral-800 leading-[1.4] hover:bg-neutral-900/[0.05] dark:text-neutral-100 dark:hover:bg-white/[0.06]",
												SETTINGS_RADIUS.control,
												SETTINGS_FOCUS_RING,
											)}
										>
											{place}
										</button>
									</li>
								);
							})}
						</ul>
					) : null}
				</form>

				<SettingRow
					label="Dynamic atmosphere"
					icon="droplet"
					tooltip="Show subtle rain, snow or mist over the wallpaper when current conditions match."
				>
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Enable dynamic atmosphere"
						checked={weather.dynamicAtmosphere}
						onCheckedChange={(dynamicAtmosphere: boolean) =>
							updateWeather({ dynamicAtmosphere })
						}
					/>
				</SettingRow>

				<p className="text-pretty px-1.5 py-2 text-[12px] text-neutral-500 leading-[1.45] dark:text-neutral-400">
					Weather sends the city name and chosen coordinates to Open-Meteo. It
					never uses device location. Data by{" "}
					<a
						href="https://open-meteo.com/"
						target="_blank"
						rel="noopener noreferrer"
						className="underline decoration-from-font underline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--ktab-accent)] focus-visible:outline-offset-2"
					>
						Open-Meteo
					</a>{" "}
					under{" "}
					<a
						href="https://creativecommons.org/licenses/by/4.0/"
						target="_blank"
						rel="noopener noreferrer"
						className="underline decoration-from-font underline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--ktab-accent)] focus-visible:outline-offset-2"
					>
						CC BY 4.0
					</a>
					.
				</p>
			</SettingsExpandable>
		</SectionCard>
	);
}
