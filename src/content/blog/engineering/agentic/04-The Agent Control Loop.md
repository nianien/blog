---
title: "The Agent Control Loop: Agent 运行时的核心抽象"
pubDate: "2025-12-14"
description: "Agent 的本质不是一次函数调用，而是一个可中断的控制循环。本文从状态机模型出发，深入剖析 Agent Control Loop 的每个阶段——OBSERVE、THINK、ACT、REFLECT，对比 ReAct 与 Plan-then-Execute 两种主流模式，讨论状态管理、错误处理与性能优化策略，并给出一个不依赖任何框架的完整 Python 实现。"
tags: ["Agentic", "AI Engineering", "Runtime"]
---

# The Agent Control Loop: Agent 运行时的核心抽象

> 如果说 LLM 是 Agent 的大脑，那么 Control Loop 就是 Agent 的心跳。
>
> 大多数教程在讲 Agent 时，上来就接框架、调 API、跑 demo。但如果你不理解 Agent 运行时的核心抽象——控制循环——你永远只是在用别人的黑盒。
>
> 本文是 Agentic 系列第 04 篇，整个系列的技术基石。我们会从状态机模型出发，逐层拆解 Agent Control Loop 的每一个阶段，给出完整的 Python 实现，并深入分析实际工程中的 trade-off。

---

## 1. Agent 的本质：可中断的控制循环

一个常见的误解是把 Agent 等同于"一次 LLM 调用"。实际上，Agent 和 LLM 的关系，类似于操作系统和 CPU 的关系——LLM 是执行推理的计算单元，而 Agent 是管理整个执行生命周期的运行时系统。

**LLM 是一个函数：** `f(prompt) -> completion`，输入文本，输出文本，调用一次就结束。

**Agent 是一个循环：** 它持续运行，在每一轮中观察环境、调用 LLM 进行推理、执行动作、评估结果，然后决定是否继续。

```
LLM:    Input ──→ Output            (一次调用)

Agent:  Input ──→ [Observe → Think → Act → Reflect] ──→ ... ──→ Output
                  └──────── 循环 N 次 ────────────┘     (多轮控制)
```

这个循环有几个关键特性：

- **可中断**：循环可以在任何阶段暂停，等待外部输入（用户确认、异步工具返回）后恢复
- **有状态**：循环维护上下文信息，每一轮的输出影响下一轮的输入
- **有终止条件**：循环不会无限运行，它在满足特定条件时停止
- **可观测**：循环的每一步都应该是可追踪、可回溯的

理解了这一点，Agent 编程的核心问题就变成了：**如何设计和实现这个控制循环？**

---

## 2. 状态机模型：形式化定义

要严谨地描述 Control Loop，最自然的方式是用**有限状态机（FSM）**。

### 2.1 状态定义

一个 Agent Control Loop 可以用以下状态集合描述：

```python
from enum import Enum

class AgentState(Enum):
    OBSERVE  = "observe"   # 接收并归一化输入
    THINK    = "think"     # LLM 推理，决定下一步行动
    ACT      = "act"       # 执行工具调用或产出结果
    REFLECT  = "reflect"   # 评估执行结果，决定是否继续
    DONE     = "done"      # 终止：任务完成
    ERROR    = "error"     # 终止：不可恢复错误
```

### 2.2 状态转移图

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    ▼                                         │
              ┌──────────┐                                    │
   Input ───→│ OBSERVE  │                                    │
              └────┬─────┘                                    │
                   │                                         │
                   ▼                                         │
              ┌──────────┐    need_action    ┌──────────┐    │
              │  THINK   │ ───────────────→ │   ACT    │    │
              └────┬─────┘                   └────┬─────┘    │
                   │                              │          │
                   │ has_answer                   │          │
                   │                              ▼          │
                   │                        ┌──────────┐     │
                   │                        │ REFLECT  │ ────┘
                   │                        └────┬─────┘  continue
                   │                             │
                   ▼                             ▼
              ┌──────────┐                  ┌──────────┐
              │   DONE   │                  │  ERROR   │
              └──────────┘                  └──────────┘
                                       (max_retries exceeded
                                        / unrecoverable)
```

状态转移规则：

| 当前状态 | 条件 | 下一状态 |
|---------|------|---------|
| OBSERVE | 输入就绪 | THINK |
| THINK | LLM 返回 tool_call | ACT |
| THINK | LLM 返回最终回答 | DONE |
| THINK | LLM 调用异常 | ERROR |
| ACT | 工具执行完成 | REFLECT |
| ACT | 工具执行失败 | REFLECT (带错误信息) |
| REFLECT | 需要继续 | OBSERVE (将结果作为新输入) |
| REFLECT | 任务完成 | DONE |
| REFLECT | 超过重试上限 | ERROR |

### 2.3 与 OODA Loop 的对比

Agent Control Loop 并不是凭空发明的，它和军事决策理论中的 **OODA Loop（Observe-Orient-Decide-Act）** 有深层的结构对应：

```
OODA Loop:          Agent Control Loop:
┌─────────┐         ┌─────────┐
│ Observe │ ──────→ │ OBSERVE │  感知环境
├─────────┤         ├─────────┤
│ Orient  │ ──────→ │ THINK   │  理解上下文，形成判断
├─────────┤         │         │
│ Decide  │ ──────→ │         │  (LLM 在 THINK 中同时完成 Orient+Decide)
├─────────┤         ├─────────┤
│  Act    │ ──────→ │  ACT    │  执行行动
└─────────┘         ├─────────┤
                    │ REFLECT │  OODA 中没有显式的反思阶段
                    └─────────┘
