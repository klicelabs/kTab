import {
	ColorPicker,
	ColorPickerArea,
	ColorPickerChannels,
	ColorPickerContent,
	ColorPickerHexInput,
	ColorPickerHue,
	ColorPickerPreset,
	ColorPickerPresets,
	ColorPickerTrigger,
} from "@ktab/ui/components/motion/color-picker";
import {
	FileUpload,
	type FileUploadItem,
} from "@ktab/ui/components/motion/file-upload";
import { Icon } from "@ktab/ui/icons/icon";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	cleanSurfaceCss,
	GRADIENTS,
	MAX_BACKGROUND_IMAGE_BYTES,
	WALLPAPERS,
} from "../../../../lib/constants";
import { flushPersist } from "../../../../lib/storage";
import { cn } from "../../../../lib/utils";
import { PEXELS_LIBRARY_PREVIEW } from "../../../../lib/wallpaper-themes";
import { useImageStore } from "../../../../stores/image-store";
import { useSetupStore } from "../../../../stores/setup-store";
import type { CustomWallpaper, Settings } from "../../../../types";
import { useAppearance } from "../../appearance-provider";
import { SectionCard } from "../shared/section-card";
import { SettingsAction } from "../shared/settings-action";
import {
	SETTINGS_FOCUS_RING,
	SETTINGS_PAGE,
	SETTINGS_RADIUS,
} from "../shared/settings-tokens";

type WallpaperLibraryItem =
	| { kind: "wallpaper"; id: string; label: string; thumb: string }
	| { kind: "gradient"; id: string; label: string; css: string }
	| { kind: "solid"; id: "solid"; label: string; css: string }
	| { kind: "none"; id: "none"; label: string; css: string };

type PendingUpload = {
	name: string;
	previewUrl: string;
	status: "validating" | "ready" | "confirming" | "error";
	error?: string;
	dataUrl?: string;
};

const WALLPAPER_TILE = cn(
	"group squircle relative flex aspect-[4/3] min-w-0 items-end overflow-hidden border border-neutral-900/10 bg-neutral-900/[0.04] shadow-none transition-[filter,box-shadow] duration-150 focus-visible:outline-none dark:border-white/10 dark:bg-white/[0.04]",
	SETTINGS_RADIUS.surface,
);
const TILE_SELECTED = "ring-2 ring-inset ring-[var(--ktab-accent)]";

const SUPPORTED_IMAGE_TYPES: Record<string, readonly string[]> = {
	"image/jpeg": ["jpg", "jpeg"],
	"image/png": ["png"],
	"image/webp": ["webp"],
	"image/avif": ["avif"],
};
const SUPPORTED_LABEL = "JPEG, PNG, WebP or AVIF";
const UPLOAD_ACCEPT = Object.keys(SUPPORTED_IMAGE_TYPES).join(",");

/** Downscale large user images before they enter the existing image store. */
async function downscaleImageFile(
	file: File,
	maxDimension = 2560,
): Promise<string> {
	const bitmap = await createImageBitmap(file);
	let { width, height } = bitmap;

	if (width > maxDimension || height > maxDimension) {
		if (width > height) {
			height = Math.round((height * maxDimension) / width);
			width = maxDimension;
		} else {
			width = Math.round((width * maxDimension) / height);
			height = maxDimension;
		}
	}

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Could not initialize image processor.");

	context.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	return canvas.toDataURL("image/jpeg", 0.88);
}

/** Validate the actual file, not only the browser picker's accept hint. */
function validateImageFile(file: File): string | null {
	if (!file || file.size <= 0) return "That file is empty.";
	if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
		return `Image must be ${Math.round(MAX_BACKGROUND_IMAGE_BYTES / (1024 * 1024))} MB or smaller.`;
	}

	const extensions = SUPPORTED_IMAGE_TYPES[file.type];
	if (!extensions) return `Only ${SUPPORTED_LABEL} images are supported.`;

	const extension = file.name.includes(".")
		? file.name.split(".").pop()?.toLowerCase()
		: undefined;
	if (!extension || !extensions.includes(extension)) {
		return "That file doesn't look like a supported image.";
	}
	return null;
}

