/**
 * Startup long task decomposition benchmark for the kTab newtab.
 *
 * The cold-load bench found 1 long task of ~214-233ms on every cold start
 * (5/5 runs). Before choosing between code-splitting (P1) and post-paint
 * deferral (P1-alt), this bench splits the startup window into segments:
 *
 *   T0 -> T1  module evaluation: fetch + top-level execution of the newtab
 *             bundle. Anchor: DOMContentLoaded (module scripts are deferred,
 *             so DCL fires only after the last top-level statement of the
 *             bundle; react-dom's devtools-hook inject fires mid-eval and
 *             is captured as a floor sanity check).
 *   T1 -> T2  React mount: scheduler task -> first commit. Anchor: first
 *             onCommitFiberRoot via __REACT_DEVTOOLS_GLOBAL_HOOK__ (same
 *             signal as bench-lib).
 *   T2 -> T3  post-mount -> paint: passive effects, persist hydration
 *             commits, first painted frame. Anchors: double rAF after the
 *             first commit, plus FCP (paint observer) for cross-checking.
 *
 * Also captures: second commit timestamp (persist rehydrate re-render),
 * chrome.storage.local.get start/end (hydration data arrival) and the long
 * tasks inside the T0 -> T3 window.
 *
 * If DCL turned out to fire AFTER the first commit (scheduler wins the race
 * with the DCL disposition task), this bench would be invalid as written —
 * it refuses to report segment medians in that case (see segmentOrderOk).
 *
 * Runs alternate empty/seeded (3 each by default) so ordering bias from
 * V8 code cache cannot contaminate the comparison; each run gets a fresh
 * browser profile. The seeded flow mirrors bench-cold-load: unmeasured
 * first load to write the seed, then the measured second load.
 *
 * Run: node scripts/bench-decompose.mjs [runs=6]
 */
import { rmSync } from "node:fs";
import {
	launchExtension,
	buildSeed,
	median,
	saveResults,
} from "./bench-lib.mjs";

const RUNS = Number(process.argv[2] ?? 6) || 6;
const results = { empty: [], seeded: [] };

