/**
 * Shared harness for kTab performance benchmarks.
 *
 * Launches the built MV3 extension (apps/extension/.output/chrome-mv3) in a
 * real Chromium with Playwright, resolves the extension id, seeds a dataset
 * into chrome.storage.local and instruments the page with:
 *   - React commit counting via __REACT_DEVTOOLS_GLOBAL_HOOK__ (prod builds
 *     still dispatch onCommitFiberRoot; we walk the committed tree counting
 *     fibers flagged with PerformedWork to estimate re-rendered components)
 *   - chrome.storage.local.set interception (write log + storm detection)
 *   - long-task observation (PerformanceObserver, >50ms)
 *   - rAF FPS sampling
 *
 * No product code is modified: every instrument lives in the page via
 * addInitScript and the wrapper only forwards to the original API.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = path.resolve(__dirname, "../.output/chrome-mv3");

/** Default dataset: 3 root folders + folders of cards, ~34 cards total. */
export function buildSeed({ cardsPerFolder = 12, folders = 3 } = {}) {
	const cardList = [];
	const folderList = [];
	const itemOrder = { __root: [] };
	let cardSeq = 0;
	for (let f = 0; f < folders; f += 1) {
		const id = `folder-${f + 1}`;
		folderList.push({ id, name: `Folder ${f + 1}`, order: f, parentId: null });
		itemOrder[id] = [];
		for (let c = 0; c < cardsPerFolder; c += 1) {
			cardSeq += 1;
			const cid = `card-${cardSeq}`;
			cardList.push({
				id: cid,
				folderId: id,
				title: `Bookmark ${cardSeq}`,
				url: `https://example.com/${cardSeq}`,
				favicon: null,
				thumbId: null,
				order: c,
				titleSource: null,
				origin: "local",
				capturedAt: null,
			});
			itemOrder[id].push(`card:${cid}`);
		}
	}
	itemOrder.__root = folderList.map((f) => `folder:${f.id}`);
	return {
		state: {
			folders: folderList,
			cards: cardList,
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
				quickLinks: {
					enabled: true,
					items: [
						{ id: "ql-1", label: "GitHub", url: "https://github.com" },
						{ id: "ql-2", label: "MDN", url: "https://developer.mozilla.org" },
					],
				},
				appearanceMode: "liquid",
				colorScheme: "dark",
				accentColor: "blue",
				glassIntensity: 60,
			},
		},
		version: 0,
	};
}

/** Seed for interaction benches: 3 root folders (tabbar tabs, parentId
 * null); folder-1 active with 30 cards + 1 subfolder (marquee 3/10/20,
 * card-drag, rename, open-folder); folder-2/3 hold 12 cards each
 * (folder-nav). Mirrors a real user who created root folders from the
 * tabbar. Lives here (not in bench-interactions.mjs) so importing benches
 * do not execute bench-interactions' top-level main(). */
export function buildInteractionSeed() {
	const cards = [];
	const folders = [
		{ id: "folder-1", name: "Folder 1", order: 0, parentId: null },
		{ id: "folder-2", name: "Folder 2", order: 1, parentId: null },
		{ id: "folder-3", name: "Folder 3", order: 2, parentId: null },
		{ id: "folder-4", name: "Subfolder", order: 0, parentId: "folder-1" },
	];
	const itemOrder = {
		__root__: ["folder:folder-1", "folder:folder-2", "folder:folder-3"],
		"folder-1": [],
		"folder-2": [],
		"folder-3": [],
		"folder-4": [],
	};

	let seq = 0;
	for (let c = 0; c < 30; c += 1) {
		seq += 1;
		const id = `card-${seq}`;
		cards.push({
			id,
			folderId: "folder-1",
			title: `Bookmark ${seq}`,
			url: `https://example.com/${seq}`,
			favicon: null,
			thumbId: null,
			order: c,
			titleSource: null,
			origin: "local",
			capturedAt: null,
		});
		itemOrder["folder-1"].push(`card:${id}`);
	}
	itemOrder["folder-1"].push("folder:folder-4");
	for (const fid of ["folder-2", "folder-3"]) {
		for (let c = 0; c < 12; c += 1) {
			seq += 1;
			const id = `card-${seq}`;
			cards.push({
				id,
				folderId: fid,
				title: `Bookmark ${seq}`,
				url: `https://example.com/${seq}`,
				favicon: null,
				thumbId: null,
				order: c,
				titleSource: null,
				origin: "local",
				capturedAt: null,
			});
			itemOrder[fid].push(`card:${id}`);
		}
	}

	const seed = buildSeed({ folders: 0, cardsPerFolder: 0 });
	seed.state.folders = folders;
	seed.state.cards = cards;
	seed.state.itemOrder = itemOrder;
	seed.state.activeFolderId = "folder-1";
	return seed;
}

