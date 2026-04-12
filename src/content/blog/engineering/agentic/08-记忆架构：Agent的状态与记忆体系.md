---
title: "记忆架构：Agent的状态与记忆体系"
description: "LLM 是无状态的，但 Agent 必须有状态。本文系统拆解 Agent 记忆的四层架构——Conversation Buffer、Working Memory、Episodic Memory、Semantic Memory，从认知科学类比出发，深入每一层的设计原理、存储方案、读写策略与 Context Window 管理，附完整 Python 实现。"
pubDate: "2026-01-02"
tags: ["Agentic", "AI Engineering", "Memory"]
series:
  key: "agentic"
  order: 8
---

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

![人类记忆 vs Agent 记忆](/images/blog/agentic-08/01-human-vs-agent-memory.svg)

这个类比的价值在于：

1. **分层处理**：不是所有信息都需要"记住"，大部分感觉输入会被丢弃
2. **容量约束**：工作记忆（Context Window）的容量是硬性限制，必须在这个限制内做信息的取舍
3. **编码与检索**：信息从短期记忆进入长期记忆需要"编码"（写入），使用时需要"检索"（读取）
4. **遗忘是特性**：遗忘不是 bug，而是一种必要的信息过滤机制

基于这个认知框架，我们设计 Agent 的四层记忆架构。

---

## 3. Agent 记忆的四层架构

![四层记忆架构注入 LLM Context Window](/images/blog/agentic-08/02-llm-context-window.svg)

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

![Conversation Buffer vs Working Memory](/images/blog/agentic-08/03-conversation-vs-working.svg)

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

![Episodic Memory 检索流程](/images/blog/agentic-08/10-episodic-retrieval-pipeline.svg)

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

![记忆存储方案对比](/images/blog/agentic-08/06-storage-solutions.svg)

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

![Context Window 预算分配](/images/blog/agentic-08/07-context-window-budget.svg)

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

![Token 成本 vs 上下文质量](/images/blog/agentic-08/11-cost-vs-quality-tradeoff.svg)

- **记忆越多** → 上下文越丰富 → 回答质量越高 → **但 Token 成本线性增长，延迟线性增长**
- **记忆太少** → Agent "健忘" → 重复劳动、答非所问 → **用户体验差**

**实践经验**：对于大多数 Agent，将 memory injection 控制在 Context Window 的 25-35% 是比较好的区间。超过 40% 时，边际收益急剧下降，但成本继续线性增长。

### Trade-off 2: 检索精度 vs 检索召回

![检索精度 vs 召回率的权衡](/images/blog/agentic-08/04-precision-vs-recall.svg)

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

## 9. 记忆分层决策树

在实践中，最常见的问题是："这条信息应该存到哪一层记忆？"没有清晰的决策框架，工程师往往会在不同层之间反复修改，导致记忆架构混乱。本节提供一个系统的决策树，帮助快速定位信息的归属。

### 决策框架

![记忆分层决策树](/images/blog/agentic-08/05-memory-routing-tree.svg)

### 具体示例

**示例 1：用户输入 "把上次的数据改成蓝色"**

```
Step 1: 是否为当前对话流的直接产物？ → 是
  └─> Conversation Buffer (L1)

  存储：{
    "role": "user",
    "content": "把上次的数据改成蓝色",
    "timestamp": "2024-03-20T10:15:00Z"
  }

  同时，Agent 需要在 Working Memory 中记录：
  {
    "task": "修改数据可视化颜色",
    "reference": "上次生成的图表",
    "action": "pending"
  }
```

**示例 2：执行过程中发现"数据有 15% 的缺失值"**

```
Step 1: 是否为当前任务执行状态信息？ → 是
  └─> Working Memory (L2)

  存储到 Scratchpad：{
    "data_quality": {
      "missing_percentage": 0.15,
      "affected_columns": ["sales", "region"],
      "handling_strategy": "forward_fill"
    }
  }

  同时注入到当前 prompt 中，让 Agent 在后续决策时考虑这一发现
```

**示例 3：任务完成，提取"我需要先清理缺失值再做聚合"这一教训**

```
Step 1: 是否为当前任务执行状态信息？ → 否
Step 2: 是否需要跨会话保留？ → 是
Step 3: 是否可以泛化为结构化知识？ → 是

  └─> Semantic Memory (L4) 知识库

  存储：{
    "rule_id": "data_prep_order",
    "title": "数据处理的执行顺序",
    "content": "清理缺失值必须在聚合操作之前，否则会导致统计不准",
    "applicable_scenarios": ["数据分析", "ETL流程"],
    "confidence": 0.95
  }
```

**示例 4：用户说 "我发现你上次的方法不对，应该用另一种方式"**

```
Step 1: 是否为当前任务执行状态信息？ → 否
Step 2: 是否需要跨会话保留？ → 是
Step 3: 是否可以泛化为结构化知识？ → 否

  └─> Episodic Memory (L3)

  存储：{
    "episode_id": "ep_2024_03_20_001",
    "task_description": "处理销售数据分析",
    "previous_approach": "使用线性回归预测",
    "corrected_approach": "应使用时间序列模型（ARIMA）",
    "user_feedback": "线性回归忽略了季节性",
    "lesson": "销售数据具有明显季节性，不能用简单线性模型",
    "importance": 0.85
  }
```

**示例 5：Agent 自动生成的中间结果（如 API 调用返回值）**

```
Step 1: 是否为当前对话流的直接产物？ → 是
Step 2: 是当前任务执行状态信息？ → 是

  └─> Working Memory (L2) + Conversation Buffer (L1)

  在 L2 中作为"已执行步骤的输出"：
  {
    "step_id": 2,
    "action": "fetch_data",
    "result": {
      "rows": 50000,
      "columns": 12,
      "date_range": "2024-01 to 2024-12"
    }
  }

  在 L1 中作为"对话历史"的一部分：
  {
    "role": "tool",
    "content": "Successfully fetched data: 50000 rows, 12 columns"
  }
```

