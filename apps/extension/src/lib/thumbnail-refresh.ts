/**
 * Shared contract for the thumbnail refresh layer (single + batch).
 *
 * Both the background service worker (queue processor) and the newtab UI
 * (progress toast, card overlays) import from here — message names, timing
 * constants, persisted state shape, and user-facing strings live in exactly
 * one place so the two sides can never drift apart.
 */

// ── Timing ────────────────────────────────────────────────────────────────

/**
 * Minimum gap between two captureVisibleTab calls. The platform quota is
 * 2 calls/second (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND); 1500ms runs at
 * ~0.67 captures/second, comfortably inside the limit even on slow devices
 * where Chromium's quota window behaves conservatively.
 */
export const REFRESH_THROTTLE_MS = 1500;

/** How long an inactive target tab waits for the page to settle per card. */
export const REFRESH_PAGE_SETTLE_MS = 1800;

/** Allow an activated, background-window tab's first composited frame to reach captureVisibleTab. */
export const REFRESH_CAPTURE_FRAME_SETTLE_MS = 500;

/** A target tab that does not finish navigation is failed, never captured stale. */
export const REFRESH_NAVIGATION_TIMEOUT_MS = 12_000;

/**
 * A persisted "running" batch older than this is considered stale (crashed
 * worker, closed browser) and will not auto-resume — it is marked cancelled
 * instead so a new batch can start clean.
 */
export const REFRESH_BATCH_STALE_MS = 10 * 60 * 1000;

/** chrome.storage.session key for the crash-resumable batch state. */
export const REFRESH_SESSION_KEY = "ktab-refresh-batch";

/**
 * Geometry for the reused capture window. Chrome rejects windows that are
 * more than half outside the visible work area; minimized-window capture is
 * not a documented guarantee. Keep a normal, non-topmost window and load each
 * target in an inactive tab. Some Chromium builds focus it when a target tab is
 * activated; the queue restores prior focus promptly after activation if the
 * user has not switched windows.
 */
export const REFRESH_WINDOW_GEOMETRY = {
	width: 800,
	height: 600,
	focused: false,
} as const;

/**
 * Milliseconds to wait before the next capture given the last capture time.
 * Pure helper so the spacing rule is unit-testable without timers.
 */
export function captureDelayMs(
	lastCaptureAt: number | null,
	now: number,
): number {
	if (lastCaptureAt === null) return 0;
	const elapsed = now - lastCaptureAt;
	return elapsed >= REFRESH_THROTTLE_MS ? 0 : REFRESH_THROTTLE_MS - elapsed;
}

// ── Message API (runtime.sendMessage) ─────────────────────────────────────

export type RefreshMessageType =
	| "refresh:single"
	| "refresh:batch"
	| "refresh:cancel"
	| "refresh:state"
	| "refresh:progress";

export interface RefreshSingleMessage {
	type: "refresh:single";
	cardId: string;
}

export interface RefreshBatchMessage {
	type: "refresh:batch";
	cardIds: string[];
}

export interface RefreshCancelMessage {
	type: "refresh:cancel";
}

export interface RefreshStateMessage {
	type: "refresh:state";
}

export type RefreshMessage =
	| RefreshSingleMessage
	| RefreshBatchMessage
	| RefreshCancelMessage
	| RefreshStateMessage;

export type RefreshProgressStatus =
	| "started"
	| "capturing"
	| "card-done"
	| "card-failed"
	| "done"
	| "cancelled"
	| "already-running"
	| "needs-permission";

export interface RefreshProgressEvent {
	type: "refresh:progress";
	status: RefreshProgressStatus;
	/** Total cards in this batch (1 for a single refresh). */
	total: number;
	/** Cards finished (done + failed) so far. */
	completed: number;
	updated: number;
	failed: number;
	/** Card currently being captured, if any. */
	currentCardId?: string;
	currentUrl?: string;
	currentTitle?: string;
	/** Remaining queue ids let a newly opened New Tab reconstruct progress. */
	queuedIds?: string[];
	/** Latest-first is a UI concern; the worker appends chronologically. */
	recent?: Array<{
		cardId: string;
		title: string;
		url: string;
		ok: boolean;
		/** Stage-tagged failure reason (e.g. "capture: …"). Absent on success. */
		error?: string;
	}>;
}

export function isRefreshMessage(value: unknown): value is RefreshMessage {
	if (typeof value !== "object" || value === null) return false;
	const message = value as {
		type?: unknown;
		cardId?: unknown;
		cardIds?: unknown;
	};
	if (message.type === "refresh:single")
		return typeof message.cardId === "string" && message.cardId.length > 0;
	if (message.type === "refresh:batch")
		return (
			Array.isArray(message.cardIds) &&
			message.cardIds.every((id) => typeof id === "string" && id.length > 0)
		);
	return message.type === "refresh:cancel" || message.type === "refresh:state";
}

// ── Persisted batch state (survives service-worker sleep) ────────────────

