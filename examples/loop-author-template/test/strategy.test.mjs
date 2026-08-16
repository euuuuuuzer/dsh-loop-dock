import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../src/index.mjs'

test('registers one strategy loop', () => {
  let registered
  const ctx = {
    agentLoopDock: {
      register(definition) {
        registered = definition
      },
    },
  }

  apply(ctx, { loopId: 'demo-strategy' })

  assert.equal(name, 'dsh-loop-author-template')
  assert.equal(registered.id, 'demo-strategy')
  assert.equal(registered.kind, 'strategy')
  assert.equal(typeof registered.setup, 'function')
})
