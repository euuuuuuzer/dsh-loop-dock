/**
 * Default-driver row for dsh-loop-dock.
 *
 * Installs the vendored headless derivative of the official DSH agent loop as
 * the one driver behind every strategy loop slot. The bundled patch enables
 * `fakeDriver: true` by default, which also registers a second named driver
 * `fake-driver` (see `src/fake-driver.mjs`) for testing dual-driver routing.
 */

import { createHeadlessDriverAdapter } from './default-driver.mjs'
import { createFakeDriverAdapter } from './fake-driver.mjs'
import { HeadlessAgentLoop } from '../vendor/dsh-agent-loop-headless/index.js'

export const name = 'dsh-loop-dock-headless-driver'

export const inject = [
  'agentLoopDock',
  'agents',
  'sessions',
  'llm',
  'tools',
  'systemPrompt',
]

export function apply(ctx, config) {
  const driver = createHeadlessDriverAdapter({
    HeadlessAgentLoop,
    ctx,
    config,
  })
  const detach = ctx.agentLoopDock.registerDriver(driver)
  const detaches = [detach]

  if (config.fakeDriver === true) {
    const fake = createFakeDriverAdapter({ HeadlessAgentLoop, ctx, config })
    detaches.push(ctx.agentLoopDock.registerDriver('fake-driver', fake))
  }

  ctx.effect(() => () => {
    for (const dispose of detaches) dispose()
  }, 'dsh-loop-dock-headless-driver.dispose()')
  return driver
}
