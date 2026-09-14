import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { reap } from '../../src/reap/reaper.ts'
import { readManifests } from '../../src/reap/manifest.ts'
import { applyGuards } from '../../src/guard/index.ts'
import type { Reviewed } from '../../src/types.ts'

const run = promisify(execFile)

async function sandbox() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-reap-'))
  const st = await fs.lstat(home)
  const runsDir = path.join(home, '.purge', 'runs')
  return { home, homeDev: st.dev, runsDir, ctx: { home, homeDev: st.dev, keepGlobs: [], desktopDocsSynced: false } }
}

function reviewed(p: string, bytes: number): Reviewed {
  return { path: p, label: '.next', group: 'builds', bytes, selected: true, selectable: true, warnings: [] }
}

const OPTS = (runsDir: string) => ({ version: '0.1.0', runsDir })

test('deletes selected paths and reports what was freed', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'proj', '.next')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'chunk.js'), Buffer.alloc(50_000))

  const { manifest: m } = await reap([reviewed(target, 50_000)], ctx, OPTS(runsDir))

  assert.equal(await fs.access(target).then(() => true, () => false), false, 'path still exists')
  assert.equal(m.items.length, 1)
  assert.equal(m.freedBytes, 50_000)
  assert.deepEqual(m.groups, ['builds'])
})

test('never deletes an unselected item', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'proj', 'dist')
  await fs.mkdir(target, { recursive: true })

  const item: Reviewed = { ...reviewed(target, 100), selected: false }
  const { manifest: m } = await reap([item], ctx, OPTS(runsDir))

  assert.equal(await fs.access(target).then(() => true, () => false), true, 'unselected path was deleted')
  assert.equal(m.items.length, 0)
})

test('re-validates: refuses a path that became a symlink after the scan', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const real = path.join(home, 'precious')
  const link = path.join(home, 'proj', '.next')
  await fs.mkdir(real, { recursive: true })
  await fs.writeFile(path.join(real, 'keep.txt'), 'do not lose me')
  await fs.mkdir(path.join(home, 'proj'), { recursive: true })
  await fs.symlink(real, link)

  const { manifest: m } = await reap([reviewed(link, 4096)], ctx, OPTS(runsDir))

  assert.equal(m.items.length, 0, 'reaper deleted a path that became a symlink')
  assert.equal(await fs.access(path.join(real, 'keep.txt')).then(() => true, () => false), true)
})

test('re-validates: refuses a path outside home even if handed one directly', async () => {
  const { ctx, runsDir } = await sandbox()
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-outside-'))
  await fs.writeFile(path.join(outside, 'keep.txt'), 'x')

  const { manifest: m } = await reap([reviewed(outside, 4096)], ctx, OPTS(runsDir))

  assert.equal(m.items.length, 0, 'reaper deleted outside home')
  assert.equal(await fs.access(path.join(outside, 'keep.txt')).then(() => true, () => false), true)
})

test('skips an item that acquired a NEW warning during the review window', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const repo = path.join(home, 'proj')
  const target = path.join(repo, 'dist')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'out.js'), 'x')
  await run('git', ['init', '-q'], { cwd: repo })
  await run('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  await run('git', ['config', 'user.name', 't'], { cwd: repo })
  await run('git', ['add', '-A'], { cwd: repo })
  await run('git', ['commit', '-qm', 'committed while the user was reading'], { cwd: repo })

  // The user saw NO warnings when they checked this box.
  const { manifest: m } = await reap([reviewed(target, 4096)], ctx, OPTS(runsDir))

  assert.equal(m.items.length, 0, 'deleted a path that became git-tracked mid-review')
  assert.equal(await fs.access(target).then(() => true, () => false), true)
})

test('still deletes an item whose warning the user already saw and accepted', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'Dropbox', 'proj', 'dist')
  await fs.mkdir(target, { recursive: true })

  const item = { ...reviewed(target, 4096), warnings: ['syncs to your other machines'] }
  const { manifest: m } = await reap([item], ctx, OPTS(runsDir))

  assert.equal(m.items.length, 1, 'ignored a choice the user made with full information')
})

test('writes a manifest that readManifests can read back', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'proj', '.turbo')
  await fs.mkdir(target, { recursive: true })

  await reap([{ ...reviewed(target, 1234), label: '.turbo' }], ctx, OPTS(runsDir))
  const runs = await readManifests(runsDir)

  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.freedBytes, 1234)
  assert.equal(runs[0]?.items[0]?.path, target)
  assert.equal(runs[0]?.version, '0.1.0')
})

