/**
 * Tab-bar gap model — reorder lives in the GAPS, nesting lives on the tabs.
 * Run: cd apps/extension && bun test scripts/verify-tab-gap-drop.test.tsx
 *
 * Two seams:
 *  1. `tabDropTargetFor` / `tabGapIndex` — pure geometry, asserted directly.
 *  2. The rendered bar — asserted through real drag events, because the whole
 *     point of the change is which element decides the intent, and that is
 *     only visible in the DOM.
 */

import { afterEach, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FolderTabs } from "../src/components/newtab/toolbar/folder-tabs";
import { useGridDnd } from "../src/hooks/use-grid-dnd";
import {
	clearActiveDrag,
	TAB_GAP_HALF,
	type TabBox,
	tabDropTargetFor,
	tabGapIndex,
} from "../src/lib/dnd";
import type { ItemRef } from "../src/lib/item-order";
import type { Folder } from "../src/types";

declare global {
	// Mirrors the declaration in hooks/use-grid-dnd.ts (same shape, so the two
	// merge rather than conflict).
	// eslint-disable-next-line no-var
	var __ktabDndGestureEpoch: number | undefined;
}

// ---- Pure geometry -------------------------------------------------------

// Two-pixel visual gaps, exactly like the real lane (`gap-0.5`).
const LANE: TabBox[] = [
	{ id: "a", left: 0, right: 100 },
	{ id: "b", left: 102, right: 202 },
	{ id: "c", left: 204, right: 304 },
];

test("the reorder slot spans a boundary, not the whole tab", () => {
	// A 10px slot centred on the a|b boundary (x=101).
	expect(TAB_GAP_HALF * 2).toBe(10);
	for (const x of [96, 98, 101, 104, 106]) {
		expect(tabDropTargetFor(x, LANE)).toEqual({
			kind: "gap",
			key: "b",
			position: "before",
		});
	}
});

test("a gap wins even where it overlaps the neighbouring tab's own padding", () => {
	// x=97 is inside tab a's box (0..100) and inside the slot: the gap must
	// win, or the pointer would have to thread a 2px slot to reorder.
	expect(tabDropTargetFor(97, LANE)).toEqual({
		kind: "gap",
		key: "b",
		position: "before",
	});
	// x=105 is inside tab b's box (102..202) and inside the same slot.
	expect(tabDropTargetFor(105, LANE)).toEqual({
		kind: "gap",
		key: "b",
		position: "before",
	});
});

test("the body of a tab nests", () => {
	expect(tabDropTargetFor(50, LANE)).toEqual({ kind: "nest", id: "a" });
	expect(tabDropTargetFor(150, LANE)).toEqual({ kind: "nest", id: "b" });
	expect(tabDropTargetFor(250, LANE)).toEqual({ kind: "nest", id: "c" });
});

test("the lane ends are slots too, so a tab can go first or last", () => {
	expect(tabDropTargetFor(3, LANE)).toEqual({
		kind: "gap",
		key: "a",
		position: "before",
	});
	expect(tabDropTargetFor(301, LANE)).toEqual({
		kind: "gap",
		key: "c",
		position: "after",
	});
	// Past the end of the lane still appends at the end.
	expect(tabDropTargetFor(900, LANE)).toEqual({
		kind: "gap",
		key: "c",
		position: "after",
	});
});

test("an empty lane has no target", () => {
	expect(tabDropTargetFor(10, [])).toBeNull();
});

test("a gap target maps to the index it inserts at", () => {
	expect(tabGapIndex(LANE, { key: "b", position: "before" })).toBe(1);
	expect(tabGapIndex(LANE, { key: "a", position: "before" })).toBe(0);
	expect(tabGapIndex(LANE, { key: "c", position: "after" })).toBe(3);
	expect(tabGapIndex(LANE, { key: "missing", position: "before" })).toBe(-1);
});

// ---- The rendered bar ----------------------------------------------------

const { window } = parseHTML(
	"<!doctype html><html><body><div id=app></div></body></html>",
);

Object.assign(globalThis, {
	window,
	document: window.document,
	self: window,
	navigator: window.navigator,
	HTMLElement: window.HTMLElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	requestAnimationFrame: (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	// linkedom ships neither of these; GlassSurface measures itself with one
	// and reads tokens with the other, and neither result matters here.
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
	matchMedia: () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}),
});

