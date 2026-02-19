---
title: "Memory Architecture: Agent 的状态与记忆体系"
description: "LLM 是无状态的，但 Agent 必须有状态。本文系统拆解 Agent 记忆的四层架构——Conversation Buffer、Working Memory、Episodic Memory、Semantic Memory，从认知科学类比出发，深入每一层的设计原理、存储方案、读写策略与 Context Window 管理，附完整 Python 实现。"
pubDate: "2026-01-02"
tags: ["Agentic", "AI Engineering", "Memory"]
---

# Memory Architecture: Agent 的状态与记忆体系

> LLM 是一个纯函数：给定相同的 prompt，产生相同的输出。它没有"昨天"，没有"上次"，没有"你之前说过"。
>
> 但一个合格的 Agent 必须记得：用户的偏好、上一步的结果、三天前那个失败的任务、以及从知识库中检索到的关键事实。
>
> 记忆，是 Agent 从"单轮工具"变成"持续助手"的分水岭。本文是 Agentic 系列第 08 篇，将系统拆解 Agent 记忆的四层架构，从认知科学类比到工程实现，给出完整的设计方案。

---

## 1. 为什么 Agent 需要记忆

LLM 的本质是一个 **stateless function**：`response = llm(prompt)`。每次调用都是一个全新的开始，模型不知道上一次调用发生了什么。

这在单轮问答场景下没有问题。但当我们把 LLM 嵌入 Agent 系统后，**无状态**就成了致命缺陷：

- **多轮对话**：用户说"把上面那个改成蓝色"——"上面那个"在哪里？
- **长任务执行**：Agent 执行到第 5 步，需要回顾第 2 步的输出来做决策
- **跨会话连续性**：用户昨天让 Agent 分析了一份报告，今天问"上次那份报告的结论是什么？"
- **个性化服务**：Agent 需要记住用户偏好（"我喜欢简洁的回答"、"输出用 Markdown 表格"）

没有记忆的 Agent，每次对话都是一个"失忆症患者"——它可能很聪明，但永远无法建立连续的工作关系。

**核心命题：如何为一个 stateless 的 LLM 构建一套 stateful 的记忆体系，使 Agent 在有限的 Context Window 内，获得"无限"的记忆能力？**

---

## 2. 从认知科学看 Agent 记忆

在设计 Agent 记忆架构之前，先看看人类大脑是怎么处理记忆的。认知心理学中 Atkinson-Shiffrin 模型把人类记忆分为多个层级，这个分层对 Agent 设计有极强的指导意义。

```
┌─────────────────────────────────────────────────────────────────────┐
│                    人类记忆 vs Agent 记忆                            │
├─────────────────┬──────────────────┬────────────────────────────────┤
│   人类记忆层级    │   Agent 对应       │   特征                        │
├─────────────────┼──────────────────┼────────────────────────────────┤
│ 感觉记忆         │ 当前输入           │ 极短暂，未经处理的原始信息        │
│ (Sensory)       │ (User msg/Tool)  │ 持续 < 1秒 / 单次请求           │
├─────────────────┼──────────────────┼────────────────────────────────┤
│ 工作记忆         │ Context Window   │ 容量有限，正在处理的信息           │
│ (Working)       │ (~128K tokens)   │ 持续几秒 / 单次 LLM 调用         │
├─────────────────┼──────────────────┼────────────────────────────────┤
│ 短期记忆         │ 会话状态           │ 当前任务上下文，可被覆写          │
│ (Short-term)    │ (Session state)  │ 持续分钟~小时 / 单次会话          │
├─────────────────┼──────────────────┼────────────────────────────────┤
│ 长期记忆-情景     │ 历史交互记录        │ 过去的经验，可被检索              │
│ (Episodic)      │ (Task history)   │ 持续天~月 / 跨会话               │
├─────────────────┼──────────────────┼────────────────────────────────┤
│ 长期记忆-语义     │ 知识库             │ 结构化知识，相对稳定              │
│ (Semantic)      │ (Knowledge/RAG)  │ 持续月~年 / 持久化               │
└─────────────────┴──────────────────┴────────────────────────────────┘
```

这个类比的价值在于：

1. **分层处理**：不是所有信息都需要"记住"，大部分感觉输入会被丢弃
2. **容量约束**：工作记忆（Context Window）的容量是硬性限制，必须在这个限制内做信息的取舍
3. **编码与检索**：信息从短期记忆进入长期记忆需要"编码"（写入），使用时需要"检索"（读取）
4. **遗忘是特性**：遗忘不是 bug，而是一种必要的信息过滤机制

基于这个认知框架，我们设计 Agent 的四层记忆架构。

---

## 3. Agent 记忆的四层架构

```
                         ┌──────────────────────┐
                         │     LLM Context       │
                         │      Window           │
                         │  ┌────────────────┐   │
                         │  │ System Prompt  │   │
                         │  ├────────────────┤   │
    ┌─────────────┐      │  │ Memory Inject  │◄──┼──── Layer 3: Episodic Memory
    │  User Input  │─────►│  ├────────────────┤   │     (向量数据库 / 关系数据库)
    │  Tool Output │      │  │ Working Memory │◄──┼──── Layer 2: Working Memory
    └─────────────┘      │  ├────────────────┤   │     (任务状态 / Scratchpad)
                         │  │ Conv. History  │◄──┼──── Layer 1: Conversation Buffer
                         │  ├────────────────┤   │     (消息历史 / 滑动窗口)
                         │  │ Tool Schemas   │   │
                         │  └────────────────┘   │        Layer 4: Semantic Memory
                         └──────────┬───────────┘        (知识库 / RAG)
                                    │                          │
                                    │    ┌────────────────┐    │
                                    └───►│  LLM Response   │◄───┘
                                         └────────────────┘
```

### Layer 1: Conversation Buffer — 对话历史

**本质**：保存完整的 message history，让 LLM 能"看到"之前的对话。

这是最直觉的记忆形式：把所有 `user` 和 `assistant` 消息按顺序存起来，每次调用 LLM 时全量传入。

