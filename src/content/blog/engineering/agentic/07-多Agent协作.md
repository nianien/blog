---
title: "多 Agent 协作"
pubDate: "2026-01-17"
description: "单 Agent 有四个天花板——context、专业性、可靠性、并行度。多 Agent 协作不是把 Agent 串起来，而是用架构换可靠性。本文给出四种协作模式的核心伪代码、通信机制的 schema 选型、失败传播的处理路径，以及最常被低估的乘法效应数学。"
tags: ["Agentic", "AI Engineering", "Multi-Agent"]
series:
  key: "agentic"
  order: 7
author: "skyfalling"
---

单 Agent 系统迟早会撞上四个天花板——上下文装不下、能力难以兼顾、串行执行慢、决策视角单一。撞上时人们的反应通常是"拆成多个 Agent"——但这一步比想象中危险得多。串联两个成功率 80% 的 Agent，端到端只剩 64%；三个串联就是 51%。**多 Agent 不是免费升级，是用乘法效应换专业化**。这一篇展开四种协作模式的伪代码骨架、通信机制的 schema 选型、失败传播的分层处理逻辑，以及一个比"思路对不对"更重要的问题——单节点可靠性够不够。

---

## 1. 单 Agent 的四个天花板

| 天花板 | 表现 |
|--------|------|
| **Context Window** | 一个全能 Agent 要塞所有工具描述、领域知识、示例——光是工具描述就可能数万 token，留给实际任务的空间被严重压缩。叠加 Lost in the Middle 问题，塞得越多每条信息被有效利用的概率越低 |
| **专业化** | "你是严谨数据分析师"和"你是有创意的文案写手"在一个 prompt 里互相干扰——注意力分布只有一个，强调严谨就削弱创意 |
| **可靠性** | 单 Agent 是 Single Point of Failure，且 LLM 对自身错误的检测能力有限 |
| **并行度** | 单 Agent 串行执行——一次 LLM 调用、等结果、再下一次。三个独立子任务只能顺序处理，浪费大量时间 |

![串行 vs 并行执行的效率差](/images/blog/agentic/serial-vs-parallel.svg)

当这些天花板成为瓶颈，需要的不是更强的 prompt，是多个 Agent。

但**先把丑话说在前面**：单 Agent 任务成功率 80% 意味着两个串联 Agent 系统 64%，三个串联 51%。**多 Agent 架构必须在每个节点引入校验和容错，否则数学上跑不通**——这是后续讨论的所有协作模式的共同约束。

这个数学事实有一个推论：**多 Agent 系统的可靠性目标不能只看终端**，必须分解到每个节点。如果整个系统要达到 95% 端到端成功率，三个节点串联意味着每个节点要 95%^(1/3) ≈ 98.3%。这比单节点 95% 要求高得多，工程难度也大得多。**很多多 Agent 项目失败的根因不是思路错，而是对单节点可靠性要求理解不足**。

```python
def required_per_node_reliability(target: float, n_nodes: int) -> float:
    """端到端目标 target、N 个节点串联，每个节点至少要多少可靠性"""
    return target ** (1 / n_nodes)

# 端到端 95% / 3 个节点 → 98.3%
# 端到端 99% / 3 个节点 → 99.66%
# 端到端 99% / 5 个节点 → 99.80%
# 节点越多、目标越高，单节点要求越极端
```

这个公式有一个反直觉的含义：**节点越多，单节点要求越高，但单节点能做到的可靠性是有天花板的**。LLM 单步 99% 已经是工程极限——意味着 5 节点串联端到端只能做到约 95%。要更高的端到端可靠性，必须加非串联结构（投票、冗余、人审）打破乘法效应。

---

## 2. 四种协作模式

不同的 Agent 关系模式适用不同场景。**选错模式比用错框架更致命**。

### 2.1 Supervisor-Worker：中央协调

![Supervisor-Worker](/images/blog/agentic/supervisor-worker.svg)

中央协调者（Supervisor）分解任务、分配给专门的 Worker，最后合成结果。Worker 之间不直接通信。

