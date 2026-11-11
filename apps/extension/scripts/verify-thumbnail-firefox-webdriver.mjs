/** Headful Firefox through Marionette (Playwright does not support extension documents).
 * Uses an isolated temporary addon copy/profile. GECKODRIVER points to the driver.
 * GRANTED_CAPTURE=1 declares all_urls on the test copy; it is NOT a consent test.
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { buildSeed } from "./bench-lib.mjs";

const output = process.env.BB_THREAD_STORAGE;
if (!output) throw new Error("BB_THREAD_STORAGE required");
const artifactDir = path.join(output, `firefox-webdriver-${Date.now()}`);
fs.mkdirSync(artifactDir, { recursive: true });
const report = {
	assertions: [],
	stages: [],
	limitations: ["Patched Playwright Firefox executable, not retail Firefox."],
};
const record = (name, pass, detail) => {
	report.assertions.push({
		name,
		status: pass ? "passed" : "failed",
		message: detail ? JSON.stringify(detail) : undefined,
	});
	fs.writeFileSync(
		path.join(artifactDir, "tests.json"),
		JSON.stringify(report.assertions, null, 2),
	);
	console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portServer = net.createServer();
await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
const log = fs.openSync(path.join(artifactDir, "geckodriver.log"), "w");
const driver = spawn(
	process.env.GECKODRIVER || path.join(output, "geckodriver/geckodriver.exe"),
	["--port", String(port)],
	{ stdio: ["ignore", log, log] },
);
let session;
let server;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ktab-ff-driver-"));
async function command(method, endpoint, body) {
	const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
		method,
		...(body
			? {
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				}
			: {}),
	});
	const data = await response.json();
	if (data.value?.error)
		throw new Error(`${endpoint}: ${data.value.error}: ${data.value.message}`);
	return data.value;
}
const cmd = (method, endpoint, body) =>
	command(method, `/session/${session}${endpoint}`, body);
const evaluate = async (fn, arg = null) => {
	const result = await cmd("POST", "/execute/async", {
		script: `const done = arguments[arguments.length-1]; Promise.resolve((${fn.toString()})(arguments[0])).then(value=>done({result:value}),error=>done({failure:String(error)}));`,
		args: [arg],
	});
	if (result?.failure) throw new Error(result.failure);
	return result?.result;
};
const find = async (using, value) =>
	(await cmd("POST", "/element", { using, value }))[
		"element-6066-11e4-a52e-4f735466cecf"
	];
const clickText = async (role, text) => {
	const id = await find(
		"xpath",
		`//*[@role='${role}' and normalize-space(.)='${text}']`,
	);
	await cmd("POST", `/element/${id}/click`, {});
};
const waitFor = async (fn, ms = 30000) => {
	const start = Date.now();
	while (Date.now() - start < ms) {
		const value = await fn();
		if (value) return value;
		await sleep(150);
	}
	throw new Error("Timed out waiting for actual extension state");
};
try {
	await waitFor(async () => {
		try {
			return await command("GET", "/status");
		} catch {
			return null;
		}
	}, 10000);
	const build = path.resolve(".output/firefox-mv3");
	const addon = path.join(temp, "addon");
	fs.cpSync(build, addon, { recursive: true });
	const manifest = JSON.parse(
		fs.readFileSync(path.join(addon, "manifest.json"), "utf8"),
	);
	if (process.env.GRANTED_CAPTURE === "1") {
		manifest.host_permissions = [
			...new Set([...(manifest.host_permissions ?? []), "<all_urls>"]),
		];
		manifest.optional_host_permissions = [];
		fs.writeFileSync(
			path.join(addon, "manifest.json"),
			JSON.stringify(manifest),
		);
		report.limitations.push(
			"Install-time all_urls on isolated test copy; native permission prompt excluded.",
		);
	}
	const uuid = crypto.randomUUID();
	const started = await command("POST", "/session", {
		capabilities: {
			alwaysMatch: {
				browserName: "firefox",
				"moz:firefoxOptions": {
					binary:
						process.env.FIREFOX_EXECUTABLE ||
						"C:/Users/joao/AppData/Local/ms-playwright/firefox-1543/firefox/firefox.exe",
					args: ["-remote-allow-system-access"],
					prefs: {
						"extensions.webextensions.uuids": JSON.stringify({
							[manifest.browser_specific_settings.gecko.id]: uuid,
						}),
						"browser.shell.checkDefaultBrowser": false,
					},
				},
			},
		},
	});
	session = started.sessionId;
	report.capabilities = started.capabilities;
	await cmd("POST", "/timeouts", { script: 20000, pageLoad: 30000 });
	await cmd("POST", "/moz/addon/install", { path: addon, temporary: true });
	const dashboardUrl = `moz-extension://${uuid}/newtab.html`;
	// Extension URLs require navigation through Firefox's trusted browser UI.
	await cmd("POST", "/moz/context", { context: "chrome" });
	await cmd("POST", "/execute/sync", {
		script:
			"gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); return true;",
		args: [dashboardUrl],
	});
	await cmd("POST", "/moz/context", { context: "content" });
	await waitFor(() => evaluate(() => !!document.querySelector("main")));
	const colors = [
		[45, 127, 181],
		[181, 68, 45],
		[61, 143, 78],
	];
	server = http.createServer((req, res) => {
		const index = Number((req.url ?? "").split("/").at(-1));
		const rgb = colors[index] ?? [80, 80, 80];
		report.stages.push({ at: Date.now(), request: req.url });
		res.writeHead(200, {
			"content-type": "text/html",
			"cache-control": "no-store",
		});
		res.end(
			`<html style="margin:0;background:rgb(${rgb})"><head><link rel="icon" href="data:,"></head><body style="margin:0;background:rgb(${rgb});min-height:100vh"></body></html>`,
		);
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const fixtureBase = `http://127.0.0.1:${server.address().port}`;
	const seed = buildSeed({ folders: 1, cardsPerFolder: 3 });
	seed.state.settings.thumbnailCapture.enabled = true;
	seed.state.cards.forEach((c, i) => {
		c.title = `Fixture ${i}`;
		c.url = `http://127.0.0.1:${server.address().port}/target/${i}`;
	});
	await evaluate(
		(seed) =>
			browser.storage.local.set({ "perch-setup": JSON.stringify(seed) }),
		seed,
	);
	await cmd("POST", "/refresh", {});
	await waitFor(() =>
		evaluate(() => document.querySelectorAll("[data-marquee-id]").length === 3),
	);
	await sleep(1500);
	await evaluate(async () => {
		window.__events = [];
		window.__originalTab = await browser.tabs.getCurrent();
		window.__originalWindows = await browser.windows.getAll();
		browser.runtime.onMessage.addListener((m) => {
			if (m?.type === "refresh:progress")
				window.__events.push({ at: Date.now(), ...m });
		});
		browser.windows.onFocusChanged.addListener((windowId) =>
			window.__events.push({ at: Date.now(), type: "focus", windowId }),
		);
		const bg = await browser.runtime.getBackgroundPage();
		bg.__apiTrace = [];
		for (const [area, methods] of Object.entries({
			tabs: [
				"create",
				"get",
				"update",
				"remove",
				"captureVisibleTab",
				"captureTab",
			],
			windows: ["create", "remove", "update"],
		})) {
			for (const method of methods) {
				if (typeof bg.browser[area][method] !== "function") continue;
				const real = bg.browser[area][method].bind(bg.browser[area]);
				bg.browser[area][method] = async (...args) => {
					const row = { at: Date.now(), method: `${area}.${method}`, args };
					bg.__apiTrace.push(row);
					try {
						const result = await real(...args);
						row.result =
							typeof result === "string" ? result.slice(0, 30) : result;
						return result;
					} catch (error) {
						row.error = String(error);
						throw error;
					}
				};
			}
		}
	});
	const readState = () =>
		evaluate(
			async () =>
				JSON.parse(
					(await browser.storage.local.get("perch-setup"))["perch-setup"],
				).state,
		);
	const decode = (thumbId) =>
		evaluate(async (id) => {
			const db = await new Promise((resolve, reject) => {
				const r = indexedDB.open("perch-db", 1);
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			});
			const dataUrl = await new Promise((resolve, reject) => {
				const r = db
					.transaction("thumbnails")
					.objectStore("thumbnails")
					.get(id);
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			});
			db.close();
			const image = new Image();
			image.src = dataUrl;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const ctx = canvas.getContext("2d");
			ctx.drawImage(image, 0, 0);
			return {
				width: canvas.width,
				height: canvas.height,
				rgb: [...ctx.getImageData(10, 10, 1, 1).data],
				dataUrl,
			};
		}, thumbId);
	for (const batch of [false, true]) {
		const name = batch ? "batch" : "single";
		const before = await readState();
		const offset = await evaluate(() => window.__events.length);
		// Per-phase API trace cursor: later assertions slice the background
		// trace from here, so each run is judged on its own backend truth.
		await evaluate(async () => {
			window.__traceCursor = (
				await browser.runtime.getBackgroundPage()
			).__apiTrace.length;
		});
		if (batch) {
			// Trusted WebDriver keyboard gesture drives the actual tray action.
			await cmd("POST", "/actions", {
				actions: [
					{
						type: "key",
						id: "keyboard",
						actions: [
							{ type: "keyDown", value: "\uE009" },
							{ type: "keyDown", value: "a" },
							{ type: "keyUp", value: "a" },
							{ type: "keyUp", value: "\uE009" },
						],
					},
				],
			});
			const button = await find(
				"css selector",
				'[aria-label="Selection actions"]',
			);
			await cmd("POST", `/element/${button}/click`, {});
			await clickText("menuitem", "Refresh previews (3)");
		} else {
			const card = await find("css selector", "[data-marquee-id]");
			await cmd("POST", "/actions", {
				actions: [
					{
						type: "pointer",
						id: "mouse",
						parameters: { pointerType: "mouse" },
						actions: [
							{
								type: "pointerMove",
								origin: { "element-6066-11e4-a52e-4f735466cecf": card },
								x: 0,
								y: 0,
							},
							{ type: "pointerDown", button: 2 },
							{ type: "pointerUp", button: 2 },
						],
					},
				],
			});
			await clickText("menuitem", "Refresh thumbnail");
		}
		// Mid-batch surface sample: the 1500ms scheduler lane keeps the run
		// mid-flight long enough to observe the capture surface as it exists.
		await sleep(1100);
		report.surface = report.surface ?? {};
		report.surface[name] = await evaluate(async () => ({
			windows: (await browser.windows.getAll()).map((window) => ({
				id: window.id,
				type: window.type,
				focused: window.focused,
			})),
			tabs: (await browser.tabs.query({})).map((tab) => ({
				id: tab.id,
				windowId: tab.windowId,
				active: tab.active,
				url: (tab.url ?? "").slice(0, 90),
			})),
		}));
		await waitFor(
			() =>
				evaluate(
					(offset) =>
						window.__events
							.slice(offset)
							.some((e) =>
								["done", "cancelled", "needs-permission"].includes(e.status),
							),
					offset,
				),
			60000,
		);
		const state = await readState();
		for (const index of batch ? [0, 1, 2] : [0]) {
			const c = state.cards[index];
			const pixels = c.thumbId ? await decode(c.thumbId) : null;
			if (pixels) {
				fs.writeFileSync(
					path.join(artifactDir, `${name}-${index}.jpg`),
					Buffer.from(pixels.dataUrl.split(",")[1], "base64"),
				);
				delete pixels.dataUrl;
			}
			record(
				`${name}: card ${index} replaced with correct pixels`,
				c.thumbId !== before.cards[index].thumbId &&
					!!pixels &&
					colors[index].every((v, i) => Math.abs(v - pixels.rgb[i]) < 10),
				pixels,
			);
		}
		const integrity = await evaluate(async () => ({
			tab: await browser.tabs.getCurrent(),
			original: window.__originalTab,
			windows: await browser.windows.getAll(),
			before: window.__originalWindows,
			events: window.__events,
			session: (await browser.storage.session.get("ktab-refresh-batch"))[
				"ktab-refresh-batch"
			],
			tabs: await browser.tabs.query({}),
			captureUrl: browser.runtime.getURL("/capture.html"),
		}));
		record(
			`${name}: dashboard preserved`,
			integrity.tab.id === integrity.original.id &&
				integrity.tab.url === integrity.original.url &&
				integrity.tab.windowId === integrity.original.windowId,
		);
		record(
			`${name}: resources cleaned`,
			integrity.windows.length === integrity.before.length &&
				!integrity.session,
		);
		const runTrace = await evaluate(async () =>
			(await browser.runtime.getBackgroundPage()).__apiTrace
				.slice(window.__traceCursor ?? 0)
				.map((row) => row.method),
		);
		// The Firefox backend owns no secondary window: captureTab on inactive
		// tabs only. windows.create or tabs.update (activation) in a run is a
		// lifecycle bug. captureTab itself is captured as a direct reference at
		// import (directTabCapture), so the wrapper cannot observe it; pixels
		// and the tab census already prove capture ran.
		record(
			`${name}: no window or activation in the run trace`,
			!runTrace.includes("windows.create") &&
				!runTrace.includes("windows.remove") &&
				!runTrace.includes("tabs.update") &&
				runTrace.includes("tabs.create"),
			[...new Set(runTrace)].join(","),
		);
		const leftovers = integrity.tabs.filter(
			(tab) =>
				tab.id !== integrity.original.id &&
				((tab.url ?? "").startsWith(integrity.captureUrl) ||
					(tab.url ?? "").startsWith(fixtureBase)),
		);
		// The anchor and capture tabs live in the user's window, so window
		// counts cannot see leaks; only the tab census can.
		record(
			`${name}: no leftover anchor or capture tabs`,
			leftovers.length === 0,
			leftovers.map((tab) => tab.url),
		);
		const sample = report.surface[name];
		record(
			`${name}: mid-batch surface stays window-free`,
			sample.windows.length === integrity.before.length &&
				sample.windows.every((window) => window.type === "normal"),
			sample.windows,
		);
		record(
			`${name}: anchor tab present while capturing`,
			sample.tabs.some((tab) =>
				(tab.url ?? "").startsWith(integrity.captureUrl),
			),
			sample.tabs
				.filter((tab) => (tab.url ?? "").startsWith(integrity.captureUrl))
				.map((tab) => `${tab.id}:${tab.url}`),
		);
		report[name] = integrity;
	}
	// Compare browser-native background capture strategies after the unchanged baseline.
	report.probes = [];
	for (const minimized of [false, true]) {
		const probe = await evaluate(
			async ({ url, minimized }) => {
				let win;
				let tab;
				try {
					if (minimized) {
						win = await browser.windows.create({
							url,
							state: "minimized",
							focused: false,
						});
						tab = win.tabs[0];
					} else tab = await browser.tabs.create({ url, active: false });
					for (
						let i = 0;
						i < 100 && (await browser.tabs.get(tab.id)).status !== "complete";
						i++
					)
						await new Promise((r) => setTimeout(r, 100));
					await new Promise((r) => setTimeout(r, 1800));
					const dataUrl = await browser.tabs.captureTab(tab.id, {
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
						minimized,
						tab: await browser.tabs.get(tab.id),
						window: await browser.windows.get(tab.windowId),
						rgb: [...ctx.getImageData(10, 10, 1, 1).data],
						dataUrl,
					};
				} catch (e) {
					return { minimized, error: String(e) };
				} finally {
					if (win) await browser.windows.remove(win.id);
					else if (tab) await browser.tabs.remove(tab.id);
				}
			},
			{ url: seed.state.cards[2].url, minimized },
		);
		if (probe.dataUrl) {
			fs.writeFileSync(
				path.join(artifactDir, `probe-${minimized}.jpg`),
				Buffer.from(probe.dataUrl.split(",")[1], "base64"),
			);
			delete probe.dataUrl;
		}
		report.probes.push(probe);
	}
	// ── Cancel lifecycle: a mid-batch cancel must release the surface too ──
	const cancelCursor = await evaluate(async () => {
		window.__cancelCursor = (
			await browser.runtime.getBackgroundPage()
		).__apiTrace.length;
		return window.__events.length;
	});
	const stateBeforeCancel = await readState();
	await cmd("POST", "/actions", {
		actions: [
			{
				type: "key",
				id: "keyboard",
				actions: [
					{ type: "keyDown", value: "\uE009" },
					{ type: "keyDown", value: "a" },
					{ type: "keyUp", value: "a" },
					{ type: "keyUp", value: "\uE009" },
				],
			},
		],
	});
	const cancelMenu = await find(
		"css selector",
		'[aria-label="Selection actions"]',
	);
	await cmd("POST", `/element/${cancelMenu}/click`, {});
	await clickText("menuitem", "Refresh previews (3)");
	await waitFor(
		() =>
			evaluate(
				(offset) =>
					window.__events
						.slice(offset)
						.some((event) => event.status === "card-done"),
				cancelCursor,
			),
		25000,
	);
	// Land mid-batch: the next card is in flight when the cancel arrives.
	await sleep(1100);
	await evaluate(() => browser.runtime.sendMessage({ type: "refresh:cancel" }));
	await waitFor(
		() =>
			evaluate(
				(offset) =>
					window.__events
						.slice(offset)
						.some((event) => event.status === "cancelled"),
				cancelCursor,
			),
		30000,
	);
	const afterCancel = await evaluate(async () => ({
		windows: await browser.windows.getAll(),
		tabs: await browser.tabs.query({}),
		session: (await browser.storage.session.get("ktab-refresh-batch"))[
			"ktab-refresh-batch"
		],
		dashId: (await browser.tabs.getCurrent()).id,
		captureUrl: browser.runtime.getURL("/capture.html"),
		trace: (await browser.runtime.getBackgroundPage()).__apiTrace
			.slice(window.__cancelCursor ?? 0)
			.map((row) => row.method),
	}));
	record(
		"cancel: batch stopped, session released, no window or activation",
		!afterCancel.session &&
			!afterCancel.trace.includes("windows.create") &&
			!afterCancel.trace.includes("windows.remove") &&
			!afterCancel.trace.includes("tabs.update") &&
			afterCancel.trace.includes("tabs.create"),
		[...new Set(afterCancel.trace)].join(","),
	);
	record(
		"cancel: no secondary window",
		afterCancel.windows.length === (report.single?.before?.length ?? 1),
		afterCancel.windows.map((window) => ({ id: window.id, type: window.type })),
	);
	const cancelLeftovers = afterCancel.tabs.filter(
		(tab) =>
			tab.id !== afterCancel.dashId &&
			((tab.url ?? "").startsWith(afterCancel.captureUrl) ||
				(tab.url ?? "").startsWith(fixtureBase)),
	);
	record(
		"cancel: no leftover anchor or capture tabs",
		cancelLeftovers.length === 0,
		cancelLeftovers.map((tab) => tab.url),
	);
	const cancelStateFinal = await readState();
	const replaced = cancelStateFinal.cards.filter(
		(card, index) =>
			card.thumbId !== (stateBeforeCancel.cards[index] ?? card).thumbId,
	).length;
	record(
		"cancel: partial progress preserved, rest untouched",
		replaced >= 1 && replaced <= 3,
		{ replaced, total: cancelStateFinal.cards.length },
	);
	report.afterCancel = afterCancel;
	report.apiTrace = await evaluate(
		async () => (await browser.runtime.getBackgroundPage()).__apiTrace,
	);
	report.events = await evaluate(() => window.__events);

	// ── corner scale + search shape morph (Gecko) ──
	const cornerProbe = { morph: [] };
	{
		const original = await evaluate(
			async () =>
				(await browser.storage.local.get("perch-setup"))["perch-setup"],
		);
		const patch = (tier) =>
			evaluate(async (tier) => {
				const raw = (await browser.storage.local.get("perch-setup"))[
					"perch-setup"
				];
				const envelope = JSON.parse(raw);
				envelope.state.settings.search.enabled = true;
				envelope.state.settings.cornerScale = tier;
				await browser.storage.local.set({
					"perch-setup": JSON.stringify(envelope),
				});
				return true;
			}, tier);
		const read = () =>
			evaluate(() => {
				const root = getComputedStyle(document.documentElement);
				const surface = document.querySelector(
					"[data-unified-search] form",
				)?.parentElement;
				// Bookmark/folder cards, not quick-link icon tiles: both share
				// .dial-card, but icon tiles intentionally pin their own
				// Home-Screen squircle and never follow the corner scale.
				// The marquee id lives on the grid-cell wrapper, so the card
				// itself is a descendant of it.
				const card = document.querySelector("[data-marquee-id] .dial-card");
				const cardStyle = card ? getComputedStyle(card) : null;
				return {
					attr: document.documentElement.dataset.ktabCorner ?? "",
					collapsedVar: root
						.getPropertyValue("--shape-search-collapsed")
						.trim(),
					collapsedRadius: surface
						? getComputedStyle(surface).borderTopLeftRadius
						: "",
					expandedVar: root.getPropertyValue("--shape-surface").trim(),
					expandedFallbackVar: root
						.getPropertyValue("--shape-surface-fallback")
						.trim(),
					cardVar: root.getPropertyValue("--shape-card").trim(),
					cardFallbackVar: root
						.getPropertyValue("--shape-card-fallback")
						.trim(),
					cardRadius: cardStyle ? cardStyle.borderTopLeftRadius : "",
					cardSquircle: cardStyle
						? cardStyle.getPropertyValue("--squircle-r").trim()
						: "",
					cardClass: card ? card.className : "",
					cornerShapeSupported: CSS.supports("corner-shape", "squircle"),
				};
			});
		const reload = async () => {
			await cmd("POST", "/refresh", {});
			await waitFor(() => evaluate(() => !!document.querySelector("main")));
			await sleep(500);
		};

		await patch("discreet");
		await reload();
		cornerProbe.discreet = await read();

		await patch("soft");
		await reload();
		cornerProbe.soft = await read();

		await patch("rounded");
		await reload();
		cornerProbe.rounded = await read();
		// Start the morph from a blurred, settled close state so focus() emits
		// a real focus event and the transition runs from its first frame.
		await evaluate(() => document.activeElement?.blur?.());
		await sleep(300);
		// Sample the radius across the open choreography. Finite endpoints
		// (28px resting capsule → 14px calibrated surface fallback at this
		// tier) must produce values strictly between the ends; before the
		// fix the pill held through the transition and snapped, so no
		// sample ever landed inside the range.
		cornerProbe.morph = await evaluate(
			() =>
				new Promise((resolve) => {
					const surface = document.querySelector(
						"[data-unified-search] form",
					)?.parentElement;
					const input = surface?.querySelector("input");
					input?.focus();
					const samples = [];
					const started = performance.now();
					const tick = () => {
						samples.push({
							at: Math.round(performance.now() - started),
							radius: Number.parseFloat(
								getComputedStyle(surface).borderTopLeftRadius,
							),
						});
						if (performance.now() - started < 260) {
							requestAnimationFrame(tick);
						} else {
							resolve(samples);
						}
					};
					requestAnimationFrame(tick);
				}),
		);
		cornerProbe.expanded = await evaluate(() => {
			const surface = document.querySelector(
				"[data-unified-search] form",
			)?.parentElement;
			return {
				varValue: getComputedStyle(document.documentElement)
					.getPropertyValue("--shape-surface")
					.trim(),
				radius: surface ? getComputedStyle(surface).borderTopLeftRadius : "",
				squircleVar: surface
					? getComputedStyle(surface).getPropertyValue("--squircle-r").trim()
					: "",
			};
		});
		// Keep a visual artifact of the expanded container at the top tier:
		// Gecko has no corner-shape, so this is the surface the calibrated
		// surface fallback actually renders.
		try {
			const png = await cmd("GET", "/screenshot");
			fs.writeFileSync(
				path.join(artifactDir, "corner-expanded.png"),
				Buffer.from(png, "base64"),
			);
		} catch {}
		await evaluate(() => document.activeElement?.blur?.());

		// Restore the seeded envelope so the dashboard closes on its default
		// geometry and later runs see the same state.
		await evaluate(
			async (raw) => browser.storage.local.set({ "perch-setup": raw }),
			original,
		);
		await reload();

		const interpolating = cornerProbe.morph.some(
			(sample) => sample.radius > 14.2 && sample.radius < 27.8,
		);
		const settled = cornerProbe.morph.at(-1)?.radius ?? 0;
		record(
			"corner: tiers drive cards + search, morph interpolates, capsule only on the resting field",
			cornerProbe.discreet.attr === "discreet" &&
				cornerProbe.discreet.collapsedVar === "12px" &&
				cornerProbe.discreet.collapsedRadius === "12px" &&
				cornerProbe.discreet.expandedVar === "10px" &&
				cornerProbe.discreet.expandedFallbackVar === "6px" &&
				cornerProbe.discreet.cardVar === "10px" &&
				cornerProbe.discreet.cardFallbackVar === "5px" &&
				cornerProbe.discreet.cardRadius ===
					cornerProbe.discreet.cardFallbackVar &&
				cornerProbe.soft.attr === "soft" &&
				cornerProbe.soft.collapsedVar === "22px" &&
				cornerProbe.soft.collapsedRadius === "22px" &&
				cornerProbe.soft.expandedVar === "18px" &&
				cornerProbe.soft.expandedFallbackVar === "11px" &&
				cornerProbe.soft.cardVar === "18px" &&
				cornerProbe.soft.cardFallbackVar === "10px" &&
				cornerProbe.soft.cardRadius === cornerProbe.soft.cardFallbackVar &&
				cornerProbe.rounded.attr === "rounded" &&
				cornerProbe.rounded.collapsedVar === "28px" &&
				cornerProbe.rounded.collapsedRadius === "28px" &&
				cornerProbe.rounded.expandedVar === "24px" &&
				cornerProbe.rounded.expandedFallbackVar === "14px" &&
				cornerProbe.rounded.cardVar === "24px" &&
				cornerProbe.rounded.cardFallbackVar === "13px" &&
				cornerProbe.rounded.cardRadius ===
					cornerProbe.rounded.cardFallbackVar &&
				cornerProbe.expanded.varValue === "24px" &&
				cornerProbe.expanded.radius === "14px" &&
				cornerProbe.expanded.squircleVar === "14px" &&
				interpolating &&
				settled >= 13.8 &&
				settled <= 14.2,
			{
				discreet: cornerProbe.discreet,
				soft: cornerProbe.soft,
				rounded: cornerProbe.rounded,
				expanded: cornerProbe.expanded,
				interpolating,
				settled,
				samples: cornerProbe.morph.slice(0, 6),
			},
		);
		report.corner = cornerProbe;
	}
} catch (error) {
	report.error = String(error.stack ?? error);
	console.error(report.error);
	process.exitCode = 2;
} finally {
	if (session) {
		try {
			const png = await cmd("GET", "/screenshot");
			fs.writeFileSync(
				path.join(artifactDir, "dashboard.png"),
				Buffer.from(png, "base64"),
			);
		} catch {}
		await command("DELETE", `/session/${session}`).catch(() => {});
	}
	driver.kill();
	fs.closeSync(log);
	if (server) await new Promise((r) => server.close(r));
	fs.rmSync(temp, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 300,
	});
	fs.writeFileSync(
		path.join(artifactDir, "report.json"),
		JSON.stringify(report, null, 2),
	);
	fs.writeFileSync(
		path.join(output, "firefox-latest.json"),
		JSON.stringify({ artifactDir }, null, 2),
	);
	console.log(`Report: ${artifactDir}`);
	if (!process.exitCode)
		process.exitCode = report.assertions.some((r) => r.status === "failed")
			? 1
			: 0;
}
