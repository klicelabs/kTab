import { LiquidGlass } from "@ktab/ui/components/liquid-glass";
import {
	Sidebar,
	SidebarContent,
	SidebarHeader,
} from "@ktab/ui/components/sidebar";
import type { IconName } from "@ktab/ui/icons/icon";
import { Icon } from "@ktab/ui/icons/icon";
import { AnimatePresence, motion } from "motion/react";
import {
	startTransition,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	glassForeground,
	glassLensVeil,
	glassLiquidProps,
	glassShape,
} from "../../../lib/glass";
import {
	PAGE_VARIANTS,
	type PageMotionContext,
} from "../../../lib/page-motion";
import { cn } from "../../../lib/utils";
import { useHistoryStore } from "../../../stores/history-store";
import { useAppearance, useGlassAppearance } from "../appearance-provider";
import { AdvancedPane } from "./panes/advanced-pane";
import { AppearancePane } from "./panes/appearance-pane";
import { BookmarksPane } from "./panes/bookmarks-pane";
import { GeneralPane } from "./panes/general-pane";
import { PexelsDetailView } from "./panes/pexels-controls";
import { SettingsRootPane } from "./panes/root-settings-pane";
import { SearchPane } from "./panes/search-pane";
import { WallpaperPane } from "./panes/wallpaper-pane";
import {
	createSettingsNavigation,
	pushSettingsNavigation,
	SETTINGS_PANE_LABELS,
	type SettingsNavigationState,
	type SettingsPaneId,
	type SettingsSidebarProps,
	stepSettingsNavigation,
} from "./settings-types";
import {
	SETTINGS_CONTENT_FRAME,
	SETTINGS_CONTENT_PADDING,
	SETTINGS_FOCUS_RING,
	SETTINGS_FRAME_INSET,
	SETTINGS_HEADER_CONTROL,
	SETTINGS_HEADER_HEIGHT,
	SETTINGS_HEADER_INSET,
	SETTINGS_SIDEBAR_SHELL,
} from "./shared/settings-tokens";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
	const query = window.matchMedia(REDUCED_MOTION_QUERY);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

