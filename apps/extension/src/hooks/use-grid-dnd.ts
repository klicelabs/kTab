import {
	type DragEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useAutoscroll } from "../lib/autoscroll";
import {
	clearActiveDrag,
	dropZoneFor,
	type GridItemDragProps,
	insertPositionFor,
	redispatchDragoverAt,
	resolveDragRef,
	setDragData,
} from "../lib/dnd";
import { sweepDragGhosts } from "../lib/drag-ghost";
import {
	clearFrozenDragGroup,
	clearGestureCapture,
} from "../lib/history-capture";
import type { ItemOrder, ItemRef } from "../lib/item-order";
import { useSpringLoad } from "./use-spring-load";

export interface GridDndHandlers {
	/** Live mixed reorder inside one container (never reparents). */
	onLiveReorder: (
		dragged: ItemRef,
		target: ItemRef,
		position: "before" | "after",
	) => void;
	/** Drop a card onto another card: create a subfolder with both. */
	onCombineCards: (draggedCardId: string, targetCardId: string) => void;
	/** Drop anything onto a folder: move (multi-selection aware upstream). */
	onDropOnFolder: (draggedId: string, folderId: string) => void;
	/** Drop onto empty grid background. */
	onBackgroundDrop: (dragged: ItemRef) => void;
	/**
	 * H9/P1: a foreign item (not a member of this container) dropped on a
	 * card/folder EDGE lands exactly at the previewed position — the owner
	 * inserts a block at that edge instead of appending. Center zones never
	 * reach this (folder-nest/combine paths run first).
	 */
	onForeignEdgeDrop?: (
		dragged: ItemRef,
		target: ItemRef,
		position: "before" | "after",
	) => void;
	/** Spring-loaded navigation into a folder. */
	onOpenFolder: (id: string) => void;
	/** Spring-load on folder-center hover (default true). Icon mode keeps
	 * its preview-stack spring alongside: the stack stops propagation, so
	 * slot hover and body hover never double-fire. */
	allowFolderSpringLoad?: boolean;
	/** Preview reorder callbacks share the grid's active drag lifecycle. */
	onPreviewLiveReorder?: (
		targetFolderId: string,
		dragged: ItemRef,
		target: ItemRef,
		position: "before" | "after",
	) => void;
	onPreviewDrop?: (
		targetFolderId: string,
		draggedCardId: string,
		targetCardId: string,
		position: "before" | "after",
	) => void;
	/**
	 * H7/P2: resolve the drag group for a preview hover — a length > 1
	 * group is refused by preview cells (folders cannot be positioned
	 * there), with a refusal cue rendered by the owner.
	 */
	onResolveDragGroup?: (dragged: ItemRef) => readonly unknown[];
	/** Cycle guard for folder-in-folder drops. */
	canNest: (folderId: string, targetFolderId: string) => boolean;
	/** True when the ref belongs to this grid's container. */
	isInContainer: (ref: ItemRef) => boolean;
	/**
	 * Escape support: hover-applied live reorders are real store writes, so
	 * cancelling must undo them. The owner snapshots the persisted order at
	 * dragstart and restores it on Escape; the coordinator only holds the
	 * opaque snapshot (store access stays with the owner, keeping this hook
	 * free of store imports and their module side effects).
	 */
	onSnapshotOrder?: () => ItemOrder | null;
	onRestoreOrder?: (snapshot: ItemOrder) => void;
	/**
	 * Runs first inside dragstart, synchronously: the owner adjusts selection
	 * (dragging an unselected item starts a fresh single drag) and may set a
	 * custom drag image while the browser still accepts one.
	 */
	onItemDragStart?: (ref: ItemRef, e: DragEvent) => ItemRef | undefined;
	/**
	 * Fires after every settled item/background drop (all paths), once the
	 * owner's drop handler has run. Lets the owner diff gesture state for
	 * history without distinguishing hover writes from drop commits.
	 */
	onDropSettled?: (dragged: ItemRef) => void;
}

