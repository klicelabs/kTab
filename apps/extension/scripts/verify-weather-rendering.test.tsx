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

test("renders selected city conditions with bundled decorative Meteocons artwork", () => {
	const latitude = -22.92;
	const longitude = -42.51;
	const markup = renderToStaticMarkup(
		<WeatherWidgetView
			weather={{
				enabled: true,
				display: "widget",
				place: "Saquarema, Brazil",
				latitude,
				longitude,
				dynamicAtmosphere: false,
			}}
			reading={{ temperatureC: 26, weatherCode: 0, isDay: true }}
			status="ready"
			error={null}
		/>,
	);
	expect(markup).toContain("Saquarema, Brazil");
	expect(markup).toContain("26°C");
	expect(markup).toContain("Open-Meteo");
	expect(markup).toContain('alt=""');
	expect(markup).toContain('width="52"');
});

test("renders weather artwork at stable dimensions without exposing decorative alt text", () => {
	const markup = renderToStaticMarkup(<WeatherIcon icon="snow" size={56} />);
	expect(markup).toContain('alt=""');
	expect(markup).toContain('aria-hidden="true"');
	expect(markup).toContain('width="56"');
	expect(markup).toContain('height="56"');
});

test("keeps the weather setting migration defaults aligned with the widget", () => {
	expect(DEFAULT_SETUP.settings.weather.display).toBe("widget");
});
