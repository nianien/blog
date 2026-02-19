---
title: "Multi-Agent Collaboration: 多 Agent 协作模式与架构"
pubDate: "2026-01-17"
description: "单个 Agent 的能力有天花板——Context Window 有限、专业化受限、单点故障、串行瓶颈。本文系统拆解多 Agent 协作的四种核心模式（Supervisor-Worker、Peer-to-Peer、Pipeline、Dynamic Routing），深入 Agent 间通信机制、状态管理、错误处理与成本控制，并用 Python 从零实现一个 Supervisor-Worker 协作框架。"
tags: ["Agentic", "AI Engineering", "Multi-Agent"]
---

# Multi-Agent Collaboration: 多 Agent 协作模式与架构

> 一个人可以走得很快，但一群人才能走得很远。Agent 也是如此。
>
> 本文是 Agentic 系列第 11 篇。前 10 篇我们一直在讨论单个 Agent 如何更聪明——更好的记忆、更强的工具、更深的规划。这一篇，我们把视角从"个体智能"拉升到"集体智能"：当一个 Agent 不够用时，多个 Agent 如何协作？

---

## 1. 为什么单 Agent 不够

### 1.1 一个类比：从独立开发者到工程团队

想象你是一个全栈工程师，独自完成一个项目。前端、后端、数据库、DevOps、测试、文档——全部一个人扛。小项目可以，但当系统规模增长到一定程度，你会发现：

- **注意力是瓶颈**：你不可能同时想着 CSS 布局和数据库索引优化
- **专业化有上限**：一个人很难同时成为安全专家、性能专家和 UX 专家
- **效率有天花板**：就算你是 10x 工程师，你的时间也是串行的
- **单点风险**：你生病了，整个项目就停了

这就是人类发明"团队协作"的原因。Agent 面临完全相同的结构性限制。

### 1.2 Single-Agent 的四个天花板

**天花板一：Context Window 限制**

一个 Agent 的 System Prompt 需要包含：角色定义、工具描述、输出格式约束、领域知识、示例。当你试图让一个 Agent 同时承担搜索、分析、写作、代码生成、数据可视化等多个职能时，光是工具描述就可能占据数万 token。留给实际任务执行的上下文空间被严重压缩。

```
一个"全能" Agent 的 Context 分配：

┌─────────────────────────────────────────────────┐
│ System Prompt (角色 + 规则)         ~2,000 tokens │
│ Tool Schemas (15 个工具)            ~6,000 tokens │
│ 领域知识 (RAG 检索结果)             ~4,000 tokens │
│ 对话历史                            ~8,000 tokens │
│ 当前任务 + 中间状态                 ~3,000 tokens │
├─────────────────────────────────────────────────┤
│ 剩余可用空间                        ~9,000 tokens │ ← 越来越捉襟见肘
│ (128K 窗口下比例更好，但工具越多问题越突出)         │
└─────────────────────────────────────────────────┘
```

更关键的是，研究表明 LLM 在超长上下文中存在"Lost in the Middle"问题——中间位置的信息检索准确率显著下降。塞得越多，每条信息被有效利用的概率越低。

**天花板二：专业化限制**

一个 System Prompt 很难让 LLM 同时扮演好多个角色。你告诉它"你是一个严谨的数据分析师"，它分析数据时很好；但同一个 prompt 里你又说"你也是一个有创意的文案写手"，这两种人格的行为模式是矛盾的。严谨和创意在同一个 prompt 中互相干扰，最终两个角色都做不好。

这不是 prompt engineering 的技巧问题，而是注意力分配的结构性问题——一个 LLM 调用只有一个 attention 分布，强调了分析的严谨性，就必然削弱了文案的创造性。

**天花板三：可靠性限制**

单 Agent 是一个 Single Point of Failure。如果它在第 5 步推理出错（比如工具调用参数写错），整个任务链路都会受到污染。虽然我们在第 10 篇讨论了 Reflection 和自我纠错，但自我纠错的前提是"能发现自己错了"——而 LLM 对自身错误的检测能力是有限的。

**天花板四：并行度限制**

单 Agent 的执行是串行的——一次 LLM 调用，等待结果，再进行下一次。如果一个任务可以分解为三个独立子任务（比如同时搜索三个数据源），单 Agent 只能顺序执行，浪费了大量时间。

```
Single-Agent 串行执行：

  Task ──→ [Search A] ──→ [Search B] ──→ [Search C] ──→ [Synthesize]
                                                         Total: ~40s

Multi-Agent 并行执行：

           ┌─→ [Search A] ─┐
  Task ──→ ├─→ [Search B] ─┼──→ [Synthesize]
           └─→ [Search C] ─┘
                              Total: ~15s
```

---

## 2. Multi-Agent 的四种协作模式

当我们决定使用多个 Agent 时，第一个架构问题是：**它们之间的协作关系是什么？** 不同的关系模式适用于不同的场景，选错模式比用错框架更致命。

### 2.1 模式一：Supervisor-Worker（上级分配型）

```
                    ┌──────────────────┐
                    │    Supervisor    │
                    │   (任务分解 +    │
                    │    结果合成)     │
                    └──────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │ Worker A │ │ Worker B │ │ Worker C │
       │ (搜索)   │ │ (分析)   │ │ (写作)   │
       └──────────┘ └──────────┘ └──────────┘
              │            │            │
              └────────────┼────────────┘
                           │
                           ▼
                    ┌──────────────────┐
                    │    Supervisor    │
                    │   (收集 + 合成   │
                    │    最终输出)     │
                    └──────────────────┘
```

**工作流程**：

1. Supervisor Agent 接收用户任务
2. Supervisor 将任务分解为子任务，分配给不同的 Worker Agent
3. 每个 Worker 独立执行各自的子任务
4. Supervisor 收集所有 Worker 的结果，合成最终输出

**核心特征**：

- 有一个明确的中央协调者
- Worker 之间不直接通信，只与 Supervisor 交互
- Supervisor 负责全局决策，Worker 负责局部执行

**适用场景**：任务可以明确分解的场景。比如撰写一篇技术调研报告：Search Agent 负责信息搜集，Analyze Agent 负责数据分析，Write Agent 负责报告撰写。Supervisor 负责协调整个流程。

**Trade-off**：Supervisor 是单点——如果 Supervisor 对任务的分解不合理，所有 Worker 的努力都会被浪费。此外，Supervisor 本身也是一个 LLM 调用，它对任务的理解能力决定了整个系统的上限。

