import { Children, isValidElement, type ReactNode } from "react";

interface WidgetSectionProps {
	children?: ReactNode;
}

/**
 * A full-width shelf for dashboard widgets. It deliberately lives outside the
 * bookmark grid so the active card-column setting cannot constrain it.
 */
export function WidgetSection({ children }: WidgetSectionProps) {
	const widgets = Children.toArray(children);
	if (widgets.length === 0) return null;

	return (
		<section
			aria-label="Widgets"
			className="speed-dial-widget-section flex flex-wrap items-center justify-center gap-3.5"
		>
			{widgets.map((widget) => {
				const key = isValidElement(widget)
					? widget.key
					: typeof widget === "string" || typeof widget === "number"
						? String(widget)
						: undefined;
				return (
					<div className="speed-dial-widget-slot" key={key}>
						{widget}
					</div>
				);
			})}
		</section>
	);
}
