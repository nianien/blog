---
title: "记忆与RAG：Agent的认知存储"
pubDate: "2026-01-02"
description: "LLM 是无状态函数，Agent 必须有状态。本文给出 Agent 记忆的四层结构、各层的读写删伪代码、Chunking 到 Reranking 的完整 RAG 流水线，以及为什么 80% 的 RAG 质量问题在检索侧而非生成侧。"
tags: ["Agentic", "AI Engineering", "Memory", "RAG"]
series:
  key: "agentic"
  order: 4
author: "skyfalling"
---

LLM 是 stateless function——每次调用都"忘了上次"；Agent 必须 stateful，跨轮甚至跨会话保留信息。但记忆系统真正的难点不在"能记多少"——一个 8GB 的向量库存几百万条事实毫无压力。难点在结构：什么写在哪一层、什么时候读出来、什么时候删掉、不同层之间怎么协同。把这套结构想清楚，再展开 L4 语义记忆的具体形态——RAG 流水线的每一环为什么这么设计、80% 的质量问题为什么在检索侧不在生成侧。

---

## 1. Agent 为什么需要记忆

LLM 是 stateless function——同一个输入两次调用各自独立，不知道上次发生过什么。这在单轮问答可以接受，但当 LLM 嵌入 Agent 后立刻成为致命缺陷：

- 多轮对话："把上面那个改成蓝色"——"上面那个"在哪里？
- 长任务执行：Agent 跑到第 5 步，需要第 2 步的输出来做决策
- 跨会话连续性：昨天分析过的报告，今天问"上次的结论是什么？"
- 个性化：用户偏好（简洁、表格、Markdown）需要记住

工程上的根问题：在 LLM 这个 stateless function 之外，**构建一套 stateful 的记忆系统**，让 Agent 在有限的 context window 内获得"无限"的记忆能力。

这个问题在传统软件里有现成解法（数据库、缓存、文件系统），但 Agent 场景下有一个独特约束：**最终所有信息都要塞进 LLM 的 context window**。数据库里存了 100 万条记忆没用——LLM 一次能看到的只有 context window 那几万 token。所以记忆系统的工程难点不是"如何存"，而是"如何在合适的时机把合适的内容塞进合适的位置"。

这个独特约束有一个工程含义：**记忆系统的核心 API 不是 `get(key)` 和 `put(key, value)`，而是 `assemble_context(state, budget) → messages`**。前者关注存储，后者关注组装——后者才是 Agent 记忆系统的难点。

---

## 2. 四层记忆：从对话到知识

人脑的记忆分层（Atkinson-Shiffrin 模型）对 Agent 设计有强指导意义——不是所有信息都要记，记的方式和位置应该不同。

| 层 | 内容 | 生命周期 | 存储 |
|---|------|---------|------|
| **L1 对话缓冲** | 当前会话的完整 message history | 会话内 | 内存 / Redis |
| **L2 工作记忆** | 当前任务的结构化状态（计划、scratchpad、中间结果） | 任务内 | 内存 |
| **L3 情景记忆** | 过去交互的结构化记录（任务做过什么、教训、用户反馈） | 跨会话 | 向量库 |
| **L4 语义记忆** | 相对稳定的事实知识（产品文档、政策、SOP） | 长期 | 向量库 + 原文库（RAG） |

![四层记忆架构](/images/blog/agentic/llm-context-window.svg)

四层的边界：

- **L1 vs L2**：L1 是"说了什么"，L2 是"正在做什么"。L1 是消息序列，L2 是结构化状态。一个 10 步任务的中间结果塞 L1 会撑爆 context，塞 L2 才是正确做法。
- **L3 vs L4**：L3 是 Agent 自己积累的经验（"上次用户让我用这种方式失败了"），L4 是外部知识（"产品手册写明退货期 30 天"）。L3 写入是事件驱动，L4 更新是文档管理。

四层组合起来注入 LLM 的 context window，形成一次推理需要的全部信息。

### 各层的记录 Schema

四层记忆的记录结构差别很大，混用一个表存只会让查询变成噩梦。最小可用的 schema：

