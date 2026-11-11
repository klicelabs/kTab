import { Input } from "@ktab/ui/components/input";
import { Switch } from "@ktab/ui/components/switch";
import { useMemo } from "react";
import { useSvgIcon } from "../../../../hooks/use-svg-icon";
import { SEARCH_ENGINES } from "../../../../lib/constants";
import { SEARCH_ENGINE_TO_SVGL } from "../../../../lib/svgl-mapping";
import { cn } from "../../../../lib/utils";
import { useSetupStore } from "../../../../stores/setup-store";
import { SvgIcon } from "../../../shared/svg-icon";
import { searchAccess } from "../../search/search-access";
import { SectionCard } from "../shared/section-card";
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

/** The engine's real brand mark, with its initial as a graceful fallback. */
function EngineIcon({ engineId }: { engineId: string }) {
	const svglTitle = SEARCH_ENGINE_TO_SVGL[engineId];
	const { svgXml, isLoading } = useSvgIcon(svglTitle ?? null);

	if (isLoading || !svgXml) {
		const label = SEARCH_ENGINES.find((e) => e.id === engineId)?.label ?? "?";
		return (
			<span
				aria-hidden="true"
				className="inline-flex size-4 shrink-0 items-center justify-center font-semibold text-[10px] text-neutral-400 leading-none"
			>
				{label.charAt(0)}
			</span>
		);
	}

	return (
		<span
			aria-hidden="true"
			className="inline-flex size-4 shrink-0 items-center"
		>
			<SvgIcon svgXml={svgXml} className="size-4 shrink-0" />
		</span>
	);
}

const ICON_MODE_OPTIONS = [
	{ value: "search", label: "Magnifier" },
	{ value: "engine", label: "Engine logo" },
] as const;

/** Home visibility and toolbar/keyboard access are independent choices. */
export function SearchPane() {
	const search = useSetupStore((s) => s.settings.search);
	const updateSearch = useSetupStore((s) => s.updateSearch);
	const { available } = searchAccess(search);

	const engineOptions = useMemo(
		() =>
			SEARCH_ENGINES.map((engine) => ({
				value: engine.id as string,
				label: engine.label,
				icon: <EngineIcon engineId={engine.id} />,
			})),
		[],
	);

	return (
		<div className={SETTINGS_PAGE}>
			<SectionCard>
				<SettingRow
					label="Search bar"
					icon="search"
					tooltip="Show the search field on Home."
				>
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Show search bar"
						checked={search.enabled}
						onCheckedChange={(checked: boolean) =>
							updateSearch({ enabled: checked })
						}
					/>
				</SettingRow>
				<SettingRow
					label="Toolbar & shortcut"
					icon="search"
					tooltip="Keep Search beside Settings when the bar is hidden or scrolled away. Open it with Ctrl+K or ⌘K. Turn off both options to disable Search completely."
				>
					<Switch
						className={SETTINGS_SWITCH}
						aria-label="Enable search toolbar and keyboard shortcut"
						checked={search.quickAccessEnabled}
						onCheckedChange={(checked: boolean) =>
							updateSearch({ quickAccessEnabled: checked })
						}
					/>
				</SettingRow>
			</SectionCard>

			<SettingsExpandable expanded={available} label="Search options">
				<SectionCard>
					<SelectRow
						label="Search engine"
						icon="compass"
						value={search.engine}
						options={engineOptions}
						onChange={(v) => updateSearch({ engine: v })}
					/>

					<SelectRow
						label="Icon"
						icon="sparkles"
						value={search.iconMode}
						options={ICON_MODE_OPTIONS}
						onChange={(v) => updateSearch({ iconMode: v })}
					/>

					<SettingRow
						label="Placeholder"
						icon="text"
						tooltip="Leave empty to use the default text."
					>
						<Input
							id="search-placeholder-input"
							aria-label="Search placeholder text"
							placeholder="Search the web"
							value={search.placeholder}
							onChange={(e) => updateSearch({ placeholder: e.target.value })}
							className={cn(
								cn(
									SETTINGS_CONTROL_WIDTH,
									SETTINGS_RADIUS.control,
									"h-9 px-3 text-sm",
								),
								SETTINGS_INPUT,
							)}
						/>
					</SettingRow>

					<SliderRow
						label="Search width"
						icon="columns"
						value={search.width}
						suffix="px"
						min={420}
						max={800}
						step={10}
						onChange={(v) => updateSearch({ width: v })}
						tooltip="The bar shrinks to fit smaller windows."
					/>
				</SectionCard>
			</SettingsExpandable>
		</div>
	);
}
