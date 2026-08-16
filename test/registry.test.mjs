import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DuplicateLoopError,
  InvalidLoopDefinitionError,
  InvalidLoopIdError,
  UnknownLoopError,
} from '../src/errors.mjs'
import { LoopRegistry } from '../src/registry.mjs'

test('registers and lists strategy and driver loops', () => {
  const registry = new LoopRegistry()
  const detachA = registry.register({ id: 'alpha', kind: 'strategy', setup() {} })
  const detachB = registry.register({ id: 'beta', kind: 'driver', createAgent() {}, resume() {} })

  assert.equal(registry.size, 2)
  assert.deepEqual(registry.list(), [
    { id: 'alpha', kind: 'strategy' },
    { id: 'beta', kind: 'driver' },
  ])
  assert.equal(registry.require('alpha').kind, 'strategy')

  detachB()
  assert.equal(registry.has('beta'), false)
  detachB()
  assert.equal(registry.size, 1)

  detachA()
  assert.equal(registry.size, 0)
})

test('rejects duplicate loop ids', () => {
  const registry = new LoopRegistry()
  registry.register({ id: 'pro', kind: 'strategy', setup() {} })
  assert.throws(
    () => registry.register({ id: 'pro', kind: 'driver', createAgent() {}, resume() {} }),
    DuplicateLoopError,
  )
})

test('validates ids and provider shape', () => {
  const registry = new LoopRegistry()
  assert.throws(() => registry.register({ id: 'not a loop', kind: 'strategy', setup() {} }), InvalidLoopIdError)
  assert.throws(() => registry.register({ id: 'ok', kind: 'strategy' }), InvalidLoopDefinitionError)
  assert.throws(
    () => registry.register({ id: 'ok', kind: 'driver', createAgent() {} }),
    InvalidLoopDefinitionError,
  )
  assert.throws(
    () => registry.register({ id: 'bad-pin', kind: 'strategy', setup() {}, provider: '' }),
    InvalidLoopDefinitionError,
  )
  assert.throws(
    () => registry.register({ id: 'bad-pin-model', kind: 'driver', createAgent() {}, resume() {}, model: 7 }),
    InvalidLoopDefinitionError,
  )
  assert.throws(() => registry.require('missing'), UnknownLoopError)
})
