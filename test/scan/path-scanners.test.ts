import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pkgCacheScanner } from '../../src/scan/pkg-cache.ts'
import { xcodeScanner } from '../../src/scan/xcode.ts'
import { editorsScanner } from '../../src/scan/editors.ts'
import { browsersScanner } from '../../src/scan/browsers.ts'
import type { ScanContext } from '../../src/scan/scanner.ts'

async function fakeHome(dirs: string[]): Promise<ScanContext> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-home-'))
  for (const d of dirs) await fs.mkdir(path.join(home, d), { recursive: true })
  return { home, staleDays: 60, now: Date.now(), applicationDirs: [] }
}

test('finds package caches that exist and skips those that do not', async () => {
  const ctx = await fakeHome(['.npm/_cacache', '.bun/install/cache'])
  const got = await pkgCacheScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, ['bun cache', 'npm cache'])
  assert.ok(got.every((c) => c.group === 'pkg'))
})

test('finds the npx cache and the pnpm store', async () => {
  const ctx = await fakeHome(['.npm/_npx', 'Library/pnpm/store'])
  const got = await pkgCacheScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, ['npx cache', 'pnpm store'])
})

test('marks device support as needing the original device', async () => {
  const ctx = await fakeHome(['Library/Developer/Xcode/iOS DeviceSupport'])
  const [got] = await xcodeScanner.probe(ctx)
  assert.ok(got)
  assert.match(got.note ?? '', /exact device/)
})

test('finds Xcode derived data and device support', async () => {
  const ctx = await fakeHome([
    'Library/Developer/Xcode/DerivedData',
    'Library/Developer/Xcode/iOS DeviceSupport',
  ])
  const got = await xcodeScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, ['Xcode DerivedData', 'iOS DeviceSupport'])
})

test('never claims Xcode Archives', async () => {
  const ctx = await fakeHome(['Library/Developer/Xcode/Archives'])
  const got = await xcodeScanner.probe(ctx)
  assert.equal(got.length, 0, 'Archives are shipping artifacts and must never be claimed')
})

test('finds editor caches but not editor settings', async () => {
  const ctx = await fakeHome([
    'Library/Application Support/Cursor/CachedData',
    'Library/Application Support/Cursor/User',
    'Library/Application Support/Code/GPUCache',
  ])
  const got = await editorsScanner.probe(ctx)
  const paths = got.map((c) => c.path)
  assert.equal(paths.length, 2)
  assert.ok(!paths.some((p) => p.endsWith('/User')), 'editor settings must never be claimed')
})

test('finds browser caches per profile and marks service workers', async () => {
  const ctx = await fakeHome([
    'Library/Application Support/Google/Chrome/Default/Service Worker',
    'Library/Application Support/Google/Chrome/Default/GPUCache',
    'Library/Application Support/Google/Chrome/Default/Login Data',
  ])
  const got = await browsersScanner.probe(ctx)
  const sw = got.find((c) => c.path.endsWith('Service Worker'))
  assert.ok(sw, 'service worker directory not found')
  assert.equal(sw.note, 'may hold offline app data')
  assert.ok(!got.some((c) => c.path.endsWith('Login Data')), 'browser profile data must never be claimed')
})

test('finds the Go, Maven, CocoaPods, pub, NuGet, Composer and Yarn Berry caches', async () => {
  const ctx = await fakeHome([
    'go/pkg/mod/cache', '.m2/repository', '.cocoapods/repos', '.pub-cache',
    '.nuget/packages', '.composer/cache', '.yarn/berry/cache',
  ])
  const got = await pkgCacheScanner.probe(ctx)
  assert.deepEqual(got.map((c) => c.label).sort(), [
    'CocoaPods specs', 'Composer cache', 'Go module download cache', 'Maven repository',
    'NuGet packages', 'Yarn Berry cache', 'pub cache',
  ])
})

test('finds the conda package cache wherever the distribution lives', async () => {
  const ctx = await fakeHome(['miniconda3/pkgs', '.conda/pkgs'])
  const got = await pkgCacheScanner.probe(ctx)
  assert.equal(got.filter((c) => c.label === 'conda packages').length, 2)
})

test('claims SwiftUI preview simulators alongside DerivedData', async () => {
  const ctx = await fakeHome(['Library/Developer/Xcode/UserData/Previews'])
  const got = await xcodeScanner.probe(ctx)
  assert.deepEqual(got.map((c) => c.label), ['Xcode Previews'])
})
