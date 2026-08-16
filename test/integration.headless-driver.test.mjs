import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

import { createHeadlessDriverAdapter } from '../src/default-driver.mjs'
import { createFakeDriverAdapter } from '../src/fake-driver.mjs'
import { LoopDock } from '../src/hub.mjs'
import { HeadlessAgentLoop } from '../vendor/dsh-agent-loop-headless/index.js'

function textResponse(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char) => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class MockAdapter extends LlmAdapter {
  requests = []
  constructor() {
    super()
  }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }
  async *stream(options) {
    this.requests.push(options)
    for (const chunk of textResponse('ok')) yield chunk
  }
}

function toolCallChunks(name) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'call-1', name, argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name, arguments: '{}' } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** First request answers with a tool call, later requests answer with text. */
class ToolCallingAdapter extends LlmAdapter {
  requests = []
  calls = 0
  toolName = 'echo'
  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }
  async *stream(options) {
    this.requests.push(options)
    if (this.calls++ === 0) {
      for (const chunk of toolCallChunks(this.toolName)) yield chunk
    } else {
      for (const chunk of textResponse('done')) yield chunk
    }
  }
}

async function harness({ namedDrivers = false, adapter: customAdapter } = {}) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'integration-test' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)

  // Emulate the plugin row context for the headless driver: a Cordis fiber
  // whose inject list exposes the services the driver's driver reads through
  // agent scopes.
  let driverCtx
  await ctx.plugin(Object.assign((innerCtx) => {
    driverCtx = innerCtx
  }, {
    inject: ['agents', 'sessions', 'llm', 'tools', 'systemPrompt'],
  }))

  const adapter = customAdapter ?? new MockAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)

  const dock = new LoopDock(driverCtx, {
    defaultLoop: namedDrivers ? 'loop1.strategy1' : 'alpha',
  })

  if (namedDrivers) {
    const driverA = createHeadlessDriverAdapter({ HeadlessAgentLoop, ctx: driverCtx, config: {} })
    const driverB = createHeadlessDriverAdapter({ HeadlessAgentLoop, ctx: driverCtx, config: {} })
    dock.registerDriver('loop1', driverA)
    dock.registerDriver('loop2', driverB)
    dock.register({ id: 'loop1.strategy1', kind: 'strategy', driver: 'loop1', async setup() {} })
    dock.register({ id: 'loop2.strategy3', kind: 'strategy', driver: 'loop2', async setup() {} })
  } else {
    const driver = createHeadlessDriverAdapter({
      HeadlessAgentLoop,
      ctx: driverCtx,
      config: { maxParallelToolCalls: 2 },
    })
    dock.registerDriver(driver)
    dock.register({ id: 'alpha', kind: 'strategy', async setup() {} })
    dock.register({ id: 'beta', kind: 'strategy', async setup() {} })
  }

  driverCtx.agents.setFactory(dock)

  return { ctx, driverCtx, adapter, dock }
}

function waitForIdle(ctx, agent) {
  return new Promise((resolve) => {
    const off = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      off()
      resolve()
    })
    if (agent.status === 'idle') {
      off()
      resolve()
    }
  })
}

test('headless official driver creates two agents on two strategy loops in one process', async (t) => {
  const { ctx, driverCtx } = await harness()
  const handles = []
  t.after(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.dispose()))
    await ctx.dispose?.()
  })

  const alpha = await driverCtx.agents.create({
    sessionId: 'agent-alpha',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'alpha',
  })
  handles.push(alpha)
  const beta = await driverCtx.agents.create({
    sessionId: 'agent-beta',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'beta',
  })
  handles.push(beta)

  assert.deepEqual(
    alpha.agent.session.events.filter((event) => event.type === 'agent-loop/selected'),
    [],
  )
  assert.equal(alpha.agent.options.loop, 'alpha')
  assert.equal(alpha.agent.options.driver, 'default')
  assert.deepEqual(alpha.agent.session.events.findLast((event) => event.type === 'agent-preset/selected')?.data.agentLoopDock, {
    loop: 'alpha',
    driver: 'default',
  })
  assert.deepEqual(
    beta.agent.session.events.filter((event) => event.type === 'agent-loop/selected'),
    [],
  )
  assert.equal(beta.agent.options.loop, 'beta')
  assert.equal(beta.agent.options.driver, 'default')
})

test('two-layer routing runs real agents on two named headless drivers', async (t) => {
  const { ctx, driverCtx } = await harness({ namedDrivers: true })
  const handles = []
  t.after(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.dispose()))
    await ctx.dispose?.()
  })

  const a1 = await driverCtx.agents.create({
    sessionId: 'agent-driver-a',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'loop1.strategy1',
  })
  handles.push(a1)
  const b3 = await driverCtx.agents.create({
    sessionId: 'agent-driver-b',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'loop2.strategy3',
  })
  handles.push(b3)

  assert.deepEqual(
    a1.agent.session.events.filter((event) => event.type === 'agent-loop/selected'),
    [],
  )
  assert.equal(a1.agent.options.loop, 'loop1.strategy1')
  assert.equal(a1.agent.options.driver, 'loop1')
  assert.deepEqual(
    b3.agent.session.events.filter((event) => event.type === 'agent-loop/selected'),
    [],
  )
  assert.equal(b3.agent.options.loop, 'loop2.strategy3')
  assert.equal(b3.agent.options.driver, 'loop2')
})