// linkedom has no scrolling; the grid's autoscroll loop reads both.
Object.defineProperty(window, "innerHeight", {
	configurable: true,
	value: 1000,
});
window.scrollBy = () => undefined;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// linkedom has no layout engine: every rect is 0×0. The bar's whole job is
// geometry, so give the three test tabs the boxes the pure tests above use.
const LAYOUT: Record<string, { left: number; right: number }> = {
	a: { left: 0, right: 100 },
	b: { left: 102, right: 202 },
	c: { left: 204, right: 304 },
};
Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
	configurable: true,
	value(this: HTMLElement) {
		const box = this.dataset?.tabId ? LAYOUT[this.dataset.tabId] : undefined;
		const left = box?.left ?? 0;
		const right = box?.right ?? 0;
		return {
			left,
			right,
			top: 0,
			bottom: 40,
			width: right - left,
			height: 40,
			x: left,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect;
	},
});

class TestDataTransfer {
	effectAllowed = "none";
	dropEffect = "none";
	private readonly values = new Map<string, string>();

	get types() {
		return [...this.values.keys()];
	}

	setData(type: string, value: string) {
		this.values.set(type, value);
	}

	getData(type: string) {
		return this.values.get(type) ?? "";
	}
}

function dispatchDrag(
	element: Element,
	type: "dragstart" | "dragover" | "drop" | "dragend",
	clientX: number,
	dataTransfer?: TestDataTransfer,
) {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		clientX: { value: clientX },
		clientY: { value: 20 },
		dataTransfer: { value: dataTransfer },
	});
	element.dispatchEvent(event);
}

const FOLDERS: Folder[] = [
	{ id: "a", name: "Alpha", parentId: null, order: 0 },
	{ id: "b", name: "Beta", parentId: null, order: 1 },
	{ id: "c", name: "Gamma", parentId: null, order: 2 },
];

// `FolderTabs` is imported statically above, like the other render harnesses in
// this folder. Its module graph is DOM-free at import time, so it is safe to
// evaluate before the shims below run. Do NOT switch this to a top-level
// `await import(...)`: that makes this file an async module, and Bun then
// evaluates the rest of the suite lazily — which registers `afterEach` in
// sibling files *after* the run has finished.

interface Calls {
	preview: string[];
	commit: string[];
	nest: string[];
	hoist: string[];
}

let root: Root | null = null;

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	globalThis.__ktabDndGestureEpoch = 0;
	clearActiveDrag();
	document.body.innerHTML = "<div id=app></div>";
});

function FolderTabsHarness({
	calls,
	canNestFolder,
	isRootFolder = () => true,
}: {
	calls: Calls;
	canNestFolder: (folderId: string, targetFolderId: string) => boolean;
	isRootFolder?: (id: string) => boolean;
}) {
	return (
		<FolderTabs
			folders={FOLDERS}
			hiddenFolders={[]}
			activeRootId="a"
			activeFolderId="a"
			navigationDirection="forward"
			onAddFolder={() => "new"}
			onSelectFolder={() => undefined}
			onPreviewReorderFolders={(from, to, position) =>
				calls.preview.push(`${from}>${to}:${position}`)
			}
			onCommitReorderFolders={(from, to, position) =>
				calls.commit.push(`${from}>${to}:${position}`)
			}
			onMoveFolders={(from, to) => calls.nest.push(`${from}>${to}`)}
			onMoveFolderToRoot={(from, to, position) =>
				calls.hoist.push(`${from}>${to}:${position}`)
			}
			isRootFolder={isRootFolder}
			canNestFolder={canNestFolder}
		/>
	);
}

async function mountBar(options?: {
	canNestFolder?: (folderId: string, targetFolderId: string) => boolean;
	isRootFolder?: (id: string) => boolean;
}) {
	const calls: Calls = { preview: [], commit: [], nest: [], hoist: [] };
	const mount = document.getElementById("app");
	if (!mount) throw new Error("test mount missing");
	root = createRoot(mount);
	const element = (
		<FolderTabsHarness
			calls={calls}
			canNestFolder={options?.canNestFolder ?? (() => true)}
			isRootFolder={options?.isRootFolder ?? (() => true)}
		/>
	);
	await act(async () => {
		root?.render(element);
	});
	return calls;
}

