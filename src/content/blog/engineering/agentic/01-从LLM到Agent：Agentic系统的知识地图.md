---
title: "从LLM到Agent：Agentic系统的知识地图"
description: "Agentic 系列开篇。从 LLM 的局限出发，定义 Agent 的核心组成，绘制 Agentic 系统全景架构图，并通过代码演示从 ChatCompletion 到完整 Agent 的演进路径。本文是整个系列 14 篇文章的精神锚点与导航地图。"
pubDate: "2025-12-01"
tags: ["Agentic", "AI Engineering", "LLM"]
---

# From LLM to Agent: Agentic 系统的知识地图

> 大语言模型是一个令人惊叹的函数：Text In, Text Out。但函数不等于系统，生成不等于行动，回答不等于解决。
>
> 本文是 Agentic 系列 14 篇文章的开篇。我们将从"LLM 能做什么"出发，推导出"Agent 必须做什么"，然后为整个系列绘制一张完整的知识地图。

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

```
局限：知识静态     → 解法：Memory（外部知识 + RAG）
局限：无法行动     → 解法：Tools（函数调用 + 外部接口）
局限：记忆易失     → 解法：Memory（会话状态 + 持久化记忆）
局限：单步思维     → 解法：Planner（任务分解 + 多步规划）
局限：不会反思     → 解法：Runtime（控制循环 + 反思机制）
```

每个组件都有明确的职责：

- **LLM**：核心推理引擎。理解意图、生成计划、选择工具、产出结果。它是"大脑"，但不是全部。
- **Memory**：分为短期记忆（当前对话上下文、工作区状态）和长期记忆（向量数据库中的文档、用户画像、历史经验）。短期记忆保证连贯性，长期记忆突破知识边界。
- **Tools**：Agent 与外部世界的接口。一个 Tool 就是一个带有 JSON Schema 描述的可调用函数。搜索引擎、数据库查询、代码执行器、API 网关——都是 Tool。
- **Planner**：将复杂任务分解为可执行的子步骤。从简单的 ReAct（交替推理和行动）到复杂的分层规划（Hierarchical Planning），Planner 决定了 Agent 的"智商上限"。
- **Runtime**：Agent 的执行环境。负责控制循环的调度、工具调用的执行、错误处理、超时控制、状态持久化。没有 Runtime，前面四个组件只是散落的零件。

### 2.2 Agent 与 LLM 的本质差异

用一个类比来强化理解：

```
LLM  ≈ CPU             —— 强大的计算单元，但单独无法工作
Agent ≈ Operating System —— 围绕 CPU 构建的完整运行时

LLM  是 Pure Function   —— 相同输入，相同输出，无副作用
Agent 是 Stateful System —— 有状态、有副作用、有执行循环
```

这个区分极其重要。很多团队把 LLM 当 Agent 用（期望一次 prompt 解决所有问题），或者把 Agent 当 LLM 用（忽略控制循环和状态管理），都会走进死胡同。

---

## 3. Agent 的核心控制循环

Agent 之所以能完成复杂任务，核心在于它运行一个**持续的控制循环**。这个循环可以抽象为六个阶段：

```
                    ┌──────────────────────────────────┐
                    │         Agent Control Loop        │
                    └──────────────────────────────────┘

                           ┌─────────────┐
                     ┌────▶│   Observe   │─────┐
                     │     │ (感知输入)   │     │
                     │     └─────────────┘     │
                     │                          ▼
              ┌──────┴──────┐           ┌─────────────┐
              │    Update   │           │    Think    │
              │ (更新状态)   │           │ (理解意图)   │
              └──────┬──────┘           └──────┬──────┘
                     ▲                          │
                     │                          ▼
              ┌──────┴──────┐           ┌─────────────┐
              │   Reflect   │           │    Plan     │
              │ (评估结果)   │◀──────────│ (制定计划)   │
              └─────────────┘           └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │     Act     │
                                        │ (执行动作)   │
                                        └─────────────┘
```

各阶段职责：

1. **Observe（感知）**：接收用户输入或环境变化。不仅是文本——可能是工具返回的结果、系统事件、定时触发。
2. **Think（思考）**：LLM 理解当前状态和目标。这一步对应 prompt 中的 System Message 和上下文组装。
3. **Plan（规划）**：决定下一步做什么。可能是调用工具、请求更多信息、或直接回答。ReAct 框架在此步生成 Thought + Action。
4. **Act（执行）**：真正执行动作。调用 API、查询数据库、运行代码、生成文件。这一步有**副作用**。
5. **Reflect（反思）**：检查执行结果是否符合预期。结果有错误？重试。结果不完整？补充。任务完成？退出循环。
6. **Update（更新）**：将本轮的观察、决策、结果写入记忆。更新会话上下文，可能也写入长期记忆。

**关键设计决策：何时退出循环？**

这是 Agent 设计中最容易被忽视的问题。常见策略：

- **Max Iterations**：硬性限制最大循环次数（防止无限循环和 token 爆炸）
- **Goal Completion**：LLM 判断任务已完成（但 LLM 判断可能不准）
- **Confidence Threshold**：当 Reflect 阶段的置信度低于阈值时，请求人类介入
- **Token Budget**：累计 token 消耗达到上限时强制退出

在生产系统中，通常需要**组合多种策略**，以 Max Iterations 作为保底。

---

## 4. Agentic 系统的全景架构

