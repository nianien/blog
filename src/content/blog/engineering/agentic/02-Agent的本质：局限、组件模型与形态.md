---
title: "Agent的本质：局限、组件模型与形态"
pubDate: "2025-12-05"
description: "Agent 不是更大的 LLM，而是补齐 LLM 五大局限的系统。本文给出 Agent 的组件分解、Observe-Think-Plan-Act-Reflect-Update 循环的最小落地、自主性 L1-L4 的关键机制差异，以及为什么成本驱动是人工介入率而不是 token 的工程账。"
tags: ["Agentic", "AI Engineering", "LLM"]
series:
  key: "agentic"
  order: 2
author: "skyfalling"
---

Agent 这个词被用得太宽——从一行 prompt 包装的 chatbot 到能自主跑十几步任务的系统，都被叫 Agent。要让这个词在工程上有意义，必须严格回答三件事：LLM 究竟差在哪、Agent 拿什么来补、不同自主性等级之间隔着什么。本篇不重复"LLM 是函数 / Agent 是五件套"这一层抽象（这是知识地图里讲过的），而是把五个局限、组件配置、L1-L4 分级各自的工程细节抠到底——抠到代码层、成本曲线、和"乘法效应"这种数学约束。

---

## 1. 五个局限的工程含义

LLM 是无状态的条件概率采样器：给定 token 序列预测下一个 token 的分布，按某种策略采样直到停止。这个最小机制带来五个无法回避的局限：

| 局限 | 本质 | 工程后果 |
|------|------|---------|
| **无记忆** | 权重在推理时冻结，跨调用不保留信息 | context 持续膨胀；token 线性增长；持久化必须外置 |
| **无工具** | 输出只是文本，无法发 HTTP、查库、读文件 | "已为您创建仓库"是幻觉；意图必须靠外部 Tool 落地 |
| **无规划** | 自回归生成单向，没有回溯 | 不能在第 50 个 token 时回头改第 10 个；规划是模式匹配不是搜索 |
| **无状态** | 单次推理内没有结构化的执行状态 | 不知道"第 2 步已完成、第 3 步失败"；必须 Runtime 维护 |
| **无反思** | confidence 不等于 correctness | 错误以高置信度传递；必须外部信号打断 |

![LLM 的局限](/images/blog/agentic/llm-five-limitations.svg)

下面五段把这五个局限的工程含义抠到底——它们各自的代价、为什么"模型变强"救不了、对应的 Agent 组件如何回应。

**无记忆**的代价不仅是"得重发历史"，而是 token 成本随对话长度线性增长、context window 终将耗尽。5 轮对话每轮 1000 token 输入，最后一轮模型看到 5000 token 的累积历史。"长对话遗忘前文"问题永远存在——不是模型变健忘，而是早期内容被挤出窗口或被淹没在噪声中。Memory 工程的核心难题就是在有限窗口里保留最相关的历史。

**无工具**是 LLM 与真实世界之间唯一的鸿沟。模型看过无数 stripe API 文档，知道"调用 `stripe.Customer.create` 能创建客户"，但它无法真正执行——它能做的只是生成一段"看起来像是调用了"的文本（往往还附带一个编造的 customer_id）。这是最经典的幻觉来源。Tool Calling 的工程价值就是把"生成调用文本"和"实际执行调用"对接起来。

**无规划**最容易被误解。LLM 输出"第一步...第二步..."看起来像规划，但这只是语言模式——它没有在内部维护任务树、没有评估各分支的代价、没有做搜索。真正的规划需要回溯（发现错就改）、看代价（贵的分支后做）、持久化（中途中断能恢复）。LLM 单独做不到，必须 Planner 承担。

**无状态**和无记忆有重叠但不等价。无记忆是"跨调用不保留信息"，无状态是"单次推理内没有结构化的执行状态"。即使把全部历史都塞进 prompt，LLM 也无法回答"我现在执行到第几步、哪些步成功了、哪些待重试"——除非这些状态被显式编码到 prompt 里。状态机不是 LLM 内部能力，必须由 Runtime 维护。

**无反思**是最危险的一个。LLM 错的时候不会沉默或表达犹豫，它会以相同语气和置信度输出错误答案。"幻觉"问题本质上就是这个局限的体现——模型没有"我不知道"这个内部状态，只能在分布上采样。Reflect 机制不是给 LLM 加上"自我怀疑"，而是用外部信号（执行结果、校验失败、用户反馈）打断它的自信。

