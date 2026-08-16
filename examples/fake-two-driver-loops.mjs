/**
 * Two FAKE agent-loop drivers in one dock.
 *
 * This is the simplest possible proof of the project's core claim:
 *
 *   Agent A -> Loop X
 *   Agent B -> Loop Y
 *
 * The loops are completely independent fake drivers. Each one implements the
 * same DSH AgentFactory contract, but records that it — not the other loop —
 * created its agent. No real model, no real session, no Core changes.
 *
 * Run: node examples/fake-two-driver-loops.mjs
 */

import { LoopDock } from '../src/hub.mjs'

function makeFakeLoop(id) {
  return {
    id,
    kind: 'driver',
    async createAgent(_ownerCtx, options) {
      console.log(`[${id}] create agent "${options.sessionId}" on ${id}`)
      return {
        agent: { id: options.sessionId, loop: id },
        dispose: async () => {},
      }
    },
    async resume(_ownerCtx, options) {
      console.log(`[${id}] resume agent "${options.resumeSessionId}" on ${id}`)
      return {
        agent: { id: options.resumeSessionId, loop: id },
        dispose: async () => {},
      }
    },
  }
}

const dock = new LoopDock({}, { defaultLoop: 'loop-x' })

const loopX = makeFakeLoop('loop-x')
const loopY = makeFakeLoop('loop-y')

dock.register(loopX)
dock.register(loopY)

const agentA = await dock.createAgent({}, { sessionId: 'agent-a', loop: 'loop-x' })
const agentB = await dock.createAgent({}, { sessionId: 'agent-b', loop: 'loop-y' })

console.log()
console.log(`agent-a ran on: ${agentA.agent.loop}`)
console.log(`agent-b ran on: ${agentB.agent.loop}`)
console.log('\nTwo agents, two different fake loops, one dock.')