下面这张图展示了一个完整的 Agentic 系统的分层架构。它是整个系列 14 篇文章的"地图"：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Production Layer                                │
│  Observability │ Evaluation │ Security │ Cost Control │ Deployment  │
├─────────────────────────────────────────────────────────────────────┤
│                     Protocol Layer                                  │
│         MCP (Model Context Protocol) │ Tool Registry               │
│         Capability Declaration │ Permission Control                 │
├─────────────────────────────────────────────────────────────────────┤
│                     Multi-Agent Layer                               │
│    Supervisor/Worker │ Peer-to-Peer │ Graph-based Orchestration    │
│    Message Passing │ Shared State │ Agent Registry                  │
├─────────────────────────────────────────────────────────────────────┤
│                     Planner Layer                                   │
│    ReAct │ Chain-of-Thought │ Tree-of-Thought │ Hierarchical Plan  │
│    Task Decomposition │ Self-Evaluation │ Retry Budget              │
├─────────────────────────────────────────────────────────────────────┤
│                     Memory Layer                                    │
│    Short-term: Conversation State │ Working Memory                  │
│    Long-term: Vector DB │ Knowledge Graph │ User Profile            │
│    RAG Pipeline: Chunk → Embed → Index → Retrieve → Rerank         │
├─────────────────────────────────────────────────────────────────────┤
│                     Tool Layer                                      │
│    Function Calling │ JSON Schema │ Structured Output               │
│    Tool Validation │ Sandbox Execution │ Error Handling             │
├─────────────────────────────────────────────────────────────────────┤
│                     Control Loop Layer                              │
│    Observe → Think → Plan → Act → Reflect → Update                 │
│    State Machine │ Execution Engine │ Interrupt & Resume            │
├─────────────────────────────────────────────────────────────────────┤
│                     LLM Runtime Layer                               │
│    ChatCompletion API │ Streaming │ Token Management                │
│    Model Router │ Fallback │ Rate Limiting │ Caching               │
└─────────────────────────────────────────────────────────────────────┘
```

**架构解读**：

- **自底向上**：每一层为上一层提供能力。LLM Runtime 提供推理能力，Control Loop 提供执行循环，Tool 提供行动能力，Memory 提供持久化，Planner 提供智能规划，Multi-Agent 提供协作，Protocol 提供互操作性，Production 提供生产级保障。
- **耦合方向**：上层依赖下层，但下层不应感知上层。Tool Layer 不需要知道自己被 Multi-Agent 调用还是 Single-Agent 调用。
- **灵活组合**：不是每个系统都需要所有层。一个简单的 RAG 聊天机器人可能只需要 LLM Runtime + Memory Layer。一个自动化运维 Agent 可能需要 Control Loop + Tool + Planner。架构图是上界，不是下界。

---

## 5. 14 篇文章导航地图

以下是整个系列的文章列表，以及每篇文章对应全景图中的位置：

### Phase 1: What Is an Agent?

| # | 文章 | 聚焦层 |
|---|------|--------|
| **01** | **From LLM to Agent: Agentic 系统的知识地图** ← 本文 | 全景总览 |
| 02 | From Prompt to Agent: 为什么 LLM 本身不是 Agent | LLM Runtime → Control Loop |
| 03 | Agent vs Workflow vs Automation: 选对抽象才是关键 | 架构决策 |

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
| 12 | LangChain vs LangGraph: 框架的价值与边界 | Control Loop + Tool (框架视角) |
| 13 | MCP and Tool Protocol: Agent 工具的协议化未来 | Protocol Layer |
| 14 | Production-Grade Agent Systems: 评估、成本与安全 | Production Layer |

每篇文章都可以独立阅读，但按顺序阅读可以获得最连贯的知识构建过程。

---

## 6. 从 ChatCompletion 到 Agent 的演进路径

下面通过代码展示从最简单的 API 调用到完整 Agent 的逐步演进。每一级都在前一级的基础上增加一个关键能力。理解这个演进过程，就理解了 Agent 的设计逻辑。

### Level 0: 单次 ChatCompletion

最基础的用法——一问一答，无状态，无工具。

```python
import openai

def chat(user_message: str) -> str:
    """Level 0: 纯粹的 LLM 调用，Text In → Text Out"""
    response = openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": user_message},
        ],
    )
    return response.choices[0].message.content

# 能力边界：只能回答训练数据内的问题，无法查实时数据，无法执行动作
```

**局限**：这就是一个函数调用。它不知道今天是星期几，不能帮你查天气，不记得你上一句说了什么。

### Level 1: + Tool Calling

让 LLM 能够调用外部函数，从"能说"进化到"能做"。

```python
import json

# 定义工具：用 JSON Schema 描述函数签名
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定城市的当前天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名称"}
                },
                "required": ["city"],
            },
        },
    }
]

# 工具实现
def get_weather(city: str) -> str:
    # 实际场景中调用天气 API
    return json.dumps({"city": city, "temp": "22°C", "condition": "晴"})

# 工具注册表：名称 → 函数的映射
tool_registry = {"get_weather": get_weather}

def chat_with_tools(user_message: str) -> str:
    """Level 1: LLM + Tool Calling"""
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": user_message},
    ]

    response = openai.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
    )

    msg = response.choices[0].message

    # 如果 LLM 决定调用工具
    if msg.tool_calls:
        # 执行工具调用
        for tool_call in msg.tool_calls:
            fn_name = tool_call.function.name
            fn_args = json.loads(tool_call.function.arguments)
            result = tool_registry[fn_name](**fn_args)

            # 将工具结果反馈给 LLM
            messages.append(msg)
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })

        # LLM 根据工具结果生成最终回答
        final = openai.chat.completions.create(
            model="gpt-4o", messages=messages
        )
        return final.choices[0].message.content

    return msg.content
```

**进步**：LLM 现在能"做事"了——但只能做一步。如果任务需要先查天气、再查航班、最后订酒店，这个结构无法处理。

### Level 2: + Control Loop

引入循环，让 Agent 能够多步执行、迭代推进。

```python
MAX_ITERATIONS = 10

def agent_loop(user_message: str) -> str:
    """Level 2: LLM + Tools + Control Loop"""
    messages = [
        {"role": "system", "content": "You are a helpful assistant with tools."},
        {"role": "user", "content": user_message},
    ]

    for i in range(MAX_ITERATIONS):
        response = openai.chat.completions.create(
            model="gpt-4o", messages=messages, tools=tools
        )
        msg = response.choices[0].message
        messages.append(msg)

        # 退出条件：LLM 不再请求工具调用，认为任务完成
        if not msg.tool_calls:
            return msg.content

        # 执行所有工具调用
        for tool_call in msg.tool_calls:
            fn_name = tool_call.function.name
            fn_args = json.loads(tool_call.function.arguments)

            try:
                result = tool_registry[fn_name](**fn_args)
            except Exception as e:
                result = json.dumps({"error": str(e)})

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })

    return "达到最大迭代次数，任务未完成。"
```

**进步**：Agent 现在能连续执行多步操作。但它没有记忆——每次对话从零开始，也没有规划能力——走一步看一步。

### Level 3: + Memory

加入记忆系统，让 Agent 能跨步骤、甚至跨会话地积累信息。

```python
from dataclasses import dataclass, field
from typing import Any

