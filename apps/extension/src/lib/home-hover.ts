/** Selector for the visual target a Home hover frame wraps. */
export type HomeHoverTargetKind = "card" | "pane" | "icon";

export interface HomeHoverTarget {
	element: Element;
	kind: HomeHoverTargetKind;
}

export interface HomeHoverBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Frame outset around the target, matching the switcher's frame padding. */
export const HOME_HOVER_OUTSET = 8;

const TILE_SELECTOR = ".icon-app-tile, .icon-folder-tile";

/**
 * Which box the shared Home hover frame should wrap.
 *
 *   card  bookmark/folder card in Card layout — the cell is the card.
 *   pane  Icon layout with Icon surfaces — the whole glass pane, label
 *         included, so the frame wraps the item as one object.
 *   icon  Icon layout without the pane — the bare tile square; the label
 *         stays outside the glass, like the switcher caption.
 */
export function resolveHomeHoverTarget(cell: Element): HomeHoverTarget | null {
	const layout = cell.closest(".dial-grid")?.getAttribute("data-layout");
	if (layout !== "icon") return { element: cell, kind: "card" };
	const pane = cell.querySelector(".icon-glass-tile");
	if (pane) return { element: pane, kind: "pane" };
	const tile = cell.querySelector(TILE_SELECTOR);
	return tile ? { element: tile, kind: "icon" } : null;
}

/** Stage-relative box for a measured target, expanded by the frame outset. */
export function homeHoverBox(
	target: DOMRect,
	stage: DOMRect,
	outset = HOME_HOVER_OUTSET,
): HomeHoverBox {
	return {
		x: target.left - stage.left - outset,
		y: target.top - stage.top - outset,
		width: target.width + outset * 2,
		height: target.height + outset * 2,
	};
}

/**
 * Frame outset per target kind. Glass panes already ARE a finished surface
 * (icon + label behind one material), so the frame hugs them exactly — an
 * outset would read as the hover floating past the pane.
 */
export function homeHoverOutset(kind: HomeHoverTargetKind): number {
	return kind === "pane" ? 0 : HOME_HOVER_OUTSET;
}
