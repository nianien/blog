---
title: "规划与反思：从ReAct到分层规划与自我纠错"
pubDate: "2026-01-12"
description: "Agentic 系列第 10 篇。深入剖析 Agent 规划（Planning）与反思（Reflection）的核心机制——从 ReAct 的交替推理、Plan-and-Execute 的全局视野、Tree-of-Thought 的多路径搜索，到分层规划的递归分解，再到结构化反思与自我纠错。包含完整 Python 实现、决策分析与 trade-off 讨论。"
tags: ["Agentic", "AI Engineering", "Planning"]
---

# Planning and Reflection: 从 ReAct 到分层规划与自我纠错

> LLM 的 next-token prediction 天生是"短视"的——它只看到当前 token 的概率分布，不会思考十步之后的结局。规划（Planning）让 Agent 具备"远视"能力，反思（Reflection）让 Agent 具备"纠错"能力。二者结合，是 Agent 从"工具调用器"进化为"问题解决者"的关键。
>
> 本文是 Agentic 系列的第 10 篇。我们将从规划范式的演进出发，深入分析 ReAct、Plan-and-Execute、Tree-of-Thought、Hierarchical Planning 四种规划模式，再系统探讨 Reflection 机制的设计与陷阱。

---

## 1. 为什么 Agent 需要规划和反思

LLM 的核心训练目标是 next-token prediction：给定前文，预测最可能的下一个 token。这种机制天然缺乏两种能力：

- **前瞻（Lookahead）**：生成第一步时不会考虑"这个决定在第五步会导致什么后果"——每一步都选局部最优，但局部最优的叠加不等于全局最优。
- **回溯（Backtrack）**：一旦生成了一段文本就不会主动回头修正，即使中间步骤出了错，后续 token 也会基于错误的前提继续生成。

**规划（Planning）** 弥补前瞻缺陷——在执行前把大目标拆成子目标，考虑步骤间的依赖和顺序。**反思（Reflection）** 弥补回溯缺陷——在执行后检查结果、分析错误、决定重试或调整。

```
没有规划的 Agent：走一步看一步（Greedy, Reactive）
有规划的 Agent：先想好路线再出发（Deliberate, Proactive）
有反思的 Agent：走错了能发现、能纠正（Self-correcting）
```

二者结合，Agent 才能从"工具调用器"进化为"问题解决者"。

---

## 2. 规划范式的演进

```
   2022              2023 early         2023 mid            2023+ now
    │                    │                  │                    │
    ▼                    ▼                  ▼                    ▼
┌────────┐      ┌──────────────┐    ┌──────────────┐   ┌────────────────┐
│No Plan │─────▶│    ReAct     │───▶│Plan-and-Exec │──▶│ Hierarchical   │
│直接回答 │      │Thought-Act-  │    │先规划再执行   │   │  Planning      │
└────────┘      │Observation   │    └──────────────┘   │ 多层级分解     │
                └──────┬───────┘                       └────────────────┘
                       │           ┌──────────────┐           ▲
                       └──────────▶│Tree-of-Thought│──────────┘
                                   │多路径搜索     │
                                   └──────────────┘

能力维度：单步回答 ──▶ 逐步推理 ──▶ 全局规划 ──▶ 多路径探索 ──▶ 递归分解
```

| 范式 | 核心思想 | 解决了什么 | 新的问题 |
|------|---------|-----------|---------|
| No Planning | LLM 直接回答 | — | 无法处理多步任务 |
| ReAct | 交替 Thought-Action-Observation | 多步推理+行动 | Greedy，缺乏全局视野 |
| Plan-and-Execute | 先规划再逐步执行 | 全局视野，可追踪 | 计划可能过时，修正成本高 |
| Tree-of-Thought | 多条路径搜索选优 | 探索多种可能性 | 成本倍增 |
| Hierarchical | 多层级递归分解 | 处理真正复杂的任务 | 架构复杂，调试困难 |

---

## 3. ReAct 深入分析

### 3.1 原理：Reason + Act 交替进行

ReAct（Yao et al., 2022）让 LLM 在推理（Thought）和行动（Action）之间交替，每次行动后观察结果（Observation），再基于观察继续推理。

```
User Question
     │
     ▼
┌──────────┐     ┌──────────┐     ┌──────────────┐
│ Thought  │────▶│  Action  │────▶│ Observation  │
│ (推理)   │     │ (行动)   │     │ (观察结果)    │
└──────────┘     └──────────┘     └──────┬───────┘
     ▲                                    │
     └────────────────────────────────────┘
```

### 3.2 ReAct Prompt 模板

```python
REACT_SYSTEM_PROMPT = """You operate in a loop of Thought, Action, Observation.

- Thought: Analyze the situation and decide the next step.
- Action: Call a tool. Format: Action: tool_name({"param": "value"})
- Observation: Review the tool's result.

When ready, respond: Final Answer: <your answer>

Available tools:
{tool_descriptions}

Rules:
1. Always think before acting.
2. If a tool fails, analyze why and try differently.
3. Do not fabricate information — use only tool results.
"""
```

### 3.3 优点与缺点

**优点**：灵活自适应（每步可根据 Observation 调整）、实现简单（while 循环 + prompt）、可解释性强（Thought 暴露推理过程）、容错好（失败后下一步可换策略）。

**缺点**：Greedy / 短视（不考虑长期后果）、效率低（每步完整 LLM 调用）、上下文膨胀（步骤越多 token 越多）、容易循环（重复同一失败策略）。

### 3.4 Python 实现

```python
import json
from dataclasses import dataclass
from typing import Callable
import openai

@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    function: Callable

class ReActAgent:
    def __init__(self, model: str = "gpt-4o", tools: list[Tool] | None = None,
                 max_iterations: int = 10):
        self.model = model
        self.tools = {t.name: t for t in (tools or [])}
        self.max_iterations = max_iterations
        self.client = openai.OpenAI()

    def _build_system_prompt(self) -> str:
        tool_desc = "\n".join(
            f"- {t.name}: {t.description}" for t in self.tools.values()
        )
        return REACT_SYSTEM_PROMPT.format(tool_descriptions=tool_desc)

    def _parse_action(self, text: str) -> tuple[str, dict] | None:
        for line in text.split("\n"):
            if line.strip().startswith("Action:"):
                action_str = line.strip()[len("Action:"):].strip()
                paren = action_str.find("(")
                if paren == -1:
                    return None
                name = action_str[:paren].strip()
                params_str = action_str[paren + 1:].rstrip(")")
                params = json.loads(params_str) if params_str else {}
                return name, params
        return None

    def _execute_tool(self, name: str, params: dict) -> str:
        if name not in self.tools:
            return f"Error: Unknown tool '{name}'"
        try:
            return str(self.tools[name].function(**params))
        except Exception as e:
            return f"Error: {e}"

    def run(self, query: str) -> str:
        messages = [
            {"role": "system", "content": self._build_system_prompt()},
            {"role": "user", "content": query},
        ]
        for _ in range(self.max_iterations):
            resp = self.client.chat.completions.create(
                model=self.model, messages=messages, temperature=0.0,
            )
            text = resp.choices[0].message.content
            messages.append({"role": "assistant", "content": text})

            if "Final Answer:" in text:
                return text.split("Final Answer:")[-1].strip()

            action = self._parse_action(text)
            if action is None:
                messages.append({"role": "user",
                                 "content": "Provide a valid Action or Final Answer."})
                continue

            observation = self._execute_tool(*action)
            messages.append({"role": "user", "content": f"Observation: {observation}"})

        return "Reached max iterations without final answer."
```

注意：随着迭代增加 `messages` 不断膨胀，token 消耗呈线性增长。超过 5-6 步的任务需要考虑上下文压缩（如摘要历史步骤）。

---

## 4. Plan-and-Execute 模式

### 4.1 原理：先规划再执行

Plan-and-Execute 将规划与执行分离：先用一次 LLM 调用生成完整计划，再逐个执行子任务，必要时触发 Replanning。

```
┌────────────┐       Plan: [S1, S2, S3]      ┌────────────┐
│  Planner   │──────────────────────────────▶│  Executor  │
│ (全局规划)  │                                │ (逐步执行)  │
└────────────┘                                └─────┬──────┘
      ▲                                             │ 执行失败
      │            ┌─────────────┐                  │
      └────────────│  Replanner  │◀─────────────────┘
                   │ (动态修正)   │
                   └─────────────┘
```

### 4.2 Planner / Executor 分离的优势

1. **关注点分离**：Planner 负责"做什么"，Executor 负责"怎么做"，可以分别用不同模型优化
2. **可并行**：无依赖的步骤可以并行执行
3. **可追踪**：计划本身是结构化数据，便于监控和审计
4. **可中断恢复**：执行到一半中断后可从某一步重启

### 4.3 计划的动态修正

三种 Replan 策略：**完全重新规划**（全局优化但可能丢弃已有成果）、**局部修正**（成本低但可能保留错误前提）、**条件触发**（仅在步骤失败或偏差超阈值时 Replan）。生产中通常用条件触发 + 局部修正的组合。

### 4.4 Python 实现

```python
from dataclasses import dataclass, field

@dataclass
class PlanStep:
    id: int
    description: str
    tool: str | None = None
    depends_on: list[int] = field(default_factory=list)
    status: str = "pending"   # pending / completed / failed
    result: str | None = None

PLANNER_PROMPT = """Decompose the goal into concrete steps (max 7).
Available tools: {tool_names}
Output JSON: {{"goal": "...", "steps": [{{"id": 1, "description": "...",
"tool": "tool_name or null", "depends_on": []}}]}}"""

class PlanAndExecuteAgent:
    def __init__(self, tools: dict[str, Tool],
                 planner_model: str = "gpt-4o",
                 executor_model: str = "gpt-4o-mini",
                 max_replans: int = 3):
        self.tools = tools
        self.planner_model = planner_model
        self.executor_model = executor_model
        self.max_replans = max_replans
        self.client = openai.OpenAI()

    def _create_plan(self, goal: str) -> list[PlanStep]:
        resp = self.client.chat.completions.create(
            model=self.planner_model,
            messages=[
                {"role": "system", "content": PLANNER_PROMPT.format(
                    tool_names=", ".join(self.tools.keys()))},
                {"role": "user", "content": goal},
            ],
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content)
        return [PlanStep(**s) for s in data["steps"]]

    def _execute_step(self, step: PlanStep, context: dict) -> str:
        if step.tool and step.tool in self.tools:
            param_resp = self.client.chat.completions.create(
                model=self.executor_model,
                messages=[{"role": "system", "content":
                    f"Call tool '{step.tool}' for: {step.description}\n"
                    f"Context: {json.dumps(context)}\nReturn JSON params only."}],
                response_format={"type": "json_object"},
            )
            params = json.loads(param_resp.choices[0].message.content)
            return str(self.tools[step.tool].function(**params))
        resp = self.client.chat.completions.create(
            model=self.executor_model,
            messages=[{"role": "user",
                       "content": f"Task: {step.description}\nContext: {json.dumps(context)}"}],
        )
        return resp.choices[0].message.content

    def run(self, goal: str) -> str:
        steps = self._create_plan(goal)
        context = {}
        for replan in range(self.max_replans + 1):
            for step in steps:
                if step.status == "completed":
                    continue
                deps_met = all(
                    any(s.id == d and s.status == "completed" for s in steps)
                    for d in step.depends_on
                )
                if not deps_met:
                    continue
                try:
                    step.result = self._execute_step(step, context)
                    step.status = "completed"
                    context[f"step_{step.id}"] = step.result
                except Exception as e:
                    step.status = "failed"
                    step.result = str(e)
                    steps = self._replan(goal, steps, step)
                    break
            if all(s.status == "completed" for s in steps):
                return self._synthesize(goal, context)
        return "Exceeded max replans."

    def _replan(self, goal, steps, failed) -> list[PlanStep]:
        # 将已完成步骤 + 失败信息交给 Planner 重新规划
        completed = [{"id": s.id, "result": s.result}
                     for s in steps if s.status == "completed"]
        resp = self.client.chat.completions.create(
            model=self.planner_model,
            messages=[{"role": "user", "content":
                f"Replan. Goal: {goal}\nCompleted: {json.dumps(completed)}\n"
                f"Failed step: {failed.description} -> {failed.result}"}],
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content)
        return [PlanStep(**s) for s in data["steps"]]

    def _synthesize(self, goal, context):
        resp = self.client.chat.completions.create(
            model=self.planner_model,
            messages=[{"role": "user",
                       "content": f"Goal: {goal}\nResults: {json.dumps(context)}\n"
                       "Synthesize a final answer."}],
        )
        return resp.choices[0].message.content
```