---

## 2. Agent 五件套的可配置形态

Agent = LLM + Memory + Tools + Planner + Runtime——每个组件对应一个被填补的局限。要把这套抽象落到生产，关键不是再画一张组件图，而是把它写成可配置的代码 spec：

```python
AgentSpec = {
    "name": str,
    "role": str,                      # System Prompt 中的角色定义
    "model": {
        "provider": str,              # "openai" | "anthropic" | "vendor"
        "name": str,                  # "gpt-4o" | "claude-sonnet-4-5"
        "temperature": float,
    },
    "memory": {                       # l1-l4 用数字而非语义命名，是为了显式表达层次和读写代价递增
        "l1_max_turns": int,          # 对话缓冲滑动窗口（秒级、内存级）
        "l2_enabled": bool,           # 工作记忆（分钟级、单任务）
        "l3_vector_store": str,       # 情景记忆 backend（天级、向量检索）
        "l4_knowledge_base": str,     # 语义记忆 / RAG 索引（月年级、持久化）
    },
    "tools": list[ToolSpec],          # 可用工具列表
    "planner": {
        "mode": str,                  # "react" | "plan_execute" | "hierarchical"
        "max_steps": int,
    },
    "runtime": {
        "max_iterations": int,        # 控制循环硬上限
        "token_budget": int,
        "consecutive_error_limit": int,
        "loop_detection": bool,
    },
}
```

这个 schema 的字段每一个都对应一个组件的关键决策。**任何 Agent 项目的争吵基本都集中在这几个字段上**——记忆深度多少、用什么模型、配什么工具、规划模式选哪个、循环上限设多少。把它们写明在一个 schema 里，争吵就从"感觉不对"变成"该改哪个字段"。

整套 spec 里最关键的设计变量是 `planner.mode`——它决定了 Planner 与 LLM 的边界：

| 模式 | 优势 | 代价 |
|------|------|------|
| `react` LLM 驱动 | 灵活，能处理设计时未预见的分支 | 不可控，可能跑偏；调试困难；成本高 |
| 状态机驱动（不在此 spec） | 可控，行为可预测；易于回放和调试 | 不灵活，分支必须预先定义；遇到边缘情况只能失败 |
| `plan_execute` / `hierarchical` 混合 | 大框架固定，小决策交给 LLM | 设计复杂，边界需要仔细划分 |

生产级系统几乎都是混合模式——外层用状态机定义大流程的转换规则，把"语义判断"的局部决策交给 LLM。

---

## 3. 控制循环的 Plan Schema 与三个不可少的决策

Agent 控制循环（Observe→Think→Plan→Act→Reflect→Update）的六个阶段在地图层已经画过；本节只展开三个**做不好就直接翻车**的设计点：

**Plan 必须用 Structured Output**——把 LLM 的非确定性输出转化为可解析的确定性指令：

```json
{
  "name": "agent_decision",
  "parameters": {
    "type": "object",
    "properties": {
      "thought": {
        "type": "string",
        "description": "对当前状态的简短分析（< 50 字）"
      },
      "next_action": {
        "type": "string",
        "enum": ["call_tool", "answer", "ask_user", "give_up"]
      },
      "tool_call": {
        "type": "object",
        "description": "next_action == call_tool 时填写",
        "properties": {
          "name": {"type": "string"},
          "arguments": {"type": "object"}
        }
      },
      "answer": {
        "type": "string",
        "description": "next_action == answer 时填写"
      },
      "confidence": {"type": "number", "minimum": 0, "maximum": 1}
    },
    "required": ["thought", "next_action", "confidence"]
  }
}
```

下游消费 Plan 的代码无法 try/except 一个自由文本。Structured Output 还有一个隐藏价值：它强迫 LLM 把决策"写明白"，而不是用模糊的自然语言糊弄过去——`next_action` 是 enum，没有"或许试试看"这种含糊选项。

**错误作为输入回传，不抛异常**——工具失败时，把错误信息当作下一轮的 observation 给 LLM。这让 Agent 有机会自我修正（看到错误后换一种调用方式），而不是让外层 try/catch 直接中止整个任务。这一条违反了传统软件工程的直觉，但在 Agent 里至关重要。

