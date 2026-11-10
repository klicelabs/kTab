import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	open,
	readFile,
	rename,
	rmdir,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

export const DEFAULT_PEXELS_QUERY = "cinematic nature landscape 4k";
const PRESETS = new Set([
	DEFAULT_PEXELS_QUERY,
	"cinematic nature landscape",
	"cinematic nature landscape 4k",
	"mountain landscape cinematic 4k",
	"beach ocean landscape 4k",
	"planet earth from space 4k",
	"cinematic city skyline architecture 4k",
	"minimalist landscape clean composition 4k",
	// Legacy selections remain first-class presets for people upgrading in place.
	"mountain landscape",
	"beach ocean landscape",
	"space nebula stars",
	"city architecture landscape",
	"minimalist landscape",
]);
const DAY = 86_400_000;
interface Photo {
	id: number;
	width: number;
	height: number;
	url: string;
	photographer: string;
	photographerUrl: string;
	src: {
		original: string;
		large2x: string;
		large: string;
		medium: string;
		small: string;
	};
}
interface CachedBatch {
	photos: Photo[];
	timestamp: number;
}
interface Counter {
	start: number;
	count: number;
}
interface RateLimit {
	limit: number;
	remaining: number;
	reset: number;
}
interface State {
	version: 1;
	cache: Record<string, CachedBatch>;
	calls: number[];
	customCalls: number[];
	clients: Record<string, Counter>;
	blockedUntil: number;
	rateLimit?: RateLimit;
}
interface Options {
	apiKey?: string;
	directory?: string;
	trustedClientHeader?: string;
	fetcher?: typeof fetch;
	now?: () => number;
	bodyTimeoutMs?: number;
	lockTimeoutMs?: number;
}
class ProxyError extends Error {
	constructor(
		public status: number,
		message: string,
		public retryAfter = 60,
	) {
		super(message);
	}
}
export function normalizePexelsQuery(value: unknown): string {
	if (value === undefined || value === "") return DEFAULT_PEXELS_QUERY;
	if (typeof value !== "string")
		throw new ProxyError(400, "Invalid search query");
	const query = value
		.normalize("NFKC")
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase();
	if (!query) return DEFAULT_PEXELS_QUERY;
	if (
		query.length > 80 ||
		[...query].some(
			(character) =>
				character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		)
	)
		throw new ProxyError(400, "Search must contain at most 80 characters");
	return query;
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeUrl(value: unknown, image = false): value is string {
	if (typeof value !== "string") return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			(image
				? url.hostname === "images.pexels.com"
				: ["pexels.com", "www.pexels.com"].includes(url.hostname))
		);
	} catch {
		return false;
	}
}
function parsePhotos(data: unknown): Photo[] {
	if (!record(data) || !Array.isArray(data.photos))
		throw new ProxyError(502, "Invalid photo response");
	const photos: Photo[] = [];
	for (const photo of data.photos.slice(0, 80)) {
		if (
			!record(photo) ||
			!record(photo.src) ||
			typeof photo.id !== "number" ||
			!Number.isSafeInteger(photo.id) ||
			typeof photo.width !== "number" ||
			typeof photo.height !== "number" ||
			photo.width < 1920 ||
			photo.height < 1080 ||
			photo.width <= photo.height ||
			!safeUrl(photo.url) ||
			!safeUrl(photo.photographer_url) ||
			typeof photo.photographer !== "string"
		)
			continue;
		const { original, large2x, large, medium, small } = photo.src;
		if (
			!safeUrl(original, true) ||
			!safeUrl(large2x, true) ||
			!safeUrl(large, true) ||
			!safeUrl(medium, true) ||
			!safeUrl(small, true)
		)
			continue;
		photos.push({
			id: photo.id,
			width: photo.width,
			height: photo.height,
			url: photo.url,
			photographer: photo.photographer.slice(0, 200),
			photographerUrl: photo.photographer_url,
			src: { original, large2x, large, medium, small },
		});
	}
	return photos;
}
async function readBody(
	request: Request,
	timeoutMs: number,
): Promise<Record<string, unknown>> {
	if (!request.body) return {};
	if (request.signal.aborted) throw new ProxyError(408, "Request cancelled");
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	let complete = false;
	const deadline = Promise.withResolvers<never>();
	const timer = setTimeout(
		() => deadline.reject(new ProxyError(408, "Request body timed out")),
		timeoutMs,
	);
	const onAbort = () =>
		deadline.reject(new ProxyError(408, "Request cancelled"));
	request.signal.addEventListener("abort", onAbort, { once: true });
	try {
		while (true) {
			const part = await Promise.race([reader.read(), deadline.promise]);
			if (part.done) {
				complete = true;
				break;
			}
			size += part.value.byteLength;
			if (size > 2048) {
				throw new ProxyError(413, "Request too large");
			}
			chunks.push(part.value);
		}
	} finally {
		clearTimeout(timer);
		request.signal.removeEventListener("abort", onAbort);
		// Cancellation must not await an untrusted stream's cancel callback.
		if (!complete) reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	try {
		const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!record(parsed)) throw new Error("Invalid body");
		return parsed;
	} catch {
		throw new ProxyError(400, "Invalid JSON request");
	}
}
function response(body: unknown, status = 200, retryAfter?: number): Response {
	return Response.json(body, {
		status,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Cache-Control": "no-store",
			...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
		},
	});
}
function counter(value: Counter, now: number, window: number): Counter {
	return now - value.start >= window ? { start: now, count: 0 } : value;
}

