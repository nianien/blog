---
title: "从Prompt到Agent：为什么LLM本身不是Agent"
pubDate: "2025-12-05"
description: "LLM 是一个无状态的文本函数，Agent 是一个有状态的推理系统。本文从 LLM 的五大局限出发，精确定义 Agent 的组件模型与控制循环，并沿 Chatbot → Agent 的光谱逐级拆解，帮助你建立从 Prompt 到 Agent 的完整认知框架。"
tags: ["Agentic", "AI Engineering", "LLM"]
series:
  key: "agentic"
  order: 2
author: "skyfalling"
---

---

## 1. LLM 的本质：一个文本到文本的函数

把所有复杂性剥离，LLM 的数学本质极其简洁：

```
f(prompt) → response
```

给定一段输入文本（prompt），经过前向推理，输出一段文本（response）。就这样。

更严格地说，LLM 做的是**条件概率采样**：给定已有 token 序列 `[t₁, t₂, ..., tₙ]`，逐个预测下一个 token 的概率分布 `P(tₙ₊₁ | t₁, ..., tₙ)`，然后按某种策略（greedy、top-k、top-p）从分布中采样。

这意味着三个关键性质：

- **无状态（Stateless）**：模型权重在推理时不变，两次相同输入产生的概率分布相同（忽略采样随机性）。模型本身不存储任何关于"之前发生了什么"的信息。
- **无副作用（Side-effect Free）**：模型不会改变外部世界的任何状态——不会写文件、不会调 API、不会修改数据库。它只输出文本。
- **无记忆（Memoryless）**：每次调用都是独立的函数调用。上一次对话的内容，除非你手动拼接进 prompt，否则模型完全不知道。

用一个 Python 类比，LLM 就是一个纯函数：

```python
def llm(prompt: str) -> str:
    """
    纯函数：相同输入 → 相同输出分布
    无副作用：不修改任何外部状态
    无记忆：不保留任何调用历史
    """
    tokens = tokenize(prompt)
    output_tokens = []
    for _ in range(max_tokens):
        next_token_probs = model.forward(tokens + output_tokens)
        next_token = sample(next_token_probs, temperature=0.7)
        output_tokens.append(next_token)
        if next_token == EOS:
            break
    return detokenize(output_tokens)
```

这是一个非常优雅的抽象。但正是这个抽象的简洁性，决定了它的局限性。

---

## 2. LLM 的五大局限

### 2.1 无记忆：每次对话都是独立宇宙

**场景**：你让 LLM 帮你写一个项目方案。第一轮你说了需求，第二轮你补充了约束，第三轮你修改了目标。LLM 怎么"记住"前两轮？

答案是：它不记。所谓的"多轮对话"，本质上是**客户端把历史消息全部拼接进 prompt** 重新发送。每一轮调用，LLM 都在从零开始阅读整个对话历史。

```python
# 所谓"多轮对话"的真相
messages = [
    {"role": "user", "content": "帮我写个项目方案"},          # 第一轮
    {"role": "assistant", "content": "好的，请问项目目标是什么？"},
    {"role": "user", "content": "做一个推荐系统"},            # 第二轮
    {"role": "assistant", "content": "了解，技术栈偏好？"},
    {"role": "user", "content": "用 Python，预算 50 万"},     # 第三轮
]
# 每次都是把 *全部* messages 发给 LLM，它并不"记得"前两轮
response = llm.chat(messages)
```

这带来两个工程问题：一是 **context window 有限**，对话太长会被截断，早期关键信息丢失；二是 **token 成本线性增长**，每一轮都在为重复传输历史对话付费。

### 2.2 无工具：只能生成文本，不能执行操作

**场景**：你问 LLM"现在北京气温多少度？"它会给你一个看起来很自信的答案——但这个答案是从训练数据中"编"出来的，不是实时查询的结果。

LLM 不能发 HTTP 请求，不能查数据库，不能读文件系统，不能调用任何外部服务。它唯一的"输出通道"就是文本。

```
用户：帮我创建一个 GitHub 仓库叫 my-project
LLM：好的，已经为您创建了 GitHub 仓库 my-project！  ← 这是幻觉，什么都没发生
```

LLM 的"执行"是一种语言层面的模拟——它可以生成看起来像执行结果的文本，但实际上没有任何副作用发生。这是 hallucination 问题在工具层面的体现。

### 2.3 无规划：只有 next-token prediction，没有 multi-step reasoning

**场景**：你让 LLM"规划一次三天的日本旅行"。它会一口气输出一个看起来完整的方案。但这不是"规划"——这是"自回归生成"。它不会先列出约束（预算、时间、兴趣），再枚举可能的方案，再比较 trade-off，再做决策。它只是在逐 token 地预测"下一个最可能的词"。

真正的规划需要：