/** Startup phase anchors, all in the page world via addInitScript. */
const DECOMPOSE_SCRIPT = `
(() => {
  const a = {
    injectAt: null,        // react-dom renderer registration (mid module eval floor)
    dclAt: null,           // DOMContentLoaded (end of deferred script execution)
    commit1At: null,       // first React commit
    commit2At: null,       // second commit (persist rehydrate expected)
    storageGetStartAt: null,
    storageGetEndAt: null,
    storageGetBytes: null,
    fcpAt: null,           // first-contentful-paint
    raf2At: null,          // second rAF after commit1 (painted frame proxy)
    longTasks: [],
    _rafScheduled: false,
  };
  window.__ktabDecompose = a;
  const now = () => performance.now();
  try { a.stage = "dcl-listener"; } catch (e) {}

  // --- module eval anchors ---
  document.addEventListener("DOMContentLoaded", () => { a.dclAt = now(); }, { once: true });

  // --- chrome.storage.local.get interception (persist hydration input) ---
  const armGet = () => {
    try {
      const c = window.chrome;
      if (!c || !c.storage || !c.storage.local || c.storage.local.__ktabGetWrapped) return;
      const orig = c.storage.local.get.bind(c.storage.local);
      // chrome.storage.local.get supports BOTH callback and promise forms;
      // the product uses the promise form, so the wrapper must keep it.
      const wrapped = (...args) => {
        if (a.storageGetStartAt === null) a.storageGetStartAt = now();
        const markEnd = (result) => {
          if (a.storageGetEndAt === null) {
            a.storageGetEndAt = now();
            try { a.storageGetBytes = JSON.stringify(result).length; } catch (e) {}
          }
          return result;
        };
        if (typeof args[args.length - 1] === "function") {
          const cb = args.pop();
          return orig(...args, (result) => cb(markEnd(result)));
        }
        const p = orig(...args);
        if (p && typeof p.then === "function") return p.then(markEnd);
        return p;
      };
      try { Object.defineProperty(c.storage.local, "get", { value: wrapped, writable: true, configurable: true }); } catch {}
      c.storage.local.__ktabGetWrapped = true;
    } catch (e) {}
  };
  armGet();
  setTimeout(armGet, 0);
  document.addEventListener("DOMContentLoaded", armGet);
  try { a.stage = "observers"; } catch (e) {}

  // --- long tasks (same registration shape as bench-lib: entryTypes, no
  // buffered flag — longtask rejects observe({type, buffered}) and dies) ---
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) a.longTasks.push({ t: Math.round(e.startTime), duration: Math.round(e.duration) });
    }).observe({ entryTypes: ["longtask"] });
  } catch (e) {}

  // FCP is read at collection time via performance.getEntriesByType("paint")
  // (same as bench-cold-load) — no observer needed.
  try { a.stage = "hook"; } catch (e) {}

  // --- React commit anchors (prod react-dom dispatches onCommitFiberRoot) ---
  try {
  const hook = (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ =
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {});
  hook.supportsFiber = true;
  hook.renderers = new Map();
  let _rendererIdSeed = 0;
  if (typeof hook.inject !== "function") {
    hook.inject = (internals) => {
      const id = ++_rendererIdSeed;
      hook.renderers.set(id, { id, type: 1, rendererPackage: internals.rendererPackageName });
      if (a.injectAt === null) a.injectAt = now();
      return id;
    };
  }
  const origCommit = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = (rendererId, root, priority, hydrated, fluctuations) => {
    if (a.commit1At === null) {
      a.commit1At = now();
      // Double rAF from the first commit: the second callback fires on the
      // frame after the first painted frame following that commit.
      if (!a._rafScheduled) {
        a._rafScheduled = true;
        requestAnimationFrame(() => requestAnimationFrame(() => { a.raf2At = now(); }));
      }
    } else if (a.commit2At === null) {
      a.commit2At = now();
    }
    if (origCommit) return origCommit.call(hook, rendererId, root, priority, hydrated, fluctuations);
  };
  } catch (e) { try { a.hookError = String(e && e.stack ? e.stack.slice(0, 300) : e); } catch (e2) {} }
})();
`;

/** Copy of bench-cold-load's seeded flow: unmeasured load to write data. */
async function preSeed(context, extensionId, seed) {
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
	}, seed);
	await page.close();
}

async function measureOneLoad(context, extensionId) {
	const page = await context.newPage();
	page.on("pageerror", (err) => {
		console.log("  [pageerror]", String(err).slice(0, 200));
	});
	await page.addInitScript(DECOMPOSE_SCRIPT);
	const cdp = await context.newCDPSession(page);
	await cdp.send("Performance.enable");
	await page.goto(`chrome-extension://${extensionId}/newtab.html`, {
		waitUntil: "load",
	});
	// Wait until the first painted frame after the first commit exists
	// (T3 anchor), with a hard cap so empty-state runs still complete.
	await page
		.waitForFunction(() => window.__ktabDecompose?.raf2At !== null, null, {
			timeout: 20000,
		})
		.catch(() => {});
	await page.waitForTimeout(400);

	const anchors = await page.evaluate(() => {
		const a = window.__ktabDecompose;
		const r = (v) => (v === null ? null : Math.round(v * 10) / 10);
		const h = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
		return {
			stage: a?.stage ?? null,
			hookError: a?.hookError ?? null,
			hookState: {
				exists: !!h,
				renderers: h?.renderers ? h.renderers.size : null,
				injectType: h ? typeof h.inject : null,
				commitType: h ? typeof h.onCommitFiberRoot : null,
			},
			injectAt: r(a?.injectAt ?? null),
			dclAt: r(a.dclAt),
			commit1At: r(a.commit1At),
			commit2At: r(a.commit2At),
			storageGetStartAt: r(a.storageGetStartAt),
			storageGetEndAt: r(a.storageGetEndAt),
			storageGetBytes: a.storageGetBytes,
			// FCP read at collection time (paint entries are buffered by the
			// browser automatically; no observer needed).
			fcpAt: (() => {
				try {
					const p = performance.getEntriesByType("paint").find((x) => x.name === "first-contentful-paint");
					return p ? Math.round(p.startTime) : null;
				} catch { return null; }
			})(),
			raf2At: r(a.raf2At),
			longTasks: a.longTasks.slice(0, 20),
		};
	});
	const { metrics } = await cdp.send("Performance.getMetrics");
	const pick = (name) =>
		Math.round((metrics.find((m) => m.name === name)?.value ?? 0) * 1000);
	anchors.cdpScriptMs = pick("ScriptDuration");
	anchors.cdpTaskMs = pick("TaskDuration");
	await page.close();
	return anchors;
}

