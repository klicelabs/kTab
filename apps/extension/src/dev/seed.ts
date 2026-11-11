/**
 * Development-only sample data.
 *
 * NEVER imported statically by production code: `main.tsx` loads this module
 * through a dynamic `import()` nested inside `if (import.meta.env.DEV)`, so
 * bundlers drop the branch (and this chunk) from production builds. The
 * Advanced settings pane reaches it the same way.
 *
 * Covers: tabbar overflow, scrolling grids, root folders, subfolders, 3-level
 * nesting, folders with many children, long/short names, bookmarks with and
 * without favicons (gradient fallback), and mixed folder/bookmark ordering.
 */
import { faviconUrl } from "../lib/url";
import { useSetupStore } from "../stores/setup-store";
import type { Card, Folder } from "../types";

interface SeedLink {
	title: string;
	url: string;
	/** Omit to exercise the favicon fallback path. */
	favicon?: string | null;
}

const LINKS: SeedLink[] = [
	{ title: "GitHub", url: "https://github.com" },
	{ title: "Figma", url: "https://www.figma.com" },
	{ title: "Linear — Plan and build", url: "https://linear.app" },
	{ title: "Vercel Dashboard", url: "https://vercel.com/dashboard" },
	{ title: "MDN Web Docs", url: "https://developer.mozilla.org" },
	{ title: "Stack Overflow", url: "https://stackoverflow.com" },
	{ title: "Hacker News", url: "https://news.ycombinator.com" },
	{ title: "The Verge", url: "https://www.theverge.com" },
	{ title: "Ars Technica", url: "https://arstechnica.com" },
	{ title: "Epicurious — Carbonara", url: "https://www.epicurious.com" },
	{ title: "NYT Cooking", url: "https://cooking.nytimes.com" },
	{ title: "Strava", url: "https://www.strava.com" },
	{ title: "Bandcamp", url: "https://bandcamp.com" },
	{ title: "Are.na", url: "https://www.are.na" },
	{ title: "Tailwind CSS", url: "https://tailwindcss.com" },
	{ title: "React Docs", url: "https://react.dev" },
	{ title: "TypeScript Handbook", url: "https://www.typescriptlang.org/docs" },
	{ title: "Lucide Icons", url: "https://lucide.dev" },
	{ title: "shadcn/ui", url: "https://ui.shadcn.com" },
	{ title: "Raycast Store", url: "https://www.raycast.com/store" },
	{ title: "Arc Browser", url: "https://arc.net" },
	{ title: "Things 3", url: "https://culturedcode.com/things" },
	{ title: "Notion", url: "https://www.notion.so" },
	{ title: "Excalidraw", url: "https://excalidraw.com" },
	{ title: "tRPC Documentation", url: "https://trpc.io" },
	{ title: "Drizzle ORM", url: "https://orm.drizzle.team" },
	{
		title: "A reader on liquid glass interfaces and translucency",
		url: "https://example.com/liquid-glass-reader",
	},
	{ title: "Design Systems Repo", url: "https://example.com/design-systems" },
	{ title: "IconBuddy", url: "https://iconbuddy.com" },
	{ title: "Fontshare", url: "https://www.fontshare.com" },
	{ title: "Pexels", url: "https://www.pexels.com" },
	{ title: "Unsplash", url: "https://unsplash.com" },
	{ title: "Vite", url: "https://vite.dev" },
	{ title: "Bun", url: "https://bun.sh" },
	{ title: "Zustand", url: "https://zustand.docs.pmnd.rs" },
	{ title: "TanStack Query", url: "https://tanstack.com/query" },
	{ title: "Effect", url: "https://effect.website" },
	{ title: "Flightradar24", url: "https://www.flightradar24.com" },
	{ title: "Citymapper", url: "https://citymapper.com" },
	{ title: "Poolside FM", url: "https://poolside.fm" },
	{ title: "NTS Radio", url: "https://www.nts.live" },
	{ title: "Resident Advisor", url: "https://ra.co" },
	{ title: "Letterboxd", url: "https://letterboxd.com" },
	{
		title: "Goodreads Choice Awards 2025 — the complete longlist",
		url: "https://www.goodreads.com",
	},
	{ title: "Wirecutter", url: "https://www.nytimes.com/wirecutter" },
	{ title: "Small Technology Foundation", url: "https://small-tech.org" },
	{ title: "512 Pixels", url: "https://512pixels.net" },
	{ title: "Daring Fireball", url: "https://daringfireball.net" },
	{ title: "Kottke.org", url: "https://kottke.org" },
	{ title: "Dense Discovery", url: "https://www.densediscovery.com" },
];

