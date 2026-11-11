import { afterEach, expect, test } from "bun:test";
import { SidebarProvider } from "@ktab/ui/components/sidebar";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PexelsDetailView } from "../src/components/newtab/settings/panes/pexels-controls";
import { WallpaperPane } from "../src/components/newtab/settings/panes/wallpaper-pane";
import { SettingsSidebar } from "../src/components/newtab/settings/settings-sidebar";
import { useSetupStore } from "../src/stores/setup-store";

const { window } = parseHTML(
	"<!doctype html><html><body><div id=app></div></body></html>",
);

Object.assign(globalThis, {
	window,
	document: window.document,
	self: window,
	navigator: window.navigator,
	HTMLElement: window.HTMLElement,
	HTMLInputElement: window.HTMLInputElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	// linkedom ships none of these; motion reads one, Base UI's click-trigger
	// path reads the other. Neither result matters here.
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	// linkedom also lacks MouseEvent; only `detail` is read.
	MouseEvent: class extends window.Event {
		detail: number;
		constructor(type: string, init: { detail?: number } = {}) {
			super(type, init);
			this.detail = init.detail ?? 0;
		}
	},
	// Base UI's click-trigger path reads computed styles on open.
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
	matchMedia: () => ({
		matches: true,
		addEventListener() {},
		removeEventListener() {},
	}),
	requestAnimationFrame: (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});

// Layout scrolling is absent in linkedom; the shared sidebar resets it on navigation.
window.HTMLElement.prototype.scrollTo = () => undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	useSetupStore.setState(useSetupStore.getInitialState());
	document.body.innerHTML = "<div id=app></div>";
});

async function mountPane(inSidebar = false) {
	const mount = document.getElementById("app");
	if (!mount) throw new Error("test mount missing");
	root = createRoot(mount);
	await act(async () => {
		root?.render(
			inSidebar ? (
				<SidebarProvider>
					<SettingsSidebar
						open
						onClose={() => undefined}
						initialPane="wallpaper"
					/>
				</SidebarProvider>
			) : (
				<WallpaperPane onOpenPexels={() => undefined} />
			),
		);
	});

	if (inSidebar)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
}

function solidTile() {
	const tile = document.querySelector('[data-wallpaper-tile="solid"]');
	if (!tile) throw new Error("solid tile missing");
	return tile;
}

/** The beUI picker trigger IS the solid tile button itself. */
function solidTrigger() {
	const tile = solidTile();
	return (tile as HTMLElement).matches('[data-color-picker-trigger=""]')
		? tile
		: tile.querySelector('[data-color-picker-trigger=""]');
}

test("the solid tile is the only colour picker trigger in the pane", async () => {
	await mountPane();

	// The lower "Solid colour" row used to hold a second native
	// `<input type="color">`. The beUI picker lives entirely inside the solid
	// tile trigger; no colour control anywhere else in the pane.
	const pickers = [
		...document.querySelectorAll('[data-color-picker-trigger=""]'),
	];
	expect(pickers).toHaveLength(1);
	expect(pickers[0]?.closest('[data-wallpaper-tile="solid"]')).not.toBeNull();
	// The replaced native control must not linger in the pane.
	expect(document.querySelectorAll('input[type="color"]')).toHaveLength(0);
});

