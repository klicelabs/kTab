import { SPRING_LAYOUT } from "@ktab/ui/lib/ease";
import { animate } from "motion";
import type { AccentColor } from "../types";
import { ext } from "./extension-api";
import {
	DEFAULT_TAB_SWITCHER_FIRST_PRESS,
	DEFAULT_TAB_SWITCHER_TITLE_SOURCE,
	normalizeTabSwitcherFirstPress,
	normalizeTabSwitcherTitleSource,
	readTabSwitcherFirstPress,
	readTabSwitcherTitleSource,
	resolveSwitcherTitle,
	type SwitcherFirstPress,
	type SwitcherTitleSource,
	TAB_SWITCHER_FIRST_PRESS_KEY,
	TAB_SWITCHER_TITLE_SOURCE_KEY,
} from "./tab-switcher-settings";
import {
	comboModifierKeys,
	DEFAULT_TAB_SWITCHER_SHORTCUT,
	formatShortcut,
	isComboModifierRelease,
	MODIFIER_EVENT_KEYS,
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
 * newtab toolbar. The background reads these from the persisted setup. The
 * overlay always renders the DARK material system in every theme — the light
 * frost read washed-out on wallpapers — while the selection container always
 * wears its milky light variant. `colorScheme` stays part of the payload
 * contract for the day a per-theme switch is wanted again.
 */ export interface SwitcherAppearance {
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
	/** Caption title source, injected by the client like `shortcut`. */
	titleSource?: SwitcherTitleSource;
	/** First-press behavior, injected by the client like `shortcut`. */
	firstPress?: SwitcherFirstPress;
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

/**
 * Opening selection. "stay" lands on the CURRENT tab (release = no-op);
 * "next" lands one card ahead of it — the payload is recency-ordered, so that
 * is the most recently used other tab, Alt+Tab style. Falls back to the first
 * card when the active tab is not part of the payload.
 */
export function initialSwitcherSelection(
	tabs: SwitcherTab[],
	activeTabId: number,
	firstPress: SwitcherFirstPress,
): number {
	const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
	if (activeIndex === -1) return 0;
	if (firstPress === "next" && tabs.length > 1) {
		return (activeIndex + 1) % tabs.length;
	}
	return activeIndex;
}

const DEFAULT_APPEARANCE: SwitcherAppearance = {
	colorScheme: "auto",
	liquid: true,
	intensity: 60,
	accent: "blue",
};

/**
 * Build the overlay stylesheet from the shared glass recipe.
 *
 * The band is a broad, softly masked frost — deliberately softer and blurrier
 * than the in-app surface tiers so the card row sits in a premium haze rather
 * than a panel. Each card keeps a transparent frame around ONLY the thumbnail
 * (title outside, left-aligned); selection is a single toolbar-tier glass
 * container (`.highlight`) that glides between frames like a segmented
 * control, driven by motion's vanilla `animate` with SPRING_LAYOUT.
 *
 * Every shape is a squircle, calibrated like `KtabShape`: the larger radius
 * renders in engines with `corner-shape`, and the `@supports` fallback swaps
 * in the paired Gecko radius.
 */
const FROST_EASE_STEPS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const smoothstep = (t: number) => 3 * t * t - 2 * t * t * t;

/**
 * Vertical mask dissolving the frost over an eased `span` ramp from each edge.
 * A two-stop gradient reads as a visible boundary because blur-vs-sharp is
 * perceptually non-linear; the smoothstep ramp approaches zero alpha
 * asymptotically so the band has no perceptible edge. Bottom stops are
 * generated edge-first, so they are reversed to keep positions non-decreasing
 * — out-of-order stops get clamped and silently flatten the ramp.
 */
function bandFrostMask(span: number): string {
	const top = FROST_EASE_STEPS.map(
		(u) => `rgba(0,0,0,${smoothstep(u).toFixed(3)}) ${(u * span).toFixed(1)}%`,
	);
	const bottom = FROST_EASE_STEPS.map(
		(u) =>
			`rgba(0,0,0,${smoothstep(u).toFixed(3)}) ${(100 - u * span).toFixed(1)}%`,
	).reverse();
	return `linear-gradient(to bottom, ${[...top, ...bottom].join(",")})`;
}

function buildStyles(appearance: SwitcherAppearance): string {
	const liquid = appearance.liquid;
	const t = Math.min(100, Math.max(0, appearance.intensity)) / 100;
	const bandBlur = 20 + 12 * t;
	// The whole overlay renders the DARK material system in every theme: the
	// near-neutral light frost read washed-out on wallpapers, while the dark
	// one keeps the chromatic bleed that makes the haze feel alive. Ink, veils
	// and fallbacks below are the dark palette; only the selection container
	// keeps its own milky light material.
	const bandSaturation = 1.08 + 0.22 * t;
	const bandBrightness = 0.97 - 0.06 * t;
	const frameBlur = 1.5 + 3.5 * t;
	// The selection container wears the LIGHT toolbar recipe: the smoked dark
	// veil read too transparent around a thumbnail, while the milky veil gives
	// the selection a solid, readable body.
	const frameSaturation = 1.01 + 0.08 * t;
	const frameBrightness = 1.02 + 0.01 * t;

	const ink = "#f4f6fb";
	const inkMuted = "rgba(226,231,242,0.72)";
	const hairlineStrong = "rgba(255,255,255,0.20)";
	// The highlight wears the toolbar tier's hairline in its light form
	// (black/10) — part of the milky container material.
	const highlightHairline = "rgba(0,0,0,0.10)";

	const bandVeil = `rgba(10,12,18,${(15 + t * 9) / 100})`;
	// Bevel belongs to the container's light material.
	const bevel =
		"inset 0 1px 0 rgba(0,0,0,0.08), inset 0 -10px 22px -10px rgba(60,90,140,0.08), inset 0.5px 0 0 rgba(0,0,0,0.045), inset -0.5px 0 0 rgba(0,0,0,0.035)";
	const previewFallback = "linear-gradient(150deg,#333c50,#232a38)";

	const bandFilter = liquid
		? `backdrop-filter:blur(${bandBlur}px) saturate(${bandSaturation}) brightness(${bandBrightness});-webkit-backdrop-filter:blur(${bandBlur}px) saturate(${bandSaturation}) brightness(${bandBrightness});`
		: "";
	const bandBackground = liquid ? bandVeil : "rgba(24,26,32,0.94)";
	const frameFilter = liquid
		? `backdrop-filter:blur(${frameBlur}px) saturate(${frameSaturation}) brightness(${frameBrightness});-webkit-backdrop-filter:blur(${frameBlur}px) saturate(${frameSaturation}) brightness(${frameBrightness});`
		: "";
	// ~340px dissolve at typical band heights; the ramp lives inside the band's
	// negative inset so full frost strength arrives at or before the cards, and
	// the shorter inset keeps the haze from reaching too far above and below.
	const bandMask = bandFrostMask(26);
	const bandMaskCompact = bandFrostMask(24);
	const selectedBackground = liquid
		? // Milky light toolbar veil — see frameSaturation.
			`rgba(255,255,255,${(34 + t * 10) / 100})`
		: "rgba(40,44,54,0.96)";

	return `
:host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
.ktab-switcher{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:8vh 32px;overflow:hidden}
.stage{position:relative;display:flex;width:100%;max-width:min(1200px,100%);max-height:100%}
.band{position:absolute;inset:-300px calc(50% - 50vw);background:${bandBackground};${bandFilter}pointer-events:none;-webkit-mask-image:${bandMask};mask-image:${bandMask}}
.grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(216px,1fr));align-content:center;gap:16px;width:100%;max-height:min(74vh,760px);overflow-y:auto;overflow-x:hidden;padding:10px 8px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.28) transparent}
.grid::-webkit-scrollbar{width:8px}
.grid::-webkit-scrollbar-thumb{border-radius:99px;background:rgba(255,255,255,0.24)}
.grid::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.4)}
.card{position:relative;display:flex;flex-direction:column;padding:0;border:0;background:none;color:${ink};text-align:left;animation:ks-card .24s cubic-bezier(.16,1,.3,1) backwards}
.frame{position:relative;display:block;padding:8px;border:0.5px solid transparent;border-radius:26px;corner-shape:squircle;background:transparent}
.highlight{position:absolute;left:0;top:0;border:0.5px solid ${highlightHairline};border-radius:26px;corner-shape:squircle;background:${selectedBackground};${frameFilter}box-shadow:${bevel},0 22px 48px -28px rgba(0,0,0,0.6);pointer-events:none;opacity:0;transition:opacity .18s cubic-bezier(.16,1,.3,1)}
.highlight.on{opacity:1}
.preview{position:relative;aspect-ratio:16/10;display:grid;place-items:center;overflow:hidden;border-radius:18px;corner-shape:squircle;background:${previewFallback};box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06)}
.preview img{width:100%;height:100%;object-fit:cover}
.preview .fallback{font-size:30px;font-weight:650;color:${inkMuted}}
.close{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:11px;corner-shape:squircle;background:transparent;color:rgba(255,255,255,0.88);opacity:0;transition:opacity .15s ease,background-color .15s ease,color .15s ease}
.card:hover .close,.close:focus-visible{opacity:1}
.close:hover{background:rgba(235,60,60,0.16);color:#ff5f57}
.close:focus-visible{outline:1px solid ${hairlineStrong};outline-offset:2px}
.close svg{display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.5))}
.caption{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 8px 0;text-align:left}
.favicon{width:14px;height:14px;flex:none;object-fit:contain;border-radius:4px;corner-shape:squircle}
.tabtitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:550;letter-spacing:-.01em;color:${ink};opacity:.9}
.card[aria-selected=true] .tabtitle{opacity:1}
.empty{padding:40px 28px;text-align:center;font-size:13px;color:${inkMuted}}
.card:focus-visible{outline:none}
@supports not (corner-shape:squircle){.frame{border-radius:15px}.preview{border-radius:11px}.close{border-radius:8px}.highlight{border-radius:15px}}
@keyframes ks-card{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(max-width:640px){.ktab-switcher{padding:5vh 14px}.band{inset:-150px calc(50% - 50vw);-webkit-mask-image:${bandMaskCompact};mask-image:${bandMaskCompact}}.grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.frame{padding:6px;border-radius:21px}.preview{border-radius:15px}.highlight{border-radius:21px}.caption{padding:4px 6px 0}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;
}

/**
 * Mount the switcher overlay. Clean by design: only the card grid over a
 * masked blur band — no header, count, or help footer.
 *
 * Keyboard model (default Alt+Q), Alt+Tab style:
 *   • with the default "stay" first press, the full combo opens the overlay
 *     with the CURRENT tab highlighted — releasing a modifier right away
 *     commits the current tab (a no-op stay);
 *   • with the "next" first press, the opening press already selects the next
 *     most recent tab, so a quick tap switches right away;
 *   • pressing the combo again cycles to the next card; releasing a combo
 *     modifier commits the highlighted card — the `activateOnMount` flag
 *     covers a fast tap whose modifiers went up before the payload arrived;
 *   • arrows / Tab move, Enter switches, Esc / outside-click dismiss without
 *     switching;
 *   • each card carries a close control in its top-right corner.
 *
 * The overlay also closes itself the moment its tab is hidden or the window
 * loses focus, so switching page can never leave a stale overlay behind.
 */
export function mountTabSwitcher(
	payload: SwitcherPayload,
	onActivate: (tabId: number, windowId: number) => void,
	onDismiss: () => void = () => {},
	onClose: (tabId: number, windowId: number) => void = () => {},
	activateOnMount = false,
): () => void {
	document.getElementById("ktab-tab-switcher")?.remove();
	const appearance = payload.appearance ?? DEFAULT_APPEARANCE;
	const titleSource = payload.titleSource ?? DEFAULT_TAB_SWITCHER_TITLE_SOURCE;
	const combo: ShortcutCombo =
		parseShortcut(payload.shortcut ?? DEFAULT_TAB_SWITCHER_SHORTCUT) ??
		(parseShortcut(DEFAULT_TAB_SWITCHER_SHORTCUT) as ShortcutCombo);

	const host = document.createElement("div");
	host.id = "ktab-tab-switcher";
	const shadow = host.attachShadow({ mode: "closed" });
	const style = document.createElement("style");
	style.textContent = buildStyles(appearance);

	const scrim = document.createElement("div");
	scrim.className = "ktab-switcher";
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
	const highlight = document.createElement("div");
	highlight.className = "highlight";
	highlight.setAttribute("aria-hidden", "true");
	grid.append(highlight);

	// "stay" opens on the CURRENT tab (release = stay); "next" already jumps to
	// the next most recent tab, Alt+Tab style. Either way, further combo
	// presses cycle and releasing the modifier commits the highlighted card.
	let selected = initialSwitcherSelection(
		payload.tabs,
		payload.activeTabId,
		payload.firstPress ?? DEFAULT_TAB_SWITCHER_FIRST_PRESS,
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
		card.setAttribute("aria-label", resolveSwitcherTitle(tab, titleSource));
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
		title.textContent = resolveSwitcherTitle(tab, titleSource);
		caption.append(title);

		card.append(frame, caption);
		card.addEventListener("click", (event) => {
			event.stopPropagation();
			const live = payload.tabs.indexOf(tab);
			if (live !== -1) activate(live);
		});
		card.addEventListener("mousemove", () => {
			const live = payload.tabs.indexOf(tab);
			if (live !== -1 && live !== selected) updateSelection(live);
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

	// Segmented-control highlight: one glass container glides between the
	// cards' frames, following hover and keyboard selection.
	let highlightAnimation: { stop: () => void } | null = null;
	let highlightShown = false;
	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;

	const moveHighlight = (glide: boolean) => {
		const card = cards[selected];
		const frame = card?.firstElementChild as HTMLElement | undefined;
		if (!card || !frame) {
			highlightShown = false;
			highlight.classList.remove("on");
			return;
		}
		highlight.style.width = `${frame.offsetWidth}px`;
		highlight.style.height = `${frame.offsetHeight}px`;
		const x = card.offsetLeft + frame.offsetLeft;
		const y = card.offsetTop + frame.offsetTop;
		highlightAnimation?.stop();
		if (glide && !reduceMotion) {
			highlightAnimation = animate(highlight, { x, y }, SPRING_LAYOUT);
		} else {
			highlight.style.transform = `translate(${x}px, ${y}px)`;
		}
		if (!highlightShown) {
			highlightShown = true;
			highlight.classList.add("on");
		}
	};

	const updateSelection = (next: number) => {
		if (!cards.length) return;
		selected = (next + cards.length) % cards.length;
		cards.forEach((card, index) => {
			card.setAttribute("aria-selected", String(index === selected));
		});
		cards[selected].focus({ preventScroll: true });
		cards[selected].scrollIntoView({ block: "nearest", inline: "nearest" });
		moveHighlight(true);
	};

	const keydown = (event: KeyboardEvent) => {
		if (matchShortcut(event, combo)) {
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat) updateSelection(selected + 1);
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

	// Releasing a combo modifier commits the highlighted card, the way Alt+Tab
	// switches the moment Alt goes up.
	const keyup = (event: KeyboardEvent) => {
		if (isComboModifierRelease(event.key, combo)) activate(selected);
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
		highlightAnimation?.stop();
		document.removeEventListener("keydown", keydown, true);
		document.removeEventListener("keyup", keyup, true);
		document.removeEventListener("visibilitychange", onVisibilityChange);
		window.removeEventListener("blur", onWindowBlur);
		scrim.removeEventListener("click", onScrimClick);
		host.remove();
		onDismiss();
	};
	document.addEventListener("keydown", keydown, true);
	document.addEventListener("keyup", keyup, true);
	document.addEventListener("visibilitychange", onVisibilityChange);
	window.addEventListener("blur", onWindowBlur);
	scrim.addEventListener("click", onScrimClick);
	cards[selected]?.focus({ preventScroll: true });
	moveHighlight(false);
	if (activateOnMount && cards.length) activate(selected);
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
	// Modifier keys currently physically held, needed to detect a fast tap
	// whose modifiers were released while the payload was still in flight.
	const heldModifiers = new Set<string>();

	let titleSource: SwitcherTitleSource = DEFAULT_TAB_SWITCHER_TITLE_SOURCE;
	let firstPress: SwitcherFirstPress = DEFAULT_TAB_SWITCHER_FIRST_PRESS;

	void readTabSwitcherShortcut().then((value) => {
		combo = parseShortcut(value) ?? combo;
	});
	void readTabSwitcherTitleSource().then((value) => {
		titleSource = value;
	});
	void readTabSwitcherFirstPress().then((value) => {
		firstPress = value;
	});

	const onChanged = (
		changes: Record<string, { newValue?: unknown }>,
		area: string,
	) => {
		if (area !== "local") return;
		if (TAB_SWITCHER_SHORTCUT_KEY in changes) {
			combo =
				parseShortcut(
					normalizeShortcut(changes[TAB_SWITCHER_SHORTCUT_KEY].newValue),
				) ?? combo;
		}
		if (TAB_SWITCHER_TITLE_SOURCE_KEY in changes) {
			titleSource = normalizeTabSwitcherTitleSource(
				changes[TAB_SWITCHER_TITLE_SOURCE_KEY].newValue,
			);
		}
		if (TAB_SWITCHER_FIRST_PRESS_KEY in changes) {
			firstPress = normalizeTabSwitcherFirstPress(
				changes[TAB_SWITCHER_FIRST_PRESS_KEY].newValue,
			);
		}
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
		payload.titleSource = titleSource;
		payload.firstPress = firstPress;
		const modifiersHeld = comboModifierKeys(combo).some((key) =>
			heldModifiers.has(key),
		);
		currentCleanup = mountTabSwitcher(
			payload,
			activateTab,
			dismiss,
			closeTab,
			!modifiersHeld,
		);
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
			// A mount-time commit (fast tap) already closed the overlay; only
			// register the session when it is actually on screen.
			if (currentCleanup) {
				void ext.runtime.sendMessage({
					type: "tab-switcher:opened",
					windowId: response.payload.windowId,
					activeTabId: response.payload.activeTabId,
				});
			}
		} catch {
			/* The worker may be unavailable; the hotkey simply does nothing. */
		} finally {
			requesting = false;
		}
	};

	const keydown = (event: KeyboardEvent) => {
		if (event.key in MODIFIER_EVENT_KEYS) heldModifiers.add(event.key);
		if (currentCleanup || event.repeat) return;
		if (matchShortcut(event, combo)) {
			event.preventDefault();
			event.stopPropagation();
			void open();
		}
	};
	const keyup = (event: KeyboardEvent) => {
		if (event.key in MODIFIER_EVENT_KEYS) heldModifiers.delete(event.key);
	};
	document.addEventListener("keydown", keydown, true);
	document.addEventListener("keyup", keyup, true);

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
		document.removeEventListener("keyup", keyup, true);
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