### 2.2 模式二：Peer-to-Peer（平等协商型）

```
       ┌──────────┐          ┌──────────┐
       │ Agent A  │◀────────▶│ Agent B  │
       │ (作者)   │          │ (审稿人) │
       └────┬─────┘          └────┬─────┘
            │                     │
            │    ┌──────────┐     │
            └───▶│ Agent C  │◀────┘
                 │ (编辑)   │
                 └──────────┘

       消息流是双向的，没有固定的上下级关系
       每个 Agent 都可以发起对话、提出意见、做出决策
```

**工作流程**：

1. 多个 Agent 地位平等，通过消息传递进行协商
2. 没有中央协调者——Agent 之间直接通信
3. 通过多轮对话达成共识或完成任务

**核心特征**：

- 去中心化
- Agent 之间直接消息传递
- 适合需要多视角碰撞的任务

**适用场景**：辩论式分析（多个 Agent 从不同立场论证）、代码审查（Author Agent 写代码，Reviewer Agent 审查，双方来回沟通直到代码质量达标）、多角度决策（乐观分析师 + 悲观分析师 + 风险评估师共同评估一个投资决策）。

**Trade-off**：没有中央协调意味着可能出现无限循环（两个 Agent 互相不同意，永远达不成共识）。需要额外的终止机制——最大轮次限制、外部仲裁者、投票制度等。调试也更困难，因为没有一个中心节点可以观察全局状态。

### 2.3 模式三：Pipeline（流水线型）

```
  Input                                                          Output
    │                                                              ▲
    ▼                                                              │
┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
│ Draft  │───▶│ Review │───▶│  Edit  │───▶│  Fact  │───▶│ Format │
│ Agent  │    │ Agent  │    │ Agent  │    │ Check  │    │ Agent  │
│        │    │        │    │        │    │ Agent  │    │        │
└────────┘    └────────┘    └────────┘    └────────┘    └────────┘

  Stage 1       Stage 2       Stage 3       Stage 4       Stage 5
  生成初稿      审查质量       修改完善      事实核查       格式化输出
```

**工作流程**：

1. Agent 按顺序串联，形成流水线
2. 上游 Agent 的输出是下游 Agent 的输入
3. 每个 Agent 专注于一个处理阶段

**核心特征**：

- 类似 Unix 管道：`cmd1 | cmd2 | cmd3`
- 数据单向流动
- 每个阶段的 Agent 有明确、单一的职责

**适用场景**：内容生产流水线（起草 -> 审查 -> 编辑 -> 排版）、数据处理管道（提取 -> 清洗 -> 转换 -> 加载）、多阶段审批（初审 -> 复审 -> 终审）。

**Trade-off**：流水线是严格串行的——上游不完成，下游无法开始。如果中间某个 Agent 输出质量差，后续所有阶段都会受影响（错误传播）。但好处是架构简单、易于理解和调试、每个阶段可以独立优化。

### 2.4 模式四：Dynamic Routing（动态路由型）

```
                    ┌──────────────────┐
                    │   Router Agent   │
                    │ (意图识别 + 路由) │
                    └──────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │ 技术支持  │ │ 售后服务  │ │ 销售咨询  │
       │ Agent    │ │ Agent    │ │ Agent    │
       │          │ │          │ │          │
       │ 处理技术  │ │ 处理退款  │ │ 处理购买  │
       │ 故障排查  │ │ 换货投诉  │ │ 产品推荐  │
       └──────────┘ └──────────┘ └──────────┘

  路由依据：用户输入的意图分类
  每个专家 Agent 有独立的 System Prompt、Tools、知识库
```

**工作流程**：

1. Router Agent 接收用户输入
2. 根据意图分类，将请求路由到对应的专家 Agent
3. 专家 Agent 处理请求并返回结果
4. 必要时 Router 可以在专家之间进行二次路由

**核心特征**：

- 一个轻量级的 Router 做决策
- 多个重量级的专家 Agent 做执行
- Router 可以用简单模型（快速、便宜），专家用强大模型（准确、深入）

**适用场景**：客服系统（技术问题 -> 技术 Agent，退款问题 -> 售后 Agent）、多领域知识问答（医疗问题 -> 医疗 Agent，法律问题 -> 法律 Agent）、代码助手（Python 问题 -> Python 专家，Rust 问题 -> Rust 专家）。

**Trade-off**：路由准确率是整个系统的瓶颈——路由错了，后面再专业也没用。模糊意图（"我买的东西有技术问题"——这是技术支持还是售后？）需要特殊处理。一种常见策略是允许 Router 在不确定时同时咨询多个专家，再综合判断。

### 2.5 四种模式的对比决策

| 维度 | Supervisor-Worker | Peer-to-Peer | Pipeline | Dynamic Routing |
|------|-------------------|--------------|----------|-----------------|
| 控制结构 | 中心化 | 去中心化 | 线性 | 分发型 |
| 通信模式 | 星形 | 网状 | 链式 | 扇出 |
| 并行度 | 高（Worker 并行） | 中 | 低（严格串行） | 高（请求级并行） |
| 适用复杂度 | 高 | 中 | 中 | 低-中 |
| 调试难度 | 中 | 高 | 低 | 低 |
| 典型场景 | 报告生成、项目规划 | 辩论、审查 | 内容流水线 | 客服、问答路由 |

**决策原则**：

- 任务可以并行分解 -> Supervisor-Worker
- 需要多视角碰撞 -> Peer-to-Peer
- 处理有明确阶段 -> Pipeline
- 请求类型多样，专家各有擅长 -> Dynamic Routing
- 不确定？先从最简单的 Pipeline 开始，逐步演进

---

## 3. Agent 间通信机制

多个 Agent 之间需要交换信息，通信机制的选择直接影响系统的可扩展性、耦合度和调试难度。

### 3.1 共享内存（Blackboard Pattern）

所有 Agent 读写同一个共享状态存储。这是最简单直接的通信方式。

```
       ┌──────────┐   ┌──────────┐   ┌──────────┐
       │ Agent A  │   │ Agent B  │   │ Agent C  │
       └────┬─────┘   └────┬─────┘   └────┬─────┘
            │  read/write   │  read/write   │
            ▼              ▼              ▼
       ┌──────────────────────────────────────────┐
       │           Shared Blackboard              │
       │                                          │
       │  { "search_results": [...],              │
       │    "analysis": {...},                    │
       │    "draft": "...",                       │
       │    "status": {"search": "done", ...} }   │
       └──────────────────────────────────────────┘
```

