"use client";

// beui.dev/components/motion/tabs

import { EASE_OUT, SPRING_SEGMENT } from "@ktab/ui/lib/ease";
import { ktabShape } from "@ktab/ui/lib/shapes";
import { cn } from "@ktab/ui/lib/utils";
import {
	MotionConfig,
	motion,
	type Transition,
	useReducedMotion,
} from "motion/react";
import {
	cloneElement,
	createContext,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useId,
	useMemo,
	useState,
} from "react";

type Variant = "pill" | "underline" | "segment";
export type TabsDirection = "forward" | "back";

type TriggerRenderProps = {
	className?: string;
	onClick?: (event: MouseEvent<HTMLElement>) => void;
	role?: string;
	"aria-selected"?: boolean;
	"data-tabs-direction"?: TabsDirection;
};

type Ctx = {
	value: string;
	setValue: (v: string) => void;
	layoutId: string;
	variant: Variant;
	direction?: TabsDirection;
};

const TabsCtx = createContext<Ctx | null>(null);

function useTabs() {
	const ctx = useContext(TabsCtx);
	if (!ctx) throw new Error("Tabs.* must be used inside <Tabs>");
	return ctx;
}

// The tabbar is a high-frequency navigation control. Use the short segment
// spring so it retargets immediately without the heavy, lingering feel of a
// mass-1.2 layout spring.
const transition: Transition = SPRING_SEGMENT;

export function Tabs({
	defaultValue,
	value,
	onValueChange,
	variant = "pill",
	direction,
	children,
	className,
}: {
	defaultValue?: string;
	value?: string;
	onValueChange?: (v: string) => void;
	variant?: Variant;
	direction?: TabsDirection;
	children: ReactNode;
	className?: string;
}) {
	const [internal, setInternal] = useState(defaultValue ?? "");
	const layoutId = useId();
	const reduce = useReducedMotion();
	const controlled = value !== undefined;
	const current = controlled ? value : internal;
	const setValue = useCallback(
		(v: string) => {
			if (!controlled) setInternal(v);
			onValueChange?.(v);
		},
		[controlled, onValueChange],
	);
	const contextValue = useMemo(
		() => ({ value: current, setValue, layoutId, variant, direction }),
		[current, direction, layoutId, setValue, variant],
	);

	return (
		<MotionConfig transition={reduce ? { duration: 0 } : transition}>
			<TabsCtx.Provider value={contextValue}>
				{/* layoutRoot: the indicator's layoutId measures in page coordinates, so
				    inside fixed/scrolled containers it would replay scroll offsets as
				    movement. The pill only ever travels within the list, so scoping
				    projection to the Tabs wrapper is always correct. */}
				<motion.div
					layoutRoot
					className={className}
					data-tabs-direction={direction}
				>
					{children}
				</motion.div>
			</TabsCtx.Provider>
		</MotionConfig>
	);
}

const listClasses: Record<Variant, string> = {
	pill: cn("inline-flex items-center gap-1 bg-card p-1", ktabShape("toolbar")),
	underline: "inline-flex items-center gap-1 border-b border-border",
	segment: cn(
		"inline-flex items-center gap-0 bg-card p-0.5",
		ktabShape("control"),
	),
};

export function TabsList({
	children,
	className,
	ariaLabel,
}: {
	children: ReactNode;
	className?: string;
	ariaLabel?: string;
}) {
	const { variant } = useTabs();
	return (
		<div
			role="tablist"
			aria-label={ariaLabel}
			className={cn(listClasses[variant], className)}
		>
			{children}
		</div>
	);
}

export function TabsTrigger({
	value,
	children,
	className,
	indicatorClassName,
	render,
}: {
	value: string;
	children?: ReactNode;
	className?: string;
	indicatorClassName?: string;
	/** Optional composed trigger. This keeps DnD/context-menu ownership on the
	 * actual button while the beUI indicator remains the motion owner. */
	render?: ReactElement;
}) {
	const { value: current, setValue, layoutId, variant, direction } = useTabs();
	const active = current === value;

	const handleClick = (event: MouseEvent<HTMLElement>) => {
		if (event.defaultPrevented) return;
		setValue(value);
	};

	if (variant === "underline") {
		const trigger = render ? (
			cloneElement(render as ReactElement<TriggerRenderProps>, {
				role: "tab",
				"aria-selected": active,
				"data-tabs-direction": direction,
				className: cn(
					className,
					(render.props as TriggerRenderProps).className,
				),
				onClick: handleClick,
			})
		) : (
			<button
				type="button"
				role="tab"
				aria-selected={active}
				onClick={handleClick}
				className={cn(
					"relative isolate -mb-px inline-flex min-h-[44px] items-center px-3 pt-1 pb-2.5 font-medium text-sm transition-colors",
					active
						? "text-foreground"
						: "text-muted-foreground hover:text-foreground",
					className,
				)}
			>
				{children}
				{active ? (
					<motion.span
						layoutId={layoutId}
						layout="position"
						className={cn(
							"absolute right-0 -bottom-px left-0 h-px bg-primary",
							indicatorClassName,
						)}
					/>
				) : null}
			</button>
		);
		return (
			<div className="relative">
				{render ? trigger : null}
				{render && active ? (
					<motion.span
						layoutId={layoutId}
						layout="position"
						className={cn(
							"pointer-events-none absolute right-0 -bottom-px left-0 h-px bg-primary",
							indicatorClassName,
						)}
					/>
				) : null}
			</div>
		);
	}

	const radius =
		variant === "pill" ? ktabShape("toolbarControl") : ktabShape("control");
	const trigger = render ? (
		cloneElement(render as ReactElement<TriggerRenderProps>, {
			role: "tab",
			"aria-selected": active,
			"data-tabs-direction": direction,
			className: cn(
				"relative z-10",
				className,
				(render.props as TriggerRenderProps).className,
			),
			onClick: handleClick,
		})
	) : (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={handleClick}
			className={cn(
				"relative z-10 inline-flex items-center justify-center whitespace-nowrap bg-transparent px-3.5 py-1.5 font-medium text-sm outline-none transition-colors",
				active
					? "text-primary-foreground"
					: "text-muted-foreground hover:text-foreground",
				radius,
				className,
			)}
		>
			{children}
		</button>
	);

	return (
		<div className="relative" data-tabs-trigger={value}>
			{active ? (
				<motion.span
					layoutId={layoutId}
					layout="position"
					// No inline radius: the role class below already resolves
					// --shape-control (or the toolbar capsule) per corner tier,
					// so the sliding surface stays concentric with the trigger
					// and follows the preference.
					className={cn(
						"pointer-events-none absolute inset-0 bg-primary",
						radius,
						indicatorClassName,
					)}
				/>
			) : null}
			{trigger}
		</div>
	);
}

export function TabsContent({
	value,
	children,
	className,
}: {
	value: string;
	children: ReactNode;
	className?: string;
}) {
	const { value: current } = useTabs();
	const reduce = useReducedMotion();
	const active = current === value;
	if (!active) {
		return (
			<div hidden className={className}>
				{children}
			</div>
		);
	}
	return (
		<motion.div
			key={value}
			initial={{ opacity: 0, y: reduce ? 0 : 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.18, ease: EASE_OUT }}
			className={cn("mt-4", className)}
		>
			{children}
		</motion.div>
	);
}
