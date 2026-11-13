import { Component, type ReactNode } from "react";

interface DashboardErrorBoundaryProps {
	children: ReactNode;
	fallback: (retry: () => void) => ReactNode;
}

interface DashboardErrorBoundaryState {
	error: Error | null;
}

export class DashboardErrorBoundary extends Component<
	DashboardErrorBoundaryProps,
	DashboardErrorBoundaryState
> {
	state: DashboardErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): DashboardErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error) {
		console.error("A dashboard section failed to render.", error.name);
	}

	retry = () => {
		this.setState({ error: null });
	};

	render() {
		return this.state.error
			? this.props.fallback(this.retry)
			: this.props.children;
	}
}

export function DashboardSectionFallback({
	label,
	retry,
	className,
}: {
	label: string;
	retry: () => void;
	className?: string;
}) {
	return (
		<div
			className={`flex min-h-20 items-center justify-between gap-4 rounded-[var(--shape-section)] border border-white/15 bg-black/30 px-4 py-3 text-white/90 ${className ?? ""}`}
			role="alert"
		>
			<div className="min-w-0">
				<p className="font-medium text-[13px]">{label} could not load</p>
				<p className="mt-1 text-[11px] text-white/65">
					Try again to restore this section.
				</p>
			</div>
			<button
				type="button"
				onClick={retry}
				className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px]"
			>
				Try again
			</button>
		</div>
	);
}
