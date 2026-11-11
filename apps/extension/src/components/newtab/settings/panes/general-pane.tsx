import { Input } from "@klice-start/ui/components/input";
import { Switch } from "@klice-start/ui/components/switch";
import type { IconName } from "@klice-start/ui/icons/icon";
import { cn } from "../../../../lib/utils";
import { useSetupStore } from "../../../../stores/setup-store";
import type { CardAspect, TitleSource } from "../../../../types";
import { QuickLinksSettings } from "../../quick-links-settings";
import { SectionCard } from "../shared/section-card";
import { SegmentedControl } from "../shared/segmented-control";
import { SelectRow } from "../shared/select-row";
import { SettingRow } from "../shared/setting-row";
import { SettingsExpandable } from "../shared/settings-expandable";
import {
	SETTINGS_CONTROL_WIDTH,
	SETTINGS_INPUT,
	SETTINGS_PAGE,
	SETTINGS_RADIUS,
	SETTINGS_SWITCH,
} from "../shared/settings-tokens";
import { SliderRow } from "../shared/slider-row";
import { TabSwitcherShortcut } from "../tab-switcher-shortcut";

const TILE_SIZE_OPTIONS = [
	{ value: "small", label: "Small" },
	{ value: "medium", label: "Medium" },
	{ value: "large", label: "Large" },
] as const;

const COLUMN_OPTIONS = [4, 5, 6, 7, 8, 9, 10].map((n) => ({
	value: String(n),
	label: `${n} columns`,
}));

const LAYOUT_OPTIONS = [
	{ value: "card", label: "Cards" },
	{ value: "icon", label: "Icons" },
] as const;

const TITLE_SOURCE_OPTIONS = [
	{ value: "saved", label: "Saved title" },
	{ value: "site", label: "Site name from URL" },
] as const;

const CARD_SHAPES: readonly {
	value: CardAspect;
	icon: IconName;
	label: string;
}[] = [
	{ value: "vertical", icon: "rectangle-vertical", label: "Portrait" },
	{ value: "horizontal", icon: "rectangle-horizontal", label: "Landscape" },
	{ value: "square", icon: "square", label: "Square" },
];

const COMMON_TIMEZONES = [
	{ value: "auto", label: "Automatic" },
	{ value: "UTC", label: "UTC" },
	{ value: "America/New_York", label: "New York" },
	{ value: "America/Chicago", label: "Chicago" },
	{ value: "America/Denver", label: "Denver" },
	{ value: "America/Los_Angeles", label: "Los Angeles" },
	{ value: "America/Sao_Paulo", label: "São Paulo" },
	{ value: "Europe/London", label: "London" },
	{ value: "Europe/Paris", label: "Paris / Berlin" },
	{ value: "Asia/Tokyo", label: "Tokyo" },
	{ value: "Asia/Shanghai", label: "Shanghai" },
	{ value: "Australia/Sydney", label: "Sydney" },
];

/**
 * General owns how the page is laid out and what it shows — the tiles, the
 * grid, link behaviour, and the two widgets that live on the dashboard (clock
 * and greeting). Keeping the widgets here means Appearance stays purely about
 * colour and background, and no setting is split across two pages.
 */
