/**
 * Command-history vocabulary for kTab.
 *
 * Every reversible operation is a compact inverse-data entry (never a full
 * app snapshot): affected container key arrays plus affected entity parents,
 * before and after. Descriptions are first-class — toast, confirmation and
 * history UI copy all derive from the same summary, never ad hoc strings.
 */

import type { Card, Folder } from "../types";
import { ROOT_CONTAINER } from "./item-order";

/** Display name for a container key (ROOT = top level, unknown = Home). */
export function historyContainerName(
	container: string,
	folders: readonly Pick<Folder, "id" | "name">[],
): string {
	if (container === ROOT_CONTAINER) return "Top level";
	return folders.find((f) => f.id === container)?.name ?? "Home";
}

/** Recent-operation bound. Session-scoped; old entries fall off the top. */
export const HISTORY_LIMIT = 30;

export type HistoryKind =
	| "move"
	| "reorder"
	| "combine"
	| "create"
	| "rename"
	| "update"
	| "delete";

/**
 * What happened, in UI words. `dest` is the destination folder name (moves);
 * `container` is the container display name (reorders). `label` names a
 * single moved item (card title / folder name).
 */
export interface HistorySummary {
	kind: HistoryKind;
	total: number;
	cardCount: number;
	folderCount: number;
	dest?: string;
	container?: string;
	label?: string;
	/** Rename target name (kind "rename" only). */
	newName?: string;
}

export interface HistorySnapshot {
	/** Container key → ordered item keys, for every touched container. */
	containers: Record<string, string[]>;
	/** Card id → folder id, for every touched card. */
	cards: Record<string, string>;
	/** Folder id → parent id (null = root), for every touched folder. */
	folders: Record<string, string | null>;
	/** Full records to restore (entities deleted by the action). */
	putCards: Card[];
	putFolders: Folder[];
	/** Ids to remove (entities created by the action). */
	delCardIds: string[];
	delFolderIds: string[];
	/**
	 * Rename-only folder ids (kind "rename" only).
	 *
	 * Why this exists: applyHistorySnapshot in setup-store replaces whole
	 * folder records on putFolders, so replaying a stale full record would
	 * clobber concurrent fields (order, parentId, …). The applier owner will
	 * merge only `name` for these ids; until then putFolders is retained for
	 * backward compatibility.
	 */
	nameOnlyIds?: string[];
	/** Field-level card patches for metadata edits (H2). */
	cardPatches?: Record<string, Partial<Card>>;
	/**
	 * Location to restore alongside the tree (optional).
	 *
	 * Why: a few actions also move the user — "Move to…" on the folder you are
	 * standing in navigates to the destination, so the breadcrumb and the
	 * active tab keep describing a place that exists where the user left it.
	 * Undo has to revert the whole gesture (tree AND view) as ONE entry, so the
	 * location rides on the snapshot instead of becoming a second entry or a
	 * second undo step. Absent for every action that does not navigate.
	 */
	location?: string;
}

export interface HistoryEntry {
	id: string;
	at: number;
	summary: HistorySummary;
	undo: HistorySnapshot;
	redo: HistorySnapshot;
	/**
	 * Thumbnail byte ids staged for deletion.
	 *
	 * Why: bytes must survive while the entry is undoable (undo may need to
	 * restore them) and are deleted best-effort once the entry leaves both
	 * stacks (eviction or redo-branch discard).
	 */
	thumbnails?: string[];
}

export type HistoryDirection = "undo" | "redo";

export interface PendingConfirmation {
	direction: HistoryDirection;
	/** Entry ids top-down (cascade for undo-to-here / redo-to-here). */
	entryIds: string[];
}

function itemNoun(
	total: number,
	cardCount: number,
	folderCount: number,
): string {
	if (total === 1 && cardCount === 1) return "bookmark";
	if (total === 1 && folderCount === 1) return "folder";
	if (cardCount > 0 && folderCount === 0) {
		return total === 1 ? "bookmark" : "bookmarks";
	}
	if (folderCount > 0 && cardCount === 0) {
		return total === 1 ? "folder" : "folders";
	}
	return total === 1 ? "item" : "items";
}

function moveObject(summary: HistorySummary): string {
	if (summary.total === 1 && summary.label) return `“${summary.label}”`;
	return `${summary.total} ${itemNoun(summary.total, summary.cardCount, summary.folderCount)}`;
}

