/**
 * Frente A — CPU profile attribution of the dominant ~110-145ms inter-commit
 * block (probe perf/probe-overlay-isolation).
 *
 * The transition timeline (§6.3) shows WHEN the work happens — a continuous
 * blocked span between two commits (e.g. tabbar `[41, 1, 109, 1, 35, 18, 0]`)
 * — but not WHO executes it. This bench runs a CDP sampling profile around
 * each gesture, slices the profile's samples to the dominant inter-commit
 * gap (largest commit spacing in the window) and attributes self/total time
 * to concrete bundle functions plus a React-subtree grouping.
 *
 * Clock mapping (honest approximation): CDP Profiler samples carry
 * microsecond timeDeltas from profile start, not page-clock timestamps. Each
 * sample is mapped onto the page clock by linear interpolation between the
 * page-clock instants recorded right after Profiler.start and right before
 * Profiler.stop. IPC latency adds a few ms of skew at both anchors — the gap
 * is ~110-145ms wide, so a couple of ms of edge skew do not change the
 * attribution, but samples within ~5ms of a gap edge are borderline.
 *
 * Names need the UNMINIFIED throwaway build (same protocol as the previous
 * probe: throwaway branch with `minify: false` in wxt.config.ts, discarded
 * afterwards — never committed). Timings from these runs are NOT canonical;
 * the canonical window timings stay the minified timeline medians (§6.3).
 * What is canonical here: function names + their share of the gap's samples.
 *
 * Interactions (the 3 most relevant): tabbar-nav, open-folder-grid,
 * close-preferences. 3 reps each by default.
 *
 * Report per rep: dominant gap bounds + width, samples in gap, top functions
 * by self time in gap, top by total (inclusive) time, subtree shares.
 * Aggregate: summed self/total ms per function across the 3 reps + median
 * gap width and median sample count.
 *
 * Subtree grouping: each in-gap sample's stack is walked (leaf -> root via
 * the parent map) and the sample is attributed to the innermost frame whose
 * function name matches a known subtree marker (overlay / grid / toolbar /
 * shell). Samples with no matching frame (react-dom internals, style/layout
 * in native code surfacing as (program), etc.) are reported as unattributed
 * — better an honest unattributed share than an invented one.
 *
 * Run: node scripts/bench-transition-cpuprofile.mjs [reps=3] [suffix]
 *   suffix defaults to "cpuprofile"; output:
 *   results/transition-cpuprofile-<suffix>.json
 */
import {
	launchExtension,
	openNewtab,
	waitForGrid,
	saveResults,
	median,
	TIMELINE_SCRIPT,
	buildInteractionSeed,
} from "./bench-lib.mjs";
import { rmSync } from "node:fs";

// PROBE glass-transition (Front B): --headed runs Chromium with a visible
// window + real GPU. CDP profiling works headed the same way.
// Usage: node scripts/bench-transition-cpuprofile.mjs 3 headed --headed
const HEADED = process.argv.includes("--headed");
const POSITIONAL = process.argv.slice(2).filter((a) => a !== "--headed");
const REPS = Number(POSITIONAL[0] ?? 3) || 3;
const SUFFIX = POSITIONAL[1] ? `-${POSITIONAL[1]}` : "-cpuprofile";

/** Markers mapping a JS function name to a React subtree for grouping. */
const SUBTREE_MARKERS = [
	// PROBE glass-transition (Front A): isolate glass-material frames
	// (LiquidGlass measure/displacement, glass recipe helpers) so the
	// glasskill A/B attributes glass JS precisely instead of leaving it in
	// "(unattributed)". Ordered before grid-card-icon: names like
	// glassCardMaterial belong to the material, not the card.
	{ subtree: "glass-material", match: /displacementmap|liquidglass|^measure$|refract|glassmenu|glasscard|glassdropdown|glassforeground|glasssurface|glasslens|glassshape/i },
	{ subtree: "settings-overlay", match: /settings|settingspanel|settingssidebar|settingsmotion/i },
	{ subtree: "context-menu", match: /contextmenu/i },
	{ subtree: "popover-tooltip-dialog", match: /popover|tooltip|dialog|sheet|select|dropdown/i },
	{ subtree: "grid-card-icon", match: /dialcard|dialgrid|folderpreview|iconmode|icontile|^icon$|card/i },
	{ subtree: "toolbar-tabbar", match: /toolbar|tabbar|navigationtoolbar|breadcrumb|search/i },
	{ subtree: "ambient-shell", match: /clock|greeting|quicklink|backgroundlayer|ambient|homesurface|appearance/i },
	{ subtree: "state-store", match: /setup-store|zustand|persist|hydrate|storage/i },
	{ subtree: "react-dom-internals", match: /react-dom|workloop|commitroot|performwork|reconcil|flushwork|renderwithhooks/i },
	{ subtree: "motion-animate", match: /motion|animatepresence|framer/i },
];

