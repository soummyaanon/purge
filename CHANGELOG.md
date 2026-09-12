# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

## [0.8.1] - 2026-09-12

### Changed
- Release workflow: the Homebrew bump job waits up to 20 minutes for npm's
  CDN to serve a freshly published tarball (v0.8.0 took over ten), strips
  stray whitespace from the tap token and re-masks it, refuses a secret
  that is not shaped like a GitHub token with a plain message, and can be
  run by hand via `workflow_dispatch` for an already-published version.
  No code changes.

## [0.8.0] - 2026-09-12

### Added
- `--trash` (or `"trash": true` in `~/.purgerc`): every item is moved into
  `~/.Trash` with a rename instead of deleted. Instant, same volume, sizes
  preserved. The Trash row itself is still deleted for real — it cannot be
  moved into itself.
- `purge undo`: moves the newest `--trash` run back to where it came from.
  Refuses to overwrite anything that exists again, to restore outside your
  home directory, or to move anything that is not inside the Trash. The
  manifest is marked `undoneAt`, `history` shows `undone`, and the lifetime
  total leaves it out. Plain runs still delete for real and cannot be undone;
  `undo` says so.
- Electron app caches: any folder under `~/Library/Application Support`
  with both `Cache` and `Code Cache` — Slack, Discord, Notion, Figma,
  Postman, Teams, Zoom, and apps purge has never heard of — has its
  `Cache`, `Code Cache`, `GPUCache` and Dawn shader caches offered in the
  `caches` group. `Local Storage`, `IndexedDB`, `Session Storage` and
  `Service Worker` are never touched. Apps other scanners own are skipped.
- `pkg` group: Go module download cache, Maven repository, CocoaPods specs,
  pub cache, NuGet packages, Composer cache, Yarn Berry cache, and the conda
  package cache under miniconda3/anaconda3/miniforge3/mambaforge/.conda.
- `builds` group: `.terraform`, `.dart_tool`, `.gradle`, `.tox`,
  `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.angular`, `.docusaurus`,
  `.serverless`; `build/` beside a `pubspec.yaml`, Gradle or CMake manifest;
  `target/` beside `pom.xml` or `build.sbt`; a project `.cache/` beside a
  `package.json`.
- `xcode` group: SwiftUI preview simulators (`Xcode/UserData/Previews`).
- `heavy` group: simulator devices, Android emulators and system images,
  Ollama and LM Studio models, OrbStack data — each dangerous-by-default
  with a warning naming exactly what the loss is and which native tool
  reclaims the space more gently.
- The summary asks for a GitHub star on your first three runs, then never
  again. Terminal only, never in `--json`, no network involved — the count
  comes from the manifests purge already writes.

### Changed
- A path the reaper could not remove (permission denied, a file held open)
  is now listed by name with its error code under `could not delete`,
  instead of being counted among items that "changed since the scan".
- Ctrl+C during deletion stops at the next item boundary, writes the
  manifest for everything already removed, prints the partial summary and
  exits 130. Before, it killed the process with no record.
- A run record that cannot be saved (unwritable `~/.purge`) no longer
  hides the summary of what was just deleted; it prints a warning instead.
- Review screen rows are fitted to the terminal width: long paths are
  middle-ellipsized with their tail kept, the note gives way before the
  warning, and nothing wraps and garbles the frame on an 80-column
  terminal.
- A one-line notice on stderr when running under a Node older than 22.18,
  naming both versions. Advisory only; the run continues.
- The walker no longer enters `~/.npm`, `~/.bun`, `~/.gradle`, `~/.m2`,
  `~/go/pkg/mod`, conda distributions or the heavy roots — they are offered
  whole by their own scanners, and walking the npm cache alone cost seconds.
- The release workflow now creates a GitHub Release with the changelog
  section as its notes, and bumps the Homebrew tap formula when a
  `TAP_GITHUB_TOKEN` secret is present.

## [0.7.1] - 2026-09-08

### Changed
- README: added a troubleshooting note for `npm i purge-cli` failing with
  `404 … gigabye-0.1.0.tgz`. purge shipped for a few hours on Aug 30 under
  its old name, `gigabye`, since unpublished; the error means the current
  directory's `package.json` still lists it. The note explains the fix and
  points at `npm i -g` / `npx purge-cli@latest`, which never read the
  current directory's dependencies. No code changes.

## [0.7.0] - 2026-08-30