@dataclass
class AgentMemory:
    """Agent 的记忆系统"""
    # 短期记忆：当前会话的消息历史
    conversation: list[dict] = field(default_factory=list)
    # 工作记忆：当前任务的中间状态
    working: dict[str, Any] = field(default_factory=dict)
    # 长期记忆：跨会话持久化（简化版，生产中用向量数据库）
    long_term: list[dict] = field(default_factory=list)

    def add_message(self, message: dict):
        self.conversation.append(message)

    def store_fact(self, key: str, value: Any):
        """存入工作记忆"""
        self.working[key] = value

    def commit_to_long_term(self, summary: str):
        """将重要信息提交到长期记忆"""
        self.long_term.append({
            "summary": summary,
            "timestamp": __import__("time").time(),
        })

    def get_context_window(self, max_messages: int = 20) -> list[dict]:
        """获取上下文窗口：最近的消息 + 长期记忆摘要"""
        context = []
        # 注入长期记忆摘要
        if self.long_term:
            memory_text = "\n".join(m["summary"] for m in self.long_term[-5:])
            context.append({
                "role": "system",
                "content": f"你的长期记忆：\n{memory_text}",
            })
        # 最近的对话消息
        context.extend(self.conversation[-max_messages:])
        return context


def agent_with_memory(user_message: str, memory: AgentMemory) -> str:
    """Level 3: LLM + Tools + Control Loop + Memory"""
    memory.add_message({"role": "user", "content": user_message})

    system_prompt = {
        "role": "system",
        "content": "You are a helpful assistant. Use your memory and tools.",
    }
    messages = [system_prompt] + memory.get_context_window()

    for i in range(MAX_ITERATIONS):
        response = openai.chat.completions.create(
            model="gpt-4o", messages=messages, tools=tools
        )
        msg = response.choices[0].message
        memory.add_message(msg.model_dump())

        if not msg.tool_calls:
            # 任务完成，考虑是否需要存入长期记忆
            return msg.content

        for tool_call in msg.tool_calls:
            fn_name = tool_call.function.name
            fn_args = json.loads(tool_call.function.arguments)
            try:
                result = tool_registry[fn_name](**fn_args)
                # 将关键结果存入工作记忆
                memory.store_fact(f"{fn_name}_result", result)
            except Exception as e:
                result = json.dumps({"error": str(e)})

            tool_msg = {
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            }
            memory.add_message(tool_msg)

        messages = [system_prompt] + memory.get_context_window()

    return "达到最大迭代次数。"
```

**进步**：Agent 有了"记性"。但它仍然是 reactive 的——一步一步地响应，没有全局计划。

### Level 4: + Planner

加入规划能力，让 Agent 先思考再行动。这是 ReAct 模式的核心思想。

```python
PLANNER_PROMPT = """你是一个任务规划器。给定用户的目标，你需要：
1. 将目标分解为具体的子步骤
2. 为每个步骤指定需要的工具
3. 标明步骤间的依赖关系
4. 输出 JSON 格式的计划

输出格式：
{
  "goal": "用户目标",
  "steps": [
    {"id": 1, "action": "描述", "tool": "工具名或null", "depends_on": []},
    ...
  ]
}
"""

def plan_task(goal: str) -> dict:
    """使用 LLM 生成执行计划"""
    response = openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": PLANNER_PROMPT},
            {"role": "user", "content": goal},
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


REFLECT_PROMPT = """你是一个任务审查器。根据以下信息判断：
- 原始目标：{goal}
- 已执行步骤：{executed_steps}
- 当前结果：{current_result}

请回答：
1. 任务是否已完成？(yes/no)
2. 如果未完成，下一步应该做什么？
3. 是否需要修改原计划？
"""

def agent_with_planner(user_message: str, memory: AgentMemory) -> str:
    """Level 4: LLM + Tools + Loop + Memory + Planner"""
    # Phase 1: Plan
    plan = plan_task(user_message)
    memory.store_fact("plan", plan)

    executed = []

    # Phase 2: Execute plan step by step
    for step in plan.get("steps", []):
        # 检查依赖是否满足
        deps = step.get("depends_on", [])
        if not all(d in [s["id"] for s in executed] for d in deps):
            continue

        if step.get("tool"):
            # 通过 agent_loop 执行工具调用
            result = agent_loop(
                f"执行以下步骤：{step['action']}。只使用 {step['tool']} 工具。"
            )
        else:
            result = agent_loop(step["action"])

        executed.append({"id": step["id"], "result": result})

    # Phase 3: Reflect
    reflection_prompt = REFLECT_PROMPT.format(
        goal=user_message,
        executed_steps=json.dumps(executed, ensure_ascii=False),
        current_result=executed[-1]["result"] if executed else "无结果",
    )

    final = openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": reflection_prompt}],
    )

    return final.choices[0].message.content
```

**进步**：Agent 现在会"想了再做"。但这还不是终态。

### Level 5: Full Agent System

完整的 Agent 系统不只是上述组件的堆叠，还需要生产级的工程保障：

```python
@dataclass
class AgentConfig:
    """Agent 系统配置"""
    model: str = "gpt-4o"
    max_iterations: int = 10
    max_tokens_budget: int = 50000       # token 预算上限
    tool_timeout_seconds: int = 30       # 工具调用超时
    enable_reflection: bool = True       # 是否启用反思
    enable_planning: bool = True         # 是否启用规划
    fallback_model: str = "gpt-4o-mini"  # 降级模型


