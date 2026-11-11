import { Icon, type IconName } from "@ktab/ui/icons/icon";
import { memo } from "react";
import { cn } from "../../../../lib/utils";
import type { SettingsPaneId } from "../settings-types";
import { SectionCard } from "../shared/section-card";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_HOVER_WASH,
	SETTINGS_PAGE,
	SETTINGS_RADIUS,
} from "../shared/settings-tokens";
import { AppearancePane } from "./appearance-pane";
import { GeneralPane } from "./general-pane";
import { SearchPane } from "./search-pane";

interface SettingsRootPaneProps {
	onNavigate: (pane: SettingsPaneId) => void;
}

interface SettingsNavigationRowProps {
	icon: IconName;
	label: string;
	onClick: () => void;
}

function SettingsNavigationRow({
	icon,
	label,
	onClick,
}: SettingsNavigationRowProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"group flex min-h-14 w-full items-center gap-3 bg-transparent px-2 py-2 text-left transition-colors duration-150 motion-reduce:transition-none",
				SETTINGS_HOVER_WASH,
				SETTINGS_RADIUS.surface,
				SETTINGS_FOCUS_RING,
			)}
			data-settings-ui="true"
		>
			<Icon
				name={icon}
				size={18}
				strokeWidth={1.75}
				className="shrink-0 text-neutral-500 transition-colors group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-100"
				aria-hidden="true"
			/>
			<span className="min-w-0 flex-1">
				<span className="block font-medium text-[13px] text-neutral-900 leading-[1.35] dark:text-neutral-100">
					{label}
				</span>
			</span>
			<Icon
				name="chevron-right"
				size={15}
				className="shrink-0 text-neutral-400 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none dark:text-neutral-500"
				aria-hidden="true"
			/>
		</button>
	);
}

/**
 * The default Settings view is ordered by frequency, not by implementation
 * category. Existing panes supply the same controls and grouped cards; this
 * composition only removes the extra landing-page click. Thumbnail capture
 * settings are intentionally absent here — they live only in the Manage
 * bookmarks pane, their single home.
 */
export const SettingsRootPane = memo(function SettingsRootPane({
	onNavigate,
}: SettingsRootPaneProps) {
	return (
		<div className={SETTINGS_PAGE}>
			<AppearancePane onOpenWallpaper={() => onNavigate("wallpaper")} />
			<GeneralPane />
			<SearchPane />

			<SectionCard>
				<SettingsNavigationRow
					icon="bookmark"
					label="Manage bookmarks"
					onClick={() => onNavigate("bookmarks")}
				/>
				<SettingsNavigationRow
					icon="wrench"
					label="Advanced"
					onClick={() => onNavigate("advanced")}
				/>
			</SectionCard>
		</div>
	);
});
