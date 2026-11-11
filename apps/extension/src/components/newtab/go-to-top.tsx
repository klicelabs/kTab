import { EASE_OUT } from "@ktab/ui/lib/ease";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "../../lib/utils";
import { useSelectionStore } from "../../stores/selection-store";
import { ToolbarIconButton } from "./toolbar/toolbar-icon-button";

interface GoToTopButtonProps {
	/** The Speed Dial scroll viewport (`data-speed-dial-scroll`). */
	scrollRef: RefObject<HTMLDivElement | null>;
	/** Active folder id — the grid remounts per folder, so targets retarget. */
	folderId: string;
}

/**
 * Second-row cells of the newest mounted grid, grouped by layout row band.
 * Rows come from real `offsetTop` bands (shared offsetParent for every cell),
 * never from assumed card heights — so tile size, max columns, layout mode
 * and folder-span tiles all stay correct. Fewer than two bands → no target.
 * Cells within a 2px epsilon share a band (sub-pixel/zoom rounding), instead
 * of exact rounded equality.
 */
const ROW_BAND_EPSILON_PX = 2;

function secondRowCells(grid: HTMLElement): HTMLElement[] {
	const cells = Array.from(grid.querySelectorAll<HTMLElement>(".dial-cell"));
	if (cells.length === 0) return [];
	const bands = new Map<number, HTMLElement[]>();
	for (const cell of cells) {
		const top = cell.offsetTop;
		let key: number | undefined;
		for (const band of bands.keys()) {
			if (Math.abs(band - top) <= ROW_BAND_EPSILON_PX) {
				key = band;
				break;
			}
		}
		if (key === undefined) {
			key = top;
			bands.set(key, []);
		}
		bands.get(key)?.push(cell);
	}
	const tops = [...bands.keys()].sort((a, b) => a - b);
	if (tops.length < 2) return [];
	return bands.get(tops[1]) ?? [];
}

/**
 * Go to Top for deep Speed Dial pages. Visibility is layout-aware: the
 * button appears only after the grid's second row has fully scrolled out
 * above the viewport — never after a small scroll, never on short pages.
 *
 * Performance: an IntersectionObserver (root = scroll viewport) owns all
 * visibility transitions. ResizeObserver + MutationObserver retarget the
 * observed row on layout changes only. No React state touches raw scroll
 * events; visibility flips exactly on threshold crossings.
 */
