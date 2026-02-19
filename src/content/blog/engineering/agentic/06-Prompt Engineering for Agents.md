---
title: "Prompt Engineering for Agents: 面向 Agent 的提示词工程"
description: "Agent 的 Prompt 不是聊天提示词，而是系统接口规范。本文系统拆解 Agent Prompt 的分层架构、四种关键设计模式（Router / Planner / Executor / Reflector）、Chain-of-Thought 的 Agent 化应用、Few-shot vs Zero-shot 的场景选择、Prompt 工程化实践（模板化 / 版本控制 / 测试 / 组合），以及 Context Window 管理策略。"
pubDate: "2025-12-23"
tags: ["Agentic", "AI Engineering", "Prompt Engineering"]
---

# Prompt Engineering for Agents: 面向 Agent 的提示词工程

> Agentic 系列第 06 篇。前文我们讨论了 Tool Calling 的设计哲学与工程实践，LLM 已经具备了"使用工具"的能力。但工具只是 Agent 的四肢，Prompt 才是 Agent 的大脑皮层——它定义了 Agent 如何感知、如何推理、如何决策、如何行动。
>
> 本文的核心观点：**Agent 的 Prompt 不是"聊天提示词"，而是"系统接口规范"。** Chatbot 的 Prompt 追求对话自然，Agent 的 Prompt 追求行为可控。这两者的设计哲学截然不同。

---

## 1. 从"对话技巧"到"接口规范"

大多数人对 Prompt Engineering 的印象停留在"写好提示词让 AI 回答更好"的阶段。这在 Chatbot 场景下基本成立——你调整措辞、给几个例子、加一句"请一步一步思考"，模型输出的质量就会改善。

但 Agent 场景完全不同。

Agent 的 Prompt 不是写给"一个聊天助手"的，而是写给"一个程序运行时"的。它的目的不是让输出"看起来更好"，而是让输出**可解析、可路由、可执行**。一个 Agent Prompt 的失败，不是"回答不够好"，而是**系统崩溃**——JSON 解析失败、工具调用参数错误、无限循环、状态机卡死。

| 维度 | Chatbot Prompt | Agent Prompt |
|------|---------------|--------------|
| 目标 | 自然、有帮助的回复 | 可解析、可执行的结构化输出 |
| 消费者 | 人类用户 | 程序代码（Parser / Router / Executor） |
| 失败模式 | 回答质量下降 | 系统崩溃、无限循环、安全漏洞 |
| 格式要求 | 宽松，Markdown 即可 | 严格，JSON / XML / 特定 Schema |
| 可测试性 | 主观评估 | 可自动化断言 |
| 版本管理 | 通常不管理 | 必须版本控制，等同于代码 |

这意味着，**Agent 的 Prompt Engineering 本质上是一种接口设计（Interface Design）**，而不是文案写作。

---

## 2. Agent Prompt 的分层架构

一个成熟的 Agent 系统，发送给 LLM 的 Prompt 不是一坨字符串，而是多个层次动态组装的结果。

### 2.1 四层结构

```
┌─────────────────────────────────────────────────────┐
│                   Final Prompt                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  Layer 1: System Prompt (静态)                 │  │
│  │  - 身份定义（你是谁，你的职责是什么）            │  │
│  │  - 行为约束（必须做什么，禁止做什么）            │  │
│  │  - 输出格式规范（JSON Schema / XML 模板）       │  │
│  ├───────────────────────────────────────────────┤  │
│  │  Layer 2: Context Injection (动态)             │  │
│  │  - 可用工具列表及其描述                         │  │
│  │  - 历史对话摘要 / 关键事实                      │  │
│  │  - 当前系统状态（已完成步骤、中间结果）           │  │
│  │  - 检索到的外部知识（RAG 结果）                  │  │
│  ├───────────────────────────────────────────────┤  │
│  │  Layer 3: User Input (外部)                    │  │
│  │  - 用户的原始请求                               │  │
│  │  - 或上一步 Agent 的输出（在 Multi-Agent 中）    │  │
│  ├───────────────────────────────────────────────┤  │
│  │  Layer 4: Constraints & Guardrails (静态+动态)  │  │
│  │  - 安全边界（禁止调用的工具、禁止访问的数据）     │  │
│  │  - 输出限制（最大步骤数、Token 预算）            │  │
│  │  - 当前 Turn 的特殊指令                         │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 2.2 组装过程

Prompt 组装不是简单的字符串拼接，而是一个有优先级、有裁剪策略的构建过程：

```
                  Token Budget: 8000
                       │
      ┌────────────────┼────────────────┐
      │                │                │
      ▼                ▼                ▼
 System Prompt    Context Injection   User Input
 (固定预算:2000)  (弹性预算:4500)    (固定预算:1500)
      │                │                │
      │          ┌─────┴─────┐          │
      │          │           │          │
      │      Tool Descs   History       │
      │      (1500 max)  (3000 max)     │
      │          │           │          │
      │          │     [若超预算]        │
      │          │     → 压缩/截断      │
      │          │           │          │
      ▼          ▼           ▼          ▼
     ┌──────────────────────────────────┐
     │      Prompt Assembler            │
     │  1. 拼装各层                      │
     │  2. 计算总 Token                  │
     │  3. 若超预算 → 压缩 Context 层    │
     │  4. 注入 Constraints              │
     └──────────────────────────────────┘
                    │
                    ▼
              Final Prompt
