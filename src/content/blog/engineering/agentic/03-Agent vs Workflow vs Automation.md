---
title: "Agent vs Workflow vs Automation: 选对抽象才是关键"
description: "不是所有问题都需要 Agent。本文系统比较 Rule-based Automation、Workflow/DAG、Agent 三种执行范式，从确定性、成本、可观测性等维度给出选型框架，帮助工程师在真实场景中选对抽象层次。"
pubDate: "2025-12-09"
tags: ["Agentic", "AI Engineering", "Architecture"]
---

# Agent vs Workflow vs Automation: 选对抽象才是关键

> 系列第 03 篇。上一篇我们讲了"LLM 本身不是 Agent"，这一篇要回答一个更实际的问题：**你的问题，真的需要 Agent 吗？**

---

## 1. 开篇：Agent 万能论的陷阱

2024 年以来，"Agent" 这个词已经被严重滥用。打开任何一篇技术文章，似乎所有系统都应该被重写为 Agent——客服要 Agent、ETL 要 Agent、运维要 Agent、审批要 Agent。

但现实是：**大部分生产系统中，80% 的任务用 if/else 和 DAG 就能解决，且解决得更好。**

Agent 不是银弹。它是一种特定的执行范式，适用于特定的问题空间。盲目使用 Agent 的代价是：更高的 Token 成本、更长的延迟、更难的调试、更差的可预测性。

这篇文章的目标很简单：帮你建立一个清晰的选型框架。面对一个具体问题，你应该能在 30 秒内判断——**用 Automation、用 Workflow、还是用 Agent。**

---

## 2. 三种执行范式

### 2.1 Rule-based Automation

**定义**：用预定义规则驱动的全自动执行。输入确定，规则确定，输出确定。

典型实现：if/else 逻辑、Rule Engine（Drools、Rete）、Cron Job、Event Trigger。

```
┌─────────────────────────────────────────────────────────┐
│                 Rule-based Automation                    │
│                                                         │
│   Input ──→ [Rule Match] ──→ Action A                   │
│                  │                                      │
│                  ├──→ Action B                           │
│                  │                                      │
│                  └──→ Action C                           │
│                                                         │
│   特征：路径在编写时完全确定，运行时无决策               │
│   类比：铁轨上的火车，轨道已铺好                         │
└─────────────────────────────────────────────────────────┘
```

**核心特征**：

- 零运行时决策——所有分支在代码 / 规则编写时就已确定
- 确定性：相同输入永远产生相同输出
- 延迟极低（微秒到毫秒级）
- 可解释性最强——每一步都可以追溯到具体规则

```python
# 典型的 Rule-based Automation
class AlertRule:
    def __init__(self, metric: str, threshold: float, action: str):
        self.metric = metric
        self.threshold = threshold
        self.action = action

class RuleEngine:
    def __init__(self):
        self.rules: list[AlertRule] = []

    def add_rule(self, rule: AlertRule):
        self.rules.append(rule)

    def evaluate(self, metrics: dict[str, float]) -> list[str]:
        """对每条指标做规则匹配，返回触发的动作列表"""
        actions = []
        for rule in self.rules:
            value = metrics.get(rule.metric)
            if value is not None and value > rule.threshold:
                actions.append(rule.action)
        return actions

# 使用
engine = RuleEngine()
engine.add_rule(AlertRule("cpu_usage", 90.0, "scale_up"))
engine.add_rule(AlertRule("error_rate", 5.0, "page_oncall"))
engine.add_rule(AlertRule("disk_usage", 85.0, "cleanup_logs"))

triggered = engine.evaluate({"cpu_usage": 95.0, "error_rate": 2.0})
# → ["scale_up"]   — 完全确定，完全可预测
```

### 2.2 Workflow / DAG

**定义**：预定义步骤的有序编排。步骤之间有依赖关系，可以有条件分支，但所有可能的路径在设计时已知。

典型实现：Airflow、Temporal、Prefect、Step Functions、BPMN Engine。

```
┌─────────────────────────────────────────────────────────┐
│                    Workflow / DAG                        │
│                                                         │
│   Start ──→ [Step A] ──→ [Step B] ──┬──→ [Step C]      │
│                                     │                   │
│                                     └──→ [Step D]      │
│                          │                    │         │
│                          └────────┬───────────┘         │
│                                   ▼                     │
│                              [Step E] ──→ End           │
│                                                         │
│   特征：路径在设计时确定，运行时按条件选择分支           │
│   类比：地铁线路图，站点和换乘规则预先设定               │
└─────────────────────────────────────────────────────────┘
```