Planner 用 `gpt-4o`（强规划），Executor 用 `gpt-4o-mini`（快执行）——这是生产中常见的成本优化手段。

---

## 5. Tree-of-Thought

### 5.1 原理

Tree-of-Thought（ToT，Yao et al. 2023）模拟人类"深思熟虑"：同时考虑多条推理路径，评估每条的前景，选择最优的继续深入。

```
                       Root (问题)
                      /     |     \
                   Th1     Th2    Th3      ← 生成多个候选 Thought
                  /   \     |    /   \
               T1a   T1b  T2a  T3a  T3b   ← 继续展开
                ✗      ✓    ✗    ✓    ✗    ← 评估函数打分，剪枝
```

三个核心组件：**Thought Generator**（每步生成 k 个候选）、**State Evaluator**（对候选打分）、**Search Algorithm**（BFS 或 DFS）。

### 5.2 BFS vs DFS

- **BFS**：每层展开 k 个，评估后保留 top-k 进入下一层。适合步骤少、每步选择多的问题。总调用 ≈ k x depth x 2（生成+评估）。
- **DFS**：选当前最优一路深入，死胡同时回溯。适合步骤多、每步选择少的问题。最好 O(depth)，最坏 O(k^depth)。

### 5.3 评估函数设计

1. **LLM 自评**：让 LLM 对每个 Thought 打分。简单但可能有系统性偏见。
2. **投票法**：多次评估取多数。更稳健但成本更高。
3. **外部验证**：可验证的问题（数学/代码）用外部工具检查。最可靠但适用范围有限。

### 5.4 Trade-off：质量 vs 成本

```
方法           LLM 调用次数      质量    适用场景
─────────────  ──────────────   ─────   ──────────
ReAct(单路径)   O(steps)         基准    大多数任务
ToT-BFS        O(k * d * 2)     高      创意/数学/方案选型
ToT-DFS        O(k^d) 最坏      中-高   深度推理
```

k=3, d=3 时 ToT 可能需要 40+ 次 LLM 调用，ReAct 只需 5-6 次——**8-10 倍成本差距**。只有当正确性要求高且存在多条有意义的推理路径时，ToT 的投入才有回报。

### 5.5 Python 实现

```python
import json
from dataclasses import dataclass, field
import openai

@dataclass
class ThoughtNode:
    """搜索树中的节点，每个节点代表一条推理路径的当前状态"""
    state: str                           # 当前推理状态（累积的 thought 文本）
    score: float = 0.0                   # 评估函数打分
    depth: int = 0
    children: list["ThoughtNode"] = field(default_factory=list)

class TreeOfThought:
    def __init__(self, model: str = "gpt-4o", k: int = 3, max_depth: int = 3):
        """
        k: 每层生成的候选 thought 数量（BFS 宽度）
        max_depth: 搜索树最大深度
        """
        self.model = model
        self.k = k
        self.max_depth = max_depth
        self.client = openai.OpenAI()

    def generate_thoughts(self, problem: str, current_state: str) -> list[str]:
        """生成 k 个候选 thought"""
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content":
                f"Given the problem and current reasoning state, "
                f"generate exactly {self.k} distinct next-step thoughts.\n"
                f'Return JSON: {{"thoughts": ["thought1", "thought2", ...]}}'},
                {"role": "user", "content":
                f"Problem: {problem}\nCurrent state: {current_state or '(start)'}"}],
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content)
        return data["thoughts"][:self.k]

    def evaluate_thought(self, problem: str, state: str) -> float:
        """评估当前推理状态的前景，返回 0-1 分数"""
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content":
                "Evaluate how promising this reasoning state is for solving the problem.\n"
                'Return JSON: {"score": 0.0-1.0, "reason": "..."}'},
                {"role": "user", "content":
                f"Problem: {problem}\nReasoning so far: {state}"}],
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content)
        return float(data["score"])

    def solve(self, problem: str) -> str:
        """BFS 搜索：每层生成 k 个候选，评估后保留 top-k 进入下一层"""
        # 初始化：根节点
        current_level = [ThoughtNode(state="", depth=0)]

        for depth in range(self.max_depth):
            candidates: list[ThoughtNode] = []

            for node in current_level:
                # 为每个节点生成 k 个候选 thought
                thoughts = self.generate_thoughts(problem, node.state)
                for thought in thoughts:
                    new_state = f"{node.state}\nStep {depth+1}: {thought}".strip()
                    score = self.evaluate_thought(problem, new_state)
                    child = ThoughtNode(state=new_state, score=score, depth=depth+1)
                    node.children.append(child)
                    candidates.append(child)

            # 保留 top-k 进入下一层（BFS 剪枝）
            candidates.sort(key=lambda n: n.score, reverse=True)
            current_level = candidates[:self.k]

        # 返回最终得分最高的推理路径
        best = max(current_level, key=lambda n: n.score)
        return best.state
```

核心观察：BFS 宽度 `k` 和搜索深度 `max_depth` 共同控制质量-成本的 trade-off。`k` 越大，每层探索的候选越多，找到好路径的概率越高，但 LLM 调用次数以 O(k² × d) 增长（每层 k 个节点各生成 k 个候选 + k 次评估）。实践中 k=2~3、depth=2~3 是较好的起点，可根据任务复杂度动态调整。

---

## 6. 分层规划（Hierarchical Planning）

当任务复杂到"设计并实现用户权限系统"这种级别时，一层计划无法覆盖从架构到实现的所有粒度。分层规划通过**递归分解**解决：高层拆子目标，低层拆具体动作。

```
高层规划器 (Strategic)
├─ 子目标1: 设计数据模型
│   └─ 低层规划器 (Tactical)
│       ├─ Action: 分析需求
│       ├─ Action: 设计 ER 图
│       └─ Action: 定义 API Schema
├─ 子目标2: 实现认证模块
│   └─ 低层规划器
│       ├─ Action: 实现 JWT 签发
│       └─ Action: 编写测试
└─ 子目标3: 实现授权模块
    └─ 低层规划器
        ├─ Action: 实现 RBAC
        └─ Action: 集成测试
```

### 6.1 递归分解的终止条件

1. **原子性**：任务可用单次工具调用完成 → 停止分解
2. **深度限制**：最大 2-3 层，防止过度分解
3. **预算约束**：剩余 token 预算不足以继续分解 → 当前粒度直接执行

```python
class HierarchicalPlanner:
    def __init__(self, client: openai.OpenAI, model="gpt-4o", max_depth=3):
        self.client, self.model, self.max_depth = client, model, max_depth

    def decompose(self, goal: str, depth: int = 0) -> dict:
        if depth >= self.max_depth:
            return {"type": "action", "description": goal}

        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content":
                "Decide if this goal is atomic or compound.\n"
                'Atomic: {"type":"action","description":"..."}\n'
                'Compound: {"type":"goal","description":"...","subgoals":["...",]}'},
                {"role": "user", "content": goal}],
            response_format={"type": "json_object"},
        )
        node = json.loads(resp.choices[0].message.content)
        if node["type"] == "action":
            return node
        node["children"] = [self.decompose(sg, depth+1) for sg in node.get("subgoals",[])]
        return node
```

实践中 2 层（Strategic + Tactical）通常够用。3 层以上的调试成本会快速失控。

### 6.2 执行层：递归执行分解后的计划

`HierarchicalPlanner` 只负责分解，执行需要单独的 Executor。核心逻辑：叶节点（type="action"）直接调用 LLM 或工具执行，分支节点（type="goal"）递归执行所有子节点并聚合结果。

```python
@dataclass
class ExecutionResult:
    description: str
    output: str
    success: bool
    children: list["ExecutionResult"] = field(default_factory=list)

class HierarchicalExecutor:
    def __init__(self, client: openai.OpenAI, model: str = "gpt-4o-mini",
                 tools: dict[str, Callable] | None = None):
        self.client = client
        self.model = model
        self.tools = tools or {}

    def execute(self, node: dict) -> ExecutionResult:
        """递归执行分解后的计划树"""
        desc = node.get("description", "")

        # 叶节点：直接执行
        if node["type"] == "action":
            output = self._execute_action(desc)
            return ExecutionResult(description=desc, output=output, success=True)

        # 分支节点：递归执行所有子节点
        child_results = [self.execute(child) for child in node.get("children", [])]
        all_success = all(r.success for r in child_results)

        # 聚合子节点结果
        summary = self._aggregate(desc, child_results)
        return ExecutionResult(
            description=desc, output=summary,
            success=all_success, children=child_results,
        )

    def _execute_action(self, action: str) -> str:
        """执行单个原子动作——优先使用工具，否则 fallback 到 LLM"""
        for tool_name, tool_fn in self.tools.items():
            if tool_name.lower() in action.lower():
                return str(tool_fn(action))
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": f"Execute this task: {action}"}],
        )
        return resp.choices[0].message.content

    def _aggregate(self, goal: str, results: list[ExecutionResult]) -> str:
        """将子节点执行结果聚合为父目标的总结"""
        parts = "\n".join(f"- {r.description}: {r.output[:200]}" for r in results)
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content":
                f"Goal: {goal}\nSub-results:\n{parts}\nSummarize the overall outcome."}],
        )
        return resp.choices[0].message.content
```

分解与执行分离的好处：`HierarchicalPlanner` 可以用强模型（gpt-4o）做规划，`HierarchicalExecutor` 用快模型（gpt-4o-mini）做执行，兼顾规划质量和执行成本。同时，执行层可以独立替换——例如将 `_execute_action` 改为调用真实 API 或 Code Interpreter，而不影响规划逻辑。

---

## 7. Reflection（反思）机制

### 7.1 为什么需要反思

Agent 有三类常见失败：LLM 输出错误（幻觉/逻辑错误）、工具执行失败（超时/参数错误）、计划不可行（前提假设不成立）。没有反思，错误会**无意识地传播**——第 2 步的错成为第 3 步的输入，错误不断累积。

### 7.2 Self-Critique