interface CustomWallpaperSlotContentProps {
	customWallpaper: CustomWallpaper | null;
	customPreview: string | null;
	pending: PendingUpload | null;
	interactionHint?: string;
}

function CustomWallpaperSlotContent({
	customWallpaper,
	customPreview,
	pending,
	interactionHint,
}: CustomWallpaperSlotContentProps): ReactNode {
	const candidatePreview =
		pending?.status === "error"
			? null
			: pending?.previewUrl || pending?.dataUrl;
	const previewUrl = candidatePreview || customPreview;
	const statusLabel = pending
		? pending.status === "validating"
			? "Checking image…"
			: pending.status === "confirming"
				? "Saving…"
				: pending.status === "error"
					? (pending.error ?? "Choose another image")
					: "Ready to apply"
		: null;

	return (
		<>
			{previewUrl ? (
				<img
					src={previewUrl}
					alt=""
					className="absolute inset-0 size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
				/>
			) : (
				<span className="relative z-10 flex size-10 items-center justify-center rounded-full bg-neutral-900/[0.08] text-neutral-500 dark:bg-white/[0.1] dark:text-neutral-300">
					<Icon
						name={
							customWallpaper || pending?.status === "error"
								? "image"
								: "upload"
						}
						size={19}
						aria-hidden="true"
					/>
				</span>
			)}

			{previewUrl ? (
				<span
					aria-hidden="true"
					className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/5"
				/>
			) : null}

			<span
				className={cn(
					"absolute inset-x-2 z-10 flex min-w-0 flex-col gap-1",
					interactionHint
						? "items-start text-left"
						: "items-center text-center",
					pending?.status === "ready" ? "bottom-10" : "bottom-2",
				)}
			>
				<span
					className={cn(
						"max-w-full truncate font-medium text-[12px] leading-tight",
						previewUrl
							? "text-white drop-shadow-xs"
							: "text-neutral-700 dark:text-neutral-100",
					)}
				>
					{pending?.name ?? (customWallpaper ? "Custom image" : "Add image")}
				</span>
				{statusLabel ? (
					<span
						aria-atomic="true"
						aria-live="polite"
						className={cn(
							"max-w-full truncate text-[10px] leading-tight",
							pending?.status === "error" ? "text-red-100" : "text-white/75",
						)}
					>
						{statusLabel}
					</span>
				) : null}
			</span>

			{interactionHint ? (
				<span className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-3 text-center font-medium text-[11px] text-white opacity-0 drop-shadow-xs transition-opacity duration-150 group-hover/custom:opacity-100 group-focus-visible/custom:opacity-100 motion-reduce:transition-none">
					{interactionHint}
				</span>
			) : null}
		</>
	);
}

