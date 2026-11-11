import { KtabShape } from "@ktab/ui/lib/shapes";

/**
 * Settings design tokens.
 *
 * One scale governs the whole panel so nothing is ever placed by feel. All
 * values sit on a 2px grid, and every gap is either the *row beat* (inside a
 * card) or the *card beat* (between cards) — never an arbitrary number.
 *
 *   panel gutter   16px  px-4      → content never touches the panel edge
 *   card padding    8/6  px-2 py-1.5 → card edge to row edge
 *   row padding     6/10 px-1.5 py-2.5 → row edge to row content
 *   row height     48px  min-h-12   → one exact beat per row
 *   card gap       10px  gap-2.5    → the only separation between groups
 *
 * Row content therefore lands on a 30px optical gutter from the panel edge,
 * and stacked rows share a single 48px rhythm.
 */

/**
 * Corner radii. One step per structural role, so a surface never picks a
 * radius by feel.
 *
 * Each entry pairs the Chrome radius with its `--squircle-r` fallback, which
 * the `.squircle` utility swaps in for engines without `corner-shape` (Gecko).
 * The fallback is ~60% of the Chrome radius so both renderings read as the
 * same roundness — always change the pair together.
 */
export const SETTINGS_RADIUS = KtabShape;

/** The scroll region: one vertical column, one card beat. */
export const SETTINGS_PAGE = "flex flex-col gap-2.5";

/** Interior of every section card. Rows add their own px on top of this. */
export const SETTINGS_CARD = "px-2 py-1.5";

/** The single row rhythm — 48px tall, 6px inset, 12px label↔control gap. */
export const SETTINGS_ROW = "min-h-12 gap-x-3 px-1.5 py-2.5";

/**
 * Inner padding for the scrollable Settings content frame. Both the root
 * navigation and every pane inherit the same all-side gutter.
 */
export const SETTINGS_CONTENT_PADDING = "p-4";

/**
 * The Settings header is the sidebar's counterpart to the Home toolbar. It
 * therefore uses the same responsive height and horizontal gutter instead of
 * the narrower content-frame inset. This keeps both toolbars on one optical
 * grid while the Settings body remains aligned to its own inset frame.
 */
/** Compact header band keeps the title and content frame on one short rhythm. */
export const SETTINGS_HEADER_HEIGHT = "h-12";
/** One horizontal grid for header chrome and the content frame below it. */
export const SETTINGS_FRAME_INSET = "px-[var(--workspace-gutter)]";
export const SETTINGS_HEADER_INSET = SETTINGS_FRAME_INSET;

/**
 * Type roles. Light-first with dark overrides — the panel follows the app
 * theme (Light / Dark / Auto) while always staying Flat, even when Liquid
 * Glass is enabled on the Speed Dial.
 */
export const SETTINGS_LABEL =
	"block text-[13px] font-medium leading-[1.35] text-neutral-900 dark:text-neutral-100";

/** Control column width — the widest a select, picker or input may grow. */
export const SETTINGS_CONTROL_WIDTH = "w-[min(11rem,100%)]";

/**
 * Focus ring. One definition for the entire panel: a 2px ring lifted 1px off
 * the surface. Light-first, dark override — always change the pair together.
 */
export const SETTINGS_FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ktab-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#252525]";

/** Header close/back control — a quiet circular hit target. */
export const SETTINGS_HEADER_CONTROL =
	"inline-flex size-9 shrink-0 items-center justify-center rounded-full border-0 bg-neutral-900/[0.06] text-neutral-900 shadow-none transition-[background-color,color,transform,opacity] duration-150 ease-out hover:bg-neutral-900/[0.1] hover:text-black active:scale-[0.96] motion-reduce:transition-colors dark:bg-white/[0.12] dark:text-neutral-100 dark:hover:bg-white/[0.16] dark:hover:text-white";

export const SETTINGS_SELECT_TRIGGER = `squircle min-w-0 max-w-full ${SETTINGS_RADIUS.control} !bg-none bg-neutral-900/[0.05] text-neutral-900 shadow-none hover:!bg-none hover:bg-neutral-900/[0.08] active:scale-100 dark:bg-white/[0.06] dark:text-neutral-100 dark:hover:bg-white/[0.09]`;

/**
 * Picker trigger surface — the folder picker's button, and any equivalent
 * compact trigger. The exact twin of the select trigger (same wash, type
 * size, radius, theme pair, no border, no elevation), without
 * select-specific resets, so pickers never drift from selects.
 */
