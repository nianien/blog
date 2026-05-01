---
title: "从LLM到Agent：Agentic系统的知识地图"
description: "从 LLM 的局限出发，定义 Agent 的核心组成，绘制 Agentic 系统全景架构图，并通过代码演示从 ChatCompletion 到完整 Agent 的演进路径。"
pubDate: "2025-12-01"
tags: ["Agentic", "AI Engineering", "LLM"]
series:
  key: "agentic"
  order: 1
author: "skyfalling"
---

---

## 1. 为什么需要从 LLM 走向 Agent

### 1.1 LLM 是一个了不起的函数

2022 年底以来，以 GPT-4、Claude、Gemini 为代表的大语言模型展示了令人印象深刻的能力：理解自然语言、生成结构化文本、进行多步推理、甚至通过各类考试。但如果我们冷静地回到工程视角，LLM 本质上是一个**无状态的文本映射函数**：

```
f(prompt: str, context: str) → response: str
```

它接收一段文本，返回一段文本。仅此而已。

### 1.2 LLM 的五个结构性局限

当你试图用 LLM 解决真实世界的任务时，会迅速撞上以下墙壁：

| 局限 | 本质原因 | 后果 |
|------|---------|------|
| **知识静态** | 训练数据有截止日期 | 无法回答实时问题，产生幻觉 |
| **无法行动** | 输出是文本，不是可执行指令 | 不能查数据库、调 API、操作文件 |
| **记忆易失** | 上下文窗口有限且无持久状态 | 长对话丢失信息，跨会话失忆 |
| **单步思维** | 一次 completion 只做一次推理 | 复杂任务无法分解、无法迭代 |
| **不会反思** | 不检查自己的输出质量 | 错误会被自信地传递下去 |

这五个局限不是"模型不够大"能解决的问题——它们是**架构层面的缺失**。更大的模型只是让函数 `f` 更强，但不会让函数变成系统。

### 1.3 从函数到系统的必然性

真实世界的任务天然具有以下特征：

- **需要多步执行**：完成一次数据分析需要查询 → 清洗 → 计算 → 可视化
- **需要外部交互**：查实时数据、调第三方 API、读写文件
- **需要持久记忆**：记住用户偏好、历史决策、领域知识
- **需要自我纠错**：发现错误后能回退、重试、换策略
- **需要可靠执行**：有超时、有重试、有降级、有审计

当这些需求叠加在一起，你需要的不再是一个"更好的 prompt"，而是一个**围绕 LLM 构建的系统**。这个系统，就是 Agent。

---

## 2. 定义 Agent

### 2.1 一个精确的定义

**Agent = LLM + Memory + Tools + Planner + Runtime**

这不是随意的拼凑，而是对上一节五个局限的逐一回应：

![LLM 五大局限与 Agent 组件的对应关系](/images/blog/agentic-01/llm-limitations-solutions.svg)

每个组件都有明确的职责：

- **LLM**：核心推理引擎。理解意图、生成计划、选择工具、产出结果。它是"大脑"，但不是全部。
- **Memory**：分为短期记忆（当前对话上下文、工作区状态）和长期记忆（向量数据库中的文档、用户画像、历史经验）。短期记忆保证连贯性，长期记忆突破知识边界。
- **Tools**：Agent 与外部世界的接口。一个 Tool 就是一个带有 JSON Schema 描述的可调用函数。搜索引擎、数据库查询、代码执行器、API 网关——都是 Tool。
- **Planner**：将复杂任务分解为可执行的子步骤。从简单的 ReAct（交替推理和行动）到复杂的分层规划（Hierarchical Planning），Planner 决定了 Agent 的"智商上限"。
- **Runtime**：Agent 的执行环境。负责控制循环的调度、工具调用的执行、错误处理、超时控制、状态持久化。没有 Runtime，前面四个组件只是散落的零件。

### 2.2 Agent 与 LLM 的本质差异

用一个类比来强化理解：

![LLM vs Agent 类比](/images/blog/agentic-01/llm-vs-agent-analogy.svg)

这个区分极其重要。很多团队把 LLM 当 Agent 用（期望一次 prompt 解决所有问题），或者把 Agent 当 LLM 用（忽略控制循环和状态管理），都会走进死胡同。

---

## 3. Agent 的核心控制循环

Agent 之所以能完成复杂任务，核心在于它运行一个**持续的控制循环**。这个循环可以抽象为六个阶段：

