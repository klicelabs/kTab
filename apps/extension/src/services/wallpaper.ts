import { create } from "zustand";

import { MAX_BACKGROUND_IMAGE_BYTES } from "../lib/constants";
import { extApi } from "../lib/extension-api";
import { idbDelete, idbGet, idbGetAllKeys, idbPut, STORE_BG } from "../lib/idb";
import type { PexelsPhoto } from "../lib/pexels";
import {
	choosePexelsPhoto,
	isPexelsPhoto,
	normalizePexelsQuery,
	pexelsProxyUrl,
	wallpaperImageUrl,
} from "../lib/pexels";
import {
	flushPersist,
	getResetGeneration,
	readSetupEnvelope,
} from "../lib/storage";
import {
	WALLPAPER_LOCK_NAME,
	WALLPAPER_STATE_KEY,
} from "../lib/wallpaper-coordination";
import { useSetupStore } from "../stores/setup-store";
import type { BackgroundSettings, WallpaperFrequency } from "../types";

export type DaylightPeriod = "morning" | "afternoon" | "night";
export function getCurrentPeriod(): DaylightPeriod {
	const h = new Date().getHours();
	return h >= 6 && h < 12
		? "morning"
		: h >= 12 && h < 18
			? "afternoon"
			: "night";
}
export function shouldFetch(
	frequency: WallpaperFrequency,
	lastFetched: number | null,
	lastPeriod: DaylightPeriod | null,
	now = Date.now(),
): boolean {
	if (frequency === "locked") return false;
	if (frequency === "per-tab" || lastFetched === null) return true;
	if (frequency === "daylight")
		return getCurrentPeriod() !== lastPeriod || now - lastFetched >= 86_400_000;
	return now - lastFetched >= (frequency === "hourly" ? 3_600_000 : 86_400_000);
}
interface WallpaperStatus {
	status: "idle" | "loading" | "error" | "empty";
	message: string | null;
}
export const useWallpaperStatus = create<WallpaperStatus>(() => ({
	status: "idle",
	message: null,
}));
const STATE_KEY = WALLPAPER_STATE_KEY;
const LOCK_NAME = WALLPAPER_LOCK_NAME;
const MAX_RECENT = 40;
interface Queue {
	query: string;
	photos: PexelsPhoto[];
	fetchedAt: number;
	page: number;
	noResults?: boolean;
}
interface Selection {
	query: string;
	photo: PexelsPhoto;
	imageId: string;
	chosenAt: number;
	period: DaylightPeriod | null;
}
interface EngineState {
	version: 1;
	queues: Queue[];
	recent: number[];
	current: Selection | null;
	prepared: Selection | null;
	retryAt: number;
	downloadBackoffs: { query: string; until: number }[];
}
const emptyState = (): EngineState => ({
	version: 1,
	queues: [],
	recent: [],
	current: null,
	prepared: null,
	retryAt: 0,
	downloadBackoffs: [],
});

function normalizeEngine(value: unknown): EngineState {
	if (!value || typeof value !== "object") return emptyState();
	const raw = value as Partial<EngineState>;
	if (raw.version !== 1) return emptyState();
	return {
		version: 1,
		queues: Array.isArray(raw.queues)
			? raw.queues
					.filter(
						(q) =>
							q &&
							typeof q.query === "string" &&
							Array.isArray(q.photos) &&
							Number.isFinite(q.fetchedAt),
					)
					.slice(-4)
					.map((q) => ({
						...q,
						photos: q.photos.filter(isPexelsPhoto).slice(0, 80),
						page: Math.max(1, Math.min(5, q.page || 1)),
					}))
			: [],
		recent: Array.isArray(raw.recent)
			? raw.recent.filter(Number.isSafeInteger).slice(-MAX_RECENT)
			: [],
		current:
			raw.current &&
			typeof raw.current.query === "string" &&
			typeof raw.current.imageId === "string" &&
			Number.isFinite(raw.current.chosenAt) &&
			isPexelsPhoto(raw.current.photo)
				? raw.current
				: null,
		retryAt:
			typeof raw.retryAt === "number" && Number.isFinite(raw.retryAt)
				? raw.retryAt
				: 0,
		prepared:
			raw.prepared &&
			typeof raw.prepared.query === "string" &&
			typeof raw.prepared.imageId === "string" &&
			Number.isFinite(raw.prepared.chosenAt) &&
			isPexelsPhoto(raw.prepared.photo)
				? raw.prepared
				: null,
		downloadBackoffs: Array.isArray(raw.downloadBackoffs)
			? raw.downloadBackoffs
					.filter(
						(entry) =>
							entry &&
							typeof entry.query === "string" &&
							Number.isFinite(entry.until) &&
							entry.until > Date.now(),
					)
					.slice(-4)
			: [],
	};
}
async function readState(): Promise<EngineState> {
	const data = await extApi().storage.local.get(STATE_KEY);
	return normalizeEngine(data[STATE_KEY]);
}
async function writeState(state: EngineState): Promise<void> {
	await extApi().storage.local.set({ [STATE_KEY]: state });
}