**核心特征**：

- 步骤预定义，依赖关系显式声明
- 有条件分支，但分支的数量和逻辑在设计时确定
- 支持重试、超时、补偿（Compensation）
- 可视化程度高——DAG 本身就是文档

```python
# 典型的 Workflow / DAG 定义（伪代码，框架无关）
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

class StepStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass
class Step:
    name: str
    fn: Callable
    depends_on: list[str] = field(default_factory=list)
    condition: Callable | None = None  # 条件分支
    retry_count: int = 3
    timeout_seconds: int = 300

class DAGExecutor:
    def __init__(self):
        self.steps: dict[str, Step] = {}
        self.results: dict[str, Any] = {}
        self.status: dict[str, StepStatus] = {}

    def add_step(self, step: Step):
        self.steps[step.name] = step
        self.status[step.name] = StepStatus.PENDING

    def _can_run(self, step: Step) -> bool:
        """检查依赖是否全部完成"""
        for dep in step.depends_on:
            if self.status.get(dep) != StepStatus.SUCCESS:
                return False
        return True

    def _should_run(self, step: Step) -> bool:
        """检查条件分支"""
        if step.condition is None:
            return True
        return step.condition(self.results)

    def run(self, initial_context: dict):
        self.results.update(initial_context)
        # 简化的拓扑排序执行（生产实现应支持并行）
        remaining = set(self.steps.keys())
        while remaining:
            runnable = [
                name for name in remaining
                if self._can_run(self.steps[name])
            ]
            if not runnable:
                raise RuntimeError("DAG has unresolvable dependencies")
            for name in runnable:
                step = self.steps[name]
                remaining.remove(name)
                if not self._should_run(step):
                    self.status[name] = StepStatus.SKIPPED
                    continue
                self.status[name] = StepStatus.RUNNING
                try:
                    self.results[name] = step.fn(self.results)
                    self.status[name] = StepStatus.SUCCESS
                except Exception:
                    self.status[name] = StepStatus.FAILED
                    raise
```

### 2.3 Agent

**定义**：LLM 驱动的动态决策执行。每一步做什么，由 LLM 在运行时根据当前状态决定。路径不确定，在执行前无法预知。

典型实现：ReAct Loop、LangGraph Agent、AutoGPT、自研 Agent Runtime。

```
┌─────────────────────────────────────────────────────────┐
│                       Agent                             │
│                                                         │
│   Input ──→ [LLM: 观察+思考] ──→ [Tool A] ──┐          │
│                     ▲                        │          │
│                     │                        ▼          │
│                     │            [LLM: 观察+思考]       │
│                     │                  │     │          │
│                     │         ┌────────┘     │          │
│                     │         ▼              ▼          │
│                     ├──── [Tool C]      [Tool B]        │
│                     │         │              │          │
│                     │         ▼              ▼          │
│                     └── [LLM: 够了吗？] ──→ Output      │
│                                                         │
│   特征：路径在运行时动态生成，每一步由 LLM 决定         │
│   类比：出租车司机，根据实时路况随时调整路线             │
└─────────────────────────────────────────────────────────┘
```

**核心特征**：

- 运行时决策——下一步做什么由 LLM 在当前上下文中推理得出
- 非确定性：相同输入可能走不同路径（temperature > 0 时尤为明显）
- 能处理模糊、开放、未预见的输入
- 每一步决策都需要 LLM 推理，延迟和成本显著高于前两者

```python
# 典型的 Agent Loop（极简实现）
from typing import Any

class Tool:
    def __init__(self, name: str, description: str, fn: callable):
        self.name = name
        self.description = description
        self.fn = fn

class Agent:
    def __init__(self, llm_client, tools: list[Tool], max_steps: int = 10):
        self.llm = llm_client
        self.tools = {t.name: t for t in tools}
        self.max_steps = max_steps

    def run(self, user_input: str) -> str:
        messages = [{"role": "user", "content": user_input}]
        tool_descriptions = [
            {"name": t.name, "description": t.description}
            for t in self.tools.values()
        ]

        for step in range(self.max_steps):
            # LLM 决定下一步：调用工具，还是直接回答
            response = self.llm.chat(
                messages=messages,
                tools=tool_descriptions,
            )

            if response.is_final_answer:
                return response.content

            # LLM 选择了一个工具
            tool_name = response.tool_call.name
            tool_args = response.tool_call.arguments
            tool_result = self.tools[tool_name].fn(**tool_args)

            # 将工具结果加入上下文，进入下一轮循环
            messages.append({"role": "assistant", "content": response.raw})
            messages.append({"role": "tool", "content": str(tool_result)})

        return "达到最大步数限制，未能完成任务。"
```

