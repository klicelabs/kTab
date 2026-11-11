"use client";
import {
	Popover,
	PopoverPopup,
	PopoverPortal,
	PopoverPositioner,
	PopoverTrigger,
} from "@ktab/ui/components/popover";
import {
	SPRING_GLIDE,
	SPRING_LAYOUT,
	SPRING_PRESS,
} from "@ktab/ui/lib/ease";
import { DURATION, EASE, EASE_CSS } from "@ktab/ui/lib/motion";
import {
	capturePointer,
	releasePointer,
	TOUCH_GESTURE_CLASS,
} from "@ktab/ui/lib/touch";
import { cn } from "@ktab/ui/lib/utils";
// Core controls adapted from the official beui.dev Motion Color Picker registry.
import {
	AnimatePresence,
	arc,
	LayoutGroup,
	type MotionValue,
	motion,
	type Transition,
	useAnimate,
	useReducedMotion,
	useSpring,
	useTransform,
	useVelocity,
} from "motion/react";
import {
	type ComponentPropsWithRef,
	createContext,
	type KeyboardEvent,
	type PointerEvent,
	type RefObject,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

/** Hue 0-360, saturation and value 0-100, alpha 0-1. */
export type Hsva = { h: number; s: number; v: number; a: number };
/** Channels 0-255, alpha 0-1. */
export type Rgba = { r: number; g: number; b: number; a: number };

const clamp = (n: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, n));
const round = (n: number, places = 0) => {
	const f = 10 ** places;
	return Math.round(n * f) / f;
};

export function hsvaToRgba({ h, s, v, a }: Hsva): Rgba {
	const sat = s / 100;
	const val = v / 100;
	const f = (n: number) => {
		const k = (n + h / 60) % 6;
		return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
	};
	return {
		r: Math.round(f(5) * 255),
		g: Math.round(f(3) * 255),
		b: Math.round(f(1) * 255),
		a,
	};
}

/** `previous` keeps hue for greys and saturation for black, which RGB cannot carry. */
export function rgbaToHsva({ r, g, b, a }: Rgba, previous?: Hsva): Hsva {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const d = max - Math.min(rn, gn, bn);
	let h = previous?.h ?? 0;
	if (d) {
		if (max === rn) h = ((gn - bn) / d) % 6;
		else if (max === gn) h = (bn - rn) / d + 2;
		else h = (rn - gn) / d + 4;
		h = (h * 60 + 360) % 360;
	}
	const v = max * 100;
	const s = max ? (d / max) * 100 : (previous?.s ?? 0);
	return { h, s, v, a };
}

const HEX_PATTERN = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parses #rgb, #rgba, #rrggbb and #rrggbbaa. Returns null for anything else. */
export function parseHex(input: string): Rgba | null {
	const match = HEX_PATTERN.exec(input.trim());
	if (!match) return null;
	let hex = match[1];
	if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
	const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
	return {
		r: n(0),
		g: n(2),
		b: n(4),
		a: hex.length === 8 ? round(n(6) / 255, 2) : 1,
	};
}

