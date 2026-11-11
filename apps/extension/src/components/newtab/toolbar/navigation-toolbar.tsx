import { Button } from "@ktab/ui/components/button";
import { ButtonGroup } from "@ktab/ui/components/button-group";
import { GlassButtonGroup } from "@ktab/ui/components/glass-button-group";
import { Icon } from "@ktab/ui/icons/icon";
import { ktabShape } from "@ktab/ui/lib/shapes";
import { flatSeparator, flatSurface } from "@ktab/ui/lib/surface";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpringLoad } from "../../../hooks/use-spring-load";
import { getActiveDrag } from "../../../lib/dnd";
import {
	glassForeground,
	glassLensVeil,
	glassLiquidProps,
	HERO_TEXT_SHADOW,
	wallpaperText,
} from "../../../lib/glass";
import type { NavigationDirection } from "../../../lib/navigation";
import {
	TOOLBAR,
	TOOLBAR_HEIGHT,
	TOOLBAR_ICON,
	toolbarIconClass,
	toolbarIconSize,
} from "../../../lib/toolbar-tokens";
import { cn } from "../../../lib/utils";
import type { InsertPosition } from "../../../stores/setup-store";
import type { Folder } from "../../../types";
import { useAppearance, useGlassAppearance } from "../appearance-provider";
import { FolderTabs } from "./folder-tabs";

interface NavigationToolbarProps {
	rootFolders: Folder[];
	activeRootId: string;
	navigationDirection: NavigationDirection;
	/** Full breadcrumb to the active folder (length > 1 inside a subfolder). */
	breadcrumb: Folder[];
	canGoBack: boolean;
	canGoForward: boolean;
	onBack: () => void;
	onForward: () => void;
	onSelectFolder: (id: string) => void;
	onAddFolder: (name: string) => string;
	/** Direct root-folder creation ("New Folder" + inline rename). */
	onNewRootFolder: () => void;
	/** Direct subfolder creation ("New Folder" + inline rename). */
	onNewSubfolder: (parentId: string | null) => void;
	onDeleteFolder?: (id: string) => void;
	/** Hover preview while a root is dragged across the lane gaps. */
	onPreviewReorderFolders?: (
		draggedId: string,
		targetId: string,
		position?: InsertPosition,
	) => void;
	/** The drop that ends a gap drag: converges order and commits history. */
	onCommitReorderFolders?: (
		draggedId: string,
		targetId: string,
		position?: InsertPosition,
	) => void;
	onDropCards?: (cardId: string, folderId: string) => void;
	onMoveFolders?: (folderId: string, targetFolderId: string) => void;
	onMoveFolderToRoot?: (
		folderId: string,
		targetId: string,
		position: InsertPosition,
	) => void;
	isRootFolder?: (id: string) => boolean;
	canNestFolder?: (folderId: string, targetFolderId: string) => boolean;
}

/**
 * The only navigation unit in the new-tab shell. It is mounted in the
 * application toolbar, never in the scrolling content region.
 *
 * The left and right grid lanes are equal and non-owning: they reserve room
 * for controls while the center lane measures only the Tabbar's real budget.
 * That keeps the Tabbar's center anchor fixed when history or Settings changes.
 */
