import { Button } from "@ktab/ui/components/button";
import { ButtonGroup } from "@ktab/ui/components/button-group";
import { GlassButtonGroup } from "@ktab/ui/components/glass-button-group";
import { Icon } from "@ktab/ui/icons/icon";
import { ktabShape } from "@ktab/ui/lib/shapes";
import { flatSeparator, flatSurface } from "@ktab/ui/lib/surface";
import {
	glassForeground,
	glassLensVeil,
	glassLiquidProps,
} from "../../../lib/glass";
import {
	TOOLBAR,
	TOOLBAR_ICON,
	toolbarIconClass,
	toolbarIconSize,
} from "../../../lib/toolbar-tokens";
import { cn } from "../../../lib/utils";
import { useAppearance, useGlassAppearance } from "../appearance-provider";

interface ToolbarActionsProps {
	onSettings: () => void;
	onSearch?: () => void;
	compactSearch?: boolean;
}

/** One full-bleed group, using the same material and segments as history. */
export function ToolbarActions({
	onSettings,
	onSearch,
	compactSearch = false,
}: ToolbarActionsProps) {
	const { isLiquid, resolvedDark } = useAppearance();
	const { glassParams } = useGlassAppearance();
	const optics = glassLiquidProps(glassParams, "clear");
	const segment = cn(
		"relative h-full hover:bg-transparent active:bg-transparent",
		TOOLBAR.controlWidth,
		isLiquid ? glassForeground() : "text-flat-ink",
	);
	const glyph = (name: "search" | "settings") => (
		<Icon
			name={name}
			size={toolbarIconSize(name)}
			strokeWidth={TOOLBAR_ICON.strokeWidth}
			className={cn("relative z-[1]", toolbarIconClass(name))}
			aria-hidden="true"
		/>
	);
	const face = (
		<span
			aria-hidden="true"
			className={cn(
				"toolbar-action-hover pointer-events-none absolute inset-[2px] rounded-full opacity-0 transition-opacity duration-150",
				isLiquid ? "bg-foreground/[0.10]" : "bg-flat-sunken-raised",
			)}
		/>
	);
	const buttons = (
		<>
			{compactSearch && (
				<Button
					key="search"
					variant="ghost"
					size="icon"
					data-compact-search-control="true"
					aria-label="Search"
					aria-haspopup="listbox"
					aria-controls="ktab-search-results"
					onClick={onSearch}
					className={segment}
				>
					{face}
					{glyph("search")}
				</Button>
			)}
			{compactSearch && (
				<span
					key="divider"
					aria-hidden="true"
					data-toolbar-action-divider="true"
					className={cn(
						"h-[18px] w-px shrink-0 self-center transition-opacity duration-150",
						isLiquid ? "bg-foreground/15" : flatSeparator("vertical"),
					)}
				/>
			)}
			<Button
				key="settings"
				variant="ghost"
				size="icon"
				onClick={onSettings}
				aria-label="Settings"
				aria-expanded={false}
				aria-controls="settings-sidebar"
				id="settings-trigger"
				data-settings-ui="true"
				className={segment}
			>
				{face}
				{glyph("settings")}
			</Button>
		</>
	);
	const groupProps = {
		"aria-label": "Search and settings",
		"data-toolbar-actions": "true",
		className: cn(TOOLBAR.groupHeight, "shrink-0"),
	};
	return isLiquid ? (
		<GlassButtonGroup
			{...groupProps}
			glassVariant="liquid-refract"
			surfaceClassName={glassLensVeil("toolbar", resolvedDark)}
			liquidProps={{
				blur: optics.blur,
				refraction: optics.refraction,
				saturation: optics.saturation,
				brightness: optics.brightness,
				bezel: optics.bezel,
			}}
		>
			{buttons}
		</GlassButtonGroup>
	) : (
		<ButtonGroup
			{...groupProps}
			className={cn(
				groupProps.className,
				ktabShape("toolbarGroup"),
				flatSurface("floating"),
				"shadow-none",
			)}
		>
			{buttons}
		</ButtonGroup>
	);
}