```python
class ConversationBuffer:
    """最简单的对话记忆：完整保存消息历史"""

    def __init__(self, max_tokens: int = 8000):
        self.messages: list[dict] = []
        self.max_tokens = max_tokens

    def add(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})
        self._enforce_limit()

    def get_messages(self) -> list[dict]:
        return list(self.messages)

    def _enforce_limit(self):
        """当超出 token 限制时，从最旧的消息开始裁剪"""
        while self._estimate_tokens() > self.max_tokens and len(self.messages) > 2:
            # 保留第一条（通常包含重要上下文）和最后一条
            self.messages.pop(1)

    def _estimate_tokens(self) -> int:
        # 粗略估算：1 token ≈ 4 chars (英文) 或 1.5 chars (中文)
        return sum(len(m["content"]) // 3 for m in self.messages)
```

**问题与解决方案**：

| 问题 | 影响 | 解决方案 |
|------|------|---------|
| Context Window 有限 | 消息多了装不下 | 滑动窗口：只保留最近 N 条 |
| 旧消息价值不均 | 早期关键信息被丢弃 | 消息摘要：用 LLM 压缩旧消息 |
| Token 成本线性增长 | 每轮调用的 token 越来越多 | 选择性保留：只保留有工具调用或关键决策的消息 |

**滑动窗口 + 摘要**是最常见的策略：

```python
class SummarizingBuffer:
    """带摘要能力的对话缓冲区"""

    def __init__(self, llm_client, window_size: int = 20, max_tokens: int = 8000):
        self.llm_client = llm_client
        self.window_size = window_size
        self.max_tokens = max_tokens
        self.messages: list[dict] = []
        self.summary: str = ""  # 旧消息的压缩摘要

    def add(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})
        if len(self.messages) > self.window_size:
            self._compress()

    def get_messages(self) -> list[dict]:
        result = []
        if self.summary:
            result.append({
                "role": "system",
                "content": f"[Previous conversation summary]\n{self.summary}"
            })
        result.extend(self.messages)
        return result

    def _compress(self):
        """将窗口外的消息压缩为摘要"""
        # 取出要压缩的消息（保留最近 window_size 条）
        to_compress = self.messages[:-self.window_size]
        self.messages = self.messages[-self.window_size:]

        # 用 LLM 生成摘要
        old_context = "\n".join(
            f"{m['role']}: {m['content']}" for m in to_compress
        )
        prompt = (
            f"Summarize this conversation history concisely, "
            f"preserving key decisions, facts, and user preferences:\n\n"
            f"Previous summary: {self.summary}\n\n"
            f"New messages:\n{old_context}"
        )
        self.summary = self.llm_client.complete(prompt)
```

**关键决策点**：摘要的质量直接决定 Agent 的"记忆保真度"。摘要太短会丢失关键信息，太长又失去压缩的意义。实践中，摘要长度控制在原文的 20%-30% 是比较好的平衡点。

---

### Layer 2: Working Memory — 任务执行状态

**本质**：当前任务的"草稿纸"，记录正在进行的工作的结构化状态。

Conversation Buffer 保存的是"说了什么"，Working Memory 保存的是"正在做什么"。两者的核心区别：

```
Conversation Buffer:                Working Memory:
┌─────────────────────┐            ┌─────────────────────────────┐
│ user: 帮我分析这份数据 │            │ current_goal: 分析销售数据      │
│ assistant: 好的...   │            │ completed_steps:               │
│ user: 用柱状图展示    │            │   - 读取 CSV ✓                │
│ assistant: ...       │            │   - 清洗缺失值 ✓               │
│ tool: [read_csv...]  │            │ next_step: 生成柱状图           │
│ ...                  │            │ scratchpad:                    │
│ (线性的消息流)         │            │   - 数据有 1000 行, 15 列       │
└─────────────────────┘            │   - 销售额列有 3% 空值          │
                                   │   - 日期范围: 2024-01 ~ 2024-12 │
                                   └─────────────────────────────┘
```

Working Memory 的价值在长任务中尤为明显。当 Agent 执行一个需要 10+ 步的任务时，把所有中间结果都塞在对话历史里是低效的。Working Memory 提供了一个结构化的"任务视图"。

```python
from dataclasses import dataclass, field
from typing import Any
from enum import Enum

class StepStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

@dataclass
class TaskStep:
    description: str
    status: StepStatus = StepStatus.PENDING
    result: Any = None
    error: str | None = None

@dataclass
class WorkingMemory:
    """当前任务的执行状态"""

    goal: str = ""
    plan: list[TaskStep] = field(default_factory=list)
    scratchpad: dict[str, Any] = field(default_factory=dict)
    iteration: int = 0
    max_iterations: int = 20

    def set_goal(self, goal: str):
        self.goal = goal
        self.plan = []
        self.scratchpad = {}
        self.iteration = 0

    def add_step(self, description: str) -> int:
        self.plan.append(TaskStep(description=description))
        return len(self.plan) - 1

    def complete_step(self, index: int, result: Any):
        self.plan[index].status = StepStatus.COMPLETED
        self.plan[index].result = result

    def fail_step(self, index: int, error: str):
        self.plan[index].status = StepStatus.FAILED
        self.plan[index].error = error

    def note(self, key: str, value: Any):
        """在 scratchpad 上记录中间发现"""
        self.scratchpad[key] = value

    def to_context_string(self) -> str:
        """序列化为可注入 prompt 的文本"""
        lines = [f"## Current Task State"]
        lines.append(f"**Goal**: {self.goal}")
        lines.append(f"**Progress**: Step {self.iteration}/{self.max_iterations}")
        lines.append("")
        lines.append("### Plan:")
        for i, step in enumerate(self.plan):
            status_icon = {
                StepStatus.PENDING: "[ ]",
                StepStatus.IN_PROGRESS: "[>]",
                StepStatus.COMPLETED: "[x]",
                StepStatus.FAILED: "[!]",
            }[step.status]
            lines.append(f"  {status_icon} {i+1}. {step.description}")
            if step.result:
                lines.append(f"       Result: {str(step.result)[:200]}")
            if step.error:
                lines.append(f"       Error: {step.error}")

        if self.scratchpad:
            lines.append("")
            lines.append("### Scratchpad:")
            for k, v in self.scratchpad.items():
                lines.append(f"  - {k}: {str(v)[:300]}")

        return "\n".join(lines)
```

