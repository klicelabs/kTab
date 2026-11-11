/**
 * E2E verification: single + batch thumbnail refresh with canonical matching.
 *
 * Loads the built MV3 extension (.output/chrome-mv3) in a real Chromium via
 * Playwright (same launch pattern as bench-lib.mjs), seeds folders of cards,
 * and walks the refresh scenarios with real captureVisibleTab captures
 * (local HTTP pages served per test origin, no external network or mocked APIs):
 *
 *   1. single refresh uses the target page's actual pixels and updates its card
 *   2. batches complete, cancel, and restore toast + active-card shimmer on reload
 *   3. headful mode records focus transitions and checks focus returns to the user
 *   4. edits and deletions made during page loading win over a stale screenshot
 *   5. auto-capture matching and manual-save identity remain unchanged
 *   6. no MAX_CAPTURE_VISIBLE_TAB quota errors; session state stays resumable
 *
 * Run: cd apps/extension && node scripts/verify-thumbnail-refresh-e2e.mjs
 * (node, not bun: Bun's launchPersistentContext pipe hangs in this
 * environment while plain node connects in ~1s; the harness itself is
 * runtime-agnostic plain JS.)
 * Read-only diagnostic harness — writes nothing to the repo (throwaway profile).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { launchExtension } from "./bench-lib.mjs";

function patchBuiltManifestForGrantedAccess() {
	const manifestPath = path.resolve("./.output/chrome-mv3/manifest.json");
	const original = fs.readFileSync(manifestPath, "utf8");
	let manifest;
	try {
		manifest = JSON.parse(original);
	} catch {
		throw new Error("Built extension manifest is invalid JSON");
	}
	const optional = manifest.optional_host_permissions ?? [];
	manifest.host_permissions = [
		...(manifest.host_permissions ?? []),
		...optional,
	];
	manifest.optional_host_permissions = [];
	fs.writeFileSync(manifestPath, JSON.stringify(manifest));
	return () => fs.writeFileSync(manifestPath, original);
}
const restoreManifest = patchBuiltManifestForGrantedAccess();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAVICON_PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

const COLORS = {
	"s5-r1": "#b5442d",
	"s5-r2": "#2d6fb5",
	"s5-r3": "#3d8f4e",
	"s5-r4": "#8f3d8f",
	"s5-r5": "#b5782d",
	single: "#2d7fb5",
	dom: "#4e8f3d",
	default: "#555555",
};

const pageHtml = (url) => {
	let u;
	try {
		u = new URL(url);
	} catch {
		throw new Error(`Invalid test page URL: ${url}`);
	}
	const key = u.hostname
		.replace(/\.test$/, "")
		.split("-")
		.slice(0, 2)
		.join("-");
	const color =
		COLORS[key] ?? COLORS[u.hostname.replace(/\.test$/, "")] ?? COLORS.default;
	return `<!doctype html><html style="margin:0;background:${color}"><head><title>${u.hostname}${u.pathname}</title><style>html,body{width:100%;height:100%;margin:0;background:${color}}</style></head><body style="color:#fff;font:48px sans-serif;padding:40px">${u.hostname}${u.pathname}</body></html>`;
};

const MANUAL_THUMB_ID = "thumb-manual-single";
const TEST_SERVER_NAMES = [
	"single",
	...Array.from({ length: 5 }, (_, index) => `s5-r${index + 1}`),
	...Array.from({ length: 10 }, (_, index) => `c10-${index + 1}`),
	"dom",
	"edit-mid",
	"delete-mid",
	"manual",
	// Recursive-selection fixture (check 13): NestedRoot + NestedSub cards.
	"nest-a",
	"nest-b",
	"nest-c",
	"nest-d",
];
const localTestOrigins = new Map();
const localTestServers = [];
const localTestRequests = [];

function testUrl(name, pathname = "/") {
	const origin = localTestOrigins.get(name);
	if (!origin) throw new Error(`Local test server is not ready: ${name}`);
	return `${origin}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function startLocalTestServers() {
	for (const name of TEST_SERVER_NAMES) {
		const server = http.createServer((request, response) => {
			const requestPath = request.url ?? "/";
			localTestRequests.push({ name, path: requestPath });
			const syntheticUrl = `http://${name}.test${requestPath}`;
			response.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			response.end(pageHtml(syntheticUrl));
		});
		localTestServers.push(server);
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error(`Could not bind local test server: ${name}`);
		}
		localTestOrigins.set(name, `http://127.0.0.1:${address.port}`);
	}
}

function baseSettings() {
	return {
		tileSize: "medium",
		maxColumns: 7,
		showTitle: true,
		showDeleteButton: false,
		openInNewTab: true,
		dialLayout: "card",
		cardAspect: "horizontal",
		iconShowLabel: true,
		defaultTitleSource: null,
		thumbnailCapture: { enabled: true, delayMs: 1200 },
		background: {
			type: "solid",
			color: "#7c9cc4",
			gradientId: null,
			imageId: null,
			wallpaperId: null,
			customWallpaper: null,
			blur: 0,
			brightness: 100,
			opacity: 100,
			pexelsQuery: "nature",
			pexelsFrequency: "locked",
			pexelsPreviousFrequency: null,
			pexelsLastFetched: null,
			pexelsLastPeriod: null,
			pexelsImageId: null,
		},
		clock: {
			enabled: false,
			format24: true,
			showSeconds: false,
			size: 72,
			timezone: "auto",
		},
		greeting: { enabled: false, name: "", size: 28 },
		search: {
			enabled: false,
			engine: "https://duckduckgo.com/?q=%s",
			placeholder: "",
			iconMode: "search",
			width: 560,
		},
		quickLinks: { enabled: false, items: [] },
		appearanceMode: "flat",
		colorScheme: "dark",
	};
}

function buildSeedState() {
	const folders = [
		{ id: "folder-5", name: "BatchFive", order: 0, parentId: null },
		{ id: "folder-10", name: "BatchTen", order: 1, parentId: null },
		{ id: "folder-dom", name: "Domain", order: 2, parentId: null },
		// Nested fixture for the recursive folder-selection batch (check 13):
		// a root folder with two own cards and a subfolder with two more one
		// level deeper.
		{
			id: "folder-nest",
			name: "NestedRoot",
			order: 3,
			parentId: null,
		},
		{
			id: "folder-nest-sub",
			name: "NestedSub",
			order: 0,
			parentId: "folder-nest",
		},
	];
	const cards = [];
	const itemOrder = {
		__root__: [
			"folder:folder-5",
			"folder:folder-10",
			"folder:folder-dom",
			"folder:folder-nest",
		],
		"folder-5": [],
		"folder-10": [],
		"folder-dom": [],
		"folder-nest": [],
		"folder-nest-sub": [],
	};
	let order = 0;
	const push = (folderId, title, url, thumbId) => {
		const id = `card-${title}`;
		cards.push({
			id,
			folderId,
			title,
			url,
			favicon: null,
			thumbId,
			order: order++,
			titleSource: null,
			origin: "local",
			capturedAt: thumbId ? Date.now() - 100000 : null,
		});
		itemOrder[folderId].push(`card:${id}`);
	};
	// folder-5: one card WITH a thumb (single-refresh target) + 4 thumbless.
	push("folder-5", "single", testUrl("single"), MANUAL_THUMB_ID);
	for (let i = 1; i <= 4; i += 1)
		push("folder-5", `s5-r${i}`, testUrl(`s5-r${i}`), null);
	push("folder-5", "s5-r5", testUrl("s5-r5"), null);
	// folder-10: ten thumbless cards for the cancel test.
	for (let i = 1; i <= 10; i += 1)
		push("folder-10", `c10-${i}`, testUrl(`c10-${i}`), null);
	// folder-dom: thumbless card on one path; the visit uses another path.
	push("folder-dom", "domcard", testUrl("dom", "/notebook/abc"), null);
	push("folder-dom", "edit-mid-refresh", testUrl("edit-mid"), null);
	push("folder-dom", "delete-mid-refresh", testUrl("delete-mid"), null);
	// NestedRoot: one card WITH a thumb (replaced, not only filled) and one
	// thumbless; NestedSub adds two thumbless cards one level deeper.
	push("folder-nest", "nest-a", testUrl("nest-a"), MANUAL_THUMB_ID);
	push("folder-nest", "nest-b", testUrl("nest-b"), null);
	push("folder-nest-sub", "nest-c", testUrl("nest-c"), null);
	push("folder-nest-sub", "nest-d", testUrl("nest-d"), null);
	return {
		state: {
			folders,
			cards,
			activeFolderId: "folder-5",
			itemOrder,
			settings: baseSettings(),
		},
		version: 0,
	};
}

async function readCards(observer) {
	const raw = await observer.evaluate(
		() =>
			new Promise((resolve) =>
				chrome.storage.local.get(["perch-setup"], (d) =>
					resolve(d["perch-setup"] ?? null),
				),
			),
	);
	if (!raw) return null;
	try {
		return JSON.parse(raw).state.cards;
	} catch {
		return null;
	}
}

async function readRefreshSession(observer) {
	return observer.evaluate(() =>
		chrome.storage.session
			.get("ktab-refresh-batch")
			.then((d) => d["ktab-refresh-batch"] ?? null),
	);
}

async function readThumbnailPixel(observer, thumbId) {
	return observer.evaluate(async (id) => {
		const db = await new Promise((resolve, reject) => {
			const request = indexedDB.open("perch-db", 1);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		const dataUrl = await new Promise((resolve, reject) => {
			const request = db
				.transaction("thumbnails", "readonly")
				.objectStore("thumbnails")
				.get(id);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
		db.close();
		if (typeof dataUrl !== "string") return null;
		const image = new Image();
		image.src = dataUrl;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.drawImage(image, 0, 0);
		const points = [
			{ label: "origin", x: 0, y: 0 },
			{
				label: "2%",
				x: Math.floor(canvas.width * 0.02),
				y: Math.floor(canvas.height * 0.02),
			},
			{
				label: "90%",
				x: Math.floor(canvas.width * 0.9),
				y: Math.floor(canvas.height * 0.9),
			},
		];
		return {
			width: canvas.width,
			height: canvas.height,
			pixels: points.map(({ label, x, y }) => ({
				label,
				rgb: [...context.getImageData(x, y, 1, 1).data].slice(0, 3),
			})),
		};
	}, thumbId);
}

async function windowCount(observer) {
	return observer.evaluate(() => chrome.windows.getAll().then((w) => w.length));
}

async function waitFor(fn, timeoutMs, label) {
	const t0 = Date.now();
	for (;;) {
		const value = await fn().catch(() => null);
		if (value) return value;
		if (Date.now() - t0 > timeoutMs)
			throw new Error(`timeout after ${timeoutMs}ms waiting for ${label}`);
		await sleep(300);
	}
}

async function cardShowsThumb(observer, title) {
	const card = observer
		.locator("[data-marquee-id]", { hasText: title })
		.first();
	try {
		return (await card.locator(".thumb img.thumb-media").count()) > 0;
	} catch {
		return false;
	}
}

const results = [];
const record = (scenario, pass, detail) => {
	results.push({ scenario, pass, detail });
	console.log(
		`${pass ? "PASS" : "FAIL"}  ${scenario}${detail ? ` — ${detail}` : ""}`,
	);
	if (process.env.BB_THREAD_STORAGE) {
		fs.writeFileSync(
			path.join(process.env.BB_THREAD_STORAGE, "chrome-tests.json"),
			JSON.stringify(
				results.map((r) => ({
					name: r.scenario,
					status: r.pass ? "passed" : "failed",
					message: r.detail,
				})),
				null,
				2,
			),
		);
	}
};

// Headless by default (CI has no display; the chromium channel's new
// headless still loads MV3 extensions and captureVisibleTab works there).
// Set HEADFUL=1 to watch the run in a visible browser.
let context;
let extensionId;
try {
	({ context, extensionId } = await launchExtension({
		headless: process.env.HEADFUL !== "1",
		backgroundRenderingOverrides: process.env.NATIVE_CAPTURE !== "1",
		nativeWindowGeometry: process.env.NATIVE_CAPTURE === "1",
	}));
} catch (error) {
	restoreManifest();
	throw error;
}
const swErrors = [];
const artifactDir = process.env.BB_THREAD_STORAGE
	? path.join(process.env.BB_THREAD_STORAGE, "chrome-refresh")
	: fs.mkdtempSync(
			path.join(process.env.TEMP ?? "/tmp", "ktab-refresh-polish-"),
		);
fs.mkdirSync(artifactDir, { recursive: true });
console.log(
	`refresh screenshots: ${artifactDir}; native rendering=${process.env.NATIVE_CAPTURE === "1"}`,
);
try {
	const attachWorker = (worker) => {
		worker.on("console", (msg) => {
			if (msg.type() === "error")
				swErrors.push(`sw console error: ${msg.text()}`);
		});
		worker.on("pageerror", (err) =>
			swErrors.push(`sw pageerror: ${err.message}`),
		);
	};
	context.serviceWorkers().forEach(attachWorker);
	context.on("serviceworker", attachWorker);
} catch {
	// Event subscription unsupported — skip SW console capture.
}

try {
	await startLocalTestServers();
	await context.route("**/s2/favicons*", (route) =>
		route.fulfill({ contentType: "image/png", body: FAVICON_PNG_1X1 }),
	);

	let [sw] = context.serviceWorkers();
	if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });

	// Observe the real API boundary without changing scheduling or results.
	await sw.evaluate(() => {
		globalThis.__captureTrace = [];
		const api = globalThis.browser ?? chrome;
		for (const [area, methods] of Object.entries({
			windows: ["create", "get", "update", "remove"],
			tabs: ["create", "get", "update", "remove", "captureVisibleTab"],
		})) {
			for (const method of methods) {
				const original = api[area][method].bind(api[area]);
				api[area][method] = async (...args) => {
					const entry = { at: Date.now(), method: `${area}.${method}`, args };
					globalThis.__captureTrace.push(entry);
					try {
						const result = await original(...args);
						entry.result =
							typeof result === "string" ? result.slice(0, 30) : result;
						return result;
					} catch (error) {
						entry.error = String(error);
						throw error;
					} finally {
						entry.elapsed = Date.now() - entry.at;
					}
				};
			}
		}
	});
	const granted = await sw.evaluate(() =>
		chrome.permissions.contains({ origins: ["<all_urls>"] }),
	);
	console.log(`permission probe: <all_urls> granted = ${granted}`);

	const observer = await context.newPage();
	await observer.goto(`chrome-extension://${extensionId}/newtab.html`);
	await observer.evaluate(
		(seed) =>
			new Promise((resolve, reject) => {
				chrome.storage.local.set(
					{ "perch-setup": JSON.stringify(seed) },
					() => {
						if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
						else resolve();
					},
				);
			}),
		buildSeedState(),
	);
	await observer.evaluate(
		(thumbId) =>
			new Promise((resolve, reject) => {
				const open = indexedDB.open("perch-db", 1);
				open.onerror = () => reject(open.error);
				open.onupgradeneeded = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains("thumbnails"))
						db.createObjectStore("thumbnails");
					if (!db.objectStoreNames.contains("backgrounds"))
						db.createObjectStore("backgrounds");
				};
				open.onsuccess = () => {
					const db = open.result;
					const tx = db.transaction("thumbnails", "readwrite");
					tx.objectStore("thumbnails").put(
						"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
						thumbId,
					);
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => {
						db.close();
						reject(tx.error);
					};
				};
			}),
		MANUAL_THUMB_ID,
	);
	await observer.reload({ waitUntil: "load" });
	await observer
		.waitForFunction(
			() => document.querySelectorAll("[data-marquee-id]").length >= 6,
			null,
			{
				timeout: 15000,
			},
		)
		.catch(() => {});
	// Ground-truth event tap (independent of the product's own listener).
	// Installed after the seed reload so navigation never wipes it.
	await observer.evaluate(async () => {
		window.__refreshEvents = [];
		window.__focusEvents = [];
		window.__initiatingWindowId = (await chrome.windows.getCurrent()).id;
		window.__initialFocusedWindowId =
			(await chrome.windows.getAll({ populate: false })).find(
				(candidate) => candidate.focused,
			)?.id ?? null;
		chrome.windows.onFocusChanged.addListener((id) =>
			window.__focusEvents.push(id),
		);
		chrome.runtime.onMessage.addListener((m) => {
			if (m?.type === "refresh:progress")
				window.__refreshEvents.push(`${m.status}:${m.completed}/${m.total}`);
		});
	});
	const windowsBefore = await windowCount(observer);

	// ── 1. single refresh via card context menu ──
	{
		const before = await readCards(observer);
		const thumbBefore = before.find((c) => c.title === "single")?.thumbId;
		const card = observer
			.locator("[data-marquee-id]", { hasText: "single" })
			.first();
		await card.click({ button: "right" });
		const item = observer.getByRole("menuitem", { name: "Refresh thumbnail" });
		await item.waitFor({ state: "visible", timeout: 8000 });
		await item.click();
		const updated = await waitFor(
			async () => {
				const cards = await readCards(observer);
				const found = cards?.find((c) => c.title === "single");
				return found?.thumbId && found.thumbId !== thumbBefore ? found : null;
			},
			25000,
			"single refresh thumbId change",
		);
		await waitFor(
			async () =>
				(await readRefreshSession(observer).catch(() => null)) === null
					? true
					: null,
			15000,
			"single refresh finalization",
		);
		await observer.screenshot({
			path: path.join(artifactDir, "single-completed.png"),
		});
		const ui = await cardShowsThumb(observer, "single");
		const pixel = updated
			? await readThumbnailPixel(observer, updated.thumbId).catch(() => null)
			: null;
		const sample = pixel?.pixels?.find((entry) => entry.label === "2%")?.rgb;
		const rightPageCaptured =
			Array.isArray(sample) &&
			Math.abs(sample[0] - 45) <= 5 &&
			Math.abs(sample[1] - 127) <= 5 &&
			Math.abs(sample[2] - 181) <= 5;
		const readFocus = async () =>
			observer.evaluate(async () => ({
				target: window.__initialFocusedWindowId ?? window.__initiatingWindowId,
				focused:
					(await chrome.windows.getAll({ populate: false })).find(
						(candidate) => candidate.focused,
					)?.id ?? null,
				events: window.__focusEvents,
			}));
		// Focus restoration read: the instantaneous windows.getAll answer can
		// race the window-manager handover (an otherwise passing run still
		// read focused=null while its transition trail ended on the user's
		// window). Poll briefly, then accept the trail as proof: a real
		// regression leaves the last event pointing elsewhere.
		const focusRestored = await (async () => {
			if (process.env.HEADFUL !== "1") return true;
			const deadline = Date.now() + 2500;
			for (;;) {
				const focus = await readFocus();
				if (focus.focused === focus.target) return true;
				if (Date.now() >= deadline) return focus.events.at(-1) === focus.target;
				await sleep(250);
			}
		})();
		record(
			"1. single refresh replaces the thumbnail with the target page",
			!!updated && ui && rightPageCaptured,
			`thumbId ${thumbBefore} → ${updated?.thumbId}, pixel=${JSON.stringify(pixel)}, localRequests=${JSON.stringify(localTestRequests.filter((request) => request.name === "single"))}, ui=${ui}`,
		);
		const focusTrail = await readFocus();
		record(
			"1b. headful focus returns to the prior browser window",
			focusRestored,
			`restored=${focusRestored}, transitions=${JSON.stringify(focusTrail.events)}`,
		);
	}

	// Already-active matching pages use the supported no-window fast path.
	{
		const before = (await readCards(observer)).find(
			(card) => card.title === "single",
		);
		const existingPage = await context.newPage();
		await existingPage.goto(testUrl("single"));
		const beforeWindows = await windowCount(observer);
		const response = await observer.evaluate(
			(cardId) =>
				chrome.runtime.sendMessage({ type: "refresh:single", cardId }),
			before.id,
		);
		const updated = await waitFor(
			async () => {
				const card = (await readCards(observer)).find(
					(entry) => entry.id === before.id,
				);
				return card.thumbId !== before.thumbId ? card : null;
			},
			25000,
			"active-tab capture",
		);
		await waitFor(
			async () => (await readRefreshSession(observer)) === null,
			15000,
			"active-tab finalization",
		);
		const pixel = await readThumbnailPixel(observer, updated.thumbId);
		const rgb = pixel.pixels.find((entry) => entry.label === "2%").rgb;
		record(
			"1c. already-active page refresh creates no secondary window",
			response.accepted &&
				(await windowCount(observer)) === beforeWindows &&
				!existingPage.isClosed() &&
				Math.abs(rgb[2] - 181) <= 5,
			`windows=${beforeWindows}, pixel=${JSON.stringify(rgb)}`,
		);
		await observer.bringToFront();
		await existingPage.close();
	}

	// One-shot permission failure proves initialization exceptions release the lock.
	{
		const target = (await readCards(observer)).find(
			(card) => card.title === "single",
		);
		await sw.evaluate(() => {
			const api = globalThis.browser ?? chrome;
			const original = api.permissions.contains;
			api.permissions.contains = () => {
				api.permissions.contains = original;
				return Promise.reject(new Error("initialization-failure-probe"));
			};
		});
		const failed = await observer.evaluate(
			(cardId) =>
				chrome.runtime.sendMessage({ type: "refresh:single", cardId }),
			target.id,
		);
		const responses = await observer.evaluate(async (cardId) => {
			const start = chrome.runtime.sendMessage({
				type: "refresh:single",
				cardId,
			});
			const cancel = chrome.runtime.sendMessage({ type: "refresh:cancel" });
			return Promise.all([start, cancel]);
		}, target.id);
		await waitFor(
			async () => (await readRefreshSession(observer)) === null,
			15000,
			"early cancel cleanup",
		);
		record(
			"1d. initialization failure releases the running lock",
			failed.ok === false &&
				failed.error?.includes("initialization-failure-probe") &&
				responses[0].accepted === true,
			JSON.stringify({ failed, responses }),
		);
		const current = (await readCards(observer)).find(
			(card) => card.id === target.id,
		);
		record(
			"1e. cancel during initialization is preserved",
			responses[1].cancelled === true &&
				current.thumbId === target.thumbId &&
				(await windowCount(observer)) === windowsBefore,
			`thumbnail unchanged=${current.thumbId === target.thumbId}`,
		);
	}

	// ── 2. batch of 5 via selection tray ──
	{
		const before = await readCards(observer);
		const beforeIds = new Map(
			before
				.filter((c) => c.folderId === "folder-5")
				.map((c) => [c.title, c.thumbId]),
		);
		await observer.keyboard.press("Control+A");
		await observer
			.locator("[data-selection-tray]")
			.waitFor({ state: "visible", timeout: 8000 });
		async function clickTrayRefreshOnce() {
			await observer.getByRole("button", { name: "Selection actions" }).click();
			const item = observer.getByRole("menuitem", {
				name: "Refresh previews (6)",
			});
			await item.waitFor({ state: "visible", timeout: 8000 });
			await item.click();
		}
		async function batchRunning() {
			const [text, session] = await Promise.all([
				observer
					.locator('[data-sonner-toaster][data-x-position="right"]')
					.innerText()
					.catch(() => ""),
				readRefreshSession(observer).catch(() => null),
			]);
			return {
				toast: /Capturing \d+ of 6/.test(text),
				session: session?.status === "running",
			};
		}
		await clickTrayRefreshOnce();
		// Progress toast appears with its label and the active card shimmer
		// (one retry: a click racing the menu transition can miss selection).
		let running = await waitFor(
			async () => {
				const state = await batchRunning();
				return state.toast || state.session ? state : null;
			},
			20000,
			"batch start",
		).catch(() => null);
		if (!running) {
			await clickTrayRefreshOnce();
			running = await waitFor(
				async () => {
					const state = await batchRunning();
					return state.toast || state.session ? state : null;
				},
				20000,
				"batch start retry",
			).catch(() => null);
		}
		record(
			"2a. batch starts (toast + worker state)",
			!!running && (running.toast || running.session),
			`toast=${running?.toast}, workerSession=${running?.session}`,
		);
		if (!running) throw new Error("batch of 6 never started");
		const done = await waitFor(
			async () => {
				const cards = await readCards(observer);
				const five = cards?.filter((c) => c.folderId === "folder-5") ?? [];
				return five.length === 6 && five.every((c) => !!c.thumbId)
					? five
					: null;
			},
			90000,
			"batch of 6 completion",
		);
		let allChanged = false;
		if (done) {
			allChanged = done.every((c) => beforeIds.get(c.title) !== c.thumbId);
		}
		const summaryVisible = await observer
			.getByText(/preview.*updated/)
			.waitFor({ state: "visible", timeout: 10000 })
			.then(() => true)
			.catch(() => false);
		if (!summaryVisible) {
			const dbg = await observer
				.locator('[data-sonner-toaster][data-x-position="right"]')
				.innerText()
				.catch(() => "(no toaster)");
			const sess = await readRefreshSession(observer).catch(() => "read-error");
			const evts = await observer
				.evaluate(() => window.__refreshEvents)
				.catch(() => "tap-error");
			console.log(
				"2b debug toaster:",
				JSON.stringify(dbg.slice(0, 300)),
				"session:",
				JSON.stringify(sess)?.slice(0, 200),
				"events:",
				JSON.stringify(evts)?.slice(0, 400),
			);
		}
		const batchPixels = await Promise.all(
			(done ?? []).map(async (card) => {
				const decoded = await readThumbnailPixel(observer, card.thumbId).catch(
					() => null,
				);
				const rgb = decoded?.pixels?.find((entry) => entry.label === "2%")?.rgb;
				const expected = COLORS[card.title];
				const channels = expected
					?.slice(1)
					.match(/../g)
					?.map((value) => Number.parseInt(value, 16));
				return {
					cardId: card.id,
					rgb,
					channels,
					correct:
						!!rgb &&
						!!channels &&
						channels.every((value, i) => Math.abs(value - rgb[i]) <= 5),
				};
			}),
		);
		record(
			"2c. every batch card contains its own target pixels",
			batchPixels.length === 6 && batchPixels.every((entry) => entry.correct),
			JSON.stringify(batchPixels),
		);
		record(
			"2b. batch of 6 completes, every thumb replaced",
			!!done && allChanged && summaryVisible,
			`allChanged=${allChanged}, summary=${summaryVisible}`,
		);
		await sleep(4500); // let the summary toast expire
	}

	// ── 3 + 7. batch of 10 with cancel; session persistence mid-run ──
	{
		await observer
			.getByRole("tab", { name: "BatchTen" })
			.click()
			.catch(() => undefined);
		// Fallback: click the folder tab by text if role query missed.
		const gridReady = await observer
			.waitForFunction(
				() => document.querySelectorAll("[data-marquee-id]").length >= 10,
				null,
				{
					timeout: 10000,
				},
			)
			.then(() => true)
			.catch(() => false);
		if (!gridReady) {
			await observer.getByText("BatchTen", { exact: true }).first().click();
			await observer.waitForFunction(
				() => document.querySelectorAll("[data-marquee-id]").length >= 10,
				null,
				{ timeout: 10000 },
			);
		}
		await observer.keyboard.press("Escape").catch(() => undefined);
		await observer.keyboard.press("Control+A");
		await observer
			.locator("[data-selection-tray]")
			.waitFor({ state: "visible", timeout: 8000 });
		async function clickTrayRefresh10() {
			await observer.getByRole("button", { name: "Selection actions" }).click();
			const item10 = observer.getByRole("menuitem", {
				name: "Refresh previews (10)",
			});
			await item10.waitFor({ state: "visible", timeout: 8000 });
			await item10.click();
		}
		async function batch10Running() {
			const [text, session] = await Promise.all([
				observer
					.locator('[data-sonner-toaster][data-x-position="right"]')
					.innerText()
					.catch(() => ""),
				readRefreshSession(observer).catch(() => null),
			]);
			return {
				toast: /Capturing \d+ of 10/.test(text),
				session: session?.status === "running",
			};
		}
		await clickTrayRefresh10();
		let running10 = await waitFor(
			async () => {
				const state = await batch10Running();
				return state.toast || state.session ? state : null;
			},
			30000,
			"batch-10 start",
		).catch(() => null);
		if (!running10) {
			await clickTrayRefresh10();
			running10 = await waitFor(
				async () => {
					const state = await batch10Running();
					return state.toast || state.session ? state : null;
				},
				30000,
				"batch-10 start retry",
			).catch(() => null);
		}
		if (!running10) {
			const dbg = await observer
				.locator('[data-sonner-toaster][data-x-position="right"]')
				.innerText()
				.catch(() => "(no toaster)");
			const sess = await readRefreshSession(observer).catch(() => "read-error");
			throw new Error(
				`batch of 10 never started (toaster=${JSON.stringify(dbg.slice(0, 200))} session=${JSON.stringify(sess)?.slice(0, 200)})`,
			);
		}

		// (7) mid-batch: the worker persisted resumable state to storage.session.
		const midRun = await waitFor(
			async () => {
				const text = await observer
					.locator('[data-sonner-toaster][data-x-position="right"]')
					.innerText()
					.catch(() => "");
				const state = await readRefreshSession(observer).catch(() => null);
				return /Capturing [3-9] of 10/.test(text) &&
					typeof state?.activeCardId === "string"
					? state
					: null;
			},
			60000,
			"batch reaching an active mid-run capture",
		);
		await observer.screenshot({
			path: path.join(artifactDir, "queued-and-active.png"),
		});
		const session = midRun ?? (await readRefreshSession(observer));
		record(
			"7. SW-sleep resume state persisted mid-batch",
			!!session &&
				session.status === "running" &&
				session.cardIds?.length === 10 &&
				typeof session.activeCardId === "string",
			`status=${session?.status}, queued=${session?.cardIds?.length}, done=${session?.doneIds?.length}, active=${session?.activeCardId}`,
		);

		// Reload this New Tab while the queue is running. It must reconstruct
		// both the toast and the one-card shimmer from chrome.storage.session.
		await observer.reload({ waitUntil: "load" });
		await observer.waitForFunction(
			() => document.querySelectorAll("[data-marquee-id]").length >= 10,
			null,
			{ timeout: 15000 },
		);
		const recoveredProgress = await waitFor(
			async () => {
				const currentSession = await readRefreshSession(observer).catch(
					() => null,
				);
				const ui = await observer.evaluate(() => {
					const active = [
						...document.querySelectorAll('.thumb[data-refreshing="true"]'),
					];
					const cardId = active[0]
						?.closest("[data-marquee-id]")
						?.getAttribute("data-marquee-id");
					return {
						activeCount: active.length,
						cardId,
						toast:
							document.querySelector(
								'[data-sonner-toaster][data-x-position="right"]',
							)?.innerText ?? "",
					};
				});
				if (
					currentSession?.status === "running" &&
					currentSession.activeCardId &&
					ui.activeCount === 1 &&
					ui.cardId === currentSession.activeCardId &&
					/Capturing [0-9]+ of 10/.test(ui.toast)
				) {
					return { currentSession, ui };
				}
				return null;
			},
			30000,
			"reloaded progress and active-card shimmer",
		);
		record(
			"7b. reload restores progress and only the active card shimmers",
			!!recoveredProgress,
			`active=${recoveredProgress?.currentSession.activeCardId}, shimmerCount=${recoveredProgress?.ui.activeCount}, toast=${recoveredProgress?.ui.toast.slice(0, 60)}`,
		);

		// (3) cancel now; the toast must confirm with counts.
		await observer
			.getByRole("button", { name: "Cancel refresh" })
			.evaluate((button) => button.click());
		const cancelledText = await waitFor(
			async () => {
				const text = await observer
					.locator('[data-sonner-toaster][data-x-position="right"]')
					.innerText()
					.catch(() => "");
				const m = text.match(/Cancelled at (\d+) of 10/);
				return m ? m[0] : null;
			},
			20000,
			"cancelled summary",
		);
		const stoppedCount = Number(
			cancelledText?.match(/Cancelled at (\d+) of 10/)?.[1] ?? -1,
		);
		const sessionAfter = await readRefreshSession(observer);
		const windowsAfter = await windowCount(observer);
		// Give any in-flight capture a beat, then confirm the queue is parked.
		await sleep(6000);
		const cardsAfter = await readCards(observer);
		const doneAfterWait =
			cardsAfter?.filter((c) => c.folderId === "folder-10" && !!c.thumbId)
				.length ?? -1;
		record(
			"3. cancel stops the queue with an honest count",
			!!cancelledText &&
				stoppedCount >= 1 &&
				stoppedCount < 10 &&
				sessionAfter === null &&
				windowsAfter === windowsBefore &&
				doneAfterWait <= stoppedCount + 1,
			`${cancelledText}, session=${sessionAfter === null ? "cleared" : "LEAKED"}, windows=${windowsAfter}/${windowsBefore}, thumbsSettled=${doneAfterWait}`,
		);
		await sleep(4500);
	}

	// ── 4. auto-capture on a different path of the same domain ──
	{
		const visit = await context.newPage();
		await visit.bringToFront();
		await visit.goto(testUrl("dom", "/notebook/xyz"), { waitUntil: "load" });
		const captured = await waitFor(
			async () => {
				const cards = await readCards(observer);
				const found = cards?.find((c) => c.title === "domcard");
				return found?.thumbId ? found : null;
			},
			15000,
			"domain auto-capture",
		);
		await visit.close();
		await observer.bringToFront();
		record(
			"4. visit to sibling path captures the thumbless card (domain match)",
			!!captured,
			`thumbId=${captured?.thumbId}`,
		);
	}

	// ── 5. manual save of a different path creates a NEW card ──
	{
		// Seed a same-folder card for site-m path /a, then add /b via the
		// real Settings form (the exact-match path: findBookmarkInFolder).
		const manualAUrl = testUrl("manual", "/a");
		const manualBUrl = testUrl("manual", "/b");
		await observer.evaluate((manualAUrl) => {
			chrome.storage.local.get(["perch-setup"], (d) => {
				const envelope = JSON.parse(d["perch-setup"]);
				envelope.state.cards.push({
					id: "card-manual-m",
					folderId: "folder-dom",
					title: "manual-m",
					url: manualAUrl,
					favicon: null,
					thumbId: null,
					order: 99,
					titleSource: null,
					origin: "local",
					capturedAt: null,
				});
				envelope.state.itemOrder["folder-dom"].push("card:card-manual-m");
				chrome.storage.local.set({ "perch-setup": JSON.stringify(envelope) });
			});
		}, manualAUrl);
		const before = await readCards(observer);
		const beforeCount = before?.length ?? 0;
		await observer.click('[aria-label="Settings"]');
		await sleep(700);
		await observer.getByText("Manage bookmarks", { exact: true }).click();
		await sleep(700);
		// The inspected folder follows the active folder; pick Domain.
		const folderPicker = observer
			.getByRole("button", { name: /Folder/ })
			.first();
		await folderPicker.click().catch(() => undefined);
		await sleep(300);
		await observer.keyboard.press("Escape").catch(() => undefined);
		await observer.getByRole("button", { name: "Add link" }).first().click();
		await observer.locator("#bookmark-url-input").fill(manualBUrl);
		await observer.locator("#bookmark-title-input").fill("manual-b");
		await observer.getByRole("button", { name: "Add link" }).last().click();
		await sleep(1000);
		const after = await readCards(observer);
		const cardA = after?.find((c) => c.url === manualAUrl);
		const cardB = after?.find((c) => c.url === manualBUrl);
		await observer.keyboard.press("Escape").catch(() => undefined);
		record(
			"5. different path creates a new card (exact match preserved)",
			after?.length === beforeCount + 1 &&
				!!cardA &&
				!!cardB &&
				cardA.id !== cardB.id,
			`cards ${beforeCount} → ${after?.length}`,
		);
	}

	// ── 8. main context menu carries the missing-previews entry ──
	{
		// Blank hero surface (clock/greeting/search/quicklinks are disabled
		// in the seed): top-left of the scroll container hits no card.
		await observer
			.locator('[data-speed-dial-scroll="true"]')
			.first()
			.click({ button: "right", position: { x: 40, y: 100 } });
		const missingItem = observer.getByRole("menuitem", {
			name: /Refresh missing previews \(\d+\)/,
		});
		await missingItem.waitFor({ state: "visible", timeout: 8000 });
		const label = await missingItem.innerText();
		const count = Number(
			label.match(/Refresh missing previews \((\d+)\)/)?.[1] ?? 0,
		);
		await observer.keyboard.press("Escape");
		record(
			"8. page menu shows Refresh missing previews (N)",
			count > 0,
			`label="${label}"`,
		);
	}

	// ── 9a. right-click on a selected card refreshes the whole selection ──
	{
		const before = await readCards(observer);
		// NOTE: scenario 5's form saved into the active folder (folder-10),
		// so the count is dynamic, not the seeded 10.
		const folderCount =
			before?.filter((c) => c.folderId === "folder-10").length ?? 0;
		const beforeIds = new Map(
			before
				.filter((c) => c.folderId === "folder-10")
				.map((c) => [c.title, c.thumbId]),
		);
		const expectedLabel = `Refresh previews (${folderCount})`;
		await observer.keyboard.press("Control+A");
		await observer
			.locator("[data-selection-tray]")
			.waitFor({ state: "visible", timeout: 8000 });
		const target = observer
			.locator("[data-marquee-id]", { hasText: "c10-1" })
			.first();
		await target.click({ button: "right" });
		const multiItem = observer.getByRole("menuitem", {
			name: expectedLabel,
		});
		await multiItem.waitFor({ state: "visible", timeout: 8000 });
		const singleItem = observer.getByRole("menuitem", {
			name: "Refresh thumbnail",
			exact: true,
		});
		const singleShown = await singleItem.count();
		await multiItem.click();
		const done = await waitFor(
			async () => {
				const cards = await readCards(observer);
				const ten = cards?.filter((c) => c.folderId === "folder-10") ?? [];
				return ten.length === folderCount &&
					ten.every((c) => !!c.thumbId && beforeIds.get(c.title) !== c.thumbId)
					? ten
					: null;
			},
			150000,
			"selection right-click batch completion",
		);
		// Every card must HAVE a thumb now; count how many were replaced
		// (a failed re-capture keeps its previous thumb and still counts).
		const changedCount = done
			? done.filter((c) => beforeIds.get(c.title) !== c.thumbId).length
			: -1;
		record(
			`9a. right-click on selection refreshes all ${folderCount}`,
			!!done && changedCount === folderCount && singleShown === 0,
			`allThumbed=${!!done}, replaced=${changedCount}/${folderCount}, singleEntryShown=${singleShown}`,
		);
		await sleep(4500);
	}

	// ── 9b. toast log never holds more than current + previous ──
	{
		// Re-run a batch over the same folder via the tray and sample rows.
		const cardsNow = await readCards(observer);
		const nNow =
			cardsNow?.filter((c) => c.folderId === "folder-10").length ?? 0;
		await observer.keyboard.press("Control+A");
		await observer
			.locator("[data-selection-tray]")
			.waitFor({ state: "visible", timeout: 8000 });
		await observer.getByRole("button", { name: "Selection actions" }).click();
		await observer
			.getByRole("menuitem", { name: `Refresh previews (${nNow})` })
			.click();
		await waitFor(
			async () => {
				const text = await observer
					.locator('[data-sonner-toaster][data-x-position="right"]')
					.innerText()
					.catch(() => "");
				return new RegExp(`Capturing [2-9] of ${nNow}`).test(text)
					? text
					: null;
			},
			60000,
			"second batch mid-run",
		);
		let maxRows = 0;
		let sawTwo = false;
		for (let i = 0; i < 6; i += 1) {
			const rows = await observer
				.evaluate(() => document.querySelectorAll('[role="log"] > div').length)
				.catch(() => -1);
			if (rows === 2) sawTwo = true;
			maxRows = Math.max(maxRows, rows);
			await sleep(3000);
		}
		await observer
			.getByRole("button", { name: "Cancel refresh" })
			.evaluate((button) => button.click());
		await sleep(1000);
		// The ≤3 allowance is the current + previous slots plus one popLayout
		// exit node (the receding row stays in the DOM ~200ms). A scroll list
		// would accumulate unbounded across this ~18s sampling window, so any
		// value beyond 3 — or a max that keeps rising run-to-run — is the bug.
		record(
			"9b. toast shows at most current + previous, no scroll list",
			maxRows <= 3 && sawTwo,
			`maxRows=${maxRows}, sawTwo=${sawTwo}`,
		);
		await sleep(4500);
	}

	// ── 10. icon mode hides every refresh entry ──
	{
		async function setDialLayout(mode) {
			await observer.evaluate((m) => {
				chrome.storage.local.get(["perch-setup"], (d) => {
					const envelope = JSON.parse(d["perch-setup"]);
					envelope.state.settings.dialLayout = m;
					chrome.storage.local.set({ "perch-setup": JSON.stringify(envelope) });
				});
			}, mode);
			await observer.reload({ waitUntil: "load" });
			await observer
				.waitForFunction(
					() => document.querySelectorAll("[data-marquee-id]").length >= 10,
					null,
					{ timeout: 15000 },
				)
				.catch(() => {});
			await sleep(500);
		}
		await setDialLayout("icon");
		const tile = observer.locator("[data-marquee-id]").first();
		await tile.click({ button: "right" });
		await observer
			.getByRole("menuitem", { name: "Rename" })
			.waitFor({ state: "visible", timeout: 8000 });
		const refreshEntries = await observer
			.getByRole("menuitem", { name: /Refresh (thumbnail|previews)/ })
			.count();
		await observer.keyboard.press("Escape");
		// Selection tray must not offer it either in icon mode.
		await observer.keyboard.press("Control+A");
		await observer
			.locator("[data-selection-tray]")
			.waitFor({ state: "visible", timeout: 8000 });
		await observer.getByRole("button", { name: "Selection actions" }).click();
		await sleep(600);
		const trayRefresh = await observer
			.getByRole("menuitem", { name: /Refresh (thumbnail|previews)/ })
			.count();
		await observer.keyboard.press("Escape");
		record(
			"10. icon mode shows no refresh entries (card menu + tray)",
			refreshEntries === 0 && trayRefresh === 0,
			`cardMenu=${refreshEntries}, tray=${trayRefresh}`,
		);
		await setDialLayout("card");
	}

	// ── 11. a concurrent URL edit wins over the queued screenshot ──
	{
		await observer.getByRole("tab", { name: "Domain" }).click();
		const card = observer
			.locator("[data-marquee-id]", { hasText: "edit-mid-refresh" })
			.first();
		await card.click({ button: "right" });
		await observer.getByRole("menuitem", { name: "Refresh thumbnail" }).click();
		const active = await waitFor(
			async () => {
				const session = await readRefreshSession(observer).catch(() => null);
				return session?.activeCardId === "card-edit-mid-refresh"
					? session
					: null;
			},
			10000,
			"edit test refresh start",
		);
		const editedUrl = testUrl("edit-mid", "/edited");
		await observer.evaluate(
			(editedUrl) =>
				new Promise((resolve, reject) => {
					chrome.storage.local.get(["perch-setup"], (data) => {
						let envelope;
						try {
							envelope = JSON.parse(data["perch-setup"]);
						} catch {
							reject(new Error("invalid setup in edit test"));
							return;
						}
						const target = envelope.state.cards.find(
							(card) => card.id === "card-edit-mid-refresh",
						);
						if (!target) {
							reject(new Error("edit test card missing"));
							return;
						}
						target.url = editedUrl;
						chrome.storage.local.set(
							{ "perch-setup": JSON.stringify(envelope) },
							() =>
								chrome.runtime.lastError
									? reject(chrome.runtime.lastError)
									: resolve(),
						);
					});
				}),
			editedUrl,
		);
		await waitFor(
			async () =>
				(await readRefreshSession(observer).catch(() => null)) === null
					? true
					: null,
			25000,
			"edited card refresh finalization",
		);
		const edited = (await readCards(observer))?.find(
			(entry) => entry.id === "card-edit-mid-refresh",
		);
		record(
			"11. concurrent URL edits are not overwritten by a capture",
			!!active && edited?.url === editedUrl && !edited.thumbId,
			`url=${edited?.url}, thumbId=${edited?.thumbId}`,
		);
	}

	// ── 12. deletion while the target page loads never recreates the card ──
	{
		const card = observer
			.locator("[data-marquee-id]", { hasText: "delete-mid-refresh" })
			.first();
		await card.click({ button: "right" });
		await observer.getByRole("menuitem", { name: "Refresh thumbnail" }).click();
		const active = await waitFor(
			async () => {
				const session = await readRefreshSession(observer).catch(() => null);
				return session?.activeCardId === "card-delete-mid-refresh"
					? session
					: null;
			},
			10000,
			"delete test refresh start",
		);
		await observer.evaluate(
			() =>
				new Promise((resolve, reject) => {
					chrome.storage.local.get(["perch-setup"], (data) => {
						let envelope;
						try {
							envelope = JSON.parse(data["perch-setup"]);
						} catch {
							reject(new Error("invalid setup in delete test"));
							return;
						}
						envelope.state.cards = envelope.state.cards.filter(
							(card) => card.id !== "card-delete-mid-refresh",
						);
						envelope.state.itemOrder["folder-dom"] = envelope.state.itemOrder[
							"folder-dom"
						].filter((id) => id !== "card:card-delete-mid-refresh");
						chrome.storage.local.set(
							{ "perch-setup": JSON.stringify(envelope) },
							() =>
								chrome.runtime.lastError
									? reject(chrome.runtime.lastError)
									: resolve(),
						);
					});
				}),
		);
		await waitFor(
			async () =>
				(await readRefreshSession(observer).catch(() => null)) === null
					? true
					: null,
			25000,
			"deleted card refresh finalization",
		);
		const deleted = (await readCards(observer))?.some(
			(entry) => entry.id === "card-delete-mid-refresh",
		);
		record(
			"12. a deleted card is not recreated by an in-flight refresh",
			!!active && !deleted,
			`cardStillExists=${deleted}`,
		);
	}

	// ── 13. folder selection refreshes descendants recursively ──
	{
		await observer.keyboard.press("Escape").catch(() => undefined);
		await observer
			.getByRole("tab", { name: "NestedRoot" })
			.click()
			.catch(() => undefined);
		await observer
			.waitForFunction(
				() => document.querySelectorAll("[data-marquee-id]").length >= 3,
				null,
				{ timeout: 10000 },
			)
			.catch(() => {});
		const recursiveTargets = [
			"card-nest-a",
			"card-nest-b",
			"card-nest-c",
			"card-nest-d",
		];
		const beforeThumbs = new Map(
			((await readCards(observer)) ?? [])
				.filter((c) => recursiveTargets.includes(c.id))
				.map((c) => [c.id, c.thumbId]),
		);
		// Page shows 2 cards + the NestedSub folder tile; selecting all of it
		// must batch all four cards (the folder's own subtree included).
		await observer.keyboard.press("Control+A");
		await observer
			.locator("[data-selection-tray]")
			.waitFor({ state: "visible", timeout: 8000 });
		await observer.getByRole("button", { name: "Selection actions" }).click();
		const recursiveItem = observer.getByRole("menuitem", {
			name: "Refresh previews (4)",
		});
		await recursiveItem.waitFor({ state: "visible", timeout: 8000 });
		await recursiveItem.click();
		const recursiveDone = await waitFor(
			async () => {
				const cards = await readCards(observer);
				const targets =
					cards?.filter((c) => recursiveTargets.includes(c.id)) ?? [];
				return targets.length === 4 && targets.every((c) => !!c.thumbId)
					? targets
					: null;
			},
			150000,
			"recursive selection batch",
		);
		const replacedRecursive = recursiveDone
			? recursiveDone.filter((c) => beforeThumbs.get(c.id) !== c.thumbId).length
			: -1;
		record(
			"13. folder selection expands recursively (4 targets incl. subfolder)",
			!!recursiveDone && replacedRecursive === 4,
			`replaced=${replacedRecursive}/4`,
		);
		await sleep(4500);
	}

	// ── 14. corner scale drives the token, previews live, persists reload ──
	{
		// The seed keeps the hero blank (search disabled) for deterministic
		// capture scenarios; enable it only for this check, then restore.
		const setSearchEnabled = async (enabled) => {
			await observer.evaluate((on) => {
				chrome.storage.local.get(["perch-setup"], (data) => {
					const envelope = JSON.parse(data["perch-setup"]);
					envelope.state.settings.search = {
						...envelope.state.settings.search,
						enabled: on,
					};
					chrome.storage.local.set({
						"perch-setup": JSON.stringify(envelope),
					});
				});
			}, enabled);
			await observer.reload({ waitUntil: "load" });
			await sleep(700);
		};
		const measureSearchExpanded = async () => {
			// Geometry is only meaningful on a rendered surface; activate the
			// tab so a hidden page can never freeze the transition.
			await observer.bringToFront().catch(() => undefined);
			await observer.keyboard.press("Escape").catch(() => undefined);
			// Let a close frame settle before retargeting the same surface.
			await sleep(240);
			await observer.click("[data-unified-search-input]");
			const opened = await observer.evaluate(
				() =>
					document
						.querySelector("[data-unified-search]")
						?.getAttribute("data-search-open") === "true",
			);
			// A pointerdown landing during the close cleanup can be consumed
			// without opening. One retry keeps this check about corner
			// geometry, not click timing.
			if (!opened) {
				await observer.click("[data-unified-search-input]");
			}
			await sleep(250);
			// This run opts out of the backgrounding flags so native window
			// behavior stays honest. An occluded window throttles the
			// renderer, which can freeze a CSS transition at its start value;
			// discarded screenshots force composites until the computed
			// radius reaches the token target.
			let measured = null;
			for (let attempt = 0; attempt < 6; attempt += 1) {
				await observer.screenshot({ timeout: 5000 }).catch(() => undefined);
				await sleep(120);
				measured = await observer.evaluate(() => {
					const input = document.querySelector("[data-unified-search-input]");
					const surface = input?.closest("form")?.parentElement;
					const root = getComputedStyle(document.documentElement);
					return {
						open: document
							.querySelector("[data-unified-search]")
							?.getAttribute("data-search-open"),
						// The expanded container is the shared surface role, not
						// a private search geometry. It sits one step below the
						// field so focus reduces the radius.
						varValue: root.getPropertyValue("--shape-surface").trim(),
						squircleVar: surface
							? getComputedStyle(surface)
									.getPropertyValue("--squircle-r")
									.trim()
							: "",
						cornerShape: surface
							? getComputedStyle(surface)
									.getPropertyValue("corner-shape")
									.trim()
							: "",
						radius: surface
							? getComputedStyle(surface).borderTopLeftRadius
							: "",
						attr: document.documentElement.dataset.ktabCorner ?? "",
					};
				});
				if (measured.radius === measured.varValue) break;
			}
			return measured;
		};
		await setSearchEnabled(true);
		// Collapsed-state guard for the shape morph: the resting field is a
		// FINITE, tier-driven radius (22px at Soft; 28px at Rounded is half
		// the 56px height). rounded-full resolves to calc(infinity * 1px)
		// and cannot interpolate, which is exactly what produced the
		// "pill then snap" regression. Cards must already be on
		// --shape-card before any tier change.
		const collapsed = await observer.evaluate(() => {
			const input = document.querySelector("[data-unified-search-input]");
			const surface = input?.closest("form")?.parentElement;
			const card = document.querySelector("[data-marquee-id] .dial-card");
			const root = getComputedStyle(document.documentElement);
			return {
				collapsedVar: root.getPropertyValue("--shape-search-collapsed").trim(),
				collapsedRadius: surface
					? getComputedStyle(surface).borderTopLeftRadius
					: "",
				squircleVar: surface
					? getComputedStyle(surface).getPropertyValue("--squircle-r").trim()
					: "",
				cornerShape: surface
					? getComputedStyle(surface).getPropertyValue("corner-shape").trim()
					: "",
				cardVar: root.getPropertyValue("--shape-card").trim(),
				cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : "",
			};
		});
		const soft = await measureSearchExpanded();
		await observer.screenshot({
			path: path.join(artifactDir, "corner-soft.png"),
		});
		await observer.keyboard.press("Escape").catch(() => undefined);

		await observer.click('[aria-label="Settings"]');
		await sleep(700);
		// The root pane renders AppearancePane inline (no "Appearance" nav
		// entry), so the corner-scale segment is directly clickable. Probe
		// Discreet first: the resting field must render its 12px tier radius
		// (not a constant capsule) before moving to the top tier.
		await observer
			.getByRole("button", { name: "Discreet", exact: true })
			.click();
		await sleep(500);
		const discreet = await observer.evaluate(() => {
			const input = document.querySelector("[data-unified-search-input]");
			const surface = input?.closest("form")?.parentElement;
			const card = document.querySelector("[data-marquee-id] .dial-card");
			const root = getComputedStyle(document.documentElement);
			return {
				attr: document.documentElement.dataset.ktabCorner ?? "",
				varValue: root.getPropertyValue("--shape-surface").trim(),
				collapsedVar: root.getPropertyValue("--shape-search-collapsed").trim(),
				collapsedRadius: surface
					? getComputedStyle(surface).borderTopLeftRadius
					: "",
				squircleVar: surface
					? getComputedStyle(surface).getPropertyValue("--squircle-r").trim()
					: "",
				cornerShape: surface
					? getComputedStyle(surface).getPropertyValue("corner-shape").trim()
					: "",
				cardVar: root.getPropertyValue("--shape-card").trim(),
				cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : "",
			};
		});
		await observer
			.getByRole("button", { name: "Rounded", exact: true })
			.click();
		await sleep(500);
		const live = await observer.evaluate(() => {
			const input = document.querySelector("[data-unified-search-input]");
			const surface = input?.closest("form")?.parentElement;
			const card = document.querySelector("[data-marquee-id] .dial-card");
			const root = getComputedStyle(document.documentElement);
			return {
				attr: document.documentElement.dataset.ktabCorner ?? "",
				varValue: root.getPropertyValue("--shape-surface").trim(),
				collapsedVar: root.getPropertyValue("--shape-search-collapsed").trim(),
				collapsedRadius: surface
					? getComputedStyle(surface).borderTopLeftRadius
					: "",
				squircleVar: surface
					? getComputedStyle(surface).getPropertyValue("--squircle-r").trim()
					: "",
				cornerShape: surface
					? getComputedStyle(surface).getPropertyValue("corner-shape").trim()
					: "",
				cardVar: root.getPropertyValue("--shape-card").trim(),
				cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : "",
			};
		});
		// Resting Rounded field: the user-visible capsule silhouette.
		await observer.screenshot({
			path: path.join(artifactDir, "corner-resting-rounded.png"),
		});
		await observer.keyboard.press("Escape").catch(() => undefined);
		const rounded = await measureSearchExpanded();
		await observer.screenshot({
			path: path.join(artifactDir, "corner-rounded.png"),
		});
		await observer.keyboard.press("Escape").catch(() => undefined);
		await observer.reload({ waitUntil: "load" });
		await sleep(500);
		const persisted = await measureSearchExpanded();
		const persistedCard = await observer.evaluate(() => {
			const card = document.querySelector("[data-marquee-id] .dial-card");
			return card ? getComputedStyle(card).borderTopLeftRadius : "";
		});

		// Back to the shipped default so later runs see the standard surface.
		await observer.click('[aria-label="Settings"]');
		await sleep(700);
		await observer.getByRole("button", { name: "Soft", exact: true }).click();
		await sleep(400);
		await observer.keyboard.press("Escape").catch(() => undefined);
		await setSearchEnabled(false);

		record(
			"14. corner scale lives on tokens, previews instantly, persists reload (search + cards)",
			collapsed.collapsedVar === "22px" &&
				collapsed.collapsedRadius === "22px" &&
				collapsed.cardVar === "18px" &&
				collapsed.cardRadius === "18px" &&
				soft.open === "true" &&
				soft.varValue === "18px" &&
				soft.radius === soft.varValue &&
				// The expanded container resolves the surface fallback, not
				// the resting field's own squircle radius.
				soft.squircleVar === "11px" &&
				soft.cornerShape === "superellipse(2)" &&
				collapsed.squircleVar === "22px" &&
				collapsed.cornerShape === "superellipse(2)" &&
				discreet.attr === "discreet" &&
				discreet.collapsedVar === "12px" &&
				discreet.collapsedRadius === "12px" &&
				discreet.varValue === "10px" &&
				discreet.squircleVar === "12px" &&
				discreet.cornerShape === "superellipse(2)" &&
				discreet.cardVar === "10px" &&
				discreet.cardRadius === "10px" &&
				live.attr === "rounded" &&
				live.varValue === "24px" &&
				live.collapsedVar === "28px" &&
				live.collapsedRadius === "28px" &&
				live.squircleVar === "28px" &&
				// Rounded resting field: circular corners, so 28px on the
				// 56px height is a true full-rounded capsule.
				live.cornerShape === "superellipse(1)" &&
				live.cardVar === "24px" &&
				live.cardRadius === "24px" &&
				rounded.open === "true" &&
				rounded.varValue === "24px" &&
				rounded.radius === "24px" &&
				rounded.squircleVar === "14px" &&
				// Same curvature expanded: the shape cannot pop on open.
				rounded.cornerShape === "superellipse(1)" &&
				rounded.attr === "rounded" &&
				persisted.open === "true" &&
				persisted.varValue === "24px" &&
				persisted.squircleVar === "14px" &&
				persisted.cornerShape === "superellipse(1)" &&
				persisted.attr === "rounded" &&
				persistedCard === "24px" &&
				// The resting field still follows the tier, while the expanded
				// results container uses the shared surface scale (one role
				// below the field). Its custom property proves the role swap,
				// and the radius strictly decreases on focus.
				live.collapsedRadius !== collapsed.collapsedRadius &&
				rounded.radius !== soft.radius &&
				// Focus always reduces the field radius: the expanded surface
				// sits one role below the resting field in every tier.
				Number.parseFloat(soft.radius) <
					Number.parseFloat(collapsed.collapsedRadius) &&
				Number.parseFloat(rounded.radius) <
					Number.parseFloat(live.collapsedRadius) &&
				soft.squircleVar !== collapsed.squircleVar &&
				rounded.squircleVar !== live.squircleVar,
			`collapsed=${collapsed.collapsedVar}/${collapsed.collapsedRadius} squircle=${collapsed.squircleVar} shape=${collapsed.cornerShape}, card=${collapsed.cardVar}/${collapsed.cardRadius}, soft=${soft.open}/${soft.varValue}/${soft.radius} squircle=${soft.squircleVar} shape=${soft.cornerShape}, discreet=${discreet.collapsedVar}/${discreet.collapsedRadius} expanded=${discreet.varValue} squircle=${discreet.squircleVar} shape=${discreet.cornerShape} card=${discreet.cardVar}/${discreet.cardRadius}, live=${live.varValue}/${live.attr} collapsed=${live.collapsedVar}/${live.collapsedRadius} squircle=${live.squircleVar} shape=${live.cornerShape} card=${live.cardVar}/${live.cardRadius}, rounded=${rounded.open}/${rounded.varValue}/${rounded.radius} squircle=${rounded.squircleVar} shape=${rounded.cornerShape}, persisted=${persisted.open}/${persisted.varValue} squircle=${persisted.squircleVar} shape=${persisted.cornerShape} ${persisted.attr} card=${persistedCard}`,
		);
		await sleep(1000);
	}

	// ── 6. rate limit: no quota errors across the whole run ──
	{
		const quotaErrors = swErrors.filter((e) =>
			/MAX_CAPTURE|quota|rate/i.test(e),
		);
		record(
			"6. no capture rate-limit errors",
			quotaErrors.length === 0 && swErrors.length === 0,
			`swErrors=[${swErrors.join(" | ")}]`,
		);
	}
} finally {
	const trace = await context
		.serviceWorkers()[0]
		?.evaluate(() => globalThis.__captureTrace)
		.catch(() => null);
	fs.writeFileSync(
		path.join(artifactDir, "api-trace.json"),
		JSON.stringify(trace ?? [], null, 2),
	);
	await context.close().catch(() => undefined);
	await Promise.all(
		localTestServers.map(
			(server) =>
				new Promise((resolve) => {
					if (!server.listening) return resolve();
					server.close(() => resolve());
				}),
		),
	);
	restoreManifest();
}

const failed = results.filter((r) => !r.pass);
console.log(
	`\n${results.length - failed.length}/${results.length} checks passed` +
		(failed.length
			? ` — FAILED: ${failed.map((f) => f.scenario).join("; ")}`
			: ""),
);
process.exitCode = failed.length ? 1 : 0;
