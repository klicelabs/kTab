import { GlassIcon } from "@ktab/ui/components/glass-icon";
import type { IconName } from "@ktab/ui/icons/icon";
import { Icon } from "@ktab/ui/icons/icon";
import { flatControl, flatFocusRing } from "@ktab/ui/lib/surface";
import {
	glassFocusRing,
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

interface ToolbarIconButtonProps {
	icon: IconName;
	label: string;
	onClick: () => void;
	/** Active/pressed visual state (e.g. an open menu). */
	active?: boolean;
	id?: string;
	expanded?: boolean;
	controls?: string;
	dataSettingsUi?: boolean;
	/** Render as a transparent control inside an existing GlassSurface. */
	insideSurface?: boolean;
	/** Larger standalone control for visual previews and hero affordances. */
	size?: "default" | "large";
}

/**
 * A standalone circular toolbar control where the *button itself* is the glass
 * material — no surrounding padded pill. This is the glasscn `GlassIcon`
 * (iOS Control Center style) so hover/press paint the whole circle, not an
 * inner element inside a visible container.
 *
 * Diameter is fixed at the shared toolbar surface height (34px) to match the
 * total height of the grouped pills (3px padding + 28px control), so
 * standalone and grouped controls sit on the same visual baseline.
 *
 * Grouped controls (tabs and history) stay inside one GlassSurface; the lone
 * GlassIcon controls (compact search and settings) use this.
 */
export function ToolbarIconButton({
	icon,
	label,
	onClick,
	active = false,
	id,
	expanded,
	controls,
	dataSettingsUi = false,
	insideSurface = false,
	size = "default",
}: ToolbarIconButtonProps) {
	const { isLiquid, resolvedDark } = useAppearance();
	const { glassParams } = useGlassAppearance();
	const isLarge = size === "large";

	// One glyph token drives every toolbar icon: the box size and the class
	// both come from TOOLBAR_ICON, so a chevron and the Settings gear reach the
	// same optical ink height instead of the same nominal box. The stroke is
	// the shared lighter Apple-like weight, not Lucide's default 2.
	const glyph = (
		<Icon
			name={icon}
			size={isLarge ? 28 : toolbarIconSize(icon)}
			strokeWidth={TOOLBAR_ICON.strokeWidth}
			className={isLarge ? "size-7" : toolbarIconClass(icon)}
		/>
	);

	if (isLiquid && !insideSurface) {
		const optics = glassLiquidProps(glassParams, "clear");
		return (
			<GlassIcon
				glassVariant="liquid-refract"
				liquidProps={{
					blur: optics.blur,
					refraction: optics.refraction,
					saturation: optics.saturation,
					brightness: optics.brightness,
					bezel: optics.bezel,
				}}
				surfaceClassName={glassLensVeil("toolbar", resolvedDark)}
				onClick={onClick}
				aria-label={label}
				aria-pressed={active}
				aria-expanded={expanded}
				aria-controls={controls}
				id={id}
				data-settings-ui={dataSettingsUi ? "true" : undefined}
				className={cn(
					isLarge ? "size-14" : TOOLBAR.standaloneSize,
					"shrink-0 shadow-none transition-colors",
					glassForeground(),
					glassFocusRing(isLiquid),
					active && cn("bg-foreground/10", glassForeground()),
				)}
			>
				{glyph}
			</GlassIcon>
		);
	}

	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			aria-pressed={active}
			aria-expanded={expanded}
			aria-controls={controls}
			id={id}
			data-settings-ui={dataSettingsUi ? "true" : undefined}
			className={cn(
				insideSurface
					? cn(
							"flex shrink-0 items-center justify-center",
							TOOLBAR.innerSize,
							TOOLBAR.radius,
							TOOLBAR.transition,
						)
					: cn(
							"flex shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-95",
							isLarge ? "size-14" : TOOLBAR.standaloneSize,
						),
				insideSurface
					? isLiquid
						? glassFocusRing(isLiquid)
						: flatFocusRing()
					: undefined,
				insideSurface
					? isLiquid
						? active
							? cn("bg-foreground/10", glassForeground())
							: cn(
									glassForeground("secondary"),
									"hover:bg-foreground/[0.10] hover:text-[var(--ktab-glass-foreground-primary)] active:bg-foreground/15",
								)
						: active
							? `${flatControl()} text-flat-ink shadow-none`
							: "text-flat-ink hover:bg-flat-sunken-raised active:bg-flat-sunken"
					: cn(flatControl(), flatFocusRing(), "text-flat-ink", "shadow-none"),
			)}
		>
			{glyph}
		</button>
	);
}