```python
def supervisor_worker(goal: str, workers: dict[str, Agent]) -> Result:
    """Supervisor 分解任务、并行调 Worker、合成结果"""
    # 1. Supervisor 分解
    plan = supervisor.complete(
        DECOMPOSE_PROMPT.format(goal=goal, workers=workers.keys()),
        schema=WORK_ASSIGNMENT_SCHEMA,
    )
    # plan.assignments = [{"worker": "search", "task": "..."}, ...]

    # 2. 并行调 Worker（互不依赖时）
    results = {}
    with asyncio.TaskGroup() as tg:
        for assignment in plan.assignments:
            worker = workers[assignment.worker]
            tg.create_task(
                run_worker_with_retry(worker, assignment, results)
            )

    # 3. 合成
    return supervisor.complete(
        SYNTHESIZE_PROMPT.format(plan=plan, results=results),
    )

async def run_worker_with_retry(worker, assignment, results):
    """每个 Worker 调用都自带重试/降级链"""
    for attempt in range(3):
        try:
            r = await worker.run(assignment.task, timeout=assignment.timeout)
            if validate(r, schema=assignment.expected_schema):
                results[assignment.id] = r
                return
        except WorkerError as e:
            if not is_retryable(e):
                break
    # 主 Worker 三次失败 → 走降级
    fallback = workers.get(assignment.fallback)
    if fallback:
        results[assignment.id] = await fallback.run(assignment.task)
    else:
        results[assignment.id] = Result.failed(reason="no fallback")
```

| 特征 | 含义 |
|------|------|
| 控制结构 | 中心化 |
| 通信拓扑 | 星形 |
| 并行度 | 高（Worker 间并行） |
| 调试难度 | 中 |

适合：任务可明确分解（撰写技术报告：Search Agent + Analyze Agent + Write Agent）。

**风险**：Supervisor 是单点——分解不合理时所有 Worker 努力白费。Supervisor 的理解能力决定整个系统的上限。

### 2.2 Peer-to-Peer：平等协商

![Peer-to-Peer](/images/blog/agentic/peer-to-peer.svg)

多个 Agent 地位平等，直接消息传递，无中央协调。最常见用法是"辩论"模式：

```python
def peer_to_peer_debate(
    topic: str,
    agents: list[Agent],
    max_rounds: int = 5,
    converge_threshold: float = 0.85,
) -> Result:
    """N 个 Agent 轮流发言，直到达成共识或超过轮次"""
    transcript = [Message(speaker="moderator", content=topic)]

    for round_idx in range(max_rounds):
        round_messages = []
        for agent in agents:
            response = agent.complete(
                DEBATE_PROMPT.format(
                    role=agent.role,
                    transcript=transcript[-20:],   # 滑动窗口防止 context 爆
                    round=round_idx,
                ),
                schema=DEBATE_TURN_SCHEMA,
            )
            round_messages.append(Message(speaker=agent.id, **response))

        transcript.extend(round_messages)

        # 关键：必须有外部终止机制
        if detect_consensus(round_messages, threshold=converge_threshold):
            return synthesize_consensus(transcript)
        if detect_loop(transcript, window=2 * len(agents)):
            return arbitrate(transcript)  # 引入外部仲裁打破僵局

    # 超过 max_rounds 还没达成共识 → 强制仲裁
    return arbitrate(transcript)

def detect_consensus(round_messages, threshold=0.85) -> bool:
    """共识检测的三种典型实现，按强度排序"""
    # 方案 1：所有 Agent 的 confidence × position 余弦相似度 > 阈值
    positions = [m.position for m in round_messages]
    sim_matrix = [[cosine(embed(a), embed(b)) for b in positions] for a in positions]
    pairwise_avg = sum(s for row in sim_matrix for s in row) / (len(positions) ** 2)
    if pairwise_avg > threshold:
        return True
    # 方案 2：用一个独立的 LLM judge 判断"这些立场是否实质上一致"
    judge_result = judge_llm.complete(JUDGE_CONSENSUS_PROMPT.format(positions=positions))
    return judge_result.consensus and judge_result.confidence > 0.8

def arbitrate(transcript) -> Result:
    """三种打破僵局的方式"""
    # 1) 投票多数派——Agent 间存在不可调和分歧时最朴素
    # 2) 引入更高权重的"仲裁 Agent"做最终裁决
    # 3) 直接升级到人审——所有自动化都做不了决定时的兜底
    return weighted_vote(transcript) or escalate_to_human(transcript)
```

