---
title: "Agent 的形态与边界：从 Copilot 到自主系统"
description: "Agent 不是一种东西，而是一个光谱。本文从自主性维度划分 Agent 的四种形态——路由型、工具型、任务型、自主型，讨论每种形态的架构特征与适用场景，明确 Agent 在系统中的定位与设计边界，为后续深入控制循环和工具调用建立认知框架。"
pubDate: "2025-12-09"
tags: ["Agentic", "AI Engineering", "Architecture"]
series:
  key: "agentic"
  order: 3
author: "skyfalling"
---

---

## 1. Agent 不止一种形态

当人们说"Agent"的时候，他们可能在说完全不同的东西。

GitHub Copilot 是 Agent——它理解你正在写的代码，预测你下一步要写什么，在你按下 Tab 的瞬间完成补全。Cursor 是 Agent——它能根据一句自然语言指令修改多个文件、运行测试、修复错误。AutoGPT 是 Agent——你给它一个目标，它自己拆解任务、搜索信息、写代码、反复迭代。

但这三者的架构复杂度、自主性程度、适用场景完全不同。把它们放在同一个词"Agent"下面讨论，就像把自行车、汽车、飞机都叫"交通工具"然后讨论"交通工具的最佳实践"——抽象层次太高，什么有用的结论都得不出来。

要做出正确的架构决策，第一步是**区分 Agent 的形态**。不是所有 Agent 都需要控制循环，不是所有 Agent 都需要记忆，不是所有 Agent 都需要规划。选错形态的代价，和选错技术栈一样大。

---

## 2. 自主性光谱

理解 Agent 的形态，最有效的维度是**自主性**（Autonomy）——Agent 在多大程度上独立做出决策和执行行动，而不需要人类干预。

![Agent 自主性光谱](/images/blog/agentic-03/autonomy-spectrum.svg)

### 2.1 L1：单次推理（Single Inference）

最简形态。一次 LLM 调用，输入进去，结果出来，没有循环，没有工具，没有记忆。

```python
# L1: 一次调用，一次输出
def classify_ticket(ticket_text: str) -> str:
    response = llm.chat(messages=[
        {"role": "system", "content": "将工单分为: bug / feature / question"},
        {"role": "user", "content": ticket_text}
    ])
    return response.content  # "bug"
```

这算 Agent 吗？严格来说不算——它没有控制循环，没有自主决策。但它是 Agent 架构的**起点**，很多生产系统中最有价值的 AI 能力就是一个精心设计的 L1 调用。

**典型场景**：文本分类、意图识别、内容审核、情感分析、翻译。

**关键特征**：延迟低（一次 LLM 调用）、成本可控（固定 Token 消耗）、行为可预测（相同输入近似相同输出）。

### 2.2 L2：工具增强（Tool-Augmented）

LLM 不再只是生成文本，它可以**调用工具**与外部世界交互。但通常只有 1-2 轮工具调用，人类仍然在回路中审查结果。

```python
# L2: LLM 选择工具，执行 1-2 轮
def answer_with_search(question: str) -> str:
    response = llm.chat(
        messages=[{"role": "user", "content": question}],
        tools=[search_tool, calculator_tool]
    )
    if response.tool_call:
        # LLM 决定调用搜索
        result = execute_tool(response.tool_call)
        # 将工具结果返回给 LLM，生成最终回答
        final = llm.chat(messages=[
            {"role": "user", "content": question},
            {"role": "assistant", "tool_calls": [response.tool_call]},
            {"role": "tool", "content": result}
        ])
        return final.content
    return response.content
```

L2 是目前生产环境中最常见的 Agent 形态。Perplexity 的搜索回答、ChatGPT 的代码执行、Claude 的文件分析——本质上都是 L2。

**典型场景**：搜索增强问答（RAG）、数据查询、代码执行、文件处理。

**关键特征**：工具调用轮数有限（通常 1-3 轮）、人类在回路中（看到结果后决定下一步）、每次执行的成本和延迟可预估。

### 2.3 L3：任务驱动（Task-Driven）

Agent 接收一个目标，**自主规划和执行多个步骤**来完成任务。它有控制循环、能调用多种工具、能根据中间结果调整策略。但它的自主范围被限定在一个具体任务内。