/**
 * Instrumentation injected before any page script runs.
 * Returns a recorder object exposed as window.__ktabBench.
 */
export const INSTRUMENT_SCRIPT = `
(() => {
  const rec = {
    commits: 0,               // React root commits
    performedWork: 0,         // fibers with PerformedWork flag in committed tree
    components: new Map(),    // displayName/name -> render estimate
    storageSets: [],          // {t, bytes}
    longTasks: [],            // {t, duration}
    fpsSamples: [],
    events: { pointermove: 0, pointerdown: 0, pointerup: 0 },
    gridReadyAt: null,
    startedAt: null,
    endedAt: null,
    _fpsRaf: null,
    _fpsT0: 0,
    enabled: false,
    reset() {
      this.commits = 0; this.performedWork = 0;
      this.components = new Map();
      this.storageSets = [];
      this.longTasks = [];
      this.events = { pointermove: 0, pointerdown: 0, pointerup: 0 };
    },
    startFps() {
      this.fpsSamples = [];
      const loop = (t) => {
        if (this._fpsT0) this.fpsSamples.push(t - this._fpsT0);
        this._fpsT0 = t;
        this._fpsRaf = requestAnimationFrame(loop);
      };
      this._fpsT0 = 0;
      this._fpsRaf = requestAnimationFrame(loop);
    },
    stopFps() {
      if (this._fpsRaf) cancelAnimationFrame(this._fpsRaf);
      this._fpsRaf = null;
      const s = this.fpsSamples;
      this._fpsT0 = 0;
      if (!s.length) return { frames: 0, avgFps: 0, p95FrameMs: 0, maxFrameMs: 0 };
      const d = s.slice().sort((a,b)=>a-b);
      const avg = s.reduce((a,b)=>a+b,0)/s.length;
      return {
        frames: s.length,
        avgFps: Math.round((1000/avg)*10)/10,
        p95FrameMs: Math.round(d[Math.floor(d.length*0.95)]*10)/10,
        maxFrameMs: Math.round(d[d.length-1]*10)/10,
      };
    },
  };
  window.__ktabBench = rec;

  // --- raw event throughput (are handlers event-driven or frame-driven?)
  for (const type of ["pointermove", "pointerdown", "pointerup"]) {
    window.addEventListener(type, () => {
      rec.events[type] += 1;
    }, { capture: true, passive: true });
  }

  // --- first grid paint timestamp (cold-load TTI proxy)
  // Observe "document", NOT document.documentElement: at document_start the
  // <html> element does not exist yet in this context and observe() throws.
  try {
    const markGridReady = () => {
      if (rec.gridReadyAt === null && document.querySelector("[data-marquee-id]")) {
        rec.gridReadyAt = Math.round(performance.now());
        mo.disconnect();
      }
    };
    const mo = new MutationObserver(markGridReady);
    mo.observe(document, { childList: true, subtree: true });
    markGridReady();
  } catch (e) {}

  // --- React commit counting (works against prod react-dom via the devtools hook)
  // Must provide the full devtools-hook surface or react-dom never registers:
  // it checks typeof hook.inject === "function" before calling it.
  const hook = (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ =
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {});
  hook.supportsFiber = true;
  hook.renderers = new Map();
  let _rendererIdSeed = 0;
  if (typeof hook.inject !== "function") {
    hook.inject = (internals) => {
      const id = ++_rendererIdSeed;
      hook.renderers.set(id, {
        id,
        type: 1,
        rendererPackage: internals.rendererPackageName,
        version: internals.version,
      });
      return id;
    };
  }
  const walk = (fiber, depth, seen) => {
    let n = 0;
    let count = 0;
    while (fiber && n < 20000) {
      n += 1;
      if (typeof fiber.flags === "number" && fiber.flags & 1) {
        count += 1;
        const t = fiber.type;
        const name = typeof t === "function" ? (t.displayName || t.name) : (t && typeof t === "object" ? undefined : String(t));
        if (name) rec.components.set(name, (rec.components.get(name) || 0) + 1);
      }
      if (fiber.child) count += walk(fiber.child, depth + 1, seen);
      fiber = fiber.sibling;
    }
    return count;
  };
  const origCommit = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = (rendererId, root, commitPriority, wasHydrated, fluctuations) => {
    if (rec.enabled) {
      rec.commits += 1;
      try {
        const current = root.current || (root.stateNode && root.stateNode.current);
        if (current) rec.performedWork += walk(current, 0);
      } catch (e) {}
    }
    if (origCommit) return origCommit.call(hook, rendererId, root, commitPriority, wasHydrated, fluctuations);
  };
  // renderer injection must see our hook methods
  if (hook.inject) { /* already injected renderer keeps working */ }

  // --- chrome.storage.local.set logging (page world of extension pages)
  const armStorage = () => {
    try {
      const c = window.chrome;
      if (!c || !c.storage || !c.storage.local || c.storage.local.__ktabWrapped) return;
      const orig = c.storage.local.set.bind(c.storage.local);
      const wrapped = (items, cb) => {
        rec.storageSets.push({ t: performance.now(), bytes: JSON.stringify(items).length });
        return orig(items, cb);
      };
      try { Object.defineProperty(c.storage.local, "set", { value: wrapped, writable: true, configurable: true }); } catch {}
      c.storage.local.__ktabWrapped = true;
    } catch (e) {}
  };
  armStorage();
  setTimeout(armStorage, 0);
  document.addEventListener("DOMContentLoaded", armStorage);

  // --- long tasks
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        rec.longTasks.push({ t: Math.round(e.startTime), duration: Math.round(e.duration) });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch (e) {}
})();
`;

