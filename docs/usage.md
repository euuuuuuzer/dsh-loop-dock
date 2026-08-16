# Usage

This guide assumes the package is already installed as a DSH profile plugin.
From this repository (before it is published), install the local checkout:

```sh
cd /path/to/workspace
dsh plugin --profile web add ./dsh-loop-dock
```

Then fully restart DSH Web.

## Verify it loaded

In the DSH Web plugin/settings inventory you should see the dock rows:

```text
agent-loop-dock
agent-loop-dock-default-driver
```

The official `agent-loop` row must be disabled. The headless driver row
injects the dock, so it activates only after the dock owns the factory slot.

## Fake driver: test dual-driver routing

A second, observably different driver (`src/fake-driver.mjs`) for verifying
that driver routing works. It wraps the vendored headless driver and forces
the model route to its own local adapter (`driver-ping`, reply
`[FAKE-DRIVER] fake driver reply — generated locally, no model call.`), at
the Driver layer — so sessions on it always reply with the marker, ignoring
the caller's model selection, the preset, and the loop's own pin.

The bundled patch enables it by default, so a clean install already lists both
`default` and `fake-driver`. To disable it, restate the
`agent-loop-dock-default-driver` row config (the patch replaces the whole
row):

```yaml
- id: agent-loop-dock-default-driver
  config:
    maxParallelToolCalls: 10
    fakeDriver: false
```

Use it programmatically with `driver: 'fake-driver'`:

```js
const handle = await ctx.agents.create({
  sessionId: 'x',
  loop: 'standard',
  driver: 'fake-driver',   // explicit runtime driver; overrides the strategy binding
})
```

A session on the fake driver replies `[FAKE-DRIVER] ...`, a standard
session replies with the real model — same preset family, different driver,
different behavior. Driver is fixed at session creation; there is no
mid-session driver switch (DSH locks the preset after the first turn anyway).

## Basic use: one agent per session, select the loop by preset

The dock ships one official strategy slot and maps every shipped official DSH
preset id to it:

| Loop slot | DSH preset | Meaning |
| --- | --- | --- |
| `standard` | `standard` / `minimal` / `code` / `cordis` | every shipped official mode runs the headless official loop |

Create a session and choose any shipped preset. Behind the scenes the dock
records the resolved loop for the agent:

```text
session 1: preset standard  -> loop standard
session 2: preset code      -> loop standard
```

Community presets are deliberately not baked into the plugin. A preset author
registers the corresponding loop through `ctx.agentLoopDock.register(...)` and
adds a `presetLoops` mapping, so the dock itself stays preset-neutral.

## Settings row: default driver for new sessions

The web Settings → General page gets a "默认驱动 / Default driver" row
(shipped by `client.js`). It lists the drivers registered with the dock and
persists the choice to the `agent-loops.defaultDriver` settings namespace.
The dock reads it when a new session is created:

```text
explicit driver > route driver > loop.driver > settings defaultDriver > config defaultDriver
```

The row reads and writes through TWO Typert Remote endpoints on the
`agentLoops` service:

- `agentLoops/listDrivers` → `{ drivers, current }` (the registered drivers
  and the effective default);
- `agentLoops/setDefaultDriver(driver)` → persists the choice; invalid or
  unregistered driver names are rejected before the settings write.

Writes deliberately go through the custom RPC rather than the web settings
API (`api.settings.update`): DSH gates the latter behind a hardcoded
namespace allowlist (`WEB_SETTINGS_NAMESPACES` in `dsh-host-apiproxy`) that
a plugin cannot extend, and a rejected write surfaces as
`settings-not-exposed`. The `setDefaultDriver` RPC calls the settings
SERVICE directly, which accepts any registered namespace.

Behavioral notes:

- Changing the row affects NEW sessions only; existing sessions keep the
  driver they were created with across restarts (it is recorded in the
  session log; DSH locks everything after the first turn anyway).
- The driver is bound at the exact moment the blank session is created
  (clicking "新建会话" with the current default). Switching the row after
  that moment does not affect the already-created blank session. **This is
  NOT stably reproducible**: it only happens when a stale blank session
  happens to exist and the UI reuses it (the new-session screen disappears
  into that session), so the first session after a switch may or may not
  use the new driver. Switch the row FIRST, then click "新建会话"; if the
  first session still uses the old driver, close the stale blank session
  and create again.

### Client-bundle packaging (what it takes for the row to appear)

The row lives in a client bundle (`client.js`) that DSH's web frontend loads
only when the package is wired up exactly so:

1. `package.json` declares `dsh.client` (`platform: "web"` + inject list)
   and exports `./client` AND `./package.json` (Node's exports encapsulation
   blocks `require.resolve('<pkg>/package.json')` otherwise, which is how
   the client-modules scan finds the bundle).
2. The bundle's OWN `exports.inject` is a list of **cordis service names**
   (`["slots", "locale", "connection"]`) — NOT package ids. The manifest
   inject (package ids) comes from `dsh.client.inject`; the bundle inject
   is the service deps the fiber waits for, and package ids there leave the
   entry pending forever (`web boot: did not activate`).
3. Locale dictionaries are registered with
   `ctx.effect(() => ctx.locale.register(key, { zh, en }))` — `bind` does
   not feed the slot's `t` prop, leaving literal keys on screen.
4. Local-checkout installs: the client-modules scan resolves the package
   from the GLOBAL `dsh` install (`createRequire(ctx.baseUrl)`), so a
   path-linked plugin must also be reachable there. Create the junction
   once (recreate it after a `dsh` upgrade):

   ```sh
   mklink /J "%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\dsh-loop-dock" "<absolute-path-to-this-checkout>"
   ```

## Declarative multi-agent use