```python
# L3: 多步自主执行，有控制循环
class TaskAgent:
    def __init__(self, llm, tools, max_steps=10):
        self.llm = llm
        self.tools = tools
        self.max_steps = max_steps

    def run(self, task: str) -> str:
        messages = [{"role": "user", "content": task}]

        for step in range(self.max_steps):
            response = self.llm.chat(messages=messages, tools=self.tools)

            if response.is_final_answer:
                return response.content

            # 自主决定调用什么工具
            tool_result = execute_tool(response.tool_call)
            messages.append({"role": "assistant", "content": response.raw})
            messages.append({"role": "tool", "content": tool_result})

        return "达到最大步数限制"
```

L3 是 Agent 从"辅助工具"变成"独立执行者"的分水岭。Cursor 的多文件修改、Claude Code 的编程任务、数据分析 Agent——它们接收一个目标，自己决定执行路径，自己处理中间错误。

**典型场景**：代码生成与调试、数据分析报告、多步骤信息检索、系统运维诊断。

**关键特征**：有控制循环（[第 04 篇](/blog/engineering/agentic/04-Agent控制循环：运行时的核心抽象)将深入讨论）、执行路径不确定、需要 Guardrail 限制行为边界、单次执行成本和延迟波动大。

### 2.4 L4：自主系统（Autonomous）

Agent 不再只是完成一个给定任务——它可以**自己设定子目标、长时间运行、跨会话保持状态**。它有持久记忆、能自我反思、能从失败中学习。

L4 是 Agent 研究的前沿，也是生产落地最困难的形态。AutoGPT、BabyAGI 是早期尝试，Devin 是更近的探索。它们的共同特点是：**令人兴奋的 demo，令人头疼的生产化。**

为什么 L4 很难落地？

- **目标漂移**：长时间运行中，Agent 可能偏离原始目标，去做"看起来有用但实际上不相关"的事情
- **成本失控**：没有固定的步骤上限，Token 消耗和 API 调用难以预算
- **错误累积**：每一步的小错误在多步执行中指数级放大，10 步之后可能完全偏离正确路径
- **缺乏人类校准**：自主执行意味着人类失去了"中间检查点"，等发现问题时已经浪费了大量资源

**当前状态**：L4 在受控环境中（如代码生成、游戏 AI）有一定成果，但在开放领域的通用自主 Agent 仍然不成熟。大多数生产系统应该瞄准 L2-L3。

### 2.5 形态对比

| 维度 | L1 单次推理 | L2 工具增强 | L3 任务驱动 | L4 自主系统 |
|---|---|---|---|---|
| **控制循环** | 无 | 1-3 轮 | 多轮，有终止条件 | 持续运行 |
| **工具使用** | 无 | 有，轮数有限 | 有，动态选择 | 有，可自主发现 |
| **记忆** | 无 | 短期（当前会话） | 工作记忆 | 长期 + 持久 |
| **规划** | 无 | 无 | 有（隐式或显式） | 有，可自我修订 |
| **人类参与** | 每次都在 | 审查结果 | 设定目标 + 审查 | 仅设定初始目标 |
| **单次成本** | $0.001-0.01 | $0.01-0.05 | $0.05-0.50 | $0.50-50+ |
| **延迟** | 1-3s | 3-10s | 10s-5min | 分钟-小时 |
| **生产就绪度** | 高 | 高 | 中 | 低 |
| **典型产品** | GPT 分类器 | Perplexity, ChatGPT | Cursor, Claude Code | AutoGPT, Devin |

一个关键洞察：**自主性越高，能力越强，但可控性越差。** 架构设计的核心 trade-off 就是在这两个维度之间找到平衡点。

---

## 3. 四种架构形态

自主性光谱告诉你"Agent 有多自主"，但还需要另一个维度来指导架构决策——**Agent 在系统中扮演什么角色**。同一个自主性级别，因为角色不同，架构也完全不同。

### 3.1 Router Agent（路由型）

**角色**：智能分发器。接收输入，理解意图，路由到正确的下游处理逻辑。自身不执行业务操作。

![Router Agent](/images/blog/agentic-03/router-agent.svg)

