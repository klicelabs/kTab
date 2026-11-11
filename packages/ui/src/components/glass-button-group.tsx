"use client";

import {
	type FrostGlassVariantProp,
	glassVariantStyles,
} from "@ktab/ui/lib/glass-variants";
import { ktabShape, type KtabShapeName } from "@ktab/ui/lib/shapes";
import { cn } from "@ktab/ui/lib/utils";

import { ButtonGroup } from "./button-group";
import { LiquidGlass, type LiquidGlassProps } from "./liquid-glass";

type GlassButtonGroupProps = React.ComponentProps<typeof ButtonGroup> &
	FrostGlassVariantProp & {
		/**
		 * Corner role for the whole group. Applied to the refractive surface
		 * AND to the ButtonGroup, so the surface and the outer ends of its
		 * segments resolve to the same geometry. Defaults to the grouped
		 * toolbar capsule.
		 */
		shape?: KtabShapeName;
		/** Extra classes applied to the outer LiquidGlass surface only. */
		surfaceClassName?: string;
		/** Optical recipe forwarded to the refractive surface (e.g. global Glass intensity). */
		liquidProps?: Omit<LiquidGlassProps, "children" | "shape">;
	};

/**
 * Glasscn's grouped button material. The refractive surface owns one shared
 * material while ButtonGroup owns segment clipping and focus order.
 *
 * The group is ONE object: the surface cannot carry a different corner role
 * from the segments inside it. Passing `shape` through to both — instead of
 * letting each layer append its own `rounded-*` class — is what guarantees
 * that, because the kTab corner roles are plain CSS classes and two of them
 * on one element would both apply, with only stylesheet order deciding which
 * one rendered.
 */
function GlassButtonGroup({
	className,
	glassVariant = "liquid-refract",
	shape = "toolbarGroup",
	surfaceClassName,
	liquidProps,
	children,
	...props
}: GlassButtonGroupProps) {
	const groupShape = ktabShape(shape);

	if (glassVariant === "liquid-refract") {
		return (
			<LiquidGlass
				{...liquidProps}
				shape={shape}
				className={cn("w-fit", surfaceClassName, liquidProps?.className)}
			>
				<ButtonGroup
					data-slot="glass-button-group"
					data-glass-variant={glassVariant}
					className={cn(groupShape, "bg-transparent text-[var(--ktab-glass-foreground-primary)]", className)}
					{...props}
				>
					{children}
				</ButtonGroup>
			</LiquidGlass>
		);
	}

	return (
		<ButtonGroup
			data-slot="glass-button-group"
			data-glass-variant={glassVariant}
			className={cn(
				groupShape,
				glassVariantStyles[glassVariant],
				"text-[var(--ktab-glass-foreground-primary)]",
				className,
			)}
			{...props}
		>
			{children}
		</ButtonGroup>
	);
}

export { GlassButtonGroup };
