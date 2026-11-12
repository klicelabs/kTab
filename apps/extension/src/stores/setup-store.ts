import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	GRID_GAP_PX,
	GRID_PADDING_X_PX,
	MAX_COLUMNS,
	MIN_COLUMNS,
	TILE_SIZE_DIMENSIONS,
} from "../lib/constants";
import {
	readFirstPaintSnapshot,
	snapshotPatch,
} from "../lib/first-paint-snapshot";
import { getSubtreeIds, wouldCreateCycle } from "../lib/folder-tree";
import type { HistoryEntry, HistorySnapshot } from "../lib/history";
import { nextHistoryEntryId, sameKeys } from "../lib/history-capture";
import {
	containerKeyOf,
	type ItemOrder,
	type ItemRef,
	insertCardsBlock,
	itemKey,
	parseItemKey,
	ROOT_CONTAINER,
	reindexOrders,
	reorderGroupKeys,
	repairItemOrder,
} from "../lib/item-order";
import { prepareQuickLink, reorderQuickLinks } from "../lib/quick-links";
import {
	beginReset,
	cancelPendingPersist,
	chromeStorageAdapter,
	flushPersist,
	normalizeState,
} from "../lib/storage";
import { clampInt, uid as generateId, safeTileSize } from "../lib/utils";
import { resetWallpaperCache } from "../lib/wallpaper-coordination";
import type { Card, QuickLink, Settings, Setup } from "../types";
import { useHistoryStore } from "./history-store";
import { useImageStore } from "./image-store";

export type InsertPosition = "before" | "after";

interface SetupActions {
	addFolder: (name: string, parentId?: string | null) => string;
	/** Atomically create a folder and place the selected items inside it. */
	createFolderFromSelection: (
		name: string,
		parentId: string | null,
		selectedIds: string[],
	) => string | null;
	updateFolder: (id: string, name: string) => void;
	moveFolder: (id: string, parentId: string | null) => void;
	moveFolders: (ids: string[], parentId: string | null) => void;
	deleteFolder: (id: string) => void;
	reorderFolders: (
		draggedId: string,
		targetId: string,
		position?: InsertPosition,
	) => void;
	setActiveFolder: (id: string) => void;
	addCard: (
		card: Omit<Card, "id" | "order" | "origin" | "capturedAt">,
	) => string;
	updateCard: (
		id: string,
		changes: Partial<Card>,
		options?: { history?: boolean },
	) => void;
	moveCard: (id: string, folderId: string) => void;
	/** Atomically insert a card before/after a card in a target folder. */
	insertCardAt: (
		targetFolderId: string,
		cardId: string,
		targetCardId: string,
		position?: InsertPosition,
	) => void;
	moveCards: (ids: string[], folderId: string) => void;
	/**
	 * Move a mixed group of cards + folders into one folder in a SINGLE set()
	 * (one coalesced storage write — no half-moved window). Order within each
	 * kind follows the input arrays. Folders that would create a cycle are
	 * skipped in place; unknown ids are ignored.
	 */
	moveItemsToContainer: (
		folderId: string | null,
		cardIds: string[],
		folderIds: string[],
	) => void;
	deleteCard: (id: string) => void;
	reorderCardsInActiveFolder: (
		draggedId: string,
		targetId: string,
		position?: InsertPosition,
	) => void;
	/**
	 * Move any item (card or folder) to before/after another item inside one
	 * container. Powers live mixed reorder in the grid. Never reparents.
	 */
	reorderItems: (
		container: string,
		dragged: ItemRef,
		target: ItemRef,
		position: InsertPosition,
	) => void;
	/**
	 * Move a source-ordered group of ids as one contiguous block to
	 * before/after a target inside one container. One set(), one write —
	 * hover reorder treats the selection as a single operation, never N
	 * independent member moves. Never reparents; unknown ids and a target
	 * inside the block are no-ops.
	 */
	reorderGroup: (
		container: string,
		groupIds: string[],
		target: ItemRef,
		position: InsertPosition,
	) => void;
	/**
	 * Move a source-ordered block of cards to before/after a target card in
	 * one folder (reparenting when needed). One set() — folder-preview drops
	 * commit the group once instead of once per member.
	 */
	insertCardsAt: (
		targetFolderId: string,
		cardIds: string[],
		targetCardId: string,
		position?: InsertPosition,
	) => void;
	/**
	 * Apply one history snapshot (undo/redo): replace the listed containers
	 * wholesale, reparent the listed entities, restore deleted entities and
	 * remove created ones — in a single set() with a legacy-order reindex.
	 * Unknown ids are ignored, so entries stay safe even if entities were
	 * deleted afterwards.
	 */
	applyHistorySnapshot: (snapshot: HistorySnapshot) => void;
	/**
	 * Live reorder preview during an in-gesture hover: mutates itemOrder
	 * ONLY, never the legacy `order` fields. The real commit runs at drop
	 * via reorderItems, whose reindex converges the legacy fields (H4:
	 * history must capture the drop, not the first hover).
	 */
	previewReorderItems: (
		container: string,
		dragged: ItemRef,
		target: ItemRef,
		position: InsertPosition,
	) => void;
	/**
	 * Restore a previously snapshotted ordering (drag cancellation). Replaces
	 * the order map wholesale and reindexes legacy fields so readers that
	 * still sort by `order` see the same sequence.
	 */
	restoreItemOrder: (snapshot: ItemOrder) => void;
	/**
	 * Atomically create a subfolder containing two cards of one container.
	 * Returns the new folder id, or null when the pair is invalid (nothing
	 * is mutated, so neither bookmark can be lost).
	 */
	createSubfolderFromCards: (
		containerFolderId: string,
		firstCardId: string,
		secondCardId: string,
		name: string,
	) => string | null;
	updateSettings: (changes: Partial<Settings>) => void;
	updateBackground: (changes: Partial<Settings["background"]>) => void;
	updateClock: (changes: Partial<Settings["clock"]>) => void;
	updateGreeting: (changes: Partial<Settings["greeting"]>) => void;
	updateWeather: (changes: Partial<Settings["weather"]>) => void;
	updateSearch: (changes: Partial<Settings["search"]>) => void;
	updateQuickLinks: (changes: Partial<Settings["quickLinks"]>) => void;
	addQuickLink: (link: Omit<QuickLink, "id">) => string | null;
	moveQuickLink: (
		id: string,
		targetId: string,
		position: "before" | "after",
	) => void;
	updateQuickLink: (
		id: string,
		changes: Partial<Pick<QuickLink, "label" | "url">>,
	) => void;
	removeQuickLink: (id: string) => void;
	updateThumbnailCapture: (
		changes: Partial<Settings["thumbnailCapture"]>,
	) => void;
	/**
	 * Replace the single confirmed custom wallpaper slot and make it active.
	 * The caller saves the new image bytes before invoking this action.
	 */
	commitCustomWallpaper: (entry: { id: string; name: string }) => void;
	/** Remove the custom wallpaper slot (bytes are deleted by the caller). */
	removeCustomWallpaper: (id: string) => void;
	replaceSetup: (setup: Setup) => void;
	resetAll: () => Promise<void>;
}

