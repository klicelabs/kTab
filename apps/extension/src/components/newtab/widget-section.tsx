import { Children, type ReactNode } from "react";

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
		<section aria-label="Widgets" className="speed-dial-widget-section">
			{widgets.map((widget, index) => (
				<div className="speed-dial-widget-slot" key={index}>
					{widget}
				</div>
			))}
		</section>
	);
}