/**
 * Timeline instrument: per-commit commit log (timestamp + PerformedWork fiber
 * walk + component names), input gesture timestamps (capture phase), frame-gap
 * watchdog (>16ms between rAF frames = main-thread blocking proxy) and long
 * tasks (>50ms, native observer, cross-check). Storage.set is wrapped so the
 * settle detector can require write-quiet too.
 *
 * Commit attribution: walking root.current inside onCommitFiberRoot sees only
 * fibers flagged PerformedWork by the commit that just finished (React clears
 * the flag at the start of each render), so each log entry is exactly the set
 * of components re-rendered by that commit.
 */
export const TIMELINE_SCRIPT = `
(() => {
  const rec = {
    commitLog: [],   // {t, fibers, names:[[name,count]...]} per commit (top 30 names)
    inputMarks: [],  // {t, type} capture-phase gesture events (bounded)
    gaps: [],        // rAF watchdog: {start, dur} frame gaps > 16ms
    longTasks: [],   // {t, dur} native longtask entries (>50ms)
    storageSets: [], // {t, bytes}
    lastFrameT: 0,
    armedAt: null,
    _wdT0: 0,
  };
  window.__ktabTimeline = rec;
  const now = () => performance.now();

  // --- input gesture anchors (pointerdown = the instant the page sees input)
  for (const type of ["pointerdown", "mousedown", "keydown"]) {
    window.addEventListener(type, (e) => {
      rec.inputMarks.push({ t: Math.round(now() * 10) / 10, type });
      if (rec.inputMarks.length > 200) rec.inputMarks.shift();
    }, { capture: true, passive: true });
  }

  // --- frame-gap watchdog: rAF does not fire while the main thread is
  // blocked, so consecutive rAF timestamps spaced >16ms (>2 missed frames at
  // 120Hz) approximate blocking spans. JS-driven animation produces ~8ms
  // frames and is NOT recorded as a gap.
  const wdLoop = (t) => {
    if (rec._wdT0) {
      const delta = t - rec._wdT0;
      if (delta > 16.9) rec.gaps.push({ start: Math.round(rec._wdT0), dur: Math.round(delta) });
    }
    rec._wdT0 = t;
    rec.lastFrameT = t;
    requestAnimationFrame(wdLoop);
  };
  requestAnimationFrame(wdLoop);

  // --- long tasks (>50ms) via native observer — cross-check of the watchdog
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) rec.longTasks.push({ t: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ entryTypes: ["longtask"] });
  } catch (e) {}

  // --- chrome.storage.local.set (write tail participates in settle)
  const armStorage = () => {
    try {
      const c = window.chrome;
      if (!c || !c.storage || !c.storage.local || c.storage.local.__ktabWrapped) return;
      const orig = c.storage.local.set.bind(c.storage.local);
      const wrapped = (items, cb) => {
        rec.storageSets.push({ t: Math.round(now()), bytes: JSON.stringify(items).length });
        return orig(items, cb);
      };
      try { Object.defineProperty(c.storage.local, "set", { value: wrapped, writable: true, configurable: true }); } catch {}
      c.storage.local.__ktabWrapped = true;
    } catch (e) {}
  };
  armStorage();
  setTimeout(armStorage, 0);
  document.addEventListener("DOMContentLoaded", armStorage);

  // --- React commit log (prod react-dom dispatches onCommitFiberRoot)
  const hook = (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ =
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {});
  hook.supportsFiber = true;
  hook.renderers = new Map();
  let _rendererIdSeed = 0;
  if (typeof hook.inject !== "function") {
    hook.inject = (internals) => {
      const id = ++_rendererIdSeed;
      hook.renderers.set(id, { id, type: 1, rendererPackage: internals.rendererPackageName });
      return id;
    };
  }
  const walk = (fiber, names) => {
    let n = 0;
    let performed = 0;
    while (fiber && n < 20000) {
      n += 1;
      if (typeof fiber.flags === "number" && fiber.flags & 1) {
        performed += 1;
        const t = fiber.type;
        const name = typeof t === "function" ? (t.displayName || t.name) : (t && typeof t === "object" ? undefined : String(t));
        if (name) names.set(name, (names.get(name) || 0) + 1);
      }
      if (fiber.child) performed += walk(fiber.child, names);
      fiber = fiber.sibling;
    }
    return performed;
  };
  const origCommit = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = (rendererId, root, priority, hydrated, fluctuations) => {
    if (rec.commitLog.length < 400) {
      const t = Math.round(now() * 10) / 10;
      try {
        const names = new Map();
        const current = root.current || (root.stateNode && root.stateNode.current);
        const performed = current ? walk(current, names) : 0;
        rec.commitLog.push({
          t,
          fibers: performed,
          names: [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
        });
      } catch (e) {
        rec.commitLog.push({ t, fibers: -1, names: [], err: String(e).slice(0, 80) });
      }
    }
    if (origCommit) return origCommit.call(hook, rendererId, root, priority, hydrated, fluctuations);
  };
})();
`;

