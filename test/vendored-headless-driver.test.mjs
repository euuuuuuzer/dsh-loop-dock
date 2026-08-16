import assert from 'node:assert/strict'
import test from 'node:test'

import { createHeadlessDriverAdapter } from '../src/default-driver.mjs'
import { HeadlessAgentLoop } from '../vendor/dsh-agent-loop-headless/index.js'

function fakeContext() {
  const calls = []
  const ctx = {
    fiber: {},
    get() {
      return undefined
    },
    effect(callback) {
      calls.push(callback?.() ?? (() => {}))
      return () => {}
    },
  }
  return { ctx, calls }
}

test('vendored headless driver no longer self-registers as a Service/factory', () => {
  const { ctx } = fakeContext()
  const driver = new HeadlessAgentLoop(ctx, { maxParallelToolCalls: 10, agents: [] })

  // Plain class, not a Cordis Service with a service name.
  assert.equal(driver.name, undefined)
  assert.equal(typeof driver.createAgent, 'function')
  assert.equal(typeof driver.resume, 'function')
})

test('two vendored headless drivers can be constructed from the same context', () => {
  const { ctx } = fakeContext()
  const first = new HeadlessAgentLoop(ctx, { maxParallelToolCalls: 10, agents: [] })
  const second = new HeadlessAgentLoop(ctx, { maxParallelToolCalls: 4, agents: [] })
  assert.notEqual(first, second)
  assert.equal(first.config.maxParallelToolCalls, 10)
  assert.equal(second.config.maxParallelToolCalls, 4)
})

test('headless driver adapter wraps the vendored driver and can dispose it', async () => {
  const { ctx } = fakeContext()
  const driver = createHeadlessDriverAdapter({
    HeadlessAgentLoop,
    ctx,
    config: { maxParallelToolCalls: 3 },
  })
  assert.equal(typeof driver.createAgent, 'function')
  assert.equal(typeof driver.resume, 'function')
  await driver.dispose()
})