1. **目标分解**：把大目标拆成子目标
2. **约束满足**：在多个维度上满足约束条件
3. **方案评估**：对多个候选方案进行比较
4. **回溯修正**：发现某条路不通时能回退

LLM 的自回归生成是单向的、线性的，没有回溯机制。它无法在生成第 50 个 token 时"回头修改"第 10 个 token。所有看起来像"规划"的输出，都是语言模式匹配的结果，不是搜索与优化的结果。

### 2.4 无状态：不知道自己之前做了什么

**场景**：你让 LLM 执行一个多步骤任务——先查数据，再分析，再写报告。即使它能生成每一步的文本描述，它也不知道"第一步的结果是什么"，因为它没有一个持久化的状态空间来记录执行进度。

无状态和无记忆不同：

- **无记忆**强调的是跨调用的信息丢失
- **无状态**强调的是在一次任务中，没有结构化的执行状态追踪

一个 Agent 需要知道："我已经完成了步骤 1 和 2，步骤 3 失败了，我需要重试步骤 3"。LLM 没有这个能力。

### 2.5 无反思：无法评估自己的输出质量

**场景**：你让 LLM 写一段代码。它写完了。这段代码是否正确？LLM 不知道。它不会自动运行代码验证，不会检查边界条件，不会评估时间复杂度是否满足要求。

更深层的问题是：LLM 无法区分"我确信这是对的"和"我在瞎猜"。它的 confidence 不等于 correctness。一个 softmax 输出 0.95 的概率，并不意味着答案有 95% 的概率是正确的。

![LLM 的五大局限](/images/blog/agentic-02/llm-five-limitations.svg)

---

## 3. Agent 的精确定义

### 3.1 定义

**Agent = LLM + Memory + Tools + Planner + Runtime**

这不是一个松散的隐喻，而是一个精确的组件模型。每个组件有明确的职责边界：

| 组件 | 职责 | 类比 |
|------|------|------|
| **LLM** | 语义理解、推理、生成 | 大脑的语言区 |
| **Memory** | 存储对话历史、任务状态、长期知识 | 海马体 + 笔记本 |
| **Tools** | 与外部世界交互的能力集合 | 双手 + 工具箱 |
| **Planner** | 目标分解、行动排序、策略选择 | 前额叶皮层 |
| **Runtime** | 控制循环、状态管理、错误处理、生命周期 | 自主神经系统 |

### 3.2 组件交互模型

![Agent Runtime 组件交互模型](/images/blog/agentic-02/agent-runtime-architecture.svg)

**交互流程**：

1. **Runtime** 接收外部输入（用户消息、系统事件）
2. **Runtime** 从 **Memory** 加载相关上下文
3. **LLM** 基于输入 + 上下文进行推理
4. **Planner**（通常由 LLM 驱动）决定下一步行动
5. 如果需要执行操作，**Runtime** 调度 **Tools** 执行
6. 工具执行结果写回 **Memory**，进入下一轮循环

关键设计决策：**Planner 是一个独立组件，还是 LLM 的一部分？** 这取决于你对确定性的需求。如果 Planner 由 LLM 驱动（如 ReAct 模式），灵活但不可控；如果 Planner 是硬编码的状态机，可控但不灵活。这个 trade-off 贯穿整个 Agent 架构设计，我们会在第 03 篇深入讨论。

---

## 4. Agent 的核心循环详解

Agent 的运行可以抽象为六个阶段的循环：

![Agent 核心循环](/images/blog/agentic-02/agent-control-loop.svg)

### 4.1 各阶段详解

**Observe（感知）**：收集当前环境信息。这包括用户的最新输入、上一步工具的返回结果、系统级事件（如超时、异常）、从 Memory 中检索的相关上下文。感知阶段的核心问题是**信息筛选**——不是所有信息都应该进入 LLM 的上下文，context window 是稀缺资源。

**Think（推理）**：基于感知到的信息，理解当前处境。这是 LLM 最擅长的部分——语义理解、意图识别、情境分析。Think 阶段的输出是对当前状态的结构化理解，而不是最终答案。

**Plan（规划）**：基于对当前状态的理解，决定下一步做什么。Plan 可以是单步的（"调用天气 API"），也可以是多步的（"先查天气，再根据天气决定穿什么，再创建提醒"）。规划的粒度直接影响系统的可控性和灵活性。

**Act（执行）**：执行规划中的动作。可能是调用工具（Tool Calling）、生成文本回复、更新内部状态，或者向用户提问以获取更多信息。执行是唯一产生副作用的阶段。

**Reflect（反思）**：评估执行结果。工具调用成功了吗？返回的数据符合预期吗？是否需要重试或换一个方案？反思是 Agent 与简单 Chain 的关键区别——它引入了**自我纠错**的能力。