![Agent Control Loop](/images/blog/agentic-01/agent-control-loop.svg)

各阶段职责：

1. **Observe**（感知）：接收用户输入或环境变化。不仅是文本——可能是工具返回的结果、系统事件、定时触发。
2. **Think**（思考）：LLM 理解当前状态和目标。这一步对应 prompt 中的 System Message 和上下文组装。
3. **Plan**（规划）：决定下一步做什么。可能是调用工具、请求更多信息、或直接回答。ReAct 框架在此步生成 Thought + Action。
4. **Act**（执行）：真正执行动作。调用 API、查询数据库、运行代码、生成文件。这一步有**副作用**。
5. **Reflect**（反思）：检查执行结果是否符合预期。结果有错误？重试。结果不完整？补充。任务完成？退出循环。
6. **Update**（更新）：将本轮的观察、决策、结果写入记忆。更新会话上下文，可能也写入长期记忆。

**关键设计决策：何时退出循环？**

这是 Agent 设计中最容易被忽视的问题。常见策略：

- **Max Iterations**：硬性限制最大循环次数（防止无限循环和 token 爆炸）
- **Goal Completion**：LLM 判断任务已完成（但 LLM 判断可能不准）
- **Confidence Threshold**：当 Reflect 阶段的置信度低于阈值时，请求人类介入
- **Token Budget**：累计 token 消耗达到上限时强制退出

在生产系统中，通常需要**组合多种策略**，以 Max Iterations 作为保底。

---

## 4. Agentic 系统的全景架构

下面这张图展示了一个完整的 Agentic 系统的分层架构。它是整个系列 15 篇文章的"地图"：

![Agentic 系统全景架构](/images/blog/agentic-01/agentic-architecture.svg)

**架构解读**：

- **自底向上**：每一层为上一层提供能力。LLM Runtime 提供推理能力，Control Loop 提供执行循环，Tool 提供行动能力，Memory 提供持久化，Planner 提供智能规划，Multi-Agent 提供协作，Protocol 提供互操作性，Production 提供生产级保障。
- **耦合方向**：上层依赖下层，但下层不应感知上层。Tool Layer 不需要知道自己被 Multi-Agent 调用还是 Single-Agent 调用。
- **灵活组合**：不是每个系统都需要所有层。一个简单的 RAG 聊天机器人可能只需要 LLM Runtime + Memory Layer。一个自动化运维 Agent 可能需要 Control Loop + Tool + Planner。架构图是上界，不是下界。

---

## 5. 15 篇文章导航地图

以下是整个系列的文章列表，以及每篇文章对应全景图中的位置：

### Phase 1: What Is an Agent?

| # | 文章 | 聚焦层 |
|---|------|--------|
| **01** | **From LLM to Agent: Agentic 系统的知识地图** ← 本文 | 全景总览 |
| 02 | From Prompt to Agent: 为什么 LLM 本身不是 Agent | LLM Runtime → Control Loop |
| 03 | Agent 的形态与边界：从 Copilot 到自主系统 | 形态 · 边界 · 定位 |

### Phase 2: How to Program an Agent?

| # | 文章 | 聚焦层 |
|---|------|--------|
| 04 | The Agent Control Loop: Agent 运行时的核心抽象 | Control Loop Layer |
| 05 | Tool Calling Deep Dive: 让 LLM 成为可编程接口 | Tool Layer |
| 06 | Prompt Engineering for Agents: 面向 Agent 的提示词工程 | LLM Runtime + Planner |
| 07 | Agent Runtime from Scratch: 不依赖框架构建 Agent | Control Loop + Tool + Memory |

### Phase 3: How to Scale Agent Intelligence?

| # | 文章 | 聚焦层 |
|---|------|--------|
| 08 | Memory Architecture: Agent 的状态与记忆体系 | Memory Layer |
| 09 | RAG as Cognitive Memory: 检索增强生成的工程实践 | Memory Layer (RAG) |
| 10 | Planning and Reflection: 从 ReAct 到分层规划 | Planner Layer |
| 11 | Multi-Agent Collaboration: 多 Agent 协作模式 | Multi-Agent Layer |

### Phase 4: How to Ship Agents to Production?

| # | 文章 | 聚焦层 |
|---|------|--------|
| 12 | Agent 框架与 SDK：从 LangChain 到模型厂商原生 SDK | 框架 · SDK · 选型 |
| 13 | MCP 与工具协议 + A2A：Agent 的协议化未来 | Protocol Layer |
| 14 | Production-Grade Agent Systems: 评估、成本与安全 | Production Layer |
| 15 | Computer Use 与 GUI Agent：超越 API 的交互范式 | Tool Layer (GUI) |

