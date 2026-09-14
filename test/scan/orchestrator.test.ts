import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { scan } from '../../src/scan/index.ts'
import type { ScanContext } from '../../src/scan/scanner.ts'

async function home(): Promise<ScanContext> {
  const h = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-scan-'))
  return { home: h, staleDays: 60, now: Date.now(), applicationDirs: [] }
}

async function fill(dir: string, bytes: number) {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'blob.bin'), Buffer.alloc(bytes))
}

test('finds build output and sizes it', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, 'proj', '.next'), 200_000)
  const got = await scan(ctx, { groups: ['builds'], minSizeBytes: 0 })
  const next = got.find((c) => c.label === '.next')
  assert.ok(next, '.next was not found')
  assert.ok(next.bytes >= 200_000, `size looks wrong: ${next.bytes}`)
})

test('respects the group filter', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, 'proj', '.next'), 200_000)
  await fill(path.join(ctx.home, '.npm', '_cacache'), 200_000)
  const got = await scan(ctx, { groups: ['pkg'], minSizeBytes: 0 })
  assert.ok(got.every((c) => c.group === 'pkg'), 'group filter leaked other groups')
})

test('drops candidates below the size floor', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, 'proj', '.next'), 100)
  const got = await scan(ctx, { groups: ['builds'], minSizeBytes: 10 * 1024 * 1024 })
  assert.deepEqual(got, [])
})

test('reports candidates hidden by the size floor', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, 'proj', '.next'), 100)
  let hidden: [number, number] = [0, 0]
  await scan(ctx, { groups: ['builds'], minSizeBytes: 10 * 1024 * 1024, onHidden: (count, bytes) => { hidden = [count, bytes] } })
  assert.equal(hidden[0], 1)
  assert.ok(hidden[1] >= 100)
})

test('does not descend into a directory it already claimed', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, 'proj', '.next', 'cache', 'dist'), 100_000)
  await fs.writeFile(path.join(ctx.home, 'proj', '.next', 'cache', 'package.json'), '{}')
  const got = await scan(ctx, { groups: ['builds'], minSizeBytes: 0 })
  assert.equal(got.length, 1, 'claimed a nested candidate inside an already-claimed directory')
  assert.equal(got[0]?.label, '.next')
})

test('reports progress while scanning', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, 'proj', '.next'), 50_000)
  let calls = 0
  await scan(ctx, { groups: ['builds'], minSizeBytes: 0, onProgress: () => { calls++ } })
  assert.ok(calls > 0, 'onProgress was never called')
})

test('the deep groups run through the orchestrator', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, 'Library', 'Caches', 'SomeApp'), 50_000)
  await fill(path.join(ctx.home, '.cache', 'uv'), 50_000)
  await fill(path.join(ctx.home, 'Library', 'Logs', 'SomeApp'), 50_000)
  await fill(path.join(ctx.home, '.claude', 'paste-cache'), 50_000)
  await fill(path.join(ctx.home, '.Trash'), 50_000)
  const got = await scan(ctx, { groups: ['caches', 'logs', 'agents', 'heavy'], minSizeBytes: 0 })
  const groups = new Set(got.map((c) => c.group))
  assert.deepEqual([...groups].sort(), ['agents', 'caches', 'heavy', 'logs'])
})

test('the walker leaves ~/.cache to the caches scanner', async () => {
  const ctx = await home()
  // a venv inside ~/.cache would otherwise be claimed by the builds walker
  await fill(path.join(ctx.home, '.cache', 'tool', '.venv'), 50_000)
  await fs.writeFile(path.join(ctx.home, '.cache', 'tool', '.venv', 'pyvenv.cfg'), '')
  const got = await scan(ctx, { groups: ['builds', 'caches'], minSizeBytes: 0 })
  assert.ok(got.every((c) => c.group === 'caches'), 'walker claimed something inside ~/.cache')
})

test('discovery reaches tools no curated scanner has heard of', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, '.mysterytool', 'cache'), 50_000)
  const got = await scan(ctx, { groups: ['caches'], minSizeBytes: 0 })
  assert.ok(got.some((c) => c.label === '.mysterytool/cache'), 'discovery missed .mysterytool/cache')
})

test('discovery never duplicates a row another scanner claimed', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, '.gemini', 'tmp'), 50_000)
  const got = await scan(ctx, { groups: ['agents', 'caches'], minSizeBytes: 0 })
  const rows = got.filter((c) => c.path.endsWith(path.join('.gemini', 'tmp')))
  assert.equal(rows.length, 1, `expected one row for .gemini/tmp, got ${rows.length}`)
})

test('sizing progress reports the count and cumulative bytes', async () => {
  const ctx = await home()
  await fill(path.join(ctx.home, 'Library', 'Caches', 'AppA'), 50_000)
  await fill(path.join(ctx.home, 'Library', 'Caches', 'AppB'), 60_000)
  const seen: Array<[number, number]> = []
  await scan(ctx, {
    groups: ['caches'], minSizeBytes: 0,
    onProgress: (done, bytes) => seen.push([done, bytes]),
  })
  assert.equal(seen.length, 2)
  assert.equal(seen.at(-1)?.[0], 2)
  assert.ok((seen.at(-1)?.[1] ?? 0) >= 110_000, `cumulative bytes missing: ${seen.at(-1)?.[1]}`)
})

test('the walker never enters package caches, so their bundled dist dirs are not claimed twice', async () => {
  const ctx = await home()
  for (const rel of ['go/pkg/mod/github.com/x/y@v1/dist', '.npm/_npx/abc/node_modules', '.m2/repository/org/x/dist']) {
    await fill(path.join(ctx.home, rel), 50_000)
    await fs.writeFile(path.join(ctx.home, rel, '..', 'package.json'), '{}')
  }
  const got = await scan({ ...ctx, staleDays: 0 }, { groups: ['builds'], minSizeBytes: 0 })
  assert.deepEqual(got, [], `walker claimed inside a package cache: ${got.map((c) => c.path).join(', ')}`)
})
