import assert from 'node:assert/strict'
import test from 'node:test'

import { createHeadlessDriverAdapter } from '../src/default-driver.mjs'
import { InvalidDriverError } from '../src/errors.mjs'

test('headless driver adapter strips declarative agents and delegates', async () => {
  const seen = []
  class FakeHeadlessLoop {
    constructor(_ctx, config) {
      seen.push(config)
    }
    async createAgent(ownerCtx, options) {
      seen.push(['create', options])
      return { ownerCtx }
    }
    async resume(ownerCtx, options) {
      seen.push(['resume', options])
      return { ownerCtx }
    }
    async dispose() {
      seen.push(['dispose'])
    }
  }

  const driver = createHeadlessDriverAdapter({
    HeadlessAgentLoop: FakeHeadlessLoop,
    ctx: {},
    config: { maxParallelToolCalls: 4, agents: [{ id: 'must-not-run' }] },
  })
  assert.equal(seen[0].maxParallelToolCalls, 4)
  assert.deepEqual(seen[0].agents, [])

  const options = { sessionId: 's' }
  assert.deepEqual(await driver.createAgent('owner', options), { ownerCtx: 'owner' })
  assert.deepEqual(seen.at(-1), ['create', options])
  await driver.dispose()
  assert.deepEqual(seen.at(-1), ['dispose'])
})

test('headless driver adapter rejects a missing class', () => {
  assert.throws(() => createHeadlessDriverAdapter({ HeadlessAgentLoop: undefined, ctx: {} }), InvalidDriverError)
})
