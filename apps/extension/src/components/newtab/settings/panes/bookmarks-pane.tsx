import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ktab/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ktab/ui/components/dropdown-menu";
import { Input } from "@ktab/ui/components/input";
import { Switch } from "@ktab/ui/components/switch";
import { Icon } from "@ktab/ui/icons/icon";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { findBookmarkInFolder } from "../../../../lib/bookmark-match";
import { summarizeBookmarkTree } from "../../../../lib/bookmark-merge";
import { SETTINGS_SCOPE_CLASS } from "../../../../lib/context-scope";
import { extApi } from "../../../../lib/extension-api";
import {
	getBreadcrumb,
	getDescendantIds,
	getSubtreeIds,
	wouldCreateCycle,
} from "../../../../lib/folder-tree";
import {
	hasThumbnailCapturePermission,
	requestThumbnailCapturePermission,
} from "../../../../lib/thumbnail-permission";
import { REFRESH_STRINGS } from "../../../../lib/thumbnail-refresh";
import { requestMissingRefresh } from "../../../../lib/thumbnail-refresh-client";
import {
	deriveTitleFromUrl,
	faviconUrl,
	isValidUrl,
	normalizeUrl,
} from "../../../../lib/url";
import { cn } from "../../../../lib/utils";
import {
	exportBackup,
	importBackup,
	preflightBackup,
} from "../../../../services/backup";
import {
	type BookmarkTreeFolder,
	exportBookmarksHtml,
	mergeBookmarkTree,
	parseNetscapeBookmarkFile,
	readBrowserBookmarks,
	replaceBookmarkLibrary,
} from "../../../../services/bookmarks-html";
import { useSetupStore } from "../../../../stores/setup-store";
import type { Card, TitleSource } from "../../../../types";
import { FolderTreePicker } from "../../../shared/folder-tree-picker";
import { useAppearance } from "../../appearance-provider";
import { SectionCard } from "../shared/section-card";
import { SelectRow } from "../shared/select-row";
import { SettingRow } from "../shared/setting-row";
import { SettingsAction, SettingsIconButton } from "../shared/settings-action";
import { SettingsExpandable } from "../shared/settings-expandable";
import { SettingsEmpty } from "../shared/settings-feedback";
import {
	SETTINGS_CONTROL_WIDTH,
	SETTINGS_FOCUS_RING,
	SETTINGS_ICON_BUTTON,
	SETTINGS_INPUT,
	SETTINGS_PAGE,
	SETTINGS_RADIUS,
	SETTINGS_ROW_HOVER_WASH,
	SETTINGS_SWITCH,
} from "../shared/settings-tokens";
import { SliderRow } from "../shared/slider-row";

interface BookmarksPaneProps {
	initialAction?: {
		type: "add-link" | "edit-link" | "add-folder" | "edit-folder";
		cardId?: string;
		folderId?: string;
	};
}

const FIELD_LABEL =
	"text-[12px] font-medium leading-[1.35] text-neutral-600 dark:text-neutral-300";

/**
 * Thumbnail capture preferences — the "how previews are captured" block of
 * the Manage bookmarks workflow (block 3 below). This is the single home for
 * these settings; the root Preferences view does not repeat them.
 */
function BookmarkPreviewSettings() {
	const thumbnailCapture = useSetupStore((s) => s.settings.thumbnailCapture);
	const updateThumbnailCapture = useSetupStore((s) => s.updateThumbnailCapture);
	const missingCount = useSetupStore(
		(s) => s.cards.filter((card) => !card.thumbId).length,
	);
	const [capturePermission, setCapturePermission] = useState<
		"checking" | "granted" | "missing"
	>("checking");

	useEffect(() => {
		let mounted = true;
		const refresh = () => {
			void hasThumbnailCapturePermission()
				.then((granted) => {
					if (mounted) setCapturePermission(granted ? "granted" : "missing");
				})
				.catch(() => {
					if (mounted) setCapturePermission("missing");
				});
		};
		const permissions = extApi().permissions;
		permissions.onAdded.addListener(refresh);
		permissions.onRemoved.addListener(refresh);
		refresh();
		return () => {
			mounted = false;
			permissions.onAdded.removeListener(refresh);
			permissions.onRemoved.removeListener(refresh);
		};
	}, []);

	const allowCapture = async () => {
		try {
			const granted = await requestThumbnailCapturePermission();
			setCapturePermission(granted ? "granted" : "missing");
			if (!granted)
				toast.error("Site access is needed for automatic captures.");
		} catch {
			setCapturePermission("missing");
			toast.error("Could not request site access. Try again in Settings.");
		}
	};

	function handleRefreshMissing() {
		void requestMissingRefresh();
	}

	return (
		<SectionCard>
			<SettingRow
				label="Capture missing thumbnails"
				icon="camera"
				tooltip="Capture the visible page once when a bookmark has no thumbnail."
			>
				<Switch
					className={SETTINGS_SWITCH}
					aria-label="Capture missing thumbnails"
					checked={thumbnailCapture.enabled}
					onCheckedChange={(enabled: boolean) =>
						updateThumbnailCapture({ enabled })
					}
				/>
			</SettingRow>
			{thumbnailCapture.enabled && capturePermission === "missing" && (
				<SettingRow
					label="Site access required"
					icon="globe"
					tooltip="The browser requires access to all sites to capture a visited page automatically. Only bookmarked pages without a thumbnail are captured."
				>
					<SettingsAction onClick={() => void allowCapture()}>
						Allow access
					</SettingsAction>
				</SettingRow>
			)}

			<SettingsExpandable
				expanded={thumbnailCapture.enabled}
				label="Screenshot preview options"
			>
				<SliderRow
					label="Capture delay"
					icon="timer"
					value={thumbnailCapture.delayMs || 1200}
					suffix="ms"
					min={400}
					max={4000}
					step={400}
					onChange={(v) => updateThumbnailCapture({ delayMs: v })}
				/>
			</SettingsExpandable>
			<SettingRow
				label="Missing previews"
				icon="refresh"
				tooltip="Re-photograph every bookmark that has no preview yet, one at a time in inactive tabs. Some systems may briefly switch focus during each capture."
			>
				<SettingsAction
					icon="refresh"
					disabled={missingCount === 0}
					onClick={handleRefreshMissing}
				>
					{REFRESH_STRINGS.missingAction(missingCount)}
				</SettingsAction>
			</SettingRow>
		</SectionCard>
	);
}

