import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WeatherEnabledSwitch } from "../src/components/newtab/settings/panes/weather-settings";
import { WeatherIcon } from "../src/components/newtab/weather/weather-icon";
import { WeatherWidgetView } from "../src/components/newtab/weather/weather-widget";
import { DEFAULT_SETUP } from "../src/lib/constants";
import { useSetupStore } from "../src/stores/setup-store";

const originalWeather = structuredClone(
	useSetupStore.getState().settings.weather,
);

afterEach(() => {
	useSetupStore.setState((state) => ({
		settings: { ...state.settings, weather: structuredClone(originalWeather) },
	}));
});

test("renders the weather preference with an accessible off-state switch", () => {
	const markup = renderToStaticMarkup(
		<WeatherEnabledSwitch enabled={false} onChange={() => undefined} />,
	);
	expect(markup).toContain('aria-label="Show weather"');
	expect(markup).toContain('aria-checked="false"');
});

test("renders the expanded forecast card without provider branding", () => {
	const latitude = -22.92;
	const longitude = -42.51;
	const markup = renderToStaticMarkup(
		<WeatherWidgetView
			weather={{
				enabled: true,
				display: "expanded",
				appearance: "flat",
				place: "Saquarema, Brazil",
				latitude,
				longitude,
				dynamicAtmosphere: false,
			}}
			reading={{
				temperatureC: 26,
				weatherCode: 0,
				isDay: true,
				highC: 29,
				lowC: 21,
				sunrise: "2026-11-12T05:54",
				sunset: "2026-11-12T18:12",
				hourly: [],
			}}
			status="ready"
			error={null}
		/>,
	);
	expect(markup).toContain("Saquarema");
	expect(markup).toContain("26°");
	expect(markup).not.toContain("Open-Meteo");
	expect(markup).toContain('data-widget-size="wide"');
	expect(markup).toContain('data-widget-appearance="flat"');
	expect(markup).toContain("H:29° L:21°");
	expect(markup).toContain('alt=""');
});

test("renders compact weather as a square card with the selected material", () => {
	const markup = renderToStaticMarkup(
		<WeatherWidgetView
			weather={{
				enabled: true,
				display: "compact",
				appearance: "glass",
				place: "Cupertino, California, United States",
				latitude: 37.32,
				longitude: -122.03,
				dynamicAtmosphere: false,
			}}
			reading={{ temperatureC: 14, weatherCode: 0, isDay: true }}
			status="ready"
			error={null}
		/>,
	);
	expect(markup).toContain('data-widget-size="square"');
	expect(markup).toContain('data-widget-appearance="glass"');
	expect(markup).toContain("Cupertino");
	expect(markup).toContain("14°");
});

test("renders weather artwork at stable dimensions without exposing decorative alt text", () => {
	const markup = renderToStaticMarkup(<WeatherIcon icon="snow" size={56} />);
	expect(markup).toContain('alt=""');
	expect(markup).toContain('aria-hidden="true"');
	expect(markup).toContain('width="56"');
	expect(markup).toContain('height="56"');
});

test("defaults weather to the expanded card mode", () => {
	expect(DEFAULT_SETUP.settings.weather.display).toBe("expanded");
});