### 决策树实现

```python
from enum import Enum
from typing import Dict, Any

class MemoryLayer(Enum):
    CONVERSATION_BUFFER = 1
    WORKING_MEMORY = 2
    EPISODIC_MEMORY = 3
    SEMANTIC_MEMORY = 4
    DISCARD = 0

class MemoryLayerDecisionTree:
    """根据信息特征自动判断应该存储到哪一层"""

    @staticmethod
    def decide(info: Dict[str, Any]) -> MemoryLayer:
        """
        Args:
            info: 包含以下关键字段的字典
                - content: 信息内容
                - is_direct_message: 是否为直接输入/输出
                - is_task_state: 是否为任务状态
                - is_cross_session: 是否需要跨会话保留
                - is_generalizable: 是否可泛化为知识
                - importance: 重要性评分 (0-1)
                - is_user_feedback: 是否为用户反馈

        Returns:
            应该存储的记忆层级
        """

        # 第一道：是否为当前对话流的直接产物？
        if info.get("is_direct_message"):
            return MemoryLayer.CONVERSATION_BUFFER

        # 第二道：是否为当前任务执行状态？
        if info.get("is_task_state"):
            return MemoryLayer.WORKING_MEMORY

        # 第三道：是否需要跨会话保留？
        if not info.get("is_cross_session"):
            return MemoryLayer.DISCARD

        # 第四道：是否可泛化为知识？
        if info.get("is_generalizable"):
            # 知识库需要满足：
            # 1. 相对稳定（不频繁变化）
            # 2. 适用于多个场景
            # 3. 重要性较高
            if (info.get("stability_score", 0.5) > 0.7 and
                info.get("applicability_score", 0.5) > 0.6 and
                info.get("importance", 0.5) > 0.6):
                return MemoryLayer.SEMANTIC_MEMORY

        # 默认：episodic 记忆
        return MemoryLayer.EPISODIC_MEMORY

    @staticmethod
    def get_storage_strategy(layer: MemoryLayer) -> Dict[str, Any]:
        """获取每一层的存储策略"""
        strategies = {
            MemoryLayer.CONVERSATION_BUFFER: {
                "storage": "in-memory queue / Redis",
                "max_entries": 100,
                "retention_policy": "sliding window (last N messages)",
                "access_pattern": "sequential",
                "ttl": "single session"
            },
            MemoryLayer.WORKING_MEMORY: {
                "storage": "in-memory dictionary / task cache",
                "max_entries": 1,  # 每个任务一份
                "retention_policy": "task lifecycle",
                "access_pattern": "random access by key",
                "ttl": "task duration"
            },
            MemoryLayer.EPISODIC_MEMORY: {
                "storage": "vector database (e.g., Pinecone, Weaviate)",
                "max_entries": "unlimited",
                "retention_policy": "time decay + importance score",
                "access_pattern": "semantic similarity search",
                "ttl": "days to months"
            },
            MemoryLayer.SEMANTIC_MEMORY: {
                "storage": "structured database / knowledge graph",
                "max_entries": "unlimited",
                "retention_policy": "version control",
                "access_pattern": "exact match / graph traversal",
                "ttl": "permanent"
            },
        }
        return strategies.get(layer, {})
```

---

## 10. 系统化遗忘机制

简单的时间衰减已经不够。真实的 Agent 系统需要更精细的遗忘策略：为什么有些记忆应该被遗忘得快一些，有些应该被永久保留？本节介绍三种高级遗忘策略及其组合方案。

### 三种遗忘策略

#### 策略 1: 重要性评分遗忘

信息的重要性不是固定的。"用户偏好用表格格式展示数据"这条信息很重要（高权重）；而"2024-03-15 调用了 API，返回 200 状态码"就没那么重要（低权重）。

