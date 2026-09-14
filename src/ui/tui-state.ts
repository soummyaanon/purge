import type { Group, Reviewed } from '../types.ts'
import { formatBytes } from '../util/bytes.ts'
import { HEADERS, ORDER, tildify } from './render.ts'

export type Row =
  | { kind: 'header'; group: Group; bytes: number; count: number }
  | { kind: 'item'; index: number }

export type TuiState = {
  items: Reviewed[]
  rows: Row[]
  cursor: number
  done: 'pending' | 'confirm' | 'quit'
  /** Groups whose item rows are folded away. */
  collapsed: Group[]
  /** Case-insensitive substring applied to item paths and labels. */
  filter: string
  /** True while the user is typing in the filter line. */
  filtering: boolean
  hidden?: { count: number; bytes: number; minSizeBytes: number }
}

function matches(it: Reviewed, filter: string): boolean {
  if (filter === '') return true
  const f = filter.toLowerCase()
  return it.path.toLowerCase().includes(f) || it.label.toLowerCase().includes(f)
}

/**
 * Rows are always derived from (items, collapsed, filter), never edited in
 * place. A group with no matching items disappears entirely; a collapsed
 * group keeps its header so it can be unfolded.
 */
function buildRows(items: Reviewed[], collapsed: Group[], filter: string): Row[] {
  const rows: Row[] = []
  for (const group of ORDER) {
    const visible = items
      .map((it, i) => [it, i] as const)
      .filter(([it]) => it.group === group && matches(it, filter))
    if (visible.length === 0) continue
    rows.push({
      kind: 'header', group,
      bytes: visible.reduce((n, [it]) => n + it.bytes, 0),
      count: visible.length,
    })
    if (collapsed.includes(group)) continue
    for (const [, i] of visible) rows.push({ kind: 'item', index: i })
  }
  return rows
}

function clamp(cursor: number, rows: Row[]): number {
  return Math.max(0, Math.min(cursor, rows.length - 1))
}

/** The group a row belongs to: its own for headers, the enclosing one for items. */
function groupAt(s: TuiState, cursor: number): Group | null {
  for (let i = cursor; i >= 0; i--) {
    const row = s.rows[i]
    if (row?.kind === 'header') return row.group
  }
  return null
}

function rebuilt(s: TuiState, over: Partial<TuiState>): TuiState {
  const next = { ...s, ...over }
  const rows = buildRows(next.items, next.collapsed, next.filter)
  return { ...next, rows, cursor: clamp(next.cursor, rows) }
}

export function initState(items: Reviewed[], hidden?: TuiState['hidden']): TuiState {
  const rows = buildRows(items, [], '')
  const cursor = rows.findIndex((r) => r.kind === 'item')
  return {
    items, rows, cursor: cursor === -1 ? 0 : cursor, done: 'pending',
    collapsed: [], filter: '', filtering: false, hidden,
  }
}

export function selectedBytes(s: TuiState): number {
  return s.items.filter((i) => i.selected && i.selectable).reduce((n, i) => n + i.bytes, 0)
}

/**
 * Every item a bulk toggle (select-all, the group checkbox) may touch:
 * selectable, not dangerous, and let through by the current filter. A
 * dangerous row (orphans, heavy) can only be checked one at a time, on the
 * row itself — never swept up by `a` or a header press.
 */
function bulkToggleable(s: TuiState, group?: Group): Reviewed[] {
  return s.items.filter(
    (i) => i.selectable && i.dangerous !== true && matches(i, s.filter)
      && (group === undefined || i.group === group),
  )
}

function setSelected(s: TuiState, target: (it: Reviewed) => boolean, on: boolean): TuiState {
  return rebuilt(s, { items: s.items.map((it) => (target(it) ? { ...it, selected: on } : it)) })
}

