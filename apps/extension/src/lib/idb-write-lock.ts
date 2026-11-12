const IDB_WRITE_LOCK = "ktab-idb-write";

function currentLockManager(): Pick<LockManager, "request"> | null {
	if (typeof navigator === "undefined" || !navigator.locks?.request)
		return null;
	return navigator.locks;
}

/** Serialize IndexedDB mutations across extension pages and the worker. */
export function withIndexedDbWriteLock<T>(
	operation: () => Promise<T>,
	lockManager: Pick<LockManager, "request"> | null = currentLockManager(),
): Promise<T> {
	if (!lockManager) return operation();
	return lockManager.request(IDB_WRITE_LOCK, { mode: "exclusive" }, () =>
		operation(),
	) as unknown as Promise<T>;
}
