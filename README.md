<div align="center">

```
█▀█ █ █ █▀█ █▀▀ █▀▀
█▀▀ █▄█ █▀▄ █▄█ ██▄
```

**Your Mac is full of junk that regrows itself. Purge it.**

[![npm](https://img.shields.io/npm/v/purge-cli?color=cb3837&label=npm)](https://www.npmjs.com/package/purge-cli)
[![CI](https://github.com/soummyaanon/purge/actions/workflows/ci.yml/badge.svg)](https://github.com/soummyaanon/purge/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A522.18-brightgreen)
![deps](https://img.shields.io/badge/runtime%20deps-0-black)

[purge.bixai.dev](https://purge.bixai.dev/)

</div>

```
npm i -g purge-cli     # or run without installing: npx purge-cli@latest
purge                  # or: purge-cli
```

purge makes no network calls, so it never checks for updates itself — to
update, run `npm i -g purge-cli@latest` again.

> **Heads up:** macOS ships its own `/usr/sbin/purge` (it flushes disk
> buffers and prints `Unable to purge disk buffers: Operation not
> permitted` without sudo). If typing `purge` hits that instead of this
> tool, your npm bin directory comes after `/usr/sbin` in `PATH` — run
> `purge-cli`, which never collides.

> **`npm i purge-cli` fails with `404 … gigabye-0.1.0.tgz`?** purge shipped
> for a few hours on Aug 30, 2026 under its old name, `gigabye`, which has
> since been unpublished. The error means the directory you ran `npm i`
> from has a `package.json`/`package-lock.json` that still lists `gigabye`,
> so npm tries to reinstall it alongside purge-cli. Drop the `gigabye`
> entry (or delete a stray `~/package.json` if you ran it from your home
> folder), or use `npm i -g purge-cli` / `npx purge-cli@latest`, which
> never read the current directory's dependencies.

Build output from projects you abandoned last year. Xcode DerivedData
nobody asked for. Every app's cache folder, coding-agent scratch data,
package-manager downloads — often tens of gigabytes, sometimes far more,
all of it regenerable. purge finds it in one scan, shows it grouped and
sized, and deletes only what you leave checked.

<div align="center">

![purge scanning a Mac and reviewing junk in its interactive TUI](docs/demo.gif)

</div>

## What it looks for

| Group | What |
|---|---|
| `builds` | `.next`, `.turbo`, `dist`, `build`, cargo `target`, python venvs, idle `node_modules` |
| `pkg` | npm, npx, pnpm store, bun, playwright, electron, homebrew, gradle caches |
| `xcode` | DerivedData, device support, simulator caches |
| `caches` | every app's folder in `~/Library/Caches` and `~/.cache`, plus auto-discovered `cache`/`tmp`/`logs` dirs inside any hidden `~/.tool` folder — even tools purge has never heard of |
| `browsers` | GPU and service worker caches, on-device AI models |
| `editors` | Cursor, VS Code, Windsurf, Zed caches |
| `agents` | Claude, Codex, Cursor, Gemini, Copilot, opencode, aider — caches, logs, scratchpads |
| `logs` | per-app folders in `~/Library/Logs` |
| `orphans` | app data whose app is gone — unchecked, opt in per row to delete |
| `heavy` | old iOS backups, `~/.Trash`, `Docker.raw` — unchecked, opt in per row to delete |

Narrow it: `purge builds xcode`

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
  browser profiles, passwords, bookmarks, history, or Xcode Archives
- pre-check, bulk-select, or `--yes`-delete anything in the `orphans` or
  `heavy` groups — those rows are real, non-regenerable data (an iOS backup,
  an uninstalled app's settings, Docker's disk). Each one must be checked
  individually in the review screen, past a warning naming exactly what
  the loss is; `a` and the group checkbox pass over them

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
deletion, in case anything changed while you were reading the list.

**No telemetry. No network calls. Zero runtime dependencies. Ever.**
(CI enforces the last one, and greps that only one module in the codebase
is allowed to call `rm`.)

## Keeping things

`~/.purgerc`:

```json
{
  "keep": ["**/work/**", "~/Developer/client-project/**"],
  "staleDays": 90,
  "minSize": 25
}
```

Anything matching `keep` is never shown and never deleted.

## Reports

```
purge history
purge history --last --json
purge --json
```

Every run writes a manifest to `~/.purge/runs/` recording every path,
its size, and when it went. There is no undo — there is a precise record.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture
tour and the two invariants every change must keep.

## Requirements

macOS, Node 22.18+.

## License

MIT © soummyaanon
