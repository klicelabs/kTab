/**
 * Drag event storm / write coalescing benchmark for the kTab newtab.
 *
 * The grid DnD uses native HTML5 drag (draggable + onDragOver). During a
 * native drag the browser replaces pointermove with the drag event stream,
 * so the flood candidate is `dragover`, which fires at input frequency over
 * whatever cell is under the cursor. Handlers apply "live reorder" writes to
 * the store on every target/zone change (hover-applied reorders are real
 * persisted state), guarded by a lastApplied stamp and functional setState.
 *
 * Questions measured per drag distance (1 / 4 / 12 cells crossed):
 *   1. Do React commits track target changes (guarded, ~cells crossed) or
 *      raw dragover count (unguarded storm)?
 *   2. Does a finer pointer path (steps 60 -> 200, many more dragover
 *      events) change the commit count? If not, handler cost is amortized.
 *   3. Does chrome.storage.local.set coalesce all hover reorders into one
 *      trailing write (>= 200ms after the last reorder), never a per-change
 *      write storm during the gesture?
 *   4. Where does drag CPU time go (CDP sampling profile, top functions)?
 *
 * Every rep starts from the same grid geometry (row-major cell 0 -> cell k),
 * ids may differ between reps because hover reorders persist.
 *
 * Run: node scripts/bench-pointer-storm.mjs [reps=3]
 */
import {
	launchExtension,
	buildSeed,
	openNewtab,
	waitForGrid,
	startCpuProfile,
	saveResults,
} from "./bench-lib.mjs";

const REPS = Number(process.argv[2] ?? 3) || 3;

/** Counts the native drag event stream on the window (capture phase). */
const DRAG_STATS_SCRIPT = `
(() => {
  const s = {
    dragstart: 0, dragover: 0, dragleave: 0, drop: 0, dragend: 0,
    pointermove: 0, firstOverAt: null, lastOverAt: null,
    dragstartAt: null, dragendAt: null,
  };
  window.__dragStats = s;
  const stamp = (type) => {
    s[type] += 1;
    const t = performance.now();
    if (type === "dragover") {
      if (s.firstOverAt === null) s.firstOverAt = t;
      s.lastOverAt = t;
    }
    if (type === "dragstart") s.dragstartAt = t;
    if (type === "dragend") s.dragendAt = t;
  };
  for (const type of ["dragstart", "dragover", "dragleave", "drop", "dragend"]) {
    window.addEventListener(type, () => stamp(type), { capture: true });
  }
  window.addEventListener("pointermove", () => { s.pointermove += 1; }, { capture: true, passive: true });
})();
`;