```python
from dataclasses import dataclass, field
from typing import Any
import threading


@dataclass
class Blackboard:
    """共享黑板：所有 Agent 的公共状态空间"""
    _state: dict[str, Any] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _history: list[dict] = field(default_factory=list)

    def read(self, key: str) -> Any:
        with self._lock:
            return self._state.get(key)

    def write(self, key: str, value: Any, author: str = "unknown"):
        with self._lock:
            self._history.append({
                "action": "write",
                "key": key,
                "author": author,
                "old_value": self._state.get(key),
                "new_value": value,
            })
            self._state[key] = value

    def read_all(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._state)
```

**优点**：实现简单，Agent 之间完全解耦（不需要知道彼此的存在），天然支持任意读写模式。

**缺点**：共享状态意味着潜在的竞争条件——两个 Agent 同时写同一个 key 怎么办？需要锁机制或更复杂的冲突解决策略。随着 Agent 数量增加，Blackboard 可能成为瓶颈。

### 3.2 消息传递（Message Passing）

Agent 之间通过显式的消息进行通信。每个 Agent 有自己的收件箱。

```
       ┌──────────┐         ┌──────────┐
       │ Agent A  │──msg───▶│ Agent B  │
       │          │◀──msg───│          │
       └──────────┘         └──────────┘
            │                     ▲
            │         msg         │
            ▼                     │
       ┌──────────┐              │
       │ Agent C  │──────msg─────┘
       └──────────┘
```

```python
from dataclasses import dataclass, field
from collections import defaultdict
from queue import Queue


@dataclass
class Message:
    sender: str
    receiver: str
    content: Any
    msg_type: str = "default"  # "task", "result", "feedback", "error"


class MessageBus:
    """点对点消息传递"""

    def __init__(self):
        self._queues: dict[str, Queue] = defaultdict(Queue)

    def send(self, message: Message):
        self._queues[message.receiver].put(message)

    def receive(self, agent_id: str, timeout: float = None) -> Message | None:
        try:
            return self._queues[agent_id].get(timeout=timeout)
        except Exception:
            return None

    def has_messages(self, agent_id: str) -> bool:
        return not self._queues[agent_id].empty()
```

**优点**：通信关系显式、可追踪、可审计。每条消息都有明确的发送者和接收者。

**缺点**：Agent 需要知道其他 Agent 的存在（至少知道 ID），耦合度比 Blackboard 高。如果通信拓扑复杂（多对多），消息管理会变得困难。

### 3.3 事件驱动（Event Bus）

Agent 通过发布/订阅事件进行间接通信。Agent 不需要知道谁会消费它的事件。

```
       ┌──────────┐   ┌──────────┐   ┌──────────┐
       │ Agent A  │   │ Agent B  │   │ Agent C  │
       │ pub: X   │   │ sub: X   │   │ sub: X,Y │
       └────┬─────┘   └────┬─────┘   └────┬─────┘
            │  publish      │  subscribe   │
            ▼              ▼              ▼
       ┌──────────────────────────────────────────┐
       │              Event Bus                    │
       │                                          │
       │  topic "search_done"  → [Agent B, C]     │
       │  topic "analysis_done" → [Agent C]        │
       │  topic "error"        → [Supervisor]      │
       └──────────────────────────────────────────┘
```

```python
from collections import defaultdict
from typing import Callable


class EventBus:
    """发布/订阅事件总线"""

    def __init__(self):
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)
        self._event_log: list[dict] = []

    def subscribe(self, topic: str, handler: Callable):
        self._subscribers[topic].append(handler)

    def publish(self, topic: str, data: Any, publisher: str = "unknown"):
        event = {"topic": topic, "data": data, "publisher": publisher}
        self._event_log.append(event)
        for handler in self._subscribers.get(topic, []):
            handler(event)

    def get_event_log(self) -> list[dict]:
        return list(self._event_log)
```

**优点**：Agent 之间完全解耦——发布者不知道有谁在监听，订阅者不知道事件从哪里来。扩展性好，新增 Agent 只需订阅相关事件。

**缺点**：事件流难以追踪——"这个事件是谁发的？谁处理了？处理结果在哪里？"调试时需要完整的事件日志。事件顺序可能不确定，需要额外的排序机制。

### 3.4 通信机制对比

| 维度 | Blackboard | Message Passing | Event Bus |
|------|-----------|----------------|-----------|
| 耦合度 | 低（通过 key 间接通信） | 中（需要知道目标 Agent） | 低（通过 topic 间接通信） |
| 实现复杂度 | 低 | 中 | 中 |
| 调试友好度 | 中（看状态快照） | 高（消息链路清晰） | 低（事件流分散） |
| 并发安全 | 需要锁/MVCC | 天然安全（队列隔离） | 需要考虑处理顺序 |
| 适用模式 | Supervisor-Worker | Peer-to-Peer | Pipeline, 事件驱动架构 |
| 可观测性 | 状态快照 | 消息轨迹 | 事件日志 |

**实践建议**：大多数 Multi-Agent 系统可以从 Blackboard 开始——它最简单，且对 Supervisor-Worker 模式特别友好。当系统复杂度增长到需要解耦 Agent 间关系时，再考虑 Event Bus。Message Passing 适合 Agent 之间有明确的、频繁的双向交互的场景。

---

## 4. 完整实现：Supervisor-Worker 协作框架

下面用 Python 从零实现一个 Supervisor-Worker 框架。这不依赖任何 Agent 框架，完全基于第一性原理构建。

### 4.1 基础抽象

```python
import json
import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


# ---- LLM 调用抽象（与具体 SDK 解耦）----

async def call_llm(
    messages: list[dict],
    model: str = "gpt-4o",
    response_format: dict | None = None,
) -> str:
    """LLM 调用的统一接口（简化版，生产中替换为真实 SDK 调用）"""
    import openai
    client = openai.AsyncOpenAI()
    kwargs = {"model": model, "messages": messages}
    if response_format:
        kwargs["response_format"] = response_format
    response = await client.chat.completions.create(**kwargs)
    return response.choices[0].message.content


# ---- 任务与结果的数据结构 ----

@dataclass
class Task:
    """一个可执行的子任务"""
    task_id: str
    description: str
    assigned_to: str = ""          # Worker Agent 名称
    context: dict = field(default_factory=dict)  # 来自上游的上下文
    status: str = "pending"        # pending | running | done | failed
    result: str = ""
    error: str = ""


@dataclass
class TeamResult:
    """团队执行的最终结果"""
    success: bool
    output: str
    tasks: list[Task]
    total_tokens: int = 0
    total_llm_calls: int = 0
```

