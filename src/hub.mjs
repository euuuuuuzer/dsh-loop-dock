/**
 * AgentLoopDock: the one AgentFactory the harness sees, and the dock every
 * loop provider plugs into.
 *
 * The dock deliberately contains no loop algorithm. It owns:
 *
 *   - one LoopRegistry (the slots);
 *   - one optional default driver (used by `kind: 'strategy'` loops);
 *   - agent -> loop selection;
 *   - durable loop/driver identity through a known session event;
 *   - delegation to whichever provider won the selection.
 */

import { randomUUID } from 'node:crypto'

import { normalizeDockConfig } from './config.mjs'
import {
  DuplicateDriverError,
  InvalidConfigError,
  InvalidDriverError,
  MissingDriverError,
} from './errors.mjs'
import { composeSetups, wrapStrategyLoop } from './provider.mjs'
import { LoopRegistry, normalizeDriverName } from './registry.mjs'
import {
  loopSelectionSetup,
  readLoopBindingFromEvents,
  resolveCreateLoopId,
  resolveResumeLoopId,
} from './selection.mjs'

/** The newest `agent-preset/selected` event's preset id, or undefined. */
function newestSelectedPreset(events) {
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'agent-preset/selected') continue
    const preset = event?.data?.agentPreset
    if (typeof preset === 'string' && preset.length > 0) return preset
  }
  return undefined
}

/**
 * Setup installed for every agent: an outermost `agent/request` listener
 * that re-applies the mapped loop's pinned model route against the session's
 * CURRENT effective preset. See `_decorateOptions` for why this exists — it
 * is what makes DSH Web's blank-session hero-chip preset switch also switch
 * the model route (fake ↔ real) without recreating the agent.
 */
function routeFollowSetup(dock) {
  return async function routeFollowSetup(agentCtx) {
    const presets = typeof agentCtx.get === 'function' ? agentCtx.get('agentPresets') : undefined
    if (presets === undefined || typeof presets.composedPreset !== 'function') return
    agentCtx.on?.('agent/request', async (_payload, next) => {
      const resolved = await next()
      if (resolved === null || typeof resolved !== 'object') return resolved
      const effective = presets.composedPreset(agentCtx)
      const binding = effective === undefined ? undefined : dock.config.presetLoops?.[effective]
      const loop = binding?.loop === undefined ? undefined : dock.registry.get(binding.loop)
      const pinned = loop?.provider !== undefined || loop?.model !== undefined
      if (pinned) {
        const { reasoningEffort: _inheritedEffort, ...rest } = resolved
        return {
          ...rest,
          ...(loop.provider === undefined ? {} : { provider: loop.provider }),
          ...(loop.model === undefined ? {} : { model: loop.model }),
        }
      }
      // No pin for the effective preset: release. A pin applied on an earlier
      // request was persisted into the session's request header, so the seed
      // may still carry it; restore the agent's creation-time route instead
      // of leaking the stale pin (web flows already restore the user's
      // selection through installModelSelection before this listener).
      for (const candidate of Object.values(dock.config.presetLoops ?? {})) {
        const pinnedLoop = candidate?.loop === undefined ? undefined : dock.registry.get(candidate.loop)
        if (pinnedLoop?.provider === undefined || pinnedLoop?.model === undefined) continue
        if (resolved.provider !== pinnedLoop.provider || resolved.model !== pinnedLoop.model) continue
        const fallback = agentCtx.agent?.options
        if (fallback?.provider !== undefined && fallback?.model !== undefined) {
          const { reasoningEffort: _inheritedEffort, ...rest } = resolved
          return { ...rest, provider: fallback.provider, model: fallback.model }
        }
      }
      return resolved
    }, { prepend: true })
  }
}

function assertDriver(driver) {
  if (
    driver === null
    || typeof driver !== 'object'
    || typeof driver.createAgent !== 'function'
    || typeof driver.resume !== 'function'
  ) {
    throw new InvalidDriverError('registerDriver(driver) requires createAgent(ownerCtx, options) and resume(ownerCtx, options)')
  }
}

export const DEFAULT_DRIVER_NAME = 'default'

