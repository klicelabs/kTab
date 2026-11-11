import type { Transition } from "motion/react";
import {
	EASE_DRAWER,
	EASE_DRAWER_CSS,
	EASE_IN_OUT,
	EASE_IN_OUT_CSS,
	EASE_OUT,
	EASE_OUT_CSS,
	SPRING_DEPTH,
	SPRING_PANEL,
	SPRING_PRESS,
	SPRING_SEGMENT,
	SPRING_WAKE,
} from "./ease";

/**
 * kTab motion vocabulary.
 *
 * One language, shared by CSS transitions and Motion animations. Components
 * must never inline a raw `duration: 137` or a bespoke cubic-bezier — they
 * pick a named step from here. If a component genuinely needs a unique
 * physical model, add a named entry rather than an inline value.
 *
 * Principles (Emil Kowalski / Apple HIG):
 *   - animate transform + opacity; never layout properties
 *   - exits are faster than entrances
 *   - no bounce unless physically justified
 *   - every animation must be interruptible
 *   - motion must earn its place: fewer, better animations
 */

/** Durations in seconds (Motion's unit). Multiply by 1000 for CSS. */
export const DURATION = {
	/** State flips that must feel instantaneous (checkbox tick, toggle). */
	instant: 0.08,
	/** Hover / colour feedback. */
	feedback: 0.12,
	/** Control press and release, segment slide. */
	control: 0.16,
	/** Navigation between peers — root tabs, settings panes. */
	navigation: 0.22,
	/** Menus, popovers, tooltips. */
	panel: 0.26,
	/** Hierarchy depth change — entering/leaving a subfolder. */
	depth: 0.32,
	/** App wake / Rest Mode exit choreography. */
	wake: 0.42,
	/** beUI's draw-on checkbox mark; the checked state changes immediately. */
	checkmark: 0.3,
} as const;

/** Tiny sequencing delays for authored control feedback (seconds). */
export const DELAY = { checkmark: 0.04 } as const;

/** Cubic-bezier easings, as Motion expects them. */
export const EASE = {
	/** Decelerating; the default for anything entering. */
	out: EASE_OUT,
	/** Very fast start, long tail — large surfaces and depth changes. */
	outExpo: EASE_OUT,
	/** Symmetric; for something that both enters and leaves. */
	inOut: EASE_IN_OUT,
	/** The Apple drawer/sheet curve. */
	drawer: EASE_DRAWER,
} as const;

/** Matching CSS timing functions, for the rare CSS-only transition. */
export const EASE_CSS = {
	out: EASE_OUT_CSS,
	outExpo: EASE_OUT_CSS,
	inOut: EASE_IN_OUT_CSS,
	drawer: EASE_DRAWER_CSS,
} as const;

/**
 * Shared layout transition for the Settings workspace and its transported
 * control. Keeping this as one preset prevents the sidebar, frame and shared
 * element from settling on different timelines.
 */
export const SHARED_LAYOUT_TRANSITION = {
	duration: DURATION.navigation,
	ease: EASE.drawer,
} as const satisfies Transition;

/**
 * Spring presets. Springs are preferred over duration-based easing for
 * anything the user can grab, interrupt or repeat rapidly.
 */
export const SPRING = {
	/** Press / release. Tight and quick — must not feel rubbery. */
	press: SPRING_PRESS,
	/** Selected segment sliding inside its track. */
	segment: SPRING_SEGMENT,
	/** Menu / popover entrance. */
	panel: SPRING_PANEL,
	/** Subfolder depth change — a heavier, more deliberate body. */
	depth: SPRING_DEPTH,
	/** App wake. Calm, no overshoot. */
	wake: SPRING_WAKE,
} as const satisfies Record<string, Transition>;

/** Shared transition for stateful colour/opacity changes driven by CSS. */
export const TRANSITION_FEEDBACK =
	"transition-[color,background-color,border-color,opacity] duration-100 ease-out";

/** Shared transition for a control's press response. */
export const TRANSITION_CONTROL =
	"transition-[transform,box-shadow,background-color,color] duration-[160ms] ease-out";

/**
 * The app's single "wake" choreography. Used by the initial Speed-Dial
 * entrance *and* by Rest Mode's exit, so the user recognises one motion.
 *
 * Order: chrome settles first, then the hero, then the grid. Delays are
 * deliberately tiny — a new-tab product must be usable immediately.
 */
export const WAKE = {
	/** Per-element entrance. */
	enter: { duration: DURATION.wake, ease: EASE.outExpo },
	/** Vertical travel of a settling element. */
	travel: 12,
	/** Start scale — never 0; the element must already exist. */
	scale: 0.985,
	/** Delay before each layer starts, in seconds. */
	delay: {
		chrome: 0,
		hero: 0.04,
		grid: 0.08,
	},
} as const;
