import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from './args.ts'
import { loadConfig } from './config.ts'
import { scan } from './scan/index.ts'
import { applyGuards, type GuardContext } from './guard/index.ts'
import { reap } from './reap/reaper.ts'
import { readManifests } from './reap/manifest.ts'
import { renderReport, renderJson, renderSummary } from './ui/render.ts'
import { renderHistory } from './ui/history.ts'
import { review } from './ui/tui.ts'
import { liveLine, scanLine, reapLine, shimmerWordmark } from './ui/progress.ts'
import pkg from '../package.json' with { type: 'json' }

const VERSION = pkg.version

const HELP = `
purge v${VERSION} — reclaim the regenerable junk on your Mac

USAGE
  purge [group...] [options]

GROUPS (default: all)
  builds     .next, .turbo, dist, cargo target, venvs, stale node_modules
  pkg        npm, bun, playwright, electron, homebrew and gradle caches
  xcode      DerivedData, device support, simulator caches
  caches     every app's folder in ~/Library/Caches and ~/.cache
  browsers   GPU and service worker caches, on-device AI models
  editors    Cursor, VS Code, Windsurf and Zed caches
  agents     Claude, Codex, Cursor, Gemini, Copilot, opencode, aider junk
  logs       per-app folders in ~/Library/Logs
  orphans    app data whose app is gone (unchecked — check a row to opt in)
  heavy      iOS backups, Trash, Docker.raw (unchecked — check a row to opt in)

OPTIONS
  -y, --yes           delete without the review screen
      --dry-run       report only, never prompt, never delete
      --json          machine-readable output (implies --dry-run)
      --stale-days N  node_modules idle threshold (default 60)
      --min-size N    ignore anything under N MB (default 10)
  -h, --help          this help
  -v, --version       print the version

COMMANDS
  purge history [--last] [--json]   past runs and lifetime total

purge never touches anything outside your home directory (one exception:
Claude Code's own /private/tmp scratchpad, always shown with a warning),
never follows symlinks, and leaves anything tracked in git unchecked for
you to confirm.
`