```

关键设计决策：**System Prompt 和 User Input 的预算是固定的，Context Injection 的预算是弹性的。** 当总 Token 超出预算时，优先压缩 Context 层（截断历史、精简工具描述），而非删减 System Prompt 中的行为约束。因为行为约束一旦丢失，Agent 的行为就不可控了。

### 2.3 Python 示例：Prompt 组装器

```python
from dataclasses import dataclass, field

@dataclass
class PromptLayer:
    content: str
    priority: int        # 越高越不容易被裁剪
    max_tokens: int
    compressible: bool   # 是否允许被压缩

@dataclass
class PromptAssembler:
    total_budget: int = 8000
    layers: list[PromptLayer] = field(default_factory=list)

    def add_layer(self, layer: PromptLayer):
        self.layers.append(layer)

    def assemble(self) -> str:
        # 按优先级排序：高优先级最后处理（最不容易被裁剪）
        sorted_layers = sorted(self.layers, key=lambda l: l.priority)

        total_used = sum(estimate_tokens(l.content) for l in self.layers)

        if total_used > self.total_budget:
            overflow = total_used - self.total_budget
            # 从低优先级开始压缩
            for layer in sorted_layers:
                if not layer.compressible:
                    continue
                available_cut = estimate_tokens(layer.content) - 100  # 至少保留 100 token
                cut = min(overflow, available_cut)
                layer.content = truncate_to_tokens(layer.content,
                                                    estimate_tokens(layer.content) - cut)
                overflow -= cut
                if overflow <= 0:
                    break

        # 按原始顺序拼装
        return "\n\n".join(l.content for l in self.layers)
```

---

## 3. 四种关键 Agent Prompt 设计模式

Agent 系统中，不同角色的 Agent 需要不同风格的 Prompt。以下是四种最核心的设计模式，每种都给出完整可用的 Prompt 示例。

### 3.1 Router Prompt：意图路由

Router 的职责是根据用户输入**选择正确的工具或子流程**，而不是自己去执行任务。它是 Agent 系统的"交通警察"。

```python
ROUTER_PROMPT = """You are a request router. Your ONLY job is to analyze the user's
request and select the appropriate tool. Do NOT attempt to answer the question yourself.

## Available Tools
{tool_descriptions}

## Routing Rules
1. If the request involves real-time data (weather, stock prices, news) → use `web_search`
2. If the request involves the user's own data (files, emails, calendar) → use `data_query`
3. If the request involves code generation or debugging → use `code_assistant`
4. If the request involves image generation or editing → use `image_tool`
5. If the request is ambiguous, ask a clarifying question instead of guessing.
6. If NO tool matches, respond with tool_name: "none" and explain why.

## Output Format (strict JSON, no markdown fence)
{{
  "reasoning": "<one sentence explaining your routing decision>",
  "tool_name": "<exact tool name from the list above, or 'none'>",
  "tool_input": {{<parameters to pass to the selected tool>}},
  "confidence": <float between 0.0 and 1.0>
}}

## Critical Constraints
- NEVER fabricate a tool name not in the list.
- NEVER return free-form text. ALWAYS return valid JSON.
- If confidence < 0.6, set tool_name to "none" and ask for clarification.
"""
```

**设计要点：**
- 明确告诉 LLM "你不负责回答问题"，避免它自作主张直接回答
- 提供确定性的路由规则（if-then），减少 LLM 的自由裁量空间
- 要求输出 confidence 分数，让调用方可以做二次判断
- 兜底规则：没有匹配的工具时，显式输出 "none"

### 3.2 Planner Prompt：任务规划

Planner 的职责是将一个复杂请求**分解为可执行的子任务列表**。它是 Agent 的"项目经理"。

```python
PLANNER_PROMPT = """You are a task planner. Given a complex user request, decompose it
into a sequence of concrete, executable sub-tasks.

## Planning Principles
1. Each sub-task must be independently executable by a single tool call.
2. Sub-tasks should be ordered by dependency — a task can only depend on tasks before it.
3. Minimize the number of steps. Do NOT over-decompose simple requests.
4. If a request can be done in ONE tool call, return a plan with ONE step.

## Available Tools
{tool_descriptions}

## Output Format (strict JSON)
{{
  "analysis": "<brief analysis of the request's complexity and required resources>",
  "plan": [
    {{
      "step_id": 1,
      "description": "<what this step does>",
      "tool_name": "<tool to use>",
      "tool_input": {{<parameters>}},
      "depends_on": []
    }},
    {{
      "step_id": 2,
      "description": "<what this step does>",
      "tool_name": "<tool to use>",
      "tool_input": {{<parameters, can reference $step_1_result>}},
      "depends_on": [1]
    }}
  ],
  "estimated_steps": <int>,
  "can_parallelize": [<list of step_id groups that can run concurrently>]
}}

## Constraints
- Maximum 8 steps. If the task seems to need more, simplify or ask the user to narrow scope.
- NEVER include steps like "verify result" or "report to user" — those are handled by the system.
- Use $step_N_result to reference the output of a previous step.
"""
```

**设计要点：**
- "最小化步骤数"原则防止 LLM 过度分解（这是规划器最常见的问题）
- `depends_on` 字段使得执行引擎可以识别并行机会
- 明确设置步骤上限（8 步），避免 LLM 生成无休止的计划
- 禁止 LLM 添加"元步骤"（验证、汇报），这些是系统层的职责

### 3.3 Executor Prompt：执行操作

Executor 的职责是**执行单个具体操作**，并以严格的格式返回结果。它是 Agent 的"操作工"。

```python
EXECUTOR_PROMPT = """You are a task executor. You will receive a specific sub-task and
must execute it using the provided tool.

## Current Task
{task_description}

## Tool to Use
Name: {tool_name}
Schema: {tool_schema}

## Context from Previous Steps
{previous_results}

## Execution Rules
1. Call the tool EXACTLY ONCE with the correct parameters.
2. Do NOT deviate from the task description.
3. Do NOT call tools not specified for this task.
4. If the tool call fails, report the error — do NOT retry or improvise.

## Output Format (strict JSON)
{{
  "tool_call": {{
    "name": "{tool_name}",
    "arguments": {{<filled parameters>}}
  }},
  "explanation": "<one sentence on why these parameters were chosen>"
}}
"""
```

**设计要点：**
- Executor 的设计哲学是"最小权限"——只做被告知的事
- 严禁 Executor 自主决策，发现错误只能上报，不能自行重试
- 这种设计让 Executor 成为一个确定性单元，便于测试和审计

### 3.4 Reflector Prompt：结果反思

Reflector 的职责是**评估执行结果**，判断是否达成目标，如果未达成则提出修正方案。它是 Agent 的"质量检查员"。

```python
REFLECTOR_PROMPT = """You are a result evaluator. Given the original user request and the
execution result, determine whether the task has been completed successfully.

## Original Request
{user_request}

## Execution Plan
{plan}

## Execution Results
{results}

## Evaluation Criteria
1. Completeness: Does the result fully address the user's request?
2. Correctness: Is the result factually and logically correct?
3. Format: Is the result in the expected format?

## Output Format (strict JSON)
{{
  "evaluation": {{
    "completeness": {{"score": <1-5>, "reason": "<explanation>"}},
    "correctness": {{"score": <1-5>, "reason": "<explanation>"}},
    "format": {{"score": <1-5>, "reason": "<explanation>"}}
  }},
  "overall_pass": <true|false>,
  "action": "<one of: 'accept', 'retry_step', 'replan', 'escalate'>",
  "retry_details": {{
    "step_id": <which step to retry, if applicable>,
    "modification": "<what to change in the retry>"
  }}
}}

## Decision Rules
- If all scores >= 4: action = "accept"
- If any score <= 2 and retry_count < 3: action = "retry_step" or "replan"
- If retry_count >= 3: action = "escalate" (ask user for help)
- NEVER accept a result with correctness score <= 2.
"""
```

**设计要点：**
- 多维度评估（完整性、正确性、格式）而非简单的 pass/fail
- 明确的决策规则，减少 LLM 判断的主观性
- retry_count 上限防止无限重试循环
- "escalate" 作为最终兜底——承认失败比无限循环好得多

### 3.5 四种模式的协作

```
User Request
     │
     ▼
 ┌────────┐     tool_name + input     ┌──────────┐
 │ Router │ ──── (简单请求直接执行) ───→│ Executor │──→ Result
 └────┬───┘                           └──────────┘
      │ (复杂请求)                          ▲
      ▼                                    │
 ┌─────────┐    plan[step_1..N]     ┌──────┴───┐
 │ Planner │ ─────────────────────→│ Executor  │
 └─────────┘                       │ (per step)│
                                   └──────┬───┘
                                          │ results
                                          ▼
                                   ┌───────────┐
                                   │ Reflector  │
                                   └─────┬─────┘
                                         │
                              ┌──────────┼──────────┐
                              │          │          │
                           accept    retry_step   replan
                              │          │          │
                              ▼          ▼          ▼
                           Return    Executor    Planner
                           to User  (重试该步)   (重新规划)