export interface RefreshBatchState {
	status: "running" | "idle";
	cardIds: string[];
	doneIds: string[];
	failedIds: string[];
	sites: Record<
		string,
		{ title: string; url: string; ok: boolean; error?: string }
	>;
	startedAt: number;
	/** Crash staleness follows activity, not the duration of a healthy batch. */
	lastActivityAt?: number;
	/** Identity of the page loaded into the pending tab, independent of UI progress. */
	pendingTarget?: {
		cardId: string;
		url: string;
		thumbId: string | null;
	} | null;
	/** Card currently being prepared/captured; null between cards. */
	activeCardId?: string | null;
	/** Owned window/tab ids let a resumed worker reuse or clean its surface. */
	captureWindowId?: number | null;
	/** The inert extension anchor proves ownership; numeric IDs alone do not. */
	captureAnchorTabId?: number | null;
	captureOwnerToken?: string | null;
	/** Firefox owns only two inactive tabs, never their containing user window. */
	captureSurface?: "window" | "tabs";
	captureTabId?: number | null;
	pendingCaptureTabId?: number | null;
}

export function emptyRefreshState(): RefreshBatchState {
	return {
		status: "idle",
		cardIds: [],
		doneIds: [],
		failedIds: [],
		sites: {},
		startedAt: 0,
		activeCardId: null,
		captureWindowId: null,
		captureTabId: null,
		pendingCaptureTabId: null,
	};
}

/** True when a persisted state is a fresh, resumable running batch. */
export function isResumableRefreshState(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const state = value as Partial<RefreshBatchState>;
	if (state.status !== "running") return false;
	if (!Array.isArray(state.cardIds) || state.cardIds.length === 0) return false;
	if (!state.cardIds.every((id) => typeof id === "string")) return false;
	if (!Array.isArray(state.doneIds) || !Array.isArray(state.failedIds))
		return false;
	if (
		!state.doneIds.every((id) => typeof id === "string") ||
		!state.failedIds.every((id) => typeof id === "string")
	)
		return false;
	if (
		!state.sites ||
		typeof state.sites !== "object" ||
		Array.isArray(state.sites)
	)
		return false;
	if (typeof state.startedAt !== "number" || !Number.isFinite(state.startedAt))
		return false;
	if (state.activeCardId != null && typeof state.activeCardId !== "string")
		return false;
	for (const id of [
		state.captureWindowId,
		state.captureAnchorTabId,
		state.captureTabId,
		state.pendingCaptureTabId,
	]) {
		if (id != null && (!Number.isInteger(id) || id < 0)) return false;
	}
	// The ownership anchor authorizes every window adoption/closure; a state
	// with a broken surface contract must not be adopted or auto-resumed.
	if (
		state.captureSurface != null &&
		state.captureSurface !== "window" &&
		state.captureSurface !== "tabs"
	) {
		return false;
	}
	if (
		state.captureOwnerToken != null &&
		(typeof state.captureOwnerToken !== "string" ||
			state.captureOwnerToken.length === 0)
	) {
		return false;
	}
	const activity = state.lastActivityAt ?? state.startedAt;
	return (
		typeof activity === "number" &&
		Number.isFinite(activity) &&
		Date.now() - activity < REFRESH_BATCH_STALE_MS
	);
}

export function isRefreshPendingTargetUnchanged(
	pending: RefreshBatchState["pendingTarget"],
	cardId: string,
	url: string,
	thumbId: string | null | undefined,
): boolean {
	return (
		!!pending &&
		pending.cardId === cardId &&
		isRefreshTargetUnchanged(pending.url, url, pending.thumbId, thumbId)
	);
}

export function isRefreshTargetUnchanged(
	initialUrl: string,
	currentUrl: string,
	initialThumbId: string | null | undefined,
	currentThumbId: string | null | undefined,
): boolean {
	return (
		initialUrl === currentUrl &&
		(initialThumbId ?? null) === (currentThumbId ?? null)
	);
}

// ── User-facing strings (single source; no copies in components) ─────────

export const REFRESH_STRINGS = {
	singleItem: "Refresh thumbnail",
	batchAction: (n: number) => `Refresh previews (${n})`,
	missingAction: (n: number) => `Refresh missing previews (${n})`,
	confirmMany: (n: number) =>
		`Refresh ${n} previews? Pages load in inactive tabs; some browsers may briefly show a capture window or shift focus.`,
	alreadyRunning: "A refresh is already running.",
	needsPermission:
		"Site access was removed. Click refresh again to allow capture.",
	permissionDenied:
		"Refresh cancelled: site access was not granted. Your previews are unchanged.",
	permissionError: "Could not request site access. Click refresh to try again.",
	capturing: (done: number, total: number) =>
		`Capturing ${done + 1} of ${total}…`,
	cancelRefresh: "Cancel refresh",
	cancelledAt: (done: number, total: number) =>
		`Cancelled at ${done} of ${total}`,
	completeSummary: (updated: number, failed: number) =>
		failed === 0
			? `${updated} preview${updated === 1 ? "" : "s"} updated`
			: `${updated} updated, ${failed} failed`,
} as const;
