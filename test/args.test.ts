import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from '../src/args.ts'

const D = {}
function ok(argv: string[]) {
  const r = parseArgs(argv, D)
  assert.ok(!('error' in r), `unexpected error: ${'error' in r ? r.error : ''}`)
  return r
}

test('defaults to an interactive scan over every group', () => {
  const o = ok([])
  assert.equal(o.command, 'scan')
  assert.equal(o.apply, false)
  assert.equal(o.dryRun, false)
  assert.deepEqual(o.groups, [
    'builds', 'pkg', 'xcode', 'caches', 'browsers', 'editors', 'agents', 'logs', 'orphans', 'heavy',
  ])
})

test('positional group names narrow the scan', () => {
  assert.deepEqual(ok(['builds', 'xcode']).groups, ['builds', 'xcode'])
})

test('rejects an unknown group name', () => {
  const r = parseArgs(['nonsense'], D)
  assert.ok('error' in r)
  assert.match(r.error, /unknown group/)
})

test('rejects an unknown flag', () => {
  const r = parseArgs(['--wat'], D)
  assert.ok('error' in r)
  assert.match(r.error, /unknown option/)
})

test('--yes sets apply', () => {
  assert.equal(ok(['--yes']).apply, true)
  assert.equal(ok(['-y']).apply, true)
})

test('--json implies dry run and never applies', () => {
  const o = ok(['--json', '--yes'])
  assert.equal(o.json, true)
  assert.equal(o.dryRun, true)
  assert.equal(o.apply, false)
})

test('--stale-days and --min-size take numeric values', () => {
  const o = ok(['--stale-days', '90', '--min-size', '50'])
  assert.equal(o.staleDays, 90)
  assert.equal(o.minSizeBytes, 50 * 1024 * 1024)
})

test('rejects a non-numeric --stale-days', () => {
  const r = parseArgs(['--stale-days', 'soon'], D)
  assert.ok('error' in r)
  assert.match(r.error, /number/)
})

test('history is a command, and --last narrows it', () => {
  const o = ok(['history', '--last', '--json'])
  assert.equal(o.command, 'history')
  assert.equal(o.last, true)
  assert.equal(o.json, true)
})

test('help and version are commands', () => {
  assert.equal(ok(['--help']).command, 'help')
  assert.equal(ok(['-h']).command, 'help')
  assert.equal(ok(['--version']).command, 'version')
})

test('config defaults apply when no flag overrides them', () => {
  const o = parseArgs([], { staleDays: 90 })
  assert.ok(!('error' in o))
  assert.equal(o.staleDays, 90)
})

test('an explicit flag beats a config default', () => {
  const o = parseArgs(['--stale-days', '10'], { staleDays: 90 })
  assert.ok(!('error' in o))
  assert.equal(o.staleDays, 10)
})

test('accepts the legacy group name claude as an alias for agents', () => {
  const o = parseArgs(['claude'], {})
  assert.ok(!('error' in o), 'claude must not be an unknown group')
  if (!('error' in o)) assert.deepEqual(o.groups, ['agents'])
})

test('--trash moves instead of deleting', () => {
  assert.equal(ok([]).trash, false)
  assert.equal(ok(['--trash']).trash, true)
})

test('undo is a command', () => {
  assert.equal(ok(['undo']).command, 'undo')
})

test('config can turn trash mode on, and a flag cannot turn it off', () => {
  const o = parseArgs([], { trash: true })
  assert.ok(!('error' in o))
  assert.equal(o.trash, true)
})
