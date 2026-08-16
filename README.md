# dsh-loop-dock

> One harness. Multiple agent loops.

`dsh-loop-dock` is a community infrastructure plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). It
does **not** design a new agent loop. It provides the dock that lets many loop
providers exist in one harness and lets each agent choose which one runs it.

[中文说明](./README.zh-CN.md)

## Why dsh-loop-dock?

A model's ceiling is not the model alone. The same model can behave very
differently depending on turn structure, tool discipline, context management,
planning strategy, and execution workflow.

Community plugins have already shown this: small changes around one loop —
a minimal-first preset, a prompt section, a bootstrap hook — can give the same
model meaningfully different behavior.

DSH already made the Agent Loop a plugin, but the slot is still effectively
single:

```
Agent A ─┐
Agent B ─┼──> Loop X
Agent C ─┘
```

`dsh-loop-dock` opens the next step:

```
Agent A ──> Loop X
Agent B ──> Loop Y
Agent C ──> Loop Z
```

One harness. Multiple specialized loops.

## What does the dock do?

The dock is intentionally simple. It does not decide how a loop reasons.

It provides:

- loop registration
- loop selection
- agent-loop binding
- driver delegation

The community builds the loops. The dock makes them composable.

## Example

A future DSH setup could look like:

```yaml
agent-loop-dock:
  agents:
    - id: coder
      provider: deepseek-official
      model: deepseek-v4-pro
      loop: coding-loop

    - id: researcher
      provider: deepseek-official
      model: deepseek-v4-flash
      loop: research-loop

    - id: planner
      provider: provider-c
      model: model-c
      loop: planning-loop
```

`coding-loop`, `research-loop`, and `planning-loop` are community-registered
loops. Each agent gets:

```
one agent
+ one suitable model
+ one suitable loop
```

instead of forcing every model and task through the same execution pattern.

## Try it without a model key

The bundled patch registers `fake-driver` next to the real `default` driver.
Switch the Settings row to `fake-driver`, create a new session, and send any
message. It replies locally:

```text
[FAKE-DRIVER] fake driver reply — generated locally, no model call.
```

No API key and no network are involved. This makes loop and driver routing
visible in the first minute.

## Architecture

```text
ctx.agents.create / resume
        |
        v
   dsh-loop-dock
   (AgentFactory layer)
        |
        +-- LoopRegistry
              |     |     |
              v     v     v
            Loop A Loop B Loop C
                    |
                    v
              Agent Driver
                    |
                    v
                  Model
```

The dock separates two concepts:

- **Strategy loop** — reuses an existing driver and only installs agent-scoped
  setup such as prompts, presets, hooks, tools, and policies. This is the
  common case.
- **Driver loop** — a complete custom loop implementation owning
  `createAgent`, `resume`, and turn control flow. This is for fundamentally
  different execution architectures.

## Current Status

Pre-alpha, but runnable.

- ✅ Loop registry
- ✅ Agent → loop routing
- ✅ Durable loop + driver binding
- ✅ Driver selection
- ✅ Strategy loop protocol
- ✅ Driver loop protocol
- ✅ Default headless driver
- ✅ Official `standard` strategy slot
- ✅ Multi-agent integration tests

The dock is working. The ecosystem is the next step.

See [docs/architecture.md](./docs/architecture.md) for the roadmap.

## Terminology

Names follow DeepSeek Harness's own vocabulary (the official package
`@deepseek-ai/dsh-agent-loop` never uses "engine"; it speaks of the
"agent factory and driver service"):