```

---

## 4. Chain-of-Thought 在 Agent 中的应用

### 4.1 标准 CoT vs Agent CoT

标准的 Chain-of-Thought（CoT）是一种推理增强技术——"Let's think step by step"。但在 Agent 中，CoT 的用途和形式有本质不同：

| 维度 | 标准 CoT | Agent CoT |
|------|---------|-----------|
| 目的 | 提高推理准确性 | 让中间推理过程可审计、可路由 |
| 消费者 | 最终输出的一部分 | Agent Runtime 的中间状态 |
| 格式 | 自然语言 | 结构化（通常嵌入 JSON 的某个字段） |
| 是否返回用户 | 通常是 | 通常不是（内部消费） |

Agent 的 CoT 更像是一个**内部日志**，而非用户可见的推理过程。它的首要目标是让系统（而非人类）能够理解和利用中间推理。

### 4.2 Scratchpad 模式

Scratchpad 模式是 Agent CoT 的典型实现——在 Prompt 中显式开辟一个"草稿区"，让 LLM 在其中进行中间推理，然后输出最终决策。

```python
SCRATCHPAD_PROMPT = """Analyze the user's request and decide on an action.

## User Request
{user_request}

## Available Tools
{tools}

## Instructions
Use the <scratchpad> section to think through your decision. This section will NOT be
shown to the user. Then provide your final action in the <action> section.

<scratchpad>
Think through:
1. What is the user actually asking for?
2. Which tools could help? What are the pros/cons of each?
3. What information am I missing?
4. What's the simplest approach that works?
</scratchpad>

<action>
Return strict JSON here:
{{"tool_name": "...", "tool_input": {{...}}, "reasoning_summary": "..."}}
</action>
"""
```

Runtime 解析时，只提取 `<action>` 标签中的内容作为执行指令，`<scratchpad>` 的内容记录到日志中用于调试和审计。

### 4.3 显式推理 vs 隐式推理的 Trade-off

**显式推理（Explicit Reasoning）：** 在 Prompt 中要求 LLM 输出推理过程。

优势：
- 可审计，出了问题能追溯"为什么做了这个决策"
- 推理质量通常更高（CoT 效应）
- 便于调试

劣势：
- 消耗更多 Token（推理内容可能占输出的 50%+）
- 增加延迟
- 推理内容可能包含敏感的内部逻辑

**隐式推理（Implicit Reasoning）：** 直接要求 LLM 输出最终决策，不要求中间过程。

优势：
- Token 用量更低，延迟更短
- 输出更简洁，解析更简单

劣势：
- 黑盒，无法理解决策过程
- 在复杂场景下准确率下降明显

**工程决策建议：**
- Router 和 Executor（简单、确定性高）：倾向隐式推理，追求速度
- Planner 和 Reflector（复杂、需要判断）：必须显式推理，追求准确性和可审计性
- 在系统稳定后，可以通过 A/B 测试逐步将显式推理切换为隐式推理以降低成本

---

## 5. Few-shot vs Zero-shot 在 Agent 场景的选择

这是 Agent Prompt 设计中一个重要但常被忽视的决策点。

### 5.1 决策矩阵

```
                    输出结构化程度
                 低 ◄──────────► 高
                 │                │
  任务复杂度  高  │  Few-shot      │  Zero-shot + Schema
                 │  (复杂规划)     │  (结构化反思)
                 │                │
              低  │  Zero-shot     │  Zero-shot + Schema
                 │  (简单对话)     │  (工具调用)
                 │                │
