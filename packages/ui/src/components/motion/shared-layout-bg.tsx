"use client";

import { SPRING_LAYOUT } from "@ktab/ui/lib/ease";
import { cn } from "@ktab/ui/lib/utils";
import {
	AnimatePresence,
	type HTMLMotionProps,
	motion,
	useReducedMotion,
	type Variants,
} from "motion/react";
import {
	Children,
	cloneElement,
	forwardRef,
	type HTMLAttributes,
	isValidElement,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	type Ref,
	useId,
	useState,
} from "react";

export interface SharedLayoutBgProps
	extends Omit<HTMLAttributes<HTMLElement>, "children"> {
	children: ReactNode;
	/** Semantic container used for the children. */
	as?: "div" | "ul";
	/** Tailwind class applied to the moving pill. Defaults to a subtle foreground tint. */
	pillClassName?: string;
	/** Horizontal inset of the pill relative to each row (px). Default 20. */
	inset?: number;
	/** Optional positioning override for the pill wrapper inside each item. */
	pillContainerClassName?: string;
	/**
	 * Controlled pill key. When defined (even as null), the moving pill
	 * follows this key instead of pointer hover — unifying keyboard
	 * selection and pointer hover into ONE visual surface. Children still
	 * drive it by updating the key (e.g. onMouseEnter → selection), so no
	 * interaction logic changes. Absent = legacy pointer-hover behavior.
	 */
	activeKey?: string | null;
}

const variants: Variants = {
	initial: { opacity: 0 },
	animate: { opacity: 1 },
	exit: (isActive: boolean) => (!isActive ? { opacity: 0 } : {}),
};

const reducedVariants: Variants = {
	initial: { opacity: 0 },
	animate: { opacity: 1 },
	exit: (isActive: boolean) => (!isActive ? { opacity: 0 } : {}),
};

export const SharedLayoutBg = forwardRef<HTMLElement, SharedLayoutBgProps>(
	function SharedLayoutBg(
		{
			children,
			as = "div",
			className,
			onMouseLeave,
			pillClassName,
			pillContainerClassName,
			inset = 20,
			activeKey,
			...props
		},
		forwardedRef,
	) {
		const [hoveredKey, setHoveredKey] = useState<string | null>(null);
		const uid = useId();
		const reduce = useReducedMotion();
		// Controlled mode (activeKey defined) unifies pointer + keyboard into
		// one surface; uncontrolled keeps the legacy hover-only pill.
		const effectiveActiveKey = activeKey !== undefined ? activeKey : hoveredKey;

		const renderedChildren = Children.toArray(children)
			.filter(isValidElement)
			.map((child, index) => {
				const el = child as ReactElement<{
					className?: string;
					onMouseEnter?: () => void;
					children?: ReactNode;
					["data-shared-bg-skip"]?: unknown;
				}>;
				const childKey = el.key ? String(el.key) : `item-${index}`;
				// Non-interactive rows (section labels, empty states) opt out
				// via data-shared-bg-skip: rendered untouched, never hosting
				// the pill, never stealing it on hover.
				if ("data-shared-bg-skip" in el.props) return el;
				return cloneElement(
					el,
					{
						key: childKey,
						className: cn("relative", el.props.className),
						onMouseEnter: () => {
							el.props.onMouseEnter?.();
							setHoveredKey(childKey);
						},
					},
					<>
						<AnimatePresence custom={effectiveActiveKey !== null}>
							{effectiveActiveKey !== null ? (
								<motion.div
									variants={reduce ? reducedVariants : variants}
									initial="initial"
									animate="animate"
									exit="exit"
									custom={effectiveActiveKey !== null}
									className={cn(
										"pointer-events-none absolute inset-y-0",
										pillContainerClassName,
									)}
									style={{ left: -inset, right: -inset }}
								>
									{effectiveActiveKey === childKey ? (
										<motion.div
											layoutId={`shared-bg-${uid}`}
											transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
											className={cn(
												"pointer-events-none h-full w-full rounded-2xl bg-primary/[0.06]",
												pillClassName,
											)}
										/>
									) : null}
								</motion.div>
							) : null}
						</AnimatePresence>
						<div className="relative z-10">{el.props.children}</div>
					</>,
				);
			});

		const handleMouseLeave = (event: MouseEvent<HTMLElement>) => {
			setHoveredKey(null);
			onMouseLeave?.(event);
		};

		// layoutRoot scopes the pill's layout projection to this list, so fixed or
		// scrolled ancestors can't smear scroll offsets into its movement.
		return as === "ul" ? (
			<motion.ul
				{...(props as HTMLMotionProps<"ul">)}
				ref={forwardedRef as Ref<HTMLUListElement>}
				layoutRoot
				onMouseLeave={handleMouseLeave}
				className={cn("flex w-full flex-col", className)}
			>
				{renderedChildren}
			</motion.ul>
		) : (
			<motion.div
				{...(props as HTMLMotionProps<"div">)}
				ref={forwardedRef as Ref<HTMLDivElement>}
				layoutRoot
				onMouseLeave={handleMouseLeave}
				className={cn("flex w-full flex-col", className)}
			>
				{renderedChildren}
			</motion.div>
		);
	},
);