| Our term | What it means | Common / official phrasing |
| --- | --- | --- |
| **driver** | The core agent-loop implementation that owns the `createAgent`/`resume` contract and drives turns (`HeadlessAgentLoop` is the vendored official driver). | Official DSH: *agent loop* / *driver* ("agent factory and driver service"). Other harnesses often say *engine* (e.g. Codex engine) — DSH does not use that word. |
| **loop** | The COMPLETE loop an agent runs, as registered in the `LoopRegistry`: a **strategy loop** (reuses a driver + installs agent-scoped setup) or a **driver loop** (`kind: 'driver'`, a full custom driver). `loop` is the whole loop; `driver` is only its engine part. | Community: *agent loop* / *loop*. Do not use "loop" for the engine layer. |
| **strategy loop** | A loop that reuses a driver and only installs per-agent setup (mount a preset, add hooks). This is the common case. | Roughly: a preset/profile plus an adapter on top of one engine. |
| **driver loop** | A loop that IS a complete driver (`createAgent`/`resume`), for control flow that differs from the default driver. | Roughly: a full engine implementation. |
| **preset** | DSH's per-session composition (tools + prompt sections), selected via the native picker. | Official DSH: *preset*. Note: in everyday conversation "preset" sometimes means the loop — we always mean the tool/prompt composition. |
| **model route** | The provider/model (+ reasoningEffort) a session's requests use. | Community: model config / model selection. |
| **AgentFactory** | The `createAgent`/`resume` contract the factory registry delegates to (`ctx.agents.setFactory`). | Official DSH: *AgentFactory*. |
| **harness** | The whole agent runtime platform (DSH itself, or Codex, etc.). | Common term across the ecosystem. |
| **binding** | The durable `{ loop, driver? }` selection the dock records on a session at creation (`agent-preset/selected` `data.agentLoopDock`). | Recorded selection / route binding. |

These concepts relate as follows: **preset** defines the tools and prompt sections, **driver** executes turns, **loop** is the complete loop an agent runs (strategy loop = driver + setup; driver loop = a full custom driver), and **model route** decides which LLM answers. Sessions pick a preset; the dock derives the loop; the loop (or settings) picks the driver; the request uses the model route.


## Implementation status

**Pre-alpha but runnable: the routing core, the vendored headless official
driver, and the shipped official `standard` strategy slot are implemented and tested together.**

| Piece | Status |
| --- | --- |
| Named loop registry | ✅ implemented |
| Agent → loop routing | ✅ implemented |
| Durable loop + driver selection (known event binding, preset fallback) | ✅ implemented |
| Local no-model ping adapter (`loop-ping`) | ✅ implemented |
| Effective-preset model-route following (hero-chip switching) | ✅ implemented |
| Fake driver for dual-driver testing (`fakeDriver: true`) | ✅ implemented |
| Web Settings "Default driver" row (`agentLoops` Remote + `client.js`) | ✅ implemented |
| Strategy-loop + driver-loop provider protocol | ✅ implemented |
| `standard` strategy slot | ✅ registered |
| Headless default driver (official loop derivative) | ✅ vendored, see [docs/default-driver.md](./docs/default-driver.md) |
| Two-agent real-driver integration test | ✅ passing |
| Core `SessionHeader.agentFactory` field | ❌ upstream follow-up only |

Track the roadmap in [docs/architecture.md](./docs/architecture.md); the
original motivation and design notes live in [DESIGN.md](./DESIGN.md).

## Model

```text
ctx.agents.create / resume
        |
   dsh-loop-dock (the only AgentFactory)
        |
        +-- LoopRegistry (the slots)
        |     +-- standard           (strategy: standard preset)
        |     +-- community-loop      (user-registered community loop)
        |     +-- ...                (your loop)
        |
        +-- selection
        |     explicit option > session route > preset route > default
        |
        +-- default driver
              +-- HeadlessDriver (vendored derivative of @deepseek-ai/dsh-agent-loop)
```

A **strategy loop** reuses a driver and installs an agent-scoped setup. It
may declare a preferred driver (`driver: 'loop2'`) or leave the choice to the
caller. At creation time `loop` and `driver` are independent dimensions:

```js
ctx.agents.create({ sessionId: 'a1', loop: 'strategy1', driver: 'loop1' })
ctx.agents.create({ sessionId: 'a3', loop: 'strategy3', driver: 'loop2' })
```

so one dock supports arbitrary driver × strategy combinations. A
**model-specific loop** is usually a strategy loop: its author does not need
to implement turn/step control flow.

An **driver loop** owns the complete `createAgent` / `resume` contract. It is
for loops whose control flow differs from the default driver.

## Install

Install as a normal DSH profile plugin (local checkout before publication):

```sh
cd /path/to/workspace
dsh plugin --profile web add ./dsh-loop-dock
```

Full usage instructions are in [docs/usage.md](./docs/usage.md) and the DSH
multi-agent compatibility matrix is in [docs/compatibility.md](./docs/compatibility.md).