class Agent:
    """Level 5: 完整的 Agent 系统骨架"""

    def __init__(self, config: AgentConfig):
        self.config = config
        self.memory = AgentMemory()
        self.tools = ToolRegistry()       # 工具注册中心
        self.planner = Planner(config)    # 规划器
        self.observer = Observer()        # 可观测性（trace/log/metrics）
        self.token_usage = 0             # token 消耗追踪

    def run(self, user_input: str) -> str:
        """Agent 主入口：完整的控制循环"""
        self.observer.trace_start(user_input)

        try:
            # 1. Observe: 接收输入，组装上下文
            context = self._observe(user_input)

            # 2. Plan: 如果启用规划，先生成执行计划
            plan = None
            if self.config.enable_planning:
                plan = self.planner.create_plan(context)
                self.observer.log_plan(plan)

            # 3. Execute: 控制循环
            result = self._execute_loop(context, plan)

            # 4. Reflect: 如果启用反思，评估结果质量
            if self.config.enable_reflection:
                result = self._reflect_and_refine(context, result)

            # 5. Update: 更新记忆
            self.memory.commit_to_long_term(
                f"用户问: {user_input[:100]}... → 结果: {result[:100]}..."
            )

            self.observer.trace_end(result, self.token_usage)
            return result

        except Exception as e:
            self.observer.trace_error(e)
            return f"Agent 执行出错: {str(e)}"

    def _observe(self, user_input: str) -> dict:
        """感知阶段：组装完整上下文"""
        return {
            "user_input": user_input,
            "conversation": self.memory.get_context_window(),
            "working_memory": self.memory.working,
            "available_tools": self.tools.list_schemas(),
        }

    def _execute_loop(self, context: dict, plan: dict | None) -> str:
        """核心执行循环"""
        steps = plan["steps"] if plan else [{"action": context["user_input"]}]

        results = []
        for step in steps:
            for i in range(self.config.max_iterations):
                # 预算检查
                if self.token_usage > self.config.max_tokens_budget:
                    return "Token 预算耗尽，任务中断。"

                # LLM 推理（含自动降级）
                response = self._call_llm(context, step)

                if response.tool_calls:
                    self._execute_tools(response.tool_calls)
                else:
                    results.append(response.content)
                    break

        return "\n".join(results)

    def _call_llm(self, context, step):
        """LLM 调用，含降级逻辑"""
        try:
            return self._invoke(self.config.model, context, step)
        except Exception:
            # 降级到备用模型
            return self._invoke(self.config.fallback_model, context, step)

    # ... 省略 _execute_tools, _reflect_and_refine 等实现细节
```

**这不是最终代码，而是架构骨架。** 生产系统还需要：并发控制、幂等性保证、结构化日志、指标采集、灰度发布、A/B 测试、成本告警等。这些内容将在系列后续文章中逐一展开。

### 演进路径总结

```
Level 0   Level 1     Level 2        Level 3         Level 4         Level 5
 LLM ───→ +Tools ───→ +Loop ───→ +Memory ───→ +Planner ───→ +Production
  │          │           │           │             │              │
  │          │           │           │             │              │
单次调用   一步行动    多步执行    有记忆的      有规划的      生产级
无状态     无循环     有迭代       迭代执行      智能执行      完整系统
```

每一级都引入一个**新的能力维度**，也同时引入**新的复杂度和 trade-off**。不是所有场景都需要 Level 5。选择哪个级别，取决于你的任务复杂度和工程约束。

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

## 8. 选型决策树

选择合适的架构级别（LLM、Workflow、还是 Agent）需要综合考虑多个维度。以下是一个决策框架：

### 8.1 决策维度

```
                        任务特征评估
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
      确定性程度         延迟要求            成本承受力
          │                  │                  │
     ┌────┴────┐        ┌────┴────┐       ┌────┴────┐
     高        低        <200ms    >2s      紧        充足
     │         │          │        │       │         │
```

### 8.2 决策矩阵

| 场景 | 任务特征 | 确定性 | 延迟 | 成本 | 推荐方案 | 代码示例 |
|------|---------|--------|------|------|---------|---------|
| **简单问答** | 用户问"今天天气如何？" | 高 | <1s | 低 | `ChatCompletion` | 一次 API 调用 |
| **个性化推荐** | 基于历史记录推荐商品，逻辑清晰 | 高 | <500ms | 低 | `ChatCompletion + Prompt` | 在 prompt 中写死逻辑 |
| **订单处理** | 验证库存→计算价格→生成订单，步骤固定 | 高 | <1s | 中 | `Workflow / DAG` | 见 9.3 示例 |
| **报表生成** | 查多个数据源，聚合，需重试 | 中 | <30s | 中 | `Agent (轻量级)` | Workflow + 少量工具 |
| **客户支持诊断** | 问题类型多样，需多次追问 | 低 | <5s | 中 | `Agent (完整)` | 见 Level 5 |
| **数据分析与洞察** | 不确定需要哪些数据源，需迭代优化 | 低 | <1min | 高 | `Agent (完整)` | 多工具协作 |
| **代码生成与自测** | 生成→测试→修复，需循环 | 低 | <2min | 高 | `Agent + 长步骤` | ReAct 模式 |

### 8.3 快速判断流程

```
START
  │
  ├─ 任务流程能否用 flowchart 清晰表达？
  │   ├─ 是 → 流程完全确定，步骤不变
  │   │   └─ 是否需要 NLP 或多 API 聚合？
  │   │       ├─ 否 → 用传统后端 + DB（不用 LLM）
  │   │       └─ 是 → 用 ChatCompletion + prompt 工程
  │   │
  │   └─ 否 → 流程存在分支和不确定性
  │       └─ 是否需要 <200ms 响应？
  │           ├─ 是 → **不适合 Agent**，降级为 prompt + rule
  │           └─ 否 → 是否能负担多次 API 调用？
  │               ├─ 否 → **Workflow 引擎**（确定性 + 成本控制）
  │               └─ 是 → **Agent**（自主规划 + 多步推理）
  │
  └─ 选择确定，评估 memory 需求
      ├─ 需要跨会话持久化？
      │   ├─ 是 → 加 RAG / Vector DB
      │   └─ 否 → 会话内存足够
      │
      └─ 需要多 Agent 协作？
          ├─ 是 → 设计 Multi-Agent 系统
          └─ 否 → 单 Agent 足够