```

### 5.2 工具调用：Zero-shot 优先

工具调用场景天然适合 Zero-shot。原因是 **JSON Schema 本身就是最好的"示例"**——它精确定义了每个参数的名称、类型、描述和约束，比任何 Few-shot 示例都更完整。

```python
# 工具调用不需要 few-shot，Schema 就是最好的约束
tool_schema = {
    "name": "search_database",
    "description": "Search the product database with filters",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search keywords"},
            "category": {
                "type": "string",
                "enum": ["electronics", "clothing", "books"],
                "description": "Product category filter"
            },
            "max_results": {
                "type": "integer",
                "default": 10,
                "minimum": 1,
                "maximum": 100
            }
        },
        "required": ["query"]
    }
}
```

加 Few-shot 反而可能引入问题：LLM 可能过度拟合示例中的具体值，而不是理解 Schema 的通用约束。

### 5.3 复杂规划：Few-shot 有价值

规划场景是 Few-shot 真正发挥价值的地方。因为"好的计划"是一个模糊的概念——仅凭输出格式定义不足以引导 LLM 产出高质量的计划。

```python
PLANNER_WITH_EXAMPLES = """You are a task planner.

## Example 1: Multi-step data analysis
User: "Compare last month's sales with the same period last year and visualize the trend"
Plan:
[
  {{"step_id": 1, "tool": "data_query", "input": "sales data for 2025-07", "depends_on": []}},
  {{"step_id": 2, "tool": "data_query", "input": "sales data for 2024-07", "depends_on": []}},
  {{"step_id": 3, "tool": "data_compare", "input": "$step_1_result, $step_2_result", "depends_on": [1, 2]}},
  {{"step_id": 4, "tool": "chart_gen", "input": "$step_3_result, type=line", "depends_on": [3]}}
]
Note: Steps 1 and 2 can run in parallel since they have no dependencies.

## Example 2: Simple single-step task
User: "What's the weather in Tokyo?"
Plan:
[
  {{"step_id": 1, "tool": "weather_api", "input": "Tokyo", "depends_on": []}}
]
Note: Simple requests should NOT be over-decomposed.

## Now plan for:
User: "{user_request}"
"""
```

Few-shot 示例在这里传递了两个关键信息：
1. **粒度标准**——什么程度的分解是合适的
2. **并行意识**——独立步骤应该标记为可并行

### 5.4 反思评估：Zero-shot + 结构化输出

反思（Reflection）场景适合 Zero-shot + 结构化输出。原因是反思本质上是"评判"，而评判标准已经通过评估维度（completeness / correctness / format）和评分规则完整定义了。给出 Few-shot 示例反而可能让 LLM 锚定在示例的评分上，而不是独立评估当前结果。

**总结决策原则：**
- 格式约束充分（JSON Schema / 评分规则）→ Zero-shot
- 需要传递"风格"或"粒度标准" → Few-shot
- 两者都可以时 → 优先 Zero-shot（更省 Token，更不容易过拟合）

---

## 6. Prompt 工程化实践

当 Agent 系统超过原型阶段，Prompt 管理就变成了一个严肃的工程问题。

### 6.1 Prompt 模板化

核心思想：**分离静态结构和动态内容**。静态部分（身份定义、行为规则、输出格式）是模板，动态部分（工具列表、历史消息、当前状态）通过变量注入。

```python
from typing import Any
from string import Template
import hashlib
import json
from datetime import datetime