/**
 * Launch Chromium with the built extension loaded.
 * Returns { context, page, extensionId } where page is about:blank.
 */
export async function launchExtension({
	headless = true,
	backgroundRenderingOverrides = true,
	nativeWindowGeometry = false,
} = {}) {
	if (!fs.existsSync(OUTPUT_DIR)) {
		throw new Error(
			`Extension build not found at ${OUTPUT_DIR}. Run: cd apps/extension && bun run build`,
		);
	}
	const userDataDir = fs.mkdtempSync(
		path.join(process.env.TEMP ?? "/tmp", "ktab-bench-"),
	);
	const context = await chromium.launchPersistentContext(userDataDir, {
		headless,
		// Fixed viewport emulation restores/resizes extension-created windows,
		// invalidating minimized-window and focus probes. Native tests opt out.
		...(nativeWindowGeometry ? { viewport: null } : {}),
		// The default headless shell cannot load extensions; the "chromium"
		// channel runs the full build with new headless (extension support).
		channel: "chromium",
		args: [
			`--disable-extensions-except=${OUTPUT_DIR}`,
			`--load-extension=${OUTPUT_DIR}`,
			"--no-first-run",
			// A covered window counts as occluded to Chromium, which then
			// stops producing frames: CSS transitions freeze at their start
			// value and exit animations never unmount portals. Occlusion
			// depends on whatever window the developer happens to have in
			// front, so it must never decide whether a check passes. Native
			// geometry runs (NATIVE_CAPTURE) still exercise real window
			// creation and focus — they just render while covered.
			"--disable-features=CalculateNativeWinOcclusion",
			...(backgroundRenderingOverrides
				? [
						"--disable-background-timer-throttling",
						"--disable-backgrounding-occluded-windows",
						"--disable-renderer-backgrounding",
					]
				: []),
		],
	});
	let [background] = context.serviceWorkers();
	if (!background) {
		background = await context.waitForEvent("serviceworker", {
			timeout: 15000,
		});
	}
	let extensionId;
	try {
		extensionId = new URL(background.url()).host;
	} catch (error) {
		throw new Error(
			`Could not resolve extension id from service worker url: ${background.url()} (${error})`,
		);
	}
	return { context, extensionId, userDataDir };
}

