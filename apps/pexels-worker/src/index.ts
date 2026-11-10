/// <reference types="@cloudflare/workers-types" />

const DEFAULT_QUERY = "cinematic nature landscape 4k";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const CACHE_MS = DAY_MS;
const STALE_MS = 7 * DAY_MS;
const MAX_MONTH_CALLS = 18_000;
const MAX_HOUR_CALLS = 150;
const MAX_CUSTOM_CALLS_PER_HOUR = 20;

const PRESETS = new Set([
	DEFAULT_QUERY,
	"cinematic nature landscape",
	"mountain landscape cinematic 4k",
	"beach ocean landscape 4k",
	"planet earth from space 4k",
	"cinematic city 4k",
	"minimalist landscape 4k",
	"cinematic city skyline architecture 4k",
	"minimalist landscape clean composition 4k",
	"mountain landscape",
	"beach ocean landscape",
	"space nebula stars",
	"city architecture landscape",
	"minimalist landscape",
]);

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

interface RateLimitInfo {
	limit: number;
	remaining: number;
	reset: number;
}

interface CachedRow {
	cached_at: number;
	photos_json: string;
	rate_limit_json: string | null;
}

interface ProviderRow {
	blocked_until: number;
	rate_limit_json: string | null;
}

interface Env {
	DB: D1Database;
	PEXELS_API_KEY?: string;
	PEXELS_LIMITER: RateLimit;
	/** Test-only injection points. They are never configured by Wrangler. */
	__testFetch?: typeof fetch;
	__testNow?: () => number;
}

export class ProxyError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly retryAfter = 60,
	) {
		super(message);
	}
}

export function normalizePexelsQuery(value: unknown): string {
	if (value === undefined || value === "") return DEFAULT_QUERY;
	if (typeof value !== "string")
		throw new ProxyError(400, "Invalid search query");
	const query = value
		.normalize("NFKC")
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase();
	if (!query) return DEFAULT_QUERY;
	if (
		query.length > 80 ||
		[...query].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 32 || code === 127;
		})
	)
		throw new ProxyError(400, "Search must contain at most 80 characters");
	return query;
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
				: url.hostname === "pexels.com" || url.hostname === "www.pexels.com")
		);
	} catch {
		return false;
	}
}

function parsePhotos(data: unknown): Photo[] {
	if (!isRecord(data) || !Array.isArray(data.photos))
		throw new ProxyError(502, "Invalid photo response");
	const photos: Photo[] = [];
	for (const value of data.photos.slice(0, 80)) {
		if (!isRecord(value) || !isRecord(value.src)) continue;
		const {
			id,
			width,
			height,
			url,
			photographer,
			photographer_url: photographerUrl,
		} = value;
		const { original, large2x, large, medium, small } = value.src;
		if (
			!Number.isSafeInteger(id) ||
			typeof width !== "number" ||
			typeof height !== "number" ||
			!Number.isFinite(width) ||
			!Number.isFinite(height) ||
			width < 1920 ||
			height < 1080 ||
			width <= height ||
			!safeUrl(url) ||
			!safeUrl(photographerUrl) ||
			typeof photographer !== "string" ||
			!safeUrl(original, true) ||
			!safeUrl(large2x, true) ||
			!safeUrl(large, true) ||
			!safeUrl(medium, true) ||
			!safeUrl(small, true)
		)
			continue;
		photos.push({
			id: id as number,
			width,
			height,
			url,
			photographer: photographer.slice(0, 200),
			photographerUrl,
			src: { original, large2x, large, medium, small },
		});
	}
	return photos;
}

function parseJson<T>(value: string | null | undefined): T | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
}

function json(body: unknown, status = 200, retryAfter?: number): Response {
	return Response.json(body, {
		status,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Cache-Control": "no-store",
			...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
		},
	});
}

function preflight(): Response {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Access-Control-Max-Age": "86400",
		},
	});
}

async function readRequest(request: Request): Promise<Record<string, unknown>> {
	const declaredLength = Number(request.headers.get("content-length") ?? 0);
	if (declaredLength > 2048) throw new ProxyError(413, "Request too large");
	const body = await request.text();
	if (new TextEncoder().encode(body).byteLength > 2048)
		throw new ProxyError(413, "Request too large");
	try {
		const value: unknown = body ? JSON.parse(body) : {};
		if (!isRecord(value)) throw new Error("Expected an object");
		return value;
	} catch {
		throw new ProxyError(400, "Invalid JSON request");
	}
}

const READ_CACHE = `
	SELECT cached_at, photos_json, rate_limit_json
	FROM pexels_cache
	WHERE query = ? AND page = ? AND cached_at >= ?
`;

const READ_PROVIDER_STATE = `
	SELECT blocked_until, rate_limit_json
	FROM pexels_provider_state
	WHERE id = ?
`;