```python
# L1：对话缓冲——直接复用 OpenAI/Anthropic 的 message 协议
L1_Message = {
    "role": "user" | "assistant" | "tool" | "system",
    "content": str,
    "tool_calls": list | None,  # assistant 消息可能有
    "tool_call_id": str | None, # tool 消息必有
    "timestamp": int,
}

# L2：工作记忆——任务状态的结构化快照
L2_TaskState = {
    "task_id": str,
    "goal": str,
    "plan": list,              # 子步骤列表
    "current_step": int,
    "scratchpad": dict,        # 中间结果、推理痕迹
    "tool_results": dict,      # 已完成的工具调用结果
    "blocked_on": str | None,  # 当前阻塞点
}

# L3：情景记忆——可检索的经验记录
L3_Episode = {
    "id": str,
    "user_id": str,
    "summary": str,           # 自然语言摘要，会做 embedding
    "embedding": list[float],
    "kind": "preference" | "failure_lesson" | "success_pattern" | "tool_usage",
    "importance": float,      # 0-1，决定遗忘优先级
    "created_at": int,
    "last_accessed": int,
    "access_count": int,
}

# L4：语义记忆——文档块
L4_Chunk = {
    "id": str,
    "doc_id": str,
    "parent_chunk_id": str | None,  # Parent-Doc Retrieval 用
    "text": str,
    "embedding": list[float],
    "metadata": {
        "source": str,
        "title": str,
        "section_path": list[str],   # 标题层级
        "doc_version": str,
        "permissions": list[str],
    },
}
```

**关键设计点**：每个 schema 都有自己的索引需求——L1 按 session_id + timestamp 顺序读、L2 按 task_id 主键查、L3 按 embedding 做向量检索 + 按 importance/last_accessed 做遗忘判定、L4 按 embedding + metadata 过滤检索。四个表分开存、各自加索引，混用一个表会丢检索效率。

### 为什么是四层而不是其他数量

这个分层不是凭空设计的，而是反映了 Agent 任务的天然时间尺度：

| 时间尺度 | 信息类型 | 对应层 |
|--------|--------|------|
| 秒级 | 当前对话上下文 | L1 |
| 分钟级 | 任务执行的中间状态 | L2 |
| 天/周级 | 用户的历史交互模式 | L3 |
| 月/年级 | 业务知识、产品文档 | L4 |

每一层有不同的访问模式、不同的更新频率、不同的容量需求——把它们混在一起，要么短期信息淹没长期知识，要么长期知识被频繁更新搞乱。**分层不是为了优雅，是因为这四类信息的工程特性根本不同**。

---

## 3. 读：怎么组装上下文

每次 LLM 调用前，从四层里取出相关内容拼成 prompt。这是记忆系统最高频的操作，也是最容易出 bug 的环节。

### 上下文组装的伪代码

```python
def assemble_context(
    user_input: str,
    state: AgentState,
    budget: int = 8000,  # token 预算
) -> list[Message]:
    """从四层记忆里拼出一次 LLM 调用的 messages"""

    # 1. System Prompt：固定预算，永远保留
    system = render_system_prompt(state.agent_config)
    system_tokens = count(system)

    # 2. 检索 L3 + L4：按当前 query 找相关经验和知识
    retrieved = retrieve_relevant(
        query=user_input,
        sources=["L3_episodes", "L4_docs"],
        top_k=10,
        filter_by_permission=state.user.permissions,
    )
    reranked = rerank(query=user_input, candidates=retrieved, top_k=5)
    retrieval_block = format_retrieval(reranked)

    # 3. L2 任务状态：序列化为简洁文本，不要 dump 整个 JSON
    task_block = format_task_state(state.l2_task)

    # 4. L1 对话历史：压缩到剩余预算
    fixed_tokens = system_tokens + count(retrieval_block) + count(task_block)
    output_reserve = 1500          # 给 LLM 输出留空间
    history_budget = budget - fixed_tokens - count(user_input) - output_reserve

    history = compress_history(state.l1_messages, history_budget)

    return [
        system_msg(system),
        *history,
        context_msg(retrieval_block + task_block),  # 检索结果作为系统级注入
        user_msg(user_input),
    ]
```

这段伪代码里有四个值得注意的设计：

**System Prompt 永远不裁**。一旦丢失安全规则、工具描述，Agent 行为不可控。

**检索结果走系统级注入，而不是 user message**。模型对"system 给的事实"比"user 说的事实"信任度更高。把 RAG 结果伪装成用户说的话是反模式。

**L2 任务状态要做摘要**。直接 `json.dumps(task_state)` 会塞进大量字段 ID、时间戳，LLM 看不懂还浪费 token。要写一个`format_task_state`把状态翻译成自然语言："你正在执行任务 X，已完成步骤 1-3，当前在步骤 4，遇到的阻碍是 Y"。

**L1 压缩在最后才做**。先把固定预算扣掉，剩下多少才轮到 L1。L1 是"可压缩资源"，其他都是"不可压缩资源"。

### Token 预算的分配比例

| 部分 | 预算占比（8K context 示例） | 来源 |
|------|---------------------------|------|
| System Prompt | 15-20% | 静态配置 |
| L3 + L4 检索结果 | 25-30% | 按当前用户输入做语义检索 |
| L2 当前任务状态 | 10-15% | 序列化为文本 |
| L1 对话历史 | 25-30% | 滑动窗口或摘要 |
| 输出预留 | 15-20% | 留给生成 |

