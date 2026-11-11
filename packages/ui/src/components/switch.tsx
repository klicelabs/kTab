"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@ktab/ui/lib/utils";

function Switch({
	className,
	size = "default",
	...props
}: SwitchPrimitive.Root.Props & {
	size?: "sm" | "default";
}) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={size}
			className={cn(
				"peer group/switch relative inline-flex shrink-0 items-center rounded-full border-2 outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/20 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 data-[size=default]:h-5 data-[size=sm]:h-5 data-[size=default]:w-9 data-[size=sm]:w-9 data-disabled:cursor-not-allowed data-checked:border-primary data-unchecked:border-transparent data-checked:bg-primary data-unchecked:bg-input/90 data-disabled:opacity-50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block rounded-full bg-background not-dark:bg-clip-padding shadow-sm ring-0 transition-transform duration-150 data-checked:translate-x-full data-unchecked:translate-x-0 group-data-[size=default]/switch:h-4 group-data-[size=sm]/switch:h-4 group-data-[size=default]/switch:w-4 group-data-[size=sm]/switch:w-4 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