function matching(bg: BackgroundSettings, query: string): boolean {
	return bg.type === "pexels" && normalizePexelsQuery(bg.pexelsQuery) === query;
}
async function applySelection(selection: Selection): Promise<void> {
	const bg = useSetupStore.getState().settings.background;
	if (!matching(bg, selection.query)) return;
	if (
		bg.pexelsImageId === selection.imageId &&
		bg.pexelsLastFetched === selection.chosenAt &&
		bg.pexelsPhoto?.id === selection.photo.id
	)
		return;
	const { id, url, photographer, photographerUrl, width, height } =
		selection.photo;
	const credit = { id, url, photographer, photographerUrl, width, height };
	useSetupStore.getState().updateBackground({
		pexelsImageId: selection.imageId,
		pexelsPhoto: credit,
		pexelsLastFetched: selection.chosenAt,
		pexelsLastPeriod: selection.period,
	});
	await flushPersist();
}

async function downloadImage(
	url: string,
	signal: AbortSignal,
): Promise<string> {
	const response = await fetch(url, {
		credentials: "omit",
		referrerPolicy: "no-referrer",
		signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
	});
	if (
		!response.ok ||
		!response.headers.get("Content-Type")?.toLowerCase().startsWith("image/")
	)
		throw new Error(
			"The photo couldn't be downloaded. Your current wallpaper is unchanged.",
		);
	const declared = Number(response.headers.get("Content-Length") || 0);
	if (!Number.isFinite(declared) || declared > MAX_BACKGROUND_IMAGE_BYTES)
		throw new Error("This photo is too large. Try another photo.");
	const reader = response.body?.getReader();
	const chunks: ArrayBuffer[] = [];
	let total = 0;
	if (reader) {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > MAX_BACKGROUND_IMAGE_BYTES) {
				await reader.cancel();
				throw new Error("This photo is too large. Try another photo.");
			}
			const copy = new Uint8Array(value.byteLength);
			copy.set(value);
			chunks.push(copy.buffer);
		}
	}
	const blob = reader
		? new Blob(chunks, {
				type: response.headers.get("Content-Type") || "image/jpeg",
			})
		: await response.blob();
	if (!blob.size || blob.size > MAX_BACKGROUND_IMAGE_BYTES)
		throw new Error("This photo couldn't be loaded.");
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const file = new FileReader();
		file.onload = () =>
			typeof file.result === "string"
				? resolve(file.result)
				: reject(new Error("Image conversion failed"));
		file.onerror = () => reject(file.error);
		file.readAsDataURL(blob);
	});
	// Readiness includes decoding: corrupt or unsupported bytes never replace the current image.
	const image = new Image();
	image.src = dataUrl;
	await image.decode();
	return dataUrl;
}

