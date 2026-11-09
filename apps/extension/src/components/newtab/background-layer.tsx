import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BACKGROUND, GRADIENTS, WALLPAPERS } from "../../lib/constants";
import { cn, cssUrl } from "../../lib/utils";
import {
	decodeWallpaper,
	pexelsCreditUrl,
} from "../../lib/wallpaper-presentation";
import type { Settings } from "../../types";
import "./wallpaper-transition.css";
import {
	prepareNextWallpaper,
	refreshWallpaper,
} from "../../services/wallpaper";
import { useImageStore } from "../../stores/image-store";
import { useSetupStore } from "../../stores/setup-store";
import { GlassSurface } from "./toolbar/glass-surface";

function getInitialBackgroundCss(): string {
	try {
		const bg = useSetupStore.getState().settings.background;
		if (bg.type === "wallpaper" && bg.wallpaperId) {
			const wallpaper = WALLPAPERS.find((w) => w.id === bg.wallpaperId);
			if (wallpaper) return `${cssUrl(wallpaper.src)} center / cover no-repeat`;
		}
		if (bg.type === "gradient" && bg.gradientId) {
			const g = GRADIENTS.find((x) => x.id === bg.gradientId);
			if (g) return g.css;
		}
		if (bg.type === "pexels") {
			return DEFAULT_BACKGROUND.color;
		}
		if (bg.type === "solid" && bg.color) {
			return bg.color;
		}
	} catch {
		// Store not ready or in SSR/test
	}
	return DEFAULT_BACKGROUND.color;
}

function withImagePosition(background: string, position: string): string {
	return background.replace(
		/ center \/ cover no-repeat$/,
		` ${position} / cover no-repeat`,
	);
}