每轮的 Agent 输出 schema 要明确：

```json
{
  "name": "debate_turn",
  "parameters": {
    "type": "object",
    "properties": {
      "position": {"type": "string", "description": "本轮立场，简洁陈述"},
      "supporting_evidence": {"type": "array", "items": {"type": "string"}},
      "rebuttal_to": {"type": "array", "items": {"type": "string"},
                      "description": "针对之前哪些观点反驳"},
      "agreement_with": {"type": "array", "items": {"type": "string"},
                         "description": "认可之前哪些观点"},
      "confidence": {"type": "number"}
    },
    "required": ["position", "confidence"]
  }
}
```

| 特征 | 含义 |
|------|------|
| 控制结构 | 去中心化 |
| 通信拓扑 | 网状 |
| 并行度 | 中 |
| 调试难度 | 高 |

适合：辩论式分析（多视角碰撞）、代码审查（作者 + 审查者来回沟通）、风险评估（乐观分析师 + 悲观分析师）。

**风险**：可能无限循环——两个 Agent 互相不同意永远达不成共识。**必须有外部终止机制**：最大轮次、外部仲裁、投票制度。

### 2.3 Pipeline：流水线

![Pipeline](/images/blog/agentic/pipeline.svg)

Agent 按顺序串联，上游输出是下游输入，数据单向流动。

```python
def pipeline_with_checkpoint(input_data, stages: list[Stage]) -> Result:
    """带 checkpoint 的 Pipeline：每阶段输出落盘，失败可从最近 checkpoint 恢复"""
    state = PipelineState(input=input_data, outputs={}, current_stage=0)
    state = load_checkpoint_if_exists(state.run_id) or state

    for i in range(state.current_stage, len(stages)):
        stage = stages[i]
        try:
            # 准备输入：当前阶段拿前一阶段的输出
            stage_input = state.outputs.get(stages[i - 1].name) if i > 0 else input_data
            result = stage.run(stage_input)

            if not validate(result, schema=stage.output_schema):
                # 校验失败 → 视为本阶段失败
                raise StageValidationError(stage.name, result)

            state.outputs[stage.name] = result
            state.current_stage = i + 1
            save_checkpoint(state)            # 每阶段成功后立刻 checkpoint

        except StageError as e:
            if stage.fallback:
                # 走降级：跳过本阶段，把前阶段输出直接传给下下阶段
                state.outputs[stage.name] = stage.fallback(stage_input)
                save_checkpoint(state)
                continue
            return Result.failed(stage=stage.name, error=e, partial_state=state)

    return Result.ok(outputs=state.outputs)
```

| 特征 | 含义 |
|------|------|
| 控制结构 | 线性 |
| 通信拓扑 | 链式 |
| 并行度 | 低（严格串行） |
| 调试难度 | 低 |

适合：内容生产（起草→审查→编辑→排版）、ETL（提取→清洗→转换→加载）。

**风险**：上游不完成下游无法开始。**错误会沿管道传播——中间节点失败时，前面已完成的工作可能浪费**。Checkpoint 机制是 Pipeline 必须的基础设施，否则长链路失败的成本会让人难以接受。

### 2.4 Dynamic Routing：意图分发

![Dynamic Routing](/images/blog/agentic/dynamic-routing.svg)

轻量级 Router 根据意图分类把请求分发到对应的专家 Agent。

```python
def dynamic_routing(
    request: Request,
    router: Agent,         # 小模型，便宜快
    experts: dict[str, Agent],
) -> Result:
    """Router 分流到专家 Agent，专家内部各自跑自己的循环"""
    route_decision = router.complete(
        ROUTE_PROMPT.format(request=request, experts=experts.keys()),
        schema=ROUTE_SCHEMA,
    )
    # route_decision = {"route": "tech_support", "confidence": 0.92, ...}

    if route_decision.confidence < 0.6:
        # 低置信度 → 走兜底专家或追问用户
        return experts.get("clarifier").run(request) \
            if "clarifier" in experts \
            else ask_user_for_clarification(request, route_decision)

    expert = experts.get(route_decision.route)
    if not expert:
        return Result.failed(reason=f"unknown route: {route_decision.route}")

    return expert.run(request)
```