用同一个 LLM 评估自己的输出。理论支持：LLM 在**验证**上通常比**生成**更强（就像检查别人的代码比自己写更容易）。但盲区在于：LLM 的系统性偏见在生成和评估中是一致的。

### 7.3 结构化反思

```python
@dataclass
class ReflectionResult:
    what_went_well: list[str]
    what_went_wrong: list[str]
    root_cause: str
    what_to_do_next: str
    should_retry: bool
    confidence: float  # 0-1

REFLECTION_PROMPT = """Analyze this execution result.
Goal: {goal} | Steps: {steps} | Result: {result}
Return JSON: {{"what_went_well":[], "what_went_wrong":[], "root_cause":"",
"what_to_do_next":"", "should_retry": bool, "confidence": 0.0-1.0}}"""
```

### 7.4 Retry Budget 与 Stop Condition

反思不能无限循环。必须有 Stop Condition：

```
                  反思完成
                     │
          ┌──────────▼──────────┐   是
          │ 质量 >= 阈值？       │─────▶ 返回结果
          └──────────┬──────────┘
                     │ 否
          ┌──────────▼──────────┐   是
          │ 达到最大重试？       │─────▶ 返回最好的结果
          └──────────┬──────────┘
                     │ 否
          ┌──────────▼──────────┐   是
          │ 改进幅度 < 阈值？    │─────▶ 停止（再试也没用）
          └──────────┬──────────┘
                     │ 否
          ┌──────────▼──────────┐   是
          │ 成本超出预算？       │─────▶ 返回当前结果
          └──────────┬──────────┘
                     │ 否
                  继续重试
```

四个条件形成**多层安全网**：质量达标是正常退出，最大重试和成本预算是硬性保底，改进幅度检测是"聪明的"提前退出。

### 7.5 代码实现

```python
@dataclass
class ReflectionPolicy:
    max_retries: int = 3
    quality_threshold: float = 0.7
    improvement_threshold: float = 0.1
    cost_limit_tokens: int = 10000

class ReflectiveAgent:
    def __init__(self, base_agent: ReActAgent, policy: ReflectionPolicy,
                 model: str = "gpt-4o-mini"):
        self.base_agent = base_agent
        self.policy = policy
        self.model = model
        self.client = openai.OpenAI()

    def _reflect(self, goal, steps, result) -> ReflectionResult:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": REFLECTION_PROMPT.format(
                goal=goal, steps=json.dumps(steps), result=result)}],
            response_format={"type": "json_object"},
        )
        return ReflectionResult(**json.loads(resp.choices[0].message.content))

    def run(self, goal: str) -> str:
        best_result, best_score = None, 0.0
        history = []

        for attempt in range(self.policy.max_retries + 1):
            # 执行（重试时注入反思结论）
            if attempt == 0:
                result = self.base_agent.run(goal)
            else:
                enhanced = (f"{goal}\n\nPrevious issues: {reflection.what_went_wrong}"
                           f"\nRoot cause: {reflection.root_cause}"
                           f"\nSuggestion: {reflection.what_to_do_next}")
                result = self.base_agent.run(enhanced)

            reflection = self._reflect(goal, history, result)

            # Stop conditions
            if reflection.confidence >= self.policy.quality_threshold:
                best_result, best_score = result, reflection.confidence
                break
            if not reflection.should_retry:
                break
            if attempt > 0 and (reflection.confidence - best_score) < self.policy.improvement_threshold:
                break  # 改进幅度不足，再试也没用

            # 更新最优结果（放在 stop condition 之后，避免 improvement 检查失效）
            if reflection.confidence > best_score:
                best_result, best_score = result, reflection.confidence

            history.append({"attempt": attempt, "issues": reflection.what_went_wrong})

        return best_result or result
```

---

## 8. Reflection 的陷阱

### 8.1 无限循环

Agent 不断反思但不改进——反思发现了问题却没有提供有效的改进方向。解法：`improvement_threshold` 检测，连续两轮质量差距 < 0.1 直接停止。

### 8.2 过度反思

简单任务（"今天天气怎么样"）也要三轮反思，浪费 3-4 倍 token。解法：引入复杂度判断，简单任务跳过反思。

```python
def needs_reflection(task: str, result: str) -> bool:
    """简单任务不值得反思"""
    if len(result) < 100:  # 结果很短 → 可能是简单查询
        return False
    simple_patterns = ["什么是", "查一下", "告诉我"]
    return not any(p in task for p in simple_patterns)
```

### 8.3 成本爆炸

每次反思是完整 LLM 调用，包含完整上下文。对策：(1) 反思用小模型（GPT-4o-mini）；(2) 压缩上下文传摘要版本；(3) 采样反思（30% 的执行触发反思而非 100%）。

### 8.4 合理的 Reflection 策略

```
Q1: 任务的错误成本高吗？
  高 → 启用反思    低 → 跳过

Q2: 错误可自动检测吗？
  是（代码可测试） → 外部验证（更可靠更便宜）
  否（文案质量）   → LLM Self-Critique

Q3: 预算够吗？
  够   → 结构化反思 + 多轮重试
  不够 → 单轮 Self-Critique

Q4: 延迟敏感吗？
  是 → 最多一轮，超时直接返回

---

---

---


---

## 9. 自发反思触发机制

### 9.1 为什么需要自发触发

反思不应该总是被动地在执行失败时才启动。更好的策略是：Agent 能主动察觉到质量下降的信号，自发触发反思，而不必等到显式的失败。这样可以在问题恶化前及时纠正。

三种常见的衰退信号：

1. **信息熵监测**：当 LLM 的输出开始重复时，信息熵突然下降。这是"词汇枯竭"的标志，通常意味着模型卡在某个固定的推理循环中。
2. **预测置信度阈值**：LLM 通常可以对自己输出的置信度给出评估。当置信度连续下降或低于阈值时，反思应该被触发。
3. **外部反馈信号**：工具返回异常（HTTP 错误、超时）、用户表示不满、或执行结果与预期格式不符。

### 9.2 信息熵的计算和置信度追踪

信息熵可通过分析文本 token 的概率分布来计算。当最近 N 个 token 的熵突然下降时（相比前一个窗口），说明输出开始陷入重复。置信度则由 LLM 自行评估：要求其输出一个 0-1 的置信度分数，同时说明是否仍在正轨上。

### 9.3 ReflectionTrigger 类设计

核心思想是多信号融合：监控三个独立信号（信息熵、置信度、外部异常），只有当多个信号同时触发时才进入反思模式。这比单一阈值更稳健。

实现上，维护 entropy_history、confidence_history 两个滑动窗口，逐次判断是否满足触发条件。当检测到衰退信号时，构造新的 goal prompt，注入前一轮的发现问题和改进建议，促使下一轮执行做出改正。

### 9.4 实践建议

- **监控信息熵**：简单有效，可在本地计算，零成本。
- **置信度追踪**：额外一次 LLM 调用，但提供显式的自评信号。
- **外部反馈**：最可靠，但需要设计好信号收集机制。
- **多信号融合**：在生产中应该综合多个信号，而不是单一阈值。例如：Entropy 下降 + 置信度低 + 用户反馈，三信号都触发时才进入反思模式。

---

## 10. Planning 与 Reflection 的交互循环

### 10.1 为什么需要规划中的动态调整

静态规划假设任务的前提条件在执行过程中保持不变。但现实中：
- 环境变化（API 服务下线、数据更新）
- 中间步骤产生的数据与预期不符
- 依赖关系的前提假设不成立

**规划中局部修正**（Plan Repair）和**执行中动态重规划**（Adaptive Replanning）是对这些变化的响应。

### 10.2 三层修正策略

执行步骤失败时，先分析失败原因。如果是工具参数问题，可局部修正（调整参数重试）。如果是依赖条件不满足或前提错误，需要生成替代步骤或重新规划某个子目标。避免全局重规划的高成本。

### 10.3 AdaptivePlanExecutor 的核心能力

该执行器实现以下关键机制：
- **条件分支支持**：规划中的每个步骤可以有条件表达式，执行器在运行时评估（使用 LLM）并决定是否执行该步
- **局部修正优先**：检测到执行失败时，先诊断原因，尝试调整参数重试，避免全局重规划
- **动态步骤插入**：当需要全局重规划时，生成新步骤并插入计划，继续执行，无需重新开始
- **完整的执行日志**：记录每个步骤的执行状态、结果、以及是否经历过修正，便于调试和事后审计

关键方法：`_check_dependencies()` 检查依赖、`_evaluate_condition()` 评估条件、`_execute_with_retry()` 支持重试、`_diagnose_and_repair()` 根据错误信息决定修复策略。

---

## 11. Tree-of-Thought 评估函数的可靠性分析

### 11.1 评估函数的三大偏差

Tree-of-Thought 的核心问题不在搜索算法，而在于**评估函数本身的可靠性**。LLM 评估 LLM 的推理路径时，存在三类系统性偏差：

#### (a) 确认偏差（Confirmation Bias）

LLM 倾向于支持与已有假设一致的路径。如果一条推理路径的前两步很好，LLM 会对其后续步骤给予不合理的高分，即使第三步有明显缺陷。

#### (b) 多数人谬误（Plurality Fallacy）

当使用投票法（多次评估取多数）来降低个体 LLM 的偏差时，多个评估可能会放大共同的偏见。所有 LLM 都用相同的训练数据和算法，它们的系统性错误会同向。

#### (c) 评估成本的不对称性

成本高的路径（步骤多、调用多工具）往往看起来更"严谨"，评估函数容易给它高分。但高成本 ≠ 高质量。这导致 ToT 系统倾向于选择冗长、低效的解决方案。

### 11.2 去偏差的策略

**策略 1：对立面评估** — 用两个评估：一个打分，一个找缺陷，综合打分减去缺陷的严重程度。这样正面评估的乐观不会被 LLM 的确认偏差完全接纳。

**策略 2：随机扰动测试** — 通过随机扰动路径（加入轻微的不确定性表述），检验评估的鲁棒性。如果打分对小的改变很敏感，说明评估不稳定，可以用稳定性加权。

**策略 3：多维度评估聚合** — 从四个独立维度评估（correctness、efficiency、robustness、clarity），而不是单一打分。可以识别"看似高分但实际有缺陷"的路径。

### 11.3 综合方案

结合三种策略，取加权平均（多维度 50%、扰动稳定性 30%、对立面 20%）。既能降低单一评估的偏差，又不会过度增加成本。在生产中，BiasMitigatedToT 类整合所有去偏差方法。

---

## 12. 认知科学的理论支撑

### 12.1 Kahneman 双过程理论与 Agent 规划

认知心理学家 Kahneman 提出，人类思维分为两个系统：

- **System 1（快思考）**：直觉、快速、低成本，但容易出错。特点是自动化、并行处理。
- **System 2（慢思考）**：理性、缓慢、高成本，更精确。特点是需要专注、串行处理。

**在 Agent 设计中的对应**：

| 人类认知 | Agent 机制 | 特征 |
|--------|---------|------|
| System 1 | ReAct（单步推理+行动） | 快速响应，逐步贪心 |
| System 2 | Planning（深思熟虑的规划） | 全局视野，前瞻性强 |
| System 1+2 协作 | Hierarchical Planning + Reflection | 多层级思考+自我纠正 |

实际上，好的 Agent 架构正是对双过程理论的编程实现。简单任务直接 ReAct；复杂任务先规划、再执行、定期反思。这就是为什么 Plan-and-Execute 模式效果好于纯 ReAct：它显式地分离了"快思"和"慢思"的角色。

### 12.2 Rittel 的 Wicked Problem 与 Agent 的开放性问题

Rittel 和 Webber（1973）提出"邪恶问题"（Wicked Problem）的概念，指那些没有确定解的复杂问题。特征包括：

- **定义不清**：问题本身是不确定的，不同利益方对"问题是什么"的理解不同
- **无最优解**：没有"唯一正确答案"，只有"更优"和"更差"的权衡
- **可逆性差**：一旦开始求解，解决方案会改变问题本身
- **每个实例是唯一的**：无法简单套用历史经验

**Agent 面对的任务通常是 Wicked 的**。例如，"设计一个推荐系统"没有人能完全定义它，也没有唯一最优解。

**Agent 应对 Wicked Problem 的策略**：

1. **迭代探索**：不期望一次规划得到完美方案，而是通过多轮执行+反思不断逼近
2. **约束条件明确化**：显式列出假设、限制条件、优先级权衡
3. **反馈循环**：定期反思"问题定义是否还准确"，而不仅仅反思"解决方案是否有效"
4. **多路径探索**：Tree-of-Thought 式的多路径搜索对 Wicked Problem 特别有价值

这正是为什么简单的规划（Plan-and-Execute）对 Wicked 问题不够，需要能适应和调整的规划（Hierarchical + Adaptive）。

### 12.3 元认知（Metacognition）与 Agent 反思

元认知是"对自己认知过程的认知"，即"思考自己的思考"。人类具有强大的元认知能力：自我监控、策略调整、学习反思。

**Agent 的反思机制正是对元认知的形式化**。但关键区别是：人类的元认知是**连续的、隐性的**，而 Agent 的反思是**离散的、显式的**。

这导致两个挑战：

1. **反思的时机不够精细**：人类在每一步都有微观的自我监控，而 Agent 通常只在特定时刻触发反思
2. **反思的信号可靠性不同**：人类的"这不对"的直觉来自丰富的经验，而 LLM 的置信度评估可能是虚幻的

**改进方向**：

- **增加反思频率**：不只是事后反思，而是事中反思（每 N 步检查一次）
- **多信号融合**：不只依赖 LLM 的自评，还结合外部信号（工具反馈、用户反馈）
- **元学习**：让 Agent 在重复类似任务时记住"哪些反思策略有效"，逐渐改进反思的精准度

从某种意义上说，**Agent 的成熟度就取决于其元认知能力的完善程度**——能否准确察觉自己的不确定性、及时调整策略、从错误中学习。

---

## 9. 多 Agent 协作的成本特征分析

Multi-Agent 系统看起来功能更强，但成本结构也更复杂。本节量化对比四种协作模式的成本特征，帮助你在实际项目中做出经济合理的架构选择。

### 9.1 四种模式的成本维度对比

| 维度 | Supervisor-Worker | Peer-to-Peer | Pipeline | Dynamic Routing |
|------|------------------|--------------|----------|-----------------|
| **每任务 LLM 调用次数** | 1(Sup) + N(Workers) | 2-5（取决于轮数） | N（等于阶段数） | 1(Router) + 1(Expert) |
| **平均 Token 消耗** | ~35,000 | ~28,000 | ~25,000 | ~18,000 |
| **通信开销** | 低（星形集中） | 高（全网通信） | 低（链式顺序） | 低（分发） |
| **端到端延迟** | 中（并行 Workers） | 高（多轮协商） | 高（串行阶段） | 低（单次路由） |
| **并行度潜力** | 高（Worker 可并行） | 中（轮次间串行） | 低（阶段必须顺序） | 高（请求级并行） |
| **失败重试成本** | 中（重试单个 Worker） | 高（重新协商） | 高（后续阶段受影响） | 低（重试 Expert） |

### 9.2 实例成本估算：撰写技术博客

假设任务为：**撰写一篇 3000 字的技术博客**，关于"LLM Agent 成本优化最佳实践"。我们分别用四种模式实现，并对比成本。

**基础假设**：
- GPT-4o: $15/MTok (Input), $60/MTok (Output)
- GPT-4o-mini: $0.15/MTok (Input), $0.6/MTok (Output)
- 平均每个 LLM 调用产生 1,500 token 输出
- 平均上下文注入 2,000 token

#### 模式一：Supervisor-Worker

```
执行步骤：
1. Supervisor 分解任务                          Tokens: ~3,000 (Input: 2K, Output: 1K)
   ├─ Worker A (搜索): 搜集最新的 LLM 成本数据  Tokens: ~8,000 (Input: 4K, Output: 4K)
   ├─ Worker B (分析): 分析成本优化策略         Tokens: ~8,000 (Input: 4K, Output: 4K)
   ├─ Worker C (写作): 撰写初稿                 Tokens: ~10,000 (Input: 5K, Output: 5K)
   └─ Supervisor 合成最终版本                  Tokens: ~6,000 (Input: 4K, Output: 2K)

