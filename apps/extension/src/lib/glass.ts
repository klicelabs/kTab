import {
	glassVariantStyles,
	type LiquidGlassDensity,
} from "@ktab/ui/lib/glass-variants";
import type { FlatElevation } from "@ktab/ui/lib/surface";
import { flatSunken, flatSurface } from "@ktab/ui/lib/surface";
import { ktabShape, type KtabShapeName } from "@ktab/ui/lib/shapes";
import { cn } from "./utils";

export type GlassShape = KtabShapeName;

/**
 * Semantic Glass roles. Components request PURPOSE, never a raw glasscn
 * variant name — the mapping below is the single place that knows glasscn.
 *
 *   hero    small, low-count, optically expressive controls:
 *           collapsed main Search, Settings chrome → liquid-refract lens.
 *   toolbar the top toolbar family, isolated so its calibration never leaks
 *           into unrelated heroes: Back/Forward, Tabbar shell, tabs,
 *           Settings, compact Search, ellipsis → liquid-refract lens with
 *           a restrained toolbar veil and a defined hairline edge.
 *   surface repeated / larger / text-heavy surfaces:
 *           expanded Search done via `search`, menus via `menu`;
 *           folder picker, popovers, dropdowns, footers, large floating
 *           panels → liquid (readable, no lens).
 *   search  expanded Search + results: deliberately denser/darker than the
 *           collapsed hero so query text survives any wallpaper → liquid-menu.
 *   menu    context menus / dropdown menus: dense + accent active row,
 *           comfortable rows, subtle separators → liquid-menu.
 *   tooltip compact, high-contrast, never refractive → liquid-menu CSS only.
 *   tile    launcher tile pane (icon + label on one pane): the quietest
 *           member of the family — discreet veil, no lens, still driven by
 *           the global glass intensity → liquid-tile.
 *   nested  ONLY a genuine second material layer; everywhere else prefer a
 *           plain hover/fill on the parent → subtle. Never Glass³.
 */
export type GlassTier =
	| "hero"
	| "toolbar"
	| "surface"
	| "nested"
	| "search"
	| "menu"
	| "tooltip"
	| "tile";

const GLASS_TIER_VARIANTS = {
	hero: "liquid-refract",
	toolbar: "liquid-refract",
	surface: "liquid",
	nested: "subtle",
	search: "liquid-menu",
	menu: "liquid-menu",
	tooltip: "liquid-menu",
	tile: "liquid-tile",
} as const;

/** Map product intent to the single glasscn material tier for that role. */
export function glassTierVariant(tier: GlassTier) {
	return GLASS_TIER_VARIANTS[tier];
}

/**
 * Lens-node veil for the refractive tiers (`toolbar`, `hero`).
 *
 * Lens nodes render their backdrop-filter from INLINE style (see the lens
 * note in glass-variants.ts), so backdrop-* utilities would be dead code
 * here — veil is bg opacity + hairline border only, and the SVG lens adds
 * blur / saturation / brightness around it. The generic `LiquidGlass` base
 * is near-clear glass, so every refractive product surface MUST include
 * this veil or it renders theme-blind.
 *
 * Veil density is PARAMETRIC in the global `--ktab-glass-intensity` var
 * (0 Clear … 1 Tinted, set live by AppearanceProvider): the slider visibly
 * moves every veil with zero re-renders, while each role keeps its own
 * floor/span so the density hierarchy never collapses. Floors carry theme
 * identity, so even Clear reads Light vs Dark.
 *
 *   toolbar  Light 34→44, Dark smoked 8→16 + defined hairline edge.
 *   hero     one step clearer: Light 24→32, Dark 6→14.
 */
