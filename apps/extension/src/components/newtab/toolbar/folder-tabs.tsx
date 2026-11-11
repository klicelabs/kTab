import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ktab/ui/components/motion/context-menu";
import {
	Tabs,
	TabsList,
	TabsTrigger,
} from "@ktab/ui/components/motion/tabs";
import { Icon } from "@ktab/ui/icons/icon";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { useSpringLoad } from "../../../hooks/use-spring-load";
import {
	type ActiveDrag,
	resolveDragRef,
	setActiveDrag,
	setDragData,
	type TabBox,
	tabDropTargetFor,
	tabGapIndex,
} from "../../../lib/dnd";
import { resolveDragGroup } from "../../../lib/drag-group";
import {
	glassDropdownItem,
	glassFocusRing,
	glassForeground,
	glassMenu,
} from "../../../lib/glass";
import {
	beginGestureCapture,
	buildRenameEntry,
	clearFrozenDragGroup,
	freezeDragGroup,
} from "../../../lib/history-capture";
import type { ItemOrder } from "../../../lib/item-order";
import type { NavigationDirection } from "../../../lib/navigation";
import { TOOLBAR, TOOLBAR_ICON } from "../../../lib/toolbar-tokens";
import { cn } from "../../../lib/utils";
import { useHistoryStore } from "../../../stores/history-store";
import { useMoveDialogStore } from "../../../stores/move-dialog-store";
import { useRenameStore } from "../../../stores/rename-store";
import { useSelectionStore } from "../../../stores/selection-store";
import {
	type InsertPosition,
	useSetupStore,
} from "../../../stores/setup-store";
import type { Folder } from "../../../types";
import { InlineRenameInput } from "../../shared/inline-rename-input";
import { useAppearance } from "../appearance-provider";
import { FolderTabsOverflow } from "./folder-tabs-overflow";
import { GlassSurface } from "./glass-surface";

interface FolderTabsProps {
	folders: Folder[];
	hiddenFolders: Folder[];
	activeRootId: string;
	/** Currently viewed folder id (drives redundant-Open removal by identity). */
	activeFolderId?: string;
	navigationDirection: NavigationDirection;
	/** Inline "+" affordance. Only true while the lane has room (no overflow). */
	showAddButton?: boolean;
	onAddRoot?: () => void;
	onAddFolder: (name: string) => string;
	onSelectFolder: (id: string) => void;
	onNewRootFolder?: () => void;
	onNewSubfolder?: (parentId: string) => void;
	onDeleteFolder?: (id: string) => void;
	/**
	 * Hover preview while a root is dragged across the gaps: writes the order
	 * array only (no legacy `order` reindex, no history). Called on every gap
	 * change, so it must stay cheap.
	 */
	onPreviewReorderFolders?: (
		draggedId: string,
		targetId: string,
		position: InsertPosition,
	) => void;
	/**
	 * The drop that ends a gap drag. This is the single history-worthy write
	 * for the whole gesture: it converges the legacy order fields, and the
	 * caller diffs it against the dragstart capture to produce one entry.
	 */
	onCommitReorderFolders?: (
		draggedId: string,
		targetId: string,
		position: InsertPosition,
	) => void;
	onDropCards?: (cardId: string, folderId: string) => void;
	onMoveFolders?: (folderId: string, targetFolderId: string) => void;
	/** Drop a non-root folder in a gap: hoist to root at that position. */
	onMoveFolderToRoot?: (
		folderId: string,
		targetId: string,
		position: InsertPosition,
	) => void;
	isRootFolder?: (id: string) => boolean;
	canNestFolder?: (folderId: string, targetFolderId: string) => boolean;
}

/** What the pointer over the bar currently means. */
type TabIntent =
	| { kind: "gap"; key: string; position: InsertPosition }
	| { kind: "nest"; id: string }
	/** Refused destination (itself or a descendant): cue, never a drop. */
	| { kind: "blocked"; id: string };

