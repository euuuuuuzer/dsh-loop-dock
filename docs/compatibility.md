# DSH compatibility

Status for DSH `0.1.0-rc.6` and the multi-agent paths that create agents.

## Supported creation paths

| Path | How it reaches the dock | Loop selection source | Status |
| --- | --- | --- | --- |
| DSH Web session create/resume | `ctx.agents.create/resume` with preset setup | recorded `agentLoopDock` binding, then `meta.agentPreset` mapped through `presetLoops` | implemented |
| Declarative `agent-loop-dock.agents` | dock calls `ctx.agents.create/resume` | `agents[].loop` / `agents[].driver` | implemented |
| Programmatic plugin callers | `ctx.agents.create/resume` | `options.loop` / `options.driver` | implemented |
| `subagent` / `subagent_fork` | `ctx.agents.create` | child `meta.agentPreset` from parent | transparent, setup order verified |
| `workflow` / `ralph` spawned children | `ctx.agents.create` through their providers | child `meta.agentPreset` when present | expected transparent; live E2E pending |
| Natural-language team creation from chat | does not exist yet | would need a new model-facing tool | not implemented |

## Important integration rule

DSH Web and in-process subagent providers already compose the preset through
the caller's `setup` before an agent is published. Dock strategy setups run
after that caller setup. Built-in preset loops check
`agentPresets.composedPreset(agentCtx)` and skip their own mount when a
composition already exists, so:

- Web-created sessions do not double-mount;
- subagents joining their parent preset do not double-mount;
- declarative dock agents with no caller setup still get the preset mounted.

This is covered by unit tests and should be re-verified against a live Web
profile before a release.

## Live E2E checklist before publishing

- [ ] Install `dsh-loop-dock` into the Web profile and restart.
- [ ] Create two sessions: one shipped preset mapped to `standard`, and one
      user-registered loop mapped through `presetLoops`.
- [ ] Restart DSH and confirm each session resumes on its recorded loop and
      driver (`agent-preset/selected` `data.agentLoopDock`; fallback for
      unrecorded sessions is `SessionHeader.agentPreset` → `presetLoops`).
- [ ] From one session, call `subagent` and verify the child is created
      without a preset double-mount error.
- [ ] Test `subagent_fork`.
- [ ] Test `workflow` / `ralph` if those tools are enabled by the preset.
- [ ] Restart DSH and verify configured declarative agents resume their
      persisted sessions and loops.
