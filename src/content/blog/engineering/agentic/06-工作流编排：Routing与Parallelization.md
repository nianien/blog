---
title: "工作流编排：Routing 与 Parallelization"
pubDate: "2025-12-17"
description: "Agent 不是只靠一个大循环跑到底。复杂任务通常需要把多步组装成工作流：根据输入选择不同路径（Routing）、把可独立的步骤并行（Parallelization）、把多个步骤链成顺序流水（Chaining）。本文从契约和实现两个角度展开这三种工作流模式，给出何时用、怎么用、容易踩什么坑。"
tags: ["Agentic", "AI Engineering", "Workflow"]
series:
  key: "agentic"
  order: 6
author: "skyfalling"
---

生产级 Agent 任务很少只是一个 ReAct 循环跑到底。它通常是一个**工作流**——根据输入选择不同执行路径、把可独立的子任务并行起来、把若干阶段串成有序流水。把"步骤拓扑"从 LLM 的隐性决策提到代码层显式化，是 Agent 工程从个例 demo 走到批量生产的分水岭。下面拆开工作流编排里最基础也最高频的三个模式：**Chaining、Routing、Parallelization**——它们是 Agent 系统组装多步执行的积木，掌握了这三个，多 Agent 协作就只是把同一套积木从"单 Agent 内"扩展到"多 Agent 间"。

---

## 1. 三个模式的核心问题

| 模式 | 解决什么 | 何时第一时间想到它 |
|------|---------|---------|
| **Chaining** | 把多个 LLM/工具调用串成有依赖关系的流水 | 任务必须 A 完成后才能做 B，B 完成后才能做 C |
| **Routing** | 根据输入特征把请求分发到不同处理路径 | "这个问题该用 RAG 还是工具？该用大模型还是小模型？" |
| **Parallelization** | 把无依赖的子任务同时执行 | 任务能拆成"互不相关的 N 份"或"对同一份数据做 N 种独立处理" |

三者经常组合出现——一个生产 Agent 的典型工作流可能是："Router 路由 → 大块拆分 → 并行处理 → 顺序汇聚"。但拆开学一遍，才能在组合时不混淆。

底层有一个共同点：**工作流模式让步骤拓扑显式化**。在纯 ReAct 循环里，所有步骤的连接关系都隐藏在 LLM 的下一步选择里——你只能事后看 trace 知道它做了什么。工作流模式把"先做什么、后做什么、谁和谁能并行"提到代码层显式定义，可观测、可优化、可测试。这是 Agent 工程从"个例 demo"到"可批量生产"的关键转变。

---

## 2. Chaining：顺序流水

Chaining 的核心是**步骤间显式依赖 + 顺序执行**。它和 ReAct 循环的根本区别在于"控制权归谁"：

| 维度 | ReAct 循环 | 显式 Chain |
|------|----------|----------|
| 步骤数 | 不确定，由 LLM 决定 | 固定，代码层声明 |
| 步骤间连接 | 隐式（在 LLM 选择里）| 显式（代码定义"step1 输出 → step2 输入"）|
| 失败处理 | LLM 看错误重新选择 | 每步独立 try/except、retry、fallback |
| 适合任务 | 探索性、步骤模糊的 | 流程确定、合规要求高的 |

ReAct 适合做"路径不确定"的探索，Chain 适合编码"已经稳定的业务流程"——比如"采集 → 清洗 → 提取实体 → 入库 → 通知"。

### 2.1 带 checkpoint 的 Chain 骨架

Chain 在生产里几乎不用"裸版"，至少要带 checkpoint——长链路里第 7 步失败时不能从第 1 步重跑：

```python
def run_chain(input_data, steps, run_id) -> ChainState:
    """每步成功后落 checkpoint，失败可从最近 checkpoint 恢复"""
    state = load_checkpoint(run_id) or ChainState(input=input_data, outputs={}, cursor=0)

    for i in range(state.cursor, len(steps)):
        step = steps[i]
        try:
            state.outputs[step.name] = step.run(state)
            state.cursor = i + 1
            save_checkpoint(run_id, state)              # 每步成功立刻落 checkpoint
        except StepError as e:
            if step.required:
                raise ChainAborted(step.name, e, partial_state=state)
            state.outputs[step.name] = step.fallback(state, e)
            state.cursor = i + 1
            save_checkpoint(run_id, state)
    return state
```

