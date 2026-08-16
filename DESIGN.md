Heterogeneous Agent Loops for DeepSeek Harness

«One harness. Multiple agents. Different loops.»

> 本文是早期设计稿，保留原思路；当前实现与术语以 [README.md](./README.md)、
> [docs/architecture.md](./docs/architecture.md) 和
> [docs/loop-provider-spec.md](./docs/loop-provider-spec.md) 为准。

1. 项目目的

DeepSeek Harness（DSH）已经将 Agent 与具体 Agent Loop 实现进行了解耦，使 Agent Loop 具备可替换性。

但目前还有一个值得探索的问题：

«如果不同模型、不同 Agent 角色可能适合不同的 Agent Loop，为什么一个 Multi-Agent 系统中的所有 Agent 必须共享同一种 Loop？»

本项目希望探索 Heterogeneous Agent Loops（异构 Agent Loop）：

当前常见结构：

Agent A ─┐
Agent B ─┼──→ Agent Loop X
Agent C ─┘


希望实现：

Agent A ───→ Agent Loop X
Agent B ───→ Agent Loop Y
Agent C ───→ Agent Loop Z

本项目不试图设计一个更好的 Agent Loop。

它只希望提供一个接口或基础设施，使不同 Agent 能够选择不同的 Agent Loop，从而让社区能够进一步实验：

- 不同模型是否适合不同 Loop；
- 不同 Agent 角色是否适合不同 Loop；
- 不同任务是否适合不同 Loop；
- 异构 Loop 是否能够改善 Multi-Agent 系统。

项目的核心目标不是回答这些问题，而是：

«让这些问题变得可以被实验。»

---

2. Motivation

不同模型可能对 Harness / Agent Loop 结构表现出不同敏感性。

例如，一个模型可能适合：

LLM
 ↓
Large Toolset
 ↓
Tool Call
 ↓
LLM

另一个模型可能更适合：

LLM
 ↓
Minimal Toolset
 ↓
First Tool Call
 ↓
Standard Toolset
 ↓
LLM

如果这种差异真实存在，那么 Multi-Agent 系统中的：

Planner
Coder
Reviewer
Researcher

理论上没有必要强制共享同一个 Agent Loop。

更加自然的结构可能是：

Planner
  ↓
Planning-optimized Loop

Coder
  ↓
Coding-optimized Loop

Reviewer
  ↓
Verification-optimized Loop

Researcher
  ↓
Long-context Loop

甚至：

Agent A
Model A
Loop X

Agent B
Model B
Loop Y

Agent C
Model C
Loop Z

因此本项目提出一个非常简单的问题：

«Why should the agent loop be a harness-global choice rather than an agent-level choice?»

---

3. 项目不做什么

这是本项目非常重要的边界。

本项目 不负责：

- 设计新的 Agent Loop；
- 优化现有 Agent Loop；
- 判断哪个 Agent Loop 最优秀；
- 判断哪个模型应该使用哪个 Loop；
- 实现 Planner / Coder / Reviewer；
- 设计 Multi-Agent 消息协议；
- 设计 Agent 间通信；
- 设计共享 Memory；
- 设计任务分解；
- 设计 Multi-Agent Workflow；
- 自动根据模型选择 Loop；
- 自动根据任务选择 Loop。

这些问题都可以建立在本项目提供的能力之上，但不属于项目核心。

本项目只负责：

Register
   ↓
Select
   ↓
Bind
   ↓
Delegate

即：

«注册多个 Agent Loop provider，并允许不同 Agent 选择不同 provider。»

---

4. 核心设计原则

4.1 不修改 Agent Loop 内部逻辑

本项目原则上不应该关心一个 Loop 内部如何工作。

例如：

Loop A:

LLM → Tool → LLM → Tool


Loop B:

Planner → Executor → Critic


Loop C:

Minimal → First Tool Call → Standard

对于本项目而言，它们都应该只是：

AgentFactory / Agent Driver

项目只负责决定：

Agent A → Factory A
Agent B → Factory B

而不是 Factory A / B 内部如何实现。

---

4.2 Loop 的选择应该成为 Agent 属性

目标抽象：

Harness
   │
   ├── Agent A → Loop A
   │
   ├── Agent B → Loop B
   │
   └── Agent C → Loop C

而不是：

Harness
   │
   └── Loop A
        ├── Agent A
        ├── Agent B
        └── Agent C

从概念上说，本项目希望把：

Harness → Loop

的全局绑定关系进一步细化为：

Agent → Loop

---

5. 与 DSH 当前架构的关系

DSH 已经实现了非常重要的一步：

Agent contract 与具体 Agent Loop provider 已经分离。

因此当前架构已经具有：

«Replaceability»

即：

Loop A
  OR
Loop B
  OR
Loop C

本项目希望进一步探索：

«Multiplicity»

即：

Loop A
  +
Loop B
  +
Loop C

并允许：

Agent A → Loop A
Agent B → Loop B
Agent C → Loop C

因此，本项目并不是试图推翻 DSH 的 Agent Loop 插件化设计。

恰恰相反，它是在沿着相同的设计思想继续向前探索：

«从“Loop 可以被替换”，进一步走向“多个 Loop 可以同时存在”。»

---

6. 可能的实现方案

目前考虑两条路线。

Route A — Plugin-level Prototype

第一阶段优先尝试完全通过插件实现。

例如建立：

MultiLoopManager
      │
      ├── Runtime / Context A
      │        ↓
      │      Loop A
      │
      └── Runtime / Context B
               ↓
             Loop B

上层提供统一入口：

Agent A → Context A → Loop A
Agent B → Context B → Loop B

这个方案的优点是：

- 不需要立即修改 DSH Core；
- 不需要理解或修改 Agent Loop 内部；
- 可以快速证明 heterogeneous loops 的概念；
- 适合作为 v0.0 Proof of Concept。