**max_iterations 必须存在**——LLM 的 Reflect 判断可能错。没有硬上限，一次错误的"我没完成、继续重试"就能烧光预算。max_iterations 不是"防 bug"，而是承认"LLM 的退出判断不可靠"这个事实。

---

## 5. Agent 的自主性分级（L1-L4）

同样使用 LLM 的系统，自主性差几个数量级。**这种差异不是连续的，而是阶梯式的**——每一级引入了下一级没有的关键机制：

| 级别 | 形态 | 关键机制 | 单次成本 | 典型产品 |
|------|------|---------|---------|---------|
| **L1 单次推理** | 一次调用，无循环、无工具 | — | $0.001-0.01 | 文本分类、意图识别、情感分析 |
| **L2 工具增强** | 1-3 轮工具调用，人在回路 | Tool Calling | $0.01-0.05 | Perplexity、ChatGPT 联网搜索 |
| **L3 任务驱动** | 自主多步执行 | 控制循环 + 反思 | $0.05-0.50 | Cursor、Claude Code、Data Analysis Agent |
| **L4 自主系统** | 长期运行，自设子目标 | 持久记忆 + 自我反思 | $0.50-50+ | AutoGPT、Devin（多为研究形态） |

### 四级的最小代码骨架对比

把四个等级写成代码骨架，差异最直观：

```python
# L1：一次调用，没有循环
def l1_classify(text: str) -> str:
    return llm.complete(f"将以下文本分类：{text}", schema=category_schema)

# L2：工具增强，最多 1-3 轮
def l2_with_tool(query: str) -> str:
    response = llm.complete(query, tools=[search_tool])
    if response.tool_calls:
        result = search_tool.invoke(response.tool_calls[0])
        return llm.complete(query + result)  # 一次工具 + 一次综合
    return response.text

# L3：自主多步循环，有反思与退出条件
def l3_agent(goal: str) -> str:
    messages = [system_msg(), user_msg(goal)]
    for step in range(MAX_STEPS):
        response = llm.complete(messages, tools=all_tools)
        if not response.tool_calls:
            return response.text                              # 任务完成
        for tc in response.tool_calls:
            messages.append(tool_msg(tc.id, invoke(tc)))
        if exceeds_budget() or detect_loop(messages):
            return escalate()                                 # 退出守卫
    return safe_terminate()

# L4：长期运行 + 自设子目标 + 持久记忆
def l4_autonomous():
    while True:                                               # 没有用户触发的循环
        goal = self_set_goal(observe_environment())
        plan = decompose(goal)
        for sub in plan:
            result = l3_agent(sub.description)
            update_persistent_memory(sub, result)
            if should_replan(result):
                plan = decompose(self_set_goal(observe_environment()))
                break
        sleep(check_interval)
```

每一级的边界不是清晰的——同一个 Agent 在简单任务时表现像 L2、在复杂任务时像 L3。但**关键机制**是清晰的：

- **L1 → L2** 的跃迁是引入了 Tools。Agent 第一次能影响外部世界。
- **L2 → L3** 的跃迁是引入了控制循环。Agent 第一次能跨多步执行、自主决定何时停。
- **L3 → L4** 的跃迁是引入了持久化的自我目标和长期记忆。Agent 第一次能在没有用户输入的情况下持续运行。

每一级的跃迁不是"模型变强了"，而是"系统层引入了新机制"。这也是为什么"GPT-5 出来后，Agent 不就过时了"是错误的判断——L1 到 L2 不是模型能力问题，是有没有 Tool 注册系统的问题；L2 到 L3 不是模型能力问题，是有没有循环和状态管理的问题。

**关于 L4 的一个澄清**：目前公开产品中真正稳定运行的 L4 系统几乎不存在。具体看几个有代表性的尝试：AutoGPT（2023 早期开源）尝试用循环自主目标拆解，但缺乏退出条件检测、token 预算守卫、不可逆操作护栏，公开使用中频繁出现"为了完成不重要的子目标烧光预算"；Devin（Cognition，2024）演示效果很好，但落地企业版后退化为"L3 强化版"——任务仍由人发起，长期运行时把控制权部分交回人；BabyAGI 类项目则在"自设新目标"层卡住，新目标的质量随循环次数下降。三个失败方向高度一致：**长期自主运行 + 不可逆副作用 = 风险叠加的乘法效应**，工程上还没有共识级的解法。**L4 在工程上还是研究阶段，不是部署阶段**。这并不意味着 L4 没有价值，而是说在 2026 年的当下，把 L3 做扎实比追求 L4 更现实。

