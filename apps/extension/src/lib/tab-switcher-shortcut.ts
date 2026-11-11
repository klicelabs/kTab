import { ext } from "./extension-api";

/**
 * The tab switcher hotkey is owned by the extension (content script + newtab
 * keydown listeners), NOT a manifest `commands` entry. Chrome cannot rebind a
 * command shortcut programmatically, so owning the key is what lets the user
 * remap it from inside Settings instead of chrome://extensions/shortcuts.
 *
 * The combo is stored as a canonical string ("Alt+Q") under its own local
 * storage key, independent of the setup envelope, so the hotkey survives
 * resets and never participates in the setup normalization contract.
 */
export interface ShortcutCombo {
	alt: boolean;
	ctrl: boolean;
	shift: boolean;
	meta: boolean;
	/** Normalized base key: an uppercase character, or a named key ("F5"). */
	key: string;
}

export const TAB_SWITCHER_SHORTCUT_KEY = "klice-tab-switcher-shortcut";
export const DEFAULT_TAB_SWITCHER_SHORTCUT = "Alt+Q";

type ModifierFlag = "alt" | "ctrl" | "shift" | "meta";

const MODIFIER_ALIASES: Record<string, ModifierFlag> = {
	alt: "alt",
	option: "alt",
	"⌥": "alt",
	ctrl: "ctrl",
	control: "ctrl",
	"⌃": "ctrl",
	shift: "shift",
	"⇧": "shift",
	meta: "meta",
	cmd: "meta",
	command: "meta",
	super: "meta",
	win: "meta",
	"⌘": "meta",
};

const MODIFIER_KEYS = new Set(["Alt", "Control", "Shift", "Meta"]);

/** Collapse layout/case differences so "q", "Q" and "Space" match reliably. */
export function normalizeShortcutKey(key: string): string {
	if (key === " " || key === "Spacebar") return "Space";
	if (key.length === 1) return key.toUpperCase();
	return key;
}

export function parseShortcut(value: string): ShortcutCombo | null {
	if (typeof value !== "string" || !value.trim()) return null;
	const tokens = value
		.trim()
		.split("+")
		.map((token) => token.trim())
		.filter(Boolean);
	if (tokens.length === 0) return null;
	const combo: ShortcutCombo = {
		alt: false,
		ctrl: false,
		shift: false,
		meta: false,
		key: "",
	};
	for (const token of tokens.slice(0, -1)) {
		const flag = MODIFIER_ALIASES[token.toLowerCase()];
		if (!flag) return null;
		combo[flag] = true;
	}
	combo.key = normalizeShortcutKey(tokens[tokens.length - 1]);
	return combo.key ? combo : null;
}

/** Canonical order (Ctrl, Alt, Shift, Meta) so stored strings stay stable. */
export function formatShortcut(combo: ShortcutCombo): string {
	const parts: string[] = [];
	if (combo.ctrl) parts.push("Ctrl");
	if (combo.alt) parts.push("Alt");
	if (combo.shift) parts.push("Shift");
	if (combo.meta) parts.push("Meta");
	parts.push(combo.key);
	return parts.join("+");
}

export function matchShortcut(
	event: KeyboardEvent,
	combo: ShortcutCombo,
): boolean {
	return (
		event.altKey === combo.alt &&
		event.ctrlKey === combo.ctrl &&
		event.shiftKey === combo.shift &&
		event.metaKey === combo.meta &&
		normalizeShortcutKey(event.key) === combo.key
	);
}

/**
 * Build a combo from a live keypress for the recorder. Modifier-only presses
 * return null so the recorder keeps waiting for the actual base key.
 */
export function eventToCombo(event: KeyboardEvent): ShortcutCombo | null {
	if (MODIFIER_KEYS.has(event.key)) return null;
	return {
		alt: event.altKey,
		ctrl: event.ctrlKey,
		shift: event.shiftKey,
		meta: event.metaKey,
		key: normalizeShortcutKey(event.key),
	};
}

/**
 * A global hotkey must not hijack ordinary typing: require Ctrl/Alt/Meta, or a
 * function key (which never produces text). Shift alone is just capitalization.
 */
export function isValidShortcut(combo: ShortcutCombo): boolean {
	if (!combo.key || MODIFIER_KEYS.has(combo.key)) return false;
	const hasPrimaryModifier = combo.ctrl || combo.alt || combo.meta;
	const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(combo.key);
	return hasPrimaryModifier || isFunctionKey;
}

/** Parse + validate + canonicalize, falling back to the shipped default. */
export function normalizeShortcut(value: unknown): string {
	const combo = typeof value === "string" ? parseShortcut(value) : null;
	return combo && isValidShortcut(combo)
		? formatShortcut(combo)
		: DEFAULT_TAB_SWITCHER_SHORTCUT;
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	const platform = navigator.platform || navigator.userAgent || "";
	return /Mac|iPhone|iPad|iPod/.test(platform);
}

function baseKeyLabel(key: string, mac: boolean): string {
	if (key === "Space") return mac ? "␣" : "Space";
	if (mac) {
		const named: Record<string, string> = {
			Enter: "↩",
			Escape: "⎋",
			Tab: "⇥",
			Backspace: "⌫",
			Delete: "⌦",
			ArrowUp: "↑",
			ArrowDown: "↓",
			ArrowLeft: "←",
			ArrowRight: "→",
		};
		if (named[key]) return named[key];
	}
	return key;
}

/** Human-facing label: macOS glyphs on Apple platforms, words elsewhere. */
export function shortcutLabel(value: string, mac = isMacPlatform()): string {
	const combo = parseShortcut(value);
	if (!combo) return value;
	const parts: string[] = [];
	if (combo.ctrl) parts.push(mac ? "⌃" : "Ctrl");
	if (combo.alt) parts.push(mac ? "⌥" : "Alt");
	if (combo.shift) parts.push(mac ? "⇧" : "Shift");
	if (combo.meta) parts.push(mac ? "⌘" : "Meta");
	parts.push(baseKeyLabel(combo.key, mac));
	return mac ? parts.join("") : parts.join("+");
}

export async function readTabSwitcherShortcut(): Promise<string> {
	try {
		const data = await ext.storage.local.get(TAB_SWITCHER_SHORTCUT_KEY);
		return normalizeShortcut(data[TAB_SWITCHER_SHORTCUT_KEY]);
	} catch {
		return DEFAULT_TAB_SWITCHER_SHORTCUT;
	}
}

export async function writeTabSwitcherShortcut(value: string): Promise<void> {
	await ext.storage.local.set({
		[TAB_SWITCHER_SHORTCUT_KEY]: normalizeShortcut(value),
	});
}
