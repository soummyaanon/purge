# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org).

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
