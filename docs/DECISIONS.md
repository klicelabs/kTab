# Decisions (pending only)

Locked context: local-first MV3, no accounts/billing/sync. The Pexels wallpaper feature is the only backend exception and uses Cloudflare Workers + D1 for its public proxy/cache; this does not decide the backend for Pro. Supabase (Postgres + Drizzle) is scaffolded, unused. Past verdicts live in `perf/diagnosis.md` §8.

### D1 — Backend for Pro
**Status:** pending
**Question:** Where do sync, accounts, and Pro entitlements live?
**Options:** Supabase (scaffolded) / Cloudflare (Workers + D1 + R2) / `apps/web` self-hosted Next.
**Recommendation:** Supabase — schema/orm direction already set, Realtime fits cross-tab sync evolution. Decide before any Pro surface.

### D2 — AI: BYOK vs hosted
**Status:** pending
**Question:** Who pays for and holds AI keys?
**Options:** BYOK (user key, zero marginal cost, privacy-aligned) / hosted proxy (frictionless, billed).
**Recommendation:** BYOK first — matches "cloud optional" and zero-cost local posture; hosted only if a killer AI moment demands it.

### D3 — Billing
**Status:** pending
**Question:** Merchant of record?
**Options:** Polar / Lemon Squeezy / Stripe / license key.
**Recommendation:** Polar or Lemon Squeezy (MoR, not raw Stripe) — minimal tax/VAT surface for a solo/small team. No choice needed until I1.

### D4 — Bundle budget
**Status:** pending
**Question:** Numeric JS limit for the newtab chunk?
**Options:** 350 KB / 500 KB / no cap with long-task budget instead.
**Recommendation:** Cap by long task, not bytes: cold-load dominant task ≤200 ms on reference hardware; measure per release with `bench-cold-load.mjs`. Bytes follow.

### D5 — i18n: implement or EN-only launch
**Status:** pending
**Question:** Ship other locales at launch?
**Options:** EN-only / full i18n infra now.
**Recommendation:** EN-only launch — manifest declares `default_locale: en` but no `_locales/` exists; adding locales is pure cost pre-launch. Revisit with first non-EN user evidence.

### D6 — Icon system verdicts (decided — recorded on `feat/premium-icon-system`)
**Status:** decided; mechanics in ARCHITECTURE.md "Icon resolution"
- **The site's own app icon wins.** Order: site app icon (apple-touch / manifest "any") → brand art (SVGL) → site mark → provider → letter. A launcher's job is to look like the home screen, and the home screen uses the site's own app tile; SVGL's vector mark is the fallback for brands that ship no app icon, not the flagship.
- **Manifest intent is respected.** `purpose:"monochrome"` is an alpha mask (the spec discards the colour) and is never rendered; `purpose:"maskable"` is padded artwork and ranks below an `"any"` icon. YouTube declares a 512px monochrome logo — showing it was the difference between "app icon" and "small white glyph".
- **Treatment comes from pixels.** Only decoded assets decide `full` (edge-to-edge) vs `glyph` (centered mark): ≥96px AND an opaque edge ring. Names and declared sizes are hints, not verdicts.
- **Neutral faces.** Per-URL gradient tiles are gone: the face is white/grey (light) or graphite (dark). Random colours fought the artwork and made the grid look like stickers.
- **A closed folder is one icon.** 3×3 mini icons inside an icon-sized squircle (iOS), `+N` badge for the rest; the folder no longer spans two cells and inflates the grid.
- **Glass tile = house material.** The pane is the shared `GlassSurface` with a new `tile` role (discreet, intensity-parametric), not a private CSS recipe; it wraps icon + label for app tiles AND folders, and the Quick Links rail stays glass-free.
- **Corner geometry is a ratio of the tile size** (`--icon-radius-ratio`, 0.22/0.30/0.38 per tier) with a paired circular fallback (≈0.6×) for Gecko — the same pairing contract as the `--shape-*` roles, so icons follow the appearance preference instead of a fixed number.
- **Glass tile default off, Icon Mode only.** Blur across the whole grid costs battery/perf on shared hardware and muddies transparent wallpapers; opt-in keeps Card Mode thumbnails unmolested and the Quick Links rail glass-free.
- **Metadata-only icon cache; byte/IDB caching deferred.** URLs + treatment travel in `chrome.storage.local` (≤600 entries, TTL 14/3 d); bytes ride the browser HTTP cache. An IDB byte store is the follow-up only if cold re-fetch proves wasteful.
- **Chromium `_favicon/` deferred.** The internal page-icon API needs a manifest permission + per-browser builds and serves ≤32px rasters (below the quality bar). `favicon.html` route revisit possible next iteration.
- **Google S2 excluded from the resolver; DDG ip3 is the sole provider.** S2 answers 200 with a generic mark for any domain → unverifiable misses would poison negative caching. S2 stays as the first-paint baseline only.
- **og:image out of the probe.** Social banners are non-square; manifest/apple-touch already cover proper square art.
- **Probe scope note.** Cross-origin HTML/manifest fetches ride the install-time `http/https` host permissions (Chrome grants them at install; Firefox 127+ shows and grants them in the install prompt). Scheme targets are pre-filtered (`isAbsoluteHttpUrl`), so no escalation beyond existing grants is required. Re-evaluate only if private-network icon sources (self-hosted Dashmarks/Homarr-style pages on localhost) become a supported story.
