import { INK, scanText, reapLine } from './progress.ts'

/**
 * The purge mascot: a boxy little bot who looks for junk while the scan
 * runs, sweeps it off the edge while the reaper runs, and blinks while the
 * user reads the review screen. Pure in (mood, tick), so every frame is
 * testable and stripping the escapes always yields the plain sprite.
 *
 * Box-drawing and block characters only — no emoji. Emoji are two columns
 * wide in some terminals and one in others, and a sprite drawn beside live
 * text must never shift that text.
 */
export type Mood = 'scan' | 'clean' | 'idle'

type Seg = readonly [text: string, ink: string]

const BODY = INK.steel
const EYES = INK.brightCyan
const TOOL = INK.blue
const JUNK = INK.gray

/** Eyes dart every four ticks: centre, left, centre, right. */
const GLANCES = ['◕ ◕', '◕◕ ', '◕ ◕', ' ◕◕'] as const
/** One blink per period, one tick long, never on tick 0 (the first draw). */
const BLINK_PERIOD = 25
const SWEEP_PERIOD = 4

function eyes(mood: Mood, tick: number): string {
  if (mood === 'scan') return GLANCES[Math.floor(tick / 4) % GLANCES.length] as string
  if (mood === 'idle' && tick % BLINK_PERIOD === BLINK_PERIOD - 1) return '- -'
  return '◕ ◕'
}

function rows(mood: Mood, tick: number): Seg[][] {
  const top: Seg[] = [['╭───╮', BODY]]
  const face: Seg[] = [['│', BODY], [eyes(mood, tick), EYES], ['│', BODY]]
  const bottom: Seg[] = [['╰───╯', BODY]]

  if (mood === 'idle') return [top, face, bottom]
  if (mood === 'scan') return [top, [...face, ['─○', TOOL]], bottom]

  // The broom swings on alternate ticks; the pile at the edge loses a block
  // per tick and a fresh one appears when the sweep loops.
  const phase = tick % SWEEP_PERIOD
  const swing = phase % 2 === 0
  const pile = '▓▒░'.slice(phase).padStart(3)
  return [
    top,
    [...face, [swing ? '╯' : ' ╮', TOOL]],
    [...bottom, [swing ? '╱ ' : ' ╲', TOOL], [pile, JUNK]],
  ]
}

const fg = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`

/** Three rows, padded to one width, painted with the purge palette when `color`. */
export function mascotFrame(mood: Mood, tick: number, color = false): string[] {
  const segs = rows(mood, tick)
  const width = Math.max(...segs.map((r) => r.reduce((n, [t]) => n + [...t].length, 0)))
  return segs.map((r) => {
    const used = r.reduce((n, [t]) => n + [...t].length, 0)
    const painted = r.map(([t, ink]) => (color && t.trim() !== '' ? fg(ink, t) : t)).join('')
    return painted + ' '.repeat(width - used)
  })
}

const visibleWidth = (s: string) => [...s.replace(/\x1b\[[0-9;]*m/g, '')].length

/**
 * Puts two blocks side by side: the left one padded to its widest row, then
 * `gap` spaces, then the right. Pads by visible width so a shimmering
 * wordmark on the left still lines up. A shorter right block leaves the
 * left rows untouched; a shorter left block is padded with blank rows.
 */
export function beside(left: string[], right: string[], gap = 2): string[] {
  const width = Math.max(0, ...left.map(visibleWidth))
  const height = Math.max(left.length, right.length)
  const out: string[] = []
  for (let i = 0; i < height; i++) {
    const l = left[i] ?? ''
    const r = right[i]
    out.push(r === undefined ? l : `${l}${' '.repeat(width - visibleWidth(l) + gap)}${r}`)
  }
  return out
}

/** The bot with its magnifier out, the scan status on its middle row. */
export function scanBlock(tick: number, sized: number, bytes: number, color = false): string[] {
  return beside(mascotFrame('scan', tick, color), ['', scanText(sized, bytes, color), ''])
}

/** The bot sweeping, the reap progress bar on its middle row. */
export function reapBlock(tick: number, freedBytes: number, totalBytes: number, color = false): string[] {
  return beside(mascotFrame('clean', tick, color), ['', reapLine(freedBytes, totalBytes, color), ''])
}

/** Narrower than this and a block row wraps, which breaks in-place redraws. */
const MIN_COLUMNS = 60

/**
 * Whether to draw the mascot on `stream`: a real terminal, wide enough for
 * the bot plus a status line, and not switched off in ~/.purgerc. An
 * unknown width (some multiplexers report none) is taken as wide enough,
 * matching how the rest of the UI assumes 80 columns.
 */
export function wantsMascot(
  stream: { isTTY?: boolean; columns?: number }, enabled: boolean | undefined,
): boolean {
  if (enabled === false) return false
  if (stream.isTTY !== true) return false
  return (stream.columns ?? 80) >= MIN_COLUMNS
}
