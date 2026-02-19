---
title: "Planning and Reflection: 从 ReAct 到分层规划与自我纠错"
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
  否 → 多轮直到质量达标
```

---

## 9. 规划模式选型指南

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