**关键原则**：System Prompt 永远保留不裁，输出预留不可省（不然 LLM 输出截断 JSON 导致解析失败）。压缩空间在 L1 对话历史，其次是检索结果。

---

## 4. 写：什么值得记住

不是所有交互都值得沉淀。**过度记忆比不记忆更糟**——记忆库噪声多了，检索质量下降，所有依赖记忆的决策都被污染。

写入规则按层不同：

| 层 | 写入时机 | 标准 |
|---|---------|------|
| L1 | 每条消息发生时 | 全部写，但有上限（滑动窗口） |
| L2 | 任务步骤完成时 | 全部写，任务结束清空或归档 |
| L3 | 任务完成或失败时 | 只写"有泛化价值"的——单次任务的具体数据不写，方法论才写 |
| L4 | 文档源变更触发 | 事件驱动重建索引，整个流水线独立于 Agent 运行 |

### L4 的写入：事件驱动的"隐形知识库"

L4 的写入策略和 L1/L2/L3 有本质区别——它不是 Agent 自己触发，而是**文档源的变更触发**。一个跑通的 L4 流水线大致这样：

```python
@on_event("confluence.page.updated")
def reindex_confluence_page(event):
    """Confluence 页面更新 → 增量重建对应 chunk"""
    doc = fetch_doc(event.page_id)
    # 旧 chunk 标记为 tombstone（不立即删，等查询验证）
    mark_chunks_as_stale(doc_id=event.page_id, version=event.old_version)
    # 解析 + 切块 + embedding + 入库
    chunks = chunking_pipeline(doc)
    embeddings = embed_batch([c.text for c in chunks])
    write_chunks_atomic(chunks, embeddings, doc_id=event.page_id, version=event.new_version)
    # 旧 chunk 被新 chunk 完全覆盖后才物理删除
    gc_stale_chunks(doc_id=event.page_id, older_than=event.new_version)

@on_event("github.pr.merged")
def extract_change_log(event):
    """PR 合入 → 提取变更说明作为新知识入 L4"""
    summary = llm.summarize(event.pr_description + event.commits)
    add_to_l4(text=summary, source=event.pr_url, kind="change_log")

@on_event("jira.issue.closed")
def harvest_faq(event):
    """工单关闭 → 抽取 question/answer 作为 FAQ 入 L4"""
    if event.resolution_quality >= "good":
        add_to_l4(text=f"Q: {event.summary}\nA: {event.resolution}", source=event.issue_url)
```

**事件驱动是核心设计**——靠员工"主动上传文档维护知识库"在企业里几乎注定失败（这是后面 §13 会再点的事实）。把 L4 写入挂到文档真实变更的事件上，知识库才能跟上业务。

L4 写入还有几个易踩的工程坑：**版本切换不能阻塞查询**（用 tombstone + 原子替换而非"先删后建"）、**Embedding 模型升级要全量重建**（旧向量和新查询不在同一空间）、**删除的内容要从向量库 + 缓存 + 搜索引擎多处真正删掉**（否则"已删除文档"仍能被检索到，造成合规风险）。

### L3 写入的决策伪代码

L3 是最微妙的——写多了污染、写少了浪费。一个工程上跑得通的判定逻辑：

```python
def should_write_to_l3(event: AgentEvent) -> tuple[bool, float, str]:
    """判断一次 Agent 事件是否值得写入 L3，返回 (是否写, 重要性, 类型)"""

    # 显式信号：高优先级
    if event.user_feedback == "positive" and event.task_completed:
        return True, 0.9, "success_pattern"
    if event.user_feedback == "negative":
        return True, 0.95, "failure_lesson"
    if event.kind == "preference_change":
        return True, 0.85, "preference"

    # 隐式信号：需要 LLM 判断
    if event.kind == "tool_usage" and event.is_first_time:
        # 第一次成功用某个工具的"方法论"值得记
        return True, 0.6, "tool_usage"

    # 失败信号：失败本身就有教学价值
    if event.task_failed and event.has_clear_root_cause:
        return True, 0.8, "failure_lesson"

    # 单次具体事实：不写
    return False, 0.0, ""
```

L3 的高门槛意味着情景记忆库不会无限膨胀——一个跑了半年的 Agent，L3 通常只有几千到几万条，远比 L1 的总消息数少。

### L3 写入的反模式

**把整段对话内容当 L3 写** — 这是 L1 的工作。L3 应该写"从这次对话学到的可迁移规律"。

**写得太具体** — "用户问了订单 #12345 的状态" 不该进 L3。"用户偏好按订单状态分组展示" 才进 L3。

**没有去重** — 同一条经验如果被反复触发写入，会让该规律被检索得过频。写入前要做语义去重——查一下 L3 里有没有相似的记录，有就更新 access_count 和置信度而不是新增。