test('readManifests returns an empty list when no runs exist', async () => {
  const { runsDir } = await sandbox()
  assert.deepEqual(await readManifests(runsDir), [])
})

test('SAFETY: refuses an orphan whose danger warning the user was never shown', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'Library', 'Application Support', 'Slack')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'data.bin'), 'x')

  // A caller that forged selected:true without carrying the danger warning
  // the guards attach. The fresh verdict's warning is then an objection the
  // user never saw, and the reaper must skip it.
  const forced: Reviewed = {
    path: target, label: 'Slack', group: 'orphans', bytes: 4096,
    selected: true, selectable: true, warnings: [],
  }
  const { manifest: m } = await reap([forced], ctx, OPTS(runsDir))

  assert.equal(m.items.length, 0, 'reaper deleted an orphan the user never saw a warning for')
  assert.equal(await fs.access(target).then(() => true, () => false), true, 'orphan data was deleted')
})

test('SAFETY: refuses an item handed in as report-only', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'Library', 'Application Support', 'Discord')
  await fs.mkdir(target, { recursive: true })

  // selectable:false is what applyGuards produces for a 'report' verdict.
  const item: Reviewed = {
    path: target, label: 'Discord', group: 'orphans', bytes: 4096,
    selected: true, selectable: false, warnings: ['review manually'],
  }
  const { manifest: m } = await reap([item], ctx, OPTS(runsDir))

  assert.equal(m.items.length, 0)
  assert.equal(await fs.access(target).then(() => true, () => false), true)
})

test('deletes an orphan the user explicitly checked, warning seen', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'Library', 'Application Support', 'Slack')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'data.bin'), 'x')

  // What the TUI hands over after the user checks the row: the danger
  // warning it displayed rides along, so the fresh verdict matches.
  const [shown] = await applyGuards(
    [{ path: target, label: 'Slack', group: 'orphans', bytes: 4096 }], ctx,
  )
  assert.ok(shown)
  assert.equal(shown.dangerous, true)
  const { manifest: m } = await reap([{ ...shown, selected: true }], ctx, OPTS(runsDir))

  assert.equal(m.items.length, 1, 'an explicit, informed opt-in must be honoured')
  assert.equal(await fs.access(target).then(() => true, () => false), false, 'orphan data still exists')
})

test('reports freed bytes as it deletes', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const a = path.join(home, 'proj', '.next')
  const b = path.join(home, 'proj', 'dist')
  for (const t of [a, b]) {
    await fs.mkdir(t, { recursive: true })
    await fs.writeFile(path.join(t, 'chunk.js'), Buffer.alloc(10_000))
  }
  const seen: Array<[number, number]> = []
  await reap([reviewed(a, 10_000), reviewed(b, 10_000)], ctx, {
    ...OPTS(runsDir),
    onProgress: (freed, total) => seen.push([freed, total]),
  })
  assert.equal(seen.length, 2)
  assert.deepEqual(seen.at(-1), [20_000, 20_000])
  assert.ok(seen.every(([, total]) => total === 20_000), 'total must be stable across calls')
})

test('reports a path it could not delete, with the reason, instead of dropping it silently', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'proj', '.next')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'chunk.js'), 'x')
  // A read-only directory: its children cannot be unlinked, so rm fails.
  await fs.chmod(target, 0o555)

  try {
    const { manifest: m } = await reap([reviewed(target, 4096)], ctx, OPTS(runsDir))
    assert.equal(m.items.length, 0, 'a failed deletion must not be counted as freed')
    assert.equal(m.failed.length, 1)
    assert.equal(m.failed[0]?.path, target)
    assert.match(m.failed[0]?.reason ?? '', /EACCES|EPERM/)
  } finally {
    await fs.chmod(target, 0o755)
  }
})

