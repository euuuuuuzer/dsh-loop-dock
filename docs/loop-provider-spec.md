# Loop Provider Spec (v0)

A loop provider is one of two shapes. The id must match
`/^[a-z0-9][a-z0-9._-]*$/` and is unique inside one dock.

## Strategy loop

```js
{
  id: 'community-loop',
  kind: 'strategy',
  label: 'Community Loop',
  description: 'what this loop changes and why',
  driver: 'loop2', // optional; omitted means the default driver

  async setup(agentCtx) {
    // Trusted, composition-only, unpublished agent scope.
    // Do NOT drive the agent here.
  },
}
```

`setup` follows DSH's `AgentSetup` contract:

- it receives the unpublished `agent.ctx`;
- it may return `{ commit() { ... } }` for publication-time validation;
- a throw rolls the whole agent creation back.

The dock composes setups in this order:

1. caller `options.setup` (so DSH Web/subagent preset mounts are visible)
2. durable binding setup (records `agent-preset/selected`
   `data.agentLoopDock`, preserving the session's effective preset)
3. route-follow setup (`agent/request` model-route re-evaluation)
4. strategy `setup`

and collects every commit, so the caller and the loop both stay within DSH's
publication transaction. Caller-before-strategy lets DSH Web/subagent setup
install the preset before the strategy runs; a preset strategy can then
detect that the preset is already mounted and avoid double-mounting.

### What a strategy setup may do

- mount a preset: `await agentCtx.get('agentPresets').mount(agentCtx, id)`
- register scoped tools / prompt sections / variables
- restrict tools: `agentCtx.tools.restrict(...)`
- install scoped event listeners (`agent/pre-step`, `agent/request`,
  `system-prompt/assemble`, ...)
- key any mutable state by Session/Agent (never module-global per-process)

### What a strategy setup cannot do

- change the turn/step driver;
- replace tool execution or the model stream itself;
- create another agent (use `ctx.agents` from a plugin context outside setup).

## Driver loop

```js
{
  id: 'planner-executor-critic',
  kind: 'driver',

  async createAgent(ownerCtx, options) {
    // implement the full DSH AgentFactory contract
    return { agent, dispose }
  },

  async resume(ownerCtx, options) {
    // load persistence, rebuild, return the same handle shape
  },
}
```

`options` is the DSH `CreateAgentOptions` / `ResumeAgentOptions`, with two dock
extensions:

- `options.loop` — selected loop id;
- `options.agentOptions.loop` — same value, for drivers that only inspect
  agent options.

A driver loop must own the complete rollback-covered publication transaction:
prepare session, construct agent, run setup, enter registries, announce, start
driving. The official `@deepseek-ai/dsh-agent-loop` is the reference.

## Drivers

A dock has a named driver registry:

```js
dock.registerDriver(driver)             // name: 'default'
dock.registerDriver('loop2', driver2)   // named driver
```

A strategy loop without an `driver` field uses `default`. A strategy with
`driver: 'loop2'` prefers that driver; an explicit runtime `driver` option
overrides the preference. Driver loops are full providers and never use the
strategy wrapper.

The same strategy id is globally unique; to express “strategy 3 on loop 2”,
use a composite slot id such as `loop2.strategy3` plus `driver: 'loop2'`.

## Compatibility rules for authors

- Never call `ctx.agents.setFactory` from a loop provider. The dock owns that
  slot.
- Do not publish process-global services without an isolation strategy. Prefer
  agent-scoped registrations through `agent.ctx`.
- Durable state must be derivable from session events (resume-safe).
- Loop choice is creation-time identity. Do not switch a live non-blank session
  by mutating the persisted event.

## Examples

Copy the loop author starter as a starting point:

```sh
cp -R examples/loop-author-template my-loop
```

Fake demos (both run without DSH):

```sh
# two strategy loops sharing one fake driver
node examples/fake-two-loop.mjs

# two fully independent fake driver loops in one dock
node examples/fake-two-driver-loops.mjs
```

Real strategy example (requires a dock + default driver):

```js
dock.register({
  id: 'example-preset',
  kind: 'strategy',
  async setup(agentCtx) {
    await agentCtx.get('agentPresets').mount(agentCtx, 'example-preset')
  },
})
```

Two-layer routing example:

```js
dock.registerDriver('loop1', driver1)
dock.registerDriver('loop2', driver2)

dock.register({ id: 'strategy1', kind: 'strategy', setup: strategy1 })
dock.register({ id: 'strategy2', kind: 'strategy', setup: strategy2 })
dock.register({ id: 'strategy3', kind: 'strategy', driver: 'loop2', setup: strategy3 })
dock.register({ id: 'strategy4', kind: 'strategy', setup: strategy4 })

// strategy1 runs on loop1, strategy4 runs on loop2, all chosen at runtime:
create({ sessionId: 'a1', loop: 'strategy1', driver: 'loop1' })
create({ sessionId: 'a4', loop: 'strategy4', driver: 'loop2' })
```