```

关键区别在于 **REFLECT 阶段**。传统 OODA Loop 假设决策者能实时感知行动效果并自然融入下一轮 Observe。但 LLM Agent 不具备这种连续感知能力——它需要一个显式的反思步骤来评估工具返回值、判断是否需要修正。这是 Agent Control Loop 相对于经典决策循环的重要改进。

---

## 3. 循环中每个阶段的深入分析

### 3.1 OBSERVE：输入归一化

OBSERVE 阶段的职责是**收集并归一化各种来源的输入**，将它们统一为 LLM 可理解的格式。

输入来源远不止"用户消息"一种：

```
输入来源                    归一化后
┌─────────────────┐       ┌──────────────────────┐
│ 用户消息         │ ────→ │ {"role": "user",     │
│ 工具返回值       │ ────→ │  "content": "..."}   │
│ 系统事件         │ ────→ │                      │
│ 定时触发         │ ────→ │ {"role": "system",   │
│ 外部 Webhook    │ ────→ │  "content": "..."}   │
│ 上一轮反思结果   │ ────→ │                      │
└─────────────────┘       └──────────────────────┘
```

**输入归一化的核心原则：**

1. **所有输入都必须序列化为 message 格式**。不管来源是什么，最终都要变成 `{"role": ..., "content": ...}` 的形式，因为 LLM 只理解 message 序列。

2. **工具返回值需要结构化包装**。不要直接把原始 JSON 甩给 LLM，要附上工具名称、执行状态和必要的摘要信息。

3. **输入需要截断和优先级排序**。当多个输入同时到达时，需要决定哪些放进当前轮次的 Context Window，哪些缓存到下一轮。

```python
def observe(self, raw_inputs: list[dict]) -> list[dict]:
    """将原始输入归一化为 LLM message 格式"""
    messages = []
    for inp in raw_inputs:
        match inp["type"]:
            case "user_message":
                messages.append({"role": "user", "content": inp["text"]})
            case "tool_result":
                messages.append({
                    "role": "tool",
                    "tool_call_id": inp["call_id"],
                    "content": self._format_tool_result(inp),
                })
            case "system_event":
                messages.append({
                    "role": "system",
                    "content": f"[System Event] {inp['event']}",
                })
    return messages
```

### 3.2 THINK：LLM 推理

THINK 阶段是控制循环中最核心的一环——调用 LLM，让它基于当前上下文做出决策。

这个阶段要解决三个问题：

**问题一：Context Window 构建**

LLM 的输入不是当前轮次的消息，而是**从任务开始到现在的完整上下文**。构建 Context Window 的典型结构：

```
┌─────────────────────────────────────────────┐
│ System Prompt                               │  固定不变
│ (角色定义 + 能力边界 + 输出格式要求)           │
├─────────────────────────────────────────────┤
│ Tool Definitions                            │  固定不变
│ (可用工具的 JSON Schema 定义)                │
├─────────────────────────────────────────────┤
│ Message History                             │  随轮次增长
│ (user → assistant → tool → assistant → ...) │
├─────────────────────────────────────────────┤
│ Current Turn Input                          │  当前轮次
│ (本轮 OBSERVE 阶段归一化的输入)              │
└─────────────────────────────────────────────┘
```

**问题二：Token 预算控制**

Context Window 有上限（4K / 8K / 128K / 200K），而每一轮循环都会增加 message history。如果不加控制，几轮之后就会超限。

常见的预算控制策略：

| 策略 | 实现方式 | 适用场景 |
|-----|---------|---------|
| 硬截断 | 只保留最近 N 条消息 | 简单场景 |
| 滑动窗口 | System Prompt 固定 + 最近 K 轮对话 | 工具调用场景 |
| 摘要压缩 | 将早期对话用 LLM 生成摘要后替换 | 长对话场景 |
| 优先级保留 | 按消息重要性排序，低优先级先丢弃 | 复杂多步任务 |

```python
def _build_context(self, new_messages: list[dict]) -> list[dict]:
    """构建符合 Token 预算的 Context Window"""
    self.message_history.extend(new_messages)

    context = [self.system_prompt] + self.tool_definitions
    remaining_budget = self.max_tokens - self._count_tokens(context)

    # 从最新消息开始向前填充，直到预算耗尽
    selected = []
    for msg in reversed(self.message_history):
        msg_tokens = self._count_tokens([msg])
        if msg_tokens > remaining_budget:
            break
        selected.insert(0, msg)
        remaining_budget -= msg_tokens

    return context + selected
