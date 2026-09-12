import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initState, reduce, selectedBytes, renderFrame } from '../../src/ui/tui-state.ts'
import type { Reviewed } from '../../src/types.ts'

function items(): Reviewed[] {
  return [
    { path: '/h/a/.next', label: '.next', group: 'builds', bytes: 1000, selected: true, selectable: true, warnings: [] },
    { path: '/h/b/dist', label: 'dist', group: 'builds', bytes: 500, selected: false, selectable: true, warnings: ['tracked in git'] },
    { path: '/h/.npm/_cacache', label: 'npm cache', group: 'pkg', bytes: 300, selected: true, selectable: true, warnings: [] },
  ]
}

test('builds a row list with a header per group', () => {
  const s = initState(items())
  const headers = s.rows.filter((r) => r.kind === 'header')
  assert.equal(headers.length, 2)
  assert.equal(s.rows.length, 5)
})

test('the cursor starts on the first selectable item, not a header', () => {
  const s = initState(items())
  assert.equal(s.rows[s.cursor]?.kind, 'item')
})

test('the cursor visits headers so groups can be toggled and folded', () => {
  let s = initState(items())
  s = reduce(s, 'down') // item 1 -> item 2 of builds? no: rows are [h,i,i,h,i]
  s = reduce(s, 'down') // second builds item -> pkg header
  assert.equal(s.rows[s.cursor]?.kind, 'header')
})

test('the cursor stops at the ends rather than wrapping', () => {
  let s = initState(items())
  for (let i = 0; i < 20; i++) s = reduce(s, 'up')
  assert.equal(s.cursor, 0)
  for (let i = 0; i < 20; i++) s = reduce(s, 'down')
  assert.equal(s.cursor, s.rows.length - 1)
})

test('space toggles the item under the cursor', () => {
  const s0 = initState(items())
  const before = s0.items[0]?.selected
  const s1 = reduce(s0, 'space')
  assert.equal(s1.items[0]?.selected, !before)
})

test('space does not mutate the previous state', () => {
  const s0 = initState(items())
  reduce(s0, 'space')
  assert.equal(s0.items[0]?.selected, true, 'reducer mutated its input')
})

test('a selects everything and a second a clears everything', () => {
  let s = reduce(initState(items()), 'a')
  assert.ok(s.items.every((i) => i.selected))
  s = reduce(s, 'a')
  assert.ok(s.items.every((i) => !i.selected))
})

test('selectedBytes sums only checked items', () => {
  const s = initState(items())
  assert.equal(selectedBytes(s), 1300)
  assert.equal(selectedBytes(reduce(s, 'a')), 1800)
})

test('enter confirms and q quits', () => {
  assert.equal(reduce(initState(items()), 'enter').done, 'confirm')
  assert.equal(reduce(initState(items()), 'q').done, 'quit')
})

test('an unknown key changes nothing', () => {
  const s0 = initState(items())
  const s1 = reduce(s0, 'z')
  assert.deepEqual(s1.items, s0.items)
  assert.equal(s1.cursor, s0.cursor)
})

function withOrphan(): Reviewed[] {
  return [
    ...items(),
    { path: '/h/Library/Application Support/Slack', label: 'Slack', group: 'orphans', bytes: 900, selected: false, selectable: true, dangerous: true, warnings: ['not regenerable'] },
  ]
}

test('space toggles a dangerous row — on the row itself, the user may opt in', () => {
  let s = initState(withOrphan())
  // walk the cursor onto the orphan row (last item row)
  for (let i = 0; i < 10; i++) s = reduce(s, 'down')
  const orphan = s.items.findIndex((i) => i.group === 'orphans')
  s = reduce(s, 'space')
  assert.equal(s.items[orphan]?.selected, true, 'checking a dangerous row on the row itself must work')
  s = reduce(s, 'space')
  assert.equal(s.items[orphan]?.selected, false, 'a second space must uncheck it again')
})

test('select-all never sweeps up a dangerous row', () => {
  const s = reduce(initState(withOrphan()), 'a')
  const orphan = s.items.find((i) => i.group === 'orphans')
  assert.equal(orphan?.selected, false, 'select-all checked a dangerous item')
  assert.ok(
    s.items.filter((i) => i.selectable && i.dangerous !== true).every((i) => i.selected),
    'select-all missed selectable items',
  )
})