**Working Memory 什么时候更新？**

- **Plan 阶段**：Agent 制定计划后，写入 `plan`
- **每步执行后**：更新 step 状态和结果
- **发现新信息时**：写入 `scratchpad`（例如发现数据有异常值）
- **任务完成/失败时**：清空或归档到 Episodic Memory

---

### Layer 3: Episodic Memory — 历史经验

**本质**：过去交互的结构化记录，用于跨会话的经验积累。

如果说 Working Memory 是"今天的笔记"，Episodic Memory 就是"过去的日记"。它回答的问题是：

- "上次用户让我处理类似的任务，我是怎么做的？"
- "用户偏好什么样的输出格式？"
- "上次这个工具调用失败了，原因是什么？"

```python
import time
import json
import hashlib
from dataclasses import dataclass, asdict

@dataclass
class Episode:
    """一次交互的结构化记录"""

    episode_id: str
    timestamp: float
    task_description: str
    approach: str              # Agent 采用的方法
    outcome: str               # 成功/失败/部分成功
    key_decisions: list[str]   # 关键决策点
    user_feedback: str | None  # 用户反馈（如果有）
    tools_used: list[str]      # 使用了哪些工具
    lessons: list[str]         # 经验教训
    importance: float          # 重要性评分 0-1
    embedding: list[float] | None = None  # 向量表示

    def to_context_string(self) -> str:
        return (
            f"[Past experience - {self.task_description}]\n"
            f"Approach: {self.approach}\n"
            f"Outcome: {self.outcome}\n"
            f"Lessons: {'; '.join(self.lessons)}"
        )


class EpisodicMemory:
    """基于向量检索的情景记忆"""

    def __init__(self, embedding_fn, vector_store):
        self.embedding_fn = embedding_fn   # text -> vector
        self.vector_store = vector_store   # 向量数据库客户端
        self.decay_factor = 0.95           # 时间衰减因子

    def store(self, episode: Episode):
        """写入一条记忆"""
        # 生成向量表示
        text_for_embedding = (
            f"{episode.task_description} {episode.approach} "
            f"{' '.join(episode.lessons)}"
        )
        episode.embedding = self.embedding_fn(text_for_embedding)

        # 写入向量数据库
        self.vector_store.upsert(
            id=episode.episode_id,
            vector=episode.embedding,
            metadata=asdict(episode)
        )

    def recall(self, query: str, top_k: int = 5) -> list[Episode]:
        """根据当前任务检索相关记忆"""
        query_embedding = self.embedding_fn(query)

        # 向量相似度检索
        results = self.vector_store.query(
            vector=query_embedding,
            top_k=top_k * 2  # 多检索一些，后面再过滤
        )

        # 综合评分：相似度 × 时间衰减 × 重要性
        scored_episodes = []
        now = time.time()
        for result in results:
            episode = Episode(**result.metadata)
            age_days = (now - episode.timestamp) / 86400

            # 综合评分公式
            time_decay = self.decay_factor ** age_days
            final_score = (
                result.similarity * 0.5 +    # 语义相似度
                time_decay * 0.3 +            # 时间新鲜度
                episode.importance * 0.2      # 重要性
            )
            scored_episodes.append((episode, final_score))

        # 按综合分排序，取 top_k
        scored_episodes.sort(key=lambda x: x[1], reverse=True)
        return [ep for ep, _ in scored_episodes[:top_k]]
```

**Episodic Memory 的检索策略**：

```
                    Query: "用户要分析 Q3 销售数据"
                              │
                    ┌─────────▼──────────┐
                    │   Embedding Model   │
                    └─────────┬──────────┘
                              │ query_vector
                    ┌─────────▼──────────┐
                    │   Vector Search     │──── 语义相似度 (0.5)
                    │   (Top 10)          │
                    └─────────┬──────────┘
                              │ candidates
                    ┌─────────▼──────────┐
                    │   Scoring & Rank    │
                    │  ├─ time_decay (0.3)│──── 新消息 > 旧消息
                    │  └─ importance (0.2)│──── 成功经验 > 普通记录
                    └─────────┬──────────┘
                              │ top_k
                    ┌─────────▼──────────┐
                    │ Format & Inject     │──── 注入 Context Window
                    │ into Prompt         │
                    └────────────────────┘
```

**关键决策：什么时候写入 Episodic Memory？**

不是每轮对话都值得记住。过度记忆会导致检索噪声。实践中推荐以下策略：

| 触发条件 | 写入内容 | 重要性 |
|---------|---------|-------|
| 任务成功完成 | 完整的任务描述、方法、结果 | 0.7-0.9 |
| 任务失败 | 失败原因、错误信息、教训 | 0.8-1.0 |
| 用户显式反馈 | 用户的表扬/批评/修正 | 0.9-1.0 |
| 发现新的用户偏好 | 偏好描述 | 0.8 |
| 使用了新的工具/方法 | 工具使用经验 | 0.5-0.7 |

---

### Layer 4: Semantic Memory — 知识库

**本质**：相对稳定的事实性知识，通常通过 RAG (Retrieval-Augmented Generation) 接入。

Semantic Memory 与 Episodic Memory 的区别：

| 维度 | Episodic Memory | Semantic Memory |
|------|----------------|-----------------|
| 存储内容 | Agent 的经验（做过什么） | 外部知识（世界是什么样） |
| 更新频率 | 每次任务后可能更新 | 相对稳定，定期更新 |
| 来源 | Agent 自身的交互历史 | 文档、数据库、API |
| 检索触发 | 遇到类似任务时 | 需要事实性知识时 |

在本篇中，我们只关注 Agent 如何"使用"Semantic Memory。知识如何构建、如何切分、如何检索——这些 RAG 工程问题留给下一篇文章。