```

**问题三：LLM 输出解析**

LLM 的返回可能是纯文本回答（任务完成），也可能是工具调用请求。需要根据返回类型决定下一步状态转移：

```python
def think(self, context: list[dict]) -> ThinkResult:
    """调用 LLM 进行推理"""
    response = self.client.chat.completions.create(
        model=self.model,
        messages=context,
        tools=self.tool_schemas,
    )
    choice = response.choices[0]

    if choice.finish_reason == "tool_calls":
        return ThinkResult(
            action="tool_call",
            tool_calls=choice.message.tool_calls,
            raw_message=choice.message,
        )
    else:
        return ThinkResult(
            action="answer",
            content=choice.message.content,
            raw_message=choice.message,
        )
```

### 3.3 ACT：执行层

ACT 阶段负责**执行 THINK 阶段决定的动作**——通常是调用工具（Tool Calling）。

执行层的核心挑战不是"调用工具"本身，而是以下几个工程问题：

**同步 vs 异步执行**

```
同步执行（Simple）：
  think → call_tool_1 → wait → call_tool_2 → wait → reflect
  延迟 = T1 + T2

异步 / 并行执行（Optimized）：
  think → call_tool_1 ─┬─→ reflect
        → call_tool_2 ─┘
  延迟 = max(T1, T2)
```

当 LLM 在一次返回中请求多个工具调用（parallel tool calling）时，应该并行执行以降低延迟：

```python
import asyncio

async def act(self, tool_calls: list[ToolCall]) -> list[dict]:
    """并行执行多个工具调用"""
    tasks = [self._execute_tool(tc) for tc in tool_calls]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    tool_results = []
    for tc, result in zip(tool_calls, results):
        if isinstance(result, Exception):
            tool_results.append({
                "type": "tool_result",
                "call_id": tc.id,
                "status": "error",
                "content": f"Tool '{tc.function.name}' failed: {result}",
            })
        else:
            tool_results.append({
                "type": "tool_result",
                "call_id": tc.id,
                "status": "success",
                "content": str(result),
            })
    return tool_results
```

**执行安全**

工具执行不是无条件信任的。需要考虑：

- **超时控制**：每个工具调用必须有 timeout，防止阻塞整个循环
- **结果大小限制**：工具返回值可能非常大（比如查数据库返回 10 万行），需要截断
- **权限校验**：某些工具（文件写入、网络请求、代码执行）需要额外的权限检查
- **沙箱执行**：代码执行类工具应该在沙箱中运行

### 3.4 REFLECT：输出质量评估

REFLECT 阶段回答一个关键问题：**上一步的执行结果是否满意？是继续、重试还是停止？**

这个阶段有两种实现方式：

**方式一：隐式反思——让 LLM 在下一轮 THINK 中自行判断**

这是最简单的方式。把工具返回值直接送进下一轮 THINK，让 LLM 自己决定是否需要修正。大多数框架（如 OpenAI Assistants API）默认采用这种方式。

优点：实现简单，不增加额外的 LLM 调用。

缺点：LLM 可能"自信地"忽略错误，特别是在返回值看起来合理但语义错误的情况下。

**方式二：显式反思——用独立的 LLM 调用进行自我评估**

```python
def reflect(self, action_result: dict, task_goal: str) -> ReflectResult:
    """显式反思：评估执行结果"""
    prompt = f"""评估以下工具执行结果是否达成了任务目标。

任务目标: {task_goal}
执行结果: {json.dumps(action_result, ensure_ascii=False)}

请回答：
1. 结果是否正确？(yes/no)
2. 是否需要进一步行动？(yes/no)
3. 如果需要，下一步应该做什么？
"""
    response = self.client.chat.completions.create(
        model=self.model,
        messages=[{"role": "user", "content": prompt}],
    )
    # 解析反思结果...
    return ReflectResult(
        is_correct=...,
        needs_more_action=...,
        next_step_hint=...,
    )
