/**
 * Agent -> loop selection and durable loop identity.
 *
 * A binding has two dimensions:
 *
 *   loop   — strategy or driver provider id
 *   driver — optional driver name for strategy loops (default = 'default')
 *
 * CREATE precedence:
 *   explicit options > exact session route > preset route > defaults
 *
 * RESUME:
 *   explicit/route choices must agree with the durable binding; otherwise
 *   the dock refuses to switch a non-blank session.
 */

import { LoopSwitchError } from './errors.mjs'
import { normalizeDriverName, normalizeLoopId } from './registry.mjs'

export const LOOP_DOCK_BINDING_EVENT = 'agent-preset/selected'
export const LOOP_DOCK_BINDING_KEY = 'agentLoopDock'

/** Read the runtime two-dimensional selection from caller options. */
export function selectionFromOptions(options) {
  if (options === null || typeof options !== 'object') return {}
  const loop = options.loop ?? options.agentOptions?.loop
  const driver = options.driver ?? options.agentOptions?.driver
  return {
    ...(loop === undefined ? {} : { loop: normalizeLoopId(loop) }),
    ...(driver === undefined ? {} : { driver: normalizeDriverName(driver) }),
  }
}

function routeEntry(value, routes) {
  if (value === undefined || routes === undefined) return undefined
  const entry = routes instanceof Map ? routes.get(value) : routes[value]
  if (entry === undefined) return undefined
  if (typeof entry === 'string') return { loop: normalizeLoopId(entry) }
  if (entry === null || typeof entry !== 'object') return undefined
  return {
    ...(entry.loop === undefined ? {} : { loop: normalizeLoopId(entry.loop) }),
    ...(entry.driver === undefined ? {} : { driver: normalizeDriverName(entry.driver) }),
  }
}

function exactRoute(options, sessionRoutes) {
  const identity = options?.sessionId ?? options?.resumeSessionId
  return routeEntry(identity, sessionRoutes)
}

function presetRoute(metaOrHeader, presetLoops) {
  return routeEntry(metaOrHeader?.agentPreset, presetLoops)
}

function mergeBinding(...bindings) {
  const merged = {}
  for (const binding of bindings) {
    if (binding?.loop !== undefined) merged.loop = binding.loop
    if (binding?.driver !== undefined) merged.driver = binding.driver
  }
  return merged
}

/** Normalize a loop string or { loop, driver? } binding. */
export function normalizeBinding(binding) {
  if (binding === undefined || binding === null) return undefined
  if (typeof binding === 'string') return { loop: normalizeLoopId(binding) }
  if (typeof binding !== 'object') return undefined
  if (binding.loop === undefined) return undefined
  return {
    loop: normalizeLoopId(binding.loop),
    ...(binding.driver === undefined ? {} : { driver: normalizeDriverName(binding.driver) }),
  }
}

/**
 * Append the dock's durable loop/driver binding to a KNOWN session event.
 *
 * The dock rides `agent-preset/selected` and stores its binding under
 * `data.agentLoopDock`. The event type is in DSH's
 * `KNOWN_SESSION_EVENT_TYPES`, so the persistence read path accepts it;
 * `Session.append` has no public way to mark a custom event `ignorable`,
 * which is why the dock does not use one for live sessions.
 *
 * When `agentPreset` is supplied it is copied onto the event as well, keeping
 * the session's effective preset unchanged. Without it the event still
 * carries the binding and `resolveSessionPreset` keeps returning the header
 * value (undefined when the session has no preset).
 */
export function recordDockBinding(session, binding, { agentPreset } = {}) {
  if (session === null || typeof session !== 'object' || typeof session.append !== 'function') return undefined
  const normalized = normalizeBinding(binding)
  if (normalized === undefined) return undefined
  return session.append(LOOP_DOCK_BINDING_EVENT, {
    ...(typeof agentPreset === 'string' && agentPreset.length > 0 ? { agentPreset } : {}),
    [LOOP_DOCK_BINDING_KEY]: normalized,
  })
}

/** Read the newest durable binding from a session object. */
export function readLoopBinding(session) {
  return readLoopBindingFromEvents(session?.events)
}

/** Return only the selected loop id from a session object. */
export function readLoopSelection(session) {
  return readLoopBinding(session)?.loop
}

/**
 * Read the newest durable binding from an event log.
 *
 * The binding is recorded under the KNOWN `agent-preset/selected` event in
 * `data.agentLoopDock`; malformed records are skipped without bricking
 * resume.
 */
