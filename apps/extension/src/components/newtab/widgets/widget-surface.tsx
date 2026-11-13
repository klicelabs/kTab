import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";
import type {
	MusicAppearance,
	WeatherAppearance,
	WidgetAppearance,
} from "../../../types";
import { GlassSurface } from "../toolbar/glass-surface";

export type WidgetName = "weather" | "market" | "github" | "music";
export type WidgetSize = "compact" | "expanded";
export type WidgetSurfaceAppearance =
	| WidgetAppearance
	| WeatherAppearance
	| MusicAppearance;

export function WidgetSurface({
	appearance,
	name,
	size,
	className,
	children,
	...props
}: {
	appearance: WidgetSurfaceAppearance;
	name: WidgetName;
	size: WidgetSize;
	className?: string;
	children: ReactNode;
	"data-time"?: string;
	"data-condition"?: string;
}) {
	return (
		<GlassSurface
			{...props}
			appearanceOverride={appearance === "glass" ? "glass" : "flat"}
			variant="surface"
			shape="section"
			data-widget={name}
			data-widget-size={size}
			data-widget-appearance={appearance}
			className={cn(
				"dashboard-widget-card isolate flex shrink-0 flex-col items-stretch",
				appearance === "flat"
					? "text-flat-ink"
					: appearance === "glass"
						? "text-[var(--ktab-glass-foreground-primary)]"
						: "text-white",
				className,
			)}
		>
			{children}
		</GlassSurface>
	);
}
