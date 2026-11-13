import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@ktab/ui/components/motion/context-menu";
import { Icon } from "@ktab/ui/icons/icon";
import { motion, useReducedMotion } from "motion/react";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { glassDropdownItem, glassMenu } from "../../lib/glass";
import { cn } from "../../lib/utils";
import { requestWidgetAction } from "../../lib/widget-actions";
import { moveWidget } from "../../lib/widget-order";
import { useSetupStore } from "../../stores/setup-store";
import type {
	DashboardWidgetId,
	GitHubHeatmapPalette,
	MusicAppearance,
	WidgetAppearance,
	WidgetSizePreference,
} from "../../types";
import { useAppearance } from "./appearance-provider";

interface WidgetSectionItem {
	id: DashboardWidgetId;
	content: ReactNode;
}

interface WidgetSectionProps {
	items: WidgetSectionItem[];
	onOpenSettings?: () => void;
}

const WIDGET_LABELS: Record<DashboardWidgetId, string> = {
	weather: "Weather",
	music: "Music",
	market: "Market",
	github: "GitHub",
};

const COMMON_APPEARANCES = [
	{ value: "glass", label: "Liquid Glass" },
	{ value: "flat", label: "Flat" },
	{ value: "oled", label: "OLED" },
] as const;

const APPEARANCE_OPTIONS: Record<
	DashboardWidgetId,
	readonly { value: string; label: string }[]
> = {
	weather: [
		...COMMON_APPEARANCES,
		{ value: "atmospheric", label: "Atmospheric" },
	],
	music: [...COMMON_APPEARANCES, { value: "album-blur", label: "Album Blur" }],
	market: COMMON_APPEARANCES,
	github: COMMON_APPEARANCES,
};

const GITHUB_PALETTES: readonly {
	value: GitHubHeatmapPalette;
	label: string;
	color: string;
}[] = [
	{ value: "github", label: "GitHub green", color: "#238636" },
	{ value: "blue", label: "Blue", color: "#388bfd" },
	{ value: "purple", label: "Purple", color: "#a371f7" },
	{ value: "orange", label: "Orange", color: "#da8123" },
	{ value: "monochrome", label: "Monochrome", color: "#969696" },
];

const WIDGET_EASE = [0.22, 1, 0.36, 1] as const;
const INTERACTIVE_SELECTOR =
	"button, a, input, textarea, select, summary, [contenteditable='true'], [role='button'], [role='link'], [data-widget-no-drag]";
const WIDGET_SLOT_SELECTOR = "[data-widget-slot-id]";
const WIDGET_DRAG_THRESHOLD = 7;

interface WidgetPointerDrag {
	id: DashboardWidgetId;
	pointerId: number;
	originX: number;
	originY: number;
	started: boolean;
}

