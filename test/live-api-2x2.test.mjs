import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import { createHeadlessDriverAdapter } from '../src/default-driver.mjs'
import { LoopDock } from '../src/hub.mjs'
import { HeadlessAgentLoop } from '../vendor/dsh-agent-loop-headless/index.js'

const ENABLED = process.env.DSH_LOOP_DOCK_LIVE_API === '1'

function credentialFromEnvOrFile(name) {
  if (process.env[name]) return process.env[name]
  try {
    const path = join(homedir(), '.dsh', '.credentials.yaml')
    const text = readFileSync(path, 'utf8')
    const match = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

function textResponse(text, usage) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class LiveHttpAdapter extends LlmAdapter {
  constructor({ apiKey, baseUrl, model }) {
    super()
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.model = model
    this.requests = []
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  async *stream(options) {
    this.requests.push(options)
    const messages = [
      ...(options.system === undefined ? [] : [{ role: 'system', content: options.system }]),
      ...(options.messages ?? []).map((message) => ({
        role: message.role,
        content: Array.isArray(message.content)
          ? message.content.map((block) => block.text ?? '').join('')
          : String(message.content ?? ''),
      })),
    ]
    const timeout = AbortSignal.timeout(60_000)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: options.maxTokens ?? 32,
        stream: false,
      }),
      signal,
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`live adapter ${response.status}: ${detail.slice(0, 500)}`)
    }
    const json = await response.json()
    const text = json.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error(`live adapter returned no content: ${JSON.stringify(json).slice(0, 500)}`)
    }
    const usage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    }
    for (const chunk of textResponse(text, usage)) {
      if (signal.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

async function setupLiveHarness(t) {
  const apiKey = credentialFromEnvOrFile('DEEPSEEK_API_KEY')
  const baseUrl = process.env.DSH_LOOP_DOCK_LIVE_BASE_URL ?? 'https://api.deepseek.com/chat/completions'
  const model = process.env.DSH_LOOP_DOCK_LIVE_MODEL ?? 'deepseek-chat'
  if (apiKey === undefined) {
    t.skip('DEEPSEEK_API_KEY is not available in env or ~/.dsh/.credentials.yaml')
    return undefined
  }

  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'live-api-test' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)

  let driverCtx
  await ctx.plugin(Object.assign((innerCtx) => {
    driverCtx = innerCtx
  }, {
    inject: ['agents', 'sessions', 'llm', 'tools', 'systemPrompt'],
  }))

  const adapter = new LiveHttpAdapter({ apiKey, baseUrl, model })
  ctx.llm.registerAdapter(['live-deepseek'], adapter)

  const driverA = createHeadlessDriverAdapter({ HeadlessAgentLoop, ctx: driverCtx, config: {} })
  const driverB = createHeadlessDriverAdapter({ HeadlessAgentLoop, ctx: driverCtx, config: {} })
  const dock = new LoopDock(driverCtx, { defaultLoop: 'strategy-a', defaultDriver: 'loop1' })
  dock.registerDriver('loop1', driverA)
  dock.registerDriver('loop2', driverB)

  dock.register({
    id: 'strategy-a',
    kind: 'strategy',
    async setup(agentCtx) {
      agentCtx.systemPrompt.section({
        name: 'live:strategy-a',
        order: 100,
        text: 'You are in a live 2x2 dock test. Reply with exactly: OK',
      })
    },
  })
  dock.register({
    id: 'strategy-b',
    kind: 'strategy',
    async setup(agentCtx) {
      agentCtx.systemPrompt.section({
        name: 'live:strategy-b',
        order: 100,
        text: 'You are in a live 2x2 dock test. Reply with exactly: OK',
      })
    },
  })
  driverCtx.agents.setFactory(dock)

  t.after(async () => {
    await Promise.all([driverA.dispose(), driverB.dispose()])
    await ctx.dispose?.()
  })
  return { ctx, driverCtx, adapter }
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

function assistantText(agent) {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type !== 'assistant/message') continue
    const content = event.data?.message?.content
    return Array.isArray(content) ? content.map((block) => block.text ?? '').join('') : ''
  }
  return ''
}

test('live API 2x2: two headless drivers x two strategies', { skip: !ENABLED }, async (t) => {
  const harness = await setupLiveHarness(t)
  if (harness === undefined) return
  const { ctx, driverCtx, adapter } = harness
  const handles = []
  t.after(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.dispose()))
  })

  const combos = [
    ['agent-1', 'strategy-a', 'loop1'],
    ['agent-2', 'strategy-b', 'loop1'],
    ['agent-3', 'strategy-a', 'loop2'],
    ['agent-4', 'strategy-b', 'loop2'],
  ]

  for (const [sessionId, loop, driver] of combos) {
    const handle = await driverCtx.agents.create({
      sessionId,
      agentOptions: { provider: 'live-deepseek', model: adapter.model, maxTokens: 32 },
      loop,
      driver,
    })
    handles.push(handle)

    assert.equal(handle.agent.options.loop, loop)
    assert.equal(handle.agent.options.driver, driver)
    assert.deepEqual(
      handle.agent.session.events.filter((event) => event.type === 'agent-loop/selected'),
      [],
    )
  }

  for (const handle of handles) {
    const { agent } = handle
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Reply with exactly: OK' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, agent)
    assert.match(assistantText(agent).toLowerCase(), /ok/)
  }

  assert.equal(adapter.requests.length, 4)
  assert.deepEqual(
    handles.map((handle) => handle.agent.session.events
      .filter((event) => event.type === 'agent-loop/selected')),
    [[], [], [], []],
  )
})
