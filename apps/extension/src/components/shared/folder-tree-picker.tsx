import {
	FileTree,
	FileTreeFile,
	FileTreeFolder,
} from "@ktab/ui/components/motion/file-tree";
import {
	Popover,
	PopoverPopup,
	PopoverPortal,
	PopoverPositioner,
	PopoverTrigger,
} from "@ktab/ui/components/popover";
import { Icon } from "@ktab/ui/icons/icon";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { SETTINGS_SCOPE_CLASS } from "../../lib/context-scope";
import { buildTree, type FolderTreeNode } from "../../lib/folder-tree";
import { glassForeground, glassMaterial, glassShape } from "../../lib/glass";
import { cn } from "../../lib/utils";
import type { Folder } from "../../types";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_TRIGGER,
} from "../newtab/settings/shared/settings-tokens";

const ROOT_VALUE = "__root__";

interface FolderTreePickerProps {
	folders: Folder[];
	value: string | null;
	onChange: (folderId: string | null) => void;
	label?: string;
	excludeIds?: string[];
	allowRoot?: boolean;
	rootLabel?: string;
	className?: string;
	isLiquid?: boolean;
}

function renderFolder(
	node: FolderTreeNode,
	disabled: ReadonlySet<string>,
): ReactNode {
	return (
		<FileTreeFolder
			key={node.folder.id}
			value={node.folder.id}
			name={node.folder.name}
			disabled={disabled.has(node.folder.id)}
			icon={<Icon name="folder" size={14} aria-hidden="true" />}
		>
			{node.children.map((child) => renderFolder(child, disabled))}
		</FileTreeFolder>
	);
}

function expandedChainFor(folders: Folder[], value: string | null): string[] {
	const expanded: string[] = [];
	const byId = new Map(folders.map((folder) => [folder.id, folder]));
	let parentId = value ? (byId.get(value)?.parentId ?? null) : null;
	while (parentId) {
		expanded.push(parentId);
		parentId = byId.get(parentId)?.parentId ?? null;
	}
	return expanded;
}

/**
 * Shared folder destination picker.
 *
 * Structural rule: navigating the tree NEVER commits. Clicking a folder
 * expands/collapses it and stages it as the pending destination; the picker
 * only closes on an intentional commit (Select button, double-click, or
 * Enter on the Select control) or an explicit dismissal (Escape, Cancel,
 * outside click). This is what keeps nested navigation usable — one shared
 * foundation for every File Tree usage (Move To, bookmark folders, folder
 * parents), so no instance can regress independently.
 */
