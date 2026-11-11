# Architecture

Local-first MV3 extension. Dashboard data stays on-device, with no accounts, billing, or sync. Pexels wallpaper search is the deliberate backend exception: a public Cloudflare Worker backed by D1.

## Stack

- Runtime: React 19.2 + TypeScript 5.9, Zustand 5 (all state), motion 13 (animation), Base UI 1.6 + shadcn-style primitives (`@ktab/ui`), Tailwind 4, sonner toasts, lucide icons.
- Build: WXT 0.20 + Vite, `@wxt-dev/module-react`. Manifest V3, `manifest.version 1.3.0`.
- Dev: `bun run dev` (WXT port 5555, strict). Typecheck: `bun run compile` (`tsc --noEmit`). Tests: `bun test scripts/` (bun:test, ~233). Lint/format: Biome via root `bun run check`.
- Package manager: bun 1.3.13 (workspaces + catalog). Turbo orchestrates `apps/*`.

## Monorepo layout

- `apps/extension/` — the product. `entrypoints/` (newtab, popup, background service worker), `src/` (components, stores, lib, hooks, services, styles), `scripts/` (verify-*.test.ts product tests + bench-*.mjs diagnostic harnesses, never CI).
- `apps/web/` — Next.js app (landing/backend target; auth `none`, payments `none` today).
- `apps/fumadocs/` — docs site.
- `packages/ui/` — shared primitives (glass material, motion menus, icons, sidebar, switch).
- `packages/db/` — empty Drizzle/Postgres scaffold (`schema/index.ts` is `export {}`; Supabase configured, unused).
- `packages/env/`, `packages/config/` — shared env/config.

## Entrypoints

- `entrypoints/newtab/` (`main.tsx` → `App.tsx`) — the dashboard. First paint path: `main.tsx` seeds the store from the `localStorage` first-paint mirror, then mounts; wallpaper frame 1 comes from a CSS shim (`wallpaper-snapshot.ts`), storage wins on resolve.
- `entrypoints/popup/` — save-current-page + capture trigger.
- `entrypoints/background.ts` — service worker: thumbnail capture queue (`captureVisibleTab`, pending/in-flight maps, 10 s cooldown), cross-tab envelope reads, reset generation barrier.

## Storage (3 layers)

1. **`chrome.storage.local`, key `perch-setup`** — source of truth. One JSON envelope `{state, __perchResetGeneration}`. Writes coalesced 200 ms (`_doWrite` chain in `src/lib/storage.ts`); quota preflighted at 95% of 10 MiB; own-write echoes consumed so `onChanged` never replays our saves. Flush on `beforeunload`/`pagehide`/hidden.
2. **IndexedDB `perch-db` v1** (`src/lib/idb.ts`) — binary bytes the envelope can't hold: `thumbnails` (card screenshots, `thumbId`), `backgrounds` (custom/pexels images). Orphan sweep runs once per session post-hydration.
3. **Import/export** — `bookmarks-html.ts` (Chromium/Firefox/Vivaldi flavours + fixtures) and `backup.ts` in, envelope JSON out.

Normalization is load-bearing: `normalizeState` repairs folders (orphans→root, cycle-break), cards (dedupe, URL-gated), and backfills `itemOrder`. Corrupt envelopes are quarantined (removed + reported), never absorbed.

## Seam contract

- `useSetupStore` (zustand + persist) owns folders/cards/settings/itemOrder; every structural mutation keeps `itemOrder` in sync atomically (one coalesced write).
- `useImageStore` owns bytes (IDB only, never persisted to chrome.storage).
- Session-only stores (selection, rename, move-dialog, history UI, settings-motion) are never persisted.
- Cross-tab: `storage.onChanged` → echo-consume → `mergeConcurrentSetup` → history invalidation (`use-cross-tab-sync.ts`, `background.ts:284`).
- Reset protocol: generation barrier (`perch-reset-generation`); stale envelopes read as empty; reset cancels pending writes first.

## Permissions & MV3 specifics

