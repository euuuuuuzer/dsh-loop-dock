# dsh-loop-author-template

Starter for a loop provider that plugs into `dsh-loop-dock`.

## Strategy loop

A strategy loop reuses an existing driver and only installs agent-scoped
setup. Edit `src/index.mjs`, replace the `setup` body, then map it from a
preset:

```yaml
- id: agent-loop-dock
  config:
    presetLoops:
      my-preset: my-loop
```

## Driver loop

For control flow that cannot be expressed with setup hooks, use:

```js
ctx.agentLoopDock.register({
  id: 'my-driver-loop',
  kind: 'driver',
  async createAgent(ownerCtx, options) { /* full AgentFactory contract */ },
  async resume(ownerCtx, options) { /* full AgentFactory contract */ },
})
```

See [../../docs/loop-provider-spec.md](../../docs/loop-provider-spec.md).
