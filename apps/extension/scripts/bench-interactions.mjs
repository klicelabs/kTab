/**
 * Interaction benchmark for the kTab newtab.
 *
 * Measures per-interaction: wall duration, React commits + PerformedWork
 * fibers, top re-rendered components, chrome.storage.local.set calls, long
 * tasks and raw pointer-event counts. Each interaction runs REPS times
 * (default 3); the report prints per-rep values plus the median.
 *
 * Dataset: 3 root folders; folder-1 holds 30 cards + 1 subfolder (for
 * marquee 3/10/20 and open-folder); folder-2/3 hold 12 cards each (tabbar
 * navigation). Starts at root view.
 *
 * Run: node scripts/bench-interactions.mjs [reps=3]
 */
import {
	launchExtension,
	buildInteractionSeed,
	openNewtab,
	waitForGrid,
	measureInteraction,
	openPreferences,
	closeSettings,
	saveResults,
} from "./bench-lib.mjs";

const REPS = Number(process.argv[2] ?? 3) || 3;

/** Center of an element's bounding rect (page coordinates). */
async function centerOf(page, selector) {
	return page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	}, selector);
}

/** Scripted pointer drag (Playwright mouse = real trusted events). */
async function pointerDrag(page, from, to, { steps = 40, holdMs = 120 } = {}) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.waitForTimeout(holdMs);
	await page.mouse.move(to.x, to.y, { steps });
	await page.waitForTimeout(80);
	await page.mouse.up();
}