export class LoopDock {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = normalizeDockConfig(config)
    this.registry = new LoopRegistry()
    this._drivers = new Map()
    this._wrapped = new Map()
    this._warned = new Set()
    this._pendingAgents = new Set()
    /** Optional settings handle (`{ get() -> { defaultDriver } }`), set by the plugin entry. */
    this.driverSettings = undefined
  }

  /** The driver new sessions use when nothing else selects one. */
  currentDriver() {
    const fromSettings = this.driverSettings?.get?.()?.defaultDriver
    return fromSettings ?? this.config.defaultDriver
  }

  _defaultDriver() {
    try {
      return this.currentDriver()
    } catch {
      return this.config.defaultDriver
    }
  }

  /** Register one loop provider. Returns an idempotent disposer. */
  register(loop) {
    const disposer = this.registry.register(loop)
    this._wrapped.clear()
    // A declarative agent may have been waiting for exactly this loop.
    this._flushConfiguredAgents()
    return disposer
  }

  unregister(id) {
    this._wrapped.clear()
    return this.registry.unregister(id)
  }

  /**
   * Register a named driver.
   *
   * `registerDriver(driver)` registers the default driver used by legacy
   * strategy loops. `registerDriver('loop2', driver)` registers a named
   * driver that strategies bind with `driver: 'loop2'`.
   */
  registerDriver(nameOrDriver, maybeDriver) {
    const name = normalizeDriverName(maybeDriver === undefined ? DEFAULT_DRIVER_NAME : nameOrDriver)
    const driver = maybeDriver === undefined ? nameOrDriver : maybeDriver
    assertDriver(driver)
    if (this._drivers.has(name)) throw new DuplicateDriverError(name)
    this._drivers.set(name, driver)
    this._wrapped.clear()
    // Driver row activation is asynchronous in the loader. Declarative
    // strategy agents waiting for this driver can now start.
    this._flushConfiguredAgents()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this._drivers.get(name) === driver) {
        this._drivers.delete(name)
        this._wrapped.clear()
      }
    }
  }

  get driverRegistered() {
    return this._drivers.has(DEFAULT_DRIVER_NAME)
  }

  listDrivers() {
    return [...this._drivers.keys()].sort()
  }

  hasDriver(name) {
    return this._drivers.has(normalizeDriverName(name))
  }

  _requireDriver(loop, driverName = DEFAULT_DRIVER_NAME) {
    const driver = this._drivers.get(driverName)
    if (driver === undefined) throw new MissingDriverError(loop.id, driverName)
    return driver
  }

  listLoops() {
    return this.registry.list()
  }

  _service(name) {
    if (this.ctx === null || this.ctx === undefined) return undefined
    if (typeof this.ctx.get === 'function') return this.ctx.get(name)
    return this.ctx[name]
  }

  _warn(message) {
    if (this._warned.has(message)) return
    this._warned.add(message)
    try {
      this.ctx?.logger?.warn?.(`dsh-loop-dock: ${message}`)
    } catch {
      // Logging is optional; routing must never depend on it.
    }
  }

  _materialize(loop, driverName) {
    if (loop.kind === 'driver') return loop
    const resolvedDriver = driverName ?? loop.driver ?? this._defaultDriver()
    const driver = this._requireDriver(loop, resolvedDriver)
    const cacheKey = `${resolvedDriver}:${loop.id}`
    let wrapped = this._wrapped.get(cacheKey)
    if (wrapped === undefined) {
      wrapped = wrapStrategyLoop(loop, driver)
      this._wrapped.set(cacheKey, wrapped)
    }
    return wrapped
  }

  _assertStrategyDriverOnly(loop, decision) {
    if (loop.kind === 'driver' && decision.driver !== undefined) {
      throw new InvalidConfigError(
        `driver selection is only valid for strategy loops; "${loop.id}" is a driver loop`,
      )
    }
  }

  _resolveBinding(loop, decision) {
    if (loop.kind === 'driver') {
      return { loop: decision.loopId, loopId: decision.loopId }
    }
    return {
      loop: decision.loopId,
      loopId: decision.loopId,
      driver: decision.driver ?? loop.driver ?? this._defaultDriver(),
    }
  }

  /**
   * Decorate caller options with the resolved loop/driver coordinates.
   *
   * Durable identity is recorded through the KNOWN `agent-preset/selected`
   * event under `data.agentLoopDock` (see `src/selection.mjs`). DSH's
   * persistence read path accepts that event type, while `Session.append`
   * has no public way to mark a custom event `ignorable` — so the dock never
   * writes an unknown event type to a live session. Loop routing across
   * restarts still understands the durable `SessionHeader.agentPreset`
   * (mapped through `presetLoops`), exact `sessionLoops` routes, and explicit
   * resume options.
   *
   * A route-following setup runs after the caller setup for EVERY agent, but
   * its `prepend` listener is outermost in the `agent/request` waterfall. It
   * re-evaluates the pinned model route against the session's CURRENT
   * effective preset (live `composedPreset`), so a blank-session preset
   * switch (DSH Web's hero chip → `agent-preset/select` → `recompose`)
   * switches the model route too — the loop identity stays fixed at
   * creation, but a pinned loop's provider/model follows the effective
   * preset per request.
   */
  _decorateOptions(options, binding) {
    const loop = this.registry.get(binding.loopId)
    const pinned = loop?.provider !== undefined || loop?.model !== undefined
    const durableSetup = loopSelectionSetup(binding, {
      agentPreset(agentCtx) {
        const presets = typeof agentCtx?.get === 'function' ? agentCtx.get('agentPresets') : undefined
        const composed = typeof presets?.composedPreset === 'function' ? presets.composedPreset(agentCtx) : undefined
        const session = agentCtx?.agent?.session ?? agentCtx?.get?.('agent')?.session
        return composed ?? newestSelectedPreset(session?.events) ?? session?.header?.agentPreset
      },
    })
    return {
      ...options,
      loop: binding.loopId,
      ...(binding.driver === undefined ? {} : { driver: binding.driver }),
      setup: composeSetups([options?.setup, durableSetup, routeFollowSetup(this)]),
      agentOptions: (() => {
        const base = {
          ...options?.agentOptions,
          loop: binding.loopId,
          ...(binding.driver === undefined ? {} : { driver: binding.driver }),
        }
        if (!pinned) return base
        // A pinned loop owns the whole model route: drop the caller's
        // reasoning effort (a local ping adapter supports none) and apply
        // the pin.
        const { reasoningEffort: _inheritedEffort, ...rest } = base
        return {
          ...rest,
          ...(loop.provider === undefined ? {} : { provider: loop.provider }),
          ...(loop.model === undefined ? {} : { model: loop.model }),
        }
      })(),
    }
  }

  async createAgent(ownerCtx, options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new InvalidConfigError('create options must be an object')
    }
    if (typeof options.sessionId !== 'string' || options.sessionId.length === 0) {
      throw new InvalidConfigError('create options.sessionId must be a non-empty string')
    }
    const decision = resolveCreateLoopId({
      options,
      sessionRoutes: this.config.sessionLoops,
      presetLoops: this.config.presetLoops,
      defaultLoop: this.config.defaultLoop,
    })
    const loop = this.registry.require(decision.loopId)
    this._assertStrategyDriverOnly(loop, decision)
    const binding = this._resolveBinding(loop, decision)
    const provider = this._materialize(loop, binding.driver)
    const decorated = this._decorateOptions(options, binding)
    return provider.createAgent(ownerCtx, decorated)
  }

  async resume(ownerCtx, options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new InvalidConfigError('resume options must be an object')
    }
    const identity = options.resumeSessionId
    if (typeof identity !== 'string' || identity.length === 0) {
      throw new InvalidConfigError('resume options.resumeSessionId must be a non-empty string')
    }
    const inspection = await this._inspectPersisted(identity)
    const decision = resolveResumeLoopId({
      options,
      persisted: inspection.persisted,
      headerPreset: inspection.headerPreset,
      sessionRoutes: this.config.sessionLoops,
      presetLoops: this.config.presetLoops,
      defaultLoop: this.config.defaultLoop,
    })
    const loop = this.registry.require(decision.loopId)
    this._assertStrategyDriverOnly(loop, decision)
    const binding = this._resolveBinding(loop, decision)
    const provider = this._materialize(loop, binding.driver)
    const decorated = this._decorateOptions(options, binding)
    return provider.resume(ownerCtx, decorated)
  }

  async _inspectPersisted(sessionId) {
    const persistence = this._service('sessionPersistence')
    if (persistence === undefined || typeof persistence.inspect !== 'function') return {}
    try {
      const inspected = await persistence.inspect(sessionId)
      return {
        persisted: readLoopBindingFromEvents(inspected?.events),
        // The effective preset of a session can be switched while it is still
        // blank via the host's `agent-preset/selected` event (DSH Web's
        // new-session hero chip stages a preset and applies it after the
        // session exists). Mirror the host's `resolveSessionPreset`: the
        // newest such event wins over the frozen creation header.
        headerPreset: newestSelectedPreset(inspected?.events) ?? inspected?.meta?.agentPreset,
      }
    } catch (error) {
      this._warn(`could not inspect persisted loop selection for "${sessionId}": ${String(error?.message ?? error)}`)
      return {}
    }
  }

  /**
   * Start the declarative `config.agents` entries.
   *
   * Each entry starts as soon as its dependency is ready:
   *   - driver loops start once the loop itself is registered;
   *   - strategy loops additionally wait for the default driver row.
   */
  startConfiguredAgents() {
    for (const entry of this.config.agents) this._pendingAgents.add(entry)
    return this._flushConfiguredAgents()
  }

  async _hasPersistedSession(sessionId) {
    const persistence = this._service('sessionPersistence')
    if (persistence === undefined || typeof persistence.list !== 'function') return false
    try {
      const headers = await persistence.list()
      return Array.isArray(headers) && headers.some((header) => header?.id === sessionId)
    } catch (error) {
      this._warn(`could not inspect persistence for "${sessionId}": ${String(error?.message ?? error)}`)
      return false
    }
  }

  _configuredEntryReady(entry) {
    const loopId = entry.loop ?? this.config.defaultLoop
    const loop = this.registry.get(loopId)
    if (loop === undefined) return false
    if (loop.kind === 'driver') return true
    const driverName = entry.driver ?? loop.driver ?? this._defaultDriver()
    return this._drivers.has(driverName)
  }

  _flushConfiguredAgents() {
    if (this._pendingAgents.size === 0) return []
    const started = []
    for (const entry of [...this._pendingAgents]) {
      if (!this._configuredEntryReady(entry)) continue
      this._pendingAgents.delete(entry)
      started.push(this._startConfiguredAgent(entry))
    }
    return started
  }

  async _startConfiguredAgent(entry) {
    const agents = this._service('agents')
    if (agents === undefined) return
    const agentOptions = {
      ...(entry.provider === undefined ? {} : { provider: entry.provider }),
      ...(entry.model === undefined ? {} : { model: entry.model }),
      ...(entry.maxTokens === undefined ? {} : { maxTokens: entry.maxTokens }),
      ...(entry.reasoningEffort === undefined ? {} : { reasoningEffort: entry.reasoningEffort }),
    }
    const routingFields = {
      ...(entry.loop === undefined ? {} : { loop: entry.loop }),
      ...(entry.driver === undefined ? {} : { driver: entry.driver }),
    }
    try {
      if (entry.resumeSessionId !== undefined) {
        await agents.resume({
          resumeSessionId: entry.resumeSessionId,
          agentOptions,
          ...routingFields,
        })
        return
      }

      const sessionId = entry.sessionId ?? `${entry.id}-session-${randomUUID()}`
      if (entry.sessionId !== undefined && await this._hasPersistedSession(entry.sessionId)) {
        await agents.resume({
          resumeSessionId: entry.sessionId,
          agentOptions,
          ...routingFields,
        })
        return
      }

      await agents.create({
        sessionId,
        agentOptions,
        ...routingFields,
        ...(entry.cwd === undefined ? {} : { meta: { cwd: entry.cwd } }),
      })
    } catch (error) {
      this._warn(`configured agent "${entry.id}" failed to start: ${String(error?.message ?? error)}`)
    }
  }
}