class PromptTemplate:
    """可管理、可版本化、可测试的 Prompt 模板"""

    def __init__(self, name: str, template: str, version: str,
                 required_vars: list[str], metadata: dict | None = None):
        self.name = name
        self.template = template
        self.version = version
        self.required_vars = required_vars
        self.metadata = metadata or {}
        self._hash = hashlib.sha256(template.encode()).hexdigest()[:12]

    def render(self, **kwargs) -> str:
        # 校验所有必需变量都已提供
        missing = set(self.required_vars) - set(kwargs.keys())
        if missing:
            raise ValueError(f"Missing required variables: {missing}")

        # 渲染模板
        rendered = self.template
        for key, value in kwargs.items():
            placeholder = "{" + key + "}"
            if isinstance(value, (dict, list)):
                value = json.dumps(value, indent=2, ensure_ascii=False)
            rendered = rendered.replace(placeholder, str(value))

        return rendered

    def fingerprint(self) -> str:
        """返回模板内容的哈希指纹，用于版本追踪"""
        return f"{self.name}@{self.version}#{self._hash}"


class PromptRegistry:
    """Prompt 模板注册中心：集中管理所有 Agent 使用的 Prompt"""

    def __init__(self):
        self._templates: dict[str, dict[str, PromptTemplate]] = {}  # name -> {version -> template}

    def register(self, template: PromptTemplate):
        if template.name not in self._templates:
            self._templates[template.name] = {}
        self._templates[template.name][template.version] = template

    def get(self, name: str, version: str = "latest") -> PromptTemplate:
        if name not in self._templates:
            raise KeyError(f"Template '{name}' not found")

        versions = self._templates[name]
        if version == "latest":
            latest_version = sorted(versions.keys())[-1]
            return versions[latest_version]

        if version not in versions:
            raise KeyError(f"Version '{version}' not found for template '{name}'")
        return versions[version]

    def list_all(self) -> dict[str, list[str]]:
        return {name: sorted(vers.keys()) for name, vers in self._templates.items()}


# ── 使用示例 ──

registry = PromptRegistry()

# 注册 Router Prompt v1
registry.register(PromptTemplate(
    name="router",
    version="1.0",
    template="""You are a request router.
Available tools: {tool_descriptions}
Route the following request: {user_input}
Output JSON: {{"tool_name": "...", "tool_input": {{...}}}}""",
    required_vars=["tool_descriptions", "user_input"],
    metadata={"author": "agent-team", "last_tested": "2025-08-10"}
))

# 注册 Router Prompt v2（增加了 confidence 字段）
registry.register(PromptTemplate(
    name="router",
    version="2.0",
    template="""You are a request router. Your ONLY job is to route, not to answer.
Available tools: {tool_descriptions}
Route the following request: {user_input}
Output JSON: {{"tool_name": "...", "tool_input": {{...}}, "confidence": <0.0-1.0>}}""",
    required_vars=["tool_descriptions", "user_input"],
    metadata={"author": "agent-team", "last_tested": "2025-08-13"}
))

# 获取并渲染
router_prompt = registry.get("router", version="2.0")
final_prompt = router_prompt.render(
    tool_descriptions="1. web_search: Search the web\n2. calculator: Do math",
    user_input="What is 42 * 17?"
)
```

### 6.2 Prompt 版本控制

为什么 Prompt 需要版本控制？因为 **Prompt 是 Agent 行为的源代码**。改一个词可能导致 Agent 行为的巨大变化——从正确路由变成错误路由，从结构化输出变成自由文本。

版本控制策略：

```
prompts/
├── router/
│   ├── v1.0.txt          # 初始版本
│   ├── v1.1.txt          # 修复：低 confidence 时的行为
│   ├── v2.0.txt          # 重大变更：新增 confidence 字段
│   └── changelog.md      # 变更记录
├── planner/
│   ├── v1.0.txt
│   └── v1.1.txt
├── executor/
│   └── v1.0.txt
└── reflector/
    └── v1.0.txt
```

关键实践：
- **每次 Prompt 变更都有对应的测试结果**（下面会详述）
- **生产环境使用固定版本号**，而非 "latest"
- **支持灰度发布**：新版 Prompt 可以先对 10% 的流量生效
- **保留回滚能力**：发现新版 Prompt 导致问题时，立即切回旧版

### 6.3 Prompt 测试

Prompt 测试的核心挑战是 LLM 输出的非确定性。我们不能像测试普通函数那样做精确断言，但可以做**结构化断言**和**统计性断言**。

```python
from dataclasses import dataclass

@dataclass
class PromptTestCase:
    name: str
    input_vars: dict[str, Any]       # 模板变量
    assertions: list[dict]            # 断言列表

    # 断言类型：
    # {"type": "json_valid"}                           → 输出是合法 JSON
    # {"type": "has_field", "field": "tool_name"}      → JSON 中包含指定字段
    # {"type": "field_in", "field": "tool_name", "values": ["a", "b"]} → 字段值在范围内
    # {"type": "no_field", "field": "apology"}         → 不包含某字段（防止 LLM 废话）
    # {"type": "max_tokens", "limit": 200}             → 输出长度不超过限制


