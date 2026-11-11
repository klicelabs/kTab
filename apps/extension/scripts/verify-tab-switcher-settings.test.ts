import { expect, test } from "bun:test";
import {
	initialSwitcherSelection,
	type SwitcherTab,
} from "../src/lib/tab-switcher";
import {
	normalizeTabSwitcherFirstPress,
	normalizeTabSwitcherTitleSource,
	resolveSwitcherTitle,
} from "../src/lib/tab-switcher-settings";

const tab = (id: number, active = false): SwitcherTab => ({
	id,
	windowId: 1,
	title: `Tab ${id}`,
	url: `https://example.com/${id}`,
	active,
});

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

test("switcher first press normalizes unknown values to stay", () => {
	expect(normalizeTabSwitcherFirstPress("next")).toBe("next");
	expect(normalizeTabSwitcherFirstPress("stay")).toBe("stay");
	expect(normalizeTabSwitcherFirstPress("bogus")).toBe("stay");
	expect(normalizeTabSwitcherFirstPress(undefined)).toBe("stay");
});

test("switcher opening selection follows the first press mode", () => {
	const tabs = [tab(1), tab(2, true), tab(3)];
	expect(initialSwitcherSelection(tabs, 2, "stay")).toBe(1);
	expect(initialSwitcherSelection(tabs, 2, "next")).toBe(2);
	expect(initialSwitcherSelection(tabs, 3, "next")).toBe(0);
	expect(initialSwitcherSelection(tabs, 99, "next")).toBe(0);
	expect(initialSwitcherSelection(tabs, 99, "stay")).toBe(0);
});