async function fetchQueue(
	query: string,
	page: number,
	state: EngineState,
	signal: AbortSignal,
): Promise<Queue | null> {
	if (!pexelsProxyUrl())
		throw new Error(
			"Online photography isn't configured yet. Your current wallpaper is available offline.",
		);
	if (Date.now() < state.retryAt)
		throw new Error(
			"Photography is temporarily unavailable. Your current wallpaper is unchanged.",
		);
	const resetGeneration = getResetGeneration();
	try {
		const response = await fetch(pexelsProxyUrl(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query, page }),
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
		});
		if (!response.ok) {
			const delay = Number(response.headers.get("Retry-After"));
			state.retryAt =
				Date.now() +
				Math.min(
					86_400_000,
					Math.max(30, Number.isFinite(delay) ? delay : 300) * 1000,
				);
			await writeState(state);
			throw new Error(
				response.status === 429
					? "Photography is taking a break. Your current wallpaper is unchanged."
					: "Couldn't reach online photography. Your current wallpaper is unchanged.",
			);
		}
		const result: unknown = await response.json();
		const values =
			result &&
			typeof result === "object" &&
			"photos" in result &&
			Array.isArray(result.photos)
				? result.photos
				: [];
		const photos = Array.from(
			new Map(values.filter(isPexelsPhoto).map((p) => [p.id, p])).values(),
		).slice(0, 80);
		if (!photos.length) {
			return {
				query,
				photos: [],
				fetchedAt: Date.now(),
				page,
				noResults: true,
			};
		}
		return { query, photos, fetchedAt: Date.now(), page };
	} catch (error) {
		// Provider failures are shared across queries, but apply only when another API call is needed.
		// Cached batches remain usable while requests are suspended.
		if (
			!signal.aborted &&
			getResetGeneration() === resetGeneration &&
			Date.now() >= state.retryAt &&
			matching(useSetupStore.getState().settings.background, query) &&
			(await persistedPreferencesMatch(
				query,
				useSetupStore.getState().settings.background.pexelsFrequency,
			))
		) {
			state.retryAt = Date.now() + 60_000;
			await writeState(state);
		}
		throw error;
	}
}

let generation = 0;
let inFlight: {
	query: string;
	frequency: WallpaperFrequency;
	promise: Promise<void>;
} | null = null;
let requestController: AbortController | null = null;

async function persistedPreferencesMatch(
	query: string,
	frequency: WallpaperFrequency,
): Promise<boolean> {
	const setup = await readSetupEnvelope("perch-setup");
	const bg = setup?.settings.background;
	return !!bg && matching(bg, query) && bg.pexelsFrequency === frequency;
}

