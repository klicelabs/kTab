import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DEFAULT_PEXELS_QUERY,
	normalizePexelsQuery,
	PexelsProxy,
} from "../../web/src/lib/pexels-proxy";

const folders: string[] = [];
afterEach(async () => {
	for (const folder of folders.splice(0))
		await rm(folder, { recursive: true, force: true });
});
function request(query = DEFAULT_PEXELS_QUERY, page = 1) {
	return new Request("https://dashboard.test/api/pexels", {
		method: "POST",
		body: JSON.stringify({ query, page }),
	});
}
const photo = {
	id: 1,
	width: 4000,
	height: 2400,
	url: "https://www.pexels.com/photo/one-1/",
	photographer: "Jane",
	photographer_url: "https://www.pexels.com/@jane/",
	src: {
		original: "https://images.pexels.com/a.jpg",
		large2x: "https://images.pexels.com/a.jpg?w=1880",
		large: "https://images.pexels.com/a.jpg?w=940",
		medium: "https://images.pexels.com/a.jpg?w=350",
		small: "https://images.pexels.com/a.jpg?w=130",
	},
};
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "ktab-pexels-test-"));
	folders.push(directory);
	let now = Date.now();
	let count = 0;
	let result = () => Response.json({ photos: [photo] });
	let lastUrl = "";
	const fetcher = (async (input: RequestInfo | URL) => {
		count++;
		lastUrl = String(input);
		return result();
	}) as typeof fetch;
	const options = { directory, apiKey: "test-key", fetcher, now: () => now };
	return {
		directory,
		proxy: new PexelsProxy(options),
		options,
		count: () => count,
		url: () => new URL(lastUrl),
		advance: (duration: number) => {
			now += duration;
		},
		result: (factory: () => Response) => {
			result = factory;
		},
	};
}
describe("durable Pexels proxy", () => {
	test("normalizes search without replacing custom keywords", () => {
		expect(normalizePexelsQuery("  Spider-Man   JAPAN ")).toBe(
			"spider-man japan",
		);
		expect(normalizePexelsQuery(undefined)).toBe(DEFAULT_PEXELS_QUERY);
		expect(() => normalizePexelsQuery("a".repeat(81))).toThrow();
	});
	test("requires durable configuration before making network requests", async () => {
		const f = await fixture();
		const proxy = new PexelsProxy({ ...f.options, directory: undefined });
		expect((await proxy.handle(request())).status).toBe(503);
		expect(f.count()).toBe(0);
	});
	test("missing key returns a recoverable service error", async () => {
		const f = await fixture();
		expect(
			(
				await new PexelsProxy({ ...f.options, apiKey: undefined }).handle(
					request(),
				)
			).status,
		).toBe(503);
		expect(f.count()).toBe(0);
	});
	test("requests 80 landscape photos and shares normalized batches across instances", async () => {
		const f = await fixture();
		const first = await f.proxy.handle(request(" JAPAN "));
		expect(first.status).toBe(200);
		expect(f.url().searchParams.get("per_page")).toBe("80");
		expect(f.url().searchParams.get("orientation")).toBe("landscape");
		expect(f.url().searchParams.get("query")).toBe("japan 4k");
		const second = await new PexelsProxy(f.options).handle(request("japan"));
		expect((await second.json()).cached).toBe(true);
		expect(f.count()).toBe(1);
	});
	test("a transient upstream failure does not cool down other searches", async () => {
		const f = await fixture();
		f.result(() => {
			throw new TypeError("network offline");
		});
		expect((await f.proxy.handle(request("japan"))).status).toBe(503);
		f.result(() => Response.json({ photos: [photo] }));
		expect((await f.proxy.handle(request("earth"))).status).toBe(200);
		expect(f.url().searchParams.get("query")).toBe("earth 4k");
		expect(f.count()).toBe(2);
	});
	test("coalesces simultaneous requests with a durable lock", async () => {
		const f = await fixture();
		const results = await Promise.all([
			f.proxy.handle(request()),
			new PexelsProxy(f.options).handle(request()),
		]);
		expect(results.every((r) => r.ok)).toBe(true);
		expect(f.count()).toBe(1);
	});
	test("competing waiters fail closed on an abandoned lock instead of recovering it by age", async () => {
		const f = await fixture();
		const lock = join(f.directory, "request.lock");
		await mkdir(lock);
		const old = new Date(Date.now() - 120_000);
		await utimes(lock, old, old);
		const results = await Promise.all([
			new PexelsProxy({ ...f.options, lockTimeoutMs: 20 }).handle(request()),
			new PexelsProxy({ ...f.options, lockTimeoutMs: 20 }).handle(request()),
		]);
		expect(results.map((result) => result.status)).toEqual([503, 503]);
		expect(await readdir(lock)).toEqual([]);
		expect(f.count()).toBe(0);
	});
	test("a former owner's release never removes a replacement owner's lock", async () => {
		const f = await fixture();
		const started = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const fetcher = (async () => {
			started.resolve();
			await finish.promise;
			return Response.json({ photos: [photo] });
		}) as typeof fetch;
		const pending = new PexelsProxy({ ...f.options, fetcher }).handle(
			request(),
		);
		await started.promise;
		const lock = join(f.directory, "request.lock");
		await rm(lock, { recursive: true });
		await mkdir(lock);
		await writeFile(join(lock, "owner-replacement"), "");
		finish.resolve();
		expect((await pending).status).toBe(200);
		expect(await readdir(lock)).toEqual(["owner-replacement"]);
	});
	test("stalled request bodies time out, cancel and release all admission slots", async () => {
		const f = await fixture();
		let cancelled = 0;
		const proxy = new PexelsProxy({ ...f.options, bodyTimeoutMs: 30 });
		const stalled = Array.from({ length: 32 }, () => {
			const body = new ReadableStream<Uint8Array>({
				cancel() {
					cancelled++;
					return new Promise<void>(() => undefined);
				},
			});
			return proxy.handle(
				new Request("https://example.test", { method: "POST", body }),
			);
		});
		expect((await proxy.handle(request())).status).toBe(429);
		expect(
			(await Promise.all(stalled)).every((result) => result.status === 408),
		).toBe(true);
		expect(cancelled).toBe(32);
		expect((await proxy.handle(request())).status).toBe(200);
		expect(f.count()).toBe(1);
	});
	test("aborting a stalled body cancels its reader immediately", async () => {
		const f = await fixture();
		let cancelled = false;
		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			},
		});
		const pending = f.proxy.handle(
			new Request("https://example.test", {
				method: "POST",
				body,
				signal: controller.signal,
			}),
		);
		controller.abort();
		expect((await pending).status).toBe(408);
		expect(cancelled).toBe(true);
		expect((await f.proxy.handle(request())).status).toBe(200);
	});
	test("returns empty batches without changing query and caches them", async () => {
		const f = await fixture();
		f.result(() => Response.json({ photos: [] }));
		const res = await f.proxy.handle(request("spider-man"));
		expect((await res.json()).photos).toEqual([]);
		await f.proxy.handle(request("Spider-Man"));
		expect(f.count()).toBe(1);
		expect(f.url().searchParams.get("query")).toBe("spider-man 4k");
	});
	test("filters portrait, low-resolution and non-Pexels URLs", async () => {
		const f = await fixture();
		f.result(() =>
			Response.json({
				photos: [
					photo,
					{ ...photo, id: 2, width: 1000 },
					{ ...photo, id: 3, url: "https://evil.test" },
					{ ...photo, id: 4, height: 5000 },
				],
			}),
		);
		expect(
			(await (await f.proxy.handle(request())).json()).photos,
		).toHaveLength(1);
	});
	test("rejects invalid pages and oversized bodies before upstream access", async () => {
		const f = await fixture();
		expect((await f.proxy.handle(request("nature", 6))).status).toBe(400);
		const oversized = new Request("https://example.test", {
			method: "POST",
			body: "x".repeat(3000),
		});
		expect((await f.proxy.handle(oversized)).status).toBe(413);
		expect(f.count()).toBe(0);
	});
	test("keeps stale batches when upstream fails and blocks subsequent requests after 429", async () => {
		const f = await fixture();
		await f.proxy.handle(request());
		f.advance(86_400_001);
		f.result(() => new Response(null, { status: 429 }));
		const stale = await f.proxy.handle(request());
		expect(stale.status).toBe(200);
		expect((await stale.json()).stale).toBe(true);
		expect((await f.proxy.handle(request("Japan"))).status).toBe(429);
		expect(f.count()).toBe(2);
	});
	test("provider remaining/reset headers prevent new upstream requests", async () => {
		const f = await fixture();
		f.result(() =>
			Response.json(
				{ photos: [photo] },
				{
					headers: {
						"X-Ratelimit-Limit": "20000",
						"X-Ratelimit-Remaining": "1",
						"X-Ratelimit-Reset": String(Math.floor(Date.now() / 1000) + 86400),
					},
				},
			),
		);
		await f.proxy.handle(request());
		expect((await f.proxy.handle(request("Japan"))).status).toBe(429);
		expect(f.count()).toBe(1);
	});
	test("limits arbitrary searches while preserving the preset quota reserve", async () => {
		const f = await fixture();
		for (let i = 0; i < 20; i++)
			expect((await f.proxy.handle(request(`search ${i}`))).status).toBe(200);
		expect((await f.proxy.handle(request("other search"))).status).toBe(429);
		expect((await f.proxy.handle(request())).status).toBe(200);
		expect(f.count()).toBe(21);
	});
	test("rolling global budget survives a new proxy instance", async () => {
		const f = await fixture();
		await f.proxy.handle(request());
		const path = join(f.directory, "state.json");
		const state = JSON.parse(await readFile(path, "utf8"));
		state.calls = Array.from({ length: 150 }, () => Date.now());
		await writeFile(path, JSON.stringify(state));
		expect(
			(await new PexelsProxy(f.options).handle(request("new search"))).status,
		).toBe(429);
		expect(f.count()).toBe(1);
	});
	test("corrupt durable state fails closed instead of resetting the budget", async () => {
		const f = await fixture();
		await writeFile(join(f.directory, "state.json"), "not json");
		expect((await f.proxy.handle(request())).status).toBe(503);
		expect(f.count()).toBe(0);
	});
	test("provider errors expose no upstream response text or credentials", async () => {
		const f = await fixture();
		f.result(() => new Response("test-key upstream secret", { status: 500 }));
		const res = await f.proxy.handle(request());
		expect(res.status).toBe(502);
		expect(await res.text()).not.toContain("test-key");
	});
});