const RESERVE_BUDGET = `
	WITH usage AS (
		SELECT
			COALESCE(SUM(CASE WHEN kind = 'day' THEN count ELSE 0 END), 0) AS recent_calls,
			COALESCE(MAX(CASE WHEN kind = 'hour' THEN count ELSE 0 END), 0) AS hour_calls,
			COALESCE(MAX(CASE WHEN kind = 'custom_hour' THEN count ELSE 0 END), 0) AS custom_calls
		FROM pexels_usage
		WHERE (kind = 'day' AND bucket >= ?)
			OR (kind IN ('hour', 'custom_hour') AND bucket = ?)
	),
	allowed AS (
		SELECT 1 FROM usage
		WHERE recent_calls < ?
			AND hour_calls < ?
			AND (? = 0 OR custom_calls < ?)
	),
	increments(kind, bucket) AS (
		SELECT 'day', ? FROM allowed
		UNION ALL SELECT 'hour', ? FROM allowed
		UNION ALL SELECT 'custom_hour', ? WHERE ? = 1 AND EXISTS (SELECT 1 FROM allowed)
	)
	INSERT INTO pexels_usage (kind, bucket, count)
	SELECT kind, bucket, 1 FROM increments WHERE 1
	ON CONFLICT (kind, bucket) DO UPDATE SET count = pexels_usage.count + 1
	RETURNING kind
`;

async function reserveBudget(
	db: D1Database,
	now: number,
	isCustom: boolean,
): Promise<boolean> {
	const dayBucket = Math.floor(now / DAY_MS);
	const hourBucket = Math.floor(now / HOUR_MS);
	const { results } = await db
		.prepare(RESERVE_BUDGET)
		.bind(
			dayBucket - 30,
			hourBucket,
			MAX_MONTH_CALLS,
			MAX_HOUR_CALLS,
			isCustom ? 1 : 0,
			MAX_CUSTOM_CALLS_PER_HOUR,
			dayBucket,
			hourBucket,
			hourBucket,
			isCustom ? 1 : 0,
		)
		.all<{ kind: string }>();
	const expected = isCustom ? 3 : 2;
	if (results.length !== expected) return false;
	await db
		.prepare(
			"DELETE FROM pexels_usage WHERE (kind = 'day' AND bucket < ?) OR (kind IN ('hour', 'custom_hour') AND bucket < ?)",
		)
		.bind(dayBucket - 30, hourBucket)
		.run();
	return true;
}

async function writeProviderState(
	db: D1Database,
	blockedUntil: number,
	rateLimit: RateLimitInfo | undefined,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO pexels_provider_state (id, blocked_until, rate_limit_json)
			 VALUES (1, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET
				blocked_until = excluded.blocked_until,
				rate_limit_json = excluded.rate_limit_json`,
		)
		.bind(blockedUntil, rateLimit ? JSON.stringify(rateLimit) : null)
		.run();
}

async function writeCache(
	db: D1Database,
	query: string,
	page: number,
	now: number,
	photos: Photo[],
	rateLimit: RateLimitInfo | undefined,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO pexels_cache (query, page, cached_at, photos_json, rate_limit_json)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (query, page) DO UPDATE SET
				cached_at = excluded.cached_at,
				photos_json = excluded.photos_json,
				rate_limit_json = excluded.rate_limit_json`,
		)
		.bind(
			query,
			page,
			now,
			JSON.stringify(photos),
			rateLimit ? JSON.stringify(rateLimit) : null,
		)
		.run();
	await db
		.prepare("DELETE FROM pexels_cache WHERE cached_at < ?")
		.bind(now - STALE_MS)
		.run();
	await db
		.prepare(
			`DELETE FROM pexels_cache
			 WHERE (query, page) IN (
				 SELECT query, page FROM pexels_cache
				 ORDER BY cached_at DESC LIMIT -1 OFFSET 128
			 )`,
		)
		.bind()
		.run();
}

function cachedResponse(
	query: string,
	page: number,
	photos: Photo[],
	rateLimit: RateLimitInfo | undefined,
	stale: boolean,
): Response {
	return json({ photos, query, page, cached: true, stale, rateLimit });
}

