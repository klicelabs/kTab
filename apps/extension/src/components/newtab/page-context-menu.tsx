import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ktab/ui/components/motion/context-menu";
import { Icon } from "@ktab/ui/icons/icon";
import { type MouseEvent, type ReactNode, useCallback, useState } from "react";
import { isInsideSettingsScope } from "../../lib/context-scope";
import { glassDropdownItem, glassMenu } from "../../lib/glass";
import { REFRESH_STRINGS } from "../../lib/thumbnail-refresh";
import { cn } from "../../lib/utils";
import { refreshWallpaper } from "../../services/wallpaper";
import { useHistoryStore } from "../../stores/history-store";
import { useImageStore } from "../../stores/image-store";
import { useSetupStore } from "../../stores/setup-store";
import { useAppearance } from "./appearance-provider";

interface PageContextMenuProps {
	children: ReactNode;
	onOpenBackgroundSettings: () => void;
	onOpenShortcutSettings: () => void;
	onAddQuickLink: () => void;
	onAddFolder?: () => void;
	onSelectAll?: () => void;
	onOpenHistory?: () => void;
	onOpenGeneralSettings?: () => void;
	onEnterRestMode?: () => void;
	/** Library-wide thumbless count; the entry hides when 0. */
	missingPreviewCount?: number;
	onRefreshMissing?: () => void;
	enabled?: boolean;
}

