import { useEffect, useRef } from "react";
import type { Browser } from "wxt/browser";
import { extApi } from "../lib/extension-api";
import { mergeConcurrentSetup } from "../lib/merge-external-setup";
import {
	createStateSyncMessage,
	isStateSyncMessage,
	realtimeSettings,
	realtimeSettingsSignature,
	STATE_SYNC_CHANNEL,
} from "../lib/state-sync";
import {
	consumeOwnWriteEcho,
	getResetGeneration,
	normalizeState,
	PERSIST_GENERATION_KEY,
	readSetupEnvelope,
} from "../lib/storage";
import { useHistoryStore } from "../stores/history-store";
import { useSetupStore } from "../stores/setup-store";
import type { Setup } from "../types";

/**
 * Listen for storage changes from other tabs and update the store.
 *
 * The storage adapter records outgoing snapshots before storage.local.set.
 * onChanged may fire before that promise resolves; consuming the registered
 * value prevents our own write from replacing the live arrays and grid.
 */
export function useCrossTabSync() {
	const lastCommonSetup = useRef<Setup | null>(null);
	useEffect(() => {
		let storageCleanup: () => void = () => undefined;
		const extensionStorage = extApi()?.storage?.onChanged;
		if (extensionStorage) {
			type OnChangedCb = Parameters<
				(typeof Browser.storage.onChanged)["addListener"]
			>[0];
			let readSequence = 0;
			const handler: OnChangedCb = (changes, area) => {
				// "perch-setup" is the legacy persist name; kept for data continuity.
				if (area !== "local" || !changes["perch-setup"]) return;

				const newValue = changes["perch-setup"].newValue;
				if (!newValue) return;

				const raw =
					typeof newValue === "string" ? newValue : JSON.stringify(newValue);

				if (consumeOwnWriteEcho(raw)) {
					lastCommonSetup.current = useSetupStore.getState();
					return;
				}

				try {
					const parsed =
						typeof newValue === "string" ? JSON.parse(newValue) : newValue;

					if (!parsed || typeof parsed !== "object" || !("state" in parsed))
						return;

					const persistedGenerationValue = (parsed as Record<string, unknown>)[
						PERSIST_GENERATION_KEY
					];
					const persistedGeneration =
						typeof persistedGenerationValue === "number" &&
						Number.isSafeInteger(persistedGenerationValue) &&
						persistedGenerationValue >= 0
							? persistedGenerationValue
							: 0;
					if (persistedGeneration < getResetGeneration()) return;

					const sequence = ++readSequence;
					void readSetupEnvelope("perch-setup")
						.then((incoming) => {
							if (
								!incoming ||
								sequence !== readSequence ||
								persistedGeneration < getResetGeneration()
							)
								return;

							const current = useSetupStore.getState();
							const base = lastCommonSetup.current ?? current;
							const update = mergeConcurrentSetup(base, current, incoming);
							if (update) useSetupStore.setState(update);
							lastCommonSetup.current = update
								? { ...current, ...update }
								: current;

							// M4/NPD-3: external state arrived. Invalidate the redo branch and
							// prune undo entries whose snapshots no longer match live state —
							// stale cascades must never replay over another tab's writes.
							useHistoryStore
								.getState()
								.invalidateForExternalSync(buildLiveShape(incoming));
						})
						.catch(() => undefined);
				} catch {
					// Ignore parse errors
				}
			};

			extensionStorage.addListener(handler);
			storageCleanup = () => extensionStorage.removeListener(handler);
		}

		let channel: BroadcastChannel | null = null;
		if (typeof BroadcastChannel !== "undefined") {
			try {
				channel = new BroadcastChannel(STATE_SYNC_CHANNEL);
			} catch {
				channel = null;
			}
		}
		if (!channel) return storageCleanup;

		const senderId =
			globalThis.crypto?.randomUUID?.() ??
			`ktab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		let sequence = 0;
		let lastSentSignature = realtimeSettingsSignature(
			useSetupStore.getState().settings,
		);
		const receivedSequences = new Map<string, number>();
		const unsubscribe = useSetupStore.subscribe((state) => {
			const signature = realtimeSettingsSignature(state.settings);
			if (signature === lastSentSignature) return;
			lastSentSignature = signature;
			sequence += 1;
			try {
				channel?.postMessage(
					createStateSyncMessage(senderId, sequence, state.settings),
				);
			} catch {
				// Storage onChanged remains the fallback if a message cannot clone.
			}
		});

		channel.onmessage = (event: MessageEvent<unknown>) => {
			if (!isStateSyncMessage(event.data) || event.data.senderId === senderId)
				return;
			const previousSequence = receivedSequences.get(event.data.senderId) ?? 0;
			if (event.data.sequence <= previousSequence) return;
			receivedSequences.set(event.data.senderId, event.data.sequence);

			const current = useSetupStore.getState();
			const normalized = normalizeState({
				...current,
				settings: { ...current.settings, ...event.data.settings },
			});
			const nextSettings = {
				...current.settings,
				...realtimeSettings(normalized.settings),
			};
			lastSentSignature = realtimeSettingsSignature(nextSettings);
			lastCommonSetup.current = { ...current, settings: nextSettings };
			if (lastSentSignature !== realtimeSettingsSignature(current.settings)) {
				useSetupStore.setState({ settings: nextSettings });
			}
		};

		return () => {
			storageCleanup();
			unsubscribe();
			channel?.close();
		};
	}, []);
}

/**
 * Extract the id → parent/container shape the history store compares its
 * snapshots against (see invalidateForExternalSync).
 */
function buildLiveShape(setup: Setup): {
	cards: Map<string, string>;
	folders: Map<string, string | null>;
	containers: Record<string, string[]>;
} {
	const cards = new Map(setup.cards.map((card) => [card.id, card.folderId]));
	const folders = new Map(
		setup.folders.map((folder) => [folder.id, folder.parentId ?? null]),
	);
	const containers: Record<string, string[]> = {};
	for (const [container, keys] of Object.entries(setup.itemOrder ?? {})) {
		containers[container] = [...keys];
	}
	return { cards, folders, containers };
}
