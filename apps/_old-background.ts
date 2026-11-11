import {
	findBookmarkInFolder,
	findBookmarksByDomain,
	isThumbnailCaptureUrl,
} from "../src/lib/bookmark-match";
import { ext } from "../src/lib/extension-api";
import { getChildren } from "../src/lib/folder-tree";
import { idbDelete, STORE_THUMBS, saveThumbnail } from "../src/lib/idb";
import {
	PENDING_SAVE_KEY,
	PENDING_SAVE_QUERY_PARAM,
	PENDING_SAVE_TTL_MS,
	parsePendingSave,
	pendingSaveId,
	pendingSaveThumbId,
} from "../src/lib/pending-save";
import {
	getResetGeneration,
	normalizeState,
	readSetupEnvelope,
	writeSetupEnvelope,
} from "../src/lib/storage";
import { hasThumbnailCapturePermission } from "../src/lib/thumbnail-permission";
import {
	captureDelayMs,
	emptyRefreshState,
	isRefreshMessage,
	isRefreshPendingTargetUnchanged,
	isRefreshTargetUnchanged,
	isResumableRefreshState,
	REFRESH_CAPTURE_FRAME_SETTLE_MS,
	REFRESH_NAVIGATION_TIMEOUT_MS,
	REFRESH_PAGE_SETTLE_MS,
	REFRESH_SESSION_KEY,
	REFRESH_WINDOW_GEOMETRY,
	type RefreshBatchState,
	type RefreshMessage,
	type RefreshProgressEvent,
} from "../src/lib/thumbnail-refresh";
import { canonicalizeForAutoCapture, isAbsoluteHttpUrl } from "../src/lib/url";
import { uid } from "../src/lib/utils";
import type { Folder, Setup } from "../src/types";

// Persistent identifiers from the Perch era — kept verbatim so existing
// installs keep their data and context-menu registration after the rename.
const STORAGE_KEY = "perch-setup";
const MENU_ID = "add-to-perch";
const NEW_FOLDER_SEPARATOR_ID = "klice-new-folder-separator";
const NEW_FOLDER_MENU_ID = "klice-new-folder";

/**
 * Read and normalize the persisted setup, or null when nothing is stored.
 * N1: routes through the shared generation protocol — an envelope older
 * than the current reset generation reads as "nothing stored", so a save
 * never builds on dead state.
 */
function readSetup(): Promise<Setup | null> {
	return readSetupEnvelope(STORAGE_KEY);
}

/**
 * N1: persist with the current generation stamped and the shared write
 * chain honored. Post-reset, the next quick-save reads null (fresh setup),
 * writes with the new stamp — the badge "✓" finally means the data landed.
 */
function writeSetup(setup: Setup): Promise<void> {
	return writeSetupEnvelope(STORAGE_KEY, setup);
}

// Context menu: "Save page to Klice Start" is a parent item with one entry
// per Klice Start folder (nested folders become nested submenus).
const FOLDER_MENU_PREFIX = "klice-folder:";
const MAX_MENU_TITLE_LENGTH = 60;

/** Menu id for a folder item; stable across restarts and updates. */
function folderMenuId(folderId: string): string {
	return `${FOLDER_MENU_PREFIX}${folderId}`;
}

/**
 * Escape "&" (contextMenus treats it as a mnemonic accelerator on some
 * platforms) and truncate very long names so submenus stay usable.
 */
function menuTitle(name: string): string {
	const trimmed = name.trim() || "Untitled";
	const short =
		trimmed.length > MAX_MENU_TITLE_LENGTH
			? `${trimmed.slice(0, MAX_MENU_TITLE_LENGTH)}…`
			: trimmed;
	return short.replaceAll("&", "&&");
}

/**
 * Create one menu item per folder, mirroring the folder hierarchy.
 * Parents are created before their children so every parentId resolves,
 * and siblings follow the app's folder-tree ordering (order, then name —
 * see getChildren). normalizeState already repaired orphans and cycles,
 * so walking parentId chains always terminates at a root.
 */
function createFolderMenuItems(folders: Folder[]): void {
	const createLevel = (parentId: string | null, parentMenuId: string): void => {
		for (const folder of getChildren(folders, parentId)) {
			const id = folderMenuId(folder.id);
			safeCreateMenuItem({
				id,
				parentId: parentMenuId,
				title: menuTitle(folder.name),
				contexts: ["page"],
			});
			createLevel(folder.id, id);
		}
	};
	createLevel(null, MENU_ID);
}

/**
 * contextMenus.create reports duplicate-id errors asynchronously through
 * runtime.lastError (and can throw synchronously), so swallow both: a
 * duplicate here is harmless because rebuildMenus always removeAll()s first.
 */
function safeCreateMenuItem(
	properties: Parameters<typeof ext.contextMenus.create>[0],
): void {
	try {
		ext.contextMenus.create(properties, () => {
			void ext.runtime.lastError;
		});
	} catch {
		// Duplicate id or invalid properties — safe to ignore, see above.
	}
}

/**
 * Rebuild the whole context menu from the persisted setup. removeAll-then-
 * create is the race-safe pattern: no stale or duplicate items can survive
 * restarts, resets, or folder changes.
 */
async function rebuildMenus(): Promise<void> {
	await ext.contextMenus.removeAll();

	// Parent item. It has children, so it can never receive a click itself —
	// every folder leaf handles its own click.
	safeCreateMenuItem({
		id: MENU_ID,
		title: "Save page to Klice Start",
		contexts: ["page"],
	});

	const setup = (await readSetup()) ?? normalizeState(null);
	const folders = setup.folders;

	if (folders.length === 0) {
		// Should be unreachable — normalizeState guarantees a default Home
		// folder — but never ship an empty submenu.
		safeCreateMenuItem({
			id: folderMenuId("default"),
			parentId: MENU_ID,
			title: "Save to Home",
			contexts: ["page"],
		});
	} else {
		createFolderMenuItems(folders);
	}

	safeCreateMenuItem({
		id: NEW_FOLDER_SEPARATOR_ID,
		parentId: MENU_ID,
		type: "separator",
		contexts: ["page"],
	});
	safeCreateMenuItem({
		id: NEW_FOLDER_MENU_ID,
		parentId: MENU_ID,
		title: "New Folder…",
		contexts: ["page"],
	});
}

// Serialize rebuilds so overlapping triggers never interleave their
// removeAll/create sequences.
let rebuildChain: Promise<void> = Promise.resolve();
function scheduleRebuild(): void {
	rebuildChain = rebuildChain.then(rebuildMenus).catch(() => {
		// A failed rebuild is retried by the next trigger.
	});
}

// Context-menu and keyboard saves share one read-modify-write lane. This keeps
// two quick save gestures from both observing an empty destination and adding
// the same URL before either write reaches storage.
let bookmarkSaveChain: Promise<void> = Promise.resolve();
function enqueueBookmarkSave(task: () => Promise<void>): Promise<void> {
	const next = bookmarkSaveChain.catch(() => undefined).then(task);
	bookmarkSaveChain = next.catch(() => undefined);
	return next;
}

// Trailing debounce for storage.onChanged: zustand persist coalesces writes
// but can still fire several changes in a row; keep a single pending timer.
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRebuildDebounced(): void {
	clearTimeout(rebuildTimer);
	rebuildTimer = setTimeout(scheduleRebuild, 150);
}

/**
 * Capture the visible tab. windowId is optional in the API (defaults to the
 * current window), so we only pass it when we actually have one.
 */
function captureVisible(
	windowId: number | undefined,
	quality: number,
): Promise<string> {
	const options = { format: "jpeg" as const, quality };
	return typeof windowId === "number"
		? ext.tabs.captureVisibleTab(windowId, options)
		: ext.tabs.captureVisibleTab(options);
}

