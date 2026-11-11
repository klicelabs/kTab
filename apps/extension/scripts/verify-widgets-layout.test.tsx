import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetSection } from "../src/components/newtab/widget-section";

test("widget shelf stays independent of the bookmark grid and wraps its items", () => {
	const { document } = parseHTML(
		renderToStaticMarkup(
			createElement(
				WidgetSection,
				null,
				createElement("div", { "data-widget": "clock" }, "09:30"),
				createElement("div", { "data-widget": "weather" }, "22°C"),
			),
		),
	);

	const section = document.querySelector('[aria-label="Widgets"]');
	expect(section).not.toBeNull();
	expect(section?.classList.contains("speed-dial-widget-section")).toBe(true);
	expect(section?.querySelectorAll(".speed-dial-widget-slot")).toHaveLength(2);
	expect(section?.querySelector('[data-widget="clock"]')?.textContent).toBe(
		"09:30",
	);
	expect(section?.querySelector('[data-widget="weather"]')?.textContent).toBe(
		"22°C",
	);
});

test("widget shelf is absent until it has visible content", () => {
	const { document } = parseHTML(
		renderToStaticMarkup(createElement(WidgetSection)),
	);

	expect(document.querySelector('[aria-label="Widgets"]')).toBeNull();
});
