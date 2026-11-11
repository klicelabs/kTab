import { Icon, type IconName } from "@ktab/ui/icons/icon";
import type { ReactNode } from "react";
import { useId } from "react";
import { cn } from "../../../../lib/utils";
import { SettingsLabel } from "./settings-label";
import { SETTINGS_ROW } from "./settings-tokens";

interface SettingRowProps {
	children: ReactNode;
	className?: string;
	icon?: IconName;
	label?: ReactNode;
	/**
	 * Legacy supporting copy. It is kept as a tooltip for callers that still
	 * provide it; Settings rows never render permanent secondary text.
	 */
	description?: ReactNode;
	/**
	 * Supporting context kept one hover away instead of on screen. Use only
	 * where the label is self-explanatory but the context is still worth
	 * keeping — never alongside `description`.
	 */
	tooltip?: ReactNode;
	/** Align the label column with the top of a tall control. */
	align?: "center" | "start";
}

/**
 * The single row primitive for every preference.
 *
 * A row is a 48px beat: a label column that takes all remaining width, and a
 * control column that hugs the trailing edge. Labels sit at 13px/medium;
 * supporting context stays behind the shared help tooltip so the panel stays
 * compact.
 *
 * Layout lives on a plain `div`, never on a `fieldset`: Chromium does not
 * distribute free space (`align-items`) reliably inside a fieldset grid
 * container, which left row content sitting ~4px high with a heavier bottom
 * pad. The grouping contract is preserved with `role="group"` named by the
 * visible label, so assistive tech keeps the control paired with its row.
 */
export function SettingRow({
	children,
	className,
	icon,
	label,
	description,
	tooltip,
	align = "center",
}: SettingRowProps) {
	const labelId = useId();

	if (label) {
		return (
			// biome-ignore lint/a11y/useSemanticElements: settings rows use a generic group so controls can share the panel row grid without fieldset layout rules.
			<div
				role="group"
				className={cn(
					"m-0 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] border-0",
					SETTINGS_ROW,
					align === "center" ? "items-center" : "items-start",
					className,
				)}
				aria-labelledby={labelId}
			>
				<div className="flex min-w-0 items-center gap-2.5">
					{icon && (
						<Icon
							name={icon}
							size={16}
							strokeWidth={1.75}
							className="shrink-0 text-neutral-400 dark:text-neutral-400"
							aria-hidden="true"
						/>
					)}
					<span className="min-w-0">
						<SettingsLabel id={labelId} tooltip={tooltip ?? description}>
							{label}
						</SettingsLabel>
					</span>
				</div>
				<div className="flex min-w-0 shrink-0 items-center gap-2 justify-self-end">
					{children}
				</div>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center",
				SETTINGS_ROW,
				className,
			)}
		>
			{children}
		</div>
	);
}