export function readLoopBindingFromEvents(events) {
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== LOOP_DOCK_BINDING_EVENT) continue
    try {
      const binding = normalizeBinding(event.data?.[LOOP_DOCK_BINDING_KEY])
      if (binding !== undefined) return binding
    } catch {
      // Malformed dock metadata must not brick resume; keep scanning.
    }
  }
  return undefined
}

/**
 * Build a setup hook that records the binding while the agent is still
 * unpublished, using the persistence-safe known event. Safe to call on a
 * mock `agentCtx` with no agent.
 *
 * `agentPreset` may be a string or a function receiving `agentCtx`; the hook
 * falls back to the session header's creation preset. A pre-existing durable
 * binding is never overwritten unless `force` is set.
 */
export function loopSelectionSetup(binding, { force = false, agentPreset } = {}) {
  const normalized = normalizeBinding(binding)
  return function loopSelectionSetup(agentCtx) {
    const session = agentCtx?.agent?.session ?? agentCtx?.get?.('agent')?.session
    if (session === undefined || normalized === undefined || typeof session.append !== 'function') return
    if (!force && readLoopBinding(session) !== undefined) return
    const preset = typeof agentPreset === 'function' ? agentPreset(agentCtx) : agentPreset
    recordDockBinding(session, normalized, {
      agentPreset: preset ?? session.header?.agentPreset,
    })
  }
}

/**
 * Resolve the loop binding for a new agent.
 *
 * @returns {{ loopId: string, source: 'explicit' | 'route' | 'preset' | 'default',
 *             driver?: string, driverSource?: 'explicit' | 'route' | 'preset' }}
 */
export function resolveCreateLoopId({
  options,
  sessionRoutes,
  presetLoops,
  defaultLoop,
}) {
  const explicit = selectionFromOptions(options)
  const route = exactRoute(options, sessionRoutes)
  const preset = presetRoute(options?.meta, presetLoops)

  const source = explicit.loop !== undefined
    ? 'explicit'
    : route?.loop !== undefined
      ? 'route'
      : preset?.loop !== undefined
        ? 'preset'
        : 'default'

  const driverSource = explicit.driver !== undefined
    ? 'explicit'
    : route?.driver !== undefined
      ? 'route'
      : preset?.driver !== undefined
        ? 'preset'
        : undefined

  return {
    loopId: normalizeLoopId(explicit.loop ?? route?.loop ?? preset?.loop ?? defaultLoop),
    source,
    ...(explicit.driver ?? route?.driver ?? preset?.driver) === undefined
      ? {}
      : { driver: normalizeDriverName(explicit.driver ?? route?.driver ?? preset?.driver), driverSource },
  }
}

/**
 * Resolve the loop binding for a resumed agent.
 */
export function resolveResumeLoopId({
  options,
  persisted,
  headerPreset,
  sessionRoutes,
  presetLoops,
  defaultLoop,
}) {
  const explicit = selectionFromOptions(options)
  const route = exactRoute(options, sessionRoutes)
  const preset = presetRoute({ agentPreset: headerPreset }, presetLoops)
  const stored = mergeBinding(preset, normalizeBinding(persisted))
  const identity = options?.resumeSessionId ?? options?.sessionId

  if (explicit.loop !== undefined && stored.loop !== undefined && explicit.loop !== stored.loop) {
    throw new LoopSwitchError(identity, explicit.loop, stored.loop, 'loop')
  }
  if (route?.loop !== undefined && stored.loop !== undefined && route.loop !== stored.loop) {
    throw new LoopSwitchError(identity, route.loop, stored.loop, 'loop')
  }
  if (explicit.driver !== undefined && stored.driver !== undefined && explicit.driver !== stored.driver) {
    throw new LoopSwitchError(identity, explicit.driver, stored.driver, 'driver')
  }
  if (route?.driver !== undefined && stored.driver !== undefined && route.driver !== stored.driver) {
    throw new LoopSwitchError(identity, route.driver, stored.driver, 'driver')
  }

  const source = explicit.loop !== undefined
    ? 'explicit'
    : route?.loop !== undefined
      ? 'route'
      : stored.loop !== undefined
        ? 'persisted'
        : 'default'

  return {
    loopId: normalizeLoopId(explicit.loop ?? route?.loop ?? stored.loop ?? defaultLoop),
    source,
    ...(explicit.driver ?? route?.driver ?? stored.driver) === undefined
      ? {}
      : { driver: normalizeDriverName(explicit.driver ?? route?.driver ?? stored.driver) },
  }
}