```

**Trade-off 分析：**

| 维度 | 隐式反思 | 显式反思 |
|-----|---------|---------|
| Token 消耗 | 低 | 高（额外一次 LLM 调用） |
| 质量把控 | 依赖 LLM 自觉 | 有独立的质量评估 |
| 延迟 | 低 | 增加一轮 LLM 延迟 |
| 适用场景 | 简单工具调用 | 复杂推理链、高准确性要求 |

实际工程中，常用的折中方案是：**对关键步骤用显式反思，对常规步骤用隐式反思**。

### 3.5 终止条件：什么时候停下来？

一个 Agent 如果不知道什么时候停，就是一个烧钱的死循环。终止条件的设计是 Control Loop 中最容易被忽视、但对生产环境最重要的部分。

```python
def should_stop(self, state: LoopState) -> tuple[bool, str]:
    """判断是否应该终止循环"""
    # 1. LLM 认为任务完成
    if state.last_think_result.action == "answer":
        return True, "task_completed"

    # 2. 达到最大轮次
    if state.turn_count >= self.max_turns:
        return True, "max_turns_exceeded"

    # 3. Token 预算耗尽
    if state.total_tokens >= self.token_budget:
        return True, "token_budget_exceeded"

    # 4. 连续错误过多
    if state.consecutive_errors >= self.max_consecutive_errors:
        return True, "too_many_errors"

    # 5. 死循环检测（重复输出相同内容）
    if self._detect_loop(state.recent_outputs):
        return True, "loop_detected"

    return False, ""
```

各终止条件的设计考量：

- **max_turns**：硬上限，防止失控。一般设 10-30 轮。过小会导致复杂任务被截断，过大会导致 Token 浪费
- **token_budget**：成本控制。根据业务场景设定每次交互的 Token 上限
- **consecutive_errors**：容错阈值。工具偶尔失败是正常的，但连续 3 次以上通常意味着系统性问题
- **loop_detected**：死循环检测。如果 Agent 连续 N 轮输出相同或高度相似的内容，说明它陷入了无效循环

---

## 4. 两种主流 Loop 模式对比

### 4.1 ReAct 模式

**ReAct（Reason + Act）** 是目前最主流的 Agent Loop 模式，由 Yao et al. 2022 提出。其核心思想是让 LLM 交替进行推理和行动：

```
┌──────────────────────────────────────────────────────┐
│                   ReAct Loop                         │
│                                                      │
│  ┌─────────┐    ┌─────────┐    ┌─────────────────┐  │
│  │ Thought │ →  │ Action  │ →  │  Observation    │  │
│  │(LLM推理)│    │(工具调用)│    │(工具返回值)      │  │
│  └─────────┘    └─────────┘    └────────┬────────┘  │
│       ▲                                  │          │
│       └──────────────────────────────────┘          │
│                  循环直到完成                         │
└──────────────────────────────────────────────────────┘
```

一个典型的 ReAct 执行轨迹（Trace）：

```
Thought: 用户想知道北京今天的天气。我需要调用天气 API。
Action:  get_weather(city="北京")
Observation: {"temp": 28, "condition": "晴", "humidity": 45}

Thought: 已经获取到天气数据，我可以直接回答用户。
Answer:  北京今天晴天，气温 28°C，湿度 45%。
```

**ReAct 的优势：**
- 每一步都基于最新的观察结果做决策，**适应性强**
- Thought 过程可见，**可解释性好**
- 实现简单，与 Tool Calling API 天然契合

**ReAct 的劣势：**
- 逐步决策，无法全局优化执行顺序
- 每一步都需要一次 LLM 调用，**延迟累积**
- 对于需要协调多个子任务的复杂场景，容易陷入局部最优

### 4.2 Plan-then-Execute 模式

与 ReAct 的"走一步看一步"不同，Plan-then-Execute 先生成一个**完整的执行计划**，然后按计划依次执行：

```
┌──────────────────────────────────────────────────────────┐
│              Plan-then-Execute Loop                       │
│                                                          │
│  ┌──────────────────────────────────────┐                │
│  │           Planning Phase             │                │
│  │  Input → LLM → [Step1, Step2, ...]   │                │
│  └───────────────┬──────────────────────┘                │
│                  │                                        │
│                  ▼                                        │
│  ┌──────────────────────────────────────┐                │
│  │         Execution Phase              │                │
│  │  Step1 → Execute → Result1           │                │
│  │  Step2 → Execute → Result2           │                │
│  │  ...                                 │                │
│  └───────────────┬──────────────────────┘                │
│                  │                                        │
│                  ▼                                        │
│  ┌──────────────────────────────────────┐                │
│  │    Replan (if needed)                │                │
│  │  检查是否需要调整计划                   │                │
│  └──────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────┘
```

执行轨迹示例：

```
Plan:
  1. 查询北京天气
  2. 查询上海天气
  3. 对比两地天气差异
  4. 生成出行建议

Execute Step 1: get_weather(city="北京") → {"temp": 28, "condition": "晴"}
Execute Step 2: get_weather(city="上海") → {"temp": 32, "condition": "多云"}
Execute Step 3: (LLM 对比分析)
Execute Step 4: (LLM 生成建议)

Answer: ...
```

### 4.3 Trade-off 分析

```
                        灵活性
                          ▲
                          │
                 ReAct ●  │
                          │
                          │        ● Hybrid
                          │          (ReAct + Plan)
                          │
              Plan-then   │
              -Execute ●  │
                          │
                          └──────────────────→ 效率
                                          (LLM 调用次数)
