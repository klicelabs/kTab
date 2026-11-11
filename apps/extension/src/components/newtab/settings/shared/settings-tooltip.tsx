import { Tooltip } from "@ktab/ui/components/motion/tooltip";
import { Icon } from "@ktab/ui/icons/icon";
import type { ReactNode } from "react";
import { glassShape } from "../../../../lib/glass";
import { cn } from "../../../../lib/utils";
import { SETTINGS_FOCUS_RING, SETTINGS_TOOLTIP_DELAY } from "./settings-tokens";

interface SettingsTooltipProps {
	/** Concise supporting copy — one short sentence, sentence case. */
	content: ReactNode;
	/** Accessible name for the info affordance. Defaults to "More info". */
	label?: string;
	className?: string;
}

/**
 * The one tooltip for the whole Settings panel, built on beUI's motion
 * tooltip (`@beui/tooltip` behaviour: intent-delayed, keyboard/focus
 * reachable, motion-safe, portal-positioned).
 *
 * Used only where a label is NOT self-explanatory but the context is still
 * worth keeping one hover away. Obvious labels get no tooltip at all.
 * Delay comes from the single shared `SETTINGS_TOOLTIP_DELAY` token.
 */
export function SettingsTooltip({
	content,
	label = "More info",
	className,
}: SettingsTooltipProps) {
	return (
		<Tooltip
			content={content}
			delay={SETTINGS_TOOLTIP_DELAY}
			className={cn(
				"max-w-[240px] whitespace-normal border-neutral-900/10 bg-white text-neutral-700 text-xs shadow-xl dark:border-white/10 dark:bg-[#333333] dark:text-neutral-200",
				glassShape("control"),
				className,
			)}
		>
			<button
				type="button"
				aria-label={label}
				tabIndex={0}
				className={cn(
					"inline-flex size-4 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300",
					SETTINGS_FOCUS_RING,
				)}
			>
				<Icon name="info" size={12} strokeWidth={2} aria-hidden="true" />
			</button>
		</Tooltip>
	);
}
