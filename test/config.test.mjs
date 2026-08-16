import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_LOOP, normalizeDockConfig } from '../src/config.mjs'
import { InvalidConfigError } from '../src/errors.mjs'

test('normalizes defaults and route maps', () => {
  const config = normalizeDockConfig({
    defaultDriver: 'loop2',
    presetLoops: { 'example-preset': 'example-loop' },
    sessionLoops: new Map([['session-1', { loop: 'pro-loop', driver: 'loop2' }]]),
    agents: [{ id: 'planner' }],
    pingReply: '[FAKE-LOOP] debug reply',
  })
  assert.equal(config.defaultLoop, DEFAULT_LOOP)
  assert.equal(config.defaultDriver, 'loop2')
  assert.deepEqual(config.presetLoops, { 'example-preset': { loop: 'example-loop' } })
  assert.deepEqual(config.sessionLoops, { 'session-1': { loop: 'pro-loop', driver: 'loop2' } })
  assert.equal(config.agents.length, 1)
  assert.equal(config.pingReply, '[FAKE-LOOP] debug reply')
})

test('normalizes a complete agent entry', () => {
  const [agent] = normalizeDockConfig({
    agents: [{
      id: 'coder',
      loop: 'standard',
      driver: 'loop2',
      provider: 'provider-a',
      model: 'model-a',
      maxTokens: 8192,
      reasoningEffort: 'max',
      cwd: '/work',
      sessionId: 'coder-session',
    }],
  }).agents
  assert.deepEqual(agent, {
    id: 'coder',
    loop: 'standard',
    driver: 'loop2',
    provider: 'provider-a',
    model: 'model-a',
    maxTokens: 8192,
    reasoningEffort: 'max',
    cwd: '/work',
    sessionId: 'coder-session',
  })
})

test('rejects malformed config values at mount time', () => {
  assert.throws(() => normalizeDockConfig(null), InvalidConfigError)
  assert.throws(() => normalizeDockConfig({ defaultLoop: '' }), InvalidConfigError)
  assert.throws(() => normalizeDockConfig({ presetLoops: { bad: 'not valid!' } }), InvalidConfigError)
  assert.throws(() => normalizeDockConfig({ agents: 'nope' }), InvalidConfigError)
  assert.throws(() => normalizeDockConfig({ agents: [{}] }), InvalidConfigError)
  assert.throws(
    () => normalizeDockConfig({ agents: [{ id: 'x', sessionId: 'a', resumeSessionId: 'b' }] }),
    InvalidConfigError,
  )
  assert.throws(
    () => normalizeDockConfig({ agents: [{ id: 'x', maxTokens: 0 }] }),
    InvalidConfigError,
  )
  assert.throws(
    () => normalizeDockConfig({ agents: [{ id: 'x', sessionId: 'same' }, { id: 'y', sessionId: 'same' }] }),
    /duplicate exact session identity/,
  )
  assert.throws(
    () => normalizeDockConfig({ agents: [{ id: 'x', resumeSessionId: 'same' }, { id: 'y', sessionId: 'same' }] }),
    /duplicate exact session identity/,
  )
})
