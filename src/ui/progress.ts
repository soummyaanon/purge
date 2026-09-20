import { formatBytes } from '../util/bytes.ts'

/**
 * Live-progress rendering. Everything here is a pure string function so it
 * can be unit-tested; the only thing that touches the terminal is LiveLine,
 * and it refuses to animate when stdout is not a TTY.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * The purge palette: cyan for what moves, blue for numbers, gray for chrome.
 * 256-color codes — every terminal from Terminal.app up understands them,
 * and everything falls back to plain text when color is off.
 */
export const INK = {
  cyan: '38;5;81',
  brightCyan: '38;5;51',
  blue: '38;5;75',
  steel: '38;5;67',
  gray: '38;5;245',
  dim: '38;5;240',
} as const

const fg = (code: string, s: string) => `\x1b[${code}m${s}\x1b[0m`

export function spinnerFrame(tick: number): string {
  return FRAMES[tick % FRAMES.length] as string
}

export function barLine(done: number, total: number, width: number): string {
  const ratio = total > 0 ? Math.min(done / total, 1) : 0
  const filled = Math.round(ratio * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** The scan status without a spinner, for when the mascot is the liveness signal. */
export function scanText(sized: number, bytes: number, color = false): string {
  if (!color) return `scanning  ${sized} sized · ${formatBytes(bytes)} found`
  return `${fg(INK.gray, 'scanning')}  ` +
    `${fg(INK.blue, `${sized} sized`)}${fg(INK.dim, ' · ')}${fg(INK.cyan, `${formatBytes(bytes)} found`)}`
}

export function scanLine(tick: number, sized: number, bytes: number, color = false): string {
  const spinner = color ? fg(INK.brightCyan, spinnerFrame(tick)) : spinnerFrame(tick)
  return `${spinner} ${scanText(sized, bytes, color)}`
}

export function reapLine(freedBytes: number, totalBytes: number, color = false): string {
  const bar = barLine(freedBytes, totalBytes, 24)
  if (!color) return `[${bar}]  ${formatBytes(freedBytes)} / ${formatBytes(totalBytes)} freed`
  // The filled half shimmers cyan→blue across its length; the rest is gray.
  const filled = bar.replace(/░.*$/, '')
  const empty = bar.slice(filled.length)
  const shades = [INK.brightCyan, INK.cyan, INK.blue, INK.steel]
  const painted = [...filled]
    .map((c, i) => fg(shades[Math.floor((i / 24) * shades.length)] ?? INK.blue, c))
    .join('')
  return `${fg(INK.dim, '[')}${painted}${fg(INK.dim, `${empty}]`)}  ` +
    `${fg(INK.cyan, formatBytes(freedBytes))}${fg(INK.dim, ' / ')}${fg(INK.blue, `${formatBytes(totalBytes)} freed`)}`
}

/**
 * Two rows of half-block letters. The name is short enough that this stays
 * well under 40 columns and never wraps on a sane terminal.
 */
const MARK = ['█▀█ █ █ █▀█ █▀▀ █▀▀', '█▀▀ █▄█ █▀▄ █▄█ ██▄'] as const

export function wordmark(): string {
  return MARK.join('\n')
}

/**
 * The wordmark with a bright band sweeping left to right — steel-blue base,
 * cyan crest two columns wide. Pure in `tick`, so a frame is testable and
 * stripping the escapes always yields the plain wordmark.
 */
export function shimmerWordmark(tick: number, color: boolean): string {
  if (!color) return wordmark()
  const width = MARK[0]?.length ?? 0
  const crest = (tick * 2) % (width + 8) - 4 // starts off-screen, sweeps past the end
  return MARK.map((line) =>
    [...line]
      .map((ch, x) => {
        if (ch === ' ') return ch
        const d = Math.abs(x - crest)
        return fg(d <= 1 ? INK.brightCyan : d <= 3 ? INK.cyan : INK.steel, ch)
      })
      .join(''),
  ).join('\n')
}

export function banner(version: string): string {
  return `${MARK[0]}\n${MARK[1]}  v${version} — say purge to the junk on your Mac`
}

/** Rewrites one terminal line in place. Inert (still safe to call) off-TTY. */
export function liveLine(stream: NodeJS.WriteStream) {
  const tty = stream.isTTY === true
  return {
    update(s: string) {
      if (tty) stream.write(`\r\x1b[2K${s}`)
    },
    done(finalText?: string) {
      if (!tty) return
      stream.write('\r\x1b[2K')
      if (finalText !== undefined) stream.write(`${finalText}\n`)
    },
  }
}

/**
 * Rewrites a block of terminal rows in place — the multi-row sibling of
 * liveLine, for the mascot beside a status line. Every call must pass the
 * same number of rows: the cursor climbs back over the rows drawn last time,
 * so a shrinking block would leave its tail on screen. Inert off-TTY.
 */
export function liveBlock(stream: NodeJS.WriteStream) {
  const tty = stream.isTTY === true
  let drawn = 0
  // ESC[nA with n = 0 still moves one line on some terminals, so a one-row
  // block must not emit it at all.
  const toTop = () => (drawn > 1 ? `\x1b[${drawn - 1}A` : '')
  return {
    update(rows: string[]) {
      if (!tty) return
      stream.write(`\r${toTop()}${rows.map((r) => `\x1b[2K${r}`).join('\n')}`)
      drawn = rows.length
    },
    done() {
      if (!tty || drawn === 0) return
      stream.write(`\r${toTop()}\x1b[J`)
      drawn = 0
    },
  }
}