```python
class SemanticMemory:
    """知识库接口（RAG 的消费侧）"""

    def __init__(self, retriever):
        self.retriever = retriever  # RAG 检索器

    def query(self, question: str, top_k: int = 3) -> list[dict]:
        """检索相关知识片段"""
        results = self.retriever.search(question, top_k=top_k)
        return [
            {
                "content": r.text,
                "source": r.metadata.get("source", "unknown"),
                "relevance": r.score,
            }
            for r in results
        ]

    def format_for_context(self, results: list[dict]) -> str:
        """格式化为可注入 prompt 的文本"""
        if not results:
            return ""
        lines = ["## Relevant Knowledge:"]
        for i, r in enumerate(results, 1):
            lines.append(f"\n### [{i}] (source: {r['source']})")
            lines.append(r["content"])
        return "\n".join(lines)
```

---

## 4. 记忆的读写操作

记忆系统的核心操作可以概括为四个：**Write、Read、Update、Forget**。每个操作都有其触发时机和策略选择。

### Write：写入记忆

```python
class MemoryWriter:
    """决定什么信息、在什么时候写入哪层记忆"""

    def __init__(self, working_memory, episodic_memory, llm_client):
        self.working = working_memory
        self.episodic = episodic_memory
        self.llm = llm_client

    def on_step_complete(self, step_index: int, result: Any):
        """每步执行完成后的写入"""
        # 更新 Working Memory
        self.working.complete_step(step_index, result)

        # 重要发现写入 scratchpad
        if self._is_notable(result):
            key = f"step_{step_index}_finding"
            self.working.note(key, self._extract_key_info(result))

    def on_task_complete(self, task_description: str, success: bool):
        """任务完成后的写入"""
        # 用 LLM 提取经验教训
        reflection_prompt = (
            f"Task: {task_description}\n"
            f"Working Memory:\n{self.working.to_context_string()}\n\n"
            f"Extract key lessons learned from this task. "
            f"Output as JSON with keys: approach, lessons, importance (0-1)"
        )
        reflection = self.llm.complete(reflection_prompt, json_mode=True)
        parsed = json.loads(reflection)

        # 写入 Episodic Memory
        episode = Episode(
            episode_id=hashlib.md5(
                f"{task_description}{time.time()}".encode()
            ).hexdigest(),
            timestamp=time.time(),
            task_description=task_description,
            approach=parsed.get("approach", ""),
            outcome="success" if success else "failure",
            key_decisions=[],
            user_feedback=None,
            tools_used=[],
            lessons=parsed.get("lessons", []),
            importance=parsed.get("importance", 0.5),
        )
        self.episodic.store(episode)

    def on_user_feedback(self, feedback: str, task_description: str):
        """用户反馈时的写入——高优先级"""
        episode = Episode(
            episode_id=hashlib.md5(
                f"feedback_{time.time()}".encode()
            ).hexdigest(),
            timestamp=time.time(),
            task_description=task_description,
            approach="",
            outcome="user_feedback",
            key_decisions=[],
            user_feedback=feedback,
            tools_used=[],
            lessons=[f"User feedback: {feedback}"],
            importance=0.9,  # 用户反馈总是高重要性
        )
        self.episodic.store(episode)

    def _is_notable(self, result: Any) -> bool:
        """判断结果是否值得特别记录"""
        # 简单启发式：结果较长或包含数字时可能重要
        text = str(result)
        return len(text) > 200 or any(c.isdigit() for c in text)

    def _extract_key_info(self, result: Any) -> str:
        """提取关键信息（可以用 LLM，也可以用规则）"""
        text = str(result)
        if len(text) <= 300:
            return text
        return text[:300] + "..."
```

### Read：读取记忆

读取操作发生在每次 LLM 调用之前——我们需要从各层记忆中组装 context。

```python
class MemoryReader:
    """从各层记忆中组装 LLM 调用的上下文"""

    def __init__(
        self,
        conversation_buffer,
        working_memory,
        episodic_memory,
        semantic_memory,
    ):
        self.conversation = conversation_buffer
        self.working = working_memory
        self.episodic = episodic_memory
        self.semantic = semantic_memory

    def assemble_context(
        self,
        user_query: str,
        system_prompt: str,
        token_budget: int = 16000,
    ) -> list[dict]:
        """组装完整的消息列表"""
        messages = []

        # 1. System Prompt（固定分配）
        messages.append({"role": "system", "content": system_prompt})

        # 2. 检索 Episodic Memory（相关历史经验）
        relevant_episodes = self.episodic.recall(user_query, top_k=3)
        if relevant_episodes:
            episode_text = "\n\n".join(
                ep.to_context_string() for ep in relevant_episodes
            )
            messages.append({
                "role": "system",
                "content": f"## Relevant Past Experience:\n{episode_text}"
            })

        # 3. 检索 Semantic Memory（相关知识）
        knowledge_results = self.semantic.query(user_query, top_k=3)
        if knowledge_results:
            knowledge_text = self.semantic.format_for_context(knowledge_results)
            messages.append({
                "role": "system",
                "content": knowledge_text
            })

        # 4. Working Memory（当前任务状态）
        if self.working.goal:
            messages.append({
                "role": "system",
                "content": self.working.to_context_string()
            })

        # 5. Conversation History（对话历史）
        messages.extend(self.conversation.get_messages())

        # 6. Token 预算检查与裁剪
        messages = self._fit_to_budget(messages, token_budget)

        return messages

    def _fit_to_budget(
        self, messages: list[dict], budget: int
    ) -> list[dict]:
        """确保总 token 数不超过预算"""
        total = sum(len(m["content"]) // 3 for m in messages)
        if total <= budget:
            return messages

        # 裁剪策略：优先裁减对话历史中间部分
        # 保留: system prompts + 最早2条 + 最近5条
        system_msgs = [m for m in messages if m["role"] == "system"]
        non_system = [m for m in messages if m["role"] != "system"]

        if len(non_system) > 7:
            kept = non_system[:2] + non_system[-5:]
            messages = system_msgs + kept

        return messages
```

### Update：记忆更新

记忆更新有三种模式，适用于不同场景：

