<div align="center">

```
█▀█ █ █ █▀█ █▀▀ █▀▀
█▀▀ █▄█ █▀▄ █▄█ ██▄
```

**Your Mac is full of junk that regrows itself. Purge it.**

[![npm](https://img.shields.io/npm/v/purge-cli?color=cb3837&label=npm)](https://www.npmjs.com/package/purge-cli)
[![downloads](https://img.shields.io/npm/dm/purge-cli?color=cb3837)](https://www.npmjs.com/package/purge-cli)
[![CI](https://github.com/soummyaanon/purge/actions/workflows/ci.yml/badge.svg)](https://github.com/soummyaanon/purge/actions/workflows/ci.yml)
[![stars](https://img.shields.io/github/stars/soummyaanon/purge?style=flat&color=ffcc00)](https://github.com/soummyaanon/purge/stargazers)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![deps](https://img.shields.io/badge/runtime%20deps-0-black)

[purge.bixai.dev](https://purge.bixai.dev/)

</div>

```
brew install soummyaanon/tap/purge      # Homebrew (no Node needed)
npm i -g purge-cli                      # or npm
npx purge-cli@latest                    # or run once without installing

purge                                   # scan, review, delete what you leave checked
purge --trash                           # same, but everything goes to the Trash — undo with: purge undo
```

<div align="center">

![purge scanning a Mac and reviewing junk in its interactive TUI](docs/demo.gif)

</div>

Build output from projects you abandoned last year. Xcode DerivedData
nobody asked for. Every app's cache folder, coding-agent scratch data,
package-manager downloads — often tens of gigabytes, sometimes far more,
all of it regenerable. purge finds it in one scan, shows it grouped and
sized, and deletes only what you leave checked.

## What it looks for

| Group | What |
|---|---|
| `builds` | `.next`, `.turbo`, `.nuxt`, `.angular`, `.terraform`, `.dart_tool`, `.gradle`, `.tox`, python venvs, cargo `target`, idle `node_modules`; `dist`/`build`/`target` beside a JS, Flutter, Gradle, CMake, Maven or sbt manifest |
| `pkg` | npm, npx, pnpm, bun, yarn, go, maven, cocoapods, pub, conda, nuget, composer, playwright, electron, homebrew, gradle caches |
| `xcode` | DerivedData, device support, simulator caches, SwiftUI previews |
| `caches` | every app's folder in `~/Library/Caches` and `~/.cache`; the Chromium caches of every Electron app (Slack, Discord, Notion, Figma, Postman, ...); auto-discovered `cache`/`tmp`/`logs` dirs inside any hidden `~/.tool` folder — even tools purge has never heard of |
| `browsers` | GPU and service worker caches, on-device AI models |
| `editors` | Cursor, VS Code, Windsurf, Zed caches |
| `agents` | Claude, Codex, Cursor, Gemini, Copilot, opencode, aider — caches, logs, scratchpads |
| `logs` | per-app folders in `~/Library/Logs` |
| `orphans` | app data whose app is gone — unchecked, opt in per row |
| `heavy` | iOS backups, `~/.Trash`, `Docker.raw`, OrbStack, simulator devices, Android emulators and system images, Ollama and LM Studio models — unchecked, opt in per row |

Narrow it: `purge builds xcode`

## Trash mode and undo

```
purge --trash        # move instead of delete
purge undo           # put the last --trash run back where it was
```

With `--trash` (or `"trash": true` in `~/.purgerc`) nothing is deleted:
every item is renamed into `~/.Trash`, which is instant and keeps the
files exactly as they were. Empty the Trash when you are sure; run
`purge undo` if you were not. Undo never overwrites a path that exists
again, never restores outside your home directory, and never moves anything
that is not inside the Trash. Plain runs delete for real and cannot be
undone — `purge undo` tells you so.

## The review screen

Full-keyboard, zero-dependency TUI:

| Key | Action |
|---|---|
| `↑`/`↓` `j`/`k` | move |
| `tab` / `shift+tab` | hop to the next / previous checkbox, skipping headers |
| `space` | toggle an item — or a whole group from its header |
| `←`/`→` `h`/`l` | fold / unfold a group |
| `/` | live-filter by path (`esc` clears) |
| `a` | select all / none (respects the filter) |
| `g` / `G` | jump to top / bottom |
| `enter` | delete what's checked — if a filter is hiding checked rows, the first `enter` reveals them instead |
| `q` | leave without touching anything |

## Safety

purge will **never**:

- touch anything outside your home directory — with one visible exception:
  Claude Code's own scratchpad under `/private/tmp/claude-<uid>`, which is
  always shown unchecked with a warning
- follow or delete a symlink
- touch a file on an external or network volume
- delete agent configs, credentials, installed extensions, editor settings,
  browser profiles, passwords, bookmarks, history, Electron app storage
  (`Local Storage`, `IndexedDB`, `Session Storage`), or Xcode Archives
- pre-check, bulk-select, or `--yes`-delete anything in the `orphans` or
  `heavy` groups — those rows are real data (an iOS backup, an uninstalled
  app's settings, Docker's disk, 40 GB of model weights). Each one must be
  checked individually in the review screen, past a warning naming exactly
  what the loss is; `a` and the group checkbox pass over them

purge leaves **unchecked**, with a visible warning, anything that is:

- tracked in git (the committed-`dist/` case)
- inside iCloud Drive, Dropbox, Google Drive or OneDrive — deleting there
  propagates to your other machines
- a browser Service Worker directory, which can hold real offline app data
- an iCloud-backed cache (`CloudKit`, `com.apple.bird`) — deleting forces a re-sync
- an ML model cache (`~/.cache/huggingface`, `~/.cache/torch`) — regenerable,
  but the re-download is tens of GB
- coding-agent session history (`~/.claude/projects`, `~/.codex/sessions`, …)
  — resume and rewind stop working without it

Every path is re-checked through the full guard pipeline immediately before
deletion, in case anything changed while you were reading the list. A path
that cannot be removed (permission denied, a file held open) is named in
the summary with its reason. Ctrl+C mid-delete stops at the next item and
still writes the run record.

**No telemetry. No network calls. Zero runtime dependencies. Ever.**
(CI enforces the last one, and greps that only one module in the codebase
is allowed to call `rm`.)

## Why purge and not …

| | purge | `npkill` | `mac-cleanup` | CleanMyMac |
|---|---|---|---|---|
| Finds | builds, caches, Xcode, agents, Electron apps, heavy items | `node_modules` only | curated caches | curated caches + more |
| Review before delete | every row, sized, grouped | per row | no — runs commands | GUI |
| Git-tracked / cloud-synced / symlink guards | yes | no | no | no |
| Re-validates before each delete | yes | no | no | — |
| Trash mode + undo | yes | no | no | Trash |
| Needs sudo | never | no | often | yes |
| Runtime deps / telemetry | 0 / none | some / none | python / none | closed / yes |
| Price | free, MIT | free | free | paid |

## Keeping things

`~/.purgerc`:

```json
{
  "keep": ["**/work/**", "~/Developer/client-project/**"],
  "staleDays": 90,
  "minSize": 25,
  "trash": true
}
```

Anything matching `keep` is never shown and never deleted.

## Reports

```
purge history
purge history --last --json
purge --json
```

Every run writes a manifest to `~/.purge/runs/` recording every path, its
size, when it went, and — for `--trash` runs — where it went. `history`
marks trash runs and undone runs, and leaves undone runs out of the
lifetime total.

## Troubleshooting

**Typing `purge` prints `Unable to purge disk buffers: Operation not
permitted`.** macOS ships its own `/usr/sbin/purge`. Your npm bin
directory comes after `/usr/sbin` in `PATH`. Run `purge-cli`, which never
collides — or install with Homebrew, whose bin directory comes first.

**`npm i purge-cli` fails with `404 … gigabye-0.1.0.tgz`.** purge shipped
for a few hours on Aug 30, 2026 under its old name, `gigabye`, since
unpublished. The directory you ran `npm i` from has a `package.json` or
lockfile that still lists `gigabye`. Drop that entry (or delete a stray
`~/package.json`), or use `npm i -g purge-cli` / `npx purge-cli@latest`,
which never read the current directory's dependencies.

**Updating.** purge makes no network calls, so it never checks for updates
itself. Run `brew upgrade purge` or `npm i -g purge-cli@latest`. Plain
`npx purge-cli` can serve a stale cached version; use `@latest`.

**Older Node.** purge is tested on Node 22.18+. On an older Node it prints
one notice and continues; if anything misbehaves, upgrade Node first (or
use the Homebrew install, which brings its own).

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture
tour and the two invariants every change must keep. Issues tagged
[`good first issue`](https://github.com/soummyaanon/purge/labels/good%20first%20issue)
are scoped to one scanner or one guard each.

If purge freed space for you, a ★ helps the next person find it.

## Requirements

macOS. Node 22.18+ for the npm install; the Homebrew install brings its own.

## License

MIT © soummyaanon