/** Pure. Never mutates `s` — the tests depend on this. */
export function reduce(s: TuiState, key: string): TuiState {
  if (key.startsWith('char:')) {
    if (!s.filtering) return s
    return rebuilt(s, { filter: s.filter + key.slice(5) })
  }

  switch (key) {
    case 'up': return { ...s, cursor: clamp(s.cursor - 1, s.rows) }
    case 'down': return { ...s, cursor: clamp(s.cursor + 1, s.rows) }
    case 'g': return { ...s, cursor: 0 }
    case 'G': return { ...s, cursor: clamp(s.rows.length - 1, s.rows) }

    // Tab hops checkbox-to-checkbox: headers are skipped and the ends wrap,
    // so one keystroke always lands on a particular box.
    case 'next-item': case 'prev-item': {
      const dir = key === 'next-item' ? 1 : -1
      const n = s.rows.length
      for (let step = 1; step <= n; step++) {
        const i = (((s.cursor + dir * step) % n) + n) % n
        if (s.rows[i]?.kind === 'item') return { ...s, cursor: i }
      }
      return s
    }

    case 'space': {
      const row = s.rows[s.cursor]
      if (row === undefined) return s
      if (row.kind === 'header') {
        const inGroup = bulkToggleable(s, row.group)
        if (inGroup.length === 0) return s // all-dangerous groups have no bulk toggle
        const allOn = inGroup.every((i) => i.selected)
        return setSelected(s, (it) => it.group === row.group && it.selectable && it.dangerous !== true && matches(it, s.filter), !allOn)
      }
      // A report-only row is shown but never checkable. A dangerous row
      // (orphans, heavy) IS checkable — here, on the row itself, and only here.
      if (s.items[row.index]?.selectable === false) return s
      const items = s.items.map((it, i) => (i === row.index ? { ...it, selected: !it.selected } : it))
      return { ...s, items }
    }

    case 'a': {
      const visible = bulkToggleable(s)
      const allOn = visible.length > 0 && visible.every((i) => i.selected)
      return setSelected(s, (it) => it.selectable && it.dangerous !== true && matches(it, s.filter), !allOn)
    }

    case 'fold': case 'unfold': {
      const group = groupAt(s, s.cursor)
      if (group === null) return s
      const collapsed = key === 'fold'
        ? (s.collapsed.includes(group) ? s.collapsed : [...s.collapsed, group])
        : s.collapsed.filter((g) => g !== group)
      // A no-op fold/unfold must not move the cursor either.
      if (collapsed.length === s.collapsed.length) return s
      const next = rebuilt(s, { collapsed })
      const header = next.rows.findIndex((r) => r.kind === 'header' && r.group === group)
      return { ...next, cursor: header === -1 ? next.cursor : header }
    }

    case 'filter-start': return { ...s, filtering: true }
    case 'backspace': {
      if (!s.filtering) return s
      return rebuilt(s, { filter: s.filter.slice(0, -1) })
    }
    case 'escape': {
      // Escape only clears the filter. It never quits: discarding minutes of
      // checkbox work on a reflex keypress is worse than a dead key.
      if (!s.filtering && s.filter === '') return s
      const next = rebuilt(s, { filter: '', filtering: false })
      const item = next.rows.findIndex((r) => r.kind === 'item')
      return { ...next, cursor: item === -1 ? next.cursor : item }
    }
    case 'enter': {
      if (s.filtering) return { ...s, filtering: false }
      // Confirming while a filter hides checked rows would delete things the
      // user cannot currently see. Reveal everything first; the next enter
      // confirms what is actually on screen.
      if (s.filter !== '') {
        const hidden = s.items.some((i) => i.selected && i.selectable && !matches(i, s.filter))
        if (hidden) {
          const next = rebuilt(s, { filter: '' })
          const item = next.rows.findIndex((r) => r.kind === 'item')
          return { ...next, cursor: item === -1 ? next.cursor : item }
        }
      }
      return { ...s, done: 'confirm' }
    }
    case 'q': return { ...s, done: 'quit' }
    default: return s
  }
}

/** Middle-ellipsize so both the start and, mostly, the tail of a path survive. */
export function ellipsizeMiddle(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 1) return '…'
  const tail = Math.ceil((max - 1) * 0.6)
  const head = max - 1 - tail
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`
}

function cutEnd(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`
}

const MIN_PATH = 12

/**
 * Shrinks one item row to `width` columns. The path gives way first (middle
 * ellipsis, tail kept); if that leaves too little of it, the note goes; the
 * warning is cut last because it is the one thing the user must not miss.
 */
function fitRow(
  r: { prefix: string; path: string; note: string; warn: string }, width: number | undefined,
): { path: string; note: string; warn: string } {
  if (width === undefined) return r
  let { note, warn } = r
  let budget = width - r.prefix.length - note.length - warn.length
  if (budget < MIN_PATH && note !== '') { budget += note.length; note = '' }
  if (budget < MIN_PATH && warn !== '') {
    warn = cutEnd(warn, Math.max(0, width - r.prefix.length - MIN_PATH))
    budget = width - r.prefix.length - warn.length
  }
  return { path: ellipsizeMiddle(r.path, Math.max(1, budget)), note, warn }
}

