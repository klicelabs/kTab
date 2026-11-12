import type { WeatherIconName } from "../../../lib/weather-conditions";

const METEOCON_ASSETS: Record<WeatherIconName, string> = {
	"clear-day": new URL("./meteocons/clear-day.svg", import.meta.url).href,
	"clear-night": new URL("./meteocons/clear-night.svg", import.meta.url).href,
	"partly-cloudy-day": new URL(
		"./meteocons/partly-cloudy-day.svg",
		import.meta.url,
	).href,
	"partly-cloudy-night": new URL(
		"./meteocons/partly-cloudy-night.svg",
		import.meta.url,
	).href,
	overcast: new URL("./meteocons/overcast.svg", import.meta.url).href,
	drizzle: new URL("./meteocons/drizzle.svg", import.meta.url).href,
	rain: new URL("./meteocons/rain.svg", import.meta.url).href,
	snow: new URL("./meteocons/snow.svg", import.meta.url).href,
	fog: new URL("./meteocons/fog.svg", import.meta.url).href,
	thunderstorms: new URL("./meteocons/thunderstorms.svg", import.meta.url).href,
};

export function WeatherIcon({
	icon,
	size = 48,
}: {
	icon: WeatherIconName;
	size?: number;
}) {
	return (
		<img
			src={METEOCON_ASSETS[icon]}
			alt=""
			aria-hidden="true"
			width={size}
			height={size}
			decoding="async"
			className="shrink-0 object-contain"
		/>
	);
}
