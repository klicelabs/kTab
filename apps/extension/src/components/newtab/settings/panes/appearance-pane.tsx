import { Icon } from "@klice-start/ui/icons/icon";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ACCENT_OPTIONS } from "../../../../lib/accent";
import {
	cleanSurfaceCss,
	GRADIENTS,
	WALLPAPERS,
} from "../../../../lib/constants";
import { clampGlassIntensity } from "../../../../lib/glass";
import { cn } from "../../../../lib/utils";
import { useImageStore } from "../../../../stores/image-store";
import { useSetupStore } from "../../../../stores/setup-store";
import type { Settings } from "../../../../types";
import { useAppearance } from "../../appearance-provider";
import { ToolbarIconButton } from "../../toolbar/toolbar-icon-button";
import { SectionCard } from "../shared/section-card";
import { SegmentedControl } from "../shared/segmented-control";
import { SettingRow } from "../shared/setting-row";
import { SettingsExpandable } from "../shared/settings-expandable";
import { SettingsLabel } from "../shared/settings-label";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_PAGE,
	SETTINGS_RADIUS,
} from "../shared/settings-tokens";
import { SliderRow } from "../shared/slider-row";

/** The three appearance modes, ordered by the user's most direct choices. */
const MODE_OPTIONS: readonly {
	value: "auto" | "light" | "dark";
	label: string;
	ariaLabel: string;
	/** Preview shell — an abstract surface, not a miniature browser window. */
	shell: string;
	/** Preview panel and content tones. */
	panel: string;
	content: string;
}[] = [
	{
		value: "light",
		label: "Light",
		ariaLabel: "Use light appearance",
		shell: "border-neutral-300 bg-neutral-200",
		panel: "bg-white",
		content: "bg-neutral-200",
	},
	{
		value: "dark",
		label: "Dark",
		ariaLabel: "Use dark appearance",
		shell: "border-neutral-700 bg-neutral-950",
		panel: "bg-neutral-900",
		content: "bg-neutral-700",
	},
	{
		value: "auto",
		label: "System",
		ariaLabel: "Use system appearance",
		shell: "border-neutral-300 bg-neutral-800",
		panel: "bg-neutral-100",
		content: "bg-neutral-600",
	},
];

/**
 * Appearance owns the look of the dashboard: the theme, the background source
 * (wallpaper source, dynamic photography and effects layered over it). The
 * complete wallpaper library lives in its own page so this pane stays focused
 * on quick, high-frequency visual adjustments.
 */
interface AppearancePaneProps {
	onOpenWallpaper: () => void;
}

interface CurrentWallpaperPreviewProps {
	background: Settings["background"];
}

