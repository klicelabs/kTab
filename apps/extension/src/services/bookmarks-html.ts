/**
 * Bookmarks interop via the Netscape Bookmark File Format — the HTML format
 * produced by Chrome (chrome://bookmarks → Export) and Firefox (Manage
 * Bookmarks → Export), and accepted by both browsers on import. kTab
 * exports its folder tree + cards in that shape and imports the same format back.
 *
 * Import parses with DOMParser on a detached document (never the live page),
 * reuses folders by case-insensitive name at the same level, and de-dupes
 * cards per folder by canonical URL, so re-importing is idempotent. All
 * mutations are committed in a single setState at the end to avoid
 * intermediate re-renders and read-modify-write races on the store.
 */
import {
	type BookmarkTreeFolder,
	planBookmarkMerge,
} from "../lib/bookmark-merge";
import { normalizeBrowserBookmarkTree } from "../lib/browser-bookmark-tree";
import { extApi } from "../lib/extension-api";
import {
	getOrderedRefs,
	type ItemOrder,
	ROOT_CONTAINER,
	repairItemOrder,
} from "../lib/item-order";
import { parseNetscapeTree } from "../lib/netscape-bookmarks";
import { isAbsoluteHttpUrl } from "../lib/url";
import { useSetupStore } from "../stores/setup-store";
import type { Card, Folder } from "../types";

export interface BookmarkImportResult {
	foldersCreated: number;
	cardsCreated: number;
	/** First folder that gained content (reveal target), if any. */
	revealFolderId: string | null;
}

interface ParsedLink {
	title: string;
	url: string;
}

/** A parsed node from a Netscape bookmark file: a folder with its children. */
interface ParsedFolder {
	name: string;
	links: ParsedLink[];
	children: ParsedFolder[];
	entries: Array<
		| { kind: "link"; title: string; url: string }
		| { kind: "folder"; folder: ParsedFolder }
	>;
}

/** A folder in a normalized bookmark tree (HTML file or browser bookmarks). */
export type { BookmarkTreeFolder };

/** Escape text for safe embedding in an HTML attribute or text node. */
function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/**
 * Export kTab's folders and cards as a Netscape Bookmark File, downloaded
 * as `ktab-bookmarks.html`. Hierarchy is preserved (roots → children via
 * parentId) and empty folders are included so the structure round-trips.
 */
export function serializeBookmarksHtml(
	folders: Folder[],
	cards: Card[],
	itemOrder?: ItemOrder,
): string {
	const ordered = repairItemOrder(itemOrder, folders, cards);
	const folderIds = new Set(folders.map((f) => f.id));

	// Group folders by parent; orphaned parentId values fall back to root.
	const childrenByParent = new Map<string | null, Folder[]>();
	for (const folder of folders) {
		const rawParentId = folder.parentId ?? null;
		const parentId =
			rawParentId !== null && folderIds.has(rawParentId) ? rawParentId : null;
		const list = childrenByParent.get(parentId);
		if (list) list.push(folder);
		else childrenByParent.set(parentId, [folder]);
	}
	for (const list of childrenByParent.values())
		list.sort((a, b) => a.order - b.order);

	// Group cards by folder; cards whose folder is missing are skipped.
	const cardsByFolder = new Map<string, Card[]>();
	for (const card of cards) {
		if (!folderIds.has(card.folderId)) continue;
		const list = cardsByFolder.get(card.folderId);
		if (list) list.push(card);
		else cardsByFolder.set(card.folderId, [card]);
	}
	for (const list of cardsByFolder.values())
		list.sort((a, b) => a.order - b.order);
	const folderById = new Map(folders.map((folder) => [folder.id, folder]));
	const cardById = new Map(cards.map((card) => [card.id, card]));

	const lines: string[] = [
		"<!DOCTYPE NETSCAPE-Bookmark-file-1>",
		"<!-- This is an automatically generated file.",
		"It will be read and overwritten.",
		"DO NOT EDIT! -->",
		'<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
		"<TITLE>Bookmarks</TITLE>",
		"<H1>Bookmarks</H1>",
		"<DL><p>",
	];

	const emitFolder = (folder: Folder, depth: number): void => {
		const indent = "    ".repeat(depth);
		lines.push(`${indent}<DT><H3>${escapeHtml(folder.name)}</H3>`);
		lines.push(`${indent}<DL><p>`);
		for (const ref of getOrderedRefs(
			folder.id,
			childrenByParent.get(folder.id) ?? [],
			cardsByFolder.get(folder.id) ?? [],
			ordered,
		)) {
			if (ref.kind === "folder") {
				const child = folderById.get(ref.id);
				if (child) emitFolder(child, depth + 1);
			} else {
				const card = cardById.get(ref.id);
				if (!card || !isAllowedScheme(card.url)) continue;
				lines.push(
					`${indent}    <DT><A HREF="${escapeHtml(card.url)}">${escapeHtml(card.title)}</A>`,
				);
			}
		}
		lines.push(`${indent}</DL><p>`);
	};

	for (const ref of getOrderedRefs(
		ROOT_CONTAINER,
		childrenByParent.get(null) ?? [],
		[],
		ordered,
	)) {
		const root = folderById.get(ref.id);
		if (root) emitFolder(root, 1);
	}
	lines.push("</DL><p>");
	return lines.join("\n");
}

