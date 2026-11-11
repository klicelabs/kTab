/**
 * Glass vs Flat FPS benchmark (hypothesis 1: backdrop-filter cost).
 *
 * Methodology notes:
 *   - Runs HEADED (headless software compositing saturates at the display
 *     cadence and hides compositor cost). One headed Chrome window per run.
 *   - CPU throttled 4x via CDP Emulation.setCPUThrottlingRate to represent
 *     mid-range hardware; unthrottled runs are included for contrast.
 *   - Trusted input only: drags/marquee via Playwright mouse (real
 *     pointerdown/move/up through the browser input pipeline), scroll via
 *     mouse.wheel.
 *   - FPS sampled in-page by the shared recorder (rAF deltas -> avgFps,
 *     p95/max frame ms, dropped-frame count vs 120Hz expectation).
 *
 * Run: node scripts/bench-glass-fps.mjs [seconds=3] [reps=3]
 */
import {
	launchExtension,
	openNewtab,
	waitForGrid,
	countBackdropNodes,
	startCpuProfile,
	saveResults,
} from "./bench-lib.mjs";

const SECONDS = Number(process.argv[2] ?? 3) || 3;
const REPS = Number(process.argv[3] ?? 3) || 3;

function buildFpsSeed() {
	const cards = [];
	const folders = [
		{ id: "folder-1", name: "Folder 1", order: 0, parentId: null },
		{ id: "folder-2", name: "Folder 2", order: 1, parentId: null },
	];
	const itemOrder = {
		__root__: ["folder:folder-1", "folder:folder-2"],
		"folder-1": [],
		"folder-2": [],
	};
	for (let i = 1; i <= 30; i++) {
		const id = `card-${i}`;
		cards.push({
			id,
			folderId: "folder-1",
			title: `Bookmark ${i}`,
			url: `https://example.com/${i}`,
			favicon: null,
			thumbId: null,
			order: i - 1,
			titleSource: null,
			origin: "local",
			capturedAt: null,
		});
		itemOrder["folder-1"].push(`card:${id}`);
	}
	return {
		state: {
			folders,
			cards,
			activeFolderId: "folder-1",
			itemOrder,
			settings: {
				tileSize: "medium",
				maxColumns: 7,
				showTitle: true,
				showDeleteButton: false,
				openInNewTab: true,
				dialLayout: "card",
				cardAspect: "horizontal",
				iconShowLabel: true,
				defaultTitleSource: null,
				thumbnailCapture: { enabled: false, delayMs: 1200 },
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
					pexelsFrequency: "daily",
					pexelsPreviousFrequency: null,
					pexelsLastFetched: null,
					pexelsLastPeriod: null,
					pexelsImageId: null,
				},
				clock: {
					enabled: true,
					dateEnabled: true,
					format24: true,
					showSeconds: false,
					size: 72,
					dateSize: 16,
					timezone: "auto",
				},
				greeting: { enabled: true, name: "", size: 28 },
				search: {
					enabled: true,
					engine: "https://duckduckgo.com/?q=%s",
					placeholder: "Search the web",
					iconMode: "search",
					width: 560,
				},
				quickLinks: { enabled: true, items: [] },
				appearanceMode: "liquid",
				colorScheme: "dark",
				accentColor: "blue",
				glassIntensity: 60,
			},
		},
		version: 0,
	};
}

/** Start the in-page rAF sampler (returns a stop promise). */
async function startFpsSampling(page) {
	await page.evaluate(() => {
		const r = window.__ktabBench;
		r.reset();
		r.enabled = true;
		r.startFps();
	});
}

async function stopFpsSampling(page) {
	return page.evaluate(() => {
		const r = window.__ktabBench;
		const stats = r.stopFps();
		r.enabled = false;
		return {
			...stats,
			commits: r.commits,
			longTasks: r.longTasks.length,
			longTaskTotalMs: r.longTasks.reduce((a, t) => a + t.duration, 0),
			pointermove: r.events.pointermove,
		};
	});
}