export function FolderTreePicker({
	folders,
	value,
	onChange,
	label = "Choose a folder",
	excludeIds,
	allowRoot = true,
	rootLabel = "No parent",
	className,
	isLiquid = false,
}: FolderTreePickerProps) {
	const tree = useMemo(() => buildTree(folders), [folders]);
	const disabledSet = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
	const [open, setOpen] = useState(false);
	/** Staged destination — committed only intentionally, never by expanding. */
	const [pending, setPending] = useState<string | null>(value);
	const [expandedIds, setExpandedIds] = useState<string[]>(() =>
		expandedChainFor(folders, value),
	);

	// Re-stage whenever the picker opens or the committed value changes.
	useEffect(() => {
		if (open) {
			setPending(value);
			setExpandedIds(expandedChainFor(folders, value));
		}
	}, [open, value, folders]);

	const emptyLabel = allowRoot ? rootLabel : "Select folder";
	const selectedLabel = value
		? (folders.find((folder) => folder.id === value)?.name ?? "Select folder")
		: emptyLabel;
	const pendingLabel =
		pending === null
			? emptyLabel
			: (folders.find((folder) => folder.id === pending)?.name ??
				selectedLabel);

	const canCommit =
		pending !== null &&
		!disabledSet.has(pending) &&
		(pending !== ROOT_VALUE || allowRoot);

	function commit(next: string | null) {
		const resolved = next === ROOT_VALUE ? null : next;
		if (resolved !== null && disabledSet.has(resolved)) return;
		if (resolved === null && !allowRoot) return;
		onChange(resolved);
		setOpen(false);
	}

	function handleTreeChange(next: string) {
		// Stage only — expanding or collapsing a folder must not dismiss.
		if (next === ROOT_VALUE) {
			if (allowRoot) setPending(ROOT_VALUE);
			return;
		}
		if (disabledSet.has(next)) return;
		setPending(next);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						aria-label={`${label}: ${selectedLabel}`}
						aria-expanded={open}
						aria-haspopup="tree"
						className={cn(
							"flex h-8 w-full items-center gap-1.5 px-2.5 text-left outline-none",
							SETTINGS_TRIGGER,
							SETTINGS_FOCUS_RING,
							isLiquid &&
								cn(glassForeground(), "hover:bg-foreground/[0.08]"),
							className,
						)}
					>
						<Icon
							name="folder"
							size={14}
							className={cn(
								"shrink-0",
								isLiquid && glassForeground(),
							)}
							aria-hidden="true"
						/>
						<span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
						<Icon
							name="chevron-down"
							size={14}
							className={cn("shrink-0", isLiquid && glassForeground())}
							aria-hidden="true"
						/>
					</button>
				}
			/>
			<PopoverPortal>
				<PopoverPositioner side="bottom" align="start" sideOffset={6}>
					<PopoverPopup
						className={cn(
							"w-[min(320px,calc(100vw-32px))] p-1.5 outline-none",
							SETTINGS_SCOPE_CLASS,
							glassShape("panel"),
							glassMaterial(isLiquid, "menu", "dense"),
							isLiquid
								? glassForeground()
								: "text-flat-ink",
						)}
					>
						<FileTree
							value={pending ?? (allowRoot ? ROOT_VALUE : null)}
							onValueChange={handleTreeChange}
							expandedIds={expandedIds}
							onExpandedChange={setExpandedIds}
							ariaLabel={label}
							className="max-h-64 overflow-y-auto"
							classNames={{
								item: cn(
									glassShape("control"),
									isLiquid
										? `${glassForeground()} hover:bg-foreground/[0.08] hover:text-[var(--ktab-glass-foreground-primary)] focus-visible:bg-[var(--ktab-accent)] focus-visible:text-[var(--ktab-accent-foreground)]`
										: "text-flat-ink-muted hover:bg-flat-face-hover hover:text-flat-ink",
								),
								icon: isLiquid
									? glassForeground("secondary")
									: "text-flat-ink-muted",
							}}
						>
							{allowRoot && (
								<FileTreeFile
									value={ROOT_VALUE}
									name={rootLabel}
									icon={<Icon name="folder" size={14} aria-hidden="true" />}
								/>
							)}
							{tree.map((node) => renderFolder(node, disabledSet))}
						</FileTree>
						<div className="flex items-center gap-2 border-border/50 border-t px-1.5 pt-1.5 pb-0.5">
							<span
								className={cn(
									"min-w-0 flex-1 truncate text-xs",
									isLiquid
										? glassForeground("secondary")
										: "text-muted-foreground",
								)}
								aria-live="polite"
							>
								{pendingLabel}
							</span>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className={cn(
									"inline-flex h-8 shrink-0 items-center justify-center px-2.5 font-medium text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									isLiquid ? glassForeground("secondary") : "text-muted-foreground",
									isLiquid && "hover:text-[var(--ktab-glass-foreground-primary)]",
									glassShape("control"),
								)}
							>
								Cancel
							</button>
							<button
								type="button"
								disabled={!canCommit}
								onClick={() => pending !== null && commit(pending)}
								onDoubleClick={() => pending !== null && commit(pending)}
								className={cn(
									"inline-flex h-8 shrink-0 items-center justify-center bg-primary px-3 font-medium text-primary-foreground text-xs transition-[background-color,opacity] hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
									glassShape("control"),
								)}
							>
								Select
							</button>
						</div>
					</PopoverPopup>
				</PopoverPositioner>
			</PopoverPortal>
		</Popover>
	);
}