export function PageContextMenu({
	children,
	onOpenBackgroundSettings,
	onAddQuickLink,
	onAddFolder,
	onSelectAll,
	onOpenHistory,
	onOpenGeneralSettings,
	onEnterRestMode,
	missingPreviewCount = 0,
	onRefreshMissing,
	enabled = true,
}: PageContextMenuProps) {
	const { isLiquid, resolvedDark } = useAppearance();
	const bgType = useSetupStore((s) => s.settings.background.type);
	const pexelsImageId = useSetupStore(
		(s) => s.settings.background.pexelsImageId,
	);
	const pexelsFrequency = useSetupStore(
		(s) => s.settings.background.pexelsFrequency,
	);
	const updateBackground = useSetupStore((s) => s.updateBackground);
	const getBackgroundImage = useImageStore((s) => s.getBackgroundImage);
	const [open, setOpen] = useState(false);

	const isPexels = bgType === "pexels";

	const handleDownloadBackground = useCallback(async () => {
		if (!pexelsImageId) return;
		const dataUrl = await getBackgroundImage(pexelsImageId);
		if (!dataUrl) return;
		const a = document.createElement("a");
		a.href = dataUrl;
		a.download = `ktab-wallpaper-${pexelsImageId}.jpg`;
		a.click();
	}, [pexelsImageId, getBackgroundImage]);

	const handleToggleLock = useCallback(() => {
		if (!isPexels) return;
		if (pexelsFrequency === "locked") {
			const fallback =
				useSetupStore.getState().settings.background.pexelsPreviousFrequency ||
				"daily";
			updateBackground({
				pexelsFrequency: fallback,
				pexelsPreviousFrequency: null,
			});
			void refreshWallpaper(true);
			return;
		}
		updateBackground({
			pexelsFrequency: "locked",
			pexelsPreviousFrequency: pexelsFrequency,
		});
	}, [isPexels, pexelsFrequency, updateBackground]);

	const handleNextBackground = useCallback(async () => {
		if (!isPexels) return;
		await refreshWallpaper(true);
	}, [isPexels]);

	function handleContextMenu(event: MouseEvent) {
		// If clicking an interactive card/tab with its own context menu, skip
		const target = event.target as HTMLElement | null;
		if (target?.closest("[data-local-context-menu]")) {
			event.preventDefault();
			return;
		}
		// Settings is its own surface: never open the global Home menu there.
		// This covers the panel itself plus settings-owned floating UI, which
		// portals render outside the panel DOM (see `lib/context-scope`).
		// The beUI trigger only stands down on defaultPrevented, so — exactly
		// like the local-menu rule above — prevention here is what keeps the
		// global menu closed. Everything else (clicks, keys, selection)
		// passes through untouched.
		if (isInsideSettingsScope(target)) {
			event.preventDefault();
			return;
		}
	}

	const itemClassName = glassDropdownItem(isLiquid, resolvedDark, {
		pillOwned: true,
	});
	// Single persistent history entry: Undo/Redo live in the post-action
	// toast, shortcuts and here — never as a duplicate direct item.
	const hasHistory =
		useHistoryStore((s) => s.past.length + s.future.length) > 0;

	if (!enabled) return children;

	return (
		<ContextMenu open={open} onOpenChange={setOpen}>
			<ContextMenuTrigger>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: the page surface is the context-menu trigger and the beUI trigger adds keyboard handling. */}
				<div
					className="block min-h-screen w-full"
					onContextMenu={handleContextMenu}
				>
					{children}
				</div>
			</ContextMenuTrigger>

			<ContextMenuContent
				className={cn(glassMenu(isLiquid, resolvedDark), "min-w-48")}
			>
				{onAddFolder && (
					<ContextMenuItem className={itemClassName} onSelect={onAddFolder}>
						<Icon name="folder-plus" size={14} />
						New folder
					</ContextMenuItem>
				)}
				<ContextMenuItem className={itemClassName} onSelect={onAddQuickLink}>
					<Icon name="plus" size={14} />
					Add link
				</ContextMenuItem>
				{onSelectAll && (
					<ContextMenuItem className={itemClassName} onSelect={onSelectAll}>
						<Icon name="check-square" size={14} />
						Select all
					</ContextMenuItem>
				)}
				{onRefreshMissing && missingPreviewCount > 0 && (
					<ContextMenuItem
						className={itemClassName}
						onSelect={onRefreshMissing}
					>
						<Icon name="refresh" size={14} />
						{REFRESH_STRINGS.missingAction(missingPreviewCount)}
					</ContextMenuItem>
				)}

				{/* One separator per group boundary, each gated on its own
				    group: adjacent separators can never render. */}
				{onOpenHistory && hasHistory && (
					<>
						<ContextMenuSeparator
							className={isLiquid ? "bg-foreground/10" : undefined}
						/>
						<ContextMenuItem className={itemClassName} onSelect={onOpenHistory}>
							<Icon name="history" size={14} />
							Recent actions
						</ContextMenuItem>
					</>
				)}

				<ContextMenuSeparator
					className={isLiquid ? "bg-foreground/10" : undefined}
				/>

				<ContextMenuItem
					className={itemClassName}
					onSelect={onOpenBackgroundSettings}
				>
					<Icon name="settings" size={14} />
					Edit background
				</ContextMenuItem>
				<ContextMenuItem
					className={itemClassName}
					onSelect={onOpenGeneralSettings ?? onOpenBackgroundSettings}
				>
					<Icon name="settings" size={14} />
					Settings
				</ContextMenuItem>
				{onEnterRestMode && (
					<ContextMenuItem className={itemClassName} onSelect={onEnterRestMode}>
						<Icon name="clock" size={14} />
						Enter Rest Mode
					</ContextMenuItem>
				)}

				{isPexels && (
					<>
						<ContextMenuSeparator
							className={isLiquid ? "bg-foreground/10" : undefined}
						/>
						<ContextMenuItem
							className={itemClassName}
							onSelect={handleDownloadBackground}
						>
							<svg
								aria-hidden="true"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
							</svg>
							Download wallpaper
						</ContextMenuItem>
						<ContextMenuItem
							className={itemClassName}
							onSelect={handleToggleLock}
						>
							<svg
								aria-hidden="true"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								{pexelsFrequency === "locked" ? (
									<path d="M7 11V7a5 5 0 0 1 10 0v4M12 15v2M5 11h14v10H5z" />
								) : (
									<path d="M7 11V7a5 5 0 0 1 9.9-1M12 15v2M5 11h14v10H5z" />
								)}
							</svg>
							{pexelsFrequency === "locked"
								? "Unlock wallpaper"
								: "Lock wallpaper"}
						</ContextMenuItem>
						<ContextMenuItem
							className={itemClassName}
							onSelect={handleNextBackground}
						>
							<svg
								aria-hidden="true"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
							</svg>
							Next wallpaper
						</ContextMenuItem>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}