```python
import time
import math
from dataclasses import dataclass
from typing import Optional

@dataclass
class MemoryEntry:
    """记忆条目"""
    id: str
    content: str
    timestamp: float                    # 写入时间
    importance_score: float             # 初始重要性 (0-1)
    access_count: int = 0               # 被检索次数
    last_access_time: Optional[float] = None
    tags: list[str] = None              # 标签（如 user_preference, task_result）

    def set_importance(self, score: float):
        """手动设置重要性"""
        assert 0 <= score <= 1
        self.importance_score = score

    def increment_access(self):
        """记录访问"""
        self.access_count += 1
        self.last_access_time = time.time()


class ImportanceBasedForgetfulness:
    """基于重要性的遗忘管理器"""

    def __init__(self, base_forget_rate: float = 0.05):
        """
        Args:
            base_forget_rate: 基础遗忘率（每天遗忘的比例）
        """
        self.base_forget_rate = base_forget_rate

    def compute_forget_score(self, entry: MemoryEntry, current_time: float) -> float:
        """
        计算遗忘评分：值越高，越应该被遗忘

        基础公式：
        forget_score = base_rate × time_factor × (1 - importance_adjustment)

        where:
        - time_factor: 时间越久，遗忘倾向越强
        - importance_adjustment: 重要性越高，遗忘倾向越弱
        """

        # 计算时间衰减因子
        age_days = (current_time - entry.timestamp) / 86400
        time_factor = min(1.0, age_days / 30)  # 30 天后达到最大衰减

        # 重要性调整：重要性越高，遗忘评分越低
        # importance_score = 0.9 → importance_adjustment = 0.1（难以遗忘）
        # importance_score = 0.1 → importance_adjustment = 0.9（容易遗忘）
        importance_adjustment = 1 - entry.importance_score

        forget_score = self.base_forget_rate * time_factor * importance_adjustment

        return forget_score

    def should_forget(self, entry: MemoryEntry, current_time: float, threshold: float = 0.5) -> bool:
        """判断是否应该遗忘这条记忆"""
        return self.compute_forget_score(entry, current_time) > threshold


class QueryFrequencyBasedForgetfulness:
    """基于查询频率的热度衰减"""

    def __init__(self, lookback_days: int = 30, hot_threshold: int = 5):
        """
        Args:
            lookback_days: 计算热度的时间窗口
            hot_threshold: 判定为"热"的最少访问次数
        """
        self.lookback_days = lookback_days
        self.hot_threshold = hot_threshold

    def compute_hotness(self, entry: MemoryEntry, current_time: float) -> float:
        """
        计算记忆的"热度"：最近被访问的频率

        热度范围 0-1：
        - 1.0: 非常热（最近经常被检索）
        - 0.5: 中等
        - 0.0: 冷（很久没被检索过）
        """

        if entry.last_access_time is None:
            # 从未被访问
            age_days = (current_time - entry.timestamp) / 86400
            return max(0, 1 - age_days / 30)  # 新记忆默认较热

        # 最后访问距今的天数
        days_since_last_access = (
            (current_time - entry.last_access_time) / 86400
        )

        # 查询频率（每天访问次数）
        days_of_existence = (current_time - entry.timestamp) / 86400
        if days_of_existence == 0:
            days_of_existence = 1
        access_frequency = entry.access_count / days_of_existence

        # 综合评分：近期被访问 + 频繁被访问
        recency_score = max(0, 1 - days_since_last_access / self.lookback_days)
        frequency_score = min(1.0, access_frequency / self.hot_threshold)

        hotness = recency_score * 0.6 + frequency_score * 0.4
        return hotness

    def should_downgrade(self, entry: MemoryEntry, current_time: float) -> bool:
        """
        判断是否应该将记忆从高优先级降级到低优先级

        降级意味着：
        - 从 Episodic Memory 转移到冷存储（如归档库）
        - 检索时优先级降低
        - 自动清理列表中的排序靠后
        """
        hotness = self.compute_hotness(entry, current_time)
        return hotness < 0.2  # 热度过低时降级
```

#### 策略 2: 混合遗忘（时间 × 重要性 × 热度）

上面的两个策略可以结合起来，形成一个更强大的遗忘模型：

```python
class HybridForgettingManager:
    """综合时间、重要性、热度的遗忘管理器"""

    def __init__(
        self,
        base_forget_rate: float = 0.05,
        weight_time: float = 0.4,
        weight_importance: float = 0.35,
        weight_hotness: float = 0.25,
    ):
        self.base_forget_rate = base_forget_rate
        self.weight_time = weight_time
        self.weight_importance = weight_importance
        self.weight_hotness = weight_hotness

        self.importance_mgr = ImportanceBasedForgetfulness(base_forget_rate)
        self.hotness_mgr = QueryFrequencyBasedForgetfulness()

    def compute_comprehensive_forget_score(
        self, entry: MemoryEntry, current_time: float
    ) -> float:
        """
        综合评分：越高越应该被遗忘

        final_score =
            weight_time × time_score +
            weight_importance × (1 - importance_score) +
            weight_hotness × (1 - hotness_score)
        """

        # 时间评分：越久越容易遗忘
        age_days = (current_time - entry.timestamp) / 86400
        time_score = min(1.0, age_days / 90)  # 90 天后达到最大

        # 重要性评分：直接使用 entry 中存储的值
        importance_penalty = 1 - entry.importance_score

        # 热度评分：冷的记忆更容易遗忘
        hotness = self.hotness_mgr.compute_hotness(entry, current_time)
        hotness_penalty = 1 - hotness

        # 加权综合
        final_score = (
            self.weight_time * time_score +
            self.weight_importance * importance_penalty +
            self.weight_hotness * hotness_penalty
        )

        return final_score

    def should_forget(
        self, entry: MemoryEntry, current_time: float, threshold: float = 0.6
    ) -> bool:
        """判断是否应该遗忘"""
        score = self.compute_comprehensive_forget_score(entry, current_time)
        return score > threshold

    def get_forget_probability(
        self, entry: MemoryEntry, current_time: float
    ) -> float:
        """
        获取遗忘概率（0-1）

        可用于：
        - 决定是否定期执行遗忘检查
        - 生成遗忘日志
        - 监控记忆库的健康度
        """
        score = self.compute_comprehensive_forget_score(entry, current_time)
        # 使用 sigmoid 函数将评分转换为概率
        return 1 / (1 + math.exp(-5 * (score - 0.5)))


class ForgettingManager:
    """
    记忆遗忘的主管理类

    责任：
    1. 定期扫描记忆库，识别应该遗忘的条目
    2. 执行遗忘操作（删除或降级）
    3. 记录遗忘日志（用于调试和分析）
    4. 支持撤销遗忘（soft delete）
    """

    def __init__(self, memory_store, config: Dict[str, Any] = None):
        self.memory_store = memory_store
        self.config = config or self._default_config()

        self.hybrid_mgr = HybridForgettingManager(
            base_forget_rate=self.config["base_forget_rate"],
            weight_time=self.config["weight_time"],
            weight_importance=self.config["weight_importance"],
            weight_hotness=self.config["weight_hotness"],
        )

        self.forget_log = []

    @staticmethod
    def _default_config() -> Dict[str, Any]:
        return {
            "base_forget_rate": 0.05,
            "weight_time": 0.4,
            "weight_importance": 0.35,
            "weight_hotness": 0.25,
            "forget_threshold": 0.6,
            "batch_size": 100,
            "check_interval_seconds": 3600,  # 每小时检查一次
        }

    def scan_and_forget(self, current_time: Optional[float] = None) -> Dict[str, Any]:
        """
        扫描整个记忆库，执行遗忘操作

        Returns:
            {
                "deleted": int,           # 删除的条目数
                "downgraded": int,        # 降级的条目数
                "preserved": int,         # 保留的条目数
                "log": [...]              # 详细日志
            }
        """
        if current_time is None:
            current_time = time.time()

        deleted_count = 0
        downgraded_count = 0
        preserved_count = 0

        # 分批扫描
        all_entries = self.memory_store.list_all()
        batch_size = self.config["batch_size"]

        for i in range(0, len(all_entries), batch_size):
            batch = all_entries[i : i + batch_size]

            for entry in batch:
                should_delete = self.hybrid_mgr.should_forget(
                    entry, current_time, threshold=self.config["forget_threshold"]
                )

                if should_delete:
                    self.memory_store.soft_delete(entry.id)
                    deleted_count += 1
                    self.forget_log.append({
                        "timestamp": current_time,
                        "action": "delete",
                        "entry_id": entry.id,
                        "reason": "forget_threshold_exceeded",
                        "score": self.hybrid_mgr.compute_comprehensive_forget_score(
                            entry, current_time
                        ),
                    })
                else:
                    preserved_count += 1

        return {
            "deleted": deleted_count,
            "downgraded": downgraded_count,
            "preserved": preserved_count,
            "total_scanned": len(all_entries),
            "log_sample": self.forget_log[-10:],
        }

    def restore_forgotten(self, entry_id: str) -> bool:
        """
        撤销遗忘操作（如果支持软删除）

        通常在以下场景使用：
        - 用户明确要求恢复某条记忆
        - 系统发现遗忘错误
        """
        return self.memory_store.restore(entry_id)

    def batch_set_importance(self, tag: str, importance: float):
        """
        批量设置某类记忆的重要性

        Args:
            tag: 记忆标签（如 "user_preference"）
            importance: 新的重要性评分 (0-1)

        Example:
            mgr.batch_set_importance("user_preference", 0.95)
            # 所有标记为用户偏好的记忆都变成"难以遗忘"
        """
        entries = self.memory_store.query_by_tag(tag)
        for entry in entries:
            entry.set_importance(importance)
            self.memory_store.update(entry)
```

