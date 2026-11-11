import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import {
	HOME_HOVER_OUTSET,
	homeHoverBox,
	homeHoverOutset,
	resolveHomeHoverTarget,
} from "../src/lib/home-hover";

function stageWithCell(inner: string, layout = "icon") {
	const { document } = parseHTML(
		`<div class="dial-grid-stage">
			<div class="dial-grid" data-layout="${layout}">
				<div class="dial-cell">${inner}</div>
			</div>
		</div>`,
	);
	const stage = document.querySelector(".dial-grid-stage") as Element;
	const cell = stage.querySelector(".dial-cell") as Element;
	return { stage, cell };
}

function rect(
	left: number,
	top: number,
	width: number,
	height: number,
): DOMRect {
	return { left, top, width, height } as DOMRect;
}

test("card layout wraps the whole cell", () => {
	const { cell } = stageWithCell('<div class="dial-card"></div>', "card");
	const target = resolveHomeHoverTarget(cell);
	expect(target?.kind).toBe("card");
	expect(target?.element).toBe(cell);
});

test("icon surfaces wrap the whole glass pane, label included", () => {
	const { cell } = stageWithCell(`
		<div class="icon-glass-tile">
			<div class="icon-app-tile"></div>
			<span class="label">Opencode</span>
		</div>`);
	const target = resolveHomeHoverTarget(cell);
	expect(target?.kind).toBe("pane");
	expect(target?.element.classList.contains("icon-glass-tile")).toBe(true);
});

test("flat icon layout wraps only the tile square", () => {
	const { cell } = stageWithCell(`
		<div class="icon-app-tile">
			<span class="label">Opencode</span>
		</div>`);
	const target = resolveHomeHoverTarget(cell);
	expect(target?.kind).toBe("icon");
	expect(target?.element.classList.contains("icon-app-tile")).toBe(true);
});

test("folder cells resolve their folder tile", () => {
	const { cell } = stageWithCell('<div class="icon-folder-tile"></div>');
	const target = resolveHomeHoverTarget(cell);
	expect(target?.kind).toBe("icon");
	expect(target?.element.classList.contains("icon-folder-tile")).toBe(true);
});

test("empty icon cells resolve no frame", () => {
	const { cell } = stageWithCell("<div></div>");
	expect(resolveHomeHoverTarget(cell)).toBeNull();
});

test("box math is stage-relative and outsets every edge", () => {
	const box = homeHoverBox(rect(120, 84, 160, 190), rect(20, 40, 800, 600));
	expect(HOME_HOVER_OUTSET).toBe(8);
	expect(box).toEqual({
		x: 120 - 20 - 8,
		y: 84 - 40 - 8,
		width: 160 + 16,
		height: 190 + 16,
	});
});

test("glass panes are framed edge-to-edge, tiles and cards get the outset", () => {
	expect(homeHoverOutset("pane")).toBe(0);
	expect(homeHoverOutset("icon")).toBe(HOME_HOVER_OUTSET);
	expect(homeHoverOutset("card")).toBe(HOME_HOVER_OUTSET);
	const paneBox = homeHoverBox(
		rect(100, 100, 100, 122),
		rect(0, 0, 800, 600),
		homeHoverOutset("pane"),
	);
	expect(paneBox).toEqual({ x: 100, y: 100, width: 100, height: 122 });
});