export async function handleRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method === "OPTIONS") return preflight();
	if (request.method !== "POST")
		return json({ error: "Method not allowed" }, 405);

	try {
		const ipAddress = request.headers.get("cf-connecting-ip") ?? "unknown";
		const rateLimit = await env.PEXELS_LIMITER.limit({ key: ipAddress });
		if (!rateLimit.success)
			throw new ProxyError(429, "Too many photo requests", 60);

		const body = await readRequest(request);
		const query = normalizePexelsQuery(body.query);
		const page = body.page ?? 1;
		if (
			typeof page !== "number" ||
			!Number.isInteger(page) ||
			page < 1 ||
			page > 5
		)
			throw new ProxyError(400, "Page must be between 1 and 5");

		const now = env.__testNow?.() ?? Date.now();
		const cached = await env.DB.prepare(READ_CACHE)
			.bind(query, page, now - STALE_MS)
			.first<CachedRow>();
		const cachedPhotos = parseJson<Photo[]>(cached?.photos_json);
		const previousProvider = await env.DB.prepare(READ_PROVIDER_STATE)
			.bind(1)
			.first<ProviderRow>();
		const providerRateLimit = parseJson<RateLimitInfo>(
			previousProvider?.rate_limit_json,
		);
		const cachedRateLimit = parseJson<RateLimitInfo>(cached?.rate_limit_json);
		const stale =
			cached && cachedPhotos && now - cached.cached_at < CACHE_MS
				? cachedResponse(
						query,
						page,
						cachedPhotos,
						cachedRateLimit ?? providerRateLimit,
						false,
					)
				: undefined;
		if (stale) return stale;

		const fallback = () =>
			cached && cachedPhotos
				? cachedResponse(
						query,
						page,
						cachedPhotos,
						cachedRateLimit ?? providerRateLimit,
						true,
					)
				: undefined;

		if (!env.PEXELS_API_KEY) {
			const old = fallback();
			if (old) return old;
			throw new ProxyError(503, "Photo service is not configured", 300);
		}

		const blockedUntil = previousProvider?.blocked_until ?? 0;
		if (
			blockedUntil > now ||
			(providerRateLimit?.remaining !== undefined &&
				providerRateLimit.remaining <= 1 &&
				providerRateLimit.reset * 1000 > now)
		) {
			const old = fallback();
			if (old) return old;
			const retryAfter = Math.max(
				60,
				Math.ceil(
					(Math.max(blockedUntil, (providerRateLimit?.reset ?? 0) * 1000) -
						now) /
						1000,
				),
			);
			throw new ProxyError(
				429,
				"Photo quota temporarily unavailable",
				retryAfter,
			);
		}

		const isCustom = !PRESETS.has(query);
		if (!(await reserveBudget(env.DB, now, isCustom))) {
			const old = fallback();
			if (old) return old;
			throw new ProxyError(429, "Photo quota temporarily unavailable", 3600);
		}

		const providerQuery = /(?:^|\s)4k(?:\s|$)/i.test(query)
			? query
			: `${query} 4k`;
		const params = new URLSearchParams({
			query: providerQuery,
			page: String(page),
			per_page: "80",
			orientation: "landscape",
			size: "large",
		});
		let upstream: Response;
		try {
			upstream = await (env.__testFetch ?? fetch)(
				`https://api.pexels.com/v1/search?${params}`,
				{
					headers: { Authorization: env.PEXELS_API_KEY },
					signal: AbortSignal.timeout(8000),
					cache: "no-store",
				},
			);
		} catch {
			const old = fallback();
			if (old) return old;
			throw new ProxyError(503, "Photo service temporarily unavailable", 60);
		}

		if (!upstream.ok) {
			if (upstream.status === 429) {
				const retryAfter = Math.max(
					60,
					Number(upstream.headers.get("Retry-After")) || 3600,
				);
				await writeProviderState(
					env.DB,
					now + retryAfter * 1000,
					providerRateLimit,
				);
				const old = fallback();
				if (old) return old;
				throw new ProxyError(429, "Photo provider unavailable", retryAfter);
			}
			const old = fallback();
			if (old) return old;
			throw new ProxyError(502, "Photo provider unavailable", 60);
		}

		const limit = Number(upstream.headers.get("X-Ratelimit-Limit"));
		const remaining = Number(upstream.headers.get("X-Ratelimit-Remaining"));
		const reset = Number(upstream.headers.get("X-Ratelimit-Reset"));
		const nextRateLimit =
			limit > 0 && remaining >= 0 && reset > now / 1000
				? { limit, remaining, reset }
				: providerRateLimit;

		try {
			const photos = parsePhotos(await upstream.json());
			await writeCache(env.DB, query, page, now, photos, nextRateLimit);
			await writeProviderState(env.DB, 0, nextRateLimit);
			return json({
				photos,
				query,
				page,
				cached: false,
				stale: false,
				rateLimit: nextRateLimit,
			});
		} catch (error) {
			if (error instanceof ProxyError) {
				const old = fallback();
				if (old) return old;
				throw error;
			}
			const old = fallback();
			if (old) return old;
			throw new ProxyError(503, "Photo service temporarily unavailable", 60);
		}
	} catch (error) {
		if (error instanceof ProxyError)
			return json(
				{ error: error.message, retryAfter: error.retryAfter },
				error.status,
				error.retryAfter,
			);
		return json(
			{ error: "Photo service temporarily unavailable", retryAfter: 60 },
			503,
			60,
		);
	}
}

export default {
	fetch: handleRequest,
} satisfies ExportedHandler<Env>;
