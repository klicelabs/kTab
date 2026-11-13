export interface MarketPoint {
	time: number;
	close: number;
}

export interface MarketQuote {
	symbol: string;
	name: string;
	currency: string;
	price: number;
	previousClose: number;
	change: number;
	changePercent: number;
	points: MarketPoint[];
}

export type MarketChartPeriod = "1D" | "1W" | "1M" | "1Y";

const MARKET_PERIOD_QUERY: Record<
	MarketChartPeriod,
	{ range: string; interval: string }
> = {
	"1D": { range: "1d", interval: "5m" },
	"1W": { range: "5d", interval: "30m" },
	"1M": { range: "1mo", interval: "1d" },
	"1Y": { range: "1y", interval: "1d" },
};

export interface MarketRequestOptions {
	fetcher?: typeof fetch;
	signal?: AbortSignal;
}

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function yahooName(symbol: string, meta: Record<string, unknown>): string {
	for (const key of ["longName", "shortName"]) {
		const value = meta[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return symbol;
}

function normalizeYahooChart(
	value: unknown,
	symbol: string,
	period: MarketChartPeriod,
): MarketQuote {
	if (!isRecord(value) || !isRecord(value.chart)) {
		throw new Error(`Market data for ${symbol} was incomplete.`);
	}
	const chart = value.chart;
	if (Array.isArray(chart.error) && chart.error.length > 0) {
		throw new Error(`Market data for ${symbol} is unavailable.`);
	}
	const result = Array.isArray(chart.result) ? chart.result[0] : null;
	if (!isRecord(result) || !isRecord(result.meta)) {
		throw new Error(`Market data for ${symbol} was incomplete.`);
	}
	const meta = result.meta;
	const indicators = isRecord(result.indicators) ? result.indicators : null;
	const quote =
		indicators && Array.isArray(indicators.quote) ? indicators.quote[0] : null;
	const closes =
		isRecord(quote) && Array.isArray(quote.close) ? quote.close : [];
	const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
	const points: MarketPoint[] = [];
	for (
		let index = 0;
		index < Math.min(closes.length, timestamps.length);
		index++
	) {
		const close = closes[index];
		const time = timestamps[index];
		if (finiteNumber(close) && finiteNumber(time)) points.push({ time, close });
	}
	const lastPoint = points.at(-1)?.close;
	const price = finiteNumber(meta.regularMarketPrice)
		? meta.regularMarketPrice
		: lastPoint;
	const dayPreviousClose = finiteNumber(meta.chartPreviousClose)
		? meta.chartPreviousClose
		: finiteNumber(meta.previousClose)
			? meta.previousClose
			: null;
	const previousClose =
		period === "1D" ? dayPreviousClose : (points[0]?.close ?? dayPreviousClose);
	if (!finiteNumber(price) || !finiteNumber(previousClose)) {
		throw new Error(`Market data for ${symbol} is missing a current price.`);
	}
	const change = price - previousClose;
	return {
		symbol,
		name: yahooName(symbol, meta),
		currency:
			typeof meta.currency === "string" && meta.currency.length === 3
				? meta.currency
				: "USD",
		price,
		previousClose,
		change,
		changePercent: previousClose === 0 ? 0 : (change / previousClose) * 100,
		points: period === "1D" ? points.slice(-48) : points,
	};
}

async function fetchQuote(
	symbol: string,
	options: MarketRequestOptions,
	period: MarketChartPeriod = "1D",
): Promise<MarketQuote> {
	const url = new URL(`${YAHOO_CHART_URL}${encodeURIComponent(symbol)}`);
	url.searchParams.set("range", MARKET_PERIOD_QUERY[period].range);
	url.searchParams.set("interval", MARKET_PERIOD_QUERY[period].interval);
	const response = await (options.fetcher ?? fetch)(url, {
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		signal: options.signal,
		headers: { accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`Market data request failed (${response.status}).`);
	}
	const quote = normalizeYahooChart(await response.json(), symbol, period);
	if (period !== "1D" && quote.points.length < 2) {
		throw new Error(`Historical market data for ${symbol} is unavailable.`);
	}
	return quote;
}

/** Fetch one historical chart period after the user opens an asset chart. */
export async function fetchMarketHistory(
	symbol: string,
	period: MarketChartPeriod,
	options: MarketRequestOptions = {},
): Promise<MarketQuote> {
	const normalized = symbol.trim().toUpperCase();
	if (!/^[A-Z0-9.^=_-]{1,16}$/.test(normalized)) {
		throw new Error("Enter a valid market ticker before loading its chart.");
	}
	return fetchQuote(normalized, options, period);
}

/** Fetch at most three public quote snapshots in parallel. */
export async function fetchMarketQuotes(
	symbols: readonly string[],
	options: MarketRequestOptions = {},
): Promise<MarketQuote[]> {
	const uniqueSymbols = Array.from(
		new Set(
			symbols
				.map((symbol) => symbol.trim().toUpperCase())
				.filter((symbol) => /^[A-Z0-9.^=_-]{1,16}$/.test(symbol)),
		),
	).slice(0, 3);
	if (uniqueSymbols.length === 0) return [];
	const results = await Promise.allSettled(
		uniqueSymbols.map((symbol) => fetchQuote(symbol, options)),
	);
	const quotes = results.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
	if (quotes.length === 0) {
		const failure = results.find((result) => result.status === "rejected");
		throw failure?.status === "rejected"
			? failure.reason
			: new Error("Market data is unavailable.");
	}
	return quotes;
}
