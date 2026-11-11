import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@ktab/ui/components/input-group";
import {
	MorphPopover,
	MorphPopoverContent,
	MorphPopoverTrigger,
} from "@ktab/ui/components/motion/popover-morph";
import { Icon } from "@ktab/ui/icons/icon";
import { flatControl } from "@ktab/ui/lib/surface";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveDragRef, setActiveDrag } from "../../../lib/dnd";
import { buildRenameEntry } from "../../../lib/history-capture";
import {
	glassDropdown,
	glassDropdownItemPill,
	glassFieldPill,
	glassForeground,
	glassText,
} from "../../../lib/glass";
import { cn } from "../../../lib/utils";
import { useHistoryStore } from "../../../stores/history-store";
import { useRenameStore } from "../../../stores/rename-store";
import { useSetupStore } from "../../../stores/setup-store";
import type { Folder } from "../../../types";
import { InlineRenameInput } from "../../shared/inline-rename-input";
import { useAppearance } from "../appearance-provider";
import { ToolbarIconButton } from "./toolbar-icon-button";

interface FolderTabsOverflowProps {
	hiddenFolders: Folder[];
	activeRootId: string;
	onSelectFolder: (id: string) => void;
	onAddFolder: (name: string) => string;
	onDropCards?: (cardId: string, folderId: string) => void;
	onMoveFolders?: (folderId: string, targetFolderId: string) => void;
	canNestFolder?: (folderId: string, targetFolderId: string) => boolean;
}

/**
 * "⋯" overflow button — same height and radius as all toolbar controls.
 *
 * The top input is reused for folder creation: pressing "+" switches the
 * SAME field into create mode (placeholder + behavior change) instead of
 * stacking a second input underneath. The "+" morphs into a confirm check
 * once a non-empty name is typed.
 */
