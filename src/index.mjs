/**
 * dsh-loop-dock plugin entry.
 *
 * This is a HOST-plane plugin, not an agent preset. Its bundle patch must
 * disable the official `agent-loop` row and insert this row instead. The dock
 * then becomes the single AgentFactory registered with `ctx.agents`, and
 * every loop provider becomes an internal slot.
 *
 * Service surface:
 *   ctx.agentLoopDock.register(provider)
 *   ctx.agentLoopDock.registerDriver(driver)          // default driver
 *   ctx.agentLoopDock.registerDriver(name, driver)    // named driver
 *   ctx.agentLoopDock.listLoops()
 *   ctx.agentLoopDock.listDrivers()
 *   ctx.agentLoopDock.hasDriver(name)
 */

import { LoopDock } from './hub.mjs'
import { AgentLoopsRemote, installAgentLoopsSettings } from './driver-settings.mjs'
import { PingAdapter } from './ping-adapter.mjs'
import { defineStrategyLoop } from './provider.mjs'

export const name = 'dsh-loop-dock'

export const inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt']

/** Provider id under which the local no-model ping adapter is registered. */
export const PING_PROVIDER = 'loop-ping'

/**
 * Default fixed reply served by the ping adapter. Neutral by default — a
 * deployment that wants a distinguishable marker (e.g. a fake debug loop)
 * sets `config.pingReply` in its own profile patch instead, keeping the
 * repository free of any deployment-specific text.
 */
export const PING_REPLY = 'loop-ping: local no-model reply (generated locally, no model call).'

const BUILTIN_PRESET_LOOPS = [
  {
    id: 'standard',
    preset: 'standard',
    label: 'Standard preset loop',
    description: 'Runs the shipped Standard preset on the dock default driver.',
  },
]

/**
 * A strategy loop that mounts one preset (skipping its own mount when a
 * caller setup already composed one — DSH Web and in-process subagent
 * providers do that before the dock's setups run).
 */
function presetStrategyLoop({ id, label, description, preset }) {
  return defineStrategyLoop({
    id,
    label,
    description,
    async setup(agentCtx) {
      const presets = typeof agentCtx.get === 'function' ? agentCtx.get('agentPresets') : undefined
      if (presets === undefined) return
      if (typeof presets.composedPreset === 'function' && presets.composedPreset(agentCtx) !== undefined) return
      await presets.mount(agentCtx, preset)
    },
  })
}

const builtinLoops = BUILTIN_PRESET_LOOPS.map(({ id, preset, label, description }) => (
  presetStrategyLoop({ id, label, description, preset })
))

export function apply(ctx, config) {
  const dock = new LoopDock(ctx, config)

  // Settings-driven default driver (the web Settings row writes it) +
  // the Remote surface the row lists drivers through.
  if (typeof ctx.inject === 'function') {
    dock.driverSettings = installAgentLoopsSettings(ctx, config)
    new AgentLoopsRemote(ctx, dock)
  }

  // Local no-model adapter for loops that pin provider: loop-ping. The reply
  // text is deployment-configurable via `config.pingReply`; the neutral
  // default keeps the repository free of deployment-specific markers.
  if (typeof ctx.llm?.registerAdapter === 'function') {
    const reply = dock.config.pingReply ?? PING_REPLY
    ctx.llm.registerAdapter([PING_PROVIDER], new PingAdapter(reply))
  }

  // Built-in official baseline slot. It is a strategy loop: the default
  // registers them as driver providers when it activates.
  for (const loop of builtinLoops) dock.register(loop)

  // The dock is the ONE factory the harness sees. This must be registered
  // exactly once; the bundled cordis.patch.yml disables the official row.
  ctx.effect(() => ctx.agents.setFactory(dock), 'dsh-loop-dock.setFactory()')

  // The headless driver no longer self-registers these variables; the dock
  // owns them once so preset personas using {{provider}}, {{model}}, and
  // {{cwd}} keep working exactly as with the official loop.
  if (typeof ctx.systemPrompt?.variable === 'function') {
    ctx.systemPrompt.variable('provider', (context) => context.agent?.options.provider)
    ctx.systemPrompt.variable('model', (context) => context.agent?.options.model)
    ctx.systemPrompt.variable('cwd', (context) => context.agent?.session.header.cwd)
  }

  // Publish the dock for loop authors and for future UI/settings surfaces.
  // `ctx.provide` registers its own fiber-owned disposer.
  if (typeof ctx.provide === 'function') ctx.provide('agentLoopDock', dock)

  // Declarative agents start after the factory slot is occupied. Each entry
  // may carry `loop` plus the usual provider/model/session fields.
  dock.startConfiguredAgents()

  return dock
}