test("the solid tile swatch and selected state track the applied colour", async () => {
	useSetupStore.setState({
		settings: {
			...useSetupStore.getState().settings,
			background: {
				...useSetupStore.getState().settings.background,
				type: "solid",
				color: "#123456",
			},
		},
	});
	await mountPane();

	const tile = solidTile();
	const trigger = solidTrigger();
	if (!trigger) throw new Error("colour picker trigger missing");

	// The swatch renders the applied colour.
	const swatch = tile.querySelector("span[aria-hidden]")?.getAttribute("style");
	expect(swatch).toContain("#123456");
	// Active tile carries the accent ring and the check badge.
	expect(tile.className).toContain("ring-[var(--ktab-accent)]");
	expect(tile.querySelector("svg")).not.toBeNull();
	// The toggle reads as selected (clicking the trigger opens the picker).
	expect(trigger.getAttribute("aria-pressed")).toBe("true");
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("picking a colour on the solid tile applies it live", async () => {
	useSetupStore.setState({
		settings: {
			...useSetupStore.getState().settings,
			background: {
				...useSetupStore.getState().settings.background,
				type: "wallpaper",
				wallpaperId: "tokyo-skyline",
			},
		},
	});
	await mountPane();

	const trigger = solidTrigger();
	if (!trigger) throw new Error("colour picker trigger missing");

	// Opening the picker is the selection gesture: solid wins with the
	// persisted colour and the other source ids are cleared.
	await act(async () => {
		trigger.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});

	const background = useSetupStore.getState().settings.background;
	expect(background.type).toBe("solid");
	expect(background.wallpaperId).toBeNull();
	expect(background.gradientId).toBeNull();
	expect(background.imageId).toBeNull();
});

async function click(selector: string) {
	const element = document.querySelector(selector);
	if (!element) throw new Error(`Missing control: ${selector}`);
	await act(async () => {
		element.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
}

test("Pexels opens from a library card and preserves custom query and frequency", async () => {
	useSetupStore.getState().updateBackground({
		type: "pexels",
		pexelsQuery: "Spider-Man Japan",
		pexelsFrequency: "daylight",
	});
	await mountPane(true);
	const card = document.querySelector('[data-wallpaper-tile="pexels"]');
	expect(card?.className).toContain("aspect-[4/3]");
	expect(card?.querySelector("img")?.getAttribute("src")).toStartWith(
		"https://images.pexels.com/",
	);
	expect(card?.querySelector("button")?.getAttribute("aria-pressed")).toBe(
		"true",
	);
	expect(document.getElementById("pexels-query-input")).toBeNull();
	expect(document.getElementById("settings-panel-title")?.textContent).toBe(
		"Wallpaper",
	);
	await click('[data-wallpaper-tile="pexels"] button');
	expect(
		document.getElementById("pexels-query-input")?.getAttribute("value"),
	).toBe("Spider-Man Japan");
	expect(document.querySelectorAll("[data-pexels-theme]")).toHaveLength(7);
	expect(document.getElementById("settings-panel-title")?.textContent).toBe(
		"Pexels",
	);
	expect(document.querySelectorAll("h2")).toHaveLength(1);
	expect(
		document.querySelectorAll(
			'fieldset img[src^="https://images.pexels.com/"]',
		),
	).toHaveLength(12);
	// AnimatePresence may retain the outgoing library while its exit completes.
	expect(document.querySelectorAll("h2")).toHaveLength(1);
	expect(document.body.textContent).toContain("Next photo");
	await click('[aria-label="Back to Wallpaper"]');
	expect(
		document.querySelector('[data-wallpaper-tile="solid"]'),
	).not.toBeNull();
	expect(document.getElementById("settings-panel-title")?.textContent).toBe(
		"Wallpaper",
	);
	expect(useSetupStore.getState().settings.background.pexelsQuery).toBe(
		"Spider-Man Japan",
	);
	expect(useSetupStore.getState().settings.background.pexelsFrequency).toBe(
		"daylight",
	);
});

test("browsing Pexels themes does not activate or replace the current wallpaper", async () => {
	useSetupStore
		.getState()
		.updateBackground({ type: "wallpaper", wallpaperId: "tokyo-skyline" });
	await mountPane(true);
	await click('[data-wallpaper-tile="pexels"] button');
	expect(useSetupStore.getState().settings.background.type).toBe("wallpaper");
	expect(useSetupStore.getState().settings.background.wallpaperId).toBe(
		"tokyo-skyline",
	);
	expect(
		document.querySelectorAll('[data-pexels-theme][aria-pressed="true"]'),
	).toHaveLength(0);
	await click('[aria-label="Back to Wallpaper"]');
	expect(
		document
			.querySelector('[data-wallpaper-tile="tokyo-skyline"] button')
			?.getAttribute("aria-pressed"),
	).toBe("true");
});

test("Pexels content uses the shared settings header without a duplicate title or back button", async () => {
	const mount = document.getElementById("app");
	if (!mount) throw new Error("test mount missing");
	root = createRoot(mount);
	await act(async () => {
		root?.render(<PexelsDetailView />);
	});
	expect(document.querySelectorAll("h2")).toHaveLength(0);
	expect(document.querySelector('[aria-label="Back to Wallpaper"]')).toBeNull();
});
