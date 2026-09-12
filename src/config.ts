import fs from 'node:fs/promises'
import path from 'node:path'
import { ALL_GROUPS, GROUP_ALIASES, type Group } from './types.ts'

export type Config = {
  /** Glob patterns purge must never touch. */
  keep: string[]
  staleDays?: number
  minSize?: number
  groups?: Group[]
  /** Always move to ~/.Trash instead of deleting. */
  trash?: boolean
}

const EMPTY: Config = { keep: [] }

/**
 * Reads ~/.purgerc. A missing, unreadable or malformed file yields defaults
 * rather than an error — a broken config must never stop someone reclaiming
 * disk space, and every field it sets is only ever more conservative.
 */
export async function loadConfig(home: string): Promise<Config> {
  let raw: string
  try {
    raw = await fs.readFile(path.join(home, '.purgerc'), 'utf8')
  } catch {
    return { ...EMPTY }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...EMPTY }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY }

  const src = parsed as Record<string, unknown>
  const out: Config = { keep: [] }

  if (Array.isArray(src.keep) && src.keep.every((k) => typeof k === 'string')) {
    // Expand a leading ~/ against home. Candidate paths are always absolute,
    // so an unexpanded '~/Developer/x/**' would silently match nothing — and
    // a keep rule that quietly does nothing is worse than no keep rule at all.
    // The README documents exactly this form.
    out.keep = (src.keep as string[]).map((g) =>
      g.startsWith('~/') ? path.join(home, g.slice(2)) : g,
    )
  }
  if (typeof src.staleDays === 'number' && src.staleDays >= 0) out.staleDays = src.staleDays
  if (typeof src.minSize === 'number' && src.minSize >= 0) out.minSize = src.minSize
  if (typeof src.trash === 'boolean') out.trash = src.trash
  if (Array.isArray(src.groups)) {
    const groups = src.groups
      .map((g) => (typeof g === 'string' ? GROUP_ALIASES[g] ?? g : g))
      .filter((g): g is Group => (ALL_GROUPS as string[]).includes(g as string))
    // Assigned even when the filter leaves nothing: the user wrote an
    // explicit restriction, and an unrecognized one must narrow the scan to
    // nothing — never silently widen it back to every group.
    out.groups = groups
  }

  return out
}
