import { Input } from "@klice-start/ui/components/input";
import { Icon } from "@klice-start/ui/icons/icon";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	normalizePexelsQuery,
	PEXELS_MAX_QUERY_LENGTH,
} from "../../../../lib/pexels";
import { cn } from "../../../../lib/utils";
import { pexelsCreditUrl } from "../../../../lib/wallpaper-presentation";
import { PEXELS_THEMES } from "../../../../lib/wallpaper-themes";
import {
	refreshWallpaper,
	useWallpaperStatus,
} from "../../../../services/wallpaper";
import { useSetupStore } from "../../../../stores/setup-store";
import type { WallpaperFrequency } from "../../../../types";
import { SectionCard } from "../shared/section-card";
import { SelectRow } from "../shared/select-row";
import { SettingsAction } from "../shared/settings-action";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_INPUT,
	SETTINGS_PAGE,
	SETTINGS_RADIUS,
} from "../shared/settings-tokens";

const FREQUENCIES: readonly { value: WallpaperFrequency; label: string }[] = [
	{ value: "per-tab", label: "Every new tab" },
	{ value: "hourly", label: "Hourly" },
	{ value: "daily", label: "Daily" },
	{ value: "daylight", label: "Follow daylight" },
	{ value: "locked", label: "Manual" },
];

const THEME_TILE = cn(
	"group squircle relative flex aspect-[4/3] min-w-0 overflow-hidden border border-neutral-900/10 bg-neutral-900/[0.04] text-left shadow-none transition-[filter,box-shadow] duration-150 focus-visible:outline-none dark:border-white/10 dark:bg-white/[0.04]",
	SETTINGS_RADIUS.surface,
	SETTINGS_FOCUS_RING,
);
const TILE_SELECTED = "ring-2 ring-inset ring-[var(--klice-accent)]";

function ThemeThumb({ src, alt }: { src: string; alt: string }): ReactNode {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return (
			<span
				aria-hidden="true"
				className="absolute inset-0 bg-gradient-to-br from-neutral-700 to-neutral-900"
			/>
		);
	}
	return (
		<img
			src={src}
			alt={alt}
			loading="lazy"
			decoding="async"
			referrerPolicy="no-referrer"
			onError={() => setFailed(true)}
			className="absolute inset-0 size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
		/>
	);
}

export function PexelsDetailView(): ReactNode {
	const background = useSetupStore((state) => state.settings.background);
	const updateBackground = useSetupStore((state) => state.updateBackground);
	const status = useWallpaperStatus((state) => state.status);
	const message = useWallpaperStatus((state) => state.message);
	const [draft, setDraft] = useState(background.pexelsQuery);
	const loading = status === "loading";
	const currentPhoto =
		background.type === "pexels" ? background.pexelsPhoto : null;

	useEffect(() => setDraft(background.pexelsQuery), [background.pexelsQuery]);

	function selectQuery(query: string) {
		if (!query.trim()) return;
		const normalized = normalizePexelsQuery(query);
		setDraft(normalized);
		if (background.type !== "pexels") {
			updateBackground({ type: "pexels", pexelsQuery: normalized });
			refreshWallpaper(true).catch(() => undefined);
			return;
		}

		updateBackground({ pexelsQuery: normalized });
		refreshWallpaper(true).catch(() => undefined);
	}

	return (
		<div className={SETTINGS_PAGE}>
			<SectionCard>
				<fieldset
					className="min-w-0 space-y-3 border-0"
					aria-label="Photo themes"
				>
					<legend className="font-medium text-[13px] text-neutral-800 dark:text-neutral-100">
						Themes
					</legend>
					<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-2.5">
						{PEXELS_THEMES.map((theme) => {
							const selected =
								background.type === "pexels" &&
								normalizePexelsQuery(background.pexelsQuery) === theme.query;
							return (
								<button
									key={theme.id}
									type="button"
									aria-pressed={selected}
									onClick={() => selectQuery(theme.query)}
									className={cn(
										THEME_TILE,
										selected ? TILE_SELECTED : "hover:brightness-105",
									)}
									data-pexels-theme={theme.id}
								>
									<ThemeThumb src={theme.preview} alt="" />
									<span
										aria-hidden="true"
										className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent"
									/>
									<span className="pointer-events-none relative z-10 mt-auto truncate px-2.5 pb-2 font-medium text-[11px] text-white/95 drop-shadow-xs">
										{theme.label}
									</span>
									{selected ? (
										<span className="pointer-events-none absolute top-2 right-2 z-10 flex size-5 items-center justify-center rounded-full bg-[var(--klice-accent)] text-[var(--klice-accent-foreground)] shadow-sm">
											<Icon
												name="check"
												size={12}
												strokeWidth={3}
												aria-hidden="true"
											/>
										</span>
									) : null}
								</button>
							);
						})}
					</div>
					<form
						className="flex min-w-0 gap-2 pt-1"
						onSubmit={(event) => {
							event.preventDefault();
							selectQuery(draft);
						}}
					>
						<Input
							id="pexels-query-input"
							aria-label="Search Pexels photos"
							placeholder="Search anything, e.g. Japan"
							maxLength={PEXELS_MAX_QUERY_LENGTH}
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							className={cn(
								"h-9 min-w-0 flex-1 px-3 text-sm",
								SETTINGS_RADIUS.control,
								SETTINGS_INPUT,
							)}
						/>
						<SettingsAction
							type="submit"
							disabled={!draft.trim()}
							icon="search"
						>
							Search
						</SettingsAction>
					</form>
				</fieldset>
			</SectionCard>

			<SectionCard>
				<SelectRow
					label="Change photo"
					icon="timer"
					value={background.pexelsFrequency}
					options={FREQUENCIES}
					onChange={(value) => {
						updateBackground({ pexelsFrequency: value });
					}}
				/>
				<div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-neutral-900/10 border-t pt-3 dark:border-white/10">
					<div className="min-w-0 flex-1 text-xs leading-relaxed">
						<p className="font-medium">
							{currentPhoto ? "Current photo" : "Choose a photo"}
						</p>
						<a
							href={
								pexelsCreditUrl(currentPhoto?.url) ?? "https://www.pexels.com/"
							}
							target="_blank"
							rel="noopener noreferrer"
							className={cn(
								"break-words underline decoration-current/40 underline-offset-4 hover:decoration-current",
								SETTINGS_FOCUS_RING,
							)}
						>
							{currentPhoto?.photographer ?? "Explore Pexels"}
						</a>
					</div>
					<SettingsAction
						icon="refresh"
						onClick={() => {
							if (background.type !== "pexels") {
								updateBackground({ type: "pexels" });
							}
							refreshWallpaper(true).catch(() => undefined);
						}}
						disabled={loading}
					>
						{loading ? "Loading photo…" : "Next photo"}
					</SettingsAction>
				</div>
				<p
					role="status"
					aria-live="polite"
					aria-atomic="true"
					className={cn(
						"text-xs leading-relaxed",
						(loading || message) && "pt-3",
					)}
				>
					{loading ? "Finding your next photograph…" : (message ?? "")}
				</p>
			</SectionCard>
			<p className="px-2 text-neutral-600 text-xs leading-relaxed dark:text-neutral-300">
				Search terms are shared with Pexels. Photos are saved on this device.
			</p>
		</div>
	);
}