---

## 11. Embedding 成本优化

向量化（Embedding）是检索的关键，但 Token 成本不容忽视。对于一个中等规模的 Episodic Memory 库（10000 条记忆），定期重新 Embedding 所有条目会产生巨大成本。本节介绍三种成本优化策略。

### 问题分析

假设你有一个 Episodic Memory 库，包含 10,000 条过去的交互记录。每条记录平均 200 tokens。

**全量 Embedding 的成本**：
```
10,000 条 × 200 tokens = 2,000,000 tokens

假设 Embedding API 的价格是 $0.02 per 1M tokens（如 OpenAI text-embedding-3-small）：
成本 = 2,000,000 × $0.02 / 1,000,000 = $0.04

看起来不贵。但问题是：
1. 如果每天新增 100 条记忆，每周需要重新 Embedding？
2. 如果记忆库增长到 100,000 条？
3. 如果你运行多个 Agent 实例？
```

**实际成本考虑**：

```
周场景：
- 每周全量 Embedding: 10,000 条 × 200 tokens × 52 周 = 104M tokens/年
- 年成本: ~$2,080/年（单个库）

如果有 10 个 Agent 实例，每个都维护自己的记忆库：
- 年成本: $20,800/年
```

### 策略 1: 增量 vs 全量

最直接的优化：只 Embedding 新增或修改的记忆，而不是全量重新计算。

```python
from datetime import datetime, timedelta
from typing import List, Optional

class IncrementalEmbeddingStrategy:
    """增量 Embedding 策略"""

    def __init__(self, embedding_client, memory_store):
        self.embedding_client = embedding_client
        self.memory_store = memory_store
        self.last_embedding_time = None

    def get_records_needing_embedding(
        self,
        since: Optional[datetime] = None,
        include_modified: bool = True
    ) -> List[MemoryEntry]:
        """
        获取需要 Embedding 的记录

        Args:
            since: 只返回此时间点之后的记录
            include_modified: 是否包含修改过的记录

        Returns:
            待 Embedding 的记录列表
        """
        if since is None:
            since = self.last_embedding_time or (
                datetime.now() - timedelta(days=7)
            )

        criteria = {
            "created_after": since,
        }

        if include_modified:
            criteria["modified_after"] = since

        return self.memory_store.query(criteria)

    def embed_incremental(self) -> Dict[str, Any]:
        """
        执行增量 Embedding

        Returns:
            {
                "newly_embedded": int,
                "cost": float,
                "tokens_used": int,
                "time_elapsed": float
            }
        """
        records = self.get_records_needing_embedding()

        if not records:
            return {"newly_embedded": 0, "cost": 0, "tokens_used": 0}

        # 批量获取 Embedding
        texts = [r.content for r in records]
        embeddings, tokens_used = self.embedding_client.embed_batch(texts)

        # 写回记忆库
        for record, embedding in zip(records, embeddings):
            record.embedding = embedding
            record.embedding_timestamp = datetime.now()
            self.memory_store.update(record)

        self.last_embedding_time = datetime.now()

        cost = self._estimate_cost(tokens_used)

        return {
            "newly_embedded": len(records),
            "tokens_used": tokens_used,
            "cost": cost,
        }

    @staticmethod
    def _estimate_cost(tokens: int, price_per_1m: float = 0.02) -> float:
        """估算成本"""
        return tokens / 1_000_000 * price_per_1m
```