// Settle delay before an automatic capture. 1600ms sits inside the
// 1500–2000ms debounce window: long enough for fonts/hero images to paint
// after onCompleted, short enough that the user's own delayMs setting
// (default 1200) still reads as "extra patience" rather than a no-op.
const THUMBNAIL_SETTLE_DELAY_MS = 1600;
const THUMBNAIL_FAILURE_COOLDOWN_MS = 10_000;

interface PendingThumbnailCapture {
	timer: ReturnType<typeof setTimeout>;
	expectedUrl: string;
	expectedKey: string;
	navigationGeneration: number;
}

interface InFlightThumbnailCapture {
	expectedKey: string;
	navigationGeneration: number;
}

// These maps contain only transient scheduling state. The bookmark and image
// records remain in extension storage/IndexedDB, so a worker restart cannot
// lose user data. The guards prevent repeated onUpdated/onActivated events
// from starting parallel captures for the same navigation.
const pendingThumbnailCaptures = new Map<number, PendingThumbnailCapture>();
const inFlightThumbnailCaptures = new Map<number, InFlightThumbnailCapture>();

/**
 * In-memory card index for the cheap per-navigation pre-filter:
 * origin → every thumbless-or-not card stored under it (multiple cards may
 * share a site across folders and paths). Keys use canonicalizeForAutoCapture
 * — the same domain identity the capture-time matcher
 * (findBookmarksByDomain) uses — so index hits and capture-time matches
 * agree by construction. The manual re-save path intentionally keeps its own
 * exact identity (canonicalUrl in findBookmarkInFolder) and never consults
 * this index.
 *
 * The index is advisory only — it can skip work that would no-op, never
 * approve work the fresh-state check in captureMissingThumbnail would
 * reject. A stale "no thumb" entry costs one extra scheduled attempt that
 * then finds nothing to update; a stale "has thumb" entry self-heals on the
 * next perch-setup change because every write refreshes the index.
 */
interface CardIndexEntry {
	id: string;
	thumbId: string | null;
}

let cardIndex = new Map<string, CardIndexEntry[]>();
let cardIndexReady: Promise<void> = Promise.resolve();

async function refreshCardIndex(): Promise<void> {
	const setup = await readSetup();
	const next = new Map<string, CardIndexEntry[]>();
	if (setup) {
		for (const card of setup.cards) {
			const key = canonicalizeForAutoCapture(card.url);
			if (!key) continue;
			const entry: CardIndexEntry = { id: card.id, thumbId: card.thumbId };
			const entries = next.get(key);
			if (entries) entries.push(entry);
			else next.set(key, [entry]);
		}
	}
	cardIndex = next;
}

/** Serialized rebuilds: a burst of setup writes converges to one fresh read. */
function scheduleCardIndexRefresh(): void {
	cardIndexReady = cardIndexReady.then(refreshCardIndex).catch(() => undefined);
}

/**
 * True when at least one card on this URL's ORIGIN still lacks a thumbnail.
 * Any path on a saved site can satisfy any thumbless card on that origin.
 * Cards that already have one never block the capture — the pipeline
 * attaches the shot to thumbless matches only — but an origin whose every
 * card already has a thumb skips scheduling entirely.
 */
function hasCardWithoutThumbnail(rawUrl: string): boolean {
	const key = canonicalizeForAutoCapture(rawUrl);
	if (!key) return false;
	const entries = cardIndex.get(key);
	if (!entries) return false;
	return entries.some((entry) => !entry.thumbId);
}
const recentThumbnailAttempts = new Map<string, number>();
/** One capture can satisfy every card that points at the same URL. */
const inFlightThumbnailKeys = new Set<string>();
const navigationStartUrls = new Map<number, string>();
const navigationGenerations = new Map<number, number>();
const tabActivationRevisions = new Map<number, number>();
let refreshStartupReady: Promise<void> = Promise.resolve();

function cancelPendingThumbnailCapture(tabId: number): void {
	const pending = pendingThumbnailCaptures.get(tabId);
	if (!pending) return;
	clearTimeout(pending.timer);
	pendingThumbnailCaptures.delete(tabId);
}

function nextNavigationGeneration(tabId: number): number {
	const next = (navigationGenerations.get(tabId) ?? 0) + 1;
	navigationGenerations.set(tabId, next);
	return next;
}

function thumbnailAttemptKey(expectedKey: string): string {
	return expectedKey;
}

function isWithinThumbnailFailureCooldown(attemptKey: string): boolean {
	const attemptedAt = recentThumbnailAttempts.get(attemptKey);
	if (attemptedAt === undefined) return false;
	if (Date.now() - attemptedAt >= THUMBNAIL_FAILURE_COOLDOWN_MS) {
		recentThumbnailAttempts.delete(attemptKey);
		return false;
	}
	return true;
}

function tabCanBeCaptured(
	tab: { active?: boolean; status?: string; url?: string },
	tabId: number,
	navigationGeneration: number,
): boolean {
	return (
		tab.active === true &&
		tab.status === "complete" &&
		navigationGenerations.get(tabId) === navigationGeneration &&
		!!tab.url &&
		isThumbnailCaptureUrl(tab.url)
	);
}

export default defineBackground(() => {
	ext.windows.onFocusChanged?.addListener((windowId) => {
		refreshFocusEventSequence += 1;
		refreshFocusEventLog.push({
			sequence: refreshFocusEventSequence,
			windowId,
		});
		if (refreshFocusEventLog.length > 64) refreshFocusEventLog.shift();
		if (refreshCaptureWindowIds.has(windowId)) return;
		refreshFocusRevision += 1;
		// WINDOW_ID_NONE can be the first half of a window-manager transition.
		// Keep the last concrete target; restoration still checks current focus.
		if (windowId >= 0) refreshLastNonCaptureWindowId = windowId;
	});
	ext.windows.onRemoved?.addListener((windowId) => {
		tabActivationRevisions.delete(windowId);
		refreshCaptureWindowIds.delete(windowId);
		if (refreshHiddenWindowId === windowId) refreshHiddenWindowId = null;
	});

	// Worker startup: read the persisted setup once and warm the card index.
	// Every later change flows through storage.onChanged above, so the index
	// stays current without re-reading per navigation.
	scheduleCardIndexRefresh();
	// A batch interrupted by a worker restart resumes its remaining cards.
	refreshStartupReady = resumeRefreshBatchIfNeeded();

	// Refresh control plane: single, batch, cancel. Progress flows back as
	// refresh:progress events (no polling). Unknown messages return false so
	// other listeners in this worker stay unaffected.
	ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (!isRefreshMessage(message)) return false;
		handleRefreshMessage(message).then(
			(result) => sendResponse({ ok: true, ...(result as object) }),
			(error: unknown) =>
				sendResponse({
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				}),
		);
		return true;
	});

	ext.runtime.onInstalled.addListener(() => {
		scheduleRebuild();
	});

	// Covers browser restarts: the service worker's menu registrations persist,
	// but rebuilding guarantees they match the current setup.
	ext.runtime.onStartup.addListener(() => {
		scheduleRebuild();
	});

	// Keep the menu in sync with folder create/delete/rename/move, import,
	// reset, and cross-tab writes — everything persists to this one key.
	ext.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !(STORAGE_KEY in changes)) return;
		scheduleRebuildDebounced();
		// Same single key owns the cards: import, manual saves, resets, and
		// the background's own capture writes all invalidate the index here.
		scheduleCardIndexRefresh();
	});

	ext.contextMenus.onClicked.addListener((info, tab) => {
		if (!tab) return;
		const menuItemId = info.menuItemId;
		if (menuItemId === NEW_FOLDER_MENU_ID) {
			void captureAndOpenPendingSave(tab);
			return;
		}
		if (
			typeof menuItemId === "string" &&
			menuItemId.startsWith(FOLDER_MENU_PREFIX)
		) {
			void captureAndAdd(tab, menuItemId.slice(FOLDER_MENU_PREFIX.length));
		}
	});

	ext.commands.onCommand.addListener((command) => {
		if (command === "add-current-page") {
			ext.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
				if (tabs[0]) captureAndAdd(tabs[0]);
			});
		}
	});

	ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
		// Refresh-owned tabs are loaded and captured by the queue; the visit
		// pipeline must never schedule an automatic capture for them.
		if (changeInfo.status === "loading") {
			const startUrl = changeInfo.url ?? tab.url;
			if (startUrl) navigationStartUrls.set(tabId, startUrl);
			else navigationStartUrls.delete(tabId);
			nextNavigationGeneration(tabId);
			cancelPendingThumbnailCapture(tabId);
		} else if (changeInfo.url && !navigationStartUrls.has(tabId)) {
			// Some browser navigation paths report the URL before the loading
			// status. Treat the first URL event as the navigation start while
			// preserving it through redirects.
			navigationStartUrls.set(tabId, changeInfo.url);
			nextNavigationGeneration(tabId);
			cancelPendingThumbnailCapture(tabId);
		}
		if (refreshHiddenTabIds.has(tabId)) return;
		if (changeInfo.status !== "complete") return;
		const currentUrl = tab.url ?? changeInfo.url;
		if (!currentUrl) return;
		queueMissingThumbnailCapture(
			tabId,
			{ ...tab, url: currentUrl },
			navigationStartUrls.get(tabId) ?? currentUrl,
		);
	});

	ext.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
		tabActivationRevisions.set(
			windowId,
			(tabActivationRevisions.get(windowId) ?? 0) + 1,
		);
		if (refreshHiddenTabIds.has(tabId)) return;
		try {
			const tab = await ext.tabs.get(tabId);
			if (tab.url) {
				// Activation is a fresh opportunity for an already-settled tab;
				// do not reuse a stale redirect candidate from an old navigation.
				navigationStartUrls.delete(tabId);
				// onActivated is authoritative about the active tab, even if the
				// immediately-following tabs.get snapshot still reports old state.
				queueMissingThumbnailCapture(tabId, { ...tab, active: true }, tab.url);
			}
		} catch {
			// Tab may not exist anymore
		}
	});

	// webNavigation.onCompleted is the precise visit signal: it fires once per
	// top-frame navigation for http(s) URLs only (url filter below), even when
	// the tabs.onUpdated status stream skips or reorders events. It shares the
	// same capture pipeline as tabs.onUpdated — queueMissingThumbnailCapture
	// dedupes by origin and navigation generation, so a navigation that
	// both listeners observe schedules exactly one capture.
	ext.webNavigation.onCompleted.addListener(
		(details) => {
			void handleNavigationCompleted(details);
		},
		{ url: [{ schemes: ["http", "https"] }] },
	);

	ext.tabs.onRemoved.addListener((tabId) => {
		cancelPendingThumbnailCapture(tabId);
		navigationStartUrls.delete(tabId);
		navigationGenerations.delete(tabId);
		inFlightThumbnailCaptures.delete(tabId);
		refreshHiddenTabIds.delete(tabId);
	});
});