```

| 维度 | ReAct | Plan-then-Execute |
|------|-------|-------------------|
| 灵活性 | 高。每步实时调整 | 低。偏离计划时需要 Replan |
| LLM 调用次数 | 多（每步一次推理） | 少（规划一次 + 执行时可能不需要 LLM） |
| 可控性 | 低。难以预测执行路径 | 高。计划可审核、可修改 |
| 适合场景 | 工具调用为主、步骤不确定 | 多步骤、有依赖关系、需要全局协调 |
| 错误恢复 | 自然。下一步可以直接修正 | 需要 Replan 机制 |
| 人类干预 | 难以在中途插入 | 容易。可以审核和修改计划 |

**实际工程建议：** 大多数场景从 ReAct 开始。当你发现 Agent 频繁在多步任务中"迷路"或做出低效的工具调用序列时，再考虑引入 Plan-then-Execute 或混合模式。

---

## 5. 状态管理

Control Loop 的状态管理决定了 Agent 的**持久性**和**可恢复性**。

### 5.1 Stateless Agent

Stateless Agent 不维护执行状态，所有上下文通过 **message history** 传递。

```
Request 1:  [system, user_msg_1]                     → response_1
Request 2:  [system, user_msg_1, response_1, user_2] → response_2
Request 3:  [system, user_msg_1, response_1, user_2, response_2, user_3] → response_3
```

**特点：**
- 实现最简单，无需持久化
- 每次请求都是自包含的
- message history 不断膨胀，最终超过 Context Window
- 不支持暂停/恢复

这是大多数 "chat completion" 应用的工作方式。适合单轮或短对话场景。

### 5.2 Stateful Agent

Stateful Agent 维护一个独立的 **execution state**，它不仅包含 message history，还包含任务进度、中间结果、工具状态等信息。

```python
@dataclass
class ExecutionState:
    """Agent 执行状态"""
    session_id: str
    status: AgentState
    turn_count: int
    message_history: list[dict]

    # 任务状态
    task_goal: str
    current_plan: list[str] | None
    completed_steps: list[str]

    # 资源消耗
    total_input_tokens: int
    total_output_tokens: int

    # 错误追踪
    consecutive_errors: int
    error_log: list[dict]

    # 时间戳
    created_at: float
    updated_at: float
```

### 5.3 状态持久化方案

当 Agent 需要支持暂停/恢复、跨进程执行、或长时间运行时，执行状态必须持久化。

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   In-Memory  │     │    Redis     │     │   Database   │
│  (dict/obj)  │     │  (KV Store)  │     │ (PostgreSQL) │
├─────────────┤     ├──────────────┤     ├──────────────┤
│ 最快         │     │ 快，支持 TTL  │     │ 持久可靠     │
│ 进程重启丢失  │     │ 跨进程共享    │     │ 支持查询分析  │
│ 单进程使用    │     │ 重启后可保留  │     │ 适合生产环境  │
│ 适合开发/测试 │     │ 适合 session  │     │ 适合审计追溯  │
└─────────────┘     └──────────────┘     └──────────────┘
```

**Checkpoint 与恢复** 是 Stateful Agent 的核心能力。思路很直接：在每轮循环的关键节点保存一次快照，异常恢复时从最近的快照重新开始。

```python
class CheckpointManager:
    def save(self, state: ExecutionState) -> str:
        """保存 checkpoint，返回 checkpoint_id"""
        snapshot = {
            "state": asdict(state),
            "timestamp": time.time(),
        }
        checkpoint_id = f"{state.session_id}:{state.turn_count}"
        self.store.set(checkpoint_id, json.dumps(snapshot))
        return checkpoint_id

    def restore(self, checkpoint_id: str) -> ExecutionState:
        """从 checkpoint 恢复执行状态"""
        snapshot = json.loads(self.store.get(checkpoint_id))
        return ExecutionState(**snapshot["state"])
```

实际系统中，checkpoint 的保存频率需要权衡：

- **每轮都保存**：恢复粒度最细，但写入开销大
- **关键节点保存**（如每次工具调用前后）：开销适中，覆盖最重要的故障场景
- **定时保存**：实现简单，但可能丢失最近几轮的状态

---

## 6. 完整代码实现

下面是一个最小但完整的 Agent Control Loop 实现。不依赖任何框架，仅使用 Python 标准库 + OpenAI SDK。

