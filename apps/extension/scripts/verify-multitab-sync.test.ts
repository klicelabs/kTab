import { expect, test } from "bun:test";
import { DEFAULT_SETUP } from "../src/lib/constants";
import { withIndexedDbWriteLock } from "../src/lib/idb-write-lock";
import {
	createStateSyncMessage,
	isStateSyncMessage,
	realtimeSettings,
	STATE_SYNC_CHANNEL,
} from "../src/lib/state-sync";

test("state sync publishes only theme, layout and wallpaper settings", () => {
	const message = createStateSyncMessage("tab-a", 1, DEFAULT_SETUP.settings);
	expect(STATE_SYNC_CHANNEL).toBe("ktab_state_sync");
	expect(isStateSyncMessage(message)).toBe(true);
	expect(Object.keys(message.settings)).toEqual(
		Object.keys(realtimeSettings(DEFAULT_SETUP.settings)),
	);
	expect(message).not.toHaveProperty("cards");
	expect(isStateSyncMessage({ ...message, sequence: -1 })).toBe(false);
	expect(isStateSyncMessage({ ...message, senderId: "" })).toBe(false);
});

test("BroadcastChannel delivers the state sync protocol to another page", async () => {
	const first = new BroadcastChannel(STATE_SYNC_CHANNEL);
	const second = new BroadcastChannel(STATE_SYNC_CHANNEL);
	try {
		const received = new Promise<unknown>((resolve) => {
			second.onmessage = (event: MessageEvent<unknown>) => resolve(event.data);
		});
		const message = createStateSyncMessage("tab-a", 2, DEFAULT_SETUP.settings);
		first.postMessage(message);
		expect(await received).toEqual(message);
	} finally {
		first.close();
		second.close();
	}
});

test("IndexedDB writes queue through one exclusive Web Lock", async () => {
	let tail = Promise.resolve();
	const requestedNames: string[] = [];
	const lockManager = {
		request: <T>(
			name: string,
			options: LockOptions,
			callback: () => Promise<T>,
		): Promise<T> => {
			requestedNames.push(`${name}:${options.mode}`);
			const result = tail.then(callback);
			tail = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
	} as unknown as Pick<LockManager, "request">;
	let active = 0;
	let maximumActive = 0;
	const operations = ["a", "b", "c"].map((name) =>
		withIndexedDbWriteLock(async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 4));
			active -= 1;
			return name;
		}, lockManager),
	);
	expect(await Promise.all(operations)).toEqual(["a", "b", "c"]);
	expect(maximumActive).toBe(1);
	expect(requestedNames).toEqual([
		"ktab-idb-write:exclusive",
		"ktab-idb-write:exclusive",
		"ktab-idb-write:exclusive",
	]);
});

test("IndexedDB writes still work when Web Locks are unavailable", async () => {
	await expect(
		withIndexedDbWriteLock(async () => "written", null),
	).resolves.toBe("written");
});
