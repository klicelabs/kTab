import { Input } from "@klice-start/ui/components/input";
import { Icon } from "@klice-start/ui/icons/icon";
import { KliceShape } from "@klice-start/ui/lib/shapes";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	SETTINGS_ACTION_PRIMARY,
	SETTINGS_FOCUS_RING,
	SETTINGS_INPUT,
} from "../../src/components/newtab/settings/shared/settings-tokens";
import { ACCENT_COLORS } from "../../src/lib/accent";
import { findBookmarkInFolder } from "../../src/lib/bookmark-match";
import { ext } from "../../src/lib/extension-api";
import { flattenForPicker } from "../../src/lib/folder-tree";
import {
	PENDING_SAVE_KEY,
	PENDING_SAVE_QUERY_PARAM,
	type PendingSave,
	parsePendingSave,
	pendingSaveId,
	pendingSaveThumbId,
} from "../../src/lib/pending-save";
import { flushPersist } from "../../src/lib/storage";
import { faviconUrl } from "../../src/lib/url";
import { cn } from "../../src/lib/utils";
import { useImageStore } from "../../src/stores/image-store";
import { useSetupStore } from "../../src/stores/setup-store";

type SaveState = "idle" | "saving" | "saved" | "updated" | "error";
type PendingState =
	| "loading"
	| "ready"
	| "saving"
	| "saved"
	| "cancelled"
	| "stale"
	| "error";

const pendingSaveQuery =
	typeof window === "undefined"
		? null
		: new URLSearchParams(window.location.search).get(PENDING_SAVE_QUERY_PARAM);

const FIELD_LABEL =
	"text-[11px] font-medium text-neutral-500 dark:text-neutral-400";
const FIELD_INPUT = cn("h-9 text-[13px]", SETTINGS_INPUT, SETTINGS_FOCUS_RING);
const FIELD_SELECT = cn(
	KliceShape.control,
	"h-9 w-full appearance-none border-0 bg-neutral-900/[0.05] px-3 pr-8 text-[13px] text-neutral-900 shadow-none outline-none transition-[background-color,box-shadow] duration-150 hover:bg-neutral-900/[0.08] dark:bg-white/[0.06] dark:text-neutral-100 dark:hover:bg-white/[0.09]",
	SETTINGS_FOCUS_RING,
);
const PRIMARY_ACTION = cn(
	KliceShape.control,
	SETTINGS_ACTION_PRIMARY,
	SETTINGS_FOCUS_RING,
	"h-9 w-full text-[13px] accent-action-shadow",
);
const QUIET_ACTION =
	"text-[12px] font-medium text-neutral-500 transition-colors duration-150 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100";

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

async function clearPendingOperation(
	expectedId: string,
	deleteThumb: boolean,
	deleteThumbnail: (id: string) => Promise<void>,
): Promise<void> {
	if (!expectedId) return;
	const data = await ext.storage.local.get(PENDING_SAVE_KEY);
	const raw = data[PENDING_SAVE_KEY];
	if (pendingSaveId(raw) !== expectedId) return;
	const thumbId = deleteThumb ? pendingSaveThumbId(raw) : null;
	await ext.storage.local.remove(PENDING_SAVE_KEY);
	if (thumbId) await deleteThumbnail(thumbId);
}

function PagePreview({
	src,
	favicon,
	title,
}: {
	src: string | null;
	favicon?: string;
	title?: string;
}) {
	return (
		<div
			className={cn(
				KliceShape.surface,
				"relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-neutral-900/[0.05] ring-1 ring-black/[0.06] ring-inset dark:bg-white/[0.05] dark:ring-white/[0.08]",
			)}
		>
			{src ? (
				<img src={src} alt="" className="h-full w-full object-cover" />
			) : favicon ? (
				<img
					src={favicon}
					alt=""
					className="size-8 rounded-[8px] object-contain opacity-80"
				/>
			) : (
				<span className="font-semibold text-2xl text-neutral-400 dark:text-neutral-500">
					{(title || "?").trim().charAt(0).toUpperCase() || "?"}
				</span>
			)}
		</div>
	);
}

function Chevron() {
	return (
		<Icon
			name="chevron-down"
			size={14}
			aria-hidden="true"
			className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-neutral-400 dark:text-neutral-500"
		/>
	);
}