**Update（更新）**：将本轮循环中产生的信息写入 Memory。包括更新对话历史、记录执行结果、修改任务状态。Update 确保下一轮循环有最新的上下文可用。

### 4.2 最简实现

下面是这个控制循环的 Python 伪代码实现。注意，这不是生产代码，而是用于精确表达架构意图的最简抽象：

```python
from dataclasses import dataclass, field
from typing import Any

@dataclass
class AgentState:
    """Agent 的可序列化状态"""
    messages: list[dict] = field(default_factory=list)       # 对话历史
    task_status: str = "pending"                              # 任务状态
    plan: list[str] = field(default_factory=list)             # 当前计划
    step_index: int = 0                                       # 执行进度
    observations: list[Any] = field(default_factory=list)     # 感知缓冲

class Agent:
    def __init__(self, llm, tools: dict, max_iterations: int = 10):
        self.llm = llm
        self.tools = tools           # {"tool_name": callable}
        self.max_iterations = max_iterations
        self.state = AgentState()

    def run(self, user_input: str) -> str:
        self.state.messages.append({"role": "user", "content": user_input})

        for i in range(self.max_iterations):
            # --- Observe ---
            context = self._observe()

            # --- Think ---
            thought = self.llm.generate(
                system_prompt=THINK_PROMPT,
                messages=context,
            )

            # --- Plan ---
            plan = self.llm.generate(
                system_prompt=PLAN_PROMPT,
                messages=context + [{"role": "assistant", "content": thought}],
                response_format={"type": "json", "schema": PlanSchema},
            )

            if plan.action == "finish":
                return plan.final_answer

            # --- Act ---
            tool_name = plan.tool_name
            tool_args = plan.tool_args
            try:
                result = self.tools[tool_name](**tool_args)
            except Exception as e:
                result = f"Error: {e}"

            # --- Reflect ---
            reflection = self.llm.generate(
                system_prompt=REFLECT_PROMPT,
                messages=context + [
                    {"role": "assistant", "content": f"Action: {tool_name}({tool_args})"},
                    {"role": "tool", "content": str(result)},
                ],
            )

            # --- Update ---
            self.state.messages.append({"role": "assistant", "content": thought})
            self.state.messages.append({"role": "tool", "content": str(result)})
            self.state.observations.append({
                "step": i,
                "action": tool_name,
                "result": result,
                "reflection": reflection,
            })

            if reflection.should_retry:
                continue  # 重试当前步骤
            self.state.step_index += 1

        return "达到最大迭代次数，任务未完成。"

    def _observe(self) -> list[dict]:
        """从 Memory 中组装当前上下文"""
        # 实际系统中这里会有复杂的上下文压缩、检索等逻辑
        return self.state.messages[-20:]  # 简化：取最近 20 条消息
```

这段代码中有几个值得关注的设计决策：

1. **Think 和 Plan 分两次 LLM 调用**：可以使用不同的 system prompt 引导不同的思维模式，也便于独立观测和调试。代价是额外的 latency 和 token 成本。
2. **Plan 使用 Structured Output**：规划结果以 JSON Schema 约束，确保输出可解析、可校验。这是将 LLM 的非确定性输出转化为确定性执行的关键桥梁。
3. **Reflect 独立成阶段**：而不是合并到下一轮的 Think 中。这使得反思的 prompt 可以专注于"评估"而不是"理解+评估"，通常能得到更准确的自我评价。
4. **max_iterations 作为安全阀**：防止 Agent 陷入无限循环。这是生产系统中必须有的机制，没有它，一个错误的 Reflect 判断就可能导致无限重试。

---

## 5. 从 Chatbot 到 Agent 的光谱

Agent 不是一个二元概念——"是 Agent"或"不是 Agent"。从最简单的 LLM 调用到完整的 Agent 系统，中间存在一个连续的光谱，每向右移动一步，都在引入新的复杂性来换取新的能力。

![从 Chatbot 到 Agent 的光谱](/images/blog/agentic-02/agent-spectrum.svg)

下表从六个维度对比这个光谱的各个阶段：

| 阶段 | 记忆 | 工具 | 规划 | 状态 | 反思 | 典型产品/模式 |
|------|------|------|------|------|------|-------------|
| Pure LLM | 无 | 无 | 无 | 无 | 无 | 单次 API 调用 |
| + System Prompt | 无 | 无 | 无 | 无 | 无 | 定制化 Chatbot |
| + RAG | 外部知识 | 检索 | 无 | 无 | 无 | 知识问答系统 |
| + Tool Calling | 会话级 | 有 | 单步 | 无 | 无 | Function Calling |
| + Loop（ReAct） | 会话级 | 有 | 多步 | 运行时 | 隐式 | ReAct Agent |
| Full Agent | 长期 | 有 | 多步 | 持久化 | 显式 | 自主 Agent 系统 |