```python
class RouterAgent:
    """将用户请求路由到正确的处理器"""
    def __init__(self, llm, handlers: dict[str, callable]):
        self.llm = llm
        self.handlers = handlers

    def route(self, user_input: str) -> str:
        # LLM 做意图分类
        intent = self.llm.chat(messages=[
            {"role": "system", "content": f"""
                判断用户意图，返回以下类别之一:
                {', '.join(self.handlers.keys())}
            """},
            {"role": "user", "content": user_input}
        ]).content.strip()

        # 路由到确定性处理器
        handler = self.handlers.get(intent, self.handlers["fallback"])
        return handler(user_input)

# 使用
router = RouterAgent(llm, {
    "order_query": query_order_system,       # 确定性逻辑
    "refund_request": process_refund,         # 确定性逻辑
    "general_question": answer_from_kb,       # 可能是另一个 Agent
    "fallback": transfer_to_human,            # 人工兜底
})
```

Router Agent 的价值在于它用 LLM 的理解能力替代了传统的意图分类模型或关键词匹配，但下游的处理逻辑仍然是确定性的。这是 LLM 最"划算"的用法之一——**用最少的推理成本撬动最大的系统价值**（一次调用 → 正确路由）。

**适用场景**：客服系统的意图分流、API Gateway 的请求路由、多模型系统的模型选择。

**设计要点**：Router 的输出必须是**枚举值**（从预定义的类别中选择），不能是自由文本。这保证了路由结果可以被下游确定性系统消费。

### 3.2 Tool Agent（工具型）

**角色**：增强型助手。具备调用工具的能力，但在有限的轮次内完成任务，人类始终在回路中。

Tool Agent 是 L2 自主性的典型实现。它和 Router Agent 的区别在于：Router 只做分类，Tool Agent 实际执行工具调用并整合结果。

```python
class ToolAgent:
    """调用工具回答问题，限定轮次"""
    def __init__(self, llm, tools: list, max_rounds: int = 3):
        self.llm = llm
        self.tools = tools
        self.max_rounds = max_rounds

    def run(self, question: str) -> str:
        messages = [{"role": "user", "content": question}]

        for _ in range(self.max_rounds):
            response = self.llm.chat(messages=messages, tools=self.tools)

            if response.is_final_answer:
                return response.content

            # 执行工具调用
            result = execute_tool(response.tool_call)
            messages.extend([
                {"role": "assistant", "content": response.raw},
                {"role": "tool", "content": result}
            ])

        # 超过轮次，用已有信息给出最终回答
        messages.append({
            "role": "user",
            "content": "请基于以上信息直接给出回答"
        })
        return self.llm.chat(messages=messages).content
```

**适用场景**：搜索增强问答、数据库查询、实时信息检索、文件分析。

**设计要点**：`max_rounds` 是 Tool Agent 和 Task Agent 的分界线。当你把 `max_rounds` 设成 3，Agent 的行为是可预估的；设成 20，它就变成了 Task Agent，行为的可预测性急剧下降。

### 3.3 Task Agent（任务型）

**角色**：独立执行者。接收一个目标，自主规划和执行多步骤操作。有控制循环，能根据中间结果动态调整。

Task Agent 是 L3 自主性的典型实现，也是当前 Agent 工程的核心战场。它和 Tool Agent 的本质区别不是"步骤多少"，而是**有没有规划能力和自我纠错能力**。

Task Agent 的核心架构在[第 04 篇](/blog/engineering/agentic/04-Agent控制循环：运行时的核心抽象)有完整的控制循环设计，[第 10 篇](/blog/engineering/agentic/10-规划与反思：从ReAct到分层规划与自我纠错)深入讨论规划与反思机制。这里只给出架构轮廓：

```python
class TaskAgent:
    """自主执行复杂任务"""
    def __init__(self, llm, tools, memory, max_steps=15):
        self.llm = llm
        self.tools = tools
        self.memory = memory          # 工作记忆
        self.max_steps = max_steps

    def run(self, goal: str) -> str:
        # 1. 规划：将目标拆解为子步骤
        plan = self.plan(goal)

        # 2. 执行：逐步执行，动态调整
        for step in range(self.max_steps):
            observation = self.observe()
            action = self.think(observation, plan)

            if action.type == "finish":
                return action.result

            result = self.act(action)
            self.memory.add(step, action, result)

            # 3. 反思：评估结果，必要时修订计划
            if self.should_replan(result, plan):
                plan = self.replan(goal, self.memory)

        return self.summarize_progress()
```