END
```

### 8.4 具体场景举例

**场景 A：电商订单处理（确定性任务）**

> 订单流程：验证用户 → 检查库存 → 计算折扣 → 生成订单 → 发送确认

- **确定性**：高（步骤顺序固定）
- **延迟要求**：<1s
- **成本**：每单 0.05 元，年 100 万单

**选择**：`Workflow / 状态机`，不用 Agent

原因：
- 步骤顺序明确，不需要 LLM 重新规划
- 延迟要求严格，每多一个 LLM 调用就多增加 1-2s
- 成本敏感：Agent 的多轮调用会让每单成本翻倍

---

**场景 B：财务数据分析和洞察（探索性任务）**

> 用户问："去年 Q4 相比 Q3，我们的毛利率变化趋势如何？哪些产品线贡献最大？"

- **确定性**：低（不知道需要查哪些表，需要多少次聚合）
- **延迟要求**：<30s 可接受
- **成本**：对 token 消耗有预算

**选择**：`Agent (完整)`

原因：
- 需要多步探索：先查销售表 → 计算成本 → 比较环比 → 识别贡献者
- 每一步结果都可能影响下一步（自适应）
- 可以接受多次 LLM 调用和较长延迟
- 需要记忆：可能需要参考之前查过的数据

---

**场景 C：实时库存预警（低延迟 + 确定性）**

> 当库存低于警戒线时自动触发预警和建议采购量

- **确定性**：高（逻辑清晰：库存值 < 阈值 → 发警告）
- **延迟要求**：<100ms
- **成本**：成本约束严格

**选择**：`规则引擎 + 轻量级 prompt`，不用 Agent

原因：
- Agent 无法提供 <100ms 响应（网络+LLM 调用最少 500ms）
- 用规则引擎实现主逻辑，必要时用 ChatCompletion 生成人类可读的建议文案

---

## 9. 何时不用 Agent —— 反面教学

### 9.1 问题陈述

假设我们要实现"订单处理系统"。用户通过 API 提交订单，系统需要：

1. 验证订单内容（检查是否有异常）
2. 检查库存（是否有货）
3. 计算订单总价（包含税费、折扣）
4. 生成订单记录
5. 返回订单 ID

这个流程**完全确定**：步骤顺序固定，每步的输入和输出都明确。

### 9.2 用 Agent 实现（反面示例）

```python
from openai import OpenAI
import json
import time

client = OpenAI()

# Agent 方式：让 LLM 决定每一步做什么
tools = [
    {
        "type": "function",
        "function": {
            "name": "validate_order",
            "description": "验证订单内容是否合法",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                    "items": {"type": "array"},
                    "customer_id": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_inventory",
            "description": "检查库存是否充足",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {"type": "array"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_price",
            "description": "计算订单总价",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {"type": "array"},
                    "customer_id": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_order",
            "description": "创建订单记录",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {"type": "string"},
                    "items": {"type": "array"},
                    "total_price": {"type": "number"},
                },
            },
        },
    },
]

# 工具实现（模拟）
tool_impl = {
    "validate_order": lambda **kw: json.dumps({"valid": True}),
    "check_inventory": lambda **kw: json.dumps({"in_stock": True}),
    "calculate_price": lambda **kw: json.dumps({"total": 999.99, "tax": 79.99}),
    "create_order": lambda **kw: json.dumps({"order_id": "ORD-2025-0001"}),
}

def process_order_with_agent(order_data: dict) -> dict:
    """使用 Agent 处理订单"""
    start_time = time.time()
    token_count = 0

    messages = [
        {
            "role": "system",
            "content": "You are an order processing agent. Process the order step by step."
        },
        {
            "role": "user",
            "content": f"Process this order: {json.dumps(order_data)}",
        }
    ]

    # Agent 循环
    iterations = 0
    max_iterations = 10

    while iterations < max_iterations:
        iterations += 1

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools,
        )

        # 追踪 token 消耗
        token_count += response.usage.prompt_tokens + response.usage.completion_tokens

        msg = response.choices[0].message
        messages.append(msg.model_dump())

        if not msg.tool_calls:
            # Agent 认为完成
            return {
                "result": msg.content,
                "iterations": iterations,
                "tokens": token_count,
                "latency_ms": (time.time() - start_time) * 1000,
                "cost": token_count * 0.0015 / 1000,  # gpt-4o-mini 价格估算
            }

        # 执行工具调用
        for tool_call in msg.tool_calls:
            fn_name = tool_call.function.name
            fn_args = json.loads(tool_call.function.arguments)
            result = tool_impl[fn_name](**fn_args)

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })

    return {
        "error": "Max iterations exceeded",
        "tokens": token_count,
        "latency_ms": (time.time() - start_time) * 1000,
        "cost": token_count * 0.0015 / 1000,
    }

# 测试
order = {
    "customer_id": "CUST-123",
    "items": [
        {"sku": "PROD-001", "qty": 2, "price": 499.99},
        {"sku": "PROD-002", "qty": 1, "price": 199.99},
    ]
}

result_agent = process_order_with_agent(order)
print("Agent 方式结果：")
print(json.dumps(result_agent, indent=2, ensure_ascii=False))
```

**Agent 方式的问题**：
- ⏱️ **延迟高**：平均 3-5 秒（多次 API 调用 + 网络往返）
- 💰 **成本高**：每个订单耗费 2000+ tokens，成本 ¥0.003+（比 Workflow 高 10 倍）
- 🎲 **不可预测**：LLM 可能按错误的顺序执行工具，或重复调用同一工具
- 📊 **难以调试**：如果某个订单处理失败，很难追踪是哪一步出问题（LLM 的"思考过程"不透明）
- 🔒 **难以审计**：金融场景需要清晰的执行日志，Agent 的非确定性会导致审计困难

### 9.3 用 Workflow 实现（推荐方案）

```python
from dataclasses import dataclass
import json
from enum import Enum
from typing import Optional
import time

class OrderStatus(Enum):
    PENDING = "pending"
    VALIDATED = "validated"
    INVENTORY_CHECKED = "inventory_checked"
    PRICE_CALCULATED = "price_calculated"
    CREATED = "created"
    FAILED = "failed"

@dataclass
class OrderContext:
    """订单处理的执行上下文"""
    customer_id: str
    items: list
    status: OrderStatus = OrderStatus.PENDING
    validation_result: Optional[dict] = None
    inventory_result: Optional[dict] = None
    price_result: Optional[dict] = None
    order_id: Optional[str] = None
    error: Optional[str] = None

