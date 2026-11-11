"use client";

import { type KtabShapeName, ktabShape } from "@ktab/ui/lib/shapes";

import { cn } from "@ktab/ui/lib/utils";
import {
	type CSSProperties,
	forwardRef,
	type HTMLAttributes,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

type MapGeometry = {
	width: number; // element width, CSS px, integer
	height: number; // element height, CSS px, integer
	radius: number; // corner radius, CSS px, already clamped to min(width, height) / 2
	bezel: number; // fraction (0..1] of the half-min-dimension used as the refractive band
};

const MAX_TEXTURE_SIZE = 480;
const EDGE_TAPER_PX = 1.25;
/** Keep every glasscn refraction surface inside the app's blur budget. */
export const MAX_LIQUID_GLASS_BLUR = 12;
/** Keep refraction visible but prevent extreme edge displacement on tiny UI. */
export const MAX_LIQUID_GLASS_REFRACTION = 48;

const displacementMapCache = new Map<string, string>();

// CSS.supports("backdrop-filter", "url(#f)") returns true in Safari and
// Firefox (they parse the value) but neither browser actually renders SVG
// filters through backdrop-filter. UA sniffing is the only reliable approach.
// When WebKit ships support (track WebKit bug 245510), loosen this function.
function supportsSvgBackdropFilter() {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	const isChromium = /Chrom(e|ium)/.test(ua) || /Edg\//.test(ua);
	return isChromium && !/Firefox/.test(ua);
}

// NOTE: Per-corner radii and percentage radii are NOT supported. The map
// reads only borderTopLeftRadius in px. If a future consumer needs
// asymmetric corners, extend the corner SDF branch to accept four radii.
//
// NOTE: Map regeneration renders a ≤480 px texture and encodes a PNG for
// each unique (width, height, radius, bezel). Continuously animating the
// element's SIZE will thrash the cache; animate transform: scale instead.
function createDisplacementMap({ width, height, radius, bezel }: MapGeometry) {
	const cacheKey = `${width}:${height}:${radius}:${bezel}`;
	const cached = displacementMapCache.get(cacheKey);
	if (cached !== undefined) return cached;

	const downscale = Math.min(1, MAX_TEXTURE_SIZE / Math.max(width, height));
	const texWidth = Math.max(2, Math.round(width * downscale));
	const texHeight = Math.max(2, Math.round(height * downscale));

	const canvas = document.createElement("canvas");
	canvas.width = texWidth;
	canvas.height = texHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) return "";

	const image = ctx.createImageData(texWidth, texHeight);
	const data = image.data;
	const halfWidth = width / 2;
	const halfHeight = height / 2;
	const r = Math.min(radius, halfWidth, halfHeight);
	const bezelPx = Math.max(1, bezel * Math.min(halfWidth, halfHeight));

	for (let ty = 0; ty < texHeight; ty += 1) {
		for (let tx = 0; tx < texWidth; tx += 1) {
			// Texel center in element coordinates, origin at element center.
			const px = ((tx + 0.5) / texWidth) * width - halfWidth;
			const py = ((ty + 0.5) / texHeight) * height - halfHeight;

			// Signed distance + outward normal of the rounded-rectangle contour.
			const qx = Math.abs(px) - (halfWidth - r);
			const qy = Math.abs(py) - (halfHeight - r);
			let signedDistance: number;
			let dirX = 0;
			let dirY = 0;
			if (qx > 0 && qy > 0) {
				const len = Math.hypot(qx, qy);
				signedDistance = len - r;
				dirX = (Math.sign(px) * qx) / len;
				dirY = (Math.sign(py) * qy) / len;
			} else if (qx > qy) {
				signedDistance = qx - r;
				dirX = Math.sign(px);
			} else {
				signedDistance = qy - r;
				dirY = Math.sign(py);
			}

			const index = (ty * texWidth + tx) * 4;
			const inside = -signedDistance; // px from the contour, positive inside

			if (inside <= 0) {
				data[index] = 128;
				data[index + 1] = 128;
				data[index + 2] = 128;
				data[index + 3] = 255;
				continue;
			}

			const t = Math.min(1, inside / bezelPx); // 0 at the edge → 1 at the bezel's inner end
			let magnitude = 1 - convexSquircle(t); // max refraction at the edge, optically flat interior
			magnitude *= Math.min(1, inside / EDGE_TAPER_PX); // avoid sampling artifacts on the outermost pixels

			data[index] = Math.round(128 + dirX * magnitude * 127);
			data[index + 1] = Math.round(128 + dirY * magnitude * 127);
			data[index + 2] = 128;
			data[index + 3] = 255;
		}
	}

	ctx.putImageData(image, 0, 0);
	const mapUrl = canvas.toDataURL("image/png");
	displacementMapCache.set(cacheKey, mapUrl);
	return mapUrl;
}

function convexSquircle(x: number) {
	return (1 - (1 - x) ** 4) ** 0.25;
}