**成本对比**：

```
假设每天新增 50 条记忆（200 tokens/条）：
- 增量 Embedding (每天): 50 × 200 = 10K tokens/天 = $0.0002/天
- 全量 Embedding (每周): 2M tokens/周 = $0.04/周 = $2.08/年

![Re-embedding 成本对比](/images/blog/agentic-08/08-re-embedding-cost.svg)

### 策略 2: 哈希缓存（内容不变则跳过重新 Embedding）

问题：有些记忆的内容可能被修改（如重要性评分改变，但文本内容不变）。此时重新 Embedding 是浪费。

```python
import hashlib

class EmbeddingCacheWithHashVerification:
    """使用内容哈希缓存 Embedding 结果"""

    def __init__(self, embedding_client, memory_store):
        self.embedding_client = embedding_client
        self.memory_store = memory_store
        self.content_hash_cache = {}  # content_hash -> embedding

    @staticmethod
    def compute_content_hash(content: str) -> str:
        """计算内容的 SHA256 哈希"""
        return hashlib.sha256(content.encode()).hexdigest()

    def get_or_embed(self, record: MemoryEntry) -> List[float]:
        """
        获取 Embedding，如果内容未变则返回缓存结果

        Args:
            record: 记忆条目

        Returns:
            embedding 向量
        """
        content_hash = self.compute_content_hash(record.content)

        # 情况 1: 记录本身就有 embedding（可能来自之前的计算）
        if record.embedding is not None:
            # 检查内容是否改变过
            if not hasattr(record, "content_hash") or record.content_hash == content_hash:
                # 内容未变，直接返回已有的 embedding
                return record.embedding

        # 情况 2: 哈希缓存中有
        if content_hash in self.content_hash_cache:
            embedding = self.content_hash_cache[content_hash]
            record.embedding = embedding
            record.content_hash = content_hash
            return embedding

        # 情况 3: 需要调用 API 计算新的 embedding
        embedding = self.embedding_client.embed(record.content)
        self.content_hash_cache[content_hash] = embedding
        record.embedding = embedding
        record.content_hash = content_hash

        return embedding

    def batch_get_or_embed(self, records: List[MemoryEntry]) -> Dict[str, List[float]]:
        """
        批量获取 Embedding，智能判断是否需要调用 API

        Returns:
            {record_id: embedding}
        """
        to_embed = []
        cached_results = {}

        for record in records:
            content_hash = self.compute_content_hash(record.content)

            # 检查缓存
            if content_hash in self.content_hash_cache:
                cached_results[record.id] = self.content_hash_cache[content_hash]
            elif record.embedding is not None and (
                not hasattr(record, "content_hash") or record.content_hash == content_hash
            ):
                cached_results[record.id] = record.embedding
            else:
                to_embed.append((record.id, record.content, content_hash))

        # 批量调用 API（只处理需要的）
        newly_embedded = {}
        if to_embed:
            ids, contents, hashes = zip(*to_embed)
            embeddings = self.embedding_client.embed_batch(contents)

            for record_id, embedding, content_hash in zip(ids, embeddings, hashes):
                newly_embedded[record_id] = embedding
                self.content_hash_cache[content_hash] = embedding

        # 合并结果
        return {**cached_results, **newly_embedded}

    def clear_cache(self):
        """清空缓存（可选）"""
        self.content_hash_cache.clear()
```

**缓存效果示例**：

```
假设 10,000 条记忆中：
- 20% 的记忆内容从未改变（100% 命中缓存）
- 30% 的记忆内容改变过，但现在稳定（70% 命中）
- 50% 的记忆是新的或频繁改变（0% 命中）

实际需要 Embedding 的比例：
= 20% × 0% + 30% × 30% + 50% × 100%
= 0% + 9% + 50%
= 59%