**适用场景**：代码生成与修复、数据分析与报告生成、复杂信息检索、运维故障诊断。

**设计要点**：Task Agent 必须有三道防线——**最大步数限制**防止死循环、**Token 预算**防止成本失控、**输出验证**防止结果不可用。没有这三道防线的 Task Agent 不应该上生产。

### 3.4 形态选择指南

面对一个具体需求，如何选择 Agent 形态？核心判断依据是两个问题：

**问题一：需要几轮 LLM 推理？**

- 1 轮 → Router Agent 或 L1 单次推理
- 1-3 轮 → Tool Agent
- 3+ 轮，且路径不确定 → Task Agent

**问题二：执行路径是否可预知？**

- 可枚举所有路径 → Router Agent（每条路径对应一个 handler）
- 路径大致确定，但需要动态获取信息 → Tool Agent
- 路径取决于中间结果，无法预知 → Task Agent

一个容易犯的错误是**高估所需的自主性**。很多看起来需要 Task Agent 的场景，仔细分析后发现用 Router + 几个确定性 handler 就能解决。每一级自主性的提升都带来成本、延迟和不可预测性的显著增加——选择你真正需要的最低级别。

---

## 4. Agent 的能力边界

Agent 的强项是处理模糊性——理解自然语言、动态选择行动、适应未预见的输入。但这个强项也精确地定义了它的**边界**：当任务不包含模糊性时，Agent 就不是正确的工具。

### 4.1 三个"不要用 Agent"的信号

**信号一：输入输出完全可枚举。** 如果给定的输入集合是有限的，每个输入对应的输出是确定的，这就是规则引擎的工作。告警阈值判断、订单状态流转、计费逻辑——这些场景用 `if/else` 或状态机实现，成本接近零、延迟微秒级、100% 可预测。引入 Agent 意味着用 1000 倍的成本换来更差的可靠性。

**信号二：步骤固定，只有执行顺序的问题。** ETL Pipeline、CI/CD 流程、批处理任务——步骤是预定义的，步骤之间的依赖关系是确定的。这是 Workflow 引擎（Airflow、Temporal）的领地。Agent 在这里的"价值"只是用 LLM 重新发现你已经知道的步骤顺序，纯属浪费。

**信号三：要求 100% 确定性。** 金融交易、支付处理、合规审计——这些场景不能容忍"大概率正确"。LLM 的非确定性在这里不是"回答质量下降"，而是"用户的钱没了但订单没更新"。

### 4.2 Agent 的正确位置

一条简洁的判断规则：

> **Agent 处理模糊性，确定性系统处理其余一切。**

在一个真实的生产系统中，需要 LLM 推理的部分通常只占 20%。客服系统里，70% 的问题用 FAQ 匹配就能解决，20% 用模板化的订单查询，只有 10% 需要 Agent 真正去"理解"和"推理"。

这意味着 Agent 的正确角色不是"系统的大脑"，而是**系统的某一个节点**——处理那些确定性逻辑覆盖不了的模糊地带。下一节会展开这个设计原则。

---

## 5. Agent 在系统中的定位

理解了 Agent 的形态和边界，接下来要回答一个架构层面的问题：**Agent 应该放在系统的哪个位置？**

### 5.1 核心原则：Agent 是节点，不是系统

最常见的架构错误是让 Agent 控制整个流程。

```python
# 错误：让 Agent 控制整个流程
agent.run("从数据库读取用户评论，分析情感，把结果写回数据库")
# Agent 可能：用错 SQL、忘记写回、写入格式错误...
```

正确的做法是：**确定性系统定义骨架，Agent 只负责需要推理的那一步。**

