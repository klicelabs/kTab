import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@ktab/ui/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverPortal({ ...props }: PopoverPrimitive.Portal.Props) {
	return <PopoverPrimitive.Portal data-slot="popover-portal" {...props} />;
}

function PopoverPositioner({
	className,
	...props
}: PopoverPrimitive.Positioner.Props) {
	return (
		<PopoverPrimitive.Positioner
			data-slot="popover-positioner"
			className={cn("z-50", className)}
			{...props}
		/>
	);
}

function PopoverPopup({ className, ...props }: PopoverPrimitive.Popup.Props) {
	return (
		<PopoverPrimitive.Popup
			data-slot="popover-popup"
			className={cn(
				"data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 outline-none data-closed:animate-out data-open:animate-in",
				className,
			)}
			{...props}
		/>
	);
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
	return (
		<PopoverPrimitive.Title
			data-slot="popover-title"
			className={cn(
				"font-heading font-medium text-base leading-none",
				className,
			)}
			{...props}
		/>
	);
}

function PopoverDescription({
	className,
	...props
}: PopoverPrimitive.Description.Props) {
	return (
		<PopoverPrimitive.Description
			data-slot="popover-description"
			className={cn("text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
	return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

export {
	Popover,
	PopoverClose,
	PopoverDescription,
	PopoverPopup,
	PopoverPortal,
	PopoverPositioner,
	PopoverTitle,
	PopoverTrigger,
};