async function deletePendingThumbnail(thumbId: string | null): Promise<void> {
	if (!thumbId) return;
	try {
		await idbDelete(STORE_THUMBS, thumbId);
	} catch {
		// Cleanup is best effort; the pending record remains the source of truth.
	}
}

async function clearPendingSave(
	expectedId: string,
	deleteThumb: boolean,
	fallbackThumbId: string | null = null,
): Promise<void> {
	const data = await ext.storage.local.get(PENDING_SAVE_KEY);
	const raw = data[PENDING_SAVE_KEY];
	if (pendingSaveId(raw) !== expectedId) return;
	const thumbId = deleteThumb
		? pendingSaveThumbId(raw) || fallbackThumbId
		: null;
	await ext.storage.local.remove(PENDING_SAVE_KEY);
	if (thumbId) await deletePendingThumbnail(thumbId);
}

async function captureAndOpenPendingSave(tab: {
	id?: number;
	url?: string;
	title?: string;
	windowId?: number;
	favIconUrl?: string;
}): Promise<void> {
	if (!tab.url || !isAbsoluteHttpUrl(tab.url)) {
		flashBadge("✕", "#FF453A");
		return;
	}

	const id = uid();
	const createdAt = Date.now();
	let thumbId: string | null = null;
	try {
		const dataUrl = await captureVisible(tab.windowId, 85);
		thumbId = await saveThumbnail(dataUrl);
	} catch {
		// A page can still be saved when the browser denies the screenshot.
	}

	const pending = {
		id,
		url: tab.url.trim(),
		title: tab.title?.trim() || tab.url.trim(),
		favicon: tab.favIconUrl || "",
		thumbId,
		sourceTabId: typeof tab.id === "number" ? tab.id : null,
		sourceWindowId: typeof tab.windowId === "number" ? tab.windowId : null,
		createdAt,
		expiresAt: createdAt + PENDING_SAVE_TTL_MS,
	};
	const validated = parsePendingSave(pending, id, createdAt);
	if (!validated) {
		await deletePendingThumbnail(thumbId);
		flashBadge("✕", "#FF453A");
		return;
	}

	let stored = false;
	try {
		const existing = await ext.storage.local.get(PENDING_SAVE_KEY);
		const previousThumbId = pendingSaveThumbId(existing[PENDING_SAVE_KEY]);
		await ext.storage.local.set({ [PENDING_SAVE_KEY]: validated });
		stored = true;
		if (previousThumbId) await deletePendingThumbnail(previousThumbId);

		const popupUrl = ext.runtime.getURL(
			`/popup.html?${PENDING_SAVE_QUERY_PARAM}=${encodeURIComponent(id)}`,
		);
		await ext.windows.create({
			url: popupUrl,
			type: "popup",
			width: 360,
			height: 500,
			focused: true,
		});
	} catch {
		if (stored) {
			await clearPendingSave(id, true, thumbId).catch(() =>
				deletePendingThumbnail(thumbId),
			);
		} else {
			await deletePendingThumbnail(thumbId);
		}
		flashBadge("✕", "#FF453A");
	}
}

function captureAndAdd(
	tab: {
		id?: number;
		url?: string;
		title?: string;
		windowId?: number;
		favIconUrl?: string;
	},
	targetFolderId?: string,
): Promise<void> {
	return enqueueBookmarkSave(() => captureAndAddNow(tab, targetFolderId));
}

async function captureAndAddNow(
	tab: {
		id?: number;
		url?: string;
		title?: string;
		windowId?: number;
		favIconUrl?: string;
	},
	targetFolderId?: string,
) {
	const pageUrl = tab?.url?.trim();
	if (!pageUrl || !isAbsoluteHttpUrl(pageUrl)) {
		flashBadge("✕", "#FF453A");
		return;
	}

	let thumbId: string | null = null;
	let persisted = false;
	try {
		// Capture and persist the thumbnail BEFORE re-reading state, so the
		// read-modify-write window that could clobber a concurrent newtab write
		// is as small as possible.
		try {
			const dataUrl = await captureVisible(tab.windowId, 85);
			thumbId = await saveThumbnail(dataUrl);
		} catch {
			// Saving a bookmark remains useful when the browser denies a capture.
		}

		const setup = (await readSetup()) ?? normalizeState(null);
		// Context-menu clicks pass an explicit folder; fall back to the
		// active/default folder when it is absent or was deleted since the
		// menu was rendered.
		const targetFolder = targetFolderId
			? setup.folders.find((f) => f.id === targetFolderId)
			: undefined;
		const folderId =
			targetFolder?.id ||
			setup.activeFolderId ||
			setup.folders[0]?.id ||
			"default";
		const cardsInFolder = setup.cards.filter((c) => c.folderId === folderId);
		const existingCard = findBookmarkInFolder(setup.cards, folderId, pageUrl);

		if (existingCard) {
			const previousThumbId = existingCard.thumbId;
			existingCard.title = tab.title?.trim() || existingCard.title;
			if (thumbId) existingCard.thumbId = thumbId;
			if (tab.favIconUrl) existingCard.favicon = tab.favIconUrl;
			await writeSetup(setup);
			persisted = true;
			if (thumbId && previousThumbId && previousThumbId !== thumbId) {
				await deleteUnreferencedThumbnails([previousThumbId]).catch(
					() => undefined,
				);
			}
		} else {
			setup.cards.push({
				id: uid(),
				folderId,
				title: tab.title?.trim() || pageUrl,
				url: pageUrl,
				favicon: tab.favIconUrl || "",
				thumbId,
				order: cardsInFolder.length,
				origin: "local",
				capturedAt: null,
			});
			await writeSetup(setup);
			persisted = true;
		}
		flashBadge("✓", "#34C759");
	} catch {
		if (!persisted && thumbId) await deletePendingThumbnail(thumbId);
		flashBadge("✕", "#FF453A");
	}
}

