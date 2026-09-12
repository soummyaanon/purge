import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderHistory } from '../../src/ui/history.ts'
import type { RunManifest } from '../../src/types.ts'

function run(ts: string, freedBytes: number, groups: RunManifest['groups'] = []): RunManifest {
  return { ts, version: '0.1.0', freedBytes, groups, items: [] }
}

const NO_COLOR = { color: false }

test('lists runs with their groups', () => {
  const out = renderHistory([
    run('2026-08-29T11:04:22Z', 6_553_600_000, ['builds', 'pkg']),
    run('2026-08-12T09:00:00Z', 2_576_980_378, ['pkg']),
  ], NO_COLOR)
  assert.match(out, /6\.1 GB/)
  assert.match(out, /builds, pkg/)
  assert.match(out, /2\.4 GB/)
})

test('totals lifetime reclaimed space', () => {
  const out = renderHistory([
    run('2026-08-29T11:04:22Z', 1024 ** 3),
    run('2026-08-12T09:00:00Z', 1024 ** 3),
  ].map((r) => ({ ...r, groups: ['builds'] as RunManifest['groups'] })), NO_COLOR)
  assert.match(out, /lifetime reclaimed: 2\.0 GB/)
})

test('says so when there is no history yet', () => {
  assert.match(renderHistory([], NO_COLOR), /no runs yet/)
})

test('marks trash-mode and undone runs, and leaves undone runs out of the lifetime total', () => {
  const out = renderHistory([
    { ...run('2026-09-12T11:00:00Z', 1024 ** 3, ['builds']), mode: 'trash' },
    { ...run('2026-09-12T10:00:00Z', 1024 ** 3, ['pkg']), mode: 'trash', undoneAt: '2026-09-12T10:30:00Z' },
    run('2026-09-01T10:00:00Z', 1024 ** 3, ['xcode']),
  ], NO_COLOR)
  assert.match(out, /trash/)
  assert.match(out, /undone/)
  assert.match(out, /lifetime reclaimed: 2\.0 GB/)
})