/** Classify one function name into a subtree (or null when unknown). */
function classifySubtree(fnName) {
	for (const { subtree, match } of SUBTREE_MARKERS) {
		if (match.test(fnName)) return subtree;
	}
	return null;
}

const SNAPSHOT = () => {
	const r = window.__ktabTimeline;
	return { commits: r.commitLog.length, gaps: r.gaps.length, dT: performance.now() };
};

async function waitQuiet(page, pre) {
	return page
		.waitForFunction(
			(pre) => {
				const r = window.__ktabTimeline;
				if (!r) return false;
				const now = performance.now();
				if (now < pre.dT + 120) return false;
				const newCommits = r.commitLog.length - pre.commits;
				const newGaps = r.gaps.length - pre.gaps;
				if (newCommits === 0 && newGaps === 0) return now > pre.dT + 2500;
				const acts = [];
				if (r.commitLog.length) acts.push(r.commitLog[r.commitLog.length - 1].t);
				for (let i = pre.gaps; i < r.gaps.length; i++)
					acts.push(r.gaps[i].start + r.gaps[i].dur);
				for (let i = 0; i < r.longTasks.length; i++)
					acts.push(r.longTasks[i].t + r.longTasks[i].dur);
				for (let i = 0; i < r.storageSets.length; i++)
					acts.push(r.storageSets[i].t);
				const last = acts.length ? Math.max(...acts) : pre.dT;
				return now - last > 250;
			},
			pre,
			{ timeout: 10000, polling: 60 },
		)
		.then(() => true)
		.catch(() => false);
}

/**
 * Slice the window + find the dominant inter-commit gap (largest spacing).
 * Returns commit times, gap bounds and per-window aggregates.
 */