export function NavigationToolbar({
	rootFolders,
	activeRootId,
	navigationDirection,
	breadcrumb,
	canGoBack,
	canGoForward,
	onBack,
	onForward,
	onSelectFolder,
	onAddFolder,
	onNewRootFolder,
	onNewSubfolder,
	onDeleteFolder,
	onPreviewReorderFolders,
	onCommitReorderFolders,
	onDropCards,
	onMoveFolders,
	onMoveFolderToRoot,
	isRootFolder,
	canNestFolder,
}: NavigationToolbarProps) {
	const { isLiquid } = useAppearance();

	const sorted = useMemo(
		() => [...rootFolders].sort((a, b) => a.order - b.order),
		[rootFolders],
	);

	// Measure the center lane, not the natural width of the Tabbar. Controls in
	// the side lanes therefore never consume the Tabbar's overflow budget.
	const containerRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLDivElement>(null);
	const [visibleCount, setVisibleCount] = useState<number>(sorted.length);

	const updateOverflow = useCallback(() => {
		const container = containerRef.current;
		const measure = measureRef.current;
		if (!container || !measure) return;

		const available = container.clientWidth;
		const tabNodes = Array.from(measure.children).filter(
			(node): node is HTMLElement => node instanceof HTMLElement,
		);
		if (tabNodes.length === 0) {
			setVisibleCount(0);
			return;
		}

		const tabGap = 2;
		// Derived from the height system rather than duplicated as literals:
		// the Tabbar shell pads by the group inset on both sides, and the
		// overflow pill and the "+" affordance are both one control wide.
		const surfacePadding = TOOLBAR_HEIGHT.inset * 2;
		const overflowPillWidth = TOOLBAR_HEIGHT.control;
		const addButtonWidth = TOOLBAR_HEIGHT.control;
		const widths = tabNodes.map((node) => node.offsetWidth);
		const totalNatural = widths.reduce(
			(total, width, index) => total + width + (index > 0 ? tabGap : 0),
			surfacePadding,
		);

		if (totalNatural + tabGap + addButtonWidth <= available) {
			setVisibleCount(sorted.length);
			return;
		}

		const budget = available - overflowPillWidth - tabGap;
		let fit = 0;
		let used = surfacePadding;
		for (const [index, width] of widths.entries()) {
			const next = used + width + (index > 0 ? tabGap : 0);
			if (next > budget) break;
			used = next;
			fit += 1;
		}

		setVisibleCount(fit);
	}, [sorted]);

	useEffect(() => {
		updateOverflow();
		const container = containerRef.current;
		if (!container) return;
		const resizeObserver = new ResizeObserver(updateOverflow);
		resizeObserver.observe(container);
		return () => resizeObserver.disconnect();
	}, [updateOverflow]);

	// Webfonts shift tab widths after first paint; re-run the overflow fit
	// once they settle so the pill-only (fit=0) state is measured, not stuck.
	useEffect(() => {
		const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
		if (!fonts) return;
		let cancelled = false;
		fonts.ready
			.then(() => {
				if (!cancelled) updateOverflow();
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [updateOverflow]);

	const visibleFolders = useMemo(
		() => sorted.slice(0, visibleCount),
		[sorted, visibleCount],
	);
	const hiddenFolders = useMemo(
		() => sorted.slice(visibleCount),
		[sorted, visibleCount],
	);
	const hasOverflow = hiddenFolders.length > 0;
	const activeRootVisible = visibleFolders.some(
		(folder) => folder.id === activeRootId,
	);
	const currentFolder = breadcrumb[breadcrumb.length - 1];
	const activeRoot = sorted.find((folder) => folder.id === activeRootId);
	const contextualFolder = breadcrumb.length > 1 ? currentFolder : activeRoot;
	const showContextualTitle = Boolean(
		contextualFolder && (breadcrumb.length > 1 || !activeRootVisible),
	);

	return (
		<nav
			aria-label="Folder navigation"
			className="pointer-events-none absolute inset-0 flex items-center px-[var(--speed-dial-toolbar-gutter)]"
			data-speed-dial-navigation="true"
		>
			<div className="grid w-full grid-cols-[minmax(5rem,1fr)_minmax(0,2fr)_minmax(5rem,1fr)] items-center">
				<div className="pointer-events-auto flex min-w-0 items-center gap-2 overflow-hidden">
					<HistoryControls
						isLiquid={isLiquid}
						canGoBack={canGoBack}
						canGoForward={canGoForward}
						onBack={onBack}
						onForward={onForward}
					/>
					{showContextualTitle && contextualFolder && (
						<span
							className={cn(
								"min-w-0 truncate font-medium text-[13px]",
								wallpaperText("secondary"),
							)}
							style={{ textShadow: HERO_TEXT_SHADOW }}
							title={contextualFolder.name}
						>
							{contextualFolder.name}
						</span>
					)}
				</div>

				<div
					ref={containerRef}
					className="pointer-events-auto relative col-start-2 mx-auto flex w-full min-w-0 max-w-[880px] items-center justify-center"
				>
					<div className="relative flex min-w-0 max-w-full items-center">
						<FolderTabs
							folders={visibleFolders}
							hiddenFolders={hiddenFolders}
							activeRootId={activeRootId}
							activeFolderId={currentFolder?.id ?? activeRootId}
							navigationDirection={navigationDirection}
							showAddButton={!hasOverflow}
							onAddRoot={onNewRootFolder}
							onAddFolder={onAddFolder}
							onSelectFolder={onSelectFolder}
							onNewRootFolder={onNewRootFolder}
							onNewSubfolder={onNewSubfolder}
							onDeleteFolder={onDeleteFolder}
							onPreviewReorderFolders={onPreviewReorderFolders}
							onCommitReorderFolders={onCommitReorderFolders}
							onDropCards={onDropCards}
							onMoveFolders={onMoveFolders}
							onMoveFolderToRoot={onMoveFolderToRoot}
							isRootFolder={isRootFolder}
							canNestFolder={canNestFolder}
						/>
					</div>

					<div
						ref={measureRef}
						aria-hidden="true"
						className="pointer-events-none invisible absolute top-0 left-0 flex items-center gap-0.5"
						style={{ visibility: "hidden" }}
					>
						{sorted.map((folder) => (
							<span
								key={folder.id}
								className={cn(
									TOOLBAR.controlHeight,
									TOOLBAR.radius,
									"inline-flex max-w-[160px] items-center truncate px-3 font-normal text-[13px]",
								)}
							>
								{folder.name}
							</span>
						))}
					</div>
				</div>

				<div aria-hidden="true" className="min-w-0" />
			</div>
		</nav>
	);
}

interface HistoryControlsProps {
	isLiquid: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	onBack: () => void;
	onForward: () => void;
}

function HistoryControls({
	isLiquid,
	canGoBack,
	canGoForward,
	onBack,
	onForward,
}: HistoryControlsProps) {
	// Raw library primitives only.
	//
	// There is exactly ONE surface in each mode, and it owns the group's
	// geometry: in Glass mode that is the GlassButtonGroup's refractive
	// surface, in Flat mode the ButtonGroup itself. Neither mode wraps the
	// group in a second visual container, because a wrapper can only ever
	// approximate the segments inside it — which is how the control ended up
	// with a rounded shell around a square-er inner end.
	//
	// The segments are full-bleed: the group carries no inner padding, so the
	// hover/pressed wash reaches the capsule edge instead of floating as an
	// inset block with a square cut in the middle. The segments are h-full and
	// follow the group's surface height directly.
	//
	// kTab customizes only what it is allowed to: the group height, segment
	// width, the glyph token, the liquid wash tint, and the group's corner
	// role. Segment geometry, the seam and disabled state stay owned by the
	// group implementation.
	// Hooks below are unconditional so every render path shares one order.
	const { resolvedDark } = useAppearance();
	const { glassParams } = useGlassAppearance();
	// Shared spring-navigation gate: a Back/Forward dwell that just fired
	// locks both segments briefly so one held pointer cannot chain
	// Back → Back → Back (or straddle the divider into Forward) by accident.
	const springGate = useRef(0);
	const groupClassName = cn(TOOLBAR.groupHeight, "shrink-0");
	const groupButtons = (
		<>
			<HistoryButton
				icon="chevron-left"
				label="Back"
				disabled={!canGoBack}
				isLiquid={isLiquid}
				onClick={onBack}
				springEnabled={canGoBack}
				onSpringNavigate={onBack}
				springGate={springGate}
			/>
			{canGoForward && (
				<>
					<HistoryDivider isLiquid={isLiquid} />
					<HistoryButton
						icon="chevron-right"
						label="Forward"
						disabled={false}
						isLiquid={isLiquid}
						onClick={onForward}
						springEnabled={canGoForward}
						onSpringNavigate={onForward}
						springGate={springGate}
					/>
				</>
			)}
		</>
	);

	if (isLiquid) {
		const optics = glassLiquidProps(glassParams, "clear");
		return (
			<GlassButtonGroup
				glassVariant="liquid-refract"
				aria-label="Navigation history"
				aria-orientation="horizontal"
				className={groupClassName}
				data-history-controls="true"
				surfaceClassName={glassLensVeil("toolbar", resolvedDark)}
				liquidProps={{
					blur: optics.blur,
					refraction: optics.refraction,
					saturation: optics.saturation,
					brightness: optics.brightness,
					bezel: optics.bezel,
				}}
			>
				{groupButtons}
			</GlassButtonGroup>
		);
	}

	return (
		<ButtonGroup
			aria-label="Navigation history"
			aria-orientation="horizontal"
			className={cn(
				ktabShape("toolbarGroup"),
				flatSurface("floating"),
				// Toolbar controls carry no elevation: face wash only, so the
				// group never reads as floating above the wallpaper.
				"shadow-none",
				groupClassName,
			)}
			data-history-controls="true"
		>
			{groupButtons}
		</ButtonGroup>
	);
}

interface HistoryButtonProps {
	icon: "chevron-left" | "chevron-right";
	label: string;
	disabled: boolean;
	isLiquid: boolean;
	onClick: () => void;
	/** Spring-load DnD navigation: arm dwell only when history can traverse. */
	springEnabled: boolean;
	onSpringNavigate: () => void;
	/** Shared Back/Forward gate against accidental chained traversals. */
	springGate: React.RefObject<number>;
}

/** Dwell before a held drag traverses history (slower than folder springs:
 * history navigation destroys context, so it must never fire by accident). */
const HISTORY_SPRING_DELAY_MS = 750;
/** Per-direction cooldown after a spring traversal: the pointer is still
 * over the button, so re-arm requires a fresh dwell after this gap. */
const HISTORY_SPRING_COOLDOWN_MS = 1000;
/** Cross-button lock after any spring traversal (Back → Forward straddle). */
const HISTORY_SPRING_GATE_MS = 400;

/**
 * The native-style divider between the Back and Forward segments.
 *
 * Spotlight/Finder-like: a 1px hairline at roughly half the group height,
 * vertically centered, never edge-to-edge. It carries no data-slot so the
 * group's first/last-segment geometry selectors keep resolving exactly as
 * before — the divider sits *between* segments without becoming one.
 *
 * Glass gets a faint white hairline; Flat gets the engraved tonal groove
 * from the shared surface system (never a hard border color).
 */
function HistoryDivider({ isLiquid }: { isLiquid: boolean }) {
	return (
		<span
			aria-hidden="true"
			data-history-divider="true"
			className={cn(
				"h-[18px] w-px shrink-0 self-center transition-opacity duration-150",
				isLiquid ? "bg-foreground/15" : flatSeparator("vertical"),
			)}
		/>
	);
}

function HistoryButton({
	icon,
	label,
	disabled,
	isLiquid,
	onClick,
	springEnabled,
	onSpringNavigate,
	springGate,
}: HistoryButtonProps) {
	const [dwelling, setDwelling] = useState(false);
	const [cooling, setCooling] = useState(false);
	const enabledRef = useRef(springEnabled);
	enabledRef.current = springEnabled;
	const navigateRef = useRef(onSpringNavigate);
	navigateRef.current = onSpringNavigate;
	const dragIdentity = useRef<string | null>(null);
	const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const fireSpring = useCallback(() => {
		setDwelling(false);
		// Fire-time re-validation: the history stack may have changed
		// mid-dwell (pruned folders, external navigation), and the drag
		// itself may have been cancelled and replaced.
		if (!enabledRef.current) return;
		const live = getActiveDrag();
		const liveKey = live ? `${live.kind}:${live.id}` : null;
		if (!liveKey || liveKey !== dragIdentity.current) return;
		const now = Date.now();
		if (now - springGate.current < HISTORY_SPRING_GATE_MS) return;
		springGate.current = now;
		navigateRef.current();
		// Cooldown: the pointer is still over the button. Each further leg
		// costs a fresh dwell + gap, so draining the stack stays deliberate.
		setCooling(true);
		if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current);
		cooldownTimer.current = setTimeout(() => {
			cooldownTimer.current = null;
			setCooling(false);
		}, HISTORY_SPRING_COOLDOWN_MS);
	}, [springGate]);

	const spring = useSpringLoad(fireSpring, HISTORY_SPRING_DELAY_MS);

	useEffect(
		() => () => {
			if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current);
		},
		[],
	);

	function handleDragOver(e: React.DragEvent) {
		if (!enabledRef.current || cooling) return;
		if (!getActiveDrag()) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "move";
		const live = getActiveDrag();
		dragIdentity.current = live ? `${live.kind}:${live.id}` : null;
		if (!dwelling) {
			setDwelling(true);
			spring.start();
		}
	}

	function handleDragLeave(e: React.DragEvent) {
		const related = e.relatedTarget as Node | null;
		if (
			related &&
			e.currentTarget instanceof Node &&
			e.currentTarget.contains(related)
		) {
			return;
		}
		if (!dwelling) return;
		setDwelling(false);
		spring.cancel();
	}

	function handleDrop(e: React.DragEvent) {
		// History targets are view-only: swallow the drop so it can neither
		// persist a move nor fall through to a background append. The drag
		// payload stays alive for the destination page.
		e.preventDefault();
		e.stopPropagation();
		setDwelling(false);
		spring.cancel();
	}

	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			onDragOver={disabled ? undefined : handleDragOver}
			onDragLeave={disabled ? undefined : handleDragLeave}
			onDrop={disabled ? undefined : handleDrop}
			className={cn(
				"relative h-full hover:bg-transparent active:bg-transparent",
				TOOLBAR.controlWidth,
				// Same wash tint as the tabbar items. The seam and the outer
				// capsule ends stay native to the group.
				// Flat mode states its ink explicitly. Disabled segments keep
				// the strong ink and dim through opacity only (native-style:
				// dim the normal tone, don't swap to a lighter gray, which
				// washed the thin glyph out on light faces). 25% reads
				// clearly inactive without disappearing.
				isLiquid
					? `${glassForeground()} hover:text-[var(--ktab-glass-foreground-primary)]`
					: "text-flat-ink disabled:opacity-25",
				// Active DnD dwell: the button's own hover wash so the target
				// reads "listening — hold here to navigate". Restrained by
				// design: no outer glow, no layout shift, no scale.
				dwelling &&
					(isLiquid
						? "bg-foreground/[0.10] ring-1 ring-foreground/30 ring-inset"
						: "bg-flat-sunken-raised ring-1 ring-flat-edge-strong ring-inset"),
			)}
			data-slot="button"
			data-history-control="true"
		>
			<span
				aria-hidden="true"
				data-history-hover-face="true"
				className={cn(
					"pointer-events-none absolute inset-[2px] rounded-full opacity-0 transition-opacity duration-150",
					isLiquid ? "bg-foreground/[0.10]" : "bg-flat-sunken-raised",
				)}
			/>
			<Icon
				name={icon}
				size={toolbarIconSize(icon)}
				strokeWidth={TOOLBAR_ICON.strokeWidth}
				className={cn("relative z-[1]", toolbarIconClass(icon))}
				aria-hidden="true"
			/>
			{dwelling && (
				<span
					aria-hidden="true"
					className="history-spring-fill pointer-events-none absolute inset-x-2 bottom-1 h-[2px] rounded-full bg-current opacity-40"
				/>
			)}
		</Button>
	);
}