/** One full screen of output. `height` is the terminal row count; `width` its columns. */
export function renderFrame(
  s: TuiState, height: number, opts: { color: boolean; home: string; width?: number },
): string {
  const paint = opts.color
    ? (code: string, str: string) => `\x1b[${code}m${str}\x1b[0m`
    : (_code: string, str: string) => str
  const fit = (str: string) => (opts.width === undefined ? str : cutEnd(str, opts.width))
  // The purge palette (see progress.ts INK): cyan headers, blue sizes, gray
  // chrome, a deep-blue bar for the cursor instead of harsh reverse video.
  const C = {
    header: '1;38;5;81', size: '38;5;75', chrome: '38;5;245', dim: '38;5;240',
    cursor: '48;5;24;38;5;195', accent: '1;38;5;51', warn: '38;5;179',
  }

  const footer = (s.filtering || s.filter !== '' ? 5 : 4) + (s.hidden?.count ? 1 : 0)
  const body = Math.max(3, height - footer)
  const start = Math.max(0, Math.min(s.cursor - Math.floor(body / 2), s.rows.length - body))
  const lines: string[] = []

  for (let i = start; i < Math.min(start + body, s.rows.length); i++) {
    const row = s.rows[i]
    if (row === undefined) break
    const here = i === s.cursor
    if (row.kind === 'header') {
      const mark = s.collapsed.includes(row.group) ? '▸' : '▾'
      // The header carries the group's aggregate checkbox so that toggling a
      // group — a folded one especially — has visible feedback. It reflects
      // only what space would toggle here, so an all-dangerous group shows
      // '[-]' even while a row inside it is individually checked.
      const inGroup = bulkToggleable(s, row.group)
      const on = inGroup.filter((it) => it.selected).length
      const box = inGroup.length === 0 ? '[-]' : on === 0 ? '[ ]' : on === inGroup.length ? '[x]' : '[~]'
      const name = `${mark} ${box} ${HEADERS[row.group]}`
      const stats = `${formatBytes(row.bytes)} (${row.count})`
      const text = fit(`${name}  ${stats}`)
      if (here) lines.push(paint(C.cursor, text))
      else if (text.length < `${name}  ${stats}`.length) lines.push(paint(C.header, text))
      else lines.push(`${paint(C.header, name)}  ${paint(C.chrome, stats)}`)
      continue
    }
    const it = s.items[row.index]
    if (it === undefined) continue
    // '[-]' marks a row that exists for information only and cannot be checked.
    const box = !it.selectable ? '[-]' : it.selected ? '[x]' : '[ ]'
    const size = formatBytes(it.bytes).padStart(9)
    const prefix = `   ${box} ${size}  `
    // Same de-duplication as renderReport: a warning that repeats the note
    // verbatim must not print the text twice.
    const r = fitRow({
      prefix,
      path: tildify(it.path, opts.home),
      note: it.note && !it.warnings.includes(it.note) ? `  ${it.note}` : '',
      warn: it.warnings.length > 0 ? `  ! ${it.warnings.join(', ')}` : '',
    }, opts.width)
    if (here) {
      lines.push(paint(C.cursor, `${prefix}${r.path}${r.note}${r.warn}`))
    } else {
      lines.push(
        `   ${paint(it.selected ? C.accent : C.chrome, box)} ${paint(C.size, size)}  ${r.path}`
        + (r.note ? paint(C.dim, r.note) : '') + (r.warn ? paint(C.warn, r.warn) : ''),
      )
    }
  }

  lines.push('')
  if (s.hidden?.count) lines.push(paint(C.dim, `  ${s.hidden.count} items under ${formatBytes(s.hidden.minSizeBytes)} hidden (${formatBytes(s.hidden.bytes)}) · --min-size 0 shows them`))
  if (s.filtering || s.filter !== '') {
    const query = opts.width === undefined ? s.filter : cutEnd(s.filter, Math.max(1, opts.width - 5))
    lines.push(`  ${paint(C.accent, '/')} ${query}${s.filtering ? paint('7', ' ') : ''}`)
  }
  lines.push(paint(C.dim, fit(s.filtering
    ? '  type to filter   ↑/↓ move   enter keep   esc clear'
    : '  tab box   space toggle   ←/→ fold   a all   / filter   g/G ends   enter go   q quit')))
  const selected = s.items.filter((i) => i.selected && i.selectable)
  lines.push(paint(C.accent, fit(`  selected: ${selected.length} items, ${formatBytes(selectedBytes(s))}`)))
  return lines.join('\n')
}