缺点是可能需要多个 context/runtime，因此存在额外开销与生命周期管理问题。

---

Route B — Native Multi-Factory Registry

如果 Plugin PoC 证明设计有价值，同时发现当前 single-factory seam 成为主要限制，可以进一步提出一个非常小的 Core abstraction change。

概念上从：

ctx.agents
   ↓
Single AgentFactory

变为：

ctx.agents
   ↓
Named AgentFactory Registry
   │
   ├── "default"  → Factory A
   ├── "planning" → Factory B
   ├── "coding"   → Factory C
   └── "review"   → Factory D

API 可以类似：

registerFactory("default", factoryA)
registerFactory("experimental", factoryB)

创建 Agent：

create({
    factory: "experimental"
})

如果没有指定：

factory = default

这并不需要修改任何具体 Agent Loop。

改变的只是：

Single Provider
      ↓
Multiple Named Providers

即 AgentFactory seam 的 multiplicity。

---

7. v0.0 Proof of Concept

第一阶段不追求完整实现。

只证明：

«两个 Agent 可以在同一个 Multi-Agent 使用场景中分别运行不同的 Agent Loop。»

初始 Demo 可以使用：

               Multi-Loop PoC
                     │
            ┌────────┴────────┐
            │                 │
        Agent A           Agent B
            │                 │
   DeepSeek V4 Flash    DeepSeek V4 Pro
            │                 │
      Standard Loop      Minimal-first Loop
                              │
                     Minimal → Standard

其中：

Agent A

DeepSeek V4 Flash
        ↓
Standard Agent Loop

Standard 仅作为 baseline。

本项目不宣称 Standard 是 V4 Flash 的最佳 Loop。

Agent B

DeepSeek V4 Pro
        ↓
Minimal-first Standard
        ↓
Minimal Toolset
        ↓
First Tool Call
        ↓
Standard Toolset

该实现可以直接使用现有的 Minimal-first Standard 思路，而无需本项目重新设计 Agent Loop。

因此 Demo 的目的不是：

证明 Flash + Standard 最好

也不是：

证明 Pro + Minimal-first 最好

而只是证明：

Flash Agent → Loop A

和

Pro Agent → Loop B

可以同时存在于一个 Multi-Agent 使用场景中。

---

8. v0.1 最小目标

如果进一步实现 native registry，v0.1 只要求四项能力：

1. 注册多个 named AgentFactory / driver；
2. 创建 Agent 时指定 loop（以及可选 driver）；
3. 未指定时使用 default loop / default driver；
4. 两个不同 Agent 可以同时由不同 loop 驱动。

> 本节是早期设计稿。0.1.0 实现已经采用当前术语与配置形状：
> `agents` 是数组，字段为 `loop`（可选 `driver`），而不是 map + `factory`。

例如（当前实现）：

```yaml
agents:
  - id: flash
    model: deepseek-v4-flash
    loop: standard

  - id: pro
    model: deepseek-v4-pro
    loop: minimal-first
```

除此之外全部属于 Out of Scope。

---

9. 测试策略

第一阶段不需要真实模型。

可以建立：

FakeFactory A
FakeFactory B

分别创建：

Agent A
Agent B

测试：

Agent A → Factory A
Agent B → Factory B

确认 Factory selection 正确后，再连接真实 Agent Loop。

测试顺序：

Fake Factory A/B
        ↓
Default Loop + Fake Loop
        ↓
Two Real Loop Providers
        ↓
V4 Flash + V4 Pro Demo

这样可以把：

架构问题

与：

模型行为问题

完全分开。

---

10. Session / Resume

如果 Agent 创建时选择了特定 Factory：

Agent A → Factory X

那么 session resume 后原则上应该保持：

Agent A → Factory X

而不能静默退回：

Agent A → Default Factory

因此未来可能需要在 session metadata 中记录：

{
  "agentFactory": "factory-x"
}

具体实现方式需要根据 DSH 当前 session architecture 进一步确认。

这是本项目需要解决的基础设施问题之一，但仍然不涉及具体 Agent Loop 内部逻辑。

---

11. Future Possibilities

以下功能不是当前目标，但 heterogeneous loop capability 可以为它们提供基础：

Model-based Loop Routing

Task-based Loop Routing

Role-based Loop Routing

Automatic Loop Benchmarking

Runtime Loop Selection

Loop Marketplace

Planner-specific Loops

Coder-specific Loops

Reviewer-specific Loops

Multi-model / Multi-loop Agent Teams

未来甚至可能形成：

Task
 ↓
Agent Router
 ↓
Model Selection
 ↓
Loop Selection
 ↓
Agent Execution

但这些都不属于本项目第一阶段。

---

12. 项目成功标准

这个项目不需要证明 heterogeneous loops 一定优于 homogeneous loops。

它甚至不需要提出任何新的 Agent Loop。

最低成功标准只有：

Before:

Agent A ─┐
Agent B ─┼→ Loop X
Agent C ─┘


After:

Agent A → Loop X
Agent B → Loop Y
Agent C → Loop Z

如果社区能够基于这个接口研究：

«哪个模型应该配哪个 Loop？»

那么这个项目就已经完成了它最核心的目标。

---

13. 核心理念

本项目并不试图回答：

«What is the best agent loop?»

它希望首先提出另一个问题：

«Why should there be only one?»

以及更进一步：

«If different models, roles, and tasks benefit from different agent loops, why should heterogeneous agents be forced to share the same loop?»

本项目希望做的事情很小：

«不是创造最好的 Agent Loop，而是让不同 Agent Loop 可以共同存在。»

如果这个接口最终让更多开发者能够实验、比较和创造新的 Agent Loop，那么它就已经达到了目的。
