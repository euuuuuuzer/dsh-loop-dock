import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject, name } from '../src/index.mjs'

function fakePluginContext() {
  const calls = []
  const ctx = {
    agents: {
      setFactory(factory) {
        calls.push(['setFactory', factory])
        return () => {}
      },
    },
    systemPrompt: {
      variable(name) {
        calls.push(['variable', name])
        return () => {}
      },
    },
    provide(service, value) {
      calls.push(['provide', service, value])
      return () => {}
    },
    effect(callback) {
      calls.push(['effect'])
      // Cordis effects run synchronously when they are registered; emulate
      // that so setFactory/service disposers are observable in tests.
      return callback?.() ?? (() => {})
    },
    get(key) {
      return undefined
    },
  }
  return { ctx, calls }
}

test('plugin entry registers the ping adapter for loop-ping sessions', () => {
  const { ctx } = fakePluginContext()
  const registered = []
  ctx.llm = {
    registerAdapter(providers, adapter) {
      registered.push([providers, adapter])
      return () => {}
    },
  }
  const dock = apply(ctx, { defaultLoop: 'standard' })
  assert.equal(dock.listLoops().length, 1)
  assert.equal(registered.length, 1)
  assert.deepEqual(registered[0][0], ['loop-ping'])
  assert.equal(typeof registered[0][1].stream, 'function')
  assert.equal(typeof registered[0][1].resolveModel, 'function')
  assert.equal(registered[0][1].reply, 'loop-ping: local no-model reply (generated locally, no model call).')
})

test('config.pingReply overrides the ping adapter reply text', () => {
  const { ctx } = fakePluginContext()
  const registered = []
  ctx.llm = {
    registerAdapter(providers, adapter) {
      registered.push([providers, adapter])
      return () => {}
    },
  }
  apply(ctx, { defaultLoop: 'standard', pingReply: '[FAKE-LOOP] fake debug loop reply' })
  assert.equal(registered[0][1].reply, '[FAKE-LOOP] fake debug loop reply')
})

test('plugin entry registers the dock as the one factory', () => {
  const { ctx, calls } = fakePluginContext()
  const dock = apply(ctx, { defaultLoop: 'standard' })

  assert.equal(name, 'dsh-loop-dock')
  assert.deepEqual(inject, ['agents', 'sessions', 'llm', 'tools', 'systemPrompt'])
  assert.equal(dock.listLoops().length, 1)
  assert.ok(dock.registry.has('standard'))
  assert.equal(dock.registry.has('removed-community-loop'), false)

  const setFactory = calls.find((call) => call[0] === 'setFactory')
  assert.equal(setFactory?.[1], dock)
  const provide = calls.find((call) => call[0] === 'provide')
  assert.equal(provide?.[1], 'agentLoopDock')
  assert.equal(provide?.[2], dock)
  assert.deepEqual(
    calls.filter((call) => call[0] === 'variable').map((call) => call[1]),
    ['provider', 'model', 'cwd'],
  )
})

test('built-in strategy slots mount their real presets by id', async () => {
  const { ctx } = fakePluginContext()
  const dock = apply(ctx, { defaultLoop: 'standard' })
  const mounted = []
  const presets = {
    async mount(agentCtx, id) {
      mounted.push([agentCtx, id])
    },
  }

  for (const id of ['standard']) {
    const loop = dock.registry.require(id)
    assert.equal(loop.kind, 'strategy')
    await loop.setup({ get: () => presets })
  }

  assert.deepEqual(mounted.map(([, id]) => id), ['standard'])
})

test('DSH-style caller setup mounts the preset first and the slot skips its own mount', async () => {
  const { ctx } = fakePluginContext()
  const dock = apply(ctx, { defaultLoop: 'standard' })
  const mounted = []
  const presets = {
    current: undefined,
    composedPreset() {
      return this.current
    },
    async mount(_agentCtx, id) {
      this.current = id
      mounted.push(id)
    },
  }
  dock.registerDriver({
    async createAgent(_ownerCtx, options) {
      await options.setup({ get: () => presets })
      return { agent: { id: options.sessionId } }
    },
    async resume() {},
  })

  await dock.createAgent({}, {
    sessionId: 'session-1',
    loop: 'standard',
    setup: async (agentCtx) => {
      await agentCtx.get('agentPresets').mount(agentCtx, 'standard')
    },
  })

  assert.deepEqual(mounted, ['standard'])
})

test('built-in preset setups never mount twice', async () => {
  const { ctx } = fakePluginContext()
  const dock = apply(ctx, { defaultLoop: 'standard' })
  const mounted = []
  const presets = {
    current: undefined,
    composedPreset() {
      return this.current
    },
    async mount(_agentCtx, id) {
      this.current = id
      mounted.push(id)
    },
  }
  const loop = dock.registry.require('standard')
  const agentCtx = { get: () => presets }

  await loop.setup(agentCtx)
  await loop.setup(agentCtx)

  assert.deepEqual(mounted, ['standard'])
})
