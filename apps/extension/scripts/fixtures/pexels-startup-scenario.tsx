import { mock } from "bun:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import { useImageStore } from "../../src/stores/image-store";
import { useSetupStore } from "../../src/stores/setup-store";

const ready = Promise.withResolvers<void>();
let refreshes = 0;
const status = create(() => ({ status: "error", message: "Try again" }));
mock.module("../../src/services/wallpaper", () => ({
	useWallpaperStatus: status,
	prepareNextWallpaper: async () => undefined,
	refreshWallpaper: async () => {
		refreshes++;
		await ready.promise;
	},
}));
const { BackgroundLayer } = await import(
	"../../src/components/newtab/background-layer"
);
const { PexelsDetailView } = await import(
	"../../src/components/newtab/settings/panes/pexels-controls"
);
const { AppearanceProvider } = await import(
	"../../src/components/newtab/appearance-provider"
);
const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
window.matchMedia = () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
});
Object.assign(globalThis, {
	window,
	document: window.document,
	navigator: window.navigator,
	HTMLElement: window.HTMLElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	Image: class {
		src = "";
		decode = async () => undefined;
	},
	ResizeObserver: class {
		observe() {}
		disconnect() {}
		unobserve() {}
	},
	requestAnimationFrame: (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 0) as unknown as number,
	cancelAnimationFrame: (handle: number) => clearTimeout(handle),
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
useSetupStore.getState().updateBackground({
	type: "pexels",
	pexelsQuery: "beach ocean landscape",
	pexelsImageId: "old",
	pexelsFrequency: "per-tab",
});
useImageStore.setState({
	getBackgroundImage: async (id: string) => `data:image/jpeg;base64,${id}`,
});
const target = document.getElementById("root");
assert.ok(target);
const root = createRoot(target);
await act(async () =>
	root.render(
		<StrictMode>
			<AppearanceProvider>
				<BackgroundLayer />
			</AppearanceProvider>
		</StrictMode>,
	),
);
const css = () =>
	document.getElementById("bg-layer")?.getAttribute("style") ?? "";
assert.ok(
	!css().includes("base64,old"),
	"startup must never paint the previous photo while rotation is pending",
);
assert.ok(
	!css().includes("/wallpapers/"),
	"startup must not flash a bundled fallback either",
);
assert.equal(refreshes, 1, "StrictMode shares one startup rotation");
await act(async () => {
	useSetupStore.getState().updateBackground({
		pexelsImageId: "new",
		pexelsPhoto: {
			id: 1,
			url: "https://www.pexels.com/photo/1",
			photographer: "Test author",
			photographerUrl: "https://www.pexels.com/@test",
			width: 6000,
			height: 4000,
		},
	});
	ready.resolve();
});
assert.ok(css().includes("base64,new"));
assert.equal(
	document.querySelectorAll(".wallpaper-outgoing").length,
	0,
	"first photo has no outgoing old image",
);
const creditClass = () =>
	document
		.querySelector('[aria-label="Photo credits"]')
		?.getAttribute("class") ?? "";
const liquidCredit = creditClass();
assert.ok(
	document
		.querySelector('[aria-label="Photo credits"]')
		?.textContent?.includes("Test author"),
);
await act(async () =>
	useSetupStore.getState().updateSettings({ appearanceMode: "classic" }),
);
assert.notEqual(
	creditClass(),
	liquidCredit,
	"the attribution changes material with the theme",
);
assert.ok(
	creditClass().includes("face-"),
	"Flat uses the shared opaque surface",
);
await act(async () => root.render(<PexelsDetailView />));
assert.ok(!document.body.textContent?.includes("Framing"));
assert.ok(!document.body.textContent?.includes("Dim wallpaper"));
assert.ok(!document.body.textContent?.includes("Photos from Pexels"));
const before = refreshes;
await act(async () => {
	const form = document.querySelector("form");
	assert.ok(form);
	form.dispatchEvent(
		new window.Event("submit", { bubbles: true, cancelable: true }),
	);
});
assert.equal(
	refreshes,
	before + 1,
	"submitting the same query retries instead of silently doing nothing",
);
await act(async () => root.unmount());
