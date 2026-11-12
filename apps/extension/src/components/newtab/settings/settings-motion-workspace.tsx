import { SidebarProvider } from "@ktab/ui/components/sidebar";
import {
	type ComponentProps,
	type CSSProperties,
	type ReactNode,
	startTransition,
	useCallback,
	useEffect,
	useState,
} from "react";
import {
	isSettingsLayoutOpen,
	settingsMotionStore,
	useSettingsMotionStore,
} from "../../../stores/settings-motion-store";
import { BackgroundLayer } from "../background-layer";
import { WeatherAtmosphereOverlay } from "../weather/weather-atmosphere-overlay";
import { WeatherRuntime } from "../weather/weather-runtime";
import { SettingsSidebar } from "./settings-sidebar";

type SettingsMotionWorkspaceProps = {
	children: ReactNode;
};

/** Static Home boundary: Settings must never invalidate the grid's layout. */
export function SettingsMotionWorkspace({
	children,
}: SettingsMotionWorkspaceProps) {
	return (
		// SidebarProvider is intentionally uncontrolled here. Its generic open
		// context wraps Home; changing it would propagate through the full grid.
		// Only the sibling Settings panel subscribes to its motion phase.
		<SidebarProvider
			style={
				{
					"--sidebar-width": "var(--settings-sidebar-width)",
				} as CSSProperties
			}
			className="settings-workspace relative h-screen min-h-screen w-screen min-w-0 overflow-hidden bg-neutral-100 dark:bg-[#252525]"
		>
			{children}
		</SidebarProvider>
	);
}

export function SettingsMotionFrame({
	children,
	...props
}: ComponentProps<"div">) {
	return (
		<div {...props}>
			<BackgroundLayer contained />
			<WeatherRuntime />
			<WeatherAtmosphereOverlay />
			{children}
		</div>
	);
}

export function SettingsMotionSidebar() {
	const phase = useSettingsMotionStore((state) => state.phase);
	const pane = useSettingsMotionStore((state) => state.pane);
	const action = useSettingsMotionStore((state) => state.action);
	const [prepared, setPrepared] = useState(false);
	useEffect(() => {
		if (prepared) return;
		if (phase !== "closed") {
			setPrepared(true);
			return;
		}
		// Do not add Settings to Home's initial render. Prepare it at idle and
		// retain its controls/geometry so opening never has to rebuild them.
		const prepare = () => startTransition(() => setPrepared(true));
		if (typeof window.requestIdleCallback === "function") {
			const idle = window.requestIdleCallback(prepare);
			return () => window.cancelIdleCallback(idle);
		}
		const timeout = window.setTimeout(prepare, 1000);
		return () => window.clearTimeout(timeout);
	}, [phase, prepared]);
	const finishOpen = useCallback(
		() => settingsMotionStore.getState().finishOpen(),
		[],
	);
	if (phase === "closed" && !prepared) return null;

	return (
		<SettingsSidebar
			open={isSettingsLayoutOpen(phase)}
			onOpenComplete={finishOpen}
			onClose={() => settingsMotionStore.getState().close()}
			onCloseComplete={() => settingsMotionStore.getState().finishClose()}
			initialPane={pane}
			initialAction={action}
		/>
	);
}
