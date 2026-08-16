# dsh-loop-dock

> 一个 Harness，多个 Agent Loop。

`dsh-loop-dock` 是 DeepSeek Harness（DSH）的社区基础设施插件。它不设计任何
新的 Agent Loop，只提供让多个 Loop provider 同时存在、并让不同 Agent 选择
不同 Loop 的“拓展坞”。

[English](./README.md)

## 概述

dsh-loop-dock 是 DeepSeek Harness 的多 Agent Loop 拓展坞。它把原本唯一的 AgentFactory 槽位扩展为多 loop 的注册、选择、绑定和委托，让不同 Agent 既能使用最适合自己的模型，也能绑定一个能把该模型潜力发挥完全的专属核心 Agent Loop——不是 preset，也不是策略外壳，而是核心循环本身。目前已实现默认 headless driver、官方 standard 策略槽、Web 默认驱动设置和会话级 loop + driver 持久化，并内置 fake-driver：一个不联网、不调用真实模型的本地调试驱动，固定返回 [FAKE-DRIVER]，用于验证路由和重启恢复。项目本身只是抛砖引玉——dock 只负责接口，真正有价值的是社区未来写出更多优秀的核心 Agent Loop。

## 术语表

本项目采用 DeepSeek Harness 自己的词汇（官方 `@deepseek-ai/dsh-agent-loop`
从不使用 "engine"，官方口径是 "agent factory and driver service"）：

| 我们用词 | 含义 | 社区 / 官方常用说法 |
| --- | --- | --- |
| **driver（驱动）** | 实现 `createAgent`/`resume` 契约并驱动回合的核心 agent loop（`HeadlessAgentLoop` 就是 vendor 的官方驱动）。 | 官方 DSH：*agent loop* / *driver*（"agent factory and driver service"）。其他 harness 常叫 *engine*（如 Codex engine）——DSH 不用这个词。 |
| **loop（loop 条目）** | agent 实际运行的**完整 loop**，注册在 `LoopRegistry` 里：**策略 loop**（复用驱动 + 装 agent 作用域 setup）或 **驱动 loop**（`kind: 'driver'`，一套完整自定义驱动）。`loop` 是整个循环，`driver` 只是其中的引擎层。 | 社区常说的 *agent loop*。不要把引擎层叫成 loop。 |
| **strategy loop（策略 loop）** | 复用某个驱动，只安装 agent 作用域的 setup（挂载 preset、添加 hook）。这是常见用法。 | 大致相当于：在一个引擎之上叠加 preset/profile 和适配器。 |
| **driver loop（驱动 loop）** | 本身就是一套完整驱动（`createAgent`/`resume`），用于与默认驱动不同的控制流。 | 大致相当于：完整的 engine 实现。 |
| **preset** | DSH 的会话组合（工具 + 提示词段），由原生选择器选定。 | 官方 DSH：*preset*。注意：日常对话里 "preset" 有时被误当成 loop——我们一律指"工具/提示词组合"。 |
| **model route（模型路由）** | 会话请求所用的 provider/model（+ reasoningEffort）。 | 社区：model config / 模型选择。 |
| **AgentFactory** | `createAgent`/`resume` 契约（`ctx.agents.setFactory` 委托的目标）。 | 官方 DSH：*AgentFactory*。 |
| **harness** | 整个 agent 运行平台（DSH 本身、Codex 等）。 | 生态通用词。 |
| **binding（绑定）** | dock 在创建会话时记录的持久化 `{ loop, driver? }` 选择（`agent-preset/selected` 事件的 `data.agentLoopDock`）。 | 记录下来的选择 / 路由绑定。 |

这些概念的关系如下：**preset** 定义工具和提示词段，**driver** 执行回合，**loop** 是 agent 实际运行的完整循环（策略 loop = driver + setup；驱动 loop = 一套完整自定义 driver），**model route** 决定由哪个 LLM 回答。会话选择 preset → dock 推导 loop → loop（或设置行）选择 driver → 请求使用 model route。