| 特征 | 含义 |
|------|------|
| 控制结构 | 分发型 |
| 通信拓扑 | 扇出 |
| 并行度 | 高（请求级并行） |
| 调试难度 | 低 |

适合：客服系统（技术 vs 售后）、多领域问答（医疗 vs 法律）、代码助手（Python vs Rust 专家）。

**风险**：**路由准确率是系统瓶颈**——路由错了，后面专家再专业也没用。模糊意图（"我买的东西有技术问题"——技术支持还是售后？）需要特殊处理：低 confidence 时降级到澄清问询，或走"全部专家并行 + 后置仲裁"。

### 2.5 选哪种

| 任务特征 | 选 |
|---------|---|
| 可并行分解（一个总目标拆成独立子任务） | Supervisor-Worker |
| 需要多视角碰撞（辩论、审查） | Peer-to-Peer |
| 处理有明确阶段（数据流单向） | Pipeline |
| 请求类型多样，专家各有擅长 | Dynamic Routing |

大多数任务最自然的形态是 Supervisor-Worker——"一个总目标，分解后并行执行，最后合成"。从它开始不容易选错。

**四种模式不是互斥的**。生产中的复杂多 Agent 系统通常是混合形态：

- 外层是 Dynamic Routing 把请求按类型分发
- 每个路由分支内部是 Supervisor-Worker 做任务分解
- 关键决策节点内嵌 Peer-to-Peer 做辩论式分析
- 输出生成阶段走 Pipeline 做"草稿→审查→润色"

把多 Agent 看成"模式的组合"而非"单一模式"，能更好地匹配真实任务的复杂性。但越多模式叠加，调试难度增长越快——所以混合形态应该是被现实推出来的，不是被设计欲推出来的。

### 2.6 四种模式都不太合适怎么办

如果四种都尝试过仍然撞墙，往往意味着两件事之一：**任务还不够独立 = 多 Agent 救不了，回到单 Agent + 工作流编排**，或**单节点可靠性不够 = 拆 Agent 只会让乘法效应更糟**。这时三个降级路径按收益排序：

1. **回到单 Agent，但加工作流编排**——很多看起来需要多 Agent 的场景，其实只需要更好的 Routing + Parallelization
2. **把多 Agent 退化为工具化的 sub-Agent**——子 Agent 作为主 Agent 的特殊工具，主从关系明确，比对等协作好调试
3. **承认这个任务现阶段不该自动化**——HITL 兜底 + 沉淀人类决策模式，等真实数据足够再考虑自动化

第三条最被低估——多 Agent 项目最大的失败模式是"不该自动化的事强行自动化"。

---

## 3. 黑板、消息、事件：Agent 之间怎么传信息

| 机制 | 思路 | 优势 | 劣势 |
|------|------|------|------|
| **Blackboard**（共享黑板） | 所有 Agent 读写同一个状态存储 | 完全解耦——Agent 不需要知道彼此存在 | 共享状态意味着竞争条件，需要锁 |
| **Message Passing**（消息传递） | Agent 之间通过显式消息通信，各有收件箱 | 通信关系显式、可追踪、可审计 | 耦合度高——Agent 要知道目标 ID |
| **Event Bus**（事件总线） | 通过发布/订阅事件间接通信 | 扩展性好——新增 Agent 只需订阅相关事件 | 事件流难追踪："这个事件是谁发的？谁处理的？" |

### 3.1 Blackboard 的最小 schema

```python
Blackboard = {
    "run_id": str,                  # 一次多 Agent 协作的唯一 ID
    "goal": str,
    "shared_facts": dict,           # 各 Agent 共享的事实库
    "agent_outputs": {              # 每个 Agent 的输出独立分区
        "search_agent": {"status": "done", "data": {...}, "ts": int},
        "analyze_agent": {"status": "running", "data": None, "ts": int},
        "writer_agent": {"status": "pending", "data": None, "ts": int},
    },
    "checkpoints": list,            # 关键决策点快照
    "errors": list,                 # 全局错误日志
}
```

关键设计：**每个 Agent 的输出分到自己的 key**。多个 Agent 同时写不同的 key 不冲突；只有 Supervisor 读所有 key 做合成。

