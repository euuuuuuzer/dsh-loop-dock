/**
 * Zero-dependency proof of the docking model.
 *
 * Run: node examples/fake-two-loop.mjs
 *
 * It uses a fake driver, registers two strategy loops, and creates one agent
 * on each loop. This is the FakeFactory/FakeLoop test from the project design
 * written as a runnable demo.
 */

import { LoopDock } from '../src/hub.mjs'

const calls = []

const fakeDriver = {
  async createAgent(_ownerCtx, options) {
    calls.push(`create ${options.sessionId} -> loop ${options.loop}`)
    await options.setup?.({})
    return { agent: { id: options.sessionId }, dispose: async () => {} }
  },
  async resume(_ownerCtx, options) {
    calls.push(`resume ${options.resumeSessionId} -> loop ${options.loop}`)
    return { agent: { id: options.resumeSessionId }, dispose: async () => {} }
  },
}

const dock = new LoopDock({}, { defaultLoop: 'standard' })
dock.registerDriver(fakeDriver)

dock.register({
  id: 'standard',
  kind: 'strategy',
  description: 'the baseline slot',
  async setup() {
    calls.push('setup standard')
  },
})

dock.register({
  id: 'loop-b',
  kind: 'strategy',
  description: 'the second slot',
  async setup() {
    calls.push('setup loop-b')
  },
})

await dock.createAgent({}, { sessionId: 'agent-a', loop: 'standard' })
await dock.createAgent({}, { sessionId: 'agent-b', loop: 'loop-b' })

console.log(calls.join('\n'))
console.log('\nTwo agents, one dock, two different loops.')
