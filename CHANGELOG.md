# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - Unreleased

### Fixed

- Driver selection is durable across restarts without a bricking custom event:
  the dock records `agent-preset/selected` `data.agentLoopDock` (a KNOWN DSH
  event) while the agent setup runs, preserving the session's effective
  preset. Resume reads that record first and falls back to `presetLoops` for
  sessions created before the record existed.
- `scripts/vendor-headless-loop.mjs` now reproduces the checked-in
  `maxParallelToolCalls` threading exactly; regeneration no longer reintroduces
  the removed `ctx.agentLoop.config` read.
- The fake driver now installs its `agent/request` route pin after the dock
  and caller setups, so it truly stays outermost and wins over a loop-pinned
  model route.
- Added the root `client.js` to the npm `files` allowlist and declared the
  direct `@deepseek-ai/dsh-typert-protocol` peer dependency.
- CI now installs dependencies and runs the renamed
  `fake-two-driver-loops.mjs` example.
- Declarative-agent config rejects duplicate exact session identities, matching
  the official loop.
- Invalid driver names now throw `INVALID_DRIVER` instead of reusing the loop
  id error.
- `scripts/check-syntax.mjs` also checks root `client.js` and `test/`.
- Added `scripts/smoke-portable.sh`: installs a built tarball into a
  throwaway `DSH_HOME`, boots DSH Web, fetches the client bundle, and
  exercises `agentLoops/listDrivers` + `setDefaultDriver` over real RPC.
- The bundled patch now enables `fakeDriver: true` by default; the effective
  default driver remains `default`, and clean installs immediately show both
  `default` and `fake-driver` in the Settings row.
- Removed the last built-in community preset slot and its mapping. The
  dock now ships only the official `standard` baseline slot; community presets
  stay user-registered, keeping the project preset-neutral.

### Changed

- Removed the built-in `router-flash` slot and its third-party preset
  reference plus
  `docs/third-party-loops.md` — community loops are registered by the user
  via the registry (`dock.register`), not baked into the plugin. The dock
  core stays dependency-free; the repository ships only the two built-in
  strategy slot (`standard`) for the shipped official presets.

- Removed the binding machinery: `scripts/bind-loop.mjs` and `config.loops`
  (declarative custom loops with `prompt`/`provider`/`model`/`driver`
  fields) are gone. Custom loops selectable from the web UI are the preset
  author's job — DSH's native picker already lists every real preset, and
  the dock's single built-in `standard` loop covers the shipped official
  presets. Loop-level model/driver pins remain available for
  loops registered programmatically (`dock.register(...)`), and the
  route-follow feature (pin re-evaluated per request against the effective
  preset) is unchanged. Driver switching lives in the Settings row
  (`agent-loops.defaultDriver`).

- Terminology normalized to DeepSeek Harness's official vocabulary: the
  official `@deepseek-ai/dsh-agent-loop` never uses "engine" — it speaks of
  the "agent factory and driver service". The dock now says **driver**
  everywhere: `registerDriver`/`listDrivers`, config and settings
  `defaultDriver`, the named driver `fake-driver`,
  `kind: 'driver'` (driver loops), Remote `setDefaultDriver`, the Settings
  row "默认驱动 / Default driver", `fakeDriver: true`, and files
  `default-driver.mjs`, `headless-driver-plugin.mjs`, `fake-driver.mjs`,
  `driver-settings.mjs`. See the Terminology table in README.md.

## [0.1.0] - Unreleased

### Added

- Project scaffold and name: `dsh-loop-dock`.
- `LoopRegistry` with named strategy/driver provider validation.
- `LoopDock` AgentFactory delegation and driver wiring.
- Create/resume selection precedence; loop/driver routing across restarts
  rides the known `agent-preset/selected` `data.agentLoopDock` binding (the
  original custom `agent-loop/selected` event was dropped — DSH persistence
  refuses a log containing unknown event types, which permanently bricked
  every session the dock touched).
- Built-in `standard` strategy slot.


- Local no-model LLM adapter (`src/ping-adapter.mjs`) registered as provider
  `loop-ping`: pinned debug loops answer with a fixed local reply and never
  call a real model or the network. The reply text is deployment-configurable
  via `config.pingReply` (repository default is neutral).
