import { expect, test } from "bun:test";

// In-memory localStorage shim. wallpaper-snapshot.ts touches localStorage
// lazily (inside functions, typeof-guarded), so setting this before the
// dynamic import exercises the real read/write paths.
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
	getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
};

const {
	WALLPAPER_SNAPSHOT_KEY,
	WALLPAPER_SNAPSHOT_NEUTRAL,
	writeWallpaperSnapshot,
	readWallpaperSnapshot,
	snapshotToCss,
} = await import("../src/lib/wallpaper-snapshot");

function bg(overrides: Record<string, unknown>) {
	return {
		type: "wallpaper",
		color: "#0A0A0C",
		gradientId: null,
		imageId: null,
		wallpaperId: "tokyo-skyline",
		customWallpaper: null,
		...overrides,
	};
}

test("bundled wallpaper round-trips with its discriminator", () => {
	mem.clear();
	writeWallpaperSnapshot(
		bg({ type: "wallpaper", wallpaperId: "bonsai-rock-milky-way" }),
	);
	expect(JSON.parse(mem.get(WALLPAPER_SNAPSHOT_KEY) as string)).toEqual({
		type: "bundled",
		id: "bonsai-rock-milky-way",
	});
	const snap = readWallpaperSnapshot();
	expect(snap).toEqual({ type: "bundled", id: "bonsai-rock-milky-way" });
	expect(snapshotToCss(snap!)).toContain("bonsai-rock-milky-way.avif");
});

test("solid colour round-trips; non-hex colours never reach the mirror", () => {
	mem.clear();
	writeWallpaperSnapshot(bg({ type: "solid", color: "#ff0000" }));
	expect(readWallpaperSnapshot()).toEqual({ type: "solid", color: "#ff0000" });
	expect(snapshotToCss({ type: "solid", color: "#ff0000" })).toBe("#ff0000");

	// Stored data is untrusted: an injection string must clear the mirror,
	// never land in a <style> payload.
	writeWallpaperSnapshot(
		bg({ type: "solid", color: 'red";</style><script>alert(1)</script>' }),
	);
	expect(mem.has(WALLPAPER_SNAPSHOT_KEY)).toBe(false);
	expect(readWallpaperSnapshot()).toBeNull();
});

test("custom image maps to the neutral surface, never the default image", () => {
	mem.clear();
	writeWallpaperSnapshot(bg({ type: "image", imageId: "bg-123" }));
	expect(readWallpaperSnapshot()).toEqual({ type: "custom", id: "bg-123" });
	const css = snapshotToCss({ type: "custom", id: "bg-123" });
	expect(css).toBe(WALLPAPER_SNAPSHOT_NEUTRAL);
	expect(css).not.toContain("url(");
});

test("none round-trips to the clean light surface recipe", () => {
	mem.clear();
	writeWallpaperSnapshot(bg({ type: "none" }));
	expect(readWallpaperSnapshot()).toEqual({ type: "none" });
	const css = snapshotToCss({ type: "none" });
	expect(css).toBe("linear-gradient(180deg,#f6f7fa,#e9edf3)");
});

test("gradient/pexels/unknown ids keep no mirror; malformed mirror reads null", () => {
	mem.clear();
	writeWallpaperSnapshot(bg({ type: "gradient", gradientId: "sunset" }));
	expect(mem.has(WALLPAPER_SNAPSHOT_KEY)).toBe(false);
	writeWallpaperSnapshot(bg({ type: "pexels", pexelsImageId: "p1" }));
	expect(mem.has(WALLPAPER_SNAPSHOT_KEY)).toBe(false);
	writeWallpaperSnapshot(
		bg({ type: "wallpaper", wallpaperId: "deleted-pack" }),
	);
	expect(mem.has(WALLPAPER_SNAPSHOT_KEY)).toBe(false);

	mem.set(WALLPAPER_SNAPSHOT_KEY, "{not json");
	expect(readWallpaperSnapshot()).toBeNull();
	mem.set(WALLPAPER_SNAPSHOT_KEY, JSON.stringify({ type: "bundled" }));
	expect(readWallpaperSnapshot()).toBeNull();
	mem.delete(WALLPAPER_SNAPSHOT_KEY);
	expect(readWallpaperSnapshot()).toBeNull();
});
