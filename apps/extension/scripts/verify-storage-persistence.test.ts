import { expect, test } from "bun:test";
import { requestStoragePersistence } from "../src/lib/storage-persistence";

test("storage persistence guard handles grant, denial, rejection and unsupported APIs", async () => {
	expect(await requestStoragePersistence({ persist: async () => true })).toBe(
		true,
	);
	expect(await requestStoragePersistence({ persist: async () => false })).toBe(
		false,
	);
	expect(
		await requestStoragePersistence({
			persist: async () => {
				throw new Error("Permission unavailable");
			},
		}),
	).toBe(false);
	expect(await requestStoragePersistence(null)).toBeNull();
});