/** Open a newtab page, optionally seeding first (seed + reload for cold data). */
export async function openNewtab(
	context,
	extensionId,
	{ seed, initScripts = [] } = {},
) {
	const page = await context.newPage();
	await page.addInitScript(INSTRUMENT_SCRIPT);
	for (const script of initScripts) await page.addInitScript(script);
	await page.goto(`chrome-extension://${extensionId}/newtab.html`);
	if (seed) {
		await page.evaluate((data) => {
			return new Promise((resolve, reject) => {
				chrome.storage.local.set(
					{ "perch-setup": JSON.stringify(data) },
					() => {
						if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
						else resolve();
					},
				);
			});
		}, seed);
		await page.reload({ waitUntil: "load" });
	}
	return page;
}

/** Median of a numeric array. */
export function median(values) {
	if (!values.length) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Wait for the grid to render `n` marquee cells (interactive proxy). */
export async function waitForGrid(page, n = 1, timeout = 30000) {
	await page.waitForFunction(
		(m) => document.querySelectorAll("[data-marquee-id]").length >= m,
		n,
		{ timeout },
	);
}

/** Count elements with an active backdrop-filter on screen. */
export async function countBackdropNodes(page) {
	return page.evaluate(() => {
		let nodes = 0;
		let svgFilterNodes = 0;
		const detail = [];
		for (const el of document.querySelectorAll("*")) {
			const cs = getComputedStyle(el);
			const bf = cs.backdropFilter || cs.webkitBackdropFilter;
			if (bf && bf !== "none") {
				nodes += 1;
				if (bf.includes("url(#")) svgFilterNodes += 1;
				const r = el.getBoundingClientRect();
				detail.push({
					tag: el.tagName.toLowerCase(),
					cls: String(el.className).slice(0, 60),
					w: Math.round(r.width),
					h: Math.round(r.height),
					svg: bf.includes("url(#"),
				});
			}
		}
		return { nodes, svgFilterNodes, detail };
	});
}

/**
 * Run one measured interaction: reset + arm the recorder, dispatch `fn`,
 * wait for `settlePredicate` (or settleMs fallback), then snapshot.
 * Returns { durationMs, commits, performedWork, components, storageSets,
 * longTasks, events } — all scoped to the interaction window.
 */
export async function measureInteraction(
	page,
	fn,
	{ settleMs = 500, settlePredicate = null, settleTimeout = 5000 } = {},
) {
	await page.evaluate(() => {
		const r = window.__ktabBench;
		r.reset();
		r.enabled = true;
		r.startedAt = performance.now();
	});
	const t0 = performance.now();
	await fn();
	if (settlePredicate) {
		await page
			.waitForFunction(settlePredicate, null, { timeout: settleTimeout })
			.catch(() => {});
	}
	await page.waitForTimeout(settleMs);
	const durationMs = Math.round(performance.now() - t0);
	const out = await page.evaluate(() => {
		const r = window.__ktabBench;
		r.enabled = false;
		r.endedAt = performance.now();
		return {
			pageDurationMs: Math.round(r.endedAt - r.startedAt),
			commits: r.commits,
			performedWork: r.performedWork,
			components: [...r.components.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 12),
			storageSets: r.storageSets,
			longTasks: r.longTasks,
			events: r.events,
		};
	});
	return { durationMs, ...out };
}

/** Median helper for objects with a numeric field. */
export function medianOf(items, field) {
	return median(items.map((i) => i[field]).filter((v) => v != null));
}

/** Open the Preferences workspace. The root pane already embeds theme,
 * accent and material controls (no separate Appearance nav step exists). */
export async function openPreferences(page) {
	await page.click('[aria-label="Settings"]');
	await page
		.waitForFunction(
			() => document.querySelector('[data-settings-open="true"]') !== null,
			null,
			{ timeout: 5000 },
		)
		.catch(() => {});
	await page.waitForTimeout(600); // pane transition
}

/** Close preferences via its dedicated close control and confirm closed. */
export async function closeSettings(page) {
	const close = page.locator('[aria-label="Close preferences"]');
	if (await close.count()) {
		await close.first().click();
	} else {
		await page.keyboard.press("Escape");
	}
	await page
		.waitForFunction(
			() =>
				document.querySelector('[data-settings-open="false"]') !== null ||
				document.querySelector("[data-settings-open]") === null,
			null,
			{ timeout: 5000 },
		)
		.catch(() => {});
	await page.waitForTimeout(400);
}

/**
 * CDP CPU profile helpers. startCpuProfile returns a stop() that resolves to
 * a summarized profile: top self-time functions + total samples.
 */
export async function startCpuProfile(page) {
	const session = await page.context().newCDPSession(page);
	await session.send("Profiler.enable");
	await session.send("Profiler.setSamplingInterval", { interval: 200 });
	await session.send("Profiler.start");
	return {
		stop: async () => {
			const { profile } = await session.send("Profiler.stop");
			await session.detach().catch(() => {});
			return summarizeCpuProfile(profile);
		},
	};
}

/**
 * Summarize a CDP profile into self-time per (function, url). Self time =
 * sum of hitCount per node (sampling interval approximation).
 */
export function summarizeCpuProfile(profile, topN = 18) {
	const byKey = new Map();
	let totalHits = 0;
	for (const node of profile.nodes) {
		const fn = node.callFrame.functionName || "(anonymous)";
		const url = (node.callFrame.url || "").replace(
			/^.*\/(chunks|assets)\//,
			"",
		);
		const key = `${fn} @ ${url || "(vm)"}`;
		byKey.set(key, (byKey.get(key) ?? 0) + (node.hitCount ?? 0));
	}
	for (const hits of byKey.values()) totalHits += hits;
	const top = [...byKey.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([key, hits]) => ({
			fn: key,
			selfMs: Math.round(hits * 0.2), // sampling interval 0.2ms
			pct: totalHits ? Math.round((hits / totalHits) * 1000) / 10 : 0,
		}));
	return { totalSelfMs: totalHits * 0.2, top };
}

/** Save raw results JSON under scripts/results/. */
export function saveResults(name, data) {
	fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
	const file = path.join(__dirname, "results", name);
	fs.writeFileSync(file, JSON.stringify(data, null, 2));
	return file;
}