### Token 累积的数学

**最容易被低估的代价是 token 累积**：L3 Agent 每一步都重发完整对话历史。N 步任务的总输入 token 量不是 N×T，而是约 N(N+1)/2 × T——三角数累积：

```python
def cumulative_input_tokens(steps: int, per_step_new: int = 1000) -> int:
    """N 步 Agent 的累计输入 token 数"""
    # 第 1 步看 1 段、第 2 步看 1+2 段、... 第 N 步看 1+2+...+N 段
    return sum(i * per_step_new for i in range(1, steps + 1))

# 例：5 步任务每步新增 1000 token
# 累计输入 = 1000 + 2000 + 3000 + 4000 + 5000 = 15,000 token
# 而不是 5,000 token——是 3 倍
```

以 GPT-4o 定价（input $2.5/1M token），一个 5 步 L3 Agent 单次约 $0.03-0.05，日调用 10 万次月成本 $90,000-$150,000。这个数字会让"在所有功能里都用 L3 Agent"的方案从财务上就站不住脚。

---

## 6. 何时不用 Agent

Agent 处理"输入是模糊的、路径是不确定的"任务。当任务不包含模糊性时，Agent 就是错的工具。

三个清晰的不该用 Agent 的信号：

| 信号 | 原因 | 正确方案 |
|------|------|---------|
| 输入输出可枚举 | 规则引擎成本接近零、100% 可预测 | `if/else` 或状态机 |
| 步骤固定，只是顺序问题 | Agent 在这里只是用 LLM 重新发现已知的步骤顺序 | Workflow 引擎（Airflow、Temporal） |
| 要求 100% 确定性 | LLM 的概率本质不可消除——你无法消除"用户的钱没了但订单没更新"的可能 | 代码 + 强制人工审批 |

**真实生产系统中 LLM 推理通常只占 20% 的工作量**——客服系统 70% 用 FAQ 匹配解决、20% 用模板查询，剩下 10% 才是 Agent 推理。Agent 是系统的一个节点，不是整个系统。最常见的架构错误是让 Agent 控制整个流程；正确做法是确定性代码定义骨架，Agent 只在需要语义理解的环节出现。

### 判断流程的伪代码

```python
def should_use_agent(task: TaskSpec) -> Decision:
    """五维判断：任意维度不满足都倾向不用 Agent"""
    score = 0
    score += 1 if task.input_needs_semantic_parsing else 0
    score += 1 if task.path_depends_on_intermediate_results else 0
    score += 1 if task.requires_dynamic_tool_selection else 0
    score += 1 if not task.can_be_drawn_as_complete_dag else 0
    score += 1 if task.tolerable_error_rate >= 0.05 else 0

    if score >= 4:
        return Decision(use_agent=True, level="L3")
    if score == 3:
        return Decision(use_agent=True, level="L2",   # 退而求其次：受限 Agent
                        note="先用受限 Tool Calling，跑稳再升级")
    return Decision(use_agent=False, note="用 Workflow / 规则引擎")
```

四个以上"偏向 Agent"才考虑 Agent；两个以下就老老实实用 Workflow 或规则。

---

## 7. 成本结构：token 是小头，人工是大头

具体场景：客服退货流程——查订单、判断退货期、确认退款方式、执行退款，涉及 4 个工具。三种方案对比：

| 指标 | Pure LLM | Tool Calling | ReAct Agent |
|------|---------|-------------|-------------|
| LLM 调用次数 | 1 | 2-3 | 4-6 |
| 累计 token | 350 | 1300-2000 | 3600-7500 |
| 平均延迟 | 1-2s | 3-5s | 5-10s |
| 任务成功率 | ~20% | ~60% | ~95% |
| **人工介入率** | **80%** | **40%** | **5%** |

按 GPT-4o 定价 + 人工成本 5¥/次介入（5 分钟 × 1¥/分钟）：

| 成本项 | Pure LLM | Tool Calling | ReAct Agent |
|------|---------|-------------|-----------|
| LLM token 成本 | 0.014¥ | 0.05¥ | 0.10¥ |
| API 调用 | 0¥ | 0.015¥ | 0.035¥ |
| 人工成本 | 4¥ | 2¥ | 0.25¥ |
| **总成本/次** | **4.01¥** | **2.07¥** | **0.39¥** |
| **年成本** 百万次 | **400万¥** | **207万¥** | **39万¥** |

