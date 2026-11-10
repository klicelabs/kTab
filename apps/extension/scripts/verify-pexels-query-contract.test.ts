import { expect, test } from "bun:test";

import { normalizePexelsQuery as normalizeProxyQuery } from "../../web/src/lib/pexels-proxy";
import { DEFAULT_SETUP } from "../src/lib/constants";
import {
	normalizePexelsQuery,
	PEXELS_MAX_QUERY_LENGTH,
} from "../src/lib/pexels";
import { normalizeState } from "../src/lib/storage";
import { PEXELS_THEMES } from "../src/lib/wallpaper-themes";

test("extension queries meet the proxy's 80-character boundary after Unicode normalization", () => {
	expect(PEXELS_MAX_QUERY_LENGTH).toBe(80);
	for (const value of [
		"a".repeat(80),
		"a".repeat(81),
		"a".repeat(100),
		"Ｊ".repeat(81),
		"İ".repeat(80),
	]) {
		const query = normalizePexelsQuery(value);
		expect(query.length).toBeLessThanOrEqual(PEXELS_MAX_QUERY_LENGTH);
		expect(normalizeProxyQuery(query)).toBe(query);
	}
	expect(normalizePexelsQuery("a".repeat(80))).toHaveLength(80);
});

test("persisted query migration retains valid preferences and bounds legacy long input", () => {
	for (const value of ["Spider-Man Japan", "J".repeat(80), "J".repeat(100)]) {
		const setup = structuredClone(DEFAULT_SETUP);
		setup.settings.background.pexelsQuery = value;
		const query = normalizeState(setup).settings.background.pexelsQuery;
		expect(query).toBe(value.slice(0, PEXELS_MAX_QUERY_LENGTH));
		expect(() =>
			normalizeProxyQuery(normalizePexelsQuery(query)),
		).not.toThrow();
	}
});

test("curated photo themes use 4K queries and replace Space with Earth", () => {
	expect(PEXELS_THEMES.map(({ id }) => id)).toContain("earth");
	expect(PEXELS_THEMES.map(({ id }) => id)).not.toContain("space");
	for (const theme of PEXELS_THEMES)
		expect(theme.query).toMatch(/(?:^|\s)4k(?:\s|$)/i);
});
