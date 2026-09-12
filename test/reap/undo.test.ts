import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { undo, pickUndoable } from '../../src/reap/undo.ts'
import { reap } from '../../src/reap/reaper.ts'
import { readManifestEntries } from '../../src/reap/manifest.ts'
import type { Reviewed, RunManifest } from '../../src/types.ts'

const alive = (p: string) => fs.access(p).then(() => true, () => false)

async function sandbox() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-undo-'))
  const st = await fs.lstat(home)
  const runsDir = path.join(home, '.purge', 'runs')
  return { home, runsDir, ctx: { home, homeDev: st.dev, keepGlobs: [], desktopDocsSynced: false } }
}

function reviewed(p: string, bytes = 4096): Reviewed {
  return { path: p, label: path.basename(p), group: 'builds', bytes, selected: true, selectable: true, warnings: [] }
}

async function trashed(home: string, ctx: Awaited<ReturnType<typeof sandbox>>['ctx'], runsDir: string, rels: string[]) {
  const targets = rels.map((r) => path.join(home, r))
  for (const t of targets) {
    await fs.mkdir(t, { recursive: true })
    await fs.writeFile(path.join(t, 'payload.txt'), path.basename(t))
  }
  const { manifest } = await reap(targets.map((t) => reviewed(t)), ctx, { version: '0.8.0', runsDir, trash: true })
  return { targets, manifest }
}

test('restores every item of a trash run to where it was', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const { targets, manifest } = await trashed(home, ctx, runsDir, ['a/.next', 'b/dist'])
  for (const t of targets) assert.equal(await alive(t), false)

  const r = await undo(manifest, { home })

  assert.equal(r.restored.length, 2)
  assert.equal(r.skipped.length, 0)
  for (const t of targets) {
    assert.equal(await fs.readFile(path.join(t, 'payload.txt'), 'utf8'), path.basename(t))
  }
})

test('never overwrites a path that has been recreated since', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const { targets, manifest } = await trashed(home, ctx, runsDir, ['a/.next'])
  const t = targets[0] as string
  await fs.mkdir(t, { recursive: true })
  await fs.writeFile(path.join(t, 'payload.txt'), 'rebuilt since')

  const r = await undo(manifest, { home })

  assert.equal(r.restored.length, 0)
  assert.match(r.skipped[0]?.reason ?? '', /exists/)
  assert.equal(await fs.readFile(path.join(t, 'payload.txt'), 'utf8'), 'rebuilt since')
})

test('reports an item whose trash copy is already gone', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const { manifest } = await trashed(home, ctx, runsDir, ['a/.next'])
  await fs.rm(manifest.items[0]?.trashedTo as string, { recursive: true })

  const r = await undo(manifest, { home })

  assert.equal(r.restored.length, 0)
  assert.match(r.skipped[0]?.reason ?? '', /Trash/)
})

test('SAFETY: refuses to restore outside home or from outside the Trash', async () => {
  const { home } = await sandbox()
  const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-undo-out-'))
  await fs.mkdir(path.join(elsewhere, 'src'))
  const forged: RunManifest = {
    ts: '2026-09-12T10:00:00Z', version: '0.8.0', freedBytes: 1, groups: ['builds'], mode: 'trash',
    items: [
      { path: path.join(elsewhere, 'victim'), bytes: 1, group: 'builds', trashedTo: path.join(home, '.Trash', 'x') },
      { path: path.join(home, 'restored'), bytes: 1, group: 'builds', trashedTo: path.join(elsewhere, 'src') },
    ],
  }
  const r = await undo(forged, { home })
  assert.equal(r.restored.length, 0)
  assert.equal(r.skipped.length, 2)
  assert.equal(await alive(path.join(elsewhere, 'src')), true, 'moved something from outside the Trash')
  assert.equal(await alive(path.join(elsewhere, 'victim')), false, 'wrote outside home')
})

test('pickUndoable chooses the newest trash run that has not been undone', () => {
  const base: Omit<RunManifest, 'ts'> = { version: '0.8.0', freedBytes: 1, groups: [], items: [] }
  const runs: RunManifest[] = [
    { ...base, ts: '2026-09-12T12:00:00Z', mode: 'rm' },
    { ...base, ts: '2026-09-12T11:00:00Z', mode: 'trash', undoneAt: '2026-09-12T11:30:00Z' },
    { ...base, ts: '2026-09-12T10:00:00Z', mode: 'trash' },
    { ...base, ts: '2026-09-12T09:00:00Z', mode: 'trash' },
  ]
  assert.equal(pickUndoable(runs)?.ts, '2026-09-12T10:00:00Z')
  assert.equal(pickUndoable([runs[0] as RunManifest]), null)
  assert.equal(pickUndoable([]), null)
})

test('undo marks the manifest on disk so a second undo finds nothing', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const { manifest } = await trashed(home, ctx, runsDir, ['a/.next'])
  const [entry] = await readManifestEntries(runsDir)
  assert.ok(entry)

  await undo(manifest, { home, manifestFile: entry.file })

  const [after] = await readManifestEntries(runsDir)
  assert.ok(after?.manifest.undoneAt, 'manifest was not marked undone')
  assert.equal(pickUndoable([after.manifest]), null)
})