## 为什么做

DSH 已经让 Agent Loop 成为可替换插件：具体 Loop 通过唯一的 `AgentFactory`
向 `ctx.agents` 注册。但目前这个接缝是单槽的：

```
Agent A ─┐
Agent B ─┼──> Loop X
Agent C ─┘
```

本项目探索的是“复数”：

```
Agent A ──> Loop X
Agent B ──> Loop Y
Agent C ──> Loop Z
```

dock 不理解任何 Loop 的内部逻辑，它只负责：注册、选择、绑定、委托。

### 只改 preset，能力已经变化很大

社区插件已经证明，围绕官方 loop 做一点“外围处理”——例如先用最小工具集、
第一次工具调用后再展开完整工具集的 preset，或者添加一段提示词和一个
bootstrap hook——就能让同一个模型表现出明显不同的能力。在 DeepSeek 上这一
点尤其明显，因为 DSH 正好把这些接缝暴露了出来，而 DeepSeek 对工具与提示词
纪律也格外敏感。

这就引出了本项目真正想问的问题：如果只是改一个 loop 外面的 preset 和 setup
就能解锁这么多能力，那把整个 loop 换掉会怎样？dock 不负责回答这个问题，它
只负责让这个问题变得可以低成本地实验。

## 当前状态

**Pre-alpha 但已可运行：路由核心、vendor 的 headless 官方驱动、内置的官方
`standard` 策略槽已经一起实现并通过集成测试。**

| 部分 | 状态 |
| --- | --- |
| Named Loop Registry | ✅ 已实现 |
| Agent → Loop 路由 | ✅ 已实现 |
| 持久化 Loop + driver 选择（已知事件 binding，preset 回退） | ✅ 已实现 |
| 策略型 / 驱动型两种 Loop-provider 协议 | ✅ 已实现 |
| `standard` 策略槽 | ✅ 已注册 |
| 本地无模型 ping 适配器（`loop-ping`） | ✅ 已实现 |
| Effective-preset 模型路由跟随（hero-chip 切换） | ✅ 已实现 |
| 双驱动测试用假驱动（`fakeDriver: true`） | ✅ 已实现 |
| Web Settings「默认驱动」行（`agentLoops` Remote + `client.js`） | ✅ 已实现 |
| Headless 默认驱动（官方 loop 衍生） | ✅ 已 vendor，见 [docs/default-driver.md](./docs/default-driver.md) |
| 双 Agent 真实驱动集成测试 | ✅ 通过 |
| Core `SessionHeader.agentFactory` 字段 | ❌ 留待上游演进 |

路线见 [docs/architecture.md](./docs/architecture.md)；最初的动机与设计笔记见
[DESIGN.md](./DESIGN.md)。

## 模型

```text
ctx.agents.create / resume
        |
   dsh-loop-dock（唯一的 AgentFactory）
        |
        +-- LoopRegistry（插槽）
        |     +-- standard           （策略：standard preset）
        |     +-- community-loop      （用户注册的社区 loop）
        |     +-- ...                （你的 Loop）
        |
        +-- selection
        |     显式选项 > session 路由 > preset 路由 > 默认
        |
        +-- default driver
              +-- HeadlessDriver（vendor 的官方 loop 衍生）
```

**Strategy Loop** 复用某个驱动，只安装 per-agent setup。它可以声明首选
驱动 `driver: 'loop2'`，也可以把驱动选择留给调用方。创建 Agent 时
`loop` 和 `driver` 是两个独立维度：

```js
ctx.agents.create({ sessionId: 'a1', loop: 'strategy1', driver: 'loop1' })
ctx.agents.create({ sessionId: 'a3', loop: 'strategy3', driver: 'loop2' })
```

因此一个 dock 支持任意 driver × strategy 组合。大多数“模型专属 Loop”
本质是策略型 Loop，作者不需要实现 turn/step 控制流。