总 Token: 35,000

模型使用：
- Supervisor: GPT-4o (2次调用，共 9,000 token)        → $0.27
- Worker A/B: GPT-4o-mini (2次调用，共 16,000 token)  → $0.048
- Worker C: GPT-4o (1次调用，共 10,000 token)         → $0.30
- Supervisor 合成: GPT-4o (1次调用，共 6,000 token)   → $0.18
                                                Total: $0.798 (~$0.80)

执行时间：
- Supervisor 分解: 4s
- Workers 并行执行: max(6s, 6s, 8s) = 8s
- Supervisor 合成: 5s
                    Total: ~17s
```

#### 模式二：Peer-to-Peer

```
执行步骤（假设 3 轮协商）：
Round 1:
  - Agent A (初稿作者): 撰写初稿                   ~5,000 token
  - Agent B (技术审稿): 提出专业意见              ~4,000 token
  - Agent C (编辑): 检查逻辑和结构                ~3,000 token

Round 2:
  - Agent A: 根据反馈修改                         ~5,000 token
  - Agent B: 检查修改后的技术准确性               ~3,000 token
  - Agent C: 优化措辞                            ~2,000 token

Round 3:
  - Agent A: 最终微调                            ~3,000 token
  - 共识检测: 所有 Agent 同意发布                ~2,000 token

总 Token: ~27,000

模型使用：
- 所有 Agent 用 GPT-4o-mini                      → $0.081
                                                Total: $0.08

执行时间：
- Round 1: A(4s) + B(3s) + C(2s) = 9s (串行)
- Round 2: A(4s) + B(3s) + C(2s) = 9s (串行)
- Round 3: A(2s) + 共识(2s) = 4s
                                 Total: ~22s
```

#### 模式三：Pipeline

```
执行步骤（5 个阶段）：
1. Draft Agent: 快速生成初稿                      ~5,000 token
2. Review Agent: 审查内容准确性和完整性            ~4,000 token
3. Edit Agent: 改进措辞和逻辑流                   ~4,000 token
4. FactCheck Agent: 验证数据和引用               ~3,000 token
5. Format Agent: 最终排版和调整                   ~2,000 token

总 Token: ~18,000

模型使用：
- Draft: GPT-4o-mini                            → $0.015
- Review: GPT-4o-mini                           → $0.012
- Edit: GPT-4o-mini                             → $0.012
- FactCheck: GPT-4o                             → $0.21
- Format: GPT-4o-mini                           → $0.006
                                                Total: $0.255

执行时间：
- 5 个阶段串行: 4s + 3s + 3s + 4s + 2s = 16s
```

#### 模式四：Dynamic Routing

```
执行步骤：
1. Router (意图识别): "这是一个技术博客写作任务"  ~1,500 token (GPT-4o-mini)
2. 路由到 Blog Writer Expert Agent               ~1,500 token
3. Blog Writer 调用子工具：
   - 搜索工具: 不计 token（工具调用）
   - 数据整理: ~3,000 token
   - 撰写完整博客: ~10,000 token

总 Token: ~16,000

模型使用：
- Router: GPT-4o-mini                           → $0.0045
- Expert: GPT-4o (1次，包含搜索和写作)         → $0.21
                                                Total: $0.214

执行时间：
- 路由决策: 1s
- 专家执行: 8s
                Total: ~9s（最快！）
```

### 9.3 成本对比总结表

| 指标 | Supervisor-Worker | Peer-to-Peer | Pipeline | Dynamic Routing |
|------|------------------|--------------|----------|-----------------|
| **总成本** | $0.80 | $0.08 | $0.26 | $0.21 |
| **执行时间** | 17s | 22s | 16s | 9s |
| **成本/时间** | $0.047/s | $0.0036/s | $0.016/s | $0.023/s |
| **输出质量预期** | 高 | 中 | 中-高 | 高 |
| **质量/成本比** | 1.25 | 12.5 | 3.8 | 4.8 |
| **质量/时间比** | 0.059 | 0.045 | 0.063 | 0.111 |

**关键发现**：

1. **Peer-to-Peer 最便宜但最慢**：因为每一轮都需要多个 Agent 参与，而且往往需要 3+ 轮才能达成共识。但"质量/成本比"最高，说明如果你对成本很敏感且不急，它是很好的选择。

2. **Dynamic Routing 最快且成本中等**：因为路由决策非常轻量，整个执行集中在一个专家 Agent。最适合高频的、决策清晰的任务。

3. **Pipeline 成本最低但不是最快**：原因是阶段必须串行，但每个阶段都很轻量。适合流水线式的内容处理。

4. **Supervisor-Worker 最贵但质量最高**：需要 Supervisor 的多次调用（分解+合成），但能产出最高质量的结果。适合高价值任务。

**经济决策规则**：

- **日均调用 < 10 次**：选择 Supervisor-Worker（质量优先）
- **日均调用 10-100 次，对成本敏感**：选择 Dynamic Routing
- **日均调用 > 100 次，对质量要求中等**：选择 Pipeline
- **需要多视角碰撞、有充足时间**：选择 Peer-to-Peer

---

## 10. Peer-to-Peer 协议设计深化

Peer-to-Peer 模式看似简单（多个 Agent 互相对话），但要实现稳定的 P2P 协作，需要精心设计通信协议。本节深入探讨 P2P 的关键设计细节。

### 10.1 对话格式标准化

在 Peer-to-Peer 模式中，Agent 之间的消息必须遵循一个标准格式，否则 Agent 会互相"听不懂"。

```python
from dataclasses import dataclass, field
from typing import Literal
from enum import Enum
import json


class MessageType(str, Enum):
    """P2P 消息类型"""
    PROPOSE = "propose"           # 提出方案或观点
    COMMENT = "comment"           # 评论或反馈
    QUESTION = "question"         # 提出问题
    AGREE = "agree"               # 同意
    DISAGREE = "disagree"         # 不同意
    COMPROMISE = "compromise"     # 提出妥协方案
    REQUEST_INFO = "request_info" # 请求信息
    CONSENSUS = "consensus"       # 宣布达成共识