The package declares `dsh.bundle.patch = cordis.patch.yml`. Its bundle patch
disables the official `agent-loop` row and inserts `agent-loop-dock`, so the
dock owns the single factory slot:

```yaml
- id: agent-loop
  disabled: true

- insert:
    - id: agent-loop-dock
      name: 'dsh-loop-dock'
      config:
        defaultLoop: standard
        defaultDriver: default
        presetLoops:
          standard: standard
          minimal: standard
          code: standard
          cordis: standard
        sessionLoops: {}
        agents: []

    - id: agent-loop-dock-default-driver
      name: 'dsh-loop-dock/headless-driver'
      config:
        maxParallelToolCalls: 10
        fakeDriver: true
```

> Do not install a strategy-loop pack and the official loop adapter into the
> same profile until the adapter is designed to leave `setFactory` to the
> dock.

## Declarative agents

The dock accepts the agent list the official loop used, plus `loop` and
optional `driver` fields:

```yaml
agent-loop-dock:
  defaultLoop: standard
  agents:
    - id: planner
      provider: provider-a
      model: model-a
      loop: loop-a
      sessionId: planner-session

    - id: coder
      provider: provider-b
      model: model-b
      loop: loop-b
```

`loop` is optional. Without it, selection falls back through session routes,
preset routes, and `defaultLoop`. `driver` is optional and falls back through
route values, the strategy's declared driver, and `defaultDriver`.
`provider`, `model`, `maxTokens`, `reasoningEffort`, and `cwd` are passed
through to the driver and the strategy setup; consult your driver adapter for
which fields it applies. A complete YAML shape lives in
[examples/agents.example.yml](./examples/agents.example.yml).

### Driver picker in the web UI

The plugin ships a client bundle (`client.js`) that renders a
"默认驱动 / Default driver" row in Settings → General, listing the drivers
registered with the dock and persisting the choice to the
`agent-loops.defaultDriver` setting. It talks to the `agentLoops` Remote
service (`listDrivers` / `setDefaultDriver`). Full wiring details, the
packaging requirements (junctions, exports, inject semantics), and
behavioral notes (new sessions only, blank-session reuse) are in
[docs/usage.md](./docs/usage.md).

### Model routing is separate from loop routing

The dock owns two coordinates:

```text
loop routing:  loop + driver
model routing: provider + model (+ maxTokens + reasoningEffort)
```

`provider` and `model` are consumed by DSH's LLM adapters; the dock passes
them through, except loops that pin their own route (a loop registered
programmatically with `provider`/`model`, e.g. the `loop-ping` debug
adapter), which override the caller's choice — re-evaluated on every request
against the session's effective preset, so preset switches follow live. So a
four-agent team can be declared in one place:

```yaml
agent-loop-dock:
  agents:
    - id: agent1
      provider: provider-a
      model: model-a
      loop: strategy1
      driver: loop1

    - id: agent2
      provider: provider-a
      model: model-a
      loop: strategy2
      driver: loop1

    - id: agent3
      provider: provider-b
      model: model-b
      loop: strategy3
      driver: loop2

    - id: agent4
      provider: provider-b
      model: model-b
      loop: strategy4
      driver: loop2
```

### Can I create that team by typing in the DSH Web chat?

Not yet. The dock currently has no model-facing "create agent team" tool. The
supported creation paths are:

1. declarative `agents` config (above);
2. programmatic `ctx.agents.create({ agentOptions, loop, driver })`;
3. DSH Web sessions created manually through the UI, where the model picker
   chooses the model and the preset picker chooses the mapped loop.

Built-in subagents inherit their parent preset, and DSH's subagent tool schema
does not expose `loop`/`driver` fields. A natural-language team-creation tool
is a natural next plugin on top of this dock, but it is not implemented yet.

## Loop-provider protocol

See [docs/loop-provider-spec.md](./docs/loop-provider-spec.md).

Strategy loop (the common case):

```js
dock.register({
  id: 'community-loop',
  kind: 'strategy',
  description: 'community-owned setup for one model family',
  async setup(agentCtx) {
    // install presets, prompt sections, tool restrictions, event hooks
  },
})
```

Driver loop (custom control flow):

```js
dock.register({
  id: 'planner-executor',
  kind: 'driver',
  async createAgent(ownerCtx, options) { /* ... */ },
  async resume(ownerCtx, options) { /* ... */ },
})
```

