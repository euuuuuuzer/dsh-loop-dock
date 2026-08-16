import assert from 'node:assert/strict'
import test from 'node:test'

import {
  InvalidConfigError,
  InvalidDriverError,
  LoopSwitchError,
  MissingDriverError,
  UnknownLoopError,
} from '../src/errors.mjs'
import { LoopDock } from '../src/hub.mjs'

function fakeSession() {
  const events = []
  return {
    events,
    append(type, data) {
      const event = { type, seq: events.length, data }
      events.push(event)
      return event
    },
  }
}

function fakeDriver(calls) {
  return {
    async createAgent(_ownerCtx, options) {
      calls.push(['create', options.loop])
      if (typeof options.setup === 'function') {
        const session = fakeSession()
        const commit = await options.setup({ agent: { session } })
        commit?.commit?.()
        calls.push(['selection', session.events.at(-1)?.data?.loop])
      }
      return { agent: { id: options.sessionId } }
    },
    async resume(_ownerCtx, options) {
      calls.push(['resume', options.loop])
      return { agent: { id: options.resumeSessionId } }
    },
  }
}

function dockWith(overrides = {}) {
  const services = {
    sessionPersistence: undefined,
    agents: undefined,
    ...overrides,
  }
  const ctx = {
    logger: { warn() {} },
    get(name) {
      return services[name]
    },
  }
  return { ctx, services, dock: new LoopDock(ctx, { defaultLoop: 'default' }) }
}

test('create/resume validate their required identity fields', async () => {
  const { dock } = dockWith()
  await assert.rejects(() => dock.createAgent({}, {}), InvalidConfigError)
  await assert.rejects(() => dock.createAgent({}, { sessionId: '' }), InvalidConfigError)
  await assert.rejects(() => dock.resume({}, {}), InvalidConfigError)
  await assert.rejects(() => dock.resume({}, { resumeSessionId: '' }), InvalidConfigError)
})

test('driver names follow the same identifier grammar as loop ids', () => {
  const { dock } = dockWith()
  assert.throws(() => dock.registerDriver('not a valid name', fakeDriver([])), InvalidDriverError)
})

test('driver selection is rejected for full driver loops', async () => {
  const { dock } = dockWith()
  dock.register({ id: 'full-driver', kind: 'driver', createAgent() {}, resume() {} })
  await assert.rejects(
    () => dock.createAgent({}, { sessionId: 's', loop: 'full-driver', driver: 'loop1' }),
    InvalidConfigError,
  )
})

test('create routes an explicit loop to a driver provider', async () => {
  const { dock } = dockWith()
  const calls = []
  dock.register({ id: 'pro-loop', kind: 'driver', ...fakeDriver(calls) })
  const handle = await dock.createAgent({}, { sessionId: 'session-1', loop: 'pro-loop' })
  assert.deepEqual(handle, { agent: { id: 'session-1' } })
  await assert.rejects(
    () => dock.createAgent({}, { sessionId: 'session-1', loop: 'missing' }),
    UnknownLoopError,
  )
})

test('create decorates driver options with the resolved loop', async () => {
  const { dock } = dockWith()
  const calls = []
  dock.register({ id: 'pro-loop', kind: 'driver', ...fakeDriver(calls) })
  await dock.createAgent({}, { sessionId: 'session-1', loop: 'pro-loop' })
  assert.deepEqual(calls, [
    ['create', 'pro-loop'],
    ['selection', undefined],
  ])
})

test('a loop-pinned provider/model overrides caller agentOptions', async () => {
  const { dock } = dockWith()
  const calls = []
  dock.register({
    id: 'pinned',
    kind: 'driver',
    provider: 'loop-ping',
    model: 'ping',
    async createAgent(_ownerCtx, options) {
      calls.push(options.agentOptions)
      return { agent: { id: options.sessionId } }
    },
    async resume() {},
  })
  await dock.createAgent({}, {
    sessionId: 'session-1',
    loop: 'pinned',
    agentOptions: { provider: 'provider-a', model: 'model-a', reasoningEffort: 'max', maxTokens: 512 },
  })
  assert.deepEqual(calls, [{
    loop: 'pinned',
    provider: 'loop-ping',
    model: 'ping',
    maxTokens: 512,
  }])
})