```python
# 正确：确定性系统控制流程，Agent 只做推理
def step_1_extract(ctx):
    """确定性：固定 SQL 读取数据"""
    return db.query("SELECT id, comment FROM reviews WHERE date = %s", ctx["date"])

def step_2_analyze(ctx):
    """Agent 节点：情感分析（需要理解自然语言）"""
    results = []
    for review in ctx["step_1_extract"]:
        sentiment = agent.run(
            f"分析以下评论的情感倾向(positive/negative/neutral):\n{review['comment']}"
        )
        results.append({"id": review["id"], "sentiment": sentiment})
    return results

def step_3_load(ctx):
    """确定性：固定逻辑写回数据库"""
    for item in ctx["step_2_analyze"]:
        db.execute("UPDATE reviews SET sentiment = %s WHERE id = %s",
                   (item["sentiment"], item["id"]))

# Workflow 控制整体编排
workflow.add_step(Step("extract", step_1_extract))
workflow.add_step(Step("analyze", step_2_analyze, depends_on=["extract"]))
workflow.add_step(Step("load", step_3_load, depends_on=["analyze"]))
```

这种模式的好处是：数据读取和写入是 100% 可靠的（固定 SQL），即使 Agent 在情感分析上偶尔出错，也不会影响数据完整性。

### 5.2 输出契约：Agent 与确定性系统的接口

Agent 作为系统中的一个节点，它的输出必须满足下游系统的输入要求。自由文本对人类友好，但对程序不友好——下游代码无法解析"这封邮件看起来像是垃圾邮件，因为..."。

解决方案是**结构化输出**（Structured Output）：强制 Agent 以预定义的 Schema 输出。

```python
# 自由文本输出 — 下游无法消费
result = agent.run("判断这封邮件是否是垃圾邮件")
# "这封邮件看起来像是垃圾邮件，因为..."  → 下游怎么解析？

# 结构化输出 — 下游直接消费
result = agent.run(
    "判断这封邮件是否是垃圾邮件",
    response_format={
        "type": "object",
        "properties": {
            "is_spam": {"type": "boolean"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "reason": {"type": "string"}
        },
        "required": ["is_spam", "confidence"]
    }
)
# {"is_spam": true, "confidence": 0.92, "reason": "..."} → 下游直接用 result["is_spam"]
```

结构化输出建立了 Agent 和确定性系统之间的**接口契约**：Agent 负责推理，但推理结果必须符合预定义格式。这让 Agent 可以被嵌入到任何确定性流程中，而不会因为输出格式不稳定导致下游崩溃。

### 5.3 输出验证：信任但验证

即使有了结构化输出，Agent 的结果仍然需要验证。LLM 可能输出不在枚举范围内的值、可能返回不符合业务规则的决策、甚至可能返回格式正确但内容荒谬的结果。

```python
def analyze_with_validation(ctx):
    """Agent 步骤 + 输出验证"""
    VALID_SENTIMENTS = {"positive", "negative", "neutral"}
    results = []
    for review in ctx["reviews"]:
        sentiment = agent.run(f"分析情感倾向: {review['comment']}")
        # 验证 Agent 输出
        sentiment = sentiment.strip().lower()
        if sentiment not in VALID_SENTIMENTS:
            sentiment = "neutral"  # fallback 到安全默认值
            log.warning(f"Agent 输出无效值，已 fallback: review_id={review['id']}")
        results.append({"id": review["id"], "sentiment": sentiment})
    return results
```

验证层的设计原则是**宽进严出**：允许 Agent 自由推理（不限制它的思考过程），但在输出端严格校验（不符合契约的结果一律拒绝或 fallback）。

### 5.4 混合架构实例：AIOps

一个完整的混合架构案例——智能运维系统：

![AIOps 混合架构](/images/blog/agentic-03/aiops-hybrid.svg)

这个系统把三种执行模式组合在一起：

- **告警去重和分级**：纯规则逻辑。相同告警 5 分钟内只触发一次，按阈值自动分级（P4-P1）。这里不需要任何 LLM 推理。
- **已知故障自动修复**：预定义的修复剧本。CPU 高 → 扩容，磁盘满 → 清理日志，OOM → 重启服务。固定逻辑，固定动作。
- **未知故障根因分析**：这才是 Agent 的用武之地。Agent 查看日志、查询监控指标、检查最近的部署变更，综合判断根因。如果 Agent 能确定根因，触发对应的修复流程（确定性执行）；如果无法确定，升级到人工。

注意 Agent 在这个架构中的位置——它只处理"未知故障的根因分析"这一个环节，占整个系统工作量的不到 20%。但正是这 20%，是规则引擎和预定义剧本无法覆盖的部分。

---

