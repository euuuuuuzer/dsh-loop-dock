import assert from 'node:assert/strict'
import test from 'node:test'

import { composeSetups, wrapStrategyLoop } from '../src/provider.mjs'

test('composeSetups runs setups in order and commits in order', async () => {
  const calls = []
  const setup = composeSetups([
    async () => {
      calls.push('a')
      return { commit() { calls.push('commit-a') } }
    },
    async () => {
      calls.push('b')
      return { commit() { calls.push('commit-b') } }
    },
  ])

  const result = await setup({})
  assert.deepEqual(calls, ['a', 'b'])
  result.commit()
  assert.deepEqual(calls, ['a', 'b', 'commit-a', 'commit-b'])
})

test('composeSetups accepts plain-function commits from third-party drivers', async () => {
  const committed = []
  const setup = composeSetups([
    async () => {
      return () => committed.push('x')
    },
  ])
  const result = await setup({})
  result.commit()
  assert.deepEqual(committed, ['x'])
})

test('wrapStrategyLoop delegates create/resume through the driver', async () => {
  const events = []
  const driver = {
    async createAgent(_ownerCtx, options) {
      events.push('create')
      const result = await options.setup({})
      result?.commit?.()
      return { ok: true }
    },
    async resume(_ownerCtx, options) {
      events.push('resume')
      await options.setup({})
      return { ok: true }
    },
  }
  const strategy = {
    id: 'demo',
    kind: 'strategy',
    async setup() {
      events.push('strategy')
    },
  }
  const wrapped = wrapStrategyLoop(strategy, driver)

  assert.equal(wrapped.kind, 'driver')
  assert.equal((await wrapped.createAgent({}, { setup: async () => { events.push('user') } })).ok, true)
  assert.deepEqual(events, ['create', 'user', 'strategy'])

  events.length = 0
  await wrapped.resume({}, {})
  assert.deepEqual(events, ['resume', 'strategy'])
})