`storage, activeTab, tabs, contextMenus, bookmarks, webNavigation`; host `http/https`; optional `<all_urls>` (`thumbnail-permission.ts` — requested synchronously inside a refresh/Settings click so the browser's native prompt opens in the same gesture; after granting, the operation continues, and refusal/existing grants get distinct messages with no repeated prompts); `Alt+Shift+D` save command; Firefox gecko id pinned. No remote code, no eval; content scripts minimal by design.

## Pexels photo service

`apps/pexels-worker/` serves the public Pexels search proxy in production. D1 stores the 24-hour metadata cache, provider cooldown, and shared daily/hourly/custom-query budgets; Cloudflare's rate-limit binding caps requests by client IP. The Pexels API key is a Worker secret, never part of the extension. The extension sends only the search query and page to the proxy; photo bytes come directly from Pexels. The endpoint is public and has no caller authentication.

Production builds use the Worker URL in `src/lib/pexels.ts`. A local `apps/extension/.env.local` override takes precedence, including during production builds, so release builds must override it with the deployed HTTPS URL or remove the local override.

## Screenshot capture path

Popup or auto-capture → `background.ts` queue (URL-canonicalized, 1600 ms settle + user delay, 10 s cooldown, pending→in-flight maps) → one shared rate-limited capture lane (1500 ms spacing incl. rejected attempts) → capture → downscale → IDB `thumbnails` → card `thumbId`. Failures degrade to favicon/gradient, never blank.

## Icon resolution

Launcher icons (Icon Mode tiles, Card Mode favicon fallbacks) resolve **once per domain** through a quality-first ladder in `src/lib/icon-resolver.ts`; the verdict is persisted as metadata-only in `chrome.storage.local` key `ktab-icon-cache` (own adapter + 400 ms debounce — never the `perch-setup` envelope; ≤600 entries, positive TTL 14 d, negative 3 d). No image bytes are stored: assets ride the browser HTTP cache between sessions, and a stale entry cheaply re-probes after its TTL.

Inline SVG artwork uses an explicit 100% viewport and instance-local resource IDs (`SvgIcon`). Gradients, clipping, filters, local references and embedded ID selectors stay with their own icon, so an invisible search launcher cannot hide the same brand in the overlay or Quick Links.

The ladder is ordered by what the USER sees on a home screen — the site's own app icon first:

1. **The site's own app icon** — an `apple-touch-icon` or a Web App Manifest `"any"` icon at app scale. This is the asset iOS/Android actually put on a home screen, so it is the one that reads as a real app. Manifest intent is respected: a `"monochrome"` entry is an **alpha mask** (the spec discards its colour) and is never shown; a `"maskable"` entry is padded artwork and ranks just below an `"any"` icon of the same size. The manifest is always consulted (GitHub ships its whole icon set only there), and scoring is quality-based, not a rigid order: apple-touch = 90 > manifest ≥192 = 86 > manifest maskable = 84 > rel svg = 82 > manifest ≥96 = 74 > … , with `apple-touch-icon*` filenames getting a small bonus (that file *is* the app icon by web convention).
2. **SVGL brand art** — curated vector marks matched by hostname (root path only, so `google.com/drive` cannot hijack `google.com`), `kind:"svg"`. It outranks a favicon-scale raster but never a real app icon.
3. **The site's own mark** — vector logo, small raster, or the bare `/favicon.ico`. Also reached by **alive-but-refused documents** (404/500 pages): the domain answered, so the origin favicon is still worth asking for; only a dead network or an aborted half-body returns with no verdict.
4. **DuckDuckGo ip3** — the sole provider: a 404 is a *verifiable* miss. Google S2 is excluded from resolving (it answers 200 with a generic globe for any domain, which would poison negative caching); it remains the first-paint display baseline (`baseline` status in `use-resolved-icon.ts`) until the record arrives.
5. **Negative record** — `kind:"none"` only after DDG verifies the miss; the tile renders a deterministic letter-mark (`deriveInitialLetter`), never a hanging row of identical placeholders.

**Treatment comes from pixels, not from the filename.** App-scale candidates (declared ≥96 px or unknown size) are decoded once through a fetch→blob→canvas 32×32 edge-ring: `opaqueEdgeRatio` ≥ 0.8 and ≥96 px classifies **`full`** (paint edge-to-edge — the artwork *is* the icon), while a smaller raster, a transparent mark or a hollow shape stays **`glyph`** (centered on the tile's neutral face). A mark is drawn at its own resolution (`--icon-media-native`), so a 512 px logo fills the tile and a 32 px favicon is never blown up into a blur. One decode per **artwork family**: sites ship the same icon in ten sizes (`apple-touch-icon-57…256`), and those must not burn the probe budget before the ladder reaches the real app icon.

Invalid/scheme-less targets (chrome://, extension pages, empty) write nothing. `use-resolved-icon.ts` demand-enqueues missing/stale domains into the idle scheduler in `icon-cache-store.ts` (concurrency 2, single-flight per domain, ≥220 ms spacing); components subscribe per key, so one resolution never re-renders the whole grid. og:image is deliberately out of the probe (non-square social banners crop badly as tiles).

**Presentation.** The icon face is a shared soft-light neutral in both themes, with a subtle border; full app artwork still covers it edge-to-edge. A launcher icon is the artwork's stage, never a coloured frame; per-URL gradient palettes are gone. Glyphs use a consistent optical cap, and a **closed folder is one icon** (iOS behaviour): an icon-sized squircle holding a 3×3 grid of mini icons, with a `+N` badge for the remainder — the grid rhythm never breaks and a folder never looks inflated. Icon Mode carries an opt-in **icon surface** (`iconTileSurface`, default **off**): one pane wraps icon + label, built on the shared `GlassSurface` with the house `tile` material role, so it follows the global glass intensity and appearance provider; the Quick Links rail never takes this surface. Grid metrics (gaps, safe padding, hover/press scale per `data-tile`) live in `icon-layout.ts` + `tokens.css` and do not grow cells.

**Corner geometry** is a ratio, not a number: `--icon-radius-ratio` (0.22 / 0.30 / 0.38 for discreet / soft / rounded) times the tile's own size, so a tile is equally rounded at 48 px, 76 px or as a 18 px folder mini-icon. Chromium renders `corner-shape: squircle` from it; the paired `--icon-radius-fallback-ratio` (≈0.6×) is the circular (Gecko) radius for the same perceived rounding — the same pairing contract the `--shape-*` roles use.

## Manual preview refresh and selection

Manual single/batch refresh keeps its queue in `chrome.storage.session`. A matching already-active page can be captured without opening or activating another surface. Otherwise the queue picks a per-browser capture backend: Chrome drives a reused 800×600 normal window (`focused:false`, inert `capture.html#token` anchor tab) — targets load inactive, only the target tab activates per shot, and capture is `captureVisibleTab` on that window. Firefox instead keeps two inactive tabs in the user's own window (anchor + target) and photographs them with `tabs.captureTab`, so no secondary window ever appears. Both backends store an ownership token + anchor tab id; windows are adopted or closed only when that anchor is still present with the exact token, so the dashboard and user tabs are never removed by capture cleanup.

Pending-tab identity is separate from progress metadata; navigation/activation revisions and card URL/thumbnail identity guard the capture. Recent activity, not total batch duration, controls crash staleness.

Focus restoration (Chrome only) is best-effort and honors the currently focused window; some browser/window-manager combinations may still briefly focus a newly created window. Minimized/offscreen rendering is not relied on — Chromium ignores `state: minimized` on create and Firefox restores it, so fidelity always wins over invisibility. The shared storage write chain is **per context**, not a cross-context transaction: reset generations prevent old captures being promoted after reset, but `storage.local` has no compare-and-swap for whole-envelope writes.

Selection is session-only and keyed by item IDs with source-folder metadata. Marquee geometry only discovers crossings; crossed membership survives scroll and is committed independently of viewport rectangles. Cards expose sibling Base UI checkboxes with beUI Motion styling (20×20 px visual control, 32×32 px expanded hit area, shared press spring and draw-on checkmark), so selecting never nests a control inside a navigation link. Refreshing a selection expands folders recursively first (`expandSelectionToCards`): a selected folder batches its whole subtree, deduplicated by card id, and the tray's refresh entry counts the expanded targets — the large-batch confirm (>20) lives once in `startBatchRefresh`, which every entry path funnels through.

Refresh feedback uses a single neutral skeleton shimmer on the worker's active card: a clipped, linear 1800 ms sweep, no secondary card spinner, and a static surface under reduced motion. Queued cards only have a status label. The previous decoded thumbnail stays opaque beneath the incoming image until its 220 ms opacity transition finishes; unreadable replacements preserve it. Local decoding remains `aria-busy` but does not start another shimmer after the worker advances to the next card.

## Corner scale

One preference drives three coordinate systems, so every radius in the product moves together. `tokens.css` declares the `--shape-*` variables (a Chromium radius plus its calibrated Gecko fallback for corner-shape: squircle), and `packages/ui` shape roles consume them: panel, section, surface, card, control, thumbnail and pill. It also remaps `--radius` per tier, which is the base of the Tailwind/shadcn `rounded-sm…4xl` ladder — dropdown menus, context menus, dialogs, inputs, selects and popovers in `packages/ui` therefore follow the preference without per-component overrides. Settings → Appearance writes `cornerScale` ("discreet"/"soft"/"rounded", default "soft" = shipped geometry) to storage; the appearance provider mirrors it as `[data-ktab-corner]` on the document root for instant live preview. Bookmark and folder cards read `--shape-card`, subfolder preview mini-tiles read `--shape-thumb`, the workspace frame reads the panel token, and the `select`/`input` squircle pairings derive their Gecko fallback from `--radius` so both engines stay proportional at every tier.

Deliberately outside the scale (intentional geometry): toolbar surfaces and controls are always true capsules (`--ktab-toolbar-radius`), icon-mode tiles keep the Home-Screen squircle (`--icon-radius`), and micro details inside thumbnails (favicons) plus circles stay fixed.

The search field reads `--shape-search-collapsed` (12/22/28px). Discreet and Soft use the section role's calibrated squircle fallback; their detached list aliases the same field radius and fallback, so both surfaces share identical corners. Rounded is a true 28px field capsule in both engines and keeps a separate 46px squircle list (28px calibrated Gecko fallback). Rows use the control role. The list opens and closes with a reversible 160ms opacity/transform transition, without animating layout or changing the input's shape; reduced motion closes immediately.

## Search workspace

`UnifiedSearch` owns query, scope and keyboard selection. Its resting launcher reserves a stable hero slot; opening mounts one input and one separate results surface into a body portal. `use-search-position.ts` follows the hero anchor through captured native scroll/resize events, clamps the open search into the visible viewport below the toolbar, and reserves space for actual result rows. Returning to the top naturally docks it at the original anchor without remounting the active input. Compact Search lives in the same full-bleed button group as Settings, independent of the centered folder navigation. Its button toggles the search; keyboard shortcuts focus it. The shared seam fades on hover or keyboard focus, matching history controls.

`search.enabled` controls only the Home field. The independent `search.quickAccessEnabled` preference (default true, including older saved setups) controls the toolbar button and Ctrl/Cmd+K. With the Home field hidden, the button stays beside Settings and opens the same search in a centered floating position below the toolbar, without reserving hero space. Turning off both preferences disables search entirely and releases the keyboard shortcut. Engine/options remain configurable while either access path is enabled. Both visibility preferences are included in the first-paint mirror to avoid a toolbar flash before storage hydration.

The local index normalizes accents and case once per library snapshot and matches combined title, URL and folder-path terms. `search-results.ts` groups saved pages, folders, authored Quick Links and web actions; All / Saved / Folders / Web scopes make their origin explicit. The empty view uses authored destinations, without inventing visit history. Web suggestions are best-effort, abortable and requested only after at least two typed characters; local results and direct search do not wait for the network. Results render title and context on one line; URL rows reuse the Home `IconAppTile` pipeline on a white face. Keyboard selection uses stable result IDs so asynchronous suggestions cannot silently change the selected destination.

In All/Web, a typed address or recognized website leads the results. `search-destinations.ts` indexes the bundled site mappings (plus Wikipedia and Gmail) and the shared, cached SVGL brand catalogue without sending queries to that catalogue. Exact names, unique prefixes and unambiguous small typos can resolve a site; it never guesses a `.com` suffix. Google suggestions use the Chrome response format and distinguish `NAVIGATION` URLs from textual queries (Chromium's `search_suggestion_parser.cc`); these live URLs extend discovery beyond the catalogue. Unsupported engines, network failures and uncertain names retain ordinary search. Saved/Folder scopes stay local. A saved homepage/Quick Link is promoted without duplicating bare/`www` URLs, while deeper saved pages stay available. Remote responses are keyed by query and engine, and cancelled responses are ignored.

## What is NOT here (SaaS target, unimplemented)

General account services remain unimplemented: sync, auth, billing/entitlements, multi-device, AI, and dashboard write-parity. The D1 schema is limited to Pexels cache and quota operations; the Supabase scaffold remains unused. `bts.jsonc` describes the broader SaaS target, not the Pexels service.