节省成本：41%（与全量 Embedding 相比）
```

### 策略 3: 批量 Embedding 的吞吐优化

当需要 Embedding 大量记忆时，批处理和并发可以显著提升吞吐量。

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed

class BatchEmbeddingOptimizer:
    """批量 Embedding 的吞吐优化"""

    def __init__(
        self,
        embedding_client,
        batch_size: int = 100,
        max_workers: int = 4,
    ):
        self.embedding_client = embedding_client
        self.batch_size = batch_size
        self.max_workers = max_workers

    def embed_batch_sync(self, texts: List[str], show_progress: bool = True) -> List[List[float]]:
        """
        同步批量 Embedding

        Args:
            texts: 待 Embedding 的文本列表
            show_progress: 是否显示进度

        Returns:
            Embedding 向量列表
        """
        embeddings = []
        total_batches = (len(texts) + self.batch_size - 1) // self.batch_size

        for i in range(0, len(texts), self.batch_size):
            batch = texts[i : i + self.batch_size]
            batch_embeddings = self.embedding_client.embed_batch(batch)
            embeddings.extend(batch_embeddings)

            if show_progress:
                current_batch = (i // self.batch_size) + 1
                print(f"Progress: {current_batch}/{total_batches} batches")

        return embeddings

    async def embed_batch_async(self, texts: List[str]) -> List[List[float]]:
        """
        异步批量 Embedding（更高效）

        Args:
            texts: 待 Embedding 的文本列表

        Returns:
            Embedding 向量列表
        """
        loop = asyncio.get_event_loop()

        def process_batch(batch):
            return self.embedding_client.embed_batch(batch)

        embeddings = []
        tasks = []

        # 将文本分批，创建异步任务
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i : i + self.batch_size]
            task = loop.run_in_executor(None, process_batch, batch)
            tasks.append(task)

        # 等待所有任务完成
        results = await asyncio.gather(*tasks)
        for result in results:
            embeddings.extend(result)

        return embeddings

    def estimate_cost_and_time(self, num_texts: int, avg_tokens_per_text: int) -> Dict[str, Any]:
        """
        估算成本和时间

        Args:
            num_texts: 文本数量
            avg_tokens_per_text: 平均每条文本的 token 数

        Returns:
            {
                "total_tokens": int,
                "estimated_cost": float,
                "estimated_time_seconds": float,
                "api_calls": int,
                "batches": int,
            }
        """
        total_tokens = num_texts * avg_tokens_per_text
        total_batches = (num_texts + self.batch_size - 1) // self.batch_size

        # 假设平均响应时间 1 秒/batch，支持 4 个并发
        estimated_time = (total_batches / self.max_workers) * 1.0

        estimated_cost = total_tokens / 1_000_000 * 0.02  # 以 $0.02/1M 计

        return {
            "total_texts": num_texts,
            "total_tokens": total_tokens,
            "estimated_cost": estimated_cost,
            "estimated_time_seconds": estimated_time,
            "api_calls": total_batches,
            "batches": total_batches,
        }


class EmbeddingCostOptimizer:
    """综合 Embedding 成本优化管理器"""

    def __init__(self, embedding_client, memory_store):
        self.embedding_client = embedding_client
        self.memory_store = memory_store
        self.hash_cache = EmbeddingCacheWithHashVerification(
            embedding_client, memory_store
        )
        self.batch_optimizer = BatchEmbeddingOptimizer(embedding_client)
        self.cost_log = []

    def optimize_and_embed(self, records: List[MemoryEntry]) -> Dict[str, Any]:
        """
        使用所有优化策略进行 Embedding

        流程：
        1. 使用哈希缓存跳过未变更的内容
        2. 使用批量处理提升吞吐
        3. 记录成本和统计信息
        """

        start_time = time.time()

        # 步骤 1: 哈希缓存过滤
        result = self.hash_cache.batch_get_or_embed(records)

        elapsed_time = time.time() - start_time

        # 统计
        cache_hits = sum(
            1 for r in records if r.id in result and r.embedding is not None
        )
        newly_embedded = len(records) - cache_hits

        # 估算成本（简化估算）
        api_calls = (newly_embedded + self.batch_optimizer.batch_size - 1) // self.batch_optimizer.batch_size
        avg_tokens = 200  # 假设
        estimated_cost = newly_embedded * avg_tokens / 1_000_000 * 0.02

        log_entry = {
            "timestamp": datetime.now(),
            "total_records": len(records),
            "cache_hits": cache_hits,
            "newly_embedded": newly_embedded,
            "cost_saved_by_cache": (cache_hits * avg_tokens / 1_000_000 * 0.02),
            "estimated_cost": estimated_cost,
            "elapsed_time": elapsed_time,
        }
        self.cost_log.append(log_entry)

        return {
            "completed": True,
            "embedded_records": result,
            "statistics": log_entry,
            "cumulative_cost": sum(log["estimated_cost"] for log in self.cost_log),
        }
```

---

## 12. 多租户记忆隔离与并发控制

当 Agent 系统支持多用户场景时，记忆隔离和并发控制变成必需品。一个用户的记忆不能泄露给另一个用户，同时多个用户可能并发修改各自的记忆。

### 隔离方案

#### 方案 1: User ID 命名空间隔离

最直接的方案：所有记忆的 key 都带上 `user_id` 前缀。

```python
from typing import Optional, Dict, Any

class NamespacedMemoryStore:
    """基于 user_id 命名空间的隔离存储"""

    def __init__(self, backend_store):
        """
        Args:
            backend_store: 底层存储（如 Redis 或数据库）
        """
        self.backend = backend_store

    @staticmethod
    def _make_key(user_id: str, memory_layer: str, entry_id: str) -> str:
        """生成命名空间化的 key"""
        return f"user:{user_id}:memory:{memory_layer}:{entry_id}"

    def write(
        self,
        user_id: str,
        memory_layer: str,
        entry_id: str,
        value: Dict[str, Any],
    ) -> bool:
        """写入记忆"""
        key = self._make_key(user_id, memory_layer, entry_id)
        return self.backend.set(key, value)

    def read(
        self,
        user_id: str,
        memory_layer: str,
        entry_id: str,
    ) -> Optional[Dict[str, Any]]:
        """读取记忆"""
        key = self._make_key(user_id, memory_layer, entry_id)
        return self.backend.get(key)

    def list_user_memories(
        self,
        user_id: str,
        memory_layer: Optional[str] = None,
    ) -> Dict[str, Any]:
        """列出用户的所有记忆"""
        pattern = f"user:{user_id}:memory:{memory_layer or '*'}:*"
        keys = self.backend.keys(pattern)
        return {key: self.backend.get(key) for key in keys}

    def delete(self, user_id: str, memory_layer: str, entry_id: str) -> bool:
        """删除记忆"""
        key = self._make_key(user_id, memory_layer, entry_id)
        return self.backend.delete(key)
```

**隔离效果验证**：

```python
# 用户 A 的数据
store.write("user_a", "episodic", "ep_001", {"content": "..."})

# 用户 B 读取
result = store.read("user_b", "episodic", "ep_001")
# result = None（隔离成功！）

# 列出用户 A 的所有记忆
user_a_memories = store.list_user_memories("user_a")
# 只会返回 user_a 的记忆，不会泄露其他用户的数据
```

### 并发控制

#### 方案 2: 乐观锁 + 版本号

当多个 Agent 实例可能同时修改同一条记忆时，需要并发控制。乐观锁是一个轻量级方案。

