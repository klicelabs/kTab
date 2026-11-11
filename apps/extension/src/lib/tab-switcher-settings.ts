import { ext } from "./extension-api";
import { deriveIconLabel } from "./url";

/**
 * Tab switcher user preferences that live under their own local storage keys,
 * independent of the setup envelope — the same contract as the hotkey. Each
 * choice is injected into the payload by the client so the overlay can honor
 * it at render time, and picked up live through storage.onChanged.
 */

/** What the switcher captions show — mirrors the bookmark cards' setting. */
export type SwitcherTitleSource = "title" | "site";

export const TAB_SWITCHER_TITLE_SOURCE_KEY = "ktab-tab-switcher-title-source";
export const DEFAULT_TAB_SWITCHER_TITLE_SOURCE: SwitcherTitleSource = "title";

export function normalizeTabSwitcherTitleSource(
	value: unknown,
): SwitcherTitleSource {
	return value === "site" ? "site" : DEFAULT_TAB_SWITCHER_TITLE_SOURCE;
}

export async function readTabSwitcherTitleSource(): Promise<SwitcherTitleSource> {
	try {
		const data = await ext.storage.local.get(TAB_SWITCHER_TITLE_SOURCE_KEY);
		return normalizeTabSwitcherTitleSource(data[TAB_SWITCHER_TITLE_SOURCE_KEY]);
	} catch {
		return DEFAULT_TAB_SWITCHER_TITLE_SOURCE;
	}
}

export async function writeTabSwitcherTitleSource(
	value: SwitcherTitleSource,
): Promise<void> {
	await ext.storage.local.set({
		[TAB_SWITCHER_TITLE_SOURCE_KEY]: normalizeTabSwitcherTitleSource(value),
	});
}

/**
 * What the FIRST shortcut press does, Alt+Tab style:
 *   • "stay" (default) — opens the overlay on the CURRENT tab; only further
 *     combo presses cycle, and releasing right away is a no-op stay;
 *   • "next" — the opening press already jumps to the next most recent tab;
 *     a quick tap therefore switches right away.
 */
export type SwitcherFirstPress = "stay" | "next";

export const TAB_SWITCHER_FIRST_PRESS_KEY = "ktab-tab-switcher-first-press";
export const DEFAULT_TAB_SWITCHER_FIRST_PRESS: SwitcherFirstPress = "stay";

export function normalizeTabSwitcherFirstPress(
	value: unknown,
): SwitcherFirstPress {
	return value === "next" ? "next" : DEFAULT_TAB_SWITCHER_FIRST_PRESS;
}

export async function readTabSwitcherFirstPress(): Promise<SwitcherFirstPress> {
	try {
		const data = await ext.storage.local.get(TAB_SWITCHER_FIRST_PRESS_KEY);
		return normalizeTabSwitcherFirstPress(data[TAB_SWITCHER_FIRST_PRESS_KEY]);
	} catch {
		return DEFAULT_TAB_SWITCHER_FIRST_PRESS;
	}
}

export async function writeTabSwitcherFirstPress(
	value: SwitcherFirstPress,
): Promise<void> {
	await ext.storage.local.set({
		[TAB_SWITCHER_FIRST_PRESS_KEY]: normalizeTabSwitcherFirstPress(value),
	});
}

/** Caption text for a switcher card, honoring the configured title source. */
export function resolveSwitcherTitle(
	tab: { title: string; url: string },
	source: SwitcherTitleSource,
): string {
	const page = tab.title || tab.url || "Untitled tab";
	return source === "site" ? deriveIconLabel(tab.url) || page : page;
}