@dataclass
class P2PMessage:
    """P2P 协作中的标准消息格式"""
    msg_id: str                              # 消息唯一 ID
    sender: str                              # 发送者 Agent 名称
    receivers: list[str]                    # 接收者列表（可以是广播）
    msg_type: MessageType                   # 消息类型
    content: str                            # 消息主体
    reasoning: str = ""                     # 发送者的推理过程（为什么这么说）
    evidence: list[dict] = field(default_factory=list)  # 证据列表
    confidence: float = 0.8                 # 发送者对该观点的信心度 (0-1)
    references: list[str] = field(default_factory=list)  # 引用的之前消息的 ID
    timestamp: float = field(default_factory=lambda: __import__('time').time())
    round_number: int = 0                   # 第几轮对话

    def to_json(self) -> str:
        return json.dumps({
            "msg_id": self.msg_id,
            "sender": self.sender,
            "receivers": self.receivers,
            "msg_type": self.msg_type.value,
            "content": self.content,
            "reasoning": self.reasoning,
            "evidence": self.evidence,
            "confidence": self.confidence,
            "references": self.references,
            "timestamp": self.timestamp,
            "round_number": self.round_number,
        }, ensure_ascii=False)
```

### 10.2 轮次终止条件

P2P 协作最大的风险是陷入无限循环。需要明确的终止条件。具体实现见前面的 P2PTerminationChecker 类。

### 10.3 冲突解决机制

当两个 Agent 无法达成共识时，需要冲突解决机制。具体实现见前面的 ConflictResolver 类。

### 10.4 完整的 PeerToPeerProtocol 类

```python
import asyncio
import uuid
from typing import Callable, Optional


class PeerToPeerProtocol:
    """完整的 P2P 协作协议实现"""

    def __init__(
        self,
        agents: dict[str, "WorkerAgent"],
        max_rounds: int = 5,
        consensus_threshold: float = 0.8,
        resolution_strategy: str = "confidence_weighted",
    ):
        self.agents = agents
        self.max_rounds = max_rounds
        self.consensus_threshold = consensus_threshold
        self.resolution_strategy = resolution_strategy
        self.message_history: list[P2PMessage] = []
        self.agent_states: dict[str, dict] = {
            name: {
                "opinion": "",
                "agreement_confidence": 0.5,
                "last_message_time": 0,
            }
            for name in agents.keys()
        }

    async def run(self, topic: str, initial_content: str = "") -> dict:
        """运行 P2P 协作流程"""
        # 实现类似上面所述的协作循环
        # 包括多轮对话、终止条件检测、冲突解决
        return {
            "topic": topic,
            "message_count": len(self.message_history),
            "agent_states": self.agent_states,
        }
```

---

## 11. Single Agent vs Multi-Agent 的量化对比

很多团队在决定是否采用 Multi-Agent 架构时陷入困局。本节用具体数据对比两种方案。

### 11.1 对比任务：竞品分析报告

**任务定义**：撰写一份 5000 字的竞品分析报告，对比 OpenAI、Anthropic、Google 三家公司的 LLM 产品策略、成本模型、应用生态。报告需要包含：

- 产品对标（功能、性能、成本）
- 市场策略分析
- 生态建设对比
- 风险和机会评估
- 建议（对我们的产品有什么启示）

### 11.2 方案 A：Single Agent

**成本计算**：
- 单个 Agent 推理：22,500 tokens
- 成本：$0.529
- 执行时间：33s
- 输出质量：6.8/10

### 11.3 方案 B：Multi-Agent（Supervisor-Worker）

**成本计算**：
- 5 次 LLM 调用
- 41,500 tokens
- 成本：$1.339
- 执行时间：27s
- 输出质量：8.8/10

### 11.4 对比总结表

| 指标 | Single Agent | Multi-Agent | 差异 |
|------|-------------|-------------|------|
| **总成本** | $0.529 | $1.339 | +153% |
| **执行时间** | 33s | 27s | -18% |
| **LLM 调用次数** | 1 | 5 | +400% |
| **Token 消耗** | 22,500 | 41,500 | +84% |
| **质量评分** | 6.8/10 | 8.8/10 | +2 |
| **质量/成本** | 12.85 | 6.57 | -49% |
| **质量/时间** | 0.21 | 0.33 | +57% |

**关键发现**：

1. **成本方面**：Multi-Agent 约 2.5 倍的成本，但质量提升 30%
2. **时间方面**：Multi-Agent 反而因为并行度快 18%
3. **质量方面**：Multi-Agent 明显更好（8.8 vs 6.8）
4. **经济性**：对高价值任务（>$1000），多花 2.5x 成本是值得的

**决策建议**：

| 场景 | 推荐方案 |
|------|---------|
| 日常内部分析，成本敏感 | Single Agent |
| 高价值客户交付（>$1000） | Multi-Agent |
| 实时系统，对延迟敏感 | Multi-Agent |
| 任务简单，不需要深度分析 | Single Agent |

---

## 12. Worker 专业化的度量标准

不是所有任务都值得创建专门的 Worker Agent。本节提供量化的判断标准。

### 12.1 专业化的三个关键指标

**指标一：任务频率阈值**

日均调用 > 100 次时，专业化往往值得投资。

**指标二：准确率提升幅度**

如果专业化能将准确率从 75% 提升到 92%（17% 提升），即使频率不高，ROI 也会很高。

**指标三：成本效率比**

综合考虑开发成本、运行成本节省、质量提升三个因素。

### 12.2 SpecializationEvaluator 类

```python
class SpecializationEvaluator:
    """Worker 专业化评估器"""

    def __init__(
        self,
        frequency_weight: float = 0.4,
        accuracy_weight: float = 0.35,
        efficiency_weight: float = 0.25,
    ):
        self.frequency_weight = frequency_weight
        self.accuracy_weight = accuracy_weight
        self.efficiency_weight = efficiency_weight

    def evaluate(
        self,
        task_name: str,
        daily_call_volume: int,
        current_accuracy: float,
        specialized_accuracy_estimate: float,
        error_cost: float,
        specialization_cost_dollars: int = 2000,
    ) -> dict:
        """
        评估一个 Worker 是否应该专业化

        返回评估结果，包含：
        - frequency_score: 0-10
        - accuracy_score: 0-10
        - efficiency_score: 0-10
        - overall_score: 加权平均
        - recommendation: "强烈推荐" / "值得考虑" / "暂不必专业化"
        """
        # 三个评分维度
        freq_score = self._score_frequency(daily_call_volume)
        acc_score = self._score_accuracy(
            current_accuracy,
            specialized_accuracy_estimate,
            error_cost,
            daily_call_volume,
        )
        eff_score = self._score_efficiency(
            daily_call_volume,
            specialization_cost_dollars,
        )

        overall = (
            freq_score * self.frequency_weight
            + acc_score * self.accuracy_weight
            + eff_score * self.efficiency_weight
        )

        if overall >= 7.5:
            rec = "强烈推荐"
        elif overall >= 5.5:
            rec = "值得考虑"
        else:
            rec = "暂不必专业化"

        return {
            "task_name": task_name,
            "frequency_score": round(freq_score, 1),
            "accuracy_score": round(acc_score, 1),
            "efficiency_score": round(eff_score, 1),
            "overall_score": round(overall, 1),
            "recommendation": rec,
        }

    def _score_frequency(self, daily_call_volume: int) -> float:
        """频率评分（0-10）"""
        if daily_call_volume < 10:
            return 1
        elif daily_call_volume < 100:
            return 5
        elif daily_call_volume < 500:
            return 8
        else:
            return 10

    def _score_accuracy(
        self,
        current_accuracy: float,
        specialized_accuracy: float,
        error_cost: float,
        daily_call_volume: int,
    ) -> float:
        """准确率提升评分（0-10）"""
        accuracy_gain = specialized_accuracy - current_accuracy
        if accuracy_gain < 0.02:
            return 0
        elif accuracy_gain < 0.10:
            return accuracy_gain / 0.10 * 10
        else:
            return 10

    def _score_efficiency(
        self,
        daily_call_volume: int,
        specialization_cost_dollars: int,
    ) -> float:
        """成本效率评分（0-10）"""
        monthly_savings = daily_call_volume * 0.5 * 30 * 0.2  # 假设每日成本减少 20%
        breakeven_months = specialization_cost_dollars / monthly_savings
        
        if breakeven_months <= 1:
            return 10
        elif breakeven_months <= 6:
            return 7
        elif breakeven_months <= 12:
            return 4
        else:
            return 1
```

---

## 13. 设计 Multi-Agent 系统的决策清单

---

## 9. 多 Agent 协作的成本特征分析

Multi-Agent 系统看起来功能更强，但成本结构也更复杂。本节量化对比四种协作模式的成本特征，帮助你在实际项目中做出经济合理的架构选择。

### 9.1 四种模式的成本维度对比

| 维度 | Supervisor-Worker | Peer-to-Peer | Pipeline | Dynamic Routing |
|------|------------------|--------------|----------|-----------------|
| **每任务 LLM 调用次数** | 1(Sup) + N(Workers) | 2-5（取决于轮数） | N（等于阶段数） | 1(Router) + 1(Expert) |
| **平均 Token 消耗** | ~35,000 | ~28,000 | ~25,000 | ~18,000 |
| **通信开销** | 低（星形集中） | 高（全网通信） | 低（链式顺序） | 低（分发） |
| **端到端延迟** | 中（并行 Workers） | 高（多轮协商） | 高（串行阶段） | 低（单次路由） |
| **并行度潜力** | 高（Worker 可并行） | 中（轮次间串行） | 低（阶段必须顺序） | 高（请求级并行） |
| **失败重试成本** | 中（重试单个 Worker） | 高（重新协商） | 高（后续阶段受影响） | 低（重试 Expert） |

### 9.2 实例成本估算：撰写技术博客

假设任务为：**撰写一篇 3000 字的技术博客**，关于"LLM Agent 成本优化最佳实践"。我们分别用四种模式实现，并对比成本。

**基础假设**：
- GPT-4o: $15/MTok (Input), $60/MTok (Output)
- GPT-4o-mini: $0.15/MTok (Input), $0.6/MTok (Output)
- 平均每个 LLM 调用产生 1,500 token 输出
- 平均上下文注入 2,000 token

#### 模式一：Supervisor-Worker

```
执行步骤：
1. Supervisor 分解任务                          Tokens: ~3,000 (Input: 2K, Output: 1K)
   ├─ Worker A (搜索): 搜集最新的 LLM 成本数据  Tokens: ~8,000 (Input: 4K, Output: 4K)
   ├─ Worker B (分析): 分析成本优化策略         Tokens: ~8,000 (Input: 4K, Output: 4K)
   ├─ Worker C (写作): 撰写初稿                 Tokens: ~10,000 (Input: 5K, Output: 5K)
   └─ Supervisor 合成最终版本                  Tokens: ~6,000 (Input: 4K, Output: 2K)

总 Token: 35,000

模型使用：
- Supervisor: GPT-4o (2次调用，共 9,000 token)        → $0.27
- Worker A/B: GPT-4o-mini (2次调用，共 16,000 token)  → $0.048
- Worker C: GPT-4o (1次调用，共 10,000 token)         → $0.30
- Supervisor 合成: GPT-4o (1次调用，共 6,000 token)   → $0.18
                                                Total: $0.798 (~$0.80)

执行时间：
- Supervisor 分解: 4s
- Workers 并行执行: max(6s, 6s, 8s) = 8s
- Supervisor 合成: 5s
                    Total: ~17s
```

#### 模式二：Peer-to-Peer

```
执行步骤（假设 3 轮协商）：
Round 1:
  - Agent A (初稿作者): 撰写初稿                   ~5,000 token
  - Agent B (技术审稿): 提出专业意见              ~4,000 token
  - Agent C (编辑): 检查逻辑和结构                ~3,000 token

