import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ktab/ui/components/dialog";
import { Icon } from "@ktab/ui/icons/icon";
import { describeHistoryAction } from "../../lib/history";
import { cn } from "../../lib/utils";
import { useHistoryStore } from "../../stores/history-store";

interface HistoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * Minimal recent-actions surface. Rows never execute directly: picking one
 * closes the dialog and opens the standard confirmation first. Undo rows
 * cascade top-down to the picked entry ("undo to here"); redo rows mirror
 * that from the redo branch. Dismissal keeps every entry in history.
 */
export function HistoryDialog({ open, onOpenChange }: HistoryDialogProps) {
	const past = useHistoryStore((s) => s.past);
	const future = useHistoryStore((s) => s.future);
	const recentPast = past.slice(-8).reverse();
	const recentFuture = future.slice(0, 8);
	const empty = past.length === 0 && future.length === 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				aria-label="Recent actions"
				className="max-h-[70dvh] overflow-hidden"
			>
				<DialogHeader>
					<DialogTitle>Recent actions</DialogTitle>
					<DialogDescription>
						{empty
							? "Moves and reorders will appear here for review."
							: "Pick an action to undo or redo it — confirmation first, always."}
					</DialogDescription>
				</DialogHeader>
				{!empty && (
					<ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
						{recentPast.map((entry) => (
							<li key={entry.id}>
								<button
									type="button"
									onClick={() => {
										onOpenChange(false);
										useHistoryStore.getState().requestUndoTo(entry.id);
									}}
									title={`Undo to here: ${describeHistoryAction(entry.summary)}`}
									className={cn(
										"flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
										"text-flat-ink hover:bg-flat-sunken-raised",
										"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									)}
								>
									<Icon name="undo" size={14} aria-hidden="true" />
									<span className="min-w-0 flex-1 truncate">
										{describeHistoryAction(entry.summary)}
									</span>
								</button>
							</li>
						))}
						{recentFuture.map((entry) => (
							<li key={entry.id}>
								<button
									type="button"
									onClick={() => {
										onOpenChange(false);
										useHistoryStore.getState().requestRedoTo(entry.id);
									}}
									title={`Redo to here: ${describeHistoryAction(entry.summary)}`}
									className={cn(
										"flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
										"text-flat-ink-muted hover:bg-flat-sunken-raised hover:text-flat-ink",
										"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									)}
								>
									<Icon name="redo" size={14} aria-hidden="true" />
									<span className="min-w-0 flex-1 truncate">
										{describeHistoryAction(entry.summary)}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
