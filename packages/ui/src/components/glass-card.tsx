"use client";

import { type HTMLAttributes, forwardRef } from "react";

import {
  type FrostGlassVariant,
  glassVariantStyles,
} from "@ktab/ui/lib/glass-variants";
import { ktabShape } from "@ktab/ui/lib/shapes";
import { cn } from "@ktab/ui/lib/utils";

import { LiquidGlass, type LiquidGlassProps } from "./liquid-glass";

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  /** Material of the card surface. */
  variant?: FrostGlassVariant | "flat";
  /** Props forwarded to the glasscn refractive surface. */
  liquidProps?: Omit<LiquidGlassProps, "children">;
  /** Classes applied to the outer glasscn surface. */
  surfaceClassName?: string;
};

/**
 * A glasscn card surface. This is the single component the Speed Dial uses for
 * every card-shaped tile (site cards, folder tiles, the "New Folder"
 * placeholder), so transparency is always managed by the library and never by
 * ad-hoc bg-white/x + backdrop-blur in feature code.
 *
 * Rounding is left to the consumer (via className) so the card can inherit the
 * user's configurable corner radius.
 */
const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  {
    // Cards are repeated/content-heavy surfaces. Hero callers opt into
    // `liquid-refract` explicitly instead of making every card pay for the
    // SVG lens by default.
    variant = "liquid",
    className,
    liquidProps,
    surfaceClassName,
    ...props
  },
  ref,
) {
  if (variant === "liquid-refract") {
    return (
      <LiquidGlass
        {...liquidProps}
        ref={ref}
        className={cn(
          ktabShape("surface"),
          surfaceClassName,
          liquidProps?.className,
        )}
      >
        <div
          data-slot="glass-card"
          data-glass-variant={variant}
          className={cn(
				"relative overflow-hidden border-0 bg-transparent text-[var(--ktab-glass-foreground-primary)] shadow-none",
            ktabShape("surface"),
            className,
          )}
          {...props}
        />
      </LiquidGlass>
    );
  }

  const material = variant === "flat" ? "border border-border bg-card shadow-sm" : glassVariantStyles[variant];

  return (
    <div
      ref={ref}
      data-slot="glass-card"
      data-glass-variant={variant}
		className={cn("relative overflow-hidden text-[var(--ktab-glass-foreground-primary)]", material, className)}
      {...props}
    />
  );
});

export { GlassCard, type GlassCardProps };