/** Lowercase #rrggbb, or #rrggbbaa when the color is translucent. */
export function formatHex({ r, g, b, a }: Rgba): string {
	const pair = (n: number) => Math.round(n).toString(16).padStart(2, "0");
	return `#${pair(r)}${pair(g)}${pair(b)}${a < 1 ? pair(a * 255) : ""}`;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

type ColorPickerContextValue = {
	id: string;
	hsva: Hsva;
	rgba: Rgba;
	hex: string;
	alpha: boolean;
	disabled: boolean;
	update: (next: Hsva) => void;
	commit: () => void;
	setOpen: (open: boolean) => void;
};

const ColorPickerContext = createContext<ColorPickerContextValue | null>(null);

function usePickerContext(component: string) {
	const context = useContext(ColorPickerContext);
	if (!context) throw new Error(`${component} must be used within ColorPicker`);
	return context;
}

/** Current color and a setter, for custom parts inside a ColorPicker. */
export function useColorPicker() {
	const { hex, rgba, hsva, alpha, disabled, update, commit } =
		usePickerContext("useColorPicker");
	return {
		hex,
		rgba,
		hsva,
		alpha,
		disabled,
		/** Accepts any hex form. Invalid input is ignored. */
		setColor: (value: string) => {
			const parsed = parseHex(value);
			if (!parsed) return;
			update(rgbaToHsva(parsed, hsva));
			commit();
		},
	};
}

export interface ColorPickerProps
	extends Omit<ComponentPropsWithRef<"fieldset">, "onChange" | "defaultValue"> {
	/** Controlled hex color (#rgb, #rrggbb or #rrggbbaa). */
	value?: string;
	defaultValue?: string;
	/** Fires on every change while dragging or typing, with a lowercase hex. */
	onValueChange?: (value: string) => void;
	/** Fires once an interaction settles: pointer release, key, preset or field commit. */
	onValueCommit?: (value: string) => void;
	/** Allow transparency. When false the value is always opaque. Default false. */
	alpha?: boolean;
	/** Submits the hex value with a form under this name. */
	name?: string;
	/** Controlled open state for ColorPickerTrigger + ColorPickerContent. */
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/** Give it an aria-label, or a legend through children. */
export function ColorPicker({
	value,
	defaultValue = "#3478f6",
	onValueChange,
	onValueCommit,
	alpha = false,
	disabled = false,
	name,
	open: openProp,
	defaultOpen = false,
	onOpenChange,
	form,
	className,
	children,
	...props
}: ColorPickerProps) {
	const id = useId();
	const [openInternal, setOpenInternal] = useState(defaultOpen);
	const open = openProp ?? openInternal;
	const setOpen = (next: boolean) => {
		if (next === open) return;
		if (openProp === undefined) setOpenInternal(next);
		onOpenChange?.(next);
	};
	const controlled = value !== undefined;
	const incoming = controlled ? value : defaultValue;
	const [state, setState] = useState(() => ({
		source: incoming,
		hsva: rgbaToHsva(parseHex(incoming) ?? BLACK),
	}));

	// A controlled value the picker did not emit itself is re-read here, during
	// render, so the thumbs never paint a stale color for a frame.
	let hsva = state.hsva;
	if (controlled && value !== state.source) {
		const parsed = parseHex(value);
		hsva = parsed ? rgbaToHsva(parsed, state.hsva) : state.hsva;
		setState({ source: value, hsva });
	}
	if (!alpha && hsva.a !== 1) hsva = { ...hsva, a: 1 };

	const rgba = hsvaToRgba(hsva);
	const hex = formatHex(rgba);
	// Event handlers read the latest emitted hex, which may be ahead of render.
	const hexRef = useRef(hex);
	useLayoutEffect(() => {
		hexRef.current = hex;
	}, [hex]);

	const update = (next: Hsva) => {
		const clean: Hsva = {
			h: clamp(next.h, 0, 360),
			s: clamp(next.s, 0, 100),
			v: clamp(next.v, 0, 100),
			a: alpha ? clamp(next.a, 0, 1) : 1,
		};
		const nextHex = formatHex(hsvaToRgba(clean));
		const changed = nextHex !== hexRef.current;
		hexRef.current = nextHex;
		setState({ source: nextHex, hsva: clean });
		if (changed) onValueChange?.(nextHex);
	};

	return (
		<ColorPickerContext.Provider
			value={{
				id,
				hsva,
				rgba,
				hex,
				alpha,
				disabled,
				update,
				commit: () => onValueCommit?.(hexRef.current),
				setOpen,
			}}
		>
			<Popover open={open} onOpenChange={setOpen}>
				<fieldset
					{...props}
					disabled={disabled}
					form={form}
					className={cn(
						"relative flex w-full min-w-0 max-w-72 flex-col gap-3 border-0 p-0",
						disabled && "opacity-50",
						className,
					)}
				>
					{children}
					{name && <input type="hidden" name={name} value={hex} form={form} />}
				</fieldset>
			</Popover>
		</ColorPickerContext.Provider>
	);
}

// ---------------------------------------------------------------------------
// Pointer + spring plumbing shared by the area and the sliders
// ---------------------------------------------------------------------------

function useGlide(target: number) {
	const reduce = useReducedMotion();
	const spring = useSpring(target, SPRING_GLIDE);
	useEffect(() => {
		if (reduce) spring.jump(target);
		else spring.set(target);
	}, [reduce, spring, target]);
	return { spring, offset: useTransform(spring, (n) => `${n}%`) };
}

function useDrag(
	onPoint: (x: number, y: number) => void,
	onEnd: () => void,
	disabled: boolean,
) {
	const railRef = useRef<HTMLDivElement>(null);
	const thumbRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const [dragging, setDragging] = useState(false);

	const point = (event: PointerEvent<HTMLDivElement>) => {
		const rect = railRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0 || rect.height === 0) return;
		onPoint(
			clamp((event.clientX - rect.left) / rect.width, 0, 1),
			clamp((event.clientY - rect.top) / rect.height, 0, 1),
		);
	};

	const end = (event: PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) return;
		releasePointer(event.currentTarget, event.pointerId);
		draggingRef.current = false;
		setDragging(false);
		onEnd();
	};

	return {
		railRef,
		thumbRef,
		dragging,
		handlers: {
			onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
				if (disabled || event.button !== 0) return;
				draggingRef.current = true;
				setDragging(true);
				capturePointer(event.currentTarget, event.pointerId);
				thumbRef.current?.focus({ preventScroll: true });
				point(event);
			},
			onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
				if (draggingRef.current) point(event);
			},
			onPointerUp: end,
			onPointerCancel: end,
		},
	};
}