/** Durable shared state on one persistent host, including multiple Node processes. */
export class PexelsProxy {
	private activeRequests = 0;
	constructor(private options: Options) {}
	private now() {
		return (this.options.now ?? Date.now)();
	}
	async handle(request: Request): Promise<Response> {
		if (this.activeRequests >= 32)
			return response({ error: "Photo service busy", retryAfter: 5 }, 429, 5);
		this.activeRequests++;
		try {
			const body = await readBody(request, this.options.bodyTimeoutMs ?? 2000);
			const query = normalizePexelsQuery(body.query);
			const page = body.page ?? 1;
			if (
				typeof page !== "number" ||
				!Number.isInteger(page) ||
				page < 1 ||
				page > 5
			)
				throw new ProxyError(400, "Page must be between 1 and 5");
			if (!this.options.directory)
				throw new ProxyError(
					503,
					"Photo service storage is not configured",
					300,
				);
			const directory = resolve(this.options.directory);
			await mkdir(directory, { recursive: true });
			const release = await this.lock(directory);
			try {
				return await this.batch(directory, request, query, page);
			} finally {
				await release();
			}
		} catch (error) {
			if (error instanceof ProxyError)
				return response(
					{ error: error.message, retryAfter: error.retryAfter },
					error.status,
					error.retryAfter,
				);
			return response(
				{ error: "Photo service temporarily unavailable", retryAfter: 60 },
				503,
				60,
			);
		} finally {
			this.activeRequests--;
		}
	}
	private async lock(directory: string): Promise<() => Promise<void>> {
		const path = join(directory, "request.lock");
		const deadline = Date.now() + (this.options.lockTimeoutMs ?? 12_000);
		while (true) {
			try {
				await mkdir(path);
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!("code" in error) ||
					error.code !== "EEXIST"
				)
					throw error;
				if (Date.now() >= deadline)
					throw new ProxyError(503, "Photo service busy", 5);
				await new Promise((resolveWait) => setTimeout(resolveWait, 30));
				continue;
			}
			// Never reclaim a directory by age: a paused owner may still resume.
			const marker = join(path, `owner-${randomUUID()}`);
			await writeFile(marker, "", { flag: "wx", mode: 0o600 });
			return async () => {
				try {
					await unlink(marker);
				} catch (error) {
					if (
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
						return;
					throw error;
				}
				await rmdir(path);
			};
		}
	}
	private async read(directory: string): Promise<State> {
		try {
			const state: State = JSON.parse(
				await readFile(join(directory, "state.json"), "utf8"),
			);
			if (
				state.version !== 1 ||
				!state.cache ||
				!Array.isArray(state.calls) ||
				!Array.isArray(state.customCalls) ||
				!state.clients
			)
				throw new Error("Invalid persistent state");
			return state;
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "ENOENT"
			)
				throw error;
			return {
				version: 1,
				cache: {},
				calls: [],
				customCalls: [],
				clients: {},
				blockedUntil: 0,
			};
		}
	}
	private async save(directory: string, state: State): Promise<void> {
		const temporary = join(directory, `state-${randomUUID()}.tmp`);
		const file = await open(temporary, "w", 0o600);
		try {
			await file.writeFile(JSON.stringify(state));
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporary, join(directory, "state.json"));
	}
	private async batch(
		directory: string,
		request: Request,
		query: string,
		page: number,
	): Promise<Response> {
		const now = this.now();
		const state = await this.read(directory);
		const key = `${query}:${page}`;
		const address = this.options.trustedClientHeader
			? request.headers.get(this.options.trustedClientHeader) || "anonymous"
			: "anonymous";
		const clientId = createHash("sha256")
			.update(address.slice(0, 256))
			.digest("hex");
		const client = counter(
			state.clients[clientId] ?? { start: now, count: 0 },
			now,
			60_000,
		);
		if (client.count >= (this.options.trustedClientHeader ? 30 : 120))
			throw new ProxyError(429, "Too many photo requests", 60);
		client.count++;
		state.clients[clientId] = client;
		state.clients = Object.fromEntries(
			Object.entries(state.clients)
				.filter(([, value]) => now - value.start < 60_000)
				.slice(-512),
		);
		state.cache = Object.fromEntries(
			Object.entries(state.cache)
				.filter(([, value]) => now - value.timestamp < 7 * DAY)
				.sort((a, b) => b[1].timestamp - a[1].timestamp)
				.slice(0, 128),
		);
		const cached = state.cache[key];
		const reply = (stale: boolean) =>
			response({
				photos: cached?.photos ?? [],
				query,
				page,
				cached: true,
				stale,
				rateLimit: state.rateLimit,
			});
		if (cached && now - cached.timestamp < DAY) {
			await this.save(directory, state);
			return reply(false);
		}
		state.calls = state.calls.filter((time) => now - time < 31 * DAY);
		state.customCalls = state.customCalls.filter(
			(time) => now - time < 3_600_000,
		);
		const providerBlocked =
			state.rateLimit &&
			state.rateLimit.remaining <= 1 &&
			now < state.rateLimit.reset * 1000;
		const budgetBlocked =
			state.calls.filter((time) => now - time < 3_600_000).length >= 150 ||
			state.calls.length >= 18_000 ||
			(!PRESETS.has(query) && state.customCalls.length >= 20);
		if (
			!this.options.apiKey ||
			providerBlocked ||
			budgetBlocked ||
			now < state.blockedUntil
		) {
			await this.save(directory, state);
			if (cached) return reply(true);
			const recentCalls = state.calls.filter((time) => now - time < 3_600_000);
			const nextAllowed = Math.max(
				now + 60_000,
				state.blockedUntil,
				providerBlocked ? (state.rateLimit?.reset ?? 0) * 1000 : 0,
				recentCalls.length >= 150 ? recentCalls[0] + 3_600_000 : 0,
				state.calls.length >= 18_000 ? state.calls[0] + 31 * DAY : 0,
				!PRESETS.has(query) && state.customCalls.length >= 20
					? state.customCalls[0] + 3_600_000
					: 0,
			);
			throw new ProxyError(
				this.options.apiKey ? 429 : 503,
				this.options.apiKey
					? "Photo quota temporarily unavailable"
					: "Photo service is not configured",
				this.options.apiKey ? Math.ceil((nextAllowed - now) / 1000) : 300,
			);
		}
		// Reserve durably before fetch: failures and process crashes still consume budget.
		state.calls.push(now);
		if (!PRESETS.has(query)) state.customCalls.push(now);
		await this.save(directory, state);
		const params = new URLSearchParams({
			query: /(?:^|\s)4k(?:\s|$)/i.test(query) ? query : `${query} 4k`,
			page: String(page),
			per_page: "80",
			orientation: "landscape",
			size: "large",
		});
		try {
			const upstream = await (this.options.fetcher ?? fetch)(
				`https://api.pexels.com/v1/search?${params}`,
				{
					headers: { Authorization: this.options.apiKey },
					signal: AbortSignal.timeout(8000),
					cache: "no-store",
				},
			);
			if (upstream.ok) {
				const limit = Number(upstream.headers.get("X-Ratelimit-Limit"));
				const remaining = Number(upstream.headers.get("X-Ratelimit-Remaining"));
				const reset = Number(upstream.headers.get("X-Ratelimit-Reset"));
				if (limit > 0 && remaining >= 0 && reset > now / 1000)
					state.rateLimit = { limit, remaining, reset };
			} else if (upstream.status === 429) {
				const delay = Number(upstream.headers.get("Retry-After")) || 3600;
				state.blockedUntil = Math.max(
					now + Math.max(60, delay) * 1000,
					state.rateLimit?.remaining === 0 ? state.rateLimit.reset * 1000 : 0,
				);
			}
			if (!upstream.ok)
				throw new ProxyError(
					upstream.status === 429 ? 429 : 502,
					"Photo provider unavailable",
					upstream.status === 429 ? 3600 : 60,
				);
			const photos = parsePhotos(await upstream.json());
			state.cache[key] = { photos, timestamp: now };
			await this.save(directory, state);
			return response({
				photos,
				query,
				page,
				cached: false,
				stale: false,
				rateLimit: state.rateLimit,
			});
		} catch (error) {
			// A transport or provider error for one query does not block other searches.
			await this.save(directory, state);
			if (cached) return reply(true);
			throw error;
		}
	}
}