async function main() {
	const seed = buildFpsSeed();
	const results = {};
	const conditions = [
		{ material: "glass", throttle: 4 },
		{ material: "flat", throttle: 4 },
		{ material: "glass", throttle: 1 },
		{ material: "flat", throttle: 1 },
	];

	for (const cond of conditions) {
		const key = `${cond.material}-x${cond.throttle}`;
		results[key] = { cond, drag: [], scroll: [], marquee: [] };

		const { context, extensionId } = await launchExtension({
			headless: false,
		});
		try {
			const page = await openNewtab(context, extensionId, { seed });
			await waitForGrid(page, 10, 20000);
			await page.setViewportSize({ width: 1600, height: 900 });
			await page.waitForTimeout(400);

			// CPU throttling to represent mid-range hardware.
			const cdp = await context.newCDPSession(page);
			await cdp.send("Emulation.setCPUThrottlingRate", {
				rate: cond.throttle,
			});

			// Material via storage write + reload (same appearanceMode values
			// the Material segmented control writes).
			await page.evaluate((m) => {
				return new Promise((resolve, reject) => {
					chrome.storage.local.get("perch-setup", (d) => {
						let parsed;
						try {
							parsed = JSON.parse(d["perch-setup"]);
						} catch (error) {
							reject(new Error(`seed parse failed: ${error}`));
							return;
						}
						parsed.state.settings.appearanceMode =
							m === "glass" ? "liquid" : "classic";
						chrome.storage.local.set(
							{ "perch-setup": JSON.stringify(parsed) },
							() => resolve(),
						);
					});
				});
			}, cond.material);
			await page.reload({ waitUntil: "load" });
			await waitForGrid(page, 10, 20000);
			await page.waitForTimeout(500);

			const glassCensus = await countBackdropNodes(page);
			console.log(
				`[${key}] backdrop-filter nodes: ${glassCensus.nodes} (svg-lens: ${glassCensus.svgFilterNodes})`,
			);
			results[key].backdropNodes = glassCensus.nodes;

			// ----- workload 1: card drag sweep (trusted mouse events) -----
			for (let rep = 0; rep < REPS; rep += 1) {
				const cell = await page
					.locator('[data-marquee-id="card-5"]')
					.boundingBox();
				const sx = cell.x + cell.width / 2;
				const sy = cell.y + cell.height / 2;
				await startFpsSampling(page);
				const profiler = await startCpuProfile(page);
				await page.mouse.move(sx, sy);
				await page.mouse.down();
				const steps = SECONDS * 30; // ~30Hz pointer cadence, spread over S seconds
				for (let i = 1; i <= steps; i += 1) {
					const t = i / steps;
					const x = sx + Math.sin(t * Math.PI * 4) * 380;
					const y = sy + Math.cos(t * Math.PI * 2) * 110;
					await page.mouse.move(x, y);
					await page.waitForTimeout(SECONDS * 1000 / steps);
				}
				await page.mouse.up();
				const fps = await stopFpsSampling(page);
				const cpu = await profiler.stop();
				results[key].drag.push({ ...fps, cpuTop: cpu.top.slice(0, 6) });
			}
			await page.keyboard.press("Escape").catch(() => {});
			await page.waitForTimeout(200);

			// ----- workload 2: scroll sweep (trusted wheel) -----
			for (let rep = 0; rep < REPS; rep += 1) {
				const grid = await page
					.locator(".dial-grid-wrap")
					.boundingBox();
				const cx = grid.x + grid.width / 2;
				const cy = grid.y + grid.height / 2;
				await startFpsSampling(page);
				const wheelSteps = SECONDS * 20;
				for (let i = 1; i <= wheelSteps; i += 1) {
					const t = i / wheelSteps;
					await page.mouse.move(cx, cy);
					await page.mouse.wheel(0, Math.sin(t * Math.PI * 2) * 90);
					await page.waitForTimeout(SECONDS * 1000 / wheelSteps);
				}
				results[key].scroll.push(await stopFpsSampling(page));
			}

			// ----- workload 3: marquee sweep (trusted drag over grid) -----
			for (let rep = 0; rep < REPS; rep += 1) {
				const grid = await page
					.locator(".dial-grid-wrap")
					.boundingBox();
				const startX = grid.x + 8;
				const startY = grid.y + grid.height * 0.35;
				await startFpsSampling(page);
				await page.mouse.move(startX, startY);
				await page.mouse.down();
				const steps = SECONDS * 30;
				for (let i = 1; i <= steps; i += 1) {
					const t = i / steps;
					const x = startX + t * grid.width * 0.5;
					const y = startY + Math.sin(t * Math.PI * 3) * 150;
					await page.mouse.move(x, y);
					await page.waitForTimeout(SECONDS * 1000 / steps);
				}
				await page.mouse.up();
				results[key].marquee.push(await stopFpsSampling(page));
			}
			await page.keyboard.press("Escape").catch(() => {});
		} finally {
			await context.close().catch(() => {});
		}
	}

	// --- medians ---
	const median = (arr) => {
		const s = [...arr].filter((v) => v != null).sort((a, b) => a - b);
		const mid = Math.floor(s.length / 2);
		return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
	};
	const summary = {};
	for (const [key, data] of Object.entries(results)) {
		summary[key] = { backdropNodes: data.backdropNodes };
		for (const workload of ["drag", "scroll", "marquee"]) {
			const runs = data[workload];
			summary[key][workload] = {
				reps: runs.length,
				avgFps: median(runs.map((r) => r.avgFps)),
				p95FrameMs: median(runs.map((r) => r.p95FrameMs)),
				maxFrameMs: median(runs.map((r) => r.maxFrameMs)),
				commits: median(runs.map((r) => r.commits)),
				longTasks: median(runs.map((r) => r.longTasks)),
				pointermoveEvents: median(runs.map((r) => r.pointermove)),
			};
		}
	}

	const file = saveResults("glass-fps.json", {
		date: new Date().toISOString(),
		seconds: SECONDS,
		summary,
		raw: results,
	});
	console.log("\n=== MEDIANS ===");
	console.log(JSON.stringify(summary, null, 2));
	console.log("saved:", file);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