```python
from dataclasses import dataclass
import threading

@dataclass
class VersionedMemoryEntry:
    """支持版本控制的记忆条目"""

    id: str
    user_id: str
    content: str
    version: int = 1              # 版本号，每次更新递增
    last_modified_time: float = None
    last_modified_by: str = None   # 修改者（agent ID）
    locked: bool = False
    lock_owner: Optional[str] = None
    lock_time: Optional[float] = None


class OptimisticLockingMemoryStore:
    """基于乐观锁的并发控制"""

    def __init__(self, backend_store):
        self.backend = backend_store
        self.local_lock = threading.RLock()  # 本地锁（保护字典操作）

    def read_with_version(
        self, user_id: str, entry_id: str
    ) -> tuple[VersionedMemoryEntry, bool]:
        """
        读取记忆并获取版本号

        Returns:
            (entry, success)
        """
        key = f"user:{user_id}:entry:{entry_id}"
        entry = self.backend.get(key)

        if entry is None:
            return None, False

        return VersionedMemoryEntry(**entry), True

    def write_with_version_check(
        self,
        user_id: str,
        entry_id: str,
        new_content: str,
        expected_version: int,
        agent_id: str,
    ) -> tuple[bool, str]:
        """
        有条件更新：只有版本号匹配才能更新

        Args:
            user_id: 用户 ID
            entry_id: 条目 ID
            new_content: 新内容
            expected_version: 期望的版本号（乐观锁）
            agent_id: 执行修改的 agent

        Returns:
            (success, message)
        """
        key = f"user:{user_id}:entry:{entry_id}"

        with self.local_lock:
            current = self.backend.get(key)

            if current is None:
                # 新建条目
                self.backend.set(
                    key,
                    {
                        "id": entry_id,
                        "user_id": user_id,
                        "content": new_content,
                        "version": 1,
                        "last_modified_by": agent_id,
                        "last_modified_time": time.time(),
                    },
                )
                return True, "Created"

            current_version = current.get("version", 1)

            if current_version != expected_version:
                # 版本不匹配，更新失败
                return (
                    False,
                    f"Version mismatch: expected {expected_version}, "
                    f"got {current_version}. Concurrent modification detected.",
                )

            # 版本匹配，执行更新
            self.backend.set(
                key,
                {
                    **current,
                    "content": new_content,
                    "version": current_version + 1,
                    "last_modified_by": agent_id,
                    "last_modified_time": time.time(),
                },
            )

            return True, f"Updated to version {current_version + 1}"

    def resolve_conflict(
        self,
        user_id: str,
        entry_id: str,
        conflict_strategy: str = "latest-write-wins",
    ) -> tuple[VersionedMemoryEntry, bool]:
        """
        当乐观锁失败时，尝试冲突解决

        Args:
            conflict_strategy: 冲突策略
                - "latest-write-wins": 保留最新的版本（默认）
                - "merge": 尝试合并两个版本
                - "abort": 放弃此次更新

        Returns:
            (resolved_entry, success)
        """
        key = f"user:{user_id}:entry:{entry_id}"
        current = self.backend.get(key)

        if current is None:
            return None, False

        # 重新读取最新版本
        latest_entry = VersionedMemoryEntry(**current)

        if conflict_strategy == "latest-write-wins":
            # 直接返回最新版本
            return latest_entry, True

        elif conflict_strategy == "merge":
            # 这里可以实现更复杂的合并逻辑
            # 示例：如果内容是 JSON，可以做字段级合并
            return latest_entry, True

        elif conflict_strategy == "abort":
            return None, False

        return None, False
```

### 租户级配额管理

```python
@dataclass
class TenantQuota:
    """租户级配额"""

    user_id: str
    max_memory_entries: int       # 最多存储条目数
    max_embedding_per_day: int    # 每天最多 Embedding 次数
    max_context_window_tokens: int # 单次推理最多注入 token
    storage_limit_gb: float        # 存储空间限制


class MultiTenantMemoryStore:
    """支持多租户、隔离、并发控制的记忆存储"""

    def __init__(
        self,
        backend_store,
        default_quota: Optional[TenantQuota] = None,
    ):
        self.backend = backend_store
        self.namespaced_store = NamespacedMemoryStore(backend_store)
        self.locking_store = OptimisticLockingMemoryStore(backend_store)
        self.quotas: Dict[str, TenantQuota] = {}
        self.default_quota = (
            default_quota or self._create_default_quota()
        )

    @staticmethod
    def _create_default_quota() -> TenantQuota:
        """默认配额"""
        return TenantQuota(
            user_id="default",
            max_memory_entries=10000,
            max_embedding_per_day=50000,
            max_context_window_tokens=32768,
            storage_limit_gb=10.0,
        )

    def register_user(self, user_id: str, quota: Optional[TenantQuota] = None):
        """注册用户及其配额"""
        if quota is None:
            quota = TenantQuota(
                user_id=user_id,
                **{
                    k: v for k, v in self.default_quota.__dict__.items()
                    if k != "user_id"
                },
            )
        self.quotas[user_id] = quota

    def check_quota(self, user_id: str, operation: str) -> tuple[bool, str]:
        """检查用户是否满足配额"""
        if user_id not in self.quotas:
            return False, f"User {user_id} not registered"

        quota = self.quotas[user_id]

        if operation == "write_entry":
            # 检查条目数量限制
            user_memories = self.namespaced_store.list_user_memories(user_id)
            if len(user_memories) >= quota.max_memory_entries:
                return (
                    False,
                    f"Exceeded max entries limit: {quota.max_memory_entries}",
                )

        elif operation == "embedding":
            # 检查每日 Embedding 配额（简化）
            # 实际应用中需要记录每日消费
            pass

        elif operation == "context_injection":
            # 检查上下文注入限制
            pass

        return True, "OK"

    def write_memory(
        self,
        user_id: str,
        memory_layer: str,
        entry_id: str,
        content: str,
        agent_id: str,
    ) -> tuple[bool, str]:
        """
        写入记忆（带租户隔离和配额检查）

        Args:
            user_id: 用户 ID
            memory_layer: 记忆层级
            entry_id: 条目 ID
            content: 内容
            agent_id: 执行操作的 agent

        Returns:
            (success, message)
        """

        # 步骤 1: 检查配额
        quota_ok, quota_msg = self.check_quota(user_id, "write_entry")
        if not quota_ok:
            return False, quota_msg

        # 步骤 2: 读取旧版本（为了获取版本号）
        old_entry, found = self.locking_store.read_with_version(user_id, entry_id)
        expected_version = old_entry.version if found else 0

        # 步骤 3: 尝试写入（带乐观锁）
        success, msg = self.locking_store.write_with_version_check(
            user_id=user_id,
            entry_id=entry_id,
            new_content=content,
            expected_version=expected_version,
            agent_id=agent_id,
        )

        return success, msg

    def read_memory(self, user_id: str, entry_id: str) -> Optional[Dict[str, Any]]:
        """读取记忆（带租户隔离）"""
        entry, found = self.locking_store.read_with_version(user_id, entry_id)
        if not found:
            return None
        return entry.__dict__

    def list_user_memories(self, user_id: str, memory_layer: Optional[str] = None) -> Dict[str, Any]:
        """列出用户的所有记忆（租户隔离）"""
        return self.namespaced_store.list_user_memories(user_id, memory_layer)

    def enforce_quota_limit(self, user_id: str):
        """
        强制执行配额限制

        在存储空间或条目数超限时触发：
        1. 遗忘最不重要的条目
        2. 压缩旧的对话历史
        3. 发送告警通知
        """
        quota = self.quotas.get(user_id, self.default_quota)
        user_memories = self.namespaced_store.list_user_memories(user_id)

        if len(user_memories) > quota.max_memory_entries:
            # 触发遗忘机制
            excess = len(user_memories) - quota.max_memory_entries
            # ... 删除最不重要的 excess 条记忆
            pass
```

