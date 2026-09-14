import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { electronScanner } from '../../src/scan/electron.ts'
import type { ScanContext } from '../../src/scan/scanner.ts'

const AS = 'Library/Application Support'

async function fakeHome(dirs: string[]): Promise<ScanContext> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-electron-'))
  for (const d of dirs) await fs.mkdir(path.join(home, d), { recursive: true })
  return { home, staleDays: 60, now: Date.now(), applicationDirs: [] }
}

test('claims the Chromium cache trio of any Electron app it has never heard of', async () => {
  const ctx = await fakeHome([
    `${AS}/Slack/Cache`, `${AS}/Slack/Code Cache`, `${AS}/Slack/GPUCache`, `${AS}/Slack/DawnGraphiteCache`,
    `${AS}/Slack/Local Storage`, `${AS}/Slack/IndexedDB`, `${AS}/Slack/Session Storage`, `${AS}/Slack/Service Worker`,
  ])
  const got = await electronScanner.probe(ctx, new Set())
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, ['Slack Cache', 'Slack Code Cache', 'Slack DawnGraphiteCache', 'Slack GPUCache'])
  assert.ok(got.every((c) => c.group === 'caches'))
  assert.ok(!got.some((c) => /Storage|IndexedDB|Service Worker/.test(c.path)), 'app data was claimed')
})

test('a lone Cache folder is not proof of Electron — leave it alone', async () => {
  const ctx = await fakeHome([`${AS}/SomeNativeApp/Cache`, `${AS}/SomeNativeApp/Data`])
  assert.deepEqual(await electronScanner.probe(ctx, new Set()), [])
})

test('leaves apps that other scanners own to those scanners', async () => {
  const ctx = await fakeHome([
    `${AS}/Code/Cache`, `${AS}/Code/Code Cache`,
    `${AS}/Cursor/Cache`, `${AS}/Cursor/Code Cache`,
    `${AS}/Claude/Cache`, `${AS}/Claude/Code Cache`,
    `${AS}/Discord/Cache`, `${AS}/Discord/Code Cache`,
  ])
  const got = await electronScanner.probe(ctx, new Set())
  assert.deepEqual(got.map((c) => c.label).sort(), ['Discord Cache', 'Discord Code Cache'])
})

test('skips an app whose whole folder was already claimed (an orphan) and any claimed subdir', async () => {
  const ctx = await fakeHome([
    `${AS}/Notion/Cache`, `${AS}/Notion/Code Cache`,
    `${AS}/Figma/Cache`, `${AS}/Figma/Code Cache`, `${AS}/Figma/GPUCache`,
  ])
  const claimed = new Set([
    path.join(ctx.home, AS, 'Notion'),
    path.join(ctx.home, AS, 'Figma', 'GPUCache'),
  ])
  const got = await electronScanner.probe(ctx, claimed)
  assert.deepEqual(got.map((c) => c.label).sort(), ['Figma Cache', 'Figma Code Cache'])
})

test('survives a home with no Application Support', async () => {
  const ctx = await fakeHome([])
  assert.deepEqual(await electronScanner.probe(ctx, new Set()), [])
})

test('claims per-partition caches under <App>/Partitions/<name>/ without their app data', async () => {
  const ctx = await fakeHome([
    `${AS}/Slack/Partitions/work/Cache`,
    `${AS}/Slack/Partitions/work/Code Cache`,
    `${AS}/Slack/Partitions/work/IndexedDB`,
  ])
  const got = await electronScanner.probe(ctx, new Set())
  assert.deepEqual(got.map((c) => c.label).sort(), ['Slack work Cache', 'Slack work Code Cache'])
  assert.ok(!got.some((c) => c.path.endsWith('IndexedDB')))
})

test('the root profile and each partition are judged by the same signature rule', async () => {
  const ctx = await fakeHome([
    `${AS}/Teams/Cache`, `${AS}/Teams/Code Cache`,
    `${AS}/Teams/Partitions/msa/Cache`, `${AS}/Teams/Partitions/msa/Code Cache`, `${AS}/Teams/Partitions/msa/GPUCache`,
    `${AS}/Teams/Partitions/msa/Local Storage`, `${AS}/Teams/Partitions/msa/Service Worker`,
    `${AS}/Teams/Partitions/leftover/Cache`,   // lone Cache — not a profile
  ])
  const got = await electronScanner.probe(ctx, new Set())
  assert.deepEqual(got.map((c) => c.label).sort(), [
    'Teams Cache', 'Teams Code Cache', 'Teams msa Cache', 'Teams msa Code Cache', 'Teams msa GPUCache',
  ])
  assert.ok(!got.some((c) => /Storage|Service Worker/.test(c.path)), 'partition app data was claimed')
})

test('a claimed app root hides its partitions too', async () => {
  const ctx = await fakeHome([
    `${AS}/Postman/Cache`, `${AS}/Postman/Code Cache`,
    `${AS}/Postman/Partitions/p1/Cache`, `${AS}/Postman/Partitions/p1/Code Cache`,
  ])
  const claimed = new Set([path.join(ctx.home, AS, 'Postman')])
  assert.deepEqual(await electronScanner.probe(ctx, claimed), [])
})
