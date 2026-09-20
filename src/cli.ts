import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from './args.ts'
import { loadConfig } from './config.ts'
import { scan } from './scan/index.ts'
import { applyGuards, type GuardContext } from './guard/index.ts'
import { reap } from './reap/reaper.ts'
import { readManifests, readManifestEntries } from './reap/manifest.ts'
import { undo, pickUndoable } from './reap/undo.ts'
import { formatBytes } from './util/bytes.ts'
import { renderReport, renderJson, renderSummary } from './ui/render.ts'
import { renderHistory } from './ui/history.ts'
import { review } from './ui/tui.ts'
import { liveLine, liveBlock, scanLine, reapLine, shimmerWordmark } from './ui/progress.ts'
import { scanBlock, reapBlock, wantsMascot } from './ui/mascot.ts'
import { nodeVersionNotice } from './util/node-version.ts'
import pkg from '../package.json' with { type: 'json' }

const VERSION = pkg.version

const HELP = `
purge v${VERSION} — reclaim the regenerable junk on your Mac

USAGE
  purge [group...] [options]

GROUPS (default: all)
  builds     .next, .turbo, dist, build, target, .terraform, venvs, stale node_modules
  pkg        npm, pnpm, bun, yarn, go, maven, cocoapods, pub, conda, gradle, brew caches
  xcode      DerivedData, device support, simulator caches, previews
  caches     every app's folder in ~/Library/Caches and ~/.cache, Electron app caches
  browsers   GPU and service worker caches, on-device AI models
  editors    Cursor, VS Code, Windsurf and Zed caches
  agents     Claude, Codex, Cursor, Gemini, Copilot, opencode, aider junk
  logs       per-app folders in ~/Library/Logs
  orphans    app data whose app is gone (unchecked — check a row to opt in)
  heavy      iOS backups, Trash, Docker/OrbStack, simulators, emulators, local
             LLM models (unchecked — check a row to opt in)

OPTIONS
  -y, --yes           delete without the review screen
      --trash         move to the Trash instead of deleting (reverse: purge undo)
      --dry-run       report only, never prompt, never delete
      --json          machine-readable output (implies --dry-run)
      --stale-days N  node_modules idle threshold (default 60)
      --min-size N    ignore anything under N MB (default 10)
  -h, --help          this help
  -v, --version       print the version

COMMANDS
  purge history [--last] [--json]   past runs and lifetime total
  purge undo                        put the last --trash run back where it was

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
  const notice = nodeVersionNotice(process.versions.node)
  if (notice !== null) process.stderr.write(`${notice}\n`)

  const home = os.homedir()
  const runsDir = path.join(home, '.purge', 'runs')
  const config = await loadConfig(home)

  const parsed = parseArgs(argv, {
    ...(config.staleDays !== undefined ? { staleDays: config.staleDays } : {}),
    ...(config.minSize !== undefined ? { minSizeBytes: config.minSize * 1024 * 1024 } : {}),
    ...(config.groups !== undefined ? { groups: config.groups } : {}),
    ...(config.trash !== undefined ? { trash: config.trash } : {}),
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

  if (opts.command === 'undo') {
    const entries = await readManifestEntries(runsDir)
    const pick = pickUndoable(entries.map((e) => e.manifest))
    if (pick === null) {
      process.stdout.write('\nnothing to undo — only runs made with --trash can be put back.\n')
      return 0
    }
    const file = entries.find((e) => e.manifest === pick)?.file
    const r = await undo(pick, { home, ...(file !== undefined ? { manifestFile: file } : {}) })
    const bytes = r.restored.reduce((n, i) => n + i.bytes, 0)
    process.stdout.write(`\nrestored ${r.restored.length} item(s), ${formatBytes(bytes)}\n`)
    for (const sk of r.skipped) process.stdout.write(`  skipped ${sk.path}  ${sk.reason}\n`)
    return 0
  }

  // -- scan ----------------------------------------------------------
  // Claude Code's per-user sandbox scratchpad: the one path outside home the
  // claude scanner may offer and the home guard lets through.
  const uid = process.getuid?.()
  const claudeTmpDir = uid === undefined ? undefined : `/private/tmp/claude-${uid}`

  // With the mascot on, the bot is the liveness signal and the status line
  // rides on its middle row; otherwise the braille spinner does the job.
  const mascotScan = wantsMascot(process.stderr, config.mascot)
  const scanLive = liveLine(process.stderr)
  const scanBlk = liveBlock(process.stderr)
  let tick = 0
  let sized = 0
  let sizedBytes = 0
  let timer: ReturnType<typeof setInterval> | undefined
  if (!opts.json) {
    if (process.stderr.isTTY === true) {
      process.stderr.write(`${shimmerWordmark(4, true)}\x1b[38;5;245m  v${VERSION} — say purge to the junk on your Mac\x1b[0m\n\n`)
      timer = setInterval(() => {
        if (mascotScan) scanBlk.update(scanBlock(tick++, sized, sizedBytes, true))
        else scanLive.update(scanLine(tick++, sized, sizedBytes, true))
      }, 80)
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
  scanBlk.done()
  scanLive.done()

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
    const picked = await review(reviewed, hidden, { mascot: wantsMascot(process.stdout, config.mascot) })
    if (picked === null) { process.stdout.write('\ncancelled. nothing deleted.\n'); return 0 }
    chosen = picked
  }

  const wanted = chosen.filter((c) => c.selected)
  if (wanted.length === 0) { process.stdout.write('\nnothing selected. nothing deleted.\n'); return 0 }

  // -- reap ----------------------------------------------------------
  // Ctrl+C mid-delete: finish the item in flight, stop, and still write the
  // manifest — a half-recorded run is far better than an unrecorded one.
  const abort = new AbortController()
  const onSigint = () => abort.abort()
  process.on('SIGINT', onSigint)

  // The reaper only reports at item boundaries; a big item can take a
  // while, so with the mascot on a timer keeps the broom moving in between.
  const mascotReap = wantsMascot(process.stdout, config.mascot)
  const reapLive = liveLine(process.stdout)
  const reapBlk = liveBlock(process.stdout)
  let reapTick = 0
  let progress = { freed: 0, total: wanted.reduce((n, w) => n + w.bytes, 0) }
  const drawReap = () => reapBlk.update(reapBlock(reapTick++, progress.freed, progress.total, true))
  const reapTimer = mascotReap ? setInterval(drawReap, 120) : undefined
  let reaped: Awaited<ReturnType<typeof reap>>
  try {
    reaped = await reap(chosen, guardCtx, {
      version: VERSION, runsDir, signal: abort.signal, trash: opts.trash,
      onProgress: (freed, total) => {
        progress = { freed, total }
        if (mascotReap) drawReap()
        else reapLive.update(reapLine(freed, total, color))
      },
    })
  } finally {
    // A dangling interval would keep the process alive after a failure.
    if (reapTimer !== undefined) clearInterval(reapTimer)
    process.off('SIGINT', onSigint)
    reapBlk.done()
    reapLive.done()
  }
  const { manifest, manifestPath } = reaped

  // The star line shows on a user's first three runs. Only on a terminal:
  // a log file or a pipe is not a person.
  const runCount = color ? (await readManifests(runsDir)).length : undefined
  process.stdout.write(`${renderSummary(manifest, { color, home, ...(runCount !== undefined ? { runCount } : {}) })}\n`)

  if (abort.signal.aborted) {
    process.stdout.write(`interrupted — ${manifest.items.length} of ${wanted.length} item(s) were deleted before Ctrl+C.\n`)
  }
  if (manifestPath === null) {
    process.stderr.write(`purge: could not save the run record under ${runsDir} — the deletions above still happened.\n`)
  }
  const skipped = wanted.length - manifest.items.length - manifest.failed.length
  if (!abort.signal.aborted && skipped > 0) {
    process.stdout.write(`${skipped} item(s) changed since the scan and were skipped.\n`)
  }
  return abort.signal.aborted ? 130 : 0
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code },
  (err: unknown) => {
    process.stderr.write(`purge: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  },
)