export function BackgroundLayer({
	contained = false,
}: {
	contained?: boolean;
}) {
	const type = useSetupStore((s) => s.settings.background.type);
	const imageId = useSetupStore((s) => s.settings.background.imageId);
	const wallpaperId = useSetupStore((s) => s.settings.background.wallpaperId);
	const gradientId = useSetupStore((s) => s.settings.background.gradientId);
	const color = useSetupStore((s) => s.settings.background.color);
	const pexelsImageId = useSetupStore(
		(s) => s.settings.background.pexelsImageId,
	);
	const pexelsPhoto = useSetupStore((s) => s.settings.background.pexelsPhoto);
	const pexelsPosition = useSetupStore(
		(s) => s.settings.background.pexelsPosition,
	);
	const pexelsQuery = useSetupStore((s) => s.settings.background.pexelsQuery);
	const pexelsFrequency = useSetupStore(
		(s) => s.settings.background.pexelsFrequency,
	);
	const previewBackgroundImage = useImageStore((s) => s.previewBackgroundImage);
	const previewBackgroundColor = useImageStore((s) => s.previewBackgroundColor);

	const blur = useSetupStore((s) => s.settings.background.blur);
	const brightness = useSetupStore((s) => s.settings.background.brightness);
	const opacity = useSetupStore((s) => s.settings.background.opacity);

	const getBackgroundImage = useImageStore((s) => s.getBackgroundImage);
	const [bgCss, setBgCss] = useState<string>(getInitialBackgroundCss);
	const currentCssRef = useRef(bgCss);
	const hasPaintedImage = useRef(type !== "pexels");
	const [outgoingCss, setOutgoingCss] = useState<string | null>(null);
	const [displayedPhoto, setDisplayedPhoto] =
		useState<Settings["background"]["pexelsPhoto"]>(null);
	const commitBackground = useCallback((css: string) => {
		if (currentCssRef.current === css) return;
		setOutgoingCss(hasPaintedImage.current ? currentCssRef.current : null);
		hasPaintedImage.current = true;
		currentCssRef.current = css;
		setBgCss(css);
	}, []);
	useEffect(() => {
		if (!outgoingCss) return;
		const timeout = setTimeout(() => setOutgoingCss(null), 400);
		return () => clearTimeout(timeout);
	}, [outgoingCss]);
	useEffect(() => {
		if (
			type !== "pexels" ||
			pexelsFrequency === "per-tab" ||
			pexelsFrequency === "locked"
		)
			return;
		const interval = setInterval(() => {
			refreshWallpaper().catch(() => undefined);
		}, 60_000);
		return () => clearInterval(interval);
	}, [type, pexelsFrequency]);

	const lastFetchedKeyRef = useRef<string>("");
	const pendingRefreshRef = useRef<Promise<void> | null>(null);
	const generationRef = useRef(0);

	const resolveImage = useCallback(
		async (imgId: string): Promise<string | null> => {
			try {
				const dataUrl = await getBackgroundImage(imgId);
				if (dataUrl) {
					if (!(await decodeWallpaper(dataUrl))) return null;
					return `${cssUrl(dataUrl)} center / cover no-repeat`;
				}
			} catch {
				// fall through
			}
			return null;
		},
		[getBackgroundImage],
	);

	const resolvePackagedWallpaper = useCallback(
		(wpId: string): string | null => {
			const wallpaper = WALLPAPERS.find((item) => item.id === wpId);
			return wallpaper
				? `${cssUrl(wallpaper.src)} center / cover no-repeat`
				: null;
		},
		[],
	);

	const applyImage = useCallback(
		async (imgId: string, isCurrent: () => boolean) => {
			const css = await resolveImage(imgId);
			if (!isCurrent() || !css) return;
			commitBackground(css);
			setDisplayedPhoto(null);
		},
		[resolveImage, commitBackground],
	);

	const resolvePreview = useCallback(
		async (dataUrl: string): Promise<string | null> => {
			try {
				if (!(await decodeWallpaper(dataUrl))) return null;
				return `${cssUrl(dataUrl)} center / cover no-repeat`;
			} catch {
				return null;
			}
		},
		[],
	);

	useEffect(() => {
		const generation = ++generationRef.current;
		let cancelled = false;
		const isCurrent = () => !cancelled && generationRef.current === generation;
		const fallback = color || DEFAULT_BACKGROUND.color;

		(async () => {
			if (previewBackgroundImage) {
				lastFetchedKeyRef.current = "";
				const css = await resolvePreview(previewBackgroundImage);
				if (!isCurrent() || !css) return;
				commitBackground(css);
				setDisplayedPhoto(null);
				return;
			}

			if (type === "pexels") {
				const fetchKey = `${pexelsQuery}|${pexelsFrequency}`;
				if (lastFetchedKeyRef.current !== fetchKey) {
					lastFetchedKeyRef.current = fetchKey;
					pendingRefreshRef.current = refreshWallpaper();
				}
				// StrictMode and store updates must await the same startup rotation.
				await pendingRefreshRef.current;
				if (!isCurrent()) return;

				const fresh = useSetupStore.getState().settings.background;
				const nextImageId = fresh.pexelsImageId ?? pexelsImageId;
				if (nextImageId) {
					const css = await resolveImage(nextImageId);
					if (isCurrent() && css) {
						commitBackground(css);
						setDisplayedPhoto(
							(nextImageId === pexelsImageId
								? pexelsPhoto
								: fresh.pexelsPhoto) ?? null,
						);
						void prepareNextWallpaper().catch(() => undefined);
					} else if (isCurrent()) {
						await refreshWallpaper(true);
					}
				}
				return;
			}

			if (type === "image" && imageId) {
				lastFetchedKeyRef.current = "";
				await applyImage(imageId, isCurrent);
				return;
			}

			if (type === "wallpaper" && wallpaperId) {
				lastFetchedKeyRef.current = "";
				const wallpaper = WALLPAPERS.find((w) => w.id === wallpaperId);
				if (wallpaper) {
					if (!(await decodeWallpaper(wallpaper.src))) return;
				}
				if (!isCurrent()) return;
				const css = resolvePackagedWallpaper(wallpaperId);
				commitBackground(css || fallback);
				setDisplayedPhoto(null);
				return;
			}

			if (type === "gradient" && gradientId) {
				lastFetchedKeyRef.current = "";
				const g = GRADIENTS.find((x) => x.id === gradientId) || GRADIENTS[0];
				if (isCurrent()) {
					commitBackground(g.css);
					setDisplayedPhoto(null);
				}
				return;
			}

			lastFetchedKeyRef.current = "";
			if (isCurrent()) {
				commitBackground(fallback);
				setDisplayedPhoto(null);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [
		type,
		pexelsImageId,
		pexelsPhoto,
		commitBackground,
		pexelsQuery,
		pexelsFrequency,
		imageId,
		wallpaperId,
		gradientId,
		color,
		previewBackgroundImage,
		applyImage,
		resolveImage,
		resolvePackagedWallpaper,
		resolvePreview,
	]);

	const position = type === "pexels" ? (pexelsPosition ?? "center") : "center";
	const photoUrl =
		pexelsCreditUrl(displayedPhoto?.url) ?? "https://www.pexels.com/";
	const photographerUrl = pexelsCreditUrl(displayedPhoto?.photographerUrl);

	return (
		<>
			<div
				id="bg-layer"
				className={cn(
					contained ? "absolute z-0" : "fixed -z-10",
					"pointer-events-none inset-0 overflow-hidden transition-[filter,opacity] duration-200 ease-out motion-reduce:transition-none",
				)}
				style={{
					// Staged images retain priority; solid commits paint synchronously,
					// without waiting for the background-resolution effect.
					background: withImagePosition(
						previewBackgroundImage
							? bgCss
							: type === "solid"
								? (previewBackgroundColor ??
									(color || DEFAULT_BACKGROUND.color))
								: bgCss,
						position,
					),
					filter: `blur(${blur || 0}px) brightness(${brightness || 100}%)`,
					opacity: (opacity ?? 100) / 100,
				}}
			>
				{outgoingCss && type !== "solid" && !previewBackgroundColor ? (
					<div
						key={bgCss}
						aria-hidden="true"
						className="wallpaper-outgoing absolute inset-0 motion-reduce:hidden"
						style={{ background: withImagePosition(outgoingCss, position) }}
					/>
				) : null}
			</div>
			{displayedPhoto ? (
				<GlassSurface
					role="complementary"
					variant="tooltip"
					shape="control"
					aria-label="Photo credits"
					className={cn(
						contained ? "absolute" : "fixed",
						"bottom-3 left-4 z-10 block max-w-[calc(100%-2rem)] px-3 py-1.5 text-xs leading-relaxed",
					)}
				>
					Photo by{" "}
					{photographerUrl ? (
						<a
							className="underline decoration-current/50 underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-current focus-visible:outline-offset-2"
							href={photographerUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							{displayedPhoto.photographer}
						</a>
					) : (
						displayedPhoto.photographer
					)}
					{" on "}
					<a
						className="underline decoration-current/50 underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-current focus-visible:outline-offset-2"
						href={photoUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						Pexels
					</a>
				</GlassSurface>
			) : null}
		</>
	);
}
