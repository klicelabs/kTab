import { LiquidGlass } from "@ktab/ui/components/liquid-glass";
import { glassVariantStyles } from "@ktab/ui/lib/glass-variants";
import { flatSurface } from "@ktab/ui/lib/surface";
import {
	type CSSProperties,
	type HTMLAttributes,
	useEffect,
	useRef,
} from "react";
import {
	type GlassShape,
	type GlassTier,
	glassLensVeil,
	glassLiquidProps,
	glassShape,
	glassTierVariant,
} from "../../../lib/glass";
import { cn } from "../../../lib/utils";
import { observeBackdropVisibility } from "../../../lib/visible-backdrops";
import { useAppearance, useGlassAppearance } from "../appearance-provider";

type GlassSurfaceProps = HTMLAttributes<HTMLDivElement> & {
	/** Product intent mapped to a glasscn material tier. */
	variant?: GlassTier;
	/**
	 * Shared corner role. Defaults per role: hero → toolbar capsule,
	 * search → caller passes searchCollapsed/searchExpanded explicitly,
	 * everything else → section squircle.
	 */
	shape?: GlassShape;
	/**
	 * Drop the Flat elevation (outer shadow) and keep only the face wash.
	 * Toolbar clusters (Tabbar shell) opt out — they sit on the wallpaper
	 * like macOS controls, never floating above it. Floating panels such as
	 * the Search overlay keep the default elevation.
	 */
	shadowless?: boolean;
};

/** Default corner role per semantic Glass role (concentricity by contract). */
const ROLE_SHAPE: Record<GlassTier, GlassShape> = {
	hero: "toolbar",
	toolbar: "toolbar",
	surface: "section",
	nested: "control",
	search: "searchExpanded",
	menu: "section",
	tooltip: "control",
	// The launcher tile pane carries the icon's own squircle (the icon radius
	// plus the pane padding), so it starts from the surface role and the
	// product CSS refines the radius.
	tile: "surface",
};

/**
 * The single material entry point for product chrome — `KtabGlassSurface`.
 *
 * Components request a semantic ROLE (hero / toolbar / surface / search /
 * menu / tooltip / nested); raw glasscn details (liquid-refract vs liquid
 * vs subtle, blur / refraction / saturation from the global Glass
 * intensity) stay centralized here. Individual product components must NOT
 * contain raw Glass recipes.
 *
 *   - Liquid Glass → the role's glasscn tier through ONE LiquidGlass node
 *     (refractive lens only for hero; every other role is the calm CSS
 *     material so repeated panels never pay for the SVG filter).
 *   - Flat → the flat shadcn surface from semantic tokens. Zero Glass.
 *
 * All transparency lives inside the library styles — never hardcode
 * bg-white/x here.
 */
export function GlassSurface({
	className,
	children,
	variant = "hero",
	shape,
	shadowless = false,
	style,
	...props
}: GlassSurfaceProps) {
	const { isLiquid, prefersContrastMore, resolvedDark, cornerScale } =
		useAppearance();
	const { glassParams } = useGlassAppearance();
	// prefers-contrast: more upgrades broad `surface` panels to the dense
	// `menu` tier so text survives any wallpaper. Hero keeps its lens.
	const effectiveVariant: GlassTier =
		prefersContrastMore && variant === "surface" ? "menu" : variant;
	const glassVariant = glassTierVariant(effectiveVariant);
	const resolvedShape = shape ?? ROLE_SHAPE[variant];
	// Refractive tiers own no veil in the variant map (liquid-refract is the
	// bare lens), so the role veil lands here: toolbar gets its isolated
	// milky/smoked recipe, hero its clearer sibling. Non-lens tiers already
	// carry their themed veils in the variant classes — never stack this.
	const lensVeil =
		effectiveVariant === "toolbar" || effectiveVariant === "hero"
			? glassLensVeil(effectiveVariant, resolvedDark)
			: "";
	const surfaceClassName = cn(
		"flex items-center",
		glassShape(resolvedShape),
		(variant === "hero" || variant === "toolbar") && "shadow-none",
		className,
	);

	if (isLiquid) {
		if (variant === "tile")
			return (
				<ViewportGlassTile
					{...props}
					data-glass-role={variant}
					data-glass-tone={resolvedDark ? "dark" : "light"}
					className={cn(
						"relative overflow-hidden text-[var(--ktab-glass-foreground-primary)]",
						surfaceClassName,
						glassVariantStyles[glassVariant],
					)}
					style={style}
				>
					{children}
				</ViewportGlassTile>
			);
		const refract = glassVariant === "liquid-refract";
		const optics = glassLiquidProps(
			glassParams,
			glassVariant === "liquid-menu" ? "dense" : "clear",
		);
		return (
			<LiquidGlass
				{...props}
				blur={optics.blur}
				refract={refract}
				refraction={optics.refraction}
				saturation={optics.saturation}
				brightness={optics.brightness}
				bezel={optics.bezel}
				shape={resolvedShape}
				geometryKey={cornerScale}
				data-glass-role={variant}
				data-glass-tone={resolvedDark ? "dark" : "light"}
				className={cn(
					surfaceClassName,
					lensVeil,
					glassVariantStyles[glassVariant],
				)}
				style={style as CSSProperties}
			>
				{children}
			</LiquidGlass>
		);
	}

	return (
		<div
			{...props}
			data-glass-role={variant}
			data-glass-tone={resolvedDark ? "dark" : "light"}
			className={cn(
				surfaceClassName,
				flatSurface("floating"),
				shadowless && "shadow-none",
			)}
			style={style}
		>
			{children}
		</div>
	);
}

/** Repeated tiles use the CSS material's own border/highlight, not another
 * masked LiquidGlass rim. Keep all item DOM for DnD/layout, but only allocate
 * live backdrop passes near the viewport (including one row of overscan). */
function ViewportGlassTile({
	children,
	style,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		return observeBackdropVisibility(element, (visible) => {
			element.dataset.glassBackdrop = visible ? "active" : "idle";
		});
	}, []);
	return (
		<div {...props} ref={ref} data-glass-backdrop="idle" style={style}>
			{children}
		</div>
	);
}

/**
 * Canonical product name for the shared material primitive. `GlassSurface`
 * remains as the historical alias; new code should read `KtabGlassSurface`
 * as the `KtabTheme → tokens → roles → primitives → components` layer.
 */
export const KtabGlassSurface = GlassSurface;