/** Only this tile subscribes to transient drag frames, never the library grid. */
function SolidWallpaperTile({
	color,
	selected,
	onActivate,
}: {
	color: string;
	selected: boolean;
	onActivate?: (color: string) => void;
}) {
	const draft = useImageStore((state) => state.previewBackgroundColor);
	const [open, setOpen] = useState(false);
	const pendingRef = useRef<{ color: string; persisted: string } | null>(null);

	// Reads live stores, including during unmount: never resurrect another
	// wallpaper (or a new staged image) from a stale settings closure.
	const settle = useCallback(() => {
		const pending = pendingRef.current;
		pendingRef.current = null;
		if (!pending) return;
		const images = useImageStore.getState();
		const setup = useSetupStore.getState();
		const background = setup.settings.background;
		if (
			images.previewBackgroundColor === pending.color &&
			!images.previewBackgroundImage &&
			background.type === "solid" &&
			background.color === pending.persisted &&
			background.color.toLowerCase() !== pending.color.toLowerCase()
		) {
			setup.updateBackground({
				type: "solid",
				color: pending.color,
				wallpaperId: null,
				gradientId: null,
				imageId: null,
			});
		}
		if (images.previewBackgroundColor === pending.color) {
			images.clearBackgroundColorPreview();
		}
	}, []);

	useEffect(() => () => settle(), [settle]);
	useEffect(() => {
		if (!selected) {
			settle();
			setOpen(false);
		}
	}, [selected, settle]);

	return (
		<ColorPicker
			value={draft ?? color}
			alpha={false}
			open={open}
			onOpenChange={(next) => {
				if (next)
					onActivate?.(useSetupStore.getState().settings.background.color);
				else settle();
				setOpen(next);
			}}
			onValueChange={(next) => {
				const background = useSetupStore.getState().settings.background;
				if (background.type !== "solid") return;
				pendingRef.current = {
					color: next,
					persisted: pendingRef.current?.persisted ?? background.color,
				};
				useImageStore.getState().setBackgroundColorPreview(next);
			}}
			onValueCommit={settle}
			aria-label="Solid background colour"
			className="h-full max-w-none"
		>
			<ColorPickerTrigger
				aria-label="Use solid colour background"
				aria-pressed={selected}
				data-wallpaper-tile="solid"
				className={cn(
					WALLPAPER_TILE,
					"w-full items-end text-left",
					SETTINGS_FOCUS_RING,
					selected ? TILE_SELECTED : "hover:brightness-105",
				)}
			>
				<span
					aria-hidden="true"
					className="absolute inset-0 size-full"
					style={{ background: draft ?? color }}
				/>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent"
				/>
				<span className="pointer-events-none relative z-10 truncate px-2.5 pb-2 font-medium text-[11px] text-white/95 drop-shadow-xs">
					Solid colour
				</span>
				{selected && (
					<span className="pointer-events-none absolute top-2 right-2 z-10 flex size-5 items-center justify-center rounded-full bg-[var(--ktab-accent)] text-[var(--ktab-accent-foreground)] shadow-sm">
						<Icon name="check" size={12} strokeWidth={3} aria-hidden="true" />
					</span>
				)}
			</ColorPickerTrigger>
			<ColorPickerContent aria-label="Solid background colour picker">
				<ColorPickerArea />
				<ColorPickerHue />
				<ColorPickerHexInput />
				<ColorPickerChannels />
				<ColorPickerPresets aria-label="Colour presets">
					{[
						"#18181b",
						"#ffffff",
						"#3478f6",
						"#22c55e",
						"#f59e0b",
						"#ef4444",
						"#a855f7",
					].map((value) => (
						<ColorPickerPreset
							key={value}
							value={value}
							label={`Use ${value} colour`}
						/>
					))}
				</ColorPickerPresets>
			</ColorPickerContent>
		</ColorPicker>
	);
}

interface WallpaperTileProps {
	item: WallpaperLibraryItem;
	selected: boolean;
	onSelect: (item: WallpaperLibraryItem) => void;
	/** Select solid on opening; drag preview and settled commits stay local. */
	onColorChange?: (color: string) => void;
}

function WallpaperTile({
	item,
	selected,
	onSelect,
	onColorChange,
}: WallpaperTileProps) {
	if (item.kind === "solid") {
		return (
			<SolidWallpaperTile
				color={item.css}
				selected={selected}
				onActivate={onColorChange}
			/>
		);
	}
	const tileLabel =
		item.kind === "gradient"
			? `Use ${item.label} gradient`
			: item.kind === "none"
				? "Use no wallpaper"
				: `Use ${item.label} wallpaper`;

	return (
		<div
			className={cn(
				WALLPAPER_TILE,
				selected ? TILE_SELECTED : "hover:brightness-105",
			)}
			data-wallpaper-tile={item.id}
		>
			<button
				type="button"
				onClick={() => onSelect(item)}
				aria-label={tileLabel}
				aria-pressed={selected}
				className={cn(
					"absolute inset-0 flex flex-col justify-end text-left focus-visible:outline-none",
					SETTINGS_FOCUS_RING,
				)}
			>
				{item.kind === "wallpaper" ? (
					<img
						src={item.thumb}
						alt=""
						className="absolute inset-0 size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
						loading="lazy"
					/>
				) : (
					<span
						aria-hidden="true"
						className="absolute inset-0 size-full"
						style={{ background: item.css }}
					/>
				)}
			</button>

			{/* Scrim and label sit above whichever control is active, and must
			    never swallow its clicks. */}
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
			<span className="pointer-events-none relative z-10 truncate px-2.5 pb-2 font-medium text-[11px] text-white/95 drop-shadow-xs">
				{item.label}
			</span>

			{selected ? (
				<span className="pointer-events-none absolute top-2 right-2 z-10 flex size-5 items-center justify-center rounded-full bg-[var(--ktab-accent)] text-[var(--ktab-accent-foreground)] shadow-sm">
					<Icon name="check" size={12} strokeWidth={3} aria-hidden="true" />
				</span>
			) : null}
		</div>
	);
}

