import { REORDER_TWEEN } from "@ktab/ui/lib/ease";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { useGridDnd } from "../../hooks/use-grid-dnd";
import { useMarqueeSelection } from "../../hooks/use-marquee-selection";
import {
	CARD_ASPECT_RATIO,
	GRID_GAP_PX,
	TILE_SIZE_DIMENSIONS,
} from "../../lib/constants";
import { showGroupDragGhost } from "../../lib/drag-ghost";
import {
	planGroupFolderDrop,
	resolveDragGroup,
	resolveFrozenDragGroup,
	splitGroupKinds,
} from "../../lib/drag-group";
import type { HistorySummary } from "../../lib/history";
import {
	beginGestureCapture,
	buildHistoryEntry,
	clearFrozenDragGroup,
	freezeDragGroup,
	takeGestureCapture,
} from "../../lib/history-capture";
import { computeIconGridMaxWidth, iconGridConfig } from "../../lib/icon-layout";
import {
	getOrderedRefs,
	type ItemOrder,
	type ItemRef,
} from "../../lib/item-order";
import type { NavigationState } from "../../lib/navigation";
import { PAGE_VARIANTS, type PageMotionContext } from "../../lib/page-motion";
import { selectedAncestorOf } from "../../lib/selection-model";
import { cn } from "../../lib/utils";
import { useHistoryStore } from "../../stores/history-store";
import { useSelectionStore } from "../../stores/selection-store";
import { computeGridMaxWidth, useSetupStore } from "../../stores/setup-store";
import type { Card, Folder } from "../../types";
import { DialCard } from "./dial-card";
import { DialHoverVeil } from "./dial-hover-veil";
import {
	FolderPreviewCard,
	type FolderPreviewItem,
} from "./folders/folder-preview-card";

const REDUCED_GRID_TRANSITION = { duration: 0.08 } as const;
const VIRTUALIZE_AFTER = 80;
const VIRTUAL_OVERSCAN_ROWS = 3;

interface CardGridMetrics {
	width: number;
	tileWidth: number;
	columnGap: number;
	rowGap: number;
	columns: number;
	scrollMargin: number;
}

function initialGridMetrics(
	gridMaxWidth: number,
	cellWidth: number,
	columnGap: number,
	rowGap: number,
	maxColumns: number,
	safePadding: number,
): CardGridMetrics {
	const viewportWidth =
		typeof window === "undefined" ? gridMaxWidth + 96 : window.innerWidth;
	const gutter = viewportWidth <= 480 ? 16 : viewportWidth <= 900 ? 20 : 24;
	const width = Math.max(
		cellWidth,
		Math.min(gridMaxWidth, viewportWidth - gutter * 2) - safePadding * 2,
	);
	const columns = Math.max(
		1,
		Math.min(
			maxColumns,
			Math.floor((width + columnGap) / (cellWidth + columnGap)),
		),
	);
	return {
		width,
		tileWidth: cellWidth,
		columnGap,
		rowGap,
		columns,
		scrollMargin: 0,
	};
}

interface DialGridProps {
	/** Item-order container being rendered (the active folder id). */
	folderId: string;
	cards: Card[];
	subfolders: Folder[];
	allCards: Card[];
	allFolders: Folder[];
	itemOrder: ItemOrder;
	cardCounts: Record<string, number>;
	previewCards: Record<string, FolderPreviewItem[]>;
	onDelete: (id: string) => void;
	onDeleteFolder: (id: string) => void;
	onOpenFolder: (id: string) => void;
	onNewSubfolder: (parentId: string) => void;
	/** Single-set mixed move (one coalesced write, no half-moved window). */
	onMoveItems: (
		cardIds: string[],
		folderIds: string[],
		targetFolderId: string,
	) => void;
	onLiveReorder: (
		container: string,
		dragged: ItemRef,
		target: ItemRef,
		position: "before" | "after",
	) => void;
	/** Contiguous group reorder: one block move, one store write. */
	onReorderGroup: (
		container: string,
		groupIds: string[],
		target: ItemRef,
		position: "before" | "after",
	) => void;
	/** Block card insert for folder-preview drops (reparents as needed). */
	onInsertCardsAt: (
		targetFolderId: string,
		cardIds: string[],
		targetCardId: string,
		position: "before" | "after",
	) => void;
	onPreviewDrop: (
		targetFolderId: string,
		draggedCardId: string,
		targetCardId: string,
		position: "before" | "after",
	) => void;
	onCombineCards: (draggedCardId: string, targetCardId: string) => void;
	canNestFolder: (folderId: string, targetFolderId: string) => boolean;
	navigation: NavigationState;
	emptyState?: ReactNode;
}

