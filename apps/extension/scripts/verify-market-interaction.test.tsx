import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { marketTooltipEdge } from "../src/components/newtab/widgets/market-chart";
import type { MarketChartPeriod } from "../src/services/market-data";

test("market tooltip switches to the open side near the right edge", () => {
	expect(marketTooltipEdge(100, 300)).toBe("right");
	expect(marketTooltipEdge(220, 300)).toBe("left");
});

test("clicking a market row opens its chart and the header returns to the list", async () => {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	const { document, window } = dom;
	const raf = (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 16) as unknown as number;
	class ResizeObserverStub {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	Object.assign(window, {
		requestAnimationFrame: raf,
		cancelAnimationFrame: (id: number) => clearTimeout(id),
		matchMedia: () => ({
			matches: false,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		}),
		MouseEvent: window.Event,
	});
	const globals: Record<string, unknown> = {
		window,
		document,
		navigator: window.navigator,
		Element: window.Element,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		Event: window.Event,
		MouseEvent: window.Event,
		requestAnimationFrame: raf,
		cancelAnimationFrame: window.cancelAnimationFrame,
		ResizeObserver: ResizeObserverStub,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [name, value] of Object.entries(globals)) {
		Object.defineProperty(globalThis, name, {
			configurable: true,
			enumerable: true,
			writable: true,
			value,
		});
	}

	let root: {
		render: (children: unknown) => void;
		unmount: () => void;
	} | null = null;
	let actTest: typeof import("react").act | null = null;
	try {
		const [{ createRoot }, { act }, { MarketWidgetView }] = await Promise.all([
			import("react-dom/client"),
			import("react"),
			import("../src/components/newtab/widgets/market-widget"),
		]);
		actTest = act;
		const rootElement = document.querySelector("#root");
		if (!rootElement) throw new Error("Expected a React root element.");
		root = createRoot(rootElement);
		const quotes = [
			{
				symbol: "^BVSP",
				name: "IBOVESPA",
				currency: "BRL",
				price: 125_053,
				previousClose: 126_147,
				change: -1_094,
				changePercent: -0.86,
				points: [
					{ time: 1, close: 125_200 },
					{ time: 2, close: 125_053 },
				],
			},
		];
		const requestedPeriods: MarketChartPeriod[] = [];
		const renderChart = (
			quote: { symbol: string },
			period: MarketChartPeriod,
			_loading: boolean,
			_error: boolean,
		) =>
			createElement("div", {
				"data-intraday-graph": quote.symbol,
				"data-period": period,
			});
		await act(async () => {
			root?.render(
				createElement(MarketWidgetView, {
					quotes,
					status: "ready",
					appearance: "flat",
					onChartRequest: (_quote: unknown, period: MarketChartPeriod) =>
						requestedPeriods.push(period),
					renderChart,
				}),
			);
		});
		expect(document.querySelector('[data-market-view="list"]')).not.toBeNull();
		const asset = document.querySelector<HTMLButtonElement>(
			'[aria-label="Show chart for ^BVSP, IBOVESPA"]',
		);
		if (!asset) throw new Error("Expected the IBOVESPA asset button.");
		await act(async () => {
			asset.click();
			await new Promise((resolve) => setTimeout(resolve, 250));
		});
		expect(document.querySelector('[data-market-view="chart"]')).not.toBeNull();
		expect(document.querySelector('[data-period="1D"]')).not.toBeNull();
		expect(requestedPeriods).toEqual(["1D"]);
		const oneWeek = document.querySelector<HTMLButtonElement>(
			'fieldset[aria-label="Chart period"] button[aria-pressed="false"]',
		);
		expect(oneWeek).not.toBeNull();
		await act(async () => {
			oneWeek?.click();
		});
		expect(document.querySelector('[data-period="1W"]')).not.toBeNull();
		expect(requestedPeriods).toEqual(["1D", "1W"]);
		expect(
			document.querySelector('[data-market-view="chart"]')?.textContent,
		).toContain("^BVSP");
		const back = document.querySelector<HTMLButtonElement>(
			'[aria-label="Back to assets"]',
		);
		await act(async () => {
			back?.click();
			await new Promise((resolve) => setTimeout(resolve, 250));
		});
		expect(document.querySelector('[data-market-view="list"]')).not.toBeNull();

		await act(async () => {
			root?.render(
				createElement(MarketWidgetView, {
					quotes,
					status: "ready",
					appearance: "flat",
					size: "compact",
					onChartRequest: (_quote: unknown, period: MarketChartPeriod) =>
						requestedPeriods.push(period),
					renderChart,
				}),
			);
		});
		const compactAsset = document.querySelector<HTMLButtonElement>(
			'[aria-label="Show chart for ^BVSP, IBOVESPA"]',
		);
		if (!compactAsset) throw new Error("Expected the compact IBOVESPA row.");
		await act(async () => {
			compactAsset.click();
			await new Promise((resolve) => setTimeout(resolve, 250));
		});
		expect(
			document.querySelector(
				'[data-market-view="chart"][data-market-size="compact"]',
			),
		).not.toBeNull();
		const periodButtons = document.querySelectorAll<HTMLButtonElement>(
			'[aria-label="Chart period"] button',
		);
		expect(periodButtons).toHaveLength(4);
		await act(async () => {
			periodButtons[3]?.click();
		});
		expect(document.querySelector('[data-period="1Y"]')).not.toBeNull();
		expect(requestedPeriods).toEqual(["1D", "1W", "1D", "1Y"]);
	} finally {
		if (root && actTest) await actTest(async () => root?.unmount());
	}
});