async function deleteUnreferencedThumbnails(
	thumbIds: readonly (string | null)[],
): Promise<void> {
	const candidates = [...new Set(thumbIds.filter((id): id is string => !!id))];
	if (candidates.length === 0) return;
	const setup = await readSetup();
	if (!setup) return;
	const referenced = new Set(
		setup.cards.flatMap((card) => (card.thumbId ? [card.thumbId] : [])),
	);
	for (const thumbId of candidates) {
		if (!referenced.has(thumbId)) await deletePendingThumbnail(thumbId);
	}
}

/**
 * webNavigation.onCompleted handler: the cheap synchronous gates run first so
 * ordinary browsing that cannot produce a capture never pays for an async
 * permission roundtrip. Anything that survives is handed to
 * queueMissingThumbnailCapture, which owns the settle debounce, the
 * active-tab/generation guards, and the capture itself — the same pipeline
 * the tabs.onUpdated path uses (one implementation, two visit signals).
 */
async function handleNavigationCompleted(details: {
	frameId: number;
	tabId: number;
	url: string;
}): Promise<void> {
	// Sub-frames never own the visible surface captureVisibleTab photographs;
	// only a top-frame completed load can match a card.
	if (details.frameId !== 0) return;
	// Refresh-owned tabs are driven by the queue, never the visit pipeline
	// (same guard as tabs.onUpdated above).
	if (refreshHiddenTabIds.has(details.tabId)) return;
	const url = details.url;
	if (!url || !isThumbnailCaptureUrl(url)) return;
	// The newtab override and any other extension page must never capture
	// themselves. The url filter already excludes chrome:// and
	// chrome-extension:// schemes; this guard keeps that guarantee explicit
	// and future-proof against filter changes.
	if (url.startsWith(ext.runtime.getURL("/"))) return;
	// Cheap index pre-filter: no card for this URL, or every matching card
	// already has a thumbnail — nothing this visit could update. Await the
	// startup read first so a cold worker's first navigation cannot consult
	// an empty index and silently skip a real match.
	await cardIndexReady;
	if (!hasCardWithoutThumbnail(url)) return;
	// An automatic background capture has no user gesture, so only a granted
	// optional "<all_urls>" (permissions.contains) may proceed — see
	// thumbnail-permission.ts for why the http/https host grants do not
	// qualify. Silent skip: an unconsented user gets no capture, never an
	// error, and the Settings pane's "Allow access" flow offers the one-time
	// consent that lets the next visit capture.
	if (!(await hasThumbnailCapturePermission())) return;
	queueMissingThumbnailCapture(details.tabId, { url }, url);
}

function queueMissingThumbnailCapture(
	tabId: number,
	tab: { active?: boolean; url?: string },
	expectedUrl = tab.url,
) {
	const url = tab.url;
	if (tab.active === false || !url || !isThumbnailCaptureUrl(url)) {
		cancelPendingThumbnailCapture(tabId);
		return;
	}
	const candidateUrl =
		expectedUrl && isThumbnailCaptureUrl(expectedUrl) ? expectedUrl : url;
	// Domain identity: any path on the origin shares one attempt key and one
	// cooldown, so back-to-back visits to sibling pages do not double-capture.
	const expectedKey = canonicalizeForAutoCapture(candidateUrl);
	if (!expectedKey) {
		cancelPendingThumbnailCapture(tabId);
		return;
	}

	const navigationGeneration = navigationGenerations.get(tabId) ?? 0;
	const inFlight = inFlightThumbnailCaptures.get(tabId);
	if (inFlight?.navigationGeneration === navigationGeneration) return;
	const attemptKey = thumbnailAttemptKey(expectedKey);
	if (inFlightThumbnailKeys.has(attemptKey)) return;
	if (isWithinThumbnailFailureCooldown(attemptKey)) return;

	cancelPendingThumbnailCapture(tabId);

	const timeoutId = setTimeout(() => {
		const pending = pendingThumbnailCaptures.get(tabId);
		if (!pending || pending.timer !== timeoutId) return;
		pendingThumbnailCaptures.delete(tabId);
		void captureMissingThumbnail(
			tabId,
			pending.expectedUrl,
			pending.expectedKey,
			pending.navigationGeneration,
		).catch(() => {});
	}, THUMBNAIL_SETTLE_DELAY_MS);

	pendingThumbnailCaptures.set(tabId, {
		timer: timeoutId,
		expectedUrl: candidateUrl,
		expectedKey,
		navigationGeneration,
	});
}

async function captureMissingThumbnail(
	tabId: number,
	expectedUrl: string,
	expectedKey: string,
	navigationGeneration: number,
) {
	if (inFlightThumbnailCaptures.has(tabId)) return;
	if (inFlightThumbnailKeys.has(expectedKey)) return;
	inFlightThumbnailCaptures.set(tabId, {
		expectedKey,
		navigationGeneration,
	});
	inFlightThumbnailKeys.add(expectedKey);

	let thumbId: string | null = null;
	let persisted = false;
	try {
		const state = await readSetup();
		if (!state?.settings.thumbnailCapture?.enabled) return;
		// An automatic background capture has no activeTab user gesture. Missing
		// optional access must not start a failure cooldown: granting access in
		// Settings should allow the next visit to capture immediately.
		if (!(await hasThumbnailCapturePermission())) return;

		let tab = await ext.tabs.get(tabId);
		if (!tabCanBeCaptured(tab, tabId, navigationGeneration)) return;

		// Domain match: any thumbless card on this origin qualifies, even
		// when the saved path differs from the visited one.
		let matches = findBookmarksByDomain(state.cards, [
			expectedUrl,
			tab.url ?? "",
		]);
		if (matches.length === 0) return;

		const attemptKey = thumbnailAttemptKey(expectedKey);
		if (isWithinThumbnailFailureCooldown(attemptKey)) return;
		recentThumbnailAttempts.set(attemptKey, Date.now());

		const delayMs = Number(state.settings.thumbnailCapture.delayMs) || 1200;
		if (delayMs > THUMBNAIL_SETTLE_DELAY_MS) {
			await new Promise<void>((resolve) =>
				setTimeout(resolve, delayMs - THUMBNAIL_SETTLE_DELAY_MS),
			);
		}

		// The user may have navigated, switched tabs, or explicitly saved the
		// bookmark while the settle delay was running. Re-read both before the
		// expensive capture so we never attach a stale frame or duplicate an
		// explicit refresh.
		if (navigationGenerations.get(tabId) !== navigationGeneration) return;
		tab = await ext.tabs.get(tabId);
		if (!tabCanBeCaptured(tab, tabId, navigationGeneration)) return;
		const beforeCaptureUrl = tab.url ?? "";
		const beforeCaptureState = await readSetup();
		if (!beforeCaptureState?.settings.thumbnailCapture?.enabled) return;
		matches = findBookmarksByDomain(beforeCaptureState.cards, [
			expectedUrl,
			beforeCaptureUrl,
		]);
		if (matches.length === 0) return;
		const dataUrl = await captureVisible(tab.windowId, 82);
		thumbId = await saveThumbnail(dataUrl);
		const capturedAt = Date.now();

		if (navigationGenerations.get(tabId) !== navigationGeneration) return;
		tab = await ext.tabs.get(tabId);
		if (!tabCanBeCaptured(tab, tabId, navigationGeneration)) return;

		// Re-read fresh state right before writing to avoid clobbering concurrent
		// edits and to ensure an explicit save won the race while we captured.
		const fresh = await readSetup();
		if (!fresh) return;
		const finalMatches = findBookmarksByDomain(fresh.cards, [
			expectedUrl,
			tab.url ?? "",
		]);
		if (finalMatches.length === 0) return;
		const matchIds = new Set(finalMatches.map((card) => card.id));
		let changed = false;

		for (const card of fresh.cards) {
			if (!matchIds.has(card.id) || card.thumbId) continue;
			card.thumbId = thumbId;
			card.capturedAt = capturedAt;
			if (!card.favicon && tab.favIconUrl) card.favicon = tab.favIconUrl;
			changed = true;
		}

		if (!changed) return;
		await writeSetup(fresh);
		persisted = true;
	} finally {
		const navigationChanged =
			navigationGenerations.get(tabId) !== navigationGeneration;
		if (thumbId && !persisted) await deletePendingThumbnail(thumbId);
		if (persisted) recentThumbnailAttempts.delete(expectedKey);
		const current = inFlightThumbnailCaptures.get(tabId);
		if (
			current?.expectedKey === expectedKey &&
			current.navigationGeneration === navigationGeneration
		) {
			inFlightThumbnailCaptures.delete(tabId);
		}
		inFlightThumbnailKeys.delete(expectedKey);
		if (navigationGenerations.get(tabId) === navigationGeneration) {
			navigationStartUrls.delete(tabId);
		}
		if (navigationChanged) {
			void ext.tabs
				.get(tabId)
				.then((currentTab) => {
					if (currentTab.active && currentTab.status === "complete") {
						queueMissingThumbnailCapture(tabId, currentTab, currentTab.url);
					}
				})
				.catch(() => undefined);
		}
	}
}

