import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postcss, { type Rule } from "postcss";

const tokens = readFileSync(
	new URL("../src/styles/tokens.css", import.meta.url),
	"utf8",
);
const stylesheet = postcss.parse(tokens);

test("icon surface titles are black only with Flat + Light active", () => {
	const selector =
		':root.light[data-ktab-material="flat"] .icon-glass-tile .icon-label';
	const rule = stylesheet.nodes.find(
		(node): node is Rule => node.type === "rule" && node.selector === selector,
	);
	expect(rule).toBeDefined();

	const declarations = Object.fromEntries(
		(rule?.nodes ?? [])
			.filter((node) => node.type === "decl")
			.map((node) => [node.prop, node.value]),
	);
	expect(declarations).toMatchObject({
		color: "#000",
		"-webkit-text-fill-color": "#000",
		"-webkit-text-stroke": "0",
		"text-shadow": "none",
	});
	expect(tokens).toMatch(/\.icon-label\s*\{[^}]*color:\s*#fff/);
});
