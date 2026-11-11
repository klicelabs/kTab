import { LiquidGlass } from "@ktab/ui/components/liquid-glass";
import { Button as MotionButton } from "@ktab/ui/components/motion/button/base";
import { Icon } from "@ktab/ui/icons/icon";
import { ktabShape } from "@ktab/ui/lib/shapes";
import { Fragment } from "react";
import {
	glassFocusRing,
	glassForeground,
	glassLensVeil,
	glassLiquidProps,
	glassMaterial,
	HERO_TEXT_SHADOW,
	wallpaperText,
} from "../../lib/glass";
import { RECOMMENDED_SITES } from "../../lib/recommended-sites";
import { faviconUrl } from "../../lib/url";
import { cn } from "../../lib/utils";
import { useSetupStore } from "../../stores/setup-store";
import { useAppearance, useGlassAppearance } from "./appearance-provider";

interface EmptyLandingProps {
	/** Target folder, used to name where a quick-add shortcut will land. */
	folderName: string;
	/** Opens the add-link flow. */
	onAdd: () => void;
}

/**
 * Four well-known destinations. This state is deliberately quiet: one text
 * line, no favicons, no per-site chrome. Anything richer turns the empty
 * state into a mini dashboard whose secondary actions compete with the one
 * primary action.
 */
const QUICK_ADD = RECOMMENDED_SITES.slice(0, 4);

/**
 * Empty-folder state. Single hierarchy, top to bottom:
 *
 *   1. one focal mark        (squircle tile + bookmark glyph)
 *   2. one concise headline
 *   3. one short supporting sentence
 *   4. one primary action    ("Add link")
 *   5. quiet secondary line  (quick add)
 *
 * The current folder name is intentionally NOT repeated here — the tabbar
 * already shows it, so a badge would only add noise. The keyboard shortcut
 * for saving a page lives in Settings rather than in the main body.
 */
export function EmptyLanding({ folderName, onAdd }: EmptyLandingProps) {
	const { isLiquid, resolvedDark } = useAppearance();
	const { glassParams } = useGlassAppearance();
	const activeFolderId = useSetupStore((s) => s.activeFolderId);
	const addCard = useSetupStore((s) => s.addCard);
	const optics = glassLiquidProps(glassParams, "clear");

	function handleAddStarter(site: (typeof QUICK_ADD)[number]) {
		addCard({
			folderId: activeFolderId,
			title: site.name,
			url: site.url,
			favicon: faviconUrl(site.url),
			thumbId: null,
		});
	}

	const addLinkButton = (
		<MotionButton
			type="button"
			onClick={onAdd}
			variant="ghost"
			size="md"
			ripple={!isLiquid}
			className={cn(
				"inline-flex h-9 items-center gap-1.5 rounded-full px-4 font-medium text-xs transition-[background-color,border-color,box-shadow] duration-150 ease-out",
				glassFocusRing(isLiquid),
				isLiquid
					? cn(
							"border-0 bg-transparent hover:bg-foreground/[0.10]",
							glassForeground(),
						)
					: cn(glassMaterial(false, "floating"), "text-flat-ink"),
			)}
		>
			<Icon name="plus" size={13} />
			Add link
		</MotionButton>
	);

	return (
		<div className="flex justify-center px-6 pt-6 pb-20">
			<div
				className="flex w-full max-w-sm flex-col items-center text-center"
				style={{ animation: "emptyLandingIn 220ms ease-out both" }}
			>
				{/* 1. Focal mark. A real hero-lens tile (same optics + veil as
				    the toolbar family) over a soft halo, so it reads as one
				    deliberate object. Decorative: the headline carries meaning. */}
				<div aria-hidden="true" className="relative mb-6">
					<div
						className={cn(
							"absolute -inset-5 rounded-full blur-2xl",
							isLiquid
								? resolvedDark
									? "bg-white/15"
									: "bg-white/40"
								: "bg-foreground/[0.05]",
						)}
					/>
					{isLiquid ? (
						<LiquidGlass
							data-glass-variant="liquid-refract"
							blur={optics.blur}
							refract
							refraction={optics.refraction}
							saturation={optics.saturation}
							brightness={optics.brightness}
							bezel={optics.bezel}
							shape="section"
							className={cn(
								"relative flex size-[68px] items-center justify-center",
								glassLensVeil("hero", resolvedDark),
								glassForeground(),
							)}
						>
							<Icon name="bookmark" size={26} />
						</LiquidGlass>
					) : (
						<div
							className={cn(
								"relative flex size-[68px] items-center justify-center",
								ktabShape("section"),
								glassMaterial(false, "panel"),
								"text-muted-foreground",
							)}
						>
							<Icon name="bookmark" size={26} />
						</div>
					)}
				</div>

				{/* 2 + 3. Headline, then one short supporting sentence. Both sit
				    directly on the wallpaper with no backing surface, so they
				    reuse the same shadow the clock uses. */}
				<h2
					className={cn(
						"font-semibold text-[17px] tracking-tight",
						wallpaperText("primary"),
					)}
					style={{ textShadow: HERO_TEXT_SHADOW }}
				>
					This folder is empty
				</h2>
				<p
					className={cn(
						"mt-2 text-xs leading-relaxed",
						wallpaperText("secondary"),
					)}
					style={{ textShadow: HERO_TEXT_SHADOW }}
				>
					Save a page here or add your first link.
				</p>

				{/* 4. The single primary action. In Glass mode it is a hero lens,
				    matching the focal icon instead of using the regular surface path. */}
				{isLiquid ? (
					<LiquidGlass
						data-glass-variant="liquid-refract"
						blur={optics.blur}
						refract
						refraction={optics.refraction}
						saturation={optics.saturation}
						brightness={optics.brightness}
						bezel={optics.bezel}
						shape="toolbarControl"
						className={cn("mt-6", glassLensVeil("hero", resolvedDark))}
					>
						{addLinkButton}
					</LiquidGlass>
				) : (
					<div className="mt-6">{addLinkButton}</div>
				)}

				{/* 5. Optional secondary actions, reduced to a single quiet line so
				    they never compete with the CTA. `text-shadow` inherits, so
				    setting it here covers the label, separators and buttons. */}
				<div
					className={cn(
						"mt-8 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11px]",
						wallpaperText("muted"),
					)}
					style={{ textShadow: HERO_TEXT_SHADOW }}
				>
					<span className="opacity-80">Quick add</span>
					{QUICK_ADD.map((site) => (
						<Fragment key={site.url}>
							<span aria-hidden="true" className="opacity-40">
								·
							</span>
							<button
								type="button"
								onClick={() => handleAddStarter(site)}
								title={`Add ${site.name} to ${folderName}`}
								aria-label={`Add ${site.name} to ${folderName}`}
								className={cn(
									"rounded-sm px-0.5 transition-colors duration-150 hover:underline hover:underline-offset-2",
									glassFocusRing(isLiquid),
									wallpaperText("secondary"),
								)}
							>
								{site.name}
							</button>
						</Fragment>
					))}
				</div>
			</div>
		</div>
	);
}