```python
class MemoryUpdateStrategy:
    """记忆更新策略"""

    @staticmethod
    def overwrite(store: dict, key: str, value: Any):
        """覆盖：新值完全替换旧值
        适用于：用户偏好（用户说"我改主意了，用英文回复"）
        """
        store[key] = value

    @staticmethod
    def append(store: dict, key: str, value: Any):
        """追加：保留历史，添加新记录
        适用于：任务历史（每次任务都是新记录）
        """
        if key not in store:
            store[key] = []
        store[key].append(value)

    @staticmethod
    def merge(store: dict, key: str, value: dict, llm_client=None):
        """合并：智能融合旧信息和新信息
        适用于：用户画像（逐步积累，可能有矛盾需要解决）
        """
        if key not in store:
            store[key] = value
            return

        old = store[key]
        if llm_client:
            # 用 LLM 智能合并
            prompt = (
                f"Merge these two user profiles, resolving conflicts "
                f"by preferring newer information:\n"
                f"Old: {json.dumps(old)}\nNew: {json.dumps(value)}"
            )
            merged = json.loads(llm_client.complete(prompt, json_mode=True))
            store[key] = merged
        else:
            # 简单合并：新值覆盖旧值中的同名字段
            if isinstance(old, dict) and isinstance(value, dict):
                store[key] = {**old, **value}
```

### Forget：记忆遗忘

遗忘是记忆系统的必要组成部分。没有遗忘，记忆库会无限膨胀，检索质量会持续下降。

```python
class MemoryForgetting:
    """记忆遗忘策略"""

    def __init__(self, episodic_memory, decay_rate: float = 0.01):
        self.episodic = episodic_memory
        self.decay_rate = decay_rate

    def time_based_decay(self, max_age_days: int = 90):
        """基于时间的遗忘：超过 N 天且重要性低的记忆被清除"""
        cutoff = time.time() - (max_age_days * 86400)
        all_episodes = self.episodic.vector_store.list_all()

        for episode_data in all_episodes:
            if (
                episode_data["timestamp"] < cutoff
                and episode_data["importance"] < 0.7
            ):
                self.episodic.vector_store.delete(episode_data["episode_id"])

    def capacity_based_eviction(self, max_episodes: int = 1000):
        """基于容量的驱逐：保留最重要的 N 条记忆"""
        all_episodes = self.episodic.vector_store.list_all()

        if len(all_episodes) <= max_episodes:
            return

        # 按综合分排序（重要性 × 时间衰减）
        now = time.time()
        scored = []
        for ep in all_episodes:
            age_days = (now - ep["timestamp"]) / 86400
            score = ep["importance"] * (0.95 ** age_days)
            scored.append((ep["episode_id"], score))

        scored.sort(key=lambda x: x[1])

        # 删除分数最低的
        to_remove = len(all_episodes) - max_episodes
        for episode_id, _ in scored[:to_remove]:
            self.episodic.vector_store.delete(episode_id)

    def explicit_forget(self, episode_id: str):
        """主动遗忘：用户要求或隐私合规"""
        self.episodic.vector_store.delete(episode_id)
```

---

## 5. 记忆存储方案对比

不同的记忆层适合不同的存储后端。选择存储方案时需要考虑：数据结构、访问模式、持久化需求和查询能力。

```
┌──────────────┬──────────────────┬──────────────────┬──────────────────┐
│   存储方案     │   适用记忆层        │   优点             │   缺点            │
├──────────────┼──────────────────┼──────────────────┼──────────────────┤
│ 内存          │ Conversation     │ 零延迟            │ 重启丢失          │
│ (dict/list)  │ Buffer,          │ 实现简单           │ 不可跨进程        │
│              │ Working Memory   │ 无外部依赖         │ 容量受限          │
├──────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Redis        │ 会话状态,          │ 亚毫秒读写         │ 无语义检索        │
│              │ Working Memory,  │ 支持 TTL 自动过期   │ 数据结构较简单     │
│              │ 短期缓存          │ 可跨进程           │ 需要额外运维       │
├──────────────┼──────────────────┼──────────────────┼──────────────────┤
│ 向量数据库     │ Episodic Memory, │ 语义相似度检索      │ 写入有延迟        │
│ (Chroma /    │ Semantic Memory  │ 适合非结构化数据     │ 精确查询弱        │
│  Pinecone)   │                  │ 可扩展             │ 需要 Embedding    │
├──────────────┼──────────────────┼──────────────────┼──────────────────┤
│ 关系数据库     │ 用户偏好,          │ 结构化查询强        │ 无语义检索        │
│ (PostgreSQL) │ 任务历史,         │ 事务保证            │ Schema 需设计     │
│              │ 审计日志          │ 成熟稳定            │ 向量支持有限       │
├──────────────┼──────────────────┼──────────────────┼──────────────────┤
│ 混合方案       │ 生产环境          │ 各取所长            │ 复杂度高          │
│ PG + Vector  │ 全层级            │ 一个系统解决多需求    │ 需要编排层        │
│ + Redis      │                  │                   │                  │
└──────────────┴──────────────────┴──────────────────┴──────────────────┘
```

**实践建议**：

- **原型阶段**：全部用内存（dict + list），快速验证
- **单用户产品**：SQLite + ChromaDB（本地向量库），零运维
- **多用户产品**：PostgreSQL（结构化数据 + pgvector 扩展）+ Redis（会话缓存）
- **大规模系统**：PostgreSQL + 专用向量数据库（Pinecone/Qdrant）+ Redis Cluster

---

## 6. 完整实现：MemoryManager

将四层记忆整合到一个统一的管理器中，在 Agent Loop 中使用。