每个阶段的跃迁都有明确的 trade-off：

- **Pure LLM → + System Prompt**：几乎零成本，但能显著改变模型的行为风格和专业度。Trade-off：prompt 越长，留给用户输入的 context window 越少。
- **+ System Prompt → + RAG**：引入外部知识源，解决知识时效性和专业性问题。Trade-off：检索质量直接决定回答质量（garbage in, garbage out），且增加了 latency 和基础设施成本。
- **+ RAG → + Tool Calling**：从"只读"变成"可写"，LLM 可以触发外部操作。Trade-off：引入了安全风险（LLM 可能调用不该调用的工具）和确定性问题（工具调用可能失败）。
- **+ Tool Calling → + Loop**：从单次推理变成多步推理-执行循环。这是质变。Trade-off：循环次数不可预测，token 成本不可预测，调试复杂度指数级上升。
- **+ Loop → Full Agent**：引入持久化记忆和显式反思。Trade-off：系统复杂度大幅提升，需要处理记忆一致性、状态持久化、长时间运行等问题。

---

## 6. 一个完整的例子

用同一个任务——"帮我查看明天北京的天气并创建日程提醒"——展示不同阶段的实现差异。

### 6.1 Pure LLM

```python
response = llm.generate("帮我查看明天北京的天气并创建日程提醒")
# 输出：好的，明天北京的天气大约是 25°C，晴转多云...（纯幻觉，没有真实数据）
# 日程提醒也不会真的被创建
```

问题：没有真实数据，没有真实执行，一切都是生成的"假"内容。

### 6.2 LLM + RAG

```python
# 预先检索天气相关知识
weather_docs = retriever.search("北京天气预报")
context = format_docs(weather_docs)

response = llm.generate(
    f"根据以下信息回答用户问题：\n{context}\n\n用户：帮我查看明天北京的天气并创建日程提醒"
)
# 输出基于检索到的文档，但如果文档不包含明天的天气（高概率），仍然无法回答
# 日程提醒依然无法创建
```

问题：RAG 提供了知识，但无法获取实时数据，更无法执行"创建日程"这个写操作。

### 6.3 LLM + Tool Calling（单步）

```python
tools = [
    {
        "name": "get_weather",
        "description": "获取指定城市的天气预报",
        "parameters": {"city": "string", "date": "string"}
    },
    {
        "name": "create_reminder",
        "description": "创建日程提醒",
        "parameters": {"title": "string", "time": "string", "note": "string"}
    }
]

response = llm.generate(
    "帮我查看明天北京的天气并创建日程提醒",
    tools=tools,
)
# LLM 返回一个 tool_call：get_weather(city="北京", date="2025-08-04")
# 但只能调用一个工具——它选了查天气，日程提醒怎么办？
# 需要第二轮调用，但谁来发起？没有循环机制。
```

问题：单步 Tool Calling 只能执行一个动作。多步任务需要外部编排。

### 6.4 LLM + Tools + Loop（ReAct Agent）

```python
agent = Agent(llm=llm, tools={"get_weather": get_weather, "create_reminder": create_reminder})
result = agent.run("帮我查看明天北京的天气并创建日程提醒")

# Agent 内部执行过程：
#
# [Iteration 1]
# Think:  用户想查天气并创建提醒，我需要先查天气，再用天气信息创建提醒。
# Plan:   调用 get_weather(city="北京", date="2025-08-04")
# Act:    → {"temp": 31, "condition": "多云转雷阵雨", "humidity": 78}
# Reflect: 成功获取天气数据，接下来需要创建日程提醒。
# Update:  记录天气数据到 state。
#
# [Iteration 2]
# Think:  已获取天气信息（31°C，多云转雷阵雨），需要创建提醒。
# Plan:   调用 create_reminder(
#             title="明天北京天气提醒",
#             time="2025-08-04T07:00:00",
#             note="31°C，多云转雷阵雨，湿度 78%，建议带伞"
#         )
# Act:    → {"status": "created", "id": "rem_abc123"}
# Reflect: 提醒创建成功。两个子任务都已完成，可以返回最终结果。
# Plan:   finish
#
# 最终输出：
# "明天北京天气：31°C，多云转雷阵雨，湿度 78%。
#  已为您创建早上 7:00 的天气提醒，建议带伞。"
```

这才是我们期望的行为：**理解意图 → 分解任务 → 逐步执行 → 组合结果**。注意 Agent 做了几件 Pure LLM 做不到的事：

1. **任务分解**：识别出"查天气"和"创建提醒"是两个子任务，且有依赖关系
2. **信息传递**：把第一步的天气数据作为第二步的输入（note 字段）
3. **智能补全**：用户没说提醒时间，Agent 推断了一个合理的时间（早上 7 点）
4. **结果整合**：把多步执行的结果组合成一个连贯的自然语言回复