export type SetupStore = Setup & SetupActions;

function applySettingsUpdate(
	state: SetupStore,
	changes: Partial<Settings>,
): Pick<SetupStore, "settings"> {
	return { settings: { ...state.settings, ...changes } };
}

type NestedSettingsKey =
	| "background"
	| "clock"
	| "greeting"
	| "quickLinks"
	| "search"
	| "thumbnailCapture"
	| "weather";

function applyNestedSettingsUpdate<K extends NestedSettingsKey>(
	state: SetupStore,
	key: K,
	changes: Partial<Settings[K]>,
): Pick<SetupStore, "settings"> {
	return {
		settings: {
			...state.settings,
			[key]: { ...state.settings[key], ...changes },
		},
	};
}

/**
 * Every structural mutation below keeps the unified `itemOrder` map in sync
 * and reindexes the legacy `order` fields from it, so the two models can
 * never drift apart. All multi-entity moves run inside a single `set()`,
 * making them atomic for persistence (one coalesced storage write).
 */
/**
 * polish/first-paint-snapshot: seed creation with the localStorage mirror so
 * the first render already reflects the user's display flags. Creation-time
 * seeding (not a post-creation setState) schedules NO persist write — a
 * set() before hydration resolves could otherwise flush pre-hydration
 * defaults over stored data on slow boots (data loss). Storage still wins
 * once it resolves.
 */
function preHydratedInitialState(): Setup {
	const base = normalizeState(null);
	const snap = readFirstPaintSnapshot();
	if (!snap || Object.keys(snap).length === 0) return base;
	return { ...base, ...snapshotPatch(base, snap) };
}