注意上面代码的关键区别：**Automation 和 Workflow 的控制流是代码写死的，Agent 的控制流是 LLM 在运行时生成的。** 这是三者的本质差异。

---

## 3. 决策维度分析

### 3.1 对比总览

| 维度 | Rule-based Automation | Workflow / DAG | Agent |
|---|---|---|---|
| **确定性** | 完全确定 | 路径确定，结果依赖外部 | 不确定 |
| **可解释性** | 极强（规则可追溯） | 强（DAG 可视化） | 弱（LLM 是黑盒） |
| **延迟** | μs - ms | ms - min（取决于步骤） | s - min（LLM 推理） |
| **单次成本** | 几乎为零 | 低（计算资源） | 高（Token 费用） |
| **可靠性** | 极高 | 高（有重试/补偿） | 中等（LLM 可能幻觉） |
| **可观测性** | 高（日志即文档） | 高（DAG 天然可视化） | 低（需要额外 Trace） |
| **灵活性** | 低（新规则需改代码） | 中（新步骤需改 DAG） | 高（Prompt 即可调整） |
| **处理模糊输入** | 不支持 | 有限支持 | 原生支持 |
| **开发复杂度** | 低 | 中 | 高 |

### 3.2 逐维度展开

**确定性 vs 不确定性**

这是最重要的选型维度。问自己一个问题：**给定相同的输入，系统是否必须产生相同的输出？**

- 如果答案是"必须"——不要用 Agent。Rule-based Automation 或 Workflow 是正确选择。
- 如果答案是"不一定，但结果需要在合理范围内"——Agent 可以考虑，但要加 Guardrail。
- 如果答案是"每次可以不同，只要合理就行"——Agent 是自然选择。

金融交易、订单状态流转、计费逻辑——这些场景如果引入 Agent 的非确定性，后果不堪设想。

**可解释性**

生产系统出了问题，你需要回答"为什么系统做了这个决策"。

- Rule Engine：直接查看匹配了哪条规则，一目了然。
- Workflow：查看 DAG 执行日志，哪个步骤走了哪个分支，完全透明。
- Agent：LLM 的推理过程是一段自然语言（Chain of Thought），但它可能是事后合理化，并不一定反映真实的"推理过程"。

在合规要求高的领域（金融、医疗、法律），可解释性不是 nice-to-have，而是硬性要求。

**成本**

这一点经常被低估。以一个中等复杂度的任务为例：

```
Rule Engine:  ~0 成本（CPU 时间可忽略）
Workflow:     ~$0.001（计算资源 + 存储）
Agent:        ~$0.01 - $0.50（取决于步骤数和模型选择）
              3 步 Agent × GPT-4 级别 ≈ 每次 $0.03-0.10
              如果日调用量 100K，月成本 = $3,000 - $10,000
```

当你把 Agent 用在本该用 Rule Engine 解决的问题上，你是在用 100 倍的成本获得更差的可靠性。

**可靠性**

- Rule Engine：只要规则正确，就永远正确。故障模式是规则覆盖不全。
- Workflow：支持重试、幂等、补偿事务。成熟的 Workflow Engine 可以做到 99.99% 可靠。
- Agent：LLM 可能幻觉、可能选错工具、可能陷入循环。即使加了 Guardrail，端到端成功率通常在 85%-95%（复杂任务更低）。

**可观测性**

- Rule Engine：每次执行记录匹配规则和动作，日志本身就是完整的审计轨迹。
- Workflow：DAG 执行引擎天然提供步骤级别的状态、耗时、输入输出。Airflow 的 UI 就是最好的例子。
- Agent：你需要自己构建 Trace 系统——记录每一轮 LLM 的输入、输出、选择的工具、工具的返回值、Token 消耗。没有这些，Agent 在生产环境中就是一个黑盒。

---

## 4. 场景分析

