import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport, renderJson, renderSummary } from '../../src/ui/render.ts'
import type { Reviewed, RunManifest } from '../../src/types.ts'

function item(over: Partial<Reviewed> = {}): Reviewed {
  return {
    path: '/Users/x/proj/.next', label: '.next', group: 'builds',
    bytes: 1_181_116_006, selected: true, selectable: true, warnings: [], ...over,
  }
}

const NO_COLOR = { color: false, home: '/Users/x' }

test('groups items under headers with a group total', () => {
  const out = renderReport([item(), item({ group: 'pkg', label: 'npm cache', bytes: 1024 * 1024 })], NO_COLOR)
  assert.match(out, /BUILD ARTIFACTS/)
  assert.match(out, /PACKAGE CACHES/)
  assert.match(out, /1\.1 GB/)
})

test('shows warnings beside downgraded items', () => {
  const out = renderReport([item({ selected: false, warnings: ['tracked in git'] })], NO_COLOR)
  assert.match(out, /tracked in git/)
})

test('abbreviates the home directory as a tilde', () => {
  const out = renderReport([item()], NO_COLOR)
  assert.ok(!out.includes('/Users/x/proj'), 'raw home path leaked into output')
  assert.match(out, /~\/proj\/\.next/)
})

test('emits no ANSI escapes when color is off', () => {
  const out = renderReport([item()], NO_COLOR)
  assert.ok(!/\x1b\[/.test(out), 'ANSI escapes present with color disabled')
})

test('json output is parseable and carries the fields the spec documents', () => {
  const parsed = JSON.parse(renderJson([item()])) as {
    reclaimableBytes: number
    items: Array<{ path: string; bytes: number; group: string; selected: boolean }>
  }
  assert.equal(parsed.reclaimableBytes, 1_181_116_006)
  assert.equal(parsed.items[0]?.group, 'builds')
  assert.equal(parsed.items[0]?.selected, true)
})

test('summary states what was reclaimed', () => {
  const m: RunManifest = {
    ts: '2026-08-29T11:04:22Z', version: '0.1.0', freedBytes: 6_553_600_000,
    groups: ['builds'], items: [],
  }
  assert.match(renderSummary(m, NO_COLOR), /6\.1 GB/)
})

test('does not print a note that a warning already says verbatim', () => {
  const out = renderReport(
    [item({ selected: false, note: 'may hold offline app data', warnings: ['may hold offline app data'] })],
    NO_COLOR,
  )
  const hits = out.match(/may hold offline app data/g) ?? []
  assert.equal(hits.length, 1, `note and warning printed the same text twice: ${out}`)
})

test('still prints a note that adds information beyond the warning', () => {
  const out = renderReport(
    [item({ selected: false, note: 'idle 214d', warnings: ['tracked in git'] })],
    NO_COLOR,
  )
  assert.match(out, /idle 214d/)
  assert.match(out, /tracked in git/)
})

test('renders dangerous items unchecked, outside the reclaimable total', () => {
  const out = renderReport(
    [
      item(),
      item({ path: '/Users/x/Library/Application Support/Slack', label: 'Slack', group: 'orphans',
             bytes: 500_000_000, selected: false, selectable: true, dangerous: true,
             warnings: ['not regenerable'] }),
    ],
    NO_COLOR,
  )
  assert.match(out, /ORPHANED APP DATA/)
  assert.match(out, /\[ \].+Slack/, 'a dangerous row must show an empty checkbox, not [-]')
  assert.match(out, /not regenerable/)
  // 1_181_116_006 alone is 1.1 GB; adding the 500 MB orphan would read 1.6 GB.
  assert.match(out, /reclaimable: 1\.1 GB/)
})

function freed(freedBytes: number): RunManifest {
  return { ts: '2026-09-12T10:00:00Z', version: '0.8.0', freedBytes, groups: ['builds'], items: [] }
}

test('summary asks for a star on the first three runs only', () => {
  const REPO = /github\.com\/soummyaanon\/purge/
  assert.match(renderSummary(freed(1024 ** 3), { ...NO_COLOR, runCount: 1 }), REPO)
  assert.match(renderSummary(freed(1024 ** 3), { ...NO_COLOR, runCount: 3 }), REPO)
  assert.doesNotMatch(renderSummary(freed(1024 ** 3), { ...NO_COLOR, runCount: 4 }), REPO)
})

test('summary never asks for a star when the run count is unknown or nothing was freed', () => {
  const REPO = /github\.com/
  assert.doesNotMatch(renderSummary(freed(1024 ** 3), NO_COLOR), REPO)
  assert.doesNotMatch(renderSummary(freed(0), { ...NO_COLOR, runCount: 1 }), REPO)
})

test('summary names every path that could not be deleted, with its reason', () => {
  const m: RunManifest = {
    ...freed(0),
    failed: [{ path: '/Users/x/Library/Caches/Held', bytes: 4096, group: 'caches', reason: 'EPERM' }],
  }
  const out = renderSummary(m, NO_COLOR)
  assert.match(out, /could not delete/)
  assert.match(out, /~\/Library\/Caches\/Held/)
  assert.match(out, /EPERM/)
})

test('trash-mode summary says the space is in the Trash and how to get it back', () => {
  const m: RunManifest = { ...freed(1024 ** 3), mode: 'trash' }
  const out = renderSummary(m, NO_COLOR)
  assert.match(out, /moved to Trash: 1\.0 GB/)
  assert.match(out, /purge undo/)
  assert.doesNotMatch(out, /^reclaimed:/m)
})
