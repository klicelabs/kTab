import { expect, test } from "bun:test";
import {
	requestWidgetAction,
	subscribeWidgetAction,
} from "../src/lib/widget-actions";

test("widget quick actions reach only active subscribers and unsubscribe cleanly", () => {
	let weatherRefreshes = 0;
	let marketRefreshes = 0;
	let audioOutputRequests = 0;
	const stopWeather = subscribeWidgetAction("weather", "refresh", () => {
		weatherRefreshes += 1;
	});
	subscribeWidgetAction("market", "refresh", () => {
		marketRefreshes += 1;
	});
	subscribeWidgetAction("music", "open-audio-output", () => {
		audioOutputRequests += 1;
	});

	requestWidgetAction("weather", "refresh");
	requestWidgetAction("music", "open-audio-output");
	stopWeather();
	requestWidgetAction("weather", "refresh");

	expect(weatherRefreshes).toBe(1);
	expect(marketRefreshes).toBe(0);
	expect(audioOutputRequests).toBe(1);
});
