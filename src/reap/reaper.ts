import fs from 'node:fs/promises'
import path from 'node:path'
import type { Reviewed, RunManifest, ReapedItem, FailedItem, Group } from '../types.ts'
import { applyGuards, type GuardContext } from '../guard/index.ts'
import { writeManifest } from './manifest.ts'

export type ReapResult = {
  manifest: RunManifest & { failed: FailedItem[] }
  /** Where the manifest was saved, or null when ~/.purge was not writable. */
  manifestPath: string | null
}

/**
 * THE ONLY MODULE IN purge THAT DELETES ANYTHING.
 *
 * Do not add fs.rm, fs.unlink or fs.rmdir anywhere else in src/. CI enforces
 * this by grep — see .github/workflows/ci.yml.
 *
 * Every path is re-validated through the full guard pipeline immediately
 * before removal. The user may have spent minutes in the review screen, and
 * in that window a directory can be replaced by a symlink, moved onto another
 * volume, or committed to git. Trusting the scan-time verdict would be a
 * time-of-check-to-time-of-use bug with rm -rf on the other end.
 */
export async function reap(
  items: Reviewed[],
  ctx: GuardContext,
  opts: {
    version: string
    runsDir: string
    /** Called after each successful removal with cumulative freed bytes. */
    onProgress?: (freedBytes: number, totalBytes: number) => void
    /**
     * Ctrl+C. The loop stops at the next item boundary — never mid-rm, which
     * would leave a half-deleted tree — and the manifest still records
     * everything that was removed before the signal fired.
     */
    signal?: AbortSignal
    /**
     * Move each item into ~/.Trash with fs.rename instead of removing it.
     * Home and the Trash share a volume (the volume guard blocks anything
     * else), so the move is instant and `purge undo` can reverse it.
     */
    trash?: boolean
  },
): Promise<ReapResult> {
  const trashDir = path.join(path.resolve(ctx.home), '.Trash')
  // selectable:false means a guard returned 'report'. Filtered here AND
  // re-checked against the fresh verdict below, so a caller that forged
  // selected:true still cannot delete one. A dangerous row (orphans, heavy)
  // passes — but only when its exact warning was shown to the user, which
  // the known-warnings check below enforces.
  const wanted = items.filter((i) => i.selected && i.selectable)

  // What each item was already warned about when the user chose it.
  const known = new Map(wanted.map((i) => [i.path, new Set(i.warnings)]))

  // Re-run the guards. Anything now blocked disappears from this list.
  const revalidated = await applyGuards(wanted, ctx)
  const fresh = new Map(revalidated.map((r) => [r.path, r]))

  const reaped: ReapedItem[] = []
  const failed: FailedItem[] = []
  for (const item of wanted) {
    if (opts.signal?.aborted === true) break
    const now = fresh.get(item.path)
    if (now === undefined) continue // a guard blocks it now
    // A guard now says report-only. Never delete, whatever the caller asked.
    if (!now.selectable) continue
    const nowWarns = now.warnings

    // A warning that appeared AFTER the user chose is an objection they never
    // saw — for instance they ran `git add dist && commit` while reading the
    // review screen. Skip it. A warning they already saw and checked anyway
    // is their decision and is honoured.
    if (nowWarns.some((w) => !(known.get(item.path)?.has(w) ?? false))) continue
    try {
      // The Trash cannot be moved into itself; that one row is always removed.
      if (opts.trash === true && path.resolve(item.path) !== trashDir) {
        await fs.mkdir(trashDir, { recursive: true })
        const dest = await freeTrashName(trashDir, path.basename(item.path))
        await fs.rename(item.path, dest)
        reaped.push({ path: item.path, bytes: item.bytes, group: item.group, trashedTo: dest })
      } else {
        await fs.rm(item.path, { recursive: true, force: true })
        reaped.push({ path: item.path, bytes: item.bytes, group: item.group })
      }
      opts.onProgress?.(
        reaped.reduce((n, r) => n + r.bytes, 0),
        wanted.reduce((n, w) => n + w.bytes, 0),
      )
    } catch (err) {
      // Permission denied and friends. Never fatal — but never silent either:
      // the user chose this path and deserves to know it is still there.
      const code = (err as NodeJS.ErrnoException).code
      const reason = code ?? (err instanceof Error ? err.message : String(err))
      failed.push({ path: item.path, bytes: item.bytes, group: item.group, reason })
    }
  }

  const groups = [...new Set(reaped.map((r) => r.group))] as Group[]
  const manifest: ReapResult['manifest'] = {
    ts: new Date().toISOString(),
    version: opts.version,
    freedBytes: reaped.reduce((n, r) => n + r.bytes, 0),
    groups,
    items: reaped,
    failed,
    mode: opts.trash === true ? 'trash' : 'rm',
  }

  // A record that cannot be saved must not throw away the summary of what
  // was just deleted — that is the one moment the user most needs it.
  let manifestPath: string | null = null
  try {
    manifestPath = await writeManifest(opts.runsDir, manifest)
  } catch { /* ~/.purge unwritable — cli.ts warns */ }
  return { manifest, manifestPath }
}

/** True only when nothing is at `p`. Any error other than ENOENT counts as occupied. */
async function isFree(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return false
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

/**
 * A destination in the Trash that nothing occupies. rename(2) would silently
 * replace a file of the same name, so the name is checked first and suffixed
 * the way Finder does when two `.next` directories arrive in one run.
 */
async function freeTrashName(trashDir: string, base: string): Promise<string> {
  const plain = path.join(trashDir, base)
  if (await isFree(plain)) return plain
  for (let n = 2; n < 1000; n++) {
    const p = path.join(trashDir, `${base} (purge ${n})`)
    if (await isFree(p)) return p
  }
  return path.join(trashDir, `${base} (purge ${Date.now()})`)
}