Checkpoint 的代价是每步多一次持久化写入；收益是**长链路、贵步骤、长跑任务**下重试成本断崖式下降。判断要不要上 checkpoint，看"一次重跑要烧多少"——超过几美元的链路基本都该上。

### 2.2 不可逆步骤要补 Saga

如果 Chain 中间有**不可逆副作用**（发邮件、扣款、创建资源），靠 try/except 兜不住——失败时已经发生的副作用没法回滚。这时要补 **Saga 补偿模式**：每个不可逆步骤声明对应的补偿动作，链路失败时按反向顺序执行补偿：

```python
def run_saga_chain(steps, input_data):
    """每步要么成功并记录补偿动作，要么触发反向补偿链"""
    compensations = []                    # 已成功步骤的补偿动作栈
    state = ChainState(input=input_data, outputs={})

    try:
        for step in steps:
            state.outputs[step.name] = step.run(state)
            if step.compensate is not None:
                compensations.append((step.name, step.compensate, state.snapshot()))
        return state
    except StepError as e:
        # 反向执行所有已注册的补偿动作
        for name, compensate, snapshot in reversed(compensations):
            try:
                compensate(snapshot)
            except Exception as cex:
                log_compensation_failure(name, cex)     # 补偿失败需要人审
        raise ChainAborted(failed_step=e.step, compensations_run=len(compensations))
```

Saga 模式从分布式事务领域来——Agent 工作流跨多个外部系统时本质就是分布式事务，所以同样的解法在这里继续生效。**补偿动作本身也可能失败**——补偿失败需要告警 + 人审，因为这意味着系统进入了不一致状态。

实战中常见的形态是**Chain 套 ReAct**：外层流程显式 Chain 编排，某一步内部跑 ReAct 完成探索性子任务。这样既能保证整体流程的可控性，又能给关键步骤留出 LLM 自由发挥的空间。

---

## 3. Routing：根据输入选择路径

### 3.1 Routing 的本质

Routing 模式回答一个问题：**面对一个输入，应该走哪条处理路径？** 它把"选择"从 LLM 的隐性决策提升为系统的显式决策。

典型路由场景：

| 输入特征 | 路由到 |
|---------|------|
| 短问答类（如"什么是 RAG"）| 小模型 + 缓存 |
| 涉及实时数据（如"今天股价"）| 工具调用路径 |
| 涉及私有知识（如"我们的产品文档"）| RAG 路径 |
| 复杂多步任务（如"做一份竞品分析"）| 完整 Agent 循环 |
| 涉及账户操作（如"删除我的订单"）| HITL 审批路径 |

不做 Routing 的代价：所有请求都走最重的路径——延迟翻倍、成本翻数倍、简单问题的回答质量反而下降（大模型在简单问题上有时会"过度思考"）。Routing 是 Agent 系统的第一个性能与成本杠杆。

### 3.2 三种 Routing 实现

| 方式 | 决策依据 | 准确率 | 成本 | 适合 |
|------|---------|------|------|------|
| **规则路由** | 关键词、正则、参数特征 | 高（在覆盖到的模式上）| 零（不调 LLM）| 类别有限、特征明显 |
| **分类器路由** | 小模型/embedding 相似度 | 中-高 | 低（一次小模型调用 或 一次向量比对）| 类别 5-50 个、有训练数据 |
| **LLM 路由** | LLM 读输入 + 路由 prompt 输出 enum | 高 | 中（一次 LLM 调用）| 类别复杂、规则难写 |

生产系统通常**三层组合**：先规则路由（覆盖 80% 高频明显的）→ 分类器路由（覆盖 15% 中等复杂的）→ LLM 路由（兜底 5% 复杂或新型的）。这种组合的关键是**让最便宜的方式覆盖最多流量**。

分类器路由通常用一个小型 embedding 模型（如 BGE-small / text-embedding-3-small），把每个路由类别预先 embed 成几条"代表样本向量"，新请求过来时算 cosine 相似度：

