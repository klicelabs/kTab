import type { DragEvent } from "react";

/**
 * Shared drag payload conventions. Drop targets need to tell a card drag from a
 * folder drag, so we encode the kind in a dedicated MIME type alongside the raw
 * id in text/plain (kept for Firefox compatibility and native fallbacks).
 */
export type DragKind = "card" | "folder";

const KIND_PREFIX = "application/x-ktab-";

export interface ActiveDrag {
	kind: DragKind;
	id: string;
}

// Native drag events outlive React renders (and can outlive the source node
// when spring-load navigation swaps a folder). Keep only the small payload in
// module state so a newly rendered drop target can still resolve it.
let _activeDrag: ActiveDrag | null = null;

/** Get the currently active in-memory drag state (available during dragover). */
export function getActiveDrag(): ActiveDrag | null {
	return _activeDrag ? { ..._activeDrag } : null;
}

/** Set or clear the active in-memory drag state. */
export function setActiveDrag(drag: ActiveDrag | null): void {
	_activeDrag = drag;
}

/** Clear the payload at a terminal drag boundary (drop, dragend, or cancel). */
export function clearActiveDrag(): void {
	_activeDrag = null;
}

/** Write both the raw id (text/plain) and a typed marker for the drag kind. */
export function setDragData(e: DragEvent, kind: DragKind, id: string): void {
	setActiveDrag({ kind, id });
	e.dataTransfer.effectAllowed = "move";
	try {
		e.dataTransfer.setData("text/plain", id);
		e.dataTransfer.setData(`${KIND_PREFIX}${kind}`, id);
	} catch {
		// Some environments disallow setData during dragstart; safe to ignore.
	}
}

/** True when the active drag carries the given kind (checkable during dragOver). */
export function isDragKind(e: DragEvent, kind: DragKind): boolean {
	if (_activeDrag) {
		return _activeDrag.kind === kind;
	}
	return e.dataTransfer.types.includes(`${KIND_PREFIX}${kind}`);
}

/**
 * Props a grid item spreads onto its draggable element. Owned by the grid's
 * DnD coordinator; cards/folders stay presentational.
 */
export interface GridItemDragProps {
	draggable: boolean;
	/**
	 * H11: stable identity hooks for the autoscroll re-hit-test — the
	 * pointer can hold still while the container scrolls, so the rehit
	 * dispatches a synthetic dragover at the element now under it.
	 */
	"data-dnd-item"?: string;
	"data-dnd-kind"?: DragKind;
	onDragStart: (e: DragEvent) => void;
	onDragEnd: (e: DragEvent) => void;
	onDragOver: (e: DragEvent) => void;
	onDragLeave: (e: DragEvent) => void;
	onDrop: (e: DragEvent) => void;
}

/**
 * Which part of a drop target the pointer is over. Edges mean "insert
 * before/after" (reorder); the center means "drop onto/into" (nest/combine).
 * Shared by the grid and the tabbar so intent reads identically everywhere.
 */
export type DropZone = "before" | "after" | "center";

/** Preview cells always represent insertion, including over their center. */
export function insertPositionFor(
	e: DragEvent,
	el: HTMLElement,
): "before" | "after" {
	const rect = el.getBoundingClientRect();
	return e.clientX < rect.left + rect.width / 2 ? "before" : "after";
}

/**
 * H11: after an autoscroll delta the content under a stationary pointer has
 * moved. Re-hit-test and re-dispatch an item dragover there so the intent
 * visual and the eventual drop position track the CONTENT, not the screen.
 * Returns whether a dragover was re-dispatched.
 */
export function redispatchDragoverAt(
	pointer: { x: number; y: number },
	draggedId: string,
	doc: Pick<Document, "elementFromPoint"> = document,
): boolean {
	if (typeof doc.elementFromPoint !== "function") return false;
	const hit = doc.elementFromPoint(pointer.x, pointer.y);
	const el = hit?.closest<HTMLElement>("[data-dnd-item]");
	const id = el?.dataset.dndItem;
	const kind = el?.dataset.dndKind;
	if (!el || !id || (kind !== "card" && kind !== "folder")) return false;
	if (id === draggedId) return false;
	const event = new Event("dragover", { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		clientX: { value: pointer.x },
		clientY: { value: pointer.y },
	});
	el.dispatchEvent(event);
	return true;
}

