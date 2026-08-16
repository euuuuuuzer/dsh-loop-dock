import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject, name } from '../src/headless-driver-plugin.mjs'

test('headless driver row registers a real default driver with the dock', () => {
  const registered = []
  const ctx = {
    fiber: {},
    get() {
      return undefined
    },
    effect(callback) {
      return callback?.() ?? (() => {})
    },
    agentLoopDock: {
      registerDriver(driver) {
        registered.push(driver)
        return () => {}
      },
    },
  }

  const driver = apply(ctx, { maxParallelToolCalls: 7 })

  assert.equal(name, 'dsh-loop-dock-headless-driver')
  assert.deepEqual(inject, [
    'agentLoopDock',
    'agents',
    'sessions',
    'llm',
    'tools',
    'systemPrompt',
  ])
  assert.equal(registered.length, 1)
  assert.equal(registered[0], driver)
  assert.equal(driver.instance.config.maxParallelToolCalls, 7)
})

test('fakeDriver: true also registers the fake-driver named driver', () => {
  const registered = []
  const ctx = {
    fiber: {},
    get() {
      return undefined
    },
    effect(callback) {
      return callback?.() ?? (() => {})
    },
    llm: {
      registerAdapter() {
        return () => {}
      },
    },
    agentLoopDock: {
      registerDriver(name, driver) {
        if (driver === undefined) registered.push([undefined, name])
        else registered.push([name, driver])
        return () => {}
      },
    },
  }

  apply(ctx, { maxParallelToolCalls: 7, fakeDriver: true })

  assert.equal(registered.length, 2)
  assert.equal(registered[0][0], undefined)
  assert.equal(registered[1][0], 'fake-driver')
  assert.equal(typeof registered[1][1].createAgent, 'function')
  assert.equal(typeof registered[1][1].resume, 'function')
})
