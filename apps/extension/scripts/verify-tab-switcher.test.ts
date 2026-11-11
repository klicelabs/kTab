import { expect, test } from "bun:test";
import {
	applyCachedTabPreviews,
	cacheTabPreview,
	orderTabsByRecency,
	registerTabSwitcherSession,
	removeTabSwitcherSession,
	type SwitcherTab,
	type TabSwitcherSession,
} from "../src/lib/tab-switcher";

const tab = (id: number, active = false): SwitcherTab => ({
	id,
	windowId: 1,
	title: `Tab ${id}`,
	url: `https://example.com/${id}`,
	active,
});

test("tab switcher prioritizes the most recently activated tabs", () => {
	expect(
		orderTabsByRecency([tab(1, true), tab(2), tab(3)], [3, 1, 2]).map(
			(entry) => entry.id,
		),
	).toEqual([3, 1, 2]);
});

test("tab switcher keeps an active tab first when recency is not known", () => {
	expect(
		orderTabsByRecency([tab(1), tab(2, true), tab(3)], []).map(
			(entry) => entry.id,
		),
	).toEqual([2, 1, 3]);
});

test("tab switcher ordering does not mutate the browser query result", () => {
	const input = [tab(1, true), tab(2), tab(3)];
	const ordered = orderTabsByRecency(input, [3, 2, 1]);
	expect(input.map((entry) => entry.id)).toEqual([1, 2, 3]);
	expect(ordered.map((entry) => entry.id)).toEqual([3, 2, 1]);
});

test("tab switcher opened message registers the active tab field consistently", () => {
	const sessions = new Map<number, TabSwitcherSession>();
	expect(registerTabSwitcherSession(sessions, 90, 4, 12)).toBe(true);
	expect(sessions.get(90)).toEqual({ windowId: 4, activeTabId: 12 });
	expect(registerTabSwitcherSession(sessions, -1, 4, 12)).toBe(false);
	expect(removeTabSwitcherSession(sessions, 90)).toBe(true);
	expect(sessions.size).toBe(0);
});

test("tab switcher caches only bounded image previews and attaches them by tab", () => {
	const previews = new Map<number, string>();
	expect(cacheTabPreview(previews, 1, "https://example.com/image.png")).toBe(false);
	expect(cacheTabPreview(previews, 1, "data:image/jpeg;base64,one")).toBe(true);
	expect(cacheTabPreview(previews, 2, "data:image/jpeg;base64,two")).toBe(true);
	const tabs = [tab(1), tab(2), tab(3)];
	expect(applyCachedTabPreviews(tabs, previews).map((entry) => entry.preview)).toEqual([
		"data:image/jpeg;base64,one",
		"data:image/jpeg;base64,two",
		undefined,
	]);
	expect(tabs.every((entry) => entry.preview === undefined)).toBe(true);
});
