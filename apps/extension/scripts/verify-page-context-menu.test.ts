import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { isPageBackgroundContextMenuTarget } from "../src/lib/page-context-menu";

test("global context menu only accepts unoccupied page surfaces", () => {
	const { document } = parseHTML(`
		<div id="background"></div>
		<div id="search"><input /></div>
		<div data-widget-slot-id="music"><div data-widget="music"></div></div>
		<div data-quick-links="true"><a href="https://example.com">Site</a></div>
		<div data-local-context-menu><button>Open local menu</button></div>
		<div data-speed-dial-app-toolbar><button>Search</button></div>
		<p id="copy">A visible component</p>
	`);

	expect(
		isPageBackgroundContextMenuTarget(document.querySelector("#background")),
	).toBe(true);
	expect(
		isPageBackgroundContextMenuTarget(document.querySelector("#search input")),
	).toBe(false);
	expect(
		isPageBackgroundContextMenuTarget(
			document.querySelector('[data-widget="music"]'),
		),
	).toBe(false);
	expect(
		isPageBackgroundContextMenuTarget(
			document.querySelector("[data-quick-links] a"),
		),
	).toBe(false);
	expect(
		isPageBackgroundContextMenuTarget(
			document.querySelector("[data-local-context-menu] button"),
		),
	).toBe(false);
	expect(
		isPageBackgroundContextMenuTarget(document.querySelector("#copy")),
	).toBe(false);
	expect(isPageBackgroundContextMenuTarget(null)).toBe(false);
});
