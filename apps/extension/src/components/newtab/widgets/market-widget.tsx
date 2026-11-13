import { Icon } from "@ktab/ui/icons/icon";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getWidgetCache, putWidgetCache } from "../../../lib/idb";
import { subscribeWidgetAction } from "../../../lib/widget-actions";
import {
	formatMarketChange,
	formatMarketChangePercent,
	formatMarketPrice,
} from "../../../lib/widget-format";
import {
	fetchMarketHistory,
	fetchMarketQuotes,
	type MarketChartPeriod,
	type MarketQuote,
} from "../../../services/market-data";
import { useSetupStore } from "../../../stores/setup-store";
import type { WidgetAppearance, WidgetSizePreference } from "../../../types";
import { WidgetSurface } from "./widget-surface";

const CACHE_AGE = 5 * 60 * 1000;
const MARKET_EASE = [0.22, 1, 0.36, 1] as const;
const PERIODS: readonly MarketChartPeriod[] = ["1D", "1W", "1M", "1Y"];
const MarketChart = lazy(() =>
	import("./market-chart").then((module) => ({ default: module.MarketChart })),
);

export type MarketWidgetStatus = "loading" | "ready" | "error";
type MarketHistoryStatus = "loading" | "ready" | "error";

function historyKey(symbol: string, period: MarketChartPeriod) {
	return `market-history:${symbol}:${period}`;
}

function isMarketQuote(value: unknown): value is MarketQuote {
	return (
		typeof value === "object" &&
		value !== null &&
		"symbol" in value &&
		typeof value.symbol === "string" &&
		"price" in value &&
		typeof value.price === "number" &&
		"points" in value &&
		Array.isArray(value.points)
	);
}

function isQuoteList(value: unknown): value is MarketQuote[] {
	return Array.isArray(value) && value.every(isMarketQuote);
}

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
	const color =
		quote.change >= 0 ? "var(--market-positive)" : "var(--market-negative)";
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

