import { SPRING_LAYOUT } from "@ktab/ui/lib/ease";
import { animate } from "motion";
import { useEffect, useRef } from "react";
import {
	homeHoverBox,
	homeHoverOutset,
	resolveHomeHoverTarget,
} from "../../lib/home-hover";

interface DialHoverVeilProps {
	/** Page key (folder id): a container swap hides the frame. */
	resetKey: string;
}

/**
 * One shared Home hover frame, the switcher's selection container translated
 * to the grid: it springs between items with SPRING_LAYOUT instead of fading
 * per cell. Rendered as the FIRST CHILD of the .dial-grid itself — being
 * inside the grid is what lets the frame resolve the grid-owned icon vars
 * (--icon-size, --icon-glass-pad) for its squircle radii, and cells paint
 * above it by DOM order while its backdrop samples the wallpaper.
 */
export function DialHoverVeil({ resetKey }: DialHoverVeilProps) {
	const veilRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const veil = veilRef.current;
		// The grid owns the icon geometry vars, so every box is grid-relative.
		const grid = veil?.parentElement;
		if (!veil || !grid) return;
		const finePointer = window.matchMedia(
			"(hover: hover) and (pointer: fine)",
		).matches;
		const reduceMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		let glide: { stop: () => void } | null = null;
		let shown = false;

		const hide = () => {
			glide?.stop();
			glide = null;
			if (!shown) return;
			shown = false;
			veil.classList.remove("on");
		};

		const show = (cell: HTMLElement, withGlide: boolean) => {
			const target = resolveHomeHoverTarget(cell);
			if (!target) {
				hide();
				return;
			}
			const box = homeHoverBox(
				target.element.getBoundingClientRect(),
				grid.getBoundingClientRect(),
				homeHoverOutset(target.kind),
			);
			veil.dataset.veil = target.kind;
			veil.style.width = `${box.width}px`;
			veil.style.height = `${box.height}px`;
			glide?.stop();
			if (withGlide && !reduceMotion) {
				glide = animate(veil, { x: box.x, y: box.y }, SPRING_LAYOUT);
			} else {
				glide = null;
				veil.style.transform = `translate(${box.x}px, ${box.y}px)`;
			}
			if (!shown) {
				shown = true;
				veil.classList.add("on");
			}
		};

		const cellFrom = (node: EventTarget | null) => {
			if (!(node instanceof Element)) return null;
			const cell = node.closest<HTMLElement>(".dial-cell");
			return cell && grid.contains(cell) ? cell : null;
		};

		const onPointerOver = (event: PointerEvent) => {
			if (!finePointer) return;
			if (grid.closest("[data-drag-active='true']")) return;
			const cell = cellFrom(event.target);
			if (!cell) {
				hide();
				return;
			}
			if (cell.querySelector("[data-dragging='true']")) {
				hide();
				return;
			}
			show(cell, true);
		};

		const onFocusIn = (event: FocusEvent) => {
			const cell = cellFrom(event.target);
			if (cell) show(cell, true);
		};

		const onFocusOut = (event: FocusEvent) => {
			if (!cellFrom(event.relatedTarget)) hide();
		};

		const onPointerLeave = () => hide();

		grid.addEventListener("pointerover", onPointerOver);
		grid.addEventListener("pointerleave", onPointerLeave);
		grid.addEventListener("focusin", onFocusIn);
		grid.addEventListener("focusout", onFocusOut);
		grid.addEventListener("dragstart", hide);
		window.addEventListener("scroll", hide, { passive: true });
		window.addEventListener("resize", hide);

		hide();
		return () => {
			glide?.stop();
			grid.removeEventListener("pointerover", onPointerOver);
			grid.removeEventListener("pointerleave", onPointerLeave);
			grid.removeEventListener("focusin", onFocusIn);
			grid.removeEventListener("focusout", onFocusOut);
			grid.removeEventListener("dragstart", hide);
			window.removeEventListener("scroll", hide);
			window.removeEventListener("resize", hide);
		};
	}, [resetKey]);

	return <div ref={veilRef} className="dial-hover-veil" aria-hidden="true" />;
}