### 4.2 Worker Agent

每个 Worker 是一个专注于特定领域的 Agent，拥有独立的 System Prompt 和能力边界。

```python
class WorkerAgent:
    """Worker Agent：接收子任务，独立执行，返回结果"""

    def __init__(self, name: str, system_prompt: str, model: str = "gpt-4o"):
        self.name = name
        self.system_prompt = system_prompt
        self.model = model
        self._call_count = 0

    async def execute(self, task: Task) -> Task:
        """执行一个子任务"""
        task.status = "running"
        task.assigned_to = self.name

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": self._build_prompt(task)},
        ]

        try:
            result = await call_llm(messages, model=self.model)
            self._call_count += 1
            task.result = result
            task.status = "done"
        except Exception as e:
            task.error = str(e)
            task.status = "failed"

        return task

    def _build_prompt(self, task: Task) -> str:
        prompt = f"## 任务\n{task.description}\n"
        if task.context:
            prompt += f"\n## 上下文信息\n{json.dumps(task.context, ensure_ascii=False, indent=2)}\n"
        prompt += "\n请完成上述任务，直接输出结果。"
        return prompt
```

### 4.3 Supervisor Agent

Supervisor 负责三件事：任务分解、任务分配、结果合成。

```python
DECOMPOSE_PROMPT = """你是一个任务分解专家。给定一个复杂任务，将其分解为可以独立执行的子任务。

可用的 Worker 及其能力：
{workers_description}

请将任务分解为子任务，并指定每个子任务应该分配给哪个 Worker。
输出 JSON 格式：
{{
  "subtasks": [
    {{
      "task_id": "task_1",
      "description": "具体的子任务描述",
      "assigned_to": "worker 名称",
      "depends_on": []
    }}
  ]
}}

注意：
- 每个子任务应该足够具体，让 Worker 能独立完成
- depends_on 标明依赖关系（某个子任务需要等另一个完成后才能开始）
- 尽可能让子任务并行执行以提高效率
"""

SYNTHESIZE_PROMPT = """你是一个结果合成专家。多个专业 Agent 已经分别完成了子任务。
请根据它们的结果，合成一个完整、连贯、高质量的最终输出。

原始任务：{original_task}

各子任务的执行结果：
{subtask_results}

请整合以上信息，生成最终的完整输出。确保：
1. 信息完整，没有遗漏
2. 逻辑连贯，前后一致
3. 去除重复内容
4. 保持专业质量
"""


class SupervisorAgent:
    """Supervisor Agent：任务分解、分配、合成"""

    def __init__(self, model: str = "gpt-4o"):
        self.model = model
        self._call_count = 0

    async def decompose(
        self, task: str, workers: dict[str, WorkerAgent]
    ) -> list[Task]:
        """将复杂任务分解为子任务"""
        workers_desc = "\n".join(
            f"- {name}: {w.system_prompt[:200]}"
            for name, w in workers.items()
        )

        messages = [
            {
                "role": "system",
                "content": DECOMPOSE_PROMPT.format(
                    workers_description=workers_desc
                ),
            },
            {"role": "user", "content": task},
        ]

        result = await call_llm(
            messages,
            model=self.model,
            response_format={"type": "json_object"},
        )
        self._call_count += 1

        parsed = json.loads(result)
        tasks = []
        for st in parsed.get("subtasks", []):
            tasks.append(Task(
                task_id=st["task_id"],
                description=st["description"],
                assigned_to=st.get("assigned_to", ""),
            ))
        return tasks

    async def synthesize(
        self, original_task: str, completed_tasks: list[Task]
    ) -> str:
        """合成所有 Worker 的结果"""
        results_text = "\n\n".join(
            f"### {t.task_id} ({t.assigned_to})\n{t.result}"
            for t in completed_tasks
            if t.status == "done"
        )

        messages = [
            {
                "role": "system",
                "content": SYNTHESIZE_PROMPT.format(
                    original_task=original_task,
                    subtask_results=results_text,
                ),
            },
            {"role": "user", "content": "请合成最终结果。"},
        ]

        result = await call_llm(messages, model=self.model)
        self._call_count += 1
        return result
```

### 4.4 AgentTeam：编排层

AgentTeam 管理多个 Agent 的生命周期、通信和执行流程。