export function GoToTopButton({ scrollRef, folderId }: GoToTopButtonProps) {
	const reduceMotion = useReducedMotion() ?? false;
	const trayOpen = useSelectionStore((s) => s.selectedIds.length > 0);
	const [visible, setVisible] = useState(false);
	const [dragging, setDragging] = useState(false);
	const visibleRef = useRef(false);
	// Last known "fully above the viewport" per tracked cell.
	const aboveRef = useRef(new Map<Element, boolean>());

	const setVisibleIfChanged = useCallback((next: boolean) => {
		if (visibleRef.current !== next) {
			visibleRef.current = next;
			setVisible(next);
		}
	}, []);

	const isAboveViewport = useCallback(
		(entry: IntersectionObserverEntry): boolean => {
			if (entry.isIntersecting) return false;
			const rootTop =
				entry.rootBounds?.top ??
				scrollRef.current?.getBoundingClientRect().top ??
				0;
			return entry.boundingClientRect.bottom <= rootTop;
		},
		[scrollRef],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: folderId remounts the grid node, so observers must re-attach per folder.
	useEffect(() => {
		const scrollEl = scrollRef.current;
		if (!scrollEl || typeof IntersectionObserver === "undefined") return;
		const above = aboveRef.current;

		const sync = () => {
			setVisibleIfChanged(above.size > 0 && [...above.values()].every(Boolean));
		};

		const io = new IntersectionObserver(
			(entries) => {
				let changed = false;
				for (const entry of entries) {
					if (!above.has(entry.target)) continue;
					const next = isAboveViewport(entry);
					if (above.get(entry.target) !== next) {
						above.set(entry.target, next);
						changed = true;
					}
				}
				if (changed) sync();
			},
			{ root: scrollEl, threshold: 0 },
		);

		const retarget = () => {
			// During folder transitions two grids overlap briefly; the last
			// mounted one is the entering grid.
			const grids = scrollEl.querySelectorAll<HTMLElement>(".dial-grid");
			const grid = grids[grids.length - 1];
			const next = grid ? secondRowCells(grid) : [];
			for (const target of [...above.keys()]) {
				if (!next.includes(target as HTMLElement)) {
					io.unobserve(target);
					above.delete(target);
				}
			}
			if (next.length === 0) {
				setVisibleIfChanged(false);
				return;
			}
			const rootRect = scrollEl.getBoundingClientRect();
			for (const cell of next) {
				if (!above.has(cell)) {
					io.observe(cell);
					// Synchronous seed so the first paint never flashes.
					above.set(cell, cell.getBoundingClientRect().bottom <= rootRect.top);
				}
			}
			sync();
		};

		retarget();

		const grids = scrollEl.querySelectorAll<HTMLElement>(".dial-grid");
		const gridEl = grids[grids.length - 1] ?? null;
		let ro: ResizeObserver | null = null;
		let mo: MutationObserver | null = null;
		if (gridEl && typeof ResizeObserver !== "undefined") {
			ro = new ResizeObserver(() => retarget());
			ro.observe(gridEl);
		}
		if (gridEl && typeof MutationObserver !== "undefined") {
			mo = new MutationObserver(() => retarget());
			mo.observe(gridEl, { childList: true });
		}
		window.addEventListener("resize", retarget);
		return () => {
			window.removeEventListener("resize", retarget);
			ro?.disconnect();
			mo?.disconnect();
			io.disconnect();
			above.clear();
		};
	}, [scrollRef, folderId, isAboveViewport, setVisibleIfChanged]);

	// A native drag must never land on this control — keep the gesture
	// surface clean while anything is carried.
	useEffect(() => {
		const onStart = () => setDragging(true);
		const onEnd = () => setDragging(false);
		window.addEventListener("dragstart", onStart);
		window.addEventListener("dragend", onEnd);
		window.addEventListener("drop", onEnd);
		return () => {
			window.removeEventListener("dragstart", onStart);
			window.removeEventListener("dragend", onEnd);
			window.removeEventListener("drop", onEnd);
		};
	}, []);

	const scrollToTop = useCallback(() => {
		scrollRef.current?.scrollTo({
			top: 0,
			behavior: reduceMotion ? "auto" : "smooth",
		});
	}, [scrollRef, reduceMotion]);

	return (
		<AnimatePresence initial={false}>
			{visible && !dragging && (
				<motion.span
					key="go-to-top"
					data-go-to-top="true"
					className={cn(
						// Absolute to the Speed Dial frame (the relative
						// workspace), never the browser viewport — so the
						// Settings sidebar shrink is honored automatically.
						// Above the scroll fade, below the app toolbar; the
						// Selection Tray (z-40) always wins an overlap.
						"absolute right-5 z-[var(--speed-dial-layer-navigation)]",
						// The tray occupies ~270px of bottom viewport when
						// open; lift clear of it instead of overlapping.
						trayOpen ? "bottom-[284px]" : "bottom-5",
					)}
					initial={
						reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.96 }
					}
					animate={
						reduceMotion
							? { opacity: 1, transition: { duration: 0.12 } }
							: {
									opacity: 1,
									y: 0,
									scale: 1,
									transition: { duration: 0.15, ease: EASE_OUT },
								}
					}
					exit={
						reduceMotion
							? { opacity: 0 }
							: {
									opacity: 0,
									y: 4,
									scale: 0.96,
									transition: { duration: 0.12, ease: EASE_OUT },
								}
					}
				>
					<ToolbarIconButton
						icon="chevron-up"
						label="Go to top"
						onClick={scrollToTop}
					/>
				</motion.span>
			)}
		</AnimatePresence>
	);
}