test('two-layer routing supports driver x strategy combinations', async () => {
  const { dock } = dockWith()
  const calls = []
  const labeledDriver = (label) => ({
    async createAgent(_ownerCtx, options) {
      calls.push([label, options.loop])
      return { agent: { id: options.sessionId } }
    },
    async resume() {},
  })

  dock.registerDriver('loop1', labeledDriver('driver-1'))
  dock.registerDriver('loop2', labeledDriver('driver-2'))
  assert.deepEqual(dock.listDrivers(), ['loop1', 'loop2'])

  for (const id of ['loop1.strategy1', 'loop1.strategy2', 'loop2.strategy3', 'loop2.strategy4']) {
    const driver = id.startsWith('loop1') ? 'loop1' : 'loop2'
    dock.register({ id, kind: 'strategy', driver, async setup() {} })
  }

  await dock.createAgent({}, { sessionId: 'a1', loop: 'loop1.strategy1' })
  await dock.createAgent({}, { sessionId: 'a2', loop: 'loop1.strategy2' })
  await dock.createAgent({}, { sessionId: 'a3', loop: 'loop2.strategy3' })
  await dock.createAgent({}, { sessionId: 'a4', loop: 'loop2.strategy4' })

  assert.deepEqual(calls, [
    ['driver-1', 'loop1.strategy1'],
    ['driver-1', 'loop1.strategy2'],
    ['driver-2', 'loop2.strategy3'],
    ['driver-2', 'loop2.strategy4'],
  ])
})

test('runtime driver selection combines the same strategy with different drivers', async () => {
  const { dock } = dockWith()
  const calls = []
  const labeledDriver = (label) => ({
    async createAgent(_ownerCtx, options) {
      calls.push([label, options.loop, options.driver])
      return { agent: { id: options.sessionId } }
    },
    async resume() {},
  })

  dock.registerDriver('loop1', labeledDriver('driver-1'))
  dock.registerDriver('loop2', labeledDriver('driver-2'))
  dock.register({ id: 'strategy-shared', kind: 'strategy', async setup() {} })

  await dock.createAgent({}, { sessionId: 'a', loop: 'strategy-shared', driver: 'loop1' })
  await dock.createAgent({}, { sessionId: 'b', loop: 'strategy-shared', driver: 'loop2' })

  assert.deepEqual(calls, [
    ['driver-1', 'strategy-shared', 'loop1'],
    ['driver-2', 'strategy-shared', 'loop2'],
  ])
})

test('a named-driver strategy waits for its specific driver', async () => {
  const { dock } = dockWith()
  dock.register({ id: 'loop2.strategy3', kind: 'strategy', driver: 'loop2', async setup() {} })
  await assert.rejects(
    () => dock.createAgent({}, { sessionId: 's', loop: 'loop2.strategy3' }),
    MissingDriverError,
  )
  dock.registerDriver('loop1', fakeDriver([]))
  await assert.rejects(
    () => dock.createAgent({}, { sessionId: 's', loop: 'loop2.strategy3' }),
    MissingDriverError,
  )
})

test('strategy loops need a registered default driver', async () => {
  const { dock } = dockWith()
  dock.register({
    id: 'demo-loop',
    kind: 'strategy',
    async setup(agentCtx) {
      agentCtx.agent.session.append('test/strategy-setup-ran', { loop: 'demo-loop' })
    },
  })
  await assert.rejects(
    () => dock.createAgent({}, { sessionId: 'session-1', loop: 'demo-loop' }),
    MissingDriverError,
  )

  const calls = []
  dock.registerDriver(fakeDriver(calls))
  await dock.createAgent({}, { sessionId: 'session-1', loop: 'demo-loop' })
  assert.deepEqual(calls, [
    ['create', 'demo-loop'],
    ['selection', 'demo-loop'],
  ])
})

test('caller setup runs before the strategy setup', async () => {
  const { dock } = dockWith()
  const order = []
  dock.registerDriver(fakeDriver([]))
  dock.register({
    id: 'demo-loop',
    kind: 'strategy',
    async setup() { order.push('strategy') },
  })
  await dock.createAgent({}, {
    sessionId: 'session-1',
    loop: 'demo-loop',
    setup: async () => { order.push('caller') },
  })
  assert.deepEqual(order, ['caller', 'strategy'])
})