```python
class AgentTeam:
    """Agent 团队：管理 Supervisor + Workers 的协作"""

    def __init__(self, supervisor: SupervisorAgent):
        self.supervisor = supervisor
        self.workers: dict[str, WorkerAgent] = {}
        self.blackboard = Blackboard()
        self.execution_log: list[dict] = []

    def add_worker(self, worker: WorkerAgent):
        self.workers[worker.name] = worker

    async def run(self, task: str, max_retries: int = 2) -> TeamResult:
        """执行完整的 Multi-Agent 协作流程"""
        self._log("team", f"接收任务: {task[:100]}...")

        # Phase 1: Supervisor 分解任务
        self._log("supervisor", "开始任务分解")
        subtasks = await self.supervisor.decompose(task, self.workers)
        self._log("supervisor", f"分解为 {len(subtasks)} 个子任务")

        for st in subtasks:
            self._log("supervisor", f"  {st.task_id} -> {st.assigned_to}: {st.description[:80]}")

        # Phase 2: Workers 并行执行（考虑依赖关系）
        completed = await self._execute_tasks(subtasks, max_retries)

        # Phase 3: Supervisor 合成结果
        self._log("supervisor", "开始合成结果")
        final_output = await self.supervisor.synthesize(task, completed)
        self._log("supervisor", "合成完成")

        # 汇总统计
        total_calls = self.supervisor._call_count + sum(
            w._call_count for w in self.workers.values()
        )

        return TeamResult(
            success=all(t.status == "done" for t in completed),
            output=final_output,
            tasks=completed,
            total_llm_calls=total_calls,
        )

    async def _execute_tasks(
        self, tasks: list[Task], max_retries: int
    ) -> list[Task]:
        """执行子任务，支持并行和重试"""
        completed = []
        pending = list(tasks)

        while pending:
            # 找出当前可以执行的任务（依赖已满足）
            ready = []
            still_pending = []
            completed_ids = {t.task_id for t in completed}

            for task in pending:
                deps = task.context.get("depends_on", [])
                if all(d in completed_ids for d in deps):
                    ready.append(task)
                else:
                    still_pending.append(task)

            if not ready:
                # 没有可执行的任务但还有待处理的 -> 可能存在循环依赖
                self._log("team", "警告: 检测到无法满足的依赖关系")
                break

            # 并行执行所有就绪的任务
            results = await asyncio.gather(*[
                self._execute_single(task, max_retries)
                for task in ready
            ])

            for task in results:
                completed.append(task)
                # 将结果写入 Blackboard，供后续任务使用
                if task.status == "done":
                    self.blackboard.write(
                        task.task_id, task.result, author=task.assigned_to
                    )

            pending = still_pending

        return completed

    async def _execute_single(
        self, task: Task, max_retries: int
    ) -> Task:
        """执行单个任务，带重试"""
        worker = self.workers.get(task.assigned_to)
        if not worker:
            task.status = "failed"
            task.error = f"未找到 Worker: {task.assigned_to}"
            return task

        # 将 Blackboard 上的相关信息注入任务上下文
        task.context["blackboard"] = self.blackboard.read_all()

        for attempt in range(max_retries + 1):
            self._log(worker.name, f"执行 {task.task_id} (尝试 {attempt + 1})")
            result = await worker.execute(task)

            if result.status == "done":
                self._log(worker.name, f"{task.task_id} 完成")
                return result

            self._log(worker.name, f"{task.task_id} 失败: {result.error}")

            if attempt < max_retries:
                self._log(worker.name, f"准备重试 {task.task_id}")

        return result

    def _log(self, source: str, message: str):
        entry = {"source": source, "message": message}
        self.execution_log.append(entry)
```

### 4.5 组装示例：技术调研报告

```python
async def main():
    """示例：用 Multi-Agent 团队撰写一篇技术调研报告"""

    # 创建 Supervisor
    supervisor = SupervisorAgent(model="gpt-4o")

    # 创建专业化的 Worker Agent
    search_agent = WorkerAgent(
        name="searcher",
        system_prompt=(
            "你是一个信息搜索专家。你的任务是根据给定的主题，"
            "整理出全面的信息摘要，包括关键事实、数据、案例。"
            "输出结构化的搜索结果，标注来源和可信度。"
        ),
    )

    analyze_agent = WorkerAgent(
        name="analyst",
        system_prompt=(
            "你是一个技术分析专家。你的任务是根据搜索结果和原始数据，"
            "进行深度分析，提炼洞察，识别趋势、风险和机会。"
            "输出包含数据支撑的分析报告。"
        ),
    )

    write_agent = WorkerAgent(
        name="writer",
        system_prompt=(
            "你是一个技术写作专家。你的任务是根据分析结果，"
            "撰写结构清晰、逻辑严谨、可读性强的技术报告。"
            "确保使用专业术语，并配有合适的章节结构。"
        ),
    )

    # 组建团队
    team = AgentTeam(supervisor=supervisor)
    team.add_worker(search_agent)
    team.add_worker(analyze_agent)
    team.add_worker(write_agent)

    # 执行任务
    result = await team.run(
        "撰写一篇关于 LLM Agent 在企业客服场景落地的技术调研报告，"
        "包括行业现状、主流技术方案对比、落地挑战和建议。"
    )

    print(f"成功: {result.success}")
    print(f"LLM 调用次数: {result.total_llm_calls}")
    print(f"\n最终输出:\n{result.output[:500]}...")

    # 查看执行日志
    print("\n执行链路:")
    for entry in team.execution_log:
        print(f"  [{entry['source']}] {entry['message']}")


# asyncio.run(main())
```

这段代码展示了核心的协作模式。生产系统中还需要补充：Token 用量追踪、超时控制、Worker 健康检查、结果缓存等。但架构骨架已经清晰——Supervisor 负责全局调度，Worker 负责局部执行，Blackboard 负责状态共享，AgentTeam 负责生命周期管理。

---

## 5. 状态管理的复杂性

Multi-Agent 系统的状态管理比 Single-Agent 复杂一个数量级。核心难题在于：多个 Agent 同时操作状态，如何保证一致性。

### 5.1 共享状态 vs 独立状态

```
方案 A：共享状态                     方案 B：独立状态
┌─────────────────┐                ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Global State   │                │ State A  │  │ State B  │  │ State C  │
│                 │                │ (Agent A │  │ (Agent B │  │ (Agent C │
│ Agent A ──write │                │  独占)   │  │  独占)   │  │  独占)   │
│ Agent B ──write │                └──────────┘  └──────────┘  └──────────┘
│ Agent C ──write │                      │              │              │
└─────────────────┘                      └──────────────┼──────────────┘
                                                        ▼
                                                  合并/同步层
```

**共享状态**的优点是 Agent 之间信息同步即时，任何 Agent 都能看到最新全局状态。缺点是需要处理并发冲突。适合 Supervisor-Worker 模式——Supervisor 需要看到所有 Worker 的进度。

**独立状态**的优点是无并发问题，每个 Agent 完全自主。缺点是 Agent 之间信息同步有延迟，需要显式的合并机制。适合 Pipeline 模式——每个阶段独立处理，只在交接时传递状态。

### 5.2 冲突解决策略

当两个 Agent 同时修改同一个状态时，需要冲突解决。常见策略：

```python
class ConflictResolver:
    """状态冲突解决器"""

    @staticmethod
    def last_writer_wins(old_value, new_value_a, new_value_b, timestamp_a, timestamp_b):
        """最后写入者胜出——简单但可能丢失数据"""
        return new_value_a if timestamp_a > timestamp_b else new_value_b

    @staticmethod
    def merge_append(old_value, new_value_a, new_value_b):
        """合并追加——适用于列表类型的状态"""
        if isinstance(old_value, list):
            merged = list(old_value)
            if isinstance(new_value_a, list):
                merged.extend(new_value_a)
            if isinstance(new_value_b, list):
                merged.extend(new_value_b)
            return merged
        return new_value_b  # fallback

    @staticmethod
    async def llm_resolve(old_value, new_value_a, new_value_b, context: str):
        """用 LLM 判断如何合并冲突——最灵活但最贵"""
        prompt = (
            f"两个 Agent 同时修改了同一个状态。\n"
            f"原始值: {old_value}\n"
            f"Agent A 的修改: {new_value_a}\n"
            f"Agent B 的修改: {new_value_b}\n"
            f"上下文: {context}\n"
            f"请决定最终值应该是什么，并解释原因。"
        )
        return await call_llm([{"role": "user", "content": prompt}])
```

