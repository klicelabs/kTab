import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppearanceProvider } from "../src/components/newtab/appearance-provider";
import { SearchResultIcon } from "../src/components/newtab/search/search-result-icon";
import {
	activeSearchIndex,
	buildSearchGroups,
	searchDestination,
} from "../src/components/newtab/search/search-results";
import { searchPlacement } from "../src/components/newtab/search/use-search-position";
import {
	canRestoreSearchFocus,
	searchPresence,
} from "../src/components/newtab/search/use-search-presence";
import { ToolbarActions } from "../src/components/newtab/toolbar/toolbar-actions";
import { createSearchIndex } from "../src/lib/search-index";
import type { Card, Folder } from "../src/types";

const folders: Folder[] = [
	{ id: "root", name: "Design", parentId: null, order: 0 },
	{ id: "child", name: "Inspiração", parentId: "root", order: 1 },
];
const cards: Card[] = [
	{
		id: "figma",
		folderId: "child",
		title: "Figma resources",
		url: "https://figma.com/",
		favicon: null,
		thumbId: null,
		order: 2,
	},
	{
		id: "exact",
		folderId: "root",
		title: "Figma",
		url: "https://example.com/figma",
		favicon: null,
		thumbId: null,
		order: 3,
	},
];
const quickLinks = [{ id: "figma", label: "Figma", url: "https://figma.com" }];
const index = createSearchIndex(cards, folders);

test("compact Search shares one accessible group with Settings and keeps their order", () => {
	// Other DOM tests may leave a window without matchMedia. Supply the
	// browser capability only for this synchronous render and restore it.
	const owner = typeof window === "undefined" ? null : window;
	const descriptor = owner
		? Object.getOwnPropertyDescriptor(owner, "matchMedia")
		: undefined;
	if (owner && typeof owner.matchMedia !== "function")
		Object.defineProperty(owner, "matchMedia", {
			configurable: true,
			value: (media: string) => ({
				matches: false,
				media,
				onchange: null,
				addListener() {},
				removeListener() {},
				addEventListener() {},
				removeEventListener() {},
				dispatchEvent() {
					return true;
				},
			}),
		});
	try {
		for (const compactSearch of [false, true]) {
			const { document } = parseHTML(
				renderToStaticMarkup(
					createElement(
						AppearanceProvider,
						null,
						createElement(ToolbarActions, {
							compactSearch,
							onSettings: () => {},
							onSearch: () => {},
						}),
					),
				),
			);
			const group = document.querySelector('[data-toolbar-actions="true"]');
			if (!group) throw new Error("Expected the app actions group");
			expect(group?.getAttribute("role")).toBe("group");
			expect(
				[...group.querySelectorAll("button")].map((button) =>
					button.getAttribute("aria-label"),
				),
			).toEqual(compactSearch ? ["Search", "Settings"] : ["Settings"]);
			expect(document.querySelectorAll("#settings-trigger")).toHaveLength(1);
			expect(
				group.querySelectorAll("[data-toolbar-action-divider]"),
			).toHaveLength(compactSearch ? 1 : 0);
		}
	} finally {
		if (owner) {
			if (descriptor) Object.defineProperty(owner, "matchMedia", descriptor);
			else Reflect.deleteProperty(owner, "matchMedia");
		}
	}
});

test("search exit retains content until completion and cannot close a reopened search", () => {
	const closing = searchPresence("open", { type: "close", immediate: false });
	expect(closing).toBe("closing");
	expect(searchPresence(closing, { type: "finish" })).toBe("closed");
	const reopened = searchPresence(closing, { type: "open" });
	expect(searchPresence(reopened, { type: "finish" })).toBe("open");
	expect(searchPresence("open", { type: "close", immediate: true })).toBe(
		"closed",
	);
});

test("exit only restores focus for the same closed interaction with no newer focus target", () => {
	expect(canRestoreSearchFocus("closed", 3, 3, true)).toBe(true);
	expect(canRestoreSearchFocus("open", 3, 3, true)).toBe(false);
	expect(canRestoreSearchFocus("closing", 3, 3, true)).toBe(false);
	expect(canRestoreSearchFocus("closed", 3, 4, true)).toBe(false);
	expect(canRestoreSearchFocus("closed", 3, 3, false)).toBe(false);
});