function PexelsSourceTile({
	selected,
	onOpen,
}: {
	selected: boolean;
	onOpen: () => void;
}): ReactNode {
	const [failed, setFailed] = useState(false);
	return (
		<div
			className={cn(
				WALLPAPER_TILE,
				selected ? TILE_SELECTED : "hover:brightness-105",
			)}
			data-wallpaper-tile="pexels"
		>
			<button
				type="button"
				onClick={onOpen}
				aria-label={
					selected ? "Pexels photography (active)" : "Choose Pexels photography"
				}
				aria-pressed={selected}
				className={cn(
					"absolute inset-0 flex flex-col justify-end text-left focus-visible:outline-none",
					SETTINGS_FOCUS_RING,
				)}
			>
				{failed ? (
					<span
						aria-hidden="true"
						className="absolute inset-0 bg-gradient-to-br from-neutral-700 to-neutral-900"
					/>
				) : (
					<img
						src={PEXELS_LIBRARY_PREVIEW}
						alt=""
						loading="lazy"
						decoding="async"
						referrerPolicy="no-referrer"
						onError={() => setFailed(true)}
						className="absolute inset-0 size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
					/>
				)}
			</button>
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
			<span className="pointer-events-none relative z-10 flex items-center gap-1.5 truncate px-2.5 pb-2 font-medium text-[11px] text-white/95 drop-shadow-xs">
				<Icon name="camera" size={11} aria-hidden="true" />
				Pexels
			</span>
			{selected ? (
				<span className="pointer-events-none absolute top-2 right-2 z-10 flex size-5 items-center justify-center rounded-full bg-[var(--ktab-accent)] text-[var(--ktab-accent-foreground)] shadow-sm">
					<Icon name="check" size={12} strokeWidth={3} aria-hidden="true" />
				</span>
			) : null}
		</div>
	);
}

