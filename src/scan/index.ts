import path from 'node:path'
import type { Candidate, Group } from '../types.ts'
import { walk } from './walker.ts'
import { diskUsageBytes } from '../util/du.ts'
import type { PathScanner, RawCandidate, ScanContext, WalkScanner } from './scanner.ts'
import { buildsScanner } from './builds.ts'
import { nodeModulesScanner } from './node-modules.ts'
import { cargoScanner } from './cargo.ts'
import { pythonScanner } from './python.ts'
import { pkgCacheScanner } from './pkg-cache.ts'
import { xcodeScanner } from './xcode.ts'
import { editorsScanner } from './editors.ts'
import { browsersScanner } from './browsers.ts'
import { orphansScanner } from './orphans.ts'
import { sysCachesScanner } from './sys-caches.ts'
import { discoverScanner } from './discover.ts'
import { logsScanner } from './logs.ts'
import { agentsScanner } from './agents.ts'
import { heavyScanner } from './heavy.ts'

const WALK_SCANNERS: WalkScanner[] = [
  buildsScanner, nodeModulesScanner, cargoScanner, pythonScanner,
]

const PATH_SCANNERS: PathScanner[] = [
  pkgCacheScanner, xcodeScanner, editorsScanner, browsersScanner, orphansScanner,
  sysCachesScanner, logsScanner, agentsScanner, heavyScanner,
  // last on purpose: discovery dedupes against everything claimed above
  discoverScanner,
]

/** Sizing is I/O bound. Bound the concurrency so a big home directory does not thrash. */
const SIZING_CONCURRENCY = 8

/**
 * Home-relative directories the walk never enters. diskdiet excluded these
 * with `-not -path`, and dropping them was a real regression: `~/Library`
 * alone contains thousands of `dist`, `build` and `node_modules` directories
 * belonging to installed applications, and walking it is slow.
 *
 * The fixed-path scanners still reach into ~/Library deliberately; they do
 * not use the walker.
 */
const SKIP_UNDER_HOME = [
  'Library', 'Applications', 'Pictures', 'Music', 'Movies',
  '.vscode', '.cursor', '.claude', '.codex', '.windsurf', '.local', '.rustup', '.cargo/registry',
  // owned by the caches scanner; the walker would claim venvs buried inside it
  '.cache',
]

async function sizeAll(
  raw: RawCandidate[],
  onProgress?: (done: number, bytes: number) => void,
): Promise<Candidate[]> {
  const out: Candidate[] = []
  let cursor = 0
  let done = 0
  let total = 0

  async function worker() {
    for (;;) {
      const i = cursor++
      const item = raw[i]
      if (item === undefined) return
      const bytes = await diskUsageBytes(item.path)
      out.push({ ...item, bytes })
      total += bytes
      onProgress?.(++done, total)
    }
  }

  await Promise.all(Array.from({ length: SIZING_CONCURRENCY }, worker))
  return out
}

/**
 * One filesystem walk plus the fixed-path probes, then a bounded-concurrency
 * sizing pass. Claimed directories are pruned, so a `dist/` nested inside an
 * already-claimed `.next/` is never counted twice.
 */
export async function scan(
  ctx: ScanContext,
  opts: { groups: Group[]; minSizeBytes: number; onProgress?: (done: number, bytes: number) => void; onHidden?: (count: number, bytes: number) => void },
): Promise<Candidate[]> {
  const wanted = new Set(opts.groups)
  const raw: RawCandidate[] = []

  const activeWalkers = WALK_SCANNERS.filter((s) => wanted.has(s.group))
  if (activeWalkers.length > 0) {
    const skipRoots = new Set(SKIP_UNDER_HOME.map((rel) => path.join(ctx.home, rel)))
    await walk(
      ctx.home,
      async (v) => {
        for (const scanner of activeWalkers) {
          const hit = await scanner.inspect(v, ctx)
          if (hit === null) continue
          raw.push(hit)
          return { prune: true } // never look inside something already claimed
        }
        return { prune: false }
      },
      { skip: (abs) => skipRoots.has(abs) },
    )
  }

  for (const scanner of PATH_SCANNERS) {
    if (!wanted.has(scanner.group)) continue
    raw.push(...(await scanner.probe(ctx, new Set(raw.map((r) => r.path)))))
  }

  const sized = await sizeAll(raw, opts.onProgress)
  const hidden = sized.filter((c) => c.bytes < opts.minSizeBytes)
  opts.onHidden?.(hidden.length, hidden.reduce((sum, c) => sum + c.bytes, 0))
  return sized
    .filter((c) => c.bytes >= opts.minSizeBytes)
    .sort((a, b) => b.bytes - a.bytes)
}