To start two agents with different models and loops at boot, add a patch to
the web profile (`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- id: agent-loop-dock
  config:
    defaultLoop: standard
    presetLoops:
      standard: standard
## Basic use: one agent per session, select the loop by preset

The dock ships one official strategy slot and maps every shipped official DSH
preset id to it:

| Loop slot | DSH preset | Meaning |
| --- | --- | --- |
| `standard` | `standard` / `minimal` / `code` / `cordis` | every shipped official mode runs the headless official loop |

Create a session and choose any shipped preset. Behind the scenes the dock
records the resolved loop for the agent:

```text
session 1: preset standard  -> loop standard
session 2: preset code      -> loop standard
```

Community presets are deliberately not baked into the plugin. A preset author
registers the corresponding loop through `ctx.agentLoopDock.register(...)` and
adds a `presetLoops` mapping, so the dock itself stays preset-neutral.
    agents:
      - id: planner
        provider: provider-a
        model: model-a
        loop: standard
        sessionId: planner-session
        reasoningEffort: max

```

Important: this patch must restate every key you want for the row, because a
DSH patch replaces the row's whole config rather than merging it. A complete
agent-list example lives in
[../examples/agents.example.yml](../examples/agents.example.yml).

## Two-layer routing

Named drivers allow a driver × strategy matrix in one dock:

```js
dock.registerDriver('loop1', driver1)
dock.registerDriver('loop2', driver2)

dock.register({ id: 'strategy1', kind: 'strategy', setup: s1 })
dock.register({ id: 'strategy2', kind: 'strategy', setup: s2 })
dock.register({ id: 'strategy3', kind: 'strategy', setup: s3 })
dock.register({ id: 'strategy4', kind: 'strategy', setup: s4 })
```

At creation time, both dimensions are independent:

```js
await ctx.agents.create({ sessionId: 'a1', loop: 'strategy1', driver: 'loop1' })
await ctx.agents.create({ sessionId: 'a2', loop: 'strategy2', driver: 'loop1' })
await ctx.agents.create({ sessionId: 'a3', loop: 'strategy3', driver: 'loop2' })
await ctx.agents.create({ sessionId: 'a4', loop: 'strategy4', driver: 'loop2' })
```

A strategy may also declare a default driver binding:

```js
dock.register({ id: 'strategy3', kind: 'strategy', driver: 'loop2', setup: s3 })
```

An explicit runtime `driver` overrides the strategy's declared binding.
Declarative agents support the same field:

```yaml
agents:
  - id: agent1
    loop: strategy1
    driver: loop1
```

## Programmatic use

Any plugin can access the dock service and create an agent on a chosen loop:

```js
const handle = await ctx.agents.create({
  sessionId: 'agent-1',
  agentOptions: { provider: 'provider-a', model: 'model-a' },
  loop: 'standard',
})
```

Loop authors register new slots through `ctx.agentLoopDock.register(...)`;
see [loop-provider-spec.md](./loop-provider-spec.md).

## Selection precedence

Create:

```text
loop:   options.loop > sessionLoops.loop > presetLoops.loop > defaultLoop
driver: options.driver > sessionLoops.driver > presetLoops.driver
        > strategy.driver > defaultDriver
```

Resume:

```text
recorded agentLoopDock binding (loop + driver, from creation)
  > mapped SessionHeader.agentPreset (presetLoops)
  > sessionLoops route
  > defaults
```

An explicit or routed choice that conflicts with the recorded binding throws
`LOOP_SWITCH`.

> Loop routing is persisted through the KNOWN `agent-preset/selected` event
> under `data.agentLoopDock` — not through a custom event type. DSH's
> persistence read path rejects unknown event types unless they are marked
> `ignorable`, and `Session.append` cannot mark one, so the dock stores its
> binding on an event DSH already knows. Sessions created with a `loop` but
> no preset resume on that recorded loop; sessions without a binding record
> fall back to the mapped `agentPreset` header.

## Verify loop routing

Open a session and check the newest `agent-preset/selected` event carries
`data.agentLoopDock` with the expected `loop`/`driver`, or resume it after a
restart and confirm the agent resumes on that recorded loop and driver.

## Current limits

- The Web UI has no separate loop picker yet; loops are selected through the
  existing preset picker or through configuration/programmatic callers.
- **Use the Settings → Agent presets row, or the new-session hero chip —
  both now switch the model route.** The settings row writes
  `agent-presets.default`, resolved at session **creation**
  (`meta.agentPreset`). The hero chip **stages** a preset and applies it to
  the blank session via `agent-preset/select` → `presets.recompose`: the
  preset composition swaps AND the pinned model route follows, because the
  dock re-evaluates the mapped loop's pin against the session's live
  effective preset on every request (`routeFollowSetup`). For non-pinned
  loops, the model route is whatever the web model-selection flow installed;
  the dock only rewrites it when the effective preset maps to a pinned loop.
  The loop identity (driver/strategy) stays fixed at creation, and a
  switched-in loop's prompt marker only appears if the session was created
  on that loop.
  DSH locks the preset once the session starts (`agent-preset-locked` after
  the first `turn/start`), so all of the above happens in the blank window
  before the first message — no mid-conversation preset or loop switching
  exists, on either layer.
- Subagents inherit their parent's preset, and therefore the mapped loop, via
  the existing DSH composition path.
- Loop/driver routing across restarts rides the recorded
  `agent-preset/selected` `data.agentLoopDock` binding. The preset
  COMPOSITION still follows DSH's resolution (newest blank-session
  `agent-preset/selected` wins over the frozen header); the dock's recorded
  loop/driver binding is creation identity and is not overwritten by a later
  blank-session preset switch. Sessions without a binding record fall back to
  `presetLoops`, and callers can always re-supply `loop`/`driver` or use a
  `sessionLoops` route.
