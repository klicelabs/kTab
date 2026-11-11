import { isAbsoluteHttpUrl } from "./url";

/** Storage key used to hand a context-menu save operation to the popup. */
export const PENDING_SAVE_KEY = "ktab-pending-save";
export const PENDING_SAVE_QUERY_PARAM = "pendingSaveId";

/** Pending operations intentionally expire quickly if their popup is abandoned. */
export const PENDING_SAVE_TTL_MS = 5 * 60 * 1000;

export interface PendingSave {
	id: string;
	url: string;
	title: string;
	favicon: string;
	thumbId: string | null;
	sourceTabId: number | null;
	sourceWindowId: number | null;
	createdAt: number;
	expiresAt: number;
}

type UnknownRecord = Record<string, unknown>;

function decodeRecord(value: unknown): UnknownRecord | null {
	let decoded = value;
	if (typeof decoded === "string") {
		try {
			decoded = JSON.parse(decoded) as unknown;
		} catch {
			return null;
		}
	}
	return decoded !== null &&
		typeof decoded === "object" &&
		!Array.isArray(decoded)
		? (decoded as UnknownRecord)
		: null;
}

function boundedString(value: unknown, maxLength: number): string | null {
	return typeof value === "string" && value.length <= maxLength ? value : null;
}

function nullableInteger(value: unknown): number | null | undefined {
	if (value === null) return null;
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
		return value;
	return undefined;
}

/** Return the id from a record without accepting arbitrary oversized values. */
export function pendingSaveId(value: unknown): string | null {
	const record = decodeRecord(value);
	const id = record && boundedString(record.id, 200);
	return id && id.length > 0 ? id : null;
}

/** Return a thumbnail id only when it is safe to delete during cleanup. */
export function pendingSaveThumbId(value: unknown): string | null {
	const record = decodeRecord(value);
	if (!record || pendingSaveId(record) === null) return null;
	const thumbId = boundedString(record.thumbId, 200);
	return thumbId && thumbId.length > 0 ? thumbId : null;
}

/** True when a validated pending operation has passed its expiry instant. */
export function isPendingSaveExpired(
	pending: Pick<PendingSave, "expiresAt">,
	now = Date.now(),
): boolean {
	return (
		!Number.isSafeInteger(pending.expiresAt) ||
		!Number.isFinite(now) ||
		now >= pending.expiresAt
	);
}

/**
 * Parse and validate a pending operation from extension storage.
 * An expected id is required by callers handling a popup query so an older
 * popup can never consume a newer operation that replaced the single key.
 */
export function parsePendingSave(
	value: unknown,
	expectedId?: string,
	now = Date.now(),
): PendingSave | null {
	const record = decodeRecord(value);
	if (!record) return null;

	const id = pendingSaveId(record);
	const url = boundedString(record.url, 16_384);
	const title = boundedString(record.title, 4_000);
	const favicon = boundedString(record.favicon, 4_096);
	const thumbIdValue = record.thumbId;
	const thumbId =
		thumbIdValue === null ? null : boundedString(thumbIdValue, 200);
	const sourceTabId = nullableInteger(record.sourceTabId);
	const sourceWindowId = nullableInteger(record.sourceWindowId);
	const createdAt = record.createdAt;
	const expiresAt = record.expiresAt;

	if (
		!id ||
		(expectedId !== undefined && id !== expectedId) ||
		!url ||
		!isAbsoluteHttpUrl(url) ||
		title === null ||
		favicon === null ||
		(thumbIdValue !== null && thumbId === null) ||
		sourceTabId === undefined ||
		sourceWindowId === undefined
	)
		return null;
	if (
		typeof createdAt !== "number" ||
		typeof expiresAt !== "number" ||
		!Number.isSafeInteger(createdAt) ||
		!Number.isSafeInteger(expiresAt)
	)
		return null;
	if (
		!Number.isFinite(now) ||
		createdAt > now ||
		expiresAt <= createdAt ||
		expiresAt - createdAt > PENDING_SAVE_TTL_MS ||
		isPendingSaveExpired({ expiresAt }, now)
	)
		return null;

	return {
		id,
		url: url.trim(),
		title,
		favicon,
		thumbId,
		sourceTabId,
		sourceWindowId,
		createdAt,
		expiresAt,
	};
}