Round 2:
  - Agent A: 根据反馈修改                         ~5,000 token
  - Agent B: 检查修改后的技术准确性               ~3,000 token
  - Agent C: 优化措辞                            ~2,000 token

Round 3:
  - Agent A: 最终微调                            ~3,000 token
  - 共识检测: 所有 Agent 同意发布                ~2,000 token

总 Token: ~27,000

模型使用：
- 所有 Agent 用 GPT-4o-mini                      → $0.081
                                                Total: $0.08

执行时间：
- Round 1: A(4s) + B(3s) + C(2s) = 9s (串行)
- Round 2: A(4s) + B(3s) + C(2s) = 9s (串行)
- Round 3: A(2s) + 共识(2s) = 4s
                                 Total: ~22s
```

#### 模式三：Pipeline

```
执行步骤（5 个阶段）：
1. Draft Agent: 快速生成初稿                      ~5,000 token
2. Review Agent: 审查内容准确性和完整性            ~4,000 token
3. Edit Agent: 改进措辞和逻辑流                   ~4,000 token
4. FactCheck Agent: 验证数据和引用               ~3,000 token
5. Format Agent: 最终排版和调整                   ~2,000 token

总 Token: ~18,000

模型使用：
- Draft: GPT-4o-mini                            → $0.015
- Review: GPT-4o-mini                           → $0.012
- Edit: GPT-4o-mini                             → $0.012
- FactCheck: GPT-4o                             → $0.21
- Format: GPT-4o-mini                           → $0.006
                                                Total: $0.255

执行时间：
- 5 个阶段串行: 4s + 3s + 3s + 4s + 2s = 16s
```

#### 模式四：Dynamic Routing

```
执行步骤：
1. Router (意图识别): "这是一个技术博客写作任务"  ~1,500 token (GPT-4o-mini)
2. 路由到 Blog Writer Expert Agent               ~1,500 token
3. Blog Writer 调用子工具：
   - 搜索工具: 不计 token（工具调用）
   - 数据整理: ~3,000 token
   - 撰写完整博客: ~10,000 token

总 Token: ~16,000

模型使用：
- Router: GPT-4o-mini                           → $0.0045
- Expert: GPT-4o (1次，包含搜索和写作)         → $0.21
                                                Total: $0.214

执行时间：
- 路由决策: 1s
- 专家执行: 8s
                Total: ~9s（最快！）
```

### 9.3 成本对比总结表

| 指标 | Supervisor-Worker | Peer-to-Peer | Pipeline | Dynamic Routing |
|------|------------------|--------------|----------|-----------------|
| **总成本** | $0.80 | $0.08 | $0.26 | $0.21 |
| **执行时间** | 17s | 22s | 16s | 9s |
| **成本/时间** | $0.047/s | $0.0036/s | $0.016/s | $0.023/s |
| **输出质量预期** | 高 | 中 | 中-高 | 高 |
| **质量/成本比** | 1.25 | 12.5 | 3.8 | 4.8 |
| **质量/时间比** | 0.059 | 0.045 | 0.063 | 0.111 |

**关键发现**：

1. **Peer-to-Peer 最便宜但最慢**：因为每一轮都需要多个 Agent 参与，而且往往需要 3+ 轮才能达成共识。但"质量/成本比"最高，说明如果你对成本很敏感且不急，它是很好的选择。

2. **Dynamic Routing 最快且成本中等**：因为路由决策非常轻量，整个执行集中在一个专家 Agent。最适合高频的、决策清晰的任务。

3. **Pipeline 成本最低但不是最快**：原因是阶段必须串行，但每个阶段都很轻量。适合流水线式的内容处理。

4. **Supervisor-Worker 最贵但质量最高**：需要 Supervisor 的多次调用（分解+合成），但能产出最高质量的结果。适合高价值任务。

**经济决策规则**：

- **日均调用 < 10 次**：选择 Supervisor-Worker（质量优先）
- **日均调用 10-100 次，对成本敏感**：选择 Dynamic Routing
- **日均调用 > 100 次，对质量要求中等**：选择 Pipeline
- **需要多视角碰撞、有充足时间**：选择 Peer-to-Peer

---

## 10. Peer-to-Peer 协议设计深化

Peer-to-Peer 模式看似简单（多个 Agent 互相对话），但要实现稳定的 P2P 协作，需要精心设计通信协议。本节深入探讨 P2P 的关键设计细节。

### 10.1 对话格式标准化

在 Peer-to-Peer 模式中，Agent 之间的消息必须遵循一个标准格式，否则 Agent 会互相"听不懂"。

```python
from dataclasses import dataclass, field
from typing import Literal
from enum import Enum
import json


class MessageType(str, Enum):
    """P2P 消息类型"""
    PROPOSE = "propose"           # 提出方案或观点
    COMMENT = "comment"           # 评论或反馈
    QUESTION = "question"         # 提出问题
    AGREE = "agree"               # 同意
    DISAGREE = "disagree"         # 不同意
    COMPROMISE = "compromise"     # 提出妥协方案
    REQUEST_INFO = "request_info" # 请求信息
    CONSENSUS = "consensus"       # 宣布达成共识


@dataclass
class P2PMessage:
    """P2P 协作中的标准消息格式"""
    msg_id: str                              # 消息唯一 ID
    sender: str                              # 发送者 Agent 名称
    receivers: list[str]                    # 接收者列表（可以是广播）
    msg_type: MessageType                   # 消息类型
    content: str                            # 消息主体
    reasoning: str = ""                     # 发送者的推理过程（为什么这么说）
    evidence: list[dict] = field(default_factory=list)  # 证据列表
    confidence: float = 0.8                 # 发送者对该观点的信心度 (0-1)
    references: list[str] = field(default_factory=list)  # 引用的之前消息的 ID
    timestamp: float = field(default_factory=lambda: __import__('time').time())
    round_number: int = 0                   # 第几轮对话

    def to_json(self) -> str:
        return json.dumps({
            "msg_id": self.msg_id,
            "sender": self.sender,
            "receivers": self.receivers,
            "msg_type": self.msg_type.value,
            "content": self.content,
            "reasoning": self.reasoning,
            "evidence": self.evidence,
            "confidence": self.confidence,
            "references": self.references,
            "timestamp": self.timestamp,
            "round_number": self.round_number,
        }, ensure_ascii=False)
```

### 10.2 轮次终止条件

P2P 协作最大的风险是陷入无限循环。需要明确的终止条件。具体实现见前面的 P2PTerminationChecker 类。

### 10.3 冲突解决机制

当两个 Agent 无法达成共识时，需要冲突解决机制。具体实现见前面的 ConflictResolver 类。

### 10.4 完整的 PeerToPeerProtocol 类

```python
import asyncio
import uuid
from typing import Callable, Optional


class PeerToPeerProtocol:
    """完整的 P2P 协作协议实现"""

    def __init__(
        self,
        agents: dict[str, "WorkerAgent"],
        max_rounds: int = 5,
        consensus_threshold: float = 0.8,
        resolution_strategy: str = "confidence_weighted",
    ):
        self.agents = agents
        self.max_rounds = max_rounds
        self.consensus_threshold = consensus_threshold
        self.resolution_strategy = resolution_strategy
        self.message_history: list[P2PMessage] = []
        self.agent_states: dict[str, dict] = {
            name: {
                "opinion": "",
                "agreement_confidence": 0.5,
                "last_message_time": 0,
            }
            for name in agents.keys()
        }

    async def run(self, topic: str, initial_content: str = "") -> dict:
        """运行 P2P 协作流程"""
        # 实现类似上面所述的协作循环
        # 包括多轮对话、终止条件检测、冲突解决
        return {
            "topic": topic,
            "message_count": len(self.message_history),
            "agent_states": self.agent_states,
        }
```

---

## 11. Single Agent vs Multi-Agent 的量化对比

很多团队在决定是否采用 Multi-Agent 架构时陷入困局。本节用具体数据对比两种方案。

### 11.1 对比任务：竞品分析报告

**任务定义**：撰写一份 5000 字的竞品分析报告，对比 OpenAI、Anthropic、Google 三家公司的 LLM 产品策略、成本模型、应用生态。报告需要包含：

- 产品对标（功能、性能、成本）
- 市场策略分析
- 生态建设对比
- 风险和机会评估
- 建议（对我们的产品有什么启示）

### 11.2 方案 A：Single Agent

**成本计算**：
- 单个 Agent 推理：22,500 tokens
- 成本：$0.529
- 执行时间：33s
- 输出质量：6.8/10

### 11.3 方案 B：Multi-Agent（Supervisor-Worker）

**成本计算**：
- 5 次 LLM 调用
- 41,500 tokens
- 成本：$1.339
- 执行时间：27s
- 输出质量：8.8/10

### 11.4 对比总结表

| 指标 | Single Agent | Multi-Agent | 差异 |
|------|-------------|-------------|------|
| **总成本** | $0.529 | $1.339 | +153% |
| **执行时间** | 33s | 27s | -18% |
| **LLM 调用次数** | 1 | 5 | +400% |
| **Token 消耗** | 22,500 | 41,500 | +84% |
| **质量评分** | 6.8/10 | 8.8/10 | +2 |
| **质量/成本** | 12.85 | 6.57 | -49% |
| **质量/时间** | 0.21 | 0.33 | +57% |

**关键发现**：

1. **成本方面**：Multi-Agent 约 2.5 倍的成本，但质量提升 30%
2. **时间方面**：Multi-Agent 反而因为并行度快 18%
3. **质量方面**：Multi-Agent 明显更好（8.8 vs 6.8）
4. **经济性**：对高价值任务（>$1000），多花 2.5x 成本是值得的

**决策建议**：

| 场景 | 推荐方案 |
|------|---------|
| 日常内部分析，成本敏感 | Single Agent |
| 高价值客户交付（>$1000） | Multi-Agent |
| 实时系统，对延迟敏感 | Multi-Agent |
| 任务简单，不需要深度分析 | Single Agent |

---

## 12. Worker 专业化的度量标准

不是所有任务都值得创建专门的 Worker Agent。本节提供量化的判断标准。

### 12.1 专业化的三个关键指标

**指标一：任务频率阈值**

日均调用 > 100 次时，专业化往往值得投资。

**指标二：准确率提升幅度**

如果专业化能将准确率从 75% 提升到 92%（17% 提升），即使频率不高，ROI 也会很高。

**指标三：成本效率比**

综合考虑开发成本、运行成本节省、质量提升三个因素。

### 12.2 SpecializationEvaluator 类

```python
class SpecializationEvaluator:
    """Worker 专业化评估器"""

    def __init__(
        self,
        frequency_weight: float = 0.4,
        accuracy_weight: float = 0.35,
        efficiency_weight: float = 0.25,
    ):
        self.frequency_weight = frequency_weight
        self.accuracy_weight = accuracy_weight
        self.efficiency_weight = efficiency_weight

    def evaluate(
        self,
        task_name: str,
        daily_call_volume: int,
        current_accuracy: float,
        specialized_accuracy_estimate: float,
        error_cost: float,
        specialization_cost_dollars: int = 2000,
    ) -> dict:
        """
        评估一个 Worker 是否应该专业化

        返回评估结果，包含：
        - frequency_score: 0-10
        - accuracy_score: 0-10
        - efficiency_score: 0-10
        - overall_score: 加权平均
        - recommendation: "强烈推荐" / "值得考虑" / "暂不必专业化"
        """
        # 三个评分维度
        freq_score = self._score_frequency(daily_call_volume)
        acc_score = self._score_accuracy(
            current_accuracy,
            specialized_accuracy_estimate,
            error_cost,
            daily_call_volume,
        )
        eff_score = self._score_efficiency(
            daily_call_volume,
            specialization_cost_dollars,
        )

        overall = (
            freq_score * self.frequency_weight
            + acc_score * self.accuracy_weight
            + eff_score * self.efficiency_weight
        )

        if overall >= 7.5:
            rec = "强烈推荐"
        elif overall >= 5.5:
            rec = "值得考虑"
        else:
            rec = "暂不必专业化"

        return {
            "task_name": task_name,
            "frequency_score": round(freq_score, 1),
            "accuracy_score": round(acc_score, 1),
            "efficiency_score": round(eff_score, 1),
            "overall_score": round(overall, 1),
            "recommendation": rec,
        }

    def _score_frequency(self, daily_call_volume: int) -> float:
        """频率评分（0-10）"""
        if daily_call_volume < 10:
            return 1
        elif daily_call_volume < 100:
            return 5
        elif daily_call_volume < 500:
            return 8
        else:
            return 10

    def _score_accuracy(
        self,
        current_accuracy: float,
        specialized_accuracy: float,
        error_cost: float,
        daily_call_volume: int,
    ) -> float:
        """准确率提升评分（0-10）"""
        accuracy_gain = specialized_accuracy - current_accuracy
        if accuracy_gain < 0.02:
            return 0
        elif accuracy_gain < 0.10:
            return accuracy_gain / 0.10 * 10
        else:
            return 10

    def _score_efficiency(
        self,
        daily_call_volume: int,
        specialization_cost_dollars: int,
    ) -> float:
        """成本效率评分（0-10）"""
        monthly_savings = daily_call_volume * 0.5 * 30 * 0.2  # 假设每日成本减少 20%
        breakeven_months = specialization_cost_dollars / monthly_savings
        
        if breakeven_months <= 1:
            return 10
        elif breakeven_months <= 6:
            return 7
        elif breakeven_months <= 12:
            return 4
        else:
            return 1