export function GeneralPane() {
	const tileSize = useSetupStore((s) => s.settings.tileSize);
	const maxColumns = useSetupStore((s) => s.settings.maxColumns);
	const dialLayout = useSetupStore((s) => s.settings.dialLayout);
	const cardAspect = useSetupStore((s) => s.settings.cardAspect);
	const iconShowLabel = useSetupStore((s) => s.settings.iconShowLabel);
	const iconTileSurface = useSetupStore((s) => s.settings.iconTileSurface);
	const defaultTitleSource = useSetupStore(
		(s) => s.settings.defaultTitleSource,
	);
	const showTitle = useSetupStore((s) => s.settings.showTitle);
	const openInNewTab = useSetupStore((s) => s.settings.openInNewTab);
	const clock = useSetupStore((s) => s.settings.clock);
	const greeting = useSetupStore((s) => s.settings.greeting);
	const updateSettings = useSetupStore((s) => s.updateSettings);
	const updateClock = useSetupStore((s) => s.updateClock);
	const updateGreeting = useSetupStore((s) => s.updateGreeting);

	return (
		<div className={SETTINGS_PAGE}>
			{/* Appearance, density and click behavior run as one uninterrupted
			    stack: no headings and no dividers. Every row names its own setting,
			    so a heading above three rows only repeated what the rows already
			    said, and a rule between them only restated the 48px row beat. The
			    fieldsets keep their aria-labels, so the grouping still reaches
			    assistive tech (aria-label already overrode the legends these
			    replaced, so the announced names are unchanged). */}
			<SectionCard>
				<fieldset className="m-0 border-0 p-0" aria-label="Bookmark appearance">
					<SelectRow
						label="Display style"
						icon="layout"
						value={dialLayout}
						options={LAYOUT_OPTIONS}
						onChange={(v) =>
							updateSettings({ dialLayout: v as "card" | "icon" })
						}
					/>

					<SelectRow
						label="Tile size"
						icon="grid"
						value={tileSize}
						options={TILE_SIZE_OPTIONS}
						onChange={(v) =>
							updateSettings({ tileSize: v as "small" | "medium" | "large" })
						}
					/>

					{dialLayout === "card" ? (
						<SettingRow label="Card shape" icon="rectangle-horizontal">
							<SegmentedControl
								label="Card shape"
								iconOnly
								value={cardAspect}
								options={CARD_SHAPES}
								onChange={(value) => updateSettings({ cardAspect: value })}
								className="w-[7.5rem]"
							/>
						</SettingRow>
					) : (
						<>
							<SettingRow label="Show labels" icon="text">
								<Switch
									className={SETTINGS_SWITCH}
									aria-label="Show labels"
									checked={iconShowLabel}
									onCheckedChange={(checked: boolean) =>
										updateSettings({ iconShowLabel: checked })
									}
								/>
							</SettingRow>
							<SettingRow
								label="Icon surfaces"
								icon="stack"
								tooltip="Place each icon and label on a shared surface. Its material follows the glass appearance setting."
							>
								<Switch
									className={SETTINGS_SWITCH}
									aria-label="Icon surfaces"
									checked={iconTileSurface}
									onCheckedChange={(checked: boolean) =>
										updateSettings({ iconTileSurface: checked })
									}
								/>
							</SettingRow>
						</>
					)}

					{dialLayout === "card" ? (
						<SettingRow label="Show site titles" icon="text">
							<Switch
								className={SETTINGS_SWITCH}
								aria-label="Show site titles"
								checked={showTitle}
								onCheckedChange={(checked: boolean) =>
									updateSettings({ showTitle: checked })
								}
							/>
						</SettingRow>
					) : null}
					<SelectRow
						label="Default title source"
						icon="text"
						tooltip="Applies to bookmarks without their own title source."
						value={defaultTitleSource}
						options={TITLE_SOURCE_OPTIONS}
						onChange={(value) =>
							updateSettings({ defaultTitleSource: value as TitleSource })
						}
					/>
				</fieldset>

				<fieldset
					className="m-0 border-0 p-0"
					aria-label="Bookmark grid density"
				>
					<SelectRow
						label="Columns"
						icon="columns"
						value={String(maxColumns)}
						options={COLUMN_OPTIONS}
						onChange={(v) =>
							updateSettings({ maxColumns: Number.parseInt(v, 10) })
						}
					/>
				</fieldset>

				<fieldset
					className="m-0 border-0 p-0"
					aria-label="Bookmark click behavior"
				>
					<SettingRow
						label="Open in new tab"
						icon="external-link"
						tooltip="Keep this page open when you click a tile."
					>
						<Switch
							className={SETTINGS_SWITCH}
							aria-label="Open in new tab"
							checked={openInNewTab}
							onCheckedChange={(checked: boolean) =>
								updateSettings({ openInNewTab: checked })
							}
						/>
					</SettingRow>
				</fieldset>
			</SectionCard>

			<QuickLinksSettings />

			{/* Clock — one widget, one block: only its own settings live here.
			    The date was split out below so each widget's block matches its
			    scope (clock: enabled, format, seconds, size, timezone). */}
			<SectionCard>
				<SettingRow label="Clock" icon="clock">
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Show clock"
						checked={clock.enabled}
						onCheckedChange={(checked: boolean) =>
							updateClock({ enabled: checked })
						}
					/>
				</SettingRow>

				<SettingsExpandable expanded={clock.enabled} label="Clock options">
					<SelectRow
						label="Time zone"
						icon="globe"
						tooltip="Automatic follows your system time zone."
						value={clock.timezone || "auto"}
						options={COMMON_TIMEZONES}
						onChange={(v) => updateClock({ timezone: v })}
					/>

					{clock.enabled ? (
						<SettingRow label="24-hour time" icon="timer">
							<Switch
								className={SETTINGS_SWITCH}
								aria-label="Use 24-hour time"
								checked={clock.format24}
								onCheckedChange={(checked: boolean) =>
									updateClock({ format24: checked })
								}
							/>
						</SettingRow>
					) : null}

					{clock.enabled ? (
						<SettingRow label="Show seconds" icon="hourglass">
							<Switch
								className={SETTINGS_SWITCH}
								aria-label="Show seconds"
								checked={clock.showSeconds}
								onCheckedChange={(checked: boolean) =>
									updateClock({ showSeconds: checked })
								}
							/>
						</SettingRow>
					) : null}

					{clock.enabled ? (
						<SliderRow
							label="Clock size"
							icon="text"
							value={clock.size}
							suffix="%"
							min={60}
							max={200}
							step={10}
							onChange={(v) => updateClock({ size: v })}
						/>
					) : null}
				</SettingsExpandable>
			</SectionCard>

			{/* Date — its own block, split from the clock: the date is toggled
			    and sized independently of the clock, so its settings (enabled,
			    size) live in a block that owns exactly that scope. */}
			<SectionCard>
				<SettingRow
					label="Date"
					icon="clock"
					tooltip="Show the date independently from the clock."
				>
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Show date"
						checked={clock.dateEnabled}
						onCheckedChange={(checked: boolean) =>
							updateClock({ dateEnabled: checked })
						}
					/>
				</SettingRow>

				<SettingsExpandable expanded={clock.dateEnabled} label="Date options">
					<SliderRow
						label="Date size"
						icon="clock"
						value={clock.dateSize}
						suffix="%"
						min={60}
						max={200}
						step={10}
						onChange={(v) => updateClock({ dateSize: v })}
					/>
				</SettingsExpandable>
			</SectionCard>

			{/* Greeting — the other hero widget. */}
			<SectionCard>
				<SettingRow
					label="Greeting"
					icon="user"
					tooltip="A short hello above your tiles. Independent from the clock."
				>
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Show greeting"
						checked={greeting.enabled}
						onCheckedChange={(checked: boolean) =>
							updateGreeting({ enabled: checked })
						}
					/>
				</SettingRow>

				<SettingsExpandable
					expanded={greeting.enabled}
					label="Greeting options"
				>
					<SettingRow label="Your name" icon="pencil">
						<Input
							id="greeting-name-input"
							aria-label="Your name"
							placeholder="e.g. Alex"
							value={greeting.name}
							onChange={(e) => updateGreeting({ name: e.target.value })}
							className={cn(
								SETTINGS_CONTROL_WIDTH,
								SETTINGS_RADIUS.control,
								"h-9 px-3 text-sm",
								SETTINGS_INPUT,
							)}
						/>
					</SettingRow>

					<SliderRow
						label="Greeting size"
						icon="text"
						value={greeting.size}
						suffix="%"
						min={60}
						max={200}
						step={10}
						onChange={(v) => updateGreeting({ size: v })}
					/>
				</SettingsExpandable>
			</SectionCard>

			{/* The one keyboard behavior the extension owns: the tab switcher
			    hotkey, remappable here instead of chrome://extensions/shortcuts. */}
			<TabSwitcherShortcut />
		</div>
	);
}