```python
"""
Minimal Agent Control Loop
不依赖任何框架，纯 Python + OpenAI SDK
"""
import json
import time
from enum import Enum
from dataclasses import dataclass, field
from openai import OpenAI


class State(Enum):
    OBSERVE = "observe"
    THINK = "think"
    ACT = "act"
    REFLECT = "reflect"
    DONE = "done"
    ERROR = "error"


@dataclass
class LoopContext:
    messages: list[dict] = field(default_factory=list)
    turn: int = 0
    total_tokens: int = 0
    consecutive_errors: int = 0
    recent_outputs: list[str] = field(default_factory=list)


# ── Tool Registry ────────────────────────────────────

TOOL_FUNCTIONS = {}

def register_tool(name: str, description: str, parameters: dict):
    """装饰器：注册工具函数及其 schema"""
    def decorator(fn):
        TOOL_FUNCTIONS[name] = {
            "fn": fn,
            "schema": {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                },
            },
        }
        return fn
    return decorator


@register_tool(
    name="get_weather",
    description="获取指定城市的当前天气",
    parameters={
        "type": "object",
        "properties": {
            "city": {"type": "string", "description": "城市名称"},
        },
        "required": ["city"],
    },
)
def get_weather(city: str) -> str:
    # 示例实现，实际中调用真实 API
    return json.dumps({"city": city, "temp": 28, "condition": "晴"})


# ── Agent Control Loop ───────────────────────────────

class Agent:
    def __init__(
        self,
        system_prompt: str,
        model: str = "gpt-4o",
        max_turns: int = 15,
        token_budget: int = 50_000,
        max_consecutive_errors: int = 3,
    ):
        self.client = OpenAI()
        self.model = model
        self.system_prompt = system_prompt
        self.max_turns = max_turns
        self.token_budget = token_budget
        self.max_errors = max_consecutive_errors
        self.tool_schemas = [t["schema"] for t in TOOL_FUNCTIONS.values()]

    def run(self, user_input: str) -> str:
        ctx = LoopContext()
        ctx.messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_input},
        ]
        state = State.THINK  # 首轮输入已就绪，直接进入 THINK

        while state not in (State.DONE, State.ERROR):
            match state:
                case State.THINK:
                    state, ctx = self._think(ctx)
                case State.ACT:
                    state, ctx = self._act(ctx)
                case State.REFLECT:
                    state, ctx = self._reflect(ctx)
            ctx.turn += 1

        # 提取最终回答
        for msg in reversed(ctx.messages):
            if msg["role"] == "assistant" and msg.get("content"):
                return msg["content"]
        return "[Agent finished without a final answer]"

    def _think(self, ctx: LoopContext) -> tuple[State, LoopContext]:
        """调用 LLM 推理"""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=ctx.messages,
                tools=self.tool_schemas or None,
            )
        except Exception as e:
            ctx.consecutive_errors += 1
            ctx.messages.append({
                "role": "assistant",
                "content": f"[LLM Error] {e}",
            })
            if ctx.consecutive_errors >= self.max_errors:
                return State.ERROR, ctx
            return State.THINK, ctx  # 重试

        # 记录 token 消耗
        usage = response.usage
        ctx.total_tokens += (usage.prompt_tokens + usage.completion_tokens)
        ctx.consecutive_errors = 0

        choice = response.choices[0]
        assistant_msg = choice.message.model_dump()
        ctx.messages.append(assistant_msg)

        # 决定下一状态
        if choice.message.tool_calls:
            return State.ACT, ctx
        else:
            return State.DONE, ctx

    def _act(self, ctx: LoopContext) -> tuple[State, LoopContext]:
        """执行工具调用"""
        assistant_msg = ctx.messages[-1]
        tool_calls = assistant_msg.get("tool_calls", [])

        for tc in tool_calls:
            fn_name = tc["function"]["name"]
            fn_args = json.loads(tc["function"]["arguments"])

            tool_entry = TOOL_FUNCTIONS.get(fn_name)
            if not tool_entry:
                result = f"Error: unknown tool '{fn_name}'"
            else:
                try:
                    result = tool_entry["fn"](**fn_args)
                except Exception as e:
                    result = f"Error: tool '{fn_name}' raised {type(e).__name__}: {e}"
                    ctx.consecutive_errors += 1

            ctx.messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": str(result),
            })

        return State.REFLECT, ctx

    def _reflect(self, ctx: LoopContext) -> tuple[State, LoopContext]:
        """反思：检查终止条件"""
        # 最大轮次
        if ctx.turn >= self.max_turns:
            ctx.messages.append({
                "role": "assistant",
                "content": "[Agent stopped: max turns exceeded]",
            })
            return State.ERROR, ctx

        # Token 预算
        if ctx.total_tokens >= self.token_budget:
            ctx.messages.append({
                "role": "assistant",
                "content": "[Agent stopped: token budget exceeded]",
            })
            return State.ERROR, ctx

        # 连续错误
        if ctx.consecutive_errors >= self.max_errors:
            return State.ERROR, ctx

        # 死循环检测：最近 3 次输出相同
        tool_results = [
            m["content"] for m in ctx.messages[-6:]
            if m.get("role") == "tool"
        ]
        if len(tool_results) >= 3 and len(set(tool_results[-3:])) == 1:
            ctx.messages.append({
                "role": "assistant",
                "content": "[Agent stopped: loop detected]",
            })
            return State.ERROR, ctx

        # 继续下一轮推理
        return State.THINK, ctx


# ── 使用示例 ─────────────────────────────────────────

if __name__ == "__main__":
    agent = Agent(
        system_prompt="你是一个天气助手。使用 get_weather 工具回答天气问题。",
        max_turns=10,
    )
    answer = agent.run("北京今天天气怎么样？")
    print(answer)
```