test('selectedBytes counts a dangerous row only once the user checks it', () => {
  let s = reduce(initState(withOrphan()), 'a')
  assert.equal(selectedBytes(s), 1800, 'unchecked dangerous bytes leaked into the selected total')
  for (let i = 0; i < 10; i++) s = reduce(s, 'down')
  s = reduce(s, 'space')
  assert.equal(selectedBytes(s), 2700, 'an explicitly checked dangerous row must count')
})

test('space on a header toggles the whole group', () => {
  let s = initState(items())
  s = { ...s, cursor: 0 } // builds header
  s = reduce(s, 'space')  // one builds item was on, one off -> all on
  assert.ok(s.items.filter((i) => i.group === 'builds').every((i) => i.selected))
  assert.equal(s.items[2]?.selected, true, 'other groups must be untouched')
  s = reduce(s, 'space')  // all on -> all off
  assert.ok(s.items.filter((i) => i.group === 'builds').every((i) => !i.selected))
})

test('fold collapses the group under the cursor and unfold restores it', () => {
  let s = initState(items())
  assert.equal(s.rows.length, 5)
  s = reduce(s, 'fold') // cursor on first builds item -> collapse builds
  assert.equal(s.rows.length, 3, 'builds items must leave the row list')
  assert.equal(s.rows[s.cursor]?.kind, 'header', 'cursor moves to the folded header')
  s = reduce(s, 'unfold')
  assert.equal(s.rows.length, 5)
})

test('a filter narrows rows to matching items and hides empty groups', () => {
  let s = initState(items())
  s = reduce(s, 'filter-start')
  for (const c of 'npm') s = reduce(s, `char:${c}`)
  assert.equal(s.filter, 'npm')
  const itemRows = s.rows.filter((r) => r.kind === 'item')
  assert.equal(itemRows.length, 1)
  const headers = s.rows.filter((r) => r.kind === 'header')
  assert.equal(headers.length, 1, 'groups with no matches must not render headers')
  s = reduce(s, 'escape')
  assert.equal(s.filter, '')
  assert.equal(s.rows.length, 5)
})

test('enter while filtering keeps the filter instead of confirming', () => {
  let s = initState(items())
  s = reduce(s, 'filter-start')
  s = reduce(s, 'char:d')
  s = reduce(s, 'enter')
  assert.equal(s.done, 'pending')
  assert.equal(s.filtering, false)
  assert.equal(s.filter, 'd')
  // items 0 and 2 are checked but hidden by the filter, so the next enter
  // reveals them instead of confirming their deletion sight-unseen.
  s = reduce(s, 'enter')
  assert.equal(s.done, 'pending')
  assert.equal(s.filter, '')
})

test('backspace edits the filter query', () => {
  let s = initState(items())
  s = reduce(s, 'filter-start')
  for (const c of 'np') s = reduce(s, `char:${c}`)
  s = reduce(s, 'backspace')
  assert.equal(s.filter, 'n')
})

test('a with an active filter only touches visible items', () => {
  let s = initState(items())
  s = reduce(s, 'a') // clear nothing: first a selects all
  assert.ok(s.items.every((i) => i.selected))
  s = reduce(s, 'filter-start')
  for (const c of 'npm') s = reduce(s, `char:${c}`)
  s = reduce(s, 'enter')
  s = reduce(s, 'a') // all visible (npm cache) are on -> turn visible off
  assert.equal(s.items[2]?.selected, false)
  assert.equal(s.items[0]?.selected, true, 'hidden items must be untouched')
})

test('g and G jump to the first and last row', () => {
  let s = initState(items())
  s = reduce(s, 'G')
  assert.equal(s.cursor, s.rows.length - 1)
  s = reduce(s, 'g')
  assert.equal(s.cursor, 0)
})

test('enter with a filter hiding checked items reveals them instead of confirming', () => {
  let s = initState(items()) // items 0 and 2 start selected
  s = reduce(s, 'filter-start')
  for (const c of 'dist') s = reduce(s, `char:${c}`)
  s = reduce(s, 'enter') // leave typing mode
  s = reduce(s, 'enter') // items 0+2 are checked but hidden -> must NOT confirm
  assert.equal(s.done, 'pending')
  assert.equal(s.filter, '', 'the filter must clear so hidden checked rows become visible')
  s = reduce(s, 'enter') // everything visible now -> confirm
  assert.equal(s.done, 'confirm')
})