每篇文章都可以独立阅读，但按顺序阅读可以获得最连贯的知识构建过程。

---

## 6. 从 ChatCompletion 到 Agent 的演进路径

理解 Agent 的最好方式，是看它如何从最简单的 API 调用一步步演进而来。下面用代码勾勒每一级的**核心跃迁**——完整实现将在后续文章中展开。

### Level 0 → 1: 从"能说"到"能做"（+ Tool Calling）

单次 ChatCompletion 只是一个文本映射函数。加入 Tool Calling 后，LLM 可以输出结构化的函数调用请求，由运行时执行并将结果反馈——这是 Agent 的第一个跃迁。

```python
# Level 0: 纯文本映射，一问一答
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": user_message}],
)

# Level 1: + Tool Calling —— LLM 决定"调哪个函数、传什么参数"
response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,  # JSON Schema 描述的函数列表
)
if response.choices[0].message.tool_calls:
    # 执行工具 → 将结果追加到 messages → 再次调用 LLM 生成最终回答
    ...
```

**局限**：只能做一步。如果任务需要"先查天气、再查航班、最后订酒店"，这个结构无法处理。

> 深入阅读：第 05 篇《工具调用深度解析》

### Level 1 → 2: 从"一步"到"多步"（+ Control Loop）

引入循环，让 Agent 能持续执行直到任务完成或达到退出条件。

```python
for i in range(MAX_ITERATIONS):
    response = client.chat.completions.create(
        model="gpt-4o", messages=messages, tools=tools
    )
    msg = response.choices[0].message
    messages.append(msg)

    if not msg.tool_calls:      # 退出条件：LLM 认为任务完成
        return msg.content

    for tool_call in msg.tool_calls:
        result = execute_tool(tool_call)
        messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})
```

**局限**：没有记忆——每次对话从零开始；没有规划——走一步看一步。

> 深入阅读：第 04 篇《Agent 控制循环》

### Level 2 → 3: 从"无状态"到"有记忆"（+ Memory）

加入短期记忆（会话上下文管理）和长期记忆（跨会话持久化），让 Agent 能积累信息和经验。

```python
@dataclass
class AgentMemory:
    conversation: list[dict]          # 短期：当前会话消息历史
    working: dict[str, Any]           # 工作记忆：当前任务的中间状态
    long_term: list[dict]             # 长期：跨会话持久化（向量数据库）

    def get_context_window(self, max_messages=20):
        """组装上下文：长期记忆摘要 + 最近对话"""
        ...
```

> 深入阅读：第 08 篇《记忆架构》、第 09 篇《RAG 工程实践》

### Level 3 → 4: 从"reactive"到"proactive"（+ Planner）

加入规划能力，Agent 先将目标分解为子步骤，再逐步执行，执行后反思结果质量。

```python
# Plan → Execute → Reflect
plan = planner.decompose(goal)          # 将目标分解为子步骤
for step in plan.steps:
    result = agent.execute(step)        # 逐步执行
    evaluation = reflector.evaluate(    # 反思：完成了吗？需要调整吗？
        goal, executed_steps, result
    )
    if evaluation.needs_replan:
        plan = planner.replan(evaluation.feedback)
```

> 深入阅读：第 10 篇《规划与反思》

### Level 4 → 5: 从"能跑"到"能上线"（+ Production Runtime）

生产级 Agent 需要补齐工程保障：错误重试、token 预算控制、结构化追踪、模型降级、安全审计。

```python
class Agent:
    def __init__(self, config: AgentConfig):
        self.memory = AgentMemory()
        self.tools = ToolRegistry()
        self.planner = Planner(config)
        self.observer = Observer()       # 可观测性（trace / log / metrics）

    def run(self, user_input: str) -> str:
        context = self._observe(user_input)           # 感知：组装上下文
        plan = self.planner.create_plan(context)      # 规划：分解任务
        result = self._execute_loop(context, plan)    # 执行：控制循环
        result = self._reflect_and_refine(result)     # 反思：质量评估
        self.memory.commit_to_long_term(summary)      # 更新：写入记忆
        return result
```

> 深入阅读：第 07 篇《不依赖框架构建 Agent》、第 14 篇《生产级 Agent 系统》