/** Web Locks coordinates all extension pages, while storage survives page closure and worker restarts. */
export async function refreshWallpaper(force = false): Promise<void> {
	const initial = useSetupStore.getState().settings.background;
	if (initial.type !== "pexels") return;
	const query = normalizePexelsQuery(initial.pexelsQuery);
	if (
		inFlight?.query === query &&
		inFlight.frequency === initial.pexelsFrequency
	)
		return inFlight.promise;
	requestController?.abort();
	const controller = new AbortController();
	requestController = controller;
	const requestGeneration = ++generation;
	const resetGeneration = getResetGeneration();
	const requestedAt = Date.now();
	const isCurrent = () =>
		requestGeneration === generation &&
		getResetGeneration() === resetGeneration &&
		matching(useSetupStore.getState().settings.background, query) &&
		useSetupStore.getState().settings.background.pexelsFrequency ===
			initial.pexelsFrequency;
	const task = async () => {
		if (!isCurrent()) return;
		useWallpaperStatus.setState({ status: "loading", message: null });
		try {
			await flushPersist();
			if (
				typeof navigator === "undefined" ||
				!navigator.locks ||
				!extApi().storage?.local
			)
				throw new Error(
					"Online photography isn't available in this browser. Your current wallpaper is unchanged.",
				);
			await navigator.locks.request(
				LOCK_NAME,
				{ signal: controller.signal },
				async () => {
					if (
						!isCurrent() ||
						!(await persistedPreferencesMatch(query, initial.pexelsFrequency))
					)
						return;
					const state = await readState();
					const bg = useSetupStore.getState().settings.background;
					// Only engine-owned ids are swept; uploaded backgrounds and legacy ids stay intact.
					const keys = await idbGetAllKeys(STORE_BG);
					for (const key of keys) {
						if (
							typeof key === "string" &&
							key.startsWith("pexels_") &&
							key !== state.current?.imageId &&
							key !== state.prepared?.imageId &&
							key !== bg.pexelsImageId
						)
							await idbDelete(STORE_BG, key);
					}
					const shared = state.current?.query === query ? state.current : null;
					const sharedBytes = shared
						? await idbGet(STORE_BG, shared.imageId)
						: null;
					if (
						shared &&
						sharedBytes &&
						(shared.chosenAt >= requestedAt ||
							(!force &&
								!shouldFetch(
									bg.pexelsFrequency,
									shared.chosenAt,
									shared.period,
								)))
					) {
						if (isCurrent()) await applySelection(shared);
						return;
					}
					if (
						!force &&
						!shouldFetch(
							bg.pexelsFrequency,
							bg.pexelsLastFetched,
							bg.pexelsLastPeriod,
						) &&
						(bg.pexelsImageId || sharedBytes)
					)
						return;
					const prepared =
						state.prepared?.query === query ? state.prepared : null;
					const preparedBytes = prepared
						? await idbGet(STORE_BG, prepared.imageId)
						: null;
					let queue =
						state.queues.find((q) => q.query === query) ??
						(preparedBytes
							? { query, photos: [], fetchedAt: Date.now(), page: 1 }
							: undefined);
					if (
						!preparedBytes &&
						state.downloadBackoffs.some(
							(entry) => entry.query === query && entry.until > Date.now(),
						)
					)
						throw new Error(
							"Photography is temporarily unavailable. Your current wallpaper is unchanged.",
						);
					if (
						!preparedBytes &&
						queue?.noResults &&
						Date.now() - queue.fetchedAt < 86_400_000
					) {
						useWallpaperStatus.setState({
							status: "empty",
							message:
								"No landscape photos found. Try another search; your wallpaper is unchanged.",
						});
						return;
					}
					if (
						!preparedBytes &&
						(!queue ||
							Date.now() - queue.fetchedAt > 86_400_000 ||
							!queue.photos.length)
					) {
						try {
							const fresh = await fetchQueue(
								query,
								queue?.photos.length
									? queue.page
									: ((queue?.page ?? 0) % 5) + 1,
								state,
								controller.signal,
							);
							if (!isCurrent()) return;
							if (fresh) {
								queue = fresh;
								state.queues = state.queues
									.filter((q) => q.query !== query)
									.slice(-3)
									.concat(fresh);
								if (fresh.noResults) {
									await writeState(state);
									useWallpaperStatus.setState({
										status: "empty",
										message:
											"No landscape photos found. Try another search; your wallpaper is unchanged.",
									});
									return;
								}
							} else return;
						} catch (error) {
							if (!queue?.photos.length) throw error;
						}
					}
					if (!queue || !isCurrent()) return;
					// A short result set retains its newest half as history, so it can rotate without getting stuck.
					let photo =
						preparedBytes && prepared
							? prepared.photo
							: choosePexelsPhoto(queue.photos, state.recent);
					if (!photo)
						photo = choosePexelsPhoto(
							queue.photos,
							state.recent.slice(
								-Math.min(20, Math.max(1, Math.floor(queue.photos.length / 2))),
							),
						);
					if (!photo)
						throw new Error(
							"No different photos are available yet. Your current wallpaper is unchanged.",
						);
					const url = wallpaperImageUrl(
						photo,
						window.innerWidth,
						window.innerHeight,
						window.devicePixelRatio,
					);
					let dataUrl: string;
					try {
						dataUrl =
							preparedBytes || (await downloadImage(url, controller.signal));
					} catch (error) {
						// A broken image host/decoder pauses this query, without suspending other cached themes.
						if (
							!controller.signal.aborted &&
							isCurrent() &&
							(await persistedPreferencesMatch(query, initial.pexelsFrequency))
						) {
							state.downloadBackoffs = state.downloadBackoffs
								.filter(
									(entry) => entry.query !== query && entry.until > Date.now(),
								)
								.slice(-3)
								.concat({ query, until: Date.now() + 60_000 });
							await writeState(state);
						}
						throw error;
					}
					if (
						!isCurrent() ||
						!(await persistedPreferencesMatch(query, initial.pexelsFrequency))
					)
						return;
					const imageId =
						preparedBytes && prepared
							? prepared.imageId
							: `pexels_${crypto.randomUUID()}`;
					await idbPut(STORE_BG, imageId, dataUrl);
					if (!isCurrent()) {
						await idbDelete(STORE_BG, imageId);
						return;
					}
					const previous = state.current;
					const selection: Selection = {
						query,
						photo,
						imageId,
						chosenAt: Date.now(),
						period:
							bg.pexelsFrequency === "daylight" ? getCurrentPeriod() : null,
					};
					state.current = selection;
					const unusedPrepared = state.prepared;
					state.prepared = null;
					state.downloadBackoffs = state.downloadBackoffs.filter(
						(entry) => entry.query !== query,
					);
					state.recent = state.recent
						.filter((id) => id !== photo.id)
						.concat(photo.id)
						.slice(-MAX_RECENT);
					queue.photos = queue.photos.filter((p) => p.id !== photo.id);
					try {
						await writeState(state);
					} catch (error) {
						await idbDelete(STORE_BG, imageId);
						throw error;
					}
					await applySelection(selection);
					if (unusedPrepared && unusedPrepared.imageId !== imageId)
						await idbDelete(STORE_BG, unusedPrepared.imageId).catch(
							() => undefined,
						);
					if (previous && previous.imageId !== imageId)
						await idbDelete(STORE_BG, previous.imageId).catch(() => undefined);
				},
			);
			if (isCurrent() && useWallpaperStatus.getState().status === "loading")
				useWallpaperStatus.setState({ status: "idle", message: null });
		} catch (error) {
			if (isCurrent())
				useWallpaperStatus.setState({
					status: "error",
					message:
						error instanceof Error
							? error.message
							: "Couldn't load photography. Your current wallpaper is unchanged.",
				});
		}
	};
	const promise = task();
	inFlight = { query, frequency: initial.pexelsFrequency, promise };
	try {
		await promise;
	} finally {
		if (inFlight?.promise === promise) inFlight = null;
	}
}

