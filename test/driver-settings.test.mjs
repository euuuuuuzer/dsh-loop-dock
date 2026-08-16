import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'

import { InvalidDriverError, UnknownDriverError } from '../src/errors.mjs'
import {
  AGENT_LOOPS_SETTINGS_NS,
  AgentLoopsRemote,
  installAgentLoopsSettings,
} from '../src/driver-settings.mjs'
import { LoopDock } from '../src/hub.mjs'

function fakeDriver(label) {
  return {
    async createAgent(_ownerCtx, options) {
      return { agent: { id: options.sessionId, driver: label } }
    },
    async resume() {},
  }
}

test('installAgentLoopsSettings registers the namespace handle', () => {
  const calls = []
  const settings = {
    register(namespace, schema, options) {
      calls.push([namespace, options?.base])
      return { get: () => ({ defaultDriver: 'loop2' }) }
    },
  }
  const ctx = {
    inject(names, callback) {
      assert.deepEqual(names, ['settings'])
      callback({ settings, effect() {} })
    },
  }
  const handle = installAgentLoopsSettings(ctx, { defaultDriver: 'default' })
  assert.equal(calls[0][0], AGENT_LOOPS_SETTINGS_NS)
  assert.deepEqual(calls[0][1], { defaultDriver: 'default' })
  assert.equal(handle.get().defaultDriver, 'loop2')
})

test('AgentLoopsRemote is a Remote service listing drivers and the current default', async () => {
  const ctx = new Context()
  const writes = []
  ctx.provide('settings', {
    async update(ns, patch) {
      writes.push([ns, patch])
      return { ok: true }
    },
    register(namespace, schema, options) {
      return { get: () => ({ defaultDriver: options?.base?.defaultDriver ?? 'default' }) }
    },
  })
  const dock = new LoopDock(ctx, { defaultDriver: 'default' })
  dock.registerDriver(fakeDriver('default'))
  dock.registerDriver('fake-driver', fakeDriver('fake-driver'))

  const remote = new AgentLoopsRemote(ctx, dock)

  assert.deepEqual(remoteMethods(remote).map((marker) => marker.method).sort(), ['listDrivers', 'setDefaultDriver'])
  assert.equal(remote.typertRemote.namespace, 'agentLoops')
  const served = ctx.get('agentLoops')
  assert.ok(served !== undefined, 'agentLoops service is registered')
  assert.equal(served.listDrivers().drivers.length, 2)
  assert.deepEqual(remote.listDrivers(), {
    drivers: ['default', 'fake-driver'],
    current: 'default',
  })

  const written = await remote.setDefaultDriver('fake-driver')
  assert.deepEqual(writes, [['agent-loops', { defaultDriver: 'fake-driver' }]])
  assert.deepEqual(written, { ok: true })

  await assert.rejects(() => remote.setDefaultDriver('missing-driver'), UnknownDriverError)
  await assert.rejects(() => remote.setDefaultDriver('bad name'), InvalidDriverError)
  assert.deepEqual(writes.length, 1)
  dock.driverSettings = { get: () => ({ defaultDriver: 'fake-driver' }) }
  assert.deepEqual(remote.listDrivers(), {
    drivers: ['default', 'fake-driver'],
    current: 'fake-driver',
  })
})