### 3.2 Message Passing 的 schema

```python
Message = {
    "id": str,
    "from": str,                    # 发送方 agent_id
    "to": str | list[str],          # 接收方，可单播可组播
    "kind": "request" | "response" | "broadcast" | "ack",
    "in_reply_to": str | None,      # 关联的上游 message_id
    "payload": dict,
    "timestamp": int,
    "expected_response_by": int | None,   # 超时
}
```

显式的 `in_reply_to` 是 P2P 模式调试时的救命字段——没有它，几十条 Message 在 Trace 里就是一团乱麻。

### 3.3 配什么协作模式

| 用什么 | 配什么协作模式 |
|--------|--------------|
| Blackboard | Supervisor-Worker（Supervisor 看全局状态，Worker 写自己负责的部分） |
| Message Passing | Peer-to-Peer（双向频繁交互） |
| Event Bus | Pipeline + 事件驱动架构 |

**实践建议**：大多数 Multi-Agent 系统从 Blackboard 开始——最简单且对 Supervisor-Worker 友好。复杂度增长到需要解耦时再考虑 Event Bus。

---

## 4. 状态分区：避免冲突的核心思路

Multi-Agent 系统的状态管理比 Single-Agent 复杂一个数量级。多个 Agent 同时操作状态，怎么保证一致性？

| 共享状态 | 独立状态 |
|---------|---------|
| Agent 间信息同步即时 | 无并发问题 |
| 任何 Agent 看到最新全局状态 | 每个 Agent 完全自主 |
| 需要处理并发冲突 | Agent 间信息同步有延迟，需要显式合并 |
| 适合 Supervisor-Worker | 适合 Pipeline |

**最有效的冲突避免不是冲突解决**——是**状态分区**。每个 Agent 只写自己负责的状态区域，避免多 Agent 写同一个 key。Supervisor-Worker 天然支持这个：每个 Worker 写自己的结果 key，只有 Supervisor 读所有 key。

```python
def write_partition(blackboard, agent_id, key, value):
    """每个 Agent 只能写自己的分区——一行权限校验防住绝大多数冲突"""
    assert key.startswith(f"agent_outputs.{agent_id}."), \
        f"agent {agent_id} cannot write to {key}"
    blackboard[key] = value
```

这种"权限分区"在工程上比"加锁"简单得多——锁机制处理不好就死锁、性能损失大；分区是设计层面避免冲突，几乎零成本。

---

## 5. 失败在哪个层面发生：Worker、Supervisor、Pipeline

Multi-Agent 的错误传播路径比单 Agent 更多。三层处理：

### 5.1 Worker 失败

按优先级处理：

1. **同一 Worker 重试**——瞬时错误（网络、API 限流）
2. **降级到备选 Worker**——主 Worker 持续失败时切换。需要预先配置降级链
3. **跳过 + 上报**——非关键 Worker 失败时跳过，让流程继续
4. **整体失败 + 告知用户**——关键 Worker 不可恢复时止损

降级链的配置 schema：

```python
WorkerConfig = {
    "id": "search_agent",
    "primary": {"model": "gpt-4o", "tools": ["google_search", "web_scrape"]},
    "fallback_chain": [
        {"model": "gpt-4o-mini", "tools": ["google_search"]},   # 弱化版
        {"model": "haiku-4-5", "tools": ["cached_search"]},     # 仅缓存
    ],
    "max_retries_per_level": 2,
    "is_critical": False,                  # 关键性标志：False 时失败可跳过
}
```

### 5.2 Supervisor 失败

Supervisor 是中央协调者，失败意味着整个任务无法继续。三层保护：

- **外部监控**：非 LLM 的监控层检测 Supervisor 健康状态
- **Supervisor 冗余**：备用 Supervisor（可用不同模型），主切备
- **Checkpoint 机制**：每个决策点保存状态快照，从最近的 checkpoint 恢复

### 5.3 Pipeline 链路中断

| 策略 | 做法 | 适用 |
|------|------|------|
| 重试当前节点 | 相同输入重新执行 | 瞬时故障 |
| 跳过 + 降级 | 跳过失败节点，前节点输出直接给下下节点 | 失败节点是可选增强步骤（翻译、润色） |
| Checkpoint 回退 | 缓存每个节点的输入输出，从失败处重新开始 | 链路长、前面步骤成本高 |