function CurrentWallpaperPreview({
	background,
	className,
}: CurrentWallpaperPreviewProps & { className?: string }) {
	const getBackgroundImage = useImageStore((state) => state.getBackgroundImage);
	const { resolvedDark } = useAppearance();
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const activeImageId =
		background.type === "image"
			? background.imageId
			: background.type === "pexels"
				? background.pexelsImageId
				: null;

	useEffect(() => {
		let active = true;
		setImageUrl(null);
		if (!activeImageId) {
			return;
		}
		getBackgroundImage(activeImageId)
			.then((url) => {
				if (active) setImageUrl(url);
			})
			.catch(() => {
				if (active) setImageUrl(null);
			});
		return () => {
			active = false;
		};
	}, [activeImageId, getBackgroundImage]);

	const wallpaper =
		background.type === "wallpaper"
			? WALLPAPERS.find((item) => item.id === background.wallpaperId)
			: undefined;
	const gradient =
		background.type === "gradient"
			? GRADIENTS.find((item) => item.id === background.gradientId)
			: undefined;

	if (imageUrl) {
		return (
			<img
				src={imageUrl}
				alt=""
				className={cn("size-full object-cover", className)}
			/>
		);
	}
	if (wallpaper) {
		return (
			<img
				src={wallpaper.thumb}
				alt=""
				className={cn("size-full object-cover", className)}
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className={cn("block size-full", className)}
			style={{
				background:
					gradient?.css ??
					(background.type === "solid"
						? background.color
						: background.type === "none"
							? cleanSurfaceCss(resolvedDark)
							: "#27272a"),
			}}
		/>
	);
}

function getCurrentWallpaperLabel(background: Settings["background"]): string {
	if (background.type === "none") return "None";
	if (background.type === "solid") return "Solid colour";
	if (background.type === "gradient") {
		return (
			GRADIENTS.find((item) => item.id === background.gradientId)?.label ??
			"Gradient"
		);
	}
	if (background.type === "image") {
		return background.customWallpaper?.id === background.imageId
			? background.customWallpaper.name
			: "Uploaded wallpaper";
	}
	if (background.type === "pexels") return "Dynamic photography";
	return (
		WALLPAPERS.find((item) => item.id === background.wallpaperId)?.label ??
		"Wallpaper"
	);
}

export function AppearancePane({ onOpenWallpaper }: AppearancePaneProps) {
	const appearanceMode = useSetupStore((s) => s.settings.appearanceMode);
	const isLiquidGlass = appearanceMode === "liquid";
	const glassIntensity = useSetupStore((s) =>
		clampGlassIntensity(s.settings.glassIntensity),
	);
	const colorScheme = useSetupStore((s) => s.settings.colorScheme ?? "auto");
	const accentColor = useSetupStore((s) => s.settings.accentColor ?? "blue");
	const cornerScale = useSetupStore((s) => s.settings.cornerScale ?? "soft");
	const bg = useSetupStore((s) => s.settings.background);

	const updateSettings = useSetupStore((s) => s.updateSettings);
	const updateBackground = useSetupStore((s) => s.updateBackground);
	const reduceMotion = useReducedMotion() ?? false;

	return (
		<div className={SETTINGS_PAGE}>
			{/* Theme */}
			<SectionCard>
				<fieldset className="m-0 border-0 px-1.5 py-2.5" aria-label="Theme">
					<div className="flex items-center gap-2.5">
						<Icon
							name="sun-moon"
							size={16}
							strokeWidth={1.75}
							className="shrink-0 text-neutral-400"
							aria-hidden="true"
						/>
						<SettingsLabel>Theme</SettingsLabel>
					</div>
					<div className="mt-3 grid grid-cols-3 gap-2.5">
						{MODE_OPTIONS.map((mode) => {
							const selected = colorScheme === mode.value;
							return (
								<div
									key={mode.value}
									className="flex min-w-0 flex-col items-center gap-2"
								>
									<button
										type="button"
										onClick={() => updateSettings({ colorScheme: mode.value })}
										aria-label={mode.ariaLabel}
										aria-pressed={selected}
										className={cn("group w-full", SETTINGS_FOCUS_RING)}
									>
										<div
											className={cn(
												"squircle relative aspect-[1.35] w-full overflow-hidden border p-1.5 shadow-none transition-[filter,box-shadow] duration-150 group-hover:brightness-105 motion-reduce:transition-none dark:border-white/10",
												SETTINGS_RADIUS.surface,
												mode.shell,
												selected &&
													"ring-2 ring-[var(--klice-accent)] ring-offset-2 ring-offset-white dark:ring-offset-[#252525]",
											)}
										>
											{mode.value === "auto" ? (
												<div
													className={cn(
														"squircle grid h-full grid-cols-2 gap-1.5 overflow-hidden bg-neutral-100",
														SETTINGS_RADIUS.thumbnail,
													)}
												>
													<div className="bg-neutral-100 p-1.5">
														<div className="h-2.5 w-4/5 rounded-full bg-white" />
														<div className="mt-2 h-1.5 w-full rounded-full bg-neutral-300" />
														<div className="mt-1.5 h-1.5 w-3/4 rounded-full bg-neutral-300" />
													</div>
													<div className="bg-neutral-900 p-1.5">
														<div className="h-2.5 w-4/5 rounded-full bg-neutral-800" />
														<div className="mt-2 h-1.5 w-full rounded-full bg-neutral-700" />
														<div className="mt-1.5 h-1.5 w-3/4 rounded-full bg-neutral-700" />
													</div>
												</div>
											) : (
												<div
													className={cn(
														"squircle h-full p-1.5",
														SETTINGS_RADIUS.thumbnail,
														mode.panel,
													)}
												>
													<div
														className={cn(
															"h-2.5 w-4/5 rounded-full",
															mode.content,
														)}
													/>
													<div
														className={cn(
															"mt-2 h-1.5 w-full rounded-full",
															mode.content,
														)}
													/>
													<div
														className={cn(
															"mt-1.5 h-1.5 w-3/4 rounded-full",
															mode.content,
														)}
													/>
												</div>
											)}
										</div>
									</button>
									{selected ? (
										<motion.span
											layoutId="settings-theme-label"
											transition={
												reduceMotion
													? { duration: 0 }
													: { duration: 0.18, ease: "easeOut" }
											}
											className={cn(
												SETTINGS_RADIUS.pill,
												"bg-[var(--klice-accent)] px-2.5 py-1 font-medium text-[11px] text-[var(--klice-accent-foreground)] leading-none",
											)}
										>
											{mode.label}
										</motion.span>
									) : (
										<span
											className={cn(
												SETTINGS_RADIUS.pill,
												"bg-neutral-900/[0.06] px-2.5 py-1 font-medium text-[11px] text-neutral-500 leading-none dark:bg-white/[0.08] dark:text-neutral-400",
											)}
										>
											{mode.label}
										</span>
									)}
								</div>
							);
						})}
					</div>
				</fieldset>

				<SettingRow label="Accent color" icon="palette">
					<div className="flex items-center gap-2">
						{ACCENT_OPTIONS.map((accent) => {
							const selected = accentColor === accent.id;
							return (
								<button
									key={accent.id}
									type="button"
									onClick={() => updateSettings({ accentColor: accent.id })}
									aria-label={`${accent.label} accent color`}
									aria-pressed={selected}
									title={accent.label}
									className={cn(
										"size-6 rounded-full p-0.5 transition-[box-shadow,transform] duration-150 hover:scale-105 active:scale-95 motion-reduce:transition-none",
										SETTINGS_FOCUS_RING,
										selected &&
											"ring-2 ring-[var(--klice-accent)] ring-offset-1 ring-offset-white dark:ring-offset-[#252525]",
									)}
								>
									<span
										className="block size-full rounded-full"
										style={{ backgroundColor: accent.light }}
									/>
								</button>
							);
						})}
					</div>
				</SettingRow>

				<SettingRow
					label="Material"
					icon="glass-water"
					tooltip="Glass picks up the wallpaper; Flat stays opaque. Settings itself stays flat."
				>
					<SegmentedControl
						label="Material"
						value={isLiquidGlass ? "glass" : "flat"}
						options={[
							{ value: "flat", label: "Flat" },
							{ value: "glass", label: "Glass" },
						]}
						onChange={(next) =>
							updateSettings({
								appearanceMode: next === "glass" ? "liquid" : "classic",
							})
						}
					/>
				</SettingRow>

				<SettingRow
					label="Corner rounding"
					icon="shapes"
					tooltip="Shapes panels, menus and controls everywhere. Toolbars stay capsules and cards keep their own edges."
				>
					<SegmentedControl
						label="Corner rounding"
						value={cornerScale}
						options={[
							{ value: "discreet", label: "Discreet" },
							{ value: "soft", label: "Soft" },
							{ value: "rounded", label: "Rounded" },
						]}
						onChange={(next) => {
							updateSettings({ cornerScale: next });
						}}
					/>
				</SettingRow>
			</SectionCard>

			{/* Wallpaper: compact preview is the entry point (title lives
			inside the image, pencil opens the library), and the background
			effects that modify it live in the same card. */}
			<SectionCard>
				<div className="px-1.5 py-2.5">
					<div className="flex items-center gap-2.5">
						<Icon
							name="image"
							size={16}
							strokeWidth={1.75}
							className="shrink-0 text-neutral-400"
							aria-hidden="true"
						/>
						<SettingsLabel>Wallpaper</SettingsLabel>
					</div>
					<div className="relative mt-3">
						<button
							type="button"
							onClick={onOpenWallpaper}
							aria-label={`Change wallpaper. Current wallpaper: ${getCurrentWallpaperLabel(bg)}`}
							title="Change wallpaper"
							className={cn(
								"squircle group relative block aspect-[2/1] w-full overflow-hidden bg-neutral-900/[0.08] transition-[filter] duration-200 group-hover:brightness-[1.03] motion-reduce:transition-none",
								SETTINGS_RADIUS.thumbnail,
								SETTINGS_FOCUS_RING,
							)}
						>
							{/* Truthful miniature of the real background layer:
							opacity / brightness / blur mirror the active
							settings (blur capped so the thumb stays legible),
							so the glass overlays preview exactly what the
							speed dial renders. */}
							<span
								aria-hidden="true"
								className="absolute inset-0 block"
								style={{
									opacity: bg.opacity / 100,
									filter: `brightness(${bg.brightness / 100}) blur(${Math.min(bg.blur, 8)}px)`,
								}}
							>
								<CurrentWallpaperPreview background={bg} />
							</span>
							<span
								aria-hidden="true"
								className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/55 to-transparent"
							/>
							<span className="pointer-events-none absolute inset-x-0 top-1/2 mt-12 flex -translate-y-1/2 justify-center truncate px-3 text-center font-medium text-[12px] text-white drop-shadow-sm">
								{getCurrentWallpaperLabel(bg)}
							</span>
						</button>
						{/* A single, larger direct-background glass control keeps the
						preview legible without turning it into a miniature browser. */}
						<div
							inert
							aria-hidden="true"
							className="pointer-events-none absolute inset-0"
						>
							<div className="absolute inset-0 flex items-center justify-center">
								<ToolbarIconButton
									size="large"
									icon="image"
									label="Gallery"
									onClick={() => undefined}
								/>
							</div>
						</div>
						<div className="absolute top-2 right-2 z-10">
							<ToolbarIconButton
								icon="pencil"
								label="Edit wallpaper"
								onClick={onOpenWallpaper}
							/>
						</div>
					</div>
				</div>

				{/* Glass intensity belongs directly after the preview so the
				material control reads before the wallpaper image adjustments. */}
				<SettingsExpandable expanded={isLiquidGlass} label="Glass intensity">
					<SliderRow
						label="Glass intensity"
						icon="blend"
						value={glassIntensity}
						min={0}
						max={100}
						step={1}
						tooltip="Controls how strongly the Liquid Glass material tints and diffuses the wallpaper."
						onChange={(v) => updateSettings({ glassIntensity: v })}
					/>
				</SettingsExpandable>

				<SliderRow
					label="Opacity"
					icon="eye"
					value={bg.opacity}
					suffix="%"
					min={20}
					max={100}
					step={10}
					onChange={(v) =>
						updateBackground({ opacity: v } as Partial<Settings["background"]>)
					}
				/>

				<SliderRow
					label="Blur"
					icon="blend"
					value={bg.blur}
					suffix="px"
					min={0}
					max={20}
					step={2}
					onChange={(v) =>
						updateBackground({ blur: v } as Partial<Settings["background"]>)
					}
				/>

				<SliderRow
					label="Brightness"
					icon="sun"
					value={bg.brightness}
					suffix="%"
					min={40}
					max={140}
					step={10}
					onChange={(v) =>
						updateBackground({ brightness: v } as Partial<
							Settings["background"]
						>)
					}
				/>
			</SectionCard>
		</div>
	);
}