## 6. Agent 的代价

选择更高自主性的 Agent 形态意味着接受更高的代价。这些代价在 demo 阶段容易被忽视，在规模化阶段会成为真实的痛点。[第 14 篇](/blog/engineering/agentic/14-生产级Agent系统：评估、成本与安全)会深入讨论生产化的完整挑战，这里只给出一张速查表帮助前期选型。

| 代价维度 | L1 单次推理 | L2 工具增强 | L3 任务驱动 |
|---|---|---|---|
| **Token 成本** | 固定，可预算 | 近似固定（1-3轮） | 超线性增长，难预算 |
| **延迟** | 1-3s | 3-10s | 10s-分钟级 |
| **可预测性** | 高 | 较高 | 低（相同输入可能走不同路径） |
| **调试难度** | 低（一次调用） | 中（几轮调用） | 高（需要完整 Trace） |
| **失败影响** | 单次结果不准 | 单次结果不准 | 多步执行偏离，可能产生副作用 |

其中最容易被低估的是 **Token 成本的超线性增长**。Task Agent 的每一步都要重发之前所有的对话历史，5 步 Agent 单次执行的 Token 总量不是 5x，而是约 15x（因为上下文累积）。以 GPT-4o 计价，一个 5 步 Agent 单次执行约 $0.03-0.05。日调用 10 万次，月成本 $90,000-$150,000。

**原则：选择能完成任务的最低自主性级别。** 能用 L1 解决的不要用 L2，能用 L2 解决的不要用 L3。每一级自主性的提升都应该有明确的业务理由。

---

## 7. 常见误区

### 误区一：因为"想用 AI"而选高自主性 Agent

技术选型应该从问题出发，不是从解决方案出发。"我们想用 AI"不是选 Task Agent 的理由，"用户输入是自然语言且意图不可穷举、处理路径取决于中间结果"才是。很多场景下一个 Router Agent 就够了。

### 误区二：跳过 L1/L2 直接上 L3

这是最常见的过度工程。团队花三个月构建了一个复杂的 Task Agent，结果发现 90% 的请求只需要一次 LLM 调用就能处理。正确的路径是**从最简形态开始，只在遇到真实瓶颈时升级**——先用 L1 做分类，发现不够就加工具变成 L2，发现还不够再加控制循环变成 L3。

### 误区三：让 Agent 同时负责决策和执行

Agent 应该只负责"决定做什么"（What），具体的"怎么做"（How）交给确定性系统。Agent 决定"需要给用户退款"，但调用退款 API 的逻辑是固定代码，不是 Agent 自己拼 HTTP 请求。决策和执行分离，是 Agent 可靠性的基础。

### 误区四：忽视 Agent 的失败模式

Agent 会失败——它会幻觉、会循环、会选错工具、会超时。你的系统必须回答：Agent 失败了怎么办？有没有 Fallback？有没有人工兜底？对于 Task Agent（L3），还需要考虑：中间步骤已经产生了副作用（比如发了一封邮件），后续步骤失败了怎么回滚？

### 误区五：用 Agent 替代状态机

订单流转、审批流程、工单生命周期——这些有限状态机（FSM）问题有成熟的解决方案。它们的状态和转换规则完全确定，需要事务保证和补偿机制。把它们交给 Agent，就是用一个非确定性系统去做确定性工作，得到的只有更高的成本和更差的可靠性。

---

## 8. 总结

回到这篇文章的核心问题：Agent 有哪些形态？边界在哪里？

三个要点：

1. **Agent 是一个光谱，不是一个点。** 从 L1 单次推理到 L4 自主系统，不同形态的架构复杂度、成本、可控性差异巨大。选择你真正需要的最低自主性级别。

2. **Agent 的正确位置是模糊性处理器。** 在混合架构中，确定性系统处理 80% 的工作，Agent 只处理那 20% 需要理解和推理的部分。Agent 是系统的一个节点，不是整个系统。

3. **形态决定架构。** Router Agent 只需要一次 LLM 调用和一个枚举校验；Task Agent 需要控制循环、工作记忆、规划能力、输出验证和多层 Guardrail。在动手实现之前，先确定你要建的是哪种 Agent。

下一篇，我们深入 Agent 最核心的运行时抽象——控制循环。