function sameIntent(a: TabIntent | null, b: TabIntent | null): boolean {
	if (a === b) return true;
	if (!a || !b || a.kind !== b.kind) return false;
	if (a.kind === "gap" && b.kind === "gap") {
		return a.key === b.key && a.position === b.position;
	}
	if (a.kind === "nest" && b.kind === "nest") return a.id === b.id;
	if (a.kind === "blocked" && b.kind === "blocked") return a.id === b.id;
	return false;
}

function cloneItemOrder(order: ItemOrder | undefined): ItemOrder {
	const copy: ItemOrder = {};
	for (const [container, keys] of Object.entries(order ?? {})) {
		copy[container] = [...keys];
	}
	return copy;
}

/** D4/NPD-4: arm the same-document gesture marker so grid drop sites accept
 *  a payload that started on the tab bar (see use-grid-dnd). */
function armGestureEpoch() {
	const scope = globalThis as { __ktabDndGestureEpoch?: number };
	scope.__ktabDndGestureEpoch = (scope.__ktabDndGestureEpoch ?? 0) + 1;
}

/**
 * Floating tab bar with spring-load dwell navigation and tab context menu.
 *
 * Drop intent is gap-based. The lane is split into the tabs themselves and
 * the gaps between them: a gap reorders root folders (roots move within the
 * top level, non-roots are hoisted to it), a tab body nests — persist first,
 * navigation second — and spring-load only arms while the pointer is over a
 * tab body. Gaps win even where they overlap a tab's padding, so the two
 * intents never compete for the same pixel.
 *
 * The bar owns every drop decision; the tabs only render the intent they are
 * handed. That is what keeps the "is this a gap or a tab?" question answered
 * once, in one place.
 */
