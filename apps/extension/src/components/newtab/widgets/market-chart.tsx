import { ChartContainer } from "@ktab/ui/components/chart";
import { useId } from "react";
import { Area, AreaChart, ReferenceLine, YAxis } from "recharts";
import type { MarketQuote } from "../../../services/market-data";

export function MarketChart({ quote }: { quote: MarketQuote }) {
	const gradientId = `market-fill-${useId().replace(/:/g, "")}`;
	const positive = quote.change >= 0;
	const color = positive ? "#39d98a" : "#ff334f";
	if (quote.points.length < 2) {
		return (
			<div className="dashboard-widget-muted grid h-[54px] place-items-center text-[10px]">
				Intraday chart unavailable
			</div>
		);
	}
	return (
		<ChartContainer
			config={{ price: { label: "Price", color } }}
			className="h-[54px] w-full"
			initialDimension={{ width: 300, height: 54 }}
			aria-label={`${quote.symbol} intraday price chart`}
		>
			<AreaChart
				data={quote.points}
				margin={{ top: 6, right: 0, left: 0, bottom: 0 }}
			>
				<defs>
					<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={color} stopOpacity={0.38} />
						<stop offset="100%" stopColor={color} stopOpacity={0} />
					</linearGradient>
				</defs>
				<YAxis hide domain={["dataMin", "dataMax"]} />
				<ReferenceLine
					y={quote.previousClose}
					stroke={color}
					strokeDasharray="3 3"
					opacity={0.8}
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