test("search URL results use the actual Home app tile and its shared art pipeline", () => {
	const { document } = parseHTML(
		renderToStaticMarkup(
			createElement(SearchResultIcon, {
				url: "https://example.com",
				icon: "globe",
			}),
		),
	);
	expect(
		document.querySelector(".ktab-search-app-icon.icon-app-tile"),
	).not.toBeNull();
	expect(document.querySelector(".ktab-search-result-icon")).toBeNull();
	const plain = parseHTML(
		renderToStaticMarkup(createElement(SearchResultIcon, { icon: "search" })),
	);
	expect(plain.document.querySelector(".icon-app-tile")).toBeNull();
});
const groupsFor = (
	query: string,
	scope: "all" | "saved" | "folders" | "web" = "all",
	suggestions: string[] = [],
) =>
	buildSearchGroups({
		query,
		scope,
		local: index(query),
		cards,
		folders,
		quickLinks,
		suggestions,
	});

test("search finds accents, reordered terms and folder context, while exact titles rank first", () => {
	expect(index("figma").sites.map((card) => card.id)).toEqual([
		"exact",
		"figma",
	]);
	expect(
		index("resources design inspiracao").sites.map((card) => card.id),
	).toEqual(["figma"]);
	expect(index("InSpIrAcAo").folders[0]?.id).toBe("child");
	expect(index("figma missing").sites).toEqual([]);
});

test("empty search uses authored shortcuts and folders, never invented visit history or web suggestions", () => {
	const groups = groupsFor("", "all", ["external trending query"]);
	expect(groups.map((group) => group.id)).toEqual(["quick-links", "folders"]);
	expect(
		groups
			.flatMap((group) => group.items)
			.some((item) => item.type === "suggestion"),
	).toBe(false);
});

test("the recognized website leads, saved results follow and duplicate shortcuts are omitted", () => {
	const groups = groupsFor("figma", "all", [
		"figma",
		"figma tutorials",
		"figma tutorials",
	]);
	expect(groups.map((group) => group.id)).toEqual([
		"destination",
		"saved",
		"web",
	]);
	expect(groups[0]?.items[0]?.id).toBe("bookmark:figma");
	expect(groups.at(-1)?.items.map((item) => item.type)).toEqual([
		"web",
		"suggestion",
	]);
});

test("scope filtering retains recovery for web while local no-match stays empty", () => {
	expect(groupsFor("missing", "saved")).toEqual([]);
	expect(groupsFor("figma", "folders")).toEqual([]);
	expect(groupsFor("figma", "web").map((group) => group.id)).toEqual([
		"destination",
		"web",
	]);
	expect(groupsFor("", "saved")[0]?.items).toHaveLength(2);
});

test("late web responses preserve the keyboard selection by identity", () => {
	const before = groupsFor("figma").flatMap((group) => group.items);
	const after = groupsFor("figma", "all", ["figma tutorials"]).flatMap(
		(group) => group.items,
	);
	const selected = before[1];
	expect(after[activeSearchIndex(after, selected?.id ?? null, true)]?.id).toBe(
		selected?.id,
	);
	expect(activeSearchIndex(after, null, false)).toBe(-1);
	expect(activeSearchIndex(after, "deleted", true)).toBe(0);
});

test("direct destinations accept web addresses and never turn unsafe schemes into navigation", () => {
	expect(searchDestination("example.com/path?q=hello")).toBe(
		"https://example.com/path?q=hello",
	);
	expect(searchDestination("https://example.com")).toBe("https://example.com/");
	expect(searchDestination("example.com:8080/path")).toBe(
		"https://example.com:8080/path",
	);
	for (const value of [
		"javascript:alert(1)",
		"data:text/html,test",
		"file:///tmp",
		"https://user:secret@example.com",
		"a search query",
		"example",
		"https://",
	])
		expect(searchDestination(value)).toBeNull();
});

const position = (top: number, width = 1280, height = 800) =>
	searchPlacement({
		anchor: { left: (width - 560) / 2, top, width: 560 },
		frame: { left: 0, top: 0, width },
		viewport: { left: 0, top: 0, width, height },
		preferredWidth: 560,
	});

test("offscreen search opens below the toolbar and docks back to its original visible anchor", () => {
	const floating = position(-400);
	expect(floating.floating).toBe(true);
	expect(floating.top).toBe(68);
	expect(position(230).top).toBe(230);
	expect(position(230).floating).toBe(false);
});

test("search fits a narrow window and a shortened visual viewport without horizontal overflow", () => {
	const narrow = position(-100, 360, 420);
	expect(narrow.left).toBeGreaterThanOrEqual(12);
	expect(narrow.left + narrow.width).toBeLessThanOrEqual(348);
	expect(narrow.top + 66 + narrow.resultsHeight).toBeLessThanOrEqual(420);
});

test("an anchor near the bottom moves upward to reserve real result rows", () => {
	const short = position(300, 800, 400);
	expect(short.floating).toBe(true);
	expect(short.top).toBeLessThanOrEqual(80);
	expect(short.resultsHeight).toBeGreaterThanOrEqual(240);
	expect(short.top + 66 + short.resultsHeight).toBeLessThanOrEqual(400);
});
