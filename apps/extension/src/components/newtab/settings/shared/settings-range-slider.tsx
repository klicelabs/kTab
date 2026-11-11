import { RangeSlider } from "@ktab/ui/components/motion/range-slider";
import { useCallback, useEffect, useRef, useState } from "react";
import { glassShape } from "../../../../lib/glass";
import { flushPersist } from "../../../../lib/storage";
import { cn } from "../../../../lib/utils";

interface SettingsRangeSliderProps {
	label: string;
	value: number;
	suffix?: string;
	min: number;
	max: number;
	step?: number;
	onChange: (value: number) => void;
	className?: string;
	disabled?: boolean;
}

/**
 * The one continuous-control primitive in Settings. The beUI RangeSlider
 * owns pointer and keyboard semantics; this wrapper owns the compact kTab
 * readout and coalesces the final persistence flush for live settings.
 */
export function SettingsRangeSlider({
	label,
	value,
	suffix = "",
	min,
	max,
	step,
	onChange,
	className,
	disabled = false,
}: SettingsRangeSliderProps) {
	const [local, setLocal] = useState(value);
	const interacting = useRef(false);
	const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingValue = useRef<number | null>(null);
	const publishFrame = useRef<number | null>(null);
	const onChangeRef = useRef(onChange);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	const flushPendingChange = useCallback(() => {
		if (publishFrame.current !== null) {
			cancelAnimationFrame(publishFrame.current);
			publishFrame.current = null;
		}
		const next = pendingValue.current;
		pendingValue.current = null;
		if (next !== null) onChangeRef.current(next);
	}, []);

	const scheduleChange = useCallback((next: number) => {
		pendingValue.current = next;
		if (publishFrame.current !== null) return;
		publishFrame.current = requestAnimationFrame(() => {
			publishFrame.current = null;
			const valueToPublish = pendingValue.current;
			pendingValue.current = null;
			if (valueToPublish !== null) onChangeRef.current(valueToPublish);
		});
	}, []);

	useEffect(() => {
		if (!interacting.current) setLocal(value);
	}, [value]);

	useEffect(
		() => () => {
			flushPendingChange();
			if (flushTimer.current) clearTimeout(flushTimer.current);
			void flushPersist().catch(() => undefined);
		},
		[flushPendingChange],
	);

	function flushInteraction() {
		flushPendingChange();
		if (flushTimer.current) clearTimeout(flushTimer.current);
		flushTimer.current = null;
		interacting.current = false;
		void flushPersist().catch(() => undefined);
	}

	function scheduleInteractionFlush() {
		if (flushTimer.current) clearTimeout(flushTimer.current);
		flushTimer.current = setTimeout(() => {
			flushTimer.current = null;
			interacting.current = false;
			void flushPersist().catch(() => undefined);
		}, 400);
	}

	return (
		<fieldset
			aria-label={`${label} slider`}
			className={cn("m-0 min-w-0 border-0 p-0", className)}
			onPointerDown={() => {
				interacting.current = true;
			}}
			onPointerUp={flushInteraction}
			onPointerCancel={flushInteraction}
			onLostPointerCapture={flushInteraction}
			onKeyUp={flushInteraction}
			onBlur={flushInteraction}
		>
			<RangeSlider
				value={local}
				min={min}
				max={max}
				step={step}
				showTicks={false}
				disabled={disabled}
				aria-label={label}
				formatValueText={(next) => `${next}${suffix}`}
				valueLabel={`${local}${suffix}`}
				className={cn(
					"h-8 bg-neutral-900/[0.05] dark:bg-white/[0.06]",
					glassShape("control"),
				)}
				onValueChange={(next) => {
					interacting.current = true;
					setLocal(next);
					scheduleChange(next);
					scheduleInteractionFlush();
				}}
			/>
		</fieldset>
	);
}