export function dropZoneFor(e: DragEvent, el: HTMLElement): DropZone {
	const rect = el.getBoundingClientRect();
	// Y-aware zones for wrapping grids: a pointer clearly above/below the
	// tile's vertical middle is a reorder signal even when horizontally
	// central. This keeps top/bottom approaches forgiving across rows and
	// variable heights, while the X ratio still decides within the middle
	// band. Wide (multi-cell folder) tiles keep X-dominant behavior because
	// their center band is physically meaningful.
	const ratioX = (e.clientX - rect.left) / Math.max(1, rect.width);
	const ratioY = (e.clientY - rect.top) / Math.max(1, rect.height);
	const isWide = rect.width > rect.height * 1.5;
	if (!isWide) {
		// L5: the Y bands are unconditional — the previous X guards created a
		// corner inversion (top-right corner fell through to X>0.72 → "after"
		// while the mirrored bottom-left said "before"). A pointer clearly in
		// the top strip now ALWAYS inserts before, bottom strip always after,
		// corners included; the middle band keeps the horizontal contract.
		if (ratioY < 0.25) return "before";
		if (ratioY > 0.75) return "after";
	}
	if (ratioX < 0.28) return "before";
	if (ratioX > 0.72) return "after";
	return "center";
}

/** Horizontal extent of one tab, in client coordinates. */
export interface TabBox {
	id: string;
	left: number;
	right: number;
}

/**
 * Half-width of a gap band, in pixels. Two neighbouring tabs share the band
 * across their boundary, so the full reorder slot is twice this — wide enough
 * to hit without threading the 2px visual gap, narrow enough that the middle
 * of a tab still reads as "on top of this tab".
 */
export const TAB_GAP_HALF = 5;

/**
 * Where a pointer over the tab bar lands.
 *
 * The bar reorders roots by dropping into a GAP, not onto a tab edge: the
 * band around every boundary (plus a band before the first tab and after the
 * last) inserts at that position, and it wins even where it overlaps a tab's
 * own padding. Everywhere else the pointer is over a tab body, which nests.
 * One function decides, so the two intents can never fight over the same
 * pixel — the gap is not "a narrower edge", it is the only reorder target.
 */
export type TabDropTarget =
	| { kind: "gap"; key: string; position: "before" | "after" }
	| { kind: "nest"; id: string };

export function tabDropTargetFor(
	clientX: number,
	tabs: readonly TabBox[],
	gapHalf = TAB_GAP_HALF,
): TabDropTarget | null {
	const first = tabs[0];
	const last = tabs[tabs.length - 1];
	if (!first || !last) return null;

	// Outer bands: past either end of the lane appends at that end.
	if (clientX <= first.left + gapHalf) {
		return { kind: "gap", key: first.id, position: "before" };
	}
	if (clientX >= last.right - gapHalf) {
		return { kind: "gap", key: last.id, position: "after" };
	}

	// Inner boundaries. Anchored on the NEXT tab's leading edge, so the rail
	// is drawn by the tab the item is about to land in front of.
	for (let i = 0; i < tabs.length - 1; i++) {
		const before = tabs[i];
		const after = tabs[i + 1];
		if (!before || !after) continue;
		const boundary = (before.right + after.left) / 2;
		if (Math.abs(clientX - boundary) <= gapHalf) {
			return { kind: "gap", key: after.id, position: "before" };
		}
	}

	const hit = tabs.find((tab) => clientX >= tab.left && clientX <= tab.right);
	return hit ? { kind: "nest", id: hit.id } : null;
}

/**
 * Index a gap target inserts at, or -1 when the anchor is unknown. Compared
 * against the dragged item's current index, this is what tells a real move
 * from a drop that would land it exactly where it already is.
 */
export function tabGapIndex(
	tabs: readonly TabBox[],
	target: { key: string; position: "before" | "after" },
): number {
	const anchor = tabs.findIndex((tab) => tab.id === target.key);
	if (anchor === -1) return -1;
	return target.position === "after" ? anchor + 1 : anchor;
}

/** Resolve the active drag during over/drop: in-memory first (same-document,
 * reliable mid-drag), dataTransfer types as the cross-window fallback. */
export function resolveDragRef(e: DragEvent): ActiveDrag | null {
	if (_activeDrag) return { ..._activeDrag };
	if (e.dataTransfer.types.includes(`${KIND_PREFIX}card`)) {
		return { kind: "card", id: getDragId(e) };
	}
	if (e.dataTransfer.types.includes(`${KIND_PREFIX}folder`)) {
		return { kind: "folder", id: getDragId(e) };
	}
	return null;
}

/** Read the dragged id on drop, falling back to in-memory active drag. */
export function getDragId(e: DragEvent): string {
	if (_activeDrag) {
		return _activeDrag.id;
	}
	try {
		return e.dataTransfer.getData("text/plain");
	} catch {
		return "";
	}
}