/** A responsive widget shelf with whole-surface drag and saved keyboard order. */
export function WidgetSection({ items, onOpenSettings }: WidgetSectionProps) {
	const widgetSettings = useSetupStore((state) => state.settings.widgets);
	const weatherSettings = useSetupStore((state) => state.settings.weather);
	const updateSettings = useSetupStore((state) => state.updateSettings);
	const { isLiquid, resolvedDark } = useAppearance();
	const reducedMotion = useReducedMotion() ?? false;
	const order = widgetSettings.order;
	const [previewOrder, setPreviewOrder] = useState(order);
	const previewOrderRef = useRef(order);
	const [draggingId, setDraggingId] = useState<DashboardWidgetId | null>(null);
	const [dropTargetId, setDropTargetId] = useState<DashboardWidgetId | null>(
		null,
	);
	const [announcement, setAnnouncement] = useState("");
	const pointerDragRef = useRef<WidgetPointerDrag | null>(null);
	const menuItemClass = cn(
		"gap-2.5",
		glassDropdownItem(isLiquid, resolvedDark, { pillOwned: true }),
	);

	const weatherVisible =
		weatherSettings.enabled &&
		(weatherSettings.display === "compact" ||
			weatherSettings.display === "expanded" ||
			weatherSettings.display === "widget");
	const visibleItems = items.filter((item) => {
		if (item.id === "weather") return weatherVisible;
		return widgetSettings[item.id].enabled;
	});
	const visibleIds = new Set(visibleItems.map((item) => item.id));
	const orderedItems = previewOrder
		.map((id) => visibleItems.find((item) => item.id === id))
		.filter((item): item is WidgetSectionItem => item !== undefined);

	useEffect(() => {
		if (draggingId !== null) return;
		previewOrderRef.current = order;
		setPreviewOrder(order);
	}, [draggingId, order]);

	if (orderedItems.length === 0) return null;

	function saveOrder(nextOrder: DashboardWidgetId[]) {
		previewOrderRef.current = nextOrder;
		setPreviewOrder(nextOrder);
		updateSettings({ widgets: { ...widgetSettings, order: nextOrder } });
	}

	function startPointerDrag(
		id: DashboardWidgetId,
		event: PointerEvent<HTMLDivElement>,
	) {
		if (visibleItems.length < 2) return;
		if (event.button !== 0 || !event.isPrimary) return;
		const target = event.target;
		if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) {
			return;
		}
		pointerDragRef.current = {
			id,
			pointerId: event.pointerId,
			originX: event.clientX,
			originY: event.clientY,
			started: false,
		};
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Pointer capture is not available in a few embedded test surfaces.
		}
	}

	function updateDropPosition(event: PointerEvent<HTMLDivElement>) {
		const hitTarget = document.elementFromPoint?.(event.clientX, event.clientY);
		if (!(hitTarget instanceof Element)) return false;
		const targetSlot = hitTarget.closest<HTMLElement>(WIDGET_SLOT_SELECTOR);
		const targetId = targetSlot?.dataset.widgetSlotId as
			| DashboardWidgetId
			| undefined;
		const drag = pointerDragRef.current;
		if (!targetSlot || !targetId || !visibleIds.has(targetId) || !drag) {
			setDropTargetId(null);
			return false;
		}
		const bounds = targetSlot.getBoundingClientRect();
		const sameRow =
			event.clientY >= bounds.top && event.clientY <= bounds.bottom;
		const after = sameRow
			? event.clientX >= bounds.left + bounds.width / 2
			: event.clientY >= bounds.top + bounds.height / 2;
		const next = moveWidget(previewOrderRef.current, drag.id, targetId, after);
		previewOrderRef.current = next;
		setDropTargetId(targetId);
		return true;
	}

	function movePointerDrag(event: PointerEvent<HTMLDivElement>) {
		const drag = pointerDragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (!drag.started) {
			const distance = Math.hypot(
				event.clientX - drag.originX,
				event.clientY - drag.originY,
			);
			if (distance < WIDGET_DRAG_THRESHOLD) return;
			drag.started = true;
			previewOrderRef.current = order;
			setPreviewOrder(order);
			setDraggingId(drag.id);
		}
		event.preventDefault();
		updateDropPosition(event);
	}

	function finishPointerDrag(event: PointerEvent<HTMLDivElement>) {
		const drag = pointerDragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (drag.started) {
			const overWidget = updateDropPosition(event);
			if (overWidget) {
				saveOrder(previewOrderRef.current);
				setAnnouncement(
					`${WIDGET_LABELS[drag.id]} moved to position ${
						previewOrderRef.current
							.filter((id) => visibleIds.has(id))
							.indexOf(drag.id) + 1
					} of ${visibleItems.length}.`,
				);
			} else {
				previewOrderRef.current = order;
				setPreviewOrder(order);
			}
		} else {
			previewOrderRef.current = order;
			setPreviewOrder(order);
		}
		pointerDragRef.current = null;
		setDraggingId(null);
		setDropTargetId(null);
	}

	function cancelPointerDrag(event: PointerEvent<HTMLDivElement>) {
		const drag = pointerDragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		pointerDragRef.current = null;
		previewOrderRef.current = order;
		setPreviewOrder(order);
		setDraggingId(null);
		setDropTargetId(null);
	}

	function handleReorderKey(
		id: DashboardWidgetId,
		event: KeyboardEvent<HTMLDivElement>,
	) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		const currentVisible = previewOrder.filter((candidate) =>
			visibleIds.has(candidate),
		);
		const currentIndex = currentVisible.indexOf(id);
		const direction = event.key === "ArrowRight" ? 1 : -1;
		const target = currentVisible[currentIndex + direction];
		if (!target) return;
		event.preventDefault();
		const next = moveWidget(previewOrderRef.current, id, target, direction > 0);
		saveOrder(next);
		setAnnouncement(
			`${WIDGET_LABELS[id]} moved to position ${currentIndex + direction + 1} of ${visibleItems.length}.`,
		);
	}

	function currentAppearance(id: DashboardWidgetId): string {
		return id === "weather"
			? weatherSettings.appearance
			: widgetSettings[id].appearance;
	}

	function updateAppearance(id: DashboardWidgetId, appearance: string) {
		if (id === "weather") {
			updateSettings({
				weather: {
					...weatherSettings,
					appearance: appearance as typeof weatherSettings.appearance,
				},
			});
		} else if (id === "music") {
			updateSettings({
				widgets: {
					...widgetSettings,
					music: {
						...widgetSettings.music,
						appearance: appearance as MusicAppearance,
					},
				},
			});
		} else if (id === "market") {
			updateSettings({
				widgets: {
					...widgetSettings,
					market: {
						...widgetSettings.market,
						appearance: appearance as WidgetAppearance,
					},
				},
			});
		} else {
			updateSettings({
				widgets: {
					...widgetSettings,
					github: {
						...widgetSettings.github,
						appearance: appearance as WidgetAppearance,
					},
				},
			});
		}
	}

	function currentSize(id: DashboardWidgetId): WidgetSizePreference {
		if (id === "weather") {
			return weatherSettings.display === "compact" ? "compact" : "expanded";
		}
		return widgetSettings[id].size;
	}

	function updateSize(id: DashboardWidgetId, size: WidgetSizePreference) {
		if (id === "weather") {
			updateSettings({ weather: { ...weatherSettings, display: size } });
		} else if (id === "music") {
			updateSettings({
				widgets: {
					...widgetSettings,
					music: { ...widgetSettings.music, size },
				},
			});
		} else if (id === "market") {
			updateSettings({
				widgets: {
					...widgetSettings,
					market: { ...widgetSettings.market, size },
				},
			});
		} else {
			updateSettings({
				widgets: {
					...widgetSettings,
					github: { ...widgetSettings.github, size },
				},
			});
		}
	}

	function hideWidget(id: DashboardWidgetId) {
		if (id === "weather") {
			updateSettings({ weather: { ...weatherSettings, enabled: false } });
		} else if (id === "music") {
			updateSettings({
				widgets: {
					...widgetSettings,
					music: { ...widgetSettings.music, enabled: false },
				},
			});
		} else if (id === "market") {
			updateSettings({
				widgets: {
					...widgetSettings,
					market: { ...widgetSettings.market, enabled: false },
				},
			});
		} else {
			updateSettings({
				widgets: {
					...widgetSettings,
					github: { ...widgetSettings.github, enabled: false },
				},
			});
		}
	}

	function updateGitHubPalette(palette: GitHubHeatmapPalette) {
		updateSettings({
			widgets: {
				...widgetSettings,
				github: { ...widgetSettings.github, palette },
			},
		});
	}

	function runSpecificAction(id: DashboardWidgetId) {
		if (id === "weather" || id === "market" || id === "github") {
			requestWidgetAction(id, "refresh");
		} else {
			requestWidgetAction("music", "open-audio-output");
		}
	}

	return (
		<section
			aria-label="Widgets"
			className="speed-dial-widget-section flex flex-wrap items-center justify-center gap-3.5"
		>
			{orderedItems.map((item) => {
				const appearance = currentAppearance(item.id);
				const size = currentSize(item.id);
				return (
					<ContextMenu key={item.id}>
						<ContextMenuTrigger>
							<motion.div
								layout
								role="group"
								tabIndex={0}
								aria-label={`Move ${WIDGET_LABELS[item.id]} widget. Use left or right arrow keys to reorder.`}
								aria-description="Right-click for widget options."
								aria-keyshortcuts="ArrowLeft ArrowRight"
								transition={{
									layout: {
										duration: reducedMotion ? 0 : 0.22,
										ease: WIDGET_EASE,
									},
								}}
								className={cn(
									"speed-dial-widget-slot group/widget relative max-w-full touch-pan-y outline-none transition-[opacity,scale] duration-150 ease-out focus-visible:rounded-[var(--shape-section,22px)] focus-visible:ring-2 focus-visible:ring-[var(--ktab-accent)] focus-visible:ring-offset-2 motion-reduce:transition-none",
									draggingId === item.id && "scale-[0.985] opacity-50",
									dropTargetId === item.id &&
										"[&_[data-widget]]:ring-2 [&_[data-widget]]:ring-[var(--ktab-accent)]/70",
								)}
								data-widget-slot-id={item.id}
								data-local-context-menu="true"
								data-widget-dragging={
									draggingId === item.id ? "true" : undefined
								}
								onKeyDown={(event) => handleReorderKey(item.id, event)}
								onPointerDown={(event) => startPointerDrag(item.id, event)}
								onPointerMove={movePointerDrag}
								onPointerUp={finishPointerDrag}
								onPointerCancel={cancelPointerDrag}
								onLostPointerCapture={cancelPointerDrag}
							>
								{item.content}
							</motion.div>
						</ContextMenuTrigger>
						<ContextMenuContent
							ariaLabel={`${WIDGET_LABELS[item.id]} widget options`}
							className={cn(glassMenu(isLiquid, resolvedDark), "squircle")}
						>
							{!(item.id === "music" && size === "compact") ? (
								<>
									<ContextMenuLabel className="flex items-center gap-2.5">
										<Icon name="sparkles" size={14} aria-hidden="true" />
										Appearance
									</ContextMenuLabel>
									<ContextMenuRadioGroup
										value={appearance}
										onValueChange={(value) => updateAppearance(item.id, value)}
									>
										{APPEARANCE_OPTIONS[item.id].map((option) => (
											<ContextMenuRadioItem
												key={option.value}
												value={option.value}
												className={menuItemClass}
											>
												{option.label}
											</ContextMenuRadioItem>
										))}
									</ContextMenuRadioGroup>
									<ContextMenuSeparator />
								</>
							) : null}

							<ContextMenuLabel className="flex items-center gap-2.5">
								<Icon name="layout" size={14} aria-hidden="true" />
								Size
							</ContextMenuLabel>
							<ContextMenuRadioGroup
								value={size}
								onValueChange={(value) =>
									updateSize(item.id, value as WidgetSizePreference)
								}
							>
								<ContextMenuRadioItem value="compact" className={menuItemClass}>
									Compact
								</ContextMenuRadioItem>
								<ContextMenuRadioItem
									value="expanded"
									className={menuItemClass}
								>
									Expanded
								</ContextMenuRadioItem>
							</ContextMenuRadioGroup>

							{item.id === "weather" ? (
								<>
									<ContextMenuSeparator />
									<ContextMenuItem
										className={menuItemClass}
										onSelect={() => runSpecificAction(item.id)}
									>
										<Icon name="refresh" size={14} aria-hidden="true" />
										Refresh now
									</ContextMenuItem>
									<ContextMenuItem
										className={menuItemClass}
										onSelect={onOpenSettings}
									>
										<Icon name="map-pin" size={14} aria-hidden="true" />
										Change city
									</ContextMenuItem>
								</>
							) : null}
							{item.id === "music" ? (
								<ContextMenuItem
									className={menuItemClass}
									onSelect={() => runSpecificAction(item.id)}
								>
									<Icon name="headphones" size={14} aria-hidden="true" />
									Change audio output
								</ContextMenuItem>
							) : null}
							{item.id === "market" ? (
								<>
									<ContextMenuSeparator />
									<ContextMenuItem
										className={menuItemClass}
										onSelect={() => requestWidgetAction("market", "refresh")}
									>
										<Icon name="refresh" size={14} aria-hidden="true" />
										Refresh now
									</ContextMenuItem>
									<ContextMenuItem
										className={menuItemClass}
										onSelect={onOpenSettings}
									>
										<Icon name="market" size={14} aria-hidden="true" />
										Manage assets
									</ContextMenuItem>
								</>
							) : null}
							{item.id === "github" ? (
								<>
									<ContextMenuSeparator />
									<ContextMenuItem
										className={menuItemClass}
										onSelect={() => requestWidgetAction("github", "refresh")}
									>
										<Icon name="refresh" size={14} aria-hidden="true" />
										Refresh now
									</ContextMenuItem>
									<ContextMenuLabel className="flex items-center gap-2.5">
										<Icon name="palette" size={14} aria-hidden="true" />
										Heatmap colors
									</ContextMenuLabel>
									<ContextMenuRadioGroup
										value={widgetSettings.github.palette}
										onValueChange={(value) =>
											updateGitHubPalette(value as GitHubHeatmapPalette)
										}
									>
										{GITHUB_PALETTES.map((palette) => (
											<ContextMenuRadioItem
												key={palette.value}
												value={palette.value}
												className={menuItemClass}
											>
												<span
													aria-hidden="true"
													className="squircle size-3 rounded-sm"
													style={{ backgroundColor: palette.color }}
												/>
												{palette.label}
											</ContextMenuRadioItem>
										))}
									</ContextMenuRadioGroup>
								</>
							) : null}

							<ContextMenuSeparator />
							<ContextMenuItem
								tone="destructive"
								className={cn(menuItemClass, "text-destructive")}
								onSelect={() => hideWidget(item.id)}
							>
								<Icon name="x" size={14} aria-hidden="true" />
								Hide widget
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				);
			})}
			<p className="sr-only" aria-live="polite" aria-atomic="true">
				{announcement}
			</p>
		</section>
	);
}
