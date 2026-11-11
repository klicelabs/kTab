/**
 * Shared Liquid Glass material family (CSS half of the system).
 *
 * The optical half lives in `apps/extension/src/lib/glass.ts`:
 * `glassIntensityParams()` interpolates the global `glassIntensity` 0…100
 * slider into the LiquidGlass props (blur / refraction / saturation / bezel)
 * consumed through GlassSurface:
 *
 *   intensity 0   Ultra Clear:  clear blur 1.5, dense blur 8,
 *                               refraction 12, low veil opacity
 *   intensity 60  Default:      clear blur 3.6, dense blur 10.4,
 *                               refraction 26, restrained veil opacity
 *   intensity 100 Fully Tinted: clear blur 5, dense blur 12,
 *                               refraction 36, denser veil opacity
 * (saturation pairs are dark / light: Light stays near-neutral so the
 * toolbar can't pick up a blue cast from the wallpaper.)
 *
 * Hard ceiling: blur never exceeds 12px (MAX_LIQUID_GLASS_BLUR). The CSS
 * below is intentionally static — blur/backdrop/refraction are NEVER
 * animated (transform/opacity only), and prefers-contrast: more is served
 * by selecting the dense tier, never by brightening this file.
 *
 * LENS NOTE: nodes rendered through `<LiquidGlass>` get their
 * backdrop-filter from INLINE style, which overrides the Tailwind
 * backdrop-* utilities below — so on-lens density must come from `bg-*`
 * opacity + lens props (blur / brightness / saturation) only. The
 * backdrop-* utilities here serve only the CSS-class path (glassMaterial
 * on plain divs). Recipes are light-first with `dark:` overrides (the
 * `.dark` class is set by AppearanceProvider).
 */
export type FrostGlassVariant =
	| "clear"
	| "frosted"
	| "subtle"
	| "liquid"
	| "liquid-menu"
	| "liquid-refract"
	| "liquid-tile";
export type FrostGlassVariantProp = { glassVariant?: FrostGlassVariant };
/** `regular` is the clear material; `dense` is reserved for content-heavy UI. */
export type LiquidGlassDensity = "regular" | "dense";

export const liquidRefractStyles = "bg-transparent border-0 shadow-none";

const LIQUID_GLASS_BASE = [
	// A restrained sheen: the backdrop should remain the visual source, not
	// turn into a white translucent rectangle.
	"[background-image:radial-gradient(120%_85%_at_15%_8%,rgba(255,255,255,0.10)_0%,rgba(255,255,255,0.025)_40%,rgba(255,255,255,0)_70%),radial-gradient(110%_80%_at_85%_100%,rgba(120,170,255,0.06)_0%,rgba(0,0,0,0)_60%),linear-gradient(180deg,rgba(255,255,255,0.035)_0%,rgba(0,0,0,0.10)_100%)]",
	"[background-size:200%_200%,180%_180%,100%_100%]",
	"[background-repeat:no-repeat]",

	// Hairline border for the chamfer's outer edge. Sub-pixel so it reads
	// as a crisp edge, not a thick rim, on small controls. Dark hairline in
	// Light (a white rim vanishes on the light veil), white specular in Dark.
	"border-[0.5px] border-black/[0.08] dark:border-white/[0.08]",
].join(" ");

// The CSS fallback retains only the material's inset bevel. External shadows
// belong to Flat elevation; Liquid Glass must not create broad halos around
// toolbar groups, menus, or adjacent cards. Light gets a dark-tinted bevel,
// Dark keeps the white specular.
const LIQUID_GLASS_BEVEL =
	"shadow-[inset_0_1px_0_0_rgba(0,0,0,0.08),inset_0_-10px_22px_-10px_rgba(60,90,140,0.08),inset_0.5px_0_0_0_rgba(0,0,0,0.045),inset_-0.5px_0_0_0_rgba(0,0,0,0.035)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),inset_0_-10px_22px_-10px_rgba(180,210,255,0.12),inset_0.5px_0_0_0_rgba(255,255,255,0.075),inset_-0.5px_0_0_0_rgba(255,255,255,0.06)]";