```python
def write_l3(episode: L3_Episode):
    # 语义去重：检查是否已有近似经验
    existing = vector_search(episode.embedding, top_k=3, threshold=0.85)
    if existing:
        # 合并而不是新增——加强已有经验
        existing[0].importance = min(1.0, existing[0].importance + 0.05)
        existing[0].access_count += 1
        existing[0].last_accessed = now()
        update_l3(existing[0])
        return
    # 新经验
    insert_l3(episode)
```

---

## 5. 删：遗忘也是必要的

没有遗忘机制的记忆库最终会被噪声淹没。三种遗忘策略可组合：

| 策略 | 触发 | 删除什么 |
|------|------|---------|
| 时间衰减 | 超过 N 天 | 重要性 < 0.7 且最后访问 > 30 天前的记录 |
| 容量驱逐 | 总条数超上限 | 按"重要性 × 时间新鲜度 × 访问频率"综合排序，删最低分 |
| 显式遗忘 | 用户要求 / 隐私合规 | 指定的记录 |

### 容量驱逐的评分公式

```python
def memory_score(record: L3_Episode, now_ts: int) -> float:
    """综合分数越低越优先删除"""
    age_days = (now_ts - record.created_at) / 86400
    recency_days = (now_ts - record.last_accessed) / 86400

    # 时间新鲜度：用 exp 衰减
    freshness = math.exp(-recency_days / 30)  # 30 天半衰期

    # 访问频率：log 防止过度奖励高频项
    frequency = math.log1p(record.access_count)

    return record.importance * freshness * frequency

def evict_if_needed(capacity: int = 100_000):
    total = count_l3_records()
    if total <= capacity:
        return
    # 按分数升序排，删最低的 N 条
    to_delete = top_k_lowest(score_fn=memory_score, k=total - capacity)
    soft_delete(to_delete, reason="capacity_eviction")
```

**软删除而非硬删除**——支持回滚，避免误删。每次遗忘要记录原因和时间戳，便于审计。

### 遗忘的反直觉点

很多 Agent 团队不做遗忘，因为"删信息感觉是损失"。但实际上：**L3 的检索质量随条数 N 不是线性增长，是先升后降**——少了无内容可检索、多了语义相似的记录互相挤压排名、查准率下降。一个 50 万条的 L3 库未必比 5 万条的更好用，因为信噪比下降得比检索召回率上升得快。所以遗忘机制不是"为节省存储"，是"为维持检索质量"。

---

## 6. L4 语义记忆的工程实现：RAG

RAG（Retrieval-Augmented Generation）是 L4 的具体实现。但 RAG 不是"搜索+拼接"——这种理解会让系统质量天花板极低。

**80% 的 RAG 质量问题在检索侧，不在生成侧**。换更贵的模型不如把检索做好。

这个判断有一个朴素的原因：**LLM 没拿到的信息它就答不出来，拿到了错的信息它就编出错的答案**。检索阶段的失败（漏检、错检）会直接体现为生成阶段的失败（不知道、瞎编）。反过来，生成阶段的问题（输出格式不对、引用不准）通常是 prompt 工程问题，不是模型能力问题。**所以 RAG 项目调优的本质是检索调优**——绝大部分 PoC 阶段表现差的 RAG 项目，问题都在 chunking、embedding、retrieval、rerank 这条链路上。

RAG 的完整流水线分两条链：

| 链 | 阶段 | 关键决策 |
|---|------|---------|
| **离线索引** | 文档解析 → Chunking → Embedding → 入向量库 | 怎么切、用什么 embedding、怎么分区 |
| **在线检索** | Query 改写 → 混合检索 → Reranking → Context Packing → 生成 | 用什么检索、怎么排序、怎么注入 |

![RAG 全景](/images/blog/agentic/rag-pipeline.svg)

下面四节展开每个关键决策。

---

## 7. Chunking：切得不好，后面全废

Chunking 是最被低估、对质量影响最大的环节。切分策略直接决定：

- 检索时能否命中相关内容
- 命中的内容是否包含足够上下文
- LLM 拿到的信息有多少噪声

| 策略 | 思路 | 问题 |
|------|------|------|
| 固定长度 | 按字符数等间隔切 | 完全不考虑语义边界，会把句子切成两半 |
| 语义切分 | 按段落、标题、代码块 | 块大小不均，依赖文档格式规范 |
| 递归切分 | 先按大边界（\n\n），切不动再用小边界（\n、.） | 平衡了语义和大小，是 LangChain `RecursiveCharacterTextSplitter` 的核心思路 |

### 递归切分的伪代码

