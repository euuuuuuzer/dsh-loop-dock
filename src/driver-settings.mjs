/**
 * Host settings + Remote surface for the web driver picker.
 *
 * - Settings namespace `agent-loops.defaultDriver`: the driver new sessions
 *   use when nothing else selects one (hot-reloaded, written by the web
 *   Settings row, mirrored by `settings.yaml`).
 * - A Typert Remote service (`agentLoops/listDrivers`) that lets the web
 *   client list the registered drivers and read the current default.
 */

import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { UnknownDriverError } from './errors.mjs'
import { normalizeDriverName } from './registry.mjs'

export const AGENT_LOOPS_SETTINGS_NS = 'agent-loops'

const AgentLoopsSettingsSchema = z.object({
  defaultDriver: z.string(),
})

/**
 * Register the settings slice. Returns the namespace handle whose `get()`
 * reads the hot-reloaded document (`{ defaultDriver?: string }`).
 */
export function installAgentLoopsSettings(ctx, config) {
  let handle
  ctx.inject(['settings'], (settingsCtx) => {
    handle = settingsCtx.settings.register(
      AGENT_LOOPS_SETTINGS_NS,
      AgentLoopsSettingsSchema,
      { base: { defaultDriver: config.defaultDriver } },
    )
  })
  return {
    get() {
      return handle?.get?.()
    },
  }
}

/** Emulate the `@Remote` decorator without a build step. */
function remoteMarker(methodName, exportName) {
  let initializer
  if (exportName === undefined) {
    Remote(undefined, {
      private: false,
      static: false,
      name: methodName,
      addInitializer(fn) {
        initializer = fn
      },
    })
  } else {
    Remote(exportName)(undefined, {
      private: false,
      static: false,
      name: methodName,
      addInitializer(fn) {
        initializer = fn
      },
    })
  }
  return initializer
}

/**
 * Remote surface consumed by the web client: `agentLoops/listDrivers` and
 * `agentLoops/setDefaultDriver`.
 *
 * Writes go through the settings SERVICE directly instead of the web-exposed
 * settings API: DSH's host gates the latter behind a hardcoded namespace
 * allowlist (`WEB_SETTINGS_NAMESPACES` in dsh-host-apiproxy) that a plugin
 * cannot extend.
 */
export class AgentLoopsRemote extends TypertRemoteService {
  static { /* markers installed per-instance in the constructor */ }

  constructor(ctx, dock) {
    super(ctx, 'agentLoops', { namespace: 'agentLoops' })
    this.dock = dock
    for (const initializer of [remoteMarker('listDrivers'), remoteMarker('setDefaultDriver')]) {
      initializer.call(this)
    }
  }

  /** List the registered drivers and the current default. */
  listDrivers() {
    return {
      drivers: this.dock.listDrivers(),
      current: this.dock.currentDriver(),
    }
  }

  /** Persist the default driver for new sessions. */
  async setDefaultDriver(driver) {
    const normalized = normalizeDriverName(driver)
    if (!this.dock.hasDriver(normalized)) {
      throw new UnknownDriverError(normalized, this.dock.listDrivers())
    }
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw new Error('agentLoops: settings service is not available')
    await settings.update(AGENT_LOOPS_SETTINGS_NS, { defaultDriver: normalized })
    return { ok: true }
  }
}
