import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ktab/ui/components/dialog";
import { Input } from "@ktab/ui/components/input";
import { Icon } from "@ktab/ui/icons/icon";
import { useEffect, useState } from "react";
import { SETTINGS_SCOPE_CLASS } from "../../lib/context-scope";
import { glassShape } from "../../lib/glass";
import { cn } from "../../lib/utils";
import {
	SETTINGS_ACTION,
	SETTINGS_ACTION_PRIMARY,
	SETTINGS_FOCUS_RING,
	SETTINGS_INPUT,
} from "../newtab/settings/shared/settings-tokens";

export type SelectionCreateMode = "folder" | "subfolder";

interface CreateFolderFromSelectionDialogProps {
	open: boolean;
	mode: SelectionCreateMode;
	selectionSummary: string;
	parentName?: string;
	isLiquid: boolean;
	onOpenChange: (open: boolean) => void;
	/** Return false when the live selection can no longer be grouped. */
	onCreate: (name: string) => boolean;
}

export function CreateFolderFromSelectionDialog({
	open,
	mode,
	selectionSummary,
	parentName,
	isLiquid,
	onOpenChange,
	onCreate,
}: CreateFolderFromSelectionDialogProps) {
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setName("");
			setError(null);
		}
	}, [open]);

	const folderLabel = mode === "folder" ? "folder" : "subfolder";
	const title = `Create new ${folderLabel} from selection`;
	const destination =
		mode === "folder"
			? "Top-level folder"
			: parentName
				? `Inside ${parentName}`
				: "Inside the current folder";

	function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) {
			setError("Enter a name to continue.");
			return;
		}
		if (!onCreate(trimmed)) {
			setError("These items can’t be grouped in this location.");
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				closeGlass={isLiquid}
				className={cn(
					glassShape("panel"),
					SETTINGS_SCOPE_CLASS,
					"sm:max-w-[380px]",
				)}
			>
				<form className="flex flex-col gap-5" onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							Move {selectionSummary || "the selected items"} into it.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-2">
						<label
							className="font-medium text-flat-ink text-[12px]"
							htmlFor="create-folder-from-selection-name"
						>
							Name
						</label>
						<Input
							id="create-folder-from-selection-name"
							autoFocus
							value={name}
							placeholder={mode === "folder" ? "Folder name" : "Subfolder name"}
							onChange={(event) => {
								setName(event.target.value);
								if (error) setError(null);
							}}
							aria-invalid={error ? true : undefined}
							aria-describedby={
								error ? "create-folder-from-selection-error" : undefined
							}
							glassVariant="classic"
							className={cn("h-10 text-[13px]", SETTINGS_INPUT)}
						/>
						{error && (
							<p
								id="create-folder-from-selection-error"
								className="text-destructive text-xs"
								role="alert"
							>
								{error}
							</p>
						)}
					</div>

					<div
						className={cn(
							glassShape("control"),
							"flex items-center gap-2 bg-flat-sunken-raised px-3 py-2.5 text-flat-ink-muted text-[12px]",
						)}
					>
						<Icon name="folder" size={14} className="shrink-0 opacity-70" />
						<span className="min-w-0 truncate">{destination}</span>
					</div>

					<DialogFooter className="pt-1">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className={cn(
								"inline-flex h-9 items-center justify-center px-3 font-medium text-xs",
								glassShape("control"),
								SETTINGS_ACTION,
								SETTINGS_FOCUS_RING,
							)}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!name.trim()}
							className={cn(
								"inline-flex h-9 items-center justify-center gap-1.5 px-3 font-medium text-xs",
								glassShape("control"),
								SETTINGS_ACTION_PRIMARY,
								SETTINGS_FOCUS_RING,
								"bg-[var(--ktab-accent)] text-[var(--ktab-accent-foreground)] hover:brightness-95 disabled:pointer-events-none disabled:opacity-40",
							)}
						>
							<Icon name="folder-plus" size={14} aria-hidden="true" />
							Create {folderLabel}
						</button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