实践中，大多数 Multi-Agent 系统通过架构设计来避免冲突，而不是在运行时解决冲突。最有效的方法是**状态分区**——每个 Agent 只写自己负责的状态区域，避免多 Agent 写同一个 key。这也是 Supervisor-Worker 模式天然的优势：每个 Worker 写自己的结果 key，只有 Supervisor 读所有 key。

---

## 6. 错误处理与容错

Multi-Agent 系统的错误处理比 Single-Agent 更复杂，因为错误的传播路径更多。

### 6.1 Worker 失败

Worker 失败是最常见的情况。处理策略按优先级：

```
Worker 失败处理决策树：

  Worker 执行失败
       │
       ▼
  ┌─ 是否可重试？ ─── 是 ──→ 重试（最多 N 次）──→ 成功？──→ 继续
  │      │                                          │
  │     否                                         否
  │      │                                          │
  │      ▼                                          ▼
  │  ┌─ 有替代 Worker？ ─── 是 ──→ 分配给替代 Worker
  │  │      │
  │  │     否
  │  │      │
  │  │      ▼
  │  │  ┌─ 该子任务是关键路径？
  │  │  │      │            │
  │  │  │     是           否
  │  │  │      │            │
  │  │  │      ▼            ▼
  │  │  │  整体任务失败   降级处理（跳过该子任务，
  │  │  │                 标记结果为不完整）
```

```python
class ResilientAgentTeam(AgentTeam):
    """增强容错能力的 Agent 团队"""

    def __init__(self, supervisor: SupervisorAgent):
        super().__init__(supervisor)
        self.fallback_workers: dict[str, list[str]] = {}  # Worker 降级链

    def set_fallback(self, worker_name: str, fallbacks: list[str]):
        """设置 Worker 的降级替代链"""
        self.fallback_workers[worker_name] = fallbacks

    async def _execute_single(self, task: Task, max_retries: int) -> Task:
        """增强版：支持 Worker 降级"""
        # 尝试主 Worker
        result = await super()._execute_single(task, max_retries)
        if result.status == "done":
            return result

        # 主 Worker 失败，尝试降级 Worker
        fallbacks = self.fallback_workers.get(task.assigned_to, [])
        for fb_name in fallbacks:
            self._log("team", f"降级: {task.assigned_to} -> {fb_name}")
            task.assigned_to = fb_name
            task.status = "pending"
            task.error = ""
            result = await super()._execute_single(task, max_retries=1)
            if result.status == "done":
                return result

        return result
```

### 6.2 Supervisor 失败

Supervisor 失败更严重——它是中央协调者，失败意味着整个任务无法继续。处理策略：

- **外部监控**：在 AgentTeam 之上设置一个非 LLM 的监控层，检测 Supervisor 的健康状态
- **Supervisor 冗余**：准备一个备用 Supervisor（可以用不同的模型），主 Supervisor 失败时切换
- **Checkpoint 机制**：Supervisor 在每个决策点保存状态快照，失败后从最近的 Checkpoint 恢复

```python
async def run_with_checkpoint(self, task: str) -> TeamResult:
    """带 Checkpoint 的执行流程"""
    checkpoint = {"phase": "init", "subtasks": [], "completed": []}

    try:
        # Phase 1: 分解
        checkpoint["phase"] = "decompose"
        subtasks = await self.supervisor.decompose(task, self.workers)
        checkpoint["subtasks"] = subtasks

        # Phase 2: 执行
        checkpoint["phase"] = "execute"
        completed = await self._execute_tasks(subtasks, max_retries=2)
        checkpoint["completed"] = completed

        # Phase 3: 合成
        checkpoint["phase"] = "synthesize"
        output = await self.supervisor.synthesize(task, completed)

        return TeamResult(success=True, output=output, tasks=completed)

    except Exception as e:
        self._log("team", f"失败于阶段 {checkpoint['phase']}: {e}")
        # 可以从 checkpoint 恢复，跳过已完成的阶段
        return TeamResult(
            success=False,
            output=f"任务在 {checkpoint['phase']} 阶段失败: {e}",
            tasks=checkpoint.get("completed", []),
        )
```

### 6.3 死锁检测

在 Peer-to-Peer 模式中，两个 Agent 可能互相等待对方的回复，形成死锁。

```
死锁场景：

  Agent A: "请 Agent B 先确认方案"
           ↓ 等待 B
  Agent B: "请 Agent A 先提供数据"
           ↓ 等待 A
  → 无限等待
```

解决方案：

```python
class DeadlockDetector:
    """简单的死锁检测器"""

    def __init__(self, timeout_seconds: float = 60):
        self.timeout = timeout_seconds
        self._waiting: dict[str, str] = {}  # agent_id -> waiting_for_agent_id

    def register_wait(self, agent_id: str, waiting_for: str):
        self._waiting[agent_id] = waiting_for
        # 检测环形等待
        if self._has_cycle(agent_id):
            raise DeadlockError(
                f"检测到死锁: {self._trace_cycle(agent_id)}"
            )

    def _has_cycle(self, start: str) -> bool:
        visited = set()
        current = start
        while current in self._waiting:
            if current in visited:
                return True
            visited.add(current)
            current = self._waiting[current]
        return False

    def _trace_cycle(self, start: str) -> str:
        chain = [start]
        current = self._waiting.get(start, "")
        while current != start and current:
            chain.append(current)
            current = self._waiting.get(current, "")
        chain.append(start)
        return " -> ".join(chain)


class DeadlockError(Exception):
    pass
```

---

## 7. Multi-Agent 的成本问题

成本是 Multi-Agent 系统必须正视的问题。它不只是"贵一点"的问题——可能是"贵一个数量级"的问题。

### 7.1 成本模型

