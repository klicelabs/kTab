/**
 * Frente B — transition timeline: decompose the user-reported 400-750ms
 * interaction windows (open Preferences, close Preferences, tabbar folder
 * nav, open folder from grid, Back) into input -> commit1 -> commitN ->
 * settle, with rAF-watchdog blocking chunks (>16ms) and per-component
 * re-render counts inside the window.
 *
 * Uses the shared TIMELINE_SCRIPT (bench-lib): trusted pointerdown/keydown
 * capture marks anchor the input instant; every React commit is logged with
 * timestamp + PerformedWork fiber count + component names; the rAF watchdog
 * records frame gaps >16ms (JS animation frames ~8ms are NOT gaps).
 *
 * Window slicing per rep (page world, post-settle):
 *   inputT  = first input mark after the pre-gesture snapshot (trusted event)
 *   commit1 = first commit at/after inputT        commitN = last such commit
 *   settle  = LAST ACTIVITY timestamp in the window (commit t, gap end,
 *             storage.set t, longtask end) — NOT the quiet-detection
 *             deadline, so commitNToSettle is real trailing work, not the
 *             250ms quiet margin used to detect settle.
 *   blockedMs = sum of frame-gap overlaps with [inputT, settle]
 *
 * The decisive read:
 *   one big commit + large blockedMs  => single expensive render pass
 *   many small commits, small spacing => state-update cascade
 *
 * Names are minified against the production build; run with the unminified
 * throwaway build (perf/probe-rerender-sourcemap, minify:false) and a
 * filename suffix for component identity. Timings cited in the report come
 * from the minified (production) build.
 *
 * Run: node scripts/bench-transition-timeline.mjs [reps=3] [suffix]
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
// window + real GPU instead of headless software raster, to test whether
// the (idle)-heavy inter-commit gap is partly a headless artifact.
// Usage: node scripts/bench-transition-timeline.mjs 3 headed --headed
const HEADED = process.argv.includes("--headed");
const POSITIONAL = process.argv.slice(2).filter((a) => a !== "--headed");
const REPS = Number(POSITIONAL[0] ?? 3) || 3;
const SUFFIX = POSITIONAL[1] ? `-${POSITIONAL[1]}` : "";

// ---------------------------------------------------------------------------
// page-world helpers
// ---------------------------------------------------------------------------

/** Pre-gesture snapshot: counters + dispatch time (page clock). */
const SNAPSHOT = () => {
	const r = window.__ktabTimeline;
	return {
		commits: r.commitLog.length,
		gaps: r.gaps.length,
		dT: performance.now(),
	};
};

/** Wait until the window is quiet: >=120ms after dispatch, some new activity
 * (commit or gap), then 250ms without any new activity. A gesture that
 * produced zero commits AND zero gaps is accepted after 2.5s (honest
 * zero-activity reading instead of a hang). */
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

