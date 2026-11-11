import { Checkbox } from "@ktab/ui/components/motion/checkbox";
import type { MouseEvent } from "react";

/**
 * Sibling selection control — never nested inside a card's link or folder
 * button, so toggling never navigates or opens.
 *
 * The inner Checkbox stays the official beUI default (motion + 20px
 * geometry + draw-on mark, driven by `checked`): this wrapper only owns
 * card integration — absolute placement, selected/hover visibility (via
 * tokens.css `.selection-checkbox`) and interaction vetoes. The inner
 * `onCheckedChange` is a sync noop so the store remains the single source
 * of truth; every click (button or the 32px hit padding) toggles once
 * through the wrapper's `onSelect`, preserving the full MouseEvent for
 * Shift-range selection.
 */
export function SelectionCheckbox({
	checked,
	label,
	onSelect,
}: {
	checked: boolean;
	label: string;
	onSelect: (event: MouseEvent) => void;
}) {
	return (
		/* The span is a positioning/hit-area wrapper: the inner beUI button
	   owns focus, keyboard and the accessible name, while the span only
	   delegates its bubble to the store toggle (keyboard Space/Enter fire
	   click on the inner button natively). */
		// biome-ignore lint/a11y/noStaticElementInteractions: wrapper delegates to inner button.
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard lands on the inner button.
		<span
			data-selection-checkbox
			className="selection-checkbox"
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => {
				event.stopPropagation();
				onSelect(event);
			}}
			onDragStart={(event) => event.preventDefault()}
		>
			<Checkbox
				checked={checked}
				onCheckedChange={() => undefined}
				aria-label={`Select ${label}`}
			/>
		</span>
	);
}