export const SETTINGS_TRIGGER = `squircle ${SETTINGS_RADIUS.control} bg-neutral-900/[0.05] text-neutral-900 text-xs shadow-none transition-[background-color,box-shadow] duration-150 hover:bg-neutral-900/[0.08] active:scale-100 dark:bg-white/[0.06] dark:text-neutral-100 dark:hover:bg-white/[0.09]`;

export const SETTINGS_SWITCH =
	"shadow-none [&_[data-slot=switch-thumb]]:shadow-none";

export const SETTINGS_INPUT = `squircle ${SETTINGS_RADIUS.control} border-neutral-900/[0.08] bg-neutral-900/[0.04] text-neutral-900 shadow-none placeholder:text-neutral-400 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-neutral-100 dark:placeholder:text-neutral-500`;

/**
 * In-row actions. One quiet default, one clear primary, one destructive —
 * the palette never carries more than one of each per group, so a card always
 * has an obvious "do this" affordance.
 *
 * Shape comes from `SETTINGS_RADIUS.control`, applied by the component, so
 * every action in the panel is identical by construction.
 */
export const SETTINGS_ACTION =
	"h-8 gap-1.5 border-0 bg-neutral-900/[0.05] px-2.5 text-neutral-800 text-xs shadow-none transition-[background-color,color,transform] duration-150 hover:bg-neutral-900/[0.09] active:scale-[0.98] dark:bg-white/[0.06] dark:text-neutral-100 dark:hover:bg-white/[0.1]";

export const SETTINGS_ACTION_PRIMARY =
	"h-8 gap-1.5 border-0 bg-[var(--ktab-accent)] px-3 font-medium text-[var(--ktab-accent-foreground)] text-xs shadow-none transition-[filter,transform] duration-150 hover:brightness-95 active:scale-[0.98]";

export const SETTINGS_ACTION_DANGER =
	"h-8 gap-1.5 border-0 bg-transparent px-2.5 text-red-600 text-xs shadow-none transition-[background-color,color,transform] duration-150 hover:bg-red-500/10 hover:text-red-500 active:scale-[0.98] dark:text-red-400 dark:hover:text-red-300";

/** Icon-only row action — 32px hit target, revealed on row hover/focus. */
export const SETTINGS_ICON_BUTTON =
	"inline-flex size-8 shrink-0 items-center justify-center border-0 bg-transparent text-neutral-500 shadow-none transition-[background-color,color,transform,opacity] duration-150 hover:bg-neutral-900/[0.06] hover:text-neutral-900 active:scale-[0.94] dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-neutral-100";

/**
 * The sidebar's outer workspace surface. It is intentionally quiet and
 * opaque: Settings remains Flat even while Speed Dial is Liquid Glass.
 */
export const SETTINGS_SIDEBAR_SHELL =
	"bg-neutral-100 text-neutral-900 dark:bg-[#252525] dark:text-neutral-100";

/**
 * The inset content frame. Keeping this one tone step away from the shell
 * gives the pages a home without changing any of their existing controls.
 */
export const SETTINGS_CONTENT_FRAME =
	"bg-white text-neutral-900 shadow-[0_1px_0_rgb(255_255_255/0.65)] dark:bg-[#1d1d1d] dark:text-neutral-100 dark:shadow-[0_1px_0_rgb(255_255_255/0.04)]";

/** Card surface — groups rows without adding visual weight. */
export const SETTINGS_CARD_SURFACE =
	"bg-neutral-900/[0.035] dark:bg-white/[0.04]";
export const SETTINGS_CARD_SURFACE_DANGER =
	"bg-red-500/[0.07] dark:bg-destructive/[0.06]";

/** Quiet hover wash for rows and nav items. */
export const SETTINGS_HOVER_WASH =
	"hover:bg-neutral-900/[0.045] dark:hover:bg-white/[0.05]";
export const SETTINGS_ROW_HOVER_WASH =
	"hover:bg-neutral-900/[0.03] dark:hover:bg-white/[0.04]";

export const SETTINGS_ACTION_ICON = "shrink-0 opacity-70";

/**
 * The one tooltip delay for the whole Settings panel (ms).
 *
 * Fast enough for repeated use, slow enough to skip accidental brushes —
 * one shared value so every page feels identical.
 */
export const SETTINGS_TOOLTIP_DELAY = 200;
