/**
 * Ask the browser to protect local extension data from automatic eviction.
 * Unsupported browsers and denied requests keep working normally.
 */
export async function requestStoragePersistence(
	storage: Pick<StorageManager, "persist"> | null = typeof navigator !==
	"undefined"
		? navigator.storage
		: null,
): Promise<boolean | null> {
	if (!storage || typeof storage.persist !== "function") return null;
	try {
		return await storage.persist();
	} catch {
		return false;
	}
}