export function glassLensVeil(
	tier: "toolbar" | "hero",
	resolvedDark = true,
): string {
	if (tier === "toolbar") {
		return resolvedDark
			? "bg-[color-mix(in_srgb,black_calc(8%+var(--ktab-glass-intensity)*8%),transparent)] border-[0.5px] border-white/[0.10]"
			: "bg-[color-mix(in_srgb,white_calc(34%+var(--ktab-glass-intensity)*10%),transparent)] border-[0.5px] border-black/[0.10]";
	}
	return resolvedDark
		? "bg-[color-mix(in_srgb,black_calc(6%+var(--ktab-glass-intensity)*8%),transparent)] border-[0.5px] border-white/[0.10]"
		: "bg-[color-mix(in_srgb,white_calc(24%+var(--ktab-glass-intensity)*8%),transparent)] border-[0.5px] border-black/[0.08]";
}

/**
 * Liquid Glass intensity mapping (the `glassIntensity` 0…100 setting).
 *
 * The slider drives the WHOLE semantic system, not raw opacity. Each role
 * reads its optical recipe from here; components never hand-tune blur or
 * refraction. Only parameters that REALLY exist on the installed glasscn
 * `LiquidGlass` are used (blur, refraction, saturation, bezel) plus the
 * veil-density branch (regular vs dense tier selection stays role-owned).
 *
 *   intensity 0   Ultra Clear:  clear blur 1.5, dense blur 8,
 *                               refraction 12, near-neutral saturation
 *   intensity 60  Default:      clear blur 3.6, dense blur 10.4,
 *                               refraction 26, measured saturation
 *   intensity 100 Fully Tinted: clear blur 5, dense blur 12,
 *                               refraction 36, strongest readable veil
 *
 * Saturation is theme-aware on purpose: Dark keeps the chromatic
 * wallpaper bleed that makes smoked Glass feel alive; Light stays near
 * neutral (macOS Light Glass reads milky-white, never blue) so the
 * toolbar can't inherit a cool cast from a sky/ocean wallpaper.
 *
 * Contrast rationale: Glass surfaces use theme ink (black in Light, white in
 * Dark). Dark surfaces can therefore lower brightness as the
 * material strengthens, while Light stays close to neutral and preserves the
 * wallpaper's color.
 *
 * Hard ceiling: blur never exceeds 12px (mirrors glasscn's
 * MAX_LIQUID_GLASS_BLUR). Hero stays the most transparent; large surfaces
 * keep more density for legibility. These values are stable per frame —
 * never animate them (animate transform/opacity only).
 */
export interface GlassIntensityParams {
	/** Backdrop blur for clear/refractive controls, px. */
	blurHero: number;
	/** Backdrop blur for dense/text-heavy surfaces, px. */
	blurSurface: number;
	/** SVG displacement strength for the refractive lens. */
	refraction: number;
	/** Backdrop saturation for clear/refractive surfaces. */
	saturationClear: number;
	/** Backdrop saturation for dense surfaces. */
	saturationDense: number;
	/** Refractive band width as a fraction of the half-min-dimension. */
	bezel: number;
	/** Backdrop brightness for clear/refractive surfaces. */
	brightnessHero: number;
	/** Backdrop brightness for dense surfaces. */
	brightnessSurface: number;
}

export const GLASS_INTENSITY_DEFAULT = 60;
const GLASS_BLUR_CEILING = 12;

export type GlassDensity = "clear" | "dense";

export interface GlassLiquidProps {
	blur: number;
	refraction: number;
	saturation: number;
	brightness: number;
	bezel: number;
}

export function clampGlassIntensity(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return GLASS_INTENSITY_DEFAULT;
	}
	return Math.min(100, Math.max(0, Math.round(value)));
}

