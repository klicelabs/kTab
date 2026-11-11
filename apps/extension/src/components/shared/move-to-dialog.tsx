import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ktab/ui/components/dialog";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SETTINGS_SCOPE_CLASS } from "../../lib/context-scope";
import { getSubtreeIds } from "../../lib/folder-tree";
import { glassShape } from "../../lib/glass";
import { buildHistoryEntry, snapshotSetup } from "../../lib/history-capture";
import { describeMoveGroup } from "../../lib/move-selection";
import { cn } from "../../lib/utils";
import { useHistoryStore } from "../../stores/history-store";
import { useMoveDialogStore } from "../../stores/move-dialog-store";
import { useSelectionStore } from "../../stores/selection-store";
import { useSetupStore } from "../../stores/setup-store";
import { useAppearance } from "../newtab/appearance-provider";
import { SettingsAction } from "../newtab/settings/shared/settings-action";
import { FolderTreePicker } from "./folder-tree-picker";

/**
 * Lightweight "Move to…" destination picker for the current selection (or a
 * single item). Not Settings — one labelled picker + Move/Cancel.
 *
 * Moves are atomic (one store call), order-preserving, and cycle-safe:
 * folders cannot land inside themselves or their descendants, and bookmarks
 * cannot live at the top level.
 */
/**
 * Option B decision: does this move carry away the folder the user is standing
 * in, and if so where should the app follow it?
 *
 * Pure on purpose — the acceptance cases (into a root folder, into a
 * descendant, to the top level, and every "not the current folder" shape) are
 * then testable without rendering the destination picker.
 *
 * Identity is the folder ID, never its name or path. Top level returns null by
 * design: the moved folder BECOMES a root there, so the derived breadcrumb
 * collapses on its own and there is nowhere new to go.
 */
export function moveFollowTarget(
	destinationId: string | null | undefined,
	folderIds: readonly string[],
	activeFolderId: string,
): string | null {
	if (typeof destinationId !== "string") return null;
	return folderIds.includes(activeFolderId) ? destinationId : null;
}

