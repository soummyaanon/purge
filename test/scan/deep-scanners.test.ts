import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sysCachesScanner } from '../../src/scan/sys-caches.ts'
import { logsScanner } from '../../src/scan/logs.ts'
import { heavyScanner } from '../../src/scan/heavy.ts'
import { agentsScanner } from '../../src/scan/agents.ts'
import type { ScanContext } from '../../src/scan/scanner.ts'

async function fakeHome(dirs: string[]): Promise<ScanContext> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-home-'))
  for (const d of dirs) await fs.mkdir(path.join(home, d), { recursive: true })
  return { home, staleDays: 60, now: Date.now(), applicationDirs: [] }
}

test('enumerates per-app cache dirs under Library/Caches and .cache', async () => {
  const ctx = await fakeHome([
    'Library/Caches/com.apple.Safari',
    'Library/Caches/JetBrains',
    '.cache/uv',
  ])
  const got = await sysCachesScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, ['.cache/uv', 'JetBrains', 'com.apple.Safari'])
  assert.ok(got.every((c) => c.group === 'caches'))
})

test('skips cache entries the pkg scanner already claims', async () => {
  const ctx = await fakeHome([
    'Library/Caches/Homebrew',
    'Library/Caches/ms-playwright',
    'Library/Caches/SomeApp',
  ])
  const got = await sysCachesScanner.probe(ctx)
  assert.deepEqual(got.map((c) => c.label), ['SomeApp'])
})

test('ignores plain files in the cache roots', async () => {
  const ctx = await fakeHome(['Library/Caches/RealApp'])
  await fs.writeFile(path.join(ctx.home, 'Library/Caches/.DS_Store'), 'junk')
  const got = await sysCachesScanner.probe(ctx)
  assert.deepEqual(got.map((c) => c.label), ['RealApp'])
})

test('survives a home with no cache roots at all', async () => {
  const ctx = await fakeHome([])
  const got = await sysCachesScanner.probe(ctx)
  assert.deepEqual(got, [])
})

test('reports each iOS backup, the Trash and Docker.raw as heavy items', async () => {
  const ctx = await fakeHome([
    'Library/Application Support/MobileSync/Backup/00008110-000A1',
    'Library/Application Support/MobileSync/Backup/00008120-000B2',
    '.Trash',
    'Library/Containers/com.docker.docker/Data/vms/0/data',
  ])
  await fs.writeFile(
    path.join(ctx.home, 'Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw'),
    'vm',
  )
  const got = await heavyScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, [
    '.Trash', 'Docker.raw', 'iOS backup 00008110-000A1', 'iOS backup 00008120-000B2',
  ])
  assert.ok(got.every((c) => c.group === 'heavy'))
})

test('claims Claude Desktop caches but never its settings or storage', async () => {
  const ctx = await fakeHome([
    'Library/Application Support/Claude/Cache',
    'Library/Application Support/Claude/GPUCache',
    'Library/Application Support/Claude/Local Storage',
    'Library/Application Support/Claude/IndexedDB',
  ])
  const got = await agentsScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, ['Claude Desktop Cache', 'Claude Desktop GPUCache'])
  assert.ok(got.every((c) => c.group === 'agents'))
})

test('claims Claude Code caches, transcripts and file history', async () => {
  const ctx = await fakeHome([
    '.claude/plugins/cache',
    '.claude/plugins/repos',
    '.claude/cache',
    '.claude/paste-cache',
    '.claude/projects',
    '.claude/file-history',
    '.claude/skills',
    '.claude/agents',
  ])
  const got = await agentsScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, [
    'Claude Code file history',
    'Claude Code paste cache',
    'Claude Code plugin cache',
    'Claude Code session transcripts',
    'Claude Code shared cache',
  ])
})

test('claims the sandbox scratchpad root when it exists', async () => {
  const ctx = await fakeHome([])
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-claude-tmp-'))
  const got = await agentsScanner.probe({ ...ctx, claudeTmpDir: tmp })
  assert.deepEqual(got.map((c) => c.label), ['Claude Code session scratchpads'])
  assert.equal(got[0]?.path, tmp)
})

test('heavy scanner finds nothing on a lean home', async () => {
  const ctx = await fakeHome([])
  assert.deepEqual(await heavyScanner.probe(ctx), [])
})

test('enumerates per-app log dirs under Library/Logs', async () => {
  const ctx = await fakeHome(['Library/Logs/Claude', 'Library/Logs/JetBrains'])
  await fs.writeFile(path.join(ctx.home, 'Library/Logs/stray.log'), 'x')
  const got = await logsScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, ['Claude', 'JetBrains'])
  assert.ok(got.every((c) => c.group === 'logs'))
})

test('claims Codex caches and logs, and its session history', async () => {
  const ctx = await fakeHome(['.codex/cache', '.codex/sessions', '.codex/plugins'])
  await fs.writeFile(path.join(ctx.home, '.codex/logs_2.sqlite'), 'db')
  await fs.writeFile(path.join(ctx.home, '.codex/logs_2.sqlite-wal'), 'wal')
  await fs.writeFile(path.join(ctx.home, '.codex/history.jsonl'), '{}')
  await fs.writeFile(path.join(ctx.home, '.codex/config.toml'), '')
  const got = await agentsScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  // logs_2.sqlite has a -wal sidecar: the database is open or was not
  // checkpointed, so neither file may be claimed.
  assert.deepEqual(labels, ['Codex cache', 'Codex history', 'Codex sessions'])
})

test('claims a Codex log db only when it is idle (no -wal/-shm sidecars)', async () => {
  const ctx = await fakeHome(['.codex'])
  await fs.writeFile(path.join(ctx.home, '.codex/logs_1.sqlite'), 'db')
  const got = await agentsScanner.probe(ctx)
  assert.deepEqual(got.map((c) => c.label), ['Codex log db (logs_1.sqlite)'])
})

test('claims Cursor AI tracking but never its extensions', async () => {
  const ctx = await fakeHome(['.cursor/ai-tracking', '.cursor/extensions', '.cursor/plugins'])
  const got = await agentsScanner.probe(ctx)
  assert.deepEqual(got.map((c) => c.label), ['Cursor AI tracking'])
})

test('probes the other coding agents only where they exist', async () => {
  const ctx = await fakeHome([
    '.gemini/tmp', '.copilot/logs', '.aider/caches', '.local/share/opencode/log',
  ])
  const got = await agentsScanner.probe(ctx)
  const labels = got.map((c) => c.label).sort()
  assert.deepEqual(labels, [
    'Copilot CLI logs', 'Gemini CLI tmp', 'aider cache', 'opencode logs',
  ])
})

test('reports simulators, Android images and emulators, local LLM models and OrbStack as heavy', async () => {
  const ctx = await fakeHome([
    'Library/Developer/CoreSimulator/Devices',
    '.android/avd',
    'Library/Android/sdk/system-images',
    '.ollama/models',
    '.lmstudio/models',
    '.orbstack/data',
  ])
  const got = await heavyScanner.probe(ctx)
  assert.deepEqual(got.map((c) => c.label).sort(), [
    'Android emulators', 'Android system images', 'LM Studio models', 'Ollama models',
    'OrbStack data', 'Simulator devices',
  ])
  assert.ok(got.every((c) => c.group === 'heavy'))
})

test('finds LM Studio models in its newer cache location too', async () => {
  const ctx = await fakeHome(['.cache/lm-studio/models'])
  const got = await heavyScanner.probe(ctx)
  assert.deepEqual(got.map((c) => c.label), ['LM Studio models'])
})
