import { Icon, type IconName } from "@ktab/ui/icons/icon";
import type { ComponentProps } from "react";
import { glassShape } from "../../../../lib/glass";
import { cn } from "../../../../lib/utils";
import {
	SETTINGS_ACTION,
	SETTINGS_ACTION_DANGER,
	SETTINGS_ACTION_ICON,
	SETTINGS_ACTION_PRIMARY,
	SETTINGS_FOCUS_RING,
	SETTINGS_ICON_BUTTON,
} from "./settings-tokens";

const ACTION_TONE = {
	quiet: SETTINGS_ACTION,
	primary: SETTINGS_ACTION_PRIMARY,
	danger: SETTINGS_ACTION_DANGER,
} as const;

interface SettingsActionProps extends ComponentProps<"button"> {
	/** Quiet by default so a group never has two competing primary actions. */
	tone?: keyof typeof ACTION_TONE;
	icon?: IconName;
}

/**
 * The one in-row action. Every settings button renders through this, so
 * heights, radii, padding and press feedback stay identical no matter which
 * pane (or which edge case) produced it.
 */
export function SettingsAction({
	tone = "quiet",
	icon,
	children,
	className,
	type = "button",
	...props
}: SettingsActionProps) {
	return (
		<button
			type={type}
			className={cn(
				"inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium disabled:pointer-events-none disabled:opacity-40",
				glassShape("control"),
				ACTION_TONE[tone],
				SETTINGS_FOCUS_RING,
				className,
			)}
			{...props}
		>
			{icon ? (
				<Icon
					name={icon}
					size={14}
					strokeWidth={1.75}
					className={SETTINGS_ACTION_ICON}
					data-icon="inline-start"
					aria-hidden="true"
				/>
			) : null}
			{children}
		</button>
	);
}

interface SettingsIconButtonProps extends ComponentProps<"button"> {
	icon: IconName;
	/** Required: an icon-only control must announce itself. */
	label: string;
	tone?: "default" | "danger";
}

/** A 32px icon-only row action, revealed on hover/focus by its row. */
export function SettingsIconButton({
	icon,
	label,
	tone = "default",
	className,
	...props
}: SettingsIconButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			className={cn(
				"inline-flex size-8 shrink-0 items-center justify-center",
				glassShape("control"),
				SETTINGS_ICON_BUTTON,
				tone === "danger" && "hover:bg-red-500/10 hover:text-red-400",
				SETTINGS_FOCUS_RING,
				className,
			)}
			{...props}
		>
			<Icon name={icon} size={15} strokeWidth={1.75} aria-hidden="true" />
		</button>
	);
}