const liquidGlassDensityStyles: Record<LiquidGlassDensity, string> = {
	regular: [
		// Clear surfaces preserve backdrop detail. The provider supplies the
		// theme-aware optical values; this path stays live for plain divs too.
		"backdrop-blur-[var(--ktab-glass-blur-clear)] backdrop-saturate-[var(--ktab-glass-saturation-clear)] backdrop-brightness-[var(--ktab-glass-brightness-clear)]",
		"bg-[color-mix(in_srgb,white_calc(22%+var(--ktab-glass-intensity)*10%),transparent)] dark:bg-[color-mix(in_srgb,black_calc(10%+var(--ktab-glass-intensity)*8%),transparent)]",
	].join(" "),
	dense: [
		// Dense is reserved for menus, search results and other text-heavy
		// surfaces. It is visibly stronger than clear, but still lets the
		// wallpaper read through instead of becoming opaque chrome.
		"backdrop-blur-[var(--ktab-glass-blur-dense)] backdrop-saturate-[var(--ktab-glass-saturation-dense)] backdrop-brightness-[var(--ktab-glass-brightness-dense)]",
		"bg-[color-mix(in_srgb,white_calc(54%+var(--ktab-glass-intensity)*8%),transparent)] dark:bg-[color-mix(in_srgb,black_calc(38%+var(--ktab-glass-intensity)*8%),transparent)]",
	].join(" "),
};

export const liquidGlassStyles: Record<LiquidGlassDensity, string> = {
	regular: [
		liquidGlassDensityStyles.regular,
		LIQUID_GLASS_BASE,
		LIQUID_GLASS_BEVEL,
	].join(" "),
	dense: [
		liquidGlassDensityStyles.dense,
		LIQUID_GLASS_BASE,
		LIQUID_GLASS_BEVEL,
	].join(" "),
};

/** Liquid Glass card material without a broad external halo. */
export const liquidGlassCardStyles = [
	liquidGlassDensityStyles.regular,
	LIQUID_GLASS_BASE,
	LIQUID_GLASS_BEVEL,
].join(" ");

/**
 * Launcher tile pane — the quietest member of the family.
 *
 * A launcher tile is a SMALL surface floating on the wallpaper. It wants the
 * family's blur/tint language, but the regular card veil (22 %+ white) reads
 * as a heavy white square at that size. This recipe keeps the house optics
 * (blur/saturation/brightness from the global intensity) and trims the fill
 * to a discreet veil with a hairline edge — never a chunky glassmorphism
 * block. Still parametric in `--ktab-glass-intensity`, so the Appearance
 * slider moves it with everything else.
 */
export const liquidTileStyles = [
	"backdrop-blur-[var(--ktab-glass-blur-clear)] backdrop-saturate-[var(--ktab-glass-saturation-clear)] backdrop-brightness-[var(--ktab-glass-brightness-clear)]",
	"bg-[color-mix(in_srgb,white_calc(10%+var(--ktab-glass-intensity)*8%),transparent)] dark:bg-[color-mix(in_srgb,black_calc(12%+var(--ktab-glass-intensity)*8%),transparent)]",
	"border-[0.5px] border-black/[0.08] dark:border-white/[0.10]",
	"shadow-[inset_0_1px_0_0_rgba(255,255,255,0.20),0_6px_16px_-12px_rgba(0,0,0,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_8px_20px_-14px_rgba(0,0,0,0.7)]",
].join(" ");

export const glassVariantStyles: Record<FrostGlassVariant, string> = {
	clear: [
		"backdrop-blur-[2px] backdrop-saturate-[1.9]",
		"bg-white/[0.20] dark:bg-black/[0.12]",
		"border border-black/[0.08] dark:border-white/[0.12]",
		"shadow-[0_1px_12px_rgba(0,0,0,0.12)]",
	].join(" "),
	frosted: [
		"backdrop-blur-[10px] backdrop-saturate-[1.5]",
		"bg-white/[0.48] dark:bg-black/[0.34]",
		"border border-black/[0.08] dark:border-white/10",
		"shadow-[0_2px_20px_rgba(0,0,0,0.16)]",
	].join(" "),
	subtle: [
		// Nested layer: a faint brightening wash inside the parent veil, both
		// themes — never a second independent Glass.
		"backdrop-blur-[4px] backdrop-saturate-[1.5]",
		"bg-black/[0.045] dark:bg-white/[0.06]",
		"border border-black/[0.08] dark:border-white/[0.08]",
		"shadow-[0_1px_12px_rgba(0,0,0,0.2)]",
	].join(" "),
	// Liquid Glass is a material, not a theme palette. The regular density is
	// the canonical recipe for cards, controls, and other broad surfaces.
	liquid: liquidGlassStyles.regular,
	// Preserve the named menu variant as the dense member of the same family.
	"liquid-menu": liquidGlassStyles.dense,
	"liquid-refract": "",
	// Launcher tile pane: discreet, intensity-parametric, part of the family.
	"liquid-tile": liquidTileStyles,
};
