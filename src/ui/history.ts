import type { RunManifest } from '../types.ts'
import { formatBytes } from '../util/bytes.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '??? ??'
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')}`
}

export function renderHistory(runs: RunManifest[], opts: { color: boolean }): string {
  const dim = opts.color ? (s: string) => `\x1b[2m${s}\x1b[0m` : (s: string) => s
  const bold = opts.color ? (s: string) => `\x1b[1m${s}\x1b[0m` : (s: string) => s

  if (runs.length === 0) return '\n  no runs yet — run `purge` to reclaim some space\n'

  const lines = ['']
  for (const r of runs) {
    const tag = r.undoneAt !== undefined ? '  undone' : r.mode === 'trash' ? '  trash' : ''
    lines.push(`  ${shortDate(r.ts)}  ${formatBytes(r.freedBytes).padStart(9)}   ${dim(r.groups.join(', '))}${dim(tag)}`)
  }
  // An undone run put everything back, so it reclaimed nothing net.
  const lifetime = runs.filter((r) => r.undoneAt === undefined).reduce((n, r) => n + r.freedBytes, 0)
  lines.push('', bold(`  lifetime reclaimed: ${formatBytes(lifetime)}`), '')
  return lines.join('\n')
}