**LLM token 成本差异是小头**（最大 0.10¥）。**真正的成本驱动是人工介入率**——从 80% 降到 5%，总成本下降约 90%。

### 单次成本计算的最小公式

```python
def per_request_cost(
    llm_tokens: int,
    llm_unit_price: float,        # ¥ / 1k token
    tool_calls: int,
    tool_unit_price: float,       # ¥ / call
    intervention_rate: float,     # 0-1
    intervention_cost: float,     # ¥ / intervention
) -> float:
    return (
        llm_tokens / 1000 * llm_unit_price
        + tool_calls * tool_unit_price
        + intervention_rate * intervention_cost
    )

# 三种方案的 sensitivity：人工成本是 token 成本的 100-300 倍
# 这就是为什么"省 token"是次要优化，"降介入率"才是主优化
```

工程含义：评估 Agent 投入产出比时，算的是减少了多少人工介入，不是省了多少 token。介入率从 80% 降到 70% 价值有限，降到 10% 以下才有质变。这个比例的可降空间决定了项目值不值得做。

**衍生的判断标准**：如果一个业务流程目前的人工介入率本来就低（比如 < 20%），那么上 Agent 的边际收益不大——能节省的人力本来就少。Agent 的价值集中在"目前严重依赖人工"的环节，而不是"现在已经自动化得不错"的环节。

---

## 8. 概率性输出的乘法效应

升级到更高 L 级别带来的不只是成本上升，还有质的工程代价：

| 维度 | L1 | L2 | L3 |
|------|----|----|----|
| Token 成本 | 固定，可预算 | 近似固定 | 超线性增长，难预算 |
| 延迟 | 1-3s | 3-10s | 10s-分钟级 |
| 可预测性 | 高 | 较高 | **低**——相同输入可能走不同路径 |
| 调试难度 | 低 | 中 | **高**——需要完整 trace |
| 失败影响 | 单次结果不准 | 单次结果不准 | **多步偏离，可能产生不可逆副作用** |

### 串联可靠性的数学

L3 升 L4 的最危险代价不是延迟和成本，是**乘法效应**——多步执行的端到端成功率是每步成功率的连乘。这个数学约束在单 Agent 内的多轮循环上就开始体现：3 轮 ReAct 每轮成功率 90% 意味着端到端只剩 73%。这套数学在多 Agent 系统中放大成主导问题（详细的 `required_per_step` 公式、Worker 链路设计、98.3% 单节点门槛的推论在多 Agent 协作的专题里展开）。本节只指出工程后果：

- **不要为了显得更智能而拆多 Agent / 多轮循环**——每多一步就乘一次成功率
- **关键操作必须放在确定性代码里**——退款、下单、删数据这类不可逆操作不能让 Agent 决定执行，必须代码兜底
- **端到端高可靠的要求必须从串联拓扑里抽身**——要么让步骤可重试且幂等、要么引入独立校验环节打破乘法链

---

## 9. 围绕不可靠组件的设计原则

**LLM 是推理引擎，不是整个系统**。

工程上的具体含义：让 LLM 做它擅长的（语义理解、推理、决策），用确定性代码处理其余。

| 决策 | 选什么 |
|------|------|
| 逻辑可以穷举 | 代码（业务规则不需要 LLM 判断） |
| 需要理解自然语言 | LLM |
| 错误代价高 | 代码兜底——即使 LLM 给了答案，关键操作（如金额校验）也必须代码确认 |
| 输入空间开放 | LLM 处理多样性 |

![确定性 vs 非确定性](/images/blog/agentic/deterministic-vs-nondeterministic.svg)

### 一个典型的"LLM 决策 + 代码执行"分工

```python
# 反模式：让 LLM 直接执行业务操作
llm_output = llm.complete("退款 ¥1000 给用户 U12345")
execute_refund(amount=llm_output.amount, user=llm_output.user)  # ⚠ 危险

# 正确：LLM 负责语义理解，代码负责验证 + 执行
intent = llm.parse_intent(user_message, schema=refund_intent_schema)

# 代码层做硬约束
assert intent.amount <= max_refund_per_request
assert intent.user_id == current_user.id    # 防止跨用户
assert order_eligible_for_refund(intent.order_id)

# 幂等 key 防重复扣款——LLM 可能重试或 Agent 可能循环到这里两次
idempotency_key = f"refund:{intent.order_id}:{intent.amount}"
if already_executed(idempotency_key):
    return get_previous_result(idempotency_key)

audit_log.record(intent, key=idempotency_key)   # 审计留痕，按 key 去重
execute_refund(intent, idempotency_key)          # 才到执行
```

