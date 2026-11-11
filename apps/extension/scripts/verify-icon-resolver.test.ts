// In-memory chrome.storage.local shim — mirrors verify-persistence-protocol.test.ts.
// bun test runs outside a browser, so the store's chrome path needs a `chrome`
// global before the modules under test load; the dynamic imports below keep
// that ordering honest down to the persist layer's first hydration read.
const mem = new Map<string, unknown>();
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

import { beforeEach, describe, expect, test } from "bun:test";
import { DOMParser } from "linkedom";

import type { DecodedAsset, ProbePlan } from "../src/lib/icon-resolver";

// linkedom supplies the DOMParser that the extraction step expects outside a
// browser page context (mirrors verify-bookmark-html-hierarchy.test.ts).
Object.assign(globalThis, { DOMParser });

const {
	assetFamilyKey,
	extractSiteIconCandidates,
	interpretTreatment,
	manifestCandidates,
	iconBrandName,
	googleHQFaviconUrl,
	parsePurpose,
	parseSizes,
	resolveIconForDomain,
	scoreCandidate,
	simpleIconsUrl,
} = await import("../src/lib/icon-resolver");
const { useIconCacheStore } = await import("../src/stores/icon-cache-store");
const {
	saveMacOSiconsSettings,
	searchMacOSicons,
} = await import("../src/services/macosicons");

const OPAQUE_FULL: DecodedAsset = {
	naturalWidth: 180,
	naturalHeight: 180,
	opaqueEdgeRatio: 0.95,
};

const FULL_MEASURE = async () => ({ ...OPAQUE_FULL });

const NONE_MEASURE = async () => null;

function records(): Record<string, unknown> {
	return useIconCacheStore.getState().records as Record<string, unknown>;
}

function resetStore(): void {
	mem.clear();
	useIconCacheStore.setState({ records: {} });
}

const FALLBACK_FETCH = globalThis.fetch;

type FetchResult = {
	ok: boolean;
	status: number;
	url?: string;
	text: string;
};

function stubFetch(handler: (url: string) => FetchResult): void {
	// Response-shaped: the resolver calls await res.text() (method), reads
	// res.ok / res.status / res.url, and uses the no-body text fallback path.
	globalThis.fetch = (async (input: unknown) => {
		const url = String(input);
		const outcome = handler(url);
		return {
			ok: outcome.ok,
			status: outcome.status,
			url: outcome.url ?? url,
			body: null,
			text: () => Promise.resolve(outcome.text),
		};
	}) as unknown as typeof globalThis.fetch;
}