function resolveDrag(e: DragEvent): ItemRef | null {
	const active = resolveDragRef(e);
	if (!active || !active.id) return null;
	return { kind: active.kind, id: active.id };
}

/**
 * Shared edge-triggered autoscroll tuning lives in lib/autoscroll
 * (90px zone, quadratic 180→1000px/s). The grid keeps the legacy window
 * fallback for drags that leave the scroll viewport.
 */
function isValidItemDrop(
	dragged: ItemRef,
	target: ItemRef,
	zone: "before" | "after" | "center",
	handlers: GridDndHandlers,
) {
	if (dragged.id === target.id) return false;
	if (zone === "center") {
		if (target.kind === "folder") {
			return (
				dragged.kind !== "folder" || handlers.canNest(dragged.id, target.id)
			);
		}
		return dragged.kind === "card" && handlers.isInContainer(dragged);
	}
	return (
		handlers.isInContainer(dragged) ||
		target.kind === "folder" ||
		target.kind === "card"
	);
}

/**
 * Grid drag-and-drop coordinator.
 *
 * One hook owns the whole interaction so drop intent is unambiguous:
 *
 *   - pointer over an item's edges → live reorder (surrounding items move
 *     out of the way in real time via `onLiveReorder` on every zone change);
 *   - pointer over a card's center → combine (drop creates a subfolder);
 *   - pointer over a folder's center → nest (drop moves inside) + spring-load;
 *   - drop on empty background → container append (this is what makes a drop
 *     still land correctly when spring-load navigation swapped the grid
 *     mid-drag: the moved item is always persisted, navigation never swallows
 *     the move).
 *
 * Spring-load only arms on folder-center hover, never on reorder edges, and
 * the drop always persists its move — navigation is never a substitute.
 */
/**
 * D4/NPD-4: same-document gesture epoch. Every local dragstart bumps it;
 * cross-window drops carry no epoch, so a zero epoch at a drop handler
 * means the payload came from another window — refuse (decisão NPD-4:
 * melhor recusar do que aceitar silenciosamente com histórico errado).
 */
declare global {
	// eslint-disable-next-line no-var
	var __ktabDndGestureEpoch: number | undefined;
}