```python
def classifier_route(user_input: str) -> RouteDecision:
    """用 embedding 相似度做意图分类——零 LLM 调用、毫秒级"""
    query_vec = embed_small(user_input)
    best_route, best_score = None, -1

    for route_name, sample_vecs in ROUTE_PROTOTYPES.items():
        # 每个路由 5-10 个代表样本的向量已离线预算好
        # 取与代表样本的最大相似度作为该路由的得分
        score = max(cosine(query_vec, s) for s in sample_vecs)
        if score > best_score:
            best_route, best_score = route_name, score

    if best_score >= 0.78:
        return RouteDecision(route=best_route, confidence=best_score, method="classifier")
    return RouteDecision(route=None, confidence=best_score, method="classifier")  # 让 LLM 路由兜底

# 离线构建 ROUTE_PROTOTYPES 时，每个路由的"代表样本"从生产日志里挖出 5-10 条最典型的真实请求
```

分类器路由的工程优势：**毫秒级响应、几乎零成本、可解释性强**——失败时能直接看是哪个 prototype 离用户问题最近。劣势是新意图加入时要重新挖代表样本和调阈值。

### 3.3 LLM-based Routing 的 Prompt 设计

LLM Routing 的输出必须是结构化的——不能给一段散文。典型 Schema：

```json
{
  "name": "route_decision",
  "parameters": {
    "type": "object",
    "properties": {
      "route": {
        "type": "string",
        "enum": ["qa_simple", "rag", "tool_calling", "agent_full", "hitl_approval", "unsupported"]
      },
      "confidence": {
        "type": "number",
        "minimum": 0,
        "maximum": 1
      },
      "reasoning": {
        "type": "string",
        "description": "一句话解释路由依据"
      }
    },
    "required": ["route", "confidence"]
  }
}
```

注意三个设计点：

- **`route` 用 `enum`，不让 LLM 自由发挥**——避免输出 "qa_simple_v2" 这种系统不认识的路由
- **必须有 confidence**——低 confidence 时降级到上一层路由器或 fallback
- **必须包含 unsupported 兜底**——LLM 经常面对"不在已知类别里"的输入，强迫它选一个会让路由错乱

Router 的 System Prompt 关键段：

```text
你是一个请求分类器，把用户输入分到下列路由：

- qa_simple: 简单事实性问答，1 句话能答的
- rag: 涉及私有知识库的查询
- tool_calling: 需要实时数据或外部系统操作的
- agent_full: 复杂多步骤任务（需要规划、迭代）
- hitl_approval: 涉及不可逆操作（删除、转账、对外发送）
- unsupported: 不属于以上任何类别

规则：
- 一律输出 enum 中的值，不要造新词
- confidence 低于 0.6 时，必须选 unsupported 而非猜测
- 涉及多个动作的，按"最高风险动作"归类
- 用户表达不清时，倾向选 unsupported 触发追问
```

这段 prompt 里 "倾向选 unsupported" 是关键反直觉点——大多数路由 prompt 会要求"尽量匹配"，但生产中宁可"我不知道"也不能"猜错"，因为路由错了下游全错。

### 3.4 Routing 的关键设计点

**Confidence 阈值与降级**。Routing 必须有 confidence 评分和 fallback 路径：

```python
def smart_route(user_input):
    # 第 1 层：规则
    if r := rule_router(user_input):
        return r
    # 第 2 层：embedding 分类器
    cls_result = embedding_classifier(user_input)
    if cls_result.confidence >= 0.85:
        return cls_result.route
    # 第 3 层：LLM 路由
    llm_result = llm_router(user_input)
    if llm_result.confidence >= 0.6:
        return llm_result.route
    # 都不行，进入 fallback：要么追问用户，要么走最保守路径
    return "ask_clarification"
```

**路由错误的代价不对称**。把"复杂任务"误判为"简单 QA"的代价是回答不完整；把"简单 QA"误判为"完整 Agent"的代价是延迟从 200ms 变成 30s。**前者用户看得见、后者用户感受得到——但通常前者更可接受**。所以 Router 应该**偏向高复杂度路径**——拿不准就走重路径，宁可慢一点也不能漏掉关键信息。