function tab(id: string) {
	const el = document.querySelector<HTMLElement>(`[data-tab-id="${id}"]`);
	if (!el) throw new Error(`tab ${id} missing`);
	return el;
}

/** The wrapper that owns the drop surface (the tablist's parent). */
function lane() {
	const el = document.querySelector('[role="tablist"]')?.parentElement;
	if (!el) throw new Error("lane missing");
	return el;
}

test("a tab dragstart arms the same-document gesture, so the grid accepts the drop", async () => {
	await mountBar();
	expect(globalThis.__ktabDndGestureEpoch ?? 0).toBe(0);
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("a"), "dragstart", 50, transfer);
	});
	expect(globalThis.__ktabDndGestureEpoch ?? 0).toBeGreaterThan(0);
	// The payload the grid resolves on drop.
	expect(transfer.getData("text/plain")).toBe("a");
});

test("dragging a tab into a gap previews on hover and commits once on drop", async () => {
	const calls = await mountBar();
	const transfer = new TestDataTransfer();
	// c is last; the slot between a and b would put it there.
	await act(async () => {
		dispatchDrag(tab("c"), "dragstart", 250, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 101, transfer);
	});
	// The rail is drawn by the tab the item lands in front of.
	expect(tab("b").className).toContain("tab-insert-before");
	expect(calls.preview).toEqual(["c>b:before"]);
	expect(calls.commit).toEqual([]);

	await act(async () => {
		dispatchDrag(lane(), "drop", 101, transfer);
	});
	expect(calls.commit).toEqual(["c>b:before"]);
	// The cue is gone the moment the gesture resolves.
	expect(tab("b").className).not.toContain("tab-insert-before");
});

test("hovering the same gap repeatedly previews only once", async () => {
	const calls = await mountBar();
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("c"), "dragstart", 250, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 99, transfer);
		dispatchDrag(lane(), "dragover", 100, transfer);
		dispatchDrag(lane(), "dragover", 103, transfer);
	});
	expect(calls.preview).toEqual(["c>b:before"]);
});

test("dragging a tab onto the gap beside itself is not a move", async () => {
	const calls = await mountBar();
	const transfer = new TestDataTransfer();
	// a already sits immediately before b, so "insert before b" reproduces
	// the current order — no rail, no preview, no history entry.
	await act(async () => {
		dispatchDrag(tab("a"), "dragstart", 50, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 101, transfer);
	});
	expect(calls.preview).toEqual([]);
	expect(tab("b").className).not.toContain("tab-insert-before");
	await act(async () => {
		dispatchDrag(lane(), "drop", 101, transfer);
	});
	expect(calls.commit).toEqual([]);
});

test("dragging the last tab onto the end-of-lane slot is not a move either", async () => {
	const calls = await mountBar();
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("c"), "dragstart", 250, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 302, transfer);
	});
	expect(calls.preview).toEqual([]);
	expect(tab("c").className).not.toContain("tab-insert-after");
});

test("dropping a tab back where it already sits is not a move", async () => {
	const calls = await mountBar();
	const transfer = new TestDataTransfer();
	// b is index 1; the slot before b inserts at index 1.
	await act(async () => {
		dispatchDrag(tab("b"), "dragstart", 150, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 101, transfer);
	});
	expect(calls.preview).toEqual([]);
	expect(tab("b").className).not.toContain("tab-insert-before");
	await act(async () => {
		dispatchDrag(lane(), "drop", 101, transfer);
	});
	expect(calls.commit).toEqual([]);
});

test("a tab body nests instead of reordering", async () => {
	const calls = await mountBar();
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("a"), "dragstart", 50, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 150, transfer);
	});
	expect(calls.preview).toEqual([]);
	await act(async () => {
		dispatchDrag(lane(), "drop", 150, transfer);
	});
	expect(calls.nest).toEqual(["a>b"]);
	expect(calls.commit).toEqual([]);
});

test("dropping a folder on itself is refused with a cue, never a drop", async () => {
	const calls = await mountBar({
		canNestFolder: (folderId, targetId) => folderId !== targetId,
	});
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("b"), "dragstart", 150, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 150, transfer);
	});
	expect(tab("b").hasAttribute("data-drop-blocked")).toBe(true);
	await act(async () => {
		dispatchDrag(lane(), "drop", 150, transfer);
	});
	expect(calls.nest).toEqual([]);
});