```python
def recursive_split(text: str, max_size: int = 512, overlap: int = 50) -> list[str]:
    """递归切分：先按大边界切，块仍然过大就用更小的边界继续切"""
    separators = ["\n\n", "\n", "。", "！", "？", ". ", "; ", " "]

    if len(text) <= max_size:
        return [text]

    for sep in separators:
        if sep in text:
            parts = text.split(sep)
            chunks, buf = [], ""
            for p in parts:
                p = p + sep
                if len(buf) + len(p) <= max_size:
                    buf += p
                else:
                    if buf:
                        chunks.append(buf)
                    if len(p) > max_size:
                        # 单个 part 还太大，递归切
                        chunks.extend(recursive_split(p, max_size, overlap))
                        buf = ""
                    else:
                        buf = p
            if buf:
                chunks.append(buf)
            return add_overlap(chunks, overlap)

    # 所有分隔符都没用，只能硬切
    return [text[i : i + max_size] for i in range(0, len(text), max_size - overlap)]
```

### Parent-Document Retrieval

当前公认最有效的落地技巧：**用小 chunk 做检索，用大 chunk 给模型**。小 chunk（~200 tokens）语义集中、检索准；命中后返回 parent chunk（~2000 tokens）让模型看到完整上下文。解决了"切大不准、切小不够"的两难。

```python
def index_with_parents(doc: str):
    """双层 chunking：小 chunk 用于检索，大 chunk 用于喂模型"""
    parents = recursive_split(doc, max_size=2000, overlap=200)
    for parent in parents:
        parent_id = save_chunk(parent, role="parent")
        children = recursive_split(parent, max_size=200, overlap=20)
        for child in children:
            save_chunk(child, role="child", parent_id=parent_id, embedding=embed(child))

def retrieve_with_parents(query: str, top_k: int = 5):
    """检索时取 child，返回 parent"""
    child_hits = vector_search(query, role="child", top_k=top_k * 3)
    parent_ids = unique([c.parent_id for c in child_hits])[:top_k]
    return load_chunks(parent_ids)
```

**Chunk overlap**：相邻 chunk 重叠 10-20% 防止边界信息丢失。一个 512 token 的 chunk 配 50-100 token overlap 是合理起点。

### 文档解析的三档

| 档 | 工具 | 适用 |
|---|------|------|
| 规则解析 | PyMuPDF、python-docx、BeautifulSoup | 标准格式，速度快、成本低 |
| 布局感知 | unstructured、docling | 复杂排版、扫描件 |
| 多模态模型 | GPT-4o、Claude 直接读截图 | 极端复杂表格、手写 |

实际选型：第一档打底 + 第二档兜底；只有第一档失败的文档（扫描件、复杂表格）走第三档。

**文档解析是 RAG 项目最常被低估的环节**。一份格式良好的 PDF 用 PyMuPDF 解析能得到结构化文本；同一份 PDF 经过扫描就需要 OCR；带复杂表格的报告即使是原生 PDF 也常常解析出错位的文字。企业场景中，"知识库里 30% 的文档解析质量不达标"是常态。解析质量直接决定后续 chunking 的边界是否合理——边界都不对，再好的 embedding 也救不了。

---

## 8. 检索：单一策略都有盲区

| 策略 | 优势 | 盲区 |
|------|------|------|
| BM25（关键词） | 精确匹配，专有名词、ID、错误码 | 不理解语义，"提升吞吐"匹配不到"提高 QPS" |
| Vector Search（语义） | 同义词、意图理解 | 不擅长精确匹配，"4012"和"4013"难区分 |
| Hybrid（混合） | 两者优势叠加 | 实现复杂度更高，需要融合算法 |

### 混合检索的 RRF 伪代码

**生产系统默认 Hybrid**。融合用 RRF（Reciprocal Rank Fusion）——不关心绝对分数，只关心排名：

```python
def hybrid_retrieve(query: str, top_k: int = 20, k: int = 60) -> list[Chunk]:
    """BM25 + Vector，用 RRF 融合排名"""
    bm25_hits = bm25_search(query, top_k=top_k * 2)       # [(chunk, rank), ...]
    vector_hits = vector_search(query, top_k=top_k * 2)

    scores = defaultdict(float)
    for hits in (bm25_hits, vector_hits):
        for rank, hit in enumerate(hits, start=1):
            # RRF 公式：1 / (k + rank)
            scores[hit.id] += 1 / (k + rank)

    # 按融合分数排序，取 top_k
    sorted_ids = sorted(scores.keys(), key=lambda x: -scores[x])[:top_k]
    return load_chunks(sorted_ids)
```

RRF 的好处是不需要在 BM25 分数（一般 5-30）和 Cosine 分数（0-1）之间做归一化——它只看排名。k 常取 60，是经验值。

只有非常确定场景只需要语义搜索（纯自然语言文档、无 ID）才用纯 Vector。

### Query 改写：别直接拿用户原话去检索

