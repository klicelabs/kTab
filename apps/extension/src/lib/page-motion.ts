import { EASE_OUT } from "@ktab/ui/lib/ease";
import type { TargetAndTransition, Variants } from "motion/react";

export type PageDirection = "forward" | "back";
export type PageMotionKind = "root" | "depth" | "settings";

export interface PageMotionContext {
	direction: PageDirection;
	kind: PageMotionKind;
	reduceMotion: boolean;
}

const TRAVEL_PX: Record<PageMotionKind, number> = {
	root: 32,
	depth: 24,
	settings: 20,
};

/** The entering page follows the path of the departing page in reverse. */
export function pageMotion(
	context: PageMotionContext,
	phase: "initial" | "animate" | "exit",
): TargetAndTransition {
	const distance = context.reduceMotion ? 0 : TRAVEL_PX[context.kind];
	const sign = context.direction === "forward" ? 1 : -1;
	const offset =
		phase === "initial"
			? sign * distance
			: phase === "exit"
				? -sign * distance
				: 0;
	return {
		transform: `translate3d(${offset}px, 0, 0)`,
		opacity:
			phase === "animate"
				? 1
				: phase === "exit" || context.reduceMotion
					? 0
					: 0.4,
		transition: {
			duration: context.reduceMotion ? 0.08 : phase === "exit" ? 0.16 : 0.22,
			ease: EASE_OUT,
		},
	};
}

export const PAGE_VARIANTS: Variants = {
	initial: (context: PageMotionContext) => pageMotion(context, "initial"),
	animate: (context: PageMotionContext) => pageMotion(context, "animate"),
	exit: (context: PageMotionContext) => pageMotion(context, "exit"),
};
