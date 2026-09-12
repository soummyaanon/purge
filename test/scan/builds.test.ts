import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildsScanner } from '../../src/scan/builds.ts'
import type { DirVisit } from '../../src/scan/walker.ts'
import type { ScanContext } from '../../src/scan/scanner.ts'

const ctx: ScanContext = { home: '/Users/x', staleDays: 60, now: Date.now(), applicationDirs: [] }

function visit(p: string, over: Partial<DirVisit> = {}): DirVisit {
  const parts = p.split('/')
  return {
    path: p, name: parts[parts.length - 1] as string,
    parent: parts.slice(0, -1).join('/'), entries: [], parentEntries: [], ...over,
  }
}

test('claims unambiguous framework output directories', async () => {
  for (const name of ['.next', '.turbo', '.parcel-cache', '.svelte-kit', '.astro']) {
    const got = await buildsScanner.inspect(visit(`/Users/x/proj/${name}`), ctx)
    assert.ok(got, `${name} was not claimed`)
    assert.equal(got.label, name)
    assert.equal(got.group, 'builds')
  }
})

test('claims dist when the parent has a package.json', async () => {
  const got = await buildsScanner.inspect(
    visit('/Users/x/proj/dist', { parentEntries: ['package.json', 'dist'] }),
    ctx,
  )
  assert.ok(got)
  assert.equal(got.label, 'dist')
})

test('ignores build directories with no manifest beside them', async () => {
  const got = await buildsScanner.inspect(
    visit('/Users/x/docs/build', { parentEntries: ['index.md'] }),
    ctx,
  )
  assert.equal(got, null)
})

test('ignores directories it does not recognise', async () => {
  assert.equal(await buildsScanner.inspect(visit('/Users/x/proj/src'), ctx), null)
})

test('claims tool caches and Terraform state that any init regenerates', async () => {
  for (const name of ['.terraform', '.dart_tool', '.gradle', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.angular', '.docusaurus', '.serverless', '.nuxt']) {
    const got = await buildsScanner.inspect(visit(`/Users/x/proj/${name}`), ctx)
    assert.ok(got, `${name} was not claimed`)
  }
})

test('claims build next to a Flutter, Gradle or CMake manifest', async () => {
  for (const manifest of ['pubspec.yaml', 'build.gradle', 'build.gradle.kts', 'settings.gradle.kts', 'CMakeLists.txt']) {
    const got = await buildsScanner.inspect(visit('/Users/x/proj/build', { parentEntries: [manifest, 'build'] }), ctx)
    assert.ok(got, `build beside ${manifest} was not claimed`)
  }
})

test('claims target next to a Maven or sbt manifest, and nowhere else', async () => {
  assert.ok(await buildsScanner.inspect(visit('/Users/x/proj/target', { parentEntries: ['pom.xml'] }), ctx))
  assert.ok(await buildsScanner.inspect(visit('/Users/x/proj/target', { parentEntries: ['build.sbt'] }), ctx))
  assert.equal(await buildsScanner.inspect(visit('/Users/x/proj/target', { parentEntries: ['package.json'] }), ctx), null)
  assert.equal(await buildsScanner.inspect(visit('/Users/x/proj/target', { parentEntries: [] }), ctx), null)
})

test('claims a project .cache only beside a package.json', async () => {
  assert.ok(await buildsScanner.inspect(visit('/Users/x/proj/.cache', { parentEntries: ['package.json'] }), ctx))
  assert.equal(await buildsScanner.inspect(visit('/Users/x/proj/.cache', { parentEntries: ['notes.md'] }), ctx), null)
})