export function glassIntensityParams(
	intensity: number = GLASS_INTENSITY_DEFAULT,
	dark = true,
): GlassIntensityParams {
	const t = clampGlassIntensity(intensity) / 100;
	return {
		blurHero: Math.min(GLASS_BLUR_CEILING, 1.5 + 3.5 * t),
		blurSurface: Math.min(GLASS_BLUR_CEILING, 8 + 4 * t),
		refraction: 12 + 24 * t,
		saturationClear: dark ? 1.04 + 0.28 * t : 1.01 + 0.08 * t,
		saturationDense: dark ? 1.12 + 0.36 * t : 1.04 + 0.1 * t,
		bezel: 0.26 + 0.1 * t,
		brightnessHero: dark ? 0.94 - 0.12 * t : 1.02 + 0.01 * t,
		// Dense surfaces need a veil for reading, not a black plate. Keep the
		// Dark backdrop close to neutral so stronger glass preserves wallpaper
		// color instead of making menus look like opaque rectangles.
		brightnessSurface: dark ? 0.96 - 0.08 * t : 1.0,
	};
}

/** Convert the shared recipe into the exact props a LiquidGlass node needs. */
export function glassLiquidProps(
	params: GlassIntensityParams,
	density: GlassDensity = "clear",
): GlassLiquidProps {
	const dense = density === "dense";
	return {
		blur: dense ? params.blurSurface : params.blurHero,
		refraction: params.refraction,
		saturation: dense ? params.saturationDense : params.saturationClear,
		brightness: dense ? params.brightnessSurface : params.brightnessHero,
		bezel: params.bezel,
	};
}

/** CSS variables keep the plain-div GlassCN path on the same recipe. */
export function glassCssVariables(
	params: GlassIntensityParams,
): Record<`--${string}`, string> {
	return {
		"--ktab-glass-blur-clear": `${params.blurHero}px`,
		"--ktab-glass-blur-dense": `${params.blurSurface}px`,
		"--ktab-glass-saturation-clear": String(params.saturationClear),
		"--ktab-glass-saturation-dense": String(params.saturationDense),
		"--ktab-glass-brightness-clear": String(params.brightnessHero),
		"--ktab-glass-brightness-dense": String(params.brightnessSurface),
	};
}

/**
 * Shared kTab geometry. Pills keep native full rounding; every other shape
 * uses the incumbent squircle utility and its paired Firefox fallback token.
 */
export function glassShape(shape: GlassShape): string {
	return cn(ktabShape(shape));
}

/**
 * Shared material entry point for extension surfaces.
 *
 * Liquid Glass components use the glasscn liquid-refract primitive directly
 * where the surface can own its DOM node (toolbar/search/card primitives).
 * This class helper remains for Base UI surfaces that accept only a className;
 * it is the same capped, no-halo fallback family and never adds a second
 * parent filter around a refractive component.
 */
export function glassMaterial(
	isLiquid: boolean,
	elevation: Extract<
		FlatElevation,
		"floating" | "menu" | "panel" | "dialog"
	> = "floating",
	density: LiquidGlassDensity = "regular",
): string {
	if (!isLiquid) return flatSurface(elevation);
	return density === "dense"
		? glassVariantStyles["liquid-menu"]
		: glassVariantStyles.liquid;
}

/** Shared foreground ladder for readable Glass content. */
export type GlassForegroundVariant =
	| "primary"
	| "secondary"
	| "muted"
	| "disabled";

const GLASS_FOREGROUND_CLASSES: Record<GlassForegroundVariant, string> = {
	primary: "text-[var(--ktab-glass-foreground-primary)]",
	secondary: "text-[var(--ktab-glass-foreground-secondary)]",
	muted: "text-[var(--ktab-glass-foreground-muted)]",
	disabled: "text-[var(--ktab-glass-foreground-disabled)]",
};

/**
 * Primary Glass content is opaque black in Light and opaque white in Dark.
 * Alpha is reserved for secondary, muted and disabled semantics.
 */
export function glassForeground(
	variant: GlassForegroundVariant = "primary",
): string {
	return GLASS_FOREGROUND_CLASSES[variant];
}

/** Card-local material: retains the bevel but never paints a broad halo into
 * the surrounding grid. Flat cards keep their existing floating elevation. */