class OrderWorkflow:
    """确定性的订单处理工作流"""

    def __init__(self):
        self.token_count = 0  # 成本追踪
        self.steps_log = []   # 审计日志

    def run(self, order_data: dict) -> dict:
        """执行订单处理流程"""
        start_time = time.time()
        ctx = OrderContext(
            customer_id=order_data["customer_id"],
            items=order_data["items"],
        )

        try:
            # Step 1: 验证
            self._validate_order(ctx)

            # Step 2: 检查库存
            self._check_inventory(ctx)

            # Step 3: 计算价格
            self._calculate_price(ctx)

            # Step 4: 创建订单
            self._create_order(ctx)

            ctx.status = OrderStatus.CREATED

        except Exception as e:
            ctx.status = OrderStatus.FAILED
            ctx.error = str(e)

        return {
            "order_id": ctx.order_id,
            "status": ctx.status.value,
            "error": ctx.error,
            "price": ctx.price_result,
            "steps_executed": len(self.steps_log),
            "steps_log": self.steps_log,
            "tokens": self.token_count,
            "latency_ms": (time.time() - start_time) * 1000,
            "cost": self.token_count * 0.0015 / 1000,
        }

    def _validate_order(self, ctx: OrderContext):
        """Step 1: 验证订单"""
        self.steps_log.append("VALIDATE: start")

        if not ctx.customer_id:
            raise ValueError("缺少 customer_id")
        if not ctx.items or len(ctx.items) == 0:
            raise ValueError("订单为空")

        # 检查每个 item
        for item in ctx.items:
            if not item.get("sku") or item.get("qty", 0) <= 0:
                raise ValueError(f"非法的 item: {item}")

        ctx.validation_result = {"valid": True}
        ctx.status = OrderStatus.VALIDATED
        self.steps_log.append("VALIDATE: success")

    def _check_inventory(self, ctx: OrderContext):
        """Step 2: 检查库存"""
        self.steps_log.append("INVENTORY: start")

        # 模拟库存查询
        skus = [item["sku"] for item in ctx.items]
        inventory = {
            "PROD-001": 100,
            "PROD-002": 50,
        }

        for sku in skus:
            if sku not in inventory or inventory[sku] <= 0:
                raise ValueError(f"SKU {sku} 库存不足")

        ctx.inventory_result = {"in_stock": True}
        ctx.status = OrderStatus.INVENTORY_CHECKED
        self.steps_log.append("INVENTORY: success")

    def _calculate_price(self, ctx: OrderContext):
        """Step 3: 计算价格"""
        self.steps_log.append("PRICE: start")

        subtotal = sum(item.get("price", 0) * item.get("qty", 1) for item in ctx.items)
        tax_rate = 0.08
        tax = subtotal * tax_rate
        total = subtotal + tax

        ctx.price_result = {
            "subtotal": subtotal,
            "tax": tax,
            "total": total,
        }
        ctx.status = OrderStatus.PRICE_CALCULATED
        self.steps_log.append(f"PRICE: total={total}")

    def _create_order(self, ctx: OrderContext):
        """Step 4: 创建订单"""
        self.steps_log.append("CREATE: start")

        # 模拟数据库写入
        order_id = f"ORD-{int(time.time() * 1000)}"
        ctx.order_id = order_id

        self.steps_log.append(f"CREATE: order_id={order_id}")

# 测试
order = {
    "customer_id": "CUST-123",
    "items": [
        {"sku": "PROD-001", "qty": 2, "price": 499.99},
        {"sku": "PROD-002", "qty": 1, "price": 199.99},
    ]
}

workflow = OrderWorkflow()
result_workflow = workflow.run(order)
print("Workflow 方式结果：")
print(json.dumps(result_workflow, indent=2, ensure_ascii=False))
```

**Workflow 方式的优势**：

| 指标 | Agent | Workflow |
|------|-------|----------|
| **延迟** | 3-5s | <100ms |
| **成本** | ¥0.003/单 | ¥0.00003/单（100 倍便宜） |
| **可预测性** | 不确定 | 完全确定 |
| **可审计性** | 难 | 易（清晰的步骤日志） |
| **错误处理** | 含糊 | 精确的 try-catch |
| **调试难度** | 困难 | 简单 |
| **扩展灵活性** | 高 | 低 |

### 9.4 总结：何时选择哪个方案

- **Workflow**：适合确定性流程。步骤顺序固定、输入输出明确、成本/延迟敏感。订单、支付、报表生成等。
- **Agent**：适合探索性任务。不确定需要几步、用什么工具、可以接受较长延迟和较高成本。数据分析、问题诊断、代码生成等。

**黄金法则**：用最简单的工具解决问题。如果 Workflow 够用，不要用 Agent。成本、延迟、可维护性都会感谢你这个决定。

---

## 10. 增强 Level 5 代码 —— 生产级实现

前面的 Level 5 给出了一个架构骨架。本节补充**生产级必需的三个关键能力**：错误处理与重试、成本追踪、结构化可观测性。

### 10.1 完整的生产级 Agent

```python
import logging
import json
import time
from dataclasses import dataclass, field
from typing import Optional, Callable, Any
from enum import Enum
from collections import defaultdict
import random

# 日志配置（OpenTelemetry 风格）
logger = logging.getLogger(__name__)
handler = logging.StreamHandler()
formatter = logging.Formatter(
    '%(asctime)s [%(levelname)s] trace_id=%(trace_id)s span_id=%(span_id)s %(message)s'
)
handler.setFormatter(formatter)
logger.addHandler(handler)


class RetryPolicy(Enum):
    """重试策略"""
    NO_RETRY = "no_retry"
    EXPONENTIAL_BACKOFF = "exponential_backoff"
    LINEAR_BACKOFF = "linear_backoff"


@dataclass
class CostMetrics:
    """成本和 token 追踪"""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    
    # 模型定价（USD per 1M tokens）
    model_prices = {
        "gpt-4o": {"input": 5.00, "output": 15.00},
        "gpt-4o-mini": {"input": 0.15, "output": 0.60},
        "gpt-4-turbo": {"input": 10.00, "output": 30.00},
    }
    
    def add(self, prompt_tokens: int, completion_tokens: int, model: str = "gpt-4o"):
        """累加 token 消耗"""
        self.prompt_tokens += prompt_tokens
        self.completion_tokens += completion_tokens
        self.total_tokens = self.prompt_tokens + self.completion_tokens
    
    def calculate_cost(self, model: str = "gpt-4o") -> float:
        """计算成本（USD）"""
        prices = self.model_prices.get(model, self.model_prices["gpt-4o"])
        input_cost = self.prompt_tokens * prices["input"] / 1_000_000
        output_cost = self.completion_tokens * prices["output"] / 1_000_000
        return input_cost + output_cost
    
    def to_dict(self) -> dict:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "estimated_cost_usd": round(self.calculate_cost(), 6),
        }