export default function App() {
	const isPendingFlow = pendingSaveQuery !== null;
	const pendingId = pendingSaveQuery ?? "";
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [blocked, setBlocked] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [tabInfo, setTabInfo] = useState<{
		title: string;
		url: string;
		favicon: string;
	} | null>(null);
	const [titleValue, setTitleValue] = useState("");
	const [pendingState, setPendingState] = useState<PendingState>(
		isPendingFlow ? "loading" : "ready",
	);
	const [pendingRecord, setPendingRecord] = useState<PendingSave | null>(null);
	const [pendingThumbId, setPendingThumbId] = useState<string | null>(null);
	const [newFolderName, setNewFolderName] = useState("");
	const [pendingNameError, setPendingNameError] = useState(false);
	const [parentFolderId, setParentFolderId] = useState<string | null>(null);
	const [hasHydrated, setHasHydrated] = useState(() =>
		useSetupStore.persist.hasHydrated(),
	);
	const titleRef = useRef<HTMLInputElement>(null);
	const pendingNameRef = useRef<HTMLInputElement>(null);

	const folders = useSetupStore((s) => s.folders);
	const activeFolderId = useSetupStore((s) => s.activeFolderId);
	const colorScheme = useSetupStore((s) => s.settings.colorScheme ?? "auto");
	const accentColor = useSetupStore((s) => s.settings.accentColor ?? "blue");
	const cornerScale = useSetupStore((s) => s.settings.cornerScale ?? "soft");
	const saveThumbnail = useImageStore((s) => s.saveThumbnail);
	const getThumbnail = useImageStore((s) => s.getThumbnail);
	const deleteThumbnail = useImageStore((s) => s.deleteThumbnail);

	// The popup is product chrome: it follows the app's theme, accent and
	// corner scale instead of keeping its own hardcoded palette.
	useEffect(() => {
		const root = document.documentElement;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark =
				colorScheme === "dark" || (colorScheme === "auto" && media.matches);
			root.classList.toggle("dark", dark);
			root.classList.toggle("light", !dark);
			root.style.colorScheme = dark ? "dark" : "light";
			root.dataset.kliceCorner = cornerScale;
			const accent = ACCENT_COLORS[accentColor] ?? ACCENT_COLORS.blue;
			root.style.setProperty(
				"--klice-accent",
				dark ? accent.dark : accent.light,
			);
			root.style.setProperty("--klice-accent-foreground", accent.foreground);
			root.style.setProperty("--klice-accent-rgb", accent.rgb);
		};
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [accentColor, colorScheme, cornerScale]);

	useEffect(() => {
		if (useSetupStore.persist.hasHydrated()) {
			setHasHydrated(true);
			return;
		}
		return useSetupStore.persist.onFinishHydration(() => setHasHydrated(true));
	}, []);

	const [folderId, setFolderId] = useState(activeFolderId);
	// The picker mounts pre-hydration with the store default. Sync the
	// hydrated activeFolderId until the user touches the picker (H13).
	const folderTouchedRef = useRef(false);
	const folderOptions = useMemo(() => flattenForPicker(folders), [folders]);

	useEffect(() => {
		if (!folderTouchedRef.current) setFolderId(activeFolderId);
	}, [activeFolderId]);

	useEffect(() => {
		if (isPendingFlow) {
			let cancelled = false;
			(async () => {
				if (!pendingId) {
					setPendingState("stale");
					return;
				}
				try {
					const data = await ext.storage.local.get(PENDING_SAVE_KEY);
					const record = parsePendingSave(data[PENDING_SAVE_KEY], pendingId);
					if (!record) {
						await clearPendingOperation(pendingId, true, deleteThumbnail).catch(
							() => undefined,
						);
						if (!cancelled) setPendingState("stale");
						return;
					}
					let resolvedThumbId = record.thumbId;
					if (record.thumbId) {
						try {
							const image = await getThumbnail(record.thumbId);
							if (image) setPreviewUrl(image);
							else resolvedThumbId = null;
						} catch {
							resolvedThumbId = null;
						}
					}
					if (cancelled) return;
					setPendingRecord(record);
					setPendingThumbId(resolvedThumbId);
					setPendingState("ready");
				} catch {
					await clearPendingOperation(pendingId, true, deleteThumbnail).catch(
						() => undefined,
					);
					if (!cancelled) setPendingState("error");
				}
			})();
			return () => {
				cancelled = true;
			};
		}

		let cancelled = false;
		(async () => {
			const [tab] = await ext.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (cancelled) return;
			if (!tab?.url || !/^https?:/.test(tab.url)) {
				setBlocked(true);
				return;
			}
			setTabInfo({
				title: tab.title || tab.url,
				url: tab.url,
				favicon: tab.favIconUrl || "",
			});
			try {
				const dataUrl =
					tab.windowId !== undefined
						? await ext.tabs.captureVisibleTab(tab.windowId, {
								format: "jpeg",
								quality: 80,
							})
						: await ext.tabs.captureVisibleTab({
								format: "jpeg",
								quality: 80,
							});
				if (!cancelled) setPreviewUrl(dataUrl);
			} catch {
				// Preview is optional.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [deleteThumbnail, getThumbnail, isPendingFlow, pendingId]);

	useEffect(() => {
		if (!isPendingFlow || pendingState !== "ready") return;
		requestAnimationFrame(() => pendingNameRef.current?.focus());
	}, [isPendingFlow, pendingState]);

	useEffect(() => {
		if (isPendingFlow || !tabInfo) return;
		setTitleValue(tabInfo.title);
		const input = titleRef.current;
		if (!input) return;
		input.focus();
		input.select();
	}, [isPendingFlow, tabInfo]);

	async function handlePendingCancel() {
		if (!pendingId || pendingState === "saving") return;
		await clearPendingOperation(pendingId, true, deleteThumbnail).catch(
			() => undefined,
		);
		setPendingState("cancelled");
		setTimeout(() => window.close(), 250);
	}

	async function handlePendingCreate(event?: FormEvent) {
		event?.preventDefault();
		if (!hasHydrated || !pendingRecord || pendingState !== "ready") return;
		const name = newFolderName.trim();
		if (!name) {
			setPendingNameError(true);
			return;
		}
		setPendingNameError(false);

		setPendingState("saving");
		// Snapshot the ids created by this mutation (+ the thumbnail they
		// reference) so a flushPersist failure can roll the commit back.
		// Ordering mirrors the wallpaper pane: save → commit → flush →
		// cleanup-previous (M19).
		let createdFolderId: string | null = null;
		let createdCardId: string | null = null;
		const thumbSnapshot = pendingThumbId;
		try {
			const data = await ext.storage.local.get(PENDING_SAVE_KEY);
			const current = parsePendingSave(data[PENDING_SAVE_KEY], pendingId);
			if (!current) throw new Error("Pending save expired");

			const setup = useSetupStore.getState();
			const parentId =
				parentFolderId &&
				setup.folders.some((folder) => folder.id === parentFolderId)
					? parentFolderId
					: null;
			createdFolderId = setup.addFolder(name, parentId);
			createdCardId = setup.addCard({
				folderId: createdFolderId,
				title: current.title,
				url: current.url,
				favicon: current.favicon || faviconUrl(current.url),
				thumbId: pendingThumbId,
			});
			await flushPersist();
			await clearPendingOperation(pendingId, false, deleteThumbnail);
			setPendingState("saved");
			setTimeout(() => window.close(), 600);
		} catch {
			if (createdFolderId) {
				useSetupStore.getState().deleteFolder(createdFolderId);
			} else if (createdCardId) {
				useSetupStore.getState().deleteCard(createdCardId);
			}
			if (thumbSnapshot) {
				await deleteThumbnail(thumbSnapshot).catch(() => undefined);
			}
			await flushPersist().catch(() => undefined);
			await clearPendingOperation(pendingId, false, deleteThumbnail).catch(
				() => undefined,
			);
			setPendingState("error");
		}
	}

	async function handleSave(event?: FormEvent) {
		event?.preventDefault();
		if (!hasHydrated || !tabInfo || saveState === "saving") return;

		setSaveState("saving");
		let thumbId: string | null = null;
		let persisted = false;
		try {
			if (previewUrl) {
				thumbId = await saveThumbnail(previewUrl);
			}

			// Re-read after the screenshot finishes: a context-menu save or a
			// second popup may have written the same URL while this popup was open.
			const store = useSetupStore.getState();
			const existing = findBookmarkInFolder(store.cards, folderId, tabInfo.url);
			const title = titleValue.trim() || tabInfo.title;
			if (existing) {
				const previousThumbId = existing.thumbId;
				const changes = {
					title,
					...(tabInfo.favicon ? { favicon: tabInfo.favicon } : {}),
					...(thumbId ? { thumbId } : {}),
				};
				store.updateCard(existing.id, changes, { history: true });
				await flushPersist();
				persisted = true;
				if (thumbId && previousThumbId && previousThumbId !== thumbId) {
					const stillReferenced = useSetupStore
						.getState()
						.cards.some((card) => card.thumbId === previousThumbId);
					if (!stillReferenced) {
						await deleteThumbnail(previousThumbId).catch(() => undefined);
					}
				}
				setSaveState("updated");
			} else {
				store.addCard({
					folderId,
					title,
					url: tabInfo.url,
					favicon: tabInfo.favicon || faviconUrl(tabInfo.url),
					thumbId,
				});
				await flushPersist();
				persisted = true;
				setSaveState("saved");
			}
			setTimeout(() => window.close(), 600);
		} catch {
			if (!persisted && thumbId) {
				await deleteThumbnail(thumbId).catch(() => undefined);
			}
			setSaveState("error");
		}
	}

	const shell =
		"w-[320px] select-none bg-white font-sans text-[13px] text-neutral-900 antialiased dark:bg-[#1d1d1d] dark:text-neutral-100";

	if (isPendingFlow) {
		const pendingFormVisible =
			pendingRecord && (pendingState === "ready" || pendingState === "saving");
		return (
			<div className={shell}>
				<div className="p-3">
					<header className="mb-2.5 flex items-center justify-between gap-2">
						<h1 className="font-semibold text-[13px] tracking-[-0.01em]">
							New folder &amp; save
						</h1>
						<button
							type="button"
							onClick={handlePendingCancel}
							className={QUIET_ACTION}
						>
							Cancel
						</button>
					</header>

					{pendingState === "loading" && (
						<div className="flex h-[188px] flex-col items-center justify-center gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
							<Icon name="loader" size={14} className="animate-spin" />
							Preparing save…
						</div>
					)}
					{(pendingState === "stale" || pendingState === "cancelled") && (
						<div className="flex h-[188px] flex-col items-center justify-center gap-2 text-center text-[12px] text-neutral-500 dark:text-neutral-400">
							<Icon name="alert" size={16} className="opacity-60" />
							{pendingState === "cancelled"
								? "Save cancelled."
								: "This save request has expired."}
						</div>
					)}
					{pendingState === "error" && (
						<div
							role="alert"
							className="flex h-[188px] flex-col items-center justify-center gap-2 text-center text-[12px] text-red-600 dark:text-red-400"
						>
							<Icon name="alert" size={16} className="opacity-80" />
							Could not complete the save.
						</div>
					)}
					{pendingState === "saved" && (
						<div className="flex h-[188px] flex-col items-center justify-center gap-2 text-center">
							<span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
								<Icon name="check" size={16} />
							</span>
							<p className="font-medium text-[12px] text-neutral-700 dark:text-neutral-200">
								Folder created and page saved
							</p>
						</div>
					)}
					{pendingFormVisible && pendingRecord && (
						<>
							<PagePreview
								src={previewUrl}
								favicon={pendingRecord.favicon}
								title={pendingRecord.title}
							/>
							<div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
								{pendingRecord.favicon && (
									<img
										src={pendingRecord.favicon}
										alt=""
										className="size-3.5 shrink-0 rounded-[3px] object-contain"
									/>
								)}
								<span className="truncate">{pendingRecord.title}</span>
							</div>

							<form
								className="mt-2.5 grid gap-2.5"
								onSubmit={handlePendingCreate}
							>
								<div className="grid gap-1.5">
									<label htmlFor="new-folder-name" className={FIELD_LABEL}>
										Folder name
									</label>
									<Input
										id="new-folder-name"
										ref={pendingNameRef}
										value={newFolderName}
										onChange={(event) => {
											setNewFolderName(event.target.value);
											setPendingNameError(false);
										}}
										placeholder="e.g. Design references"
										autoComplete="off"
										aria-invalid={pendingNameError}
										className={FIELD_INPUT}
									/>
									{pendingNameError && (
										<p className="text-[11px] text-red-600 dark:text-red-400">
											Folder name is required.
										</p>
									)}
								</div>
								<div className="grid gap-1.5">
									<label htmlFor="parent-folder-select" className={FIELD_LABEL}>
										Parent folder{" "}
										<span className="font-normal text-neutral-400 dark:text-neutral-500">
											(optional)
										</span>
									</label>
									<div className="relative">
										<select
											id="parent-folder-select"
											value={parentFolderId ?? ""}
											onChange={(event) =>
												setParentFolderId(event.target.value || null)
											}
											className={FIELD_SELECT}
										>
											<option
												value=""
												className="bg-white text-neutral-900 dark:bg-[#1d1d1d] dark:text-neutral-100"
											>
												Top level
											</option>
											{folderOptions.map((opt) => (
												<option
													key={opt.folder.id}
													value={opt.folder.id}
													className="bg-white text-neutral-900 dark:bg-[#1d1d1d] dark:text-neutral-100"
												>
													{opt.depth > 0
														? "· ".repeat(opt.depth) + opt.folder.name
														: opt.folder.name}
												</option>
											))}
										</select>
										<Chevron />
									</div>
								</div>
								<button
									type="submit"
									disabled={!hasHydrated || pendingState === "saving"}
									className={PRIMARY_ACTION}
								>
									{pendingState === "saving"
										? "Creating…"
										: "Create folder & save"}
								</button>
							</form>
						</>
					)}
				</div>
			</div>
		);
	}

	const statusText =
		saveState === "saving"
			? "Saving…"
			: saveState === "saved"
				? "Saved to Klice Start"
				: saveState === "updated"
					? "Bookmark updated"
					: saveState === "error"
						? "Could not save this page."
						: "";
	const success = saveState === "saved" || saveState === "updated";

	return (
		<div className={shell}>
			<div className="p-3">
				<header className="mb-2.5 flex items-center justify-between gap-2">
					<h1 className="shrink-0 font-semibold text-[13px] tracking-[-0.01em]">
						Save to Klice Start
					</h1>
					{tabInfo && (
						<span className="flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
							{tabInfo.favicon && (
								<img
									src={tabInfo.favicon}
									alt=""
									className="size-3.5 shrink-0 rounded-[3px] object-contain"
								/>
							)}
							<span className="truncate">{hostOf(tabInfo.url)}</span>
						</span>
					)}
				</header>

				{blocked ? (
					<div className="flex h-[148px] flex-col items-center justify-center gap-2 text-center text-[12px] text-neutral-500 dark:text-neutral-400">
						<Icon name="alert" size={16} className="opacity-60" />
						Cannot save this page. Open a regular web page to bookmark it.
					</div>
				) : (
					<>
						<PagePreview
							src={previewUrl}
							favicon={tabInfo?.favicon}
							title={tabInfo?.title}
						/>
						<form className="mt-2.5 grid gap-2.5" onSubmit={handleSave}>
							<div className="grid gap-1.5">
								<label htmlFor="tab-title-input" className={FIELD_LABEL}>
									Title
								</label>
								<Input
									id="tab-title-input"
									ref={titleRef}
									type="text"
									value={titleValue}
									onChange={(event) => {
										setTitleValue(event.target.value);
										if (saveState !== "idle") setSaveState("idle");
									}}
									placeholder="Page title"
									autoComplete="off"
									className={FIELD_INPUT}
								/>
							</div>

							<div className="grid gap-1.5">
								<label htmlFor="folder-select-input" className={FIELD_LABEL}>
									Folder
								</label>
								<div className="relative">
									<select
										id="folder-select-input"
										value={folderId}
										onChange={(event) => {
											folderTouchedRef.current = true;
											setFolderId(event.target.value);
											if (saveState !== "idle") setSaveState("idle");
										}}
										className={FIELD_SELECT}
									>
										{folderOptions.map((opt) => (
											<option
												key={opt.folder.id}
												value={opt.folder.id}
												className="bg-white text-neutral-900 dark:bg-[#1d1d1d] dark:text-neutral-100"
											>
												{opt.depth > 0
													? "· ".repeat(opt.depth) + opt.folder.name
													: opt.folder.name}
											</option>
										))}
									</select>
									<Chevron />
								</div>
							</div>

							<button
								type="submit"
								disabled={
									!hasHydrated ||
									saveState === "saving" ||
									saveState === "saved" ||
									saveState === "updated"
								}
								className={PRIMARY_ACTION}
							>
								{success && <Icon name="check" size={14} />}
								{saveState === "saving"
									? "Saving…"
									: saveState === "saved"
										? "Saved"
										: saveState === "updated"
											? "Updated"
											: "Save page"}
							</button>

							{statusText && (
								<p
									aria-live="polite"
									className={cn(
										"text-center font-medium text-[11px]",
										saveState === "error"
											? "text-red-600 dark:text-red-400"
											: success
												? "text-emerald-600 dark:text-emerald-400"
												: "text-neutral-500 dark:text-neutral-400",
									)}
								>
									{statusText}
								</p>
							)}
						</form>
					</>
				)}
			</div>
		</div>
	);
}
