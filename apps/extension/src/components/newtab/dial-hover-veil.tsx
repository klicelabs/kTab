import { SPRING_LAYOUT } from "@ktab/ui/lib/ease";
import { animate } from "motion";
import { useEffect, useRef } from "react";
import { homeHoverBox, resolveHomeHoverTarget } from "../../lib/home-hover";

interface DialHoverVeilProps {
	/** Page key (folder id): a container swap hides the frame. */
	resetKey: string;
}

/**
 * One shared Home hover frame, the switcher's selection container translated
 * to the grid: it springs between items with SPRING_LAYOUT instead of fading
 * per cell. Rendered as the first child of the grid stage so the grid (and
 * every card/label) paints above it while its backdrop samples the wallpaper.
 */
export function DialHoverVeil({ resetKey }: DialHoverVeilProps) {
	const veilRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const veil = veilRef.current;
		const stage = veil?.parentElement;
		if (!veil || !stage) return;
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
				stage.getBoundingClientRect(),
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
			return cell && stage.contains(cell) ? cell : null;
		};

		const onPointerOver = (event: PointerEvent) => {
			if (!finePointer) return;
			if (stage.closest("[data-drag-active='true']")) return;
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

		stage.addEventListener("pointerover", onPointerOver);
		stage.addEventListener("pointerleave", onPointerLeave);
		stage.addEventListener("focusin", onFocusIn);
		stage.addEventListener("focusout", onFocusOut);
		stage.addEventListener("dragstart", hide);
		window.addEventListener("scroll", hide, { passive: true });
		window.addEventListener("resize", hide);

		hide();
		return () => {
			glide?.stop();
			stage.removeEventListener("pointerover", onPointerOver);
			stage.removeEventListener("pointerleave", onPointerLeave);
			stage.removeEventListener("focusin", onFocusIn);
			stage.removeEventListener("focusout", onFocusOut);
			stage.removeEventListener("dragstart", hide);
			window.removeEventListener("scroll", hide);
			window.removeEventListener("resize", hide);
		};
	}, [resetKey]);

	return <div ref={veilRef} className="dial-hover-veil" aria-hidden="true" />;
}