describe("icon resolution ladder (parsers)", () => {
	test("parseSizes reads the widest declared size", () => {
		expect(parseSizes("192x192")).toBe(192);
		expect(parseSizes("512x512 256x256")).toBe(512);
		expect(parseSizes(null)).toBe(0);
		expect(parseSizes("")).toBe(0);
		expect(parseSizes("any")).toBe(0);
	});

	test("candidate scores follow the quality tiers, not a rigid rung order", () => {
		// apple-touch beats a sparse manifest; a big manifest beats svg; …
		expect(scoreCandidate("shadow-touch", 180, false)).toBe(90);
		expect(scoreCandidate("manifest", 192, false)).toBe(86);
		expect(scoreCandidate("rel-icon", 0, true)).toBe(82);
		expect(scoreCandidate("manifest", 96, false)).toBeLessThan(82);
		expect(scoreCandidate("rel-icon", 0 /* unknown raster */, false)).toBe(45);
	});

	test("manifest purpose decides what may ever be shown", () => {
		// A monochrome entry is an ALPHA MASK (the spec discards its colour):
		// it can never be the icon we render.
		expect(scoreCandidate("manifest", 512, false, "monochrome")).toBe(0);
		// "any" is the real icon; "maskable" is padded artwork, so it ranks
		// just below an "any" icon of the same size.
		expect(scoreCandidate("manifest", 512, false, "maskable")).toBeLessThan(
			scoreCandidate("manifest", 512, false, "any"),
		);
		expect(parsePurpose("any maskable")).toBe("any");
		expect(parsePurpose("maskable")).toBe("maskable");
		expect(parsePurpose("monochrome")).toBe("monochrome");
		expect(parsePurpose("fizzbuzz")).toBe("any");
		expect(parsePurpose(undefined)).toBe("any");
	});

	test("an apple-touch-icon file outranks a generic manifest raster", () => {
		const generic = scoreCandidate("manifest", 192, false, "any");
		const appIcon = scoreCandidate(
			"manifest",
			192,
			false,
			"any",
			"https://example.com/apple-touch-icon-192x192.png",
		);
		expect(appIcon).toBeGreaterThan(generic);
	});

	test("only app-scale rasters can become an app tile", () => {
		// A 32px favicon is a favicon, even when it is fully opaque.
		expect(
			interpretTreatment({
				naturalWidth: 32,
				naturalHeight: 32,
				opaqueEdgeRatio: 1,
			}),
		).toBe("glyph");
		// 96px+ and opaque → the artwork IS the icon.
		expect(
			interpretTreatment({
				naturalWidth: 96,
				naturalHeight: 96,
				opaqueEdgeRatio: 0.95,
			}),
		).toBe("full");
	});

	test("one artwork family is probed once, whatever sizes it ships", () => {
		expect(assetFamilyKey("https://x.dev/apple-touch-icon-256x256.png")).toBe(
			"apple-touch-icon",
		);
		expect(assetFamilyKey("https://x.dev/apple-touch-icon-57x57.png")).toBe(
			"apple-touch-icon",
		);
		expect(assetFamilyKey("https://x.dev/favicon_192x192_v2.png")).toBe(
			"favicon",
		);
		// Different artwork keeps its own key.
		expect(assetFamilyKey("https://x.dev/app-icon-512-abc123.png")).toBe(
			"app-icon-512-abc123",
		);
	});

	test("treatment classification: opaque large squares go full, small or hollow stay glyph", () => {
		expect(
			interpretTreatment({
				naturalWidth: 96,
				naturalHeight: 96,
				opaqueEdgeRatio: 0.9,
			}),
		).toBe("full");
		expect(
			interpretTreatment({
				naturalWidth: 96,
				naturalHeight: 96,
				opaqueEdgeRatio: 0.4,
			}),
		).toBe("glyph");
		expect(
			interpretTreatment({
				naturalWidth: 32,
				naturalHeight: 32,
				opaqueEdgeRatio: 0.99,
			}),
		).toBe("glyph");
	});

	test("extraction resolves hrefs and orders nothing (scoring stays pure)", () => {
		const doc = new DOMParser().parseFromString(
			`<html><head>
				<link rel="apple-touch-icon" sizes="180x180" href="/touch.png">
				<link rel="apple-touch-icon" href="/touch-120.png" sizes="120x120">
				<link rel="icon" type="image/svg+xml" href="icon.svg">
				<link rel="shortcut icon" href="/favicon.ico">
				<link rel="manifest" href="/site.webmanifest">
			</head><body></body></html>`,
			"text/html",
		);
		const plan: ProbePlan = extractSiteIconCandidates(
			doc as unknown as Document,
			"https://example.com/app/",
		);
		const hrefs = plan.candidates.map((c) => c.href);
		expect(hrefs).toContain("https://example.com/touch.png");
		// Relative hrefs resolve against the page's directory, not the origin.
		expect(hrefs).toContain("https://example.com/app/icon.svg");
		expect(hrefs).toContain("https://example.com/favicon.ico");
		expect(plan.manifestHref).toBe("https://example.com/site.webmanifest");
		const apple = plan.candidates.filter((c) => c.source === "shadow-touch");
		expect(apple).toHaveLength(2);
	});

	test("<base href> anchors relative icon URLs", () => {
		const doc = new DOMParser().parseFromString(
			`<html><head><base href="https://cdn.example.net/a/b/">
				<link rel="icon" href="mark.png" sizes="64x64">
			</head><body></body></html>`,
			"text/html",
		);
		const plan = extractSiteIconCandidates(
			doc as unknown as Document,
			"https://example.com/",
		);
		expect(plan.candidates[0]?.href).toBe(
			"https://cdn.example.net/a/b/mark.png",
		);
	});

	test("manifest candidates come out sorted widest-first with absolute URLs", () => {
		const list = manifestCandidates(
			"https://example.com/site.webmanifest",
			`{"icons":[
				{"src":"/a-192.png","sizes":"192x192"},
				{"src":"/a-512.png","sizes":"512x512"},
				{"src":"b.svg","type":"image/svg+xml"}
			]}`,
		);
		expect(list[0]?.href).toBe("https://example.com/a-512.png");
		expect(list[list.length - 1]?.isSvg).toBe(true);
		expect(list.every((c) => c.href.startsWith("https://"))).toBe(true);
	});
});

