import type { ReactNode } from "react";
import type { WidgetAppearance } from "../../../types";
import { cn } from "../../../lib/utils";
import { GlassSurface } from "../toolbar/glass-surface";

export type WidgetName = "weather" | "market" | "github" | "music";
export type WidgetSize = "square" | "wide";

export function WidgetSurface({
	appearance,
	name,
	size,
	className,
	children,
	...props
}: {
	appearance: WidgetAppearance;
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
			appearanceOverride={appearance}
			variant="surface"
			shape="section"
			data-widget={name}
			data-widget-size={size}
			data-widget-appearance={appearance}
			className={cn(
				"dashboard-widget-card isolate flex shrink-0 flex-col items-stretch",
				className,
			)}
		>
			{children}
		</GlassSurface>
	);
}