**路由的可观测性**。每次路由必须记 trace：输入摘要、路由结果、confidence、所走路径的延迟和成本。线上才能回答"哪些请求被路由到了高成本路径？是不是路由错了？"——没有这层数据，路由策略改起来全凭直觉。

**Routing 不只在入口**。一个常见误解是"Routing 是 Agent 系统的入口分流器"。实际上 Routing 在 Agent 内部到处都是——选哪个工具是 Routing（隐性的）、选哪个 RAG 索引是 Routing、选用哪个 prompt 模板是 Routing。把"内部路由"也显式化，能定位 70% 的 Agent 不稳定问题。

---

## 4. Parallelization：把可独立的步骤同时执行

### 4.1 三种并行场景

| 场景 | 例子 | 关键判断 |
|------|------|---------|
| **Fan-out** 任务并行 | 同时调用 3 个不同工具收集信息 | 子任务彼此无依赖 |
| **Map-Reduce** 数据并行 | 把 100 页文档分块，每块独立 LLM 总结，再合并 | 数据可独立处理 + 结果可聚合 |
| **Scatter-Gather** 多源并行 | 同时查 4 个数据源，整合最有用的 | 多源等价但可靠性/速度不同，取胜者 |

判断"能不能并行"的核心问题：**子任务的输出是否依赖于其他子任务的输出？** 不依赖就能并行；依赖必须串行（这时回到 Chaining）。

### 4.2 Fan-out 的最小实现

```python
async def fan_out(tasks, input_data, timeout=30):
    """并行执行多个独立子任务，等所有完成或超时"""
    coros = [task.run_async(input_data) for task in tasks]
    results = await asyncio.gather(*coros, return_exceptions=True)

    # 区分成功/失败
    success, failed = [], []
    for task, result in zip(tasks, results):
        if isinstance(result, Exception):
            failed.append((task.name, result))
        else:
            success.append((task.name, result))

    return {"success": success, "failed": failed}

# 使用示例：并行调三个信息源
results = await fan_out(
    tasks=[search_web, search_kb, search_news],
    input_data="2026 年 AI Agent 市场规模",
    timeout=30
)
```

`return_exceptions=True` 是关键——不让一个子任务失败拖垮整个并行批次。失败的子任务在 `failed` 中单独处理：可能是 retry、可能是 fallback、可能是直接忽略。

### 4.3 Map-Reduce 模式

处理超长文档、批量数据的标准模式：

```python
async def map_reduce(items, mapper, reducer, batch_size=10):
    """map: 每个 item 并行处理；reduce: 把所有结果聚合"""
    # Map 阶段：并行处理所有 items（分批以控制并发数）
    map_results = []
    for batch in batched(items, batch_size):
        batch_results = await asyncio.gather(*[mapper(item) for item in batch])
        map_results.extend(batch_results)

    # Reduce 阶段：聚合
    return await reducer(map_results)

# 使用示例：长文档总结
chunks = split_document(long_doc, chunk_size=2000)
summary = await map_reduce(
    items=chunks,
    mapper=lambda c: llm.summarize(c),
    reducer=lambda summaries: llm.synthesize("\n\n".join(summaries))
)
```

Map-Reduce 在 Agent 中最常见的两个用途：

| 用途 | Map 做什么 | Reduce 做什么 |
|------|----------|------------|
| 长文档处理 | 分块独立总结/提取 | 合并去重 + 重写为统一格式 |
| 多文档比较 | 每个文档独立打分 | 排序 + 综合判断 |

Map-Reduce 在 Agent 中最大的注意点是 **Reduce 阶段也是 LLM 调用**——Reduce 的输入是所有 Map 结果，可能超过单次上下文窗口。这时要做**分层 Reduce**：