export function MoveToDialog({
	onNavigate,
}: {
	/**
	 * Option B: when the move carries away the folder the user is standing in,
	 * the app follows it to the destination so the breadcrumb and the active
	 * tab keep describing a real place. The caller owns navigation (Back stack,
	 * page transition), so this is the app's own `handleSelectFolder`.
	 */
	onNavigate: (folderId: string) => void;
}) {
	const ids = useMoveDialogStore((s) => s.ids);
	const close = useMoveDialogStore((s) => s.close);
	const folders = useSetupStore((s) => s.folders);
	const cards = useSetupStore((s) => s.cards);
	const activeFolderId = useSetupStore((s) => s.activeFolderId);
	const moveItemsToContainer = useSetupStore((s) => s.moveItemsToContainer);
	const { isLiquid } = useAppearance();

	// undefined = nothing chosen yet; null = explicitly chosen Top level.
	const [destinationId, setDestinationId] = useState<string | null | undefined>(
		undefined,
	);
	const [error, setError] = useState<string | null>(null);

	const open = ids !== null;

	// Fresh session per opening: never inherit a previous destination.
	// The selected payload can change while the dialog remains mounted/open;
	// reset the explicit destination for that new move session.
	// biome-ignore lint/correctness/useExhaustiveDependencies: ids marks a new move payload.
	useEffect(() => {
		if (open) {
			setDestinationId(undefined);
			setError(null);
		}
	}, [open, ids]);

	const { cardIds, folderIds, excludeIds, summary } = useMemo(() => {
		if (!ids)
			return { cardIds: [], folderIds: [], excludeIds: [], summary: "" };
		const cardIdSet = new Set(cards.map((c) => c.id));
		const cardIds = ids.filter((id) => cardIdSet.has(id));
		const folderIds = ids.filter((id) => folders.some((f) => f.id === id));
		const excludeIds = folderIds.flatMap((id) => getSubtreeIds(folders, id));
		const parts: string[] = [];
		if (cardIds.length > 0)
			parts.push(
				`${cardIds.length} bookmark${cardIds.length === 1 ? "" : "s"}`,
			);
		if (folderIds.length > 0)
			parts.push(
				`${folderIds.length} folder${folderIds.length === 1 ? "" : "s"}`,
			);
		return { cardIds, folderIds, excludeIds, summary: parts.join(" + ") };
	}, [ids, cards, folders]);

	function handleClose() {
		setDestinationId(undefined);
		setError(null);
		close();
	}

	function handleMove() {
		if (destinationId === undefined) return;
		if (cardIds.length === 0 && folderIds.length === 0) {
			setError("Nothing left to move.");
			return;
		}
		if (destinationId === null && cardIds.length > 0) {
			setError("Bookmarks can't live at the top level.");
			return;
		}
		const dest =
			destinationId === null
				? null
				: (folders.find((f) => f.id === destinationId) ?? null);
		const before = snapshotSetup(
			cards,
			folders,
			useSetupStore.getState().itemOrder,
		);
		moveItemsToContainer(destinationId, cardIds, folderIds);
		const live = useSetupStore.getState();
		const total = cardIds.length + folderIds.length;
		const movedCard =
			total === 1 && cardIds.length === 1 ? cardIds[0] : undefined;
		const movedFolder =
			total === 1 && folderIds.length === 1 ? folderIds[0] : undefined;
		const entry = buildHistoryEntry(
			before,
			live.cards,
			live.folders,
			live.itemOrder,
			{
				kind: "move",
				total,
				cardCount: cardIds.length,
				folderCount: folderIds.length,
				dest: dest?.name ?? "Top level",
				label:
					movedCard !== undefined
						? live.cards.find((c) => c.id === movedCard)?.title?.trim() ||
							undefined
						: movedFolder !== undefined
							? live.folders.find((f) => f.id === movedFolder)?.name
							: undefined,
			},
		);
		// Option B: moving the folder the user is standing in follows it to its
		// new home, so the breadcrumb and the active tab keep describing a place
		// that exists where the user left it.
		const followDestination = moveFollowTarget(
			destinationId,
			folderIds,
			activeFolderId,
		);
		if (entry && followDestination) {
			// One gesture, one entry: the view travels with the tree, so undo
			// puts the user back where they were instead of leaving them on a
			// destination they only reached because of this move.
			entry.undo.location = activeFolderId;
			entry.redo.location = followDestination;
		}
		if (entry) useHistoryStore.getState().commit(entry, { silent: true });
		if (followDestination) onNavigate(followDestination);
		toast.success(total === 1 ? "Item moved" : `${total} items moved`, {
			description: dest
				? `to ${dest.name} · ${describeMoveGroup(cardIds.length, folderIds.length)}`
				: `to the top level · ${describeMoveGroup(cardIds.length, folderIds.length)}`,
			// Same safety model: Undo opens confirmation, never executes.
			action: entry
				? {
						label: "Undo",
						onClick: () => useHistoryStore.getState().requestUndo(entry.id),
					}
				: undefined,
		});
		useSelectionStore.getState().clear();
		handleClose();
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) handleClose();
			}}
		>
			<DialogContent
				closeGlass={isLiquid}
				className={cn(
					glassShape("panel"),
					SETTINGS_SCOPE_CLASS,
					"sm:max-w-[360px]",
				)}
			>
				<DialogHeader>
					<DialogTitle>Move to folder</DialogTitle>
					<DialogDescription>
						{summary ? `Move ${summary}.` : "Choose a destination."}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2 py-1">
					<FolderTreePicker
						folders={folders}
						value={destinationId ?? null}
						onChange={(id) => {
							setDestinationId(id);
							setError(null);
						}}
						allowRoot={cardIds.length === 0}
						rootLabel="Top level"
						excludeIds={excludeIds}
						isLiquid={isLiquid}
						className="h-9 w-full text-xs"
					/>
					{error && (
						<p className="text-destructive text-xs" role="alert">
							{error}
						</p>
					)}
				</div>

				<DialogFooter className="pt-1">
					<SettingsAction onClick={handleClose}>Cancel</SettingsAction>
					<SettingsAction
						tone="primary"
						onClick={handleMove}
						disabled={destinationId === undefined}
					>
						Move here
					</SettingsAction>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
