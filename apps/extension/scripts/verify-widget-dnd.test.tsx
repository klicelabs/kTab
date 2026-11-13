import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { DEFAULT_SETUP } from "../src/lib/constants";
import { useSetupStore } from "../src/stores/setup-store";

test("widget cards reorder with pointer drag while inner buttons stay clickable", async () => {
	const { document, window } = parseHTML(
		"<!doctype html><html><body><div id='root'></div></body></html>",
	);
	const raf = (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 0) as unknown as number;
	const globals: Record<string, unknown> = {
		window,
		document,
		navigator: window.navigator,
		Element: window.Element,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		Event: window.Event,
		requestAnimationFrame: raf,
		cancelAnimationFrame: (id: number) => clearTimeout(id),
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
	Object.assign(window, {
		requestAnimationFrame: raf,
		cancelAnimationFrame: (id: number) => clearTimeout(id),
		matchMedia: () => ({
			matches: false,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		}),
	});
	Object.defineProperty(document, "elementFromPoint", {
		configurable: true,
		value: (x: number) => {
			const slots = Array.from(
				document.querySelectorAll<HTMLElement>("[data-widget-slot-id]"),
			);
			return slots.find((slot) => {
				const bounds = slot.getBoundingClientRect();
				return x >= bounds.left && x <= bounds.right;
			});
		},
	});

	const rootElement = document.querySelector("#root");
	if (!rootElement) throw new Error("Expected a React root element.");
	const startingOrder = ["weather", "music", "market", "github"] as const;
	const initialSettings = useSetupStore.getState().settings;
	useSetupStore.getState().updateSettings({
		weather: { ...initialSettings.weather, enabled: false },
		widgets: {
			...initialSettings.widgets,
			order: [...startingOrder],
			music: {
				...initialSettings.widgets.music,
				enabled: true,
				size: "compact",
			},
			market: { ...initialSettings.widgets.market, enabled: true },
			github: { ...initialSettings.widgets.github, enabled: false },
		},
	});

	const [{ createRoot }, { WidgetSection }, { WidgetSettings }] =
		await Promise.all([
			import("react-dom/client"),
			import("../src/components/newtab/widget-section"),
			import("../src/components/newtab/settings/panes/widget-settings"),
		]);
	const root = createRoot(rootElement);
	try {
		await act(async () => {
			root.render(
				createElement(
					"div",
					{},
					createElement(WidgetSection, {
						items: [
							{
								id: "music",
								content: createElement(
									"div",
									{ "data-widget": "music" },
									createElement("button", { type: "button" }, "Play"),
								),
							},
							{
								id: "market",
								content: createElement(
									"div",
									{ "data-widget": "market" },
									"Market",
								),
							},
						],
					}),
					createElement(WidgetSettings),
				),
			);
		});

		const slots = Array.from(
			document.querySelectorAll<HTMLElement>("[data-widget-slot-id]"),
		);
		for (const [index, slot] of slots.entries()) {
			const left = index * 220;
			slot.getBoundingClientRect = () =>
				({
					left,
					right: left + 200,
					top: 0,
					bottom: 150,
					width: 200,
					height: 150,
					x: left,
					y: 0,
					toJSON: () => ({}),
				}) as DOMRect;
		}
		const musicSlot = document.querySelector<HTMLElement>(
			'[data-widget-slot-id="music"]',
		);
		if (!musicSlot) throw new Error("Expected the music widget slot.");

		function dispatchPointer(
			target: Element,
			type: "pointerdown" | "pointermove" | "pointerup",
			pointerId: number,
			clientX: number,
		) {
			const event = new window.Event(type, { bubbles: true, cancelable: true });
			Object.defineProperties(event, {
				button: { value: 0 },
				clientX: { value: clientX },
				clientY: { value: 40 },
				isPrimary: { value: true },
				pointerId: { value: pointerId },
				pointerType: { value: "mouse" },
			});
			target.dispatchEvent(event);
		}

		await act(async () => {
			dispatchPointer(musicSlot, "pointerdown", 1, 40);
			dispatchPointer(musicSlot, "pointermove", 1, 390);
		});
		expect(musicSlot.getAttribute("data-widget-dragging")).toBe("true");
		await act(async () => dispatchPointer(musicSlot, "pointerup", 1, 390));
		expect(useSetupStore.getState().settings.widgets.order).toEqual([
			"weather",
			"market",
			"music",
			"github",
		]);
		const musicSettings = document.querySelector(
			'[aria-label="Music options"]',
		);
		expect(musicSettings?.textContent).toContain(
			"The compact player uses the album cover as its full-card appearance.",
		);
		expect(musicSettings?.textContent).toContain(
			"Choose Expanded to change its surface style.",
		);

		await act(async () => {
			const contextMenuEvent = new window.Event("contextmenu", {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperties(contextMenuEvent, {
				clientX: { value: 40 },
				clientY: { value: 40 },
			});
			musicSlot.dispatchEvent(contextMenuEvent);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		const musicMenu = document.querySelector(
			'[aria-label="Music widget options"]',
		);
		expect(musicMenu?.textContent).not.toContain("Appearance");
		expect(musicMenu?.textContent).toContain("Change audio output");

		const currentMusicSlot = document.querySelector<HTMLElement>(
			'[data-widget-slot-id="music"]',
		);
		const playButton = currentMusicSlot?.querySelector("button");
		if (!currentMusicSlot || !playButton)
			throw new Error("Expected the music play button.");
		await act(async () => {
			dispatchPointer(playButton, "pointerdown", 2, 260);
			dispatchPointer(playButton, "pointermove", 2, 40);
			dispatchPointer(playButton, "pointerup", 2, 40);
		});
		expect(useSetupStore.getState().settings.widgets.order).toEqual([
			"weather",
			"market",
			"music",
			"github",
		]);
	} finally {
		await act(async () => root.unmount());
		useSetupStore.getState().updateSettings(DEFAULT_SETUP.settings);
	}
});
