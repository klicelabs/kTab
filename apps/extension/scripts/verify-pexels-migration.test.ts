import { expect, test } from "bun:test";
import { DEFAULT_SETUP } from "../src/lib/constants";
import { mergeConcurrentSetup } from "../src/lib/merge-external-setup";
import { normalizeState } from "../src/lib/storage";

test("legacy default query migrates to Nature without changing the selected background source", () => {
	const setup = structuredClone(DEFAULT_SETUP);
	setup.settings.background.pexelsQuery = "curated wallpaper";
	const bg = normalizeState(setup).settings.background;
	expect(bg.pexelsQuery).toBe("cinematic nature landscape 4k");
	expect(bg.type).toBe(setup.settings.background.type);
	expect(bg.wallpaperId).toBe(setup.settings.background.wallpaperId);
	expect(bg.pexelsPosition).toBe("center");
});

test("automatic photo refresh preserves another tab's query, frequency and framing edits", () => {
	const base = structuredClone(DEFAULT_SETUP);
	base.settings.background.type = "pexels";
	const local = structuredClone(base);
	const incoming = structuredClone(base);
	const credit = {
		id: 1,
		url: "https://www.pexels.com/photo/1",
		photographer: "Photographer",
		photographerUrl: "https://www.pexels.com/@photographer",
		width: 6000,
		height: 4000,
	};
	Object.assign(local.settings.background, {
		pexelsImageId: "pexels_new",
		pexelsPhoto: credit,
		pexelsLastFetched: 100,
		pexelsLastPeriod: "morning",
	});
	Object.assign(incoming.settings.background, {
		pexelsQuery: "Japan",
		pexelsPosition: "top",
		pexelsFrequency: "daylight",
		brightness: 75,
	});
	const merged = mergeConcurrentSetup(base, local, incoming)?.settings
		?.background;
	expect(merged).toMatchObject({
		pexelsQuery: "Japan",
		pexelsPosition: "top",
		pexelsFrequency: "daylight",
		brightness: 75,
		pexelsImageId: "pexels_new",
		pexelsPhoto: credit,
		pexelsLastFetched: 100,
		pexelsLastPeriod: "morning",
	});
	const reverse = mergeConcurrentSetup(base, incoming, local)?.settings
		?.background;
	expect(reverse).toEqual(merged);
});

test("competing automatic refreshes keep the newest complete photo selection", () => {
	const base = structuredClone(DEFAULT_SETUP);
	const local = structuredClone(base);
	const incoming = structuredClone(base);
	Object.assign(local.settings.background, {
		pexelsImageId: "pexels_local",
		pexelsPhoto: { id: 1 },
		pexelsLastFetched: 100,
		pexelsLastPeriod: "morning",
	});
	Object.assign(incoming.settings.background, {
		pexelsImageId: "pexels_remote",
		pexelsPhoto: { id: 2 },
		pexelsLastFetched: 200,
		pexelsLastPeriod: "night",
	});
	const merged = mergeConcurrentSetup(base, local, incoming)?.settings
		?.background;
	expect(merged).toMatchObject({
		pexelsImageId: "pexels_remote",
		pexelsPhoto: { id: 2 },
		pexelsLastFetched: 200,
		pexelsLastPeriod: "night",
	});
});
test("custom themes and rotation preferences survive normalization", () => {
	for (const pexelsQuery of ["Spider-Man", "Japan", "minimalist landscape"]) {
		for (const pexelsFrequency of [
			"daylight",
			"hourly",
			"daily",
			"per-tab",
			"locked",
		] as const) {
			const setup = structuredClone(DEFAULT_SETUP);
			Object.assign(setup.settings.background, {
				type: "pexels",
				pexelsQuery,
				pexelsFrequency,
			});
			const bg = normalizeState(setup).settings.background;
			expect(bg.pexelsQuery).toBe(pexelsQuery);
			expect(bg.pexelsFrequency).toBe(pexelsFrequency);
		}
	}
});
