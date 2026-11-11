import { cn } from "./utils";

/**
 * Flat material recipes.
 *
 * Flat mode has its own material system, parallel to (and never mixed with)
 * the glasscn library that powers Glass mode. Components must compose these
 * recipes instead of hand-rolling `border bg-card shadow-sm`, so every surface
 * belongs to one coherent physical family:
 *
 *   face-*  (the wash painted on the surface)
 *   + shadow-*  (edge ring + top highlight + lower shade + ambient lift)
 *
 * The edge is deliberately NOT a `border`: it is an inset ring inside the
 * shadow stack, so it hugs whatever radius the element already has — plain
 * `rounded-*` or kTab's `.squircle` — and reads as part of the material
 * rather than a drawn rectangle. That is also why the recipes below almost
 * never contain a border utility.
 *
 * The tokens live in `packages/ui/src/styles/globals.css`.
 */

/** How far a surface floats. Tuned per surface class, never per component. */
export type FlatElevation =
	| "control"
	| "controlPressed"
	| "floating"
	| "menu"
	| "panel"
	| "dialog";

const ELEVATION: Record<FlatElevation, string> = {
	control: "shadow-control",
	controlPressed: "shadow-control-pressed",
	floating: "shadow-floating",
	menu: "shadow-menu",
	panel: "shadow-panel-clean",
	dialog: "shadow-dialog",
};

/** A standard control: buttons, tabs, toolbar pills, segment faces. */
export function flatControl(elevation: FlatElevation = "control"): string {
	return cn("face-control", ELEVATION[elevation]);
}

/**
 * A quiet control that lives inside an already-materialised surface (a menu
 * row, a settings row). It has no face of its own until hovered — the parent
 * supplies the material.
 */
export function flatQuietControl(): string {
	return "text-flat-ink transition-colors duration-100 hover:bg-flat-sunken-raised";
}

/** The premium solid action face (dark in light theme, light in dark theme). */
export function flatSolid(elevation: FlatElevation = "control"): string {
	return cn("face-solid", ELEVATION[elevation]);
}

/** A recessed well: text inputs, slider tracks, inset groups. */
export function flatSunken(elevation: FlatElevation = "control"): string {
	return cn("face-sunken", ELEVATION[elevation]);
}

/** The coherent outer surface of a segmented control. */
export function flatSegmentContainer(): string {
	return "face-segment shadow-control";
}

/**
 * A single segment. The selected segment rises out of the track; unselected
 * segments stay inert so the container reads as one physical object.
 */
export function flatSegmentItem(selected: boolean): string {
	if (selected) return "face-segment-selected shadow-control";
	return "text-flat-ink-muted hover:text-flat-ink";
}

/** A slider thumb — a light machined knob in both themes. */
export function flatThumb(): string {
	return "face-thumb shadow-control";
}

/**
 * A large opaque surface: menus, popovers, panels, dialogs. The wash is
 * shallower than a control's, because at panel scale a full control gradient
 * reads as a gradient rather than as light.
 */
export function flatSurface(
	elevation: Extract<
		FlatElevation,
		"floating" | "menu" | "panel" | "dialog"
	> = "menu",
): string {
	return cn(
		elevation === "panel" ? "face-panel-solid" : "face-panel",
		ELEVATION[elevation],
	);
}

/**
 * A separator rendered as a tonal groove rather than a bright 1px rule.
 * Prefer spacing over separators; use these only where a boundary is
 * genuinely load-bearing.
 */
export function flatSeparator(
	orientation: "horizontal" | "vertical" = "horizontal",
): string {
	return orientation === "vertical" ? "groove-v" : "groove";
}

/** Control ink. The engraved shadow is for control labels only — never body copy. */
export const FLAT_INK = "text-flat-ink";
export const FLAT_INK_ENGRAVED = "text-flat-ink ink-engraved";
export const FLAT_INK_MUTED = "text-flat-ink-muted";

/**
 * The full focus treatment for a Flat control. Borders are reduced across the
 * product, so focus is carried by a ring + surface shift instead — it must
 * stay unmistakable.
 */
export function flatFocusRing(): string {
	return "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
}
