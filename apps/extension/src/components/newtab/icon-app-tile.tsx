import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useResolvedIcon } from "../../hooks/use-resolved-icon";
import { deriveInitialLetter, faviconUrl } from "../../lib/url";
import { cn } from "../../lib/utils";
import { SvgIcon } from "../shared/svg-icon";

interface IconAppTileProps {
	url: string;
	favicon: string;
	mini?: boolean;
	showFavicon?: boolean;
	className?: string;
}

/**
 * Shared app-icon silhouette used by bookmarks, folders and folder previews.
 *
 * Media priority (see hooks/use-resolved-icon.ts): browser-confirmed data:
 * favicon → resolved record (the site's own app icon / brand art / site mark
 * / provider / letter-mark) → classic Google S2 favicon while resolution is
 * pending.
 *
 * Treatment classes:
 * - `icon-media-full`: an opaque app-scale square (apple-touch-style, PWA
 *   manifest) paints edge-to-edge, clipped by the tile's own squircle. This
 *   is the home-screen look — the artwork IS the icon.
 * - `icon-media-glyph`: a mark (transparent logo, vector brand art, small
 *   favicon) stays centered on the tile's neutral face, drawn at its own
 *   resolution so a 32px favicon is never upscaled into a blur.
 *
 * The face itself is the same soft-light neutral in both themes. Full app
 * artwork covers it; glyphs sit on it without an extra coloured frame.
 */
export function IconAppTile({
	url,
	favicon,
	mini = false,
	showFavicon = true,
	className,
}: IconAppTileProps) {
	const resolved = useResolvedIcon(url, { explicitFavicon: favicon });

	// Resolved upgrades cross-fade once; the very first paint (usually the
	// S2 baseline) fades in as part of the grid instead of a than tile.
	const mountedRef = useRef(false);
	const [swapIn, setSwapIn] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the resolved media IS the trigger — the swap animation replays whenever the artwork changes.
	useEffect(() => {
		if (!mountedRef.current) {
			mountedRef.current = true;
			return;
		}
		setSwapIn(true);
		const timer = window.setTimeout(() => setSwapIn(false), 260);
		return () => window.clearTimeout(timer);
	}, [resolved.status, resolved.imageSrc, resolved.svgXml]);

	// Keep low-resolution favicons at their native size. CSS caps larger marks
	// to a consistent optical scale inside the launcher face.
	const native =
		resolved.width > 0 ? (`${resolved.width}px` as string) : undefined;

	let media: ReactNode = null;
	if (showFavicon) {
		const swap = swapIn ? "icon-swap-in" : undefined;
		if (resolved.status === "letter") {
			const letter = deriveInitialLetter(url);
			if (letter) {
				media = (
					<span
						aria-hidden="true"
						className={cn(
							"icon-fallback-letter relative z-10 select-none",
							swap,
						)}
					>
						{letter}
					</span>
				);
			}
		} else if (resolved.status === "svg" && resolved.svgXml) {
			media = (
				<SvgIcon
					svgXml={resolved.svgXml}
					alt=""
					className={cn(
						"icon-media-glyph icon-media-vector relative z-10",
						swap,
					)}
				/>
			);
		} else if (resolved.status === "image" && resolved.imageSrc) {
			const isFull = resolved.treatment === "full";
			media = (
				<img
					src={resolved.imageSrc}
					alt=""
					draggable={false}
					className={cn(
						isFull
							? "icon-media-full absolute inset-0 z-10"
							: "icon-media-glyph relative z-10",
						swap,
					)}
					style={
						isFull || !native
							? undefined
							: ({ "--icon-media-native": native } as CSSProperties)
					}
					onError={(event) => {
						// Rotated link: degrade to the classic favicon face.
						const fallback = faviconUrl(url);
						if (!fallback || event.currentTarget.src === fallback) {
							event.currentTarget.style.visibility = "hidden";
							return;
						}
						event.currentTarget.src = fallback;
					}}
				/>
			);
		} else {
			// Baseline: the pre-pipeline presentation, byte for byte.
			const fallback = faviconUrl(url);
			media = (
				<img
					src={resolved.imageSrc || fallback}
					alt=""
					draggable={false}
					className={cn("icon-media-glyph relative z-10", swap)}
					onError={(event) => {
						if (event.currentTarget.src === fallback) {
							event.currentTarget.style.visibility = "hidden";
							return;
						}
						event.currentTarget.src = fallback;
					}}
				/>
			);
		}
	}

	return (
		<div
			aria-hidden="true"
			className={cn(
				"squircle icon-app-tile relative flex shrink-0 items-center justify-center overflow-hidden",
				mini ? "size-full" : "size-[var(--icon-size)]",
				className,
			)}
			{...(mini ? { "data-mini": "true" } : {})}
			data-icon-source={resolved.source ?? undefined}
			title={
				resolved.credit
					? [
							`Icon by ${resolved.credit}`,
							resolved.uploadedBy ? `uploaded by ${resolved.uploadedBy}` : null,
							resolved.creditUrl || "macOSicons.com",
						]
							.filter(Boolean)
							.join(" · ")
					: undefined
			}
		>
			{media}
		</div>
	);
}