async function extractWindowWithGap(page, pre) {
	return page.evaluate((pre) => {
		const r = window.__ktabTimeline;
		const inMark = r.inputMarks.find((m) => m.t >= pre.dT - 2) ?? null;
		const inputT = inMark ? inMark.t : null;
		const t0 = inputT ?? -1e9;
		const commits = r.commitLog.filter((c) => c.t >= t0 - 1);
		let settle = inputT ?? 0;
		for (const c of commits) settle = Math.max(settle, c.t);
		for (const g of r.gaps)
			if (g.start + g.dur > t0) settle = Math.max(settle, g.start + g.dur);
		for (const lt of r.longTasks)
			if (lt.t + lt.dur > t0) settle = Math.max(settle, lt.t + lt.dur);
		for (const s of r.storageSets) if (s.t > t0) settle = Math.max(settle, s.t);
		settle = Math.round(settle);

		const spacing = commits.slice(1).map((c, i) => Math.round(c.t - commits[i].t));
		let gapIdx = -1;
		let gapWidth = 0;
		spacing.forEach((w, i) => {
			if (w > gapWidth) {
				gapWidth = w;
				gapIdx = i;
			}
		});
		const gap =
			gapIdx >= 0
				? { start: commits[gapIdx].t, end: commits[gapIdx + 1].t, width: gapWidth }
				: null;

		const nameAgg = new Map();
		let fibers = 0;
		for (const c of commits) {
			fibers += c.fibers;
			for (const [n, cnt] of c.names ?? [])
				nameAgg.set(n, (nameAgg.get(n) ?? 0) + cnt);
		}
		return {
			inputDetected: inputT != null,
			commits: commits.length,
			commitTimes: commits.map((c) => c.t),
			windowMs: inputT != null ? Math.round(settle - inputT) : null,
			gap,
			commitSpacingMs: spacing,
			fibersTotal: fibers,
			topNames: [...nameAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
		};
	}, pre);
}

/** Build id->node + child->parent maps for stack walking. */
function indexProfile(profile) {
	const byId = new Map();
	const parent = new Map();
	for (const node of profile.nodes) byId.set(node.id, node);
	for (const node of profile.nodes) {
		for (const childId of node.children ?? []) parent.set(childId, node.id);
	}
	return { byId, parent };
}

function frameLabel(node) {
	const fn = node.callFrame.functionName || "(anonymous)";
	const url = (node.callFrame.url || "").replace(/^.*\/(chunks|assets)\//, "");
	return `${fn} @ ${url || "(vm)"}`;
}

/** Leaves that are native/browser work, not JS execution. */
const NATIVE_LEAF_RE = /^(\(program\)|\(idle\)|\(gc\)|toDataURL|getBoundingClientRect|querySelectorAll?|elementFromPoint|elementsFromPoint|getComputedStyle|requestAnimationFrame|appendChild|setAttribute|createElement|focus|scrollTo)$/;

/** Frames belonging to this bench's own page-world instrumentation. */
const HARNESS_RE = /^(walk|SNAPSHOT|extractWindowWithGap|measureProfiled)$/;

/**
 * Attribute in-gap samples: self time per function, total (inclusive) time
 * per function (sample charged to every ancestor), subtree share via the
 * innermost matching frame on each sample's stack.
 *
 * Two extra cuts disambiguate the "who executes" question when the gap is
 * native-dominated: `nativeInitiators` (for samples whose leaf is native,
 * the nearest ancestor frame living in the bundle — i.e. which JS called
 * into the native work) and `harnessOverhead` (samples with a bench
 * instrumentation frame on the stack — the PerformedWork `walk` runs inside
 * onCommitFiberRoot and must not be mistaken for product cost).
 */
function attributeGap(profile, gapStart, gapEnd, tStartPage, tStopPage) {
	const { samples = [], timeDeltas = [] } = profile;
	const { byId, parent } = indexProfile(profile);
	const totalDelta = timeDeltas.reduce((a, b) => a + b, 0);
	const spanPage = tStopPage - tStartPage;

	const selfHits = new Map();
	const totalHits = new Map();
	const subtreeHits = new Map();
	const nativeInitHits = new Map();
	const wholeSelfHits = new Map();
	let inGap = 0;
	let harnessInGap = 0;
	let cum = 0;
	for (let i = 0; i < samples.length; i += 1) {
		cum += timeDeltas[i] ?? 0;
		const tPage = totalDelta > 0 ? tStartPage + (cum / totalDelta) * spanPage : tStartPage;
		const leaf = byId.get(samples[i]);
		if (leaf) {
			const wk = frameLabel(leaf);
			wholeSelfHits.set(wk, (wholeSelfHits.get(wk) ?? 0) + 1);
		}
		if (tPage < gapStart || tPage > gapEnd) continue;
		inGap += 1;
		const leafId = samples[i];
		if (!leaf) continue;
		const leafName = leaf.callFrame.functionName || "(anonymous)";
		const key = frameLabel(leaf);
		selfHits.set(key, (selfHits.get(key) ?? 0) + 1);
		// Walk the stack once: ancestors for total time, harness flag,
		// innermost subtree match, nearest bundle frame for native leaves.
		let cur = leafId;
		let depth = 0;
		let sub = null;
		let harness = false;
		let initiator = null;
		while (cur != null && depth < 200) {
			const node = byId.get(cur);
			if (!node) break;
			const fn = node.callFrame.functionName || "(anonymous)";
			const k = frameLabel(node);
			totalHits.set(k, (totalHits.get(k) ?? 0) + 1);
			if (!harness && HARNESS_RE.test(fn)) harness = true;
			if (sub == null) sub = classifySubtree(fn);
			const url = node.callFrame.url || "";
			if (
				initiator == null &&
				NATIVE_LEAF_RE.test(leafName) &&
				/\/(chunks|assets)\//.test(url)
			) {
				initiator = k;
			}
			cur = parent.get(cur);
			depth += 1;
		}
		if (harness) harnessInGap += 1;
		subtreeHits.set(sub ?? "(unattributed)", (subtreeHits.get(sub ?? "(unattributed)") ?? 0) + 1);
		if (NATIVE_LEAF_RE.test(leafName)) {
			nativeInitHits.set(initiator ?? "(no-bundle-ancestor)", (nativeInitHits.get(initiator ?? "(no-bundle-ancestor)") ?? 0) + 1);
		}
	}
	const toMs = (hits) => Math.round(hits * 0.2 * 10) / 10; // 200us sampling interval
	const top = (m, n) =>
		[...m.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, n)
			.map(([fn, hits]) => ({ fn, selfMs: toMs(hits), samples: hits }));
	const totalTop = (m, n) =>
		[...m.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, n)
			.map(([fn, hits]) => ({ fn, totalMs: toMs(hits), samples: hits }));
	return {
		samplesInGap: inGap,
		samplesTotal: samples.length,
		harnessSamplesInGap: harnessInGap,
		topSelf: top(selfHits, 20),
		topTotal: totalTop(totalHits, 10),
		subtrees: [...subtreeHits.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([subtree, hits]) => ({
				subtree,
				samples: hits,
				pct: inGap ? Math.round((hits / inGap) * 1000) / 10 : 0,
			})),
		nativeInitiators: [...nativeInitHits.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([fn, hits]) => ({ fn, samples: hits, selfMs: toMs(hits) })),
		wholeWindowTopSelf: top(wholeSelfHits, 8),
	};
}

/** One profiled interaction: profile across gesture -> slice to dominant gap. */
async function measureProfiled(page, gesture) {
	const pre = await page.evaluate(SNAPSHOT);
	const session = await page.context().newCDPSession(page);
	await session.send("Profiler.enable");
	await session.send("Profiler.setSamplingInterval", { interval: 200 });
	await session.send("Profiler.start");
	const tStartPage = await page.evaluate(() => performance.now());
	await gesture();
	const quiet = await waitQuiet(page, pre);
	const tStopPage = await page.evaluate(() => performance.now());
	const { profile } = await session.send("Profiler.stop");
	await session.detach().catch(() => {});
	const win = await extractWindowWithGap(page, pre);
	let attribution = null;
	if (win.gap) {
		attribution = attributeGap(profile, win.gap.start, win.gap.end, tStartPage, tStopPage);
	}
	return { quietDetected: quiet, ...win, attribution };
}

function fmt(m) {
	const g = m.gap ? `${Math.round(m.gap.start)}->${Math.round(m.gap.end)} (${m.gap.width}ms)` : "none";
	const s = m.attribution
		? `gapSamples=${m.attribution.samplesInGap}/${m.attribution.samplesTotal}`
		: "gapSamples=-";
	return `window=${m.windowMs ?? "-"}ms commits=${m.commits} spacing=[${(m.commitSpacingMs ?? []).join(",")}] gap=${g} ${s} fibers=${m.fibersTotal}`;
}

async function main() {
	const seed = buildInteractionSeed();
	const { context, extensionId, userDataDir } = await launchExtension({
		headless: !HEADED,
	});
	const results = {};
	try {
		const page = await openNewtab(context, extensionId, {
			seed,
			initScripts: [TIMELINE_SCRIPT],
		});
		await waitForGrid(page, 30, 20000);
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.waitForTimeout(400);

		const push = (label, m) => {
			if (!results[label]) results[label] = [];
			results[label].push(strip(m));
		};
		// strip() keeps the JSON serializable (drop nothing — attribution is
		// already plain data); kept as a hook for future trimming.
		function strip(m) {
			return m;
		}

		const activeIs =
			(id) =>
			() =>
				document.querySelector("[data-active-folder-id]")?.getAttribute("data-active-folder-id") === id;

		async function gotoFolder(id, cards) {
			await page.click(`[data-tab-id="${id}"]`);
			if (cards) await waitForGrid(page, cards, 8000).catch(() => {});
			await page.waitForFunction(activeIs(id), null, { timeout: 8000 }).catch(() => {});
			await page.waitForTimeout(350);
		}

		async function openPrefsUnmeasured() {
			await page.click('[aria-label="Settings"]');
			await page
				.waitForFunction(
					() => document.querySelector('[data-settings-open="true"]') !== null,
					null,
					{ timeout: 5000 },
				)
				.catch(() => {});
			await page.waitForTimeout(400);
		}
		async function closePrefsGesture() {
			const closeBtn = page.locator('[aria-label="Close preferences"]');
			if (await closeBtn.count()) await closeBtn.first().click();
			else await page.keyboard.press("Escape");
		}

		// 1) close Preferences (3 reps; re-open unmeasured between reps)
		await openPrefsUnmeasured();
		for (let i = 0; i < REPS; i += 1) {
			const m = await measureProfiled(page, closePrefsGesture);
			push("close-preferences", m);
			console.log(`[close-preferences] rep ${i + 1}:`, fmt(m));
			await openPrefsUnmeasured();
		}
		// settle back to closed prefs on folder-1 for the nav gestures
		await closePrefsGesture();
		await page.waitForTimeout(400);
		await gotoFolder("folder-1", 30);

		// 2) tabbar navigation (folder-2 -> folder-3 -> folder-1)
		const tabSeq = ["folder-2", "folder-3", "folder-1"];
		for (let i = 0; i < REPS; i += 1) {
			const target = tabSeq[i % tabSeq.length];
			const m = await measureProfiled(page, () => page.click(`[data-tab-id="${target}"]`));
			push("tabbar-nav", { ...m, target });
			console.log(`[tabbar-nav] rep ${i + 1} -> ${target}:`, fmt(m));
		}
		await gotoFolder("folder-1", 30);

		// 3) open the subfolder tile from the grid (folder-4 inside folder-1)
		for (let i = 0; i < REPS; i += 1) {
			const m = await measureProfiled(page, () => page.click('[data-marquee-id="folder-4"]'));
			push("open-folder-grid", m);
			console.log(`[open-folder-grid] rep ${i + 1}:`, fmt(m));
			await gotoFolder("folder-1", 30);
		}

		await context.close();
	} finally {
		if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
	}

	// ---------- aggregates: sum self/total hits per function across reps ----------
	const aggregates = {};
	for (const [label, runs] of Object.entries(results)) {
		const selfSum = new Map();
		const totalSum = new Map();
		const subSum = new Map();
		const nativeSum = new Map();
		let gapSamples = 0;
		let harnessSamples = 0;
		for (const r of runs) {
			for (const t of r.attribution?.topSelf ?? [])
				selfSum.set(t.fn, (selfSum.get(t.fn) ?? 0) + t.samples);
			for (const t of r.attribution?.topTotal ?? [])
				totalSum.set(t.fn, (totalSum.get(t.fn) ?? 0) + t.samples);
			for (const s of r.attribution?.subtrees ?? [])
				subSum.set(s.subtree, (subSum.get(s.subtree) ?? 0) + s.samples);
			for (const n of r.attribution?.nativeInitiators ?? [])
				nativeSum.set(n.fn, (nativeSum.get(n.fn) ?? 0) + n.samples);
			gapSamples += r.attribution?.samplesInGap ?? 0;
			harnessSamples += r.attribution?.harnessSamplesInGap ?? 0;
		}
		const toMs = (h) => Math.round(h * 0.2 * 10) / 10;
		aggregates[label] = {
			reps: runs.length,
			gapWidthMsMedian: median(runs.map((r) => r.gap?.width ?? null)),
			windowMsMedian: median(runs.map((r) => r.windowMs)),
			gapSamplesMedian: median(runs.map((r) => r.attribution?.samplesInGap ?? null)),
			gapSamplesTotal: gapSamples,
			harnessSamplesTotal: harnessSamples,
			harnessPctOfGap: gapSamples
				? Math.round((harnessSamples / gapSamples) * 1000) / 10
				: 0,
			nativeInitiatorsAgg: [...nativeSum.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([fn, hits]) => ({ fn, samples: hits, selfMs: toMs(hits) })),
			topSelfAgg: [...selfSum.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 20)
				.map(([fn, hits]) => ({ fn, selfMs: toMs(hits), samples: hits })),
			topTotalAgg: [...totalSum.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([fn, hits]) => ({ fn, totalMs: toMs(hits), samples: hits })),
			subtreesAgg: [...subSum.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([subtree, hits]) => ({
					subtree,
					samples: hits,
					pct: gapSamples ? Math.round((hits / gapSamples) * 1000) / 10 : 0,
				})),
		};
	}

	const file = saveResults(`transition-cpuprofile${SUFFIX}.json`, {
		date: new Date().toISOString(),
		note: "CPU-profile attribution of the dominant inter-commit gap. Function names are readable only on the unminified throwaway build; gap/window timings from such runs are NOT canonical (canonical timings: minified transition-timeline medians).",
		aggregates,
		raw: results,
	});
	console.log("\n=== AGGREGATES ===");
	console.log(JSON.stringify(aggregates, null, 2));
	console.log("saved:", file);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