export function glassCardMaterial(isLiquid: boolean): string {
	return isLiquid ? glassVariantStyles.liquid : flatSurface("floating");
}

/**
 * Dropdown menu surface (overflow / search popovers).
 * Liquid: the dense, readable member of the shared Liquid Glass family —
 *   visually connected to the tabbar it hangs from, while keeping menu ink
 *   readable. Ink is theme-adaptive (black text in Light, white in Dark);
 *   only hero controls floating directly on the wallpaper keep fixed white ink.
 * Classic: standard opaque popover.
 */
export function glassDropdown(isLiquid: boolean, resolvedDark = true): string {
	return cn(
		glassMaterial(isLiquid, "menu", "dense"),
		glassShape("section"),
		"p-1.5",
		isLiquid ? glassForeground() : "text-popover-foreground",
	);
}

/**
 * Dropdown menu item.
 *
 * Liquid: neutral hover wash (a material response, never accent), accent
 * focus/highlight (keyboard selection IS the accent row, macOS-style).
 * Type is regular 13px — hierarchy comes from spacing and the accent row,
 * never from bold labels.
 * Classic: standard muted hover.
 *
 * `pillOwned` is for rows rendered inside a motion menu whose shared pill
 * already paints the background (accent on active, nothing otherwise): it
 * strips the native hover wash AND the native focus bg so exactly one
 * surface ever shows. State semantics (hover/focus/disabled) and foreground
 * ownership stay untouched — only the competing background paint goes.
 * shadcn/Base UI menus (no pill) keep the default native paints.
 *
 * No cursor override: kTab uses the platform arrow cursor for normal
 * clickable UI (menu rows included), matching native desktop menus.
 */
export function glassDropdownItem(
	isLiquid: boolean,
	resolvedDark = true,
	opts?: { pillOwned?: boolean },
): string {
	const shape = `${glassShape("control")} px-3 py-2 text-[13px] font-normal transition-colors duration-100 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-40`;
	// Pill-owned rows: the motion pill is the single background (active rows
	// get the accent pill + accent foreground from the menu primitive; the
	// foreground classes below still apply). Never stack a native wash under it.
	const hoverPaint =
		opts?.pillOwned || !isLiquid
			? opts?.pillOwned
				? ""
				: "hover:bg-flat-sunken-raised"
			: "hover:bg-foreground/[0.08] hover:text-[var(--ktab-glass-foreground-primary)]";
	const focusPaint = opts?.pillOwned
		? ""
		: "focus:bg-[var(--ktab-accent)] focus:text-[var(--ktab-accent-foreground)]";
	if (isLiquid) {
		return `${shape} ${glassForeground()} ${hoverPaint} ${focusPaint}`;
	}
	return `${shape} text-flat-ink ${hoverPaint} ${focusPaint}`;
}

/**
 * Pill variant of the dropdown item for toolbar-anchored menus (e.g. the
 * folder-overflow "search folders" menu). Same ink recipe as
 * glassDropdownItem, but a true capsule — never squircle.
 */
export function glassDropdownItemPill(
	isLiquid: boolean,
	resolvedDark = true,
): string {
	const shape =
		"rounded-full px-3 py-2 text-[13px] font-normal transition-colors duration-100 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-40";
	if (isLiquid) {
		return `${shape} ${glassForeground()} hover:bg-foreground/[0.08] hover:text-[var(--ktab-glass-foreground-primary)] focus:bg-[var(--ktab-accent)] focus:text-[var(--ktab-accent-foreground)]`;
	}
	return `${shape} text-flat-ink hover:bg-flat-sunken-raised focus:bg-[var(--ktab-accent)] focus:text-[var(--ktab-accent-foreground)]`;
}