/** Arrow, Page and Home/End stepping. Returns the delta, or null when unhandled. */
function keyStep(
	event: KeyboardEvent,
	big: number,
): { axis: "x" | "y"; delta: number } | "min" | "max" | null {
	const step = event.shiftKey ? big : 1;
	switch (event.key) {
		case "ArrowRight":
			return { axis: "x", delta: step };
		case "ArrowLeft":
			return { axis: "x", delta: -step };
		case "ArrowUp":
			return { axis: "y", delta: step };
		case "ArrowDown":
			return { axis: "y", delta: -step };
		case "PageUp":
			return { axis: "y", delta: big };
		case "PageDown":
			return { axis: "y", delta: -big };
		case "Home":
			return "min";
		case "End":
			return "max";
		default:
			return null;
	}
}

const CHECKERBOARD =
	"repeating-conic-gradient(#d4d4d8 0% 25%, #fafafa 0% 50%) 0 0 / 8px 8px";

// The loupe lifts with a visible overshoot so it reads as picked up, unlike
// the critically damped glide the thumb itself rides on.
const LOUPE_LIFT: Transition = {
	type: "spring",
	stiffness: 520,
	damping: 24,
	mass: 0.6,
};
const LOUPE_DROP: Transition = { duration: 0.12, ease: EASE.out };
// Glide velocity in %/s mapped to a pendulum swing, so the loupe trails the drag.
const LOUPE_TILT_INPUT = [-400, 400];
const LOUPE_TILT_DEGREES = [16, -16];

function Thumb({
	thumbRef,
	dragging,
	color,
	glide,
	x,
	y,
	className,
	...props
}: ComponentPropsWithRef<"div"> & {
	thumbRef: RefObject<HTMLDivElement | null>;
	dragging: boolean;
	color: string;
	/** Horizontal glide spring, read for the loupe's tilt. */
	glide: MotionValue<number>;
	x: MotionValue<string>;
	y?: MotionValue<string>;
}) {
	const reduce = useReducedMotion();
	const velocity = useVelocity(glide);
	const tilt = useSpring(
		useTransform(velocity, LOUPE_TILT_INPUT, LOUPE_TILT_DEGREES, {
			clamp: true,
		}),
		SPRING_PRESS,
	);
	const lifted = dragging && !reduce;
	return (
		<motion.div
			className="pointer-events-none absolute inset-0"
			style={{ x, y }}
		>
			<div
				{...props}
				ref={thumbRef}
				className={cn(
					"absolute left-0 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full outline-none",
					y ? "top-0" : "top-1/2",
					"focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2",
					className,
				)}
			>
				<motion.span
					aria-hidden="true"
					animate={{ scale: lifted ? 0.78 : 1 }}
					transition={SPRING_PRESS}
					className="block size-full rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.12),0_2px_6px_rgb(0_0_0/0.25)]"
					style={{ backgroundColor: color }}
				/>
				<AnimatePresence>
					{lifted && (
						<motion.span
							aria-hidden="true"
							className="pointer-events-none absolute bottom-[calc(100%+12px)] left-1/2 z-10 -ml-5 block size-10"
							style={{ rotate: tilt, originX: 0.5, originY: 1.3 }}
							initial={{ opacity: 0, scale: 0.3, y: 16 }}
							animate={{ opacity: 1, scale: 1, y: 0, transition: LOUPE_LIFT }}
							exit={{ opacity: 0, scale: 0.3, y: 16, transition: LOUPE_DROP }}
						>
							{/* A square with one sharp corner, turned so the point aims at the thumb. */}
							<span
								className="absolute inset-0 -rotate-45 overflow-hidden rounded-[50%_50%_50%_0] border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.1),0_6px_16px_rgb(0_0_0/0.28)]"
								style={{ background: CHECKERBOARD }}
							>
								<span
									className="absolute inset-0"
									style={{ background: color }}
								/>
							</span>
						</motion.span>
					)}
				</AnimatePresence>
			</div>
		</motion.div>
	);
}