/** Slice [inputT, settle] out of the timeline record and derive the metrics. */
async function extractWindow(page, pre) {
	return page.evaluate((pre) => {
		const r = window.__ktabTimeline;
		// Time-based lookup (NOT index-based): the inputMarks ring buffer shifts
		// once past its cap, which would misalign pre-snapshot indexes. The
		// gesture's first mark is the earliest mark at/after the snapshot time.
		const inMark = r.inputMarks.find((m) => m.t >= pre.dT - 2) ?? null;
		const inputT = inMark ? inMark.t : null;
		const t0 = inputT ?? -1e9;
		const commits = r.commitLog.filter((c) => c.t >= t0 - 1);
		const first = commits[0] ?? null;
		const last = commits[commits.length - 1] ?? null;

		let settle = inputT ?? 0;
		for (const c of commits) settle = Math.max(settle, c.t);
		for (const g of r.gaps)
			if (g.start + g.dur > t0) settle = Math.max(settle, g.start + g.dur);
		for (const lt of r.longTasks)
			if (lt.t + lt.dur > t0) settle = Math.max(settle, lt.t + lt.dur);
		for (const s of r.storageSets) if (s.t > t0) settle = Math.max(settle, s.t);
		settle = Math.round(settle);

		const gaps = [];
		for (const g of r.gaps) {
			const end = g.start + g.dur;
			if (end > t0 && g.start < settle) {
				gaps.push({
					start: Math.round(Math.max(g.start, t0) - t0),
					dur: g.dur,
					overlapMs: Math.round(Math.min(end, settle) - Math.max(g.start, t0)),
				});
			}
		}
		const lts = r.longTasks.filter((lt) => lt.t >= t0 - 20 && lt.t < settle);
		const blockedMs = gaps.reduce((a, g) => a + g.overlapMs, 0);

		const nameAgg = new Map();
		let fibers = 0;
		for (const c of commits) {
			fibers += c.fibers;
			for (const [n, cnt] of c.names ?? [])
				nameAgg.set(n, (nameAgg.get(n) ?? 0) + cnt);
		}
		const spacing = commits.slice(1).map((c, i) => Math.round(c.t - commits[i].t));

		return {
			inputType: inMark ? inMark.type : null,
			inputDetected: inputT != null,
			commits: commits.length,
			inputToCommit1Ms:
				first && inputT != null ? Math.round(first.t - inputT) : null,
			commit1ToCommitNMs:
				first && last ? Math.round(last.t - first.t) : commits.length === 1 ? 0 : null,
			commitNToSettleMs: last ? Math.round(settle - last.t) : null,
			windowMs: inputT != null ? Math.round(settle - inputT) : null,
			blockedMs,
			maxGapMs: gaps.reduce((a, g) => Math.max(a, g.overlapMs), 0),
			gapCount: gaps.length,
			commitSpacingMs: spacing,
			fibersTotal: fibers,
			storageSets: r.storageSets.filter((s) => s.t > t0 && s.t <= settle).length,
			longTasks50: lts.map((lt) => ({ at: Math.round(lt.t - t0), dur: lt.dur })),
			topNames: [...nameAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
		};
	}, pre);
}

/** One measured interaction: snapshot -> trusted gesture -> quiet -> slice. */
async function measure(page, gesture) {
	const pre = await page.evaluate(SNAPSHOT);
	await gesture();
	const quiet = await waitQuiet(page, pre);
	const out = await extractWindow(page, pre);
	return { quietDetected: quiet, ...out };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

// PROBE glass-transition (Front C): SEED_MODE selects the folder-2 content
// to correlate gap size with freshly-mounted glass surfaces.
//   default: stock seed (folder-2 = 12 site cards, no glass)
//   seedA:   folder-2 = 30 SITE cards (0 new glass surfaces on nav)
//   seedB:   folder-2 = 30 SUBFOLDERS (30 new glass folder-cards on nav)
// folder-1 (reset state, 30 cards + folder-4) and folder-3 are untouched.
// Usage: SEED_MODE=seedA node scripts/bench-transition-timeline.mjs 3 seedA
function buildSeedVariant() {
	const mode = process.env.SEED_MODE ?? "default";
	const seed = buildInteractionSeed();
	if (mode !== "seedA" && mode !== "seedB") return { seed, mode };
	// Strip folder-2's stock 12 site cards; folder-1/3 untouched.
	seed.state.cards = seed.state.cards.filter((c) => c.folderId !== "folder-2");
	if (mode === "seedA") {
		seed.state.itemOrder["folder-2"] = [];
		for (let c = 0; c < 30; c += 1) {
			const id = `card-sA-${c + 1}`;
			seed.state.cards.push({
				id,
				folderId: "folder-2",
				title: `Site A${c + 1}`,
				url: `https://example.com/a${c + 1}`,
				favicon: null,
				thumbId: null,
				order: c,
				titleSource: null,
				origin: "local",
				capturedAt: null,
			});
			seed.state.itemOrder["folder-2"].push(`card:${id}`);
		}
	} else {
		seed.state.itemOrder["folder-2"] = [];
		for (let c = 0; c < 30; c += 1) {
			const id = `sf-${c + 1}`;
			seed.state.folders.push({
				id,
				name: `Glass ${c + 1}`,
				order: c,
				parentId: "folder-2",
			});
			seed.state.itemOrder["folder-2"].push(`folder:${id}`);
			seed.state.itemOrder[id] = [];
		}
	}
	return { seed, mode };
}

async function main() {
	const { seed, mode } = buildSeedVariant();
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
			results[label].push(m);
		};
		const activeIs =
			(id) =>
			() =>
				document.querySelector("[data-active-folder-id]")?.getAttribute("data-active-folder-id") === id;
		const settingsClosed = () =>
			document.querySelector('[data-settings-open="true"]') === null;

		/** Unmeasured reset: switch folder via tabbar and let it settle. */
		async function gotoFolder(id, cards) {
			await page.click(`[data-tab-id="${id}"]`);
			if (cards) await waitForGrid(page, cards, 8000).catch(() => {});
			await page.waitForFunction(activeIs(id), null, { timeout: 8000 }).catch(() => {});
			await page.waitForTimeout(350);
		}

		// 1+2) open / close Preferences (alternating; each starts settled)
		for (let i = 0; i < REPS; i += 1) {
			const open = await measure(page, () => page.click('[aria-label="Settings"]'));
			push("open-preferences", open);
			const close = await measure(
				page,
				async () => {
					const closeBtn = page.locator('[aria-label="Close preferences"]');
					if (await closeBtn.count()) await closeBtn.first().click();
					else await page.keyboard.press("Escape");
				},
			);
			push("close-preferences", close);
			console.log(
				`[open-preferences] rep ${i + 1}:`,
				fmt(open),
				`closed=${await page.evaluate(settingsClosed)}`,
			);
			console.log(`[close-preferences] rep ${i + 1}:`, fmt(close));
		}
		await gotoFolder("folder-1", 30);

		// 3) tabbar navigation (folder-2 -> folder-3 -> folder-1)
		const tabSeq = ["folder-2", "folder-3", "folder-1"];
		for (let i = 0; i < REPS; i += 1) {
			const target = tabSeq[i % tabSeq.length];
			const m = await measure(page, () => page.click(`[data-tab-id="${target}"]`));
			push("tabbar-nav", { ...m, target });
			console.log(`[tabbar-nav] rep ${i + 1} -> ${target}:`, fmt(m));
		}
		await gotoFolder("folder-1", 30);

		// 4) open the subfolder tile from the grid (folder-4 inside folder-1)
		for (let i = 0; i < REPS; i += 1) {
			const m = await measure(page, () => page.click('[data-marquee-id="folder-4"]'));
			push("open-folder-grid", m);
			console.log(`[open-folder-grid] rep ${i + 1}:`, fmt(m));
			await gotoFolder("folder-1", 30);
		}

		// 5) Back (toolbar history button) from the opened subfolder
		for (let i = 0; i < REPS; i += 1) {
			await page.click('[data-marquee-id="folder-4"]');
			await page.waitForFunction(activeIs("folder-4"), null, { timeout: 8000 }).catch(() => {});
			await page.waitForTimeout(350);
			const m = await measure(page, () => page.click('[aria-label="Back"]'));
			push("back", m);
			console.log(`[back] rep ${i + 1}:`, fmt(m));
		}

		await context.close();
	} finally {
		if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
	}

	// ---------- medians ----------
	const medians = {};
	for (const [label, runs] of Object.entries(results)) {
		medians[label] = {
			reps: runs.length,
			windowMs: median(runs.map((r) => r.windowMs)),
			inputToCommit1Ms: median(runs.map((r) => r.inputToCommit1Ms)),
			commit1ToCommitNMs: median(runs.map((r) => r.commit1ToCommitNMs)),
			commitNToSettleMs: median(runs.map((r) => r.commitNToSettleMs)),
			commits: median(runs.map((r) => r.commits)),
			blockedMs: median(runs.map((r) => r.blockedMs)),
			maxGapMs: median(runs.map((r) => r.maxGapMs)),
			fibersTotal: median(runs.map((r) => r.fibersTotal)),
			quietDetectedAll: runs.every((r) => r.quietDetected),
			inputDetectedAll: runs.every((r) => r.inputDetected),
		};
	}

	const file = saveResults(`transition-timeline${SUFFIX}.json`, {
		date: new Date().toISOString(),
		note: SUFFIX
			? `Suffix "${SUFFIX.slice(1)}" run — see script header for what the suffix denotes.`
			: "Canonical run against the production (minified) build.",
		seedMode: mode,
		headed: HEADED,
		medians,
		raw: results,
	});
	console.log("\n=== MEDIANS ===");
	console.log(JSON.stringify(medians, null, 2));
	console.log("saved:", file);
}

function fmt(m) {
	return (
		`in→c1=${m.inputToCommit1Ms ?? "-"}ms ` +
		`c1→cN=${m.commit1ToCommitNMs ?? "-"}ms(${m.commits}c) ` +
		`cN→settle=${m.commitNToSettleMs ?? "-"}ms ` +
		`window=${m.windowMs ?? "-"}ms ` +
		`blocked=${m.blockedMs}ms ` +
		`maxGap=${m.maxGapMs}ms ` +
		`fibers=${m.fibersTotal}`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