```python
import time
import json
import hashlib
from dataclasses import dataclass, field, asdict
from typing import Any, Protocol


class LLMClient(Protocol):
    """LLM 客户端接口"""
    def complete(self, prompt: str, json_mode: bool = False) -> str: ...


class VectorStore(Protocol):
    """向量存储接口"""
    def upsert(self, id: str, vector: list[float], metadata: dict): ...
    def query(self, vector: list[float], top_k: int) -> list: ...
    def delete(self, id: str): ...
    def list_all(self) -> list[dict]: ...


class Retriever(Protocol):
    """RAG 检索器接口"""
    def search(self, query: str, top_k: int) -> list: ...


class MemoryManager:
    """
    统一记忆管理器，整合四层记忆架构。

    职责：
    1. 管理四层记忆的生命周期
    2. 在 Agent Loop 中提供 read/write 接口
    3. 处理 Context Window 的 token 预算分配
    """

    def __init__(
        self,
        llm_client: LLMClient,
        embedding_fn,
        vector_store: VectorStore,
        retriever: Retriever,
        config: dict | None = None,
    ):
        self.llm = llm_client
        self.config = config or {}

        # Layer 1: Conversation Buffer
        self.conversation = SummarizingBuffer(
            llm_client=llm_client,
            window_size=self.config.get("conversation_window", 20),
            max_tokens=self.config.get("conversation_max_tokens", 8000),
        )

        # Layer 2: Working Memory
        self.working = WorkingMemory(
            max_iterations=self.config.get("max_iterations", 20)
        )

        # Layer 3: Episodic Memory
        self.episodic = EpisodicMemory(
            embedding_fn=embedding_fn,
            vector_store=vector_store,
        )

        # Layer 4: Semantic Memory
        self.semantic = SemanticMemory(retriever=retriever)

        # Token budget config
        self.total_budget = self.config.get("total_token_budget", 16000)
        self.budget_allocation = self.config.get("budget_allocation", {
            "system_prompt": 0.20,  # 20% for system prompt
            "memory": 0.30,         # 30% for episodic + semantic memory
            "history": 0.30,        # 30% for conversation history
            "reserve": 0.20,        # 20% for tool schemas + response
        })

    # ── Read: 组装 LLM 上下文 ──────────────────────────────────

    def build_context(
        self, user_query: str, system_prompt: str
    ) -> list[dict]:
        """在每次 LLM 调用前，组装完整的消息列表"""
        messages = []
        budget = self.total_budget

        # 1. System Prompt
        sp_budget = int(budget * self.budget_allocation["system_prompt"])
        system_content = self._truncate(system_prompt, sp_budget)
        messages.append({"role": "system", "content": system_content})

        # 2. Memory injection (Episodic + Semantic + Working)
        mem_budget = int(budget * self.budget_allocation["memory"])
        memory_parts = []

        # 2a. Working Memory
        if self.working.goal:
            memory_parts.append(self.working.to_context_string())

        # 2b. Episodic Memory
        episodes = self.episodic.recall(user_query, top_k=3)
        if episodes:
            ep_text = "\n\n".join(ep.to_context_string() for ep in episodes)
            memory_parts.append(f"## Past Experience:\n{ep_text}")

        # 2c. Semantic Memory
        knowledge = self.semantic.query(user_query, top_k=3)
        if knowledge:
            memory_parts.append(self.semantic.format_for_context(knowledge))

        if memory_parts:
            combined = "\n\n---\n\n".join(memory_parts)
            combined = self._truncate(combined, mem_budget)
            messages.append({"role": "system", "content": combined})

        # 3. Conversation History
        hist_budget = int(budget * self.budget_allocation["history"])
        history = self.conversation.get_messages()
        history = self._truncate_messages(history, hist_budget)
        messages.extend(history)

        return messages

    # ── Write: 记忆写入 ─────────────────────────────────────

    def on_user_message(self, content: str):
        """用户消息到来时"""
        self.conversation.add("user", content)

    def on_assistant_message(self, content: str):
        """Agent 回复时"""
        self.conversation.add("assistant", content)

    def on_tool_result(self, tool_name: str, result: str):
        """工具返回结果时"""
        self.conversation.add(
            "tool", f"[{tool_name}] {result}"
        )

    def on_step_complete(self, step_index: int, result: Any):
        """单步完成时更新 Working Memory"""
        self.working.complete_step(step_index, result)

    def on_task_start(self, goal: str, plan: list[str]):
        """任务开始时初始化 Working Memory"""
        self.working.set_goal(goal)
        for step_desc in plan:
            self.working.add_step(step_desc)

    def on_task_complete(self, task_description: str, success: bool):
        """任务完成时归档到 Episodic Memory"""
        # 用 LLM 从 Working Memory 中提取经验
        reflection_prompt = (
            f"Reflect on this completed task.\n"
            f"Task: {task_description}\n"
            f"State:\n{self.working.to_context_string()}\n\n"
            f"Extract: approach (string), lessons (list of strings), "
            f"importance (float 0-1). Output JSON."
        )
        try:
            raw = self.llm.complete(reflection_prompt, json_mode=True)
            parsed = json.loads(raw)
        except (json.JSONDecodeError, Exception):
            parsed = {
                "approach": "unknown",
                "lessons": [],
                "importance": 0.5,
            }

        episode = Episode(
            episode_id=hashlib.md5(
                f"{task_description}{time.time()}".encode()
            ).hexdigest(),
            timestamp=time.time(),
            task_description=task_description,
            approach=parsed.get("approach", ""),
            outcome="success" if success else "failure",
            key_decisions=[],
            user_feedback=None,
            tools_used=[],
            lessons=parsed.get("lessons", []),
            importance=parsed.get("importance", 0.5),
        )
        self.episodic.store(episode)

        # 清空 Working Memory
        self.working = WorkingMemory(
            max_iterations=self.config.get("max_iterations", 20)
        )

    # ── Forget: 定期维护 ────────────────────────────────────

    def maintenance(self, max_age_days: int = 90, max_episodes: int = 1000):
        """定期执行的记忆维护"""
        forgetting = MemoryForgetting(self.episodic)
        forgetting.time_based_decay(max_age_days)
        forgetting.capacity_based_eviction(max_episodes)

    # ── 辅助方法 ─────────────────────────────────────────

    def _truncate(self, text: str, max_tokens: int) -> str:
        max_chars = max_tokens * 3  # 粗略估算
        if len(text) <= max_chars:
            return text
        return text[:max_chars] + "\n...[truncated]"

    def _truncate_messages(
        self, messages: list[dict], max_tokens: int
    ) -> list[dict]:
        total = sum(len(m["content"]) // 3 for m in messages)
        if total <= max_tokens:
            return messages
        # 保留最早 1 条 + 最近 N 条
        if len(messages) > 6:
            return messages[:1] + messages[-5:]
        return messages[-5:]
```

### 在 Agent Loop 中集成

