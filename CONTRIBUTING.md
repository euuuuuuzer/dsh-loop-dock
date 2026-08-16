# Contributing

This project is in pre-alpha. Contributions are welcome in three areas:

1. **Loop providers** — especially model-specific strategy loops. Start from
   [docs/loop-provider-spec.md](./docs/loop-provider-spec.md).
2. **The default driver adapter** — maintenance and re-vendoring of the
   headless derivative of `@deepseek-ai/dsh-agent-loop` described in
   [docs/default-driver.md](./docs/default-driver.md). Licensing and
   attribution requirements are non-negotiable.
3. **Dock core** — registry, selection, persistence, tests, and future Core
   compatibility.

## Rules

- Keep the core dependency-free; use Node's built-in test runner.
- Every public routing behavior gets a unit test.
- Do not modify loop internals in the dock core.
- Never claim official affiliation. Attribution rules live in [NOTICE](./NOTICE).
- DSH is a developer preview; state the tested DSH version in any real-loop
  result.

## Before a PR

```sh
npm run check
node examples/fake-two-loop.mjs
node examples/fake-two-driver-loops.mjs
npm pack --pack-destination /tmp
bash scripts/smoke-portable.sh /tmp/dsh-loop-dock-0.1.0.tgz
```
