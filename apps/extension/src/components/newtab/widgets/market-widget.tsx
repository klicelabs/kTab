import { Icon } from "@ktab/ui/icons/icon";
import { EASE_OUT } from "@ktab/ui/lib/ease";
import { AnimatePresence, motion } from "motion/react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useMemo,
	useState,
} from "react";
import { getWidgetCache, putWidgetCache } from "../../../lib/idb";
import {
	formatMarketChange,
	formatMarketPrice,
} from "../../../lib/widget-format";
import {
	fetchMarketQuotes,
	type MarketQuote,
} from "../../../services/market-data";
import { useSetupStore } from "../../../stores/setup-store";
import type { WidgetSizePreference } from "../../../types";
import { WidgetSurface } from "./widget-surface";

const CACHE_AGE = 5 * 60 * 1000;
const MarketChart = lazy(() =>
	import("./market-chart").then((module) => ({ default: module.MarketChart })),
);

export type MarketWidgetStatus = "loading" | "ready" | "error";

function MarketSparkline({ quote }: { quote: MarketQuote }) {
	const points = quote.points;
	const minimum = Math.min(...points.map((point) => point.close));
	const maximum = Math.max(...points.map((point) => point.close));
	const range = Math.max(0.000001, maximum - minimum);
	const path = points
		.map((point, index) => {
			const x = points.length <= 1 ? 50 : (index / (points.length - 1)) * 100;
			const y = 27 - ((point.close - minimum) / range) * 24;
			return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");
	const color = quote.change >= 0 ? "#39d98a" : "#ff334f";
	return (
		<svg
			viewBox="0 0 100 30"
			className="h-8 w-full overflow-visible"
			role="img"
			aria-label={`${quote.symbol} intraday trend`}
		>
			<path
				d={path}
				fill="none"
				stroke={color}
				strokeWidth="2"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

function isQuoteList(value: unknown): value is MarketQuote[] {
	return (
		Array.isArray(value) &&
		value.every((quote) => {
			return (
				typeof quote === "object" &&
				quote !== null &&
				"symbol" in quote &&
				"price" in quote &&
				"points" in quote
			);
		})
	);
}

export function MarketWidgetView({
	quotes,
	status,
	appearance,
	size = "expanded",
	onRefresh,
	renderChart,
}: {
	quotes: MarketQuote[];
	status: MarketWidgetStatus;
	appearance: "flat" | "glass";
	size?: WidgetSizePreference;
	onRefresh?: () => void;
	renderChart?: (quote: MarketQuote) => ReactNode;
}) {
	const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
	const selected =
		quotes.find((quote) => quote.symbol === selectedSymbol) ?? null;
	return (
		<WidgetSurface
			name="market"
			size={size}
			appearance={appearance}
			className="p-3"
		>
			{size === "compact" ? (
				<div
					className="flex h-full min-h-0 flex-col justify-between"
					data-market-view="compact"
				>
					{quotes[0] ? (
						<>
							<div className="flex min-w-0 items-start justify-between gap-2">
								<div className="min-w-0">
									<p className="truncate font-semibold text-[13px] leading-tight">
										{quotes[0].symbol}
									</p>
									<p className="dashboard-widget-muted truncate text-[10px] leading-tight">
										{quotes[0].name}
									</p>
								</div>
								<div className="shrink-0 text-right">
									<p className="font-semibold text-[13px] leading-tight">
										{formatMarketPrice(quotes[0].price)}
									</p>
									<p
										className={`text-[10px] leading-tight ${quotes[0].change >= 0 ? "text-emerald-500" : "text-red-500"}`}
									>
										{formatMarketChange(quotes[0].change)}
									</p>
								</div>
							</div>
							<MarketSparkline quote={quotes[0]} />
						</>
					) : (
						<div className="dashboard-widget-muted flex h-full items-center justify-center text-center text-[11px]">
							{status === "error"
								? "Market data unavailable"
								: status === "ready"
									? "Add an asset in Settings"
									: "Loading market data…"}
						</div>
					)}
				</div>
			) : (
				<AnimatePresence mode="sync" initial={false}>
					{selected ? (
						<motion.div
							key={`chart-${selected.symbol}`}
							initial={{ opacity: 0, y: 6 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -4 }}
							transition={{ duration: 0.24, ease: EASE_OUT }}
							className="flex h-full min-h-0 flex-col"
							data-market-view="chart"
						>
							<button
								type="button"
								aria-label="Back to assets"
								onClick={() => setSelectedSymbol(null)}
								className="flex min-w-0 items-center gap-1 text-start"
							>
								<Icon name="chevron-left" size={14} aria-hidden="true" />
								<span className="truncate font-semibold text-[12px]">
									{selected.symbol}
								</span>
								<span className="dashboard-widget-muted min-w-0 flex-1 truncate text-[9px]">
									{selected.name}
								</span>
								<span
									className={`shrink-0 text-[10px] ${selected.change >= 0 ? "text-emerald-400" : "text-red-400"}`}
								>
									{formatMarketChange(selected.change)}
								</span>
							</button>
							<div className="mt-1 min-h-0 flex-1">
								{renderChart ? (
									renderChart(selected)
								) : (
									<Suspense fallback={<div className="h-[54px]" />}>
										<MarketChart quote={selected} />
									</Suspense>
								)}
							</div>
							<div className="mt-auto truncate font-light text-[32px] leading-[1] tracking-[-0.045em]">
								{formatMarketPrice(selected.price)}
							</div>
						</motion.div>
					) : (
						<motion.div
							key="list"
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -4 }}
							transition={{ duration: 0.24, ease: EASE_OUT }}
							className="flex h-full min-h-0 flex-col justify-between"
							data-market-view="list"
						>
							{quotes.length > 0 ? (
								quotes.map((quote) => (
									<button
										key={quote.symbol}
										type="button"
										onClick={() => setSelectedSymbol(quote.symbol)}
										aria-label={`Show chart for ${quote.symbol}, ${quote.name}`}
										className="flex min-h-0 flex-1 items-center justify-between gap-2 text-start"
									>
										<span className="grid min-w-0 gap-0.5">
											<span className="truncate font-semibold text-[13px] leading-none">
												{quote.symbol}
											</span>
											<span className="dashboard-widget-muted truncate text-[10px] leading-none">
												{quote.name}
											</span>
										</span>
										<span className="grid shrink-0 justify-items-end gap-0.5">
											<span className="font-semibold text-[13px] leading-none">
												{formatMarketPrice(quote.price)}
											</span>
											<span
												className={`text-[10px] leading-none ${quote.change >= 0 ? "text-emerald-400" : "text-red-400"}`}
											>
												{formatMarketChange(quote.change)}
											</span>
										</span>
									</button>
								))
							) : (
								<div className="dashboard-widget-muted flex h-full flex-col items-center justify-center gap-2 text-center text-[11px]">
									{status === "error"
										? "Market data unavailable"
										: status === "ready"
											? "Add a ticker in Settings"
											: "Loading market data…"}
									{status === "error" ? (
										<button
											type="button"
											aria-label="Refresh market data"
											onClick={onRefresh}
											className="grid h-7 w-7 place-items-center rounded-full bg-white/10"
										>
											<Icon name="refresh" size={13} aria-hidden="true" />
										</button>
									) : null}
								</div>
							)}
						</motion.div>
					)}
				</AnimatePresence>
			)}
		</WidgetSurface>
	);
}

export function MarketWidget() {
	const settings = useSetupStore((state) => state.settings.widgets.market);
	const tickerKey = settings.tickers.join(",");
	const [quotes, setQuotes] = useState<MarketQuote[]>([]);
	const [status, setStatus] = useState<MarketWidgetStatus>("loading");
	const [refreshCount, setRefreshCount] = useState(0);
	const cacheKey = useMemo(() => `market:${tickerKey}`, [tickerKey]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Clicking retry intentionally re-runs the cache lookup and fetch.
	useEffect(() => {
		if (!settings.enabled) return;
		let active = true;
		const controller = new AbortController();
		const refresh = async () => {
			try {
				const result = await fetchMarketQuotes(settings.tickers, {
					signal: controller.signal,
				});
				if (!active) return;
				setQuotes(result);
				setStatus("ready");
				void putWidgetCache(cacheKey, {
					fetchedAt: Date.now(),
					value: result,
				}).catch(() => undefined);
			} catch {
				if (active && !controller.signal.aborted) setStatus("error");
			}
		};
		void getWidgetCache<MarketQuote[]>(cacheKey)
			.then((cached) => {
				if (!active) return;
				if (cached && isQuoteList(cached.value)) {
					setQuotes(cached.value);
					setStatus("ready");
					if (Date.now() - cached.fetchedAt < CACHE_AGE) return;
				}
				void refresh();
			})
			.catch(() => void refresh());
		const timer = window.setInterval(() => void refresh(), CACHE_AGE);
		return () => {
			active = false;
			window.clearInterval(timer);
			controller.abort();
		};
	}, [cacheKey, refreshCount, settings.enabled, settings.tickers]);

	if (!settings.enabled) return null;
	return (
		<MarketWidgetView
			quotes={quotes}
			status={status}
			appearance={settings.appearance}
			size={settings.size}
			onRefresh={() => setRefreshCount((count) => count + 1)}
		/>
	);
}