```python
def agent_loop(
    user_input: str,
    memory: MemoryManager,
    llm_client: LLMClient,
    tools: dict,
    system_prompt: str,
    max_steps: int = 10,
):
    """带记忆管理的 Agent 主循环"""

    # 记录用户输入
    memory.on_user_message(user_input)

    for step in range(max_steps):
        # ── Read: 从记忆中组装上下文 ──
        messages = memory.build_context(user_input, system_prompt)

        # ── Think: 调用 LLM ──
        response = llm_client.chat(messages, tools=tools)

        # ── 判断是否需要调用工具 ──
        if response.tool_calls:
            for tool_call in response.tool_calls:
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)

                # ── Act: 执行工具 ──
                result = tools[tool_name](**tool_args)

                # ── Write: 记录工具结果 ──
                memory.on_tool_result(tool_name, str(result))
                memory.on_step_complete(step, result)
        else:
            # 没有工具调用，Agent 给出了最终回答
            final_answer = response.content
            memory.on_assistant_message(final_answer)

            # 任务完成，归档到 Episodic Memory
            memory.on_task_complete(user_input, success=True)

            return final_answer

    # 超过最大步数
    memory.on_task_complete(user_input, success=False)
    return "Task exceeded maximum steps."
```

---

## 7. Context Window 管理策略

Context Window 是 Agent 记忆系统中最关键的瓶颈。所有层级的记忆最终都要"挤进"这个有限的空间。

### Token 预算分配

```
┌─────────────────────────────────────────────────────────┐
│                Context Window (128K tokens)               │
│                                                          │
│  ┌──────────────────┐  ← System Prompt: ~20%             │
│  │  角色定义、指令集    │    稳定不变，每次都一样              │
│  │  输出格式要求       │                                   │
│  ├──────────────────┤  ← Memory Injection: ~30%          │
│  │  Working Memory   │    动态变化，按相关性选取             │
│  │  Episodic Recall  │                                   │
│  │  Semantic Recall  │                                   │
│  ├──────────────────┤  ← Conversation History: ~30%      │
│  │  历史消息          │    滑动窗口 + 摘要                  │
│  │  (含摘要)         │                                    │
│  ├──────────────────┤  ← Tool Schemas + Reserve: ~20%    │
│  │  工具定义          │    为 response 预留空间              │
│  │  Response 空间     │                                   │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

这个比例不是固定的。关键在于**动态调整**：

```python
class TokenBudgetAllocator:
    """根据任务特征动态分配 token 预算"""

    def __init__(self, total_budget: int = 16000):
        self.total = total_budget

    def allocate(
        self,
        task_complexity: str = "medium",
        has_knowledge_need: bool = False,
        conversation_length: int = 0,
    ) -> dict[str, int]:
        """
        根据任务特征动态调整各部分预算。

        - 简单任务：减少 memory，增加 history（对话上下文更重要）
        - 复杂任务：增加 memory，减少 history（需要更多参考信息）
        - 知识密集：增加 semantic memory 的比重
        """
        if task_complexity == "simple":
            allocation = {
                "system_prompt": 0.15,
                "memory": 0.15,
                "history": 0.45,
                "reserve": 0.25,
            }
        elif task_complexity == "complex":
            allocation = {
                "system_prompt": 0.15,
                "memory": 0.40,
                "history": 0.25,
                "reserve": 0.20,
            }
        else:  # medium
            allocation = {
                "system_prompt": 0.20,
                "memory": 0.30,
                "history": 0.30,
                "reserve": 0.20,
            }

        # 如果需要知识检索，从 history 匀一些给 memory
        if has_knowledge_need:
            allocation["memory"] += 0.10
            allocation["history"] -= 0.10

        # 对话很长时，给 history 更多空间
        if conversation_length > 30:
            allocation["history"] += 0.05
            allocation["reserve"] -= 0.05

        return {
            k: int(v * self.total) for k, v in allocation.items()
        }
```

### 消息压缩策略

当对话历史超出预算时，需要压缩。两种主要方案：

**方案 A：LLM 摘要压缩**

```python
def llm_summarize(messages: list[dict], llm_client) -> str:
    """用 LLM 压缩对话历史"""
    conversation_text = "\n".join(
        f"{m['role']}: {m['content'][:500]}" for m in messages
    )
    prompt = (
        "Summarize this conversation, preserving:\n"
        "1. Key decisions and their rationale\n"
        "2. Important facts and data points\n"
        "3. User preferences and corrections\n"
        "4. Current task status\n\n"
        "Be concise but complete. Do not lose critical information.\n\n"
        f"Conversation:\n{conversation_text}"
    )
    return llm_client.complete(prompt)
```

**方案 B：规则压缩（零成本）**

```python
def rule_based_compress(messages: list[dict]) -> list[dict]:
    """基于规则的消息压缩，不需要额外 LLM 调用"""
    compressed = []
    for msg in messages:
        content = msg["content"]

        # 规则 1: 截断超长的工具输出
        if msg["role"] == "tool" and len(content) > 500:
            content = content[:500] + "\n...[output truncated]"

        # 规则 2: 移除纯确认消息（"好的"、"明白了"）
        if msg["role"] == "assistant" and len(content) < 20:
            continue

        # 规则 3: 移除重复的错误消息
        if "error" in content.lower() and any(
            content == m["content"] for m in compressed
        ):
            continue

        compressed.append({"role": msg["role"], "content": content})
    return compressed
```

**方案对比**：

| 维度 | LLM 摘要 | 规则压缩 |
|------|---------|---------|
| 压缩质量 | 高，能理解语义 | 中，可能丢失隐含信息 |
| 额外成本 | 需要一次 LLM 调用 | 零 |
| 延迟 | 增加 1-3 秒 | 毫秒级 |
| 适用场景 | 长对话、复杂任务 | 短对话、实时场景 |

**实践建议**：先用规则压缩兜底（保证不超 budget），当压缩比 > 50% 时再触发 LLM 摘要。两种方案可以组合使用：先规则裁剪，再 LLM 摘要。

---

## 8. Trade-off 分析

记忆系统的设计充满权衡。没有银弹，只有适合你场景的平衡点。

### Trade-off 1: 记忆丰富度 vs 成本

```
                    记忆注入量
                        │
     Token 成本 ────────┤──────────── 上下文质量
     (线性增长)          │              (边际递减)
                        │
        $$$  ──────── ┐ │ ┌ ──────── 很好
                      │ │ │
         $$  ──────── ┤ │ ├ ──────── 好
                      │ │ │
          $  ──────── ┤ │ ├ ──────── 一般
                      │ │ │
          0  ──────── ┘ │ └ ──────── 差
                        │
                        └─── 最佳区间通常在中间偏左
