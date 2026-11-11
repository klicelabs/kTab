import type { IconName } from "@ktab/ui/icons/icon";
import type { ReactNode } from "react";
import { cn } from "../../../../lib/utils";
import { SettingRow } from "./setting-row";
import { SettingsRangeSlider } from "./settings-range-slider";

interface SliderRowProps {
	label: string;
	icon?: IconName;
	value: number;
	suffix?: string;
	min: number;
	max: number;
	/**
	 * Value granularity. The track renders no tick dots in Settings — every
	 * continuous control (opacity, blur, brightness…) is a clean fill + thumb.
	 */
	step?: number;
	onChange: (value: number) => void;
	description?: string;
	tooltip?: ReactNode;
	className?: string;
	disabled?: boolean;
}

/**
 * A settings slider row built on the beUI RangeSlider.
 *
 * The title stays in the shared SettingRow label column while the value lives
 * inside the track, keeping every continuous control aligned with selects and
 * switches.
 */
export function SliderRow({
	label,
	icon,
	value,
	suffix = "",
	min,
	max,
	step,
	onChange,
	description,
	tooltip,
	className,
	disabled = false,
}: SliderRowProps) {
	return (
		<SettingRow
			label={label}
			icon={icon}
			description={description}
			tooltip={tooltip}
			className={cn("min-h-12", className)}
		>
			<SettingsRangeSlider
				label={label}
				value={value}
				suffix={suffix}
				min={min}
				max={max}
				step={step}
				onChange={onChange}
				disabled={disabled}
				className="w-44 max-w-full"
			/>
		</SettingRow>
	);
}