function folder(
	id: string,
	name: string,
	parentId: string | null,
	order: number,
): Folder {
	return { id, name, order, parentId };
}

function card(
	id: string,
	folderId: string,
	link: SeedLink,
	order: number,
): Card {
	return {
		id,
		folderId,
		title: link.title,
		url: link.url,
		favicon: link.favicon === undefined ? faviconUrl(link.url) : link.favicon,
		thumbId: null,
		order,
		origin: "local",
		capturedAt: null,
	};
}

export function buildSeedSetup() {
	const folders: Folder[] = [
		folder("seed-home", "Home", null, 0),
		folder("seed-design", "Design", null, 1),
		folder("seed-dev", "Development", null, 2),
		folder("seed-news", "News", null, 3),
		folder("seed-cooking", "Cooking", null, 4),
		folder("seed-travel", "Travel", null, 5),
		folder("seed-music", "Music", null, 6),
		folder("seed-work", "Work", null, 7),
		folder(
			"seed-reading",
			"Interesting articles to read later this month",
			null,
			8,
		),
		folder("seed-tools", "Tools", null, 9),
		folder("seed-fun", "Fun", null, 10),
		folder("seed-archive", "Archive", null, 11),
		// Subfolders (level 2).
		folder("seed-ui", "UI", "seed-design", 0),
		folder("seed-icons", "Icons", "seed-design", 1),
		folder("seed-frontend", "Frontend", "seed-dev", 0),
		folder("seed-backend", "Backend", "seed-dev", 1),
		folder("seed-projects", "Projects", "seed-work", 0),
		folder("seed-recipes", "Recipes", "seed-cooking", 0),
		// Level 3.
		folder("seed-apis", "APIs", "seed-backend", 0),
		folder("seed-y2026", "2026", "seed-projects", 0),
	];

	const cards: Card[] = [];
	const pushLinks = (
		folderId: string,
		start: number,
		count: number,
		noFaviconEvery = 4,
	) => {
		for (let i = 0; i < count; i++) {
			const link = LINKS[(start + i) % LINKS.length];
			const sparse: SeedLink =
				i % noFaviconEvery === noFaviconEvery - 1
					? { ...link, favicon: null }
					: link;
			cards.push(
				card(
					`${folderId}-c${i}`,
					folderId,
					sparse,
					cards.filter((c) => c.folderId === folderId).length,
				),
			);
		}
	};

	pushLinks("seed-home", 0, 14);
	pushLinks("seed-design", 27, 3);
	pushLinks("seed-ui", 1, 6);
	pushLinks("seed-icons", 28, 2);
	pushLinks("seed-dev", 14, 4);
	pushLinks("seed-frontend", 14, 9);
	pushLinks("seed-backend", 24, 2);
	pushLinks("seed-apis", 24, 3);
	pushLinks("seed-news", 6, 8);
	pushLinks("seed-cooking", 9, 3);
	pushLinks("seed-recipes", 9, 2);
	pushLinks("seed-travel", 37, 4);
	pushLinks("seed-music", 39, 6);
	pushLinks("seed-work", 2, 2);
	pushLinks("seed-projects", 2, 2);
	pushLinks("seed-y2026", 3, 3);
	pushLinks("seed-reading", 26, 5);
	pushLinks("seed-tools", 19, 7);
	pushLinks("seed-fun", 42, 4);
	pushLinks("seed-archive", 44, 3);

	// Interleave folders + cards in two containers so mixed ordering (and its
	// persistence) can be verified immediately after seeding.
	const itemOrder: Record<string, string[]> = {
		"seed-home": [
			"card:seed-home-c0",
			"card:seed-home-c1",
			"card:seed-home-c2",
			"card:seed-home-c3",
		],
		"seed-frontend": [
			"card:seed-frontend-c0",
			"card:seed-frontend-c1",
			"card:seed-frontend-c2",
		],
	};

	return { folders, cards, itemOrder };
}

/** Replace local state with the deterministic seed setup. */
export function seedDevData(): void {
	const { folders, cards, itemOrder } = buildSeedSetup();
	useSetupStore.getState().replaceSetup({
		folders,
		cards,
		activeFolderId: "seed-home",
		settings: useSetupStore.getState().settings,
		itemOrder,
	});
}

/** Restore the default empty setup. */
export async function resetDevData(): Promise<void> {
	await useSetupStore.getState().resetAll();
}

export function installDevSeed(): void {
	(window as unknown as Record<string, unknown>).__ktabSeed = {
		seed: seedDevData,
		reset: resetDevData,
	};
}