export type LiquidGlassProps = HTMLAttributes<HTMLDivElement> & {
	/** Disable the SVG lens while keeping the same mounted glass surface. */
	refract?: boolean;
	/** Extra blur mixed into the backdrop-filter after the SVG refraction. */
	blur?: number;
	/** SVG displacement strength. Higher values bend the sampled backdrop more. */
	refraction?: number;
	/**
	 * @deprecated Texture size now derives from element size. Accepted for
	 * backwards-compatibility but has no effect.
	 */
	mapSize?: number;
	/** Fraction of the radius used as the curved edge where most refraction happens. */
	bezel?: number;
	/** Backdrop saturation. */
	saturation?: number;
	/**
	 * Backdrop brightness (standard CSS backdrop-filter). Dark-on-wallpaper
	 * heroes pull this below 1 for white-ink contrast; Light stays near 1.
	 * Clamped 0.5…1.2 at the material boundary.
	 */
	brightness?: number;
	/**
	 * Corner role for the glass surface. Defaults to the generic `surface`
	 * role, but a consumer that owns a stronger geometry contract (a toolbar
	 * capsule, an icon chip) must pass its own role here.
	 *
	 * This is a prop rather than something the consumer appends through
	 * `className` on purpose: the corner roles are plain CSS classes, so two of
	 * them landing on one element would both apply and only the stylesheet
	 * order would decide which one rendered. Passing the role in keeps exactly
	 * one shape on the surface. Use `"none"` for a caller that supplies its own.
	 */
	shape?: KtabShapeName | "none";
	/**
	 * Opaque value that changes whenever the surface's corner geometry can
	 * change without a resize (e.g. the corner-scale token). The lens map is
	 * regenerated when it changes; the computed radius is re-read on the next
	 * frame so the root CSS variable has already been applied.
	 */
	geometryKey?: string | number;
};