用户的提问往往不适合直接检索——太短、太模糊、术语不一致。常见改写策略：

| 策略 | 做法 | 适用 |
|------|------|------|
| **HyDE** | 让 LLM 先生成假设答案，用答案去检索 | 用户问题和文档措辞差异大 |
| **Query Expansion** | LLM 把用户口语扩展为 3-5 个同义检索词 | 术语不统一的企业场景 |
| **Query Decomposition** | 复合问题拆成子问题分别检索 | 多维度复杂问题 |
| **Step-back** | 抽象为更泛化的查询 | 具体问题在文档中没有直接答案 |

Query 改写的 Prompt 模板示例：

```text
你是一个搜索查询改写助手。把用户的自然语言提问改写为 3 个不同角度的搜索查询，
用于检索企业知识库。

要求：
- 每个查询 5-15 个词
- 覆盖不同的同义词、术语、抽象层级
- 至少包含一个使用专业术语的版本
- 输出 JSON：{"queries": ["q1", "q2", "q3"]}

用户原问题：{user_question}
```

---

## 9. Reranking：从召回到精排

初步检索的目标是**高召回率**——把相关文档都捞出来，但排在前面的不一定最相关。Reranking 用更强的模型对 Top-50 做精排选出 Top-5。

![Bi-encoder vs Cross-encoder](/images/blog/agentic/encoder-comparison.svg)

| 维度 | Bi-encoder（初检索） | Cross-encoder（Reranker） |
|------|-------------------|------------------------|
| 编码方式 | Query 和 Doc 独立编码 | Query 和 Doc 拼接后一起编码 |
| 速度 | 快，Doc 可离线预计算 | 慢，每对都要实时算 |
| 精度 | 中 | 高，能捕捉 Query 和 Doc 的 token 级交互 |
| 用法 | 海量候选粗筛 | 少量候选精排 |

### 两阶段检索的伪代码

```python
def retrieve_with_rerank(
    query: str,
    initial_k: int = 50,
    final_k: int = 5,
) -> list[Chunk]:
    """两阶段检索：粗排 + 精排"""
    # 第一阶段：Hybrid 召回 50 个候选
    candidates = hybrid_retrieve(query, top_k=initial_k)

    # 第二阶段：Cross-encoder Reranker 精排
    pairs = [(query, c.text) for c in candidates]
    rerank_scores = cross_encoder.score(pairs)  # 例如 BGE-Reranker-v2

    # 按 rerank 分数取 top final_k
    ranked = sorted(zip(candidates, rerank_scores), key=lambda x: -x[1])
    return [c for c, _ in ranked[:final_k]]
```

Reranker 选型：精度优先用 Cohere Rerank 或 BGE-Reranker-v2，成本优先用小参数量 Cross-encoder。

### Reranker 的成本考虑

Reranker 每次要算 N 个 (query, doc) 对——50 个候选就是 50 次推理。Cross-encoder 比 Bi-encoder 慢 10-100 倍，所以**只在小批量上用**。直接对全库做 reranking 是噩梦：100 万文档 = 100 万次推理。两阶段架构（Bi-encoder 粗排 → Cross-encoder 精排）正是为了规避这个问题。

---

## 10. Context Packing：信息怎么送达 LLM

检索+重排后拿到 Top-K chunks，接下来是怎么组织送进 prompt。这一步直接决定 LLM 信息利用率。

### Lost in the Middle 现象

Stanford 2023 年的论文《Lost in the Middle: How Language Models Use Long Contexts》（Liu et al., arXiv:2307.03172）通过 NaturalQuestions 数据集系统测量了多个商业 LLM——在 20 个文档的 context 中，把"含答案的文档"放在不同位置时模型回答准确率呈 U 型分布：放在开头约 75%、放在结尾约 65%、放在中间最低约 50%。这意味着：**最相关的文档应该放开头或结尾，不放中间**。这个现象后续在 GPT-4、Claude、Gemini 各代模型上都被独立复现，是 RAG 工程的稳定假设而非短期 bug。

![Lost in the Middle](/images/blog/agentic/lost-in-middle.svg)

两种排布策略：

| 策略 | 排序 | 适合 |
|------|------|------|
| Relevance-first | 按相关性降序排列 | 上下文较短（< 5 chunks） |
| Edges-first | 最相关放头尾，次相关放中间 | 上下文较长（≥ 5 chunks） |

### Edges-first 的伪代码

```python
def edges_first_arrange(chunks: list[Chunk]) -> list[Chunk]:
    """最相关放两端，次相关放中间"""
    # 输入按相关性已排序：chunks[0] 最相关
    n = len(chunks)
    result = [None] * n
    left, right = 0, n - 1
    for i, chunk in enumerate(chunks):
        if i % 2 == 0:
            result[left] = chunk
            left += 1
        else:
            result[right] = chunk
            right -= 1
    return result
# 5 个 chunks 按相关性 [1,2,3,4,5] → 排列为 [1, 3, 5, 4, 2]
```

