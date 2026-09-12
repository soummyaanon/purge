import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeVersionNotice } from '../../src/util/node-version.ts'

test('says nothing on a supported Node', () => {
  assert.equal(nodeVersionNotice('22.18.0'), null)
  assert.equal(nodeVersionNotice('24.1.0'), null)
})

test('names the running and required versions on an older Node', () => {
  const out = nodeVersionNotice('20.11.1')
  assert.ok(out)
  assert.match(out, /20\.11\.1/)
  assert.match(out, /22\.18/)
})

test('a 22.x below the patch floor is still old', () => {
  assert.ok(nodeVersionNotice('22.3.0'))
})
