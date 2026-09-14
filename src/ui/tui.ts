import readline from 'node:readline'
import os from 'node:os'
import type { Reviewed } from '../types.ts'
import { initState, reduce, renderFrame, type TuiState } from './tui-state.ts'
import { shimmerWordmark } from './progress.ts'

// The escape character MUST be written as \x1b. A literal ESC byte pasted
// into source is invisible in most editors and silently lost when the file is
// copied through tooling — which produces a TUI that prints '[?1049h[2J[H'
// instead of drawing, and never restores the terminal.
const ALT_ENTER = '\x1b[?1049h'
const ALT_EXIT = '\x1b[?1049l'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const CLEAR = '\x1b[2J\x1b[H'

function keyName(
  str: string, key: { name?: string; ctrl?: boolean; shift?: boolean }, filtering: boolean,
): string | null {
  if (key.ctrl && key.name === 'c') return 'q'
  if (key.name === 'tab') return key.shift === true ? 'prev-item' : 'next-item'

  // While the filter line is open, printable characters are query text and
  // only enter/escape/backspace keep their meaning.
  if (filtering) {
    switch (key.name) {
      case 'return': return 'enter'
      case 'escape': return 'escape'
      case 'backspace': return 'backspace'
      // Arrow keys still navigate the narrowed list while typing.
      case 'up': return 'up'
      case 'down': return 'down'
    }
    return typeof str === 'string' && str.length === 1 && str >= ' ' ? `char:${str}` : null
  }

  switch (key.name) {
    case 'up': case 'k': return 'up'
    case 'down': case 'j': return 'down'
    case 'left': case 'h': return 'fold'
    case 'right': case 'l': return 'unfold'
    case 'return': return 'enter'
    case 'space': return 'space'
    case 'escape': return 'escape'
    case 'q': return 'q'
    case 'a': return 'a'
    case 'g': return str === 'G' ? 'G' : 'g'
    default: {
      if (str === ' ') return 'space'
      if (str === '/') return 'filter-start'
      return null
    }
  }
}

/**
 * Full-screen checkbox review. Resolves with the user's selection, or null
 * if they quit. Restores the terminal on every exit path, including SIGINT.
 */
export function review(items: Reviewed[], hidden?: TuiState['hidden']): Promise<Reviewed[] | null> {
  return new Promise((resolve) => {
    const out = process.stdout
    let state: TuiState = initState(items, hidden)

    let tick = 0
    const draw = () => {
      out.write(CLEAR)
      const color = out.isTTY === true
      // Wordmark takes 3 rows (2 letters + 1 blank); the frame gets the rest.
      out.write(`${shimmerWordmark(tick, color)}\n\n`)
      out.write(renderFrame(state, Math.max((out.rows ?? 24) - 3, 8), {
        color, home: os.homedir(), width: out.columns ?? 80,
      }))
    }

    // The shimmer sweep. Only the wordmark animates, and only on a real TTY.
    const shimmer = out.isTTY === true
      ? setInterval(() => { tick++; draw() }, 120)
      : undefined

    const restore = () => {
      if (shimmer !== undefined) clearInterval(shimmer)
      process.stdin.setRawMode?.(false)
      process.stdin.pause()
      out.write(SHOW_CURSOR)
      out.write(ALT_EXIT)
      process.off('SIGINT', onSigint)
    }

    const onSigint = () => { restore(); resolve(null) }

    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    out.write(ALT_ENTER)
    out.write(HIDE_CURSOR)
    process.on('SIGINT', onSigint)

    process.stdin.on('keypress', (str: string, key: { name?: string; ctrl?: boolean; shift?: boolean }) => {
      const name = keyName(str, key ?? {}, state.filtering)
      if (name === null) return
      state = reduce(state, name)
      if (state.done === 'quit') { restore(); return resolve(null) }
      if (state.done === 'confirm') { restore(); return resolve(state.items) }
      draw()
    })

    draw()
  })
}
