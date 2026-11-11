import { Icon, type IconName } from "@ktab/ui/icons/icon";
import type { ReactNode } from "react";
import { cn } from "../../../../lib/utils";

interface SettingsEmptyProps {
	icon?: IconName;
	title: string;
	description?: string;
	/** Optional next step — an empty state should point somewhere. */
	action?: ReactNode;
	className?: string;
}

/**
 * Shared empty state. Quiet by design: one dim icon, a plain sentence, and at
 * most one action, so an empty list still reads as a considered surface
 * rather than a hole in the layout.
 */
export function SettingsEmpty({
	icon,
	title,
	description,
	action,
	className,
}: SettingsEmptyProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center px-4 py-7 text-center",
				className,
			)}
		>
			{icon ? (
				<Icon
					name={icon}
					size={20}
					strokeWidth={1.5}
					className="mb-2.5 text-neutral-400 dark:text-neutral-500"
					aria-hidden="true"
				/>
			) : null}
			<p className="font-medium text-[13px] text-neutral-700 dark:text-neutral-300">
				{title}
			</p>
			{description ? (
				<p className="mt-1 max-w-[30ch] text-[12px] text-neutral-500 leading-[1.45] dark:text-neutral-500">
					{description}
				</p>
			) : null}
			{action ? <div className="mt-3.5">{action}</div> : null}
		</div>
	);
}

const STATUS_TONE = {
	info: "text-neutral-500 dark:text-neutral-400",
	success: "text-emerald-600 dark:text-emerald-400",
	error: "text-red-600 dark:text-red-400",
} as const;

interface SettingsStatusProps {
	tone?: keyof typeof STATUS_TONE;
	children: ReactNode;
	className?: string;
}

/** One line of async feedback, announced politely, shared by every pane. */
export function SettingsStatus({
	tone = "info",
	children,
	className,
}: SettingsStatusProps) {
	return (
		<p
			role="status"
			className={cn(
				"px-1.5 pt-1 pb-2 font-medium text-[12px] leading-snug",
				STATUS_TONE[tone],
				className,
			)}
		>
			{children}
		</p>
	);
}
