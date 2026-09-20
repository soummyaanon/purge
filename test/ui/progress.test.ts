import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spinnerFrame, barLine, scanLine, reapLine, banner, wordmark, shimmerWordmark } from '../../src/ui/progress.ts'

test('spinner cycles through distinct frames and wraps around', () => {
  const a = spinnerFrame(0)
  const b = spinnerFrame(1)
  assert.notEqual(a, b)
  assert.equal(spinnerFrame(0), spinnerFrame(10)) // 10 frames, wraps
})

test('bar fills proportionally and clamps at the ends', () => {
  assert.equal(barLine(0, 100, 10), '░'.repeat(10))
  assert.equal(barLine(50, 100, 10), '█'.repeat(5) + '░'.repeat(5))
  assert.equal(barLine(100, 100, 10), '█'.repeat(10))
  assert.equal(barLine(150, 100, 10), '█'.repeat(10), 'over-total must clamp')
  assert.equal(barLine(5, 0, 10), '░'.repeat(10), 'zero total must not divide by zero')
})

test('scan line reports count and cumulative size', () => {
  const line = scanLine(3, 17, 3.2 * 1024 ** 3)
  assert.match(line, /17 sized/)
  assert.match(line, /3\.2 GB/)
  assert.equal(line.startsWith(spinnerFrame(3)), true)
})

test('banner is two rows of block letters plus the version', () => {
  const lines = banner('0.2.0').split('\n')
  assert.equal(lines.length, 2)
  assert.match(banner('0.2.0'), /v0\.2\.0/)
})

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

test('shimmer wordmark is the plain wordmark with only color added', () => {
  assert.equal(shimmerWordmark(0, false), wordmark(), 'no color means no escapes at all')
  const t0 = shimmerWordmark(0, true)
  const t3 = shimmerWordmark(3, true)
  assert.notEqual(t0, t3, 'the band must move between ticks')
  assert.equal(strip(t0), wordmark())
  assert.equal(strip(t3), wordmark())
})

test('colored scan and reap lines strip back to the plain ones', () => {
  assert.equal(strip(scanLine(3, 17, 1024, true)), scanLine(3, 17, 1024))
  assert.equal(strip(reapLine(512, 1024, true)), reapLine(512, 1024))
  assert.match(scanLine(3, 17, 1024, true), /38;5;/, 'expects 256-color output')
})

import { scanText, liveBlock } from '../../src/ui/progress.ts'

test('scan text is the scan line without its spinner', () => {
  assert.equal(scanLine(3, 17, 1024), `${spinnerFrame(3)} ${scanText(17, 1024)}`)
  assert.equal(strip(scanText(17, 1024, true)), scanText(17, 1024))
  assert.match(scanText(17, 1024, true), /38;5;/)
})

/** The smallest stand-in for a terminal that records what was written. */
function recorder(tty: boolean) {
  const writes: string[] = []
  const stream = { isTTY: tty, write: (s: string) => { writes.push(s); return true } }
  return { stream: stream as unknown as NodeJS.WriteStream, writes }
}

test('live block writes nothing off a TTY', () => {
  const { stream, writes } = recorder(false)
  const block = liveBlock(stream)
  block.update(['a', 'b'])
  block.done()
  assert.deepEqual(writes, [])
})

test('live block clears each row as it draws and leaves the cursor on the last row', () => {
  const { stream, writes } = recorder(true)
  liveBlock(stream).update(['one', 'two', 'three'])
  assert.equal(writes.join(''), '\r\x1b[2Kone\n\x1b[2Ktwo\n\x1b[2Kthree')
})

test('live block moves back to its top row before redrawing', () => {
  const { stream, writes } = recorder(true)
  const block = liveBlock(stream)
  block.update(['one', 'two', 'three'])
  writes.length = 0
  block.update(['uno', 'dos', 'tres'])
  assert.equal(writes.join(''), '\r\x1b[2A\x1b[2Kuno\n\x1b[2Kdos\n\x1b[2Ktres')
})

test('live block never emits a zero-line cursor move for a one-row block', () => {
  // ESC[0A moves one line on some terminals, so a one-row block would creep upward.
  const { stream, writes } = recorder(true)
  const block = liveBlock(stream)
  block.update(['only'])
  block.update(['still'])
  assert.doesNotMatch(writes.join(''), /\x1b\[0A/)
  assert.equal(writes.join(''), '\r\x1b[2Konly\r\x1b[2Kstill')
})

test('live block done erases the block and parks the cursor on its first row', () => {
  const { stream, writes } = recorder(true)
  const block = liveBlock(stream)
  block.update(['one', 'two', 'three'])
  writes.length = 0
  block.done()
  assert.equal(writes.join(''), '\r\x1b[2A\x1b[J')
})

test('live block done before any update writes nothing', () => {
  const { stream, writes } = recorder(true)
  liveBlock(stream).done()
  assert.deepEqual(writes, [])
})