/** Cache one decoded successor from the existing batch, without changing the UI or calling the API. */
export async function prepareNextWallpaper(): Promise<void> {
	const bg = useSetupStore.getState().settings.background;
	if (
		bg.type !== "pexels" ||
		bg.pexelsFrequency === "locked" ||
		!navigator.locks
	)
		return;
	const query = normalizePexelsQuery(bg.pexelsQuery);
	const reset = getResetGeneration();
	const valid = async () =>
		getResetGeneration() === reset &&
		matching(useSetupStore.getState().settings.background, query) &&
		(await persistedPreferencesMatch(query, bg.pexelsFrequency));
	await navigator.locks.request(LOCK_NAME, {}, async () => {
		if (!(await valid())) return;
		const state = await readState();
		if (
			state.prepared?.query === query &&
			(await idbGet(STORE_BG, state.prepared.imageId))
		)
			return;
		if (
			state.downloadBackoffs.some(
				(entry) => entry.query === query && entry.until > Date.now(),
			)
		)
			return;
		const queue = state.queues.find((q) => q.query === query);
		const photo = queue && choosePexelsPhoto(queue.photos, state.recent);
		if (!photo) return;
		const data = await downloadImage(
			wallpaperImageUrl(
				photo,
				window.innerWidth,
				window.innerHeight,
				window.devicePixelRatio,
			),
			AbortSignal.timeout(20_000),
		);
		if (!(await valid())) return;
		const imageId = `pexels_${crypto.randomUUID()}`;
		await idbPut(STORE_BG, imageId, data);
		if (!(await valid())) {
			await idbDelete(STORE_BG, imageId);
			return;
		}
		const previous = state.prepared;
		state.prepared = {
			query,
			photo,
			imageId,
			chosenAt: Date.now(),
			period: null,
		};
		try {
			await writeState(state);
		} catch (error) {
			await idbDelete(STORE_BG, imageId);
			throw error;
		}
		if (previous)
			await idbDelete(STORE_BG, previous.imageId).catch(() => undefined);
	});
}