抽象的对比不如具体场景有说服力。下面逐个分析。

### 4.1 数据 ETL Pipeline → Workflow

**场景**：每天从 3 个数据源抽取数据，清洗、转换、加载到数据仓库。

**选 Workflow 的理由**：

- 步骤完全确定：Extract → Transform → Load，不需要运行时决策
- 步骤间有明确的依赖关系：Transform 必须在 Extract 之后
- 需要精确的重试和失败补偿：某个数据源失败了，只重跑那个分支
- 需要调度：每天凌晨 3 点执行
- 需要回填（Backfill）：补跑历史数据

**为什么不用 Agent**：

ETL 不需要"思考下一步做什么"——步骤是固定的。用 Agent 意味着每次运行都要花 Token 让 LLM "重新发现"这些固定步骤，纯属浪费。更危险的是，LLM 可能在某次运行中"创造性地"跳过某个步骤或改变转换逻辑。

### 4.2 客服问答 → Agent

**场景**：用户通过聊天窗口提问，系统需要理解意图、查询知识库、可能需要查订单、可能需要转人工。

**选 Agent 的理由**：

- 输入是自然语言，意图不确定，无法枚举所有可能
- 处理路径取决于用户说了什么——可能一步就能回答，也可能需要查 3 个系统
- 需要上下文理解和多轮对话能力
- "足够好"的回答即可，不需要 100% 确定性

**为什么不用 Workflow**：

你无法预定义所有可能的对话路径。用户可能问"我的订单到哪了"，也可能问"你们支持退款吗"，也可能在同一轮对话中先问订单再问退款政策。Workflow 的路径是编译期确定的，处理不了这种运行时的动态性。

### 4.3 定时报表生成 → Automation

**场景**：每周一早上 9 点，从数据库查询上周的销售数据，生成 Excel 报表，发送到指定邮箱。

**选 Automation 的理由**：

- 触发条件确定：Cron 定时
- 逻辑确定：SQL 查询 → 格式化 → 发送
- 不需要编排复杂依赖
- 不需要任何"智能"——SQL 和模板都是写死的

**为什么不用 Workflow 或 Agent**：

Workflow 是大炮打蚊子——这里没有复杂的步骤依赖和分支。Agent 更是离谱——你不需要 LLM 来执行 `SELECT SUM(amount) FROM orders WHERE date >= '2025-07-28'`。

### 4.4 代码审查助手 → Agent

**场景**：PR 提交后，自动分析代码变更，给出审查意见：安全隐患、性能问题、风格建议。

**选 Agent 的理由**：

- 代码变更是非结构化的，无法穷举所有模式
- 需要"理解"代码语义，而非简单的模式匹配（静态分析工具已经覆盖了模式匹配的部分）
- 审查意见需要结合上下文（这个函数在项目中是怎么用的？改动会影响什么？）
- Agent 可以调用多种工具：读取文件、运行测试、查看 Git 历史

**为什么不用 Rule Engine**：

Rule Engine 只能匹配预定义模式（如"函数超过 100 行"），无法理解语义层面的问题（如"这个 API 调用没有处理超时"）。实际上，最好的方案是 **Rule Engine + Agent**——先用 Linter/SAST 做确定性检查，再用 Agent 做语义级审查。

### 4.5 订单状态流转 → Workflow

**场景**：电商订单从创建到完成的状态机——待支付 → 已支付 → 拣货中 → 已发货 → 已签收 → 已完成。

**选 Workflow 的理由**：

- 状态和转换规则完全确定：已支付才能拣货，已发货才能签收
- 每个状态转换都有明确的触发条件（支付回调、物流推送）
- 需要事务保证：状态转换必须原子性，不能出现"钱扣了但订单还是待支付"
- 需要补偿机制：支付超时需要自动取消
- 0 容忍非确定性——用户的钱不能有任何模糊

**为什么不用 Agent**：

这个问题需要反复强调：**涉及金钱和状态一致性的流程，绝对不能用 Agent。** LLM 的幻觉在这里不是"回答不太准确"，而是"用户的钱没了但订单没更新"。

### 4.6 智能运维（AIOps）→ 混合架构

**场景**：监控告警触发后，自动诊断根因并执行修复。

**为什么需要混合**：

这个场景天然分为确定性部分和不确定性部分——