class PromptTestRunner:
    def __init__(self, llm_client, template: PromptTemplate):
        self.llm = llm_client
        self.template = template

    def run_test(self, test_case: PromptTestCase, n_runs: int = 5) -> dict:
        """对同一个测试用例运行 N 次，统计通过率"""
        prompt = self.template.render(**test_case.input_vars)
        results = []

        for _ in range(n_runs):
            output = self.llm.generate(prompt)
            pass_all = True
            details = []

            for assertion in test_case.assertions:
                passed = self._check_assertion(output, assertion)
                details.append({"assertion": assertion, "passed": passed})
                if not passed:
                    pass_all = False

            results.append({"output": output, "passed": pass_all, "details": details})

        pass_rate = sum(1 for r in results if r["passed"]) / n_runs
        return {
            "test_case": test_case.name,
            "template": self.template.fingerprint(),
            "n_runs": n_runs,
            "pass_rate": pass_rate,
            "results": results
        }

    def _check_assertion(self, output: str, assertion: dict) -> bool:
        if assertion["type"] == "json_valid":
            try:
                json.loads(output)
                return True
            except json.JSONDecodeError:
                return False

        if assertion["type"] == "has_field":
            try:
                data = json.loads(output)
                return assertion["field"] in data
            except (json.JSONDecodeError, TypeError):
                return False

        if assertion["type"] == "field_in":
            try:
                data = json.loads(output)
                return data.get(assertion["field"]) in assertion["values"]
            except (json.JSONDecodeError, TypeError):
                return False

        return False  # 未知断言类型


# ── 测试用例示例 ──

test_cases = [
    PromptTestCase(
        name="math_request_should_route_to_calculator",
        input_vars={
            "tool_descriptions": "1. web_search: Search the web\n2. calculator: Do math",
            "user_input": "What is 1024 * 768?"
        },
        assertions=[
            {"type": "json_valid"},
            {"type": "has_field", "field": "tool_name"},
            {"type": "field_in", "field": "tool_name", "values": ["calculator"]},
        ]
    ),
    PromptTestCase(
        name="ambiguous_request_should_not_guess",
        input_vars={
            "tool_descriptions": "1. web_search: Search the web\n2. calculator: Do math",
            "user_input": "Help me with my project"
        },
        assertions=[
            {"type": "json_valid"},
            {"type": "has_field", "field": "tool_name"},
            {"type": "field_in", "field": "tool_name", "values": ["none"]},
        ]
    ),
]
```

**测试策略建议：**
- 每个 Prompt 版本至少 10 个测试用例，覆盖正常路径、边界情况和对抗输入
- 每个测试用例运行 5-10 次，要求通过率 >= 90%（而非 100%，因为 LLM 输出非确定性）
- 将测试集纳入 CI，每次 Prompt 变更触发回归测试

### 6.4 Prompt 组合：模块化拼装

复杂 Agent 的 Prompt 往往由多个模块组合而成。与其维护一个巨大的单体 Prompt，不如将其拆分为可复用的模块：

```python
class PromptComposer:
    """将多个 Prompt 模块按顺序组合"""

    def __init__(self):
        self._modules: list[tuple[str, PromptTemplate]] = []

    def add(self, section_name: str, template: PromptTemplate):
        self._modules.append((section_name, template))
        return self  # 支持链式调用

    def compose(self, **all_vars) -> str:
        sections = []
        for section_name, template in self._modules:
            # 每个模块只取自己需要的变量
            relevant_vars = {k: v for k, v in all_vars.items()
                           if k in template.required_vars}
            rendered = template.render(**relevant_vars)
            sections.append(f"## {section_name}\n{rendered}")
        return "\n\n".join(sections)


# 使用方式
identity_module = PromptTemplate(
    name="identity", version="1.0",
    template="You are {agent_role}. {agent_description}",
    required_vars=["agent_role", "agent_description"]
)

tools_module = PromptTemplate(
    name="tools", version="1.0",
    template="Available tools:\n{tool_descriptions}",
    required_vars=["tool_descriptions"]
)

output_format_module = PromptTemplate(
    name="output_format", version="1.0",
    template="You MUST respond in the following JSON format:\n{json_schema}",
    required_vars=["json_schema"]
)

constraints_module = PromptTemplate(
    name="constraints", version="1.0",
    template="Constraints:\n{constraint_list}",
    required_vars=["constraint_list"]
)

# 组合
composer = PromptComposer()
composer.add("Identity", identity_module) \
        .add("Tools", tools_module) \
        .add("Output Format", output_format_module) \
        .add("Constraints", constraints_module)

final_prompt = composer.compose(
    agent_role="a task router",
    agent_description="You route user requests to the appropriate tool.",
    tool_descriptions="1. search: web search\n2. calc: calculator",
    json_schema='{"tool_name": "string", "tool_input": "object"}',
    constraint_list="- Never fabricate tool names\n- Always return valid JSON"
)
```

模块化的好处：
- 同一个 `output_format_module` 可以被 Router、Planner、Executor 共享
- 修改 constraints 不需要触碰 identity 和 tools 部分
- 每个模块可以独立测试和版本控制

---

## 7. Context Window 管理

Agent 的 Context Window 管理是一个独特且关键的工程挑战。与 Chatbot 的"对话越长体验越差"不同，Agent 的 context 膨胀会直接导致**系统性故障**。

### 7.1 Agent 的 Context 膨胀问题

Agent 的 context 会从三个维度快速膨胀：

```
Turn 1:  System(2000) + User(200) + Response(500)              = 2,700 tokens
Turn 2:  + Tool_Result(3000) + Response(800)                   = 6,500 tokens
Turn 3:  + Tool_Result(5000) + Error_Msg(1000) + Response(600) = 13,100 tokens
Turn 4:  + Tool_Result(2000) + Response(400)                   = 15,500 tokens
Turn 5:  + RAG_Context(4000) + Response(1000)                  = 20,500 tokens
  ...