### Token 预算的硬约束

```python
def pack_context(chunks: list[Chunk], budget: int = 3000) -> str:
    """按 token 预算打包检索结果"""
    packed = []
    used = 0
    for chunk in chunks:
        chunk_tokens = count(chunk.text)
        if used + chunk_tokens > budget:
            break  # 宁可少放，不要截断
        packed.append(chunk)
        used += chunk_tokens

    arranged = edges_first_arrange(packed)
    return format_with_citations(arranged)

def format_with_citations(chunks: list[Chunk]) -> str:
    """给每个 chunk 加来源标识，方便 LLM 生成 citation"""
    return "\n\n".join([
        f"[Source {i+1}: {c.metadata.title}#{c.metadata.section_path[-1]}]\n{c.text}"
        for i, c in enumerate(chunks)
    ])
```

宁可少放几个 chunk、每个完整，也**不要截断 chunk 送进去**——被截断的信息比没有更糟。给每个 chunk 附来源标识，方便 LLM 生成 citation。

---

## 11. RAG 评估：检索侧的特有指标

**不可度量则不可改进**。这里只讲 RAG 流水线特有的检索侧指标——Agent 整体的评估体系（任务完成度、轨迹质量、LLM-as-Judge 的偏差与校准、Quality Gate）是独立的工程话题，本节不展开。

RAG 评估覆盖检索和生成两侧：

| 侧 | 指标 | 含义 |
|---|------|------|
| 检索 | Recall@K | Top-K 中召回了多少相关文档 |
| 检索 | MRR | 第一个相关结果的排名倒数 |
| 检索 | NDCG@K | 考虑位置权重的排序质量 |
| 生成 | Faithfulness | 回答是否忠于检索上下文（不编造） |
| 生成 | Answer Relevancy | 回答与原问题的相关性 |
| 生成 | Context Relevancy | 上下文与问题的相关性 |

### Faithfulness 的 LLM-as-Judge 模板

Faithfulness 是最关键的——检索回来的内容对的，但 LLM 基于这些内容编造了一个看似合理实际错误的回答，比没找到信息更危险。Faithfulness 评估的 prompt 骨架：

```text
你是一个事实核查员。判断下面的"回答"是否完全基于"上下文"。

规则：
1. 拆解回答为原子陈述（atomic claim），逐条核查
2. 每条 claim 必须在 context 中有明确依据
3. 推论、扩展、举例如果 context 没有支持，也算不忠实
4. 输出每条 claim 的核查结果

上下文：
{retrieved_context}

回答：
{generated_answer}

输出 JSON：
{
  "claims": [
    {"claim": "...", "supported": true|false, "evidence": "context 中的原文" }
  ],
  "faithfulness_score": <supported claims 数 / 总 claim 数>,
  "unsupported_claims": ["..."]
}
```

### 评估的工程流程

```python
def run_rag_eval(test_set: list[TestCase]) -> EvalReport:
    """跑一遍评估集，比较当前 pipeline 与基线"""
    results = []
    for case in test_set:
        retrieved = retrieve_with_rerank(case.question)
        answer = generate(case.question, retrieved)

        results.append({
            "case_id": case.id,
            "recall_at_5": metric_recall(retrieved, case.gold_docs, k=5),
            "mrr": metric_mrr(retrieved, case.gold_docs),
            "faithfulness": llm_judge_faithfulness(answer, retrieved),
            "answer_relevancy": llm_judge_relevancy(answer, case.question),
        })
    return aggregate(results)
```

实操：建 50-100 条的评估集（question + ground truth），每次 Pipeline 变更（换 Embedding、调 Chunking、加 Reranker）跑一轮，关注指标变化方向而非绝对数值。**绝对数值不重要，重要的是变化方向**——一次实验如果 Recall 升 5%、Faithfulness 持平、Answer Relevancy 升 3%，就值得上线；如果 Recall 升但 Faithfulness 下降，说明召回了更多噪声、得不偿失。

---

## 12. RAG 与 Long Context 的关系

2024-2025 年最常被问的：Gemini 支持 1M+ tokens、Claude 200K、GPT-4o 128K，还需要 RAG 吗？

需要，但定位变了。

| 维度 | Long Context | RAG |
|------|-------------|-----|
| 数据规模 | 几十万字以内 | 几百万到亿级字 |
| 成本 | 按 token 计费，塞越多越贵 | 检索成本低，只送相关片段 |
| 精度 | 大海捞针仍有盲区（中间位置） | 检索质量可控可调 |
| 权限 | 全塞进去无法做细粒度权限 | 可按用户/角色过滤 |
| 更新 | 每次请求都要重新塞 | 知识库持久化，增量更新 |