### 演进路径总结

![从 LLM 到 Agent 的演进路径](/images/blog/agentic-01/evolution-path.svg)

每一级引入一个新的能力维度，也同时引入新的复杂度。不是所有场景都需要 Level 5——选择哪个级别，取决于任务复杂度和工程约束。

---

## 7. Agent 不是银弹

### 7.1 适用场景

Agent 擅长处理以下类型的任务：

- **探索性任务**：不确定最终需要几步、用什么工具才能完成。例：研究某个技术方案的可行性。
- **多工具协作**：需要组合多个 API/数据源的信息。例：跨平台数据聚合分析。
- **需要迭代优化**：初版结果不够好，需要反思和改进。例：代码生成 + 自动测试 + 修复。
- **半结构化流程**：有大致方向但细节灵活。例：客户支持中的问题诊断。

### 7.2 不适用场景

Agent 在以下场景中可能是错误的选择：

- **确定性流程**：如果你能用 DAG 或状态机画出完整流程，用 Workflow 引擎比 Agent 更可靠、更可预测、更便宜。Agent 的价值在于处理"不确定性"——如果没有不确定性，你不需要 Agent。
- **低延迟要求**：Agent 的控制循环意味着多次 LLM 调用，延迟以秒计。对于需要毫秒级响应的场景，Agent 不合适。
- **高精度要求 + 零容错**：金融交易、医疗诊断等场景。LLM 的概率性本质意味着 Agent 不能保证 100% 正确。它可以辅助决策，但不应成为最终决策者。
- **简单的问答**：如果用户只是问"1+1等于几"，一次 ChatCompletion 足矣，不需要 Agent 的全部架构。

### 7.3 关键 Trade-off

| 维度 | 更多 Agent 能力 | 代价 |
|------|----------------|------|
| 自主性 | Agent 自主决策，减少人工干预 | 不可预测行为，调试困难 |
| 复杂度 | 能处理更复杂的任务 | 系统复杂度指数增长 |
| 成本 | 每个任务消耗更多 token | 月度 API 账单可能惊人 |
| 延迟 | 多步推理产出更好结果 | 用户等待时间更长 |
| 可靠性 | 有反思和重试机制 | 但每一步都可能出错，错误会累积 |

**核心决策原则**：

> 用最简单的抽象解决问题。如果 prompt engineering 够用，不要上 Agent。如果 Agent 够用，不要上 Multi-Agent。每增加一层抽象，都要问自己：这层抽象带来的能力提升，是否值得它引入的复杂度？

---


## 8. 结语与后续预告

本文作为系列开篇，建立了三个关键认知：

1. **LLM 是函数，Agent 是系统**。从函数到系统，需要补齐 Memory、Tools、Planner、Runtime 四个维度。
2. **Agent 的核心是控制循环**。Observe → Think → Plan → Act → Reflect → Update。循环赋予了 Agent 迭代解决问题的能力。
3. **Agent 不是银弹**。选择 Agent 是一个架构决策，需要在能力与复杂度之间做出权衡。

这个系列的目标不是教你使用某个框架的 API，而是帮你建立从第一性原理理解 Agentic 系统的能力。框架会变，API 会变，但系统设计的基本原理不会变。

### 8.1 推荐学习路径

如果你刚接触 Agentic 系统，以下是一条按技术依赖关系递进的学习路径：

1. **基础接口** — Python/JS 基础、HTTP/JSON、异步与并发。这是所有后续内容的前置条件。
2. **LLM 能力** — Prompt Engineering、Function Calling / Tool Use、结构化输出（JSON Schema）。Function Calling 比大多数人以为的更值得深入——Agent 的可靠性有一半建立在"工具调用是否正确"上，花时间写好工具的 Schema 定义和参数描述，回报率远高于优化 Prompt。（对应本系列第 02、05、06 篇）
3. **RAG 能力** — 文档分块与清洗、嵌入模型、向量数据库（pgvector / Milvus / Weaviate）、混合检索与重排。（对应第 08、09 篇）
4. **编排能力** — 状态机 / DAG 设计、重试回退、超时熔断、人机协作断点。这是从 demo 到生产的关键一步。（对应第 03、04、10、11 篇）
5. **评估与运维** — Agent 评估框架、日志与追踪（OpenTelemetry）、成本监控、安全（提示注入防护、RBAC、审计）。没有可靠的评估手段，就无法量化改进。（对应第 14 篇）

