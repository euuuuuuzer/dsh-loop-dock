import assert from 'node:assert/strict'
import test from 'node:test'

import { LoopSwitchError } from '../src/errors.mjs'
import {
  LOOP_DOCK_BINDING_EVENT,
  LOOP_DOCK_BINDING_KEY,
  loopSelectionSetup,
  readLoopBinding,
  readLoopSelection,
  recordDockBinding,
  resolveCreateLoopId,
  resolveResumeLoopId,
} from '../src/selection.mjs'

test('create selection precedence: explicit > route > preset > default', () => {
  const sessionRoutes = { 'session-fixed': 'route-loop' }
  const presetLoops = { 'example-preset': 'example-loop' }

  assert.deepEqual(
    resolveCreateLoopId({
      options: { sessionId: 'session-1', loop: 'explicit-loop', meta: { agentPreset: 'example-preset' } },
      sessionRoutes,
      presetLoops,
      defaultLoop: 'default-loop',
    }),
    { loopId: 'explicit-loop', source: 'explicit' },
  )
  assert.deepEqual(
    resolveCreateLoopId({ options: { sessionId: 'session-fixed' }, sessionRoutes, presetLoops, defaultLoop: 'default-loop' }),
    { loopId: 'route-loop', source: 'route' },
  )
  assert.deepEqual(
    resolveCreateLoopId({ options: { sessionId: 'session-1', meta: { agentPreset: 'example-preset' } }, sessionRoutes, presetLoops, defaultLoop: 'default-loop' }),
    { loopId: 'example-loop', source: 'preset' },
  )
  assert.deepEqual(
    resolveCreateLoopId({ options: { sessionId: 'session-1' }, sessionRoutes, presetLoops, defaultLoop: 'default-loop' }),
    { loopId: 'default-loop', source: 'default' },
  )
})

test('resume recovers persisted loop and refuses a silent switch', () => {
  const base = { sessionRoutes: {}, presetLoops: {}, defaultLoop: 'default-loop' }
  assert.deepEqual(
    resolveResumeLoopId({
      options: { resumeSessionId: 'session-1' },
      persisted: 'persisted-loop',
      headerPreset: undefined,
      ...base,
    }),
    { loopId: 'persisted-loop', source: 'persisted' },
  )
  assert.throws(
    () => resolveResumeLoopId({
      options: { resumeSessionId: 'session-1', loop: 'other-loop' },
      persisted: 'persisted-loop',
      headerPreset: undefined,
      ...base,
    }),
    LoopSwitchError,
  )
})

test('create ignores the removed factory alias', () => {
  assert.deepEqual(
    resolveCreateLoopId({
      options: { sessionId: 'session-1', factory: 'legacy-factory', loop: 'explicit-loop' },
      sessionRoutes: {},
      presetLoops: {},
      defaultLoop: 'default-loop',
    }),
    { loopId: 'explicit-loop', source: 'explicit' },
  )
  assert.deepEqual(
    resolveCreateLoopId({
      options: { sessionId: 'session-1', factory: 'legacy-factory' },
      sessionRoutes: {},
      presetLoops: {},
      defaultLoop: 'default-loop',
    }),
    { loopId: 'default-loop', source: 'default' },
  )
})

test('create selection carries an independent runtime driver', () => {
  assert.deepEqual(
    resolveCreateLoopId({
      options: { sessionId: 'session-1', loop: 'strategy-shared', driver: 'loop2' },
      sessionRoutes: {},
      presetLoops: {},
      defaultLoop: 'default-loop',
    }),
    { loopId: 'strategy-shared', source: 'explicit', driver: 'loop2', driverSource: 'explicit' },
  )
})

test('resume refuses a driver switch even when the loop is unchanged', () => {
  assert.throws(
    () => resolveResumeLoopId({
      options: { resumeSessionId: 'session-1', loop: 'strategy-shared', driver: 'loop2' },
      persisted: { loop: 'strategy-shared', driver: 'loop1' },
      headerPreset: undefined,
      sessionRoutes: {},
      presetLoops: {},
      defaultLoop: 'default-loop',
    }),
    LoopSwitchError,
  )
})

test('resume recovers both loop and driver from a durable binding', () => {
  assert.deepEqual(
    resolveResumeLoopId({
      options: { resumeSessionId: 'session-1' },
      persisted: { loop: 'strategy-shared', driver: 'loop2' },
      headerPreset: undefined,
      sessionRoutes: {},
      presetLoops: {},
      defaultLoop: 'default-loop',
    }),
    { loopId: 'strategy-shared', source: 'persisted', driver: 'loop2' },
  )
})

test('resume maps header.agentPreset when no custom event exists', () => {
  assert.deepEqual(
    resolveResumeLoopId({
      options: { resumeSessionId: 'session-1' },
      persisted: undefined,
      headerPreset: 'example-preset',
      sessionRoutes: {},
      presetLoops: { 'example-preset': 'example-loop' },
      defaultLoop: 'standard',
    }),
    { loopId: 'example-loop', source: 'persisted' },
  )
})

test('loop identity is recorded as a durable known session event', () => {
  const events = []
  const session = {
    events,
    append(type, data) {
      const event = { type, seq: events.length, data }
      events.push(event)
      return event
    },
  }
  recordDockBinding(session, { loop: 'demo-loop', driver: 'loop2' }, { agentPreset: 'standard' })
  assert.equal(events.at(-1).type, LOOP_DOCK_BINDING_EVENT)
  assert.deepEqual(events.at(-1).data, {
    agentPreset: 'standard',
    [LOOP_DOCK_BINDING_KEY]: { loop: 'demo-loop', driver: 'loop2' },
  })
  assert.deepEqual(readLoopBinding(session), { loop: 'demo-loop', driver: 'loop2' })
  assert.equal(readLoopSelection(session), 'demo-loop')
})

test('a malformed persisted binding degrades to undefined', () => {
  assert.equal(
    readLoopSelection({
      events: [{ type: LOOP_DOCK_BINDING_EVENT, data: { agentLoopDock: { loop: 'not a loop id' } } }],
    }),
    undefined,
  )
})

test('loopSelectionSetup records once through the known session event', () => {
  const events = []
  const session = {
    header: { agentPreset: 'standard' },
    events,
    append(type, data) {
      events.push({ type, data })
    },
  }
  const setup = loopSelectionSetup({ loop: 'pro-loop', driver: 'loop2' })
  setup({ agent: { session } })
  setup({ agent: { session } })
  assert.equal(events.filter((event) => event.type === LOOP_DOCK_BINDING_EVENT).length, 1)
  assert.deepEqual(events[0].data, {
    agentPreset: 'standard',
    [LOOP_DOCK_BINDING_KEY]: { loop: 'pro-loop', driver: 'loop2' },
  })
})
