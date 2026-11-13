import { LiquidGlass } from "@ktab/ui/components/liquid-glass";
import { Button as MotionButton } from "@ktab/ui/components/motion/button/base";
import { Icon } from "@ktab/ui/icons/icon";
import { ktabShape } from "@ktab/ui/lib/shapes";
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
import { IconAppTile } from "./icon-app-tile";

interface EmptyLandingProps {
	/** Target folder, used to name where a quick-add shortcut will land. */
	folderName: string;
	/** Opens the add-link flow. */
	onAdd: () => void;
}

const QUICK_ADD = RECOMMENDED_SITES.slice(0, 4);

/** A welcoming first-link state with a useful action and local shortcuts. */
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
				"squircle inline-flex h-10 items-center gap-2 rounded-xl px-4 font-medium text-[12px] transition-[background-color,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
				glassFocusRing(isLiquid),
				isLiquid
					? cn(
							"border-0 bg-transparent hover:bg-foreground/[0.10]",
							glassForeground(),
						)
					: cn(glassMaterial(false, "floating"), "text-flat-ink"),
			)}
		>
			<Icon name="plus" size={14} aria-hidden="true" />
			Add a link
		</MotionButton>
	);

	const ghostCardMaterial = isLiquid
		? resolvedDark
			? "border-white/15 bg-white/[0.08] text-white/75 backdrop-blur-xl"
			: "border-black/10 bg-white/50 text-neutral-700 backdrop-blur-xl"
		: "border-border/70 bg-background/75 text-muted-foreground shadow-sm";

	return (
		<div className="flex justify-center px-6 pt-8 pb-20">
			<div className="group/empty flex w-full max-w-md flex-col items-center text-center">
				<div aria-hidden="true" className="relative mb-6 h-[104px] w-[176px]">
					<div
						className={cn(
							"squircle absolute top-4 left-2 flex h-[76px] w-[106px] -rotate-[11deg] flex-col gap-2 overflow-hidden rounded-2xl border p-3 shadow-lg transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:group-hover/empty:-translate-y-1 motion-safe:group-hover/empty:shadow-xl motion-reduce:transition-none",
							ghostCardMaterial,
						)}
					>
						<span className="h-2 w-12 rounded-full bg-current/20" />
						<span className="h-1.5 w-16 rounded-full bg-current/15" />
						<span className="h-1.5 w-10 rounded-full bg-current/15" />
					</div>
					<div
						className={cn(
							"squircle absolute top-3 right-1 flex h-[76px] w-[106px] rotate-[10deg] flex-col justify-between overflow-hidden rounded-2xl border p-3 shadow-lg transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:group-hover/empty:translate-y-1 motion-safe:group-hover/empty:shadow-xl motion-reduce:transition-none",
							ghostCardMaterial,
						)}
					>
						<span className="flex size-7 items-center justify-center rounded-lg bg-current/10">
							<Icon name="globe" size={15} />
						</span>
						<span className="h-1.5 w-14 rounded-full bg-current/15" />
					</div>
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
								"squircle absolute top-5 left-1/2 grid size-[68px] -translate-x-1/2 place-items-center rounded-2xl shadow-xl",
								glassLensVeil("hero", resolvedDark),
								glassForeground(),
							)}
						>
							<Icon name="bookmark" size={25} />
						</LiquidGlass>
					) : (
						<div
							className={cn(
								"squircle absolute top-5 left-1/2 grid size-[68px] -translate-x-1/2 place-items-center rounded-2xl border shadow-xl",
								ktabShape("section"),
								glassMaterial(false, "panel"),
								"text-muted-foreground",
							)}
						>
							<Icon name="bookmark" size={25} />
						</div>
					)}
				</div>

				<h2
					className={cn(
						"font-semibold text-[18px] tracking-tight",
						wallpaperText("primary"),
					)}
					style={{ textShadow: HERO_TEXT_SHADOW }}
				>
					Nothing here yet
				</h2>
				<p
					className={cn(
						"mt-2 max-w-sm text-[12px] leading-relaxed",
						wallpaperText("secondary"),
					)}
					style={{ textShadow: HERO_TEXT_SHADOW }}
				>
					Add a favorite to {folderName}, or choose one below.
				</p>

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
						className={cn("mt-5", glassLensVeil("hero", resolvedDark))}
					>
						{addLinkButton}
					</LiquidGlass>
				) : (
					<div className="mt-5">{addLinkButton}</div>
				)}

				<div
					className="mt-5 flex items-center justify-center gap-1.5 text-[10px]"
					style={{ textShadow: HERO_TEXT_SHADOW }}
				>
					<span className={wallpaperText("muted")}>Keyboard tip</span>
					<kbd
						className={cn(
							"squircle rounded-md border px-1.5 py-0.5 font-medium",
							wallpaperText("secondary"),
							isLiquid
								? "border-white/20 bg-white/10"
								: "border-border/70 bg-background/70",
						)}
					>
						Tab
					</kbd>
					<span className={wallpaperText("muted")}>then</span>
					<kbd
						className={cn(
							"squircle rounded-md border px-1.5 py-0.5 font-medium",
							wallpaperText("secondary"),
							isLiquid
								? "border-white/20 bg-white/10"
								: "border-border/70 bg-background/70",
						)}
					>
						Enter
					</kbd>
					<span className={wallpaperText("muted")}>to add a favorite</span>
				</div>

				<div className="mt-6 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
					{QUICK_ADD.map((site) => (
						<button
							key={site.url}
							type="button"
							onClick={() => handleAddStarter(site)}
							title={`Add ${site.name} to ${folderName}`}
							aria-label={`Add ${site.name} to ${folderName}`}
							className={cn(
								"squircle flex min-h-12 items-center gap-2 rounded-xl border px-2.5 text-left text-[11px] transition-[background-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-[var(--ktab-accent)] focus-visible:outline-offset-2 motion-safe:enabled:active:scale-[0.96] motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none",
								glassFocusRing(isLiquid),
								isLiquid
									? resolvedDark
										? "border-white/10 bg-white/[0.08] text-white/90 backdrop-blur-xl hover:bg-white/[0.13]"
										: "border-black/10 bg-white/55 text-neutral-800 backdrop-blur-xl hover:bg-white/75"
									: "border-border/70 bg-background/75 text-foreground hover:bg-background",
							)}
						>
							<IconAppTile
								url={site.url}
								favicon={faviconUrl(site.url)}
								className="size-7 rounded-lg shadow-sm"
							/>
							<span className="truncate">{site.name}</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