```

- **记忆越多** → 上下文越丰富 → 回答质量越高 → **但 Token 成本线性增长，延迟线性增长**
- **记忆太少** → Agent "健忘" → 重复劳动、答非所问 → **用户体验差**

**实践经验**：对于大多数 Agent，将 memory injection 控制在 Context Window 的 25-35% 是比较好的区间。超过 40% 时，边际收益急剧下降，但成本继续线性增长。

### Trade-off 2: 检索精度 vs 检索召回

```
  精确检索 (top_k=1)                模糊检索 (top_k=10)
  ┌──────────────┐                 ┌──────────────┐
  │ 命中：很准      │                 │ 命中：可能包含     │
  │ 遗漏：可能大    │                 │ 遗漏：很少        │
  │ Token 消耗：少  │                 │ Token 消耗：多    │
  │ 噪声：几乎没有  │                 │ 噪声：可能较多     │
  └──────────────┘                 └──────────────┘
```

不同记忆层的最佳 top_k：
- **Episodic Memory**：`top_k=3`（过去经验不需要太多，2-3 条最相关的就够）
- **Semantic Memory**：`top_k=5`（知识检索需要更全面，特别是当问题模糊时）

### Trade-off 3: 实时性 vs 一致性

写入记忆的时机也有权衡：

| 写入时机 | 优点 | 缺点 |
|---------|------|------|
| **同步写入**（每步结束立即写） | 记忆总是最新的 | 增加每步延迟 |
| **异步写入**（后台批量写） | 不影响主循环延迟 | 可能丢失最近的记忆 |
| **任务结束后写入** | 只写入"完整"的经验 | 任务中途中断会丢失 |

**建议**：Working Memory 同步更新（它在 Agent Loop 的关键路径上），Episodic Memory 任务结束后异步写入（不在关键路径上）。

### Trade-off 4: 通用记忆 vs 专用记忆

| 设计方向 | 场景 | 优点 | 缺点 |
|---------|------|------|------|
| 通用记忆系统 | 平台型 Agent | 一套代码支撑多场景 | 每个场景都不够深入 |
| 专用记忆系统 | 垂直领域 Agent | 为特定任务深度优化 | 迁移成本高 |

**建议**：先用通用方案（本文的四层架构），在验证了产品方向后，对核心场景做专用优化。

---

## 9. 小结与下一步

本文建立了 Agent 记忆的四层架构：

```
┌─────────────────────────────────────────────────────┐
│                  Agent Memory Stack                  │
├─────────────┬──────────────┬────────────────────────┤
│   Layer     │  存储        │  生命周期               │
├─────────────┼──────────────┼────────────────────────┤
│ L1 Conv.    │ 内存 / Redis │ 单次会话               │
│ L2 Working  │ 内存 / Redis │ 单次任务               │
│ L3 Episodic │ 向量数据库    │ 跨会话（天~月）         │
│ L4 Semantic │ RAG 系统     │ 持久化（月~年）         │
└─────────────┴──────────────┴────────────────────────┘
```

核心 takeaway：

1. **记忆是分层的**：不同信息有不同的生命周期和存储需求，不能"一刀切"
2. **Context Window 是硬约束**：所有记忆最终都要在有限的 token 预算内竞争，需要精细的预算分配
3. **遗忘是特性**：没有遗忘机制的记忆系统最终会被噪声淹没
4. **读写时机很关键**：什么时候写入、什么时候检索、检索多少条——这些决策直接影响 Agent 的表现
5. **从简单开始**：先用内存 + 滑动窗口跑通，再逐步引入向量检索和 LLM 摘要

在四层记忆中，Layer 4 Semantic Memory 的"读取"操作——即如何从大规模知识库中高效检索相关信息——是一个足够深的话题。它涉及 Ingestion、Chunking、Embedding、Hybrid Retrieval、Reranking 等一系列工程决策。

这正是下一篇文章的主题：**RAG as Cognitive Memory: 检索增强生成的工程实践**。我们将深入 RAG 管线的每一个环节，探讨如何为 Agent 构建高质量的"外部大脑"。

---

## 进一步思考

1. **Memory Consolidation**：人类在睡眠中会将短期记忆"固化"为长期记忆。Agent 能否也有类似的机制——在空闲时对 Episodic Memory 做去重、聚合、抽象化？
2. **Shared Memory**：多 Agent 协作场景下，如何设计共享记忆？一个 Agent 的发现如何高效传递给另一个 Agent？
3. **Memory as Skill**：能否让 Agent 从记忆中"学会"新技能，而非仅仅"记住"过去的经验？比如从 10 次类似任务的记录中归纳出一个通用策略。
4. **Privacy-Aware Memory**：用户说"忘记我刚才说的"，记忆系统能否真正做到选择性遗忘？在向量数据库中，删除一条记录是否真的消除了它对其他向量的影响？
5. **Memory Hallucination**：当 Episodic Memory 中存储了不准确的信息（比如一次错误的推理结论），它会不会在后续检索中"污染"Agent 的决策？如何设计记忆的"自校正"机制？

---

> **系列导航**：本文是 Agentic 系列的第 08 篇。
>
> - 上一篇：[07 | Agent Runtime from Scratch](/blog/engineering/agentic/07-Agent%20Runtime%20from%20Scratch)
> - 下一篇：[09 | RAG as Cognitive Memory](/blog/engineering/agentic/09-RAG%20as%20Cognitive%20Memory)
> - 完整目录：[01 | From LLM to Agent](/blog/engineering/agentic/01-From%20LLM%20to%20Agent)