这个原则的推论是：**Agent 系统的代码量不应该全是 LLM 调用**。一个健康的 Agent 项目，LLM 相关代码（prompt、工具定义、循环控制）通常只占 20%-30%，其余是数据预处理、状态管理、错误处理、监控、评估、运维——这些都是"非 LLM"的工程。如果你的 Agent 项目 80% 代码都在调 LLM，要么任务还不够复杂、要么工程化还不到位。

---

## 10. 上 Agent 时容易掉进的五个坑

1. **因为想用 AI 而选 L3**——技术选型应从问题出发。典型场景：某团队的客服系统其实 80% 流量是几个固定问题，FAQ + 路由就能解决，但管理层"想要 AI Agent"，结果上了 L3 Agent，月账单暴涨 30 倍、首响延迟从 200ms 涨到 6 秒，最后只能开关切回 FAQ。"想用 AI"不是技术理由，是市场理由。
2. **跳过 L1/L2 直接上 L3**——90% 的请求可能一次 LLM 调用就够。典型场景：用 L3 Agent 做"判断用户邮件意图分类"——明明是 L1 单次分类任务，强行上 ReAct 循环只是用 5 倍成本换更差的稳定性。从最简形态开始，遇到真实瓶颈再升级。
3. **让 Agent 同时负责决策和执行**——Agent 决定"做什么"，确定性代码负责"怎么做"。Agent 决定"需要退款"，但调用退款 API 的逻辑是固定代码——这样在审计、回滚、调试时，关键操作的轨迹是清晰可控的。最危险的反模式是把"调用退款 API"也包装成 Agent 工具——一旦 LLM 幻觉了金额，退款就执行了。
4. **忽视失败模式**——Agent 会幻觉、循环、选错工具、超时。典型踩坑：客户反馈"Agent 把订单状态弄乱了"，但日志只记了 LLM 输入输出没记中间状态，根本无法复现和回滚。生产系统必须回答：失败了怎么办？有 Fallback 吗？中间步骤的副作用怎么回滚？这些问题在 demo 阶段不暴露，但上线一周后会全部冒出来。
5. **用 Agent 替代状态机**——订单流转、审批流程的状态和转换规则完全确定。用 Agent 在这里是用更高成本得到更差的可靠性。判断标准：**如果业务方能在白板上画出完整状态机，就不该用 Agent**。

### 五个坑共同的诊断信号

这五个坑表面是不同问题，但共同的诊断信号是**Agent 在做它本不该做的事**：决策不该 Agent 决的（坑 1、坑 5）、执行不该 Agent 执的（坑 3）、路径不该 Agent 探的（坑 2）、失败不该 Agent 兜的（坑 4）。一个健康的 Agent 应该被严格限制在"语义理解 + 决策"这个角色里，其余职责由确定性代码承担。一旦你的 Agent 出现"什么都自己来"的倾向，多半是落进了这些坑里。

---

## 11. Agent 五件套：每件都源于一个局限

回顾全文：LLM 的五个局限——无记忆、无工具、无规划、无状态、无反思——直接决定了 Agent 必须配齐的四个组件（Memory 补前两个、Tools 补无工具、Planner 补无规划、Runtime 包合并状态与反思）。这不是命名学的巧合，是工程上"什么坏了就补什么"的直接对应。

四个组件之上是一个 Observe→Think→Plan→Act→Reflect→Update 循环，循环之上是 L1 到 L4 的自主性递增。自主性每升一级，token 消耗、延迟、不可预测性都会显著上升——成本曲线的最大变量不是 token 单价，而是人工介入率从 80% 降到 5% 这种量级的转变。

这套理解的工程价值是：当 Agent 项目出问题时，能精确定位是哪一个组件失效——是 Memory 设计不对、Tools 描述不清、Planner 规划过深、Runtime 退出条件缺失，还是模型推理本身的局限。把"Agent 表现不好"这种模糊判断，分解成五个可独立优化的工程目标。