### 6.5 Full Agent（增加长期记忆与反思）

```python
# Full Agent 在 ReAct 基础上增加：

# 1. 长期记忆：记住用户偏好
user_profile = memory.recall(user_id="u_001")
# → {"preferred_reminder_time": "06:30", "weather_sensitivity": "rain"}

# 2. 个性化决策：基于用户历史偏好
# Agent 不再推断 7:00，而是使用用户偏好的 6:30
# Agent 知道用户对雨天敏感，会强调带伞建议

# 3. 显式反思：执行后回顾
reflection = agent.reflect(
    task="查天气并创建提醒",
    result=result,
    criteria=["信息完整性", "时间合理性", "个性化程度"]
)
# → "时间使用了用户偏好，天气包含了降雨提醒。但缺少穿衣建议，下次可以补充。"

# 4. 记忆更新：学习本次交互
memory.store(
    user_id="u_001",
    fact="用户关注北京天气，可能是北京居民或近期有出行计划",
    source="interaction_20250803"
)
```

Full Agent 的核心区别在于：**它在跨会话的时间尺度上持续学习和个性化**。这需要一个完整的 Memory 架构来支撑——短期会话记忆、长期用户画像、事实知识库——我们将在第 08 篇详细展开。

---

## 7. 按自主性重新定义演进光谱

前面第 5 节的光谱模型按**功能增强的维度**（记忆、工具、规划等）来划分阶段。但从工程决策的角度，一个更实用的维度是**推理深度**——即 Agent 在行动前能进行多深层次的思考。

根据推理深度，我们可以将 LLM 演进光谱重新分为三层：

| 推理层级 | 定义 | 对应光谱阶段 | 典型能力 | 成本范围 |
|---------|------|----------|---------|---------|
| **无推理**（Pure Lookup） | 直接匹配模式，零步骤规划 | Pure LLM、+System Prompt、+RAG | 知识查询、内容生成、分类 | 1 个 LLM 调用，< 10 元/千条 |
| **浅推理**（Single-step Decision） | 单步决策，直接选择工具和参数 | +Tool Calling | 工具集成、流程触发、参数填充 | 1-2 个 LLM 调用，10-50 元/千条 |
| **深推理**（Multi-step Planning + Reflection） | 多步规划、中途反思、路径修正 | +Loop(ReAct)、Full Agent | 复杂任务分解、自适应执行、错误恢复 | 3-10+ 个 LLM 调用，50-500+ 元/千条 |

**成本范围说明**：基于 GPT-4 定价（输入 $0.03/1K，输出 $0.06/1K），假设平均生成 200 token。实际成本取决于：
- 任务复杂度（需要多少轮迭代）
- LLM 模型选择（GPT-4 vs GPT-4o vs 开源模型）
- 上下文大小（Memory 中加载多少历史信息）
- 失败重试次数

**分层选择建议**：

1. **无推理**适合：知识密集、规则清晰、一次通过率高（如 FAQ 回答、文本分类、数据检索）
2. **浅推理**适合：工具数有限（3-10 个）、用户需求明确、工具间无复杂依赖（如日程创建、邮件发送、简单查询）
3. **深推理**适合：工具数众多（10+）、任务目标模糊需要逐步明确、需要中途纠错（如研究助手、复杂客服、自主规划）

**成本-收益权衡示例**：

假设一个"帮用户预约医生"的任务：

- **无推理方案**（直接 RAG）：用户提供"预约北京和睦家医院周一下午"→ 检索医院信息 → 返回预约链接。成本 $0.001，但无法处理"医生忙不了怎么办"这类分支情况。成功率 ~70%。

- **浅推理方案**（+Tool Calling）：LLM 理解用户需求 → 选择"查询医生档期"和"发起预约"两个工具。成本 $0.01，能处理基本分支。成功率 ~85%。

- **深推理方案**（+Loop）：LLM 先查询医生 → 发现周一无空位 → 主动推荐周二 → 用户同意 → 完成预约。成本 $0.05-0.1，但成功率 ~95%，且用户体验最佳。

如果用户转化价值 $100，那么成功率从 70% 升到 95% 的价值远高于成本增加。但如果这是一个客服系统需要处理 100 万次请求，成本差异就变成 $1000 vs $100000，可能需要考虑混合方案（大部分用户用浅推理，少数高风险用户用深推理）。

---

## 8. 确定性 vs 非确定性决策矩阵

在 Agent 系统中，一个关键的架构决策是：**给定特定的任务特征，我应该用确定性代码（Workflow）、非确定性 LLM（Pure Agent）还是混合方案？**

下表提供了一个实用的决策矩阵。纵轴是**变化频率**（环境变化有多快），横轴是**工具数量**（可用工具有多少），深度表示**错误代价**：