- 确定性部分（Automation）：告警规则匹配、阈值判断、常见故障的自动修复（CPU 高 → 扩容，磁盘满 → 清理日志）
- 不确定性部分（Agent）：复杂故障的根因分析——Agent 可以查看日志、查询指标、检查最近的部署变更，综合判断根因
- 编排部分（Workflow）：整个处理流程的骨架——告警接收 → 去重 → 分级 → 自动修复 / 智能诊断 → 通知

```
告警触发
   │
   ▼
[Automation: 告警去重 + 分级]
   │
   ├──→ P4/P3 已知模式 ──→ [Automation: 自动修复]
   │                              │
   │                              ▼
   │                         [通知 Oncall]
   │
   └──→ P2/P1 或未知模式 ──→ [Agent: 根因分析]
                                   │
                                   ├──→ 找到根因 ──→ [Automation: 执行修复]
                                   │
                                   └──→ 无法确定 ──→ [升级到人工]
```

这才是 Agent 的正确用法——**只在真正需要"智能"的环节使用 Agent，其余部分用更可靠、更便宜的范式处理。**

---

## 5. 混合架构：三者如何共存

真实的生产系统很少只用一种范式。更常见的模式是：

```
┌──────────────────────────────────────────────────────────────┐
│                    混合架构全景                                │
│                                                              │
│  ┌──────────────────────────────────────────────────┐        │
│  │              Workflow / DAG（骨架层）              │        │
│  │                                                  │        │
│  │  Step 1          Step 2          Step 3          │        │
│  │  ┌──────────┐   ┌──────────┐   ┌──────────┐     │        │
│  │  │Automation│──→│  Agent   │──→│Automation│     │        │
│  │  │数据预处理│   │语义分析  │   │结果写入  │     │        │
│  │  └──────────┘   └──────────┘   └──────────┘     │        │
│  │       │              │              │            │        │
│  │       ▼              ▼              ▼            │        │
│  │  确定性操作     LLM 推理       确定性操作        │        │
│  │  延迟: 10ms    延迟: 2-5s     延迟: 50ms        │        │
│  │  成本: ~0      成本: $0.02    成本: ~0           │        │
│  └──────────────────────────────────────────────────┘        │
│                                                              │
│  设计原则：                                                  │
│  1. Workflow 负责编排和容错（重试、超时、补偿）              │
│  2. Automation 处理所有确定性步骤                            │
│  3. Agent 只出现在需要"理解"和"推理"的节点                  │
│  4. Agent 的输出经过验证后才进入下一步                       │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 设计原则

**原则一：Agent 是 Workflow 的节点，不是整个 Workflow**

一个常见的错误是让 Agent 控制整个流程——从数据获取到处理到存储全部由 Agent 决定。正确的做法是：Workflow 定义骨架（步骤顺序、依赖关系、容错策略），Agent 只负责其中需要推理的那一步。

```python
# 错误做法：让 Agent 控制整个流程
agent.run("从数据库读取用户评论，分析情感，把结果写回数据库")
# Agent 可能：用错 SQL、忘记写回、写入格式错误...

# 正确做法：Workflow 控制流程，Agent 只做推理
def step_1_extract(ctx):
    """确定性步骤：用固定 SQL 读取数据"""
    return db.query("SELECT id, comment FROM reviews WHERE date = %s", ctx["date"])

def step_2_analyze(ctx):
    """Agent 步骤：对每条评论做情感分析"""
    results = []
    for review in ctx["step_1_extract"]:
        sentiment = agent.run(
            f"分析以下评论的情感倾向(positive/negative/neutral):\n{review['comment']}"
        )
        results.append({"id": review["id"], "sentiment": sentiment})
    return results

def step_3_load(ctx):
    """确定性步骤：用固定逻辑写回数据库"""
    for item in ctx["step_2_analyze"]:
        db.execute(
            "UPDATE reviews SET sentiment = %s WHERE id = %s",
            (item["sentiment"], item["id"])
        )

