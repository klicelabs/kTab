import type { IconName } from "@ktab/ui/icons/icon";
import { ktabShape } from "@ktab/ui/lib/shapes";

/**
 * Shared toolbar design tokens. Every control in the toolbar must use these
 * exact values so all pills share one height, radius, and inner padding.
 *
 * The pill *material* (glass / flat) is provided by <GlassSurface>. Controls
 * themselves are transparent and only paint hover / active states — never a
 * hardcoded translucent background.
 */

/**
 * THE toolbar height system — one scale, two numbers.
 *
 *   surface  34  the material height of every toolbar cluster: the Tabbar
 *                shell, the Back/Forward group, and the standalone Settings /
 *                compact-Search controls. This is the silhouette that sits on
 *                the toolbar's centreline — compact macOS-like density, tuned
 *                down from the earlier 42px pass. Conceptually this is
 *                --toolbar-control-height (see tokens.css); the TS const must
 *                stay in sync with it because Tailwind needs literal classes.
 *   control  28  the height of a control *inside* a cluster that wraps its
 *                controls in extra material — i.e. a Tabbar tab inside the
 *                shell. surface === control + 2 * inset.
 *   inset     3  (surface - control) / 2 — the Tabbar shell's inner padding.
 *
 * The Back/Forward group is deliberately full-bleed: its segments ARE its
 * material, so they span the surface height rather than sitting inset inside
 * it. Giving the group an inner inset (so its wash matched a Tabbar tab's)
 * was tried and rejected — the hover wash read as a floating block with a
 * square cut in the middle instead of reaching the capsule edge.
 *
 * Glyphs are intentionally NOT shrunk by this pass: the single glyph token
 * below already targets ~18px optical ink, which sits inside the 16–18px
 * macOS-like range. Only heights and vertical padding move.
 *
 * The class strings below are literals, not derived from these numbers,
 * because Tailwind only generates utilities it can find as literal text in
 * source.
 */
export const TOOLBAR_HEIGHT = {
	/** Material height of every toolbar cluster. */
	surface: 34,
	/** Height of a control inset inside a cluster that pads. */
	control: 28,
	/** Surface-to-control inset: (surface - control) / 2. */
	inset: 3,
} as const;

export const TOOLBAR = {
	/** Toolbar container height. */
	height: "h-14",
	/** Height of a control inset inside a cluster (tabs, ellipsis, +). */
	controlHeight: "h-[28px]",
	/** Segment width of the Back/Forward group — deliberately unchanged by
	 * the proportion pass (only the group's outer height moves). */
	controlWidth: "w-[34px]",
	/** Square footprint for a control inset inside a cluster (ellipsis, +):
	 * matches controlHeight so inset controls stay circular, never oval. */
	innerSize: "size-[28px]",
	/** Shared pill geometry for a toolbar segment. Always full rounded. */
	radius: ktabShape("toolbarControl"),
	/** Shared pill geometry for a standalone 34px icon control. Always full rounded. */
	standaloneShape: ktabShape("toolbarIcon"),
	/** Inner padding of the Tabbar shell — the only cluster that wraps its controls. */
	groupPadding: "p-[3px]",
	/** Material height of a toolbar group surface (Tabbar shell, history group). */
	groupHeight: "h-[34px] max-h-[34px]",
	/** Diameter shared by standalone GlassIcon controls. */
	standaloneSize: "size-[34px]",
	/** Transition for all interactive states — explicit properties, never transition-all. */
	transition:
		"transition-[background-color,color,transform,opacity] duration-150 ease-out active:scale-[0.97]",
} as const;

/**
 * ONE toolbar glyph token.
 *
 * Lucide draws every icon inside the same 24x24 box, but the ink inside that
 * box is not uniform: measured from the rendered SVGs, a chevron fills
 * 8 x 14.2 of the box while the settings gear fills 20 x 22. At one nominal
 * size the chevrons therefore read roughly 40% smaller than Settings — which
 * is why the Back/Forward arrows kept looking undersized no matter how much
 * the button around them grew. The box was never the problem; the ink was.
 *
 * `inkHeight` is the single target: the ink height every toolbar glyph must
 * reach. A glyph whose ink already fills the box uses `size` as-is; a glyph
 * with unusually small ink gets an explicit box in the table below, derived as
 * box = round(inkHeight * 24 / inkHeightInViewBox).
 *
 * The classes are literals (not built from the numbers) because Tailwind only
 * generates utilities it can find in source.
 */