```

---

## 13. 设计 Multi-Agent 系统的决策清单


## 9. 多 Agent 协作的成本特征分析

Multi-Agent 系统看起来功能更强，但成本结构也更复杂。本节量化对比四种协作模式的成本特征，帮助你在实际项目中做出经济合理的架构选择。

### 9.1 四种模式的成本维度对比

| 维度 | Supervisor-Worker | Peer-to-Peer | Pipeline | Dynamic Routing |
|------|------------------|--------------|----------|-----------------|
| **每任务 LLM 调用次数** | 1(Sup) + N(Workers) | 2-5（取决于轮数） | N（等于阶段数） | 1(Router) + 1(Expert) |
| **平均 Token 消耗** | ~35,000 | ~28,000 | ~25,000 | ~18,000 |
| **通信开销** | 低（星形集中） | 高（全网通信） | 低（链式顺序） | 低（分发） |
| **端到端延迟** | 中（并行 Workers） | 高（多轮协商） | 高（串行阶段） | 低（单次路由） |
| **并行度潜力** | 高（Worker 可并行） | 中（轮次间串行） | 低（阶段必须顺序） | 高（请求级并行） |
| **失败重试成本** | 中（重试单个 Worker） | 高（重新协商） | 高（后续阶段受影响） | 低（重试 Expert） |

### 9.2 实例成本估算：撰写技术博客

假设任务为：**撰写一篇 3000 字的技术博客**，关于"LLM Agent 成本优化最佳实践"。我们分别用四种模式实现，并对比成本。

**基础假设**：
- GPT-4o: $15/MTok (Input), $60/MTok (Output)
- GPT-4o-mini: $0.15/MTok (Input), $0.6/MTok (Output)
- 平均每个 LLM 调用产生 1,500 token 输出
- 平均上下文注入 2,000 token

#### 模式一：Supervisor-Worker

```
执行步骤：
1. Supervisor 分解任务                          Tokens: ~3,000 (Input: 2K, Output: 1K)
   ├─ Worker A (搜索): 搜集最新的 LLM 成本数据  Tokens: ~8,000 (Input: 4K, Output: 4K)
   ├─ Worker B (分析): 分析成本优化策略         Tokens: ~8,000 (Input: 4K, Output: 4K)
   ├─ Worker C (写作): 撰写初稿                 Tokens: ~10,000 (Input: 5K, Output: 5K)
   └─ Supervisor 合成最终版本                  Tokens: ~6,000 (Input: 4K, Output: 2K)

总 Token: 35,000

模型使用：
- Supervisor: GPT-4o (2次调用，共 9,000 token)        → $0.27
- Worker A/B: GPT-4o-mini (2次调用，共 16,000 token)  → $0.048
- Worker C: GPT-4o (1次调用，共 10,000 token)         → $0.30
- Supervisor 合成: GPT-4o (1次调用，共 6,000 token)   → $0.18
                                                Total: $0.798 (~$0.80)

执行时间：
- Supervisor 分解: 4s
- Workers 并行执行: max(6s, 6s, 8s) = 8s
- Supervisor 合成: 5s
                    Total: ~17s
```

#### 模式二：Peer-to-Peer

```
执行步骤（假设 3 轮协商）：
Round 1:
  - Agent A (初稿作者): 撰写初稿                   ~5,000 token
  - Agent B (技术审稿): 提出专业意见              ~4,000 token
  - Agent C (编辑): 检查逻辑和结构                ~3,000 token

Round 2:
  - Agent A: 根据反馈修改                         ~5,000 token
  - Agent B: 检查修改后的技术准确性               ~3,000 token
  - Agent C: 优化措辞                            ~2,000 token

Round 3:
  - Agent A: 最终微调                            ~3,000 token
  - 共识检测: 所有 Agent 同意发布                ~2,000 token

总 Token: ~27,000

模型使用：
- 所有 Agent 用 GPT-4o-mini                      → $0.081
                                                Total: $0.08

执行时间：
- Round 1: A(4s) + B(3s) + C(2s) = 9s (串行)
- Round 2: A(4s) + B(3s) + C(2s) = 9s (串行)
- Round 3: A(2s) + 共识(2s) = 4s
                                 Total: ~22s
```

#### 模式三：Pipeline

```
执行步骤（5 个阶段）：
1. Draft Agent: 快速生成初稿                      ~5,000 token
2. Review Agent: 审查内容准确性和完整性            ~4,000 token
3. Edit Agent: 改进措辞和逻辑流                   ~4,000 token
4. FactCheck Agent: 验证数据和引用               ~3,000 token
5. Format Agent: 最终排版和调整                   ~2,000 token

总 Token: ~18,000

模型使用：
- Draft: GPT-4o-mini                            → $0.015
- Review: GPT-4o-mini                           → $0.012
- Edit: GPT-4o-mini                             → $0.012
- FactCheck: GPT-4o                             → $0.21
- Format: GPT-4o-mini                           → $0.006
                                                Total: $0.255

执行时间：
- 5 个阶段串行: 4s + 3s + 3s + 4s + 2s = 16s
```

#### 模式四：Dynamic Routing

```
执行步骤：
1. Router (意图识别): "这是一个技术博客写作任务"  ~1,500 token (GPT-4o-mini)
2. 路由到 Blog Writer Expert Agent               ~1,500 token
3. Blog Writer 调用子工具：
   - 搜索工具: 不计 token（工具调用）
   - 数据整理: ~3,000 token
   - 撰写完整博客: ~10,000 token

总 Token: ~16,000

模型使用：
- Router: GPT-4o-mini                           → $0.0045
- Expert: GPT-4o (1次，包含搜索和写作)         → $0.21
                                                Total: $0.214

执行时间：
- 路由决策: 1s
- 专家执行: 8s
                Total: ~9s（最快！）
```

### 9.3 成本对比总结表

| 指标 | Supervisor-Worker | Peer-to-Peer | Pipeline | Dynamic Routing |
|------|------------------|--------------|----------|-----------------|
| **总成本** | $0.80 | $0.08 | $0.26 | $0.21 |
| **执行时间** | 17s | 22s | 16s | 9s |
| **成本/时间** | $0.047/s | $0.0036/s | $0.016/s | $0.023/s |
| **输出质量预期** | 高 | 中 | 中-高 | 高 |
| **质量/成本比** | 1.25 | 12.5 | 3.8 | 4.8 |
| **质量/时间比** | 0.059 | 0.045 | 0.063 | 0.111 |

**关键发现**：

1. **Peer-to-Peer 最便宜但最慢**：因为每一轮都需要多个 Agent 参与，而且往往需要 3+ 轮才能达成共识。但"质量/成本比"最高，说明如果你对成本很敏感且不急，它是很好的选择。

2. **Dynamic Routing 最快且成本中等**：因为路由决策非常轻量，整个执行集中在一个专家 Agent。最适合高频的、决策清晰的任务。

3. **Pipeline 成本最低但不是最快**：原因是阶段必须串行，但每个阶段都很轻量。适合流水线式的内容处理。

4. **Supervisor-Worker 最贵但质量最高**：需要 Supervisor 的多次调用（分解+合成），但能产出最高质量的结果。适合高价值任务。

**经济决策规则**：

- **日均调用 < 10 次**：选择 Supervisor-Worker（质量优先）
- **日均调用 10-100 次，对成本敏感**：选择 Dynamic Routing
- **日均调用 > 100 次，对质量要求中等**：选择 Pipeline
- **需要多视角碰撞、有充足时间**：选择 Peer-to-Peer

---

## 10. Peer-to-Peer 协议设计深化

Peer-to-Peer 模式看似简单（多个 Agent 互相对话），但要实现稳定的 P2P 协作，需要精心设计通信协议。本节深入探讨 P2P 的关键设计细节。

### 10.1 对话格式标准化

在 Peer-to-Peer 模式中，Agent 之间的消息必须遵循一个标准格式，否则 Agent 会互相"听不懂"。

```python
from dataclasses import dataclass, field
from typing import Literal
from enum import Enum
import json


class MessageType(str, Enum):
    """P2P 消息类型"""
    PROPOSE = "propose"           # 提出方案或观点
    COMMENT = "comment"           # 评论或反馈
    QUESTION = "question"         # 提出问题
    AGREE = "agree"               # 同意
    DISAGREE = "disagree"         # 不同意
    COMPROMISE = "compromise"     # 提出妥协方案
    REQUEST_INFO = "request_info" # 请求信息
    CONSENSUS = "consensus"       # 宣布达成共识


@dataclass
class P2PMessage:
    """P2P 协作中的标准消息格式"""
    msg_id: str                              # 消息唯一 ID
    sender: str                              # 发送者 Agent 名称
    receivers: list[str]                    # 接收者列表（可以是广播）
    msg_type: MessageType                   # 消息类型
    content: str                            # 消息主体
    reasoning: str = ""                     # 发送者的推理过程（为什么这么说）
    evidence: list[dict] = field(default_factory=list)  # 证据列表
    confidence: float = 0.8                 # 发送者对该观点的信心度 (0-1)
    references: list[str] = field(default_factory=list)  # 引用的之前消息的 ID
    timestamp: float = field(default_factory=lambda: __import__('time').time())
    round_number: int = 0                   # 第几轮对话

    def to_json(self) -> str:
        return json.dumps({
            "msg_id": self.msg_id,
            "sender": self.sender,
            "receivers": self.receivers,
            "msg_type": self.msg_type.value,
            "content": self.content,
            "reasoning": self.reasoning,
            "evidence": self.evidence,
            "confidence": self.confidence,
            "references": self.references,
            "timestamp": self.timestamp,
            "round_number": self.round_number,
        }, ensure_ascii=False)