function PeriodSelector({
	value,
	onChange,
	compact,
}: {
	value: MarketChartPeriod;
	onChange: (period: MarketChartPeriod) => void;
	compact: boolean;
}) {
	return (
		<fieldset
			aria-label="Chart period"
			className={`squircle m-0 grid h-[27px] min-w-0 shrink-0 grid-cols-4 gap-0.5 rounded-lg border-0 bg-black/[0.055] p-0.5 dark:bg-white/[0.08] ${compact ? "w-full" : "w-[178px]"}`}
		>
			<legend className="sr-only">Chart period</legend>
			{PERIODS.map((period) => (
				<button
					key={period}
					type="button"
					aria-pressed={value === period}
					onClick={() => onChange(period)}
					className={`squircle rounded-md font-medium text-[10px] tabular-nums transition-[background-color,color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] ${
						value === period
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{period}
				</button>
			))}
		</fieldset>
	);
}

export function MarketWidgetView({
	quotes,
	status,
	appearance,
	size = "expanded",
	onRefresh,
	onChartRequest,
	historyQuotes = {},
	historyStatuses = {},
	renderChart,
}: {
	quotes: MarketQuote[];
	status: MarketWidgetStatus;
	appearance: WidgetAppearance;
	size?: WidgetSizePreference;
	onRefresh?: () => void;
	onChartRequest?: (quote: MarketQuote, period: MarketChartPeriod) => void;
	historyQuotes?: Record<string, MarketQuote>;
	historyStatuses?: Record<string, MarketHistoryStatus>;
	renderChart?: (
		quote: MarketQuote,
		period: MarketChartPeriod,
		loading: boolean,
		error: boolean,
	) => ReactNode;
}) {
	const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
	const [chartPeriod, setChartPeriod] = useState<MarketChartPeriod>("1D");
	const reduceMotion = useReducedMotion() ?? false;
	const compact = size === "compact";
	const motionOffset = reduceMotion ? 0 : 5;
	const motionScale = reduceMotion ? 1 : 0.99;
	const transition = {
		duration: reduceMotion ? 0 : 0.2,
		ease: MARKET_EASE,
	};
	const selected =
		quotes.find((quote) => quote.symbol === selectedSymbol) ?? null;
	const selectedHistoryKey = selected
		? historyKey(selected.symbol, chartPeriod)
		: "";
	const history = selectedHistoryKey
		? historyQuotes[selectedHistoryKey]
		: undefined;
	const historyStatus = selectedHistoryKey
		? (historyStatuses[selectedHistoryKey] ?? "loading")
		: "loading";
	const displayedQuote = history ?? selected;
	const chartQuote = selected
		? (history ??
			(chartPeriod === "1D" ? selected : { ...selected, points: [] }))
		: null;
	const chartLoading = !history && historyStatus === "loading";
	const chartError = !history && historyStatus === "error";

	function openChart(quote: MarketQuote) {
		setSelectedSymbol(quote.symbol);
		setChartPeriod("1D");
		onChartRequest?.(quote, "1D");
	}

	function changePeriod(period: MarketChartPeriod) {
		setChartPeriod(period);
		if (selected) onChartRequest?.(selected, period);
	}

	return (
		<WidgetSurface
			name="market"
			size={size}
			appearance={appearance}
			className="p-3"
		>
			<AnimatePresence mode="wait" initial={false}>
				{selected && displayedQuote && chartQuote ? (
					<motion.div
						key={`chart-${selected.symbol}`}
						initial={{ opacity: 0, x: motionOffset, scale: motionScale }}
						animate={{ opacity: 1, x: 0, scale: 1 }}
						exit={{ opacity: 0, x: -motionOffset, scale: motionScale }}
						transition={transition}
						className="flex h-full min-h-0 flex-col gap-1"
						data-market-view="chart"
						data-market-size={size}
					>
						<div className="flex min-w-0 shrink-0 items-center gap-1">
							<button
								type="button"
								aria-label="Back to assets"
								onClick={() => setSelectedSymbol(null)}
								className="grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-150 hover:bg-current/10"
							>
								<Icon name="chevron-left" size={14} aria-hidden="true" />
							</button>
							<span className="truncate font-semibold text-[12px]">
								{selected.symbol}
							</span>
							<span className="dashboard-widget-muted min-w-0 flex-1 truncate text-[9px]">
								{selected.name}
							</span>
						</div>

						<div className="min-h-0 flex-1">
							{renderChart ? (
								renderChart(chartQuote, chartPeriod, chartLoading, chartError)
							) : (
								<Suspense fallback={<div className="h-full min-h-[44px]" />}>
									<MarketChart
										quote={chartQuote}
										period={chartPeriod}
										compact={compact}
										loading={chartLoading}
										error={chartError}
									/>
								</Suspense>
							)}
						</div>

						<div className="flex shrink-0 items-end justify-between gap-2">
							<div className="truncate font-light text-[25px] leading-none tracking-[-0.045em]">
								{formatMarketPrice(displayedQuote.price)}
							</div>
							<div
								className="shrink-0 text-right text-[10px] tabular-nums leading-tight"
								style={{
									color:
										displayedQuote.change >= 0
											? "var(--market-positive)"
											: "var(--market-negative)",
								}}
							>
								{history || chartPeriod === "1D"
									? formatMarketChangePercent(displayedQuote.changePercent)
									: chartLoading
										? "…"
										: "—"}
							</div>
						</div>
						<PeriodSelector
							value={chartPeriod}
							onChange={changePeriod}
							compact={compact}
						/>
					</motion.div>
				) : (
					<motion.div
						key="list"
						initial={{ opacity: 0, x: motionOffset, scale: motionScale }}
						animate={{ opacity: 1, x: 0, scale: 1 }}
						exit={{ opacity: 0, x: -motionOffset, scale: motionScale }}
						transition={transition}
						className="flex h-full min-h-0 flex-col justify-between"
						data-market-view={compact ? "compact" : "list"}
						data-market-size={size}
					>
						{quotes.length > 0 ? (
							<ul
								className="m-0 flex h-full min-h-0 list-none flex-col justify-between p-0"
								aria-label="Tracked market assets"
							>
								{quotes.slice(0, 3).map((quote) => (
									<li key={quote.symbol} className="min-h-0 flex-1">
										<button
											type="button"
											onClick={() => openChart(quote)}
											aria-label={`Show chart for ${quote.symbol}, ${quote.name}`}
											className={`grid h-full min-h-0 w-full items-center text-start ${
												compact
													? "grid-cols-[minmax(0,1fr)_auto] gap-2 px-1"
													: "grid-cols-[minmax(0,1fr)_minmax(64px,0.8fr)_auto] gap-2"
											}`}
										>
											<span className="grid min-w-0 gap-0.5">
												<span
													className={`truncate font-semibold leading-none ${compact ? (quotes.length === 1 ? "text-[15px]" : "text-[12px]") : "text-[13px]"}`}
												>
													{quote.symbol}
												</span>
												<span
													className={`dashboard-widget-muted truncate leading-none ${compact ? "text-[9px]" : "text-[10px]"}`}
												>
													{quote.name}
												</span>
											</span>
											{!compact || quotes.length === 1 ? (
												<span aria-hidden="true" className="min-w-0">
													<MarketSparkline quote={quote} />
												</span>
											) : null}
											<span className="grid shrink-0 justify-items-end gap-0.5">
												<span
													className={`font-semibold leading-none ${compact ? (quotes.length === 1 ? "text-[18px]" : "text-[12px]") : "text-[13px]"}`}
												>
													{formatMarketPrice(quote.price)}
												</span>
												<span
													className={`leading-none ${compact ? "text-[9px]" : "text-[10px]"}`}
													style={{
														color:
															quote.change >= 0
																? "var(--market-positive)"
																: "var(--market-negative)",
													}}
												>
													{compact
														? formatMarketChangePercent(quote.changePercent)
														: formatMarketChange(quote.change)}
												</span>
											</span>
										</button>
									</li>
								))}
							</ul>
						) : (
							<div className="dashboard-widget-muted flex h-full flex-col items-center justify-center gap-2 text-center text-[11px]">
								{status === "error"
									? "Market data unavailable"
									: status === "ready"
										? "Add an asset in Settings"
										: "Loading market data…"}
								{status === "error" ? (
									<button
										type="button"
										aria-label="Refresh market data"
										onClick={onRefresh}
										className="squircle grid h-7 w-7 place-items-center rounded-lg bg-white/10"
									>
										<Icon name="refresh" size={13} aria-hidden="true" />
									</button>
								) : null}
							</div>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</WidgetSurface>
	);
}

export function MarketWidget() {
	const settings = useSetupStore((state) => state.settings.widgets.market);
	const tickerKey = settings.tickers.join(",");
	const [quotes, setQuotes] = useState<MarketQuote[]>([]);
	const [status, setStatus] = useState<MarketWidgetStatus>("loading");
	const [refreshCount, setRefreshCount] = useState(0);
	const [historyQuotes, setHistoryQuotes] = useState<
		Record<string, MarketQuote>
	>({});
	const [historyStatuses, setHistoryStatuses] = useState<
		Record<string, MarketHistoryStatus>
	>({});
	const historyController = useRef<AbortController | null>(null);
	const cacheKey = useMemo(() => `market:${tickerKey}`, [tickerKey]);

	useEffect(() => {
		if (!settings.enabled) return;
		return subscribeWidgetAction("market", "refresh", () =>
			setRefreshCount((count) => count + 1),
		);
	}, [settings.enabled]);

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

	useEffect(() => () => historyController.current?.abort(), []);

	async function requestHistory(quote: MarketQuote, period: MarketChartPeriod) {
		const key = historyKey(quote.symbol, period);
		const controller = new AbortController();
		historyController.current?.abort();
		historyController.current = controller;
		setHistoryStatuses((current) => ({ ...current, [key]: "loading" }));
		try {
			const cached = await getWidgetCache<MarketQuote>(key).catch(() => null);
			if (controller.signal.aborted) return;
			if (cached && isMarketQuote(cached.value)) {
				setHistoryQuotes((current) => ({ ...current, [key]: cached.value }));
				if (Date.now() - cached.fetchedAt < CACHE_AGE) {
					setHistoryStatuses((current) => ({ ...current, [key]: "ready" }));
					return;
				}
			}
			const result = await fetchMarketHistory(quote.symbol, period, {
				signal: controller.signal,
			});
			if (controller.signal.aborted) return;
			setHistoryQuotes((current) => ({ ...current, [key]: result }));
			setHistoryStatuses((current) => ({ ...current, [key]: "ready" }));
			void putWidgetCache(key, { fetchedAt: Date.now(), value: result }).catch(
				() => undefined,
			);
		} catch {
			if (controller.signal.aborted) return;
			setHistoryStatuses((current) => ({ ...current, [key]: "error" }));
		}
	}

	if (!settings.enabled) return null;
	return (
		<MarketWidgetView
			quotes={quotes}
			status={status}
			appearance={settings.appearance}
			size={settings.size}
			onRefresh={() => setRefreshCount((count) => count + 1)}
			onChartRequest={requestHistory}
			historyQuotes={historyQuotes}
			historyStatuses={historyStatuses}
		/>
	);
}