export function FolderTabs({
	folders,
	hiddenFolders,
	activeRootId,
	activeFolderId,
	navigationDirection,
	showAddButton = false,
	onAddRoot,
	onAddFolder,
	onSelectFolder,
	onNewRootFolder,
	onNewSubfolder,
	onDeleteFolder,
	onPreviewReorderFolders,
	onCommitReorderFolders,
	onDropCards,
	onMoveFolders,
	onMoveFolderToRoot,
	isRootFolder,
	canNestFolder,
}: FolderTabsProps) {
	const { isLiquid, resolvedDark } = useAppearance();
	const sorted = [...folders].sort((a, b) => a.order - b.order);
	const barRef = useRef<HTMLDivElement | null>(null);
	const [intent, setIntent] = useState<TabIntent | null>(null);
	// The last preview we asked the store for, so scrubbing inside one gap
	// does not re-write the same order on every dragover.
	const lastPreview = useRef<string | null>(null);
	const selectedIds = useSelectionStore((s) => s.selectedIds);
	// A modifier-click toggles selection without navigating. The Tabs
	// primitive still fires onValueChange for the same click, so the flag
	// below absorbs exactly one navigation right after a toggle.
	const suppressNav = useRef(false);

	function handleSelectFolder(id: string) {
		if (suppressNav.current) {
			suppressNav.current = false;
			return;
		}
		onSelectFolder(id);
	}

	function handleToggleSelect(id: string) {
		suppressNav.current = true;
		// Tabs are always roots: selecting one enters (or stays in) the
		// roots domain, intentionally replacing any content selection.
		useSelectionStore.getState().toggle({ id, kind: "folder", sourceId: null });
	}

	function clearIntent() {
		lastPreview.current = null;
		setIntent((prev) => (prev === null ? prev : null));
	}

	// Backstop for a drag that ends outside the bar (window-level dragend, or
	// the source tab unmounting mid-gesture): the cue must never outlive it.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const reset = () => {
			lastPreview.current = null;
			setIntent(null);
		};
		window.addEventListener("dragend", reset);
		window.addEventListener("drop", reset);
		return () => {
			window.removeEventListener("dragend", reset);
			window.removeEventListener("drop", reset);
		};
	}, []);

	/** Measure the lane in DOM order — the only geometry the gap model needs. */
	function readTabs(): TabBox[] {
		const root = barRef.current;
		if (!root) return [];
		const boxes: TabBox[] = [];
		for (const el of root.querySelectorAll<HTMLElement>("[data-tab-id]")) {
			const id = el.dataset.tabId;
			if (!id) continue;
			const rect = el.getBoundingClientRect();
			boxes.push({ id, left: rect.left, right: rect.right });
		}
		return boxes;
	}

	function nestIntent(dragged: ActiveDrag, targetId: string): TabIntent | null {
		if (canNestFolder && !canNestFolder(dragged.id, targetId)) {
			// Dropping a folder on itself or a descendant would build a cycle.
			// Say so on the target instead of silently refusing the drop.
			return { kind: "blocked", id: targetId };
		}
		return { kind: "nest", id: targetId };
	}

	function resolveIntent(
		clientX: number,
		dragged: ActiveDrag,
	): TabIntent | null {
		const tabs = readTabs();
		if (tabs.length === 0) return null;
		const target = tabDropTargetFor(clientX, tabs);
		if (!target) return null;

		if (dragged.kind === "card") {
			// Cards are not lane items, so they never reorder: the gap they
			// land in is simply the nearest tab to nest into.
			return nestIntent(
				dragged,
				target.kind === "gap" ? target.key : target.id,
			);
		}

		if (target.kind === "nest") return nestIntent(dragged, target.id);

		// Gap. Roots reorder within the top level; anything nested is hoisted
		// to it at this position. Neither touches the hierarchy below.
		if (isRootFolder?.(dragged.id) ?? true) {
			const from = tabs.findIndex((tab) => tab.id === dragged.id);
			const to = tabGapIndex(tabs, target);
			// Landing back where it started is not a move: no rail, no drop.
			if (from !== -1 && (to === from || to === from + 1)) return null;
		}
		return { kind: "gap", key: target.key, position: target.position };
	}

	function handleBarDragOver(e: DragEvent) {
		const dragged = resolveDragRef(e);
		if (!dragged?.id) return;
		const next = resolveIntent(e.clientX, dragged);

		if (!next) {
			// Nothing to do here: let the pointer read as "no drop" rather
			// than arming a gesture the drop would ignore.
			e.dataTransfer.dropEffect = "none";
			if (intent !== null) clearIntent();
			return;
		}

		e.preventDefault();
		e.dataTransfer.dropEffect = next.kind === "blocked" ? "none" : "move";

		if (next.kind === "gap" && (isRootFolder?.(dragged.id) ?? true)) {
			const stamp = `${dragged.id}|${next.key}|${next.position}`;
			if (lastPreview.current !== stamp) {
				lastPreview.current = stamp;
				onPreviewReorderFolders?.(dragged.id, next.key, next.position);
			}
		} else {
			lastPreview.current = null;
		}

		setIntent((prev) => (sameIntent(prev, next) ? prev : next));
	}

	function handleBarDragLeave(e: DragEvent) {
		const related = e.relatedTarget as Node | null;
		if (
			related &&
			e.currentTarget instanceof Node &&
			e.currentTarget.contains(related)
		) {
			return;
		}
		clearIntent();
	}

	function handleBarDrop(e: DragEvent) {
		const dragged = resolveDragRef(e);
		const next = dragged?.id ? resolveIntent(e.clientX, dragged) : null;
		clearIntent();
		setActiveDrag(null);
		if (!dragged?.id || !next || next.kind === "blocked") return;

		// Accepted: swallow it so the page-level drop handlers stay out of a
		// gesture the lane already resolved.
		e.preventDefault();
		e.stopPropagation();

		if (next.kind === "nest") {
			if (dragged.kind === "card") onDropCards?.(dragged.id, next.id);
			else onMoveFolders?.(dragged.id, next.id);
			return;
		}

		if (isRootFolder?.(dragged.id) ?? true) {
			onCommitReorderFolders?.(dragged.id, next.key, next.position);
		} else {
			onMoveFolderToRoot?.(dragged.id, next.key, next.position);
		}
	}

	return (
		<GlassSurface
			shadowless
			variant="toolbar"
			className={cn(TOOLBAR.groupPadding, "w-max min-w-0 max-w-full gap-0.5")}
		>
			<Tabs
				value={activeRootId}
				variant="pill"
				direction={navigationDirection}
				onValueChange={handleSelectFolder}
				className="flex items-center"
			>
				{/* The lane wrapper owns the drop surface. TabsList itself is a
				    bare role="tablist" div and takes no extra props, and the
				    gap between two tabs belongs to neither tab — so intent has
				    to be resolved one level up from both.
				    role="none": the wrapper is a layout box that only adds a
				    pointer-only drop surface, so the accessibility tree stays
				    exactly as it was before the wrapper existed. Dragging has
				    an accessible equivalent in the "Move to…" context menu. */}
				<div
					ref={barRef}
					role="none"
					className="flex min-w-0 items-center"
					onDragOver={handleBarDragOver}
					onDragLeave={handleBarDragLeave}
					onDrop={handleBarDrop}
				>
					<TabsList
						ariaLabel="Folders"
						className="gap-0.5 rounded-full bg-transparent p-0"
					>
						{sorted.map((folder) => (
							<FolderTab
								key={folder.id}
								folder={folder}
								active={folder.id === activeRootId}
								isActiveLocation={
									folder.id === (activeFolderId ?? activeRootId)
								}
								isLiquid={isLiquid}
								resolvedDark={resolvedDark}
								isSelected={selectedIds.includes(folder.id)}
								onToggleSelect={handleToggleSelect}
								insertion={
									intent?.kind === "gap" && intent.key === folder.id
										? intent.position
										: null
								}
								nestActive={intent?.kind === "nest" && intent.id === folder.id}
								blocked={intent?.kind === "blocked" && intent.id === folder.id}
								onIntentClear={clearIntent}
								onSelectFolder={onSelectFolder}
								onNewRootFolder={onNewRootFolder}
								onNewSubfolder={onNewSubfolder}
								onDeleteFolder={onDeleteFolder}
							/>
						))}
					</TabsList>
				</div>
			</Tabs>
			{showAddButton && (
				<button
					type="button"
					onClick={onAddRoot}
					aria-label="New folder"
					title="New folder"
					className={cn(
						TOOLBAR.innerSize,
						"flex shrink-0 items-center justify-center rounded-full transition-colors duration-150",
						glassFocusRing(isLiquid),
						isLiquid
							? `${glassForeground()} hover:bg-foreground/[0.10] hover:text-[var(--ktab-glass-foreground-primary)] active:bg-foreground/15`
							: "text-flat-ink hover:bg-flat-sunken-raised active:bg-flat-sunken",
					)}
				>
					<Icon name="plus" size={15} strokeWidth={TOOLBAR_ICON.strokeWidth} />
				</button>
			)}
			{hiddenFolders.length > 0 && (
				<FolderTabsOverflow
					hiddenFolders={hiddenFolders}
					activeRootId={activeRootId}
					onSelectFolder={onSelectFolder}
					onAddFolder={onAddFolder}
					onDropCards={onDropCards}
					onMoveFolders={onMoveFolders}
					canNestFolder={canNestFolder}
				/>
			)}
		</GlassSurface>
	);
}