```
Single-Agent 执行一个任务的 Token 消耗：

  1 x System Prompt   +  N x (Context + Response)
  ~1,000 tokens          ~3,000 tokens x 5 iterations
                         = ~16,000 tokens


Multi-Agent (Supervisor + 3 Workers) 的 Token 消耗：

  Supervisor 分解:   ~4,000 tokens   (System Prompt + 任务分解)
  Worker A 执行:     ~8,000 tokens   (System Prompt + 执行)
  Worker B 执行:     ~8,000 tokens   (System Prompt + 执行)
  Worker C 执行:     ~8,000 tokens   (System Prompt + 执行)
  Supervisor 合成:   ~6,000 tokens   (收集所有结果 + 合成)
                     ──────────────
  Total:             ~34,000 tokens   ← 约 2x Single-Agent

  如果 Worker 内部也有多轮迭代，消耗会更高。
```

### 7.2 什么时候 Multi-Agent 的收益大于成本

不是所有场景都值得用 Multi-Agent。一个简单的决策框架：

```
                        任务复杂度
                    低 ─────────── 高
                    │               │
  专业化需求  低    │  Single-Agent │  Single-Agent
              │    │  (够用)       │  + Better Prompt
              │    │               │
              高    │  Single-Agent │  Multi-Agent ✓
                    │  + Tools      │  (值得投入)
                    │               │
```

Multi-Agent 在以下条件下收益最大：

1. **任务天然可并行**：子任务之间独立性高，Multi-Agent 通过并行执行缩短总耗时，即使 token 消耗增加，时间成本下降
2. **专业化收益显著**：专家 Agent 在自己的领域比通用 Agent 的输出质量显著更高，质量提升值得额外成本
3. **Single-Agent 已经到达能力瓶颈**：Context Window 不够、单个 prompt 角色冲突、输出质量不稳定
4. **任务的商业价值足够高**：生成一份价值数万元的分析报告，多花几美元的 API 费用是可以接受的

### 7.3 成本优化策略

```python
class CostAwareTeam(AgentTeam):
    """成本感知的 Agent 团队"""

    def __init__(self, supervisor, token_budget: int = 100_000):
        super().__init__(supervisor)
        self.token_budget = token_budget
        self.token_used = 0

    def _select_model_for_task(self, task: Task) -> str:
        """根据任务复杂度选择模型——不是所有子任务都需要最强模型"""
        if task.context.get("complexity") == "low":
            return "gpt-4o-mini"     # 简单任务用小模型
        elif task.context.get("complexity") == "high":
            return "gpt-4o"          # 复杂任务用大模型
        else:
            return "gpt-4o-mini"     # 默认用小模型，够用即可

    def _should_continue(self) -> bool:
        """预算检查"""
        if self.token_used >= self.token_budget:
            self._log("team", f"Token 预算耗尽 ({self.token_used}/{self.token_budget})")
            return False
        return True
```

关键原则：**Router 和 Supervisor 可以用轻量模型，只有需要深度推理的 Worker 才用重量级模型。** 这类似人类组织中，项目经理不需要是技术最强的人，但专家必须在各自领域足够专业。

---

## 8. Multi-Agent 的调试挑战

Multi-Agent 系统的调试难度是 Single-Agent 的平方级增长——不仅每个 Agent 内部可能出错，Agent 之间的交互也可能出错。

### 8.1 执行链路追踪

每次 Multi-Agent 执行都应该生成一个完整的 Trace，记录每个 Agent 的每次 LLM 调用、输入、输出和耗时。

```python
import time
import uuid
from dataclasses import dataclass, field


@dataclass
class Span:
    """一个执行跨度（对应一次 Agent 操作）"""
    span_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    parent_id: str = ""
    agent_name: str = ""
    operation: str = ""          # "decompose", "execute", "synthesize"
    input_summary: str = ""
    output_summary: str = ""
    start_time: float = 0.0
    end_time: float = 0.0
    token_count: int = 0
    status: str = "running"      # running | done | failed
    children: list = field(default_factory=list)

    @property
    def duration_ms(self) -> float:
        return (self.end_time - self.start_time) * 1000


class Tracer:
    """Multi-Agent 执行链路追踪器"""

    def __init__(self):
        self.root_span: Span | None = None
        self._span_stack: list[Span] = []

    def start_span(self, agent_name: str, operation: str, input_summary: str = "") -> Span:
        span = Span(
            agent_name=agent_name,
            operation=operation,
            input_summary=input_summary[:200],
            start_time=time.time(),
        )
        if self._span_stack:
            parent = self._span_stack[-1]
            span.parent_id = parent.span_id
            parent.children.append(span)
        else:
            self.root_span = span

        self._span_stack.append(span)
        return span

    def end_span(self, output_summary: str = "", status: str = "done"):
        if self._span_stack:
            span = self._span_stack.pop()
            span.end_time = time.time()
            span.output_summary = output_summary[:200]
            span.status = status

    def print_trace(self, span: Span = None, indent: int = 0):
        """打印可视化的执行链路"""
        span = span or self.root_span
        if not span:
            return

        prefix = "  " * indent
        status_icon = "OK" if span.status == "done" else "FAIL"
        print(
            f"{prefix}[{status_icon}] {span.agent_name}.{span.operation} "
            f"({span.duration_ms:.0f}ms)"
        )
        if span.input_summary:
            print(f"{prefix}  IN:  {span.input_summary[:80]}")
        if span.output_summary:
            print(f"{prefix}  OUT: {span.output_summary[:80]}")

        for child in span.children:
            self.print_trace(child, indent + 1)
```

输出示例：

```
[OK] supervisor.decompose (2340ms)
  IN:  撰写一篇关于 LLM Agent 在企业客服场景落地的技术调研报告...
  OUT: {"subtasks": [{"task_id": "task_1", ...}, ...]}
  [OK] searcher.execute (5120ms)
    IN:  搜索 LLM Agent 客服场景的行业现状和主流方案...
    OUT: ## 行业现状\n1. 2024 年全球智能客服市场规模...
  [OK] analyst.execute (4800ms)
    IN:  分析搜索结果，提炼关键洞察和趋势...
    OUT: ## 分析结论\n1. 技术成熟度：LLM 客服处于...
  [OK] writer.execute (6200ms)
    IN:  根据分析结果撰写完整的技术调研报告...
    OUT: # LLM Agent 企业客服落地技术调研报告\n\n## 1. 执行摘要...
[OK] supervisor.synthesize (3100ms)
  IN:  请合成最终结果。
  OUT: # LLM Agent 企业客服落地技术调研报告（终稿）...
```

