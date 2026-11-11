import { expect, test } from "bun:test";
import { orderTabsByRecency, type SwitcherTab } from "../src/lib/tab-switcher";

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
