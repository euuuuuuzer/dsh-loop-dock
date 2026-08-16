# FAQ

## What is the difference between preset, loop, and driver?

- **preset** defines the tools and prompt sections an agent has.
- **driver** is the engine that implements `createAgent`, `resume`, and turn control flow.
- **loop** is the complete loop an agent runs: a strategy loop (driver + setup) or a driver loop (a full custom driver).

## Does dsh-loop-dock conflict with the official `dsh-agent-loop`?

The dock replaces the official row in the bundle patch and owns the single `AgentFactory` slot. Do not install the official `agent-loop` row in the same profile. The vendored headless derivative of the official loop is used as the default driver.

## Why not modify the official loop directly?

You can. A driver loop is the option for genuinely different control flow. A strategy loop is the lighter path when a preset, hook, or tool policy is enough.

## What is fake-driver?

`fake-driver` is a local debug driver registered by default next to `default`. It never calls a real model or the network. It always replies with `[FAKE-DRIVER]`, which makes loop/driver routing and restart persistence easy to verify without an API key.

## Can I create a multi-agent team by typing in the web chat?

Not yet. The dock currently supports declarative `agents`, programmatic `ctx.agents.create(...)`, and manual DSH Web sessions. A model-facing team-creation tool is a natural next plugin, but is not implemented here.

## Does routing survive a restart?

Yes. The creation-time `loop + driver` binding is recorded on the known `agent-preset/selected` session event under `data.agentLoopDock`. Resume reads that binding before falling back to `presetLoops`.

## Do loop authors have to implement a full driver?

No. Most loops are strategy loops: implement `setup(agentCtx)` and reuse an existing driver. A full driver loop is only needed when the turn/step control flow itself must change.