export function FolderTabsOverflow({
	hiddenFolders,
	activeRootId,
	onSelectFolder,
	onAddFolder,
	onDropCards,
	onMoveFolders,
	canNestFolder,
}: FolderTabsOverflowProps) {
	const { isLiquid, resolvedDark } = useAppearance();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const [dropId, setDropId] = useState<string | null>(null);
	// Briefly highlights a just-created folder so it is immediately visible
	// in the list.
	const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	// A rename session for a hidden tab surfaces here, so creating a root
	// folder never strands an invisible editing state.
	const editingFolderId = useRenameStore((s) =>
		s.editing?.kind === "folder" ? s.editing.id : null,
	);
	const cancelRename = useRenameStore((s) => s.cancel);
	const inputRef = useRef<HTMLInputElement>(null);

	const filtered = query.trim()
		? hiddenFolders.filter((f) =>
				f.name.toLowerCase().includes(query.toLowerCase()),
			)
		: hiddenFolders;

	const canConfirm = newName.trim().length > 0;

	const handleSelect = useCallback(
		(id: string) => {
			onSelectFolder(id);
			setOpen(false);
			setQuery("");
			setCreating(false);
			setNewName("");
			setJustCreatedId(null);
		},
		[onSelectFolder],
	);

	// Creation keeps the dropdown open with interaction continuity: reset
	// to the plain folder list, reveal the new folder with a highlight, and
	// only close on explicit select / outside click / Escape.
	const handleCreate = useCallback(() => {
		const name = newName.trim();
		if (!name) return;
		const id = onAddFolder(name);
		setCreating(false);
		setNewName("");
		setQuery("");
		setJustCreatedId(id);
		requestAnimationFrame(() => {
			listRef.current
				?.querySelector(`[data-folder-row="${id}"]`)
				?.scrollIntoView({ block: "nearest" });
		});
	}, [newName, onAddFolder]);

	function enterCreateMode() {
		setCreating(true);
		// Same element keeps focus; caret lands at the end of the cleared value.
		requestAnimationFrame(() => inputRef.current?.select());
	}

	function exitCreateMode() {
		setCreating(false);
		setNewName("");
		requestAnimationFrame(() => inputRef.current?.focus());
	}

	const closeMenu = useCallback(() => {
		setOpen(false);
		setQuery("");
		setCreating(false);
		setNewName("");
		setDropId(null);
		setJustCreatedId(null);
	}, []);

	function handleRowDragOver(folder: Folder) {
		return (e: React.DragEvent) => {
			const dragged = resolveDragRef(e);
			if (!dragged?.id) return;
			if (dragged.kind === "card") {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				setDropId(folder.id);
				return;
			}
			if (
				dragged.id !== folder.id &&
				(canNestFolder ? canNestFolder(dragged.id, folder.id) : true)
			) {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				setDropId(folder.id);
			}
		};
	}

	function handleRowDrop(folder: Folder) {
		return (e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setDropId(null);
			setActiveDrag(null);
			const dragged = resolveDragRef(e);
			if (!dragged?.id || dragged.id === folder.id) return;
			if (dragged.kind === "card") {
				onDropCards?.(dragged.id, folder.id);
			} else {
				if (canNestFolder && !canNestFolder(dragged.id, folder.id)) return;
				onMoveFolders?.(dragged.id, folder.id);
			}
			// The move persisted first; follow it so the item is visible.
			onSelectFolder(folder.id);
			setOpen(false);
			setQuery("");
			setCreating(false);
			setNewName("");
		};
	}

	useEffect(() => {
		if (!open) return;
		const id = setTimeout(() => inputRef.current?.focus(), 60);
		return () => {
			clearTimeout(id);
		};
	}, [open]);

	return (
		<MorphPopover
			open={open}
			onOpenChange={(next) => (next ? setOpen(true) : closeMenu())}
		>
			<MorphPopoverTrigger>
				<span className="inline-flex">
					<ToolbarIconButton
						icon="ellipsis"
						label="More folders"
						active={open}
						insideSurface
						onClick={() => setOpen(!open)}
					/>
				</span>
			</MorphPopoverTrigger>

			<MorphPopoverContent
				side="bottom"
				align="end"
				sideOffset={6}
				className={cn(
					glassDropdown(isLiquid, resolvedDark),
					"flex max-h-[260px] w-52 min-w-0 max-w-[calc(100vw-1.5rem)] flex-col",
				)}
			>
				<div className={cn("contents")}>
					<div className="px-1.5 pt-1.5 pb-1">
						<InputGroup
							className={cn(
								"h-8 w-full min-w-0 rounded-full",
								glassFieldPill(isLiquid),
							)}
						>
							{/* Leading glyph. The shared InputGroup addon owns the inset, so
							    the icon is never hand-positioned inside the field. The
							    explicit `size-*` class opts the glyph out of the addon's
							    `svg:not([class*=size-])` resize rule. */}
							<InputGroupAddon
								align="inline-start"
								className="py-0 pr-0.5 pl-2.5"
							>
								<Icon
									name="search"
									size={14}
									aria-hidden="true"
									className={cn("size-3.5 shrink-0", glassForeground())}
								/>
							</InputGroupAddon>
							<InputGroupInput
								ref={inputRef}
								type="text"
								placeholder={creating ? "Folder name..." : "Search folders..."}
								aria-label={creating ? "New folder name" : "Search folders"}
								value={creating ? newName : query}
								onChange={(e) =>
									creating
										? setNewName(e.target.value)
										: setQuery(e.target.value)
								}
								onKeyDown={(e) => {
									if (e.key === "Enter" && creating) {
										e.preventDefault();
										handleCreate();
									} else if (e.key === "Escape" && creating) {
										// Leave create mode first; a second Escape
										// closes the menu via the document handler.
										e.stopPropagation();
										exitCreateMode();
									}
								}}
								className={cn(
									// Horizontal padding is driven by the group's addon
									// rules (pl-1.5 / pr-1.5), so the icon-to-text gap
									// and the trailing button inset stay symmetric.
									"h-8 min-w-0 py-0 text-[13px]",
									isLiquid
									? cn(glassForeground(), "placeholder:text-[var(--ktab-glass-foreground-secondary)]")
										: "text-foreground placeholder:text-muted-foreground",
								)}
							/>
							<InputGroupAddon align="inline-end" className="py-0 pr-1 pl-0">
								<button
									type="button"
									aria-label={
										creating
											? canConfirm
												? "Create folder"
												: "Folder name required"
											: "New folder"
									}
									aria-expanded={creating}
									onClick={() => {
										if (!creating) {
											enterCreateMode();
										} else if (canConfirm) {
											handleCreate();
										}
									}}
									className={cn(
										"flex size-6 shrink-0 items-center justify-center rounded-full transition-colors",
										creating && canConfirm
											? isLiquid
											? cn("bg-foreground/10 hover:bg-foreground/15", glassForeground())
												: `${flatControl()} text-flat-ink`
											: isLiquid
											? cn(glassForeground(), "hover:bg-foreground/10 hover:text-[var(--ktab-glass-foreground-primary)] active:bg-foreground/15")
												: "text-flat-ink-muted hover:bg-flat-sunken-raised hover:text-flat-ink active:bg-flat-sunken",
									)}
								>
									<Icon
										name={creating && canConfirm ? "check" : "plus"}
										size={13}
									/>
								</button>
							</InputGroupAddon>
						</InputGroup>
					</div>

					<div
						ref={listRef}
						className="scrollbar-hidden max-h-[196px] min-h-0 flex-1 overflow-y-auto overscroll-contain"
					>
						{filtered.length === 0 ? (
							<div
								className={cn(
									"px-3 py-4 text-center text-[12px]",
									glassText(isLiquid, "muted", resolvedDark),
								)}
							>
								{creating
									? "Type a name, then press Enter"
									: "No folders found"}
							</div>
						) : (
							filtered.map((folder) =>
								editingFolderId === folder.id ? (
									<div
										key={folder.id}
										className={cn(
											"flex w-full items-center gap-2",
											glassDropdownItemPill(isLiquid, resolvedDark),
										)}
									>
										<Icon
											name="folder"
											size={14}
											className={cn("shrink-0", isLiquid && glassForeground())}
										/>
										<InlineRenameInput
											value={folder.name}
											ariaLabel={`Rename folder ${folder.name}`}
											onCommit={(name) => {
												const store = useSetupStore.getState();
												const before = store.folders.find(
													(f) => f.id === folder.id,
												);
												store.updateFolder(folder.id, name);
												if (before && before.name !== name) {
													const entry = buildRenameEntry(before, {
														...before,
														name,
													});
													if (entry) useHistoryStore.getState().commit(entry);
												}
												cancelRename();
											}}
											onCancel={cancelRename}
											className="text-[13px]"
										/>
									</div>
								) : (
									<button
										key={folder.id}
										type="button"
										data-folder-row={folder.id}
										onClick={() => handleSelect(folder.id)}
										onDragOver={handleRowDragOver(folder)}
										onDragLeave={() =>
											setDropId((prev) => (prev === folder.id ? null : prev))
										}
										onDrop={handleRowDrop(folder)}
										className={cn(
											"flex w-full items-center gap-2",
											glassDropdownItemPill(isLiquid, resolvedDark),
											folder.id === activeRootId
												? isLiquid
											? "bg-foreground/10"
													: "bg-muted"
												: "",
											dropId === folder.id &&
												(isLiquid
											? cn("bg-foreground/15 ring-1 ring-foreground/30", glassForeground())
													: "bg-accent text-accent-foreground ring-1 ring-ring"),
											justCreatedId === folder.id &&
												(isLiquid
											? cn("bg-foreground/10 ring-1 ring-foreground/25", glassForeground())
													: "bg-accent/70 text-accent-foreground ring-1 ring-ring/40"),
										)}
									>
										<Icon
											name="folder"
											size={14}
											className={cn("shrink-0", isLiquid && glassForeground())}
										/>
										<span className="truncate">{folder.name}</span>
										{folder.id === activeRootId && (
											<Icon
												name="check"
												size={13}
											className={cn("ml-auto shrink-0", isLiquid && glassForeground())}
											/>
										)}
									</button>
								),
							)
						)}
					</div>
				</div>
			</MorphPopoverContent>
		</MorphPopover>
	);
}