export const TOOLBAR_ICON = {
	/** Nominal box for a glyph whose ink already fills lucide's 24x24 viewBox. */
	size: 20,
	/** Target ink height shared by every toolbar glyph, in CSS px. */
	inkHeight: 18,
	/**
	 * ONE stroke weight for every toolbar glyph. Lucide defaults to 2, which
	 * reads heavy next to SF Symbols; 1.5 keeps full legibility at 16–28px
	 * boxes while matching the thinner Apple-like feel. Glyph *size* is
	 * untouched — only the stroke lightens.
	 */
	strokeWidth: 1.5,
} as const;

/**
 * Per-glyph box overrides, keyed by measured ink height in the 24x24 viewBox.
 *
 * chevrons: ink 14.2 tall. An exact optical match with Settings (ink 22 tall)
 * would be an 18 * 24 / 14.2 = 30.4 -> 30px box, giving a 17.8px ink height.
 * They are deliberately set lower, at 24px (ink ~14.2px), so the arrows read
 * a touch lighter than the gear instead of exactly equal to it.
 */
const TOOLBAR_GLYPH_BOX: Partial<
	Record<IconName, { size: number; className: string }>
> = {
	"chevron-left": { size: 24, className: "size-[24px]" },
	"chevron-right": { size: 24, className: "size-[24px]" },
	// Same small-ink chevron family as Back/Forward: same 24px box so the
	// Go to Top glyph reaches the same optical weight.
	"chevron-up": { size: 24, className: "size-[24px]" },
};

/**
 * The glyph box for `name`, in px. Use with the `size` prop so server-rendered
 * markup and the CSS class agree.
 */
export function toolbarIconSize(name: IconName): number {
	return TOOLBAR_GLYPH_BOX[name]?.size ?? TOOLBAR_ICON.size;
}

/**
 * The single icon-size class for `name`.
 *
 * Every toolbar glyph must carry this: it is a `size-*` class, so the shared
 * Button rule `[&_svg:not([class*='size-'])]:size-4` no longer matches it and
 * the glyph size stops depending on an `!important` override fighting a
 * descendant selector.
 */
export function toolbarIconClass(name: IconName): string {
	return TOOLBAR_GLYPH_BOX[name]?.className ?? "size-5";
}

/**
 * Shared control styles — liquid mode. Transparent by default; the enclosing
 * GlassSurface is the material. Active/hover paint over it.
 */

export function toolbarControlLiquid(active: boolean): string {
	if (active) {
		return `${TOOLBAR.controlHeight} ${TOOLBAR.radius} ${TOOLBAR.transition} bg-foreground/10 text-[var(--ktab-glass-foreground-primary)]`;
	}
	return `${TOOLBAR.controlHeight} ${TOOLBAR.radius} ${TOOLBAR.transition} text-[var(--ktab-glass-foreground-secondary)] hover:text-[var(--ktab-glass-foreground-primary)] hover:bg-foreground/[0.10] active:bg-foreground/15`;
}

/**
 * Shared control styles — classic mode.
 *
 * Normal controls use the strong flat ink, never the muted variant: muted is
 * reserved for secondary states and disabled controls, so a normal inactive
 * tab must not read as disabled. Active-state hierarchy is carried by the
 * control face background, not by dimming the label.
 *
 * Toolbar controls carry no elevation shadow anywhere (group shell, tabs,
 * standalone buttons): face wash only. Imported face recipes that bundle a
 * shadow (flatControl) are therefore never used here directly.
 */
export function toolbarControlClassic(active: boolean): string {
	if (active) {
		return `${TOOLBAR.controlHeight} ${TOOLBAR.radius} ${TOOLBAR.transition} face-control shadow-none text-flat-ink`;
	}
	return `${TOOLBAR.controlHeight} ${TOOLBAR.radius} ${TOOLBAR.transition} text-flat-ink hover:bg-flat-sunken-raised active:bg-flat-sunken`;
}