test('runtime driver selection drives one shared strategy on two real drivers', async (t) => {
  const { ctx, driverCtx, dock } = await harness({ namedDrivers: true })
  dock.register({ id: 'shared-strategy', kind: 'strategy', async setup() {} })

  const handles = []
  t.after(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.dispose()))
    await ctx.dispose?.()
  })

  const a1 = await driverCtx.agents.create({
    sessionId: 'shared-on-driver-a',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'shared-strategy',
    driver: 'loop1',
  })
  handles.push(a1)
  const b2 = await driverCtx.agents.create({
    sessionId: 'shared-on-driver-b',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'shared-strategy',
    driver: 'loop2',
  })
  handles.push(b2)

  assert.deepEqual(
    a1.agent.session.events.filter((event) => event.type === 'agent-loop/selected'),
    [],
  )
  assert.equal(a1.agent.options.loop, 'shared-strategy')
  assert.equal(a1.agent.options.driver, 'loop1')
  assert.deepEqual(
    b2.agent.session.events.filter((event) => event.type === 'agent-loop/selected'),
    [],
  )
  assert.equal(b2.agent.options.loop, 'shared-strategy')
  assert.equal(b2.agent.options.driver, 'loop2')
})

test('an agent created through the dock can actually run a turn', async (t) => {
  const { ctx, driverCtx, adapter } = await harness()
  let handle
  t.after(async () => {
    await handle?.dispose()
    await ctx.dispose?.()
  })

  handle = await driverCtx.agents.create({
    sessionId: 'agent-alpha',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'alpha',
  })
  const { agent } = handle

  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
  }))
  await waitForIdle(ctx, agent)

  assert.equal(adapter.requests.length, 1)
  assert.equal(adapter.requests[0].sessionId, 'agent-alpha')
  assert.equal(agent.status, 'idle')
})

test('a model tool call dispatches through the scheduler without the removed agentLoop service', async (t) => {
  const { ctx, driverCtx, adapter } = await harness({ adapter: new ToolCallingAdapter() })
  let handle
  t.after(async () => {
    await handle?.dispose()
    await ctx.dispose?.()
  })

  ctx.tools.register(defineTool({
    name: 'echo',
    description: 'echoes its argument',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: () => [{ type: 'text', text: 'echoed' }],
    },
    async execute() {
      return 'ok'
    },
  }))

  handle = await driverCtx.agents.create({
    sessionId: 'agent-tool-call',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'alpha',
  })
  const { agent } = handle

  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'call echo' }],
    source: { kind: 'user' },
  }))
  await waitForIdle(ctx, agent)

  const events = agent.session.events
  assert.ok(events.some((event) => event.type === 'tool/call' && event.data?.name === 'echo'), 'tool/call recorded')
  assert.ok(events.some((event) => event.type === 'tool/result'), 'tool/result recorded')
  const errored = events.find((event) => event.type === 'turn/end' && event.data?.reason?.kind === 'error')
  assert.equal(errored, undefined, `turn must not error: ${errored?.data?.reason?.error?.message ?? ''}`)
  assert.equal(adapter.requests.length, 2, 'model answered once after the tool result')
})

test('the fake driver runs a real turn with its own fixed reply, ignoring the model route', async (t) => {
  const { ctx, driverCtx } = await harness()
  let handle
  t.after(async () => {
    await handle?.dispose()
    await ctx.dispose?.()
  })

  const fakeDriver = createFakeDriverAdapter({ HeadlessAgentLoop, ctx: driverCtx, config: {} })
  // Register the fake driver as a named driver on the dock.
  const dock = driverCtx.agents.requireFactory().target
  dock.registerDriver('fake-driver', fakeDriver)
  dock.register({ id: 'strategy-fake', kind: 'strategy', driver: 'fake-driver', async setup() {} })

  // The caller asks for a real model route; the fake driver must ignore it.
  handle = await driverCtx.agents.create({
    sessionId: 'agent-fake-driver',
    agentOptions: { provider: 'mock', model: 'mock' },
    loop: 'strategy-fake',
  })
  const { agent } = handle

  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
  }))
  await waitForIdle(ctx, agent)

  const texts = agent.session.events
    .filter((e) => e.type === 'assistant/message')
    .flatMap((e) => e.data?.message?.content ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('')
  assert.match(texts, /\[FAKE-DRIVER\]/)
  const header = agent.session.requestHeader()?.config
  assert.equal(header?.provider, 'driver-ping')
  assert.equal(header?.model, 'fake')
})