interface FolderTabProps {
	folder: Folder;
	active: boolean;
	/** True when the tab IS the viewed location (Open would be a no-op). */
	isActiveLocation?: boolean;
	isLiquid: boolean;
	resolvedDark: boolean;
	isSelected?: boolean;
	onToggleSelect?: (id: string) => void;
	/** This tab's leading/trailing edge carries the insertion rail. */
	insertion: InsertPosition | null;
	/** This tab is the nest destination: highlight it and arm spring-load. */
	nestActive: boolean;
	/** This tab refuses the drop (dragged onto itself or a descendant). */
	blocked: boolean;
	/** Drop ended or was cancelled: the bar must drop its intent. */
	onIntentClear: () => void;
	onSelectFolder: (id: string) => void;
	onNewRootFolder?: () => void;
	onNewSubfolder?: (parentId: string) => void;
	onDeleteFolder?: (id: string) => void;
}

function FolderTab({
	folder,
	active,
	isActiveLocation = false,
	isLiquid,
	resolvedDark,
	isSelected = false,
	onToggleSelect,
	insertion,
	nestActive,
	blocked,
	onIntentClear,
	onSelectFolder,
	onNewRootFolder,
	onNewSubfolder,
	onDeleteFolder,
}: FolderTabProps) {
	const spring = useSpringLoad(() => onSelectFolder(folder.id));
	const tabDragSnapshot = useRef<ItemOrder | null>(null);
	const tabDragActive = useRef(false);

	// Spring-load arms on nest hover only. The bar owns "is the pointer on
	// this tab", so the dwell is driven by that verdict rather than by the
	// tab's own dragover — one source of truth for the intent.
	useEffect(() => {
		if (nestActive) spring.start();
		else spring.cancel();
	}, [nestActive, spring]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !tabDragActive.current) return;
			event.preventDefault();
			event.stopPropagation();
			const snapshot = tabDragSnapshot.current;
			tabDragSnapshot.current = null;
			tabDragActive.current = false;
			if (snapshot) useSetupStore.getState().restoreItemOrder(snapshot);
			spring.cancel();
			onIntentClear();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onIntentClear, spring]);

	const editing = useRenameStore((s) => s.isEditing("folder", folder.id));
	const beginRename = useRenameStore((s) => s.begin);
	const cancelRename = useRenameStore((s) => s.cancel);
	const openMoveDialog = useMoveDialogStore((s) => s.open);

	function handleCommitRename(name: string) {
		const store = useSetupStore.getState();
		const before = store.folders.find((f) => f.id === folder.id);
		store.updateFolder(folder.id, name);
		if (before && before.name !== name) {
			const entry = buildRenameEntry(before, { ...before, name });
			if (entry) useHistoryStore.getState().commit(entry);
		}
		cancelRename();
	}

	function handleDragStart(e: DragEvent) {
		tabDragSnapshot.current = cloneItemOrder(
			useSetupStore.getState().itemOrder,
		);
		tabDragActive.current = true;
		// Freeze order for history: hover writes mutate it and the drop diffs
		// back to this capture (one entry).
		const setup = useSetupStore.getState();
		beginGestureCapture(setup.cards, setup.folders, setup.itemOrder);
		// L8: freeze the drag group so a selection cleared mid-drag cannot
		// shrink the tab drop.
		freezeDragGroup(
			resolveDragGroup(
				{ kind: "folder", id: folder.id },
				useSelectionStore.getState().items,
				setup.cards,
				setup.folders,
				setup.itemOrder,
			),
		);
		if (!useSelectionStore.getState().selectedIds.includes(folder.id)) {
			useSelectionStore.getState().clear();
		}
		// A root folder lives only in this bar, so the bar is the only place
		// that can mark the gesture as same-document. Without this the grid
		// refuses the drop as a foreign payload.
		armGestureEpoch();
		setDragData(e, "folder", folder.id);
	}

	function handleDragEnd() {
		tabDragSnapshot.current = null;
		tabDragActive.current = false;
		setActiveDrag(null);
		spring.cancel();
		onIntentClear();
		// L8: gesture over — retire the frozen group.
		clearFrozenDragGroup();
	}

	const baseClass = cn(
		TOOLBAR.controlHeight,
		TOOLBAR.radius,
		TOOLBAR.transition,
		"max-w-[160px] select-none truncate px-3 text-[13px] [-webkit-user-drag:element]",
		glassFocusRing(isLiquid),
		active
			? isLiquid
				? cn("font-medium", glassForeground())
				: "font-medium text-flat-ink"
			: isLiquid
				? cn(
						"font-normal",
						glassForeground("secondary"),
						"hover:bg-foreground/[0.10] hover:text-[var(--ktab-glass-foreground-primary)] active:bg-foreground/15",
					)
				: "font-normal text-flat-ink hover:bg-flat-sunken-raised active:bg-flat-sunken",
		isSelected &&
			(isLiquid
				? "ring-1 ring-foreground/40 ring-inset"
				: "ring-1 ring-flat-edge-strong ring-inset"),
	);

	const dropClass = nestActive
		? isLiquid
			? cn("bg-foreground/10 ring-1 ring-foreground/30", glassForeground())
			: "bg-flat-sunken-raised text-flat-ink ring-1 ring-flat-edge-strong"
		: "";
	const indicatorClass = cn(
		"pointer-events-none",
		// Active tab keeps its face wash for hierarchy, but like every other
		// toolbar control it carries no elevation shadow.
		isLiquid ? "bg-foreground/10" : "face-control shadow-none",
		nestActive &&
			(isLiquid ? "ring-1 ring-foreground/30" : "ring-1 ring-flat-edge-strong"),
	);

	if (editing) {
		return (
			<TabsTrigger
				value={folder.id}
				className={cn(baseClass, "flex items-center")}
				indicatorClassName={indicatorClass}
				render={
					<div className="flex max-w-[160px] items-center px-3">
						<InlineRenameInput
							value={folder.name}
							ariaLabel={`Rename folder ${folder.name}`}
							onCommit={handleCommitRename}
							onCancel={cancelRename}
							className="text-[13px]"
						/>
					</div>
				}
			/>
		);
	}

	return (
		<ContextMenu>
			<TabsTrigger
				value={folder.id}
				className={cn(
					baseClass,
					dropClass,
					insertion === "before" && "tab-insert-before",
					insertion === "after" && "tab-insert-after",
				)}
				indicatorClassName={indicatorClass}
				render={
					<ContextMenuTrigger title={folder.name}>
						<button
							data-local-context-menu
							data-tab-id={folder.id}
							data-drop-blocked={blocked || undefined}
							type="button"
							title={folder.name}
							draggable
							onClick={(e) => {
								if (e.metaKey || e.ctrlKey) {
									e.preventDefault();
									onToggleSelect?.(folder.id);
								}
							}}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
						>
							{folder.name}
						</button>
					</ContextMenuTrigger>
				}
			/>

			<ContextMenuContent className={glassMenu(isLiquid, resolvedDark)}>
				{/* Open is a no-op on the viewed location: remove it entirely
				    (identity by id, never by label) rather than disabling. */}
				{!isActiveLocation && (
					<ContextMenuItem
						className={glassDropdownItem(isLiquid, resolvedDark, {
							pillOwned: true,
						})}
						onSelect={() => onSelectFolder(folder.id)}
					>
						<Icon name="folder" size={14} />
						Open
					</ContextMenuItem>
				)}
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={onNewRootFolder}
				>
					<Icon name="folder-plus" size={14} />
					New Folder
				</ContextMenuItem>
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={() => onNewSubfolder?.(folder.id)}
				>
					<Icon name="folder-plus" size={14} />
					New subfolder
				</ContextMenuItem>
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={() => beginRename({ kind: "folder", id: folder.id })}
				>
					<Icon name="pencil" size={14} />
					Rename
				</ContextMenuItem>
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={() =>
						useSelectionStore
							.getState()
							.toggle({ id: folder.id, kind: "folder", sourceId: null })
					}
				>
					<Icon name="check-square" size={14} />
					Select
				</ContextMenuItem>
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					onSelect={() => {
						const selected = useSelectionStore.getState().selectedIds;
						openMoveDialog(
							selected.includes(folder.id) ? selected : [folder.id],
						);
					}}
				>
					<Icon name="folder" size={14} />
					Move to…
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					className={glassDropdownItem(isLiquid, resolvedDark, {
						pillOwned: true,
					})}
					tone="destructive"
					onSelect={() => onDeleteFolder?.(folder.id)}
				>
					<Icon name="trash" size={14} />
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