async function main(argv: string[]): Promise<number> {
  if (process.platform !== 'darwin') {
    process.stderr.write('purge currently supports macOS only.\n')
    return 1
  }

  const home = os.homedir()
  const runsDir = path.join(home, '.purge', 'runs')
  const config = await loadConfig(home)

  const parsed = parseArgs(argv, {
    ...(config.staleDays !== undefined ? { staleDays: config.staleDays } : {}),
    ...(config.minSize !== undefined ? { minSizeBytes: config.minSize * 1024 * 1024 } : {}),
    ...(config.groups !== undefined ? { groups: config.groups } : {}),
  })

  if ('error' in parsed) {
    process.stderr.write(`purge: ${parsed.error}\n`)
    return 1
  }
  const opts = parsed
  const color = process.stdout.isTTY === true

  if (opts.command === 'help') { process.stdout.write(HELP); return 0 }
  if (opts.command === 'version') { process.stdout.write(`${VERSION}\n`); return 0 }

  if (opts.command === 'history') {
    const runs = await readManifests(runsDir)
    const shown = opts.last ? runs.slice(0, 1) : runs
    if (opts.json) {
      // --last yields the manifest object itself, not a one-element array,
      // so `purge history --last --json | jq .freedBytes` works.
      const payload = opts.last ? (shown[0] ?? null) : shown
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    } else {
      process.stdout.write(renderHistory(shown, { color }))
    }
    return 0
  }

  // -- scan ----------------------------------------------------------
  // Claude Code's per-user sandbox scratchpad: the one path outside home the
  // claude scanner may offer and the home guard lets through.
  const uid = process.getuid?.()
  const claudeTmpDir = uid === undefined ? undefined : `/private/tmp/claude-${uid}`

  const live = liveLine(process.stderr)
  let tick = 0
  let sized = 0
  let sizedBytes = 0
  let timer: ReturnType<typeof setInterval> | undefined
  if (!opts.json) {
    if (process.stderr.isTTY === true) {
      process.stderr.write(`${shimmerWordmark(4, true)}\x1b[38;5;245m  v${VERSION} — say purge to the junk on your Mac\x1b[0m\n\n`)
      timer = setInterval(() => live.update(scanLine(tick++, sized, sizedBytes, true)), 80)
    } else {
      process.stderr.write('purge  scanning...\n')
    }
  }

  let hidden = { count: 0, bytes: 0, minSizeBytes: opts.minSizeBytes }
  const candidates = await scan(
    {
      home, staleDays: opts.staleDays, now: Date.now(),
      applicationDirs: ['/Applications', path.join(home, 'Applications')],
      ...(claudeTmpDir !== undefined ? { claudeTmpDir } : {}),
    },
    {
      groups: opts.groups, minSizeBytes: opts.minSizeBytes,
      onProgress: (done, bytes) => { sized = done; sizedBytes = bytes },
      onHidden: (count, bytes) => { hidden = { count, bytes, minSizeBytes: opts.minSizeBytes } },
    },
  )

  if (timer !== undefined) clearInterval(timer)
  live.done()

  const homeStat = await fs.lstat(home)
  // "Desktop & Documents Folders" iCloud sync presents ~/Documents and
  // ~/Desktop as ordinary directories while still syncing them to every other
  // Mac on the account. This probe is the only reliable signal it is on.
  const desktopDocsSynced = await fs
    .lstat(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Desktop'))
    .then(() => true, () => false)

  const guardCtx: GuardContext = {
    home, homeDev: homeStat.dev, keepGlobs: config.keep, desktopDocsSynced,
    ...(claudeTmpDir !== undefined ? { allowOutsideHome: [claudeTmpDir] } : {}),
  }
  const reviewed = await applyGuards(candidates, guardCtx)

  if (reviewed.length === 0) {
    if (opts.json) process.stdout.write(`${renderJson([])}\n`)
    else process.stdout.write('\n  nothing to reclaim. your Mac is already lean.\n')
    return 2
  }

  // Report-only rows are shown but can never be deleted, so a run that found
  // nothing else has still reclaimed nothing: print the report, then exit 2.
  // (Dangerous rows — orphans, heavy — count as selectable: the review
  // screen is exactly where the user opts in to those.)
  const anySelectable = reviewed.some((r) => r.selectable)

  if (opts.json) { process.stdout.write(`${renderJson(reviewed)}\n`); return anySelectable ? 0 : 2 }
  if (opts.dryRun || !anySelectable) {
    process.stdout.write(`${renderReport(reviewed, { color, home, hidden })}\n`)
    if (anySelectable) process.stdout.write('\nrun `purge` to pick what to delete\n')
    else process.stdout.write('\nnothing here is reclaimable — the rows above are for review only\n')
    return anySelectable ? 0 : 2
  }

  // -- choose --------------------------------------------------------
  let chosen = reviewed
  if (!opts.apply) {
    if (!process.stdin.isTTY) {
      process.stderr.write('purge: not a terminal — use --yes or --dry-run\n')
      return 1
    }
    const picked = await review(reviewed, hidden)
    if (picked === null) { process.stdout.write('\ncancelled. nothing deleted.\n'); return 0 }
    chosen = picked
  }

  const wanted = chosen.filter((c) => c.selected)
  if (wanted.length === 0) { process.stdout.write('\nnothing selected. nothing deleted.\n'); return 0 }

  // -- reap ----------------------------------------------------------
  const liveReap = liveLine(process.stdout)
  const manifest = await reap(chosen, guardCtx, {
    version: VERSION, runsDir,
    onProgress: (freed, total) => liveReap.update(reapLine(freed, total, color)),
  })
  liveReap.done()
  process.stdout.write(`${renderSummary(manifest, { color })}\n`)

  const skipped = wanted.length - manifest.items.length
  if (skipped > 0) {
    process.stdout.write(`${skipped} item(s) changed since the scan and were skipped.\n`)
  }
  return 0
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code },
  (err: unknown) => {
    process.stderr.write(`purge: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  },
)
