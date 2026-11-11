import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ktab/ui/components/dialog";
import { Icon, type IconName } from "@ktab/ui/icons/icon";
import { useState } from "react";
import { toast } from "sonner";
import { SETTINGS_SCOPE_CLASS } from "../../../../lib/context-scope";
import { clearIconBlobCache } from "../../../../lib/icon-blob-cache";
import { cn } from "../../../../lib/utils";
import { clearMacOSiconsSettings } from "../../../../services/macosicons";
import { useIconCacheStore } from "../../../../stores/icon-cache-store";
import { useSetupStore } from "../../../../stores/setup-store";
import type { Card } from "../../../../types";
import { useAppearance } from "../../appearance-provider";
import { SectionCard } from "../shared/section-card";
import { SettingRow } from "../shared/setting-row";
import { SettingsAction } from "../shared/settings-action";
import { SETTINGS_PAGE, SETTINGS_RADIUS } from "../shared/settings-tokens";
import { IconProviderSettings } from "./icon-provider-settings";

interface AdvancedPaneProps {
	onCloseParent?: () => void;
}

interface Stat {
	icon: IconName;
	label: string;
	value: number;
}

/**
 * Advanced is the end of the panel: what the dashboard currently holds, and
 * the one irreversible action. The stats are read-only context for the reset,
 * which is why they sit directly above it.
 */
export function AdvancedPane({ onCloseParent }: AdvancedPaneProps) {
	const folders = useSetupStore((s) => s.folders);
	const cards = useSetupStore((s) => s.cards as Card[]);
	const hasCustomWallpaper = useSetupStore(
		(s) => s.settings.background.customWallpaper !== null,
	);
	const resetAll = useSetupStore((s) => s.resetAll);
	const { isLiquid } = useAppearance();

	const [confirmResetOpen, setConfirmResetOpen] = useState(false);
	const [isResetting, setIsResetting] = useState(false);

	const stats: Stat[] = [
		{ icon: "folder", label: "Folders", value: folders.length },
		{ icon: "bookmark", label: "Bookmarks", value: cards.length },
		{
			icon: "image",
			label: "Custom wallpaper",
			value: hasCustomWallpaper ? 1 : 0,
		},
	];

	async function handlePerformReset() {
		setIsResetting(true);
		try {
			await resetAll();
			useIconCacheStore.setState({ records: {} });
			await clearIconBlobCache();
			await clearMacOSiconsSettings();
			setConfirmResetOpen(false);
			onCloseParent?.();
		} finally {
			setIsResetting(false);
		}
	}

	return (
		<div className={SETTINGS_PAGE}>
			<SectionCard>
				<div className="grid grid-cols-3 divide-x divide-white/[0.06] p-1.5">
					{stats.map((stat) => (
						<div key={stat.label} className="flex flex-col gap-1.5 px-2 py-1">
							<span className="flex items-center gap-2 text-[12px] text-neutral-500 leading-[1.35] dark:text-neutral-400">
								<Icon
									name={stat.icon}
									size={15}
									strokeWidth={1.75}
									className="shrink-0 text-neutral-400 dark:text-neutral-500"
									aria-hidden="true"
								/>
								<span className="truncate">{stat.label}</span>
							</span>
							<span className="font-semibold text-[17px] text-neutral-900 tabular-nums leading-none dark:text-neutral-100">
								{stat.value}
							</span>
						</div>
					))}
				</div>
			</SectionCard>

			<IconProviderSettings />

			{/* Developer seed (development builds only — tree-shaken from prod) */}
			{import.meta.env.DEV ? (
				<SectionCard>
					<SettingRow
						label="Development data"
						icon="database"
						tooltip="Local fixtures."
					>
						<SettingsAction
							onClick={async () => {
								try {
									const seed = await import("../../../../dev/seed");
									await seed.seedDevData();
									toast.success("Seed data loaded.");
								} catch (err) {
									toast.error("Seed failed", {
										description:
											err instanceof Error
												? err.message
												: "Could not load seed.",
									});
								}
							}}
						>
							Load seed
						</SettingsAction>
						<SettingsAction
							onClick={async () => {
								try {
									const seed = await import("../../../../dev/seed");
									await seed.resetDevData();
									toast.success("Seed data cleared.");
								} catch (err) {
									toast.error("Clear failed", {
										description:
											err instanceof Error
												? err.message
												: "Could not clear seed.",
									});
								}
							}}
						>
							Clear
						</SettingsAction>
					</SettingRow>
				</SectionCard>
			) : null}

			<SectionCard tone="danger">
				<SettingRow
					label={
						<span className="text-red-600 dark:text-red-400">
							Reset everything
						</span>
					}
					icon="alert"
					tooltip="Deletes everything. Can't be undone."
				>
					<SettingsAction
						tone="danger"
						onClick={() => setConfirmResetOpen(true)}
					>
						Reset…
					</SettingsAction>
				</SettingRow>
			</SectionCard>

			<Dialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
				<DialogContent
					closeGlass={isLiquid}
					className={cn(
						"squircle",
						SETTINGS_SCOPE_CLASS,
						SETTINGS_RADIUS.panel,
						"sm:max-w-[420px]",
					)}
				>
					<DialogHeader>
						<DialogTitle>Reset all data?</DialogTitle>
						<DialogDescription>
							This deletes {cards.length} bookmark
							{cards.length === 1 ? "" : "s"} across {folders.length} folder
							{folders.length === 1 ? "" : "s"}, your custom wallpaper, and
							every cached preview and site icon, plus your saved macOSicons key.
							This can&rsquo;t be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="pt-2">
						<SettingsAction
							onClick={() => setConfirmResetOpen(false)}
							disabled={isResetting}
						>
							Cancel
						</SettingsAction>
						<SettingsAction
							tone="danger"
							onClick={handlePerformReset}
							disabled={isResetting}
						>
							{isResetting ? "Resetting…" : "Reset everything"}
						</SettingsAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
