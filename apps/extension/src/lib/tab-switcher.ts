import type { AccentColor } from "../types";
import { ext } from "./extension-api";
import {
	DEFAULT_TAB_SWITCHER_SHORTCUT,
	formatShortcut,
	matchShortcut,
	normalizeShortcut,
	parseShortcut,
	readTabSwitcherShortcut,
	type ShortcutCombo,
	TAB_SWITCHER_SHORTCUT_KEY,
} from "./tab-switcher-shortcut";

export interface SwitcherTab {
	id: number;
	windowId: number;
	title: string;
	url: string;
	favIconUrl?: string;
	active: boolean;
	preview?: string;
}

/**
 * Material inputs so the overlay renders the SAME Liquid Glass family as the
 * newtab toolbar. The background reads these from the persisted setup; the
 * client resolves `colorScheme: "auto"` against the live system preference.
 */
export interface SwitcherAppearance {
	colorScheme: "auto" | "light" | "dark";
	liquid: boolean;
	intensity: number;
	accent: AccentColor;
}

export interface SwitcherPayload {
	tabs: SwitcherTab[];
	activeTabId: number;
	windowId: number;
	appearance?: SwitcherAppearance;
	/** Configured hotkey, injected by the client so the overlay can toggle/cycle. */
	shortcut?: string;
}

export interface TabSwitcherSession {
	windowId: number;
	activeTabId: number;
	excludeClientTabId?: boolean;
}

export const TAB_PREVIEW_MAX_ENTRIES = 16;
export const TAB_PREVIEW_MAX_CHARS = 500_000;
export const TAB_PREVIEW_CACHE_MAX_CHARS = 4_000_000;

export function registerTabSwitcherSession(
	sessions: Map<number, TabSwitcherSession>,
	clientTabId: number,
	windowId: number,
	activeTabId: number,
	excludeClientTabId = false,
): boolean {
	if (
		![clientTabId, windowId, activeTabId].every(
			(id) => Number.isInteger(id) && id >= 0,
		)
	)
		return false;
	sessions.set(clientTabId, {
		windowId,
		activeTabId,
		...(excludeClientTabId ? { excludeClientTabId: true } : {}),
	});
	return true;
}

export function removeTabSwitcherSession(
	sessions: Map<number, TabSwitcherSession>,
	clientTabId: number,
): boolean {
	return sessions.delete(clientTabId);
}

export function cacheTabPreview(
	cache: Map<number, string>,
	tabId: number,
	preview: string,
): boolean {
	if (
		tabId < 0 ||
		!preview.startsWith("data:image/") ||
		preview.length > TAB_PREVIEW_MAX_CHARS
	) {
		return false;
	}
	cache.delete(tabId);
	cache.set(tabId, preview);
	let totalChars = [...cache.values()].reduce(
		(sum, image) => sum + image.length,
		0,
	);
	while (
		cache.size > TAB_PREVIEW_MAX_ENTRIES ||
		totalChars > TAB_PREVIEW_CACHE_MAX_CHARS
	) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		const removed = cache.get(oldest);
		cache.delete(oldest);
		totalChars -= removed?.length ?? 0;
	}
	return cache.has(tabId);
}

export function applyCachedTabPreviews(
	tabs: SwitcherTab[],
	cache: ReadonlyMap<number, string>,
): SwitcherTab[] {
	return tabs.map((tab) => ({
		...tab,
		preview: cache.get(tab.id) ?? tab.preview,
	}));
}

export function orderTabsByRecency(
	tabs: SwitcherTab[],
	recentIds: number[],
): SwitcherTab[] {
	const rank = new Map(recentIds.map((id, index) => [id, index]));
	return [...tabs].sort((a, b) => {
		const aRank = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
		const bRank = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
		return aRank - bRank || Number(b.active) - Number(a.active);
	});
}

const DEFAULT_APPEARANCE: SwitcherAppearance = {
	colorScheme: "auto",
	liquid: true,
	intensity: 60,
	accent: "blue",
};