export const LiquidGlass = forwardRef<HTMLDivElement, LiquidGlassProps>(
	function LiquidGlass(
		{
			refract = true,
			blur = 3,
			refraction = 15,
			mapSize: _mapSize,
			bezel = 0.34,
			saturation = 1.28,
			brightness = 1,
			shape = "surface",
			geometryKey,
			className,
			style,
			children,
			...props
		},
		ref,
	) {
		const rawId = useId();
		const filterId = useMemo(
			() => `liquid-glass-${rawId.replace(/:/g, "")}`,
			[rawId],
		);
		const canUseSvgRefraction = useMemo(() => supportsSvgBackdropFilter(), []);

		// -------------------------------------------------------------------------
		// Ref merge — we need the DOM node to measure geometry while still
		// forwarding the ref to the consumer.
		// -------------------------------------------------------------------------

		const localRef = useRef<HTMLDivElement | null>(null);
		const setRefs = useCallback(
			(node: HTMLDivElement | null) => {
				localRef.current = node;
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
			},
			[ref],
		);

		// -------------------------------------------------------------------------
		// Geometry measurement via ResizeObserver
		// -------------------------------------------------------------------------

		const [geometry, setGeometry] = useState<MapGeometry | null>(null);

		useEffect(() => {
			if (!refract || !canUseSvgRefraction) return;
			const el = localRef.current;
			if (!el) return;
			// Referenced so a tier change invalidates the cached lens map even when
			// the element's size does not change.
			void geometryKey;
			const measure = () => {
				const rect = el.getBoundingClientRect();
				const width = Math.round(rect.width);
				const height = Math.round(rect.height);
				if (!width || !height) return;
				const parsed = Number.parseFloat(
					getComputedStyle(el).borderTopLeftRadius,
				);
				const radius = Math.min(
					Number.isFinite(parsed) ? parsed : Math.min(width, height) / 2,
					width / 2,
					height / 2,
				);
				setGeometry((prev) =>
					prev &&
					prev.width === width &&
					prev.height === height &&
					prev.radius === radius &&
					prev.bezel === bezel
						? prev
						: { width, height, radius, bezel },
				);
			};
			measure();
			// Re-read after paint: a geometryKey change (corner tier) is applied to
			// the root by a parent effect, which can run after this child effect.
			// The rAF guarantees the lens map sees the settled computed radius.
			const frame = requestAnimationFrame(measure);
			// A tier change can animate border-radius (the search morph uses the
			// same 160 ms timeline). rAF alone samples the start value; the
			// transitionend re-read captures the settled endpoint. Chrome emits
			// one event per physical corner (border-top-left-radius, …), so match
			// the radius suffix rather than the shorthand.
			const onTransitionEnd = (event: TransitionEvent) => {
				if (event.propertyName.endsWith("-radius")) measure();
			};
			el.addEventListener("transitionend", onTransitionEnd);
			const observer = new ResizeObserver(measure);
			observer.observe(el);
			return () => {
				cancelAnimationFrame(frame);
				el.removeEventListener("transitionend", onTransitionEnd);
				observer.disconnect();
			};
		}, [bezel, canUseSvgRefraction, geometryKey, refract]);

		const mapUrl = useMemo(
			() => (refract && geometry ? createDisplacementMap(geometry) : ""),
			[geometry, refract],
		);

		// -------------------------------------------------------------------------
		// Browser capability gate
		//
		// Both SSR and the first client render take the fallback branch so hydration
		// never mismatches. The state is set in an effect (client-only).
		// -------------------------------------------------------------------------

		const [supported, setSupported] = useState(false);

		useEffect(() => {
			if (!refract || !canUseSvgRefraction) return;
			setSupported(true);
		}, [canUseSvgRefraction, refract]);

		// `blur` is public API, so clamp it at the material boundary rather than
		// relying on every consumer to remember the performance budget. The
		// fallback adds a small optical cushion, but must stay inside the same cap.
		const effectiveBlur = Math.min(MAX_LIQUID_GLASS_BLUR, Math.max(0, blur));
		const effectiveRefraction = Math.min(
			MAX_LIQUID_GLASS_REFRACTION,
			Math.max(0, refraction),
		);
		const effectiveBrightness = Math.min(1.2, Math.max(0.5, brightness));
		const refractionActive = refract && supported && mapUrl !== "";
		const backdropFilter = refractionActive
			? `url(#${filterId}) blur(${effectiveBlur}px) saturate(${saturation}) brightness(${effectiveBrightness})`
			: refract
				? `blur(${Math.min(MAX_LIQUID_GLASS_BLUR, effectiveBlur + 2)}px) saturate(${saturation}) brightness(${effectiveBrightness})`
				: undefined;

		return (
			<>
				<div
					ref={setRefs}
					className={cn(
						"relative overflow-hidden bg-white/[0.04] text-[var(--ktab-glass-foreground-primary)] dark:bg-black/[0.06]",
						shape !== "none" && ktabShape(shape),
						className,
					)}
					style={
						{
							...style,
							...(backdropFilter
								? { backdropFilter, WebkitBackdropFilter: backdropFilter }
								: {}),
						} as CSSProperties
					}
					{...props}
				>
					{children}
					<span
						aria-hidden
						// `rounded-[inherit]` copies the radius, and `ktab-corner-inherit`
						// copies `corner-shape` (which is NOT an inherited property).
						// Without the second one the hairline rim traces a circular arc while
						// the surface itself is a squircle, and the control appears to have
						// two different outlines.
						className="ktab-corner-inherit pointer-events-none absolute inset-0 rounded-[inherit]"
						style={{
							// Rim thickness, overridable per-consumer via --liquid-glass-rim-width.
							padding: "var(--liquid-glass-rim-width, 0.5px)",
							background:
								// iOS 27 liquid-glass rim. Each gradient runs ALONG its edges and
								// fades to nothing at the corners, uniform in between:
								//   - to right  → white streak on the top + bottom runs
								//   - to bottom → dark streak on the left + right runs
								// Streak colors are overridable per-consumer via the
								// --liquid-glass-rim-light / --liquid-glass-rim-dark variables;
								// --liquid-glass-rim-fade sets how far from each corner the
								// streak takes to reach full strength (smaller = longer streak).
								"linear-gradient(to right, rgba(255,255,255,0), var(--liquid-glass-rim-light, rgba(255,255,255,0.25)) var(--liquid-glass-rim-fade, 18%), var(--liquid-glass-rim-light, rgba(255,255,255,0.25)) calc(100% - var(--liquid-glass-rim-fade, 18%)), rgba(255,255,255,0)), " +
								"linear-gradient(to bottom, rgba(0,0,0,0), var(--liquid-glass-rim-dark, rgba(0,0,0,0.2)) var(--liquid-glass-rim-fade, 18%), var(--liquid-glass-rim-dark, rgba(0,0,0,0.2)) calc(100% - var(--liquid-glass-rim-fade, 18%)), rgba(0,0,0,0))",
							WebkitMask:
								"linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
							WebkitMaskComposite: "xor",
							mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)",
						}}
					/>
				</div>

				{refractionActive && (
					<svg
						className="absolute size-0 overflow-hidden"
						aria-hidden="true"
						role="presentation"
					>
						<filter
							id={filterId}
							x="0"
							y="0"
							width="100%"
							height="100%"
							colorInterpolationFilters="sRGB"
						>
							<feImage
								href={mapUrl}
								x="0"
								y="0"
								width="100%"
								height="100%"
								preserveAspectRatio="none"
								result="map"
							/>
							<feDisplacementMap
								in="SourceGraphic"
								in2="map"
								scale={effectiveRefraction}
								xChannelSelector="R"
								yChannelSelector="G"
								result="displaced"
							/>
							<feGaussianBlur in="displaced" stdDeviation="0.15" />
						</filter>
					</svg>
				)}
			</>
		);
	},
);
