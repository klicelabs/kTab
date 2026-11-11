/** Real browser regression for the beUI wallpaper picker and draft/commit boundary.
 * Run after build: HEADFUL=1 node scripts/verify-wallpaper-color-e2e.mjs
 * Uses a disposable profile; no API mocks or native OS color dialogs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildSeed, launchExtension, openNewtab } from "./bench-lib.mjs";

const { context, extensionId } = await launchExtension({ headless: process.env.HEADFUL !== "1" });
const screenshots = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "ktab-wallpaper-color-"));
let checks = 0;
const check = async (name, run) => { await run(); console.log(`PASS ${++checks}. ${name}`); };
const errors = [];
try {
 const page = await openNewtab(context, extensionId, { seed: buildSeed({ cardsPerFolder: 6, folders: 1 }) });
 page.on("pageerror", e => errors.push(e.message));
 await page.setViewportSize({ width: 1280, height: 800 });
 async function settle() {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY).map(a => a.finished)));
 }
 async function stored() {
  return page.evaluate(async () => JSON.parse((await chrome.storage.local.get("perch-setup"))["perch-setup"]).state.settings.background);
 }
 async function openWallpaper() {
  await page.locator("#settings-trigger").click();
  await page
    .getByRole("button", { name: /^Change wallpaper\. Current wallpaper: Solid colour$/ })
    .click();
  await settle();
 }
 const trigger = page.getByRole("button", { name: "Use solid colour background", exact: true });
 const picker = page.getByRole("dialog", { name: /colour picker/i });
 const background = page.locator("#bg-layer").first();
  async function checkBounds() {
   const r = await picker.boundingBox(); const viewport = page.viewportSize();
   assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1, JSON.stringify({ r, viewport }));
  }
  // The %-translated Thumb glide boxes must never expand the popup's scroll
  // region: any horizontal overflow here is a sizing bug, not content.
  async function checkNoHorizontalOverflow() {
   const sizes = await picker.evaluate(el => ({ scrollW: el.scrollWidth, clientW: el.clientWidth }));
   assert.ok(sizes.scrollW <= sizes.clientW + 1, JSON.stringify(sizes));
  }
 await openWallpaper();
 await check("beUI picker replaces the native dialog and remains viewport-bound", async () => {
  assert.equal(await page.locator('input[type="color"]').count(), 0);
  await trigger.click(); await picker.waitFor(); await settle();
  await picker.getByRole("slider", { name: /saturation.*brightness/i }).waitFor();
   await picker.getByRole("slider", { name: /^hue$/i }).waitFor();
   await checkBounds();
   await checkNoHorizontalOverflow();
   await page.screenshot({ path: path.join(screenshots, "picker-desktop.png") });
 });
 const initial = await stored();
 await page.evaluate(() => {
  window.__pickerWrites = 0;
  const original = chrome.storage.local.set.bind(chrome.storage.local);
  chrome.storage.local.set = (...args) => {
   if (Object.hasOwn(args[0], "perch-setup")) window.__pickerWrites++;
   return original(...args);
  };
 });
 const initialCss = await background.evaluate(el => getComputedStyle(el).backgroundColor);
 let dragCss;
 await check("drag previews immediately with zero persistent writes, even while held", async () => {
  const slider = picker.getByRole("slider", { name: /saturation.*brightness/i });
  const r = await slider.evaluate(el => {
   const rail = el.closest(".touch-none"); const rect = rail.getBoundingClientRect();
   return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(r.x + r.width * .25, r.y + r.height * .25); await page.mouse.down();
  await page.mouse.move(r.x + r.width * .75, r.y + r.height * .6, { steps: 20 });
  // Deliberately hold longer than the normal persistence debounce: a bad
  // updateBackground-per-frame implementation would write during this pause.
   await page.waitForTimeout(650);
   dragCss = await background.evaluate(el => getComputedStyle(el).backgroundColor);
   assert.notEqual(dragCss, initialCss);
   // The drag loupe rides above the thumb: it must paint without opening a scrollbar.
   await checkNoHorizontalOverflow();
  assert.equal(await page.evaluate(() => window.__pickerWrites), 0);
  assert.equal((await stored()).color, initial.color);
  await page.screenshot({ path: path.join(screenshots, "live-drag-preview.png") });
 });
 await check("release commits one opaque color without reverting the preview", async () => {
  await page.mouse.up();
  await page.waitForFunction(async old => JSON.parse((await chrome.storage.local.get("perch-setup"))["perch-setup"]).state.settings.background.color !== old, initial.color);
  const bg = await stored(); assert.equal(bg.type, "solid"); assert.match(bg.color, /^#[0-9a-f]{6}$/i);
  // The commit path is coalesced (200ms); wait for the debounced write.
  await page.waitForFunction(() => window.__pickerWrites >= 1, undefined, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__pickerWrites), 1);
  assert.equal(await background.evaluate(el => getComputedStyle(el).backgroundColor), dragCss);
 });
 await check("Escape closes only the picker and restores trigger focus", async () => {
  await page.keyboard.press("Escape"); await picker.waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-settings-sidebar-slot][data-settings-open="true"]').count(), 1);
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
 });
 await check("HEX commit persists, invalid input never changes the wallpaper", async () => {
  await trigger.click(); await picker.waitFor(); await settle();
  const hex = picker.getByRole("textbox", { name: /hex/i });
  await hex.fill("#1a2b3c"); await hex.press("Enter");
  await page.waitForFunction(async () => JSON.parse((await chrome.storage.local.get("perch-setup"))["perch-setup"]).state.settings.background.color === "#1a2b3c");
  // Allow any trailing coalesced flush to land before counting writes.
  await page.waitForTimeout(400);
  const writes = await page.evaluate(() => window.__pickerWrites);
  await hex.fill("#invalid"); await hex.press("Enter"); await page.keyboard.press("Escape");
  await picker.waitFor({ state: "detached" });
  assert.equal((await stored()).color, "#1a2b3c");
  assert.equal(await page.evaluate(() => window.__pickerWrites), writes);
 });
 await check("solid color survives reload and preserves the existing wallpaper mode", async () => {
  await page.reload(); await page.locator('[data-marquee-id="card-6"]').waitFor(); await settle();
  assert.equal((await stored()).color, "#1a2b3c");
  assert.equal(await background.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(26, 43, 60)");
  await openWallpaper();
  assert.equal(await page.locator('[data-wallpaper-tile="solid"]').evaluate(el => el.className.includes("ring-2")), true);
 });
 await check("compact viewport and reduced motion preserve access and positioning", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 900, height: 720 });
   await trigger.click(); await picker.waitFor(); await settle(); await checkBounds();
   await checkNoHorizontalOverflow();
  const hue = picker.getByRole("slider", { name: /^hue$/i });
  await hue.focus(); const before = await hue.getAttribute("aria-valuenow");
  await hue.press("ArrowRight");
  assert.notEqual(await hue.getAttribute("aria-valuenow"), before);
  await page.screenshot({ path: path.join(screenshots, "picker-compact-reduced.png") });
  await page.keyboard.press("Escape"); await picker.waitFor({ state: "detached" });
 });
 assert.deepEqual(errors, []);
 console.log(`${checks}/${checks} wallpaper color checks passed; screenshots: ${screenshots}`);
} finally { await context.close(); }
