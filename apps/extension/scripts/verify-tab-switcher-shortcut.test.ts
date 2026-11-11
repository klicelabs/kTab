import { expect, test } from "bun:test";
import {
	comboModifierKeys,
	DEFAULT_TAB_SWITCHER_SHORTCUT,
	eventToCombo,
	formatShortcut,
	isComboModifierRelease,
	isValidShortcut,
	matchShortcut,
	normalizeShortcut,
	parseShortcut,
	shortcutLabel,
} from "../src/lib/tab-switcher-shortcut";

const keyEvent = (
	key: string,
	mods: Partial<{
		alt: boolean;
		ctrl: boolean;
		shift: boolean;
		meta: boolean;
	}> = {},
): KeyboardEvent =>
	({
		key,
		altKey: mods.alt ?? false,
		ctrlKey: mods.ctrl ?? false,
		shiftKey: mods.shift ?? false,
		metaKey: mods.meta ?? false,
	}) as KeyboardEvent;

test("parses the default Alt+Q combo", () => {
	expect(parseShortcut("Alt+Q")).toEqual({
		alt: true,
		ctrl: false,
		shift: false,
		meta: false,
		key: "Q",
	});
});

test("parses modifier aliases case-insensitively and canonicalizes order", () => {
	const combo = parseShortcut("command+shift+control+k");
	expect(combo).not.toBeNull();
	expect(formatShortcut(combo as NonNullable<typeof combo>)).toBe(
		"Ctrl+Shift+Meta+K",
	);
});

test("rejects unknown modifiers and empty input", () => {
	expect(parseShortcut("Hyper+Q")).toBeNull();
	expect(parseShortcut("")).toBeNull();
	expect(parseShortcut("   ")).toBeNull();
});

test("matches only the exact modifier set and base key", () => {
	const combo = parseShortcut("Alt+Q");
	expect(combo).not.toBeNull();
	const target = combo as NonNullable<typeof combo>;
	expect(matchShortcut(keyEvent("q", { alt: true }), target)).toBe(true);
	expect(matchShortcut(keyEvent("Q", { alt: true }), target)).toBe(true);
	expect(matchShortcut(keyEvent("q", { alt: true, shift: true }), target)).toBe(
		false,
	);
	expect(matchShortcut(keyEvent("q"), target)).toBe(false);
	expect(matchShortcut(keyEvent("w", { alt: true }), target)).toBe(false);
});

test("combo modifier helpers drive the Alt+Tab release-to-commit flow", () => {
	const altQ = parseShortcut("Alt+Q");
	const ctrlShiftK = parseShortcut("Ctrl+Shift+K");
	expect(altQ).not.toBeNull();
	expect(ctrlShiftK).not.toBeNull();
	expect(comboModifierKeys(altQ as NonNullable<typeof altQ>)).toEqual(["Alt"]);
	expect(
		comboModifierKeys(ctrlShiftK as NonNullable<typeof ctrlShiftK>),
	).toEqual(["Control", "Shift"]);
	expect(isComboModifierRelease("Alt", altQ as NonNullable<typeof altQ>)).toBe(
		true,
	);
	expect(isComboModifierRelease("Q", altQ as NonNullable<typeof altQ>)).toBe(
		false,
	);
	expect(
		isComboModifierRelease("Shift", altQ as NonNullable<typeof altQ>),
	).toBe(false);
	expect(
		isComboModifierRelease(
			"Shift",
			ctrlShiftK as NonNullable<typeof ctrlShiftK>,
		),
	).toBe(true);
	expect(
		isComboModifierRelease(
			"Meta",
			ctrlShiftK as NonNullable<typeof ctrlShiftK>,
		),
	).toBe(false);
});

test("recorder ignores modifier-only presses and captures the base key", () => {
	expect(eventToCombo(keyEvent("Alt", { alt: true }))).toBeNull();
	expect(eventToCombo(keyEvent("Control", { ctrl: true }))).toBeNull();
	expect(eventToCombo(keyEvent("k", { ctrl: true, shift: true }))).toEqual({
		alt: false,
		ctrl: true,
		shift: true,
		meta: false,
		key: "K",
	});
});

test("validation requires a primary modifier or a function key", () => {
	const valid = (value: string) => {
		const combo = parseShortcut(value);
		return combo ? isValidShortcut(combo) : false;
	};
	expect(valid("Alt+Q")).toBe(true);
	expect(valid("Ctrl+Shift+K")).toBe(true);
	expect(valid("F5")).toBe(true);
	expect(valid("Shift+F5")).toBe(true);
	expect(valid("Q")).toBe(false);
	expect(valid("Shift+Q")).toBe(false);
	expect(valid("Alt+Shift")).toBe(false);
});

test("normalize falls back to the default for invalid or corrupt values", () => {
	expect(normalizeShortcut("Alt+Q")).toBe("Alt+Q");
	expect(normalizeShortcut("alt+q")).toBe("Alt+Q");
	expect(normalizeShortcut("Q")).toBe(DEFAULT_TAB_SWITCHER_SHORTCUT);
	expect(normalizeShortcut(null)).toBe(DEFAULT_TAB_SWITCHER_SHORTCUT);
	expect(normalizeShortcut(42)).toBe(DEFAULT_TAB_SWITCHER_SHORTCUT);
});

test("label renders platform glyphs and words", () => {
	expect(shortcutLabel("Alt+Q", false)).toBe("Alt+Q");
	expect(shortcutLabel("Ctrl+Shift+K", false)).toBe("Ctrl+Shift+K");
	expect(shortcutLabel("Alt+Q", true)).toBe("⌥Q");
	expect(shortcutLabel("Meta+K", true)).toBe("⌘K");
	expect(shortcutLabel("Alt+Shift+K", true)).toBe("⌥⇧K");
});