### 5.4 Peer-to-Peer 的死锁

两个 Agent 互相等待对方的回复——A 等 B 的反馈，B 等 A 的修改。检测策略：维护"等待图"，定期检测是否有环。出现环时强制超时一方。

```python
def detect_deadlock(wait_graph: dict[str, set[str]]) -> list[str] | None:
    """wait_graph[A] = {B, C} 表示 A 在等 B 和 C"""
    visited, stack = set(), []
    def dfs(node):
        if node in stack:
            return stack[stack.index(node):]  # 找到环
        if node in visited:
            return None
        visited.add(node)
        stack.append(node)
        for nb in wait_graph.get(node, []):
            if cycle := dfs(nb):
                return cycle
        stack.pop()
        return None

    for n in wait_graph:
        if cycle := dfs(n):
            return cycle
    return None
```

发现环时的处理：强制超时一方（按优先级最低或资源消耗最大的 Agent）、把僵局上报给上级 Supervisor 或人审。

为什么不直接用 NetworkX 这类成熟拓扑排序库？两个原因：**实时检测的开销**——Agent 间的 wait_graph 在每轮交互后都可能变化，NetworkX 的图构造开销在高频场景下不划算；**等待语义的特殊性**——传统拓扑排序处理的是"任务 A 必须在 B 之前"的硬依赖，Agent 死锁是"A 在等 B 的反馈、B 也在等 A 的修改"的双向软依赖，需要专门的环检测逻辑。一旦 wait_graph 复杂到 100+ 节点，再考虑引入第三方库。

---

## 6. 多 Agent 的 token 成本与模型分级

Multi-Agent 不是免费的午餐。**可能是单 Agent 的 2-3 倍 token 成本**。

![单 Agent vs 多 Agent 成本对比](/images/blog/agentic/cost-comparison.svg)

具体场景对比（5000 字技术调研报告）——**假设条件**：输入 prompt 约 2000 字、3 个 Worker 并行、模型为 GPT-4o（$2.5/$10 per 1M token）、质量分由独立的 LLM-as-Judge 在"信息完整性 / 逻辑一致性 / 引用准确性"三维平均得出（满分 10）。

| 指标 | Single Agent | Multi-Agent（Supervisor-Worker） |
|------|-------------|--------------------------------|
| LLM 调用次数 | 1 | 5（1 分解 + 3 Worker + 1 合成） |
| Token 消耗 | 22,500 | 41,500 |
| 成本 | $0.53 | $1.34 |
| 执行时间 | 33s | 27s（Worker 并行） |
| 输出质量（独立 LLM-Judge）| 6.8/10 | 8.8/10 |

这组数字的解读不是"多 Agent 强 2 分"，而是"**多花 2.5 倍 token 换 30% 的质量提升**——值不值得看任务商业价值"。一份要给客户的咨询报告，多花 $0.81 换 30% 质量提升显然划算；一个日常客服回复，这笔钱不该花。

**Multi-Agent 在以下条件收益最大**：

1. 任务天然可并行（子任务间独立性高）
2. 专业化收益显著（专家 Agent 在领域内显著优于通用 Agent）
3. 单 Agent 已到能力瓶颈（context 不够、角色冲突）
4. 任务商业价值足够高（生成一份价值数万元的分析报告，多花几美元 API 是合理的）

**最重要的成本优化原则**：Router 和 Supervisor 可以用轻量模型（GPT-4o-mini），只有需要深度推理的 Worker 用重量级模型。**项目经理不需要是技术最强的人，但专家必须各自领域足够专业**。

这个"模型分级"策略是 Multi-Agent 项目成本控制的最大杠杆。一个典型的成本结构：

| 角色 | 调用频率 | 推荐模型 | 单次成本 |
|------|--------|--------|--------|
| Router | 每请求一次 | gpt-4o-mini / haiku | 极低 |
| Supervisor | 每请求 1-3 次 | gpt-4o-mini / haiku | 低 |
| Worker（专家） | 每请求 N 次 | gpt-4o / claude-sonnet | 中 |
| Reflector | 关键节点 | gpt-4o / claude-sonnet | 中 |
| 关键决策 | 偶发 | o1 / o3 | 高 |

