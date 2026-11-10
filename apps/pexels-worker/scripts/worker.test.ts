import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleRequest, normalizePexelsQuery } from "../src/index";

const photo = {
	id: 42,
	width: 3840,
	height: 2160,
	url: "https://www.pexels.com/photo/landscape-42/",
	photographer: "Jane",
	photographer_url: "https://www.pexels.com/@jane/",
	src: {
		original: "https://images.pexels.com/landscape.jpg",
		large2x: "https://images.pexels.com/landscape.jpg?w=1880",
		large: "https://images.pexels.com/landscape.jpg?w=940",
		medium: "https://images.pexels.com/landscape.jpg?w=350",
		small: "https://images.pexels.com/landscape.jpg?w=130",
	},
};

function d1(db: Database) {
	return {
		prepare(sql: string) {
			return {
				bind(...values: unknown[]) {
					return {
						async first<T>() {
							return (
								(db.query(sql).get(...values) as T | null | undefined) ?? null
							);
						},
						async all<T>() {
							return {
								success: true,
								results: db.query(sql).all(...values) as T[],
							};
						},
						async run() {
							const result = db.query(sql).run(...values);
							return {
								success: true,
								meta: { changes: Number(result.changes) },
							};
						},
					};
				},
			};
		},
	} as unknown as D1Database;
}

function fixture() {
	const db = new Database(":memory:");
	db.exec(
		readFileSync(
			join(import.meta.dir, "../migrations/0001_initial.sql"),
			"utf8",
		),
	);
	let now = Date.UTC(2026, 10, 10, 12);
	let fetchCount = 0;
	let lastUrl = "";
	let fetchResult: () => Response | Promise<Response> = () =>
		new Response(JSON.stringify({ photos: [photo] }), {
			headers: {
				"Content-Type": "application/json",
				"X-Ratelimit-Limit": "20000",
				"X-Ratelimit-Remaining": "19999",
				"X-Ratelimit-Reset": String(Math.ceil(now / 1000) + 3600),
			},
		});
	const env = {
		DB: d1(db),
		PEXELS_API_KEY: "test-key",
		PEXELS_LIMITER: { limit: async () => ({ success: true }) },
		__testNow: () => now,
		__testFetch: (async (input: RequestInfo | URL) => {
			fetchCount++;
			lastUrl = String(input);
			return fetchResult();
		}) as typeof fetch,
	};
	return {
		db,
		env,
		fetchCount: () => fetchCount,
		url: () => new URL(lastUrl),
		setNow: (value: number) => (now = value),
		setFetchResult: (next: () => Response | Promise<Response>) =>
			(fetchResult = next),
	};
}

function request(query = "cinematic city 4k", page = 1) {
	return new Request("https://pexels.example/api/pexels", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"cf-connecting-ip": "192.0.2.10",
		},
		body: JSON.stringify({ query, page }),
	});
}

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => {
	for (const f of fixtures.splice(0)) f.db.close();
});

describe("Cloudflare Pexels Worker", () => {
	test("normalizes queries and keeps the default search", () => {
		expect(normalizePexelsQuery("  Cinematic   CITY 4K ")).toBe(
			"cinematic city 4k",
		);
		expect(normalizePexelsQuery(undefined)).toBe(
			"cinematic nature landscape 4k",
		);
		expect(() => normalizePexelsQuery("x".repeat(81))).toThrow();
	});

	test("serves CORS preflight and rejects other methods", async () => {
		const f = fixture();
		fixtures.push(f);
		const options = await handleRequest(
			new Request("https://pexels.example/api/pexels", { method: "OPTIONS" }),
			f.env,
		);
		expect(options.status).toBe(204);
		expect(options.headers.get("Access-Control-Allow-Origin")).toBe("*");
		const get = await handleRequest(
			new Request("https://pexels.example/api/pexels", { method: "GET" }),
			f.env,
		);
		expect(get.status).toBe(405);
	});

	test("fetches validated 4K photos and caches the normalized query in D1", async () => {
		const f = fixture();
		fixtures.push(f);
		const first = await handleRequest(request(" CINEMATIC   CITY 4K "), f.env);
		expect(first.status).toBe(200);
		expect(f.url().searchParams.get("query")).toBe("cinematic city 4k");
		expect(f.url().searchParams.get("per_page")).toBe("80");
		expect(f.url().searchParams.get("orientation")).toBe("landscape");
		const firstBody = await first.json();
		expect(firstBody).toMatchObject({
			query: "cinematic city 4k",
			cached: false,
		});
		expect(firstBody.photos).toHaveLength(1);
		const second = await handleRequest(request("cinematic city 4k"), f.env);
		expect((await second.json()).cached).toBe(true);
		expect(f.fetchCount()).toBe(1);
	});

	test("rejects invalid pages before contacting Pexels", async () => {
		const f = fixture();
		fixtures.push(f);
		const response = await handleRequest(
			request("cinematic city 4k", 6),
			f.env,
		);
		expect(response.status).toBe(400);
		expect(f.fetchCount()).toBe(0);
	});

	test("limits custom searches to twenty upstream calls per hour", async () => {
		const f = fixture();
		fixtures.push(f);
		for (let index = 0; index < 20; index++) {
			const response = await handleRequest(
				request(`custom subject ${index}`),
				f.env,
			);
			expect(response.status).toBe(200);
		}
		const blocked = await handleRequest(
			request("custom subject blocked"),
			f.env,
		);
		expect(blocked.status).toBe(429);
		expect(f.fetchCount()).toBe(20);
	});

	test("uses stale photos when a refresh fails without blocking another query", async () => {
		const f = fixture();
		fixtures.push(f);
		const cached = await handleRequest(request("cinematic city 4k"), f.env);
		expect(cached.status).toBe(200);
		f.setNow(Date.UTC(2026, 10, 11, 13));
		f.setFetchResult(() => {
			throw new TypeError("temporary network failure");
		});
		const stale = await handleRequest(request("cinematic city 4k"), f.env);
		expect(stale.status).toBe(200);
		expect(await stale.json()).toMatchObject({ cached: true, stale: true });
		f.setFetchResult(() => new Response(JSON.stringify({ photos: [photo] })));
		const other = await handleRequest(
			request("planet earth from space 4k"),
			f.env,
		);
		expect(other.status).toBe(200);
	});
});