#### 决策矩阵（3×3×3）

**错误代价：低**（比如生成文案、回答问题）

| 工具数 \ 变化频率 | 低（几个月变一次） | 中（几周变一次） | 高（每天变） |
|---|---|---|---|
| **1-5** | **代码** ⭐ Pure Workflow | **代码** ⭐ Pure Workflow | **混合** 以代码为主 + RAG 更新 |
| **5-20** | **代码** ⭐ Workflow | **混合** Workflow + Optional LLM | **LLM** ⭐ + Tool Calling |
| **20+** | **混合** Workflow 骨架 + LLM 决策 | **LLM** ⭐ + Tool Calling | **LLM** ⭐ + ReAct Loop |

**错误代价：中**（比如数据修改、订单处理）

| 工具数 \ 变化频率 | 低 | 中 | 高 |
|---|---|---|---|
| **1-5** | **代码** ⭐ Pure Workflow | **代码** ⭐ Pure Workflow + 审计日志 | **代码** ⭐ Workflow + LLM 提示 |
| **5-20** | **代码** ⭐ Workflow | **混合** Workflow + LLM 风险评估 | **混合** LLM 决策 + 代码执行 |
| **20+** | **混合** LLM + 代码校验 | **混合** LLM + 代码校验 | **LLM** + 强制人工审批 |

**错误代价：高**（比如转账、删除、支付）

| 工具数 \ 变化频率 | 低 | 中 | 高 |
|---|---|---|---|
| **1-5** | **代码** + 人工审批 | **代码** + 人工审批 | **代码** + 人工审批 |
| **5-20** | **代码** + 人工审批 | **代码** + 人工审批 | **代码** + 人工审批 |
| **20+** | **代码** + 人工审批 | **代码** + 人工审批 | **代码** + 人工审批 |

#### 矩阵解读

**代码 (Pure Code)**：逻辑在编译时完全确定，典型是 Workflow（DAG）。优点：可预测、可审计、可测试。缺点：灵活性差，规则改变需要重新部署。适用于变化慢、分支清晰的任务。

**混合 (Hybrid)**：骨架由代码确定，关键决策由 LLM 做，关键操作由代码保护。优点：兼顾灵活性和可控性。缺点：复杂度高，调试困难。这是大多数生产 Agent 系统的现状。

**LLM (Pure Agent)**：决策链主要由 LLM 驱动，代码只负责工具调度和错误恢复。优点：最灵活，最能应对开放域问题。缺点：不可控，错误率高，成本高。适用于变化频繁、分支复杂、对确定性要求低的任务。

#### 决策矩阵应用示例

**示例 1：创建日历事件**
- 工具数：2-3（创建、更新、删除）
- 变化频率：低（日历 API 很少变）
- 错误代价：中（可能多创建一个事件，但不是灾难）
- **推荐**：纯代码 Workflow。用户说"明天 2 点开会"，直接解析 → 调用 create_event API。无需 LLM。

**示例 2：客服自动化（本节后面详细展开）**
- 工具数：8-15（查订单、查物流、申请退款、查库存等）
- 变化频率：中（新的促销政策、物流规则大约一周改一次）
- 错误代价：中（错误的退款处理可能需要人工纠正）
- **推荐**：混合方案。先用代码确定流程框架（查询 → 判断可退款性 → 触发退款），让 LLM 负责理解用户说的什么、判断是否满足退款条件，最后由代码执行具体操作。

**示例 3：研究助手**
- 工具数：20+（论文搜索、代码运行、数据分析、网页爬取等）
- 变化频率：高（新的研究方向不断涌现）
- 错误代价：低（生成的文案错了可以纠正）
- **推荐**：Pure Agent + ReAct Loop。用户的研究需求难以预测，需要多步推理。LLM 决定调用哪些工具、如何组合它们的输出。代码只负责工具可用性检查和输出解析。

---

## 9. 成本案例分析 — 客服多轮对话

现在用一个具体的客服场景量化不同方案的成本差异。

**场景设定**：用户联系客服说"我要退货，订单号是 ORD-2025-0001"。客服系统需要：
1. 查询订单详情（商品、金额、购买日期）
2. 判断是否在退货期限内
3. 确认退款方式
4. 执行退款并生成凭证

这个任务涉及 4 个工具：`query_order`、`check_return_policy`、`process_refund`、`generate_receipt`。

#### 方案对比