// ── Thumbnail refresh queue (single + batch) ─────────────────────────────
//
// A user-initiated best-effort background operation: pages load in inactive
// tabs inside one reused normal window, spaced REFRESH_THROTTLE_MS apart
// (well inside the platform's 2 captures/second quota).
//
// Keep-alive: every loop iteration calls extension APIs (tabs.update,
// storage.session.set, captureVisibleTab, runtime.sendMessage), and since
// Chrome 110 each such call resets the service worker's 30-second idle
// timer — the worker stays alive for the whole batch without any artificial
// heartbeat. If the worker still dies (crash, 5-minute task cap), the batch
// state persisted in chrome.storage.session lets the next worker start
// resume exactly the remaining cards (see resumeRefreshBatchIfNeeded).

let refreshRunning = false;
let refreshCancelRequested = false;
let lastRefreshCaptureAt: number | null = null;
let refreshHiddenWindowId: number | null = null;
const refreshHiddenTabIds = new Set<number>();
const refreshCaptureWindowIds = new Set<number>();
const refreshWaitCancelers = new Set<() => void>();
const refreshFocusEventLog: Array<{ sequence: number; windowId: number }> = [];
let refreshFocusEventSequence = 0;
let refreshFocusRevision = 0;
let refreshLastNonCaptureWindowId: number | null = null;
let refreshLiveState: RefreshBatchState | null = null;