/**
 * Menu surface shared by card, tab, page, and overflow context menus — one
 * recipe so every menu reads as the same layer.
 *
 * Glass mode uses the dense liquid member of the glasscn family. Ink is
 * theme-adaptive (the menu is a large stable surface, not a wallpaper-floated
 * hero). The menu primitive supplies its own layout and animation; it must
 * not introduce a second glass recipe or backdrop layer.
 * Flat mode: the existing solid popover surface and elevation.
 */
export function glassMenu(isLiquid: boolean, resolvedDark = true): string {
	const layout = cn("min-w-44 p-1", glassShape("section"));

	if (isLiquid) {
		return cn(layout, glassMaterial(true, "menu", "dense"), glassForeground());
	}

	return cn(layout, glassMaterial(false, "menu"), "text-flat-ink");
}

/**
 * Quiet inset field for use INSIDE a menu surface (e.g. the overflow
 * dropdown's search/create input). The parent surface already provides the
 * material, so this only draws a hairline boundary directly on it: no second
 * filled panel, no raised inner card, no brightness jump — just a restrained
 * border that firms up on focus. Ink is theme-adaptive like the menu around
 * it; the single focus indicator is the accent border + ring.
 */
export function glassField(isLiquid: boolean): string {
	if (isLiquid) {
		return cn(
			glassShape("control"),
			"border border-black/[0.14] bg-transparent text-[var(--ktab-glass-foreground-primary)] outline-none transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none placeholder:text-[var(--ktab-glass-foreground-secondary)] dark:border-white/[0.16]",
			"focus:border-[var(--ktab-accent)] focus:ring-1 focus:ring-[var(--ktab-accent)]/30",
			"focus-within:border-[var(--ktab-accent)] focus-within:ring-1 focus-within:ring-[var(--ktab-accent)]/30",
			"has-[[data-slot=input-group-control]:focus-visible]:border-[var(--ktab-accent)] has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-[var(--ktab-accent)]/30",
		);
	}
	return cn(
		glassShape("control"),
		flatSunken("controlPressed"),
		"text-flat-ink placeholder-flat-ink-muted outline-none transition-[box-shadow,color] duration-150 motion-reduce:transition-none",
		"focus-within:ring-1 focus-within:ring-ring/35 focus:ring-1 focus:ring-ring/35",
	);
}

/**
 * Pill variant of the quiet inset field for toolbar-anchored menus (e.g. the
 * overflow dropdown's search/create input). Same hairline recipe as
 * glassField, but a true capsule — never squircle.
 */
export function glassFieldPill(isLiquid: boolean): string {
	if (isLiquid) {
		return cn(
			"rounded-full border border-black/[0.14] bg-transparent text-[var(--ktab-glass-foreground-primary)] outline-none transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none placeholder:text-[var(--ktab-glass-foreground-secondary)] dark:border-white/[0.16]",
			"focus:border-[var(--ktab-accent)] focus:ring-1 focus:ring-[var(--ktab-accent)]/30",
			"focus-within:border-[var(--ktab-accent)] focus-within:ring-1 focus-within:ring-[var(--ktab-accent)]/30",
			"has-[[data-slot=input-group-control]:focus-visible]:border-[var(--ktab-accent)] has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-[var(--ktab-accent)]/30",
		);
	}
	return cn(
		"rounded-full",
		flatSunken("controlPressed"),
		"text-flat-ink placeholder-flat-ink-muted outline-none transition-[box-shadow,color] duration-150 motion-reduce:transition-none",
		"focus-within:ring-1 focus-within:ring-ring/35 focus:ring-1 focus:ring-ring/35",
	);
}

/**
 * Shared `card-footer` material role for bookmark AND subfolder footers.
 *
 * One recipe, both card types: the footer is the dense member of the same
 * Liquid Glass family used by search and menus. This gives the text-heavy
 * strip its own compatible blur, saturation, veil, bevel and hairline while
 * preserving the clear card body above it. The material is deliberately
 * selected by semantic role instead of re-created with a footer-only color.
 *
 * Bodies are untouched: bookmark body stays glass-free content, subfolder
 * body keeps its surface role. Only the footer is unified.
 */
