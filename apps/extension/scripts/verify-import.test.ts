import { expect, test } from "bun:test";
import { preflightBackup } from "../src/lib/backup-format";
import {
	planBookmarkMerge,
	summarizeBookmarkTree,
} from "../src/lib/bookmark-merge";
import type { Card, Folder } from "../src/types";

function folder(
	id: string,
	name: string,
	parentId: string | null,
	order = 0,
): Folder {
	return { id, name, order, parentId };
}

function card(id: string, folderId: string, url: string, order = 0): Card {
	return {
		id,
		folderId,
		title: id,
		url,
		favicon: null,
		thumbId: null,
		order,
		origin: "local",
		capturedAt: null,
	};
}

// ---------------------------------------------------------------------------
// Merge rules.
// ---------------------------------------------------------------------------

test("creates folders and cards from an empty library", () => {
	const plan = planBookmarkMerge(
		[],
		[],
		[
			{
				name: "Work",
				links: [{ title: "GitHub", url: "https://github.com/" }],
				children: [],
			},
		],
		[{ title: "HN", url: "https://news.ycombinator.com/" }],
	);
	expect(plan.foldersCreated).toBe(2); // Work + catch-all Bookmarks
	expect(plan.cardsCreated).toBe(2);
	expect(plan.folders.map((f) => f.name).sort()).toEqual(["Bookmarks", "Work"]);
	const work = plan.folders.find((f) => f.name === "Work");
	expect(plan.cards.find((c) => c.title === "GitHub")?.folderId).toBe(work?.id);
	expect(plan.touchedFolderIds.length).toBeGreaterThan(0);
});

test("reuses same-level folders and dedupes same-folder urls", () => {
	const existing = [folder("w", "Work", null)];
	const cards = [card("g", "w", "https://github.com/")];
	const plan = planBookmarkMerge(
		existing,
		cards,
		[
			{
				name: "work",
				links: [{ title: "GitHub!", url: "https://github.com" }],
				children: [],
			},
		],
		[],
	);
	expect(plan.foldersCreated).toBe(0);
	expect(plan.cardsCreated).toBe(0);
});

test("preserves duplicate sibling folder names and reimports them by occurrence", () => {
	const source = [
		{
			name: "Work",
			links: [{ title: "A", url: "https://a.example/" }],
			children: [],
		},
		{
			name: "Work",
			links: [{ title: "B", url: "https://b.example/" }],
			children: [],
		},
	];
	const first = planBookmarkMerge([], [], source, []);
	expect(first.folders.map((item) => item.name)).toEqual(["Work", "Work"]);
	expect(new Set(first.cards.map((item) => item.folderId)).size).toBe(2);
	const second = planBookmarkMerge(
		first.folders,
		first.cards,
		source,
		[],
		first.itemOrder,
	);
	expect(second.foldersCreated).toBe(0);
	expect(second.cardsCreated).toBe(0);
	expect(second.folders).toHaveLength(2);
});

test("keeps the same url in different folders", () => {
	const existing = [folder("a", "A", null), folder("b", "B", null)];
	const cards = [card("g", "a", "https://github.com/")];
	const plan = planBookmarkMerge(
		existing,
		cards,
		[
			{
				name: "B",
				links: [{ title: "GitHub", url: "https://github.com/" }],
				children: [],
			},
		],
		[],
	);
	expect(plan.cardsCreated).toBe(1);
	expect(plan.cards.find((c) => c.id !== "g")?.folderId).toBe("b");
});

test("preserves nesting and skips malformed links", () => {
	const plan = planBookmarkMerge(
		[],
		[],
		[
			{
				name: "Parent",
				links: [{ title: "Bad", url: "javascript:void(0)" }],
				children: [
					{
						name: "Child",
						links: [{ title: "", url: "https://example.com/x" }],
						children: [],
					},
				],
			},
		],
		[],
	);
	expect(plan.foldersCreated).toBe(2);
	expect(plan.cardsCreated).toBe(1);
	const child = plan.folders.find((f) => f.name === "Child");
	const parent = plan.folders.find((f) => f.name === "Parent");
	expect(child?.parentId).toBe(parent?.id);
	expect(plan.cards[0].title).toBe("https://example.com/x");
});

test("planning never mutates its inputs", () => {
	const existing = [folder("w", "Work", null)];
	const cards = [card("g", "w", "https://github.com/")];
	const before = JSON.stringify({ existing, cards });
	planBookmarkMerge(
		existing,
		cards,
		[
			{
				name: "New",
				links: [{ title: "X", url: "https://x.example/" }],
				children: [],
			},
		],
		[],
	);
	expect(JSON.stringify({ existing, cards })).toBe(before);
});

test("summarizes trees for the choice dialog", () => {
	expect(
		summarizeBookmarkTree(
			[
				{
					name: "A",
					links: [{ title: "x", url: "https://x.example/" }],
					children: [],
				},
			],
			[{ title: "y", url: "https://y.example/" }],
		).text,
	).toBe("2 links in 1 folder");
	expect(summarizeBookmarkTree([], []).text).toBe("nothing importable");
});

// ---------------------------------------------------------------------------
// Backup preflight.
// ---------------------------------------------------------------------------

function backupDoc(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		folders: [{ id: "f", name: "F", order: 0, parentId: null }],
		cards: [],
		activeFolderId: "f",
		settings: {},
		...overrides,
	});
}

test("preflights valid and invalid backups", () => {
	expect(preflightBackup(backupDoc())).toEqual({ folders: 1, cards: 0 });
	expect(() => preflightBackup("")).toThrow("That file is empty.");
	expect(() => preflightBackup("   ")).toThrow("That file is empty.");
	expect(() => preflightBackup("{nope")).toThrow("not a valid kTab backup");
	expect(() => preflightBackup("[1,2]")).toThrow("not a valid kTab backup");
	expect(() => preflightBackup(backupDoc({ folders: "x" }))).toThrow(
		"folders and cards arrays",
	);
	expect(() =>
		preflightBackup(backupDoc({ thumbnails: { a: "not-a-data-url" } })),
	).toThrow("Invalid data URL");
});