```python
async def hierarchical_reduce(map_results, reducer, fanout=10):
    """分层 Reduce：每 fanout 个结果先合一次，直到能塞进单次 LLM 调用"""
    level = map_results
    while len(level) > fanout:
        # 把当前层分组、每组并行 reduce
        groups = [level[i:i + fanout] for i in range(0, len(level), fanout)]
        next_level = await asyncio.gather(*[reducer(g) for g in groups])
        level = next_level
    # 最后一层一次性 reduce
    return await reducer(level)

# 例：100 个 chunk 的总结
# Level 0: 100 个 → 10 组每组 10 个 → 10 个中间总结
# Level 1: 10 个 → 1 组 10 个 → 1 个最终总结
# 总共 10 + 1 = 11 次 reducer 调用，而不是想用 1 次塞 100 个塞不下
```

判断要不要分层：**Map 结果数 × 每个结果长度 > Reduce 模型 context 的 50%** 就该分层（留一半给 prompt 和输出）。每层 fanout 一般 5-15——太小会层数过多累积误差，太大会单次 context 接近上限。

### 4.4 Scatter-Gather：多源择优

```python
async def scatter_gather(sources, query, selector):
    """同时查多源，按 selector 策略选最佳结果"""
    coros = [src.query_async(query) for src in sources]
    results = await asyncio.gather(*coros, return_exceptions=True)

    valid = [r for r in results if not isinstance(r, Exception)]
    if not valid:
        return None
    return selector(valid)

# 使用示例：取最快返回的有效结果
result = await scatter_gather(
    sources=[google_search, bing_search, kb_search],
    query="GPT-5 发布时间",
    selector=lambda rs: max(rs, key=lambda r: r.relevance_score)
)
```

Scatter-Gather 的关键设计是 **selector 策略**：

| 策略 | 何时用 |
|------|-------|
| 取最快返回 | 容灾场景（任一源回来都行）|
| 取最高质量 | 准确率优先（综合评分挑最优）|
| 全部融合 | 召回优先（合并去重所有结果）|

### 4.5 并行的关键设计点

**并发数控制**。无脑 `asyncio.gather` 100 个任务会被 API 限流或耗尽连接池。生产实践是用 Semaphore 或分批：

```python
semaphore = asyncio.Semaphore(10)  # 最多 10 个并发

async def bounded_task(task, input_data):
    async with semaphore:
        return await task.run_async(input_data)
```

**Token 成本的隐藏面**。并行 N 个 LLM 调用意味着 N 倍的 token 消耗。Map-Reduce 处理 100 个 chunk = 100 次 Map LLM 调用 + 至少 1 次 Reduce LLM 调用。比 ReAct 串行处理快 N 倍，但**贵也是 N 倍**。

**部分失败的处理策略**。三种典型策略：

| 策略 | 含义 | 何时用 |
|------|------|------|
| All-or-Nothing | 任一失败则整体失败 | 子任务都关键，缺一不可 |
| Best-Effort | 失败的丢弃，成功的继续 | 子任务等价，部分结果可接受 |
| Fail-Open with Retry | 失败的单独 retry，最终 fallback | 关键子任务，但有降级路径 |

**确定性 vs 一致性**。并行调用 LLM 多次的结果可能不一致（即使温度=0，也可能因 batch 效应有微小差异）。如果 Reduce 阶段依赖 Map 结果的确定性顺序或一致性，要在 Reduce 时做去重和规范化。

---

## 5. 三种模式的组合：典型工作流

实际生产系统几乎都是三种模式的组合。一个完整的"信息综合"Agent 的工作流：

![信息综合 Agent 的典型工作流](/images/blog/agentic/typical-info-synthesis-flow.svg)

这个流里出现了本篇讲的三种模式——Routing（入口 + 子查询路由）、Parallelization（Fan-out + Map-Reduce）、Chaining（顺序综合）——再叠加一层独立的 Reflection 做兜底校验。这是大多数生产 Agent 系统的实际形态——**很少是纯 ReAct，几乎都是工作流编排**。

工作流编排和 ReAct 不是替代关系。工作流提供"骨架"，每个工作流节点内部仍然可以是一个小型 ReAct 循环。骨架决定"步骤拓扑"，ReAct 在每个节点内决定"如何完成这一步"。

---

## 6. 三种模式的踩坑指南

### 6.1 Routing 类

**反模式：用一个大 LLM 路由器路由所有请求**。每次入口都消耗一次 LLM 调用，对简单请求是浪费。应该规则 + 分类器先过一遍。