describe("icon resolution ladder (end-to-end records)", () => {
	beforeEach(() => {
		resetStore();
		globalThis.fetch = FALLBACK_FETCH;
	});

	test("apple-touch icon wins and is recorded as a full tile", async () => {
		stubFetch((url) => ({
			ok: true,
			status: 200,
			text:
				url === "https://example.org/"
					? '<html><head><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"></head><body></body></html>'
					: "",
		}));
		await resolveIconForDomain(
			"example.org",
			"https://example.org/",
			FULL_MEASURE,
		);
		const record = records()["example.org"] as
			| { kind: string; source: string; treatment: string; src: string }
			| undefined;
		expect(record).toBeDefined();
		expect(record?.kind).toBe("image");
		expect(record?.source).toBe("shadow-touch");
		expect(record?.treatment).toBe("full");
		expect(record?.src).toBe("https://example.org/apple-touch-icon.png");
	});

	test("a dead-end site records a negative only after the provider verifies it", async () => {
		const ddgStatuses = new Map<string, number>();
		stubFetch((url) => {
			ddgStatuses.set(url, 404);
			return { ok: false, status: 404, text: "" };
		});
		await resolveIconForDomain(
			"bare.example",
			"https://bare.example/",
			NONE_MEASURE,
		);
		const record = records()["bare.example"] as
			| { kind: string; source: string }
			| undefined;
		expect(record).toBeDefined();
		expect(record?.kind).toBe("none");
		expect(record?.source).toBe("provider");
	});

	test("an unreachable site never gets a (false) negative record", async () => {
		stubFetch(() => {
			throw new Error("offline");
		});
		await resolveIconForDomain(
			"down.example",
			"https://down.example/",
			NONE_MEASURE,
		);
		expect(records()["down.example"]).toBeUndefined();
	});

	test("when the page has no links but /favicon.ico decodes, the direct rung wins", async () => {
		stubFetch((url) => ({
			ok: true,
			status: 200,
			text:
				url === "https://minimal.example/"
					? "<html><head><title>minimal</title></head></html>"
					: "",
		}));
		await resolveIconForDomain(
			"minimal.example",
			"https://minimal.example/",
			// favicon.ico measures via origin both as a 16px glyph-shaped asset
			// and ico path; use the full tile to confirm data flows through.
			FULL_MEASURE,
		);
		const record = records()["minimal.example"] as
			| { kind: string; source: string; src: string }
			| undefined;
		expect(record?.kind).toBe("image");
		expect(record?.source).toBe("probe");
		expect(record?.src).toBe("https://minimal.example/favicon.ico");
	});

	test("a manifest's monochrome mask is never selected, even at 512px", async () => {
		// YouTube's real manifest shape: a monochrome 512 logo, a maskable
		// 512 logo and the actual "any" 192 app icon. Only the "any" entry
		// may ever be shown.
		stubFetch((url) => {
			if (url === "https://mono.example/") {
				return {
					ok: true,
					status: 200,
					text: '<html><head><link rel="manifest" href="/app.webmanifest"></head><body></body></html>',
				};
			}
			if (url === "https://mono.example/app.webmanifest") {
				return {
					ok: true,
					status: 200,
					text: JSON.stringify({
						icons: [
							{
								src: "/logo_512x512.png",
								sizes: "512x512",
								purpose: "monochrome",
							},
							{
								src: "/maskable_512x512.png",
								sizes: "512x512",
								purpose: "maskable",
							},
							{ src: "/favicon_192x192.png", sizes: "192x192" },
						],
					}),
				};
			}
			return { ok: true, status: 200, text: "" };
		});
		await resolveIconForDomain(
			"mono.example",
			"https://mono.example/",
			FULL_MEASURE,
		);
		const record = records()["mono.example"] as
			| { kind: string; source: string; src: string; treatment: string }
			| undefined;
		expect(record?.src).toBe("https://mono.example/favicon_192x192.png");
		expect(record?.treatment).toBe("full");
	});

	test("ten apple-touch sizes do not starve the real app icon", async () => {
		// A site that ships the same artwork in ten sizes plus one manifest
		// app icon: the family dedup keeps the decode budget for the icon
		// that actually matters.
		const sizes = [57, 60, 72, 76, 114, 120, 144, 152, 180, 256];
		const links = sizes
			.map(
				(size) =>
					`<link rel="apple-touch-icon" sizes="${size}x${size}" href="/apple-touch-icon-${size}x${size}.png">`,
			)
			.join("");
		stubFetch((url) => {
			if (url === "https://many.example/") {
				return {
					ok: true,
					status: 200,
					text: `<html><head>${links}<link rel="manifest" href="/app.webmanifest"></head><body></body></html>`,
				};
			}
			if (url === "https://many.example/app.webmanifest") {
				return {
					ok: true,
					status: 200,
					text: JSON.stringify({
						icons: [{ src: "/app-icon-512.png", sizes: "512x512" }],
					}),
				};
			}
			return { ok: true, status: 200, text: "" };
		});
		await resolveIconForDomain(
			"many.example",
			"https://many.example/",
			// The apple-touch family is transparent (a mark, not a tile), so
			// only the manifest icon can be the app tile.
			async (assetUrl) =>
				assetUrl.includes("apple-touch-icon")
					? { naturalWidth: 256, naturalHeight: 256, opaqueEdgeRatio: 0.2 }
					: { naturalWidth: 512, naturalHeight: 512, opaqueEdgeRatio: 1 },
		);
		const record = records()["many.example"] as
			| { kind: string; source: string; src: string; treatment: string }
			| undefined;
		expect(record?.src).toBe("https://many.example/app-icon-512.png");
		expect(record?.treatment).toBe("full");
	});

	test("a provider hit fills the record when the site declares no icons", async () => {
		// Site is up, but page/doctype declares nothing and /favicon.ico is
		// dead (measure says no); DDG still has a verifiable glyph for it.
		stubFetch((url) => ({
			ok: true,
			status: 200,
			text:
				url === "https://ddg.example/"
					? "<html><head><title>ddg fallback</title></head></html>"
					: "",
		}));
		await resolveIconForDomain(
			"ddg.example",
			"https://ddg.example/",
			async (assetUrl) =>
				assetUrl === "https://icons.duckduckgo.com/ip3/ddg.example.ico"
					? { naturalWidth: 48, naturalHeight: 48, opaqueEdgeRatio: 0.3 }
					: null,
		);
		const record = records()["ddg.example"] as
			| { kind: string; source: string; src: string; treatment: string }
			| undefined;
		expect(record?.kind).toBe("image");
		expect(record?.source).toBe("provider");
		expect(record?.src).toBe(
			"https://icons.duckduckgo.com/ip3/ddg.example.ico",
		);
		expect(record?.treatment).toBe("glyph");
	});

	test("invalid URLs write nothing", async () => {
		await resolveIconForDomain("chrome", "chrome://settings/", FULL_MEASURE);
		await resolveIconForDomain("", "https://example.com/", FULL_MEASURE);
		expect(Object.keys(records()) ?? []).toHaveLength(0);
	});

	test("online provider URLs normalize common brand names", () => {
		expect(iconBrandName("github.com")).toBe("GitHub");
		expect(iconBrandName("chatgpt.com")).toBe("ChatGPT");
		expect(simpleIconsUrl("github.com")).toBe(
			"https://cdn.simpleicons.org/github",
		);
		expect(simpleIconsUrl("linear.app")).toBe(
			"https://cdn.simpleicons.org/linear",
		);
		expect(googleHQFaviconUrl("github.com")).toContain("sz=128");
		expect(googleHQFaviconUrl("bad domain")).toBeNull();
	});

	test("macOSicons searches use the personal key and reject unsafe asset URLs", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const hit = await searchMacOSicons(
			"GitHub",
			"personal-key",
			(async (input, init) => {
				requests.push({ url: String(input), init });
				return new Response(
					JSON.stringify({
						hits: [
							{ lowResPngUrl: "http://insecure.example/icon.png" },
							{
								appName: "GitHub",
								lowResPngUrl: "https://cdn.example/icon.png",
								credit: "Example Artist",
								creditUrl: "javascript:alert(1)",
								uploadedBy: "uploader",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}) as typeof fetch,
		);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://api.macosicons.com/api/v1/search");
		expect(requests[0]?.init?.method).toBe("POST");
		expect(new Headers(requests[0]?.init?.headers).get("x-api-key")).toBe(
			"personal-key",
		);
		expect(requests[0]?.init?.body).toBe(JSON.stringify({ query: "GitHub" }));
		expect(hit).toMatchObject({
			lowResPngUrl: "https://cdn.example/icon.png",
			credit: "Example Artist",
			creditUrl: "",
			uploadedBy: "uploader",
		});
	});

	test("macOSicons is skipped without opt-in and Simple Icons only runs after opt-in", async () => {
		const measured: string[] = [];
		await saveMacOSiconsSettings({ enabled: false, apiKey: "" });
		globalThis.fetch = (async (input: unknown) => {
			const url = String(input);
			if (url === "https://github.com/")
				return new Response("<html><head></head><body></body></html>");
			if (url === "https://api.svgl.app") return new Response("[]");
			if (url.includes("duckduckgo.com")) return new Response("", { status: 404 });
			return new Response("", { status: 404 });
		}) as typeof fetch;
		await resolveIconForDomain("github.com", "https://github.com/", async (src) => {
			measured.push(src);
			return src.includes("simpleicons")
				? { naturalWidth: 256, naturalHeight: 256, opaqueEdgeRatio: 0.1 }
				: null;
		});
		expect(measured).not.toContain("https://cdn.simpleicons.org/github");
		expect(records()["github.com"]).toMatchObject({
			kind: "none",
			source: "provider",
		});

		measured.length = 0;
		await saveMacOSiconsSettings({ enabled: true, apiKey: "" });
		await resolveIconForDomain("github.com", "https://github.com/", async (src) => {
			measured.push(src);
			return src.includes("simpleicons")
				? { naturalWidth: 256, naturalHeight: 256, opaqueEdgeRatio: 0.1 }
				: null;
		});
		expect(measured).toContain("https://cdn.simpleicons.org/github");
		expect(records()["github.com"]).toMatchObject({
			kind: "image",
			source: "simple-icons",
			src: "https://cdn.simpleicons.org/github",
		});
	});

	test("macOSicons is the first icon rung when a user key is configured", async () => {
		await saveMacOSiconsSettings({ enabled: true, apiKey: "personal-key" });
		const calls: string[] = [];
		globalThis.fetch = (async (input: unknown) => {
			calls.push(String(input));
			return new Response(
				JSON.stringify({
					hits: [
						{
							appName: "GitHub",
							lowResPngUrl: "https://cdn.example/github.png",
							credit: "Creator",
							creditUrl: "https://creator.example/",
							uploadedBy: "Uploader",
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as typeof fetch;
		await resolveIconForDomain("github.com", "https://github.com/", async (src) =>
			src === "https://cdn.example/github.png"
				? { naturalWidth: 512, naturalHeight: 512, opaqueEdgeRatio: 1 }
				: null,
		);
		expect(calls).toEqual(["https://api.macosicons.com/api/v1/search"]);
		expect(records()["github.com"]).toMatchObject({
			kind: "image",
			source: "macosicons",
			credit: "Creator",
			creditUrl: "https://creator.example/",
			uploadedBy: "Uploader",
		});
	});

	test("Google S2 is used after Simple Icons misses", async () => {
		await saveMacOSiconsSettings({ enabled: true, apiKey: "" });
		const measured: string[] = [];
		await resolveIconForDomain("unknown.example", "https://unknown.example/", async (src) => {
			measured.push(src);
			return src.includes("google.com/s2/favicons")
				? { naturalWidth: 128, naturalHeight: 128, opaqueEdgeRatio: 0.6 }
				: null;
		});
		expect(measured[0]).toBe("https://cdn.simpleicons.org/unknown");
		expect(measured[1]).toContain("https://www.google.com/s2/favicons?domain=unknown.example&sz=128");
		expect(records()["unknown.example"]).toMatchObject({
			kind: "image",
			source: "google-favicon",
		});
	});
});