Turn 10: 很容易突破 50,000 tokens
```

三大膨胀源：
1. **工具返回值**：一次数据库查询可能返回几千 token 的 JSON，一次网页抓取可能返回上万 token
2. **历史消息积累**：每一轮的 user message + assistant response + tool calls 都在累积
3. **错误信息**：工具调用失败的 traceback、重试过程中的冗余信息

### 7.2 消息压缩策略

**策略 1：摘要压缩（Summarization）**

将早期的对话历史压缩为摘要，只保留关键事实和决策结果。

```python
def compress_history(messages: list[dict], llm_client,
                     keep_recent: int = 4) -> list[dict]:
    """将早期历史压缩为摘要，保留最近 N 轮完整消息"""
    if len(messages) <= keep_recent:
        return messages

    old_messages = messages[:-keep_recent]
    recent_messages = messages[-keep_recent:]

    # 用 LLM 生成摘要
    summary_prompt = f"""Summarize the following conversation history into key facts
and decisions. Keep only information that might be needed for future steps.
Be concise — maximum 200 words.

{format_messages(old_messages)}"""

    summary = llm_client.generate(summary_prompt)

    # 将摘要作为一条 system message 注入
    summary_message = {
        "role": "system",
        "content": f"[Conversation Summary]\n{summary}"
    }

    return [summary_message] + recent_messages
```

**策略 2：滑动窗口（Sliding Window）**

更简单粗暴——只保留最近 N 条消息，丢弃更早的消息。

```python
def sliding_window(messages: list[dict], max_messages: int = 10) -> list[dict]:
    """保留 system message + 最近 N 条消息"""
    system_msgs = [m for m in messages if m["role"] == "system"]
    non_system = [m for m in messages if m["role"] != "system"]
    return system_msgs + non_system[-max_messages:]
```

**策略 3：选择性保留（Selective Retention）**

根据消息的"重要性"决定保留还是丢弃。

```python
def selective_retain(messages: list[dict], token_budget: int) -> list[dict]:
    """按重要性保留消息，直到填满 token 预算"""

    def importance_score(msg: dict) -> int:
        if msg["role"] == "system":
            return 100  # 永远保留
        if msg.get("is_final_result"):
            return 90   # 最终结果必须保留
        if msg["role"] == "user":
            return 80   # 用户输入高优先
        if msg.get("tool_error"):
            return 20   # 错误信息低优先（已经被处理过了）
        if msg.get("tool_result"):
            return 40   # 工具结果中等优先
        return 50

    scored = [(importance_score(m), i, m) for i, m in enumerate(messages)]
    scored.sort(key=lambda x: (-x[0], x[1]))  # 按重要性降序，原始顺序升序

    retained = []
    used_tokens = 0
    for score, idx, msg in scored:
        msg_tokens = estimate_tokens(msg["content"])
        if used_tokens + msg_tokens <= token_budget:
            retained.append((idx, msg))
            used_tokens += msg_tokens

    # 恢复原始顺序
    retained.sort(key=lambda x: x[0])
    return [msg for _, msg in retained]
```

### 7.3 Token 预算分配

一个经验性的 Token 预算分配方案（以 8K context window 为例）：

```
Total Context Window: 8,192 tokens
                    │
    ┌───────────────┼───────────────┐
    │               │               │
System Prompt    Working Area     Reserved for
  ~25%            ~60%            Output ~15%
 (2,048)         (4,915)          (1,229)
    │               │
    │         ┌─────┴──────┐
    │         │            │
    │    Tool Descs    History + State
    │     ~15%          ~45%
    │    (1,229)       (3,686)
    │
    ├── Identity & Role: 500
    ├── Behavior Rules: 800
    ├── Output Format: 500
    └── Constraints: 248
```

关键原则：
- **Output Reserved 不能省**：如果留给输出的空间不足，LLM 会输出截断的 JSON，导致解析失败
- **System Prompt 预算固定**：行为约束不能因为 context 紧张而被裁剪
- **History 是最大的压缩空间**：优先在这里节省 Token
- **工具描述可以按需加载**：如果 Router 已经选定了工具，后续 Executor 只需要注入被选中工具的描述，而非全部工具

### 7.4 工具返回值的处理

工具返回值是 context 膨胀的最大单点源头。以下是几种处理策略：

```python
def process_tool_result(result: str, max_tokens: int = 1500) -> str:
    """处理工具返回值，防止 context 爆炸"""

    result_tokens = estimate_tokens(result)

    if result_tokens <= max_tokens:
        return result

    # 策略 1：截断（适用于文本类结果）
    if is_text(result):
        return truncate_to_tokens(result, max_tokens) + "\n[... truncated]"

    # 策略 2：提取摘要（适用于 JSON 类结果）
    if is_json(result):
        data = json.loads(result)
        if isinstance(data, list):
            # 只保留前 N 条记录 + 总数信息
            summary = {
                "total_count": len(data),
                "showing_first": 5,
                "records": data[:5],
                "note": f"Truncated from {len(data)} records. Request specific filters for more."
            }
            return json.dumps(summary, ensure_ascii=False, indent=2)

    # 策略 3：兜底截断
    return truncate_to_tokens(result, max_tokens) + "\n[... truncated]"
