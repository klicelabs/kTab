import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WidgetSection } from "../src/components/newtab/widget-section";
import { moveWidget, normalizeWidgetOrder } from "../src/lib/widget-order";

test("widget shelf follows the saved order and wraps enabled items", () => {
	const { document } = parseHTML(
		renderToStaticMarkup(
			createElement(WidgetSection, {
				items: [
					{
						id: "weather",
						content: createElement("div", { "data-widget": "weather" }, "22°C"),
					},
					{
						id: "music",
						content: createElement("div", { "data-widget": "music" }, "Music"),
					},
					{
						id: "market",
						content: createElement(
							"div",
							{ "data-widget": "market" },
							"Market",
						),
					},
					{
						id: "github",
						content: createElement(
							"div",
							{ "data-widget": "github" },
							"GitHub",
						),
					},
				],
			}),
		),
	);

	const section = document.querySelector('[aria-label="Widgets"]');
	expect(section).not.toBeNull();
	expect(section?.classList.contains("speed-dial-widget-section")).toBe(true);
	expect(section?.querySelectorAll(".speed-dial-widget-slot")).toHaveLength(2);
	expect(section?.querySelector('[data-widget="music"]')?.textContent).toBe(
		"Music",
	);
	expect(section?.querySelector('[data-widget="weather"]')).toBeNull();
	expect(section?.querySelector('[data-widget="github"]')).toBeNull();
	expect(
		Array.from(section?.querySelectorAll("[data-widget-slot-id]") ?? []).map(
			(slot) => slot.getAttribute("data-widget-slot-id"),
		),
	).toEqual(["music", "market"]);
	expect(
		section?.querySelector('[data-widget-slot-id="music"]'),
	).not.toBeNull();
	expect(
		section?.querySelector('[aria-label^="Move Music widget"]'),
	).not.toBeNull();
	expect(section?.querySelector('[aria-label^="Reorder Music"]')).toBeNull();
	expect(section?.querySelectorAll('[aria-haspopup="menu"]')).toHaveLength(2);
	expect(
		section
			?.querySelector('[data-widget-slot-id="music"]')
			?.getAttribute("draggable"),
	).toBeNull();
	expect(
		section
			?.querySelector('[data-widget-slot-id="music"]')
			?.getAttribute("data-local-context-menu"),
	).toBe("true");
});

test("widget shelf is absent until it has visible content", () => {
	const { document } = parseHTML(
		renderToStaticMarkup(createElement(WidgetSection, { items: [] })),
	);

	expect(document.querySelector('[aria-label="Widgets"]')).toBeNull();
});

test("widget order repairs invalid entries and moves items consistently", () => {
	expect(normalizeWidgetOrder(["music", "music", "unknown", "market"])).toEqual(
		["music", "market", "weather", "github"],
	);
	expect(
		moveWidget(
			["weather", "music", "market", "github"],
			"weather",
			"market",
			true,
		),
	).toEqual(["music", "market", "weather", "github"]);
});