**Driver Loop** 拥有完整 `createAgent` / `resume` 契约，用于真正需要不同
控制流的 Loop。

## 安装

发布前从本地 checkout 安装：

```sh
cd /path/to/workspace
dsh plugin --profile web add ./dsh-loop-dock
```

完整使用说明见 [docs/usage.md](./docs/usage.md)，DSH 多智能体兼容矩阵见
[docs/compatibility.md](./docs/compatibility.md)。

本包声明 `dsh.bundle.patch = cordis.patch.yml`，会自动禁用官方
`agent-loop` row 并插入 `agent-loop-dock`：

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

> 在适配器正式支持“让出 `setFactory`”之前，不要把 Dock 与官方
> `dsh-agent-loop` row 同时挂载。

## 声明式 Agent 配置

dock 接受官方 AgentLoop 的 agent 列表，并增加 `loop` 与可选 `driver`
字段：

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

`loop` 可省略；省略时依次回退到 session 路由、preset 路由、`defaultLoop`。
`driver` 可省略；依次回退到路由值、策略声明的驱动、`defaultDriver`。
`provider`、`model`、`maxTokens`、`reasoningEffort`、`cwd` 会透传给驱动
和策略 setup；具体哪些字段被驱动应用，以驱动适配器文档为准。完整的 YAML
形状见 [examples/agents.example.yml](./examples/agents.example.yml)。

### 模型路由与 Loop 路由是两套坐标

Dock 负责：

```text
Loop 路由：loop + driver
```

模型路由仍由 DSH 负责，dock 默认只透传，除非某个（程序化注册的）loop
声明了 `provider`/`model` 固定（例如 `loop-ping` 调试适配器），此时覆盖
调用方的选择：

```text
模型路由：provider + model（+ maxTokens + reasoningEffort）
```

因此一个四 Agent 团队可以在同一处配置：

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

### 能不能直接在 DSH Web 对话里说“创建 4 个 Agent”？

目前还不能。Dock 还没有注册面向模型的“创建 Agent 团队”工具。当前支持
的创建路径是：

1. 上面的声明式 `agents` 配置；
2. 程序化调用 `ctx.agents.create({ agentOptions, loop, driver })`；
3. 在 DSH Web 里手动创建 session：模型选择器决定模型，preset 选择器决定
   映射后的 Loop。

内置 subagent 会继承父 preset，DSH 的 subagent 工具 schema 也没有暴露
`loop` / `driver` 字段。基于本 dock 做一个自然语言建队工具是合理的下一个
插件，但目前尚未实现。

## Loop-provider 协议

详见 [docs/loop-provider-spec.md](./docs/loop-provider-spec.md)。

Strategy Loop（常见用法）：

```js
dock.register({
  id: 'community-loop',
  kind: 'strategy',
  description: '社区维护的某个模型首轮工具 bootstrap',
  async setup(agentCtx) {
    // 挂载 preset、注册 prompt section、限制工具、安装事件 hook
  },
})
```

Driver Loop（自定义控制流）：

```js
dock.register({
  id: 'planner-executor',
  kind: 'driver',
  async createAgent(ownerCtx, options) { /* ... */ },
  async resume(ownerCtx, options) { /* ... */ },
})
```

默认驱动只注册一次：

```js
dock.registerDriver(headlessOfficialDriver)
```

## 选择优先级

创建：

```text
loop:   options.loop > sessionLoops 路由 > presetLoops 路由 > defaultLoop
driver: options.driver > 路由 driver > preset driver
        > strategy.driver > settings defaultDriver > config defaultDriver
```

恢复：

- 创建时记录在 `agent-preset/selected` 事件 `data.agentLoopDock` 里的持久
  binding（`loop`，以及创建时解析出的 `driver`）；
- 没有该记录的会话，回退到持久化的 `SessionHeader.agentPreset` 经
  `presetLoops` 映射；