export function DialGrid({
	folderId,
	cards,
	subfolders,
	allCards,
	allFolders,
	itemOrder,
	cardCounts,
	previewCards,
	onDelete,
	onDeleteFolder,
	onOpenFolder,
	onNewSubfolder,
	onMoveItems,
	onLiveReorder,
	onReorderGroup,
	onInsertCardsAt,
	onPreviewDrop,
	onCombineCards,
	canNestFolder,
	navigation,
	emptyState,
}: DialGridProps) {
	const tileSize = useSetupStore((s) => s.settings.tileSize);
	const maxColumns = useSetupStore((s) => s.settings.maxColumns);
	const dialLayout = useSetupStore((s) => s.settings.dialLayout);
	const cardAspect = useSetupStore((s) => s.settings.cardAspect);
	const iconGrid = iconGridConfig(tileSize);
	const gridMaxWidth =
		dialLayout === "icon"
			? computeIconGridMaxWidth(tileSize, maxColumns)
			: computeGridMaxWidth(tileSize, maxColumns);
	const reduceMotion = useReducedMotion() ?? false;
	const motionContext: PageMotionContext = { ...navigation, reduceMotion };

	// Sibling displacement during live reorder: an interruptible ease-out
	// tween (<300ms). Springs stay reserved for hierarchy travel.
	const reorderTransition = reduceMotion
		? REDUCED_GRID_TRANSITION
		: REORDER_TWEEN;

	const selectedIds = useSelectionStore((s) => s.selectedIds);
	const selectedItems = useSelectionStore((s) => s.items);
	const inheritedFrom = useMemo(() => {
		if (selectedIds.includes(folderId)) return folderId;
		const folder = allFolders.find((candidate) => candidate.id === folderId);
		if (!folder) return null;
		return selectedAncestorOf(
			{ id: folderId, kind: "folder", sourceId: folder.parentId ?? null },
			selectedItems,
			allFolders,
		);
	}, [folderId, allFolders, selectedIds, selectedItems]);
	const toggle = useSelectionStore((s) => s.toggle);
	const selectRange = useSelectionStore((s) => s.selectRange);
	const clearSelection = useSelectionStore((s) => s.clear);

	// Single interleaved order: folders and cards share one sequence, so
	// folders participate in ordering instead of being pinned first.
	const orderedRefs = useMemo(
		() => getOrderedRefs(folderId, subfolders, cards, itemOrder),
		[folderId, subfolders, cards, itemOrder],
	);
	const folderById = useMemo(
		() => new Map(subfolders.map((f) => [f.id, f])),
		[subfolders],
	);
	const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

	// Clear selection on Escape (M16: honors an earlier consumer's claim
	// via defaultPrevented — settings/sidebar, search, history confirmation
	// each own their Esc; a plain Esc here is the only one that clears).
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				if (e.defaultPrevented) return;
				clearSelection();
				e.preventDefault();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [clearSelection]);

	const cardHeightRatio =
		CARD_ASPECT_RATIO[cardAspect] ?? CARD_ASPECT_RATIO.vertical;
	const initialCellWidth =
		dialLayout === "icon"
			? iconGrid.cellWidth
			: (TILE_SIZE_DIMENSIONS[tileSize]?.width ?? 160);
	const initialColumnGap =
		dialLayout === "icon"
			? iconGrid.columnGap
			: typeof window !== "undefined" && window.innerWidth <= 480
				? 12
				: typeof window !== "undefined" && window.innerWidth <= 900
					? 16
					: GRID_GAP_PX;
	const initialRowGap =
		dialLayout === "icon" ? iconGrid.rowGap : initialColumnGap;
	const initialSafePadding = dialLayout === "icon" ? iconGrid.safePadding : 12;
	const cellAspectStyle =
		dialLayout === "card"
			? { ["--card-height-ratio" as string]: String(cardHeightRatio) }
			: {};
	const fallbackMetrics = useMemo(
		() =>
			initialGridMetrics(
				gridMaxWidth,
				initialCellWidth,
				initialColumnGap,
				initialRowGap,
				maxColumns,
				initialSafePadding,
			),
		[
			gridMaxWidth,
			initialCellWidth,
			initialColumnGap,
			initialRowGap,
			initialSafePadding,
			maxColumns,
		],
	);
	const gridRef = useRef<HTMLDivElement>(null);
	const [gridMetrics, setGridMetrics] = useState(fallbackMetrics);
	const [focusedRow, setFocusedRow] = useState<number | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: folderId swaps the keyed grid DOM node; remeasure the new node after navigation.
	useEffect(() => {
		const grid = gridRef.current;
		if (!grid) return;

		const measure = () => {
			const rect = grid.getBoundingClientRect();
			if (rect.width <= 0) return;
			const styles = getComputedStyle(grid);
			const tileWidth =
				dialLayout === "icon"
					? iconGrid.cellWidth
					: Number.parseFloat(styles.getPropertyValue("--tile-w")) ||
						TILE_SIZE_DIMENSIONS[tileSize]?.width ||
						160;
			const responsiveGap =
				dialLayout === "icon"
					? iconGrid.columnGap
					: Number.parseFloat(styles.getPropertyValue("--grid-gap")) ||
						GRID_GAP_PX;
			const columnGap =
				(dialLayout === "card"
					? Number.parseFloat(styles.columnGap)
					: Number.NaN) || responsiveGap;
			const rowGap =
				(dialLayout === "card"
					? Number.parseFloat(styles.rowGap)
					: Number.NaN) ||
				(dialLayout === "icon" ? iconGrid.rowGap : responsiveGap);
			const columns = Math.max(
				1,
				Math.min(
					maxColumns,
					Math.floor((rect.width + columnGap) / (tileWidth + columnGap)),
				),
			);
			const scrollElement = grid.closest<HTMLElement>(
				"[data-speed-dial-scroll]",
			);
			const scrollMargin = scrollElement
				? rect.top -
					scrollElement.getBoundingClientRect().top +
					scrollElement.scrollTop
				: rect.top + window.scrollY;
			const next: CardGridMetrics = {
				width: rect.width,
				tileWidth,
				columnGap,
				rowGap,
				columns,
				scrollMargin: Math.max(0, scrollMargin),
			};
			setGridMetrics((current) =>
				current.width === next.width &&
				current.tileWidth === next.tileWidth &&
				current.columnGap === next.columnGap &&
				current.rowGap === next.rowGap &&
				current.columns === next.columns &&
				current.scrollMargin === next.scrollMargin
					? current
					: next,
			);
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(grid);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [
		dialLayout,
		folderId,
		iconGrid.cellWidth,
		iconGrid.columnGap,
		iconGrid.rowGap,
		maxColumns,
		tileSize,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Folder changes reset the virtual keyboard focus row.
	useEffect(() => setFocusedRow(null), [folderId]);

	const isInContainer = useCallback(
		(ref: ItemRef) =>
			ref.kind === "card" ? cardById.has(ref.id) : folderById.has(ref.id),
		[cardById, folderById],
	);

	const containerName = useCallback(
		(containerId: string) =>
			allFolders.find((f) => f.id === containerId)?.name ?? "Home",
		[allFolders],
	);

	/** Display label for a single moved item (card title / folder name). */
	const singleItemLabel = useCallback(
		(kind: "card" | "folder", id: string) => {
			if (kind === "card") {
				const title = allCards.find((c) => c.id === id)?.title?.trim();
				return title && title.length > 0 ? title : undefined;
			}
			return allFolders.find((f) => f.id === id)?.name;
		},
		[allCards, allFolders],
	);

	/**
	 * Diff the gesture capture against live state and commit one atomic
	 * history entry (announced by the history manager with Undo). No-op
	 * drops produce no entry and no toast. Returns whether an entry was
	 * committed, so drops settle selection only on real commits.
	 */
	const commitGestureHistory = useCallback(
		(summary: HistorySummary): boolean => {
			const capture = takeGestureCapture();
			if (!capture) return false;
			const state = useSetupStore.getState();
			const entry = buildHistoryEntry(
				capture,
				state.cards,
				state.folders,
				state.itemOrder,
				summary,
			);
			if (!entry) return false;
			useHistoryStore.getState().commit(entry);
			return true;
		},
		[],
	);

	// A committed drop ends the gesture: the moved members land in their
	// normal state and the selection (plus tray) closes. Keeping them
	// selected would reopen the tray over items the user just finished
	// moving. When nothing moved, the previous selection is left untouched.
	const settleMovedSelection = useCallback(
		(cardIds: string[], folderIds: string[]) => {
			if (cardIds.length === 0 && folderIds.length === 0) return;
			useSelectionStore.getState().clear();
		},
		[],
	);

	// Multi-item drop on folder: the whole drag group moves in source order;
	// cards already inside the target stay put, folders nest when valid.
	// One store call — a mixed group can never be half-moved.
	const handleDropOnFolder = useCallback(
		(draggedId: string, targetFolderId: string) => {
			const draggedKind = allCards.some((c) => c.id === draggedId)
				? ("card" as const)
				: ("folder" as const);
			// L8: consume the group frozen at dragstart — a selection cleared
			// mid-drag must not shrink this drop to the first member.
			const group = resolveFrozenDragGroup(
				{ kind: draggedKind, id: draggedId },
				useSelectionStore.getState().items,
				allCards,
				allFolders,
				itemOrder,
			);
			const { movableCards, movableFolders, refusedFolders } =
				planGroupFolderDrop(
					group,
					targetFolderId,
					(id) => allCards.find((c) => c.id === id)?.folderId,
					canNestFolder,
				);
			// H8 (decisão P2-A): a mixed group whose folders cannot nest
			// refuses WHOLE — a cards-only move would strand the folders
			// silently. Feedback beats partial silence.
			if (movableCards.length > 0 && refusedFolders.length > 0) {
				toast.warning("Some folders can't go inside that folder", {
					description:
						"Drop them on the grid background or move them individually.",
				});
				clearFrozenDragGroup();
				return;
			}
			if (movableCards.length > 0 || movableFolders.length > 0) {
				onMoveItems(movableCards, movableFolders, targetFolderId);
				const total = movableCards.length + movableFolders.length;
				const committed = commitGestureHistory({
					kind: "move",
					total,
					cardCount: movableCards.length,
					folderCount: movableFolders.length,
					dest: containerName(targetFolderId),
					label:
						total === 1
							? singleItemLabel(
									movableCards.length === 1 ? "card" : "folder",
									(movableCards[0] ?? movableFolders[0]) as string,
								)
							: undefined,
				});
				if (committed) settleMovedSelection(movableCards, movableFolders);
			}
		},
		[
			allCards,
			allFolders,
			itemOrder,
			onMoveItems,
			canNestFolder,
			settleMovedSelection,
			commitGestureHistory,
			containerName,
			singleItemLabel,
		],
	);

	// Drop on empty grid background. The whole drag group moves in source
	// order, cards and folders in one store call so a spring-loaded container
	// swap cannot split the move or leave half of the selection behind.
	const handleBackgroundDrop = useCallback(
		(dragged: ItemRef) => {
			// L8: frozen group wins over the live selection (mid-drag clears).
			const group = resolveFrozenDragGroup(
				dragged,
				useSelectionStore.getState().items,
				allCards,
				allFolders,
				itemOrder,
			);
			const { cardIds, folderIds } = splitGroupKinds(group);
			const movableCards = cardIds.filter((id) =>
				allCards.some((card) => card.id === id),
			);
			const movableFolders = folderIds.filter((id) =>
				canNestFolder(id, folderId),
			);
			if (movableCards.length > 0 || movableFolders.length > 0) {
				onMoveItems(movableCards, movableFolders, folderId);
				const total = movableCards.length + movableFolders.length;
				const committed = commitGestureHistory({
					kind: "move",
					total,
					cardCount: movableCards.length,
					folderCount: movableFolders.length,
					dest: containerName(folderId),
					label:
						total === 1
							? singleItemLabel(
									movableCards.length === 1 ? "card" : "folder",
									(movableCards[0] ?? movableFolders[0]) as string,
								)
							: undefined,
				});
				if (committed) settleMovedSelection(movableCards, movableFolders);
			}
		},
		[
			allCards,
			allFolders,
			itemOrder,
			folderId,
			onMoveItems,
			canNestFolder,
			settleMovedSelection,
			commitGestureHistory,
			containerName,
			singleItemLabel,
		],
	);

	// Dragstart rule: dragging an unselected item starts a fresh single drag
	// (previous selection clears); dragging a selected item carries the whole
	// set with a premium group overlay instead of N duplicated cards.
	// Either way the live order is frozen for history: hover writes mutate
	// it, and the drop diffs back to this capture for one atomic entry.
	const handleItemDragStart = useCallback(
		(ref: ItemRef, e: React.DragEvent) => {
			beginGestureCapture(allCards, allFolders, itemOrder);
			const store = useSelectionStore.getState();
			const sourceId =
				ref.kind === "card"
					? (allCards.find((card) => card.id === ref.id)?.folderId ?? folderId)
					: (allFolders.find((folder) => folder.id === ref.id)?.parentId ??
						null);
			const selectedAncestor = selectedAncestorOf(
				{ ...ref, sourceId },
				store.items,
				allFolders,
			);
			if (selectedAncestor) {
				const parent: ItemRef = { kind: "folder", id: selectedAncestor };
				freezeDragGroup(
					resolveDragGroup(
						parent,
						store.items,
						allCards,
						allFolders,
						itemOrder,
					),
				);
				if (dialLayout === "icon") showGroupDragGhost(e, 1);
				return parent;
			}
			if (!store.selectedIds.includes(ref.id)) {
				store.clear();
				// L8: freeze the single-item group — drop sites must never
				// fall back to whatever selection existed at dragstart.
				freezeDragGroup([
					{
						kind: ref.kind,
						id: ref.id,
						sourceId:
							ref.kind === "card"
								? (allCards.find((c) => c.id === ref.id)?.folderId ?? folderId)
								: folderId,
					},
				]);
				if (dialLayout === "icon") showGroupDragGhost(e, 1);
				return;
			}
			const group = store.selectedIds;
			// L8: freeze the full source-ordered group for every drop site.
			freezeDragGroup(
				resolveDragGroup(ref, store.items, allCards, allFolders, itemOrder),
			);
			if (group.length > 1) showGroupDragGhost(e, group.length);
			else if (dialLayout === "icon") showGroupDragGhost(e, 1);
		},
		[dialLayout, allCards, allFolders, itemOrder, folderId],
	);

	const dnd = useGridDnd({
		onResolveDragGroup: useCallback(
			(dragged: ItemRef) =>
				resolveDragGroup(
					dragged,
					useSelectionStore.getState().items,
					allCards,
					allFolders,
					itemOrder,
				),
			[allCards, allFolders, itemOrder],
		),
		onLiveReorder: useCallback(
			(dragged: ItemRef, target: ItemRef, position: "before" | "after") => {
				// One drag operation → one group insertion: when the grabbed
				// item belongs to a multi-selection, the whole source-ordered
				// block moves contiguously instead of one member at a time.
				const group = resolveDragGroup(
					dragged,
					useSelectionStore.getState().items,
					allCards,
					allFolders,
					itemOrder,
				);
				const local = group.filter((member) => member.sourceId === folderId);
				if (local.length > 1) {
					onReorderGroup(
						folderId,
						local.map((member) => member.id),
						target,
						position,
					);
					return;
				}
				onLiveReorder(folderId, dragged, target, position);
			},
			[
				onLiveReorder,
				onReorderGroup,
				folderId,
				allCards,
				allFolders,
				itemOrder,
			],
		),
		onCombineCards,
		onDropOnFolder: handleDropOnFolder,
		onBackgroundDrop: handleBackgroundDrop,
		onOpenFolder,
		// Spring-open arms on every folder center in both layouts. In icon
		// mode the stacked ninth preview slot owns its own spring and stops
		// propagation, so the two never double-fire: slot hover opens via
		// the stack, body hover via the grid — one coherent model.
		allowFolderSpringLoad: true,
		onPreviewLiveReorder: useCallback(
			(
				targetFolderId: string,
				dragged: ItemRef,
				target: ItemRef,
				position: "before" | "after",
			) => {
				if (
					dragged.kind !== "card" ||
					target.kind !== "card" ||
					allCards.find((card) => card.id === dragged.id)?.folderId !==
						targetFolderId
				)
					return;
				onLiveReorder(targetFolderId, dragged, target, position);
			},
			[allCards, onLiveReorder],
		),
		onPreviewDrop: useCallback(
			(
				targetFolderId: string,
				draggedCardId: string,
				targetCardId: string,
				position: "before" | "after",
			) => {
				// Preview drops commit the selected card block once, in source
				// order, instead of once per member. Folders cannot be
				// preview-represented, so a mixed selection moves its cards.
				// L8: the frozen group survives a mid-drag selection clear.
				const group = resolveFrozenDragGroup(
					{ kind: "card", id: draggedCardId },
					useSelectionStore.getState().items,
					allCards,
					allFolders,
					itemOrder,
				);
				const block = group
					.filter((member) => member.kind === "card")
					.map((member) => member.id);
				if (block.length > 1) {
					onInsertCardsAt(targetFolderId, block, targetCardId, position);
					const committed = commitGestureHistory({
						kind: "move",
						total: block.length,
						cardCount: block.length,
						folderCount: 0,
						dest: containerName(targetFolderId),
						label:
							block.length === 1
								? singleItemLabel("card", block[0] as string)
								: undefined,
					});
					if (committed) settleMovedSelection(block, []);
					return;
				}
				onPreviewDrop(targetFolderId, draggedCardId, targetCardId, position);
				// Single preview drops reparent too: diff the gesture so the
				// move stays reversible.
				const committed = commitGestureHistory({
					kind: "move",
					total: 1,
					cardCount: 1,
					folderCount: 0,
					dest: containerName(targetFolderId),
					label: singleItemLabel("card", draggedCardId),
				});
				if (committed) settleMovedSelection([draggedCardId], []);
			},
			[
				onPreviewDrop,
				onInsertCardsAt,
				settleMovedSelection,
				commitGestureHistory,
				containerName,
				singleItemLabel,
				allCards,
				allFolders,
				itemOrder,
			],
		),
		// Edge-reorder settlement: folder/background drops already committed
		// (and consumed the capture) above. Whatever capture remains here is
		// a same-container reorder — or a no-op drop, which diffs to nothing.
		onDropSettled: useCallback(
			(dragged: ItemRef) => {
				// L8: settle against the frozen group, then retire it — the
				// gesture is over and a stale freeze must not leak into the
				// next unrelated drop.
				const group = resolveFrozenDragGroup(
					dragged,
					useSelectionStore.getState().items,
					allCards,
					allFolders,
					itemOrder,
				);
				clearFrozenDragGroup();
				const local = group.filter((member) => member.sourceId === folderId);
				commitGestureHistory({
					kind: "reorder",
					total: local.length > 0 ? local.length : 1,
					cardCount: local.filter((m) => m.kind === "card").length,
					folderCount: local.filter((m) => m.kind === "folder").length,
					container: containerName(folderId),
				});
			},
			[
				allCards,
				allFolders,
				itemOrder,
				folderId,
				commitGestureHistory,
				containerName,
			],
		),
		canNest: canNestFolder,
		isInContainer,
		onItemDragStart: handleItemDragStart,
		onSnapshotOrder: useCallback(() => {
			const base = useSetupStore.getState().itemOrder;
			if (!base) return null;
			const copy: ItemOrder = {};
			for (const [container, keys] of Object.entries(base)) {
				copy[container] = [...keys];
			}
			return copy;
		}, []),
		onRestoreOrder: useCallback((snapshot: ItemOrder) => {
			useSetupStore.getState().restoreItemOrder(snapshot);
		}, []),
	} as Parameters<typeof useGridDnd>[0]);

	// The coordinator outlives container swaps (same hook instance): when the
	// folder changes mid-gesture (spring-load navigation), clear only visuals
	// tied to the previous container. The native payload must remain available
	// to the newly rendered grid until the browser emits drop/dragend/Escape.
	const dndResetVisuals = dnd.resetVisuals;
	useEffect(() => {
		if (folderId) dndResetVisuals();
	}, [folderId, dndResetVisuals]);

	// Ordered view items with explicit source metadata for range select.
	const orderedItems = useMemo(
		() =>
			orderedRefs.map((ref) => ({
				id: ref.id,
				kind: ref.kind,
				sourceId: folderId,
			})),
		[orderedRefs, folderId],
	);

	// Every member of a group drag dims together so the whole payload reads
	// as one lifted unit, not one dimmed card plus silent passengers.
	const dragGroupIds = useMemo(() => {
		if (!dnd.drag) return null;
		if (!selectedIds.includes(dnd.drag.id)) return new Set([dnd.drag.id]);
		return new Set(selectedIds);
	}, [dnd.drag, selectedIds]);

	// Rubber-band selection owns empty-space presses; item presses stay
	// with DnD. Results land in the one selection store, so tray,
	// Select-all and group drag consume them untouched.
	const marquee = useMarqueeSelection({
		folderId,
		items: orderedItems,
	});
	const virtualized =
		orderedRefs.length >= VIRTUALIZE_AFTER &&
		(dialLayout === "card" || iconGrid.folderSpan === 1) &&
		!dnd.drag &&
		!marquee.marqueeActive;
	const virtualCellWidth = gridMetrics.tileWidth;
	const virtualCellHeight =
		dialLayout === "icon"
			? iconGrid.cellHeight
			: gridMetrics.tileWidth * cardHeightRatio;
	const virtualRowSize = virtualCellHeight + gridMetrics.rowGap;
	const virtualRowCount = Math.ceil(orderedRefs.length / gridMetrics.columns);
	const rangeExtractor = useCallback(
		(range: Parameters<typeof defaultRangeExtractor>[0]) => {
			const indexes = defaultRangeExtractor(range);
			const retainedRows =
				focusedRow === null
					? []
					: [focusedRow, focusedRow + 1].filter(
							(row) => row >= 0 && row < virtualRowCount,
						);
			if (retainedRows.length === 0) return indexes;
			return [...new Set([...indexes, ...retainedRows])].sort((a, b) => a - b);
		},
		[focusedRow, virtualRowCount],
	);
	const virtualizer = useVirtualizer({
		count: virtualRowCount,
		getScrollElement: () =>
			gridRef.current?.closest<HTMLElement>("[data-speed-dial-scroll]") ?? null,
		estimateSize: () => virtualRowSize,
		overscan: VIRTUAL_OVERSCAN_ROWS,
		enabled: virtualized,
		scrollMargin: gridMetrics.scrollMargin,
		initialRect: { width: gridMetrics.width, height: 720 },
		rangeExtractor,
	});
	const virtualRows = virtualized ? virtualizer.getVirtualItems() : [];
	const renderedIndexes = virtualized
		? virtualRows.flatMap((row) => {
				const start = row.index * gridMetrics.columns;
				return Array.from(
					{ length: Math.min(gridMetrics.columns, orderedRefs.length - start) },
					(_, offset) => start + offset,
				);
			})
		: orderedRefs.map((_, index) => index);
	const virtualGridHeight = Math.max(
		0,
		virtualRowCount * virtualRowSize - gridMetrics.rowGap,
	);
	const virtualCellStyle = (index: number): CSSProperties | undefined => {
		if (!virtualized) return undefined;
		const trackWidth =
			gridMetrics.columns * virtualCellWidth +
			(gridMetrics.columns - 1) * gridMetrics.columnGap;
		const column = index % gridMetrics.columns;
		const row = Math.floor(index / gridMetrics.columns);
		return {
			position: "absolute",
			left:
				Math.max(0, (gridMetrics.width - trackWidth) / 2) +
				column * (virtualCellWidth + gridMetrics.columnGap),
			top: row * virtualRowSize,
			width: virtualCellWidth,
			height: virtualCellHeight,
		};
	};
	const handleVirtualFocus = (event: React.FocusEvent<HTMLDivElement>) => {
		if (!virtualized || !(event.target instanceof Element)) return;
		const row =
			event.target.closest<HTMLElement>("[data-virtual-row]")?.dataset
				.virtualRow;
		if (row !== undefined) setFocusedRow(Number(row));
	};

	function handleSelect(e: React.MouseEvent, id: string) {
		if (e.shiftKey) selectRange(id, orderedItems);
		else
			toggle({
				id,
				kind: cardById.has(id) ? "card" : "folder",
				sourceId: folderId,
			});
	}

	function handleCardClick(e: React.MouseEvent, id: string) {
		// Enter is navigation, and an ordinary click always follows the link.
		// Selection is explicit: modifier-click, Space, or the sibling checkbox.
		if (e.detail === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			handleSelect(e, id);
		}
		// Otherwise the link navigates normally (mode not entered).
	}

	function handleFolderClick(
		e: React.MouseEvent,
		id: string,
		onOpen: () => void,
	) {
		if (
			e.metaKey ||
			e.ctrlKey ||
			e.shiftKey ||
			useSelectionStore.getState().scope !== null
		) {
			// Opening in selection mode uses the sibling chevron or context menu.
			e.preventDefault();
			e.stopPropagation();
			handleSelect(e, id);
		} else {
			onOpen();
		}
	}

	return (
		<section
			className="dial-grid-wrap mx-auto w-full px-[var(--speed-dial-content-gutter)]"
			data-layout={dialLayout}
			data-selection-active={selectedIds.length > 0 ? "true" : undefined}
			data-drag-active={dnd.drag ? "true" : undefined}
			{...dnd.backgroundProps}
			{...marquee.marqueeProps}
		>
			{marquee.marqueeActive && (
				<div
					aria-hidden="true"
					className="marquee-box"
					ref={marquee.overlayRef}
					style={{ display: "none" }}
				/>
			)}
			<div
				// Both layouts clip identically: transitions slide inside the
				// stage, while outlines/shadows/feedback live in the safe
				// padding (12px card, size-specific icon padding) and never touch
				// the edge.
				className={
					dialLayout === "icon"
						? "dial-grid-stage dial-grid-stage-icon overflow-hidden"
						: "dial-grid-stage overflow-hidden"
				}
				// Track width and centering live here (not on the wrap) so the
				// full-bleed wrap stays the interaction surface in both
				// layouts while content alignment never moves.
				style={{
					maxWidth: gridMaxWidth,
					marginInline: "auto",
					...(dialLayout === "icon"
						? {
								["--icon-safe-padding" as string]: `${iconGrid.safePadding}px`,
							}
						: {}),
				}}
			>
				<AnimatePresence initial={false} mode="sync" custom={motionContext}>
					<motion.div
						key={folderId}
						initial="initial"
						animate="animate"
						exit="exit"
						variants={PAGE_VARIANTS}
						custom={motionContext}
						className="dial-grid"
						ref={gridRef}
						onFocusCapture={handleVirtualFocus}
						data-tile={tileSize}
						data-layout={dialLayout}
						data-virtualized={virtualized ? "true" : undefined}
						data-nav-direction={navigation.direction}
						data-nav-kind={navigation.kind}
						style={{
							display:
								orderedRefs.length === 0
									? undefined
									: virtualized
										? "block"
										: "grid",
							position: virtualized ? "relative" : undefined,
							height: virtualized ? virtualGridHeight : undefined,
							gridTemplateColumns:
								orderedRefs.length === 0 || virtualized
									? undefined
									: dialLayout === "icon"
										? "repeat(auto-fill, var(--icon-cell-w, 104px))"
										: "repeat(auto-fill, var(--tile-w, 148px))",
							gap:
								orderedRefs.length === 0 || virtualized
									? undefined
									: dialLayout === "icon"
										? "var(--icon-row-gap) var(--icon-column-gap)"
										: "var(--grid-gap, 22px)",
							justifyContent: orderedRefs.length === 0 ? undefined : "center",
							gridArea: "1 / 1",
							...(dialLayout === "icon"
								? {
										["--icon-cell-w" as string]: `${iconGrid.cellWidth}px`,
										["--icon-cell-h" as string]: `${iconGrid.cellHeight}px`,
										["--icon-size" as string]: `${iconGrid.iconSize}px`,
										["--icon-favicon-size" as string]: `${iconGrid.faviconSize}px`,
										["--icon-column-gap" as string]: `${iconGrid.columnGap}px`,
										["--icon-row-gap" as string]: `${iconGrid.rowGap}px`,
										["--icon-label-gap" as string]: `${iconGrid.labelGap}px`,
										["--icon-folder-span" as string]: iconGrid.folderSpan,
									}
								: {}),
							...cellAspectStyle,
						}}
					>
						{/* One shared hover frame behind the items: it springs
						    between them with the switcher motion instead of fading
						    per cell. First child of the grid so the grid-owned icon
						    vars resolve for its radii and cells paint above it. */}
						<DialHoverVeil resetKey={folderId} />
						{virtualized ? (
							<div
								aria-hidden="true"
								data-go-to-top-sentinel
								style={{
									position: "absolute",
									top: 2 * virtualCellHeight + gridMetrics.rowGap,
									left: 0,
									width: 1,
									height: 1,
									pointerEvents: "none",
								}}
							/>
						) : null}
						{orderedRefs.length === 0
							? emptyState
							: renderedIndexes.map((index) => {
									const ref = orderedRefs[index];
									if (!ref) return null;
									if (ref.kind === "folder") {
										const folder = folderById.get(ref.id);
										if (!folder) return null;
										const isSelected =
											Boolean(inheritedFrom) || selectedIds.includes(folder.id);
										return (
											<motion.div
												key={folder.id}
												layout={Boolean(dnd.drag)}
												transition={reorderTransition}
												// The wrapper is the grid item: in icon mode it
												// must also carry the 2×2 folder span, or the
												// folder content overflows a 1×1 cell and stacks
												// over its neighbours. State attributes ride
												// along so the icon feedback selectors
												// (class + attribute on one element) keep
												// matching.
												data-selected={isSelected ? "true" : undefined}
												data-dragging={
													dragGroupIds?.has(folder.id) ? "true" : undefined
												}
												data-marquee-id={folder.id}
												data-virtual-row={
													virtualized
														? Math.floor(index / gridMetrics.columns)
														: undefined
												}
												style={virtualCellStyle(index)}
												className={cn(
													"dial-cell",
													dialLayout === "icon" && "dial-icon-folder-cell",
												)}
											>
												<FolderPreviewCard
													id={folder.id}
													name={folder.name}
													itemCount={cardCounts[folder.id] ?? 0}
													previewCards={previewCards[folder.id] ?? []}
													reordering={Boolean(dnd.drag)}
													dragging={dragGroupIds?.has(folder.id) ?? false}
													isSelected={isSelected}
													onSelect={(e) => handleSelect(e, folder.id)}
													showOpenAction={selectedIds.length > 0}
													insertion={
														dnd.insertion?.key === folder.id
															? dnd.insertion.position
															: null
													}
													dropActive={dnd.nestId === folder.id}
													onClick={(e) =>
														handleFolderClick(e, folder.id, () =>
															onOpenFolder(folder.id),
														)
													}
													onOpen={onOpenFolder}
													onNewSubfolder={onNewSubfolder}
													onDelete={onDeleteFolder}
													getPreviewDragProps={(cardId) =>
														dnd.getPreviewItemDragProps(folder.id, cardId)
													}
													stackDragProps={dnd.getFolderStackDragProps(
														folder.id,
														previewCards[folder.id]?.[8]?.id,
													)}
													previewInsertion={
														dnd.previewInsertion?.folderId === folder.id
															? {
																	targetCardId:
																		dnd.previewInsertion.targetCardId,
																	position: dnd.previewInsertion.position,
																}
															: null
													}
													refuseGroup={dnd.refuseGroup === folder.id}
													dragProps={dnd.getItemDragProps({
														kind: "folder",
														id: folder.id,
													})}
												/>
											</motion.div>
										);
									}
									const card = cardById.get(ref.id);
									if (!card) return null;
									const isSelected =
										Boolean(inheritedFrom) || selectedIds.includes(card.id);
									return (
										<motion.div
											key={card.id}
											layout={Boolean(dnd.drag)}
											transition={reorderTransition}
											className="dial-cell"
											data-marquee-id={card.id}
											data-virtual-row={
												virtualized
													? Math.floor(index / gridMetrics.columns)
													: undefined
											}
											style={virtualCellStyle(index)}
										>
											<DialCard
												card={card}
												onDelete={onDelete}
												isSelected={isSelected}
												onClick={(e) => handleCardClick(e, card.id)}
												onSelect={(e) => handleSelect(e, card.id)}
												dragProps={dnd.getItemDragProps({
													kind: "card",
													id: card.id,
												})}
												insertion={
													dnd.insertion?.key === card.id
														? dnd.insertion.position
														: null
												}
												combineActive={dnd.combineKey === card.id}
												dragging={dragGroupIds?.has(card.id) ?? false}
											/>
										</motion.div>
									);
								})}
					</motion.div>
				</AnimatePresence>
			</div>
		</section>
	);
}
