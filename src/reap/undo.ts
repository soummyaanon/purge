import fs from 'node:fs/promises'
import path from 'node:path'
import type { ReapedItem, RunManifest } from '../types.ts'
import { rewriteManifest } from './manifest.ts'

export type UndoResult = {
  restored: ReapedItem[]
  skipped: Array<{ path: string; reason: string }>
}

/**
 * The run `purge undo` acts on: the newest --trash run not already undone.
 * Plain runs deleted for real and have nothing to restore.
 */
export function pickUndoable(runs: RunManifest[]): RunManifest | null {
  const newestFirst = [...runs].sort((a, b) => b.ts.localeCompare(a.ts))
  return newestFirst.find((r) => r.mode === 'trash' && r.undoneAt === undefined) ?? null
}

async function exists(p: string): Promise<boolean> {
  return fs.lstat(p).then(() => true, () => false)
}

/**
 * Moves every item of a --trash run back where it came from. This module
 * only ever renames — it never deletes, so the reaper stays the one module
 * with destructive power. A manifest is user-editable JSON, so each move is
 * checked: the source must be inside ~/.Trash and the destination inside
 * home, and nothing that exists again is ever overwritten.
 */
export async function undo(
  m: RunManifest,
  ctx: { home: string; manifestFile?: string },
): Promise<UndoResult> {
  const home = path.resolve(ctx.home)
  const trashDir = path.join(home, '.Trash')
  const restored: ReapedItem[] = []
  const skipped: UndoResult['skipped'] = []

  for (const item of m.items) {
    if (item.trashedTo === undefined) {
      skipped.push({ path: item.path, reason: 'was deleted, not moved to the Trash' })
      continue
    }
    const from = path.resolve(item.trashedTo)
    const to = path.resolve(item.path)
    if (!to.startsWith(home + path.sep)) {
      skipped.push({ path: item.path, reason: 'outside your home directory' })
      continue
    }
    if (!from.startsWith(trashDir + path.sep)) {
      skipped.push({ path: item.path, reason: 'source is not inside the Trash' })
      continue
    }
    if (await exists(to)) {
      skipped.push({ path: item.path, reason: 'path exists again — left alone' })
      continue
    }
    if (!(await exists(from))) {
      skipped.push({ path: item.path, reason: 'no longer in the Trash' })
      continue
    }
    try {
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.rename(from, to)
      restored.push(item)
    } catch (err) {
      skipped.push({ path: item.path, reason: (err as NodeJS.ErrnoException).code ?? String(err) })
    }
  }

  if (ctx.manifestFile !== undefined) {
    try {
      await rewriteManifest(ctx.manifestFile, { ...m, undoneAt: new Date().toISOString() })
    } catch { /* the restore already happened; a stale marker is the lesser problem */ }
  }
  return { restored, skipped }
}
