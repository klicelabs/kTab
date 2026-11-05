# Agent Rules

Klice Start is a local-only MV3 browser dashboard (newtab replacement). React + TypeScript + WXT, Zustand, Tailwind. Pre-launch; targets Chrome Web Store + Firefox AMO. Read current versions from the package manifests and `wxt.config.ts`.

## Stack

React/react-dom 19.2.4, zustand ^5.0.0, motion ^13.2.0, Base UI ^1.6.0, tailwind 4.3.2, typescript 5.9.3, wxt 0.20.27, bun 1.3.13, turbo 2.10.2, Biome (root). No test runner dependency — `bun test` is builtin.

## Commands

Run in `apps/extension/`:

- `bun run dev` — WXT dev, port 5555 strict. `bun run dev:firefox` for Firefox.
- `bun run build` — Chrome production build to `.output/chrome-mv3`. Before performance measurements, preserve existing release archives, then use `bunx wxt clean` and rebuild.
- `bun run compile` — `tsc --noEmit`. Must pass before commit.
- `bun test scripts/` — product tests (`bun:test`). Must pass before commit.
- `bun run zip` — Chrome store artifact. `bun run zip:firefox` for AMO; it creates both `klice-start-<version>-firefox.zip` and `klice-start-<version>-sources.zip` under `.output`. Submit both files to Firefox AMO.

Run at root: `bun run check` (read-only Biome); `bun run check:write` applies formatting/fixes intentionally. Existing lint debt is not a passing check: report it and keep cleanup scoped. There is no `bun run check` or `bun run test` inside `apps/extension`.

## Dev output freshness

- After product code changes, ensure both Chrome outputs are current: `apps/extension/.output/chrome-mv3` and `apps/extension/.output/chrome-mv3-dev`. Documentation-only changes do not need another product build.
- Refresh production output with `bun run build` from `apps/extension/`. Refresh dev output with `bun run dev` from the same directory, wait for its successful build, and let its watcher rebuild after source changes.
- Keep the dev server running between tasks on strict port 5555; if it is stopped, start it hidden and wait for the initial build. Leave it running when the task ends. Both directories are generated, ignored, and must not be committed. The separate legacy-looking `apps/extension/dev/.output` is not produced by these commands.

## Directory map

- `apps/extension/` — the product. `entrypoints/` (newtab, popup, background worker), `src/` (components, stores, lib, hooks, services, styles), `scripts/` (verify-*.test.ts + bench harnesses).
- `apps/web/` — Next.js (backend/landing target, unused). `apps/fumadocs/` — docs site.
- `packages/ui/` — shared primitives. `packages/db/` — empty Drizzle scaffold. `packages/env/`, `packages/config/` — shared config.
- `docs/` — PRODUCT, ARCHITECTURE, DECISIONS, perf/. Nothing else belongs there.

## Docs

Reference, not required reading. Consult on demand.

| Question | File |
|---|---|
| What is this product? Vision, principles, requirements, tone | `docs/PRODUCT.md` |
| Stack, data model, storage, MV3 specifics | `docs/ARCHITECTURE.md` |
| Open decisions (backend, AI, billing, budget, i18n) | `docs/DECISIONS.md` |
| Performance history and constraints | `docs/perf/diagnosis.md` |

## Workflow

1. Inspect `git status`, the active branch and pending work before editing. Preserve unrelated work; stage explicit paths. Commit completed prior work only when authorized. Never use `git add .` to collect other tasks.
2. Create a new branch for every task before editing: `feat/`, `fix/`, `chore/`, `docs/`, `perf/`, `polish/`, or `refactor/` plus a short English name. Start from approved `main`. When a task depends on an unmerged task, branch from its committed head, state the dependency, and merge in dependency order. Independent concurrent tasks use separate worktrees. Temporary `probe/` and `perf/probe-*` branches never merge.
3. Keep one task per branch and commits focused. Conventional Commits in English: `feat|fix|ui|refactor|i18n|chore|docs|perf(<scope>): <description>`, present tense, <72 chars, no emojis.
4. Before committing product changes, run `bun test scripts/`, `bun run compile`, and `bun run build` from `apps/extension/`; inspect the diff and `git diff --check`. Add meaningful behavior tests for new functionality or regressions. Refresh the dev output and leave its watcher on strict port 5555. Report any failing check accurately. The GitHub `extension-checks` job repeats compile, tests and Chrome build.
5. Present the concrete branch, commit(s), behavior changes, checks and limitations for review. Wait for João's explicit approval of that result before merging. An agent's own review, passing tests, or approval of a plan is not merge approval. New material changes require renewed review.
6. After approval, merge the reviewed head into `main`, verify the merge result and required checks, then delete only the merged task branch. Pushes, releases and store submissions follow the user's authorization; no force-push.

Generated outputs, browser data, benchmark results, local agent state and secrets stay out of commits. See `CONTRIBUTING.md` for the human contributor flow and public-release checklist.

## Release

Routine tasks update Chrome builds only. Keep the existing version; create no ZIP, tag, version bump or store submission until João explicitly requests or authorizes a release. Firefox builds are requested when needed for cross-browser validation or release.

For an authorized release:

1. Bump semver in `apps/extension/package.json`.
2. `git tag -a vX.Y.Z -m "..."`.
3. `bun run zip` (+ `:firefox`).
4. Submit CWS + AMO.
5. `git push origin main --tags`.
6. After verifying the new archives, remove older local extension/source ZIPs, per João's preference. Published store versions are changed only when explicitly requested.

## Env traps

- Never run `git repack`, `gc`, or `prune`. If `CODEBUDDY_SAFE_DELETE_ENABLED=1`, deletions route to Recycle Bin and can empty `.git/objects`.
- Builds must run outside any sandbox; the extension loads from `.output/`.
- Origin is `Klice-Start`, not the old fork. No force-push.

## Benchmark scripts

`apps/extension/scripts/bench-*.mjs` are diagnostic tooling — not tests, not CI, not maintained as a suite. See `apps/extension/scripts/README.md`.