不分级用同一个高端模型，成本可能是分级方案的 5-10 倍。这种成本差异在小规模 demo 阶段不显眼，但在百万级日活时会变成几十万美元月度账单的差距。

---

## 7. Multi-Agent 调试的平方级难度

Multi-Agent 调试难度是 Single-Agent 的平方级增长——不仅每个 Agent 内部可能出错，Agent 之间的交互也可能出错。

可观测性的基本要求：

| 维度 | 记录什么 |
|------|---------|
| Trace | 每个 Agent 的每次 LLM 调用、输入、输出、耗时 |
| Span 嵌套 | Agent 之间的调用关系——父 Span（Supervisor）下嵌套子 Span（Worker） |
| 状态快照 | 每个决策点的 Blackboard 状态 |
| 消息日志 | Agent 间所有消息的完整内容 |

### Trace span 的最小 schema

```python
AgentSpan = {
    "span_id": str,
    "parent_span_id": str | None,   # Supervisor span 是父，Worker span 是子
    "agent_id": str,
    "operation": "plan" | "execute" | "reflect" | "synthesize",
    "input": dict,
    "output": dict | None,
    "model": str,
    "tokens": {"prompt": int, "completion": int},
    "duration_ms": int,
    "status": "ok" | "retry" | "failed" | "fallback_used",
    "error": str | None,
    "blackboard_snapshot_ref": str | None,   # 指向当时 BB 的快照
}
```

**特别难的是 bug 复现**：

- LLM 输出非确定（相同输入可能产生不同输出）
- Agent 间交互动态（执行路径取决于中间结果）
- 并发时序不确定（Worker A 和 B 谁先完成可能影响结果）

应对：记录每次 LLM 调用的完整 messages 和 response（不只是摘要）；用固定 seed 和 temperature=0 做确定性回放；快照式调试——在每个 Agent 决策点保存完整 Blackboard 快照。

---

## 8. 上线前必须先回答的六个问题

| 验证项 | 不通过则不该上 |
|--------|-------------|
| 单 Agent 真的不够？ | 是否尝试过优化 prompt、增加工具、用更强模型？ |
| 任务真的需要多角色/多视角？ | 还是"觉得多 Agent 更酷"？ |
| API 预算能支撑 2-3x 成本？ | 不能就不上 |
| 每个 Agent 失败的影响范围？降级方案？ | 没想清楚就不上 |
| 如何追踪请求在多 Agent 间的完整链路？ | 没有可观测性就不上 |
| 如何测试 Agent 协作的正确性？ | 单元测试 + 集成测试都需要 |

这六条不是 checklist，是"任一不过都该停手"的硬门槛。多 Agent 项目最大的风险不是技术失败，是**上线后才发现根本没有调试和兜底能力**——线上出错时既看不清状态、又改不动 prompt、又没法回滚。

---

## 9. 从单到多不是相加，是相乘

Multi-Agent 系统最反直觉的一件事是数学：单 Agent 任务成功率 80% 意味着两个串联系统是 64%、三个是 51%。要让三个串联系统达到 95% 端到端可靠性，每个单节点必须达到约 98.3%——这是一个比单 Agent 95% 严格得多的工程要求。**很多 Multi-Agent 项目失败的根因不是思路错，而是低估了单节点可靠性的要求**。

Multi-Agent 解决的是单 Agent 的四个天花板：上下文不够、能力单一、串行执行、决策视角单一。换来的代价也是四件：2-3 倍 token 成本、平方级调试难度、新的协作错误模式（Agent 间死锁、信息不同步、状态竞争）、新的运维问题（Supervisor 单点失败、Worker 降级链路）。是用复杂度换能力上限，不是免费午餐。

最实用的判断是这样：先穷尽单 Agent 的优化空间——更好的 prompt、更精细的工具、更强的模型、更聪明的 Memory——再考虑 Multi-Agent。如果你的单 Agent 还在 70% 成功率上挣扎，拆成三个 Agent 只会让端到端可靠性更差。Multi-Agent 是"已经做到 90% 想冲 95%"的工具，不是"做不到 70% 想跳到 80%"的工具。