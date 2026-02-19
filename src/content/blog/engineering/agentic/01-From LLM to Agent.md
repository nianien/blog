---
title: "From LLM to Agent: Agentic 系统的知识地图"
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

## 8. 结语与后续预告

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
