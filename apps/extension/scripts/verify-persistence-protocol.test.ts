/**
 * N1/D2 regression tests — the shared write protocol.
 * Run: cd apps/extension && bun test scripts/verify-persistence-protocol.test.ts
 *
 * N1: the background's read/write helpers must honor the reset-generation
 * protocol — a stamped envelope survives; an envelope older than the current
 * generation reads as "nothing stored"; writes carry the current stamp, so a
 * post-reset quick-save can no longer resurrect dead state invisibly.
 *
 * D2: a corrupt envelope must NOT be absorbed silently — the adapter
 * quarantines it (removes the bad bytes) and reports, matching the
 * localStorage branch's try/catch semantics.
 */

// In-memory chrome.storage.local shim. Functions in storage.ts consult the
// global `chrome` at call time, so setting this before the dynamic import
// (and even on a cached module instance) exercises the real protocol.
import "fake-indexeddb/auto";
import { DEFAULT_SETUP } from "../src/lib/constants";

const mem = new Map<string, unknown>();
let quotaUsageOverride: number | null = null;
let keyUsageOverride: number | null = null;
const storageArea = {
	async get(keys: string | string[] | Record<string, unknown>) {
		const wanted = Array.isArray(keys)
			? keys
			: typeof keys === "string"
				? [keys]
				: Object.keys(keys);
		const out: Record<string, unknown> = {};
		for (const key of wanted) {
			if (mem.has(key)) out[key] = mem.get(key);
		}
		return out;
	},
	async set(items: Record<string, unknown>) {
		for (const [key, value] of Object.entries(items)) mem.set(key, value);
	},
	async remove(keys: string | string[]) {
		for (const key of Array.isArray(keys) ? keys : [keys]) mem.delete(key);
	},
	async clear() {
		mem.clear();
	},
	async getBytesInUse(keys: string | string[] | null) {
		if (keys === null) {
			if (quotaUsageOverride !== null) return quotaUsageOverride;
			return [...mem.values()].reduce(
				(total, value) =>
					total + new TextEncoder().encode(String(value)).byteLength,
				0,
			);
		}
		if (keyUsageOverride !== null) return keyUsageOverride;
		return (Array.isArray(keys) ? keys : [keys]).reduce(
			(total, key) =>
				total +
				(mem.has(key)
					? new TextEncoder().encode(String(mem.get(key))).byteLength
					: 0),
			0,
		);
	},
};
(globalThis as Record<string, unknown>).chrome = {
	storage: {
		local: storageArea,
		onChanged: {
			addListener: () => undefined,
			removeListener: () => undefined,
		},
	},
};
(globalThis as Record<string, unknown>).localStorage = {
	getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
} as Storage;
(globalThis as Record<string, unknown>).window = {
	addEventListener: () => undefined,
	removeEventListener: () => undefined,
};
(globalThis as Record<string, unknown>).document = {
	addEventListener: () => undefined,
	removeEventListener: () => undefined,
	visibilityState: "visible",
	// motion-dom's frameloop is a process-wide singleton that reads the LIVE
	// `document` global on every tick (DocumentProjectionNode.measureScroll).
	// The render harnesses in this folder leave animations pending, so a stub
	// without `documentElement` makes a stray tick throw and aborts the run.
	// Keep the double document-shaped even though this file never renders.
	documentElement: { scrollLeft: 0, scrollTop: 0 },
};

import { expect, test } from "bun:test";

const {
	readSetupEnvelope,
	writeSetupEnvelope,
	chromeStorageAdapter,
	RESET_GENERATION_KEY,
	PERSIST_GENERATION_KEY,
	subscribeToPersistHealth,
	getPersistHealth,
	getResetGeneration,
	consumeOwnWriteEcho,
	getLastWrittenJSON,
} = await import("../src/lib/storage");

function sampleSetup() {
	return {
		folders: [{ id: "f1", name: "Home", order: 0, parentId: null }],
		cards: [],
		activeFolderId: "f1",
		itemOrder: { f1: [] },
		settings: {},
	} as never;
}

test("N1: envelope helpers stamp the generation and treat stale reads as empty", async () => {
	mem.clear();
	// Fresh install: no generation key, generation 0.
	await writeSetupEnvelope("perch-setup", sampleSetup());
	const raw = JSON.parse(mem.get("perch-setup") as string) as Record<
		string,
		unknown
	>;
	// The write carries the current stamp (previously the background wrote a
	// bare { state } envelope that every hydration discarded as generation 0
	// after a reset — N1's resurrect-dead-state mechanism).
	expect(typeof raw[PERSIST_GENERATION_KEY]).toBe("number");
	// Round-trip: the background reads back what it wrote.
	const readBack = await readSetupEnvelope("perch-setup");
	expect(readBack?.folders[0]?.id).toBe("f1");

	// A reset happened elsewhere: generation bumps to 1 (beginReset writes
	// the new barrier before deleting state).
	mem.set(RESET_GENERATION_KEY, 1);
	// The PRE-reset envelope must read as "nothing stored" — a quick-save
	// must never build on dead state (N1's core assertion).
	const stale = await readSetupEnvelope("perch-setup");
	expect(stale).toBeNull();

	// The post-reset save: writeSetupEnvelope stamps generation 1…
	await writeSetupEnvelope("perch-setup", sampleSetup());
	const raw2 = JSON.parse(mem.get("perch-setup") as string) as Record<
		string,
		unknown
	>;
	expect(raw2[PERSIST_GENERATION_KEY]).toBe(1);
	// …and the new envelope survives reads (the badge "✓" finally means the
	// data landed).
	const fresh = await readSetupEnvelope("perch-setup");
	expect(fresh?.folders[0]?.id).toBe("f1");
});

