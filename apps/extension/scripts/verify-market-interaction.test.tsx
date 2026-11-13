import { expect, test } from "bun:test";
import { createElement } from "react";
import { parseHTML } from "linkedom";

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
		await act(async () => {
			root?.render(
				createElement(MarketWidgetView, {
					quotes,
					status: "ready",
					appearance: "flat",
					renderChart: (quote: { symbol: string }) =>
						createElement("div", { "data-intraday-graph": quote.symbol }),
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
		});
		expect(document.querySelector('[data-market-view="chart"]')).not.toBeNull();
		expect(
			document.querySelector('[aria-label="Back to assets"]')?.textContent,
		).toContain("^BVSP");
		const back = document.querySelector<HTMLButtonElement>(
			'[aria-label="Back to assets"]',
		);
		await act(async () => back?.click());
		expect(document.querySelector('[data-market-view="list"]')).not.toBeNull();
	} finally {
		if (root && actTest) await actTest(async () => root?.unmount());
	}
});
