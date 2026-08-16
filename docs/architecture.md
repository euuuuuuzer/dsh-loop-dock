# Architecture

## Goal

Allow one DSH process to host multiple named agent loops and bind a loop to an
agent at creation/resume time.

Explicit non-goals: designing loops, ranking loops, model-based routing,
task-based routing, multi-agent workflows, shared memory.

## Layers

```text
┌────────────────────────────────────────────────────────────┐
│ DSH host composition                                        │
│  ctx.agents (single AgentFactory slot)                      │
│        │                                                    │
│  dsh-loop-dock  ← the plugin that owns that slot            │
│        │                                                    │
│  LoopDock                                                   │
│   ├── LoopRegistry                                           │
│   ├── DriverRegistry (default + named drivers)               │
│   ├── selection / durable loop identity                      │
│   └── headless official loop as the default driver           │
└────────────────────────────────────────────────────────────┘
        │                          │
   StrategyLoop               DriverLoop
   (bound to a driver)        (full driver)
```

## Why one default driver?

The concrete DSH loop (`@deepseek-ai/dsh-agent-loop`) is the only supported
turn/step driver today and its internals are package-private. Reimplementing it
is a last resort.

For v0 and for most model-specific loops, one driver plus per-agent strategy
setups is sufficient: the setup can mount presets, restrict tools, alter prompt
sections, and install `agent/pre-step` / `agent/request` /
`system-prompt/assemble` listeners. Existing community preset plugins already
prove this class of loop experimentally.

A strategy loop is therefore a **first-class loop provider** in this project,
not a second-class citizen. It is also the only kind a non-expert can safely
publish.

## Selection and persistence

Selection is resolved by `src/selection.mjs`:

Create:

1. `options.loop` / `options.agentOptions.loop`
2. exact session route (`sessionLoops`)
3. preset route (`presetLoops` + `options.meta.agentPreset`)
4. `defaultLoop`

The driver dimension follows the same precedence independently:
`options.driver`, route driver, preset driver, strategy-declared driver,
settings `defaultDriver`, config `defaultDriver`.

Resume:

1. read the recorded `agent-preset/selected` `data.agentLoopDock` binding
   (creation identity for both `loop` and `driver`)
2. fall back to `SessionHeader.agentPreset` mapped through `presetLoops`
3. exact session route (`sessionLoops`)
4. apply explicit/route choices, refusing a mismatch (`LOOP_SWITCH`) on either
   the loop or the driver dimension

The dock persists its binding through the KNOWN `agent-preset/selected` event,
not through a custom event type. DSH's persistence read path refuses a log
containing any event type outside `KNOWN_SESSION_EVENT_TYPES` unless the event
is marked `ignorable`, and `Session.append` has no public way to mark one — so
an unknown custom event would brick every session it touches. Storing
`data.agentLoopDock` on an event DSH already knows preserves the effective
preset in the same record. Upstream
`SessionHeader.agentFactory` remains the future clean replacement.

## Lifecycle

- The bundle patch disables official `agent-loop` and enables the local
  `fake-driver` registration alongside the default driver (it never changes
  the effective default driver).
- `src/index.mjs` constructs one `LoopDock`, registers the built-in strategy
  slots (idempotent preset-mount strategy loops), registers the `loop-ping` local no-model adapter (`src/ping-adapter.mjs`), calls
  `ctx.agents.setFactory(dock)`, publishes `ctx.agentLoopDock`, then starts
  `config.agents`.
- `src/driver-settings.mjs` registers the `agent-loops` settings namespace
  (`defaultDriver`) and the `agentLoops` Typert Remote service
  (`listDrivers`, `setDefaultDriver`). `setDefaultDriver` writes through
  the settings SERVICE, bypassing the web settings API's hardcoded
  namespace allowlist. The dock's `_defaultDriver()` reads the namespace
  live at every create (`explicit > route > preset > loop.driver > settings
  > config`).
- The web Settings row is a client bundle (`client.js`, `dsh.client` +
  `./client` + `./package.json` exports): `exports.inject` carries cordis
  service names, and the client-modules scan requires the package to be
  resolvable from the global `dsh` install (junction for local checkouts).
- `LoopRegistry.register()` returns an idempotent disposer.
- `LoopDock.registerDriver()` accepts one default driver plus any number of
  named drivers and returns a disposer for each registration.
- Strategy loops are wrapped in driver providers and cached per
  `${driver}:${loop.id}` (the same strategy can run on several drivers).
- `_decorateOptions` applies a loop-pinned `provider`/`model` over the
  caller's agentOptions, composes the caller setup first (so preset mounts
  are visible), records the durable binding next, and then installs
  `routeFollowSetup` for every agent: an outermost `agent/request` listener
  that re-evaluates the
  mapped loop's pin against the session's CURRENT effective preset
  (`agentPresets.composedPreset`), so a blank-session preset switch (DSH
  Web hero chip → `agent-preset/select` → `recompose`) switches the model
  route live — and a stale pin persisted in the request header is released
  back to the agent's creation-time route when no pin applies.

## Milestones

### M0 — routing core (done)

Registry, selection, provider protocol, fake-driver tests.

### M1 — headless default driver (done)

A derivative of `@deepseek-ai/dsh-agent-loop` with self-registration removed.
See [default-driver.md](./default-driver.md). Two real headless-driver agents
can be created in one process through the dock; the integration test also
drives a real model turn through a mock adapter, and a named-driver test runs
`loop1.strategy1` and `loop2.strategy3` on two headless driver instances.

### M2 — one official slot wired, community slots user-registered

The `standard` strategy slot is driven by the headless driver and wired to
every shipped official preset. Community loops are registered through
`ctx.agentLoopDock.register(...)` and mapped with `presetLoops`; an E2E step
should run the official slot plus one user-registered loop with the real DSH
preset roster installed.

### M3 — community loop SDK

`defineStrategyLoop` / `defineDriverLoop` already exist in `src/provider.mjs`.
Remaining: package-level docs/examples and a standalone test harness for loop
authors.

### M4 — upstream proposal

Propose `registerFactory(name, factory, { default })` and
`SessionHeader.agentFactory` to DSH Core. The dock API should remain usable as
a compatibility shim above the native registry.

## Risks

- DSH is a developer preview; `dsh-agent-loop` internals may move.
- The dock binding rides a preset-selection event; cold-read UI/presenter paths
  see it as an ordinary preset record. A dedicated core header field would be
  cleaner long-term (the future `SessionHeader.agentFactory`).
- A strategy loop can only change what DSH extension points allow; it cannot
  change turn/step control flow.
- Shared host-plane services are process-global. Loop authors must key state by
  Session/Agent, exactly as preset authors do today.