@dataclass
class Trace:
    """OpenTelemetry 风格的追踪记录"""
    trace_id: str
    span_id: str
    start_time: float
    end_time: Optional[float] = None
    status: str = "pending"  # pending, success, error
    error: Optional[str] = None
    span_name: str = ""
    attributes: dict = field(default_factory=dict)
    
    def end(self, status: str = "success", error: Optional[str] = None):
        """结束 span"""
        self.end_time = time.time()
        self.status = status
        self.error = error
    
    def duration_ms(self) -> float:
        """获取执行时间（ms）"""
        if self.end_time is None:
            return time.time() - self.start_time
        return (self.end_time - self.start_time) * 1000
    
    def to_dict(self) -> dict:
        return {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "span_name": self.span_name,
            "status": self.status,
            "duration_ms": self.duration_ms(),
            "error": self.error,
            "attributes": self.attributes,
        }


class Observability:
    """可观测性系统（日志 + 指标 + 追踪）"""
    
    def __init__(self):
        self.traces: list[Trace] = []
        self.metrics: dict = defaultdict(int)
        self.trace_stack: list[Trace] = []
    
    def start_span(self, span_name: str, trace_id: str = None) -> Trace:
        """开始新的 span（与当前 trace_id 关联）"""
        if not trace_id:
            trace_id = self._generate_id()
        
        span_id = self._generate_id()
        trace = Trace(
            trace_id=trace_id,
            span_id=span_id,
            start_time=time.time(),
            span_name=span_name,
        )
        
        self.trace_stack.append(trace)
        logger.info(
            f"Span started: {span_name}",
            extra={"trace_id": trace_id, "span_id": span_id}
        )
        
        return trace
    
    def end_span(self, trace: Trace, status: str = "success", error: Optional[str] = None):
        """结束 span，并记录"""
        trace.end(status, error)
        self.traces.append(trace)
        
        level = "ERROR" if status == "error" else "INFO"
        logger.log(
            getattr(logging, level),
            f"Span ended: {trace.span_name} (duration: {trace.duration_ms():.1f}ms)",
            extra={"trace_id": trace.trace_id, "span_id": trace.span_id}
        )
    
    def record_metric(self, metric_name: str, value: int = 1):
        """记录指标"""
        self.metrics[metric_name] += value
    
    @staticmethod
    def _generate_id(length: int = 16) -> str:
        """生成 trace_id 和 span_id"""
        return ''.join(str(random.randint(0, 9)) for _ in range(length))
    
    def get_summary(self) -> dict:
        """获取可观测性摘要"""
        total_duration = sum(t.duration_ms() for t in self.traces)
        errors = [t for t in self.traces if t.status == "error"]
        
        return {
            "total_spans": len(self.traces),
            "total_duration_ms": total_duration,
            "error_count": len(errors),
            "error_rate": len(errors) / max(1, len(self.traces)),
            "metrics": dict(self.metrics),
            "traces": [t.to_dict() for t in self.traces[-10:]],  # 最后 10 个 span
        }


class ProductionAgent:
    """生产级 Agent —— 加入错误处理、成本追踪、可观测性"""
    
    def __init__(
        self,
        model: str = "gpt-4o-mini",
        max_iterations: int = 10,
        retry_policy: RetryPolicy = RetryPolicy.EXPONENTIAL_BACKOFF,
        max_retries: int = 3,
        token_budget: int = 50000,
    ):
        self.model = model
        self.max_iterations = max_iterations
        self.retry_policy = retry_policy
        self.max_retries = max_retries
        self.token_budget = token_budget
        
        self.cost = CostMetrics()
        self.obs = Observability()
        self.trace_id = None
    
    def run(self, user_input: str) -> dict:
        """主入口，包含完整的错误处理和追踪"""
        self.trace_id = self.obs._generate_id()
        main_span = self.obs.start_span("agent.run", self.trace_id)
        
        try:
            # 检查 token 预算
            if self.cost.total_tokens > self.token_budget:
                raise RuntimeError(f"Token 预算已耗尽：{self.cost.total_tokens}/{self.token_budget}")
            
            result = self._execute_with_retry(user_input)
            self.obs.end_span(main_span, "success")
            
            return {
                "success": True,
                "result": result,
                "cost": self.cost.to_dict(),
                "observability": self.obs.get_summary(),
            }
        
        except Exception as e:
            self.obs.end_span(main_span, "error", str(e))
            logger.error(
                f"Agent execution failed: {str(e)}",
                extra={"trace_id": self.trace_id, "span_id": main_span.span_id}
            )
            
            return {
                "success": False,
                "error": str(e),
                "cost": self.cost.to_dict(),
                "observability": self.obs.get_summary(),
            }
    
    def _execute_with_retry(self, user_input: str) -> str:
        """带重试的执行逻辑（指数退避）"""
        last_error = None
        
        for attempt in range(self.max_retries):
            try:
                return self._execute_loop(user_input)
            except Exception as e:
                last_error = e
                
                if attempt < self.max_retries - 1:
                    # 计算退避时间
                    if self.retry_policy == RetryPolicy.EXPONENTIAL_BACKOFF:
                        wait_time = 2 ** attempt + random.uniform(0, 1)
                    else:
                        wait_time = attempt + random.uniform(0, 1)
                    
                    logger.warning(
                        f"Attempt {attempt + 1} failed, retrying in {wait_time:.1f}s: {str(e)}",
                        extra={"trace_id": self.trace_id}
                    )
                    time.sleep(wait_time)
        
        raise last_error
    
    def _execute_loop(self, user_input: str) -> str:
        """核心控制循环"""
        loop_span = self.obs.start_span("agent.loop", self.trace_id)
        
        try:
            messages = [
                {"role": "system", "content": "You are a helpful assistant with tools."},
                {"role": "user", "content": user_input},
            ]
            
            for iteration in range(self.max_iterations):
                iteration_span = self.obs.start_span(f"agent.iteration.{iteration}", self.trace_id)
                
                try:
                    # 模拟 LLM 调用（实际环境中调用真实 API）
                    response_text = self._mock_llm_call(messages, user_input)
                    
                    # 累加 token 消耗
                    estimated_tokens = len(response_text.split())
                    self.cost.add(
                        prompt_tokens=len(user_input.split()) * 2,
                        completion_tokens=estimated_tokens,
                        model=self.model
                    )
                    
                    # 预算检查
                    if self.cost.total_tokens > self.token_budget:
                        raise RuntimeError(f"Token 预算耗尽：{self.cost.total_tokens}/{self.token_budget}")
                    
                    # 模拟完成
                    iteration_span.attributes = {
                        "iteration": iteration,
                        "tokens_used": estimated_tokens,
                        "cumulative_tokens": self.cost.total_tokens,
                    }
                    
                    self.obs.end_span(iteration_span, "success")
                    self.obs.record_metric("agent.iterations")
                    
                    return response_text
                
                except Exception as e:
                    self.obs.end_span(iteration_span, "error", str(e))
                    self.obs.record_metric("agent.iteration_errors")
                    raise
            
            # 超出最大迭代数
            error_msg = f"超过最大迭代次数：{self.max_iterations}"
            self.obs.end_span(loop_span, "error", error_msg)
            raise RuntimeError(error_msg)
        
        except Exception as e:
            self.obs.end_span(loop_span, "error", str(e))
            raise
    
    def _mock_llm_call(self, messages: list, user_input: str) -> str:
        """模拟 LLM 调用（实际环境中使用 OpenAI API）"""
        # 这里应该调用 openai.chat.completions.create()
        # 为了演示，我们返回模拟响应
        
        response_span = self.obs.start_span("llm.chat_completions", self.trace_id)
        
        try:
            # 模拟延迟
            time.sleep(0.1)
            
            response_text = f"基于用户输入 '{user_input[:30]}...' 的模拟响应。"
            
            response_span.attributes = {
                "model": self.model,
                "tokens_estimated": len(response_text.split()),
            }
            
            self.obs.end_span(response_span, "success")
            return response_text
        
        except Exception as e:
            self.obs.end_span(response_span, "error", str(e))
            raise