test('stops deleting when the abort signal fires, and still writes the manifest', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const a = path.join(home, 'proj', '.next')
  const b = path.join(home, 'proj', 'dist')
  for (const t of [a, b]) {
    await fs.mkdir(t, { recursive: true })
    await fs.writeFile(path.join(t, 'chunk.js'), Buffer.alloc(10_000))
  }
  const ac = new AbortController()
  const { manifest: m } = await reap([reviewed(a, 10_000), reviewed(b, 10_000)], ctx, {
    ...OPTS(runsDir),
    signal: ac.signal,
    // Ctrl+C lands after the first item is gone.
    onProgress: () => ac.abort(),
  })

  assert.equal(m.items.length, 1, 'the loop must stop at the next item boundary')
  assert.equal(await fs.access(a).then(() => true, () => false), false)
  assert.equal(await fs.access(b).then(() => true, () => false), true, 'deleted past the abort')
  const runs = await readManifests(runsDir)
  assert.equal(runs.length, 1, 'an interrupted run must still leave a record')
  assert.equal(runs[0]?.freedBytes, 10_000)
})

test('a manifest that cannot be written does not hide what was deleted', async () => {
  const { home, ctx } = await sandbox()
  const target = path.join(home, 'proj', '.next')
  await fs.mkdir(target, { recursive: true })
  // runsDir is a FILE, so mkdir -p fails.
  const runsDir = path.join(home, 'runs-is-a-file')
  await fs.writeFile(runsDir, 'not a directory')

  const { manifest: m, manifestPath } = await reap([reviewed(target, 4096)], ctx, OPTS(runsDir))

  assert.equal(m.items.length, 1)
  assert.equal(manifestPath, null)
})

test('returns where the manifest was saved', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'proj', '.next')
  await fs.mkdir(target, { recursive: true })

  const { manifestPath } = await reap([reviewed(target, 4096)], ctx, OPTS(runsDir))

  assert.ok(manifestPath?.startsWith(runsDir), `manifest saved elsewhere: ${manifestPath}`)
})

const alive = (p: string) => fs.access(p).then(() => true, () => false)

test('trash mode moves the item into ~/.Trash instead of deleting it', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'proj', '.next')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'chunk.js'), 'keep me recoverable')

  const { manifest: m } = await reap([reviewed(target, 4096)], ctx, { ...OPTS(runsDir), trash: true })

  assert.equal(await alive(target), false, 'original path still exists')
  const moved = path.join(home, '.Trash', '.next')
  assert.equal(await fs.readFile(path.join(moved, 'chunk.js'), 'utf8'), 'keep me recoverable')
  assert.equal(m.mode, 'trash')
  assert.equal(m.items[0]?.trashedTo, moved)
  assert.equal(m.freedBytes, 4096, 'trash mode still reports the bytes it moved out of the way')
})

test('trash mode never overwrites something already in the Trash with the same name', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const a = path.join(home, 'one', '.next')
  const b = path.join(home, 'two', '.next')
  for (const [t, body] of [[a, 'first'], [b, 'second']] as const) {
    await fs.mkdir(t, { recursive: true })
    await fs.writeFile(path.join(t, 'id.txt'), body)
  }

  const { manifest: m } = await reap([reviewed(a, 100), reviewed(b, 100)], ctx, { ...OPTS(runsDir), trash: true })

  assert.equal(m.items.length, 2)
  const dests = m.items.map((i) => i.trashedTo)
  assert.notEqual(dests[0], dests[1], 'two items landed on the same trash path')
  assert.equal(await fs.readFile(path.join(dests[0] as string, 'id.txt'), 'utf8'), 'first')
  assert.equal(await fs.readFile(path.join(dests[1] as string, 'id.txt'), 'utf8'), 'second')
})

test('the Trash itself is always deleted for real, even in trash mode', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const trash = path.join(home, '.Trash')
  await fs.mkdir(trash, { recursive: true })
  await fs.writeFile(path.join(trash, 'old.bin'), 'x')

  const [shown] = await applyGuards([{ path: trash, label: '.Trash', group: 'heavy', bytes: 4096 }], ctx)
  assert.ok(shown)
  const { manifest: m } = await reap([{ ...shown, selected: true }], ctx, { ...OPTS(runsDir), trash: true })

  assert.equal(m.items.length, 1)
  assert.equal(m.items[0]?.trashedTo, undefined, 'the Trash cannot be moved into itself')
  assert.equal(await alive(path.join(trash, 'old.bin')), false)
})

test('a plain run records rm mode so undo knows there is nothing to restore', async () => {
  const { home, ctx, runsDir } = await sandbox()
  const target = path.join(home, 'proj', '.next')
  await fs.mkdir(target, { recursive: true })
  const { manifest: m } = await reap([reviewed(target, 4096)], ctx, OPTS(runsDir))
  assert.equal(m.mode, 'rm')
})