/**
 * Bookmarks is the one page that manages real content, so it is organised as
 * a small workflow rather than a list of switches:
 *
 *   1. which folder you are working in (and its few, occasional actions)
 *   2. the links in that folder (add, edit, remove)
 *   3. how previews are captured
 *   4. how content moves in and out
 *
 * Folder actions and per-row actions are disclosed progressively — behind one
 * menu and behind row hover — so the page opens on the two things that matter:
 * the current folder, and adding a link.
 */
export function BookmarksPane({ initialAction }: BookmarksPaneProps) {
	const folders = useSetupStore((s) => s.folders);
	const cards = useSetupStore((s) => s.cards as Card[]);
	const activeFolderId = useSetupStore((s) => s.activeFolderId);

	const addCard = useSetupStore((s) => s.addCard);
	const updateCard = useSetupStore((s) => s.updateCard);
	const moveCard = useSetupStore((s) => s.moveCard);
	const deleteCard = useSetupStore((s) => s.deleteCard);
	const addFolder = useSetupStore((s) => s.addFolder);
	const updateFolder = useSetupStore((s) => s.updateFolder);
	const moveFolder = useSetupStore((s) => s.moveFolder);
	const deleteFolder = useSetupStore((s) => s.deleteFolder);
	const { isLiquid } = useAppearance();

	// Currently inspected folder in the settings pane
	const [selectedFolderId, setSelectedFolderId] =
		useState<string>(activeFolderId);

	useEffect(() => {
		if (!folders.some((f) => f.id === selectedFolderId)) {
			setSelectedFolderId(folders[0]?.id || "default");
		}
	}, [folders, selectedFolderId]);

	// Link editing / adding state
	const [isAddingLink, setIsAddingLink] = useState(false);
	const [editingCardId, setEditingCardId] = useState<string | null>(null);
	const [linkUrl, setLinkUrl] = useState("");
	const [linkTitle, setLinkTitle] = useState("");
	const [linkTitleSource, setLinkTitleSource] = useState<
		TitleSource | "inherit"
	>("inherit");
	const [linkFolderId, setLinkFolderId] = useState(selectedFolderId);
	const [titleTouched, setTitleTouched] = useState(false);

	// Folder editing / adding modal
	const [folderModalOpen, setFolderModalOpen] = useState(false);
	const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
	const [folderNameInput, setFolderNameInput] = useState("");
	const [folderParentInput, setFolderParentInput] = useState<string | null>(
		null,
	);
	const [folderError, setFolderError] = useState("");

	// Delete folder confirmation
	const [deleteConfirmFolderId, setDeleteConfirmFolderId] = useState<
		string | null
	>(null);

	// Import / Export states (results surface as toasts; only the
	// in-flight flag lives here)
	const fileRef = useRef<HTMLInputElement>(null);
	const [isProcessingIo, setIsProcessingIo] = useState(false);

	// Pending import awaiting a Keep/Replace decision. Staged only after the
	// payload parses and validates, so the dialog never opens for garbage.
	interface PendingImport {
		kind: "html" | "backup" | "browser";
		fileName: string;
		text?: string;
		tree?: {
			rootFolders: BookmarkTreeFolder[];
			rootLinks: { title: string; url: string }[];
		};
		summary: string;
		backupCounts?: { folders: number; cards: number };
	}
	const [pendingImport, setPendingImport] = useState<PendingImport | null>(
		null,
	);
	const [importWantsReplace, setImportWantsReplace] = useState(false);
	const [importConfirmReplace, setImportConfirmReplace] = useState(false);

	function closeImportDialog() {
		setPendingImport(null);
		setImportWantsReplace(false);
		setImportConfirmReplace(false);
	}

	function libraryIsEmpty(): boolean {
		const state = useSetupStore.getState();
		return state.folders.length === 0 && state.cards.length === 0;
	}

	/** Reveal imported content: jump to it unless already looking at it. */
	function revealImport(revealFolderId: string | null) {
		if (!revealFolderId) return;
		const state = useSetupStore.getState();
		if (state.activeFolderId !== revealFolderId) {
			state.setActiveFolder(revealFolderId);
		}
	}

	// Handle initial action if provided from outside
	useEffect(() => {
		if (!initialAction) return;
		if (initialAction.type === "add-link") {
			setLinkFolderId(initialAction.folderId || selectedFolderId);
			setLinkUrl("");
			setLinkTitle("");
			setLinkTitleSource("inherit");
			setTitleTouched(false);
			setEditingCardId(null);
			setIsAddingLink(true);
		} else if (initialAction.type === "edit-link" && initialAction.cardId) {
			const card = cards.find((c) => c.id === initialAction.cardId);
			if (card) {
				setEditingCardId(card.id);
				setLinkUrl(card.url);
				setLinkTitle(card.title);
				setLinkTitleSource(card.titleSource ?? "inherit");
				setLinkFolderId(card.folderId);
				setSelectedFolderId(card.folderId);
				setTitleTouched(true);
				setIsAddingLink(true);
			}
		} else if (initialAction.type === "add-folder") {
			setEditingFolderId(null);
			setFolderNameInput("");
			setFolderParentInput(initialAction.folderId || null);
			setFolderError("");
			setFolderModalOpen(true);
		} else if (initialAction.type === "edit-folder" && initialAction.folderId) {
			const folder = folders.find((f) => f.id === initialAction.folderId);
			if (folder) {
				setEditingFolderId(folder.id);
				setFolderNameInput(folder.name);
				setFolderParentInput(folder.parentId ?? null);
				setFolderError("");
				setFolderModalOpen(true);
			}
		}
	}, [initialAction, cards, folders, selectedFolderId]);

	// Filtered cards for the active selected folder
	const folderCards = useMemo(
		() =>
			cards
				.filter((c) => c.folderId === selectedFolderId)
				.sort((a, b) => a.order - b.order),
		[cards, selectedFolderId],
	);

	const selectedFolder = folders.find((f) => f.id === selectedFolderId);
	const breadcrumbs = useMemo(
		() => getBreadcrumb(folders, selectedFolderId),
		[folders, selectedFolderId],
	);
	/** Everything above the current folder — omitted at the root. */
	const parentPath = breadcrumbs
		.slice(0, -1)
		.map((crumb) => crumb.name)
		.join(" › ");

	// URL validation and duplicate detection
	const urlValidation = useMemo(() => {
		const trimmed = linkUrl.trim();
		if (!trimmed) return { status: "empty" as const, message: "" };
		if (!isValidUrl(trimmed)) {
			return {
				status: "invalid" as const,
				message: "Enter a valid web address.",
			};
		}
		const duplicate = findBookmarkInFolder(cards, linkFolderId, trimmed);
		if (duplicate && duplicate.id !== editingCardId) {
			return {
				status: editingCardId ? ("duplicate" as const) : ("existing" as const),
				message: editingCardId
					? "This link is already in that folder."
					: "Already saved here — saving will update it.",
			};
		}
		return { status: "valid" as const, message: "" };
	}, [linkUrl, linkFolderId, editingCardId, cards]);

	const derivedTitle = useMemo(() => {
		if (titleTouched && linkTitle.length > 0) return linkTitle;
		return deriveTitleFromUrl(linkUrl);
	}, [linkUrl, linkTitle, titleTouched]);

	function handleUrlChange(val: string) {
		setLinkUrl(val);
		if (!titleTouched) {
			setLinkTitle(deriveTitleFromUrl(val));
		}
	}

	function handleSaveLink(e: React.FormEvent) {
		e.preventDefault();
		if (urlValidation.status !== "valid" && urlValidation.status !== "existing")
			return;

		const normalized = normalizeUrl(linkUrl.trim());
		const finalTitle = (linkTitle.trim() || derivedTitle || normalized).trim();
		const finalFavicon = faviconUrl(normalized);

		if (editingCardId) {
			updateCard(
				editingCardId,
				{
					title: finalTitle,
					titleSource:
						linkTitleSource === "inherit" ? undefined : linkTitleSource,
					url: normalized,
					favicon: finalFavicon,
				},
				{ history: true },
			);
			const current = cards.find((c) => c.id === editingCardId);
			if (current && current.folderId !== linkFolderId) {
				moveCard(editingCardId, linkFolderId);
			}
		} else {
			const existing = findBookmarkInFolder(cards, linkFolderId, normalized);
			if (existing) {
				updateCard(
					existing.id,
					{
						title: finalTitle,
						titleSource:
							linkTitleSource === "inherit" ? undefined : linkTitleSource,
						url: normalized,
						favicon: finalFavicon,
					},
					{ history: true },
				);
			} else {
				addCard({
					folderId: linkFolderId,
					title: finalTitle,
					titleSource:
						linkTitleSource === "inherit" ? undefined : linkTitleSource,
					url: normalized,
					favicon: finalFavicon,
					thumbId: null,
				});
			}
		}

		setIsAddingLink(false);
		setEditingCardId(null);
		setLinkUrl("");
		setLinkTitle("");
		setLinkTitleSource("inherit");
		setTitleTouched(false);
	}

	function handleStartAddLink() {
		setEditingCardId(null);
		setLinkUrl("");
		setLinkTitle("");
		setLinkTitleSource("inherit");
		setTitleTouched(false);
		setLinkFolderId(selectedFolderId);
		setIsAddingLink(true);
	}

	function handleStartEditLink(card: Card) {
		setEditingCardId(card.id);
		setLinkUrl(card.url);
		setLinkTitle(card.title);
		setLinkTitleSource(card.titleSource ?? "inherit");
		setLinkFolderId(card.folderId);
		setTitleTouched(true);
		setIsAddingLink(true);
	}

	function handleCancelLinkEdit() {
		setIsAddingLink(false);
		setEditingCardId(null);
		setLinkUrl("");
		setLinkTitle("");
		setLinkTitleSource("inherit");
		setTitleTouched(false);
	}

	function handleOpenNewFolder() {
		setEditingFolderId(null);
		setFolderNameInput("");
		setFolderParentInput(selectedFolderId);
		setFolderError("");
		setFolderModalOpen(true);
	}

	function handleOpenEditFolder() {
		if (!selectedFolder) return;
		setEditingFolderId(selectedFolder.id);
		setFolderNameInput(selectedFolder.name);
		setFolderParentInput(selectedFolder.parentId ?? null);
		setFolderError("");
		setFolderModalOpen(true);
	}

	function handleSaveFolder(e: React.FormEvent) {
		e.preventDefault();
		const name = folderNameInput.trim();
		if (!name) {
			setFolderError("Enter a folder name.");
			return;
		}

		if (editingFolderId) {
			updateFolder(editingFolderId, name);
			const current = folders.find((f) => f.id === editingFolderId);
			if (
				current &&
				(current.parentId ?? null) !== (folderParentInput ?? null)
			) {
				if (!wouldCreateCycle(folders, editingFolderId, folderParentInput)) {
					moveFolder(editingFolderId, folderParentInput);
				}
			}
		} else {
			const newId = addFolder(name, folderParentInput);
			setSelectedFolderId(newId);
		}

		setFolderModalOpen(false);
		setEditingFolderId(null);
		setFolderNameInput("");
		setFolderParentInput(null);
		setFolderError("");
	}

	const rootFoldersCount = folders.filter(
		(f) => (f.parentId ?? null) === null,
	).length;
	const canDeleteCurrentFolder =
		rootFoldersCount > 1 || (selectedFolder?.parentId ?? null) !== null;

	const folderDeleteInfo = useMemo(() => {
		if (!deleteConfirmFolderId) return null;
		const target = folders.find((f) => f.id === deleteConfirmFolderId);
		if (!target) return null;
		const descendantIds = getDescendantIds(folders, deleteConfirmFolderId);
		const affectedFolderIds = new Set([
			deleteConfirmFolderId,
			...descendantIds,
		]);
		const cardCount = cards.filter((c) =>
			affectedFolderIds.has(c.folderId),
		).length;
		return {
			name: target.name,
			subfolderCount: descendantIds.length,
			cardCount,
		};
	}, [deleteConfirmFolderId, folders, cards]);

	// Import / Export Handlers.
	//
	// These are fire-and-forget actions, so their *results* surface as
	// temporary toasts. Anything that needs a decision (forms, destructive
	// confirms) stays inline — toasts never carry persistent state.
	function importedSummary(foldersCreated: number, cardsCreated: number) {
		return `Imported ${cardsCreated} link${cardsCreated === 1 ? "" : "s"} across ${foldersCreated} folder${foldersCreated === 1 ? "" : "s"}.`;
	}

	async function handleImportFromBrowser() {
		setIsProcessingIo(true);
		try {
			const browser = await readBrowserBookmarks();
			const tree = {
				rootFolders: browser.topFolders,
				rootLinks: browser.topLinks,
			};
			const summary = summarizeBookmarkTree(tree.rootFolders, tree.rootLinks);
			if (libraryIsEmpty()) {
				const result = mergeBookmarkTree(tree.rootFolders, tree.rootLinks);
				toast.success("Import completed", {
					description: importedSummary(
						result.foldersCreated,
						result.cardsCreated,
					),
				});
				revealImport(result.revealFolderId);
				return;
			}
			setPendingImport({
				kind: "browser",
				fileName: "browser bookmarks",
				tree,
				summary: summary.text,
			});
		} catch (err) {
			toast.error("Import failed", {
				description:
					err instanceof Error ? err.message : "Could not import bookmarks.",
			});
		} finally {
			setIsProcessingIo(false);
		}
	}

	/** One picker for both formats — the file CONTENT decides how it is read. */
	async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		setIsProcessingIo(true);
		try {
			const text = await file.text();
			// M7: a renamed file (HTML saved as .json or the reverse) used to
			// be routed by extension and fail with a misleading parse error.
			// JSON backups start with "{"; Netscape exports start with "<".
			// The extension only breaks ties for content matching neither.
			const head = text.trimStart().charAt(0);
			const isBackup =
				head === "{" ? true : head === "<" ? false : /\.json$/i.test(file.name);
			if (isBackup) {
				// Validate shape up front so malformed files fail here with a
				// clear message instead of opening a dialog over garbage.
				let counts: { folders: number; cards: number } | undefined;
				try {
					counts = preflightBackup(text);
				} catch (err) {
					toast.error("Restore failed", {
						description:
							err instanceof Error
								? err.message
								: "Could not restore that backup.",
					});
					return;
				}
				if (libraryIsEmpty()) {
					await importBackup(text);
					toast.success("Backup restored.");
					return;
				}
				setPendingImport({
					kind: "backup",
					fileName: file.name,
					text,
					summary: `${counts.cards} link${counts.cards === 1 ? "" : "s"} in ${counts.folders} folder${counts.folders === 1 ? "" : "s"}`,
					backupCounts: counts,
				});
				return;
			}
			let tree: {
				rootFolders: BookmarkTreeFolder[];
				rootLinks: { title: string; url: string }[];
			};
			try {
				tree = parseNetscapeBookmarkFile(text);
			} catch (err) {
				toast.error("Import failed", {
					description:
						err instanceof Error ? err.message : "Could not read that file.",
				});
				return;
			}
			if (libraryIsEmpty()) {
				const result = mergeBookmarkTree(tree.rootFolders, tree.rootLinks);
				toast.success("Import completed", {
					description: importedSummary(
						result.foldersCreated,
						result.cardsCreated,
					),
				});
				revealImport(result.revealFolderId);
				return;
			}
			setPendingImport({
				kind: "html",
				fileName: file.name,
				text,
				tree,
				summary: summarizeBookmarkTree(tree.rootFolders, tree.rootLinks).text,
			});
		} finally {
			setIsProcessingIo(false);
			e.target.value = "";
		}
	}

	/** Commit the staged import. Replace always arrives confirmed. */
	async function executePendingImport(replace: boolean) {
		const pending = pendingImport;
		if (!pending) return;
		closeImportDialog();
		setIsProcessingIo(true);
		try {
			if (pending.kind === "backup") {
				await importBackup(pending.text ?? "");
				toast.success("Backup restored.");
				return;
			}
			const tree = pending.tree;
			if (!tree) return;
			if (replace) {
				const result = replaceBookmarkLibrary(tree.rootFolders, tree.rootLinks);
				toast.success("Library replaced", {
					description: importedSummary(
						result.foldersCreated,
						result.cardsCreated,
					),
				});
				// Replace already lands on the first folder; nothing to reveal.
				return;
			}
			const result = mergeBookmarkTree(tree.rootFolders, tree.rootLinks);
			toast.success("Import completed", {
				description: importedSummary(
					result.foldersCreated,
					result.cardsCreated,
				),
			});
			revealImport(result.revealFolderId);
		} catch (err) {
			toast.error(
				pending.kind === "backup" ? "Restore failed" : "Import failed",
				{
					description:
						err instanceof Error
							? err.message
							: pending.kind === "backup"
								? "Could not restore that backup."
								: "Could not read that file.",
				},
			);
		} finally {
			setIsProcessingIo(false);
		}
	}

	async function handleExportHtml() {
		setIsProcessingIo(true);
		try {
			await exportBookmarksHtml();
			toast.success("Export completed", {
				description: "Saved bookmarks.html.",
			});
		} catch (err) {
			toast.error("Export failed", {
				description: err instanceof Error ? err.message : "Export failed.",
			});
		} finally {
			setIsProcessingIo(false);
		}
	}

	async function handleExportBackup() {
		setIsProcessingIo(true);
		try {
			await exportBackup();
			toast.success("Backup created", {
				description: "Saved a full backup with images.",
			});
		} catch (err) {
			toast.error("Backup failed", {
				description: err instanceof Error ? err.message : "Backup failed.",
			});
		} finally {
			setIsProcessingIo(false);
		}
	}

	const bookmarkCount = folderCards.length;

	return (
		<div className={SETTINGS_PAGE}>
			{/* 1 — The folder you are working in. */}
			<SectionCard>
				<SettingRow
					label="Folder"
					icon="folder"
					tooltip={parentPath ? `Inside ${parentPath}` : undefined}
				>
					<FolderTreePicker
						folders={folders}
						value={selectedFolderId}
						onChange={(id) => id && setSelectedFolderId(id)}
						allowRoot={false}
						label="Folder"
						className={cn(
							SETTINGS_CONTROL_WIDTH,
							SETTINGS_RADIUS.control,
							"h-8",
						)}
					/>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<button
									type="button"
									aria-label="Folder actions"
									className={cn(
										SETTINGS_ICON_BUTTON,
										SETTINGS_RADIUS.control,
										SETTINGS_FOCUS_RING,
									)}
								>
									<Icon name="ellipsis" size={16} aria-hidden="true" />
								</button>
							}
						/>
						<DropdownMenuContent
							align="end"
							className={cn(
								"squircle w-auto min-w-44 p-1 text-xs",
								SETTINGS_SCOPE_CLASS,
								SETTINGS_RADIUS.section,
							)}
						>
							<DropdownMenuItem
								className={cn(
									"gap-2 px-2.5 py-1.5 text-xs",
									SETTINGS_RADIUS.control,
								)}
								onClick={handleOpenNewFolder}
							>
								<Icon name="folder-plus" size={14} aria-hidden="true" />
								New folder
							</DropdownMenuItem>
							<DropdownMenuItem
								className={cn(
									"gap-2 px-2.5 py-1.5 text-xs",
									SETTINGS_RADIUS.control,
								)}
								disabled={!selectedFolder}
								onClick={handleOpenEditFolder}
							>
								<Icon name="folder-move" size={14} aria-hidden="true" />
								Rename or move…
							</DropdownMenuItem>
							{canDeleteCurrentFolder ? (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										className={cn(
											"gap-2 px-2.5 py-1.5 text-red-600 text-xs focus:text-red-500 dark:text-red-400 dark:focus:text-red-300",
											SETTINGS_RADIUS.control,
										)}
										onClick={() =>
											selectedFolder &&
											setDeleteConfirmFolderId(selectedFolder.id)
										}
									>
										<Icon name="trash" size={14} aria-hidden="true" />
										Delete folder
									</DropdownMenuItem>
								</>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
				</SettingRow>
			</SectionCard>

			{/* 2 — The links in that folder. */}
			<SectionCard>
				<SettingRow label="Bookmarks" icon="bookmark">
					{isAddingLink || bookmarkCount === 0 ? null : (
						<SettingsAction icon="plus" onClick={handleStartAddLink}>
							Add link
						</SettingsAction>
					)}
				</SettingRow>

				{isAddingLink ? (
					<form
						onSubmit={handleSaveLink}
						className="flex flex-col gap-2.5 p-1.5"
					>
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center justify-between gap-3">
								<label htmlFor="bookmark-url-input" className={FIELD_LABEL}>
									Link
								</label>
								{urlValidation.status === "valid" ? (
									<span className="flex items-center gap-1.5 font-medium text-[11px] text-emerald-600 dark:text-emerald-400">
										<img
											src={faviconUrl(normalizeUrl(linkUrl))}
											alt=""
											className="size-3.5 rounded-xs"
											onError={(e) => {
												e.currentTarget.style.display = "none";
											}}
										/>
										Looks good
									</span>
								) : null}
							</div>
							<Input
								id="bookmark-url-input"
								type="text"
								inputMode="url"
								placeholder="https://example.com"
								value={linkUrl}
								onChange={(e) => handleUrlChange(e.target.value)}
								autoFocus
								className={cn(
									cn("h-9 w-full px-3 text-sm", SETTINGS_RADIUS.control),
									SETTINGS_INPUT,
								)}
								aria-invalid={
									urlValidation.status === "invalid" ||
									urlValidation.status === "duplicate"
								}
							/>
							{urlValidation.message ? (
								<p
									className={cn(
										"text-[12px]",
										urlValidation.status === "existing"
											? "text-amber-600 dark:text-amber-400"
											: "text-red-600 dark:text-red-400",
									)}
									role={
										urlValidation.status === "existing" ? "status" : "alert"
									}
								>
									{urlValidation.message}
								</p>
							) : null}
						</div>

						<div className="flex flex-col gap-1.5">
							<label htmlFor="bookmark-title-input" className={FIELD_LABEL}>
								Title
							</label>
							<Input
								id="bookmark-title-input"
								type="text"
								placeholder={derivedTitle || "Site name"}
								value={linkTitle}
								onChange={(e) => {
									setTitleTouched(true);
									setLinkTitle(e.target.value);
									setLinkTitleSource("saved");
								}}
								className={cn(
									cn("h-9 w-full px-3 text-sm", SETTINGS_RADIUS.control),
									SETTINGS_INPUT,
								)}
							/>
						</div>
						<SelectRow
							label="Display title from"
							value={linkTitleSource}
							options={[
								{ value: "inherit", label: "Default setting" },
								{ value: "saved", label: "Saved title" },
								{ value: "site", label: "Site name from URL" },
							]}
							onChange={setLinkTitleSource}
						/>

						<div className="flex flex-col gap-1.5">
							<span className={FIELD_LABEL}>Folder</span>
							<FolderTreePicker
								folders={folders}
								value={linkFolderId}
								onChange={(id) => id && setLinkFolderId(id)}
								allowRoot={false}
								label="Folder"
								className={cn("h-9 w-full", SETTINGS_RADIUS.control)}
							/>
						</div>

						<div className="flex items-center justify-end gap-2 pt-0.5">
							<SettingsAction onClick={handleCancelLinkEdit}>
								Cancel
							</SettingsAction>
							<SettingsAction
								tone="primary"
								type="submit"
								disabled={
									urlValidation.status !== "valid" &&
									urlValidation.status !== "existing"
								}
							>
								{editingCardId
									? "Save changes"
									: urlValidation.status === "existing"
										? "Update link"
										: "Add link"}
							</SettingsAction>
						</div>
					</form>
				) : bookmarkCount > 0 ? (
					<section
						aria-label={`Bookmarks in ${selectedFolder?.name ?? "this folder"}. Scroll for more.`}
						data-beui-smooth-scroll="true"
						className={cn(
							"flex max-h-64 flex-col overflow-y-auto overscroll-contain scroll-smooth pr-0.5",
							SETTINGS_FOCUS_RING,
							SETTINGS_RADIUS.surface,
						)}
					>
						{folderCards.map((card) => (
							<SettingRow
								key={card.id}
								className={cn(
									"squircle group transition-colors duration-150",
									SETTINGS_ROW_HOVER_WASH,
									SETTINGS_RADIUS.surface,
								)}
								label={
									<span className="flex min-w-0 items-center gap-2.5">
										<img
											src={card.favicon || faviconUrl(card.url)}
											alt=""
											className="size-4 shrink-0 rounded-xs"
											onError={(e) => {
												e.currentTarget.style.display = "none";
											}}
										/>
										<span className="min-w-0 truncate">
											{card.title || card.url}
										</span>
									</span>
								}
							>
								<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
									<SettingsIconButton
										icon="pencil"
										label={`Edit ${card.title || card.url}`}
										onClick={() => handleStartEditLink(card)}
									/>
									<SettingsIconButton
										icon="trash"
										label={`Delete ${card.title || card.url}`}
										tone="danger"
										onClick={() => deleteCard(card.id)}
									/>
								</div>
							</SettingRow>
						))}
					</section>
				) : (
					<SettingsEmpty
						icon="bookmark"
						title="Nothing saved here yet"
						description="Save a page and it will appear on your dashboard in this folder."
						action={
							<SettingsAction icon="plus" onClick={handleStartAddLink}>
								Add link
							</SettingsAction>
						}
					/>
				)}
			</SectionCard>

			{/* 3 — How previews are captured. */}
			<BookmarkPreviewSettings />

			{/* 4 — Moving content in and out. */}
			<SectionCard>
				<input
					ref={fileRef}
					type="file"
					accept=".html,.htm,.json,application/json,text/html"
					className="hidden"
					onChange={handleImportFile}
				/>

				<SettingRow label="Import from browser" icon="import">
					<SettingsAction
						icon="import"
						onClick={handleImportFromBrowser}
						disabled={isProcessingIo}
					>
						Import
					</SettingsAction>
				</SettingRow>

				<SettingRow
					label="Import from file"
					icon="file-import"
					tooltip="Reads a browser bookmarks HTML file or a kTab backup."
				>
					<SettingsAction
						icon="file-import"
						onClick={() => fileRef.current?.click()}
						disabled={isProcessingIo}
					>
						Choose file
					</SettingsAction>
				</SettingRow>

				<SettingRow label="Export" icon="file-export">
					<SettingsAction
						icon="download"
						onClick={handleExportHtml}
						disabled={isProcessingIo}
					>
						HTML
					</SettingsAction>
					<SettingsAction
						icon="archive"
						onClick={handleExportBackup}
						disabled={isProcessingIo}
					>
						Backup
					</SettingsAction>
				</SettingRow>
			</SectionCard>

			{/* Folder edit modal */}
			<Dialog open={folderModalOpen} onOpenChange={setFolderModalOpen}>
				<DialogContent
					closeGlass={isLiquid}
					className={cn(
						"squircle",
						SETTINGS_SCOPE_CLASS,
						SETTINGS_RADIUS.panel,
						"sm:max-w-[420px]",
					)}
				>
					<DialogHeader>
						<DialogTitle>
							{editingFolderId ? "Edit folder" : "New folder"}
						</DialogTitle>
						<DialogDescription>
							{editingFolderId
								? "Rename this folder or move it somewhere else."
								: "Give the folder a name and choose where it lives."}
						</DialogDescription>
					</DialogHeader>

					<form
						onSubmit={handleSaveFolder}
						className="flex flex-col gap-3 py-2"
					>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="folder-name-modal-input" className={FIELD_LABEL}>
								Name
							</label>
							<Input
								id="folder-name-modal-input"
								placeholder="e.g. Work, Reading, Tools"
								value={folderNameInput}
								onChange={(e) => {
									setFolderNameInput(e.target.value);
									if (folderError) setFolderError("");
								}}
								autoFocus
								className={cn("h-9 text-sm", SETTINGS_RADIUS.control)}
							/>
							{folderError ? (
								<p
									className="text-[12px] text-red-600 dark:text-red-400"
									role="alert"
								>
									{folderError}
								</p>
							) : null}
						</div>

						<div className="flex flex-col gap-1.5">
							<span className={FIELD_LABEL}>Parent folder</span>
							<FolderTreePicker
								folders={folders}
								value={folderParentInput ?? "__root__"}
								onChange={setFolderParentInput}
								allowRoot={true}
								excludeIds={
									editingFolderId
										? getSubtreeIds(folders, editingFolderId)
										: undefined
								}
								label="Parent folder"
								className={cn("h-9 w-full", SETTINGS_RADIUS.control)}
							/>
						</div>

						<DialogFooter className="pt-1">
							<SettingsAction onClick={() => setFolderModalOpen(false)}>
								Cancel
							</SettingsAction>
							<SettingsAction type="submit" tone="primary">
								{editingFolderId ? "Save folder" : "Create folder"}
							</SettingsAction>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete folder confirm */}
			<Dialog
				open={Boolean(deleteConfirmFolderId)}
				onOpenChange={(open) => {
					if (!open) setDeleteConfirmFolderId(null);
				}}
			>
				<DialogContent
					closeGlass={isLiquid}
					className={cn(
						"squircle",
						SETTINGS_SCOPE_CLASS,
						SETTINGS_RADIUS.panel,
						"sm:max-w-[420px]",
					)}
				>
					<DialogHeader>
						<DialogTitle>Delete this folder?</DialogTitle>
						<DialogDescription>
							{folderDeleteInfo ? (
								<>
									&ldquo;{folderDeleteInfo.name}&rdquo; will be removed
									{folderDeleteInfo.cardCount > 0 ? (
										<span className="mt-1 block text-red-600 dark:text-red-400">
											{folderDeleteInfo.cardCount} bookmark
											{folderDeleteInfo.cardCount === 1 ? "" : "s"}
											{folderDeleteInfo.subfolderCount > 0
												? ` and ${folderDeleteInfo.subfolderCount} subfolder${folderDeleteInfo.subfolderCount === 1 ? "" : "s"}`
												: ""}{" "}
											will be deleted too.
										</span>
									) : (
										" It is empty, so nothing else is affected."
									)}
								</>
							) : null}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<SettingsAction onClick={() => setDeleteConfirmFolderId(null)}>
							Cancel
						</SettingsAction>
						<SettingsAction
							tone="danger"
							onClick={() => {
								if (deleteConfirmFolderId) {
									deleteFolder(deleteConfirmFolderId);
									setDeleteConfirmFolderId(null);
								}
							}}
						>
							Delete folder
						</SettingsAction>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{/* Import choice: Keep merges, Replace swaps the library (confirmed). */}
			<Dialog
				open={pendingImport !== null}
				onOpenChange={(open) => {
					if (!open) closeImportDialog();
				}}
			>
				<DialogContent
					closeGlass={isLiquid}
					className={cn(
						"squircle",
						SETTINGS_SCOPE_CLASS,
						SETTINGS_RADIUS.panel,
						"sm:max-w-[420px]",
					)}
				>
					<DialogHeader>
						<DialogTitle>
							{pendingImport?.kind === "backup"
								? "Restore backup?"
								: "Import bookmarks?"}
						</DialogTitle>
						<DialogDescription>
							{pendingImport?.kind === "backup" ? (
								<>
									&ldquo;{pendingImport.fileName}&rdquo; holds{" "}
									{pendingImport.summary}. Restoring replaces the current
									library.
								</>
							) : (
								<>
									&ldquo;{pendingImport?.fileName}&rdquo; holds{" "}
									{pendingImport?.summary}. Duplicates already saved here are
									skipped.
								</>
							)}
						</DialogDescription>
					</DialogHeader>

					{pendingImport?.kind !== "backup" && !importConfirmReplace && (
						<div
							role="radiogroup"
							aria-label="Import mode"
							className="flex flex-col gap-2 py-1"
						>
							<label
								className={cn(
									"flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors",
									!importWantsReplace
										? "bg-flat-sunken-raised text-flat-ink"
										: "text-flat-ink-muted hover:bg-flat-sunken-raised/60",
									"focus-within:outline-none focus-within:ring-2 focus-within:ring-ring",
								)}
							>
								<input
									type="radio"
									name="ktab-import-mode"
									checked={!importWantsReplace}
									onChange={() => setImportWantsReplace(false)}
									className="sr-only"
								/>
								<span aria-hidden="true">
									{!importWantsReplace ? "●" : "○"}
								</span>
								<span>
									<span className="block font-medium">
										Keep current bookmarks
									</span>
									<span className="block text-[12px] opacity-70">
										Add the new bookmarks and folders without deleting anything.
									</span>
								</span>
							</label>
							<label
								className={cn(
									"flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors",
									importWantsReplace
										? "bg-flat-sunken-raised text-flat-ink"
										: "text-flat-ink-muted hover:bg-flat-sunken-raised/60",
									"focus-within:outline-none focus-within:ring-2 focus-within:ring-ring",
								)}
							>
								<input
									type="radio"
									name="ktab-import-mode"
									checked={importWantsReplace}
									onChange={() => setImportWantsReplace(true)}
									className="sr-only"
								/>
								<span aria-hidden="true">{importWantsReplace ? "●" : "○"}</span>
								<span>
									<span className="block font-medium">
										Replace current bookmarks
									</span>
									<span className="block text-[12px] opacity-70">
										Remove the existing library and use only the imported data.
									</span>
								</span>
							</label>
						</div>
					)}

					{(pendingImport?.kind === "backup" || importWantsReplace) && (
						<p
							role={importConfirmReplace ? "alert" : undefined}
							className="rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-400"
						>
							{importConfirmReplace ? (
								<>
									This deletes {folders.length} folder
									{folders.length === 1 ? "" : "s"} and {cards.length} bookmark
									{cards.length === 1 ? "" : "s"}. This cannot be undone from
									here.
								</>
							) : (
								"Replacing removes the existing library first."
							)}
						</p>
					)}

					<DialogFooter>
						<SettingsAction onClick={closeImportDialog}>Cancel</SettingsAction>
						{pendingImport?.kind === "backup" || importWantsReplace ? (
							importConfirmReplace ? (
								<SettingsAction
									tone="danger"
									onClick={() => void executePendingImport(true)}
								>
									Yes, replace everything
								</SettingsAction>
							) : (
								<SettingsAction
									tone="danger"
									onClick={() => setImportConfirmReplace(true)}
								>
									Replace…
								</SettingsAction>
							)
						) : (
							<SettingsAction onClick={() => void executePendingImport(false)}>
								Import
							</SettingsAction>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
