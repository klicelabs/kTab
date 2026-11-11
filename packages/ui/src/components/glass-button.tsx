"use client";

import { type FrostGlassVariantProp, glassVariantStyles } from "@ktab/ui/lib/glass-variants";
import { cn } from "@ktab/ui/lib/utils";

import { Button } from "./button";
import { LiquidGlass } from "./liquid-glass";

type GlassButtonProps = React.ComponentProps<typeof Button> & FrostGlassVariantProp;

/**
 * Glass-styled button.
 *
 * No cursor override on either branch: kTab uses the platform arrow
 * cursor for normal clickable UI. `Button` renders a real `<button>`, which
 * the UA stylesheet already gives an arrow, so nothing needs forcing here.
 */
function GlassButton({ className, glassVariant = "liquid-refract", ...props }: GlassButtonProps) {
  if (glassVariant === "liquid-refract") {
    return (
      <LiquidGlass blur={3}>
        <Button
          data-slot="glass-button"
          data-glass-variant={glassVariant}
          className={cn("border-0 bg-transparent text-[var(--ktab-glass-foreground-primary)] shadow-none", className)}
          {...props}
        />
      </LiquidGlass>
    );
  }

  return (
    <Button
      data-slot="glass-button"
      data-glass-variant={glassVariant}
      className={cn("text-[var(--ktab-glass-foreground-primary)]", glassVariantStyles[glassVariant], className)}
      {...props}
    />
  );
}

export { GlassButton };
