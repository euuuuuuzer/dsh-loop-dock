/**
 * Loop author starter.
 *
 * Copy this directory, rename the package, replace the setup body, and install
 * it into the same DSH profile as dsh-loop-dock.
 */

export const name = 'dsh-loop-author-template'

export const inject = ['agentLoopDock']

export function apply(ctx, config = {}) {
  const loopId = config.loopId ?? 'template-strategy'

  ctx.agentLoopDock.register({
    id: loopId,
    kind: 'strategy',
    label: config.label ?? 'Template Strategy Loop',
    description: config.description ?? 'Replace this description with what the loop changes and why.',

    async setup(agentCtx) {
      // A strategy loop only installs agent-scoped setup. Examples:

      // Mount a preset by id when no composition already exists:
      // const presets = agentCtx.get('agentPresets')
      // if (presets?.composedPreset?.(agentCtx) === undefined) {
      //   await presets.mount(agentCtx, config.preset)
      // }

      // Install an agent/request listener:
      // agentCtx.on('agent/request', async (_payload, next) => next(), { prepend: true })

      // Restrict tools:
      // agentCtx.tools.restrict(['tool-a', 'tool-b'])
    },
  })
}