**互补不是替代**：Long Context 适合"少量文档的深度理解"，RAG 适合"海量知识的精准检索"。实际工程中两者常组合——RAG 从百万文档中筛 Top-K 片段，Long Context 让模型深度理解这些片段。

一个常见的误判是"Long Context 让 RAG 过时了"。这个说法表面成立——既然能塞 1M token 进去为什么还要检索？深入看会发现四个事实让它站不住：

**成本随长度线性增长**。Gemini 1.5 Pro 输入定价（截至 2026 年初）约 $1.25/1M token（≤128K）、$2.50/1M token（>128K），1M token 的单次调用约 $2.50。一个日均 10 万次的请求路径上塞满 1M token，每月几乎是 $750K。RAG 把每次请求的输入压到 5-20K，成本是 Long Context 路径的 1-3%。

**大海捞针测试在公开 benchmark 上效果很好，但在企业实际文档上表现远不如想象**。Needle-in-Haystack 是把单条已知信息插入随机文本里——这种"信号 vs 噪声完全独立"的设置在真实企业文档中根本不存在。真实文档里充满表格、引用、专业术语、版本号、近似但不相同的语句——这些都是"非噪声"但也"非答案"，会把 attention 真正分散掉。Anthropic 在 2024 年公开过 Claude 在"修改版 needle-in-haystack"（信号被语义近似项干扰）上的下降——准确率在 64K+ 区段下降 20-40 个百分点。

**Attention 在长序列上有效性递减**。即使模型能"看到"所有内容，也不代表能"用好"所有内容。这跟 Lost in the Middle 是同一回事——中间区域的有效利用率显著低。1M context 里如果关键事实在 50 万 token 位置，被有效使用的概率显著低于在前 10 万 token 内。

**权限隔离和增量更新在 Long Context 下都做不了**。你不可能为每个用户单独维护一个 100 万 token 的 prompt——租户隔离需要按角色过滤的能力，这只能在检索层做。文档更新也不可能让"每次请求都重新塞 1M token"——必须有增量索引机制，这也是 RAG 的能力。

**未来的趋势是更长的 context 加上更聪明的检索，而不是 context 取代检索**。Long Context 让"少量但要深读"的场景变好，但"海量、可过滤、增量更新、按权限隔离"的场景永远是 RAG 的主场。

---

## 13. 让 RAG 死在生产环境的六个细节

| 现实 | 后果 | 应对 |
|------|------|------|
| 文档解析丢失结构（标题层级、表格行列） | 检索时无法做结构化过滤 | 用布局感知解析，保留元数据 |
| 同一文档多个版本被索引 | 检索结果矛盾 | content hash 去重 |
| Embedding 模型升级 | 旧向量与新查询不在同一空间 | 换模型必须全量重建索引 |
| 删了文档但还能搜到 | 向量库逻辑删除 + 缓存导致"僵尸数据" | 删除后主动验证 + 定期 vacuum |
| 企业文档里的表格 | 纯文本化丢行列关系 | Markdown 化 → HTML 化 → Vision 解析逐级降级 |
| 流程图、架构图被跳过 | 大量信息丢失（技术文档 40% 信息在图中） | Captioning 把图转文字，或多模态 Embedding |

**企业 RAG 项目真正的死亡原因不是技术——是没人维护知识库**。员工不会主动上传文档、更新版本。更好的方向是事件驱动的"隐形知识库"：Confluence 页面更新触发重新索引、Git PR 合入提取变更说明、Jira 工单关闭沉淀为 FAQ。

---

## 14. 记忆是结构问题，不是容量问题

记忆系统的核心难题从来不是"能记多少"——一个 8GB 的向量数据库存几百万条事实毫无压力。难题是**结构**：什么写在哪一层、什么时候读、什么时候删、不同层之间怎么协同。L1 对话缓冲解决"刚说过什么"、L2 工作记忆解决"这个任务我做到哪了"、L3 情景记忆解决"以前类似情况怎么处理的"、L4 语义记忆解决"领域知识是什么"——四层各自的访问频率、更新频率、容量需求都不同，混在一起就是灾难。

语义记忆的工程形态是 RAG，但 RAG 不是"搜索+拼接"那么简单——它是 Chunking、Embedding、混合检索、Reranking、Context Packing 的完整流水线，每一环都有自己的失败模式。质量瓶颈 80% 在检索侧而不是生成侧——这就是为什么 RAG 项目调优的本质是检索调优，换大模型基本无效。

Long Context 不会让 RAG 过时——它会让检索从"必须做"变成"几个场景下也许可以不做"。但只要你还需要权限隔离、低延迟、按场景动态加载知识，RAG 的位置就稳得很。