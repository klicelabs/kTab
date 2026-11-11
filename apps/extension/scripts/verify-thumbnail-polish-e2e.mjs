/** Browser-level visual/motion regression probe, not a capture API test.
 * Drives the real UI using controlled worker progress events and IndexedDB
 * previews. Complements verify-thumbnail-refresh-e2e.mjs (real native capture).
 * Run after build: HEADFUL=1 node scripts/verify-thumbnail-polish-e2e.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildSeed, launchExtension, openNewtab } from "./bench-lib.mjs";

const { context, extensionId } = await launchExtension({
	headless: process.env.HEADFUL !== "1",
});
const screenshots = fs.mkdtempSync(
	path.join(process.env.TEMP ?? "/tmp", "ktab-motion-polish-"),
);
let checks = 0;
const errors = [];
const check = async (name, fn) => {
	await fn();
	console.log(`PASS ${++checks}. ${name}`);
};
try {
	const seed = buildSeed({ cardsPerFolder: 6, folders: 1 });
	seed.state.cards.forEach((card, i) => {
		card.thumbId = i < 5 ? `polish-old-${i}` : null;
	});
	const page = await openNewtab(context, extensionId, { seed });
	page.on("pageerror", (error) => errors.push(error.message));
	await page.setViewportSize({ width: 1280, height: 800 });
	const worker = context.serviceWorkers()[0];
	const card = (n) => page.locator(`[data-marquee-id="card-${n}"] .dial-card`);
	const checkbox = (n) => card(n).getByRole("checkbox");
	// Visibility lives on the positioning wrapper; the inner button keeps
	// the official beUI face (its own computed opacity is always 1).
	const checkboxWrap = (n) =>
		page.locator(`[data-marquee-id="card-${n}"] [data-selection-checkbox]`);
	const preview = (n) => card(n).locator("img.thumb-media").last();
	const active = page.locator('.thumbnail-refresh-mask[data-active="true"]');
	const toast = page.locator('[data-sonner-toaster][data-x-position="right"]');
	async function settle() {
		await page.evaluate(() =>
			Promise.allSettled(
				document
					.getAnimations()
					.filter(
						(a) =>
							a.effect?.getComputedTiming().iterations !==
							Number.POSITIVE_INFINITY,
					)
					.map((a) => a.finished),
			),
		);
	}
	async function savePreview(id, color) {
		return page.evaluate(
			async ({ id, color }) => {
				const canvas = document.createElement("canvas");
				canvas.width = 1024;
				canvas.height = 768;
				const ctx = canvas.getContext("2d");
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1024, 768);
				ctx.fillStyle = "#f4f5f7";
				ctx.fillRect(50, 48, 924, 672);
				ctx.fillStyle = color;
				ctx.fillRect(50, 48, 924, 100);
				ctx.fillStyle = "#ffffff";
				ctx.font = "bold 42px sans-serif";
				ctx.fillText("Reading list", 90, 114);
				ctx.fillStyle = "#a5acb8";
				for (let i = 0; i < 4; i++) {
					ctx.fillRect(90, 196 + i * 112, 100, 72);
					ctx.fillRect(220, 204 + i * 112, 560 - i * 40, 16);
					ctx.fillRect(220, 238 + i * 112, 660, 12);
				}
				const url = canvas.toDataURL();
				await new Promise((resolve, reject) => {
					const open = indexedDB.open("perch-db", 1);
					open.onsuccess = () => {
						const db = open.result;
						const tx = db.transaction("thumbnails", "readwrite");
						tx.objectStore("thumbnails").put(url, id);
						tx.oncomplete = () => {
							db.close();
							resolve();
						};
						tx.onerror = () => reject(tx.error);
					};
					open.onerror = () => reject(open.error);
				});
				return url;
			},
			{ id, color },
		);
	}
	async function setThumb(n, thumbId) {
		await page.evaluate(
			async ({ n, thumbId }) => {
				const raw = await chrome.storage.local.get("perch-setup");
				const envelope = JSON.parse(raw["perch-setup"]);
				envelope.state.cards.find((c) => c.id === `card-${n}`).thumbId =
					thumbId;
				await chrome.storage.local.set({
					"perch-setup": JSON.stringify(envelope),
				});
			},
			{ n, thumbId },
		);
	}
	async function progress(overrides) {
		await worker.evaluate((event) => chrome.runtime.sendMessage(event), {
			type: "refresh:progress",
			status: "started",
			total: 2,
			completed: 0,
			updated: 0,
			failed: 0,
			queuedIds: ["card-1", "card-2"],
			...overrides,
		});
	}
	for (let i = 0; i < 5; i++)
		await savePreview(
			`polish-old-${i}`,
			["#315b80", "#635580", "#417163", "#846342", "#754f61"][i],
		);
	await page.reload();
	await preview(1).waitFor();
	await settle();
	const old1 = await preview(1).getAttribute("src");
	const old2 = await preview(2).getAttribute("src");
	await check(
		"20px beUI control with a genuine expanded 32px hit area",
		async () => {
			await card(1).hover();
			assert.equal(await checkboxWrap(1).evaluate(el => getComputedStyle(el).opacity), "0");
			await checkbox(1).focus();
			const geometry = await checkbox(1).evaluate((el) => {
				const rect = el.getBoundingClientRect();
				const hit = getComputedStyle(el, "::after");
				return [
					rect.width,
					rect.height,
					Number.parseFloat(hit.width),
					Number.parseFloat(hit.height),
					document.elementFromPoint(rect.left - 4, rect.top + 10) === el,
				];
			});
			assert.deepEqual(geometry, [20, 20, 32, 32, true]);
		},
	);
	await check("spring pressure and draw-on 12px checkmark", async () => {
		const rect = await checkbox(1).boundingBox();
		await page.mouse.move(rect.x + 10, rect.y + 10);
		await page.mouse.down();
		await page.waitForFunction(() => {
			const el = document.querySelector(
				'[data-marquee-id="card-1"] [data-selection-checkbox] [role="checkbox"]',
			);
			const scale = new DOMMatrix(getComputedStyle(el).transform).a;
			return scale < 0.995 && scale > 0.9;
		});
		await page.mouse.up();
		await checkbox(1).locator("svg path").waitFor();
		assert.equal(await checkbox(1).getAttribute("aria-checked"), "true");
		assert.equal(await checkbox(1).locator("svg").getAttribute("width"), "12");
		await page.waitForFunction(() => {
			const p = document.querySelector("[data-selection-checkbox] svg path");
			return Number.parseFloat(getComputedStyle(p).strokeDasharray) >= 0.99;
		});
		await page.mouse.move(1200, 300);
		assert.equal(await checkboxWrap(1).evaluate(el => getComputedStyle(el).opacity), "1");
	});
	await check("keyboard focus and rapid toggles remain immediate", async () => {
		await checkbox(1).focus();
		await page.keyboard.press("Space");
		await page.keyboard.press("Space");
		assert.equal(await checkbox(1).getAttribute("aria-checked"), "true");
		assert.equal(
			await checkbox(1).evaluate((el) => el.matches(":focus-visible")),
			true,
		);
		await page.waitForFunction(() => {
			const el = document.querySelector('[data-marquee-id="card-1"] [data-selection-checkbox]');
			return getComputedStyle(el).opacity === "1" && Number(getComputedStyle(el.querySelector("svg")).opacity) > 0.99;
		});
		await settle();
		await page.screenshot({
			path: path.join(screenshots, "selection-desktop.png"),
		});
	});
	await page.keyboard.press("Escape");
	await check("queued cards never shimmer", async () => {
		await progress({ total: 6, queuedIds: seed.state.cards.map((c) => c.id) });
		await toast.getByText("Capturing 1 of 6…", { exact: true }).waitFor();
		assert.equal(await active.count(), 0);
		assert.equal(await page.locator(".thumbnail-refresh-label").count(), 0);
		await progress({ status: "cancelled", total: 6, queuedIds: [] });
	});
	await check(
		"one clipped neutral surface, linear 1.8s sheen, no card loader",
		async () => {
			await progress({
				status: "capturing",
				currentCardId: "card-1",
				currentTitle: "Bookmark 1",
			});
			await active.waitFor();
			await settle();
			assert.equal(await active.count(), 1);
			assert.equal(await active.getAttribute("data-preview"), "true");
			const style = await active.evaluate((el) => {
				const sheen = getComputedStyle(el.firstElementChild);
				return [
					getComputedStyle(el).overflow,
					sheen.animationDuration,
					sheen.animationTimingFunction,
					el.querySelectorAll("svg").length,
				];
			});
			assert.deepEqual(style, ["hidden", "1.8s", "linear", 0]);
			await page.screenshot({
				path: path.join(screenshots, "loading-existing.png"),
			});
		},
	);
	const replacement = await savePreview("polish-new-1", "#73533c");
	await page.evaluate((url) => {
		window.__polishDecode = { url };
		const original = Image.prototype.decode;
		Image.prototype.decode = function () {
			if (this.src.endsWith("bm90LWFuLWltYWdl"))
				window.__polishInvalidDecodeSeen = true;
			if (this.src !== window.__polishDecode.url) return original.call(this);
			return original.call(this).then(
				() =>
					new Promise((resolve) => {
						window.__polishDecode.release = resolve;
					}),
			);
		};
	}, replacement);
	await check(
		"previous decoded thumbnail survives a pending replacement",
		async () => {
			await setThumb(1, "polish-new-1");
			await page.waitForFunction(
				() => typeof window.__polishDecode.release === "function",
			);
			assert.equal(await preview(1).getAttribute("src"), old1);
			assert.equal(
				await card(1).locator(".thumb").getAttribute("aria-busy"),
				"true",
			);
		},
	);
	await check(
		"prior decode does not compete with the next active shimmer",
		async () => {
			await progress({
				status: "card-done",
				completed: 1,
				updated: 1,
				queuedIds: ["card-2"],
			});
			await progress({
				status: "capturing",
				completed: 1,
				updated: 1,
				currentCardId: "card-2",
				currentTitle: "Bookmark 2",
				queuedIds: ["card-2"],
			});
			await page.waitForFunction(
				() =>
					document.querySelectorAll(
						'.thumbnail-refresh-mask[data-active="true"]',
					).length === 1 &&
					!!document.querySelector(
						'[data-marquee-id="card-2"] .thumbnail-refresh-mask[data-active="true"]',
					),
			);
			assert.equal(await preview(1).getAttribute("src"), old1);
		},
	);
	await check(
		"opaque crossfade base prevents fallback flashes, then releases",
		async () => {
			await page.evaluate(() => window.__polishDecode.release());
			await page.waitForFunction(
				() =>
					!!document.querySelector(
						'[data-marquee-id="card-1"] [data-thumbnail-previous]',
					),
			);
			assert.equal(
				await card(1)
					.locator("[data-thumbnail-previous]")
					.evaluate((el) => getComputedStyle(el).opacity),
				"1",
			);
			await card(1)
				.locator("[data-thumbnail-previous]")
				.waitFor({ state: "detached" });
			assert.equal(await preview(1).getAttribute("src"), replacement);
		},
	);
	await check(
		"capture failure retains the preview and shows an honest summary",
		async () => {
			const recent = [
				{
					cardId: "card-2",
					title: "Bookmark 2",
					url: seed.state.cards[1].url,
					ok: false,
					error: "capture: timeout",
				},
			];
			await progress({
				status: "card-failed",
				completed: 2,
				updated: 1,
				failed: 1,
				queuedIds: [],
				recent,
			});
			await progress({
				status: "done",
				completed: 2,
				updated: 1,
				failed: 1,
				queuedIds: [],
				recent,
			});
			await active.waitFor({ state: "detached" });
			await settle();
			assert.equal(await preview(2).getAttribute("src"), old2);
			assert.match(await toast.innerText(), /failed/i);
			await page.screenshot({
				path: path.join(screenshots, "failure-preserves-preview.png"),
			});
		},
	);
	await check(
		"unreadable replacement never blanks a working thumbnail",
		async () => {
			await savePreview("polish-corrupt", "#ffffff");
			await page.evaluate(async () => {
				await new Promise((resolve) => {
					const req = indexedDB.open("perch-db", 1);
					req.onsuccess = () => {
						const db = req.result;
						const tx = db.transaction("thumbnails", "readwrite");
						tx.objectStore("thumbnails").put(
							"data:image/png;base64,bm90LWFuLWltYWdl",
							"polish-corrupt",
						);
						tx.oncomplete = () => {
							db.close();
							resolve();
						};
					};
				});
			});
			await setThumb(1, "polish-corrupt");
			await page.waitForFunction(
				() =>
					window.__polishInvalidDecodeSeen &&
					!document
						.querySelector('[data-marquee-id="card-1"] .thumb')
						.hasAttribute("aria-busy"),
			);
			assert.equal(await preview(1).getAttribute("src"), replacement);
			assert.equal(await active.count(), 0);
		},
	);
	await check(
		"restoring the initial thumbnail also releases the crossfade base",
		async () => {
			await setThumb(1, "polish-old-0");
			await page.waitForFunction(
				() =>
					!!document.querySelector(
						'[data-marquee-id="card-1"] [data-thumbnail-previous]',
					),
			);
			await card(1)
				.locator("[data-thumbnail-previous]")
				.waitFor({ state: "detached" });
			assert.equal(await preview(1).getAttribute("src"), old1);
		},
	);
	await check(
		"thumbless capture uses a solid skeleton, not a glowing favicon",
		async () => {
			await progress({
				status: "capturing",
				total: 1,
				currentCardId: "card-6",
				currentTitle: "Bookmark 6",
				queuedIds: ["card-6"],
			});
			await active.waitFor();
			await settle();
			assert.equal(await active.getAttribute("data-preview"), null);
			assert.equal(
				await active.evaluate((el) =>
					getComputedStyle(el).backgroundColor.endsWith(", 0)"),
				),
				false,
			);
			await page.screenshot({
				path: path.join(screenshots, "loading-empty.png"),
			});
			const incoming = await savePreview("polish-new-6", "#40645a");
			await setThumb(6, "polish-new-6");
			await page.waitForFunction(
				(url) =>
					document.querySelector('[data-marquee-id="card-6"] img.thumb-media')
						?.src === url,
				incoming,
			);
			assert.equal(await active.getAttribute("data-preview"), null);
			await progress({
				status: "done",
				total: 1,
				completed: 1,
				updated: 1,
				queuedIds: [],
			});
			await active.waitFor({ state: "detached" });
			await settle();
			assert.match(await toast.innerText(), /updated/i);
			await page.screenshot({ path: path.join(screenshots, "success.png") });
		},
	);
	await check(
		"light theme, compact viewport and reduced motion stay calm",
		async () => {
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.evaluate(async () => {
				const raw = await chrome.storage.local.get("perch-setup");
				const envelope = JSON.parse(raw["perch-setup"]);
				envelope.state.settings.colorScheme = "light";
				await chrome.storage.local.set({
					"perch-setup": JSON.stringify(envelope),
				});
			});
			await page.reload();
			await page.setViewportSize({ width: 900, height: 720 });
			await preview(1).waitFor();
			await settle();
			await progress({
				status: "capturing",
				total: 1,
				currentCardId: "card-1",
				currentTitle: "Bookmark 1",
				queuedIds: ["card-1"],
			});
			await active.waitFor();
			assert.equal(
				await active
					.locator(".thumbnail-refresh-light")
					.evaluate((el) => getComputedStyle(el).animationName),
				"none",
			);
			await card(1).hover();
			assert.equal(await checkboxWrap(1).evaluate(el => getComputedStyle(el).opacity), "0");
			await checkbox(1).focus();
			await checkbox(1).click();
			assert.equal(await checkbox(1).getAttribute("aria-checked"), "true");
			assert.equal(
				await checkbox(1)
					.locator("svg path")
					.evaluate((el) =>
						Number.parseFloat(getComputedStyle(el).strokeDasharray),
					),
				1,
			);
			await settle();
			await page.screenshot({
				path: path.join(screenshots, "compact-light-reduced.png"),
			});
		},
	);
	assert.deepEqual(errors, []);
	console.log(
		`${checks}/${checks} polish checks passed; screenshots: ${screenshots}`,
	);
} finally {
	await context.close();
}