A default driver is installed once:

```js
dock.registerDriver(headlessOfficialDriver)
```

## Selection precedence

Create:

```text
loop:   options.loop > sessionLoops route > presetLoops route > defaultLoop
driver: options.driver > route driver > preset driver
        > strategy.driver > settings defaultDriver > config defaultDriver
```

Resume:

- the durable binding recorded at creation as `agent-preset/selected`
  `data.agentLoopDock` (both `loop` and `driver`, when the creation-time
  driver resolution produced one);
- for sessions without that record, the durable
  `SessionHeader.agentPreset` mapped through `presetLoops`;
- exact `sessionLoops` routes;
- an explicit or routed choice that differs from the recorded/mapped binding
  is rejected with `LOOP_SWITCH`, mirroring DSH's blank-session-only preset
  switch rule.

> The dock persists the binding through the KNOWN `agent-preset/selected`
> event, not through a custom event type. DSH's persistence read path
> refuses unknown event types unless they are marked `ignorable`, and
> `Session.append` has no public way to mark one. `agent-preset/selected`
> is already in DSH's known-event vocabulary; the dock stores its payload
> under `data.agentLoopDock` and preserves the session's effective preset
> in the same event, so DSH reads the session exactly as before.

## Development

```sh
npm test
node examples/fake-two-loop.mjs
node examples/fake-two-driver-loops.mjs
npm pack --pack-destination /tmp
bash scripts/smoke-portable.sh /tmp/dsh-loop-dock-0.1.0.tgz
```

The regular suite skips the live API test. Opt in with a DeepSeek API key:

```sh
DSH_LOOP_DOCK_LIVE_API=1 \
DEEPSEEK_API_KEY=... \
DSH_LOOP_DOCK_LIVE_MODEL=deepseek-chat \
node --test test/live-api-2x2.test.mjs
```

The live test runs four real model turns across a 2×2 matrix: two headless
drivers × two strategies.

`fake-two-loop.mjs` proves two strategy loops on one fake driver.
`fake-two-driver-loops.mjs` proves two completely independent fake driver
loops in one dock — the project's core claim without any real loop work.

The routing core (`src/hub.mjs`, `src/selection.mjs`, `src/registry.mjs`,
`src/config.mjs`, `src/errors.mjs`, `src/provider.mjs`) has no runtime
dependencies. The plugin entry targets DSH `0.1.0-rc.6` peers and uses the
host-plane services through `ctx.inject`, `ctx.effect`, `ctx.provide`,
`ctx.agents.setFactory`, `ctx.llm.registerAdapter`, and
`ctx.systemPrompt.variable`; agent creation/resume delegates only through the
documented AgentFactory contract.

## License and attribution

MIT. The vendored official-loop derivative retains the upstream MIT license
and lists all modifications; see [NOTICE](./NOTICE) and
`vendor/dsh-agent-loop-headless/`.

This is a community project, not an official DeepSeek project.

## A brick, not the building

Routing is the easy part. The dock is deliberately small and boring —
register, select, bind, delegate — any competent plugin author could write
it in a weekend.

The hard part, and the reason this project exists, is that **nobody has
written a second agent loop yet**. DSH made the Agent Loop a plugin — in my
view, the only harness with that ambition — but the slot has stayed empty.
This project is a dock: a working routing hub that proves the seam is real.

I believe DSH is the harness that can most easily push **model × harness
capability** to its limit: a model's ceiling is not the model alone, but the
model driven by the right turn structure, budget, and tool discipline. An
extreme example: GPT-5.6 Sol and GPT-5.6 Luna sharing the same Codex loop
would not both run at full strength; whether it is GLM-5.3, Kimi K3, or
GPT-5.6, each deserves a dedicated DSH loop, just as a
deepseek-v4-pro-class model benefits from a loop shaped for it. The future
this project points to is multi-agent by default, where every agent picks
the model best suited to it and the agent loop best suited to that model —
one agent, one model, one model-specific loop — with DSH as the platform
where the model × harness matrix is freely recombined.

I personally believe DSH is clearly moving in this direction, but it will
take an extremely long time and an enormous amount of work — work that, in
my view, only the open-source community can carry.