- 精确的 `sessionLoops` 路由；
- 显式或路由选择若与记录/映射后的 binding 不一致，抛 `LOOP_SWITCH`，与
  DSH“只有空 session 才能切换 preset”的规则保持一致。

> 该 dock 通过 DSH **已知**的 `agent-preset/selected` 事件持久化 binding，
> 不再写自定义事件类型。DSH 的持久化读取路径会拒绝已知事件集之外且未标记
> `ignorable` 的事件，而 `Session.append` 没有公开方式标记它；因此 binding
> 放在 `data.agentLoopDock` 中，并在同一事件里保留会话当前生效的 preset，
> DSH 对会话的读取方式完全不变。

## 开发

```sh
npm test
node examples/fake-two-loop.mjs
node examples/fake-two-driver-loops.mjs
npm pack --pack-destination /tmp
bash scripts/smoke-portable.sh /tmp/dsh-loop-dock-0.1.0.tgz
```

常规测试会跳过真实 API 测试。需要 DeepSeek API key 时手动开启：

```sh
DSH_LOOP_DOCK_LIVE_API=1 \
DEEPSEEK_API_KEY=... \
DSH_LOOP_DOCK_LIVE_MODEL=deepseek-chat \
node --test test/live-api-2x2.test.mjs
```

该测试会真实调用 4 次模型，覆盖 2×2 矩阵：两个 headless 驱动 × 两个策略。

`fake-two-loop.mjs` 证明两个策略型 loop 可以共用同一个假驱动。
`fake-two-driver-loops.mjs` 证明两个完全独立的假驱动 loop 可以在同一个
dock 中共存——不需要写任何真实 loop，也能证明项目的核心能力。

路由核心（`src/hub.mjs`、`src/selection.mjs`、`src/registry.mjs`、
`src/config.mjs`、`src/errors.mjs`、`src/provider.mjs`）零运行时依赖。插件
入口面向 DSH `0.1.0-rc.6` peers，并通过 `ctx.inject`、`ctx.effect`、
`ctx.provide`、`ctx.agents.setFactory`、`ctx.llm.registerAdapter`、
`ctx.systemPrompt.variable` 访问宿主服务；agent 创建/恢复只走文档化的
AgentFactory 契约。

## 许可与声明

MIT。仓库中 vendor 的官方 loop 衍生已保留上游 MIT 声明并列出全部修改，
见 [NOTICE](./NOTICE) 与 `vendor/dsh-agent-loop-headless/`。

这是社区项目，不是 DeepSeek 官方项目。

## 抛砖引玉：路由是简单的部分，agent loop 才是难的部分

路由是简单的部分。这个 dock 刻意做得很小、很无趣——注册、选择、绑定、
委托——任何一个合格的插件作者都能用一个周末写出来。

难的那部分，也是这个项目存在的原因，是**目前还没有人写出第二个 agent
loop**。DSH 把 Agent Loop 做成了插件——我认为目前 DSH 是唯一有这份野心
的 harness——但那个插槽一直空着。这个项目就是一个拓展坞：一个能跑通的
dock，证明这个接缝是真实的。

我认为 DSH 是最容易把**模型 × harness 能力**发挥到极致的 harness：一个
模型的天花板不只是模型本身，而是"被正确的回合结构、预算与工具纪律驱动"
的模型。举个极端一点的例子：GPT-5.6 Sol 与 GPT-5.6 Luna 共用同一套
Codex 的 loop，也不太可能同时满血；无论是 GLM-5.3、Kimi K3，还是
GPT-5.6 都值得各自专属的 DSH loop，就像 deepseek-v4-pro 级别的模型值得
为它塑形的 loop。这个项目指向的未来是多智能体——每个智能体都能选择最
适合它的模型，以及最适合那个模型的 agent loop：一个 agent、一个模型、
一个模型专属 loop——而 DSH 是让"模型 × harness"矩阵可以自由重组的平台。

我个人认为 DSH 明显是想要往这个方向做的，但这需要极长的时间和极大的
工作量，我认为只有社区的力量才能做到这一点。
