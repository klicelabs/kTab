import { expect, test } from "bun:test";
import {
	normalizeTabSwitcherTitleSource,
	resolveSwitcherTitle,
} from "../src/lib/tab-switcher-title-source";

test("switcher title source normalizes unknown values to the page title", () => {
	expect(normalizeTabSwitcherTitleSource("site")).toBe("site");
	expect(normalizeTabSwitcherTitleSource("title")).toBe("title");
	expect(normalizeTabSwitcherTitleSource("bogus")).toBe("title");
	expect(normalizeTabSwitcherTitleSource(undefined)).toBe("title");
});

test("switcher captions follow the page title by default", () => {
	expect(
		resolveSwitcherTitle(
			{ title: "Docs — React", url: "https://react.dev/learn" },
			"title",
		),
	).toBe("Docs — React");
	expect(
		resolveSwitcherTitle(
			{ title: "", url: "https://react.dev/learn" },
			"title",
		),
	).toBe("https://react.dev/learn");
	expect(resolveSwitcherTitle({ title: "", url: "" }, "title")).toBe(
		"Untitled tab",
	);
});

test("switcher captions can fall back to the site name from the URL", () => {
	expect(
		resolveSwitcherTitle(
			{ title: "Docs — React", url: "https://react.dev/learn" },
			"site",
		),
	).toBe("React");
	expect(
		resolveSwitcherTitle(
			{ title: "Watch", url: "https://www.youtube.com/watch?v=1" },
			"site",
		),
	).toBe("YouTube");
	expect(
		resolveSwitcherTitle({ title: "Deep page", url: "not a url" }, "site"),
	).toBe("Deep page");
});