// ---------------------------------------------------------------------------
// Saturation / brightness area
// ---------------------------------------------------------------------------

export interface ColorPickerAreaProps
	extends Omit<ComponentPropsWithRef<"div">, "children"> {
	/** Accessible name for the 2D thumb. Default "Saturation and brightness". */
	label?: string;
}

export function ColorPickerArea({
	label = "Saturation and brightness",
	className,
	style,
	...props
}: ColorPickerAreaProps) {
	const { hsva, rgba, disabled, update, commit } =
		usePickerContext("ColorPickerArea");
	const { railRef, thumbRef, dragging, handlers } = useDrag(
		(x, y) => update({ ...hsva, s: x * 100, v: (1 - y) * 100 }),
		commit,
		disabled,
	);
	const x = useGlide(hsva.s);
	const y = useGlide(100 - hsva.v);
	const s = Math.round(hsva.s);
	const v = Math.round(hsva.v);
	return (
		<div
			{...props}
			{...handlers}
			ref={railRef}
			className={cn(
				// contain-layout: the Thumb glide box is translated by % of
				// its own full size (official beUI technique), so its box
				// always extends past the rail. Layout containment keeps that
				// invisible box from expanding ancestor scroll regions, while
				// paint stays untouched — the edge thumb and the drag loupe
				// remain fully visible. Never overflow-x: hidden here: that
				// would clip the loupe instead of fixing the source.
				"relative h-40 w-full touch-none rounded-xl contain-layout",
				TOUCH_GESTURE_CLASS,
				disabled ? "cursor-not-allowed" : "cursor-crosshair",
				className,
			)}
			style={{
				...style,
				background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsva.h} 100% 50%))`,
			}}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-black/10 ring-inset"
			/>
			<Thumb
				thumbRef={thumbRef}
				dragging={dragging}
				color={`rgb(${rgba.r} ${rgba.g} ${rgba.b})`}
				glide={x.spring}
				x={x.offset}
				y={y.offset}
				role="slider"
				tabIndex={disabled ? -1 : 0}
				aria-label={label}
				aria-roledescription="2D slider"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={s}
				aria-valuetext={`Saturation ${s}%, brightness ${v}%`}
				aria-disabled={disabled || undefined}
				onKeyDown={(event) => {
					if (disabled) return;
					const step = keyStep(event, 10);
					if (!step) return;
					event.preventDefault();
					if (step === "min") update({ ...hsva, s: 0 });
					else if (step === "max") update({ ...hsva, s: 100 });
					else if (step.axis === "x")
						update({ ...hsva, s: hsva.s + step.delta });
					else update({ ...hsva, v: hsva.v + step.delta });
					commit();
				}}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Hue and alpha sliders
// ---------------------------------------------------------------------------

function ChannelSlider({
	value,
	max,
	onValue,
	label,
	valueText,
	background,
	thumbColor,
	className,
	...props
}: Omit<ComponentPropsWithRef<"div">, "children"> & {
	value: number;
	max: number;
	onValue: (next: number) => void;
	label: string;
	valueText: string;
	background: string;
	thumbColor: string;
}) {
	const { disabled, commit } = usePickerContext("ColorPicker slider");
	const { railRef, thumbRef, dragging, handlers } = useDrag(
		(x) => onValue(x * max),
		commit,
		disabled,
	);
	const x = useGlide((value / max) * 100);

	return (
		<div
			{...props}
			{...handlers}
			className={cn(
				// Same glide-box containment as the area above: the Thumb is
				// translated by % of its own full-size box.
				"relative h-3.5 w-full touch-none rounded-full contain-layout",
				TOUCH_GESTURE_CLASS,
				disabled ? "cursor-not-allowed" : "",
				className,
			)}
			style={{ background }}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-black/10 ring-inset"
			/>
			{/* The rail is inset by half a thumb so the thumb never leaves the rounded track. */}
			<div ref={railRef} className="absolute inset-y-0 right-[9px] left-[9px]">
				<Thumb
					thumbRef={thumbRef}
					dragging={dragging}
					color={thumbColor}
					glide={x.spring}
					x={x.offset}
					role="slider"
					tabIndex={disabled ? -1 : 0}
					aria-label={label}
					aria-orientation="horizontal"
					aria-valuemin={0}
					aria-valuemax={max}
					aria-valuenow={Math.round(value)}
					aria-valuetext={valueText}
					aria-disabled={disabled || undefined}
					onKeyDown={(event) => {
						if (disabled) return;
						const step = keyStep(event, 10);
						if (!step) return;
						event.preventDefault();
						if (step === "min") onValue(0);
						else if (step === "max") onValue(max);
						else onValue(Math.round(value) + step.delta);
						commit();
					}}
				/>
			</div>
		</div>
	);
}

export interface ColorPickerHueProps
	extends Omit<ComponentPropsWithRef<"div">, "children"> {
	label?: string;
}

export function ColorPickerHue({
	label = "Hue",
	...props
}: ColorPickerHueProps) {
	const { hsva, update } = usePickerContext("ColorPickerHue");
	const h = Math.round(hsva.h);
	return (
		<ChannelSlider
			{...props}
			value={hsva.h}
			max={360}
			onValue={(next) => update({ ...hsva, h: next })}
			label={label}
			valueText={`${h} degrees`}
			background="linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)"
			thumbColor={`hsl(${hsva.h} 100% 50%)`}
		/>
	);
}

// ---------------------------------------------------------------------------
// Text fields
// ---------------------------------------------------------------------------

const FIELD_CLASS =
	"h-9 w-full min-w-0 rounded-lg border border-border bg-background text-sm text-foreground tabular-nums outline-none transition-colors focus-visible:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed";

/** A horizontal shake for rejected input; dropped under reduced motion. */
function useRejectShake() {
	const [scope, animate] = useAnimate<HTMLDivElement>();
	const reduce = useReducedMotion();
	return {
		scope,
		shake: () => {
			if (reduce || !scope.current) return;
			animate(
				scope.current,
				{ x: [0, -5, 5, -3, 3, 0] },
				{ duration: DURATION.control },
			);
		},
	};
}

export interface ColorPickerHexInputProps
	extends Omit<
		ComponentPropsWithRef<"input">,
		"value" | "defaultValue" | "type"
	> {}

/** Hex field. Updates live once six or eight digits are typed, reverts invalid input on blur. */
export function ColorPickerHexInput({
	className,
	onChange,
	onBlur,
	onKeyDown,
	"aria-label": ariaLabel = "Hex color",
	...props
}: ColorPickerHexInputProps) {
	const { hsva, hex, update, commit, disabled } = usePickerContext(
		"ColorPickerHexInput",
	);
	const [draft, setDraft] = useState<string | null>(null);
	const { scope, shake } = useRejectShake();

	const settle = () => {
		if (draft === null) return;
		const parsed = parseHex(draft);
		if (parsed) {
			update(rgbaToHsva(parsed, hsva));
			commit();
		} else shake();
		setDraft(null);
	};

	return (
		<div ref={scope} className={cn("relative min-w-0 flex-1", className)}>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm"
			>
				#
			</span>
			<input
				{...props}
				type="text"
				inputMode="text"
				autoComplete="off"
				spellCheck={false}
				maxLength={9}
				disabled={disabled}
				aria-label={ariaLabel}
				value={draft ?? hex.slice(1).toUpperCase()}
				onChange={(event) => {
					onChange?.(event);
					const next = event.target.value.replace(/^#/, "");
					setDraft(next);
					// Live preview only for full-length entries, so "abc" mid-way to
					// "abcdef" does not flash a short-form color.
					if (next.length === 6 || next.length === 8) {
						const parsed = parseHex(next);
						if (parsed) update(rgbaToHsva(parsed, hsva));
					}
				}}
				onBlur={(event) => {
					onBlur?.(event);
					settle();
				}}
				onKeyDown={(event) => {
					onKeyDown?.(event);
					if (event.key === "Enter") settle();
					if (event.key === "Escape" && draft !== null) {
						event.preventDefault();
						setDraft(null);
					}
				}}
				className={cn(FIELD_CLASS, "pr-3 pl-6 font-mono uppercase")}
			/>
		</div>
	);
}

type ChannelSpec = {
	key: string;
	short: string;
	name: string;
	max: number;
	value: number;
	set: (n: number) => Hsva;
};

function ChannelField({ spec }: { spec: ChannelSpec }) {
	const { update, commit, disabled } = usePickerContext("ColorPickerChannels");
	const [draft, setDraft] = useState<string | null>(null);
	const shown = Math.round(spec.value);

	return (
		<label className="flex min-w-0 flex-1 flex-col items-center gap-1">
			<input
				type="text"
				inputMode="numeric"
				autoComplete="off"
				disabled={disabled}
				aria-label={spec.name}
				value={draft ?? String(shown)}
				onChange={(event) => {
					const next = event.target.value.replace(/[^\d]/g, "").slice(0, 3);
					setDraft(next);
					if (next !== "") update(spec.set(clamp(Number(next), 0, spec.max)));
				}}
				onBlur={() => {
					if (draft !== null) commit();
					setDraft(null);
				}}
				onKeyDown={(event) => {
					const delta =
						event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
					if (delta) {
						event.preventDefault();
						setDraft(null);
						update(
							spec.set(
								clamp(shown + delta * (event.shiftKey ? 10 : 1), 0, spec.max),
							),
						);
						commit();
					} else if (event.key === "Enter") {
						setDraft(null);
						commit();
					}
				}}
				className={cn(FIELD_CLASS, "px-1 text-center")}
			/>
			<span
				aria-hidden="true"
				className="font-medium text-[11px] text-muted-foreground"
			>
				{spec.short}
			</span>
		</label>
	);
}

export type ColorPickerChannelsProps = Omit<
	ComponentPropsWithRef<"div">,
	"children"
>;
export function ColorPickerChannels({
	className,
	...props
}: ColorPickerChannelsProps) {
	const { hsva, rgba } = usePickerContext("ColorPickerChannels");
	const fromRgb = (patch: Partial<Rgba>) =>
		rgbaToHsva({ ...rgba, ...patch }, hsva);
	const specs: ChannelSpec[] = [
		{
			key: "r",
			short: "R",
			name: "Red",
			max: 255,
			value: rgba.r,
			set: (n) => fromRgb({ r: n }),
		},
		{
			key: "g",
			short: "G",
			name: "Green",
			max: 255,
			value: rgba.g,
			set: (n) => fromRgb({ g: n }),
		},
		{
			key: "b",
			short: "B",
			name: "Blue",
			max: 255,
			value: rgba.b,
			set: (n) => fromRgb({ b: n }),
		},
	];
	return (
		<div {...props} className={cn("flex min-w-0 flex-1 gap-1.5", className)}>
			{specs.map((spec) => (
				<ChannelField key={spec.key} spec={spec} />
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

// The selection ring hops between swatches over a low arc instead of sliding.
// arc() bends with distance (the apex sits at half of strength x distance), so
// a neighbour gets a ~5px hop and a jump across the row clears the fields above.
// Automatic direction always puts a horizontal bulge below the row; a negative
// strength mirrors it above, in both directions of travel.
const PRESET_HOP: Transition = {
	...SPRING_LAYOUT,
	layout: { ...SPRING_LAYOUT, path: arc({ strength: -0.3 }) },
};

export type ColorPickerPresetsProps = ComponentPropsWithRef<"div">;

export function ColorPickerPresets({
	className,
	children,
	...props
}: ColorPickerPresetsProps) {
	const { id } = usePickerContext("ColorPickerPresets");
	return (
		<div {...props} className={cn("flex flex-wrap gap-2", className)}>
			<LayoutGroup id={`${id}-presets`}>{children}</LayoutGroup>
		</div>
	);
}

export interface ColorPickerPresetProps
	extends Omit<ComponentPropsWithRef<"button">, "value" | "children" | "type"> {
	/** Hex color this preset applies. */
	value: string;
	/** Accessible color name. Defaults to the hex. */
	label?: string;
}

export function ColorPickerPreset({
	value,
	label,
	className,
	onClick,
	...props
}: ColorPickerPresetProps) {
	const { hsva, hex, update, commit, disabled } =
		usePickerContext("ColorPickerPreset");
	const reduce = useReducedMotion();
	const parsed = parseHex(value);
	const normalized = parsed ? formatHex(parsed) : value;
	const selected = normalized === hex;

	return (
		<motion.button
			{...(props as React.ComponentProps<typeof motion.button>)}
			type="button"
			disabled={disabled}
			aria-label={label ?? normalized}
			aria-pressed={selected}
			whileTap={reduce || disabled ? undefined : { scale: 0.88 }}
			transition={SPRING_PRESS}
			onClick={(event) => {
				onClick?.(event);
				if (event.defaultPrevented || !parsed) return;
				update(rgbaToHsva(parsed, hsva));
				commit();
			}}
			className={cn(
				"relative size-6 shrink-0 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-3 disabled:cursor-not-allowed",
				className,
			)}
		>
			{selected && (
				<motion.span
					aria-hidden="true"
					layoutId={reduce ? undefined : "color-picker-preset"}
					initial={false}
					transition={PRESET_HOP}
					className="pointer-events-none absolute -inset-[3px] rounded-full border-2 border-foreground/70"
				/>
			)}
			<span
				aria-hidden="true"
				className="absolute inset-0 overflow-hidden rounded-full"
				style={{ background: CHECKERBOARD }}
			>
				<span
					className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
					style={{ backgroundColor: normalized }}
				/>
			</span>
		</motion.button>
	);
}

/** Base UI render prop supports a whole-tile trigger without a compulsory chip. */
export function ColorPickerTrigger(
	props: ComponentPropsWithRef<typeof PopoverTrigger>,
) {
	const { disabled } = usePickerContext("ColorPickerTrigger");
	return (
		<PopoverTrigger
			data-color-picker-trigger=""
			disabled={disabled}
			{...props}
		/>
	);
}
export function ColorPickerContent({
	align = "start",
	className,
	style,
	onKeyDown,
	...props
}: ComponentPropsWithRef<typeof PopoverPopup> & {
	align?: "start" | "center" | "end";
}) {
	const reduce = useReducedMotion();
	const { setOpen } = usePickerContext("ColorPickerContent");
	return (
		<PopoverPortal>
			<PopoverPositioner align={align} sideOffset={8} collisionPadding={8}>
				<PopoverPopup
					{...props}
					aria-label={props["aria-label"] ?? "Color picker"}
					data-color-picker-content=""
					onKeyDown={(event) => {
						onKeyDown?.(event);
						if (event.key !== "Escape") return;
						// A field may consume Escape to discard its text draft first.
						// In either case the native window listener must not close settings.
						const consumed = event.defaultPrevented;
						event.preventDefault();
						event.stopPropagation();
						if (!consumed) setOpen(false);
					}}
					className={cn(
						"flex max-h-[var(--available-height)] w-72 max-w-[calc(100vw-16px)] origin-[var(--transform-origin)] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-lg transition-[opacity,transform] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
						className,
					)}
					style={{
						...style,
						animation: "none",
						transitionDuration: `${reduce ? 0 : DURATION.control * 1000}ms`,
						transitionTimingFunction: EASE_CSS.out,
					}}
				/>
			</PopoverPositioner>
		</PopoverPortal>
	);
}
