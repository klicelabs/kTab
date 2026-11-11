import { Icon } from "@ktab/ui/icons/icon";
import { useClock } from "../../hooks/use-clock";
import { wallpaperText } from "../../lib/glass";
import { cn } from "../../lib/utils";

interface RestModeProps {
	onExit: () => void;
}

/**
 * A deliberately quiet ambient state. It is a presentation mode, not a lock
 * screen: the same wallpaper remains visible and one explicit action returns
 * to the Speed Dial.
 */
export function RestMode({ onExit }: RestModeProps) {
	const { time, date, greeting } = useClock();

	return (
		<section
			aria-label="Rest Mode"
			className="rest-mode fixed inset-0 z-50 flex min-h-screen items-center justify-center px-6 text-center"
		>
			<div className="rest-mode-content flex max-w-md flex-col items-center">
				<p
					className={`${wallpaperText("muted")} rest-mode-eyebrow font-medium text-xs uppercase tracking-[0.24em]`}
				>
					kTab
				</p>
				<time
					className={cn(
						"mt-4 font-semibold leading-none tracking-[-0.06em]",
						wallpaperText("primary"),
						time ? "text-[clamp(4.5rem,13vw,8rem)]" : "text-4xl",
					)}
				>
					{time || "Resting"}
				</time>
				{date && (
					<p className={`${wallpaperText("secondary")} mt-4 text-sm`}>{date}</p>
				)}
				{greeting && (
					<p
						className={`${wallpaperText("secondary")} mt-2 font-medium text-base`}
					>
						{greeting}
					</p>
				)}
				<button
					type="button"
					onClick={onExit}
					className={`${wallpaperText("primary")} rest-mode-cta mt-10 inline-flex h-10 items-center gap-2 rounded-full px-5 font-medium text-sm`}
				>
					Enter kTab
					<Icon name="chevron-right" size={15} />
				</button>
				<p className={`${wallpaperText("muted")} mt-5 text-[11px]`}>
					Press Enter, Space, or Escape to return
				</p>
			</div>
		</section>
	);
}
