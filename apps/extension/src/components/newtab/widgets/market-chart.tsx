import { ChartContainer } from "@ktab/ui/components/chart";
import { useId } from "react";
import { Area, AreaChart, ReferenceLine, Tooltip, YAxis } from "recharts";
import { formatMarketPrice } from "../../../lib/widget-format";
import type {
	MarketChartPeriod,
	MarketQuote,
} from "../../../services/market-data";

export function marketTooltipEdge(
	cursorX: number,
	chartWidth: number,
): "left" | "right" {
	return cursorX > chartWidth * 0.68 ? "left" : "right";
}

export function MarketChart({
	quote,
	period = "1D",
	compact = false,
	loading = false,
	error = false,
}: {
	quote: MarketQuote;
	period?: MarketChartPeriod;
	compact?: boolean;
	loading?: boolean;
	error?: boolean;
}) {
	const gradientId = `market-fill-${useId().replace(/:/g, "")}`;
	const positive = quote.change >= 0;
	const color = positive ? "var(--market-positive)" : "var(--market-negative)";
	const chartHeight = compact ? 48 : 62;
	if (quote.points.length < 2) {
		return (
			<div
				role="status"
				className="dashboard-widget-muted grid h-full min-h-[44px] place-items-center text-center text-[10px]"
			>
				{loading
					? "Loading chart…"
					: error
						? "Could not load this period. Try another range."
						: `No ${period} history available`}
			</div>
		);
	}
	return (
		<ChartContainer
			config={{ price: { label: "Price", color } }}
			className="h-full min-h-0 w-full overflow-visible"
			initialDimension={{ width: compact ? 140 : 300, height: chartHeight }}
			aria-label={`${quote.symbol} ${period} price chart`}
		>
			<AreaChart
				data={quote.points}
				margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
			>
				<defs>
					<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={color} stopOpacity={0.36} />
						<stop offset="100%" stopColor={color} stopOpacity={0} />
					</linearGradient>
				</defs>
				<YAxis hide domain={["dataMin", "dataMax"]} />
				<ReferenceLine
					y={quote.previousClose}
					stroke={color}
					strokeDasharray="3 3"
					opacity={0.55}
				/>
				<Tooltip
					cursor={{
						stroke: "currentColor",
						strokeOpacity: 0.24,
						strokeDasharray: "3 3",
					}}
					allowEscapeViewBox={{ x: false, y: true }}
					isAnimationActive={false}
					wrapperStyle={{ pointerEvents: "none", zIndex: 40 }}
					content={(props) => {
						const point = props.payload?.[0]?.payload as
							| { time: number; close: number }
							| undefined;
						if (!props.active || !point) return null;
						const locale =
							typeof navigator !== "undefined" ? navigator.language : "en-US";
						const date = new Intl.DateTimeFormat(locale, {
							dateStyle: "medium",
							timeStyle: "short",
						}).format(new Date(point.time * 1000));
						const viewBoxProps = props as typeof props & {
							viewBox?: { width?: number };
						};
						const viewWidth =
							viewBoxProps.viewBox?.width ?? (compact ? 140 : 300);
						const cursorX = props.coordinate?.x ?? 0;
						const alignLeft = marketTooltipEdge(cursorX, viewWidth) === "left";
						return (
							<div
								data-tooltip-edge={alignLeft ? "left" : "right"}
								className="squircle grid gap-0.5 rounded-md bg-background px-2 py-1 text-[10px] text-foreground shadow-lg ring-1 ring-border"
								style={{
									transform: alignLeft
										? "translateX(calc(-100% - 10px))"
										: "translateX(10px)",
								}}
							>
								<strong className="font-semibold tabular-nums">
									{formatMarketPrice(point.close)}
								</strong>
								<time className="whitespace-nowrap text-muted-foreground">
									{date}
								</time>
							</div>
						);
					}}
				/>
				<Area
					type="monotone"
					dataKey="close"
					stroke={color}
					strokeWidth={2}
					fill={`url(#${gradientId})`}
					isAnimationActive={false}
					connectNulls
				/>
			</AreaChart>
		</ChartContainer>
	);
}
