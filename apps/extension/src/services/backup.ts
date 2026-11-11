import {
	type BackupPreflight,
	type ImageBudget,
	isRecord,
	MAX_BACKUP_IMAGE_ENTRIES,
	MAX_BACKUP_INPUT_LENGTH,
	MAX_BACKUP_TOTAL_IMAGE_BYTES,
	preflightBackup,
	preflightImageMap,
	validateSetupShape,
} from "../lib/backup-format";
import { putImages, STORE_BG, STORE_THUMBS } from "../lib/idb";
import { cleanupLegacyCustomWallpaperImages } from "../lib/storage";
import { useImageStore } from "../stores/image-store";
import { useSetupStore } from "../stores/setup-store";
import type { Setup } from "../types";

export type { BackupPreflight };
export { preflightBackup };

export interface BackupPayload extends Setup {
	thumbnails: Record<string, string>;
	backgrounds: Record<string, string>;
}

export async function buildBackup(): Promise<BackupPayload> {
	const state = useSetupStore.getState();
	const images = useImageStore.getState();

	const thumbnails: Record<string, string> = {};
	const thumbIds = new Set<string>();
	for (const card of state.cards) {
		if (card.thumbId) thumbIds.add(card.thumbId);
	}
	const thumbnailEntries = await Promise.all(
		[...thumbIds].map(
			async (id) => [id, await images.getThumbnail(id)] as const,
		),
	);
	for (const [id, dataUrl] of thumbnailEntries) {
		if (dataUrl) thumbnails[id] = dataUrl;
	}

	const backgrounds: Record<string, string> = {};
	const bg = state.settings.background;
	const backgroundIds = new Set<string>();
	if (bg.type === "image" && bg.imageId) backgroundIds.add(bg.imageId);
	if (bg.type === "pexels" && bg.pexelsImageId)
		backgroundIds.add(bg.pexelsImageId);
	if (bg.customWallpaper?.id) backgroundIds.add(bg.customWallpaper.id);
	const backgroundEntries = await Promise.all(
		[...backgroundIds].map(
			async (id) => [id, await images.getBackgroundImage(id)] as const,
		),
	);
	for (const [id, dataUrl] of backgroundEntries) {
		if (dataUrl) backgrounds[id] = dataUrl;
	}

	const payload: BackupPayload = {
		folders: state.folders,
		cards: state.cards,
		activeFolderId: state.activeFolderId,
		settings: state.settings,
		itemOrder: state.itemOrder,
		thumbnails,
		backgrounds,
	};
	assertBackupBudget(payload);
	return payload;
}

function assertBackupBudget(payload: BackupPayload): void {
	const imageValues = [
		...Object.values(payload.thumbnails),
		...Object.values(payload.backgrounds),
	];
	if (imageValues.length > MAX_BACKUP_IMAGE_ENTRIES) {
		throw new Error(
			`Backup exceeds maximum image entries (${MAX_BACKUP_IMAGE_ENTRIES}).`,
		);
	}
	const imageBytes = imageValues.reduce(
		(total, value) => total + value.length,
		0,
	);
	if (imageBytes > MAX_BACKUP_TOTAL_IMAGE_BYTES) {
		throw new Error(
			`Backup exceeds maximum total image size (${MAX_BACKUP_TOTAL_IMAGE_BYTES / 1024 / 1024} MB).`,
		);
	}
	const serialized = JSON.stringify(payload);
	if (serialized.length > MAX_BACKUP_INPUT_LENGTH) {
		throw new Error(
			`Backup exceeds maximum input length (${MAX_BACKUP_INPUT_LENGTH} characters).`,
		);
	}
}

/** Trigger a download of the current setup as a JSON file. */
export async function exportBackup(): Promise<void> {
	const payload = await buildBackup();
	const blob = new Blob([JSON.stringify(payload, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "ktab-backup.json";
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Restore a backup from raw file text. Images are written to IDB first, then
 * state is replaced (normalizeState inside replaceSetup guards the shape).
 * Throws on malformed JSON so the caller can surface an error.
 */
export async function importBackup(fileText: string): Promise<void> {
	if (typeof fileText !== "string") {
		throw new Error("Backup must be provided as text.");
	}
	if (fileText.length > MAX_BACKUP_INPUT_LENGTH) {
		throw new Error(
			`Backup exceeds the maximum input length (${MAX_BACKUP_INPUT_LENGTH} characters).`,
		);
	}

	const parsed: unknown = (() => {
		try {
			return JSON.parse(fileText);
		} catch {
			throw new Error("That file is not a valid kTab backup.");
		}
	})();
	if (!isRecord(parsed)) {
		throw new Error("That file is not a valid kTab backup.");
	}

	const setup = validateSetupShape(parsed);
	const budget: ImageBudget = { entries: 0, bytes: 0 };
	const thumbnails = preflightImageMap(parsed.thumbnails, "thumbnails", budget);
	const backgrounds = preflightImageMap(
		parsed.backgrounds,
		"backgrounds",
		budget,
	);

	// All shape, URL, count, and payload checks complete before the first write.
	await putImages([
		...thumbnails.map((image) => ({
			store: STORE_THUMBS as typeof STORE_THUMBS,
			key: image.id,
			value: image.dataUrl,
		})),
		...backgrounds.map((image) => ({
			store: STORE_BG as typeof STORE_BG,
			key: image.id,
			value: image.dataUrl,
		})),
	]);

	await cleanupLegacyCustomWallpaperImages(setup);
	useSetupStore.getState().replaceSetup(setup);
}