function readReducedMotion() {
	return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function serverReducedMotion() {
	return false;
}

/**
 * Settings slides over a stable Home. Only the panel is transformed; neither
 * its mount nor its travel changes the grid or the wallpaper's geometry.
 */

/**
 * Settings header chrome (Back / Close). The Settings BODY stays Flat, but
 * the chrome follows the material mode at the shared 34px toolbar geometry:
 * a Glass hero control in Glass mode, the quiet Flat control otherwise.
 * One focus language (accent ring) in both — never a stacked ring + wash.
 */
function SettingsChromeButton({
	icon,
	label,
	onClick,
	buttonRef,
}: {
	icon: IconName;
	label: string;
	onClick: () => void;
	buttonRef?: React.Ref<HTMLButtonElement>;
}) {
	const { isLiquid, resolvedDark } = useAppearance();
	const { glassParams } = useGlassAppearance();
	const glyph = (
		<Icon name={icon} size={17} strokeWidth={1.5} aria-hidden="true" />
	);

	if (isLiquid) {
		const optics = glassLiquidProps(glassParams, "clear");
		return (
			<LiquidGlass
				blur={optics.blur}
				refract
				refraction={optics.refraction}
				saturation={optics.saturation}
				brightness={optics.brightness}
				bezel={optics.bezel}
				shape="toolbarIcon"
				className={cn(
					"size-[34px] shrink-0",
					glassLensVeil("hero", resolvedDark),
				)}
			>
				<button
					ref={buttonRef}
					type="button"
					onClick={onClick}
					aria-label={label}
					title={label}
					data-settings-ui="true"
					className={cn(
						"flex size-full items-center justify-center bg-transparent transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96]",
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ktab-accent)]",
						glassForeground(),
						"hover:bg-foreground/[0.10] hover:text-[var(--ktab-glass-foreground-primary)] active:bg-foreground/15",
					)}
				>
					{glyph}
				</button>
			</LiquidGlass>
		);
	}

	return (
		<button
			ref={buttonRef}
			type="button"
			className={cn(
				"size-[34px]",
				SETTINGS_HEADER_CONTROL,
				SETTINGS_FOCUS_RING,
			)}
			onClick={onClick}
			aria-label={label}
			title={label}
			data-settings-ui="true"
		>
			{glyph}
		</button>
	);
}
export function SettingsSidebar({
	open,
	onClose,
	onOpenComplete,
	onCloseComplete,
	initialPane,
	initialAction,
}: SettingsSidebarProps) {
	const [navigation, setNavigation] = useState<SettingsNavigationState>(() =>
		createSettingsNavigation(initialPane),
	);
	const [paneDirection, setPaneDirection] = useState<1 | -1>(1);
	// Motion 13's hook snapshots this preference at mount. A retained drawer
	// must also react to changes, or CSS can stop motion while JS awaits its end.
	const reduceMotion = useSyncExternalStore(
		subscribeReducedMotion,
		readReducedMotion,
		serverReducedMotion,
	);
	// Paint the small shell first. The controls mount in a concurrent render,
	// so a cold open does not put their entire React tree in the input commit.
	const [contentReady, setContentReady] = useState(false);
	useEffect(() => {
		// Let the browser present the shell and start its native transition
		// before mounting the controls, including their layout measurements.
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				startTransition(() => setContentReady(true));
			});
		});
		return () => cancelAnimationFrame(frame);
	}, []);
	const paneMotionContext: PageMotionContext = {
		direction: paneDirection === 1 ? "forward" : "back",
		kind: "settings",
		reduceMotion,
	};
	const contentRef = useRef<HTMLElement>(null);
	const slotRef = useRef<HTMLDivElement>(null);
	const rootScrollTopRef = useRef(0);
	const closeControlRef = useRef<HTMLButtonElement>(null);
	const wasOpenRef = useRef(open);
	const focusAfterEnterRef = useRef(open);
	const restoreFocusRef = useRef(false);

	// Keep the subtree inert while it is offscreen. During motion, changing
	// inert would invalidate every descendant's style tree; the transition
	// boundary toggles it after the panel is no longer moving.
	// P2: a fresh mount that starts open never runs the enter transform
	// transition, so no transitionend would ever lift `inert` — the panel
	// would stay visible-but-dead. Only arm inert when mounting closed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only arm; `open` is read intentionally once, transitions own it afterwards.
	useLayoutEffect(() => {
		if (!open) slotRef.current?.setAttribute("inert", "");
	}, []);

	useEffect(() => {
		if (!open) return;
		rootScrollTopRef.current = 0;
		const nextNavigation = createSettingsNavigation(initialPane);
		setNavigation((current) => {
			const sameEntries =
				current.entries.length === nextNavigation.entries.length &&
				current.entries.every(
					(entry, index) => entry === nextNavigation.entries[index],
				);
			return current.root === nextNavigation.root &&
				current.index === nextNavigation.index &&
				sameEntries
				? current
				: nextNavigation;
		});
	}, [initialPane, open]);

	useEffect(() => {
		if (open && !wasOpenRef.current) {
			focusAfterEnterRef.current = true;
		}
		wasOpenRef.current = open;
	}, [open]);

	useEffect(() => {
		if (open) return;
		const activeElement = document.activeElement;
		const focusReturnedFromSidebar =
			restoreFocusRef.current ||
			(activeElement instanceof HTMLElement &&
				Boolean(activeElement.closest("[data-settings-sidebar-slot]")));
		restoreFocusRef.current = false;
		if (!focusReturnedFromSidebar) return;
		// Home's trigger subscribes separately and may still be inert in this
		// passive effect. Restore only after that sibling has committed too.
		const frame = requestAnimationFrame(() => {
			document
				.getElementById("settings-trigger")
				?.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, [open]);

	const completeTransition = useCallback(() => {
		if (open) {
			slotRef.current?.removeAttribute("inert");
			if (focusAfterEnterRef.current) {
				focusAfterEnterRef.current = false;
				closeControlRef.current?.focus({ preventScroll: true });
			}
			onOpenComplete?.();
			return;
		}
		slotRef.current?.setAttribute("inert", "");
		onCloseComplete?.();
	}, [onCloseComplete, onOpenComplete, open]);

	useEffect(() => {
		if (reduceMotion) {
			completeTransition();
			return;
		}
		// Cancellation, a hidden page or an interrupted first frame can omit
		// transitionend. Finish both presence and inert/focus at the same boundary.
		const timeout = window.setTimeout(completeTransition, 400);
		return () => window.clearTimeout(timeout);
	}, [completeTransition, reduceMotion]);

	const activePane: SettingsPaneId =
		navigation.entries[navigation.index] ?? initialPane ?? "general";
	const activePaneLabel = SETTINGS_PANE_LABELS[activePane];
	const showRoot = navigation.root;

	const navigateTo = useCallback(
		(pane: SettingsPaneId) => {
			if (showRoot) {
				rootScrollTopRef.current = contentRef.current?.scrollTop ?? 0;
			}
			setPaneDirection(1);
			setNavigation((state) => pushSettingsNavigation(state, pane));
		},
		[showRoot],
	);

	const goRoot = useCallback(() => {
		setPaneDirection(-1);
		setNavigation((state) => stepSettingsNavigation(state, "back"));
	}, []);

	const handleClose = useCallback(() => {
		const activeElement = document.activeElement;
		restoreFocusRef.current =
			activeElement instanceof HTMLElement &&
			Boolean(activeElement.closest("[data-settings-sidebar-slot]"));
		onClose();
	}, [onClose]);

	// A non-modal sidebar still owns Escape while it is open. It does not lock
	// body scroll or trap focus: the Speed Dial remains a live sibling surface.
	useEffect(() => {
		if (!open) return;
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			// A focused unified Search owns Escape first. Let it collapse its
			// floating result surface without dismissing the sibling sidebar.
			if (event.defaultPrevented) return;
			// M16: an open history confirmation claimed this Esc in the
			// capture phase (preventDefault + stopPropagation). Stand down —
			// one physical Esc must never cancel the confirmation AND close
			// settings together.
			if (useHistoryStore.getState().pending) return;
			event.preventDefault();
			handleClose();
		}
		// After nested controls, before Home's window-level clear-selection
		// handler. Idle preparation must not make ownership registration-order dependent.
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [handleClose, open]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			if (showRoot) {
				contentRef.current?.scrollTo({
					top: rootScrollTopRef.current,
					behavior: "auto",
				});
				return;
			}
			if (activePane) {
				contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [activePane, showRoot]);

	return (
		<div
			ref={slotRef}
			className="flex min-h-0 min-w-0 shrink-0 justify-end overflow-hidden"
			data-settings-open={open ? "true" : "false"}
			data-settings-sidebar-slot="true"
			aria-hidden={!open}
		>
			<Sidebar
				side="right"
				variant="inset"
				collapsible="none"
				id="settings-sidebar"
				aria-label="Settings"
				data-settings-panel="true"
				onTransitionEnd={(event) => {
					if (
						event.target === event.currentTarget &&
						event.propertyName === "transform"
					) {
						completeTransition();
					}
				}}
				className={cn(
					"h-full min-w-0 shrink-0",
					glassShape("panel"),
					SETTINGS_SIDEBAR_SHELL,
				)}
			>
				<SidebarHeader className="p-0">
					<header
						className={cn(
							"flex shrink-0 items-center gap-3",
							SETTINGS_HEADER_HEIGHT,
							SETTINGS_HEADER_INSET,
						)}
					>
						{!showRoot && (
							<SettingsChromeButton
								icon="chevron-left"
								label={`Back to ${navigation.index > 0 ? SETTINGS_PANE_LABELS[navigation.entries[navigation.index - 1]] : "Preferences"}`}
								onClick={goRoot}
							/>
						)}
						<div className="min-w-0 flex-1">
							<h2
								id="settings-panel-title"
								className="truncate font-semibold text-[16px] tracking-[-0.01em]"
								aria-live="polite"
							>
								{showRoot ? "Preferences" : activePaneLabel}
							</h2>
							<p className="sr-only">kTab preferences</p>
						</div>
						<SettingsChromeButton
							icon="x"
							label="Close preferences"
							buttonRef={closeControlRef}
							onClick={handleClose}
						/>
					</header>
				</SidebarHeader>

				<SidebarContent
					className={cn(
						"min-h-0 overflow-hidden pt-1 pb-0",
						SETTINGS_FRAME_INSET,
					)}
				>
					<div
						className={cn(
							"flex min-h-0 flex-1 flex-col overflow-hidden",
							glassShape("panel"),
							SETTINGS_CONTENT_FRAME,
						)}
						data-settings-ui="true"
					>
						<main
							id="settings-page-content"
							ref={contentRef}
							className={cn(
								"settings-content-scroll scrollbar-hidden min-h-0 flex-1 overflow-y-auto",
								SETTINGS_CONTENT_PADDING,
							)}
							aria-labelledby="settings-panel-title"
						>
							<div className="grid min-h-0 w-full">
								<AnimatePresence
									initial={false}
									mode="popLayout"
									custom={paneMotionContext}
								>
									{!contentReady ? null : showRoot ? (
										<motion.div
											key="settings-root"
											initial="initial"
											animate="animate"
											exit="exit"
											variants={PAGE_VARIANTS}
											custom={paneMotionContext}
											className="w-full [grid-area:1/1]"
											data-settings-root="true"
										>
											<SettingsRootPane onNavigate={navigateTo} />
										</motion.div>
									) : (
										<motion.div
											key={activePane}
											initial="initial"
											animate="animate"
											exit="exit"
											variants={PAGE_VARIANTS}
											custom={paneMotionContext}
											className="w-full [grid-area:1/1]"
										>
											{activePane === "general" && <GeneralPane />}
											{activePane === "appearance" && (
												<AppearancePane
													onOpenWallpaper={() => navigateTo("wallpaper")}
												/>
											)}
											{activePane === "wallpaper" && (
												<WallpaperPane
													onOpenPexels={() => navigateTo("pexels")}
												/>
											)}
											{activePane === "pexels" && <PexelsDetailView />}
											{activePane === "search" && <SearchPane />}
											{activePane === "bookmarks" && (
												<BookmarksPane initialAction={initialAction} />
											)}
											{activePane === "advanced" && (
												<AdvancedPane onCloseParent={onClose} />
											)}
										</motion.div>
									)}
								</AnimatePresence>
							</div>
						</main>
					</div>
				</SidebarContent>
			</Sidebar>
		</div>
	);
}