这段代码约 130 行，涵盖了 Control Loop 的所有核心要素：

- 状态机驱动的循环控制
- 工具注册与动态调用
- LLM 异常重试
- Token 消耗追踪
- 多种终止条件（max_turns / token_budget / consecutive_errors / loop_detected）
- 工具执行错误处理

它不是生产级代码，但足以说明 Control Loop 的核心机制。在此基础上增加异步执行、状态持久化、日志追踪，就能逐步演进为生产级实现。

---

## 7. 错误处理策略

生产环境中，Agent Control Loop 最常遇到的四类错误：

### 7.1 Tool 调用失败

工具调用失败是最高频的错误。正确的处理方式不是抛异常终止，而是**将错误信息作为 Observation 返回给 LLM**，让它决定如何应对。

```python
# 错误的做法：直接终止
try:
    result = call_tool(name, args)
except Exception:
    raise  # Agent 直接崩溃

# 正确的做法：将错误反馈给 LLM
try:
    result = call_tool(name, args)
except TimeoutError:
    result = "Tool timed out after 30s. Consider using different parameters."
except ValueError as e:
    result = f"Invalid arguments: {e}. Please check parameter types."
except Exception as e:
    result = f"Tool failed: {type(e).__name__}: {e}"
```

LLM 在收到错误信息后，通常能自主修正——换一组参数重试、换一个工具、或者告知用户当前无法完成任务。

### 7.2 LLM 返回格式异常

LLM 偶尔会返回不符合预期的格式：JSON 不合法、tool_call 参数缺失、content 为空等。

```python
def _parse_tool_call_safe(self, tool_call) -> tuple[str, dict]:
    """安全解析工具调用参数"""
    name = tool_call.function.name
    try:
        args = json.loads(tool_call.function.arguments)
    except json.JSONDecodeError:
        # LLM 返回了非法 JSON，尝试修复或跳过
        args = {}
        self.logger.warning(
            f"Invalid JSON in tool_call arguments: "
            f"{tool_call.function.arguments}"
        )
    return name, args
```

### 7.3 超时处理

整个 Agent 执行需要有全局超时，防止无限挂起：

```python
import signal

class TimeoutError(Exception):
    pass

def run_with_timeout(fn, timeout_seconds: int, *args, **kwargs):
    """为函数执行添加超时限制"""
    def handler(signum, frame):
        raise TimeoutError(f"Execution timed out after {timeout_seconds}s")

    old_handler = signal.signal(signal.SIGALRM, handler)
    signal.alarm(timeout_seconds)
    try:
        return fn(*args, **kwargs)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)
```

### 7.4 死循环检测

当 Agent 陷入死循环时，它会反复执行相同的操作序列。检测策略：

```python
def _detect_loop(self, messages: list[dict], window: int = 6) -> bool:
    """检测 Agent 是否陷入重复循环"""
    recent = messages[-window:]

    # 策略 1：完全重复检测
    contents = [m.get("content", "") for m in recent if m["role"] == "assistant"]
    if len(contents) >= 3 and len(set(contents[-3:])) == 1:
        return True

    # 策略 2：工具调用序列重复检测
    tool_calls = []
    for m in recent:
        if m.get("tool_calls"):
            for tc in m["tool_calls"]:
                tool_calls.append(f"{tc['function']['name']}:{tc['function']['arguments']}")

    if len(tool_calls) >= 4:
        half = len(tool_calls) // 2
        if tool_calls[:half] == tool_calls[half:2*half]:
            return True

    return False
```

---

## 8. 性能考量

### 8.1 Token 消耗与循环次数的关系

Agent Control Loop 的 Token 消耗不是线性增长，而是**二次增长**——因为每一轮都要携带之前所有轮次的 message history。

```
轮次    新增消息 Token    累计 Context Token    本轮总消耗
1       T               S + T                S + T
2       T               S + 2T               S + 2T
3       T               S + 3T               S + 3T
...
N       T               S + NT               S + NT

总消耗 = N*S + T*(1+2+...+N) = N*S + T*N*(N+1)/2

其中 S = System Prompt Token 数，T = 平均每轮消息 Token 数
```

这意味着 **10 轮的 Agent 消耗的 Token 不是 1 轮的 10 倍，而可能是 55 倍**。这对成本控制至关重要。

### 8.2 Context Window 膨胀问题

随着轮次增加，Context Window 持续膨胀，导致：

1. **延迟增加**：LLM 推理时间与输入 Token 数正相关
2. **成本增加**：按 Token 计费，输入越长越贵
3. **质量下降**：过长的 Context 会导致 LLM "注意力分散"，关键信息被淹没（lost in the middle 问题）

