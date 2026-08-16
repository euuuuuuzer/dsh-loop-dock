# 常见问题

## preset、loop、driver 有什么区别？

- **preset** 定义 Agent 拥有的工具和提示词段。
- **driver** 是实现 `createAgent`、`resume` 和回合控制流的引擎。
- **loop** 是 Agent 实际运行的完整循环：策略 loop（driver + setup）或驱动 loop（一套完整自定义 driver）。

## dsh-loop-dock 会和官方 `dsh-agent-loop` 冲突吗？

bundle patch 会禁用官方 `agent-loop` 行，并由 dock 持有唯一的 `AgentFactory` 槽位。不要在同一个 profile 里同时安装官方 `agent-loop` 行。官方 loop 的 headless 衍生版本作为默认 driver 使用。

## 为什么不直接修改官方 loop？

可以直接改。真正需要不同控制流时使用驱动 loop；只需要 preset、hook 或工具策略时，使用更轻量的策略 loop。

## fake-driver 是什么？

`fake-driver` 是默认注册在 `default` 旁边的本地调试驱动。它不调用真实模型，也不联网，固定返回 `[FAKE-DRIVER]`，方便在没有 API key 的情况下验证 loop/driver 路由和重启恢复。

## 能在 Web 聊天里直接创建多 Agent 团队吗？

暂时不能。目前支持声明式 `agents`、程序化 `ctx.agents.create(...)`，以及通过 DSH Web 手动创建会话。面向模型的团队创建工具适合作为下一个插件，但尚未在 dock 中实现。

## 重启后路由会丢失吗？

不会。创建时的 `loop + driver` 绑定会记录在已知的 `agent-preset/selected` 会话事件里，字段为 `data.agentLoopDock`。恢复会话时先读取该绑定，再回退到 `presetLoops`。

## loop 作者必须实现完整 driver 吗？

不需要。大多数 loop 是策略 loop：实现 `setup(agentCtx)` 并复用现有 driver。只有需要改变回合/步骤控制流本身时，才需要完整的驱动 loop。