# Workflow 定义
workflow.add_step(Step("extract", step_1_extract))
workflow.add_step(Step("analyze", step_2_analyze, depends_on=["extract"]))
workflow.add_step(Step("load", step_3_load, depends_on=["analyze"]))
```

**原则二：Agent 的输出必须经过验证**

Agent 的输出是非确定性的。在混合架构中，Agent 节点和下游确定性节点之间，必须有一个验证层。

```python
def step_2_analyze_with_validation(ctx):
    """Agent 步骤 + 输出验证"""
    VALID_SENTIMENTS = {"positive", "negative", "neutral"}
    results = []
    for review in ctx["step_1_extract"]:
        sentiment = agent.run(f"分析情感倾向: {review['comment']}")
        # 验证 Agent 输出
        sentiment = sentiment.strip().lower()
        if sentiment not in VALID_SENTIMENTS:
            sentiment = "neutral"  # fallback
            log.warning(f"Agent 返回了无效的情感值，已 fallback: review_id={review['id']}")
        results.append({"id": review["id"], "sentiment": sentiment})
    return results
```

**原则三：确定性部分永远优先用 Automation**

如果一个步骤的输入输出可以完全预定义，就不要用 Agent。这不是技术保守，而是工程理性——用最简单的工具解决问题，把复杂性预算留给真正需要的地方。

---

## 6. Agent 的隐性成本

这一节讲的是大部分"Agent 教程"不会告诉你的东西。

### 6.1 Token 成本

Agent 的每一步决策都需要调用 LLM。一个 5 步 Agent 执行一次任务的 Token 消耗：

```
第 1 步: System Prompt (500) + User Input (200) + Response (300)    = 1,000 tokens
第 2 步: 上一轮上下文 (1,000) + Tool Result (500) + Response (400)  = 1,900 tokens
第 3 步: 上一轮上下文 (1,900) + Tool Result (300) + Response (350)  = 2,550 tokens
第 4 步: 上一轮上下文 (2,550) + Tool Result (800) + Response (400)  = 3,750 tokens
第 5 步: 上一轮上下文 (3,750) + Tool Result (200) + Response (500)  = 4,450 tokens
                                                          ─────────────────────
                                                          总计: ~13,650 tokens
```

注意上下文是累积的——每一步都要重新发送之前所有的对话历史。这意味着 **Token 消耗是超线性增长的**。步骤越多，后期每一步的成本越高。

以 GPT-4o 为例（$2.5/1M input, $10/1M output），上面这个 5 步 Agent 单次执行成本约 $0.03-0.05。看似不多，但如果日调用量 10 万次，月成本就是 $90,000-$150,000。

**优化策略**：
- 上下文压缩：每 N 步对历史做一次摘要
- 选择合适的模型：简单决策用小模型，关键决策用大模型
- 缓存：对相同输入的 Agent 结果做缓存（注意非确定性问题）
- 减少 Agent 步骤：通过更好的 Prompt 和工具设计，减少所需的推理轮次

### 6.2 延迟

LLM 的推理延迟通常在 500ms-5s 之间（取决于模型和输出长度）。一个 5 步 Agent 的端到端延迟：

```
5 步 × 平均 1.5s/步 = 7.5s

加上工具调用时间（网络请求、数据库查询等），实际延迟可能在 10-15s。
```

对比：
- Rule Engine 处理同样的逻辑：< 10ms
- Workflow 执行 5 个确定性步骤：< 500ms

**在延迟敏感的场景（如支付、交易、实时推荐），Agent 的延迟是不可接受的。**

### 6.3 不可预测性

这是 Agent 最被低估的问题。

```python
# 同样的输入，Agent 可能走出完全不同的路径

# 第一次运行
# Step 1: 调用 search_database → 找到 3 条记录
# Step 2: 调用 analyze_data → 生成分析
# Step 3: 返回结果
# 总计: 3 步, 耗时 4s, 成本 $0.02

