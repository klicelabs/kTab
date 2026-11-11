/** Real Chromium regression coverage for selection ownership and scroll.
 * Run after build: HEADFUL=1 node scripts/verify-selection-scroll-e2e.mjs
 * Seeds a throwaway profile; screenshots go to TEMP, not the repository.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildSeed, launchExtension, openNewtab } from "./bench-lib.mjs";

const { context, extensionId, userDataDir } = await launchExtension({
	headless: process.env.HEADFUL !== "1",
});
const errors = [];
let checks = 0;
const check = (name, fn) =>
	Promise.resolve()
		.then(fn)
		.then(() => {
			checks++;
			console.log(`PASS ${name}`);
		});
try {
	const seed = buildSeed({ cardsPerFolder: 80, folders: 2 });
	const page = await openNewtab(context, extensionId, { seed });
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.waitForSelector('[data-marquee-id="card-80"]');
	// Hit testing starts after the initial CSS wake, not while its geometry moves.
	await page.evaluate(() =>
		Promise.allSettled(
			document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().iterations !==
						Number.POSITIVE_INFINITY,
				)
				.map((animation) => animation.finished),
		),
	);
	const cell = (id) => page.locator(`[data-marquee-id="card-${id}"]`);
	const checkbox = (id) => cell(id).getByRole("checkbox");
	const checkboxWrap = (id) =>
		cell(id).locator("[data-selection-checkbox]");
	const selected = () =>
		page.locator('.dial-grid .dial-card[data-selected="true"]').count();
	const scroller = page.locator("[data-speed-dial-scroll]");
	await check(
		"contextual checkbox is a sibling, not a link descendant",
		async () => {
			await cell(1).hover();
			assert.equal(await checkboxWrap(1).evaluate(el => getComputedStyle(el).opacity), "0");
			await checkbox(1).focus();
			assert.equal(
				await checkbox(1).evaluate((el) => el.closest("a") === null),
				true,
			);
			const geometry = await checkbox(1).evaluate((el) => {
				const rect = el.getBoundingClientRect();
				const hitArea = getComputedStyle(el, "::after");
				return {
					width: rect.width,
					height: rect.height,
					hitWidth: Number.parseFloat(hitArea.width),
					hitHeight: Number.parseFloat(hitArea.height),
					expandedHit:
						document.elementFromPoint(rect.left - 4, rect.top + 10) === el,
				};
			});
			assert.deepEqual(geometry, {
				width: 20,
				height: 20,
				hitWidth: 32,
				hitHeight: 32,
				expandedHit: true,
			});
			await checkbox(1).click({ timeout: 5000 });
			assert.equal(await selected(), 1);
		},
	);
	await check("Shift checkbox selects an ordered range", async () => {
		await checkbox(4).click({ modifiers: ["Shift"] });
		assert.equal(await selected(), 4);
	});
	await check(
		"Ctrl, plain click and Ctrl+Shift share checkbox semantics",
		async () => {
			const pagesBefore = context.pages().length;
			await cell(2)
				.locator("a")
				.click({ modifiers: ["Control"] });
			assert.equal(await selected(), 3);
			await cell(2).locator("a").click();
			assert.equal(await selected(), 4);
			await cell(6)
				.locator("a")
				.click({ modifiers: ["Control", "Shift"] });
			assert.equal(await selected(), 6);
			await checkbox(5).click();
			await checkbox(6).click();
			assert.equal(await selected(), 4);
			assert.equal(context.pages().length, pagesBefore);
		},
	);
	await check("wheel scroll preserves selected IDs and toolbar", async () => {
		await page.mouse.move(1100, 650);
		await page.mouse.wheel(0, 650);
		await page.waitForFunction(
			() => document.querySelector("[data-speed-dial-scroll]").scrollTop > 300,
		);
		assert.equal(await selected(), 4);
		assert.equal(await page.locator("[data-selection-tray]").count(), 1);
	});
	await check("native scrollbar press is not a blank clear", async () => {
		await scroller.evaluate((el) => el.classList.remove("scrollbar-hidden"));
		const hasGutter = await scroller.evaluate(
			(el) => el.offsetWidth > el.clientWidth,
		);
		if (hasGutter) {
			// Real classic-scrollbar geometry: a press inside the gutter must
			// never clear the carried selection.
			const bounds = await scroller.boundingBox();
			await page.mouse.click(bounds.x + bounds.width - 2, bounds.y + 120);
		} else {
			// Headless/overlay scrollbars own no layout gutter in Chromium, so
			// assert the same veto through the exact press geometry the listener
			// guards: a pointerdown beyond the scroll viewport's client edge.
			await scroller.evaluate((el) => {
				const r = el.getBoundingClientRect();
				el.dispatchEvent(
					new PointerEvent("pointerdown", {
						bubbles: true,
						pointerType: "mouse",
						button: 0,
						clientX: r.left + el.clientLeft + el.clientWidth + 2,
						clientY: r.top + 120,
					}),
				);
			});
		}
		await page.mouse.waitForLoadState?.("idle").catch?.(() => undefined);
		assert.equal(await selected(), 4);
		await scroller.evaluate((el) => el.classList.add("scrollbar-hidden"));
	});
	await page.keyboard.press("Escape");
	await scroller.evaluate((el) => {
		el.scrollTop = 0;
	});
	await check(
		"keyboard Space enters selection; Enter still opens a card",
		async () => {
			const link = cell(1).locator("a");
			await link.focus();
			await page.keyboard.press("Space");
			assert.equal(await selected(), 1);
			const popupPromise = page.waitForEvent("popup");
			await page.keyboard.press("Enter");
			const popup = await popupPromise;
			await popup.close();
			assert.equal(await selected(), 1);
			await checkbox(1).focus();
			await page.keyboard.press("Space");
			assert.equal(await selected(), 0);
		},
	);
	await check(
		"marquee keeps crossed IDs after stationary-pointer scroll",
		async () => {
			const first = await cell(1).boundingBox();
			const second = await cell(2).boundingBox();
			await page.mouse.move(first.x - 8, first.y - 8);
			await page.mouse.down();
			await page.mouse.move(
				second.x + second.width - 8,
				second.y + second.height - 8,
				{ steps: 12 },
			);
			await page.waitForFunction(
				() =>
					document.querySelectorAll('.dial-card[data-selected="true"]')
						.length >= 2,
			);
			const crossedIds = await page
				.locator('.dial-card[data-selected="true"]')
				.evaluateAll((els) =>
					els.map((el) => el.closest("[data-marquee-id]").dataset.marqueeId),
				);
			await scroller.evaluate((el) => {
				el.scrollTop = 650;
			});
			await page.waitForFunction(
				() =>
					document.querySelector("[data-speed-dial-scroll]").scrollTop >= 650,
			);
			await page.mouse.move(
				second.x + second.width - 7,
				second.y + second.height - 8,
			);
			await page.mouse.up();
			for (const id of crossedIds)
				assert.equal(
					await page
						.locator(`[data-marquee-id="${id}"] .dial-card`)
						.getAttribute("data-selected"),
					"true",
				);
			assert.equal(await page.locator(".marquee-box").count(), 0);
		},
	);
	await check(
		"keyboard activation of tray preview opens Move to dialog",
		async () => {
			await page.locator("[data-tray-drag-handle]").focus();
			await page.keyboard.press("Enter");
			await page.getByRole("dialog").waitFor();
			await page.keyboard.press("Escape");
		},
	);
	await check("selection carries across folder navigation", async () => {
		const count = await selected();
		await page.getByRole("tab", { name: "Folder 2" }).click();
		await page.getByRole("tab", { name: "Folder 1" }).click();
		await cell(1).waitFor();
		assert.equal(await selected(), count);
	});
	await scroller.evaluate((el) => {
		el.scrollTop = 0;
	});
	const screenshotDir = fs.mkdtempSync(
		path.join(process.env.TEMP ?? "/tmp", "ktab-selection-polish-"),
	);
	await page.screenshot({
		path: path.join(screenshotDir, "desktop-selected.png"),
	});
	await page.setViewportSize({ width: 900, height: 700 });
	await page.screenshot({
		path: path.join(screenshotDir, "compact-selected.png"),
	});
	await page.emulateMedia({ reducedMotion: "reduce" });
	await check("reduced motion keeps selection controls reachable", async () => {
		await checkbox(1).focus();
		assert.equal(
			await checkboxWrap(1).evaluate((el) => getComputedStyle(el).opacity),
			"1",
		);
		assert.equal(
			await page
				.locator(																																							"a [data-selection-checkbox], button [data-selection-checkbox]",

				)
				.count(),
			0,
		);
	});
	await check(
		"group drag still moves the selected IDs to another folder",
		async () => {
			const ids = await page
				.locator('.dial-card[data-selected="true"]')
				.evaluateAll((els) =>
					els.map((el) => el.closest("[data-marquee-id]").dataset.marqueeId),
				);
			await cell(1)
				.locator("a")
				.dragTo(page.getByRole("tab", { name: "Folder 2" }));
			await page.waitForFunction(async (selectedIds) => {
				const raw = await chrome.storage.local.get("perch-setup");
				const cards = JSON.parse(raw["perch-setup"]).state.cards;
				return selectedIds.every(
					(id) => cards.find((card) => card.id === id)?.folderId === "folder-2",
				);
			}, ids);
			await page
				.locator("[data-selection-tray]")
				.waitFor({ state: "detached" });
			assert.equal(await page.locator("[data-selection-tray]").count(), 0);
		},
	);
	assert.deepEqual(errors, []);
	console.log(
		`${checks}/${checks} selection checks passed; screenshots: ${screenshotDir}`,
	);
} finally {
	await context.close();
	fs.rmSync(userDataDir, { recursive: true, force: true });
}