test('create records the resolved binding through the known session event', async () => {
  const { dock } = dockWith()
  const calls = []
  dock.registerDriver('loop1', {
    async createAgent(_ownerCtx, options) {
      const session = fakeSession()
      await options.setup?.({ agent: { session } })
      calls.push([options.loop, options.driver, session.events])
      return { agent: { id: options.sessionId } }
    },
    async resume() {},
  })
  dock.register({ id: 'standard', kind: 'strategy', async setup() {} })
  await dock.createAgent({}, { sessionId: 's1', loop: 'standard', driver: 'loop1' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'standard')
  assert.equal(calls[0][1], 'loop1')
  const events = calls[0][2]
  assert.equal(events.filter((event) => event.type === 'agent-loop/selected').length, 0)
  const binding = events.findLast((event) => event.type === 'agent-preset/selected')
  assert.deepEqual(binding?.data?.agentLoopDock, { loop: 'standard', driver: 'loop1' })
})

test('resume recovers the driver from the known binding event', async () => {
  const session = fakeSession()
  session.append('agent-preset/selected', {
    agentPreset: 'standard',
    agentLoopDock: { loop: 'standard', driver: 'loop2' },
  })
  const { dock } = dockWith({
    sessionPersistence: {
      async inspect() {
        return { meta: { agentPreset: 'standard' }, events: session.events }
      },
    },
  })
  const calls = []
  const labeledDriver = (label) => ({
    async createAgent(_ownerCtx, options) {
      calls.push(['create', label, options.loop, options.driver])
      return { agent: { id: options.sessionId } }
    },
    async resume(_ownerCtx, options) {
      calls.push(['resume', label, options.loop, options.driver])
      return { agent: { id: options.resumeSessionId } }
    },
  })
  dock.registerDriver('default', labeledDriver('default'))
  dock.registerDriver('loop2', labeledDriver('loop2'))
  dock.register({ id: 'standard', kind: 'strategy', async setup() {} })
  dock.driverSettings = { get: () => ({ defaultDriver: 'default' }) }

  await dock.resume({}, { resumeSessionId: 'session-1' })
  assert.deepEqual(calls, [['resume', 'loop2', 'standard', 'loop2']])
})

test('sessions without a preset resume on their recorded loop and driver', async () => {
  const services = {}
  const ctx = {
    logger: { warn() {} },
    get(name) {
      return services[name]
    },
  }
  const dock = new LoopDock(ctx, { defaultLoop: 'standard', defaultDriver: 'default' })
  const calls = []
  let recordedEvents
  const labeledDriver = (label) => ({
    async createAgent(_ownerCtx, options) {
      const session = fakeSession()
      await options.setup?.({ agent: { session } })
      recordedEvents = session.events
      calls.push(['create', label, options.loop, options.driver])
      return { agent: { id: options.sessionId } }
    },
    async resume(_ownerCtx, options) {
      calls.push(['resume', label, options.loop, options.driver])
      return { agent: { id: options.resumeSessionId } }
    },
  })
  dock.registerDriver('loop1', labeledDriver('loop1'))
  dock.registerDriver('default', labeledDriver('default'))
  dock.register({ id: 'custom', kind: 'strategy', async setup() {} })

  await dock.createAgent({}, { sessionId: 's1', loop: 'custom', driver: 'loop1' })
  services.sessionPersistence = {
    async inspect() {
      return { meta: {}, events: recordedEvents }
    },
  }
  dock.driverSettings = { get: () => ({ defaultDriver: 'default' }) }
  await dock.resume({}, { resumeSessionId: 's1' })

  assert.deepEqual(calls, [
    ['create', 'loop1', 'custom', 'loop1'],
    ['resume', 'loop1', 'custom', 'loop1'],
  ])
})

test('resume recovers the persisted loop from the session log', async () => {
  const session = fakeSession()
  session.append('agent-preset/selected', { agentLoopDock: { loop: 'persisted-loop' } })
  const { dock } = dockWith({
    sessionPersistence: {
      async inspect() {
        return { meta: {}, events: session.events }
      },
    },
  })
  const calls = []
  dock.register({ id: 'persisted-loop', kind: 'driver', ...fakeDriver(calls) })
  await dock.resume({}, { resumeSessionId: 'session-1' })
  assert.deepEqual(calls, [['resume', 'persisted-loop']])
})

test('the pinned model route follows the session effective preset per request', async () => {
  const { dock } = dockWith()
  dock.config.presetLoops = {
    'fake-example-preset': { loop: 'fake' },
    standard: { loop: 'standard' },
  }
  dock.register({ id: 'standard', kind: 'strategy', async setup() {} })
  dock.register({ id: 'fake', kind: 'strategy', provider: 'loop-ping', model: 'ping', async setup() {} })
  dock.registerDriver({
    async createAgent(_ownerCtx, options) {
      // Faithful cordis waterfall model: the hook array runs outermost-first
      // (first-registered listener wraps the rest, its return wins);
      // `prepend` unshifts to the front.
      const state = { effective: 'standard', webOverride: true }
      const handlers = []
      const agentCtx = {
        agent: { options: { provider: 'x', model: 'y' } },
        get(key) {
          if (key === 'agentPresets') return { composedPreset: () => state.effective }
          return undefined
        },
        on(_event, handler, opts) {
          if (opts?.prepend) handlers.unshift(handler)
          else handlers.push(handler)
          return () => {}
        },
      }
      await options.setup(agentCtx)
      // DSH Web's installModelSelection registers after the dock setup (no
      // prepend) and re-applies the selected model + effort.
      agentCtx.on('agent/request', async (_payload, next) => {
        const resolved = await next()
        if (!state.webOverride) return resolved
        return { ...resolved, provider: 'provider-a', model: 'model-a', reasoningEffort: 'max' }
      })
      return {
        agent: {
          id: options.sessionId,
          state,
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
    },
    async resume() {},
  })

  const handle = await dock.createAgent({}, {
    sessionId: 's1',
    loop: 'standard',
    agentOptions: { provider: 'x', model: 'y' },
  })
  const seed = () => Promise.resolve({ provider: 'seed', model: 'seed', maxTokens: 100 })

  // Created under the standard preset: no pin — the caller/web model wins.
  let result = await handle.agent.run(seed)
  assert.deepEqual(result, {
    provider: 'provider-a',
    model: 'model-a',
    reasoningEffort: 'max',
    maxTokens: 100,
  })

  // Blank-session switch to the fake binding (hero chip): the pin applies.
  handle.agent.state.effective = 'fake-example-preset'
  result = await handle.agent.run(seed)
  assert.deepEqual(result, { provider: 'loop-ping', model: 'ping', maxTokens: 100 })

  // Switch back to standard (web flow): the pin releases, the user model wins.
  handle.agent.state.effective = 'standard'
  result = await handle.agent.run(seed)
  assert.deepEqual(result, {
    provider: 'provider-a',
    model: 'model-a',
    reasoningEffort: 'max',
    maxTokens: 100,
  })

  // Non-web release: a stale pin persisted in the request header must not
  // leak — fall back to the agent's creation-time route.
  handle.agent.state.webOverride = false
  const staleSeed = () => Promise.resolve({ provider: 'loop-ping', model: 'ping', maxTokens: 100 })
  result = await handle.agent.run(staleSeed)
  assert.deepEqual(result, { provider: 'x', model: 'y', maxTokens: 100 })
})

test('the settings default driver drives new sessions', async () => {
  const { dock } = dockWith()
  dock.driverSettings = { get: () => ({ defaultDriver: 'loop2' }) }
  const calls = []
  const labeledDriver = (label) => ({
    async createAgent(_ownerCtx, options) {
      calls.push([label, options.loop, options.driver])
      return { agent: { id: options.sessionId } }
    },
    async resume() {},
  })
  dock.registerDriver('loop2', labeledDriver('driver-2'))
  dock.register({ id: 'strategy', kind: 'strategy', async setup() {} })

  await dock.createAgent({}, { sessionId: 's', loop: 'strategy' })
  assert.deepEqual(calls, [['driver-2', 'strategy', 'loop2']])
})

test('resume prefers the newest agent-preset/selected event over the header', async () => {
  const session = fakeSession()
  session.append('agent-preset/selected', { agentPreset: 'old-preset' })
  session.append('agent-preset/selected', { agentPreset: 'fake-example-preset' })
  const { ctx } = dockWith({
    sessionPersistence: {
      async inspect() {
        return { meta: { agentPreset: 'old-preset' }, events: session.events }
      },
    },
  })
  const dock = new LoopDock(ctx, {
    defaultLoop: 'default',
    presetLoops: { 'fake-example-preset': 'fake' },
  })
  const calls = []
  dock.register({ id: 'fake', kind: 'driver', ...fakeDriver(calls) })
  await dock.resume({}, { resumeSessionId: 'session-1' })
  assert.deepEqual(calls, [['resume', 'fake']])
})

test('resume refuses to switch a session to a different loop', async () => {
  const session = fakeSession()
  session.append('agent-preset/selected', { agentLoopDock: { loop: 'persisted-loop' } })
  const { dock } = dockWith({
    sessionPersistence: {
      async inspect() {
        return { meta: {}, events: session.events }
      },
    },
  })
  dock.register({ id: 'other-loop', kind: 'driver', createAgent() {}, resume() {} })
  await assert.rejects(
    () => dock.resume({}, { resumeSessionId: 'session-1', loop: 'other-loop' }),
    LoopSwitchError,
  )
})

test('config validation rejects inconsistent agent identities', () => {
  assert.throws(
    () => new LoopDock({}, {
      agents: [{ id: 'x', sessionId: 'a', resumeSessionId: 'b' }],
    }),
    InvalidConfigError,
  )
})

test('configured agents are created through the selected loop', async () => {
  const calls = []
  const { dock } = dockWith({
    agents: {
      async create(options) {
        calls.push(['create', options.sessionId, options.loop])
      },
      async resume(options) {
        calls.push(['resume', options.resumeSessionId, options.loop])
      },
    },
  })
  dock.register({ id: 'pro-loop', kind: 'strategy', async setup() {} })
  dock.registerDriver(fakeDriver([]))
  dock.config.agents.push({ id: 'planner', sessionId: 'p-session', loop: 'pro-loop' })
  await Promise.all(dock.startConfiguredAgents())
  assert.deepEqual(calls, [['create', 'p-session', 'pro-loop']])
})

test('configured driver-loop agents do not wait for the default driver', async () => {
  const calls = []
  const { dock } = dockWith({
    agents: {
      async create(options) {
        calls.push(['create', options.sessionId, options.loop])
      },
      async resume() {},
    },
  })
  dock.register({ id: 'driver-loop', kind: 'driver', createAgent() {}, resume() {} })
  dock.config.agents.push({ id: 'standalone', sessionId: 'driver-session', loop: 'driver-loop' })

  await Promise.all(dock.startConfiguredAgents())
  assert.deepEqual(calls, [['create', 'driver-session', 'driver-loop']])
})

test('configured sessionId restores a persisted session instead of recreating it', async () => {
  const calls = []
  const { dock } = dockWith({
    agents: {
      async create(options) {
        calls.push(['create', options.sessionId])
      },
      async resume(options) {
        calls.push(['resume', options.resumeSessionId])
      },
    },
    sessionPersistence: {
      async list() {
        return [{ id: 'persisted-session' }]
      },
    },
  })
  dock.register({ id: 'pro-loop', kind: 'strategy', async setup() {} })
  dock.registerDriver(fakeDriver([]))
  dock.config.agents.push({ id: 'planner', sessionId: 'persisted-session', loop: 'pro-loop' })
  await Promise.all(dock.startConfiguredAgents())
  assert.deepEqual(calls, [['resume', 'persisted-session']])
})

test('configured agents queue until the driver row registers', async () => {
  const calls = []
  const { dock } = dockWith({
    agents: {
      async create(options) {
        calls.push(['create', options.sessionId, options.loop])
      },
      async resume() {},
    },
  })
  dock.config.agents.push({ id: 'planner', sessionId: 'p-session', loop: 'pro-loop' })
  dock.register({ id: 'pro-loop', kind: 'strategy', async setup() {} })

  assert.deepEqual(dock.startConfiguredAgents(), [])
  assert.deepEqual(calls, [])

  dock.registerDriver(fakeDriver([]))
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(calls, [['create', 'p-session', 'pro-loop']])
})

test('configured strategy agents wait for the settings-selected default driver', async () => {
  const calls = []
  const { dock, services } = dockWith()
  dock.driverSettings = { get: () => ({ defaultDriver: 'loop2' }) }
  services.agents = {
    create(options) {
      return dock.createAgent({}, options)
    },
    resume(options) {
      return dock.resume({}, options)
    },
  }
  const labeledDriver = (label) => ({
    async createAgent(_ownerCtx, options) {
      calls.push(['create', label, options.loop])
      return { agent: { id: options.sessionId } }
    },
    async resume(_ownerCtx, options) {
      calls.push(['resume', label, options.loop])
      return { agent: { id: options.resumeSessionId } }
    },
  })
  dock.register({ id: 'standard', kind: 'strategy', async setup() {} })
  dock.registerDriver('default', labeledDriver('default'))
  dock.config.agents.push({ id: 'planner', sessionId: 'p-session', loop: 'standard' })

  assert.deepEqual(dock.startConfiguredAgents(), [])
  assert.deepEqual(calls, [])

  dock.registerDriver('loop2', labeledDriver('loop2'))
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(calls, [['create', 'loop2', 'standard']])
})