# 第二次运行（完全相同的输入）
# Step 1: 调用 search_database → 找到 3 条记录
# Step 2: 调用 search_web → 想找更多信息（为什么？LLM 这次觉得不够）
# Step 3: 调用 search_database → 用新的关键词再查一次
# Step 4: 调用 analyze_data → 生成分析
# Step 5: 觉得分析不够好，调用 analyze_data → 重新生成
# Step 6: 返回结果
# 总计: 6 步, 耗时 10s, 成本 $0.06
```

这意味着你**无法预测 Agent 的执行时间和成本**。在需要做容量规划和 SLA 承诺的生产系统中，这是一个严重的问题。

### 6.4 调试困难

确定性系统的 Bug 可以精确复现：相同的输入 + 相同的代码 = 相同的 Bug。

Agent 不行。因为：
1. LLM 的输出本身带有随机性（即使 temperature=0，不同批次推理也可能有微小差异）
2. 工具调用的结果可能随时间变化（数据库内容变了、API 返回变了）
3. 上下文窗口中的信息累积，前几步的微小差异会被放大

**调试 Agent 的正确做法**：
- 完整记录每一步的输入（包括完整的 messages 列表）和输出
- 记录每次工具调用的参数和返回值
- 记录 Token 使用量和延迟
- 支持"回放"——用记录的数据重新走一遍流程（但要注意，即使相同输入，LLM 也可能给出不同输出）

---

## 7. 选型决策树

面对一个具体需求，按以下流程判断：

```
                    你的任务需要"理解"自然语言
                    或处理模糊/开放式输入吗？
                           │
                    ┌──────┴──────┐
                    │             │
                   Yes           No
                    │             │
                    ▼             ▼
             结果需要 100%     任务步骤之间有
             确定性吗？        复杂依赖关系吗？
                │                    │
          ┌─────┴─────┐        ┌─────┴─────┐
          │           │        │           │
         Yes         No       Yes         No
          │           │        │           │
          ▼           ▼        ▼           ▼
      先用规则     ┌──────┐  Workflow    Automation
      处理能处     │Agent │  / DAG      (Rule/Cron)
      理的部分     └──┬───┘
      用 Agent        │
      处理剩余        ▼
      (混合架构)   可以接受 $0.01-0.10/次
                   的成本和 2-10s 的延迟吗？
                          │
                    ┌─────┴─────┐
                    │           │
                   Yes         No
                    │           │
                    ▼           ▼
                  Agent     重新审视需求：
                            能否拆分为
                            确定性 + 模糊性部分？
                            → 混合架构
```

**速查表**：

| 如果你的任务是... | 推荐范式 | 理由 |
|---|---|---|
| 固定逻辑 + 定时触发 | Automation | 无需编排，无需推理 |
| 多步骤 + 有依赖 + 确定性 | Workflow | 需要编排，不需要推理 |
| 理解自然语言 + 动态决策 | Agent | 需要推理 |
| 大部分确定 + 少量模糊 | Workflow + Agent 节点 | 编排确定部分，推理模糊部分 |
| 简单触发 + 复杂诊断 | Automation + Agent | 触发用规则，诊断用推理 |

---

## 8. 常见误区

在结束之前，总结几个我在实际项目中反复见到的选型错误。

**误区一：因为"想用 AI"而选 Agent**

技术选型应该从问题出发，不是从解决方案出发。"我们想用 AI" 不是选 Agent 的理由，"用户输入是自然语言且意图不可穷举" 才是。

**误区二：用 Agent 替代状态机**

订单流转、审批流程、工单生命周期——这些有限状态机（FSM）问题有成熟的解决方案。把它们交给 Agent 不会让系统更智能，只会让它更不可靠。

**误区三：Agent 做完所有事**

让 Agent 既负责决策又负责执行。正确做法是：Agent 只负责"决定做什么"（What），具体的执行（How）交给确定性系统。例如 Agent 决定"需要给用户退款"，但实际调用退款 API 的逻辑是固定的代码，不是 Agent 自己拼 HTTP 请求。

**误区四：忽视 Agent 的失败模式**

Agent 会失败。它会幻觉、会陷入循环、会选错工具、会超时。你的系统设计必须考虑：Agent 失败了怎么办？有没有 Fallback？有没有人工兜底？最大重试次数是多少？

---

## 9. 总结

回到开篇的问题：你的问题，真的需要 Agent 吗？

三条准则：

1. **能用规则解决的，不要用 Workflow；能用 Workflow 解决的，不要用 Agent。** 选择复杂度最低的范式，降低的是长期维护成本。
2. **Agent 的正确位置是"最后一英里的模糊性"。** 在混合架构中，让确定性系统处理 80% 的工作，Agent 只处理那 20% 需要"理解"和"推理"的部分。
3. **Agent 是有代价的，而且代价比你想象的高。** Token 成本、延迟、不可预测性、调试难度——这些隐性成本在规模化后会成为真实的痛点。

选对抽象，才是真正的技术判断力。

---

> **系列导航**：本文是 Agentic 系列的第 03 篇。
>
> - 上一篇：[02 | From Prompt to Agent](/blog/engineering/agentic/02-From%20Prompt%20to%20Agent)
> - 下一篇：[04 | The Agent Control Loop](/blog/engineering/agentic/04-The%20Agent%20Control%20Loop)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