### 8.3 消息压缩/摘要策略

应对 Context Window 膨胀的核心策略：

**策略一：滑动窗口**

只保留最近 K 轮对话，丢弃更早的历史。简单粗暴但有效。

```python
def _sliding_window(self, messages: list[dict], keep_last: int = 10) -> list[dict]:
    system_msgs = [m for m in messages if m["role"] == "system"]
    non_system = [m for m in messages if m["role"] != "system"]
    return system_msgs + non_system[-keep_last:]
```

**策略二：摘要压缩**

当 message history 超过阈值时，用 LLM 对早期对话生成摘要，替换原始消息。

```python
def _compress_history(self, messages: list[dict], threshold: int = 20) -> list[dict]:
    if len(messages) <= threshold:
        return messages

    # 将早期消息压缩为摘要
    early = messages[1:-threshold]  # 跳过 system prompt，保留最近的
    summary_prompt = (
        "请用 3-5 句话总结以下对话的关键信息和已完成的操作：\n"
        + "\n".join(m.get("content", "") for m in early if m.get("content"))
    )

    summary = self.client.chat.completions.create(
        model="gpt-4o-mini",  # 用小模型做摘要，节省成本
        messages=[{"role": "user", "content": summary_prompt}],
    ).choices[0].message.content

    return (
        [messages[0]]  # system prompt
        + [{"role": "system", "content": f"[Earlier conversation summary] {summary}"}]
        + messages[-threshold:]
    )
```

**策略三：选择性保留**

不是所有消息都同等重要。工具的原始返回值（可能非常长）通常可以只保留摘要：

```python
def _trim_tool_results(self, messages: list[dict], max_len: int = 500) -> list[dict]:
    """截断过长的工具返回值"""
    trimmed = []
    for m in messages:
        if m["role"] == "tool" and len(m.get("content", "")) > max_len:
            m = {**m, "content": m["content"][:max_len] + "\n...[truncated]"}
        trimmed.append(m)
    return trimmed
```

**三种策略的对比：**

| 策略 | 信息保留 | 实现成本 | Token 节省 | 适用场景 |
|-----|---------|---------|-----------|---------|
| 滑动窗口 | 低 | 极低 | 高 | 短对话、工具调用为主 |
| 摘要压缩 | 中 | 中（需要额外 LLM 调用） | 高 | 长对话、需要历史上下文 |
| 选择性保留 | 高 | 低 | 中 | 工具返回值较大的场景 |

实际工程中，通常**组合使用**：先用选择性保留截断大结果，再用滑动窗口控制总长度，在关键节点用摘要压缩保留全局上下文。

---

## 9. 小结与进一步思考

本文从状态机模型出发，完整地拆解了 Agent Control Loop 的核心抽象：

- **OBSERVE** 负责输入归一化——将各种来源的信息统一为 LLM 可理解的 message 格式
- **THINK** 是核心推理阶段——管理 Context Window、控制 Token 预算、解析 LLM 输出
- **ACT** 是执行层——处理工具调用的同步/异步执行、超时控制、安全隔离
- **REFLECT** 负责质量评估——决定是继续、重试还是终止
- **终止条件**是成本和安全的兜底——max_turns、token_budget、error_threshold、loop_detection

我们对比了 ReAct 和 Plan-then-Execute 两种主流模式，分析了 Stateless 与 Stateful 两种状态管理策略，并实现了一个不依赖任何框架的完整 Control Loop。

但控制循环只是 Agent 运行时的骨架。它的灵魂在于 **Tool Calling**——正是工具让 Agent 从"能说会道的语言模型"变成"能做事的智能体"。

在下一篇 **《Tool Calling Deep Dive: 让 LLM 成为可编程接口》** 中，我们会深入工具调用的设计哲学：JSON Schema 作为契约、Tool Registry 的实现、参数校验、错误传播，以及 Structured Output 为什么优于自由文本。

留几个值得进一步思考的问题：

1. **Control Loop 的嵌套**：当一个 Agent 的工具是另一个 Agent 时，控制循环如何嵌套？外层循环和内层循环的终止条件如何协调？
2. **人机协作中的循环**：如何在 Control Loop 中优雅地插入人类审批节点？这和 Stateful Agent 的 checkpoint 机制有什么关系？
3. **流式输出与控制循环**：当 Agent 需要边思考边输出（streaming）时，状态机模型还适用吗？需要做哪些调整？
4. **多模态输入的归一化**：当 OBSERVE 阶段接收的不只是文本，还有图片、音频、视频时，输入归一化策略如何演化？

---

> **系列导航**：本文是 Agentic 系列的第 04 篇。
>
> - 上一篇：[03 | Agent vs Workflow vs Automation](/blog/engineering/agentic/03-Agent%20vs%20Workflow%20vs%20Automation)
> - 下一篇：[05 | Tool Calling Deep Dive](/blog/engineering/agentic/05-Tool%20Calling%20Deep%20Dive)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