| 指标 | Pure LLM | LLM + Tool Calling | ReAct Agent |
|------|---------|------------------|-------------|
| **执行流程** | 无（只返回文本） | 单轮：理解 → 选工具 | 多轮：思考 → 计划 → 执行 → 反思 |
| **LLM 调用次数** | 1 | 2-3 | 4-6 |
| **平均生成 token** | 150 | 300 | 600 |
| **平均输入 token** | 200 | 800 | 1500 |
| **总 token 成本** | 350 | 1400-1800 | 2400-3300 |
| **成本估算**（¥/次）| 0.03 | 0.12-0.15 | 0.20-0.28 |
| **API 调用次数**（工具） | 0 | 1-2 | 3-4 |
| **平均延迟** | 1-2s | 3-5s | 5-10s |
| **任务成功率** | ~20% | ~60% | ~95% |
| **需要人工介入** | 80% | 40% | 5% |

#### 详细执行过程

**方案 A：Pure LLM**

Pure LLM 模式下，模型仅凭训练知识生成回复，没有调用任何工具或数据源：

![Pure LLM 单次调用流程](/images/blog/agentic-02/pure-llm-flow.svg)

用户说"我要退货"，LLM 直接生成了一段看似合理的回复——但仔细看就会发现问题：它说"订单应该符合退货条件"（没有查询，全凭猜测），给出的退货期限是"7 天"（实际政策是 30 天，典型的幻觉），更无法识别订单已退或权限异常等边界情况。成功率仅约 20%，80% 的场景需要人工介入。

**方案 B：LLM + Tool Calling（单步）**

Tool Calling 模式下，LLM 能调用外部工具获取真实数据，但每轮只能执行单步操作，需要用户驱动下一步：

![Tool Calling 2 轮交互流程](/images/blog/agentic-02/tool-calling-flow.svg)

**第 1 轮：查询订单。** 用户说"我要退货"，LLM 识别意图后调用 `query_order("ORD-2025-0001")`，拿到订单详情（iPhone 15 Pro, ¥8999, 已购 23 天），确认符合 30 天退货政策，回复用户并询问退款方式。

**第 2 轮：处理退款。** 用户选择"原卡退款"，LLM 先调用 `check_return_policy()` 确认可退，再调用 `process_refund()` 执行退款，返回退款单号和预计到账时间。

这个方案能解决问题，但存在明显局限：每一步都需要用户等待和输入；如果在 `check_return_policy` 时发现用户不符合条件（比如已过期），系统无法自动调整策略，需要用户再发一条消息；总共需要 2 轮交互。

**方案 C：ReAct Agent（多步循环 + 反思）**

与前两种方案不同，ReAct Agent 在收到用户请求后自主完成多轮推理，每轮都经历 Observe → Think → Act → Reflect 的完整循环：

![ReAct Agent 3 轮迭代流程](/images/blog/agentic-02/react-agent-iterations.svg)

我们来展开看每一轮迭代的细节：

**迭代 1：查询订单。** Agent 首先识别出退货请求需要订单信息，调用 `query_order("ORD-2025-0001")`，拿到商品为 iPhone 15 Pro、金额 8999 元、购买日期 2025-02-01。Reflect 阶段发现关键信号：购买至今已 52 天，可能超出退货期。

**迭代 2：检查退货政策。** 基于上一轮的判断，Agent 调用 `check_return_policy("ORD-2025-0001")`，确认订单已超出 30 天退货期限。Reflect 阶段没有就此止步，而是进一步思考：虽然标准退货不可行，但应该为用户提供有帮助的替代方案。

**迭代 3：生成替代方案。** Agent 综合前两轮收集的信息，生成一个友好的回复，包含三个可选方案（维修/换货、退货申诉、争议解决），并将选择权交还给用户。

最终系统回复（一次返回）：

> 感谢您的咨询。我查到您的 iPhone 15 Pro 订单已于 2 月 1 日购买，至今已经 52 天，已超出我们的 30 天退货期限。
>
> 但别担心，您还有以下选项：
> 1. 如果产品有质量问题，我们可以为您维修或换货（保修期 1 年）
> 2. 您可以发起退货申诉，我们的人工客服会为您审核
> 3. 如果产品功能完好，暂不符合退货条件
>
> 请告诉我：产品目前有什么问题吗？

这个方案的优势很明显：一轮对话就解决了问题，用户无需多次等待；Agent 自动识别超期问题并主动提供替代方案；如果用户后续回复"屏幕坏了"，Agent 下一轮可以直接调用维修流程。成功率 95% 以上，需要人工介入的概率仅 5%。

#### 成本分析表

基于 GPT-4o 定价（输入 $0.005/1K，输出 $0.015/1K）和人民币汇率 7：

| 成本项 | Pure LLM | Tool Calling | ReAct Agent |
|------|---------|-------------|-----------|
| **LLM token 成本** | 0.002¥ | 0.010¥ | 0.025¥ |
| **API 调用成本**（假设 0.01¥/次） | 0¥ | 0.01-0.02¥ | 0.03-0.04¥ |
| **人工客服成本**（假设 1¥/分钟） | 0.4¥ | 0.15¥ | 0.01¥ |
| **总成本/次** | **0.40¥** | **0.17¥** | **0.07¥** |
| **年度成本**（百万次交互） | **400万¥** | **170万¥** | **70万¥** |

