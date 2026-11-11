import { ext } from "./extension-api";
import { deriveIconLabel } from "./url";

/**
 * What the switcher captions show, mirroring the bookmark cards' "Default
 * title source" setting: the page's own title or the site name inferred from
 * the URL. Like the hotkey, the choice lives under its own local storage key,
 * independent of the setup envelope, and is injected into the payload by the
 * client so the overlay can resolve captions at render time.
 */
export type SwitcherTitleSource = "title" | "site";

export const TAB_SWITCHER_TITLE_SOURCE_KEY = "klice-tab-switcher-title-source";
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

/** Caption text for a switcher card, honoring the configured title source. */
export function resolveSwitcherTitle(
	tab: { title: string; url: string },
	source: SwitcherTitleSource,
): string {
	const page = tab.title || tab.url || "Untitled tab";
	return source === "site" ? deriveIconLabel(tab.url) || page : page;
}