test("D2: corrupt envelope is quarantined and reported, not silently absorbed", async () => {
	mem.clear();
	mem.set("perch-setup", "{not valid json");
	// Pre-fix behavior: unguarded JSON.parse threw, zustand absorbed the
	// rejection, the app ran on defaults with hasHydrated=false forever and
	// the bad bytes stayed in storage.
	const result = await chromeStorageAdapter.getItem("perch-setup");
	expect(result).toBeNull();
	// Quarantine: the corrupt value is gone from storage, so the next write
	// replaces it cleanly and the session is not permanently degraded.
	expect(mem.has("perch-setup")).toBe(false);
	// A subsequent normal write + read round-trips.
	await writeSetupEnvelope("perch-setup", sampleSetup());
	const readBack = await readSetupEnvelope("perch-setup");
	expect(readBack?.folders[0]?.id).toBe("f1");
});

test("P5-A: persist health tracks queued, landed and failed writes", async () => {
	mem.clear();
	const events: string[] = [];
	const unsubscribe = subscribeToPersistHealth((health) => events.push(health));

	// A successful write passes through "unsaved" (queued in memory) to "ok".
	const payload = (name: string) =>
		({
			state: {
				folders: [{ id: "f1", name, order: 0, parentId: null }],
				cards: [],
				activeFolderId: "f1",
				itemOrder: { f1: [] },
				settings: {},
			},
			version: 0,
		}) as never;
	await chromeStorageAdapter.setItem("perch-setup", payload("Home"));
	expect(events).toContain("unsaved");
	expect(events[events.length - 1]).toBe("ok");
	expect(getPersistHealth()).toBe("ok");

	// A rejected write flips to "failed" — surfaced, never silent.
	const area = (globalThis as Record<string, unknown>).chrome as {
		storage: { local: { set: (items: unknown) => Promise<void> } };
	};
	const originalSet = area.storage.local.set.bind(area.storage.local);
	area.storage.local.set = async () => {
		throw new DOMException("quota full", "QuotaExceededError");
	};
	let rejected = false;
	try {
		await chromeStorageAdapter.setItem("perch-setup", payload("Home2"));
	} catch {
		rejected = true;
	}
	area.storage.local.set = originalSet as typeof area.storage.local.set;
	expect(rejected).toBe(true);
	expect(getPersistHealth()).toBe("failed");

	// Recovery: the next landed write returns to "ok".
	await chromeStorageAdapter.setItem("perch-setup", payload("Home3"));
	expect(getPersistHealth()).toBe("ok");
	expect(events[events.length - 1]).toBe("ok");
	unsubscribe();
});

test("quota preflight accounts for replacing the existing setup value", async () => {
	mem.clear();
	quotaUsageOverride = Math.floor(9.5 * 1024 * 1024) - 100;
	keyUsageOverride = 9 * 1024 * 1024;
	try {
		await chromeStorageAdapter.setItem("perch-setup", {
			state: sampleSetup(),
			version: 0,
		} as never);
		expect(getPersistHealth()).toBe("ok");
	} finally {
		quotaUsageOverride = null;
		keyUsageOverride = null;
	}
});

test("own storage change is recognized before the write promise resolves", async () => {
	const area = (globalThis as Record<string, unknown>).chrome as {
		storage: {
			local: { set: (items: Record<string, unknown>) => Promise<void> };
		};
	};
	const originalSet = area.storage.local.set.bind(area.storage.local);
	let observedEarlyEcho = false;
	area.storage.local.set = async (items) => {
		const raw = items["perch-setup"];
		if (typeof raw === "string") {
			// Chrome may deliver onChanged while set() is still pending. The old
			// completed-write guard does not recognize this value yet.
			expect(getLastWrittenJSON()).not.toBe(raw);
			observedEarlyEcho = consumeOwnWriteEcho(raw);
			expect(consumeOwnWriteEcho(raw)).toBe(false);
		}
		await originalSet(items);
	};
	try {
		await writeSetupEnvelope("perch-setup", {
			...sampleSetup(),
			folders: [{ id: "f1", name: "Early echo", order: 0, parentId: null }],
			settings: {
				...DEFAULT_SETUP.settings,
				colorScheme: "dark",
			},
		});
	} finally {
		area.storage.local.set = originalSet;
	}
	expect(observedEarlyEcho).toBe(true);
});

test("refresh cannot stamp a pre-reset snapshot into the new generation", async () => {
	const capturedGeneration = getResetGeneration();
	await writeSetupEnvelope("perch-setup", sampleSetup());
	const before = mem.get("perch-setup");
	mem.set(RESET_GENERATION_KEY, capturedGeneration + 1);
	await readSetupEnvelope("perch-setup");
	await expect(
		writeSetupEnvelope("perch-setup", sampleSetup(), capturedGeneration),
	).rejects.toThrow("Setup changed generation");
	expect(mem.get("perch-setup")).toBe(before);
	await writeSetupEnvelope("perch-setup", sampleSetup());
	expect(getPersistHealth()).toBe("ok");
});