export function useGridDnd(handlers: GridDndHandlers) {
	const [drag, setDrag] = useState<ItemRef | null>(null);
	// H7/P2 (decisão A): a folder-preview cell refuses a multi-item group —
	// previews cannot position folders, and a cards-only silent move would
	// abandon the rest of the selection. The refusal cue renders on the
	// hovered cell so feedback is immediate.
	const [refuseGroup, setRefuseGroup] = useState<string | null>(null);
	// H11: last pointer position, so the autoscroll onScroll callback can
	// re-hit-test what is under a stationary pointer while the page scrolls.
	const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
	const [insertion, setInsertion] = useState<{
		key: string;
		position: "before" | "after";
	} | null>(null);
	const [combineKey, setCombineKey] = useState<string | null>(null);
	const [nestId, setNestId] = useState<string | null>(null);
	const [previewInsertion, setPreviewInsertion] = useState<{
		folderId: string;
		targetCardId: string;
		position: "before" | "after";
	} | null>(null);

	const dragRef = useRef<ItemRef | null>(null);
	/**
	 * C3 gesture epoch. Bumped to a new id at dragstart; a cancelled gesture
	 * flips `cancelled` while the epoch stays armed until the NEXT dragstart.
	 * Drop handlers must consult this BEFORE the resolveDrag fallback: after a
	 * cancel the native dataTransfer payload still exists, and re-resolving it
	 * re-arms a gesture the user explicitly killed.
	 */
	const gestureRef = useRef({ id: 0, cancelled: false });
	const lastApplied = useRef<string | null>(null);
	const springTarget = useRef<string | null>(null);
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;
	// Pre-drag order snapshot: Escape restores the container order instead of
	// leaving hover-applied live reorders behind.
	const orderSnapshot = useRef<ItemOrder | null>(null);
	// Latest preview insertion mirrored in a ref so preview drop reads the
	// live value without recreating every preview cell's handlers per hover.
	const previewInsertionRef = useRef<{
		folderId: string;
		targetCardId: string;
		position: "before" | "after";
	} | null>(null);

	// Time-driven autoscroll session (shared with marquee selection).
	// Native dragover events stall when the pointer holds still, so sensing
	// (dragover writes the pointer) is decoupled from scrolling (a rAF loop
	// owns all scrollTop writes and keeps running with a static pointer
	// inside the edge zone).
	const autoscroll = useAutoscroll({
		windowFallback: true,
		// H11: native dragover stalls while the pointer holds still, but the
		// time-driven scroll loop keeps moving content under it — hovers go
		// stale. After every applied scroll delta, re-hit-test the element now
		// under the pointer and re-dispatch its dragover so the intent visual
		// and the eventual drop position track the CONTENT, not the screen.
		onScroll: () => {
			const point = lastPointerRef.current;
			if (!point || !dragRef.current || gestureRef.current.cancelled) return;
			redispatchDragoverAt(point, dragRef.current.id);
		},
	});
	const stopAutoscroll = autoscroll.stop;

	/** Record the pointer and ensure the scroll loop is running. */
	const feedAutoscroll = useCallback(
		(e: DragEvent) => {
			lastPointerRef.current = { x: e.clientX, y: e.clientY };
			autoscroll.feed({ x: e.clientX, y: e.clientY });
		},
		[autoscroll],
	);

	const spring = useSpringLoad(() => {
		const target = springTarget.current;
		if (target) handlersRef.current.onOpenFolder(target);
	});
	const springStart = spring.start;
	const springRestart = spring.restart;
	const springCancel = spring.cancel;

	const clearVisuals = useCallback(() => {
		setInsertion(null);
		setCombineKey(null);
		setNestId(null);
		setPreviewInsertion(null);
		previewInsertionRef.current = null;
		setRefuseGroup(null);
	}, []);

	// Clear the rendered intent without clearing the native payload. A
	// spring-loaded folder navigation swaps the grid while the browser is still
	// holding the source drag, so the new grid must be able to resolve it.
	const resetVisuals = useCallback(() => {
		lastApplied.current = null;
		springTarget.current = null;
		springCancel();
		setDrag(null);
		clearVisuals();
	}, [springCancel, clearVisuals]);

	// Full settlement is reserved for a real drag end, drop, Escape, or
	// unmount. Navigation calls resetVisuals so the active native payload lives
	// through the container swap.
	const resetDrag = useCallback(() => {
		dragRef.current = null;
		orderSnapshot.current = null;
		stopAutoscroll();
		resetVisuals();
		clearActiveDrag();
	}, [resetVisuals, stopAutoscroll]);

	/**
	 * C3: settle a cancelled gesture. dragRef/_activeDrag only cover the
	 * in-memory path; the native dataTransfer payload survives cancel (Esc or
	 * dragend elsewhere), so a later drop would re-resolve it via the
	 * resolveDrag fallback and commit the move anyway. The cancelled flag
	 * (same epoch, armed until the next dragstart) is what drop handlers
	 * check before falling back to resolveDrag. A cancelled gesture also
	 * discards the pending history capture: the drop that follows a cancel
	 * is inert, so nothing may commit against the stale "before".
	 */
	const resetDragCancelled = useCallback(() => {
		gestureRef.current.cancelled = true;
		resetDrag();
		clearGestureCapture();
		clearFrozenDragGroup();
	}, [resetDrag]);

	/** Restore the pre-drag order (Escape cancellation). */
	const restoreSnapshot = useCallback(() => {
		const snapshot = orderSnapshot.current;
		orderSnapshot.current = null;
		if (snapshot) handlersRef.current.onRestoreOrder?.(snapshot);
	}, []);

	const applyLiveReorder = useCallback(
		(dragged: ItemRef, target: ItemRef, position: "before" | "after") => {
			const stamp = `${dragged.kind}:${dragged.id}|${target.kind}:${target.id}|${position}`;
			if (lastApplied.current === stamp) return;
			lastApplied.current = stamp;
			handlersRef.current.onLiveReorder(dragged, target, position);
		},
		[],
	);

	const handleItemDragStart = useCallback(
		(ref: ItemRef) => (e: DragEvent) => {
			const effectiveRef = handlersRef.current.onItemDragStart?.(ref, e) ?? ref;
			globalThis.__ktabDndGestureEpoch =
				(globalThis.__ktabDndGestureEpoch ?? 0) + 1;
			dragRef.current = effectiveRef;
			// Fresh gesture: any stale cancel from a previous drag is void.
			gestureRef.current = { id: gestureRef.current.id + 1, cancelled: false };
			lastApplied.current = null;
			autoscroll.setContainer(undefined);
			sweepDragGhosts();
			// Snapshot the persisted order before hover-applied live reorders
			// mutate it, so Escape can return to a stable pre-drag state.
			orderSnapshot.current = handlersRef.current.onSnapshotOrder?.() ?? null;
			setDragData(e, effectiveRef.kind, effectiveRef.id);
			// Defer source dimming one frame so the browser captures a
			// full-opacity drag image.
			requestAnimationFrame(() => {
				if (dragRef.current?.id === effectiveRef.id) setDrag(effectiveRef);
			});
		},
		[autoscroll],
	);

	const handleItemDragEnd = useCallback(() => {
		resetDrag();
		// L8: the gesture is over — a stale frozen group must not survive
		// into the next unrelated drop.
		clearFrozenDragGroup();
	}, [resetDrag]);

	// Native dragend can arrive after its source node has been removed (for
	// example, when spring-load navigation swaps the grid). Keep cleanup at the
	// window boundary as a backstop, and let Escape cancel the same state.
	// Escape also restores the pre-drag order: hover-applied live reorders
	// are real store writes, so cancelling must undo them.
	//
	// C3: both cancels use resetDragCancelled so the gesture epoch is
	// invalidated — a drop arriving after Esc (delivered) or dragend must not
	// re-resolve the persisted dataTransfer payload and commit.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && dragRef.current) {
				restoreSnapshot();
				resetDragCancelled();
			}
		};
		const handleDragEnd = () => {
			// D4/NPD-4: the gesture ended — cross-window drops arriving now
			// carry a stale payload this document never started.
			globalThis.__ktabDndGestureEpoch = 0;
			resetDragCancelled();
			// L8: window-level backstop for the frozen group as well.
			clearFrozenDragGroup();
		};
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("dragend", handleDragEnd);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("dragend", handleDragEnd);
			resetDragCancelled();
		};
	}, [resetDragCancelled, restoreSnapshot]);

	const handleItemDragOver = useCallback(
		(ref: ItemRef) => (e: DragEvent) => {
			const h = handlersRef.current;
			const dragged = dragRef.current ?? resolveDrag(e);
			if (!dragged || !dragged.id || dragged.id === ref.id) return;

			const el = e.currentTarget;
			if (!(el instanceof HTMLElement)) return;
			const zone = dropZoneFor(e, el);
			const foreign = !h.isInContainer(dragged);
			if (!isValidItemDrop(dragged, ref, zone, h)) {
				e.dataTransfer.dropEffect = "none";
				return;
			}

			if (ref.kind === "folder") {
				if (zone === "center") {
					e.preventDefault();
					e.dataTransfer.dropEffect = "move";
					feedAutoscroll(e);
					lastApplied.current = null;
					setInsertion((prev) => (prev === null ? prev : null));
					setCombineKey(null);
					setNestId((prev) => (prev === ref.id ? prev : ref.id));
					if (h.allowFolderSpringLoad !== false) {
						// A target change restarts the dwell: reusing start()
						// would keep the stale timer and navigate to the
						// previous folder (A → B navigates to A).
						if (springTarget.current === ref.id) springStart();
						else {
							springTarget.current = ref.id;
							springRestart();
						}
					} else {
						springTarget.current = null;
						springCancel();
					}
					return;
				}
				// Edge: reorder for locals; foreign folders land on drop.
				if (foreign) {
					e.preventDefault();
					e.dataTransfer.dropEffect = "move";
					feedAutoscroll(e);
					return;
				}
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				feedAutoscroll(e);
				springCancel();
				springTarget.current = null;
				setNestId((prev) => (prev === null ? prev : null));
				setCombineKey(null);
				setInsertion((prev) =>
					prev?.key === ref.id && prev.position === zone
						? prev
						: { key: ref.id, position: zone },
				);
				applyLiveReorder(dragged, ref, zone);
				return;
			}

			// Target is a card.
			if (zone === "center") {
				// Only card-on-card combines; a folder cannot nest into a card.
				if (dragged.kind !== "card" || foreign) return;
				// H7/P2 (decisão A): a multi-item selection never combines —
				// merging one member would strand the rest of the selection.
				// Refuse with a cue instead of silently moving two items.
				if ((h.onResolveDragGroup?.(dragged).length ?? 1) > 1) {
					e.preventDefault();
					e.dataTransfer.dropEffect = "none";
					setInsertion((prev) => (prev === null ? prev : null));
					setCombineKey((prev) => (prev === null ? prev : null));
					setRefuseGroup((prev) => (prev === ref.id ? prev : ref.id));
					return;
				}
				setRefuseGroup((prev) => (prev === null ? prev : null));
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				feedAutoscroll(e);
				lastApplied.current = null;
				springCancel();
				springTarget.current = null;
				setInsertion((prev) => (prev === null ? prev : null));
				setNestId((prev) => (prev === null ? prev : null));
				setCombineKey((prev) => (prev === ref.id ? prev : ref.id));
				return;
			}
			if (foreign) {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				feedAutoscroll(e);
				return;
			}
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
			feedAutoscroll(e);
			springCancel();
			springTarget.current = null;
			setNestId((prev) => (prev === null ? prev : null));
			setCombineKey(null);
			setInsertion((prev) =>
				prev?.key === ref.id && prev.position === zone
					? prev
					: { key: ref.id, position: zone },
			);
			applyLiveReorder(dragged, ref, zone);
		},
		[
			springStart,
			springRestart,
			springCancel,
			applyLiveReorder,
			feedAutoscroll,
		],
	);

	const handleItemDragLeave = useCallback(
		(ref: ItemRef) => (e: DragEvent) => {
			const related = e.relatedTarget as Node | null;
			if (
				related &&
				e.currentTarget instanceof Node &&
				e.currentTarget.contains(related)
			) {
				return;
			}
			setInsertion((prev) => (prev?.key === ref.id ? null : prev));
			setCombineKey((prev) => (prev === ref.id ? null : prev));
			setRefuseGroup((prev) => (prev === ref.id ? null : prev));
			setNestId((prev) => {
				if (prev === ref.id) {
					springCancel();
					springTarget.current = null;
					return null;
				}
				return prev;
			});
		},
		[springCancel],
	);

	const handleItemDrop = useCallback(
		(ref: ItemRef) => (e: DragEvent) => {
			e.preventDefault();
			// Keep the grid-background drop handler from also firing: the item
			// already owned this drop.
			e.stopPropagation();
			const h = handlersRef.current;
			// C3: a cancelled gesture must never re-resolve via the dataTransfer
			// fallback — check BEFORE the resolveDrag path (dragRef is already
			// null after cancel; the payload is not).
			const isLiveGesture = !gestureRef.current.cancelled;
			// D4/NPD-4: a zero epoch means no live same-document gesture —
			// this payload arrived from another window; refuse.
			if (!globalThis.__ktabDndGestureEpoch) return;
			const dragged =
				dragRef.current ?? (isLiveGesture ? resolveDrag(e) : null);
			// Preserve the hover stamp until the final edge decision. Clearing it
			// before reading it made every edge drop invoke reorder twice.
			const appliedStamp = lastApplied.current;
			// A drop fully settles the gesture: clear ALL drag visuals here, not
			// just dragend. After a spring-load navigation the source node is
			// unmounted, so dragend never reaches React and anything left set
			// (notably `drag`, which drives the opacity-40 ghost) sticks forever.
			resetDrag();
			if (!dragged || !dragged.id || dragged.id === ref.id) return;

			const el = e.currentTarget;
			const zone = el instanceof HTMLElement ? dropZoneFor(e, el) : "center";
			if (!isValidItemDrop(dragged, ref, zone, h)) return;

			if (ref.kind === "folder" && zone === "center") {
				// H8: drop sites expand the drag group upstream (the owner
				// resolves the full selection) — this hook hands over the
				// grabbed ref; nothing is moved twice.
				h.onDropOnFolder(dragged.id, ref.id);
				h.onDropSettled?.(dragged);
				return;
			}
			if (ref.kind === "card" && dragged.kind === "card" && zone === "center") {
				// H7/P2: the refusal seen on hover holds at drop — a
				// multi-item group never combines (decisão A).
				if ((h.onResolveDragGroup?.(dragged).length ?? 1) > 1) return;
				h.onCombineCards(dragged.id, ref.id);
				h.onDropSettled?.(dragged);
				return;
			}
			if (!h.isInContainer(dragged)) {
				// H9/P1 (decisão A): a foreign item dropped on an edge lands
				// EXACTLY at the indicated edge — the previewed position is the
				// persisted one. Append (the old behavior) discarded the edge.
				if (ref.kind === "folder" && zone === "center") {
					h.onDropOnFolder(dragged.id, ref.id);
					h.onDropSettled?.(dragged);
					return;
				}
				if (
					ref.kind === "card" &&
					dragged.kind === "card" &&
					zone === "center"
				) {
					// H7/P2: multi-item groups never combine (decisão A).
					if ((h.onResolveDragGroup?.(dragged).length ?? 1) > 1) return;
					h.onCombineCards(dragged.id, ref.id);
					h.onDropSettled?.(dragged);
					return;
				}
				if (zone === "center") {
					// Unreachable in practice (centers settle above); the append
					// fallback keeps any residual case landing safely.
					h.onBackgroundDrop(dragged);
					h.onDropSettled?.(dragged);
					return;
				}
				h.onForeignEdgeDrop?.(dragged, ref, zone);
				h.onDropSettled?.(dragged);
				return;
			}
			// Edge drop: live reorder already applied on hover; ensure the
			// final position in case drop fired without a preceding over.
			// (All center-zone cases settled above, so only edges remain.)
			if (zone === "center") return;
			const stamp = `${dragged.kind}:${dragged.id}|${ref.kind}:${ref.id}|${zone}`;
			// H10: the previewed intent wins — reuse the hover stamp even when
			// the final pointer geometry resolves differently, so the persisted
			// position is exactly the one the user saw. Geometry only fills in
			// when no hover preceded the drop.
			if (appliedStamp !== stamp) {
				h.onLiveReorder(dragged, ref, zone);
			}
			h.onDropSettled?.(dragged);
		},
		[resetDrag],
	);

	const handleBackgroundDragOver = useCallback(
		(e: DragEvent) => {
			const dragged = dragRef.current ?? resolveDrag(e);
			if (!dragged || !dragged.id) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
			feedAutoscroll(e);
		},
		[feedAutoscroll],
	);

	const handleBackgroundDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			// C3: same guard as item drops — check the gesture epoch BEFORE the
			// resolveDrag fallback so a drop after Esc (delivered) or dragend
			// cannot resurrect a cancelled gesture from the dataTransfer payload.
			const isLiveGesture = !gestureRef.current.cancelled;
			// D4/NPD-4: refuse cross-window payloads (no same-document epoch).
			if (!globalThis.__ktabDndGestureEpoch) return;
			const dragged =
				dragRef.current ?? (isLiveGesture ? resolveDrag(e) : null);
			// Same full settle as item drops (see handleItemDrop).
			resetDrag();
			if (!dragged || !dragged.id) return;
			handlersRef.current.onBackgroundDrop(dragged);
			handlersRef.current.onDropSettled?.(dragged);
		},
		[resetDrag],
	);

	const getItemDragProps = useCallback(
		(ref: ItemRef): GridItemDragProps => ({
			draggable: true,
			"data-dnd-item": ref.id,
			"data-dnd-kind": ref.kind,
			onDragStart: handleItemDragStart(ref),
			onDragEnd: handleItemDragEnd,
			onDragOver: handleItemDragOver(ref),
			onDragLeave: handleItemDragLeave(ref),
			onDrop: handleItemDrop(ref),
		}),
		[
			handleItemDragStart,
			handleItemDragEnd,
			handleItemDragOver,
			handleItemDragLeave,
			handleItemDrop,
		],
	);

	const getPreviewItemDragProps = useCallback(
		(folderId: string, cardId: string): GridItemDragProps => {
			const ref: ItemRef = { kind: "card", id: cardId };
			return {
				draggable: true,
				"data-dnd-item": cardId,
				"data-dnd-kind": "card",
				onDragStart: (e) => {
					e.stopPropagation();
					const effectiveRef =
						handlersRef.current.onItemDragStart?.(ref, e) ?? ref;
					/**
					 * C3: preview drags share the gesture lifecycle; a fresh
					 * gesture voids any stale cancel from a previous drag.
					 */
					gestureRef.current = {
						id: gestureRef.current.id + 1,
						cancelled: false,
					};
					globalThis.__ktabDndGestureEpoch =
						(globalThis.__ktabDndGestureEpoch ?? 0) + 1;
					dragRef.current = effectiveRef;
					lastApplied.current = null;
					autoscroll.setContainer(undefined);
					sweepDragGhosts();
					orderSnapshot.current =
						handlersRef.current.onSnapshotOrder?.() ?? null;
					setDragData(e, effectiveRef.kind, effectiveRef.id);
					requestAnimationFrame(() => {
						if (dragRef.current?.id === effectiveRef.id) setDrag(effectiveRef);
					});
				},
				onDragEnd: (e) => {
					e.stopPropagation();
					resetDrag();
				},
				onDragOver: (e) => {
					const dragged = dragRef.current ?? resolveDrag(e);
					if (!dragged || dragged.kind !== "card" || dragged.id === cardId)
						return;
					// H7/P2: resolve the real drag group — a multi-item selection
					// cannot be preview-inserted (folders have no position).
					const groupSize =
						handlersRef.current.onResolveDragGroup?.(dragged).length ?? 1;
					if (groupSize > 1) {
						e.preventDefault();
						e.dataTransfer.dropEffect = "none";
						setPreviewInsertion((prev) => (prev === null ? prev : null));
						setRefuseGroup((prev) => (prev === folderId ? prev : folderId));
						return;
					}
					setRefuseGroup((prev) => (prev === null ? prev : null));
					const target = e.currentTarget;
					if (!(target instanceof HTMLElement)) return;
					const position = insertPositionFor(e, target);
					e.preventDefault();
					// Specific preview target beats folder body and page background.
					e.stopPropagation();
					e.dataTransfer.dropEffect = "move";
					feedAutoscroll(e);
					const next = { folderId, targetCardId: cardId, position };
					previewInsertionRef.current = next;
					setPreviewInsertion((prev) =>
						prev?.folderId === folderId &&
						prev.targetCardId === cardId &&
						prev.position === position
							? prev
							: next,
					);
					const stamp = `preview:${folderId}|${dragged.id}|${cardId}|${position}`;
					if (lastApplied.current === stamp) return;
					lastApplied.current = stamp;
					handlersRef.current.onPreviewLiveReorder?.(
						folderId,
						dragged,
						{ kind: "card", id: cardId },
						position,
					);
				},
				onDragLeave: (e) => {
					const related = e.relatedTarget as Node | null;
					if (
						related &&
						e.currentTarget instanceof Node &&
						e.currentTarget.contains(related)
					)
						return;
					e.stopPropagation();
					if (
						previewInsertionRef.current?.folderId === folderId &&
						previewInsertionRef.current.targetCardId === cardId
					) {
						previewInsertionRef.current = null;
					}
					setPreviewInsertion((current) =>
						current?.folderId === folderId && current.targetCardId === cardId
							? null
							: current,
					);
				},
				onDrop: (e) => {
					// C3: same cancelled-gesture guard as the grid drop handlers.
					const isLiveGesture = !gestureRef.current.cancelled;
					const dragged =
						dragRef.current ?? (isLiveGesture ? resolveDrag(e) : null);
					if (!dragged || dragged.kind !== "card" || dragged.id === cardId)
						return;
					// H7/P2: the refusal seen on hover holds at drop — a multi-item
					// group never preview-inserts (decisão A: recusar com cue).
					if (refuseGroup === folderId) {
						e.preventDefault();
						e.stopPropagation();
						resetDrag();
						return;
					}
					const target = e.currentTarget;
					if (!(target instanceof HTMLElement)) return;
					const live = previewInsertionRef.current;
					const position =
						live?.folderId === folderId && live.targetCardId === cardId
							? live.position
							: insertPositionFor(e, target);
					e.preventDefault();
					e.stopPropagation();
					resetDrag();
					handlersRef.current.onPreviewDrop?.(
						folderId,
						dragged.id,
						cardId,
						position,
					);
				},
			};
		},
		[resetDrag, feedAutoscroll, autoscroll, refuseGroup],
	);

	const getFolderStackDragProps = useCallback(
		(folderId: string, sourceCardId?: string) => ({
			onDragOver: (e: DragEvent) => {
				const dragged = dragRef.current ?? resolveDrag(e);
				if (!dragged || dragged.kind !== "card" || dragged.id === sourceCardId)
					return;
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = "move";
				feedAutoscroll(e);
				setNestId((prev) => (prev === folderId ? prev : folderId));
				if (springTarget.current === folderId) springStart();
				else {
					springTarget.current = folderId;
					springRestart();
				}
			},
			onDragLeave: (e: DragEvent) => {
				const related = e.relatedTarget as Node | null;
				if (
					related &&
					e.currentTarget instanceof Node &&
					e.currentTarget.contains(related)
				)
					return;
				e.stopPropagation();
				setNestId((current) => (current === folderId ? null : current));
				springTarget.current = null;
				springCancel();
			},
			onDrop: (e: DragEvent) => {
				e.preventDefault();
				e.stopPropagation();
				// C3: same cancelled-gesture guard as the grid drop handlers.
				const isLiveGesture = !gestureRef.current.cancelled;
				const dragged =
					dragRef.current ?? (isLiveGesture ? resolveDrag(e) : null);
				resetDrag();
				if (!dragged || dragged.kind !== "card" || dragged.id === sourceCardId)
					return;
				handlersRef.current.onDropOnFolder(dragged.id, folderId);
			},
		}),
		[springStart, springRestart, springCancel, resetDrag, feedAutoscroll],
	);

	return {
		drag,
		insertion,
		combineKey,
		nestId,
		previewInsertion,
		/** H7/P2: folder id currently refusing a multi-item group. */
		refuseGroup,
		/** Settle a stale gesture (e.g. the container swapped mid-drag). */
		reset: resetDrag,
		/** Clear hover visuals while preserving the native drag payload. */
		resetVisuals,
		getItemDragProps,
		getPreviewItemDragProps,
		getFolderStackDragProps,
		backgroundProps: {
			onDragOver: handleBackgroundDragOver,
			onDrop: handleBackgroundDrop,
		},
	};
}