### 8.2 Bug 复现

Multi-Agent 场景的 bug 复现特别困难，因为：

- LLM 输出是非确定性的——相同输入可能产生不同输出
- Agent 之间的交互是动态的——执行路径取决于中间结果
- 并发执行的时序不确定——Worker A 和 B 谁先完成可能影响最终结果

应对策略：

1. **记录完整的 LLM 输入/输出**：在 Trace 中保存每次 LLM 调用的完整 messages 和 response，不只是摘要
2. **Deterministic Replay**：用固定的 seed 和 temperature=0 复现执行，或者直接 mock LLM 响应
3. **快照式调试**：在每个 Agent 决策点保存完整的 Blackboard 状态快照，出问题时可以回溯到任意时间点

```python
class ReplayableTeam(AgentTeam):
    """可回放的 Agent 团队——记录完整的 LLM 交互供复现"""

    def __init__(self, supervisor):
        super().__init__(supervisor)
        self._llm_recordings: list[dict] = []

    def record_llm_call(self, agent_name: str, messages: list[dict], response: str):
        self._llm_recordings.append({
            "agent": agent_name,
            "messages": messages,
            "response": response,
            "timestamp": time.time(),
        })

    def save_recording(self, path: str):
        """保存录制数据，用于后续回放和调试"""
        with open(path, "w") as f:
            json.dump(self._llm_recordings, f, ensure_ascii=False, indent=2)
```

### 8.3 可观测性设计

一个生产级 Multi-Agent 系统至少需要以下可观测性指标：

| 指标类别 | 具体指标 | 目的 |
|---------|---------|------|
| **延迟** | 每个 Agent 的执行时间、端到端总时间 | 定位性能瓶颈 |
| **成本** | 每个 Agent 的 Token 消耗、总消耗 | 成本监控和预算控制 |
| **质量** | 任务成功率、重试次数、降级次数 | 评估系统可靠性 |
| **链路** | 完整的 Trace（Agent、操作、输入、输出） | 问题排查 |
| **状态** | Blackboard 的状态变更历史 | 数据流追踪 |
| **通信** | Agent 间消息数量、消息大小 | 通信效率分析 |

---

## 9. 设计 Multi-Agent 系统的决策清单

在你决定构建 Multi-Agent 系统之前，逐一回答以下问题：

**必要性验证**：
- 单个 Agent 真的不够吗？是否尝试过优化 prompt、增加工具、使用更强的模型？
- 任务是否天然需要多角色/多视角？还是只是因为你觉得"多 Agent 更酷"？
- 团队的 LLM API 预算能否支撑多 Agent 的额外消耗？

**架构选择**：
- 任务结构更接近哪种模式？Supervisor-Worker / Peer-to-Peer / Pipeline / Dynamic Routing？
- Agent 之间需要什么样的通信？单向传递 / 双向协商 / 广播通知？
- 状态应该共享还是独立？冲突解决策略是什么？

**工程保障**：
- 每个 Agent 的失败影响范围是什么？有降级方案吗？
- 如何追踪一个请求在多个 Agent 之间的完整执行链路？
- 如何测试多 Agent 协作的正确性——单元测试（单个 Agent）+ 集成测试（Agent 交互）？

---

## 10. 结语与展望

本文是 Phase 3（How to Scale Agent Intelligence）的最后一篇。在 Phase 3 的四篇文章中，我们从单个 Agent 的四个维度进行了升级：

```
Phase 3 知识路线：

  第 08 篇 Memory       → Agent 有了"记忆"
  第 09 篇 RAG          → Agent 有了"外部知识"
  第 10 篇 Planning     → Agent 有了"规划和反思"
  第 11 篇 Multi-Agent  → Agent 有了"团队协作"（本文）
```

至此，我们已经拥有构建一个"聪明的" Agent 系统所需的全部核心概念。但"聪明"不等于"可用"。一个在本地跑通 demo 的 Multi-Agent 系统，距离生产环境还有巨大的鸿沟——框架选型、协议标准化、可观测性、安全性、成本控制、评估体系。

这正是 Phase 4（How to Ship Agents to Production）要解决的问题：

- **下一篇（12）**：LangChain vs LangGraph —— 你应该用框架还是自己写？框架的价值边界在哪里？我们会从 Chain 和 Graph 两种抽象出发，讨论框架在什么时候是加速器，什么时候是束缚。
- **第 13 篇**：MCP and Tool Protocol —— Agent 的工具需要标准化。MCP 协议如何让不同 Agent 共享工具？工具的发现、声明、权限控制。
- **第 14 篇**：Production-Grade Agent Systems —— 最后一篇，打通最后一公里：评估、安全、成本、灰度、监控。

### 进一步思考

**关于协作模式的演化**：本文介绍的四种模式是"纯模式"。真实系统中，你很可能需要混合模式——比如 Supervisor-Worker 的 Worker 内部用 Pipeline，或者 Dynamic Routing 的专家 Agent 内部用 Peer-to-Peer 辩论。如何设计这种嵌套的多层协作结构，是一个值得深入探索的方向。

**关于 Agent 的涌现行为**：当多个 Agent 协作时，是否会出现超越单个 Agent 能力的"涌现行为"？还是说 Multi-Agent 的上限永远被最强的那个 Agent 决定？这个问题在学术界尚无定论，但从实践角度看，好的协作架构确实能产出超越任何单个 Agent 的结果——正如一个好的工程团队能完成任何个人都无法独自完成的项目。

**关于 Human-in-the-Loop**：本文讨论的全是 Agent-to-Agent 的协作。但在生产环境中，最重要的"Agent"可能是人类。如何设计一个 Multi-Agent 系统，让人类能在关键节点介入、审核和纠正？Human-Agent 协作可能比 Agent-Agent 协作更有实用价值，也更有挑战性。

---

> **系列导航**：本文是 Agentic 系列的第 11 篇。
>
> - 上一篇：[10 | Planning and Reflection](/blog/engineering/agentic/10-Planning%20and%20Reflection)
> - 下一篇：[12 | LangChain vs LangGraph](/blog/engineering/agentic/12-LangChain%20vs%20LangGraph)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