function resolveDark(colorScheme: SwitcherAppearance["colorScheme"]): boolean {
	if (colorScheme === "dark") return true;
	if (colorScheme === "light") return false;
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches
	);
}

/**
 * Build the overlay stylesheet from the shared glass recipe.
 *
 * The band is a broad, softly masked frost — deliberately softer and blurrier
 * than the in-app surface tiers so the card row sits in a premium haze rather
 * than a panel. Each card reuses the toolbar-tier glass (clear blur + veil +
 * hairline + inset bevel) as a frame around ONLY the thumbnail; the title sits
 * outside the frame, left-aligned. No accent ring: selection reads as glass.
 *
 * Every shape is a squircle, calibrated like `KliceShape`: the larger radius
 * renders in engines with `corner-shape`, and the `@supports` fallback swaps
 * in the paired Gecko radius.
 */
function buildStyles(appearance: SwitcherAppearance): string {
	const dark = resolveDark(appearance.colorScheme);
	const liquid = appearance.liquid;
	const t = Math.min(100, Math.max(0, appearance.intensity)) / 100;
	const bandBlur = 24 + 16 * t;
	const bandSaturation = dark ? 1.08 + 0.22 * t : 1.02 + 0.06 * t;
	const bandBrightness = dark ? 0.97 - 0.06 * t : 1.02;
	const frameBlur = 1.5 + 3.5 * t;
	const frameSaturation = dark ? 1.04 + 0.28 * t : 1.01 + 0.08 * t;

	const ink = dark ? "#f4f6fb" : "#1b1d23";
	const inkMuted = dark ? "rgba(226,231,242,0.72)" : "rgba(40,44,55,0.66)";
	const hairline = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)";
	const hairlineStrong = dark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.16)";

	const toolbarVeil = dark
		? `rgba(0,0,0,${(10 + t * 8) / 100})`
		: `rgba(255,255,255,${(34 + t * 10) / 100})`;
	const hoverVeil = dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.26)";
	const followGlow = dark ? "rgba(255,255,255,0.55)" : "rgba(15,23,42,0.30)";
	const bandVeil = dark
		? `rgba(10,12,18,${(15 + t * 9) / 100})`
		: `rgba(255,255,255,${(28 + t * 12) / 100})`;
	const bevel = dark
		? "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -10px 22px -10px rgba(180,210,255,0.12), inset 0.5px 0 0 rgba(255,255,255,0.075), inset -0.5px 0 0 rgba(255,255,255,0.06)"
		: "inset 0 1px 0 rgba(0,0,0,0.08), inset 0 -10px 22px -10px rgba(60,90,140,0.08), inset 0.5px 0 0 rgba(0,0,0,0.045), inset -0.5px 0 0 rgba(0,0,0,0.035)";
	const previewFallback = dark
		? "linear-gradient(150deg,#333c50,#232a38)"
		: "linear-gradient(150deg,#e9edf5,#d7dce8)";

	const bandFilter = liquid
		? `backdrop-filter:blur(${bandBlur}px) saturate(${bandSaturation}) brightness(${bandBrightness});-webkit-backdrop-filter:blur(${bandBlur}px) saturate(${bandSaturation}) brightness(${bandBrightness});`
		: "";
	const bandBackground = liquid
		? bandVeil
		: dark
			? "rgba(24,26,32,0.94)"
			: "rgba(248,249,252,0.95)";
	const frameFilter = liquid
		? `backdrop-filter:blur(${frameBlur}px) saturate(${frameSaturation});-webkit-backdrop-filter:blur(${frameBlur}px) saturate(${frameSaturation});`
		: "";
	const selectedBackground = liquid
		? toolbarVeil
		: dark
			? "rgba(40,44,54,0.96)"
			: "rgba(255,255,255,0.98)";

	return `
:host{all:initial;color-scheme:${dark ? "dark" : "light"};font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
.klice-switcher{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:8vh 32px}
.stage{position:relative;display:flex;width:100%;max-width:min(1200px,100%);max-height:100%}
.band{position:absolute;inset:-136px calc(50% - 50vw);background:${bandBackground};${bandFilter}pointer-events:none;-webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 24%,#000 76%,transparent 100%),linear-gradient(to right,transparent 0%,#000 8%,#000 92%,transparent 100%);-webkit-mask-composite:source-in;mask-image:linear-gradient(to bottom,transparent 0%,#000 24%,#000 76%,transparent 100%),linear-gradient(to right,transparent 0%,#000 8%,#000 92%,transparent 100%);mask-composite:intersect}
.grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(216px,1fr));align-content:center;gap:16px;width:100%;max-height:min(74vh,760px);overflow-y:auto;overflow-x:hidden;padding:10px 8px;scrollbar-width:thin;scrollbar-color:${dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.24)"} transparent}
.grid::-webkit-scrollbar{width:8px}
.grid::-webkit-scrollbar-thumb{border-radius:99px;background:${dark ? "rgba(255,255,255,0.24)" : "rgba(0,0,0,0.22)"}}
.grid::-webkit-scrollbar-thumb:hover{background:${dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.34)"}}
.card{position:relative;display:flex;flex-direction:column;padding:0;border:0;background:none;color:${ink};text-align:left;cursor:pointer;animation:ks-card .24s cubic-bezier(.16,1,.3,1) backwards}
.frame{position:relative;display:block;padding:8px;border:0.5px solid transparent;border-radius:22px;corner-shape:squircle;background:transparent;transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease}
.frame::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:radial-gradient(120px circle at var(--mx,50%) var(--my,50%),${followGlow},transparent 65%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;opacity:0;transition:opacity .18s cubic-bezier(.16,1,.3,1);pointer-events:none}
.card:hover .frame{background:${hoverVeil};border-color:${hairline}}
.card:hover .frame::before{opacity:1}
.card[aria-selected=true] .frame{background:${selectedBackground};border-color:${hairlineStrong};${frameFilter}box-shadow:${bevel},0 22px 48px -28px rgba(0,0,0,0.6)}
.preview{position:relative;aspect-ratio:16/10;display:grid;place-items:center;overflow:hidden;border-radius:14px;corner-shape:squircle;background:${previewFallback};box-shadow:inset 0 0 0 1px ${dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}}
.preview img{width:100%;height:100%;object-fit:cover}
.preview .fallback{font-size:30px;font-weight:650;color:${inkMuted}}
.close{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:11px;corner-shape:squircle;background:transparent;color:${dark ? "rgba(255,255,255,0.88)" : "rgba(15,18,26,0.62)"};opacity:0;transition:opacity .15s ease,background-color .15s ease,color .15s ease;cursor:pointer}
.card:hover .close,.close:focus-visible{opacity:1}
.close:hover{background:rgba(235,60,60,0.16);color:#ff5f57}
.close:focus-visible{outline:1px solid ${hairlineStrong};outline-offset:2px}
.close svg{display:block;filter:drop-shadow(0 1px 1.5px ${dark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.6)"})}
.caption{display:flex;align-items:center;gap:6px;min-width:0;padding:9px 6px 0;text-align:left}
.favicon{width:14px;height:14px;flex:none;object-fit:contain;border-radius:4px;corner-shape:squircle}
.tabtitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:550;letter-spacing:-.01em;color:${ink};opacity:.9}
.card[aria-selected=true] .tabtitle{opacity:1}
.empty{padding:40px 28px;text-align:center;font-size:13px;color:${inkMuted}}
.card:focus-visible{outline:none}
@supports not (corner-shape:squircle){.frame{border-radius:13px}.preview{border-radius:9px}.close{border-radius:8px}}
@keyframes ks-card{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(max-width:640px){.klice-switcher{padding:5vh 14px}.band{inset:-72px calc(50% - 50vw)}.grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.frame{padding:6px;border-radius:18px}.preview{border-radius:11px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;
}

/**
 * Mount the switcher overlay. Clean by design: only the card grid over a
 * masked blur band — no header, count, or help footer.
 *
 * Keyboard model (default Alt+Q):
 *   • the full combo toggles the overlay closed (it opened it);
 *   • arrows / Tab move, Enter switches, Esc / outside-click dismiss;
 *   • hovering a card highlights it, and each card carries a close control
 *     in its top-right corner.
 *
 * The overlay also closes itself the moment its tab is hidden or the window
 * loses focus, so switching page can never leave a stale overlay behind.
 */
export function mountTabSwitcher(
	payload: SwitcherPayload,
	onActivate: (tabId: number, windowId: number) => void,
	onDismiss: () => void = () => {},
	onClose: (tabId: number, windowId: number) => void = () => {},
): () => void {
	document.getElementById("klice-tab-switcher")?.remove();
	const appearance = payload.appearance ?? DEFAULT_APPEARANCE;
	const combo: ShortcutCombo =
		parseShortcut(payload.shortcut ?? DEFAULT_TAB_SWITCHER_SHORTCUT) ??
		(parseShortcut(DEFAULT_TAB_SWITCHER_SHORTCUT) as ShortcutCombo);

	const host = document.createElement("div");
	host.id = "klice-tab-switcher";
	const shadow = host.attachShadow({ mode: "closed" });
	const style = document.createElement("style");
	style.textContent = buildStyles(appearance);

	const scrim = document.createElement("div");
	scrim.className = "klice-switcher";
	scrim.setAttribute("role", "presentation");
	const stage = document.createElement("div");
	stage.className = "stage";
	const band = document.createElement("div");
	band.className = "band";
	band.setAttribute("aria-hidden", "true");
	const grid = document.createElement("div");
	grid.className = "grid";
	grid.setAttribute("role", "listbox");
	grid.setAttribute("aria-label", "Open tabs");
	grid.setAttribute("aria-orientation", "horizontal");

	let selected = Math.max(
		0,
		payload.tabs.findIndex((tab) => tab.id !== payload.activeTabId),
	);
	const cards: HTMLDivElement[] = [];
	let cleanup = () => {};

	const activate = (index: number) => {
		const tab = payload.tabs[index];
		if (!tab) return;
		cleanup();
		onActivate(tab.id, tab.windowId);
	};

	const closeTab = (index: number) => {
		const tab = payload.tabs[index];
		if (!tab) return;
		payload.tabs.splice(index, 1);
		cards.splice(index, 1)[0]?.remove();
		if (payload.tabs.length) {
			updateSelection(Math.min(index, payload.tabs.length - 1));
		} else {
			cleanup();
		}
		onClose(tab.id, tab.windowId);
	};

	for (const [index, tab] of payload.tabs.entries()) {
		const card = document.createElement("div");
		card.className = "card";
		card.setAttribute("role", "option");
		card.setAttribute("aria-selected", String(index === selected));
		card.setAttribute("aria-label", tab.title || tab.url || "Untitled tab");
		card.tabIndex = -1;
		card.style.animationDelay = `${Math.min(index * 22, 180)}ms`;

		const frame = document.createElement("div");
		frame.className = "frame";
		const preview = document.createElement("div");
		preview.className = "preview";
		if (tab.preview) {
			const img = document.createElement("img");
			img.src = tab.preview;
			img.alt = "";
			img.loading = "lazy";
			preview.append(img);
		} else {
			const fallback = document.createElement("span");
			fallback.className = "fallback";
			fallback.textContent =
				(tab.title || tab.url || "?").trim().charAt(0).toUpperCase() || "?";
			preview.append(fallback);
		}

		const close = document.createElement("button");
		close.type = "button";
		close.className = "close";
		close.setAttribute("aria-label", "Close tab");
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 12 12");
		svg.setAttribute("width", "12");
		svg.setAttribute("height", "12");
		svg.setAttribute("fill", "none");
		svg.setAttribute("stroke", "currentColor");
		svg.setAttribute("stroke-width", "1.6");
		svg.setAttribute("stroke-linecap", "round");
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", "M3 3l6 6M9 3l-6 6");
		svg.append(path);
		close.append(svg);
		close.addEventListener("click", (event) => {
			event.stopPropagation();
			closeTab(payload.tabs.indexOf(tab));
		});
		preview.append(close);
		frame.append(preview);

		const caption = document.createElement("div");
		caption.className = "caption";
		if (tab.favIconUrl) {
			const icon = document.createElement("img");
			icon.className = "favicon";
			icon.src = tab.favIconUrl;
			icon.alt = "";
			icon.loading = "lazy";
			caption.append(icon);
		}
		const title = document.createElement("span");
		title.className = "tabtitle";
		title.textContent = tab.title || tab.url || "Untitled tab";
		caption.append(title);

		card.append(frame, caption);
		card.addEventListener("click", (event) => {
			event.stopPropagation();
			const live = payload.tabs.indexOf(tab);
			if (live !== -1) activate(live);
		});
		card.addEventListener("mousemove", (event) => {
			const live = payload.tabs.indexOf(tab);
			if (live !== -1 && live !== selected) updateSelection(live);
			const rect = frame.getBoundingClientRect();
			frame.style.setProperty("--mx", `${event.clientX - rect.left}px`);
			frame.style.setProperty("--my", `${event.clientY - rect.top}px`);
		});
		cards.push(card);
		grid.append(card);
	}

	if (!payload.tabs.length) {
		const empty = document.createElement("div");
		empty.className = "empty";
		empty.textContent = "No open tabs found.";
		grid.append(empty);
	}

	stage.append(band, grid);
	scrim.append(stage);
	shadow.append(style, scrim);
	document.documentElement.append(host);

	const updateSelection = (next: number) => {
		if (!cards.length) return;
		selected = (next + cards.length) % cards.length;
		cards.forEach((card, index) => {
			card.setAttribute("aria-selected", String(index === selected));
		});
		cards[selected].focus({ preventScroll: true });
		cards[selected].scrollIntoView({ block: "nearest", inline: "nearest" });
	};

	const keydown = (event: KeyboardEvent) => {
		if (matchShortcut(event, combo)) {
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat) cleanup();
			return;
		}
		switch (event.key) {
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				cleanup();
				break;
			case "ArrowRight":
			case "ArrowDown":
				event.preventDefault();
				updateSelection(selected + 1);
				break;
			case "ArrowLeft":
			case "ArrowUp":
				event.preventDefault();
				updateSelection(selected - 1);
				break;
			case "Tab":
				event.preventDefault();
				updateSelection(selected + (event.shiftKey ? -1 : 1));
				break;
			case "Enter":
				if (cards.length) {
					event.preventDefault();
					event.stopPropagation();
					activate(selected);
				}
				break;
		}
	};

	const onScrimClick = (event: MouseEvent) => {
		if ((event.target as HTMLElement).closest(".card")) return;
		cleanup();
	};

	const onVisibilityChange = () => {
		if (document.visibilityState === "hidden") cleanup();
	};

	const onWindowBlur = () => cleanup();

	let cleanedUp = false;
	cleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		document.removeEventListener("keydown", keydown, true);
		document.removeEventListener("visibilitychange", onVisibilityChange);
		window.removeEventListener("blur", onWindowBlur);
		scrim.removeEventListener("click", onScrimClick);
		host.remove();
		onDismiss();
	};
	document.addEventListener("keydown", keydown, true);
	document.addEventListener("visibilitychange", onVisibilityChange);
	window.addEventListener("blur", onWindowBlur);
	scrim.addEventListener("click", onScrimClick);
	cards[selected]?.focus({ preventScroll: true });
	return cleanup;
}

/**
 * Install the extension-owned hotkey. Shared by the content script (web pages)
 * and the newtab page (extension context) — both have a `sender.tab`, so the
 * background can build the payload from the requesting tab.
 *
 * The combo is read from storage and kept live via storage.onChanged, so a
 * remap in Settings takes effect without reloading the page. Returns a teardown
 * for hosts that unmount (the newtab React tree).
 */
export function installTabSwitcherHotkey(): () => void {
	let combo: ShortcutCombo = parseShortcut(DEFAULT_TAB_SWITCHER_SHORTCUT) ?? {
		alt: true,
		ctrl: false,
		shift: false,
		meta: false,
		key: "Q",
	};
	let currentCleanup: (() => void) | null = null;
	let requesting = false;
	let suppressClosed = false;

	void readTabSwitcherShortcut().then((value) => {
		combo = parseShortcut(value) ?? combo;
	});

	const onChanged = (
		changes: Record<string, { newValue?: unknown }>,
		area: string,
	) => {
		if (area !== "local" || !(TAB_SWITCHER_SHORTCUT_KEY in changes)) return;
		combo =
			parseShortcut(
				normalizeShortcut(changes[TAB_SWITCHER_SHORTCUT_KEY].newValue),
			) ?? combo;
	};
	ext.storage.onChanged.addListener(onChanged);

	const dismiss = () => {
		currentCleanup = null;
		if (!suppressClosed) {
			void ext.runtime.sendMessage({ type: "tab-switcher:closed" });
		}
	};

	const activateTab = (tabId: number, windowId: number) => {
		void ext.runtime.sendMessage({
			type: "tab-switcher:activate",
			tabId,
			windowId,
		});
	};

	const closeTab = (tabId: number, windowId: number) => {
		void ext.runtime.sendMessage({
			type: "tab-switcher:close",
			tabId,
			windowId,
		});
	};

	const mount = (payload: SwitcherPayload) => {
		payload.shortcut = formatShortcut(combo);
		currentCleanup = mountTabSwitcher(payload, activateTab, dismiss, closeTab);
	};

	const open = async () => {
		if (requesting || currentCleanup) return;
		requesting = true;
		try {
			const response = (await ext.runtime.sendMessage({
				type: "tab-switcher:request",
			})) as { payload?: SwitcherPayload } | undefined;
			if (!response?.payload) return;
			mount(response.payload);
			void ext.runtime.sendMessage({
				type: "tab-switcher:opened",
				windowId: response.payload.windowId,
				activeTabId: response.payload.activeTabId,
			});
		} catch {
			/* The worker may be unavailable; the hotkey simply does nothing. */
		} finally {
			requesting = false;
		}
	};

	const keydown = (event: KeyboardEvent) => {
		if (currentCleanup || event.repeat) return;
		if (matchShortcut(event, combo)) {
			event.preventDefault();
			event.stopPropagation();
			void open();
		}
	};
	document.addEventListener("keydown", keydown, true);

	const onMessage = (message: unknown) => {
		const update = message as {
			type?: string;
			payload?: SwitcherPayload;
		} | null;
		if (
			update?.type !== "tab-switcher:update" ||
			!update.payload ||
			!currentCleanup
		)
			return;
		suppressClosed = true;
		currentCleanup();
		suppressClosed = false;
		mount(update.payload);
	};
	ext.runtime.onMessage.addListener(onMessage);

	return () => {
		document.removeEventListener("keydown", keydown, true);
		ext.storage.onChanged.removeListener(onChanged);
		ext.runtime.onMessage.removeListener(onMessage);
		currentCleanup?.();
		currentCleanup = null;
	};
}

/** Content-script entry: own the hotkey and render the overlay in the page. */
export function installTabSwitcherReceiver(): void {
	installTabSwitcherHotkey();
}
