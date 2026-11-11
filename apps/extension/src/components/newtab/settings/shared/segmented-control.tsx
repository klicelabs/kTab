import { Icon, type IconName } from "@ktab/ui/icons/icon";
import { SPRING_SEGMENT } from "@ktab/ui/lib/ease";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { cn } from "../../../../lib/utils";
import { SETTINGS_FOCUS_RING, SETTINGS_RADIUS } from "./settings-tokens";

export interface SegmentedOption<T extends string> {
	value: T;
	/** Accessible name; also the visible label unless `iconOnly`. */
	label: string;
	icon?: IconName;
}

interface SegmentedControlProps<T extends string> {
	value: T;
	options: readonly SegmentedOption<T>[];
	onChange: (value: T) => void;
	/** Accessible name for the group as a whole. */
	label: string;
	/** Icon-only segments keep their meaning in `aria-label` + tooltip. */
	iconOnly?: boolean;
	className?: string;
}

/**
 * A single-select segmented control. The selected segment owns one shared
 * `layoutId`, so changing value slides a single pill between positions instead
 * of cross-fading two backgrounds — the selection reads as one object moving,
 * which is the whole point of a segmented control.
 *
 * Options are equal-width (`flex-1`), so the control keeps a stable footprint
 * whatever the selected label is.
 */
export function SegmentedControl<T extends string>({
	value,
	options,
	onChange,
	label,
	iconOnly = false,
	className,
}: SegmentedControlProps<T>) {
	const reduce = useReducedMotion();
	const uid = useId();

	return (
		<fieldset
			aria-label={label}
			className={cn(
				"m-0 inline-flex shrink-0 items-center gap-0.5 border-0 bg-neutral-900/[0.05] p-0.5 dark:bg-white/[0.06]",
				SETTINGS_RADIUS.pill,
				className,
			)}
		>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						onClick={() => onChange(option.value)}
						aria-pressed={selected}
						aria-label={option.label}
						title={iconOnly ? option.label : undefined}
						className={cn(
							"relative inline-flex h-7 flex-1 items-center justify-center gap-1.5 px-2 font-medium text-[11px] transition-colors duration-150 motion-reduce:transition-none",
							SETTINGS_RADIUS.pill,
							SETTINGS_FOCUS_RING,
						selected
							? "text-neutral-900 dark:text-neutral-100"
							: "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200",
						)}
					>
						{selected ? (
							<motion.span
								layoutId={`settings-segment-${uid}`}
								className={cn(
									"absolute inset-0 bg-neutral-900/[0.09] dark:bg-white/[0.14]",
									SETTINGS_RADIUS.pill,
								)}
								transition={reduce ? { duration: 0 } : SPRING_SEGMENT}
							/>
						) : null}
						<span className="relative z-10 inline-flex items-center gap-1.5">
							{option.icon ? (
								<Icon name={option.icon} size={15} aria-hidden="true" />
							) : null}
							{iconOnly ? null : (
								<span className="whitespace-nowrap">{option.label}</span>
							)}
						</span>
					</button>
				);
			})}
		</fieldset>
	);
}
