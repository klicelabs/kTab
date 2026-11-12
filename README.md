# kTab

A minimal, high-performance new tab extension & speed dial.

[![extension-checks](https://github.com/klicelabs/ktab/actions/workflows/extension-checks.yml/badge.svg)](https://github.com/klicelabs/ktab/actions/workflows/extension-checks.yml)

kTab is a local-only browser dashboard that replaces the new tab page. Save websites as visual cards, organize nested folders, search your saved resources, and personalize the dashboard with wallpapers, icons and glass surfaces.

The extension uses React, TypeScript, WXT, Zustand and Tailwind CSS. It does not require an account, backend or database to build and run.

## Get started

Install the Bun version declared in the root `package.json`, then run:

```sh
git clone git@github.com:klicelabs/ktab.git
cd ktab
bun install --frozen-lockfile
cd apps/extension
bun run dev
```

The development server uses strict port 5555. Load `apps/extension/.output/chrome-mv3-dev` as an unpacked Chrome extension. For a production build, run `bun run build` from `apps/extension` and load `.output/chrome-mv3`.

## Validate a change

From `apps/extension`:

```sh
bun test --isolate scripts/
bun run compile
bun run build
```

From the repository root, `bun run check` runs read-only Biome checks. See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, review, commits and known lint limitations. Agents follow [AGENTS.md](AGENTS.md).

## Repository map

| Directory | Purpose |
| --- | --- |
| `apps/extension` | Browser extension, product tests and diagnostic tooling |
| `apps/pexels-worker` | Cloudflare Worker proxying and caching Pexels wallpapers |
| `packages/ui` | Shared UI primitives, material and geometry |
| `apps/web` | Separate web workspace; not required by the extension |
| `apps/fumadocs` | Documentation website workspace |
| `docs` | Product, architecture, decisions and performance records |

Product context: [PRODUCT.md](docs/PRODUCT.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DECISIONS.md](docs/DECISIONS.md).

## Firefox and release archives

From `apps/extension`, `bun run build:firefox` builds Firefox MV3. For an authorized release, `bun run zip:firefox` creates the Firefox archive and reproducible source ZIP under `.output` with filenames `ktab-<version>-firefox.zip` and `ktab-<version>-sources.zip`.

The source archive includes the workspace packages and lockfile needed to rebuild the submitted extension. Routine development does not bump versions or generate release archives.

## Project status

kTab is being prepared for public contribution. The maintainer still needs to select an explicit license before the public open-source release. The public-readiness checklist is in [CONTRIBUTING.md](CONTRIBUTING.md#releases-and-public-readiness).