export const useSetupStore = create<SetupStore>()(
	persist(
		(set, get) => ({
			...preHydratedInitialState(),

			addFolder: (name, parentId = null) => {
				const id = generateId();
				const container = containerKeyOf(parentId);
				set((s) => {
					const base = s.itemOrder ?? {};
					const itemOrder: ItemOrder = {
						...base,
						[container]: [...(base[container] ?? []), itemKey("folder", id)],
						[id]: base[id] ?? [],
					};
					const folders = [
						...s.folders,
						{ id, name, order: (base[container] ?? []).length, parentId },
					];
					return { ...reindexOrders(folders, s.cards, itemOrder), itemOrder };
				});
				return id;
			},

			createFolderFromSelection: (name, parentId, selectedIds) => {
				const nextName = name.trim();
				if (nextName.length === 0 || selectedIds.length === 0) return null;

				const id = generateId();
				let created = false;

				set((s) => {
					if (
						parentId !== null &&
						!s.folders.some((folder) => folder.id === parentId)
					)
						return {};

					const cardById = new Map(s.cards.map((card) => [card.id, card]));
					const folderById = new Map(
						s.folders.map((folder) => [folder.id, folder]),
					);
					const cardIds: string[] = [];
					const folderIds: string[] = [];
					const seen = new Set<string>();

					for (const selectedId of selectedIds) {
						if (seen.has(selectedId)) continue;
						seen.add(selectedId);

						if (cardById.has(selectedId)) {
							cardIds.push(selectedId);
							continue;
						}

						const folder = folderById.get(selectedId);
						if (!folder) continue;
						// Creating a child below an ancestor of a selected folder would
						// make the subsequent move cyclic. Reject the full operation so
						// the user never gets a partially grouped selection.
						if (wouldCreateCycle(s.folders, folder.id, parentId)) return {};
						folderIds.push(selectedId);
					}

					if (cardIds.length === 0 && folderIds.length === 0) return {};

					const movedCards = new Set(cardIds);
					const movedFolders = new Set(folderIds);
					const movedKeys = selectedIds.flatMap((selectedId) => {
						if (movedCards.has(selectedId))
							return [itemKey("card", selectedId)];
						if (movedFolders.has(selectedId))
							return [itemKey("folder", selectedId)];
						return [];
					});
					const base = s.itemOrder ?? {};
					const parentContainer = containerKeyOf(parentId);
					const itemOrder: ItemOrder = {
						...base,
						[parentContainer]: [
							...(base[parentContainer] ?? []),
							itemKey("folder", id),
						],
					};
					const movedKeySet = new Set(movedKeys);

					for (const [container, keys] of Object.entries(itemOrder)) {
						const next = keys.filter((key) => !movedKeySet.has(key));
						if (next.length !== keys.length) itemOrder[container] = next;
					}
					itemOrder[id] = movedKeys;

					const folders = [
						...s.folders,
						{ id, name: nextName, order: 0, parentId },
					];
					const cards = s.cards.map((card) =>
						movedCards.has(card.id) ? { ...card, folderId: id } : card,
					);
					const nextFolders = folders.map((folder) =>
						movedFolders.has(folder.id) ? { ...folder, parentId: id } : folder,
					);

					created = true;
					return {
						...reindexOrders(nextFolders, cards, itemOrder),
						itemOrder,
					};
				});

				return created ? id : null;
			},

			updateFolder: (id, name) =>
				set((s) => ({
					folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
				})),

			moveFolder: (id, parentId) =>
				set((s) => {
					if (id === parentId) return {};
					if (wouldCreateCycle(s.folders, id, parentId)) return {};
					const folder = s.folders.find((f) => f.id === id);
					if (!folder) return {};
					const fromContainer = containerKeyOf(folder.parentId ?? null);
					const toContainer = containerKeyOf(parentId);
					const base = s.itemOrder ?? {};
					const itemOrder: ItemOrder = { ...base };
					if (fromContainer !== toContainer) {
						const key = itemKey("folder", id);
						itemOrder[fromContainer] = (base[fromContainer] ?? []).filter(
							(k) => k !== key,
						);
						itemOrder[toContainer] = [...(base[toContainer] ?? []), key];
					}
					if (!(id in itemOrder)) itemOrder[id] = base[id] ?? [];
					const folders = s.folders.map((f) =>
						f.id === id ? { ...f, parentId } : f,
					);
					return { ...reindexOrders(folders, s.cards, itemOrder), itemOrder };
				}),

			moveFolders: (ids, parentId) =>
				set((s) => {
					const valid = ids.filter(
						(id) =>
							id !== parentId &&
							!wouldCreateCycle(s.folders, id, parentId) &&
							s.folders.some((f) => f.id === id),
					);
					if (valid.length === 0) return {};
					const validSet = new Set(valid);
					const base = s.itemOrder ?? {};
					const itemOrder: ItemOrder = { ...base };
					for (const [container, keys] of Object.entries(itemOrder)) {
						const next = keys.filter((k) => {
							const ref = parseItemKey(k);
							return !(ref && ref.kind === "folder" && validSet.has(ref.id));
						});
						if (next.length !== keys.length) itemOrder[container] = next;
					}
					const toContainer = containerKeyOf(parentId);
					itemOrder[toContainer] = [
						...(itemOrder[toContainer] ?? []),
						...valid.map((id) => itemKey("folder", id)),
					];
					for (const id of valid) {
						if (!(id in itemOrder)) itemOrder[id] = base[id] ?? [];
					}
					const folders = s.folders.map((f) =>
						validSet.has(f.id) ? { ...f, parentId } : f,
					);
					return { ...reindexOrders(folders, s.cards, itemOrder), itemOrder };
				}),

			deleteFolder: (id) =>
				set((s) => {
					// Never delete the last remaining root folder.
					const roots = s.folders.filter((f) => (f.parentId ?? null) === null);
					const target = s.folders.find((f) => f.id === id);
					if (!target) return {};
					if ((target.parentId ?? null) === null && roots.length <= 1)
						return {};

					const removedFolderIds = new Set(getSubtreeIds(s.folders, id));
					const removedCards = s.cards.filter((c) =>
						removedFolderIds.has(c.folderId),
					);
					const removedCount = removedCards.length;
					const folderCount = removedFolderIds.size - 1;
					// H2: capture the full inverse BEFORE mutating. Gesture-scoped
					// captures belong to the DnD layer, so manual deletes build the
					// equivalent diff deltas by hand (same vocabulary as
					// buildHistoryEntry: touched containers/parents + full records).
					const base = s.itemOrder ?? {};
					const undoContainers: Record<string, string[]> = {};
					const redoContainers: Record<string, string[]> = {};
					const touchedContainers = new Set([
						...Object.keys(base),
						...removedFolderIds,
					]);
					for (const container of touchedContainers) {
						const before = base[container] ?? [];
						if (removedFolderIds.has(container)) {
							// The whole container record disappears.
							if (before.length > 0) undoContainers[container] = [...before];
							continue;
						}
						const after = before.filter((k) => {
							const ref = parseItemKey(k);
							if (!ref) return false;
							return ref.kind === "folder"
								? !removedFolderIds.has(ref.id)
								: !removedFolderIds.has(
										s.cards.find((c) => c.id === ref.id)?.folderId ?? "",
									);
						});
						if (!sameKeys(before, after)) {
							undoContainers[container] = [...before];
							redoContainers[container] = after;
						}
					}
					const undoCards: Record<string, string> = {};
					const redoCards: Record<string, string> = {};
					const undoFolders: Record<string, string | null> = {};
					const redoFolders: Record<string, string | null> = {};
					const undoPutCards = removedCards.map((c) => ({ ...c }));
					const undoPutFolders = s.folders
						.filter((f) => removedFolderIds.has(f.id))
						.map((f) => ({ ...f }));
					// P3 (decisão A): bytes are tombstoned on the entry, NOT deleted
					// at the act — an undo must find every thumbnail back.
					const thumbIds = [
						...new Set(
							removedCards
								.map((c) => c.thumbId)
								.filter((t): t is string => Boolean(t)),
						),
					];
					const entryId = nextHistoryEntryId();
					const remainingFolders = s.folders.filter(
						(f) => !removedFolderIds.has(f.id),
					);
					const remainingCards = s.cards.filter(
						(c) => !removedFolderIds.has(c.folderId),
					);
					const remainingCardIds = new Set(remainingCards.map((c) => c.id));
					const itemOrder: ItemOrder = {};
					for (const [container, keys] of Object.entries(s.itemOrder ?? {})) {
						if (removedFolderIds.has(container)) continue;
						itemOrder[container] = keys.filter((k) => {
							const ref = parseItemKey(k);
							if (!ref) return false;
							return ref.kind === "folder"
								? !removedFolderIds.has(ref.id)
								: remainingCardIds.has(ref.id);
						});
					}
					const nextActive = removedFolderIds.has(s.activeFolderId)
						? target.parentId &&
							remainingFolders.some((f) => f.id === target.parentId)
							? target.parentId
							: remainingFolders.find((f) => (f.parentId ?? null) === null)
									?.id ||
								remainingFolders[0]?.id ||
								"default"
						: s.activeFolderId;

					const reindexed = reindexOrders(
						remainingFolders,
						remainingCards,
						itemOrder,
					);
					// H2: stage one atomic delete entry in the history store. The
					// entry carries the full subtree (containers, parents, records)
					// so undo restores exactly what the user saw before deleting.
					const entry: HistoryEntry = {
						id: entryId,
						at: Date.now(),
						summary: {
							kind: "delete" as const,
							total: 1,
							cardCount: removedCount,
							folderCount,
							label: target.name,
						},
						undo: {
							containers: undoContainers,
							cards: undoCards,
							folders: undoFolders,
							putCards: undoPutCards,
							putFolders: undoPutFolders,
							delCardIds: [],
							delFolderIds: [],
						},
						redo: {
							containers: redoContainers,
							cards: redoCards,
							folders: redoFolders,
							putCards: [],
							putFolders: [],
							delCardIds: removedCards.map((c) => c.id),
							delFolderIds: [...removedFolderIds],
						},
					};
					if (thumbIds.length > 0) entry.thumbnails = thumbIds;
					useHistoryStore.getState().commit(entry);
					return { ...reindexed, itemOrder, activeFolderId: nextActive };
				}),

			reorderFolders: (draggedId, targetId, position = "before") =>
				set((s) => {
					const dragged = s.folders.find((f) => f.id === draggedId);
					const target = s.folders.find((f) => f.id === targetId);
					if (!dragged || !target || draggedId === targetId) return {};
					// Only reorder within the same parent; cross-parent moves use moveFolder.
					if ((dragged.parentId ?? null) !== (target.parentId ?? null))
						return {};

					const container = containerKeyOf(dragged.parentId ?? null);
					const base = s.itemOrder ?? {};
					const keys = [...(base[container] ?? [])];
					const dKey = itemKey("folder", draggedId);
					const tKey = itemKey("folder", targetId);
					if (!keys.includes(dKey) || !keys.includes(tKey)) return {};
					const next = keys.filter((k) => k !== dKey);
					const to = next.indexOf(tKey);
					if (to === -1) return {};
					next.splice(position === "after" ? to + 1 : to, 0, dKey);
					const itemOrder: ItemOrder = { ...base, [container]: next };
					return {
						...reindexOrders(s.folders, s.cards, itemOrder),
						itemOrder,
					};
				}),

			setActiveFolder: (id) => set({ activeFolderId: id }),

			addCard: (partial) => {
				const state = get();
				const id = generateId();
				const container = partial.folderId;
				const base = state.itemOrder ?? {};
				const card: Card = {
					...partial,
					id,
					order: (base[container] ?? []).filter((k) => k.startsWith("card:"))
						.length,
					origin: "local",
					capturedAt: null,
				};
				const itemOrder: ItemOrder = {
					...base,
					[container]: [...(base[container] ?? []), itemKey("card", id)],
				};
				const reindexed = reindexOrders(
					state.folders,
					[...state.cards, card],
					itemOrder,
				);
				set({ ...reindexed, itemOrder });
				return id;
			},

			updateCard: (id, changes, options) =>
				set((s) => {
					const before = s.cards.find((card) => card.id === id);
					if (!before) return {};
					const after = { ...before, ...changes };
					const changedKeys = (
						Object.keys(changes) as Array<keyof Card>
					).filter((key) => before[key] !== after[key]);
					if (changedKeys.length === 0) return {};
					if (options?.history) {
						const beforePatch: Partial<Card> = {};
						const afterPatch: Partial<Card> = {};
						for (const key of changedKeys) {
							(beforePatch as Record<string, unknown>)[key] = before[key];
							(afterPatch as Record<string, unknown>)[key] = after[key];
						}
						useHistoryStore.getState().commit({
							id: nextHistoryEntryId(),
							at: Date.now(),
							summary: {
								kind: "update",
								total: 1,
								cardCount: 1,
								folderCount: 0,
								label: before.title || before.url,
							},
							undo: {
								containers: {},
								cards: {},
								folders: {},
								putCards: [],
								putFolders: [],
								delCardIds: [],
								delFolderIds: [],
								cardPatches: { [id]: beforePatch },
							},
							redo: {
								containers: {},
								cards: {},
								folders: {},
								putCards: [],
								putFolders: [],
								delCardIds: [],
								delFolderIds: [],
								cardPatches: { [id]: afterPatch },
							},
						});
					}
					return {
						cards: s.cards.map((card) => (card.id === id ? after : card)),
					};
				}),

			moveCard: (id, folderId) =>
				set((s) => {
					const card = s.cards.find((c) => c.id === id);
					if (!card || card.folderId === folderId) return {};
					const key = itemKey("card", id);
					const base = s.itemOrder ?? {};
					const itemOrder: ItemOrder = { ...base };
					for (const [container, keys] of Object.entries(itemOrder)) {
						if (keys.includes(key)) {
							itemOrder[container] = keys.filter((k) => k !== key);
						}
					}
					itemOrder[folderId] = [...(itemOrder[folderId] ?? []), key];
					const cards = s.cards.map((c) =>
						c.id === id ? { ...c, folderId } : c,
					);
					return { ...reindexOrders(s.folders, cards, itemOrder), itemOrder };
				}),

			insertCardAt: (
				targetFolderId,
				cardId,
				targetCardId,
				position = "before",
			) =>
				set((s) => {
					if (cardId === targetCardId) return {};
					const dragged = s.cards.find((card) => card.id === cardId);
					const target = s.cards.find((card) => card.id === targetCardId);
					if (!dragged || !target || target.folderId !== targetFolderId)
						return {};

					const base = s.itemOrder ?? {};
					const draggedKey = itemKey("card", cardId);
					const targetKey = itemKey("card", targetCardId);
					const targetKeys = [...(base[targetFolderId] ?? [])].filter(
						(key) => key !== draggedKey,
					);
					const targetIndex = targetKeys.indexOf(targetKey);
					if (targetIndex === -1) return {};

					const itemOrder: ItemOrder = {};
					for (const [container, keys] of Object.entries(base)) {
						itemOrder[container] = keys.filter((key) => key !== draggedKey);
					}
					const insertAt = position === "after" ? targetIndex + 1 : targetIndex;
					targetKeys.splice(insertAt, 0, draggedKey);
					itemOrder[targetFolderId] = targetKeys;

					const cards = s.cards.map((card) =>
						card.id === cardId ? { ...card, folderId: targetFolderId } : card,
					);
					return {
						...reindexOrders(s.folders, cards, itemOrder),
						itemOrder,
					};
				}),

			moveCards: (ids, folderId) =>
				set((s) => {
					const existing = new Set(s.cards.map((c) => c.id));
					const valid = ids.filter((id) => existing.has(id));
					if (valid.length === 0) return {};
					const validSet = new Set(valid);
					const base = s.itemOrder ?? {};
					const itemOrder: ItemOrder = { ...base };
					for (const [container, keys] of Object.entries(itemOrder)) {
						const next = keys.filter((k) => {
							const ref = parseItemKey(k);
							return !(ref && ref.kind === "card" && validSet.has(ref.id));
						});
						if (next.length !== keys.length) itemOrder[container] = next;
					}
					itemOrder[folderId] = [
						...(itemOrder[folderId] ?? []),
						...valid.map((id) => itemKey("card", id)),
					];
					const cards = s.cards.map((c) =>
						validSet.has(c.id) ? { ...c, folderId } : c,
					);
					return { ...reindexOrders(s.folders, cards, itemOrder), itemOrder };
				}),

			moveItemsToContainer: (folderId, cardIds, folderIds) =>
				set((s) => {
					const existingCards = new Set(s.cards.map((c) => c.id));
					// Bookmarks cannot live at the top level; folders hoist to
					// root through the shared root container key.
					const validCards =
						folderId === null
							? []
							: cardIds.filter((id) => existingCards.has(id));
					const validFolders = folderIds.filter(
						(id) =>
							id !== folderId &&
							!wouldCreateCycle(s.folders, id, folderId) &&
							s.folders.some((f) => f.id === id),
					);
					if (validCards.length === 0 && validFolders.length === 0) return {};
					const validCardSet = new Set(validCards);
					const validFolderSet = new Set(validFolders);
					const base = s.itemOrder ?? {};
					const itemOrder: ItemOrder = { ...base };
					for (const [container, keys] of Object.entries(itemOrder)) {
						const next = keys.filter((k) => {
							const ref = parseItemKey(k);
							if (!ref) return false;
							if (ref.kind === "card" && validCardSet.has(ref.id)) return false;
							if (ref.kind === "folder" && validFolderSet.has(ref.id))
								return false;
							return true;
						});
						if (next.length !== keys.length) itemOrder[container] = next;
					}
					const targetKey = containerKeyOf(folderId);
					itemOrder[targetKey] = [
						...(itemOrder[targetKey] ?? []),
						...validCards.map((id) => itemKey("card", id)),
						...validFolders.map((id) => itemKey("folder", id)),
					];
					for (const id of validFolders) {
						if (!(id in itemOrder)) itemOrder[id] = base[id] ?? [];
					}
					const cards = s.cards.map((c) =>
						validCardSet.has(c.id) ? { ...c, folderId: folderId as string } : c,
					);
					const folders = s.folders.map((f) =>
						validFolderSet.has(f.id) ? { ...f, parentId: folderId } : f,
					);
					return {
						...reindexOrders(folders, cards, itemOrder),
						itemOrder,
					};
				}),

			deleteCard: (id) =>
				set((s) => {
					const card = s.cards.find((c) => c.id === id);
					if (!card) return {};
					const key = itemKey("card", id);
					const base = s.itemOrder ?? {};
					const itemOrder: ItemOrder = { ...base };
					const undoContainers: Record<string, string[]> = {};
					const redoContainers: Record<string, string[]> = {};
					for (const [container, keys] of Object.entries(itemOrder)) {
						if (keys.includes(key)) {
							undoContainers[container] = [...keys];
							itemOrder[container] = keys.filter((k) => k !== key);
							redoContainers[container] = [...itemOrder[container]];
						}
					}
					// L4: a folder emptied by this delete leaves a ghost container
					// (empty array) in itemOrder forever; prune non-root empties.
					for (const [container, keys] of Object.entries(itemOrder)) {
						if (container !== ROOT_CONTAINER && keys.length === 0) {
							delete itemOrder[container];
						}
					}
					// H2: single-bookmark delete now reverses too. Tombstone the
					// thumb id on the entry (P3): bytes stay while undoable.
					const entry: HistoryEntry = {
						id: nextHistoryEntryId(),
						at: Date.now(),
						summary: {
							kind: "delete" as const,
							total: 1,
							cardCount: 1,
							folderCount: 0,
							label: card.title || card.url,
						},
						undo: {
							containers: undoContainers,
							cards: {},
							folders: {},
							putCards: [{ ...card }],
							putFolders: [],
							delCardIds: [],
							delFolderIds: [],
						},
						redo: {
							containers: redoContainers,
							cards: {},
							folders: {},
							putCards: [],
							putFolders: [],
							delCardIds: [id],
							delFolderIds: [],
						},
					};
					if (card.thumbId) entry.thumbnails = [card.thumbId];
					useHistoryStore.getState().commit(entry);
					return {
						cards: s.cards.filter((c) => c.id !== id),
						itemOrder,
					};
				}),

			reorderCardsInActiveFolder: (draggedId, targetId, position = "before") =>
				set((s) => {
					const container = s.activeFolderId;
					const base = s.itemOrder ?? {};
					const keys = [...(base[container] ?? [])];
					const dKey = itemKey("card", draggedId);
					const tKey = itemKey("card", targetId);
					if (!keys.includes(dKey) || !keys.includes(tKey)) return {};
					const next = keys.filter((k) => k !== dKey);
					const to = next.indexOf(tKey);
					if (to === -1) return {};
					next.splice(position === "after" ? to + 1 : to, 0, dKey);
					const itemOrder: ItemOrder = { ...base, [container]: next };
					return {
						...reindexOrders(s.folders, s.cards, itemOrder),
						itemOrder,
					};
				}),

			reorderItems: (container, dragged, target, position) =>
				set((s) => {
					if (dragged.id === target.id) return {};
					const base = s.itemOrder ?? {};
					const keys = [...(base[container] ?? [])];
					const dKey = itemKey(dragged.kind, dragged.id);
					const tKey = itemKey(target.kind, target.id);
					if (!keys.includes(dKey) || !keys.includes(tKey)) return {};
					const next = keys.filter((k) => k !== dKey);
					const to = next.indexOf(tKey);
					if (to === -1) return {};
					next.splice(position === "after" ? to + 1 : to, 0, dKey);
					const itemOrder: ItemOrder = { ...base, [container]: next };
					return {
						...reindexOrders(s.folders, s.cards, itemOrder),
						itemOrder,
					};
				}),

			previewReorderItems: (container, dragged, target, position) =>
				set((s) => {
					if (dragged.id === target.id) return {};
					const base = s.itemOrder ?? {};
					const keys = [...(base[container] ?? [])];
					const dKey = itemKey(dragged.kind, dragged.id);
					const tKey = itemKey(target.kind, target.id);
					if (!keys.includes(dKey) || !keys.includes(tKey)) return {};
					const next = keys.filter((k) => k !== dKey);
					const to = next.indexOf(tKey);
					if (to === -1) return {};
					next.splice(position === "after" ? to + 1 : to, 0, dKey);
					// H4: order-array write only — legacy `order` fields stay
					// untouched until the drop commits via reorderItems.
					return { itemOrder: { ...base, [container]: next } };
				}),

			restoreItemOrder: (snapshot) =>
				set((s) => {
					const itemOrder: ItemOrder = {};
					for (const [container, keys] of Object.entries(snapshot)) {
						itemOrder[container] = [...keys];
					}
					return {
						...reindexOrders(s.folders, s.cards, itemOrder),
						itemOrder,
					};
				}),

			reorderGroup: (container, groupIds, target, position) =>
				set((s) => {
					const base = s.itemOrder ?? {};
					const keys = base[container];
					if (!keys) return {};
					const cardIds = new Set(s.cards.map((c) => c.id));
					const folderIds = new Set(s.folders.map((f) => f.id));
					const draggedKeys = groupIds.flatMap((id) => {
						if (cardIds.has(id)) return [itemKey("card", id)];
						if (folderIds.has(id)) return [itemKey("folder", id)];
						return [];
					});
					const tKey = itemKey(target.kind, target.id);
					const next = reorderGroupKeys(keys, draggedKeys, tKey, position);
					if (!next) return {};
					const itemOrder: ItemOrder = { ...base, [container]: next };
					return {
						...reindexOrders(s.folders, s.cards, itemOrder),
						itemOrder,
					};
				}),

			insertCardsAt: (
				targetFolderId,
				cardIds,
				targetCardId,
				position = "before",
			) =>
				set((s) => {
					const existing = new Set(s.cards.map((c) => c.id));
					const block = cardIds.filter(
						(id) => existing.has(id) && id !== targetCardId,
					);
					if (block.length === 0) return {};
					const target = s.cards.find((c) => c.id === targetCardId);
					if (!target || target.folderId !== targetFolderId) return {};
					const base = s.itemOrder ?? {};
					const draggedKeys = block.map((id) => itemKey("card", id));
					const itemOrder = insertCardsBlock(
						base,
						targetFolderId,
						draggedKeys,
						itemKey("card", targetCardId),
						position,
					);
					if (!itemOrder) return {};
					const blockSet = new Set(block);
					const cards = s.cards.map((c) =>
						blockSet.has(c.id) ? { ...c, folderId: targetFolderId } : c,
					);
					return {
						...reindexOrders(s.folders, cards, itemOrder),
						itemOrder,
					};
				}),

			applyHistorySnapshot: (snapshot) =>
				set((s) => {
					const base = s.itemOrder ?? {};
					const itemOrder: ItemOrder = { ...base };
					for (const [container, keys] of Object.entries(snapshot.containers)) {
						itemOrder[container] = [...keys];
					}
					const delCards = new Set(snapshot.delCardIds ?? []);
					const delFolders = new Set(snapshot.delFolderIds ?? []);
					let cards = s.cards.filter((c) => !delCards.has(c.id));
					let folders = s.folders.filter((f) => !delFolders.has(f.id));
					for (const record of snapshot.putCards ?? []) {
						cards = cards.some((c) => c.id === record.id)
							? cards.map((c) => (c.id === record.id ? { ...record } : c))
							: [...cards, { ...record }];
					}
					// M1: rename snapshots ship nameOnlyIds so the applier merges ONLY
					// the name into the live record — replaying a stale full record
					// would clobber concurrent fields (order, parentId). putFolders
					// stays populated for backward compatibility but is not applied
					// wholesale for these ids.
					const nameOnly = new Set(snapshot.nameOnlyIds ?? []);
					for (const record of snapshot.putFolders ?? []) {
						if (nameOnly.has(record.id)) {
							// Merge only the name; every other field stays live.
							folders = folders.map((f) =>
								f.id === record.id ? { ...f, name: record.name } : f,
							);
							continue;
						}
						folders = folders.some((f) => f.id === record.id)
							? folders.map((f) => (f.id === record.id ? { ...record } : f))
							: [...folders, { ...record }];
					}
					cards = cards.map((c) => {
						const folderId = snapshot.cards[c.id];
						return folderId !== undefined && folderId !== c.folderId
							? { ...c, folderId }
							: c;
					});
					for (const [id, patch] of Object.entries(
						snapshot.cardPatches ?? {},
					)) {
						cards = cards.map((card) =>
							card.id === id ? { ...card, ...patch } : card,
						);
					}
					folders = folders.map((f) => {
						if (!(f.id in snapshot.folders)) return f;
						const parentId = snapshot.folders[f.id] ?? null;
						return (parentId ?? null) !== (f.parentId ?? null)
							? { ...f, parentId }
							: f;
					});
					// History snapshots can come from an older live state. Repair the
					// container map before reindexing so deleted ids can never be
					// resurrected by undo/redo (M5).
					const repairedOrder = repairItemOrder(itemOrder, folders, cards);
					const location = snapshot.location;
					return {
						...reindexOrders(folders, cards, repairedOrder),
						itemOrder: repairedOrder,
						// Only follow a location that still exists AFTER the replay, so
						// a snapshot from an older live state can never strand the app
						// on a folder the undo just removed.
						...(location !== undefined && folders.some((f) => f.id === location)
							? { activeFolderId: location }
							: {}),
					};
				}),

			createSubfolderFromCards: (
				containerFolderId,
				firstCardId,
				secondCardId,
				name,
			) => {
				if (firstCardId === secondCardId) return null;
				const s = get();
				const first = s.cards.find(
					(c) => c.id === firstCardId && c.folderId === containerFolderId,
				);
				const second = s.cards.find(
					(c) => c.id === secondCardId && c.folderId === containerFolderId,
				);
				if (!first || !second) return null;
				const id = generateId();
				const base = s.itemOrder ?? {};
				// Insert the new folder where the drop target lived.
				const keys = (base[containerFolderId] ?? []).filter(
					(k) =>
						k !== itemKey("card", firstCardId) &&
						k !== itemKey("card", secondCardId),
				);
				const targetIdx = (base[containerFolderId] ?? []).indexOf(
					itemKey("card", secondCardId),
				);
				keys.splice(
					targetIdx === -1 ? keys.length : Math.min(targetIdx, keys.length),
					0,
					itemKey("folder", id),
				);
				const itemOrder: ItemOrder = {
					...base,
					[containerFolderId]: keys,
					[id]: [itemKey("card", firstCardId), itemKey("card", secondCardId)],
				};
				const folders = [
					...s.folders,
					{ id, name, order: 0, parentId: containerFolderId },
				];
				const cards = s.cards.map((c) =>
					c.id === firstCardId
						? { ...c, folderId: id, order: 0 }
						: c.id === secondCardId
							? { ...c, folderId: id, order: 1 }
							: c,
				);
				const reindexed = reindexOrders(folders, cards, itemOrder);
				set({ ...reindexed, itemOrder });
				return id;
			},

			updateSettings: (changes) => set((s) => applySettingsUpdate(s, changes)),

			updateBackground: (changes) =>
				set((s) => applyNestedSettingsUpdate(s, "background", changes)),

			updateClock: (changes) =>
				set((s) => applyNestedSettingsUpdate(s, "clock", changes)),

			updateGreeting: (changes) =>
				set((s) => applyNestedSettingsUpdate(s, "greeting", changes)),

			updateWeather: (changes) =>
				set((s) => applyNestedSettingsUpdate(s, "weather", changes)),

			updateSearch: (changes) =>
				set((s) => applyNestedSettingsUpdate(s, "search", changes)),

			updateQuickLinks: (changes) =>
				set((s) => applyNestedSettingsUpdate(s, "quickLinks", changes)),

			addQuickLink: (link) => {
				const draft = prepareQuickLink(link.label, link.url);
				if (!draft) return null;
				const id = generateId();
				set((s) =>
					applyNestedSettingsUpdate(s, "quickLinks", {
						items: [...s.settings.quickLinks.items, { id, ...draft }],
					}),
				);
				return id;
			},

			moveQuickLink: (id, targetId, position) =>
				set((s) => {
					const items = s.settings.quickLinks.items;
					const next = reorderQuickLinks(items, id, targetId, position);
					return next === items
						? {}
						: applyNestedSettingsUpdate(s, "quickLinks", { items: next });
				}),

			updateQuickLink: (id, changes) =>
				set((s) => {
					const items = s.settings.quickLinks.items;
					if (!items.some((item) => item.id === id)) return {};
					return {
						settings: {
							...s.settings,
							quickLinks: {
								...s.settings.quickLinks,
								items: items.map((item) =>
									item.id === id ? { ...item, ...changes } : item,
								),
							},
						},
					};
				}),

			removeQuickLink: (id) =>
				set((s) => {
					const items = s.settings.quickLinks.items;
					const nextItems = items.filter((item) => item.id !== id);
					if (nextItems.length === items.length) return {};
					return {
						settings: {
							...s.settings,
							quickLinks: {
								...s.settings.quickLinks,
								items: nextItems,
							},
						},
					};
				}),

			updateThumbnailCapture: (changes) =>
				set((s) => applyNestedSettingsUpdate(s, "thumbnailCapture", changes)),

			commitCustomWallpaper: (entry) =>
				set((s) => {
					const background = s.settings.background;
					const settings: Settings = {
						...s.settings,
						background: {
							...background,
							customWallpaper: entry,
							type: "image",
							imageId: entry.id,
							wallpaperId: null,
							gradientId: null,
						},
					};
					return { settings };
				}),

			removeCustomWallpaper: (id) =>
				set((s) => {
					const background = s.settings.background;
					if (background.customWallpaper?.id !== id) return {};
					const isActive =
						background.type === "image" && background.imageId === id;
					const nextBackground = {
						...background,
						customWallpaper: null,
						...(isActive
							? {
									type: "wallpaper" as const,
									wallpaperId: "tokyo-skyline",
									imageId: null,
								}
							: {}),
					};
					const settings: Settings = {
						...s.settings,
						background: nextBackground,
					};
					return { settings };
				}),

			replaceSetup: (setup) => {
				set(normalizeState(setup));
				// NPD-3: a full external replacement (import) invalidates the
				// local history — old snapshots must never replay over it.
				useHistoryStore.getState().clearHistory();
			},

			resetAll: async () => {
				const previous = get();
				await beginReset();
				await cancelPendingPersist();
				try {
					// "perch-setup" is the legacy persist name; kept for data continuity.
					await resetWallpaperCache(async () => {
						await chrome.storage.local.remove("perch-setup");
						await useImageStore.getState().clearAll();
						set({ ...normalizeState(null) });
						await flushPersist();
					});
					// NPD-3: reset clears past+future — undoing into the pre-reset
					// world (M20) must be impossible after a confirmed wipe.
					useHistoryStore.getState().clearHistory();
				} catch (error) {
					set({
						folders: previous.folders,
						cards: previous.cards,
						activeFolderId: previous.activeFolderId,
						settings: previous.settings,
						// M21: a partial reset must restore the WHOLE pre-reset state —
						// without itemOrder the grid falls back to legacy-order reads
						// and the user's arrangement is scrambled.
						itemOrder: previous.itemOrder,
					});
					await flushPersist().catch(() => undefined);
					throw error;
				}
			},
		}),
		{
			// Legacy persist name kept so existing installs retain their setup.
			name: "perch-setup",
			storage: chromeStorageAdapter,
			partialize: (s) => ({
				folders: s.folders,
				cards: s.cards,
				activeFolderId: s.activeFolderId,
				settings: s.settings,
				itemOrder: s.itemOrder,
			}),
		},
	),
);

/** Grid max width for the current tile size + column count. Pure selector helper. */
export function computeGridMaxWidth(
	tileSize: string,
	maxColumns: number,
): number {
	const size = safeTileSize(tileSize);
	const cols = clampInt(maxColumns, MIN_COLUMNS, MAX_COLUMNS, 7);
	const tile = TILE_SIZE_DIMENSIONS[size];
	return cols * tile.width + (cols - 1) * GRID_GAP_PX + GRID_PADDING_X_PX * 2;
}
