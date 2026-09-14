import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const CLI = path.resolve(import.meta.dirname, '..', 'src', 'cli.ts')

async function sandboxHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-e2e-'))
  const junk = path.join(home, 'proj', '.next')
  await fs.mkdir(junk, { recursive: true })
  await fs.writeFile(path.join(junk, 'chunk.js'), Buffer.alloc(2_000_000))
  return home
}

function invoke(args: string[], home: string) {
  return run('node', [CLI, ...args], { env: { ...process.env, HOME: home }, cwd: home })
}

test('--json reports the junk it found without deleting it', async () => {
  const home = await sandboxHome()
  const { stdout } = await invoke(['--json', 'builds', '--min-size', '0'], home)
  const parsed = JSON.parse(stdout) as { reclaimableBytes: number; items: Array<{ path: string }> }

  assert.ok(parsed.reclaimableBytes >= 2_000_000, `found nothing: ${stdout}`)
  assert.ok(parsed.items.some((i) => i.path.endsWith('.next')))
  assert.equal(
    await fs.access(path.join(home, 'proj', '.next')).then(() => true, () => false), true,
    '--json deleted something',
  )
})

test('--dry-run prints a report and deletes nothing', async () => {
  const home = await sandboxHome()
  const { stdout } = await invoke(['--dry-run', 'builds', '--min-size', '0'], home)
  assert.match(stdout, /BUILD ARTIFACTS/)
  assert.equal(
    await fs.access(path.join(home, 'proj', '.next')).then(() => true, () => false), true,
    '--dry-run deleted something',
  )
})

test('--yes deletes and writes a manifest', async () => {
  const home = await sandboxHome()
  await invoke(['--yes', 'builds', '--min-size', '0'], home)

  assert.equal(
    await fs.access(path.join(home, 'proj', '.next')).then(() => true, () => false), false,
    '--yes did not delete',
  )
  const runs = await fs.readdir(path.join(home, '.purge', 'runs'))
  assert.equal(runs.length, 1, 'no manifest written')
})

test('history reads back the run that just happened', async () => {
  const home = await sandboxHome()
  await invoke(['--yes', 'builds', '--min-size', '0'], home)
  const { stdout } = await invoke(['history'], home)
  assert.match(stdout, /lifetime reclaimed/)
  assert.match(stdout, /builds/)
})

test('--help exits 0 and names every group', async () => {
  const { stdout } = await invoke(['--help'], await sandboxHome())
  for (const g of ['builds', 'pkg', 'xcode', 'browsers', 'editors', 'orphans']) {
    assert.match(stdout, new RegExp(g))
  }
})

test('an unknown option exits non-zero with a useful message', async () => {
  const home = await sandboxHome()
  await assert.rejects(
    () => invoke(['--nonsense'], home),
    (e: { code?: number; stderr?: string }) => {
      assert.equal(e.code, 1)
      assert.match(e.stderr ?? '', /unknown option/)
      return true
    },
  )
})

async function orphanHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-orphan-e2e-'))
  const data = path.join(home, 'Library', 'Application Support', 'Slack')
  await fs.mkdir(data, { recursive: true })
  await fs.writeFile(path.join(data, 'blob.bin'), Buffer.alloc(2_000_000))
  return home
}

test('reports orphaned app data instead of silently finding nothing', async () => {
  const home = await orphanHome()
  const res = await invoke(['--dry-run', 'orphans', '--min-size', '0'], home)
    .catch((e: { code?: number; stdout?: string }) => e)
  const stdout = (res as { stdout?: string }).stdout ?? ''

  assert.match(stdout, /ORPHANED APP DATA/, `orphans group printed nothing: ${stdout}`)
  assert.match(stdout, /Slack/)
  assert.match(stdout, /not regenerable/, 'the danger warning must be visible in the report')
  assert.equal(
    await fs.access(path.join(home, 'Library', 'Application Support', 'Slack')).then(() => true, () => false),
    true, 'orphan data was deleted',
  )
})

test('--yes never deletes orphaned app data', async () => {
  const home = await orphanHome()
  await invoke(['--yes', 'orphans', '--min-size', '0'], home).catch(() => undefined)

  assert.equal(
    await fs.access(path.join(home, 'Library', 'Application Support', 'Slack')).then(() => true, () => false),
    true, '--yes deleted an orphan',
  )
})

test('orphans alone exit 0 — reclaimable through the review screen', async () => {
  const home = await orphanHome()
  // Dangerous rows are unchecked but checkable, so the run points the user
  // at the review screen instead of declaring nothing reclaimable.
  const { stdout } = await invoke(['--dry-run', 'orphans', '--min-size', '0'], home)
  assert.match(stdout, /run `purge` to pick what to delete/)
})

test('--yes names a path it could not delete instead of calling it "changed"', async () => {
  const home = await sandboxHome()
  const junk = path.join(home, 'proj', '.next')
  await fs.chmod(junk, 0o555)
  try {
    const { stdout } = await invoke(['--yes', 'builds', '--min-size', '0'], home)
    assert.match(stdout, /could not delete/, stdout)
    assert.match(stdout, /EACCES|EPERM/)
    assert.doesNotMatch(stdout, /changed since the scan/)
  } finally {
    await fs.chmod(junk, 0o755)
  }
})

test('--trash then undo brings the directory back', async () => {
  const home = await sandboxHome()
  const junk = path.join(home, 'proj', '.next')
  await invoke(['--yes', '--trash', 'builds', '--min-size', '0'], home)
  assert.equal(await fs.access(junk).then(() => true, () => false), false, '--trash did not move it')

  const { stdout } = await invoke(['undo'], home)
  assert.match(stdout, /restored/)
  assert.equal(await fs.access(path.join(junk, 'chunk.js')).then(() => true, () => false), true, 'undo did not restore')
})

test('undo with nothing to undo says so and exits 0', async () => {
  const home = await sandboxHome()
  const { stdout } = await invoke(['undo'], home)
  assert.match(stdout, /nothing to undo/)
})
