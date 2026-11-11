import { DURATION, EASE } from "@ktab/ui/lib/motion";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "motion/react";
import { useRef } from "react";

function SkeletonSurface({ hasPreview }: { hasPreview: boolean }) {
	// Keep the material stable through decode; an empty skeleton must not
	// abruptly turn translucent just before it exits over the new image.
	const previewOnEntry = useRef(hasPreview);
	const present = useIsPresent();
	const reduceMotion = useReducedMotion();
	return (
		<motion.span
			aria-hidden="true"
			className="thumbnail-refresh-mask"
			data-active={present ? "true" : undefined}
			data-preview={previewOnEntry.current ? "true" : undefined}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{
				duration: reduceMotion ? DURATION.instant : DURATION.control,
				ease: EASE.out,
			}}
		>
			<span className="thumbnail-refresh-light" />
		</motion.span>
	);
}

/** One neutral surface shimmer, exclusively for the worker's active card. */
export function ThumbnailFeedback({
	active,
	hasPreview,
}: {
	active: boolean;
	hasPreview: boolean;
}) {
	return (
		<AnimatePresence initial={false}>
			{active && <SkeletonSurface hasPreview={hasPreview} />}
		</AnimatePresence>
	);
}
