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
import { prepareQuickLink } from "../../lib/quick-links";
import { cn } from "../../lib/utils";
import type { QuickLink } from "../../types";
import {
	SETTINGS_ACTION,
	SETTINGS_ACTION_PRIMARY,
	SETTINGS_FOCUS_RING,
	SETTINGS_INPUT,
} from "./settings/shared/settings-tokens";

interface QuickLinkEditorDialogProps {
	open: boolean;
	link: QuickLink | null;
	isLiquid: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (changes: Pick<QuickLink, "label" | "url">) => void;
}

export function QuickLinkEditorDialog({
	open,
	link,
	isLiquid,
	onOpenChange,
	onSave,
}: QuickLinkEditorDialogProps) {
	const [label, setLabel] = useState("");
	const [url, setUrl] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setLabel(link?.label ?? "");
		setUrl(link?.url ?? "");
		setError(null);
	}, [open, link]);

	function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const draft = prepareQuickLink(label, url);
		if (!draft) {
			setError("Enter a valid http(s) URL.");
			return;
		}
		onSave(draft);
		onOpenChange(false);
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
						<DialogTitle>
							{link ? "Edit Quick Link" : "Add Quick Link"}
						</DialogTitle>
						<DialogDescription>
							Choose a destination and an optional label. The site icon is
							automatic.
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-3">
						<label
							className="flex flex-col gap-1.5 font-medium text-[12px] text-flat-ink"
							htmlFor="quick-link-label"
						>
							Label
							<Input
								id="quick-link-label"
								value={label}
								placeholder="Site name"
								onChange={(event) => setLabel(event.target.value)}
								glassVariant="classic"
								className={cn("h-10 text-[13px]", SETTINGS_INPUT)}
							/>
						</label>
						<label
							className="flex flex-col gap-1.5 font-medium text-[12px] text-flat-ink"
							htmlFor="quick-link-url"
						>
							URL
							<Input
								id="quick-link-url"
								autoFocus
								value={url}
								placeholder="example.com"
								inputMode="url"
								autoComplete="url"
								onChange={(event) => {
									setUrl(event.target.value);
									if (error) setError(null);
								}}
								aria-invalid={error ? true : undefined}
								aria-describedby={error ? "quick-link-url-error" : undefined}
								glassVariant="classic"
								className={cn("h-10 text-[13px]", SETTINGS_INPUT)}
							/>
						</label>
						{error && (
							<p
								id="quick-link-url-error"
								className="text-destructive text-xs"
								role="alert"
							>
								{error}
							</p>
						)}
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
							disabled={!url.trim()}
							className={cn(
								"inline-flex h-9 items-center justify-center gap-1.5 px-3 font-medium text-xs",
								glassShape("control"),
								SETTINGS_ACTION_PRIMARY,
								SETTINGS_FOCUS_RING,
								"bg-[var(--ktab-accent)] text-[var(--ktab-accent-foreground)] hover:brightness-95 disabled:pointer-events-none disabled:opacity-40",
							)}
						>
							<Icon name="check" size={14} aria-hidden="true" />
							Save link
						</button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