```

### 10.2 轮次终止条件

P2P 协作最大的风险是陷入无限循环。需要明确的终止条件。具体实现见前面的 P2PTerminationChecker 类。

### 10.3 冲突解决机制

当两个 Agent 无法达成共识时，需要冲突解决机制。具体实现见前面的 ConflictResolver 类。

### 10.4 完整的 PeerToPeerProtocol 类

```python
import asyncio
import uuid
from typing import Callable, Optional


class PeerToPeerProtocol:
    """完整的 P2P 协作协议实现"""

    def __init__(
        self,
        agents: dict[str, "WorkerAgent"],
        max_rounds: int = 5,
        consensus_threshold: float = 0.8,
        resolution_strategy: str = "confidence_weighted",
    ):
        self.agents = agents
        self.max_rounds = max_rounds
        self.consensus_threshold = consensus_threshold
        self.resolution_strategy = resolution_strategy
        self.message_history: list[P2PMessage] = []
        self.agent_states: dict[str, dict] = {
            name: {
                "opinion": "",
                "agreement_confidence": 0.5,
                "last_message_time": 0,
            }
            for name in agents.keys()
        }

    async def run(self, topic: str, initial_content: str = "") -> dict:
        """运行 P2P 协作流程"""
        # 实现类似上面所述的协作循环
        # 包括多轮对话、终止条件检测、冲突解决
        return {
            "topic": topic,
            "message_count": len(self.message_history),
            "agent_states": self.agent_states,
        }
```

---

## 11. Single Agent vs Multi-Agent 的量化对比

很多团队在决定是否采用 Multi-Agent 架构时陷入困局。本节用具体数据对比两种方案。

### 11.1 对比任务：竞品分析报告

**任务定义**：撰写一份 5000 字的竞品分析报告，对比 OpenAI、Anthropic、Google 三家公司的 LLM 产品策略、成本模型、应用生态。报告需要包含：

- 产品对标（功能、性能、成本）
- 市场策略分析
- 生态建设对比
- 风险和机会评估
- 建议（对我们的产品有什么启示）

### 11.2 方案 A：Single Agent

**成本计算**：
- 单个 Agent 推理：22,500 tokens
- 成本：$0.529
- 执行时间：33s
- 输出质量：6.8/10

### 11.3 方案 B：Multi-Agent（Supervisor-Worker）

**成本计算**：
- 5 次 LLM 调用
- 41,500 tokens
- 成本：$1.339
- 执行时间：27s
- 输出质量：8.8/10

### 11.4 对比总结表

| 指标 | Single Agent | Multi-Agent | 差异 |
|------|-------------|-------------|------|
| **总成本** | $0.529 | $1.339 | +153% |
| **执行时间** | 33s | 27s | -18% |
| **LLM 调用次数** | 1 | 5 | +400% |
| **Token 消耗** | 22,500 | 41,500 | +84% |
| **质量评分** | 6.8/10 | 8.8/10 | +2 |
| **质量/成本** | 12.85 | 6.57 | -49% |
| **质量/时间** | 0.21 | 0.33 | +57% |

**关键发现**：

1. **成本方面**：Multi-Agent 约 2.5 倍的成本，但质量提升 30%
2. **时间方面**：Multi-Agent 反而因为并行度快 18%
3. **质量方面**：Multi-Agent 明显更好（8.8 vs 6.8）
4. **经济性**：对高价值任务（>$1000），多花 2.5x 成本是值得的

**决策建议**：

| 场景 | 推荐方案 |
|------|---------|
| 日常内部分析，成本敏感 | Single Agent |
| 高价值客户交付（>$1000） | Multi-Agent |
| 实时系统，对延迟敏感 | Multi-Agent |
| 任务简单，不需要深度分析 | Single Agent |

---

## 12. Worker 专业化的度量标准

不是所有任务都值得创建专门的 Worker Agent。本节提供量化的判断标准。

### 12.1 专业化的三个关键指标

**指标一：任务频率阈值**

日均调用 > 100 次时，专业化往往值得投资。

**指标二：准确率提升幅度**

如果专业化能将准确率从 75% 提升到 92%（17% 提升），即使频率不高，ROI 也会很高。

**指标三：成本效率比**

综合考虑开发成本、运行成本节省、质量提升三个因素。

### 12.2 SpecializationEvaluator 类

```python
class SpecializationEvaluator:
    """Worker 专业化评估器"""

    def __init__(
        self,
        frequency_weight: float = 0.4,
        accuracy_weight: float = 0.35,
        efficiency_weight: float = 0.25,
    ):
        self.frequency_weight = frequency_weight
        self.accuracy_weight = accuracy_weight
        self.efficiency_weight = efficiency_weight

    def evaluate(
        self,
        task_name: str,
        daily_call_volume: int,
        current_accuracy: float,
        specialized_accuracy_estimate: float,
        error_cost: float,
        specialization_cost_dollars: int = 2000,
    ) -> dict:
        """
        评估一个 Worker 是否应该专业化

        返回评估结果，包含：
        - frequency_score: 0-10
        - accuracy_score: 0-10
        - efficiency_score: 0-10
        - overall_score: 加权平均
        - recommendation: "强烈推荐" / "值得考虑" / "暂不必专业化"
        """
        # 三个评分维度
        freq_score = self._score_frequency(daily_call_volume)
        acc_score = self._score_accuracy(
            current_accuracy,
            specialized_accuracy_estimate,
            error_cost,
            daily_call_volume,
        )
        eff_score = self._score_efficiency(
            daily_call_volume,
            specialization_cost_dollars,
        )

        overall = (
            freq_score * self.frequency_weight
            + acc_score * self.accuracy_weight
            + eff_score * self.efficiency_weight
        )

        if overall >= 7.5:
            rec = "强烈推荐"
        elif overall >= 5.5:
            rec = "值得考虑"
        else:
            rec = "暂不必专业化"

        return {
            "task_name": task_name,
            "frequency_score": round(freq_score, 1),
            "accuracy_score": round(acc_score, 1),
            "efficiency_score": round(eff_score, 1),
            "overall_score": round(overall, 1),
            "recommendation": rec,
        }

    def _score_frequency(self, daily_call_volume: int) -> float:
        """频率评分（0-10）"""
        if daily_call_volume < 10:
            return 1
        elif daily_call_volume < 100:
            return 5
        elif daily_call_volume < 500:
            return 8
        else:
            return 10

    def _score_accuracy(
        self,
        current_accuracy: float,
        specialized_accuracy: float,
        error_cost: float,
        daily_call_volume: int,
    ) -> float:
        """准确率提升评分（0-10）"""
        accuracy_gain = specialized_accuracy - current_accuracy
        if accuracy_gain < 0.02:
            return 0
        elif accuracy_gain < 0.10:
            return accuracy_gain / 0.10 * 10
        else:
            return 10

    def _score_efficiency(
        self,
        daily_call_volume: int,
        specialization_cost_dollars: int,
    ) -> float:
        """成本效率评分（0-10）"""
        monthly_savings = daily_call_volume * 0.5 * 30 * 0.2  # 假设每日成本减少 20%
        breakeven_months = specialization_cost_dollars / monthly_savings
        
        if breakeven_months <= 1:
            return 10
        elif breakeven_months <= 6:
            return 7
        elif breakeven_months <= 12:
            return 4
        else:
            return 1
```

---

## 13. 设计 Multi-Agent 系统的决策清单


| 场景 | 推荐模式 | 原因 |
|------|---------|------|
| 简单工具调用（查天气、算术） | **ReAct** | 1-2 步完成，规划是过度设计 |
| 多步研究（竞品分析、技术调研） | **Plan-and-Execute** | 需要全局视野和步骤追踪 |
| 创意/数学/代码 | **Tree-of-Thought** | 需探索多条路径并选最优 |
| 复杂项目（系统设计） | **Hierarchical** | 粒度跨度大，需递归分解 |
| 高可靠（金融/法律） | **Plan-and-Execute + Reflection** | 全局规划 + 结果验证 |
| 实时交互（客服/对话） | **ReAct** | 延迟敏感，逐步响应 |
| 长时任务（数据管道） | **Hierarchical + Plan-Exec** | 可中断、可恢复、可并行 |

**二维决策矩阵：**

```
                  任务步骤少            任务步骤多
             ┌──────────────────┬──────────────────┐
 确定性高    │  ReAct            │  Plan-and-Exec   │
 (路径清晰)  │ (甚至不需要Agent)  │                  │
             ├──────────────────┼──────────────────┤
 确定性低    │  Tree-of-Thought  │  Hierarchical    │
 (需要探索)  │                   │  + Reflection    │
             └──────────────────┴──────────────────┘
```

**模式组合**在生产中很常见：Hierarchical + Plan-and-Execute（高层分解子目标，内部用 Plan-Exec 执行）；ReAct + Reflection（逐步执行，每 N 步检查方向）。关键原则：**从 ReAct 开始，只有当它的局限性确实成为瓶颈时再升级。**

---

## 10. 结语：规划的边界与 Multi-Agent 的必要性

规划和反思让单个 Agent 从"走一步看一步"进化到"先想后做再检查"。但单 Agent 的规划能力终有上限：

- **上下文窗口限制**：任务涉及的知识和状态超出 context window 时，单 Agent 力不从心
- **专业性限制**：一个 Agent 很难同时擅长编码、写作和数据分析——就像一个人很难同时是程序员、设计师和产品经理
- **执行效率限制**：单 Agent 串行执行，即使计划中的步骤可以并行

当这些限制成为瓶颈，你需要的不是更好的规划算法，而是**多个 Agent 的协作**——每个 Agent 专注于擅长领域，由 Orchestrator 协调。这正是下一篇的主题：**Multi-Agent Collaboration: 多 Agent 协作模式与架构。**

---

> **进一步思考：**
>
> 1. 规划质量高度依赖 LLM 对任务域的理解。如果 LLM 从未见过某类任务，能否通过 few-shot examples 注入领域知识来提升规划质量？
> 2. "LLM 评估 LLM" 的反思机制在多大程度上可靠？是否能引入外部验证信号（代码测试、人类反馈）来补强？
> 3. Tree-of-Thought 的搜索空间是指数级的。能否借鉴 AlphaGo 的 MCTS 来更高效搜索？Reasoning model（如 o1、o3）是否已在内部做了类似的事情？
> 4. 规划和反思的 token 成本显著。能否缓存和复用已有的计划，为相似任务跳过规划阶段？

---

> **系列导航**：本文是 Agentic 系列的第 10 篇。
>
> - 上一篇：[09 | RAG as Cognitive Memory](/blog/engineering/agentic/09-RAG%20as%20Cognitive%20Memory)
> - 下一篇：[11 | Multi-Agent Collaboration](/blog/engineering/agentic/11-Multi-Agent%20Collaboration)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
