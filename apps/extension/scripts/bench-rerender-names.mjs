/**
 * Frente A — which components re-render between commit1 and commit2 on the
 * empty first-run (the hydration re-commit measured at ~145ms by
 * bench-decompose.mjs).
 *
 * Uses the shared TIMELINE_SCRIPT: every commit is logged with a timestamp,
 * its PerformedWork fiber count and the component names flagged by THAT
 * commit (React clears the PerformedWork flag at the start of each render,
 * so walking root.current inside onCommitFiberRoot attributes names to the
 * exact commit that just finished — no aggregate blur across commits).
 *
 * Per empty run (fresh profile, no data — mirrors bench-decompose's empty):
 *   - commit1 / commit2 timestamps and delta (cross-check vs ~145ms baseline)
 *   - top components of commit2 (the hydration re-render)
 *   - top components of commit1 (initial mount, for contrast)
 *   - rAF watchdog gaps inside the startup window (blocking context)
 *
 * NOTE ON NAMES: the production build minifies function names, so fiber
 * names come out minified (Q, E_, ...). The report cites the run against an
 * UNMINIFIED throwaway build (perf/probe-rerender-sourcemap, minify:false)
 * for component identity; counts are identical because re-render behavior
 * does not depend on minification. Timing numbers in the report stay from
 * the minified (production) build.
 *
 * Run: node scripts/bench-rerender-names.mjs [runs=3]
 */
import {
	launchExtension,
	median,
	saveResults,
	TIMELINE_SCRIPT,
} from "./bench-lib.mjs";
import { rmSync } from "node:fs";

const RUNS = Number(process.argv[2] ?? 3) || 3;
const runs = [];

for (let i = 0; i < RUNS; i += 1) {
	const { context, extensionId, userDataDir } = await launchExtension();
	try {
		const page = await context.newPage();
		await page.addInitScript(TIMELINE_SCRIPT);
		await page.goto(`chrome-extension://${extensionId}/newtab.html`, {
			waitUntil: "load",
		});
		// Empty state has no [data-marquee-id] cells, so grid-ready never
		// fires — wait for the second commit (hydration re-render) instead.
		await page
			.waitForFunction(
				() => (window.__ktabTimeline?.commitLog?.length ?? 0) >= 2,
				null,
				{ timeout: 20000 },
			)
			.catch(() => {});
		await page.waitForTimeout(700);

		const run = await page.evaluate(() => {
			const r = window.__ktabTimeline;
			const log = r.commitLog;
			const first = log.length ? log[0].t : 0;
			const last = log.length ? log[log.length - 1].t + 1 : Number.POSITIVE_INFINITY;
			const gaps = r.gaps.filter((g) => g.start >= first && g.start <= last);
			return {
				commits: log.length,
				commit1: log[0] ?? null,
				commit2: log[1] ?? null,
				commit3: log[2] ?? null,
				commitLogTimings: log.map((c) => ({ t: c.t, fibers: c.fibers })),
				gapsInWindow: gaps,
				longTasks: r.longTasks,
				inputMarks: r.inputMarks.length,
			};
		});
		runs.push({ run: i + 1, ...run });
		console.log(
			`[empty] run ${i + 1}: commits=${run.commits}`,
			`c1=${run.commit1?.t} (${run.commit1?.fibers}f)`,
			`c2=${run.commit2?.t} (${run.commit2?.fibers}f)`,
			`delta=${run.commit1 && run.commit2 ? Math.round(run.commit2.t - run.commit1.t) : "-"}ms`,
		);
		console.log("  commit2 top:", JSON.stringify(run.commit2?.names?.slice(0, 10)));
		await page.close();
	} finally {
		await context.close().catch(() => {});
		if (userDataDir) {
			rmSync(userDataDir, { recursive: true, force: true });
		}
	}
}

// --- aggregate: commit2 component names across runs (the hydration re-render) ---
const commit2Aggregate = new Map();
for (const r of runs) {
	for (const [name, count] of r.commit2?.names ?? []) {
		commit2Aggregate.set(name, (commit2Aggregate.get(name) ?? 0) + count);
	}
}
const commit1Aggregate = new Map();
for (const r of runs) {
	for (const [name, count] of r.commit1?.names ?? []) {
		commit1Aggregate.set(name, (commit1Aggregate.get(name) ?? 0) + count);
	}
}
const top = (m, n) =>
	[...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const summary = {
	runs: runs.length,
	commit1ToCommit2Ms: median(
		runs.map((r) =>
			r.commit1 && r.commit2 ? Math.round(r.commit2.t - r.commit1.t) : null,
		),
	),
	commit2Fibers: median(runs.map((r) => r.commit2?.fibers ?? null)),
	commit2Top15Summed: top(commit2Aggregate, 15),
	commit1Top10Summed: top(commit1Aggregate, 10),
	gapsOver16msPerRun: runs.map(
		(r) => r.gapsInWindow?.map((g) => g.dur) ?? [],
	),
};

const file = saveResults("rerender-names.json", {
	date: new Date().toISOString(),
	note: "Names are minified when run against the production build; see perf/probe-rerender-sourcemap throwaway for readable identities.",
	summary,
	raw: runs,
});
console.log("\n=== SUMMARY (empty first-run, commit1 -> commit2) ===");
console.log(JSON.stringify(summary, null, 2));
console.log("saved:", file);