export function glassCardFooter(isLiquid: boolean): string {
	if (isLiquid) {
		return cn(glassVariantStyles["liquid-menu"], glassForeground());
	}
	return "bg-flat-sunken-raised text-flat-ink";
}

/**
 * Elegant keyboard-focus ring that stays legible on glass and flat alike.
 * Liquid surfaces get the accent ring (visible in both themes);
 * classic surfaces use the theme ring. Never remove focus — integrate it.
 */
export function glassFocusRing(isLiquid: boolean): string {
	return cn(
		"focus-visible:outline-none focus-visible:ring-2",
		isLiquid
			? "focus-visible:ring-[var(--ktab-accent)]/80"
			: "focus-visible:ring-ring",
	);
}

/**
 * Drop-target emphasis that preserves the material's own elevation. The ring
 * is mode-aware, while the shared surface underneath stays untouched.
 */
export function glassDropRing(isLiquid: boolean): string {
	return isLiquid
		? "ring-2 ring-[var(--ktab-accent)]/80"
		: "ring-2 ring-ring/80";
}

/**
 * Tooltip surface — a REAL Glass component, not an afterthought.
 *
 * Compact, dense, extremely readable: strong primary ink, subtle secondary
 * text, correct control squircle, small blur (6px, never refractive — a lens
 * on a 24px label is pure noise). There is no glasscn Tooltip primitive, so
 * the accessible shadcn/Base UI Tooltip behavior renders through this
 * centralized surface instead of an invented `@glasscn/glass-tooltip`.
 *
 * Settings tooltips intentionally stay Flat: they live inside the Flat
 * Settings body. This role is for wallpaper-anchored product tooltips.
 */
export function glassTooltip(isLiquid: boolean): string {
	if (isLiquid) {
		return cn(
			glassShape("control"),
			glassVariantStyles["liquid-menu"],
			"inline-flex max-w-xs items-center gap-1.5 px-2.5 py-1 text-[12px] font-normal shadow-lg",
			glassForeground(),
		);
	}
	return cn(
		glassShape("control"),
		"inline-flex max-w-xs items-center gap-1.5 bg-foreground px-2.5 py-1 text-[12px] font-normal text-background shadow-lg",
	);
}

/**
 * Bonjourr-style clean shadow — guarantees legibility for hero text that sits
 * directly on the wallpaper (clock, empty state) on both bright and
 * busy, without a heavy scrim. Shared so every piece of unbacked hero text
 * uses the same treatment.
 */
export const HERO_TEXT_SHADOW =
	"0 1px 12px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.35)";

/**
 * Text color utility for material surfaces. Glass follows the theme ink scale:
 * black in Light and white in Dark. Direct wallpaper content uses
 * `wallpaperText` instead and keeps its own contrast treatment.
 */
export function glassText(
	isLiquid: boolean,
	variant: "primary" | "secondary" | "muted" = "primary",
	resolvedDark = true,
): string {
	if (isLiquid) {
		switch (variant) {
			case "primary":
				return glassForeground("primary");
			case "secondary":
				return glassForeground("secondary");
			case "muted":
				return glassForeground("muted");
		}
	}
	switch (variant) {
		case "primary":
			return "text-foreground";
		case "secondary":
			return "text-foreground/80";
		case "muted":
			return "text-muted-foreground";
	}
}

/**
 * Semantic ink for content painted directly over the wallpaper. This role is
 * independent from both theme and material: unlike Settings or a card/menu
 * surface, the wallpaper underneath can change over time.
 */
export function wallpaperText(
	variant: "primary" | "secondary" | "muted" = "primary",
): string {
	switch (variant) {
		case "primary":
			return "wallpaper-overlay-text";
		case "secondary":
			return "wallpaper-overlay-text-secondary";
		case "muted":
			return "wallpaper-overlay-text-muted";
	}
}
