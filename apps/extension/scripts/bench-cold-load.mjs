/**
 * Cold-load benchmark for the kTab newtab.
 *
 * Each run creates a FRESH browser profile (cold extension storage + cold
 * HTTP cache) with only the built extension loaded. Measures:
 *   - navigation timing (TTFB, DCL, load) for chrome-extension:// pages
 *   - FCP (PerformancePaintTiming)
 *   - grid-interactive (first [data-marquee-id] in DOM, via MutationObserver)
 *   - long tasks during startup (parse + execute + render)
 *   - resource sizes of the scripts actually fetched by newtab.html
 *
 * Variants: "empty" (first-run, no data) and "seeded" (data written before
 * the measured load, as a returning user would have).
 *
 * Run: node scripts/bench-cold-load.mjs [runs=5]
 */
import { rmSync } from "node:fs";
import {
	launchExtension,
	buildSeed,
	median,
	saveResults,
	INSTRUMENT_SCRIPT,
} from "./bench-lib.mjs";

const RUNS = Number(process.argv[2] ?? 9) || 9;
const results = { empty: [], seeded: [], "seeded-cold": [] };

/**
 * Variant cycle per run (index-based) so ordering bias from V8 code cache
 * cannot contaminate the comparison:
 *   empty        — first load of a fresh profile, no data
 *   seeded       — unmeasured load writes data, then the measured SECOND load
 *                  (returning user: data present + warm V8 code cache)
 *   seeded-cold  — data written through the extension service worker BEFORE
 *                  any page load, so the measured load is the FIRST load
 *                  (data present + cold V8 code cache). The difference
 *                  empty <-> seeded-cold isolates the pure data effect;
 *                  seeded-cold <-> seeded isolates the pure code-cache effect.
 */
const VARIANTS = ["empty", "seeded", "seeded-cold"];

/** Write the seed through the extension service worker before any load. */
async function preSeedViaServiceWorker(context, seed) {
	let [background] = context.serviceWorkers();
	if (!background) {
		background = await context.waitForEvent("serviceworker", { timeout: 15000 });
	}
	await background.evaluate((data) => {
		return new Promise((resolve, reject) => {
			chrome.storage.local.set(
				{ "perch-setup": JSON.stringify(data) },
				() =>
					chrome.runtime.lastError
						? reject(chrome.runtime.lastError)
						: resolve(),
			);
		});
	}, seed);
}

function summarizeLoad(load) {
	return {
		ttfbMs: load.ttfbMs,
		dclMs: load.dclMs,
		loadEventMs: load.loadEventMs,
		fcpMs: load.fcpMs,
		gridInteractiveMs: load.gridInteractiveMs,
		cdpMetrics: load.cdpMetrics,
		startupLongTasks: load.longTasks,
		startupLongTaskTotalMs: load.longTasks.reduce((a, t) => a + t.duration, 0),
		scripts: load.scripts,
	};
}