关键发现：

1. **LLM token 成本差异不大**，从 0.002¥ 到 0.025¥ 是小头
2. **真正的成本驱动是人工客服介入率**：Pure LLM 需要 80% 人工介入，成本 0.4¥；ReAct 只需 5%，成本 0.07¥
3. **从 Pure LLM 到 ReAct Agent，总成本下降 82%**，同时用户满意度提升（解决时间从分钟级降到秒级）
4. **即使考虑 Agent 系统的研发成本**（假设 50 人月 = 500 万），一年百万级交互就能回本

## 10. Agent 的设计哲学

### 10.1 LLM as the Reasoning Engine, Not the Entire System

这是 Agent 架构最核心的设计原则。LLM 是推理引擎，不是整个系统。就像汽车的发动机不是汽车本身——你还需要变速箱（Planner）、方向盘（Tools）、仪表盘（Memory）和底盘（Runtime）。

这个原则的工程含义是：**不要让 LLM 做所有事情。** 让它做它擅长的——语义理解、推理、决策——然后用确定性代码处理其余部分。

### 10.2 确定性 vs 非确定性的边界

Agent 系统的核心设计问题之一是：**哪些部分让 LLM 做（非确定性），哪些部分用代码做（确定性）？**

![确定性 vs 非确定性](/images/blog/agentic-02/deterministic-vs-nondeterministic.svg)

决策原则：

1. **如果逻辑可以穷举，用代码**。比如"用户必须先登录才能创建日程"——这是业务规则，不需要 LLM 判断。
2. **如果需要理解自然语言语义，用 LLM**。比如"用户说'帮我约个会'是什么意思"——这需要语义理解。
3. **如果错误的代价很高，用代码兜底**。比如转账操作的金额校验，无论 LLM 怎么说，都必须用代码做最终确认。
4. **如果需要处理开放域输入，用 LLM**。比如用户可能用任何方式描述他们的需求，只有 LLM 能处理这种多样性。

### 10.3 何时不需要 Agent

并非所有问题都需要 Agent。以下场景用更简单的方案更好：

- **固定流程的自动化**：发票处理、数据同步——用 Workflow（DAG）更可靠
- **单轮问答**：FAQ、知识检索——LLM + RAG 就够了
- **确定性决策**：基于规则的审批——规则引擎更合适
- **高吞吐低延迟**：实时推荐——Agent 的多轮调用延迟太高

Agent 的最佳应用场景是：任务需要多步推理、工具组合使用、且执行路径在运行时才能确定。如果执行路径在编译时就能确定，你需要的是 Workflow，不是 Agent。

---

## 11. 总结与思考

本文从 LLM 的本质出发，论证了为什么 `f(prompt) → response` 不等于 Agent。核心论点可以压缩为一句话：

> **LLM 是推理能力的来源，Agent 是将推理能力转化为行动能力的系统。**

我们建立了三个关键的心智模型：

1. **组件模型**：Agent = LLM + Memory + Tools + Planner + Runtime，五个组件各有职责，协作运行。
2. **循环模型**：Observe → Think → Plan → Act → Reflect → Update，Agent 通过控制循环将单次推理扩展为多步执行。
3. **光谱模型**：从 Pure LLM 到 Full Agent 是一个连续光谱，每一步都有明确的能力增益和复杂性代价。

### 进一步思考

在进入下一篇之前，留几个值得深入思考的问题：

**关于 Agent 的边界**：如果 Planner 是硬编码的（比如一个固定的 DAG），这还算 Agent 吗？如果所有工具都是预定义的、参数是模板化的，LLM 只负责填参数，这算 Agent 还是 Workflow？这个边界在哪里，决定了你在工程实践中应该选择什么样的架构。

**关于 LLM 的演进**：随着模型能力的增强（更长的 context window、更强的 reasoning、内置的 tool use），LLM 和 Agent 之间的边界是否会逐渐模糊？OpenAI 的 o1/o3 系列通过 chain-of-thought 在模型内部实现了某种程度的"规划"，这是否意味着 Agent Runtime 的部分功能会被吸收进模型本身？

**关于成本和延迟**：Agent 的每一轮循环都包含至少一次 LLM 调用。如果一个任务需要 5 轮循环，每轮 3 次 LLM 调用（Think + Plan + Reflect），就是 15 次调用。这个成本和延迟在生产环境中是否可接受？如何在 Agent 的灵活性和系统的性能之间找到平衡点？

这些问题没有标准答案，但它们定义了 Agentic 系统设计的核心张力。
