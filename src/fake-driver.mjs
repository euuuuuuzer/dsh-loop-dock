/**
 * Fake driver adapter: a second, observably different driver for testing
 * dual-driver routing.
 *
 * It wraps the vendored headless driver and forces the model route to a
 * local ping adapter (`driver-ping`) with its own marker reply — at the
 * DRIVER layer, not the loop layer. Sessions driven by this driver always
 * reply with the fixed `[FAKE-DRIVER]` text, regardless of the caller's
 * model selection, the preset, or the loop's own model pin. This makes
 * driver routing verifiable end to end: same preset, different driver →
 * different observable behavior.
 */

import { createHeadlessDriverAdapter } from './default-driver.mjs'
import { PingAdapter } from './ping-adapter.mjs'
import { composeSetups } from './provider.mjs'

/** Provider id under which the fake driver's local adapter is registered. */
export const FAKE_DRIVER_PROVIDER = 'driver-ping'

/** Model id the fake driver reports. */
export const FAKE_DRIVER_MODEL = 'fake'

/** Fixed reply served by the fake driver's adapter. */
const FAKE_DRIVER_REPLY = '[FAKE-DRIVER] fake driver reply — generated locally, no model call.'

/** Adapter registrations keyed by plugin context, so reloads re-register cleanly. */
const adapterRegistrations = new WeakMap()

function ensureAdapter(ctx) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx?.llm?.registerAdapter !== 'function') return undefined
  if (adapterRegistrations.has(ctx)) return adapterRegistrations.get(ctx)
  const dispose = ctx.llm.registerAdapter([FAKE_DRIVER_PROVIDER], new PingAdapter(FAKE_DRIVER_REPLY))
  const registration = typeof dispose === 'function' ? dispose : undefined
  adapterRegistrations.set(ctx, registration)
  return registration
}

/**
 * An agent/request listener that forces the fake driver's route. It is
 * installed AFTER the caller/dock setups so its `prepend` lands outermost
 * and wins over both the dock's route-follow listener and the web's
 * installModelSelection override.
 */
function driverPinSetup(agentCtx) {
  agentCtx.on?.('agent/request', async (_payload, next) => {
    const resolved = await next()
    if (resolved === null || typeof resolved !== 'object') return resolved
    const { reasoningEffort: _inheritedEffort, ...rest } = resolved
    return {
      ...rest,
      provider: FAKE_DRIVER_PROVIDER,
      model: FAKE_DRIVER_MODEL,
    }
  }, { prepend: true })
}

function forceRoute(agentOptions) {
  const { reasoningEffort: _inheritedEffort, ...rest } = agentOptions ?? {}
  return {
    ...rest,
    provider: FAKE_DRIVER_PROVIDER,
    model: FAKE_DRIVER_MODEL,
  }
}

/**
 * Build the fake driver adapter around the vendored headless driver.
 *
 * @param {object} options - `HeadlessAgentLoop` class, the driver's plugin
 *   context, and the row config (maxParallelToolCalls etc.).
 * @returns a driver adapter (`createAgent` / `resume` / `dispose` /
 *   `instance`) delegating to the headless driver with the route forced.
 */
export function createFakeDriverAdapter({ HeadlessAgentLoop, ctx, config }) {
  ensureAdapter(ctx)
  const base = createHeadlessDriverAdapter({ HeadlessAgentLoop, ctx, config })
  return {
    createAgent(ownerCtx, options) {
      return base.createAgent(ownerCtx, {
        ...options,
        setup: composeSetups([options?.setup, driverPinSetup]),
        agentOptions: forceRoute(options?.agentOptions),
      })
    },
    resume(ownerCtx, options) {
      return base.resume(ownerCtx, {
        ...options,
        setup: composeSetups([options?.setup, driverPinSetup]),
        agentOptions: forceRoute(options?.agentOptions),
      })
    },
    dispose() {
      return base.dispose?.()
    },
    get instance() {
      return base.instance
    },
  }
}