export async function exportBookmarksHtml(): Promise<void> {
	const { folders, cards, itemOrder } = useSetupStore.getState();
	const blob = new Blob([serializeBookmarksHtml(folders, cards, itemOrder)], {
		type: "text/html",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "ktab-bookmarks.html";
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** True when the href is an absolute http: or https: URL. */
function isAllowedScheme(href: string): boolean {
	return isAbsoluteHttpUrl(href);
}

/**
 * Merge a normalized bookmark tree into kTab as folders + cards.
 * Plans purely, then commits a single store update (plus the repaired
 * ordering) so a failed import can never leave a half-written library.
 * See lib/bookmark-merge for the merge rules.
 */
export function mergeBookmarkTree(
	rootFolders: BookmarkTreeFolder[],
	rootLinks: { title: string; url: string }[],
): BookmarkImportResult {
	const store = useSetupStore.getState();
	const plan = planBookmarkMerge(
		store.folders,
		store.cards,
		rootFolders,
		rootLinks,
		store.itemOrder,
	);

	if (plan.foldersCreated > 0 || plan.cardsCreated > 0) {
		// repairItemOrder appends the newly imported entities to their
		// containers, so the unified ordering survives bulk imports.
		useSetupStore.setState({
			folders: plan.folders,
			cards: plan.cards,
			itemOrder: plan.itemOrder,
		});
	}

	return {
		foldersCreated: plan.foldersCreated,
		cardsCreated: plan.cardsCreated,
		revealFolderId: plan.touchedFolderIds[0] ?? null,
	};
}

export interface BookmarkReplaceResult extends BookmarkImportResult {
	/** First folder with imported content (reveal target), if any. */
	revealFolderId: string | null;
}

/**
 * Replace the library with a bookmark tree: plan against an empty library,
 * then swap folders/cards/active folder in one commit. Settings are kept.
 */
export function replaceBookmarkLibrary(
	rootFolders: BookmarkTreeFolder[],
	rootLinks: { title: string; url: string }[],
): BookmarkReplaceResult {
	const plan = planBookmarkMerge([], [], rootFolders, rootLinks);
	const firstFolder = plan.folders[0] ?? null;
	useSetupStore.setState({
		folders: plan.folders,
		cards: plan.cards,
		activeFolderId: firstFolder?.id ?? "default",
		itemOrder: plan.itemOrder,
	});
	return {
		foldersCreated: plan.foldersCreated,
		cardsCreated: plan.cardsCreated,
		revealFolderId: plan.touchedFolderIds[0] ?? firstFolder?.id ?? null,
	};
}

export interface ParsedBookmarkFile {
	rootFolders: ParsedFolder[];
	rootLinks: ParsedLink[];
}

/**
 * Parse a Netscape Bookmark File without touching state: used for the
 * pre-import preview (counts) in the Keep/Replace choice, so malformed or
 * empty files fail before any dialog opens. Throws on the same conditions
 * as the import itself.
 */
export function parseNetscapeBookmarkFile(
	fileText: string,
): ParsedBookmarkFile {
	const parsed = parseNetscapeTree(fileText);
	const hasToolbarMarker = parsed.rootFolders.some(
		(folder) => folder.personalToolbar,
	);
	if (!hasToolbarMarker) return parsed;
	const rootFolders: ParsedFolder[] = [];
	const rootLinks = [...parsed.rootLinks];
	const nativeNames = new Set([
		"bookmarks bar",
		"bookmarks toolbar",
		"other bookmarks",
		"mobile bookmarks",
		"bookmarks menu",
	]);
	for (const folder of parsed.rootFolders) {
		// The marker is semantic; companion browser containers lack it in
		// Netscape HTML, so their known export names are the conservative fallback.
		// User folders beside these containers remain roots.
		if (folder.personalToolbar || nativeNames.has(folder.name.toLowerCase())) {
			rootFolders.push(...folder.children);
			rootLinks.push(...folder.links);
		} else rootFolders.push(folder);
	}
	return { rootFolders, rootLinks };
}

export interface BookmarkImportOptions {
	/** Replace the library instead of merging into it. */
	replace?: boolean;
}

/**
 * Import a Netscape Bookmark File (as exported by Chrome or Firefox) into
 * kTab as folders + cards. Throws when the file contains no folders
 * or links. Merge semantics are provided by {@link mergeBookmarkTree};
 * replace mode swaps the whole library via {@link replaceBookmarkLibrary}.
 */
export async function importBookmarksHtml(
	fileText: string,
	options: BookmarkImportOptions = {},
): Promise<BookmarkImportResult> {
	const { rootFolders, rootLinks } = parseNetscapeBookmarkFile(fileText);
	if (options.replace) return replaceBookmarkLibrary(rootFolders, rootLinks);
	return mergeBookmarkTree(rootFolders, rootLinks);
}

/**
 * Import the browser's own bookmark tree (chrome.bookmarks) into kTab.
 * The native root containers ("Bookmarks Bar", "Other Bookmarks", Firefox's
 * "Bookmarks Menu" and "Mobile Bookmarks") are containers, not user folders:
 * their children are hoisted to the top level, and a hoisted container's
 * direct links join the loose root links (merged into the catch-all
 * "Bookmarks" folder). Only http(s) links are imported. Merge semantics are
 * provided by {@link mergeBookmarkTree}.
 */
/**
 * Read + convert the browser tree without touching state (preview step).
 * Throws when unsupported, unreadable, or empty — before any dialog opens.
 */
export async function readBrowserBookmarks(): Promise<{
	topFolders: BookmarkTreeFolder[];
	topLinks: { title: string; url: string }[];
}> {
	if (!extApi() || !extApi().bookmarks?.getTree) {
		throw new Error("Bookmark import is not supported in this browser.");
	}

	let tree: chrome.bookmarks.BookmarkTreeNode[];
	try {
		tree = await extApi().bookmarks.getTree();
	} catch (err) {
		throw new Error(
			"Could not read browser bookmarks. Check the extension permissions.",
			{ cause: err },
		);
	}

	const { topFolders, topLinks } = normalizeBrowserBookmarkTree(tree);

	const hasLinks = (folder: BookmarkTreeFolder): boolean =>
		folder.links.length > 0 || folder.children.some(hasLinks);
	if (topLinks.length === 0 && !topFolders.some(hasLinks)) {
		throw new Error("No bookmarks found in this browser.");
	}

	return { topFolders, topLinks };
}

export async function importBookmarksFromBrowser(
	options: BookmarkImportOptions = {},
): Promise<BookmarkImportResult> {
	const { topFolders, topLinks } = await readBrowserBookmarks();
	if (options.replace) return replaceBookmarkLibrary(topFolders, topLinks);
	return mergeBookmarkTree(topFolders, topLinks);
}
