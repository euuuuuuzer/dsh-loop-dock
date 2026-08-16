/**
 * Adapter factory for a headless derivative of @deepseek-ai/dsh-agent-loop.
 *
 * This module does NOT import the official loop. It expects a class that has
 * already been made dock-safe (no Service registration, no setFactory, no
 * settings/prompt-variable self-registration, no declarative-agent startup).
 * See docs/default-driver.md for the exact modification checklist.
 */

import { InvalidDriverError } from './errors.mjs'

export function createHeadlessDriverAdapter({
  HeadlessAgentLoop,
  ctx,
  config,
}) {
  if (typeof HeadlessAgentLoop !== 'function') {
    throw new InvalidDriverError('createHeadlessDriverAdapter requires a HeadlessAgentLoop class')
  }

  // The dock owns declarative agents; the driver is only the driver.
  const instance = new HeadlessAgentLoop(ctx, {
    ...config,
    agents: [],
  })

  if (typeof instance.createAgent !== 'function' || typeof instance.resume !== 'function') {
    throw new InvalidDriverError(
      'HeadlessAgentLoop instance must expose createAgent(ownerCtx, options) and resume(ownerCtx, options)',
    )
  }

  return {
    createAgent(ownerCtx, options) {
      return instance.createAgent(ownerCtx, options)
    },
    resume(ownerCtx, options) {
      return instance.resume(ownerCtx, options)
    },
    dispose() {
      return instance.dispose?.() ?? instance.ownership?.dispose?.()
    },
    get instance() {
      return instance
    },
  }
}