function sleep(ms: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function getFocusedWindowId(): Promise<number | null> {
	try {
		const windows = await ext.windows.getAll({ populate: false });
		return windows.find((window) => window.focused)?.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Restore only when the capture window is still focused. If a focus event
 * arrived during our activation, prefer that newer window (or relinquish
 * focus) rather than pulling the user back to a stale window id.
 */
async function restoreFocusAfterCaptureActivation(
	captureWindowId: number,
	previousWindowId: number | null,
	focusRevisionBefore: number,
): Promise<void> {
	if ((await getFocusedWindowId()) !== captureWindowId) return;
	const targetWindowId =
		refreshFocusRevision === focusRevisionBefore
			? previousWindowId
			: refreshLastNonCaptureWindowId;
	if (targetWindowId === captureWindowId) return;
	if (targetWindowId !== null) {
		try {
			const target = await ext.windows.get(targetWindowId);
			if (target.state !== "minimized") {
				if ((await getFocusedWindowId()) !== captureWindowId) return;
				await ext.windows.update(targetWindowId, { focused: true });
				return;
			}
		} catch {
			// The prior window may have closed while the page loaded.
		}
	}
	try {
		if ((await getFocusedWindowId()) === captureWindowId) {
			await ext.windows.update(captureWindowId, { focused: false });
		}
	} catch {
		// Best effort; capture still works if the window manager denies focus.
	}
}

async function readRefreshState(): Promise<RefreshBatchState> {
	if (refreshRunning && refreshLiveState) return refreshLiveState;
	try {
		const data = await ext.storage.session.get(REFRESH_SESSION_KEY);
		const raw = data[REFRESH_SESSION_KEY] as unknown;
		if (isResumableRefreshState(raw)) {
			return { ...emptyRefreshState(), ...(raw as RefreshBatchState) };
		}
	} catch {
		// Session storage unavailable — run without resume support.
	}
	return emptyRefreshState();
}

async function writeRefreshState(state: RefreshBatchState): Promise<void> {
	state.lastActivityAt = Date.now();
	refreshLiveState = state;
	try {
		await ext.storage.session.set({ [REFRESH_SESSION_KEY]: state });
	} catch {
		// Best-effort: the batch continues in memory without resume support.
	}
}

async function clearRefreshState(): Promise<void> {
	refreshLiveState = null;
	try {
		await ext.storage.session.remove(REFRESH_SESSION_KEY);
	} catch {
		// Best-effort.
	}
}

/** Progress reaches the newtab UI as events; a closed newtab just drops them. */
function emitRefreshProgress(event: RefreshProgressEvent): void {
	try {
		const result = ext.runtime.sendMessage(event) as unknown;
		if (result && typeof (result as Promise<unknown>).catch === "function") {
			(result as Promise<unknown>).catch(() => undefined);
		}
	} catch {
		// No receiver (newtab closed) — the batch continues regardless.
	}
}

function refreshProgressBase(state: RefreshBatchState): RefreshProgressEvent {
	const finished = new Set([...state.doneIds, ...state.failedIds]);
	const activeSite = state.activeCardId
		? state.sites[state.activeCardId]
		: undefined;
	return {
		type: "refresh:progress",
		status: "capturing",
		total: state.cardIds.length,
		completed: finished.size,
		updated: state.doneIds.length,
		failed: state.failedIds.length,
		currentCardId: state.activeCardId ?? undefined,
		currentUrl: activeSite?.url,
		currentTitle: activeSite?.title,
		queuedIds: state.cardIds.filter((cardId) => !finished.has(cardId)),
		recent: state.cardIds.flatMap((cardId) => {
			if (!finished.has(cardId)) return [];
			const site = state.sites[cardId];
			return site ? [{ cardId, ...site }] : [];
		}),
	};
}

/** Resolve true on a complete load; timeout, removal, or cancellation fail. */
async function waitForRefreshTabComplete(
	tabId: number,
	timeoutMs: number,
): Promise<boolean> {
	const current = await ext.tabs.get(tabId).catch(() => null);
	if (current?.status === "complete") return true;
	if (refreshCancelRequested) return false;
	return new Promise((resolve) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const finish = (loaded: boolean): void => {
			if (settled) return;
			settled = true;
			if (timer !== null) clearTimeout(timer);
			refreshWaitCancelers.delete(cancel);
			try {
				ext.tabs.onUpdated.removeListener(listener);
			} catch {
				// Listener already gone.
			}
			resolve(loaded);
		};
		const cancel = (): void => finish(false);
		const listener = (
			updatedTabId: number,
			changeInfo: { status?: string },
		): void => {
			if (updatedTabId === tabId && changeInfo.status === "complete") {
				finish(true);
			}
		};
		try {
			ext.tabs.onUpdated.addListener(listener);
		} catch {
			finish(false);
			return;
		}
		refreshWaitCancelers.add(cancel);
		timer = setTimeout(() => finish(false), timeoutMs);
		// Close the race where navigation completed between the first read and
		// listener registration.
		void ext.tabs
			.get(tabId)
			.then((tab) => {
				if (tab.status === "complete") finish(true);
			})
			.catch(() => finish(false));
	});
}

/** Reuse one normal capture window for the batch; recreate it if it died. */
async function ensureRefreshWindow(
	state: RefreshBatchState,
): Promise<{ windowId: number; tabId: number }> {
	const preferredWindowId = state.captureWindowId ?? refreshHiddenWindowId;
	if (preferredWindowId !== null && preferredWindowId !== undefined) {
		try {
			const existing = await ext.windows.get(preferredWindowId, {
				populate: true,
			});
			const tabs = existing.tabs ?? [];
			const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
			if (activeTab?.id !== undefined) {
				refreshHiddenWindowId = preferredWindowId;
				refreshCaptureWindowIds.add(preferredWindowId);
				for (const tab of tabs) {
					if (tab.id !== undefined) refreshHiddenTabIds.add(tab.id);
				}
				state.captureWindowId = preferredWindowId;
				state.captureTabId = activeTab.id;
				if (
					state.pendingCaptureTabId !== null &&
					state.pendingCaptureTabId !== undefined &&
					!tabs.some((tab) => tab.id === state.pendingCaptureTabId)
				) {
					state.pendingCaptureTabId = null;
				}
				await writeRefreshState(state);
				return { windowId: preferredWindowId, tabId: activeTab.id };
			}
		} catch {
			// The worker or user may have closed the previously owned window.
		}
		refreshCaptureWindowIds.delete(preferredWindowId);
		refreshHiddenWindowId = null;
		state.captureWindowId = null;
		state.captureTabId = null;
		state.pendingCaptureTabId = null;
	}

	const focusEventCursor = refreshFocusEventSequence;
	const focusedBefore = await getFocusedWindowId();
	const created = await ext.windows.create({
		...REFRESH_WINDOW_GEOMETRY,
		url: "about:blank",
	});
	if (!created || created.id === undefined)
		throw new Error("window: capture window denied");
	refreshHiddenWindowId = created.id;
	refreshCaptureWindowIds.add(created.id);
	// New-window focus events can arrive before the returned id is known.
	// Ignore those events when choosing what to restore, but honor any later
	// focus change to another browser window or to the OS desktop.
	let restoreWindowId = focusedBefore;
	for (const event of refreshFocusEventLog) {
		if (
			event.sequence > focusEventCursor &&
			event.windowId >= 0 &&
			event.windowId !== created.id
		) {
			restoreWindowId = event.windowId;
		}
	}
	await restoreFocusAfterCaptureActivation(
		created.id,
		restoreWindowId,
		refreshFocusRevision,
	);

	const tab = created.tabs?.[0];
	let tabId = tab?.id;
	if (tabId === undefined) {
		const fresh = await ext.tabs.query({ windowId: created.id });
		tabId = fresh[0]?.id;
	}
	if (tabId === undefined) throw new Error("capture tab denied");
	refreshHiddenTabIds.add(tabId);
	state.captureWindowId = created.id;
	state.captureTabId = tabId;
	state.pendingCaptureTabId = null;
	await writeRefreshState(state);
	return { windowId: created.id, tabId };
}

async function removeRefreshTab(tabId: number): Promise<void> {
	refreshHiddenTabIds.delete(tabId);
	try {
		await ext.tabs.remove(tabId);
	} catch {
		// The tab may already have been closed with its window.
	}
}

async function createRefreshTargetTab(
	state: RefreshBatchState,
	windowId: number,
	cardId: string,
	url: string,
	thumbId: string | null | undefined,
): Promise<number> {
	const pendingId = state.pendingCaptureTabId;
	if (
		pendingId !== null &&
		pendingId !== undefined &&
		isRefreshPendingTargetUnchanged(state.pendingTarget, cardId, url, thumbId)
	) {
		const pending = await ext.tabs.get(pendingId).catch(() => null);
		if (pending?.windowId === windowId) {
			refreshHiddenTabIds.add(pendingId);
			return pendingId;
		}
	}
	if (pendingId !== null && pendingId !== undefined) {
		if (pendingId !== state.captureTabId) await removeRefreshTab(pendingId);
		state.pendingCaptureTabId = null;
	}
	const created = await ext.tabs.create({ windowId, url, active: false });
	if (created.id === undefined) throw new Error("navigate: capture tab denied");
	refreshHiddenTabIds.add(created.id);
	state.pendingCaptureTabId = created.id;
	state.pendingTarget = { cardId, url, thumbId: thumbId ?? null };
	state.captureWindowId = windowId;
	await writeRefreshState(state);
	return created.id;
}

/** Supported fast path: no new window and no activation for an already-active page. */
async function findActiveRefreshTarget(
	url: string,
	ownedWindowId?: number | null,
) {
	let requestedUrl: string;
	try {
		requestedUrl = new URL(url).href;
	} catch {
		return undefined;
	}
	const tabs = await ext.tabs.query({ active: true });
	return tabs.find(
		(tab) =>
			tab.id !== undefined &&
			tab.windowId !== ownedWindowId &&
			!refreshHiddenTabIds.has(tab.id) &&
			tab.status === "complete" &&
			tab.url === requestedUrl,
	);
}

async function refreshTabIsStable(
	tabId: number,
	windowId: number,
	settledUrl: string,
	navigationRevision: number | undefined,
	activationRevision: number | undefined,
): Promise<boolean> {
	const tab = await ext.tabs.get(tabId).catch(() => null);
	return (
		!!tab &&
		tab.windowId === windowId &&
		tab.active === true &&
		tab.status === "complete" &&
		tab.url === settledUrl &&
		navigationGenerations.get(tabId) === navigationRevision &&
		tabActivationRevisions.get(windowId) === activationRevision
	);
}

async function closeRefreshWindow(): Promise<void> {
	refreshHiddenTabIds.clear();
	if (refreshHiddenWindowId === null) return;
	const id = refreshHiddenWindowId;
	refreshHiddenWindowId = null;
	refreshCaptureWindowIds.delete(id);
	try {
		await ext.windows.remove(id);
	} catch {
		// Already closed by the user or the browser.
	}
}

async function discardRefreshState(
	state: Pick<RefreshBatchState, "captureWindowId">,
): Promise<void> {
	const windowId = state.captureWindowId;
	if (windowId !== null && windowId !== undefined) {
		refreshCaptureWindowIds.delete(windowId);
		if (refreshHiddenWindowId === windowId) refreshHiddenWindowId = null;
		try {
			await ext.windows.remove(windowId);
		} catch {
			// The window may have closed with the browser already.
		}
	}
	await clearRefreshState();
}

interface RefreshStartResult {
	accepted: boolean;
	reason?: "already-running" | "needs-permission" | "empty";
	total?: number;
}

/**
 * Validate and launch a batch. The caller MUST have claimed `refreshRunning`
 * synchronously (see handleRefreshMessage) so two rapid starts can never
 * both enter. Resolves as soon as the batch is accepted — the capture loop
 * runs detached and reports through progress events, never through this
 * response. (Awaiting the loop here once froze the UI: the client's
 * optimistic beginLocal ran after completion and clobbered live progress.)
 */
async function startRefreshBatch(
	requestedIds: string[],
	resumeFrom?: RefreshBatchState,
): Promise<RefreshStartResult> {
	const snapshot = await readSetup();
	if (!snapshot) {
		if (resumeFrom) await discardRefreshState(resumeFrom);
		refreshRunning = false;
		return { accepted: false, reason: "empty" };
	}
	const snapshotById = new Map(snapshot.cards.map((card) => [card.id, card]));
	const candidates = [...new Set(requestedIds)].filter((id) => {
		const card = snapshotById.get(id);
		return !!card && isThumbnailCaptureUrl(card.url);
	});
	if (candidates.length === 0 && !resumeFrom) {
		refreshRunning = false;
		return { accepted: false, reason: "empty" };
	}

	// A manual refresh has the user's gesture behind it, but the capture
	// itself still needs the consented <all_urls> grant — the same gate the
	// auto-capture path uses. Fail loud (not silent): the UI offers the
	// Settings consent flow.
	if (!(await hasThumbnailCapturePermission())) {
		if (resumeFrom) await discardRefreshState(resumeFrom);
		refreshRunning = false;
		emitRefreshProgress({
			type: "refresh:progress",
			status: "needs-permission",
			total: candidates.length,
			completed: 0,
			updated: 0,
			failed: 0,
		});
		return { accepted: false, reason: "needs-permission" };
	}

	const alreadyDone = new Set(resumeFrom?.doneIds ?? []);
	const alreadyFailed = new Set(resumeFrom?.failedIds ?? []);
	const state: RefreshBatchState = {
		status: "running",
		cardIds: resumeFrom?.cardIds.length ? [...resumeFrom.cardIds] : candidates,
		doneIds: [...alreadyDone],
		failedIds: [...alreadyFailed],
		sites: { ...(resumeFrom?.sites ?? {}) },
		startedAt: resumeFrom?.startedAt ?? Date.now(),
		activeCardId: resumeFrom?.activeCardId ?? null,
		captureWindowId: resumeFrom?.captureWindowId ?? null,
		captureTabId: resumeFrom?.captureTabId ?? null,
		pendingCaptureTabId: resumeFrom?.pendingCaptureTabId ?? null,
		pendingTarget: resumeFrom?.pendingTarget ?? null,
	};
	if (state.captureWindowId != null) {
		refreshHiddenWindowId = state.captureWindowId;
		refreshCaptureWindowIds.add(state.captureWindowId);
	}
	const queue = state.cardIds.filter(
		(id) => !alreadyDone.has(id) && !alreadyFailed.has(id),
	);
	if (queue.length === 0) {
		await discardRefreshState(state);
		refreshRunning = false;
		emitRefreshProgress({ ...refreshProgressBase(state), status: "done" });
		return { accepted: true, total: state.cardIds.length };
	}

	lastRefreshCaptureAt = null;
	await writeRefreshState(state);
	emitRefreshProgress({ ...refreshProgressBase(state), status: "started" });

	// Detached: progress (and the terminal done/cancelled) flows back as
	// events. The loop owns clearing `refreshRunning` in its finally.
	void runRefreshLoop(state, queue, snapshotById).catch(() => undefined);
	return { accepted: true, total: state.cardIds.length };
}

async function runRefreshLoop(
	state: RefreshBatchState,
	queue: string[],
	snapshotById: Map<string, { id: string; title: string; url: string }>,
): Promise<void> {
	try {
		for (let index = 0; index < queue.length; index += 1) {
			const cardId = queue[index];
			if (refreshCancelRequested) break;

			const waitMs = captureDelayMs(lastRefreshCaptureAt, Date.now());
			if (waitMs > 0) await sleep(waitMs);
			if (refreshCancelRequested) break;

			// Refresh the card record before each page load. A deleted or
			// invalid card is a completed failure, not a stale queue entry.
			const live = await readSetup();
			const captureResetGeneration = getResetGeneration();
			const card = live?.cards.find((entry) => entry.id === cardId);
			const known = snapshotById.get(cardId);
			if (!card || !isThumbnailCaptureUrl(card.url)) {
				const reason = card
					? "validate: unsupported URL"
					: "state: card removed";
				if (!state.failedIds.includes(cardId)) state.failedIds.push(cardId);
				state.activeCardId = null;
				state.pendingCaptureTabId = null;
				state.sites[cardId] = {
					title: known?.title ?? card?.title ?? cardId,
					url: known?.url ?? card?.url ?? "",
					ok: false,
					error: reason,
				};
				await writeRefreshState(state);
				emitRefreshProgress({
					...refreshProgressBase(state),
					status: "card-failed",
					currentCardId: cardId,
					currentUrl: state.sites[cardId].url,
					currentTitle: state.sites[cardId].title,
				});
				continue;
			}

			state.activeCardId = cardId;
			state.sites[cardId] = {
				title: card.title,
				url: card.url,
				ok: false,
			};
			await writeRefreshState(state);
			emitRefreshProgress({
				...refreshProgressBase(state),
				status: "capturing",
				currentCardId: cardId,
				currentUrl: card.url,
				currentTitle: card.title,
			});

			// `stage` names the exact failure point for user-visible diagnosis.
			let stage = "window";
			let targetTabId: number | null = null;
			let previousCaptureTabId: number | null = null;
			let targetIsCurrent = false;
			let borrowedTarget = false;
			let newThumbId: string | null = null;
			let imageCommitted = false;
			try {
				const existing = await findActiveRefreshTarget(
					card.url,
					state.captureWindowId,
				);
				let windowId: number;
				if (existing?.id !== undefined) {
					windowId = existing.windowId;
					targetTabId = existing.id;
					borrowedTarget = true;
				} else {
					const owned = await ensureRefreshWindow(state);
					windowId = owned.windowId;
					state.captureTabId ??= owned.tabId;
					previousCaptureTabId = state.captureTabId ?? null;
					stage = "navigate";
					targetTabId = await createRefreshTargetTab(
						state,
						windowId,
						cardId,
						card.url,
						card.thumbId,
					);
				}
				stage = "navigate";
				const loaded = await waitForRefreshTabComplete(
					targetTabId,
					REFRESH_NAVIGATION_TIMEOUT_MS,
				);
				if (refreshCancelRequested) {
					state.activeCardId = null;
					state.pendingCaptureTabId = null;
					await writeRefreshState(state);
					break;
				}
				if (!loaded) throw new Error("navigate: page load timed out");
				await sleep(REFRESH_PAGE_SETTLE_MS);
				if (refreshCancelRequested) {
					state.activeCardId = null;
					state.pendingCaptureTabId = null;
					await writeRefreshState(state);
					break;
				}

				const targetTab = await ext.tabs.get(targetTabId);
				if (
					targetTab.windowId !== windowId ||
					!isThumbnailCaptureUrl(targetTab.url ?? "")
				) {
					throw new Error("navigate: target tab left the web page");
				}
				const settledUrl = targetTab.url ?? "";
				const navigationRevision = navigationGenerations.get(targetTabId);
				const beforeCaptureSetup = await readSetup();
				const beforeCaptureCard = beforeCaptureSetup?.cards.find(
					(entry) => entry.id === cardId,
				);
				if (!beforeCaptureCard) {
					throw new Error("state: card removed before capture");
				}
				if (
					!isRefreshTargetUnchanged(
						card.url,
						beforeCaptureCard.url,
						card.thumbId,
						beforeCaptureCard.thumbId,
					)
				) {
					throw new Error("state: card edited before capture");
				}

				if (!borrowedTarget) {
					const focusRevisionBeforeQuery = refreshFocusRevision;
					const focusedBefore = await getFocusedWindowId();
					const focusRestoreTarget =
						refreshFocusRevision === focusRevisionBeforeQuery
							? focusedBefore
							: refreshLastNonCaptureWindowId;
					const focusRevisionBeforeActivation = refreshFocusRevision;
					await ext.tabs.update(targetTabId, { active: true });
					targetIsCurrent = true;
					state.captureTabId = targetTabId;
					state.pendingCaptureTabId = null;
					await writeRefreshState(state);
					await restoreFocusAfterCaptureActivation(
						windowId,
						focusRestoreTarget,
						focusRevisionBeforeActivation,
					);
				}
				await sleep(REFRESH_CAPTURE_FRAME_SETTLE_MS);
				if (refreshCancelRequested) {
					state.activeCardId = null;
					await writeRefreshState(state);
					break;
				}
				const activationRevision = tabActivationRevisions.get(windowId);
				if (
					!(await refreshTabIsStable(
						targetTabId,
						windowId,
						settledUrl,
						navigationRevision,
						activationRevision,
					))
				) {
					throw new Error("capture: target tab is not ready");
				}

				stage = "capture";
				const dataUrl = await captureVisible(windowId, 82);
				if (!dataUrl?.startsWith("data:image")) {
					throw new Error(
						`capture: empty result (len=${dataUrl?.length ?? 0})`,
					);
				}
				if (refreshCancelRequested) {
					state.activeCardId = null;
					await writeRefreshState(state);
					break;
				}
				lastRefreshCaptureAt = Date.now();
				stage = "persist-image";
				newThumbId = await saveThumbnail(dataUrl);
				if (refreshCancelRequested) {
					state.activeCardId = null;
					await writeRefreshState(state);
					break;
				}
				if (
					!(await refreshTabIsStable(
						targetTabId,
						windowId,
						settledUrl,
						navigationRevision,
						activationRevision,
					))
				) {
					throw new Error("capture: target changed during capture");
				}
				const capturedAt = Date.now();

				// Re-read at commit time and preserve the capture's reset generation.
				// These guards reject observed edits/deletes; storage.local has no CAS
				// and direct writers in other contexts are not an atomic transaction.
				stage = "persist-state";
				const fresh = await readSetup();
				const target = fresh?.cards.find((entry) => entry.id === cardId);
				if (!fresh || !target) {
					throw new Error("state: card removed during refresh");
				}
				if (
					!isRefreshTargetUnchanged(
						card.url,
						target.url,
						card.thumbId,
						target.thumbId,
					)
				) {
					throw new Error("state: card edited during refresh");
				}
				const previousThumbId = target.thumbId;
				target.thumbId = newThumbId;
				target.capturedAt = capturedAt;
				await writeSetupEnvelope(STORAGE_KEY, fresh, captureResetGeneration);
				imageCommitted = true;
				snapshotById.set(cardId, target);
				if (previousThumbId && previousThumbId !== newThumbId) {
					await deleteUnreferencedThumbnails([previousThumbId]).catch(
						() => undefined,
					);
				}
				if (!state.doneIds.includes(cardId)) state.doneIds.push(cardId);
				state.activeCardId = null;
				state.pendingCaptureTabId = null;
				state.sites[cardId] = {
					title: target.title,
					url: target.url,
					ok: true,
				};
				await writeRefreshState(state);
				emitRefreshProgress({
					...refreshProgressBase(state),
					status: "card-done",
					currentCardId: cardId,
					currentUrl: target.url,
					currentTitle: target.title,
				});
			} catch (error) {
				if (refreshCancelRequested) {
					state.activeCardId = null;
					state.pendingCaptureTabId = null;
					await writeRefreshState(state);
					break;
				}
				const detail = error instanceof Error ? error.message : String(error);
				const reason = detail.startsWith(`${stage}:`)
					? detail
					: `${stage}: ${detail}`;
				const expectedConcurrentChange =
					/^state: card (?:removed|edited) (?:before capture|during refresh)$/.test(
						detail,
					);
				if (!expectedConcurrentChange) {
					console.error(`[refresh] card failed (${cardId}): ${reason}`);
				}
				if (!state.failedIds.includes(cardId)) state.failedIds.push(cardId);
				state.activeCardId = null;
				state.pendingCaptureTabId = null;
				state.sites[cardId] = {
					title: card.title,
					url: card.url,
					ok: false,
					error: reason,
				};
				if (stage === "window") {
					// If creating or recovering the capture window failed, the
					// rest of this batch cannot proceed either.
					for (const restId of queue.slice(index + 1)) {
						if (!state.failedIds.includes(restId)) state.failedIds.push(restId);
						const rest = snapshotById.get(restId);
						state.sites[restId] = {
							title: rest?.title ?? restId,
							url: rest?.url ?? "",
							ok: false,
							error: reason,
						};
					}
					await writeRefreshState(state);
					emitRefreshProgress({
						...refreshProgressBase(state),
						status: "card-failed",
						currentCardId: cardId,
						currentUrl: card.url,
						currentTitle: card.title,
					});
					break;
				}
				await writeRefreshState(state);
				emitRefreshProgress({
					...refreshProgressBase(state),
					status: "card-failed",
					currentCardId: cardId,
					currentUrl: card.url,
					currentTitle: card.title,
				});
			} finally {
				if (newThumbId && !imageCommitted) {
					await deletePendingThumbnail(newThumbId);
				}
				if (targetTabId !== null && !targetIsCurrent && !borrowedTarget) {
					await removeRefreshTab(targetTabId);
				}
				if (
					targetIsCurrent &&
					previousCaptureTabId !== null &&
					previousCaptureTabId !== targetTabId
				) {
					await removeRefreshTab(previousCaptureTabId);
				}
			}
		}
	} finally {
		await closeRefreshWindow();
		await clearRefreshState();
		refreshRunning = false;
	}

	const cancelled = refreshCancelRequested;
	refreshCancelRequested = false;
	emitRefreshProgress({
		...refreshProgressBase(state),
		status: cancelled ? "cancelled" : "done",
		recent: state.cardIds.map((id) => ({
			cardId: id,
			title: state.sites[id]?.title ?? snapshotById.get(id)?.title ?? id,
			url: state.sites[id]?.url ?? snapshotById.get(id)?.url ?? "",
			ok: state.doneIds.includes(id),
			error: state.sites[id]?.error,
		})),
	});
}

async function handleRefreshMessage(message: RefreshMessage): Promise<unknown> {
	await refreshStartupReady;
	if (message.type === "refresh:state") {
		return readRefreshState().then(async (state) => {
			if (state.status === "running" && !isResumableRefreshState(state)) {
				await discardRefreshState(state);
				return { state: emptyRefreshState() };
			}
			return { state };
		});
	}
	if (message.type === "refresh:cancel") {
		if (refreshRunning) {
			refreshCancelRequested = true;
			for (const cancelWait of refreshWaitCancelers) cancelWait();
		}
		return Promise.resolve({ cancelled: true });
	}
	if (refreshRunning) {
		void readRefreshState().then(
			(state) => {
				emitRefreshProgress({
					...refreshProgressBase(
						state.status === "running" ? state : emptyRefreshState(),
					),
					status: "already-running",
				});
			},
			() => undefined,
		);
		return Promise.resolve({ accepted: false, reason: "already-running" });
	}
	// Synchronous claim: two rapid starts can never both enter the async
	// validation below. Every failure path in startRefreshBatch releases it.
	refreshRunning = true;
	refreshCancelRequested = false;
	const ids =
		message.type === "refresh:single" ? [message.cardId] : [...message.cardIds];
	return startRefreshBatch(ids).catch((error: unknown) => {
		refreshRunning = false;
		refreshCancelRequested = false;
		throw error;
	});
}

/** A crashed worker's "running" batch resumes; a stale one is discarded. */
async function resumeRefreshBatchIfNeeded(): Promise<void> {
	let raw: unknown = null;
	try {
		const data = await ext.storage.session.get(REFRESH_SESSION_KEY);
		raw = (data[REFRESH_SESSION_KEY] as unknown) ?? null;
	} catch {
		return;
	}
	if (!isResumableRefreshState(raw)) {
		if (
			raw &&
			typeof raw === "object" &&
			(raw as { status?: unknown }).status === "running"
		) {
			await discardRefreshState(raw as RefreshBatchState);
		}
		return;
	}
	if (refreshRunning) return;
	refreshRunning = true;
	refreshCancelRequested = false;
	await startRefreshBatch(
		(raw as RefreshBatchState).cardIds,
		raw as RefreshBatchState,
	).catch(async () => {
		await discardRefreshState(raw as RefreshBatchState);
		refreshRunning = false;
	});
}

function flashBadge(text: string, color: string) {
	ext.action.setBadgeBackgroundColor({ color });
	ext.action.setBadgeText({ text });
	setTimeout(() => ext.action.setBadgeText({ text: "" }), 1400);
}
