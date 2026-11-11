import { cn } from "@ktab/ui/lib/utils";
import * as React from "react";

type SidebarState = "expanded" | "collapsed";

interface SidebarContextValue {
	state: SidebarState;
	open: boolean;
	setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
	isMobile: boolean;
	openMobile: boolean;
	setOpenMobile: (open: boolean) => void;
	toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebar() {
	const context = React.useContext(SidebarContext);
	if (!context) {
		throw new Error("useSidebar must be used within a SidebarProvider.");
	}
	return context;
}

interface SidebarProviderProps extends React.ComponentProps<"div"> {
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/**
 * Layout context for an in-flow sidebar. The provider owns state and shared
 * width tokens; the consumer decides whether an open state is animated.
 * Keeping the primitive free of portals/backdrops makes it useful for push
 * layouts as well as the usual shadcn sidebar compositions.
 */
function SidebarProvider({
	defaultOpen = true,
	open: openProp,
	onOpenChange,
	className,
	style,
	children,
	...props
}: SidebarProviderProps) {
	const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
	const [openMobile, setOpenMobile] = React.useState(false);
	const open = openProp ?? internalOpen;

	const setOpen = React.useCallback(
		(value: boolean | ((open: boolean) => boolean)) => {
			const next = typeof value === "function" ? value(open) : value;
			if (openProp === undefined) setInternalOpen(next);
			onOpenChange?.(next);
		},
		[onOpenChange, open, openProp],
	);

	const toggleSidebar = React.useCallback(() => {
		setOpen((current) => !current);
	}, [setOpen]);

	const value = React.useMemo<SidebarContextValue>(
		() => ({
			state: open ? "expanded" : "collapsed",
			open,
			setOpen,
			// The extension's new-tab sidebar stays in the shared layout at every
			// supported width. Mobile overlay behavior belongs to Sheet, not here.
			isMobile: false,
			openMobile,
			setOpenMobile,
			toggleSidebar,
		}),
		[open, openMobile, setOpen, toggleSidebar],
	);

	return (
		<SidebarContext.Provider value={value}>
			<div
				data-slot="sidebar-wrapper"
				data-state={value.state}
				style={
					{
						"--sidebar-width": "16rem",
						...style,
					} as React.CSSProperties
				}
				className={cn(
					"group/sidebar-wrapper flex h-full min-h-svh w-full min-w-0",
					className,
				)}
				{...props}
			>
				{children}
			</div>
		</SidebarContext.Provider>
	);
}

interface SidebarProps extends React.ComponentProps<"aside"> {
	side?: "left" | "right";
	variant?: "sidebar" | "floating" | "inset";
	collapsible?: "offcanvas" | "icon" | "none";
}

/**
 * The visual sidebar surface. Unlike Sheet, this is deliberately an ordinary
 * in-flow aside: its parent layout can contract the sibling inset instead of
 * covering it with a fixed layer.
 */
function Sidebar({
	side = "left",
	variant = "sidebar",
	collapsible = "offcanvas",
	className,
	children,
	...props
}: SidebarProps) {
	const { state } = useSidebar();

	return (
		<aside
			data-slot="sidebar"
			data-side={side}
			data-state={state}
			data-variant={variant}
			data-collapsible={collapsible}
			className={cn(
				"group/sidebar flex h-full min-h-0 w-(--sidebar-width) min-w-0 shrink-0 flex-col text-sidebar-foreground",
				variant === "floating" && "squircle rounded-2xl shadow-floating",
				className,
			)}
			{...props}
		>
			{children}
		</aside>
	);
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
	return (
		<main
			data-slot="sidebar-inset"
			className={cn(
				"relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-header"
			className={cn("flex shrink-0 flex-col gap-2", className)}
			{...props}
		/>
	);
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-content"
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col overflow-auto",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-footer"
			className={cn("mt-auto flex shrink-0 flex-col gap-2", className)}
			{...props}
		/>
	);
}

export {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	useSidebar,
};
