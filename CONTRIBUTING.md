# Contributing to kTab

The active product is the local-only browser extension in `apps/extension`.
Shared UI code lives in `packages/ui`. The web and docs apps are separate workspaces.

## Develop a change

1. Install the repository's Bun version from `package.json`, then run `bun install --frozen-lockfile` at the root.
2. Start a task branch from approved `main`: `feat/<name>`, `fix/<name>`, `perf/<name>`, `polish/<name>`, `refactor/<name>`, `docs/<name>` or `chore/<name>`.
3. Keep the branch focused. For dependent work, declare the base task branch and merge the parent first. Use a separate worktree for independent concurrent work.
4. From `apps/extension`, run `bun run dev`. The Chrome dev server uses strict port 5555; load `.output/chrome-mv3-dev` as an unpacked extension.
5. Add behavior tests for new functionality or a reproduced regression. Keep temporary benchmarks and results outside the product test suite.

## Validate and commit

Run these from `apps/extension` before committing product changes:

```sh
bun test --isolate scripts/
bun run compile
bun run build
```

At the root, `bun run check` runs read-only Biome checks. `bun run check:write`
applies fixes explicitly. Existing lint debt must be reported; do not format unrelated
workspaces as a side effect of a focused change. `git diff --check` catches whitespace errors.

Use focused Conventional Commits, for example `fix(storage): preserve settings updates`.
Stage explicit files. Build outputs, browser data, `.env` files, benchmark results and
personal agent state do not belong in a commit. Agents also follow [AGENTS.md](AGENTS.md).

## Review and merge

Open a pull request with the behavior change, tests, known limitations and any base-branch
dependency. The `extension-checks` workflow runs TypeScript, product tests and a Chrome MV3 build.
João reviews the concrete result and explicitly approves it before an agent merges it.
Passing CI alone does not authorize a merge. After approval, merge the reviewed commits,
verify the result and delete the merged branch.

Recommended GitHub rules for `main`: require pull requests, the `extension-checks` status,
resolved conversations, and block force pushes and branch deletion. Repository settings
must be enabled on GitHub by an authorized maintainer; files alone do not enforce them.
For a solo maintainer, an agent must still obtain João's review even when GitHub cannot
require the author to approve their own PR.

## Releases and public readiness

Routine changes keep the current version and update the Chrome build. Version bumps,
tags, ZIP creation and store submissions happen only for an authorized release.
Firefox validation is included when requested or relevant to a cross-browser change.

Before making the repository public:

- Choose and add an explicit license; no license is currently declared in this repository.
- Review tracked files and Git history for credentials and personal data; rotate any exposed credentials.
- Enable GitHub's private vulnerability reporting and publish the supported security-contact route.
- Enable the `main` rules above and run the workflow on GitHub.
- Review third-party asset and dependency licenses and complete store privacy disclosures.