---

## 13. 小结与下一步（更新）

本文建立了 Agent 记忆的四层架构，并深入讨论了四个进阶主题：

![Agent 记忆堆栈总览](/images/blog/agentic-08/09-agent-memory-stack.svg)

核心 takeaway：

1. **记忆是分层的**：不同信息有不同的生命周期和存储需求，不能"一刀切"
2. **Context Window 是硬约束**：所有记忆最终都要在有限的 token 预算内竞争，需要精细的预算分配
3. **遗忘是特性**：没有遗忘机制的记忆系统最终会被噪声淹没
4. **读写时机很关键**：什么时候写入、什么时候检索、检索多少条——这些决策直接影响 Agent 的表现
5. **从简单开始**：先用内存 + 滑动窗口跑通，再逐步引入向量检索和 LLM 摘要

### 四个进阶主题总结

本文在基础四层架构之上，补充了四个生产级别的优化：

**第 9 章 - 记忆分层决策树**：解决"这条信息应该存哪里"的问题。提供了从信息特征自动路由到对应记忆层的决策框架，并给出了五个具体的示例及其对应的编码实现。

**第 10 章 - 系统化遗忘机制**：超越时间衰减的简单模型，介绍了三种高级策略：基于重要性的遗忘、基于查询热度的衰减、以及结合三维因素（时间 × 重要性 × 热度）的混合遗忘。给出了完整的 `ForgettingManager` 类实现。

**第 11 章 - Embedding 成本优化**：向量化的隐性成本往往被忽视。本章讨论增量 vs 全量 Embedding、哈希缓存（跳过内容未变的重新计算）、以及批量处理的吞吐优化，可以削减 40-60% 的 Embedding 成本。给出了 `EmbeddingCostOptimizer` 的完整实现。

**第 12 章 - 多租户隔离与并发控制**：当 Agent 服务多用户时，记忆隔离和并发一致性变成必需品。本章介绍了命名空间隔离、乐观锁 + 版本号的并发控制、以及租户级配额管理，给出了 `MultiTenantMemoryStore` 的框架代码。

在四层记忆中，Layer 4 Semantic Memory 的"读取"操作——即如何从大规模知识库中高效检索相关信息——是一个足够深的话题。它涉及 Ingestion、Chunking、Embedding、Hybrid Retrieval、Reranking 等一系列工程决策。

这正是下一篇文章的主题：**RAG as Cognitive Memory: 检索增强生成的工程实践**。我们将深入 RAG 管线的每一个环节，探讨如何为 Agent 构建高质量的"外部大脑"。

---

## 进一步思考

1. **Memory Consolidation**：人类在睡眠中会将短期记忆"固化"为长期记忆。Agent 能否也有类似的机制——在空闲时对 Episodic Memory 做去重、聚合、抽象化？
2. **Shared Memory**：多 Agent 协作场景下，如何设计共享记忆？一个 Agent 的发现如何高效传递给另一个 Agent？
3. **Memory as Skill**：能否让 Agent 从记忆中"学会"新技能，而非仅仅"记住"过去的经验？比如从 10 次类似任务的记录中归纳出一个通用策略。
4. **Privacy-Aware Memory**：用户说"忘记我刚才说的"，记忆系统能否真正做到选择性遗忘？在向量数据库中，删除一条记录是否真的消除了它对其他向量的影响？
5. **Memory Hallucination**：当 Episodic Memory 中存储了不准确的信息（比如一次错误的推理结论），它会不会在后续检索中"污染"Agent 的决策？如何设计记忆的"自校正"机制？
