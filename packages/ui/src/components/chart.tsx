import { ResponsiveContainer } from "recharts";
import {
	type CSSProperties,
	type HTMLAttributes,
	type ReactElement,
	useId,
} from "react";
import { cn } from "../lib/utils";

export type ChartConfig = Record<string, { color: string; label?: string }>;

type ChartContainerProps = HTMLAttributes<HTMLDivElement> & {
	config: ChartConfig;
	children: ReactElement;
	initialDimension?: { width: number; height: number };
};

/** Small shadcn-style chart host; Recharts primitives stay composable inside. */
export function ChartContainer({
	config,
	children,
	className,
	style,
	initialDimension = { width: 300, height: 72 },
	...props
}: ChartContainerProps) {
	const id = `chart-${useId().replace(/:/g, "")}`;
	const variables = Object.fromEntries(
		Object.entries(config).map(([key, value]) => [
			`--color-${key}`,
			value.color,
		]),
	) as CSSProperties;
	return (
		<div
			{...props}
			data-chart={id}
			className={cn("flex min-h-0 w-full justify-center", className)}
			style={{ ...variables, ...style }}
		>
			<ResponsiveContainer
				width="100%"
				height="100%"
				initialDimension={initialDimension}
			>
				{children}
			</ResponsiveContainer>
		</div>
	);
}
