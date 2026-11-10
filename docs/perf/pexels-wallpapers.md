# Pexels wallpapers: audit, deployment and operating limits

Audit/research date: 2026-11-07. The dashboard owns the wallpaper experience; Pexels supplies an optional background feature. No manual image collection or paid wallpaper tier is introduced.

## Current production deployment (2026-11-10)

Production now uses `apps/pexels-worker/`: Cloudflare Worker `klice-start-pexels` with D1 database `klice-start-pexels-cache`. The deployed endpoint is `https://klice-start-pexels.joaoliveiraam.workers.dev/api/pexels`. D1 stores the metadata cache, provider cooldown, and shared quota reservations. The Worker has a 120 requests/minute per-IP rate limit, a 150 upstream calls/hour ceiling, an 18,000 calls/31-day ceiling, and a 20 custom cache misses/hour ceiling. Cached results last 24 hours and may be served stale for up to seven days. `PEXELS_API_KEY` is a Cloudflare Worker secret.

The extension sends only the search query and page to this public endpoint; it stores user settings and photos locally and fetches image bytes directly from Pexels. The endpoint has no caller authentication, so its limits bound resource use but do not prove a request came from the extension. A live smoke request returned HTTP 200 with 79 photos on 2026-11-10. Chrome and Firefox both use ordinary HTTPS `fetch`; production build configuration is covered below.

The Node/Next implementation described in the audit sections below is retained for local development and regression coverage. It is no longer the supported production service.

## Existing flow and defects

- `apps/web/src/app/api/pexels/route.ts` already held the server-only API key and searched the Pexels API. It selected one photo from only eight high-scoring candidates, requested a random page, had no shared cache, durable quota budget, concurrency coordination or abuse controls, and issued a second search when the first failed or returned no results. The second search silently replaced custom keywords with an unrelated category.
- `apps/extension/src/services/wallpaper.ts` already downloaded and persisted a background in IndexedDB. Every rotation fetched metadata and downloaded one image. Daylight replaced the configured search, and independent new tabs could race the same persistent settings/image slot. Its retry helper repeated rate-limited requests.
- The wallpaper settings pane already persisted Pexels query/frequency but hid the controls behind `SHOW_PEXELS`. Existing image storage, local wallpapers, gradients, screenshot/snapshot startup and background rendering provide the integration points; they are retained rather than replaced.

## Official constraints and reference decisions

