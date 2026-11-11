import type { BackgroundSettings } from "../types";
import { cleanSurfaceCss, DEFAULT_BACKGROUND, WALLPAPERS } from "./constants";
import { cssUrl } from "./utils";

/**
 * Read-fast localStorage mirror of the wallpaper choice.
 *
 * Problem: a new tab paints the default wallpaper, then swaps to the stored
 * one once chrome.storage.local.get resolves and Zustand rehydrates
 * (the commit1→commit2 window). The mirror lets main.tsx paint frame 1
 * with the right wallpaper before React mounts.
 *
 * Contract: chrome.storage.local is the source of truth. The mirror is
 * written on the same tick as the coalesced chrome write (_doWrite) and
 * read once before createRoot().render(). If they ever diverge, storage
 * wins as soon as it resolves.
 */
export const WALLPAPER_SNAPSHOT_KEY = "wallpaper-snapshot";

export type WallpaperSnapshot =
	| { type: "bundled"; id: string }
	| { type: "custom"; id: string }
	| { type: "solid"; color: string }
	| { type: "none" };

/** Only strict hex colours may reach a <style> payload (stored data is untrusted). */
const HEX_COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/**
 * Neutral first-frame surface while a custom blob loads async from IDB.
 * Deliberately == DEFAULT_BACKGROUND.color: a plain dark surface, never
 * the default wallpaper image. A brief neutral frame is acceptable; a
 * brief wrong-wallpaper frame is the bug.
 */
export const WALLPAPER_SNAPSHOT_NEUTRAL: string = DEFAULT_BACKGROUND.color;

/** Derive the mirror value. Returns null when there is nothing worth mirroring. */
export function snapshotFromBackground(bg: unknown): WallpaperSnapshot | null {
	if (!bg || typeof bg !== "object") return null;
	const b = bg as Partial<BackgroundSettings>;
	if (b.type === "none") return { type: "none" };
	if (
		b.type === "wallpaper" &&
		typeof b.wallpaperId === "string" &&
		WALLPAPERS.some((w) => w.id === b.wallpaperId)
	) {
		return { type: "bundled", id: b.wallpaperId };
	}
	if (
		b.type === "solid" &&
		typeof b.color === "string" &&
		HEX_COLOR.test(b.color)
	) {
		return { type: "solid", color: b.color };
	}
	if (
		b.type === "image" &&
		typeof b.imageId === "string" &&
		b.imageId.length > 0
	) {
		return { type: "custom", id: b.imageId };
	}
	// gradient/pexels keep no mirror (status quo ante).
	return null;
}

/** Best-effort write. Never throws — it must not break the real persist write. */
export function writeWallpaperSnapshot(bg: unknown): void {
	try {
		if (typeof localStorage === "undefined") return;
		const snap = snapshotFromBackground(bg);
		if (snap)
			localStorage.setItem(WALLPAPER_SNAPSHOT_KEY, JSON.stringify(snap));
		else localStorage.removeItem(WALLPAPER_SNAPSHOT_KEY);
	} catch {
		// Mirror is best-effort only.
	}
}

function isSnapshot(value: unknown): value is WallpaperSnapshot {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (v.type === "bundled" || v.type === "custom") {
		return typeof v.id === "string" && v.id.length > 0;
	}
	if (v.type === "solid") {
		return typeof v.color === "string" && HEX_COLOR.test(v.color);
	}
	if (v.type === "none") return true;
	return false;
}