async function main() {
	const seed = buildInteractionSeed();
	const { context, extensionId } = await launchExtension();
	const page = await openNewtab(context, extensionId, { seed });
	await waitForGrid(page, 3, 20000); // folder-1 tab + cards start rendering
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.waitForTimeout(300);

	const results = {};

	// ---------- helpers over page state ----------
	const settingsOpen = () =>
		document.querySelector('[data-settings-open="true"]') !== null;

	async function enterFolder1() {
		// The seed already starts inside folder-1; ensure we're there.
		await page.click('[data-tab-id="folder-1"]').catch(() => {});
		await page.waitForFunction(
			() => document.querySelectorAll('[data-marquee-id^="card-"]').length >= 30,
			null,
			{ timeout: 5000 },
		);
		await page.waitForTimeout(200);
	}
	async function backToFolder1() {
		await page.click('[data-tab-id="folder-1"]');
		await page.waitForFunction(
			() => document.querySelectorAll('[data-marquee-id^="card-"]').length >= 30,
			null,
			{ timeout: 5000 },
		);
		await page.waitForTimeout(200);
	}

	// ============================================================
	// 1) Open Preferences panel
	// ============================================================
	results["open-preferences"] = [];
	for (let i = 0; i < REPS; i += 1) {
		const m = await measureInteraction(
			page,
			async () => {
				await page.click('[aria-label="Settings"]');
			},
			{ settlePredicate: settingsOpen, settleMs: 700 },
		);
		results["open-preferences"].push(m);
		await closeSettings(page);
	}
	console.log("open-preferences:", JSON.stringify(results["open-preferences"][0]));

	// ============================================================
	// Setup: open Preferences once — the root pane embeds theme, accent
	// and material controls (verified by probe; no Appearance nav step).
	// ============================================================
	await openPreferences(page);
	const inAppearance = await page.evaluate(() => {
		return document.body.textContent.includes("Material");
	});
	console.log("preferences root reachable (Material visible):", inAppearance);

	// ============================================================
	// 2) Accent color change (blue → yellow → green → blue)
	// ============================================================
	results["accent-change"] = [];
	const accents = ["Yellow", "Green", "Blue"];
	for (let i = 0; i < REPS; i += 1) {
		const label = accents[i % accents.length];
		const m = await measureInteraction(
			page,
			async () => {
				await page.click(`[aria-label="${label} accent color"]`);
			},
			{ settleMs: 350 },
		);
		results["accent-change"].push({ ...m, accent: label });
	}
	console.log("accent-change:", JSON.stringify(results["accent-change"][0]));

	// ============================================================
	// 3) Material toggle (glass → flat → glass)
	// ============================================================
	results["material-toggle"] = [];
	const matOptions = ["Flat", "Glass", "Flat"];
	for (let i = 0; i < REPS; i += 1) {
		const opt = matOptions[i % matOptions.length];
		const m = await measureInteraction(
			page,
			async () => {
				await page.click(`[aria-label="Material"] [aria-label="${opt}"]`);
			},
			{ settleMs: 350 },
		);
		results["material-toggle"].push({ ...m, target: opt });
	}
	console.log("material-toggle:", JSON.stringify(results["material-toggle"][0]));

	// ============================================================
	// 4) Dark/light toggle
	// ============================================================
	results["dark-light-toggle"] = [];
	const themes = ["light", "dark", "light"];
	for (let i = 0; i < REPS; i += 1) {
		const target = themes[i % themes.length];
		const cap = target === "light" ? "Use light appearance" : "Use dark appearance";
		const m = await measureInteraction(
			page,
			async () => {
				await page.click(`[aria-label="${cap}"]`);
			},
			{ settleMs: 350 },
		);
		results["dark-light-toggle"].push({ ...m, target });
	}
	console.log("dark-light-toggle:", JSON.stringify(results["dark-light-toggle"][0]));
	await closeSettings(page);

	// ============================================================
	// 5) Drag one card inside grid (folder-1, card-1 → right by ~2 cols)
	// ============================================================
	await enterFolder1();
	results["card-drag"] = [];
	for (let i = 0; i < REPS; i += 1) {
		const from = await centerOf(page, '[data-marquee-id="card-1"]');
		const m = await measureInteraction(
			page,
			async () => {
				await pointerDrag(
					page,
					{ x: from.x, y: from.y },
					{ x: from.x + 420, y: from.y },
					{ steps: 60 },
				);
			},
			{ settleMs: 500 },
		);
		results["card-drag"].push(m);
	}
	console.log("card-drag:", JSON.stringify(results["card-drag"][0]));

	// ============================================================
	// 6) Marquee selection 3 / 10 / 20 cards
	// ============================================================
	async function marquee(n) {
		// Marquee engages only when pointerdown lands on the grid wrap itself
		// (not on .dial-cell/a/button — vetoed in interaction-scope). Start in
		// the wrap's left gutter, end over the Nth card (row-major order).
		const geom = await page.evaluate(() => {
			const wrap = document.querySelector(".dial-grid-wrap");
			const cells = [...document.querySelectorAll('[data-marquee-id^="card-"]')];
			if (!wrap || cells.length === 0) return null;
			const wr = wrap.getBoundingClientRect();
			const rects = cells.map((el) => {
				const r = el.getBoundingClientRect();
				return { x: r.x, y: r.y, w: r.width, h: r.height };
			});
			rects.sort((a, b) => a.y - b.y || a.x - b.x);
			return { wrapLeft: wr.left, wrapTop: wr.top, wrapH: wr.height, cards: rects };
		});
		if (!geom) throw new Error("grid geometry unavailable");
		const subset = geom.cards.slice(0, Math.min(n, geom.cards.length));
		const nth = subset[subset.length - 1];
		const minTop = Math.min(...subset.map((c) => c.y));
		const maxBottom = Math.max(...subset.map((c) => c.y + c.h));
		const from = {
			x: geom.wrapLeft + 6,
			y: Math.max(geom.wrapTop + 4, minTop - 10),
		};
		// Right edge = Nth card's centerX: with row-major flow this includes
		// every full row above and exactly the leading columns of the Nth
		// card's row (hit rule: center-in-rect), giving exactly N hits.
		const to = { x: nth.x + nth.w / 2 + 6, y: maxBottom + 6 };
		return measureInteraction(
			page,
			async () => {
				await pointerDrag(page, from, to, { steps: 50, holdMs: 80 });
			},
			{
				settleMs: 300,
				settlePredicate: () => true,
			},
			);
	}
	for (const n of [3, 10, 20]) {
		const key = `marquee-${n}`;
		results[key] = [];
		// Tall viewport so 20+ cards are visible without internal scrolling.
		await page.setViewportSize({ width: 1600, height: 1500 });
		await page.waitForTimeout(250);
		// clear selection between reps via Escape
		for (let i = 0; i < REPS; i += 1) {
			await page.keyboard.press("Escape").catch(() => {});
			await page.waitForTimeout(150);
			const m = await marquee(n);
			const selected = await page.evaluate(
				() => document.querySelectorAll('[data-selected="true"]').length,
			);
			results[key].push({ ...m, selectedAfter: selected });
		}
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.waitForTimeout(250);
		console.log(
			`${key}:`,
			JSON.stringify({
				durationMs: results[key][0].durationMs,
				commits: results[key][0].commits,
				performedWork: results[key][0].performedWork,
				longTasks: results[key][0].longTasks.length,
				selectedAfter: results[key][0].selectedAfter,
			}),
		);
	}

	// ============================================================
	// 7) Open a folder from the grid (folder-4 inside folder-1)
	// ============================================================
	await page.keyboard.press("Escape").catch(() => {});
	await backToFolder1();
	results["open-folder"] = [];
	for (let i = 0; i < REPS; i += 1) {
		const m = await measureInteraction(
			page,
			async () => {
				await page.click('[data-marquee-id="folder-4"]');
			},
			{
				settleMs: 400,
				settlePredicate: () =>
					document.querySelector('[data-active-folder-id]')?.getAttribute("data-active-folder-id") === "folder-4",
				},
		);
		results["open-folder"].push(m);
		if (i < REPS - 1) await backToFolder1();
	}
	console.log("open-folder:", JSON.stringify(results["open-folder"][0]));

	// ============================================================
	// 8) Navigate top folders via tabbar (folder-2 → folder-3 → folder-1)
	// ============================================================
	results["folder-nav"] = [];
	const tabSeq = ["folder-2", "folder-3", "folder-1"];
	for (let i = 0; i < REPS; i += 1) {
		const target = tabSeq[i % tabSeq.length];
		const m = await measureInteraction(
			page,
			async () => {
				await page.click(`[data-tab-id="${target}"]`);
			},
			{ settleMs: 400 },
		);
		results["folder-nav"].push({ ...m, target });
	}
	console.log("folder-nav:", JSON.stringify(results["folder-nav"][0]));

	// ============================================================
	// 9) Edit card title (context menu → Rename → type → Enter)
	// ============================================================
	results["card-rename"] = [];
	for (let i = 0; i < REPS; i += 1) {
		const m = await measureInteraction(
			page,
			async () => {
				await page.click('[data-marquee-id^="card-"]', { button: "right" });
				await page
					.getByRole("menuitem", { name: "Rename" })
					.first()
					.click();
				await page.keyboard.type(`Renamed ${i + 1}`);
				await page.keyboard.press("Enter");
			},
			{ settleMs: 500 },
		);
		results["card-rename"].push(m);
	}
	console.log("card-rename:", JSON.stringify(results["card-rename"][0]));

	// ============================================================
	// 10) Drag folder tab between gaps in the tabbar
	// ============================================================
	results["tab-drag"] = [];
	for (let i = 0; i < REPS; i += 1) {
		const from = await centerOf(page, '[data-tab-id="folder-2"]');
		const m = await measureInteraction(
			page,
			async () => {
				await pointerDrag(
					page,
					{ x: from.x, y: from.y },
					{ x: from.x + 260, y: from.y },
					{ steps: 50 },
				);
			},
			{ settleMs: 500 },
		);
		results["tab-drag"].push(m);
	}
	console.log("tab-drag:", JSON.stringify(results["tab-drag"][0]));

	await context.close();

	// ---------- medians ----------
	const medians = {};
	const medOf = (arr) => {
		const s = [...arr].sort((a, b) => a - b);
		return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
	};
	for (const [key, runs] of Object.entries(results)) {
		medians[key] = {
			reps: runs.length,
			durationMs: Math.round(medOf(runs.map((r) => r.durationMs))),
			pageDurationMs: Math.round(medOf(runs.map((r) => r.pageDurationMs))),
			commits: Math.round(medOf(runs.map((r) => r.commits))),
			performedWork: Math.round(medOf(runs.map((r) => r.performedWork))),
			longTasks: Math.round(medOf(runs.map((r) => r.longTasks.length))),
			storageSets: Math.round(medOf(runs.map((r) => r.storageSets.length))),
			longTaskTotalMs: Math.round(
				medOf(runs.map((r) => r.longTasks.reduce((a, t) => a + t.duration, 0))),
			),
		};
	}

	const file = saveResults("interactions.json", {
		date: new Date().toISOString(),
		medians,
		raw: results,
	});
	console.log("\n=== MEDIANS ===");
	console.log(JSON.stringify(medians, null, 2));
	console.log("saved:", file);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