export function WallpaperPane({ onOpenPexels }: { onOpenPexels: () => void }) {
	const { resolvedDark } = useAppearance();
	const bg = useSetupStore((state) => state.settings.background);
	const updateBackground = useSetupStore((state) => state.updateBackground);
	const commitCustomWallpaper = useSetupStore(
		(state) => state.commitCustomWallpaper,
	);
	const removeCustomWallpaper = useSetupStore(
		(state) => state.removeCustomWallpaper,
	);
	const saveBackgroundImage = useImageStore(
		(state) => state.saveBackgroundImage,
	);
	const deleteBackgroundImage = useImageStore(
		(state) => state.deleteBackgroundImage,
	);
	const getBackgroundImage = useImageStore((state) => state.getBackgroundImage);
	const setBackgroundPreview = useImageStore(
		(state) => state.setBackgroundPreview,
	);
	const clearBackgroundPreview = useImageStore(
		(state) => state.clearBackgroundPreview,
	);
	const customWallpaper = bg.customWallpaper;
	const [pending, setPending] = useState<PendingUpload | null>(null);
	const [customPreview, setCustomPreview] = useState<string | null>(null);
	const uploadGenerationRef = useRef(0);
	// The live staged blob URL, if any. Revoked exactly once on replace,
	// cancel or unmount — never inside a state updater.
	const pendingUrlRef = useRef<string | null>(null);

	function trackPreviewUrl(url: string | undefined) {
		const next = url || null;
		if (pendingUrlRef.current && pendingUrlRef.current !== next) {
			URL.revokeObjectURL(pendingUrlRef.current);
		}
		pendingUrlRef.current = next;
	}

	const untrackPreviewUrl = useCallback(() => {
		if (pendingUrlRef.current) {
			URL.revokeObjectURL(pendingUrlRef.current);
			pendingUrlRef.current = null;
		}
	}, []);

	useEffect(() => {
		let active = true;
		setCustomPreview(null);
		if (!customWallpaper) {
			return;
		}

		getBackgroundImage(customWallpaper.id)
			.then((dataUrl) => {
				if (active) setCustomPreview(dataUrl);
			})
			.catch(() => {
				if (active) setCustomPreview(null);
			});

		return () => {
			active = false;
		};
	}, [customWallpaper, getBackgroundImage]);

	// Invalidate in-flight uploads and drop the transient preview ONLY on
	// unmount. This must NOT depend on pending.previewUrl: depending on it
	// would run the cleanup for the very upload that just staged, bump the
	// generation, and strand it in "validating" forever. Blob URL lifetime is
	// owned by stageUpload/clearPending instead, which revoke explicitly.
	useEffect(
		() => () => {
			uploadGenerationRef.current += 1;
			clearBackgroundPreview();
			untrackPreviewUrl();
		},
		[clearBackgroundPreview, untrackPreviewUrl],
	);

	const libraryItems = useMemo<WallpaperLibraryItem[]>(
		() => [
			{
				kind: "none",
				id: "none",
				label: "None",
				css: cleanSurfaceCss(resolvedDark),
			},
			{ kind: "solid", id: "solid", label: "Solid colour", css: bg.color },
			...WALLPAPERS.map((wallpaper) => ({
				kind: "wallpaper" as const,
				id: wallpaper.id,
				label: wallpaper.label,
				thumb: wallpaper.thumb,
			})),
			...GRADIENTS.map((gradient) => ({
				kind: "gradient" as const,
				id: gradient.id,
				label: gradient.label,
				css: gradient.css,
			})),
		],
		[bg.color, resolvedDark],
	);

	function isSelected(item: WallpaperLibraryItem) {
		if (item.kind === "wallpaper")
			return bg.type === "wallpaper" && bg.wallpaperId === item.id;
		if (item.kind === "gradient")
			return bg.type === "gradient" && bg.gradientId === item.id;
		if (item.kind === "solid") return bg.type === "solid";
		if (item.kind === "none") return bg.type === "none";
		return false;
	}

	function handleSelect(item: WallpaperLibraryItem) {
		if (pending) clearPending();
		if (item.kind === "wallpaper") {
			updateBackground({
				type: "wallpaper",
				wallpaperId: item.id,
				gradientId: null,
				imageId: null,
			} as Partial<Settings["background"]>);
		} else if (item.kind === "gradient") {
			updateBackground({
				type: "gradient",
				gradientId: item.id,
				wallpaperId: null,
				imageId: null,
			} as Partial<Settings["background"]>);
		} else if (item.kind === "none") {
			updateBackground({
				type: "none",
				wallpaperId: null,
				gradientId: null,
				imageId: null,
			} as Partial<Settings["background"]>);
		}
		// Solid selection is owned by its picker opening gesture.
	}

	/** Opening the picker selects solid once; dragging never persists here. */
	function handleSolidColor(color: string) {
		if (pending) clearPending();
		if (useSetupStore.getState().settings.background.type === "solid") return;
		updateBackground({
			type: "solid",
			color,
			wallpaperId: null,
			gradientId: null,
			imageId: null,
		} as Partial<Settings["background"]>);
	}

	function handleSelectCustom() {
		if (!customWallpaper || pending) return;
		updateBackground({
			type: "image",
			imageId: customWallpaper.id,
			wallpaperId: null,
			gradientId: null,
		} as Partial<Settings["background"]>);
	}

	function clearPending() {
		uploadGenerationRef.current += 1;
		clearBackgroundPreview();
		untrackPreviewUrl();
		setPending(null);
	}

	async function stageUpload(file: File) {
		const uploadGeneration = ++uploadGenerationRef.current;
		clearBackgroundPreview();
		const name =
			file.name.replace(/\.[^/.]+$/, "").trim() || "Uploaded wallpaper";
		const next: PendingUpload = {
			name,
			previewUrl: typeof URL !== "undefined" ? URL.createObjectURL(file) : "",
			status: "validating",
		};
		trackPreviewUrl(next.previewUrl);
		setPending(next);

		const rejection = validateImageFile(file);
		if (rejection) {
			setPending({ ...next, status: "error", error: rejection });
			return;
		}
		if (typeof createImageBitmap === "undefined") {
			setPending({
				...next,
				status: "error",
				error: "This browser can't read images here.",
			});
			return;
		}

		try {
			const dataUrl = await downscaleImageFile(file);
			if (uploadGenerationRef.current !== uploadGeneration) return;
			setPending({ ...next, status: "ready", dataUrl });
			setBackgroundPreview(dataUrl);
		} catch {
			if (uploadGenerationRef.current !== uploadGeneration) return;
			setPending({
				...next,
				status: "error",
				error: "Couldn't read that image. It may be corrupted.",
			});
		}
	}

	function handleFilesAdded(_items: FileUploadItem[], files: File[]) {
		const file = files[0];
		if (file) stageUpload(file).catch(() => undefined);
	}

	async function handleConfirmUpload() {
		if (pending?.status !== "ready" || !pending.dataUrl) return;
		const snapshot = pending;
		const dataUrl = snapshot.dataUrl;
		if (!dataUrl) return;
		const previousCustomId = customWallpaper?.id ?? null;
		setPending({ ...snapshot, status: "confirming" });
		let savedId: string | null = null;

		try {
			savedId = await saveBackgroundImage(dataUrl);
			commitCustomWallpaper({ id: savedId, name: snapshot.name });
			// Keep the previous blob until the new slot is durably referenced by
			// settings, so a close during replacement cannot strand the state.
			await flushPersist();
			setCustomPreview(dataUrl);
			clearPending();
			if (previousCustomId && previousCustomId !== savedId) {
				try {
					await deleteBackgroundImage(previousCustomId);
				} catch {
					console.warn("[wallpaper] Previous custom image cleanup failed");
				}
			}
			toast.success(
				previousCustomId
					? "Custom wallpaper updated"
					: "Custom wallpaper added",
			);
		} catch {
			clearBackgroundPreview();
			if (savedId) {
				await deleteBackgroundImage(savedId).catch(() => undefined);
			}
			setPending({
				...snapshot,
				status: "error",
				error: "Couldn't save that image. Try again.",
			});
		}
	}

	async function handleDeleteCustomImage() {
		const id = customWallpaper?.id;
		if (!id) return;
		try {
			await deleteBackgroundImage(id);
			removeCustomWallpaper(id);
			setCustomPreview(null);
			toast.success("Custom wallpaper removed");
		} catch {
			toast.error("Couldn't remove custom wallpaper");
		}
	}

	const customSelected =
		!pending &&
		customWallpaper !== null &&
		bg.type === "image" &&
		bg.imageId === customWallpaper.id;
	const customTileHasPencil = customWallpaper !== null && !pending;
	const pexelsSelected = bg.type === "pexels";

	return (
		<div className={SETTINGS_PAGE} data-settings-wallpaper-page="true">
			<SectionCard>
				<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-2.5">
					<div
						className={cn(
							WALLPAPER_TILE,
							customSelected || pending
								? TILE_SELECTED
								: "hover:brightness-105",
						)}
						data-wallpaper-tile="custom-image"
						data-wallpaper-upload="true"
					>
						{customWallpaper && !pending ? (
							<>
								<button
									type="button"
									onClick={handleSelectCustom}
									aria-label={
										customSelected
											? "Use custom wallpaper (currently active)"
											: "Use custom wallpaper"
									}
									aria-pressed={customSelected}
									className={cn(
										"group/custom absolute inset-0 z-0 flex flex-col justify-end text-left focus-visible:outline-none",
										SETTINGS_FOCUS_RING,
									)}
								>
									<CustomWallpaperSlotContent
										customWallpaper={customWallpaper}
										customPreview={customPreview}
										pending={null}
										interactionHint="Use custom wallpaper"
									/>
								</button>

								<FileUpload
									value={[]}
									onValueChange={() => undefined}
									accept={UPLOAD_ACCEPT}
									multiple={false}
									maxFiles={1}
									title="Replace custom wallpaper"
									dropzoneAriaLabel="Replace custom wallpaper"
									browseLabel=""
									onFilesAdded={handleFilesAdded}
									dropzoneContent={
										<span className="grid size-full place-items-center">
											<Icon name="pencil" size={12} aria-hidden="true" />
										</span>
									}
									className="absolute top-2 right-2 z-30 size-5 space-y-0"
									classNames={{
										root: "absolute top-2 right-2 size-5 space-y-0",
										dropzone:
											"absolute inset-0 size-5 min-h-0 !rounded-full ![corner-shape:round] border border-white/20 bg-black/50 p-0 text-white shadow-sm hover:border-white/30 hover:bg-black/65 active:scale-95 dark:border-white/20 dark:bg-black/50 [--squircle-r:999px]",
										queue: "hidden",
									}}
								/>
							</>
						) : (
							<FileUpload
								value={[]}
								onValueChange={() => undefined}
								accept={UPLOAD_ACCEPT}
								multiple={false}
								maxFiles={1}
								disabled={pending?.status === "confirming"}
								title={
									customWallpaper
										? "Replace custom wallpaper"
										: "Add a custom wallpaper"
								}
								dropzoneAriaLabel={
									customWallpaper
										? "Replace custom wallpaper"
										: "Add a custom wallpaper"
								}
								browseLabel=""
								onFilesAdded={handleFilesAdded}
								dropzoneContent={
									<CustomWallpaperSlotContent
										customWallpaper={customWallpaper}
										customPreview={customPreview}
										pending={pending}
									/>
								}
								className="absolute inset-0 z-0 h-full w-full space-y-0"
								classNames={{
									root: "absolute inset-0 h-full w-full space-y-0",
									dropzone:
										"absolute inset-0 h-full min-h-0 w-full flex-col items-center justify-center gap-0 rounded-none border-0 bg-transparent p-0 text-center shadow-none hover:border-transparent hover:bg-black/[0.04] active:scale-100 data-[dragging=true]:border-transparent data-[dragging=true]:bg-black/[0.08] dark:hover:bg-white/[0.05] dark:data-[dragging=true]:bg-white/[0.1]",
									queue: "hidden",
								}}
							/>
						)}

						{customSelected ? (
							<span
								className={cn(
									"pointer-events-none absolute top-2 z-20 flex items-center justify-center rounded-full bg-[var(--ktab-accent)] text-[var(--ktab-accent-foreground)] shadow-sm",
									customTileHasPencil ? "right-9 size-5" : "right-2 size-5",
								)}
							>
								<Icon
									name="check"
									size={12}
									strokeWidth={3}
									aria-hidden="true"
								/>
							</span>
						) : null}

						{pending && pending.status !== "confirming" ? (
							<button
								type="button"
								onClick={clearPending}
								aria-label={`Cancel ${pending.name} upload`}
								className={cn(
									"absolute top-2 right-2 z-30 inline-flex size-7 items-center justify-center rounded-full bg-black/50 text-white/85 shadow-sm transition-colors hover:bg-black/75 hover:text-white",
									SETTINGS_FOCUS_RING,
								)}
							>
								<Icon name="x" size={13} aria-hidden="true" />
							</button>
						) : null}

						{pending?.status === "ready" ? (
							<div className="absolute inset-x-2 bottom-2 z-30">
								<SettingsAction
									tone="primary"
									onClick={handleConfirmUpload}
									className="h-7 w-full px-2 text-[11px]"
								>
									Confirm
								</SettingsAction>
							</div>
						) : null}

						{customWallpaper && !customSelected && !pending ? (
							<button
								type="button"
								onClick={handleDeleteCustomImage}
								aria-label="Delete custom wallpaper"
								title="Delete custom wallpaper"
								className={cn(
									"absolute top-2 right-11 z-20 inline-flex size-7 items-center justify-center rounded-full bg-black/50 text-white/85 opacity-0 shadow-sm transition-[background-color,color,opacity] hover:bg-black/75 hover:text-white focus-visible:opacity-100 group-hover:opacity-100",
									SETTINGS_FOCUS_RING,
								)}
							>
								<Icon
									name="trash"
									size={13}
									strokeWidth={2}
									aria-hidden="true"
								/>
							</button>
						) : null}
					</div>

					<PexelsSourceTile selected={pexelsSelected} onOpen={onOpenPexels} />

					{libraryItems.map((item) => (
						<WallpaperTile
							key={`${item.kind}-${item.id}`}
							item={item}
							selected={isSelected(item)}
							onSelect={handleSelect}
							onColorChange={handleSolidColor}
						/>
					))}
				</div>
			</SectionCard>

			{/* Solid colour has no row of its own: the library tile IS the control
			(see WallpaperTile), so a picker here would set the same value twice. */}
		</div>
	);
}