test('escape with no filter active does nothing instead of quitting', () => {
  const s = reduce(initState(items()), 'escape')
  assert.equal(s.done, 'pending')
})

test('clearing a filter re-seats the cursor on an item row', () => {
  let s = initState(items())
  s = reduce(s, 'filter-start')
  for (const c of 'zzz') s = reduce(s, `char:${c}`) // no matches, rows empty
  s = reduce(s, 'escape')
  assert.equal(s.rows[s.cursor]?.kind, 'item')
})

test('unfold on an already-expanded group keeps the cursor in place', () => {
  let s = initState(items())
  s = reduce(s, 'down') // second builds item
  const where = s.cursor
  s = reduce(s, 'unfold')
  assert.equal(s.cursor, where)
})

test('headers render the group checkbox state', () => {
  let s = initState(items()) // builds: one on, one off -> partial
  const frame = renderFrame(s, 24, { color: false, home: '/h' })
  assert.match(frame, /\[~\] BUILD ARTIFACTS/)
  s = { ...s, cursor: 0 }
  s = reduce(s, 'space') // toggle group on
  const on = renderFrame(s, 24, { color: false, home: '/h' })
  assert.match(on, /\[x\] BUILD ARTIFACTS/)
})

test('a colored frame is the plain frame plus 256-color paint', () => {
  const s = initState(items())
  const plain = renderFrame(s, 24, { color: false, home: '/h' })
  const colored = renderFrame(s, 24, { color: true, home: '/h' })
  assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ''), plain)
  assert.match(colored, /38;5;/, 'expects the cyan/blue/gray palette')
})

test('tab hops between item boxes, skipping headers and wrapping', () => {
  let s = initState(items()) // rows: [builds hdr, .next, dist, pkg hdr, npm]
  assert.equal(s.cursor, 1)
  s = reduce(s, 'next-item')
  assert.equal(s.cursor, 2, 'tab must go to the next box')
  s = reduce(s, 'next-item')
  assert.equal(s.cursor, 4, 'tab must skip the pkg header')
  s = reduce(s, 'next-item')
  assert.equal(s.cursor, 1, 'tab must wrap to the first box')
  s = reduce(s, 'prev-item')
  assert.equal(s.cursor, 4, 'shift+tab must wrap backwards')
})

const ANSI = /\x1b\[[0-9;]*m/g
const LONG = '/h/Library/Application Support/Some Very Long Application Name/Profiles/Default Profile/Service Worker/CacheStorage'

function longItems(): Reviewed[] {
  return [
    { path: LONG, label: 'x', group: 'browsers', bytes: 123_456_789, selected: false, selectable: true,
      note: 'may hold offline app data', warnings: ['may hold offline app data'] },
    { path: '/h/a/.next', label: '.next', group: 'builds', bytes: 1000, selected: true, selectable: true, warnings: [] },
  ]
}

test('every rendered line fits the terminal width', () => {
  const s = initState(longItems())
  for (const width of [60, 80, 100]) {
    const frame = renderFrame(s, 20, { color: false, home: '/h', width })
    for (const line of frame.split('\n')) {
      assert.ok(line.length <= width, `line overflows ${width} cols: ${JSON.stringify(line)}`)
    }
  }
})

test('a truncated path keeps its tail, so the user can still tell what it is', () => {
  const s = initState(longItems())
  const frame = renderFrame(s, 20, { color: false, home: '/h', width: 80 })
  assert.match(frame, /…/)
  assert.match(frame, /CacheStorage/)
  assert.match(frame, /may hold offline app data/, 'the warning must survive truncation')
})

test('width is honoured with color on, measured without escape codes', () => {
  const s = initState(longItems())
  const frame = renderFrame(s, 20, { color: true, home: '/h', width: 70 })
  for (const line of frame.split('\n')) {
    const plain = line.replace(ANSI, '')
    assert.ok(plain.length <= 70, `line overflows: ${JSON.stringify(plain)}`)
  }
})

test('without a width nothing is truncated', () => {
  const s = initState(longItems())
  const frame = renderFrame(s, 20, { color: false, home: '/h' })
  assert.match(frame, /Service Worker\/CacheStorage/)
  assert.doesNotMatch(frame, /…/)
})