```

---

## 8. 常见陷阱

### 8.1 Prompt 太长导致 LLM "忘记"关键指令

**现象：** System Prompt 有 3000 token，其中包含 20 条行为规则。LLM 在前几轮严格遵守，但随着 context 变长，开始"遗忘"中间的规则——尤其是第 8-15 条。

**原因：** LLM 对 prompt 中不同位置内容的"注意力"不均匀。开头和结尾的内容通常被更好地遵循（primacy effect 和 recency effect），中间的内容最容易被忽略。

**应对：**
- 将最关键的规则放在 System Prompt 的开头和结尾
- 将规则数量控制在 7 条以内（与人类工作记忆容量一致，也利于 LLM）
- 在消息末尾添加 reminder："Remember: always output valid JSON. Never fabricate tool names."
- 按当前 Turn 的需要动态注入最相关的规则子集，而非每次都注入全部规则

### 8.2 工具描述和 System Prompt 冲突

**现象：** System Prompt 说"不要执行任何数据删除操作"，但某个工具的 description 中包含"Deletes records matching the query"。LLM 收到删除请求时，行为不确定——有时遵循 System Prompt 的禁令，有时遵循工具描述的能力。

**原因：** LLM 看到的是拼装后的完整 prompt，它不理解"System Prompt 优先级高于工具描述"这个层级关系。两段相互矛盾的文本让 LLM 陷入冲突。

**应对：**
- 在 Prompt 组装阶段做**一致性检查**：扫描工具描述中的关键词，与 System Prompt 的禁止列表做匹配
- 如果某个工具被禁用，**直接不注入它的描述**，而不是注入描述然后在 System Prompt 中禁止
- 在 System Prompt 中明确声明优先级："If any tool description conflicts with these rules, these rules take priority."

### 8.3 过度约束导致 LLM 无法灵活应对

**现象：** 为了保证安全，System Prompt 中加了大量限制："只能调用列表中的工具"、"只能输出 JSON"、"不能包含任何解释"、"不能问用户问题"、"必须在一次调用中完成"......结果 LLM 在遇到无法处理的请求时，输出空 JSON 或无意义的工具调用，而不是合理地拒绝或请求澄清。

**原因：** 过度约束堵死了 LLM 所有的"逃生通道"。它没有被允许说"我不知道"或"我需要更多信息"，所以只能在约束框架内硬凑一个输出。

**应对：**
- 永远为 LLM 保留一个"安全出口"：允许它输出 `{"action": "clarify", "question": "..."}` 或 `{"action": "refuse", "reason": "..."}`
- 区分"硬约束"和"软约束"：硬约束（安全规则）不可违反，软约束（输出偏好）在特殊情况下可以放松
- 将约束从"禁止列表"改为"优先级列表"：先尝试 X，如果不行可以 Y，最后可以 Z

### 8.4 Prompt Injection 在 Agent 中的放大效应

在 Chatbot 中，Prompt Injection 最多让模型输出不当内容。但在 Agent 中，Prompt Injection 可能触发**真实的工具调用**——删除数据、发送邮件、调用 API。

**应对：**
- 用户输入和系统指令之间必须有明确的分隔标记
- 工具调用前做参数校验（schema validation），而非完全信任 LLM 输出
- 高危操作（删除、支付、发送）增加人工确认步骤
- 将用户输入视为"不可信数据"，在 Prompt 中明确标注：`[USER INPUT - UNTRUSTED]: {user_message}`

---

## 9. 结语：从 Prompt 到 Runtime

Prompt Engineering for Agents 的本质是**为 LLM 定义一套可编程的行为接口**。我们在本文中讨论了分层架构、设计模式、推理策略、测试方法和 context 管理——这些都是让 Agent "可控"的基础设施。

但 Prompt 本身只是 Agent 系统的一个组件。再好的 Prompt 也需要一个可靠的 Runtime 来驱动——处理 LLM 的响应、管理状态机的转换、执行工具调用、处理错误和重试。

下一篇文章《Agent Runtime from Scratch: 不依赖框架构建 Agent》将从零开始实现一个完整的 Agent 运行时。我们会把本文设计的 Prompt 模式，放进一个真实可运行的控制循环中，展示 Prompt、工具、状态管理和错误处理如何在代码层面协同工作。

**进一步思考：**

1. **Prompt 的自动优化**：如果我们有了 Prompt 测试框架和评估指标，是否可以用搜索算法（DSPy 的思路）自动优化 Prompt？这和手工调优的 trade-off 在哪里？

2. **Multi-Model Prompt 策略**：Router 用小模型（快、便宜），Planner 用大模型（准、贵），Executor 用中等模型。不同模型对 Prompt 的响应特性不同，如何为不同模型定制 Prompt？

3. **Prompt 的可解释性**：当 Agent 做出错误决策时，我们如何从 Prompt 和输出中定位问题根因？这需要什么样的 observability 基础设施？

4. **动态 Prompt 生成**：是否可以让一个 "Meta-Agent" 根据当前任务特征，动态生成最合适的 Prompt？这会引入什么样的复杂性和风险？

---

> **系列导航**：本文是 Agentic 系列的第 06 篇。
>
> - 上一篇：[05 | Tool Calling Deep Dive](/blog/engineering/agentic/05-Tool%20Calling%20Deep%20Dive)
> - 下一篇：[07 | Agent Runtime from Scratch](/blog/engineering/agentic/07-Agent%20Runtime%20from%20Scratch)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