/** "Moved 5 items to Design" — post-action and redo follow-ups. */
export function describeHistoryPast(summary: HistorySummary): string {
	if (summary.kind === "reorder") {
		const where = summary.container ?? "this folder";
		return summary.total === 1
			? `Reordered in ${where}`
			: `Reordered ${summary.total} items in ${where}`;
	}
	if (summary.kind === "combine") {
		return `Combined ${summary.total} ${itemNoun(summary.total, summary.cardCount, summary.folderCount)} into a new folder`;
	}
	if (summary.kind === "create") {
		return `Created folder “${summary.label ?? "Untitled"}”${createdWith(summary)}`;
	}
	if (summary.kind === "rename") {
		return `Renamed “${summary.label}” to “${summary.newName}”`;
	}
	if (summary.kind === "update") {
		return `Updated bookmark “${summary.label ?? ""}”`;
	}
	if (summary.kind === "delete") {
		if (summary.folderCount === 0) {
			return summary.total === 1
				? `Deleted bookmark “${summary.label ?? ""}”`
				: `Deleted ${summary.total} bookmarks`;
		}
		return `Deleted folder “${summary.label}”${deletedWith(summary)}`;
	}
	const dest = summary.dest ?? "another folder";
	if (summary.total === 1 && summary.label) {
		return `Moved “${summary.label}” to ${dest}`;
	}
	return `${capitalize(moveObject(summary))} moved to ${dest}`;
}

/** "moving 5 items to Design" — confirmation questions. */
export function describeHistoryGerund(summary: HistorySummary): string {
	if (summary.kind === "reorder") {
		const where = summary.container ?? "this folder";
		return summary.total === 1
			? `reordering in ${where}`
			: `reordering ${summary.total} items in ${where}`;
	}
	if (summary.kind === "combine") {
		return `combining ${summary.total} ${itemNoun(summary.total, summary.cardCount, summary.folderCount)} into a new folder`;
	}
	if (summary.kind === "create") {
		return `creating folder “${summary.label ?? "Untitled"}”${createdWith(summary)}`;
	}
	if (summary.kind === "rename") {
		return `renaming “${summary.label}” to “${summary.newName}”`;
	}
	if (summary.kind === "update") {
		return `updating bookmark “${summary.label ?? ""}”`;
	}
	if (summary.kind === "delete") {
		if (summary.folderCount === 0) {
			return summary.total === 1
				? `deleting bookmark “${summary.label ?? ""}”`
				: `deleting ${summary.total} bookmarks`;
		}
		return `deleting folder “${summary.label}”${deletedWith(summary)}`;
	}
	const dest = summary.dest ?? "another folder";
	return `moving ${moveObject(summary)} to ${dest}`;
}

/** "Move 5 items to Design" — history list rows and menu items. */
export function describeHistoryAction(summary: HistorySummary): string {
	if (summary.kind === "reorder") {
		const where = summary.container ?? "this folder";
		return summary.total === 1
			? `Reorder in ${where}`
			: `Reorder ${summary.total} items in ${where}`;
	}
	if (summary.kind === "combine") {
		return `Combine ${summary.total} ${itemNoun(summary.total, summary.cardCount, summary.folderCount)} into a new folder`;
	}
	if (summary.kind === "create") {
		return `Create folder “${summary.label ?? "Untitled"}”${createdWith(summary)}`;
	}
	if (summary.kind === "rename") {
		return `Rename “${summary.label}” to “${summary.newName}”`;
	}
	if (summary.kind === "update") {
		return `Update bookmark “${summary.label ?? ""}”`;
	}
	if (summary.kind === "delete") {
		if (summary.folderCount === 0) {
			return summary.total === 1
				? `Delete bookmark “${summary.label ?? ""}”`
				: `Delete ${summary.total} items`;
		}
		return `Delete folder “${summary.label}”${deletedWith(summary)}`;
	}
	const dest = summary.dest ?? "another folder";
	return `Move ${moveObject(summary)} to ${dest}`;
}

function capitalize(text: string): string {
	return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

/** " with 5 items" suffix for creates that grouped members, else "". */
function createdWith(summary: HistorySummary): string {
	const moved = summary.cardCount + summary.folderCount;
	if (moved <= 0) return "";
	return ` with ${moved} ${itemNoun(moved, summary.cardCount, summary.folderCount)}`;
}

/** " (4 bookmarks, 1 folder)" suffix for deletes with contents, else "". */
function deletedWith(summary: HistorySummary): string {
	const inside = summary.cardCount + summary.folderCount;
	if (inside <= 0) return "";
	const parts: string[] = [];
	if (summary.cardCount > 0) {
		parts.push(
			`${summary.cardCount} ${summary.cardCount === 1 ? "bookmark" : "bookmarks"}`,
		);
	}
	if (summary.folderCount > 0) {
		parts.push(
			`${summary.folderCount} ${summary.folderCount === 1 ? "subfolder" : "subfolders"}`,
		);
	}
	return ` (${parts.join(", ")})`;
}

/**
 * Native text editing wins: history shortcuts stay out of inputs,
 * textareas, contenteditables, selects and open dialogs.
 */
export function isHistoryEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return Boolean(
		target.closest(
			'input, textarea, select, [contenteditable="true"], [role="dialog"], dialog',
		),
	);
}