test("dropping a folder on its own descendant is refused with the same cue", async () => {
	const calls = await mountBar({
		canNestFolder: (folderId, targetId) =>
			!(folderId === "a" && targetId === "c"),
	});
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("a"), "dragstart", 50, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 250, transfer);
	});
	expect(tab("c").hasAttribute("data-drop-blocked")).toBe(true);
	expect(tab("c").className).not.toContain("tab-insert");
	await act(async () => {
		dispatchDrag(lane(), "drop", 250, transfer);
	});
	expect(calls.nest).toEqual([]);
});

test("a refused target stops being refused once the pointer moves on", async () => {
	await mountBar({
		canNestFolder: (folderId, targetId) => folderId !== targetId,
	});
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("b"), "dragstart", 150, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 150, transfer);
	});
	expect(tab("b").hasAttribute("data-drop-blocked")).toBe(true);
	await act(async () => {
		dispatchDrag(lane(), "dragover", 50, transfer);
	});
	expect(tab("b").hasAttribute("data-drop-blocked")).toBe(false);
});

test("a non-root folder dropped in a gap is hoisted to the top level", async () => {
	const calls = await mountBar({ isRootFolder: () => false });
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("a"), "dragstart", 50, transfer);
	});
	await act(async () => {
		dispatchDrag(lane(), "dragover", 101, transfer);
		dispatchDrag(lane(), "drop", 101, transfer);
	});
	expect(calls.hoist).toEqual(["a>b:before"]);
	expect(calls.commit).toEqual([]);
});

// ---- Cross-surface drop --------------------------------------------------

// A root folder lives only in the tab bar, so the bar is the only place that
// can arm the same-document gesture the grid insists on (D4/NPD-4). Without
// that the grid refuses every tab-originated drop as a foreign payload, which
// is exactly what used to make "drag a tab into the grid" silently do nothing.

function CrossSurfaceHarness({ drops }: { drops: ItemRef[] }) {
	const dnd = useGridDnd({
		onLiveReorder: () => undefined,
		onCombineCards: () => undefined,
		onDropOnFolder: () => undefined,
		onBackgroundDrop: (dragged) => drops.push(dragged),
		onOpenFolder: () => undefined,
		canNest: () => true,
		isInContainer: () => true,
	});
	return (
		<>
			<FolderTabs
				folders={FOLDERS}
				hiddenFolders={[]}
				activeRootId="a"
				activeFolderId="a"
				navigationDirection="forward"
				onAddFolder={() => "new"}
				onSelectFolder={() => undefined}
				onPreviewReorderFolders={() => undefined}
				onCommitReorderFolders={() => undefined}
				onMoveFolders={() => undefined}
				onMoveFolderToRoot={() => undefined}
				isRootFolder={() => true}
				canNestFolder={() => true}
			/>
			<section data-testid="grid" {...dnd.backgroundProps} />
		</>
	);
}

async function mountCrossSurface() {
	const drops: ItemRef[] = [];
	const mount = document.getElementById("app");
	if (!mount) throw new Error("test mount missing");
	root = createRoot(mount);
	await act(async () => {
		root?.render(<CrossSurfaceHarness drops={drops} />);
	});
	return drops;
}

function grid() {
	const el = document.querySelector('[data-testid="grid"]');
	if (!el) throw new Error("grid missing");
	return el;
}

test("a folder dragged out of the tab bar is accepted by the grid", async () => {
	const drops = await mountCrossSurface();
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("a"), "dragstart", 50, transfer);
	});
	// The bar armed the gesture, so the grid sees a same-document payload.
	expect(globalThis.__ktabDndGestureEpoch ?? 0).toBeGreaterThan(0);
	await act(async () => {
		dispatchDrag(grid(), "drop", 50, transfer);
	});
	// The grid resolves the typed marker the bar wrote, not just text/plain.
	expect(drops).toEqual([{ kind: "folder", id: "a" }]);
});

test("the grid still refuses a tab payload with no same-document gesture", async () => {
	const drops = await mountCrossSurface();
	const transfer = new TestDataTransfer();
	await act(async () => {
		dispatchDrag(tab("a"), "dragstart", 50, transfer);
	});
	// A foreign window's payload arrives with no epoch of its own.
	globalThis.__ktabDndGestureEpoch = 0;
	await act(async () => {
		dispatchDrag(grid(), "drop", 50, transfer);
	});
	expect(drops).toEqual([]);
});
