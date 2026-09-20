import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mascotFrame, beside, type Mood } from '../../src/ui/mascot.ts'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
const MOODS: Mood[] = ['scan', 'clean', 'idle']

test('every mood is three rows of equal width', () => {
  for (const mood of MOODS) {
    for (const tick of [0, 1, 2, 3, 7, 24, 25]) {
      const rows = mascotFrame(mood, tick)
      assert.equal(rows.length, 3, `${mood}@${tick}`)
      const widths = new Set(rows.map((r) => [...r].length))
      assert.equal(widths.size, 1, `${mood}@${tick} rows differ in width: ${JSON.stringify(rows)}`)
    }
  }
})

test('the bot is a rounded box with two eyes', () => {
  const [top, face, bottom] = mascotFrame('idle', 0)
  assert.equal(top?.trimEnd(), '╭───╮')
  assert.equal(face?.trimEnd(), '│◕ ◕│')
  assert.equal(bottom?.trimEnd(), '╰───╯')
})

test('no color means no escape sequences at all', () => {
  for (const mood of MOODS) {
    assert.doesNotMatch(mascotFrame(mood, 5, false).join('\n'), /\x1b/, mood)
  }
})

test('colored frames strip back to the plain frames', () => {
  for (const mood of MOODS) {
    const colored = mascotFrame(mood, 5, true)
    assert.match(colored.join(''), /38;5;/, `${mood} should use the 256-color palette`)
    assert.deepEqual(colored.map(strip), mascotFrame(mood, 5, false), mood)
  }
})

test('scanning: the magnifier is out and the eyes dart', () => {
  assert.match(mascotFrame('scan', 0)[1] ?? '', /─○/)
  const faces = new Set([0, 4, 8, 12].map((t) => mascotFrame('scan', t)[1]))
  assert.ok(faces.size >= 2, 'eyes never move')
})

test('cleaning: the broom swings and the junk slides off the edge', () => {
  const f0 = mascotFrame('clean', 0)
  const f1 = mascotFrame('clean', 1)
  assert.notEqual(f0[2], f1[2], 'broom must move between ticks')
  assert.match(f0[2] ?? '', /▓▒░$/, 'a fresh pile sits at the edge on the first frame')
  assert.match(mascotFrame('clean', 3)[2] ?? '', /[^▓▒░]$/, 'the pile is gone by the last frame')
  assert.deepEqual(mascotFrame('clean', 4), f0, 'the sweep loops every four ticks')
})

test('idle: eyes stay open except for a one-tick blink', () => {
  const open = mascotFrame('idle', 1)[1]
  const closed = mascotFrame('idle', 24)[1]
  assert.match(open ?? '', /◕ ◕/)
  assert.match(closed ?? '', /- -/)
  assert.equal(mascotFrame('idle', 23)[1], open, 'the tick before the blink is open')
  assert.equal(mascotFrame('idle', 25)[1], open, 'the tick after the blink is open')
  assert.equal(mascotFrame('idle', 49)[1], closed, 'blinks again a period later')
})

test('beside pads the left block to one width and joins with a gap', () => {
  assert.deepEqual(beside(['ab', 'abcd'], ['X', 'Y'], 2), ['ab    X', 'abcd  Y'])
})

test('beside measures the left block by visible width, ignoring color escapes', () => {
  const painted = '\x1b[38;5;81mab\x1b[0m'
  assert.deepEqual(beside([painted, 'abcd'], ['X', 'Y'], 1), [`${painted}   X`, 'abcd Y'])
})

test('beside tolerates blocks of different heights', () => {
  assert.deepEqual(beside(['a'], ['X', 'Y', 'Z'], 1), ['a X', '  Y', '  Z'])
  assert.deepEqual(beside(['a', 'b'], ['X'], 1), ['a X', 'b'])
})

import { scanBlock, reapBlock, wantsMascot } from '../../src/ui/mascot.ts'
import { scanText, reapLine } from '../../src/ui/progress.ts'

test('scan block puts the scan text on the bot\'s middle row', () => {
  const rows = scanBlock(3, 17, 1024)
  assert.equal(rows.length, 3)
  assert.equal(rows[0]?.trimEnd(), mascotFrame('scan', 3)[0]?.trimEnd())
  assert.ok(rows[1]?.endsWith(scanText(17, 1024)), rows[1])
  assert.equal(rows[2]?.trimEnd(), mascotFrame('scan', 3)[2]?.trimEnd())
})

test('reap block puts the progress bar on the bot\'s middle row', () => {
  const rows = reapBlock(1, 512, 1024)
  assert.equal(rows.length, 3)
  assert.equal(rows[0]?.trimEnd(), mascotFrame('clean', 1)[0]?.trimEnd())
  assert.ok(rows[1]?.endsWith(reapLine(512, 1024)), rows[1])
  assert.equal(strip(rows[1] ?? ''), rows[1], 'no color means no escapes')
  assert.deepEqual(reapBlock(1, 512, 1024, true).map(strip), rows)
})

test('the mascot wants a TTY at least 60 columns wide and no config veto', () => {
  assert.equal(wantsMascot({ isTTY: true, columns: 80 }, undefined), true)
  assert.equal(wantsMascot({ isTTY: true, columns: 80 }, true), true)
  assert.equal(wantsMascot({ isTTY: true, columns: 80 }, false), false)
  assert.equal(wantsMascot({ isTTY: false, columns: 80 }, undefined), false)
  assert.equal(wantsMascot({ isTTY: true, columns: 59 }, undefined), false)
  assert.equal(wantsMascot({ isTTY: true, columns: 60 }, undefined), true)
  assert.equal(wantsMascot({ isTTY: true }, undefined), true, 'an unknown width is assumed wide enough')
})
