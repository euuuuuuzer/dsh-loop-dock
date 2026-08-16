# Vendored headless official agent loop

This directory contains a derivative of the compiled
`@deepseek-ai/dsh-agent-loop@0.1.0-rc.6` `lib/index.js` distributed with the
DeepSeek Harness npm package.

## Upstream

- Package: `@deepseek-ai/dsh-agent-loop`
- Version: `0.1.0-rc.6`
- Repository: <https://github.com/deepseek-ai/deepseek-harness>
- Upstream license: MIT, Copyright (c) 2026 DeepSeek
  (see [LICENSE.upstream.txt](./LICENSE.upstream.txt))

## Modifications

The transformation is reproducible with:

```sh
node scripts/vendor-headless-loop.mjs <path-to-dsh-agent-loop/lib/index.js>
```

Local modifications:

1. Removed the Cordis `Service` base and `agentLoop` service registration.
2. Removed `ctx.agents.setFactory(this)` self-registration.
3. Removed the `installSettingsSection(...)` registration.
4. Removed the global `provider` / `model` / `cwd` prompt-variable
   registrations (the dock owns them once).
5. Removed declarative-agent auto-start.
6. Exported the same class as `HeadlessAgentLoop` (also still `default`).
7. Replaced the tool scheduler's `ctx.agentLoop.config` read (the service was
   removed in 1) with a `maxParallelToolCalls` value threaded from the
   instance config through `prepare` → `ReactLoopAgent` →
   `executeToolCalls` → `runGroup`. Without this, the first turn whose model
   returns a tool call crashes with
   `cannot get property "agentLoop" without inject`.

The turn/step driver, session handling, tool scheduling, request assembly,
resume logic, and lifecycle ownership are unchanged.

## Why this exists

DSH's official loop is the only shipped driver and its driver internals are
package-private. The dock needs the driver without its single-factory
self-registration, so this vendored derivative is the default driver.
