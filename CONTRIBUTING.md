# Contributing to purge

Thanks for wanting to help. purge deletes files on strangers' machines, so
the bar for correctness is unusually high — this document tells you where
things live and which rules are load-bearing.

## Setup

```
git clone https://github.com/soummyaanon/purge.git
cd purge
npm install
npm test            # node --test, no framework
npm run typecheck   # tsc --noEmit
npm run build       # esbuild single-file bundle
```

Node 22.18+ (the code runs as TypeScript directly via type stripping — no
build step during development).

## Architecture in one minute

```
src/
  scan/      finds candidates. One filesystem walk (walker.ts) feeds the
             WalkScanners; PathScanners probe fixed locations. Scanners are
             pure (dirent, ctx) → candidate functions.
  guard/     vetoes. Every candidate passes every guard; a guard can block
             (dropped), report (visible, never deletable), or downgrade
             (visible, unchecked, warned). Precedence: block > report > downgrade.
  reap/      deletes. reaper.ts is THE ONLY module allowed to call fs.rm —
             CI greps for violations. It re-runs the full guard pipeline on
             every path immediately before removal (TOCTOU defense).
  ui/        renders. tui-state.ts is a pure reducer; tui.ts only translates
             keypresses and writes frames. progress.ts is pure string
             functions for the spinner/bar/banner.
```

## The two invariants

1. **Only `src/reap/reaper.ts` deletes.** No `fs.rm`, `fs.unlink`, or
   `fs.rmdir` anywhere else in `src/`. CI enforces this by grep.
2. **Zero runtime dependencies.** The published package is one bundled file
   that runs on any Node ≥22.18. CI fails if `dependencies` is non-empty.

## Adding a scanner

1. Write a failing test in `test/scan/` first (this repo is TDD —
   every behavior change starts with a red test).
2. Fixed location (a cache dir, an app's data folder) → a `PathScanner` in
   its own file under `src/scan/`. Something found by walking the home
   directory → extend a `WalkScanner`.
3. Register it in `src/scan/index.ts` and, if it's a new group, add the
   group to `src/types.ts` and the headers in `src/ui/render.ts`.
4. Ask: can this path hold data the user cannot regenerate? If yes, add a
   pattern to `src/guard/fragile.ts` (downgrade: unchecked, warned, still
   bulk-toggleable) or put it in the `heavy` group and give it a warning in
   `src/guard/danger.ts` (danger: unchecked, warned, never bulk-toggled).
   When in doubt, downgrade — an unchecked row costs the user one keypress;
   a lost file costs trust.

## Style

- Tests use `node:test` + `node:assert/strict`, real temp directories via
  `fs.mkdtemp`, no mocks.
- Comments explain constraints the code can't show, not what the next line
  does. Read a few existing files first; match what you see.
- One behavior per test, one purpose per module.

## Releasing (maintainers)

Bump `version` in `package.json` (the CLI reads it at build time), add a
`## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`, commit, then tag
`vX.Y.Z` and push the tag. The release workflow runs the full suite,
publishes to npm with provenance, creates a GitHub Release whose notes are
that changelog section, and — when the `TAP_GITHUB_TOKEN` secret is set —
bumps the Homebrew formula in `soummyaanon/homebrew-tap`.
