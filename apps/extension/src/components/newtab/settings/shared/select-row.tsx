import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ktab/ui/components/select";
import type { IconName } from "@ktab/ui/icons/icon";
import type { ReactNode } from "react";
import { SETTINGS_SCOPE_CLASS } from "../../../../lib/context-scope";
import { glassShape } from "../../../../lib/glass";
import { cn } from "../../../../lib/utils";
import { SettingRow } from "./setting-row";
import {
	SETTINGS_CONTROL_WIDTH,
	SETTINGS_SELECT_TRIGGER,
} from "./settings-tokens";

interface SelectOption<T extends string> {
	value: T;
	label: string;
	/** Optional leading glyph (an icon or a brand mark) for both list and trigger. */
	icon?: ReactNode;
}

interface SelectRowProps<T extends string> {
	label: string;
	icon?: IconName;
	description?: ReactNode;
	tooltip?: ReactNode;
	value: T;
	options: readonly SelectOption<T>[];
	onChange: (value: T) => void;
	triggerClassName?: string;
}

/**
 * A labelled select. The trigger mirrors the selected option's glyph and text
 * — not just its label — so a choice like the search engine is legible at a
 * glance without opening the list.
 */
export function SelectRow<T extends string>({
	label,
	icon,
	description,
	tooltip,
	value,
	options,
	onChange,
	triggerClassName,
}: SelectRowProps<T>) {
	return (
		<SettingRow
			label={label}
			icon={icon}
			description={description}
			tooltip={tooltip}
		>
			<Select
				value={value}
				onValueChange={(v) => v && onChange(v as T)}
				items={options}
			>
				<SelectTrigger
					size="sm"
					className={cn(
						SETTINGS_CONTROL_WIDTH,
						SETTINGS_SELECT_TRIGGER,
						triggerClassName,
					)}
					aria-label={label}
				>
					<SelectValue>
						{(selected: T) => {
							const option = options.find((o) => o.value === selected);
							if (!option) return null;
							return (
								<span className="flex min-w-0 items-center gap-2">
									{option.icon}
									<span className="truncate">{option.label}</span>
								</span>
							);
						}}
					</SelectValue>
				</SelectTrigger>
				<SelectContent
					className={cn(SETTINGS_SCOPE_CLASS, glassShape("section"))}
				>
					<SelectGroup>
						{options.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								<span className="flex items-center gap-2">
									{opt.icon}
									{opt.label}
								</span>
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</SettingRow>
	);
}