**反模式：路由 prompt 用自由文本输出**（"你应该用 RAG 还是 Tool？"）。LLM 会输出散文，需要正则匹配反解析，准确率低。必须用 enum schema。

**反模式：路由没有 confidence 阈值**。低 confidence 直接强行路由 = 错误路径执行 = 浪费下游资源 + 用户体验崩溃。

**反模式：所有路由都强行匹配最近类别**。Router 应该有 unsupported 或 ask_clarification 分支，而不是把 50% 不确定的请求强行塞到错误类别。

**反模式：路由策略静态化**。不监控路由分布、不分析路由错误率，路由会逐步偏离实际。Router 是需要持续优化的组件，要把 routing trace 接入评估系统。

### 6.2 Parallelization 类

**反模式：把有依赖的步骤强行并行**。step2 需要 step1 的输出，但被并行启动——step2 会用上一次的旧数据或空数据，产生静默错误。并行前必须确认依赖图。

**反模式：并行任务全部 `await asyncio.gather`，单点失败拖垮整批**。必须用 `return_exceptions=True`，区分成功失败分别处理。

**反模式：并发数无上限**。100 个并行 LLM 调用直接打满 rate limit，全部失败重试，比串行还慢。Semaphore 是底线。

**反模式：Reduce 阶段直接喂入所有 Map 结果给 LLM**。Map 结果加起来很容易超过上下文窗口。必须做分层 Reduce 或递归 Reduce。

**反模式：忽视并行的 token 成本**。"我把 ReAct 改成 Map-Reduce 加速了 10 倍"——但账单也涨了 10 倍。要权衡延迟与成本。

### 6.3 Chaining 类

**反模式：把 Chain 写成一坨 if-else**。维护到 5-6 步就读不懂了。用配置化的 Step 列表 + 通用的 runner，新增步骤只是加一个 Step 对象。

**反模式：Chain 失败时整体重跑**。第 5 步失败时不应该从第 1 步开始重跑——前 4 步的结果是确定的，应该有 checkpoint 机制，从失败的步骤继续。

**反模式：Chain 步骤间用全局变量传状态**。要用显式的 state 对象，每步声明读什么、写什么。这样可观测、可单步调试、可单步重试。

---

## 7. 工作流与 Agent 的边界

工作流编排做的事情很朴素：**把步骤拓扑从 LLM 的隐性决策里提到代码层**。这件事看起来不起眼，但它是 Agent 工程从个例 demo 走到批量生产的分水岭——拓扑显式之后，节点边界变成可观测、可测试、可优化的最小单元，问题能定位到具体节点而不是"模型表现不稳定"。

工作流是骨架层，**其他所有模式都在它的节点里发生**：工作流节点内部通常跑 Agent 控制循环、RAG 是 Fan-out 中常见的数据源、Planner 输出的子任务图直接对应 Fan-out + Chain 的拓扑、流行框架（LangGraph、CrewAI）的本质就是工作流引擎、节点边界天然是 trace span 和 Guardrail/HITL 介入的位置。把这些关系压成一句话：**工作流回答步骤拓扑，节点内回答这一步怎么完成**——前者是确定性的代码骨架，后者可以是确定性代码也可以是 LLM 推理。

Routing 和 Parallelization 各自解决一个真问题。Routing 解决"成本和质量的路径选择"——所有请求走最重路径是 Agent 成本爆炸最常见的原因，三层组合（规则、分类器、LLM 路由）能把流量精准分到对应成本档位；设计要点是 confidence 阈值和 unsupported 兜底，宁可承认"我不知道"，不要硬猜路径。Parallelization 解决"延迟的并行化"——但并行不是免费的，N 个并行 LLM 调用就是 N 倍 token 成本，决策时要同时盯延迟和账单。

生产 Agent 几乎都是 Chain + Routing + Parallelization 的组合，纯 ReAct 只是工作流节点内部的局部实现。多 Agent 协作很大程度上就是把这套模式从"单 Agent 内"放大到"多 Agent 间"——Supervisor 本质是 Router、Peer-to-Peer 本质是 Fan-out。把工作流当骨架、节点内当肌肉，比"一个大循环跑到底"鲁棒得多。