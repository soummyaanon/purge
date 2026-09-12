import type { Group, Reviewed, RunManifest } from '../types.ts'
import { formatBytes } from '../util/bytes.ts'

export const HEADERS: Record<Group, string> = {
  builds: 'BUILD ARTIFACTS',
  pkg: 'PACKAGE CACHES',
  xcode: 'XCODE',
  caches: 'APP CACHES',
  browsers: 'BROWSER CACHES',
  editors: 'EDITOR CACHES',
  agents: 'CODING AGENTS',
  logs: 'LOGS',
  orphans: 'ORPHANED APP DATA',
  heavy: 'HEAVY ITEMS',
}

export const ORDER: Group[] = [
  'builds', 'pkg', 'xcode', 'caches', 'browsers', 'editors', 'agents', 'logs', 'orphans', 'heavy',
]

type Paint = (s: string) => string
const plain: Paint = (s) => s

function palette(color: boolean) {
  if (!color) return { bold: plain, dim: plain, cyan: plain, yellow: plain, green: plain }
  const wrap = (code: string): Paint => (s) => `\x1b[${code}m${s}\x1b[0m`
  return { bold: wrap('1'), dim: wrap('2'), cyan: wrap('36'), yellow: wrap('33'), green: wrap('32') }
}

/** Replaces the home prefix with ~ so output is readable and screenshot-safe. */
export function tildify(p: string, home: string): string {
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

export function renderReport(items: Reviewed[], opts: { color: boolean; home: string }): string {
  const c = palette(opts.color)
  const lines: string[] = []

  for (const group of ORDER) {
    const inGroup = items.filter((i) => i.group === group)
    if (inGroup.length === 0) continue

    const total = inGroup.reduce((n, i) => n + i.bytes, 0)
    lines.push('', `${c.bold(HEADERS[group])}  ${c.dim(formatBytes(total))}`)

    for (const i of inGroup) {
      // '[-]' marks a row that exists for information only and cannot be checked.
      const box = !i.selectable ? '[-]' : i.selected ? '[x]' : '[ ]'
      // A guard warning that repeats the scanner note verbatim (Service
      // Worker says the same thing in both) would otherwise print twice.
      const note = i.note && !i.warnings.includes(i.note) ? c.dim(`  ${i.note}`) : ''
      const warn = i.warnings.length > 0 ? c.yellow(`  ! ${i.warnings.join(', ')}`) : ''
      lines.push(`  ${box} ${formatBytes(i.bytes).padStart(9)}  ${c.cyan(tildify(i.path, opts.home))}${note}${warn}`)
    }
  }

  const selected = items.filter((i) => i.selected && i.selectable).reduce((n, i) => n + i.bytes, 0)
  lines.push('', c.bold(`reclaimable: ${formatBytes(selected)}`))
  return lines.join('\n')
}

export function renderJson(items: Reviewed[]): string {
  return JSON.stringify(
    {
      reclaimableBytes: items
        .filter((i) => i.selected && i.selectable)
        .reduce((n, i) => n + i.bytes, 0),
      items: items.map((i) => ({
        path: i.path, bytes: i.bytes, group: i.group,
        selected: i.selected, selectable: i.selectable,
        dangerous: i.dangerous === true, warnings: i.warnings,
      })),
    },
    null, 2,
  )
}

export const REPO_URL = 'github.com/soummyaanon/purge'

/**
 * `runCount` is how many manifests exist after this run. The star line shows
 * on a user's first three runs and then never again — one ask, at the one
 * moment the tool has visibly earned it, and no state beyond the manifests
 * purge already writes.
 */
export function renderSummary(
  m: RunManifest,
  opts: { color: boolean; home?: string; runCount?: number },
): string {
  const c = palette(opts.color)
  const home = opts.home ?? ''
  const trash = m.mode === 'trash'
  const lines = [
    '',
    c.green(c.bold(`${trash ? 'moved to Trash' : 'reclaimed'}: ${formatBytes(m.freedBytes)}`)),
  ]
  if (trash) lines.push(c.dim('empty the Trash to free the space · `purge undo` puts everything back.'))
  lines.push(c.dim('restart any browser or editor that was running.'))

  const failed = m.failed ?? []
  if (failed.length > 0) {
    lines.push('', c.yellow(`could not delete ${failed.length} item(s):`))
    for (const f of failed) {
      lines.push(`  ${formatBytes(f.bytes).padStart(9)}  ${c.cyan(tildify(f.path, home))}  ${c.dim(f.reason)}`)
    }
  }

  if (opts.runCount !== undefined && opts.runCount <= 3 && m.freedBytes > 0) {
    lines.push('', c.dim(`if purge helped, a ★ on ${REPO_URL} helps others find it.`))
  }
  return lines.join('\n')
}
