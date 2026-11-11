/**
 * Real headful Firefox refresh regression harness. No product/build mutation.
 * From apps/extension: node scripts/verify-thumbnail-firefox-e2e.mjs
 * Requires an EXISTING .output/firefox-mv3 and BB_THREAD_STORAGE. Never builds.
 * FIREFOX_EXECUTABLE / FIREFOX_BUILD may override defaults. No user profiles.
 * PROBE_MINIMIZED=1 additionally probes captureTab in a minimized window.
 * Probes run after baseline; they never replace product captures.
 * Exit 1 = failed assertions, 2 = setup/automation blocked, 0 = all checked.
 * A temporary copy of the unmodified build is installed via Firefox RDP.
 * Permission prompts are NOT auto-approved or bypassed; failures are evidence.
 *
 * KNOWN BLOCKER: Playwright's patched Firefox cannot navigate to
 * moz-extension:// pages (page.goto times out), so this harness currently
 * stalls in setup and always exits 2. The Marionette harness
 * verify-thumbnail-firefox-webdriver.mjs (geckodriver + system access)
 * covers the same product scenarios and is the canonical Firefox check.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const extension = path.join(root, "apps/extension");
const build = path.resolve(
	process.env.FIREFOX_BUILD || path.join(extension, ".output/firefox-mv3"),
);
if (!process.env.BB_THREAD_STORAGE)
	throw new Error("BB_THREAD_STORAGE is required");
const output = path.join(
	process.env.BB_THREAD_STORAGE,
	`firefox-refresh-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
fs.mkdirSync(output, { recursive: true });
const report = {
	started: new Date().toISOString(),
	build,
	output,
	assertions: [],
	trace: [],
	requests: [],
	capabilities: {},
	limitations: [
		"Playwright Firefox is a patched Firefox build, not a retail Firefox release.",
		"Native permission prompts are not DOM dialogs and are not automatically approved.",
		"OS foreground-window focus is not independently measured; browser windows.onFocusChanged and DOM focus are recorded.",
		"Per-call capture destination/execution assertions require access to the real background page; unavailable instrumentation is reported blocked, never passed.",
	],
};
const log = (type, data) => {
	const row = { time: Date.now(), type, data };
	report.trace.push(row);
	fs.appendFileSync(
		path.join(output, "trace.jsonl"),
		`${JSON.stringify(row)}\n`,
	);
};
const check = (name, pass, detail) => {
	report.assertions.push({ name, status: pass ? "passed" : "failed", detail });
	log("assertion", report.assertions.at(-1));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bounded = (promise, ms, label) => {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
		}),
	]).finally(() => clearTimeout(timer));
};
async function waitFor(fn, ms, label) {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (await fn()) return;
		await sleep(250);
	}
	throw new Error(`Timeout: ${label}`);
}
async function freePort() {
	const server = net.createServer();
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const port = server.address().port;
	await new Promise((r) => server.close(r));
	return port;
}
function findPackage(name) {
	try {
		return path.dirname(require.resolve(`${name}/package.json`));
	} catch {}
	const store = path.join(root, "node_modules/.bun");
	const entry = fs.readdirSync(store).find((n) => n.startsWith(`${name}@`));
	if (!entry)
		throw new Error(
			`Cannot resolve installed ${name}; no dependency will be added`,
		);
	return path.join(store, entry, "node_modules", name);
}
const colors = [
	[45, 127, 181],
	[181, 68, 45],
	[61, 143, 78],
];
let context;
let remote;
let temp;
let server;
let dashboard;
let monitorTimer;
let observer;
let exitCode = 2;
try {
	const manifestBytes = fs.readFileSync(path.join(build, "manifest.json"));
	const manifest = JSON.parse(manifestBytes);
	const id = manifest.browser_specific_settings?.gecko?.id;
	if (!id) throw new Error("Firefox manifest has no Gecko add-on id");
	report.manifest = manifest;
	report.manifestSha256 = crypto
		.createHash("sha256")
		.update(manifestBytes)
		.digest("hex");
	// Hash the full baseline, including scripts, to identify exactly what was tested.
	const hashes = {};
	function hashTree(dir, prefix = "") {
		for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix + item.name;
			if (item.isDirectory()) hashTree(path.join(dir, item.name), `${rel}/`);
			else
				hashes[rel] = crypto
					.createHash("sha256")
					.update(fs.readFileSync(path.join(dir, item.name)))
					.digest("hex");
		}
	}
	hashTree(build);
	report.buildHashes = hashes;
	temp = fs.mkdtempSync(path.join(os.tmpdir(), "ktab-firefox-e2e-"));
	const addon = path.join(temp, "addon");
	fs.cpSync(build, addon, { recursive: true });
	if (process.env.GRANTED_CAPTURE === "1") {
		manifest.host_permissions = [
			...new Set([...(manifest.host_permissions || []), "<all_urls>"]),
		];
		manifest.optional_host_permissions = [];
		fs.writeFileSync(
			path.join(addon, "manifest.json"),
			JSON.stringify(manifest),
		);
		report.limitations.push(
			"GRANTED_CAPTURE=1: isolated test copy declares all_urls at install; native optional-permission consent not tested by these scenarios.",
		);
	}
	server = http.createServer((request, response) => {
		const url = new URL(request.url, "http://127.0.0.1");
		report.requests.push({ time: Date.now(), path: url.pathname });
		log("http", url.pathname);
		if (url.pathname === "/favicon.ico") {
			response.writeHead(204);
			response.end();
			return;
		}
		const index = Number(url.pathname.split("/").at(-1));
		const rgb = colors[index] || [100, 100, 100];
		response.writeHead(200, {
			"content-type": "text/html",
			"cache-control": "no-store",
		});
		response.end(
			`<!doctype html><html style="margin:0;background:rgb(${rgb})"><head><title>Firefox fixture ${index}</title><link rel="icon" href="data:,"></head><body style="margin:0;min-height:100vh;background:rgb(${rgb})"></body></html>`,
		);
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const { firefox } = await import(
		pathToFileURL(path.join(findPackage("playwright"), "index.mjs")).href
	);
	const { connectWithMaxRetries } = await import(
		pathToFileURL(
			path.join(findPackage("web-ext-run"), "lib/firefox/remote.js"),
		).href
	);
	const port = await freePort();
	let uuid = crypto.randomUUID();
	context = await firefox.launchPersistentContext(path.join(temp, "profile"), {
		executablePath:
			process.env.FIREFOX_EXECUTABLE ||
			"C:/Users/joao/AppData/Local/ms-playwright/firefox-1543/firefox/firefox.exe",
		headless: false,
		viewport: null,
		args: ["-start-debugger-server", String(port)],
		firefoxUserPrefs: {
			"devtools.debugger.remote-enabled": true,
			"devtools.debugger.prompt-connection": false,
			"devtools.chrome.enabled": true,
			"extensions.webextensions.uuids": JSON.stringify({ [id]: uuid }),
			"browser.shell.checkDefaultBrowser": false,
		},
	});
	context.on("page", (page) => {
		log("page-created", page.url());
		page.on("close", () => log("page-closed", page.url()));
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame()) log("page-navigation", frame.url());
		});
		page.on("pageerror", (error) => log("page-error", String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") log("console-error", message.text());
		});
	});
	remote = await connectWithMaxRetries({ port, maxRetries: 100 });
	report.installation = await bounded(
		remote.installTemporaryAddon(addon, false),
		30000,
		"RDP temporary installation",
	);
	report.rdpRoot = await remote.client.request("getRoot");
	report.rdpAddons = await remote.client.request("listAddons");
	dashboard = await context.newPage();
	await dashboard
		.goto("about:newtab", { waitUntil: "domcontentloaded", timeout: 15000 })
		.catch((e) => log("newtab-navigation", String(e)));
	log("newtab-url", dashboard.url());
	const discovered = context
		.pages()
		.map((page) => page.url())
		.find((url) => url.startsWith("moz-extension://"));
	if (discovered) uuid = new URL(discovered).host;
	const dashboardUrl = `moz-extension://${uuid}/newtab.html`;
	if (!dashboard.url().startsWith(`moz-extension://${uuid}/`))
		await dashboard.goto(dashboardUrl, {
			waitUntil: "domcontentloaded",
			timeout: 15000,
		});
	await dashboard.waitForFunction(
		() => typeof browser !== "undefined" && !!browser.storage,
	);
	report.capabilities.permissions = await dashboard.evaluate(() =>
		browser.permissions.getAll(),
	);
	const cards = colors.map((_, i) => ({
		id: `ff-card-${i}`,
		title: `Firefox fixture ${i}`,
		url: `${origin}/target/${i}`,
		folderId: null,
		favicon: null,
		thumbId: null,
		order: i,
		titleSource: null,
		origin: "local",
		capturedAt: null,
	}));
	await dashboard.evaluate(async (cards) => {
		const stored = await browser.storage.local.get("perch-setup");
		const envelope = stored["perch-setup"]
			? JSON.parse(stored["perch-setup"])
			: { state: {}, version: 0 };
		envelope.state = {
			...envelope.state,
			cards,
			folders: [],
			currentFolderId: null,
			itemOrder: { __root__: cards.map((c) => `card:${c.id}`) },
			settings: {
				...envelope.state.settings,
				thumbnailCapture: { enabled: true, delayMs: 1200 },
				clock: { enabled: false },
				greeting: { enabled: false },
				search: { enabled: false },
				quickLinks: { enabled: false, items: [] },
			},
		};
		await browser.storage.local.set({
			"perch-setup": JSON.stringify(envelope),
		});
	}, cards);
	await dashboard.reload();
	await dashboard
		.locator("[data-marquee-id]")
		.first()
		.waitFor({ timeout: 20000 });
	await sleep(1500);
	// Independent observer survives dashboard navigation/removal. It is an extension
	// resource page, not a fake API. No changes to installed files are needed.
	observer = await context.newPage();
	await observer.goto(`moz-extension://${uuid}/popup.html`);
	await observer.evaluate(() => {
		window.__trace = [];
		const emit = (type, data) =>
			window.__trace.push({ time: Date.now(), type, data });
		browser.runtime.onMessage.addListener((m) => {
			if (m?.type === "refresh:progress") emit("progress", m);
		});
		for (const [name, event] of Object.entries({
			"tab-created": browser.tabs.onCreated,
			"tab-updated": browser.tabs.onUpdated,
			"tab-removed": browser.tabs.onRemoved,
			"tab-activated": browser.tabs.onActivated,
			"window-created": browser.windows.onCreated,
			"window-removed": browser.windows.onRemoved,
			"window-focus": browser.windows.onFocusChanged,
		}))
			event.addListener((...args) => emit(name, args));
		browser.storage.onChanged.addListener((changes, area) => {
			if (changes["ktab-refresh-batch"])
				emit("session", { area, change: changes["ktab-refresh-batch"] });
		});
	});
	report.capabilities.backgroundCaptureTap = await observer.evaluate(
		async () => {
			try {
				const bg = await browser.runtime.getBackgroundPage();
				if (!bg) return { available: false, reason: "No background Window" };
				bg.__ffCaptureTrace = [];
				// Call-through spy only: executes the original browser implementation with
				// original receiver/arguments. No synthetic captures or API result stubs.
				const namespaces = [
					...new Set([bg.browser?.tabs, bg.chrome?.tabs].filter(Boolean)),
				];
				for (const tabs of namespaces) {
					const real = tabs.captureVisibleTab;
					tabs.captureVisibleTab = function (...args) {
						const row = { time: Date.now(), args };
						bg.__ffCaptureTrace.push(row);
						bg.browser.tabs.query({ active: true }).then((active) => {
							row.activeTabs = active;
						});
						return real.apply(this, args);
					};
				}
				return { available: true, namespaces: namespaces.length };
			} catch (e) {
				return { available: false, reason: String(e) };
			}
		},
	);
	await dashboard.bringToFront();
	const baseline = await observer.evaluate(async () => ({
		tabs: await browser.tabs.query({}),
		windows: await browser.windows.getAll(),
	}));
	const dashboardTab = baseline.tabs.find((t) => t.url === dashboardUrl);
	report.baseline = baseline;
	report.dashboardTab = dashboardTab;
	let dashboardNavigated = false;
	let dashboardClosed = false;
	dashboard.on("close", () => {
		dashboardClosed = true;
	});
	dashboard.on("framenavigated", (frame) => {
		if (frame === dashboard.mainFrame()) dashboardNavigated = true;
	});
	async function snapshot() {
		return observer.evaluate(async () => ({
			time: Date.now(),
			tabs: await browser.tabs.query({}),
			windows: await browser.windows.getAll(),
			session:
				(await browser.storage.session.get("ktab-refresh-batch"))[
					"ktab-refresh-batch"
				] ?? null,
		}));
	}
	let monitoring = false;
	monitorTimer = setInterval(async () => {
		if (monitoring) return;
		monitoring = true;
		try {
			log("snapshot", await snapshot());
		} catch (e) {
			log("snapshot-error", String(e));
		} finally {
			monitoring = false;
		}
	}, 200);
	async function state() {
		return observer.evaluate(
			async () =>
				JSON.parse(
					(await browser.storage.local.get("perch-setup"))["perch-setup"],
				).state,
		);
	}
	async function decode(id) {
		return observer.evaluate(async (id) => {
			const db = await new Promise((resolve, reject) => {
				const r = indexedDB.open("perch-db", 1);
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			});
			const data = await new Promise((resolve, reject) => {
				const r = db
					.transaction("thumbnails")
					.objectStore("thumbnails")
					.get(id);
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			});
			db.close();
			if (typeof data !== "string") return null;
			const image = new Image();
			image.src = data;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const ctx = canvas.getContext("2d");
			ctx.drawImage(image, 0, 0);
			return {
				width: canvas.width,
				height: canvas.height,
				pixels: [0.02, 0.5, 0.9].map((f) => [
					...ctx.getImageData(
						Math.floor(canvas.width * f),
						Math.floor(canvas.height * f),
						1,
						1,
					).data,
				]),
				dataUrl: data,
			};
		}, id);
	}
	async function runScenario(name, indexes, trigger) {
		log("scenario-start", name);
		const before = await state();
		const beforeIds = Object.fromEntries(
			before.cards.map((c) => [c.id, c.thumbId]),
		);
		const start = Date.now();
		let triggerError;
		try {
			await trigger();
			await waitFor(
				async () => {
					const events = await observer.evaluate(() => window.__trace);
					return events.some(
						(e) =>
							e.time >= start &&
							e.type === "progress" &&
							["done", "cancelled", "needs-permission"].includes(e.data.status),
					);
				},
				90000,
				`${name} terminal progress`,
			);
		} catch (e) {
			triggerError = String(e);
			log("scenario-error", { name, error: triggerError });
		}
		await sleep(2000);
		const after = await state();
		for (const i of indexes) {
			const card = after.cards.find((c) => c.id === cards[i].id);
			check(
				`${name}: ${card?.id || cards[i].id} new thumbnail`,
				!!card?.thumbId && card.thumbId !== beforeIds[card.id],
				triggerError,
			);
			const pixels = card?.thumbId
				? await decode(card.thumbId).catch((e) => ({ error: String(e) }))
				: null;
			if (pixels?.dataUrl) {
				fs.writeFileSync(
					path.join(output, `${name}-${i}.jpg`),
					Buffer.from(pixels.dataUrl.split(",")[1], "base64"),
				);
				delete pixels.dataUrl;
			}
			check(
				`${name}: card ${i} correct decoded IDB pixels`,
				!!pixels?.pixels?.every((pixel) =>
					colors[i].every((channel, c) => Math.abs(pixel[c] - channel) <= 18),
				),
				pixels,
			);
			const rendered =
				!dashboardClosed &&
				(await dashboard
					.locator(`[data-marquee-id="card:${cards[i].id}"] img.thumb-media`)
					.count()
					.catch(() => 0));
			// Some builds use the raw id rather than the item-order key.
			const rawRendered =
				!dashboardClosed &&
				(await dashboard
					.locator("[data-marquee-id]", { hasText: cards[i].title })
					.locator("img.thumb-media")
					.count()
					.catch(() => 0));
			check(
				`${name}: card ${i} dashboard image rendered`,
				!!(rendered || rawRendered),
			);
		}
		const events = await observer.evaluate(() => window.__trace);
		const scenarioEvents = events.filter((e) => e.time >= start);
		check(
			`${name}: one started event`,
			scenarioEvents.filter(
				(e) => e.type === "progress" && e.data.status === "started",
			).length === 1,
			scenarioEvents.filter((e) => e.type === "progress"),
		);
		check(
			`${name}: cards preserved`,
			after.cards.length === before.cards.length &&
				before.cards.every((original) =>
					after.cards.some(
						(card) =>
							card.id === original.id &&
							card.url === original.url &&
							card.title === original.title &&
							card.folderId === original.folderId,
					),
				),
		);
		for (const i of indexes)
			check(
				`${name}: card ${i} completed exactly once`,
				scenarioEvents.filter(
					(e) =>
						e.type === "progress" &&
						e.data.status === "card-done" &&
						e.data.currentCardId === cards[i].id,
				).length === 1,
				scenarioEvents.filter(
					(e) => e.type === "progress" && e.data.status === "card-done",
				),
			);
		const snap = await snapshot();
		log("scenario-final", { name, snapshot: snap });
		check(
			`${name}: dashboard never navigated or removed`,
			!dashboardClosed &&
				!dashboardNavigated &&
				snap.tabs.some(
					(t) =>
						t.id === dashboardTab?.id &&
						t.windowId === dashboardTab?.windowId &&
						t.url === dashboardUrl,
				),
		);
		check(
			`${name}: no leaked tabs/windows`,
			snap.tabs.length === baseline.tabs.length &&
				snap.windows.length === baseline.windows.length &&
				baseline.tabs.every((t) =>
					snap.tabs.some((current) => current.id === t.id),
				) &&
				baseline.windows.every((w) =>
					snap.windows.some((current) => current.id === w.id),
				),
			snap,
		);
		check(
			`${name}: queue cleaned`,
			snap.session === null ||
				(snap.session.status === "idle" &&
					!snap.session.captureTabId &&
					!snap.session.captureWindowId &&
					!snap.session.pendingCaptureTabId),
			snap.session,
		);
		if (report.capabilities.backgroundCaptureTap.available) {
			const captures = await observer.evaluate(
				async () =>
					(await browser.runtime.getBackgroundPage()).__ffCaptureTrace,
			);
			const current = captures.filter((c) => c.time >= start);
			check(
				`${name}: exactly one native capture per card`,
				current.length === indexes.length,
				current,
			);
			check(
				`${name}: correct capture window and target tab`,
				current.length === indexes.length &&
					current.every(
						(c) =>
							typeof c.args[0] === "number" &&
							c.activeTabs?.some(
								(t) =>
									t.windowId === c.args[0] &&
									indexes.some((i) => t.url === cards[i].url),
							),
					),
				current,
			);
			report.captures = captures;
		} else
			report.assertions.push({
				name: `${name}: call-level destination and exactly-once`,
				status: "blocked",
				detail: report.capabilities.backgroundCaptureTap,
			});
		if (!dashboardClosed)
			await dashboard
				.screenshot({
					path: path.join(output, `${name}-dashboard.png`),
					fullPage: true,
				})
				.catch((e) => log("screenshot-error", String(e)));
		report.browserEvents = events;
	}
	await runScenario("single", [0], async () => {
		await dashboard
			.locator("[data-marquee-id]", { hasText: cards[0].title })
			.first()
			.click({ button: "right" });
		await dashboard
			.getByRole("menuitem", { name: "Refresh thumbnail", exact: true })
			.click({ timeout: 10000 });
	});
	// Continue after a red single so batch diagnostics remain independently useful.
	await runScenario("batch", [0, 1, 2], async () => {
		if (dashboardClosed || dashboardNavigated)
			throw new Error(
				"Dashboard integrity lost; refusing to silently reopen it",
			);
		await dashboard.keyboard.press("Escape");
		await dashboard.keyboard.press("Control+A");
		await dashboard
			.getByRole("button", { name: "Selection actions" })
			.click({ timeout: 10000 });
		await dashboard
			.getByRole("menuitem", { name: "Refresh previews (3)", exact: true })
			.click({ timeout: 10000 });
	});
	report.captureTabProbes = [];
	for (const minimized of [
		false,
		...(process.env.PROBE_MINIMIZED === "1" ? [true] : []),
	]) {
		const probe = {
			mode: minimized ? "minimized-window" : "inactive-tab-original-window",
			before: await snapshot(),
		};
		let targetTab;
		let ownedWindow;
		try {
			if (
				!(await observer.evaluate(
					() => typeof browser.tabs.captureTab === "function",
				))
			)
				throw new Error("captureTab unavailable");
			if (minimized) {
				ownedWindow = await observer.evaluate(
					(url) =>
						browser.windows.create({ url, focused: false, state: "minimized" }),
					`${origin}/target/2`,
				);
				targetTab = ownedWindow.tabs[0];
			} else {
				// No windows.create, tabs.hide, tabHide, or product changes.
				targetTab = await observer.evaluate(
					({ url, windowId }) =>
						browser.tabs.create({ url, windowId, active: false }),
					{ url: `${origin}/target/2`, windowId: dashboardTab.windowId },
				);
			}
			probe.targetTabId = targetTab.id;
			probe.targetWindowId = targetTab.windowId;
			await waitFor(
				() =>
					observer.evaluate(
						async (id) => (await browser.tabs.get(id)).status === "complete",
						targetTab.id,
					),
				15000,
				"captureTab page loaded",
			);
			await sleep(1800);
			probe.atCapture = await snapshot();
			const pixels = await observer.evaluate(async (id) => {
				const dataUrl = await browser.tabs.captureTab(id, {
					format: "jpeg",
					quality: 82,
				});
				const image = new Image();
				image.src = dataUrl;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const ctx = canvas.getContext("2d");
				ctx.drawImage(image, 0, 0);
				return {
					dataUrl,
					width: canvas.width,
					height: canvas.height,
					pixels: [0.02, 0.5, 0.9].map((f) => [
						...ctx.getImageData(
							Math.floor(canvas.width * f),
							Math.floor(canvas.height * f),
							1,
							1,
						).data,
					]),
				};
			}, targetTab.id);
			fs.writeFileSync(
				path.join(output, `captureTab-${probe.mode}.jpg`),
				Buffer.from(pixels.dataUrl.split(",")[1], "base64"),
			);
			delete pixels.dataUrl;
			probe.decoded = pixels;
			probe.correctPixels = pixels.pixels.every((pixel) =>
				colors[2].every((channel, c) => Math.abs(pixel[c] - channel) <= 18),
			);
			probe.inactiveAtCapture =
				probe.atCapture.tabs.find((tab) => tab.id === targetTab.id)?.active ===
				false;
			probe.minimizedAtCapture =
				probe.atCapture.windows.find((w) => w.id === targetTab.windowId)
					?.state === "minimized";
			probe.status =
				probe.correctPixels &&
				(minimized ? probe.minimizedAtCapture : probe.inactiveAtCapture)
					? "passed"
					: "failed";
		} catch (error) {
			probe.status = "blocked";
			probe.error = String(error);
		} finally {
			if (ownedWindow)
				await observer
					.evaluate((id) => browser.windows.remove(id), ownedWindow.id)
					.catch((e) => {
						probe.cleanupError = String(e);
					});
			else if (targetTab)
				await observer
					.evaluate((id) => browser.tabs.remove(id), targetTab.id)
					.catch((e) => {
						probe.cleanupError = String(e);
					});
			probe.after = await snapshot();
			probe.dashboardPreserved =
				probe.after.tabs.some(
					(t) =>
						t.id === dashboardTab.id &&
						t.windowId === dashboardTab.windowId &&
						t.url === dashboardUrl,
				) &&
				!dashboardNavigated &&
				!dashboardClosed;
			probe.resourcesRemoved =
				probe.after.tabs.length === probe.before.tabs.length &&
				probe.after.windows.length === probe.before.windows.length &&
				(!targetTab || !probe.after.tabs.some((t) => t.id === targetTab.id));
			if (
				!probe.dashboardPreserved ||
				!probe.resourcesRemoved ||
				probe.cleanupError
			)
				probe.status = "failed";
			report.captureTabProbes.push(probe);
			log("captureTab-probe", probe);
		}
	}
	exitCode = report.assertions.some((a) => a.status === "failed")
		? 1
		: report.assertions.some((a) => a.status === "blocked")
			? 2
			: 0;
} catch (error) {
	report.error = { message: String(error), stack: error.stack };
	log("fatal", report.error);
} finally {
	clearInterval(monitorTimer);
	if (observer) {
		try {
			report.browserEvents = await observer.evaluate(() => window.__trace);
		} catch {}
	}
	if (context) {
		for (const [i, page] of context.pages().entries())
			await page
				.screenshot({ path: path.join(output, `final-page-${i}.png`) })
				.catch(() => {});
	}
	try {
		remote?.disconnect();
	} catch (e) {
		log("rdp-cleanup-error", String(e));
	}
	try {
		await bounded(
			context?.close() || Promise.resolve(),
			15000,
			"close isolated Firefox",
		);
		report.browserClosed = true;
	} catch (e) {
		report.browserClosed = false;
		log("cleanup-error", String(e));
		exitCode = 2;
	}
	if (server) await new Promise((r) => server.close(r));
	if (temp && report.browserClosed !== false) {
		try {
			fs.rmSync(temp, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 300,
			});
			report.profileRemoved = true;
		} catch (e) {
			report.profileRemoved = false;
			log("cleanup-error", String(e));
			exitCode = 2;
		}
	}
	report.finished = new Date().toISOString();
	report.exitCode = exitCode;
	fs.writeFileSync(
		path.join(output, "report.json"),
		JSON.stringify(report, null, 2),
	);
	fs.writeFileSync(
		path.join(output, "tests.json"),
		JSON.stringify(
			report.assertions.map((a) => ({
				name: a.name,
				status: a.status === "blocked" ? "skipped" : a.status,
				message: JSON.stringify(a.detail),
			})),
			null,
			2,
		),
	);
	console.log(
		`Firefox E2E exit=${exitCode}; report: ${path.join(output, "report.json")}`,
	);
	process.exitCode = exitCode;
}