// ---------------------------------------------------------------------------
// Pure stack transitions (unit-tested; the store is a thin shell over these).
// ---------------------------------------------------------------------------

export interface HistoryStacks {
	past: HistoryEntry[];
	future: HistoryEntry[];
}

/**
 * Commit: append bounded, discard the redo branch.
 *
 * Returns evicted entries (past overflow + discarded redo branch) so the
 * store can delete their staged thumbnail bytes best-effort. Pure: the
 * caller owns the side effect, keeping this transition unit-testable.
 */
export function commitToStacks(
	stacks: HistoryStacks,
	entry: HistoryEntry,
): HistoryStacks & { evicted: HistoryEntry[] } {
	const past = [...stacks.past, entry].slice(-HISTORY_LIMIT);
	const droppedCount = stacks.past.length + 1 - past.length;
	const evictedPast =
		droppedCount > 0 ? stacks.past.slice(0, droppedCount) : [];
	return {
		past,
		future: [],
		evicted: [...evictedPast, ...stacks.future],
	};
}

/**
 * Collect staged thumbnail ids across entries, in order, skipping empties.
 *
 * Why a helper: the store deletes bytes on eviction, but tests must stay on
 * pure functions (history-store pulls the setup-store chain, which breaks
 * under bun cross-file imports), so the flattening lives here where it is
 * unit-testable.
 */
export function stagedThumbnailIds(
	entries: readonly Pick<HistoryEntry, "thumbnails">[],
): string[] {
	const ids: string[] = [];
	for (const entry of entries) {
		if (entry.thumbnails) ids.push(...entry.thumbnails);
	}
	return ids;
}

/** Minimal card shape the GC needs to decide if bytes are still referenced. */
type GcCard = { thumbId?: string | null };

/**
 * Thumbnail ids safe to delete for good: staged ids on entries leaving the
 * history (past overflow, discarded redo branch, pruned/cleared stacks)
 * MINUS every id still referenced by a live card.
 *
 * Why the live check: an undone delete keeps its bytes referenced through
 * the restored cards, so a redo-branch discard must not GC them. A pure
 * filter covering ALL discard paths at once — no path-specific reasoning —
 * ids referenced by nothing (true garbage) are always collected, ids any
 * live card may still render are always kept.
 */
export function collectGcableThumbnailIds(
	entries: readonly Pick<HistoryEntry, "thumbnails">[],
	liveCards: readonly GcCard[],
): string[] {
	const referenced = new Set(
		liveCards.map((c) => c.thumbId).filter((t): t is string => Boolean(t)),
	);
	return stagedThumbnailIds(entries).filter((id) => !referenced.has(id));
}

/**
 * Undo the given ids strictly top-down; stops at the first mismatch so a
 * stale cascade can never skip entries. Returns the matched entries (in
 * apply order) plus the resulting stacks.
 */
export function popUndoIds(
	stacks: HistoryStacks,
	ids: readonly string[],
): { entries: HistoryEntry[]; stacks: HistoryStacks } {
	const entries: HistoryEntry[] = [];
	let past = [...stacks.past];
	const undone: HistoryEntry[] = [];
	for (const id of ids) {
		const top = past[past.length - 1];
		if (!top || top.id !== id) break;
		entries.push(top);
		past = past.slice(0, -1);
		undone.push(top);
	}
	// Why reversed: entries are in apply order (top-down, e.g. [c, b]) but
	// future is redo-ready head-first (newest-undone first, e.g. [b, c]).
	// Sequential single undos prepend one at a time, so a cascade must
	// prepend reversed to stay equivalent.
	return {
		entries,
		stacks: {
			past,
			future: [...[...undone].reverse(), ...stacks.future].slice(
				0,
				HISTORY_LIMIT,
			),
		},
	};
}

/** Redo mirror: strictly head-first through the future branch. */
export function popRedoIds(
	stacks: HistoryStacks,
	ids: readonly string[],
): { entries: HistoryEntry[]; stacks: HistoryStacks } {
	const entries: HistoryEntry[] = [];
	let future = [...stacks.future];
	const redone: HistoryEntry[] = [];
	for (const id of ids) {
		const top = future[0];
		if (!top || top.id !== id) break;
		entries.push(top);
		future = future.slice(1);
		redone.push(top);
	}
	return {
		entries,
		stacks: {
			past: [...stacks.past, ...redone].slice(-HISTORY_LIMIT),
			future,
		},
	};
}
