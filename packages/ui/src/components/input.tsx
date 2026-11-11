import { Input as InputPrimitive } from "@base-ui/react/input";
import {
	type FrostGlassVariant,
	glassVariantStyles,
} from "@ktab/ui/lib/glass-variants";
import { cn } from "@ktab/ui/lib/utils";
import type * as React from "react";

import { LiquidGlass } from "./liquid-glass";

const INPUT_BASE =
	"squircle h-9 w-full min-w-0 rounded-lg border px-3 py-1 text-base outline-none transition-[border-color,background-color,color,box-shadow] duration-200 ease-in-out [--squircle-r:calc(var(--radius)*0.6)] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

function Input({
	className,
	type,
	glassVariant,
	...props
}: React.ComponentProps<"input"> & {
	glassVariant?: FrostGlassVariant | "classic";
}) {
	const isGlass = glassVariant && glassVariant !== "classic";
	const inputClassName = cn(
		INPUT_BASE,
		glassVariant === "liquid-refract"
			? "border-0 bg-transparent text-[var(--ktab-glass-foreground-primary)] shadow-none"
			: isGlass
				? cn(
						glassVariantStyles[glassVariant],
						"border-black/[0.12] text-[var(--ktab-glass-foreground-primary)] placeholder:text-[var(--ktab-glass-foreground-secondary)] dark:border-white/[0.16]",
					)
				: "border-transparent bg-input/50 file:text-foreground",
		className,
	);

	if (glassVariant === "liquid-refract") {
		return (
			<LiquidGlass className="w-full rounded-lg" blur={3}>
				<InputPrimitive
					type={type}
					data-slot="input"
					data-glass-variant={glassVariant}
					className={inputClassName}
					{...props}
				/>
			</LiquidGlass>
		);
	}

	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			data-glass-variant={isGlass ? glassVariant : undefined}
			className={inputClassName}
			{...props}
		/>
	);
}

export { Input };