- Effective-preset model-route following (`routeFollowSetup` in
  `src/hub.mjs`): the mapped loop's `provider`/`model` pin is re-evaluated on
  every request against the session's live `composedPreset`, so switching a
  blank session's preset — via the Settings row OR the new-session hero chip
  (`agent-preset/select` → `recompose`) — switches the model route without
  recreating the agent. A stale pin persisted in the request header is
  released to the agent's creation-time route when no pin applies.
- Built-in mode routing: every shipped preset (`standard`, `minimal`, `code`,
  `cordis`) maps to the headless official driver by default via the bundled
  `presetLoops` mapping.
- Fake driver (`src/fake-driver.mjs`): a second named driver registered when
  the default-driver row sets `fakeDriver: true`. It wraps the headless
  driver and forces its own local `driver-ping` route (`[FAKE-DRIVER]`
  marker), making dual-driver routing verifiable end to end — same preset
  family, different driver, different observable behavior.
- Web driver picker: the dock registers an `agent-loops` settings namespace
  (`defaultDriver`) and an `agentLoops` Typert Remote service
  (`listDrivers` + `setDefaultDriver`); a client bundle (`client.js`,
  declared via `dsh.client`) renders a "Default driver" row in Settings →
  General. The settings value feeds the driver resolution chain for new
  sessions (`explicit > route > loop.driver > settings > config`).
  Writes go through `setDefaultDriver` (settings service) instead of the
  web settings API, which DSH gates behind a hardcoded namespace allowlist
  (`settings-not-exposed`). The bundle follows DSH's client-packaging rules:
  `exports.inject` carries cordis SERVICE names (package ids leave the
  entry pending forever), locale uses `ctx.locale.register` inside
  `ctx.effect`, and the package exports `./package.json` so the
  client-modules scan can resolve it from the global `dsh` install (a
  junction is required for path-linked local checkouts).
- Driver default is read live at session creation — the driver binds at the
  exact moment the blank session is created (clicking "新建会话"). A stale
  result is POSSIBLE but not stably reproducible: it only occurs when the UI
  reuses an existing blank session (driver fixed at ITS creation), which it
  does intermittently. Switch the Settings row first, then create; close a
  stale blank session if the first new session still uses the old driver.
- Headless driver adapter factory (`createHeadlessDriverAdapter`).
- Vendored headless derivative of `@deepseek-ai/dsh-agent-loop@0.1.0-rc.6`
  with upstream MIT license and modification list. Includes a fix that
  threads `maxParallelToolCalls` from the instance config into the tool
  scheduler instead of reading the removed `ctx.agentLoop` service — without
  it, the first turn whose model returns a tool call crashed with
  `cannot get property "agentLoop" without inject`.
- `agent-loop-dock-default-driver` bundle row that registers the headless
  driver automatically.
- Real-driver integration test: two agents, two strategy loops, one process,
  plus one real model turn through a mock adapter, plus a full tool-call turn
  (tool/call + tool/result) through the fixed scheduler.
- Strict dock-config validation in `src/config.mjs`.
- Named driver registry and runtime two-dimensional routing: `loop` and
  `driver` are independent create/resume options, route values, and durable
  binding fields. Includes a real two-headless-driver integration test.
- Dependency-aware declarative-agent queue: driver loops start without the
  default driver, strategy loops wait for their bound driver.
- Syntax-check script for all first-party JavaScript files.
- Usage guide in `docs/usage.md` and compatibility matrix in
  `docs/compatibility.md`.
- DSH Web/subagent preset double-mount fix: caller setup runs first and
  built-in preset strategies are idempotent.
- Declarative `sessionId` restore-or-create behavior matching the official
  loop.
- Opt-in live API 2×2 test (`test/live-api-2x2.test.mjs`) that makes four real
  DeepSeek API calls across two headless drivers and two strategies.
- Strict rejection of `driver` options on full driver loops and strict driver
  name validation.
- Zero-dependency unit tests, `examples/fake-two-loop.mjs`, and
  `examples/fake-two-driver-loops.mjs`.
- Bundle patch that disables the official `agent-loop` row.