function summarize(variant, runs) {
	const seg = (r, a, b) => (r[a] !== null && r[b] !== null ? r[b] - r[a] : null);
	const nums = (xs) => xs.filter((v) => v !== null);
	const pick = (f) => {
		const vals = nums(runs.map((r) => f(r)));
		return vals.length ? Math.round(median(vals) * 10) / 10 : null;
	};
	const longInWindow = (r) => {
		if (r.raf2At === null) return [];
		return r.longTasks.filter((t) => t.t <= r.raf2At);
	};
	return {
		variant,
		runs: runs.length,
		segmentOrderOk: runs.every(
			(r) =>
				r.dclAt !== null &&
				r.commit1At !== null &&
				r.raf2At !== null &&
				r.dclAt <= r.commit1At,
		),
		median: {
			moduleEvalMs_T0T1: pick((r) => r.dclAt),
			mountMs_T1T2: pick((r) => seg(r, "dclAt", "commit1At")),
			postMountMs_T2T3: pick((r) => seg(r, "commit1At", "raf2At")),
			totalMs_T0T3: pick((r) => r.raf2At),
			commit2At: pick((r) => r.commit2At),
			commit2DeltaMs: pick((r) => seg(r, "commit1At", "commit2At")),
			storageGetEndAt: pick((r) => r.storageGetEndAt),
			fcpMs: pick((r) => r.fcpAt),
			cdpScriptMs: pick((r) => r.cdpScriptMs),
			longTaskTotalInWindowMs: pick((r) =>
				longInWindow(r).reduce((acc, t) => acc + t.duration, 0),
			),
		},
		longTaskSamples: runs.map((r) => longInWindow(r).map((t) => t.duration)),
	};
}

for (let i = 0; i < RUNS; i += 1) {
	const variant = i % 2 === 0 ? "empty" : "seeded";
	const { context, extensionId, userDataDir } = await launchExtension();
	try {
		if (variant === "seeded") {
			await preSeed(context, extensionId, buildSeed({ folders: 3, cardsPerFolder: 12 }));
		}
		const anchors = await measureOneLoad(context, extensionId);
		results[variant].push({ run: i + 1, ...anchors });
		console.log(
			`[run ${i + 1} ${variant}]:`,
			JSON.stringify({
				dclAt: anchors.dclAt,
				commit1At: anchors.commit1At,
				commit2At: anchors.commit2At,
				raf2At: anchors.raf2At,
				fcpAt: anchors.fcpAt,
			}),
		);
	} finally {
		await context.close().catch(() => {});
		if (userDataDir) {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	}
}

const summary = {
	empty: summarize("empty", results.empty),
	seeded: summarize("seeded", results.seeded),
};
const file = saveResults("decompose.json", {
	date: new Date().toISOString(),
	summary,
	raw: results,
});
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
console.log("saved:", file);