# 使用示例
if __name__ == "__main__":
    agent = ProductionAgent(
        model="gpt-4o-mini",
        max_iterations=5,
        retry_policy=RetryPolicy.EXPONENTIAL_BACKOFF,
        max_retries=2,
        token_budget=10000,
    )
    
    result = agent.run("分析一下我的销售数据")
    
    print("执行结果：")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("\n成本估算：")
    print(f"  - 总 tokens：{result['cost']['total_tokens']}")
    print(f"  - 预估费用：${result['cost']['estimated_cost_usd']}")
    print("\n可观测性摘要：")
    print(f"  - Span 总数：{result['observability']['total_spans']}")
    print(f"  - 错误率：{result['observability']['error_rate']:.1%}")
    print(f"  - 总耗时：{result['observability']['total_duration_ms']:.1f}ms")
```

### 10.2 代码关键特性说明

**1. 指数退避重试（Exponential Backoff）**

当 API 调用失败时，不是立即重试，而是等待一段时间后重试。等待时间按指数增长：

- 第 1 次失败：等待 2^0 + 随机 = ~1s
- 第 2 次失败：等待 2^1 + 随机 = ~2-3s
- 第 3 次失败：等待 2^2 + 随机 = ~4-5s

这样可以避免"雪崩"（一个故障导致大量重试，加重服务器负担）。

**2. Token 成本追踪**

```python
self.cost.add(
    prompt_tokens=input_tokens,
    completion_tokens=output_tokens,
    model=self.model
)

# 自动计算成本
cost_usd = self.cost.calculate_cost("gpt-4o-mini")  # USD 结算
```

生产系统需要实时知道每个请求的成本，这样才能设置合理的预算告警。

**3. 结构化日志与 OpenTelemetry 追踪**

```python
logger.info(
    "Span started",
    extra={"trace_id": "abc123", "span_id": "def456"}
)
```

这种结构化日志可以被 ELK、Datadog 等日志系统解析，便于在生产环境中排查问题。Trace ID 将不同 span 关联起来，形成完整的执行链路。

**4. Token 预算控制**

```python
if self.cost.total_tokens > self.token_budget:
    raise RuntimeError("Token 预算耗尽")
```

防止某个失控的 Agent 消耗无限 token，导致账单爆炸。

---

**总结**：从 Level 0 到 Level 5 的演进，本质上是不断增加系统的"智能度"和"可靠性"。但每一步都要考虑成本——无论是工程成本（代码复杂度）还是运营成本（token 消耗）。第 8-10 节的内容就是帮助你做出这个权衡的决策框架。

---

---

## 11. 结语与后续预告

本文作为系列开篇，建立了三个关键认知：

1. **LLM 是函数，Agent 是系统**。从函数到系统，需要补齐 Memory、Tools、Planner、Runtime 四个维度。
2. **Agent 的核心是控制循环**。Observe → Think → Plan → Act → Reflect → Update。循环赋予了 Agent 迭代解决问题的能力。
3. **Agent 不是银弹**。选择 Agent 是一个架构决策，需要在能力与复杂度之间做出权衡。

在接下来的文章中，我们将逐层深入：

- **下一篇（02）**：From Prompt to Agent —— 我们将用更严格的方式论证"为什么 LLM 本身不是 Agent"，并深入讨论从 Prompt Engineering 到 Agent Engineering 的思维转换。
- **第 03 篇**：Agent vs Workflow vs Automation —— 你的场景到底该用 Agent、DAG 还是规则引擎？我们会给出一个清晰的决策框架。
- **第 04 篇**：The Agent Control Loop —— 深入控制循环的每一个环节，讨论状态管理、中断恢复、错误处理的工程细节。

整个系列的目标不是教你使用某个框架的 API，而是帮你建立**从第一性原理理解 Agentic 系统**的能力。框架会变，API 会变，但系统设计的基本原理不会变。

---

> **系列导航**：本文是 Agentic 系列的第 01 篇。
>
> - 下一篇：[02 | From Prompt to Agent](/blog/engineering/agentic/02-From%20Prompt%20to%20Agent)
> - 完整目录见第 5 节