/** Same dataset shape as the interactions bench: folder-1 with 30 cards. */
function buildInteractionSeed() {
	const cards = [];
	const folders = [
		{ id: "folder-1", name: "Folder 1", order: 0, parentId: null },
		{ id: "folder-2", name: "Folder 2", order: 1, parentId: null },
		{ id: "folder-3", name: "Folder 3", order: 2, parentId: null },
	];
	const itemOrder = {
		__root__: ["folder:folder-1", "folder:folder-2", "folder:folder-3"],
		"folder-1": [],
		"folder-2": [],
		"folder-3": [],
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

/** Row-major grid cell centers (viewport coordinates). */
async function cellCenters(page) {
	return page.evaluate(() => {
		const cells = [...document.querySelectorAll('[data-marquee-id^="card-"]')];
		const rects = cells.map((el) => {
			const r = el.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		});
		rects.sort((a, b) => a.y - b.y || a.x - b.x);
		return rects;
	});
}

/** Scripted pointer drag (Playwright mouse = trusted native events). */
async function pointerDrag(page, from, to, { steps = 60, holdMs = 120 } = {}) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.waitForTimeout(holdMs);
	await page.mouse.move(to.x, to.y, { steps });
	await page.waitForTimeout(80);
	await page.mouse.up();
}

/**
 * One measured drag: arm recorder + FPS, drag, then hold long enough for
 * the 200ms storage coalescing window to flush and be captured.
 */
async function measureDrag(page, from, to, { steps = 60 } = {}) {
	await page.evaluate(() => {
		const r = window.__ktabBench;
		const s = window.__dragStats;
		r.reset();
		r.enabled = true;
		r.startedAt = performance.now();
		if (s) {
			s.dragstart = 0; s.dragover = 0; s.dragleave = 0;
			s.drop = 0; s.dragend = 0; s.pointermove = 0;
			s.firstOverAt = null; s.lastOverAt = null;
			s.dragstartAt = null; s.dragendAt = null;
		}
		r.startFps();
	});
	const t0 = performance.now();
	await pointerDrag(page, from, to, { steps });
	await page.waitForTimeout(900); // coalescing flush (200ms) + settle
	const durationMs = Math.round(performance.now() - t0);
	return page.evaluate((durMs) => {
		const r = window.__ktabBench;
		const s = window.__dragStats;
		r.enabled = false;
		r.endedAt = performance.now();
		const fps = r.stopFps();
		const t0 = r.startedAt;
		return {
			durationMs: durMs,
			dragEvents: {
				dragstart: s.dragstart,
				dragover: s.dragover,
				dragleave: s.dragleave,
				drop: s.drop,
				dragend: s.dragend,
				pointermove: s.pointermove,
			},
			commits: r.commits,
			performedWork: r.performedWork,
			topComponents: [...r.components.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 6),
			storageSets: r.storageSets.map((w) => ({
				atMs: Math.round(w.t - t0),
				bytes: w.bytes,
			})),
				longTasks: r.longTasks,
				fps,
			};
	}, durationMs);
}

async function main() {
	const seed = buildInteractionSeed();
	const { context, extensionId } = await launchExtension();
	const page = await openNewtab(context, extensionId, { seed });
	await page.addInitScript(DRAG_STATS_SCRIPT);
	await page.setViewportSize({ width: 1600, height: 900 });

	// DRAG_STATS_SCRIPT registers on the next navigation; seed reload covers it.
	await page.reload({ waitUntil: "load" });
	await waitForGrid(page, 13, 20000);
	await page.waitForTimeout(300);

	// Drag conditions: from row-major cell 0 to cell k (k-1 targets crossed).
	const conditions = [
		{ name: "drag-1cell", cellIndex: 1, steps: 60 },
		{ name: "drag-4cells", cellIndex: 4, steps: 60 },
		{ name: "drag-12cells", cellIndex: 12, steps: 60 },
		// Same distance as drag-12cells but a much finer pointer path:
		// ~3x more dragover events for the same target changes.
		{ name: "drag-12cells-fine", cellIndex: 12, steps: 200 },
	];

	const results = {};
	const profiles = {};
	for (const cond of conditions) {
		results[cond.name] = [];
		const cpu = await startCpuProfile(page);
		for (let i = 0; i < REPS; i += 1) {
			const cells = await cellCenters(page);
			if (cells.length < cond.cellIndex + 1) {
				throw new Error(`${cond.name}: only ${cells.length} cells visible`);
			}
			const from = cells[0];
			const to = cells[cond.cellIndex];
			const m = await measureDrag(page, from, to, { steps: cond.steps });
			results[cond.name].push(m);
		}
		profiles[cond.name] = await cpu.stop();
		const first = results[cond.name][0];
		console.log(
			cond.name,
			JSON.stringify({
				dragover: first.dragEvents.dragover,
				commits: first.commits,
				performedWork: first.performedWork,
				writes: first.storageSets.length,
				avgFps: first.fps.avgFps,
			}),
		);
	}

	await context.close();

	// ---------- per-condition medians + storm analysis ----------
	const medOf = (arr) => {
		const s = [...arr].sort((a, b) => a - b);
		return s.length % 2
			? s[(s.length - 1) / 2]
			: (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
	};

	const summary = {};
	for (const [name, runs] of Object.entries(results)) {
		const writeDelays = runs.flatMap((r) =>
			r.storageSets.map((w) => {
				const end = r.dragEvents.dragend;
				return { atMs: w.atMs, duringGesture: end === 0 || w.atMs <= r.durationMs - 900 + 80 };
			}),
		);
		summary[name] = {
			reps: runs.length,
			dragoverMedian: Math.round(medOf(runs.map((r) => r.dragEvents.dragover))),
			pointermoveMedian: Math.round(medOf(runs.map((r) => r.dragEvents.pointermove))),
			commitsMedian: Math.round(medOf(runs.map((r) => r.commits))),
			performedWorkMedian: Math.round(medOf(runs.map((r) => r.performedWork))),
			writesMedian: Math.round(medOf(runs.map((r) => r.storageSets.length))),
			writeTimesMs: writeDelays.map((w) => w.atMs),
			avgFpsMedian: Math.round(medOf(runs.map((r) => r.fps.avgFps)) * 10) / 10,
			longTasksTotal: runs.reduce((a, r) => a + r.longTasks.length, 0),
		};
	}

	// Storm verdict: commits should scale with target changes (condition
	// cell distance), NOT with dragover count (fine path adds ~3x events).
	const coarse = summary["drag-12cells"];
	const fine = summary["drag-12cells-fine"];
	const verdict = {
		dragoverEventsX: Math.round((fine.dragoverMedian / Math.max(1, coarse.dragoverMedian)) * 10) / 10,
		commitsX: Math.round((fine.commitsMedian / Math.max(1, coarse.commitsMedian)) * 10) / 10,
		commitsTrackTargets: fine.commitsMedian <= coarse.commitsMedian * 1.25,
		oneWritePerDrag: Object.values(summary).every((s) => s.writesMedian <= 2),
	};

	const file = saveResults("pointer-storm.json", {
		date: new Date().toISOString(),
		reps: REPS,
		summary,
		verdict,
		profiles: Object.fromEntries(
			Object.entries(profiles).map(([k, p]) => [
				k,
				{ totalSelfMs: Math.round(p.totalSelfMs), top: p.top.slice(0, 10) },
			]),
		),
		raw: results,
	});
	console.log("\n=== SUMMARY ===");
	console.log(JSON.stringify(summary, null, 2));
	console.log("=== STORM VERDICT ===");
	console.log(JSON.stringify(verdict, null, 2));
	console.log("saved:", file);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