The [Pexels API documentation](https://www.pexels.com/api/documentation/) specifies a maximum batch of 80, search orientation/size filters, default limits of 200 requests/hour and 20,000/month, and attribution to Pexels and photographers. Its statistics headers (`X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`) describe the monthly quota and are returned on successful responses; 429 responses may omit them. The proxy records successful header values and conservatively blocks new upstream calls near exhaustion. It never attempts to evade a provider limit.

Pexels recommends [normalizing searches, requesting batches and caching for 24 hours](https://help.pexels.com/hc/pt/articles/900006470063-Quais-passos-posso-seguir-para-evitar-atingir-o-limite-de-requisi%C3%A7%C3%B5es). [Its own response cache still counts repeated calls against quota](https://help.pexels.com/hc/en-us/articles/900005538826-Why-do-I-get-the-same-content-from-multiple-requests), so local/shared caches are essential.

The [wallpaper-use guidance](https://help.pexels.com/hc/en-us/articles/4405588861721-Can-I-use-the-API-as-a-wallpaper-app) allows backgrounds within a product that primarily serves another purpose. Standalone wallpaper/gallery services replicating Pexels are prohibited. Automatically displayed images need attribution in the display, not only in search settings. [General API terms](https://help.pexels.com/hc/en-us/articles/900005880463-What-are-the-Terms-and-Conditions) also prohibit standalone redistribution, unaltered resale and bulk dataset collection. This feature does not provide a stock-photo download gallery. Search terms containing brands, such as Spider-Man, do not grant rights or guarantee corresponding results.

[Bonjourr's background UX](https://bonjourr.fr/fr/docs/customisation/backgrounds/) demonstrates uncomplicated source/search selection, manual next, frequencies, framing and fades. Its [settings reference](https://bonjourr.fr/docs/reference/settings-reference/) keeps brightness and frequency separate. Its [open-source server architecture](https://github.com/victrme/bonjourr-apis/blob/main/docs/SERVICES.md) separates provider conversion from backgrounds and uses shared persistent collections. We adopt those separation/cache principles; curated Daylight collections and additional providers are outside this feature. Klice preserves the user's search during Daylight rather than choosing a different collection.

## Legacy Next.js proxy contract and safeguards (audit baseline)

POST `/api/pexels`: `{ "query": "cinematic nature landscape", "page": 1 }`. Query is Unicode-normalized, whitespace-collapsed, lowercased and bounded to 80 characters. Missing/empty query uses Nature. Pages are integers 1–5. Bodies are read with a 2 KiB limit. Each upstream call requests exactly 80 landscape/large results; returned candidates must be horizontal and at least 1920×1080, with HTTPS Pexels photo/photographer/image URLs.

Success: `{ photos, query, page, cached, stale, rateLimit? }`. Photos retain the existing camelCase fields (`id`, `width`, `height`, `url`, `photographer`, `photographerUrl`, `src`). Empty results are cached as an empty batch for that exact query; they never fall back to another search. Failures contain a generic message and `retryAfter`, never raw provider response text or credentials. 429/503 responses include `Retry-After`.

- Metadata batches are shared on disk for 24 hours. On errors/429/missing key, an existing matching batch may be served stale for up to seven days. No images are downloaded by the proxy.
- One atomic filesystem lock serializes upstream activity and durable-state updates across Node processes on the **same persistent host/volume**. Waiting concurrent requests recheck cache after acquiring the lock, so matching searches become one upstream call. Upstream fetch/response handling has an eight-second timeout. Incoming request bodies have a two-second total deadline and are cancelled on timeout/disconnect without awaiting client-controlled cleanup. Admission is capped at 32 requests per process. Lock acquisition waits at most 12 seconds; abandoned locks fail closed and require the manual recovery procedure below. Locks are never deleted merely because they look old, and each release checks its unique ownership marker.
- API reservations are persisted before upstream access, including requests that fail or time out. Rolling limits cap this integration at 150 upstream calls/hour and 18,000 per 31 days, leaving margin below the default provider quota. Provider remaining/reset information can block sooner. A provider 429 establishes a shared cooldown.
- Arbitrary custom queries have a separate ceiling of 20 cache misses/hour. The six theme queries retain access to the global reserve when custom searches are exhausted. This prevents arbitrary-query cache busting from consuming the entire default key allocation.
- Public traffic is throttled to 120 requests/minute when no trusted client identity is configured. With a reverse-proxy-controlled identity header, each hashed identity is limited to 30/minute. Only short-lived hashes are persisted; addresses are not stored. Raw client-supplied forwarding headers are ignored unless explicitly configured as trusted.
- Metadata cache is bounded to 128 batches, client hashes to 512 entries/one minute, and quota timestamps to 31 days. Corrupt/unwritable persistent state fails closed rather than resetting quota. CORS permits extension requests but supplies **no authentication or quota protection**.

The endpoint is public. A determined attacker can deny custom-search availability within its small budget, or saturate the host. These safeguards bound upstream consumption; they do not prove a caller is a legitimate extension installation. For larger public deployments use the existing hosting provider's free request/connection limits, a request-body timeout and optional account-based controls. No extension-embedded secret can solve this. No paid rate-limit service or new dependency is added.

## Legacy Next.js proxy configuration (local only)

Server (`apps/web/.env.local` for local Next development; host environment for production):

```dotenv
PEXELS_API_KEY=
# Production: absolute path to a private, persistent volume on one host.
PEXELS_CACHE_DIR=/var/lib/klice/pexels
# Optional, only if a trusted reverse proxy overwrites/removes this header.
PEXELS_TRUSTED_CLIENT_HEADER=
```

Keep the API key server-only, outside source control, frontend environment variables, logs and extension builds. In development the default cache directory is `apps/web/.cache/pexels`; `.cache` is ignored. Production requires an explicit persistent directory. Restrict its filesystem permissions to the application account. The state is quota accounting as well as a cache: retain it across deploys and restarts. Deleting it resets local budgets; provider headers cannot recover consumed hourly requests before the first new response.

Run Next with `bun run dev` from `apps/web` (port 3001). Set `VITE_PEXELS_PROXY_URL=http://localhost:3001/api/pexels` for extension development, and the deployed HTTPS endpoint for extension production. The extension stores query/history/images locally; it sends only the search/page to the proxy and fetches image bytes directly from the Pexels image CDN. The proxy sees normal connection information; Pexels sees the server's API searches and the user's image-CDN request/IP. No bookmarks or browsing history are sent.

This single-host Node setup was the previous production design and is superseded by the Cloudflare Worker above. The Next route remains useful for local development and regression tests; do not use it as the production proxy.

For the legacy Node route only, an unclean process termination may leave `request.lock`. Recovery requires stopping **all** proxy workers using the directory, confirming none can resume an in-progress request, removing only the `request.lock` directory and its ownership marker, then restarting the workers. Retain `state.json`: it contains consumed quota reservations. Never delete or replace a lock while any worker can still be running.

The legacy filesystem design above remains single-host only. Production cache and quota state now use D1, shared by the Cloudflare Worker deployment.

## Costs, scale and validation

Pexels API access is [free with default limits](https://help.pexels.com/hc/en-us/articles/47677890260761-Is-the-Pexels-API-free-to-use). Do not assume unlimited access; [limit increases are currently paused](https://help.pexels.com/hc/en-us/articles/900005852323-How-do-I-get-unlimited-requests) as checked on the audit date. Cloudflare usage remains subject to the account's plan and current usage limits; the implementation does not guarantee zero charges.

Six themes × five pages × one fresh batch/day is at most 30 upstream calls/day when every page is requested. Each can serve many users and many rotations from its local batch. Twenty unique custom cache misses/hour is at most 480/day before global ceilings apply; spelling normalization and shared cache usually reduce that. User count alone does not determine API cost: unique query/page cache misses do. User rotation frequency is intentionally independent of API-call frequency.

Legacy Next route regression tests live in `apps/extension/scripts/verify-pexels-proxy.test.ts`. Worker tests are in `apps/pexels-worker/scripts/worker.test.ts` (`bun run test`), and its typecheck is `bun run typecheck` from `apps/pexels-worker`.

## Wallpaper picker

Pexels is a source card in the existing wallpaper grid. Opening it navigates to a dedicated settings view without changing the background. Selecting a theme, submitting a search or requesting the next photo activates Pexels; going back preserves the current preferences. Six representative, 320×240 Pexels CDN thumbnails share the library cards’ proportions and selection treatment. They use lazy image loading and browser HTTP caching, consume no API searches, and show a neutral fallback on image errors. These previews are illustrative; wallpaper selection remains random. Opening the library contacts the Pexels image CDN for its source preview, and opening the detail view may load the six theme previews (normal CDN connection information/IP applies).

Historical UI validation (2026-11-09): 327 product tests passed; extension and web TypeScript checks passed; Chrome and Firefox production builds passed. Installed-extension end-to-end behavior on Chrome/Firefox and a live production proxy were not verified at that time.

## Local verification and navigation correction

Pexels is a first-class settings page. The existing header displays Pexels, and its Back action pops the shared navigation history to Wallpaper. The page content has no duplicate title or Back control. Picker tests mount the full settings sidebar to exercise this contract.

Local verification needs two running processes: `bun run dev` in `apps/web` (port 3001, reads its existing server-only `PEXELS_API_KEY`) and `bun run dev` in `apps/extension` (port 5555). An ignored `apps/extension/.env.local` may set `VITE_PEXELS_PROXY_URL=http://localhost:3001/api/pexels` for local dev and production-output testing. Release builds MUST override this with the deployed HTTPS service URL or remove that local override; localhost requires the service running on the user's own machine and is not a public deployment. Neither the key nor local environment files belong in extension artifacts or source commits.

On 2026-11-07 the local service initially refused connections, and the installed production extension reported online photography unconfigured. Starting the existing web service and rebuilding with its local URL returned 79 eligible Nature photos. The installed Chrome extension then downloaded and displayed a Pexels photo with photographer/Pexels credits. This records the local setup at that time; the Cloudflare production rollout is documented above.


## Search, startup and panel refinement (2026-11-09)

Branch `fix/pexels-search-startup-ux` depends on `fix/pexels-navigation-loading` at `f26016a`; neither dependency is merged by this task.

The local photo service was stopped again. Starting the existing service returned HTTP 200 with 80 eligible photos each for Ocean (`beach ocean landscape`), Space (`space nebula stars`) and a custom `japan` search. The preset queries were retained. Submitting an unchanged query previously did nothing; it now explicitly requests another photo, including retry after a failed search. Provider cooldowns remain enforced. The service must remain running while the local localhost build is used; this change does not deploy a public service or install automatic service startup.

The panel removes the duplicate brightness slider and the Framing selector. Brightness stays in the main settings; the existing center default and saved framing values remain compatible. Rotation frequency, the current photographer/photo link and Next photo share one group. The generic Photos from Pexels card is removed, status messages only occupy space when relevant, and the search privacy explanation is one short footer.

Startup now waits for the rotation decision before resolving a visible Pexels image. It never paints the previous photo while a new selection is pending, and the first successful image has no outgoing-image fade. When rotation is not due, or a rotation fails offline, the saved current image remains the fallback. One decoded successor is prepared in IndexedDB from the existing metadata batch after a photo is displayed. Preparation uses the same cross-page lock and reset guards, keeps at most one successor, makes no API call, and does not change the displayed selection. Rotation consumes that successor without another image download, even if its metadata batch has expired. If no prepared image exists, startup can show a neutral surface while the new download completes; this cannot guarantee a new photo instantly on a first request or offline.

Sequential new tabs no longer reuse a selection just because it was chosen less than one second ago. Truly overlapping requests still share the selection made after their request began. Attribution now uses the shared GlassSurface tooltip material, following Liquid/Flat, light/dark and corner preferences.

Regression coverage checks actual React startup under StrictMode, no old-photo/default-wallpaper flash, same-query search retry, removed controls, theme changes on the credit, coordinated preparation across contexts, consuming prepared image bytes, and sub-second sequential rotation. Installed-extension visual verification was unavailable: the computer inspection returned no Chrome windows. Required compile, product tests and production build are run for the reviewed head; the existing repository-wide lint debt remains 387 errors. The changed code passes scoped Biome.