/** Strict read. Empty (first run) or malformed → null → default first paint. */
export function readWallpaperSnapshot(): WallpaperSnapshot | null {
	try {
		if (typeof localStorage === "undefined") return null;
		const raw = localStorage.getItem(WALLPAPER_SNAPSHOT_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return isSnapshot(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * CSS `background` value for frame 1. Custom blobs load async, so frame 1
 * is the neutral surface (never the default image). Unknown bundled id →
 * null (default path).
 */
export function snapshotToCss(snap: WallpaperSnapshot): string | null {
	if (snap.type === "none") return cleanSurfaceCss(false);
	if (snap.type === "solid") return snap.color;
	if (snap.type === "custom") return WALLPAPER_SNAPSHOT_NEUTRAL;
	if (snap.type === "bundled") {
		const w = WALLPAPERS.find((x) => x.id === snap.id);
		return w ? `${cssUrl(w.src)} center / cover no-repeat` : null;
	}
	return null;
}

/** Id of the throwaway <style> that carries frame 1 over React's inline default. */
export const WALLPAPER_PREHYDRATE_STYLE_ID = "klice-wallpaper-prehydrate";

/**
 * Paint frame 1 before React mounts. `#bg-layer` does not exist yet, and
 * React will own its inline style — so the snapshot rides a stylesheet rule
 * with `!important`, which wins over the inline default. Removed by
 * clearPrehydrateWhenLive once the runtime value lands (or by backstop).
 * Empty/malformed mirror → no-op → current default first paint.
 */
export function applyWallpaperPrehydrate(): void {
	try {
		if (typeof document === "undefined") return;
		if (document.getElementById(WALLPAPER_PREHYDRATE_STYLE_ID)) return;
		const snap = readWallpaperSnapshot();
		if (!snap) return;
		const css = snapshotToCss(snap);
		if (!css) return;
		// "none" is theme-aware: resolve the dark recipe via the OS scheme for
		// the pre-React frames (exact for colorScheme "auto", the default;
		// React owns the inline style again on first render).
		const darkRule =
			snap.type === "none"
				? `@media (prefers-color-scheme:dark){#bg-layer{background:${cleanSurfaceCss(true)} !important;}}`
				: "";
		const el = document.createElement("style");
		el.id = WALLPAPER_PREHYDRATE_STYLE_ID;
		el.textContent = `#bg-layer{background:${css} !important;}${darkRule}`;
		document.head.appendChild(el);
	} catch {
		// Fall back to the default first paint.
	}
}

export function clearWallpaperPrehydrate(): void {
	try {
		if (typeof document === "undefined") return;
		document.getElementById(WALLPAPER_PREHYDRATE_STYLE_ID)?.remove();
	} catch {
		// No-op.
	}
}

/**
 * Lift the shim exactly when `#bg-layer` carries its runtime background —
 * i.e. once storage has resolved AND BackgroundLayer applied a value that
 * differs from the first-mounted default. React only writes the style
 * attribute on change, so any mutation past the first-seen value means the
 * runtime took over (identical values need no lift: same pixels). A 5 s
 * backstop guarantees the `!important` can never stick forever (a stale
 * mirror must always yield to storage).
 */
export function clearPrehydrateWhenLive(
	hasHydrated: () => boolean,
	onHydrated: (cb: () => void) => void,
): void {
	try {
		if (typeof document === "undefined" || typeof window === "undefined") {
			clearWallpaperPrehydrate();
			return;
		}
		if (!document.getElementById(WALLPAPER_PREHYDRATE_STYLE_ID)) return;
		let settled = false;
		let firstInline: string | undefined;
		const readInline = (): string | null => {
			const el = document.getElementById("bg-layer");
			return el ? (el.getAttribute("style") ?? "") : null;
		};
		const done = () => {
			if (settled) return;
			settled = true;
			mo.disconnect();
			window.clearTimeout(backstop);
			clearWallpaperPrehydrate();
		};
		const check = () => {
			const cur = readInline();
			if (cur === null) return;
			if (firstInline === undefined) firstInline = cur;
			if (hasHydrated() && cur !== firstInline) done();
		};
		const mo = new MutationObserver(check);
		const backstop = window.setTimeout(done, 5000);
		onHydrated(check);
		check();
		mo.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["style"],
		});
	} catch {
		clearWallpaperPrehydrate();
	}
}