### Changed
- The `orphans` and `heavy` groups are deletable — by explicit, per-row
  opt-in. Until now they were report-only: purge showed you 70 GB of
  Docker.raw and refused to help. Each row now arrives unchecked with a
  warning naming exactly what the loss is ("a device backup — deleting it
  is permanent", "destroys all Docker containers, images & volumes — quit
  Docker Desktop first"), and can be checked in the review screen. The
  friction is kept where it matters: select-all and the group checkbox pass
  over these rows, they are never pre-checked, `--yes` never deletes one,
  and the reaper still refuses any row whose warning the user was not shown.
- `--json` output gains a `dangerous` field per item.

## [0.6.1] - 2026-08-30

### Fixed
- `--version` (and the banner) reported a stale hardcoded version; it now
  reads from `package.json`, so it can never drift again.
- Added a `purge-cli` bin alias. On Macs where the npm bin directory sits
  after `/usr/sbin` in `PATH`, typing `purge` ran macOS's own disk-buffer
  purge tool ("Unable to purge disk buffers: Operation not permitted");
  `purge-cli` always resolves to this tool.

## [0.6.0] - 2026-08-30

### Added
- Cache discovery: the `caches` group now finds `cache`/`tmp`/`logs`
  directories inside any hidden `~/.tool` folder by naming convention —
  tools purge has never heard of get their junk found automatically.
  Identity dirs (`.ssh`, `.gnupg`, `.aws`, ...) are never probed, dot dirs
  other scanners own are left to their groups, and anything already
  claimed this scan is never duplicated. Junk names match
  case-insensitively so case-sensitive APFS behaves like the default.
- `pkg` group: the npx cache (`~/.npm/_npx`) and the pnpm store
  (`~/Library/pnpm/store`, covering every store version).

## [0.5.0] - 2026-08-30

### Added
- `tab` / `shift+tab` hop checkbox-to-checkbox on the review screen,
  skipping group headers and wrapping at the ends — the fastest way to
  reach one particular box.

## [0.4.0] - 2026-08-30

### Added
- The cyan/blue/gray palette: 256-color headers, sizes and chrome, a
  deep-blue cursor bar instead of reverse video, a cyan→blue gradient
  reap bar, and a shimmer sweep across the PURGE wordmark on the review
  screen. Plain-text output is byte-identical when color is off, and the
  test suite enforces it.

## [0.3.0] - 2026-08-30

### Added
- `agents` group: caches, logs and scratch data of every coding agent found
  on the machine — Claude Desktop/Code, Codex, Cursor, Gemini CLI, Copilot
  CLI, opencode, aider. Session history (Claude transcripts, Codex sessions)
  is always downgraded: visible, unchecked, warned.
- Interactive review screen upgrades: focusable group headers (space toggles
  the whole group), fold/unfold groups (`←`/`→`), live path filter (`/`),
  jump keys (`g`/`G`), item counts on headers, selected-count footer.

### Changed
- The `claude` group is now the `agents` group. The old name keeps working
  everywhere (`purge claude`, `~/.purgerc` groups) as an alias.

### Fixed
- A `~/.purgerc` groups list containing only unrecognized names now narrows
  the scan to nothing instead of silently widening it to every group.
- Confirming with an active filter that hides checked rows now reveals them
  first; nothing can be deleted sight-unseen from a filtered view.
- Escape no longer quits the review screen (it only clears the filter), so
  a reflex keypress cannot discard minutes of checkbox work.
- Codex sqlite log databases are only offered when idle (no `-wal`/`-shm`
  sidecars), preventing torn deletion of a live database.
- Gemini CLI checkpoints (`~/.gemini/tmp`) are downgraded like all other
  agent session state.
- Group headers show an aggregate checkbox (`[x]`/`[~]`/`[ ]`), so toggling
  a folded group has visible feedback.

## [0.2.0] - 2026-08-30

### Added
- Deep-scan groups: `caches` (every folder in `~/Library/Caches` and
  `~/.cache`), `logs` (`~/Library/Logs`), `claude` (Claude Desktop/Code
  caches, transcripts, sandbox scratchpads), `heavy` (iOS backups, Trash,
  `Docker.raw` — report-only).
- Guard downgrades for iCloud-backed caches, ML model caches, and Claude
  session history; exact-match home-guard allowlist for the Claude scratchpad.
- Live progress: braille spinner with running size counter during scan,
  byte-accurate progress bar during deletion, block-letter wordmark.

### Changed
- **Renamed from `gigabye` to `purge`** (npm package `purge-cli`, binary
  `purge`, config `~/.purgerc`, manifests `~/.purge/runs/`).

## [0.1.0] - 2026-08-29

Initial release as `gigabye`: builds/pkg/xcode/browsers/editors/orphans
groups, guard pipeline, review TUI, manifests and history.