for (let i = 0; i < RUNS; i += 1) {
	const variant = VARIANTS[i % VARIANTS.length];
	const { context, extensionId, userDataDir } = await launchExtension();
	try {
		if (variant === "seeded") {
			// Write data through the extension's own storage, then reload so the
			// measured load hydrates a realistic dataset (cold cache retained).
			const page = await context.newPage();
			await page.goto(`chrome-extension://${extensionId}/newtab.html`);
			await page.evaluate((data) => {
				return new Promise((resolve, reject) => {
					chrome.storage.local.set(
						{ "perch-setup": JSON.stringify(data) },
						() =>
							chrome.runtime.lastError
								? reject(chrome.runtime.lastError)
								: resolve(),
					);
				});
			}, buildSeed({ folders: 3, cardsPerFolder: 12 }));
			await page.close();
		} else if (variant === "seeded-cold") {
			// Data present from the very first load: the measured load is cold
			// in code cache but warm in data (isolates the data effect).
			await preSeedViaServiceWorker(
				context,
				buildSeed({ folders: 3, cardsPerFolder: 12 }),
			);
		}

			const page = await context.newPage();
			await page.addInitScript(INSTRUMENT_SCRIPT);
			const cdp = await context.newCDPSession(page);
			await cdp.send("Performance.enable");
			const t0 = Date.now();
			await page.goto(`chrome-extension://${extensionId}/newtab.html`, {
				waitUntil: "load",
			});
			await page
				.waitForFunction(
					() => window.__ktabBench && window.__ktabBench.gridReadyAt !== null,
					null,
					{ timeout: 20000 },
				)
				.catch(() => {});
			await page.waitForTimeout(400);

			const load = await page.evaluate(() => {
				const nav = performance.getEntriesByType("navigation")[0];
				const paints = performance.getEntriesByType("paint");
				const fcp = paints.find((p) => p.name === "first-contentful-paint");
				const resources = performance
					.getEntriesByType("resource")
					.filter((r) => /\.(js|css)$/.test(new URL(r.name).pathname))
					.map((r) => ({
						file: new URL(r.name).pathname.split("/").pop(),
						decodedKB: Math.round(r.decodedBodySize / 1024),
						fetchMs: Math.round(r.duration),
					}));
				return {
					ttfbMs: Math.round(nav.responseStart),
					dclMs: Math.round(nav.domContentLoadedEventEnd),
					loadEventMs: Math.round(nav.loadEventEnd),
					fcpMs: fcp ? Math.round(fcp.startTime) : null,
					gridInteractiveMs: window.__ktabBench?.gridReadyAt ?? null,
					longTasks: (window.__ktabBench?.longTasks ?? []).slice(0, 20),
					scripts: resources,
				};
			});
			const { metrics } = await cdp.send("Performance.getMetrics");
			const keep = [
				"ScriptDuration",
				"TaskDuration",
				"LayoutDuration",
				"RecalcStyleDuration",
				"V8CompileDuration",
			];
			load.cdpMetrics = Object.fromEntries(
				keep.map((k) => [k, Math.round((metrics.find((m) => m.name === k)?.value ?? 0) * 1000)]),
			);
			results[variant].push({
				run: i + 1,
				wallClockMs: Date.now() - t0,
				...summarizeLoad(load),
			});
			console.log(`[${variant}] run ${i + 1}:`, JSON.stringify(results[variant][results[variant].length - 1]));
			await page.close();
		} finally {
			await context.close().catch(() => {});
			if (userDataDir) {
				rmSync(userDataDir, { recursive: true, force: true });
			}
	}
}

// --- medians ---
const summary = {};
for (const variant of Object.keys(results)) {
	const runs = results[variant];
	const pick = (f) => median(runs.map((r) => r[f]));
	summary[variant] = {
		runs: runs.length,
		median: {
			ttfbMs: pick("ttfbMs"),
			dclMs: pick("dclMs"),
			loadEventMs: pick("loadEventMs"),
			fcpMs: pick("fcpMs"),
			gridInteractiveMs: pick("gridInteractiveMs"),
			scriptDurationMs: median(runs.map((r) => r.cdpMetrics?.ScriptDuration ?? 0)),
			v8CompileMs: median(runs.map((r) => r.cdpMetrics?.V8CompileDuration ?? 0)),
			layoutMs: median(runs.map((r) => r.cdpMetrics?.LayoutDuration ?? 0)),
			longTaskTotalMs: median(runs.map((r) => r.startupLongTaskTotalMs)),
		},
		longTaskSamples: runs.map((r) => r.startupLongTasks.map((t) => t.duration)),
	};
}

const out = { date: new Date().toISOString(), summary, raw: results };
const file = saveResults("cold-load.json", out);
console.log("\n=== MEDIANS ===");
console.log(JSON.stringify(summary, null, 2));
console.log("saved:", file);
