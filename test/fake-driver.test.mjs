import assert from 'node:assert/strict'
import test from 'node:test'

import { LoopDock } from '../src/hub.mjs'
import { createFakeDriverAdapter, FAKE_DRIVER_MODEL, FAKE_DRIVER_PROVIDER } from '../src/fake-driver.mjs'

test('fake driver adapter registers its ping adapter once per context', () => {
  let registrations = 0
  const contexts = []
  const makeContext = () => {
    const ctx = {
      llm: {
        registerAdapter() {
          registrations++
          return () => {}
        },
      },
    }
    contexts.push(ctx)
    return ctx
  }
  const fakeHeadless = class {
    constructor() {}
    async createAgent() {}
    async resume() {}
    dispose() {}
  }

  createFakeDriverAdapter({ HeadlessAgentLoop: fakeHeadless, ctx: makeContext(), config: {} })
  createFakeDriverAdapter({ HeadlessAgentLoop: fakeHeadless, ctx: makeContext(), config: {} })
  createFakeDriverAdapter({ HeadlessAgentLoop: fakeHeadless, ctx: contexts[0], config: {} })

  assert.equal(registrations, 2, 'each plugin context gets one registration; repeated calls on one context reuse it')
})

test('fake driver wins over a loop-pinned route because it installs last', async () => {
  class FakeHeadless {
    constructor() {}
    async createAgent(_ownerCtx, options) {
      const handlers = []
      const agentCtx = {
        agent: { options: options.agentOptions },
        get(name) {
          if (name === 'agentPresets') return { composedPreset: () => 'standard' }
          return undefined
        },
        on(_event, handler, opts) {
          if (opts?.prepend) handlers.unshift(handler)
          else handlers.push(handler)
          return () => {}
        },
      }
      await options.setup?.(agentCtx)
      return {
        agent: {
          async run(seed) {
            let next = () => Promise.resolve(seed())
            for (let index = handlers.length - 1; index >= 0; index -= 1) {
              const handler = handlers[index]
              const inner = next
              next = () => handler({}, inner)
            }
            return next()
          },
        },
      }
    }
    async resume() {}
    dispose() {}
  }

  const dock = new LoopDock({}, {
    defaultLoop: 'standard',
    presetLoops: { standard: { loop: 'pinned' } },
  })
  dock.registerDriver('fake-driver', createFakeDriverAdapter({
    HeadlessAgentLoop: FakeHeadless,
    ctx: { llm: { registerAdapter() { return () => {} } } },
    config: {},
  }))
  dock.register({ id: 'standard', kind: 'strategy', async setup() {} })
  dock.register({ id: 'pinned', kind: 'strategy', provider: 'loop-ping', model: 'ping', async setup() {} })

  const handle = await dock.createAgent({}, {
    sessionId: 's',
    loop: 'standard',
    driver: 'fake-driver',
    meta: { agentPreset: 'standard' },
    agentOptions: { provider: 'real', model: 'real' },
  })
  const result = await handle.agent.run(() => ({ provider: 'seed', model: 'seed' }))
  assert.deepEqual(result, { provider: FAKE_DRIVER_PROVIDER, model: FAKE_DRIVER_MODEL })
})
