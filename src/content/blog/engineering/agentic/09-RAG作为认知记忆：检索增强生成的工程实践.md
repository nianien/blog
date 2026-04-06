---
title: "RAG作为认知记忆：检索增强生成的工程实践"
pubDate: "2026-01-07"
description: "RAG 不是搜索+拼接，而是 Agent 的认知记忆系统。本文从 Ingestion、Chunking、Embedding、Hybrid Retrieval、Reranking 到 Context Packing，逐层拆解 RAG Pipeline 的工程实践与决策 Trade-off。核心观点：检索质量 > 模型大小。"
tags: ["Agentic", "AI Engineering", "RAG"]
---

> 系列第 9 篇。上一篇我们讨论了 Agent 的记忆架构——会话状态、短期记忆与长期记忆。本篇聚焦长期记忆中最核心的工程问题：如何让 Agent 在海量知识中精准找到它需要的信息。
>
> 核心命题：**检索质量 > 模型大小。** 一个用 GPT-3.5 + 优秀 RAG 的系统，往往比 GPT-4 + 粗糙检索的系统表现更好。RAG 是工程问题，不是模型问题。

---

## 1. RAG 不是"搜索+拼接"

很多团队对 RAG 的理解停留在"把搜索结果塞进 prompt"这一层。这种理解会导致系统质量的天花板极低。

RAG 的本质是 **Agent 的认知记忆系统**。人类回答问题时，不是把大脑里所有信息倒出来再筛选——而是根据问题的语义，精准地从记忆中提取相关片段，重新组织后输出回答。RAG 做的事情完全一样：理解 Query 的意图，从知识库中检索最相关的上下文，以最优的方式组织给 LLM，让它生成有据可依的回答。

这个过程中，每一个环节都会影响最终质量：

- **Chunking 策略**决定了知识的粒度——切得不好，语义被割裂，检索再准也没用
- **Embedding 质量**决定了语义理解的上限——模型选错了，同义词都搜不到
- **检索策略**决定了召回的完整性——只用向量搜索，专有名词和 ID 就会丢失
- **Reranking**决定了精排的准确性——Top 100 召回可能很好，但 Top 5 的排序决定了 LLM 看到什么
- **Context Packing**决定了 LLM 的信息利用率——塞太多噪声，LLM 反而会被干扰

一个工程事实：在大多数 RAG 系统中，**80% 的质量问题出在检索侧，而非生成侧。** 换一个更贵的模型不如把检索做好。

---

## 2. RAG Pipeline 全景图

一个生产级 RAG 系统的完整数据流如下：

![RAG Pipeline: Offline Indexing 和 Online Retrieval](/images/blog/agentic-09/rag-pipeline.svg)

整个 Pipeline 分为两个阶段：**离线索引（Offline Indexing）** 和 **在线检索（Online Retrieval）**。离线阶段处理和索引文档，在线阶段处理用户查询并生成回答。接下来逐一拆解每个环节。

---

## 3. Ingestion：数据进入系统的第一关

### 3.1 数据源多样性

真实世界的知识不会以整洁的纯文本出现。一个企业级 RAG 系统通常需要处理：

| 数据源 | 挑战 | 处理策略 |
|-------|------|---------|
| PDF | 布局复杂、表格、图片、双栏 | 使用专用解析器（如 PyMuPDF、Unstructured） |
| HTML | 导航栏、广告、模板噪声 | 内容提取 + boilerplate 去除 |
| Markdown | 相对规范，但嵌套结构多 | 按标题层级保留结构信息 |
| 代码文件 | 函数、类、注释的语义边界 | AST 解析或按函数/类切分 |
| 数据库 | 结构化数据需转换为文本 | Schema 描述 + 行级文本化 |

### 3.2 文档预处理

原始文档进入系统前，必须经过清洗和归一化：

```python
from dataclasses import dataclass, field
from typing import Optional
import hashlib
import re

@dataclass
class Document:
    """归一化后的文档表示"""
    content: str
    source: str                           # 来源标识（URL、文件路径等）
    doc_type: str                         # pdf, html, markdown, code
    metadata: dict = field(default_factory=dict)  # 标题、作者、日期等
    content_hash: str = ""                # 用于增量更新的去重

    def __post_init__(self):
        if not self.content_hash:
            self.content_hash = hashlib.sha256(
                self.content.encode()
            ).hexdigest()


def preprocess(raw_text: str) -> str:
    """文档预处理：清洗 + 归一化"""
    # 1. 去除多余空白
    text = re.sub(r'\n{3,}', '\n\n', raw_text)
    text = re.sub(r' {2,}', ' ', text)

    # 2. 去除特殊控制字符
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)

    # 3. 归一化 Unicode（统一全角/半角等）
    import unicodedata
    text = unicodedata.normalize('NFKC', text)

    return text.strip()
```

### 3.3 增量 vs 全量更新

| 策略 | 适用场景 | 实现复杂度 | 一致性保证 |
|------|---------|-----------|-----------|
| **全量重建** | 文档量小、更新不频繁 | 低 | 强（每次全量保证一致） |
| **增量更新** | 文档量大、频繁变更 | 高 | 需额外机制保证 |

增量更新的关键是 **content hash 去重**：对每个文档计算内容哈希，只有哈希变化时才重新处理。还需要处理文档删除——被删除的文档对应的 chunk 和向量必须从索引中清除，否则会产生"幽灵知识"。

---

## 4. Chunking：RAG 质量的胜负手

Chunking 是 RAG 中最容易被低估、但对质量影响最大的环节。切分策略直接决定了：
- 检索时能否命中相关内容
- 命中的内容是否包含足够上下文
- LLM 拿到的信息是否有噪声

### 4.1 固定长度切分

最简单的策略：按字符数或 token 数等间隔切分。

```python
def fixed_size_chunk(text: str, chunk_size: int = 512, overlap: int = 64) -> list[str]:
    """固定长度切分，带重叠"""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap  # 重叠区域
    return chunks
```

**优点**：实现简单，chunk 大小均匀，token 预算可控。
**缺点**：完全不考虑语义边界。一个段落可能被从中间切开，一个完整的论述被分到两个 chunk 中，检索时只能命中半句话。

**适用场景**：对内容结构不了解、无法解析的纯文本；快速原型验证。

### 4.2 语义切分

按文档的天然结构（段落、标题、代码块）切分：

```python
import re

def semantic_chunk(text: str, max_chunk_size: int = 1024) -> list[str]:
    """基于语义边界的切分"""
    # 按标题分割（Markdown）
    sections = re.split(r'\n(?=#{1,3}\s)', text)

    chunks = []
    for section in sections:
        if len(section) <= max_chunk_size:
            chunks.append(section.strip())
        else:
            # 如果单个 section 太大，按段落再分
            paragraphs = section.split('\n\n')
            current_chunk = ""
            for para in paragraphs:
                if len(current_chunk) + len(para) > max_chunk_size:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    current_chunk = para
                else:
                    current_chunk += "\n\n" + para
            if current_chunk:
                chunks.append(current_chunk.strip())

    return [c for c in chunks if c]  # 过滤空 chunk
```

**优点**：保留语义完整性，每个 chunk 是一个有意义的信息单元。
**缺点**：chunk 大小不均匀；依赖文档格式的规范性。

### 4.3 递归切分

分层递归：先按最大的结构边界切，切不动再用更小的边界：

```python
def recursive_chunk(
    text: str,
    chunk_size: int = 512,
    separators: list[str] = None
) -> list[str]:
    """递归切分：先按大结构，再按小结构"""
    if separators is None:
        separators = [
            "\n\n\n",   # 章节间空行
            "\n\n",      # 段落
            "\n",        # 行
            ". ",        # 句子
            " ",         # 单词
        ]

    if len(text) <= chunk_size:
        return [text]

    # 找到当前层级能用的分隔符
    for i, sep in enumerate(separators):
        if sep in text:
            parts = text.split(sep)
            chunks = []
            current = ""
            for part in parts:
                candidate = current + sep + part if current else part
                if len(candidate) <= chunk_size:
                    current = candidate
                else:
                    if current:
                        chunks.append(current)
                    # 如果单个 part 仍然超限，用更细的分隔符递归
                    if len(part) > chunk_size:
                        chunks.extend(
                            recursive_chunk(part, chunk_size, separators[i+1:])
                        )
                    else:
                        current = part
            if current:
                chunks.append(current)
            return chunks

    # 最后兜底：硬切
    return fixed_size_chunk(text, chunk_size)
```

这是 LangChain 的 `RecursiveCharacterTextSplitter` 采用的核心思路——先试大分隔符，不行再试小的，层层递归。

### 4.4 Overlap 策略

为什么需要重叠？考虑这段文本被切成两个 chunk：

```
Chunk 1: "...Transformer 模型的核心是 Self-Attention 机制，它允许模型在"
Chunk 2: "处理每个 token 时参考序列中所有其他 token 的信息..."
```

如果用户问"Self-Attention 机制有什么作用"，Chunk 1 命中了关键词但答案不完整，Chunk 2 有答案但没有关键词匹配不上。加入重叠区域后：

```
Chunk 1: "...Transformer 模型的核心是 Self-Attention 机制，它允许模型在处理每个 token 时"
Chunk 2: "Self-Attention 机制，它允许模型在处理每个 token 时参考序列中所有其他 token 的信息..."
```

两个 chunk 都包含了完整的语义。

**重叠多少合适？** 经验值是 chunk 大小的 10%-20%。太少起不到作用，太多则增加存储和检索冗余。对于 512 token 的 chunk，50-100 token 的 overlap 是合理的起点。

### 4.5 Chunking 策略选择 Trade-off

![Chunk 大小 Trade-off 图](/images/blog/agentic-09/chunk-tradeoff.svg)

实际选择建议：

| 文档类型 | 推荐 Chunk 大小 | 推荐策略 | 原因 |
|---------|----------------|---------|------|
| 技术文档 | 512-768 tokens | 递归（按标题+段落） | 结构清晰，段落边界明确 |
| 法律/合同 | 768-1024 tokens | 语义（按条款） | 条款不可割裂 |
| 代码 | 按函数/类 | 语义（AST 辅助） | 函数是最小可理解单元 |
| FAQ | 每个 QA 一个 chunk | 自然边界 | 问答对不可拆分 |
| 聊天记录 | 256-512 tokens | 按对话轮次 | 保持对话上下文 |

---

## 5. Embedding：将语义映射到向量空间

### 5.1 Embedding 模型选择

Embedding 模型将文本转换为高维向量，使语义相似的文本在向量空间中距离更近。选择合适的模型是基础。

| 维度 | 考量 | 建议 |
|------|------|------|
| **通用 vs 领域** | 通用模型覆盖面广但特定领域可能不够精确 | 先用通用模型验证，数据足够后考虑微调 |
| **向量维度** | 768 / 1024 / 1536 / 3072 | 768-1024 是性价比最高的区间 |
| **多语言** | 中英混合场景极其常见 | 必须选支持多语言的模型 |
| **推理成本** | 高维模型索引和检索更慢 | 生产环境需要 benchmark 延迟 |

关于维度选择的 Trade-off：维度越高，理论上能表示的语义越丰富——但实际收益递减明显。从 768 到 1536 的提升远小于从 384 到 768。同时，维度翻倍意味着存储翻倍、检索延迟增加。对大多数场景，**1024 维是一个好的默认选择**。

### 5.2 MTEB Benchmark

选择 Embedding 模型时，[MTEB（Massive Text Embedding Benchmark）](https://huggingface.co/spaces/mteb/leaderboard) 是最权威的参考。它从 Retrieval、Classification、Clustering 等多个维度评估模型能力。

但请注意：**MTEB 排名第一的模型不一定适合你。** 你需要关注：
- 你的数据语言在 benchmark 中是否有代表性
- 模型大小是否符合你的延迟和成本要求
- Retrieval 子任务的分数（而非总分）才是 RAG 场景最相关的

### 5.3 Embedding 实现

```python
from typing import Protocol

class EmbeddingModel(Protocol):
    """Embedding 模型接口抽象"""
    def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    @property
    def dimension(self) -> int:
        ...


class OpenAIEmbedding:
    """OpenAI Embedding 实现示例"""
    def __init__(self, model: str = "text-embedding-3-small"):
        from openai import OpenAI
        self.client = OpenAI()
        self.model = model
        self._dimension = 1536  # text-embedding-3-small 默认维度

    def embed(self, texts: list[str]) -> list[list[float]]:
        # 批量请求，减少 API 调用次数
        response = self.client.embeddings.create(
            model=self.model,
            input=texts
        )
        return [item.embedding for item in response.data]

    @property
    def dimension(self) -> int:
        return self._dimension
```

关键工程实践：

1. **批量 Embedding**：不要逐条调用 API，而是批量发送（通常 API 限制 2048 条/次）
2. **缓存**：相同内容不要重复 Embed，用 content hash 做缓存 key
3. **归一化**：部分模型输出未归一化的向量，需要显式 L2 归一化后再入库，否则 cosine similarity 计算不准

---

## 6. 检索策略：Hybrid Search

检索是 RAG 的核心。单一检索策略各有盲区，生产系统几乎都采用混合检索。

### 6.1 稀疏检索（BM25）

BM25 是经典的基于词频的检索算法。它的核心思想：一个词在某篇文档中出现频率高（TF），同时在所有文档中出现频率低（IDF），则该词对该文档的重要性高。

```python
import math
from collections import Counter

class BM25:
    """简化版 BM25 实现，展示核心原理"""
    def __init__(self, documents: list[str], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.docs = documents
        self.doc_count = len(documents)

        # 预处理：分词 + 词频统计
        self.doc_tokens = [doc.lower().split() for doc in documents]
        self.doc_lengths = [len(tokens) for tokens in self.doc_tokens]
        self.avg_dl = sum(self.doc_lengths) / self.doc_count

        # IDF 预计算
        self.idf = {}
        df = Counter()  # 包含某词的文档数
        for tokens in self.doc_tokens:
            for token in set(tokens):
                df[token] += 1
        for token, freq in df.items():
            self.idf[token] = math.log(
                (self.doc_count - freq + 0.5) / (freq + 0.5) + 1
            )

    def score(self, query: str, doc_idx: int) -> float:
        """计算 query 与某文档的 BM25 分数"""
        query_tokens = query.lower().split()
        doc_tokens = self.doc_tokens[doc_idx]
        doc_len = self.doc_lengths[doc_idx]
        tf = Counter(doc_tokens)

        score = 0.0
        for qt in query_tokens:
            if qt not in self.idf:
                continue
            term_freq = tf.get(qt, 0)
            numerator = term_freq * (self.k1 + 1)
            denominator = term_freq + self.k1 * (
                1 - self.b + self.b * doc_len / self.avg_dl
            )
            score += self.idf[qt] * numerator / denominator
        return score

    def search(self, query: str, top_k: int = 10) -> list[tuple[int, float]]:
        """返回 Top-K 结果：(文档索引, 分数)"""
        scores = [(i, self.score(query, i)) for i in range(self.doc_count)]
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]
```

**BM25 的优势**：精确的关键词匹配。用户搜"error code 4012"，BM25 能精确命中包含"4012"的文档，而 Embedding 模型可能完全无法区分"4012"和"4013"。

**BM25 的劣势**：不理解语义。用户问"如何提升系统吞吐量"，包含"提高 QPS"的文档不会被召回，因为没有词汇重叠。

### 6.2 稠密检索（Vector Search）

基于 Embedding 的向量检索，通过语义相似度匹配：

```python
import numpy as np

class VectorSearch:
    """基于向量的语义检索"""
    def __init__(self, embedder: EmbeddingModel):
        self.embedder = embedder
        self.vectors: np.ndarray | None = None
        self.documents: list[str] = []

    def index(self, documents: list[str]):
        """构建索引"""
        self.documents = documents
        embeddings = self.embedder.embed(documents)
        self.vectors = np.array(embeddings)
        # L2 归一化，使 dot product = cosine similarity
        norms = np.linalg.norm(self.vectors, axis=1, keepdims=True)
        self.vectors = self.vectors / norms

    def search(self, query: str, top_k: int = 10) -> list[tuple[int, float]]:
        """语义检索"""
        query_vec = np.array(self.embedder.embed([query])[0])
        query_vec = query_vec / np.linalg.norm(query_vec)

        # Cosine Similarity（归一化后等价于点积）
        similarities = self.vectors @ query_vec
        top_indices = np.argsort(similarities)[::-1][:top_k]
        return [(int(i), float(similarities[i])) for i in top_indices]
```

**Vector Search 的优势**：语义理解。"提升吞吐量"和"提高 QPS"会被映射到相近的向量空间位置。

**Vector Search 的劣势**：对精确匹配不敏感（ID、错误码、专有名词）；向量索引的存储和计算成本较高。

### 6.3 混合检索与 RRF

混合检索结合 BM25 和 Vector Search 的结果。关键问题是：两路检索返回的分数不在同一尺度上，如何融合？

**Reciprocal Rank Fusion（RRF）** 是最常用的融合算法。它不关心分数的绝对值，只关心排名：

$$RRF(d) = \sum_{r \in R} \frac{1}{k + rank_r(d)}$$

其中 $k$ 是常数（通常取 60），$rank_r(d)$ 是文档 $d$ 在检索源 $r$ 中的排名。

```python
def reciprocal_rank_fusion(
    *result_lists: list[tuple[int, float]],
    k: int = 60
) -> list[tuple[int, float]]:
    """
    RRF 融合多路检索结果

    参数:
        result_lists: 多路检索结果，每路是 (doc_id, score) 列表（已按 score 降序）
        k: 平滑常数，默认 60

    返回:
        融合后的 (doc_id, rrf_score) 列表，按 rrf_score 降序
    """
    rrf_scores: dict[int, float] = {}

    for results in result_lists:
        for rank, (doc_id, _score) in enumerate(results):
            # RRF 公式：只关心排名，不关心原始分数
            rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)

    # 按 RRF 分数降序排列
    fused = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    return fused


class HybridSearch:
    """混合检索：BM25 + Vector + RRF"""
    def __init__(self, bm25: BM25, vector_search: VectorSearch):
        self.bm25 = bm25
        self.vector_search = vector_search

    def search(self, query: str, top_k: int = 10, retrieve_k: int = 50) -> list[tuple[int, float]]:
        """
        混合检索

        retrieve_k: 每路检索的召回数量（远大于最终 top_k，保证融合质量）
        """
        bm25_results = self.bm25.search(query, top_k=retrieve_k)
        vector_results = self.vector_search.search(query, top_k=retrieve_k)

        fused = reciprocal_rank_fusion(bm25_results, vector_results)
        return fused[:top_k]
```

### 6.4 检索策略对比

| 策略 | 精确匹配 | 语义理解 | 专有名词/ID | 同义词/意图 | 延迟 | 存储成本 |
|------|---------|---------|------------|-----------|------|---------|
| **BM25** | 强 | 弱 | 强 | 弱 | 低 | 低 |
| **Vector** | 弱 | 强 | 弱 | 强 | 中 | 高 |
| **Hybrid (RRF)** | 强 | 强 | 强 | 强 | 中 | 高 |

**工程建议**：除非你非常确定场景只需要语义搜索（比如纯自然语言文档、没有 ID 和代码），否则**默认使用 Hybrid Search**。BM25 的实现成本极低，加上它获得的互补收益是巨大的。

---

## 7. Reranking：从召回到精排

### 7.1 为什么需要 Reranking

初步检索（BM25 + Vector）的目标是 **高召回率（Recall）**——尽量把相关文档都捞出来。但排在前面的不一定最相关。

这就像搜索引擎的两阶段架构：第一阶段用轻量算法从亿级文档中召回 1000 条，第二阶段用重模型对 1000 条做精排，选出最终展示的 10 条。

RAG 中同样如此：
- **阶段一（Retrieval）**：从整个知识库中召回 Top-50 或 Top-100
- **阶段二（Reranking）**：对这 50-100 条用更强的模型精排，选出 Top-5 送给 LLM

### 7.2 Bi-encoder vs Cross-encoder

![Bi-encoder vs Cross-encoder 架构对比](/images/blog/agentic-09/encoder-comparison.svg)

核心区别：
- **Bi-encoder**：Query 和 Document 独立编码，Document 可以离线预计算向量。速度快，适合海量候选。但无法捕捉 Query 和 Document 之间的深层交互。
- **Cross-encoder**：Query 和 Document 拼接后一起送入 Transformer，模型能看到两者的每个 token 之间的注意力。精度高，但每对 (Query, Document) 都需要实时计算，速度慢。

因此，Cross-encoder 只适合对少量候选做精排——这正是 Reranking 的定位。

### 7.3 Reranking 实现

```python
from dataclasses import dataclass

@dataclass
class RerankResult:
    doc_id: int
    content: str
    score: float

class Reranker:
    """基于 Cross-encoder 的重排序"""

    def __init__(self, model_name: str = "BAAI/bge-reranker-v2-m3"):
        # 实际使用时可以接入任意 Rerank 服务
        # 这里展示 API 调用模式
        self.model_name = model_name

    def rerank(
        self,
        query: str,
        documents: list[str],
        doc_ids: list[int],
        top_k: int = 5
    ) -> list[RerankResult]:
        """
        对候选文档重排序

        生产环境中通常调用 Rerank API（如 Cohere Rerank、Jina Rerank）
        或本地部署 Cross-encoder 模型
        """
        scores = self._compute_relevance(query, documents)

        # 按相关性得分降序排列
        ranked = sorted(
            zip(doc_ids, documents, scores),
            key=lambda x: x[2],
            reverse=True
        )

        return [
            RerankResult(doc_id=did, content=doc, score=s)
            for did, doc, s in ranked[:top_k]
        ]

    def _compute_relevance(self, query: str, documents: list[str]) -> list[float]:
        """
        计算 query 与每个 document 的相关性分数
        实际实现会调用 Cross-encoder 模型
        """
        # 伪代码：真实场景替换为模型推理
        # from sentence_transformers import CrossEncoder
        # model = CrossEncoder(self.model_name)
        # pairs = [(query, doc) for doc in documents]
        # scores = model.predict(pairs)
        # return scores.tolist()
        raise NotImplementedError("替换为实际模型调用")
```

**Reranker 选择建议**：
- **精度优先**：Cohere Rerank、BGE Reranker v2 等专用模型
- **成本优先**：可以用小参数量的 Cross-encoder（如 MiniLM 系列）
- **延迟敏感**：控制候选数量（50 条以内），或使用量化版模型

---

## 8. Context Packing：信息如何送达 LLM

检索和重排序完成后，拿到了 Top-K 个最相关的 chunk。接下来的问题是：如何把这些 chunk 组织到 prompt 中，让 LLM 最大化利用？

### 8.1 "Lost in the Middle" 问题

Stanford 的研究（[Liu et al., 2023](https://arxiv.org/abs/2307.03172)）发现了一个关键现象：LLM 对 prompt 中间位置的信息利用率显著低于开头和结尾。

![Lost in the Middle 位置偏差图](/images/blog/agentic-09/lost-in-middle.svg)

这意味着：**最相关的文档应该放在 prompt 的开头或结尾，而非中间。**

### 8.2 Context Packing 策略

```python
def pack_context(
    ranked_results: list[RerankResult],
    max_tokens: int = 3000,
    strategy: str = "relevance_first"
) -> str:
    """
    将检索结果组织为 LLM 的上下文

    策略:
        relevance_first: 最相关的放在最前面（默认）
        edges_first: 最相关的放开头和结尾，次相关的放中间
    """
    # 1. Token 预算下的截断
    selected = []
    current_tokens = 0
    for result in ranked_results:
        # 粗略估算 token 数（实际应用 tiktoken）
        estimated_tokens = len(result.content) // 3
        if current_tokens + estimated_tokens > max_tokens:
            break
        selected.append(result)
        current_tokens += estimated_tokens

    if not selected:
        return ""

    # 2. 根据策略决定顺序
    if strategy == "edges_first" and len(selected) >= 3:
        # 交替放置：最相关 → 最不相关 → 次相关 → 次不相关 ...
        reordered = []
        left, right = 0, len(selected) - 1
        toggle = True
        while left <= right:
            if toggle:
                reordered.append(selected[left])
                left += 1
            else:
                reordered.append(selected[right])
                right -= 1
            toggle = not toggle
        selected = reordered

    # 3. 格式化
    context_parts = []
    for i, result in enumerate(selected):
        context_parts.append(
            f"[Document {i+1}] (relevance: {result.score:.3f})\n{result.content}"
        )

    return "\n\n---\n\n".join(context_parts)
```

### 8.3 Token 预算管理

LLM 的 context window 是有限的。一个典型的 prompt 结构：

![Context Window Token 预算分配](/images/blog/agentic-09/context-budget.svg)

Context 部分的 token 预算 = 总 context window - system prompt - conversation history - user query - output reserve。在这个预算内，优先放入 Reranking 得分最高的 chunk，直到预算用完。

**决策要点**：
- 宁可少放几个 chunk、每个 chunk 完整，也不要截断 chunk 送进去——被截断的信息比没有信息更糟糕
- 为每个 chunk 附加来源标识（文档名、URL），方便 LLM 生成 citation
- 如果多个 chunk 来自同一文档的相邻位置，考虑合并后再送入，减少碎片化

---

## 9. RAG 评估体系

"不可度量则不可改进。" RAG 系统的评估需要覆盖检索和生成两个维度。

### 9.1 Retrieval 评估

| 指标 | 公式/含义 | 衡量什么 |
|------|----------|---------|
| **Recall@K** | 在 Top-K 结果中，相关文档被召回的比例 | 检索的完整性 |
| **MRR** | 第一个相关文档的排名的倒数，取平均 | 用户需要翻多远才能看到答案 |
| **NDCG@K** | 考虑位置权重的相关性评分（越靠前权重越高） | 排序质量 |

```python
def recall_at_k(relevant_ids: set[int], retrieved_ids: list[int], k: int) -> float:
    """Recall@K: Top-K 中召回了多少相关文档"""
    retrieved_set = set(retrieved_ids[:k])
    if not relevant_ids:
        return 0.0
    return len(relevant_ids & retrieved_set) / len(relevant_ids)


def mrr(relevant_ids: set[int], retrieved_ids: list[int]) -> float:
    """MRR: 第一个相关结果的排名倒数"""
    for rank, doc_id in enumerate(retrieved_ids, start=1):
        if doc_id in relevant_ids:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(relevance_scores: list[int], k: int) -> float:
    """
    NDCG@K: 归一化折损累积增益

    relevance_scores: 按检索排序的相关性评分列表（如 0/1/2/3）
    """
    import math

    def dcg(scores: list[int], k: int) -> float:
        return sum(
            score / math.log2(rank + 2)  # rank 从 0 开始，log2(1) = 0 所以 +2
            for rank, score in enumerate(scores[:k])
        )

    actual_dcg = dcg(relevance_scores, k)
    ideal_dcg = dcg(sorted(relevance_scores, reverse=True), k)

    return actual_dcg / ideal_dcg if ideal_dcg > 0 else 0.0
```

### 9.2 Generation 评估

检索质量好不意味着生成质量好。Generation 阶段需要评估：

| 指标 | 衡量什么 | 检测方式 |
|------|---------|---------|
| **Faithfulness** | 回答是否忠于检索到的上下文（不编造） | 检查回答中的每个声明是否有 context 支撑 |
| **Answer Relevancy** | 回答是否与用户问题相关 | 生成反向问题，比较与原问题的相似度 |
| **Context Relevancy** | 检索到的上下文是否与问题相关 | 评估 context 中有多少内容是回答问题所需的 |

这三个指标构成了 RAG 质量的 "Triad"：

![Faithfulness 评估框架：Query、Context、Answer 的三角关系](/images/blog/agentic-09/faithfulness-framework.svg)

### 9.3 RAGAS 框架

[RAGAS（Retrieval Augmented Generation Assessment）](https://docs.ragas.io/) 是目前最流行的端到端 RAG 评估框架，它自动化评估上述指标：

```python
# RAGAS 评估示意（伪代码）
def evaluate_rag_pipeline(test_cases: list[dict]) -> dict:
    """
    每个 test_case 包含:
        - question: 用户问题
        - ground_truth: 标准答案（人工标注）
        - retrieved_contexts: 检索到的上下文
        - generated_answer: RAG 系统生成的答案
    """
    metrics = {
        "faithfulness": [],       # 回答是否忠于 context
        "answer_relevancy": [],   # 回答是否切题
        "context_relevancy": [],  # context 是否相关
        "context_recall": [],     # context 是否覆盖了 ground truth 的信息
    }

    for case in test_cases:
        # Faithfulness: 把 answer 拆成多个 statement，
        # 逐一检查每个 statement 是否能从 context 中推导出来
        metrics["faithfulness"].append(
            check_faithfulness(case["generated_answer"], case["retrieved_contexts"])
        )

        # Answer Relevancy: 从 answer 反向生成问题，
        # 计算生成的问题与原始 question 的语义相似度
        metrics["answer_relevancy"].append(
            check_answer_relevancy(case["question"], case["generated_answer"])
        )

        # Context Relevancy: 评估 context 中有多少句子是回答问题所需的
        metrics["context_relevancy"].append(
            check_context_relevancy(case["question"], case["retrieved_contexts"])
        )

        # Context Recall: 对照 ground truth，检查 context 是否包含了必要的信息
        metrics["context_recall"].append(
            check_context_recall(case["ground_truth"], case["retrieved_contexts"])
        )

    return {k: sum(v) / len(v) for k, v in metrics.items()}
```

**实际操作建议**：
1. 构建 50-100 条高质量的评估数据集（question + ground_truth），这是最值得投入的工作
2. 每次修改 Pipeline（换 Embedding、调 Chunking、加 Reranker）后跑一轮评估
3. 关注指标的变化方向，而非绝对数值——不同数据集上的绝对分数不可比

---

## 10. 常见问题与优化

### 10.1 检索不到相关内容

**症状**：知识库中明明有答案，但检索结果中找不到。

**原因分析**：用户的 Query 和知识库中的表述方式差异太大。

**优化手段**：

**Query Expansion（查询扩展）**：将用户的短 Query 扩展为多个变体，增加召回率：

```python
def expand_query(query: str, llm_call) -> list[str]:
    """用 LLM 扩展查询，生成多个语义等价的变体"""
    prompt = f"""Given the search query: "{query}"

Generate 3 alternative phrasings that express the same intent but use different words.
Return each variant on a new line, without numbering."""

    variants = llm_call(prompt).strip().split("\n")
    return [query] + [v.strip() for v in variants if v.strip()]
```

**HyDE（Hypothetical Document Embeddings）**：先让 LLM 生成一个"假想答案"，用这个答案的 Embedding 去检索，而不是用 Query 的 Embedding。直觉上，答案和知识库中的文档更"长得像"：

```python
def hyde_search(query: str, llm_call, vector_search: VectorSearch, top_k: int = 10):
    """HyDE: 用假想答案的 Embedding 检索"""
    # 1. 让 LLM 生成假想答案（不需要准确，只需要"像"真正的文档）
    hypothetical_doc = llm_call(
        f"Please write a short passage that answers the following question: {query}"
    )

    # 2. 用假想答案的 Embedding 检索（而非 Query 的 Embedding）
    results = vector_search.search(hypothetical_doc, top_k=top_k)
    return results
```

HyDE 的 trade-off：增加了一次 LLM 调用的延迟和成本，但对检索质量的提升在某些场景下非常显著（尤其是短 Query 场景）。

### 10.2 检索到了但 LLM 没用上

**症状**：检索结果中包含正确答案，但 LLM 的回答忽略了它或回答错误。

**原因分析**：
- Context 太长，答案被"淹没"在噪声中（Lost in the Middle）
- 多个 chunk 包含矛盾信息，LLM 困惑了
- Prompt 没有明确指示 LLM "基于以下上下文回答"

**优化手段**：
- 减少送入的 chunk 数量，只保留 Top-3 而非 Top-10
- 使用 Reranker 提高 Top-K 的精度
- 在 System Prompt 中明确要求：只基于提供的上下文回答，如果上下文不足以回答则明确说明
- 应用 "edges_first" 排布策略（见 8.2 节）

### 10.3 幻觉问题

**症状**：LLM 编造了上下文中不存在的信息。

**优化手段**：

**Citation（引用标注）**：要求 LLM 在回答中标注每个声明的来源：

```python
CITATION_PROMPT = """Based on the provided context, answer the user's question.

Rules:
1. Only use information from the provided context
2. For each statement in your answer, add a citation like [Doc 1], [Doc 2]
3. If the context does not contain enough information, say "I don't have enough information to answer this"
4. Never make up information not present in the context

Context:
{context}

Question: {question}
"""
```

**Grounding Check（落地检查）**：生成回答后，用另一次 LLM 调用验证回答中的每个声明是否有上下文支撑。成本高，但在高可靠性场景（医疗、法律、金融）中是必要的。

---

## 11. 完整 Pipeline 集成

将上述所有模块串联起来：

```python
class RAGPipeline:
    """完整的 RAG Pipeline"""

    def __init__(
        self,
        embedder: EmbeddingModel,
        reranker: Reranker,
        llm_call,  # (prompt: str) -> str
        chunk_size: int = 512,
        chunk_overlap: int = 64,
        retrieve_k: int = 50,
        rerank_k: int = 5,
        max_context_tokens: int = 3000,
    ):
        self.embedder = embedder
        self.reranker = reranker
        self.llm_call = llm_call
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.retrieve_k = retrieve_k
        self.rerank_k = rerank_k
        self.max_context_tokens = max_context_tokens

        self.bm25: BM25 | None = None
        self.vector_search = VectorSearch(embedder)
        self.chunks: list[str] = []

    # ─── Offline: Indexing ───

    def ingest(self, documents: list[Document]):
        """离线索引：文档 → Chunk → Embedding → 索引"""
        # 1. Chunking
        self.chunks = []
        for doc in documents:
            cleaned = preprocess(doc.content)
            doc_chunks = recursive_chunk(cleaned, self.chunk_size)
            self.chunks.extend(doc_chunks)

        # 2. 构建双路索引
        self.bm25 = BM25(self.chunks)
        self.vector_search.index(self.chunks)

        print(f"Indexed {len(documents)} documents → {len(self.chunks)} chunks")

    # ─── Online: Query ───

    def query(self, question: str) -> str:
        """在线查询：Query → 检索 → 重排 → 生成"""
        assert self.bm25 is not None, "Must call ingest() first"

        # 1. Hybrid Search
        hybrid = HybridSearch(self.bm25, self.vector_search)
        retrieval_results = hybrid.search(question, top_k=self.retrieve_k)

        # 2. Reranking
        candidate_ids = [doc_id for doc_id, _ in retrieval_results]
        candidate_docs = [self.chunks[doc_id] for doc_id in candidate_ids]
        reranked = self.reranker.rerank(
            query=question,
            documents=candidate_docs,
            doc_ids=candidate_ids,
            top_k=self.rerank_k,
        )

        # 3. Context Packing
        context = pack_context(reranked, max_tokens=self.max_context_tokens)

        # 4. LLM Generation
        prompt = CITATION_PROMPT.format(context=context, question=question)
        answer = self.llm_call(prompt)

        return answer
```

这段代码不到 50 行，但串联了 RAG 的所有核心环节。每个环节都可以独立替换和优化——这就是模块化设计的价值。

---

---
## 12. 多语言 RAG 实践指南
中英混合场景是现代 RAG 系统的常态。许多企业的知识库涵盖中文文档、英文资料，甚至代码注释中混入两种语言。多语言 RAG 的挑战不仅在于 Embedding 模型的选择，更关键是如何处理跨语言的语义同义和分词差异。
### 12.1 跨语言 Embedding 模型对比
不同的多语言 Embedding 模型在中英混合场景上的表现差异显著。以下数据基于 MTEB Leaderboard 和实际部署经验：
| 模型 | 维度 | 参数量 | 中文 Retrieval | 英文 Retrieval | 中英混合查询 | 推理延迟 (批量 1000) | 适用场景 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **multilingual-e5-large** | 1024 | 560M | 0.684 | 0.752 | 0.598 | ~200ms | 通用，成本均衡 |
| **bge-m3** | 1024 | 568M | 0.711 | 0.765 | 0.623 | ~180ms | 中文优先，混合友好 |
| **cohere-multilingual-v3** | 1024 | - (API) | 0.696 | 0.758 | 0.612 | ~300ms (网络) | 云端部署，精度高 |
| **multilingual-e5-base** | 768 | 280M | 0.658 | 0.728 | 0.572 | ~100ms | 低延迟优先 |
| **bge-small-zh-v1.5** | 512 | 25M | 0.701 | 0.620 | 0.510 | ~50ms | 纯中文，极简部署 |

**选型建议**：

- **中英均衡、混合查询频繁**：选 `bge-m3`。它在百万级规模中文和英文上都被优化过，对中英混合查询的 recall@10 最高
- **成本敏感、云端部署**：选 `multilingual-e5-large`。开源生态完善，本地部署无 API 成本
- **纯云端、预算充足**：选 `cohere-multilingual-v3`。Cohere 的 v3 系列经过最新数据训练，精度最优但费用较高
- **超低延迟（<50ms）**：考虑两阶段方案：用小模型 `bge-small-zh-v1.5` 做初筛，用大模型 Reranker 精排
### 12.2 中文分词对 Chunking 的影响
英文以空格天然分词，而中文需要显式分词。不同的分词结果直接影响 BM25 索引的质量：
```python
def chunk_with_tokenizer(text: str, tokenizer, chunk_size: int = 512) -> list[str]:
    """考虑分词器的 Chunking——避免在词语中间切割"""
    import numpy as np
    # 1. 分词
    tokens = tokenizer.tokenize(text)
    token_positions = []
    current_pos = 0
    for token in tokens:
        # 找到 token 在原文中的位置
        pos = text.find(token, current_pos)
        token_positions.append((pos, pos + len(token)))
        current_pos = pos + len(token)
    # 2. 按 token 数量分组（而非字符数）
    chunks = []
    current_tokens = []
    current_char_pos = 0
    for i, (start_pos, end_pos) in enumerate(token_positions):
        current_tokens.append(text[start_pos:end_pos])
        if len(current_tokens) >= chunk_size or i == len(token_positions) - 1:
            chunk_text = "".join(current_tokens).strip()
            if chunk_text:
                chunks.append(chunk_text)
            current_tokens = []
    return chunks
# 示例：使用常见的中文分词器
from nltk.tokenize import sent_tokenize
from jieba import cut as jieba_cut
def chunk_chinese_aware(text: str, chunk_size: int = 512) -> list[str]:
    """中文友好的 Chunking：先按句子，再按词"""
    import jieba
    # 保留标点的句子分割
    sentences = []
    current_sent = ""
    for char in text:
        current_sent += char
        if char in "。！？；：\n":
            if current_sent.strip():
                sentences.append(current_sent.strip())
            current_sent = ""
    if current_sent.strip():
        sentences.append(current_sent.strip())
    # 以句子为单位积累 chunk
    chunks = []
    current_chunk = ""
    current_token_count = 0
    for sent in sentences:
        tokens = list(jieba.cut(sent))
        token_count = len(tokens)
        if current_token_count + token_count > chunk_size:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sent
            current_token_count = token_count
        else:
            current_chunk += sent
            current_token_count += token_count
    if current_chunk:
        chunks.append(current_chunk.strip())
    return chunks
```
**关键点**：
- 用 token 数而非字符数度量 chunk 大小（中文字符数和 token 数比例与英文不同）
- 避免在词语中间切割，以句子为最小单位
- 对中文文本，递归切分时加入"。！？"等标点作为分隔符
### 12.3 混合语言查询的归一化策略
用户的查询可能是纯中文、纯英文或混合。为了保证检索质量，需要对查询进行预处理和路由：
```python
import re
from typing import Literal
def analyze_query_language(query: str) -> Literal["zh", "en", "mixed"]:
    """判断查询主要语言"""
    # 检测中文字符
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', query))
    english_words = len(query.split())
    if chinese_chars == 0:
        return "en"
    elif english_words - chinese_chars < 3:  # 英文词很少
        return "zh"
    else:
        return "mixed"
def normalize_query_multilingual(query: str, language_type: str = None) -> list[str]:
    """对多语言查询进行归一化和扩展"""
    if language_type is None:
        language_type = analyze_query_language(query)
    normalized = [query.strip()]
    # 混合语言场景：分别提取中文和英文进行搜索
    if language_type == "mixed":
        # 提取中文部分
        zh_part = re.findall(r'[\u4e00-\u9fff]+', query)
        if zh_part:
            normalized.append(" ".join(zh_part))
        # 提取英文部分
        en_part = re.findall(r'\b[a-zA-Z]+\b', query)
        if en_part:
            normalized.append(" ".join(en_part))
    # 如果有括号或括号内容，也作为单独查询
    bracketed = re.findall(r'[（(]([^）)]+)[）)]', query)
    normalized.extend(bracketed)
    # 过滤重复和过短的查询
    normalized = list(dict.fromkeys(
        [q.strip() for q in normalized if len(q.strip()) > 2]
    ))
    return normalized
def hybrid_search_multilingual(
    query: str,
    bm25_zh: BM25,           # 中文 BM25 索引
    bm25_en: BM25,           # 英文 BM25 索引
    vector_search,           # 多语言 embedding
    top_k: int = 50
) -> list[tuple]:
    """多语言混合搜索"""
    language_type = analyze_query_language(query)
    queries = normalize_query_multilingual(query, language_type)
    results = {}
    for q in queries:
        lang = analyze_query_language(q)
        # BM25 检索：用语言特定的索引
        if lang == "zh":
            bm25_results = bm25_zh.search(q, top_k=top_k // 2)
        elif lang == "en":
            bm25_results = bm25_en.search(q, top_k=top_k // 2)
        else:
            # 混合查询同时搜两个索引
            bm25_results = (
                bm25_zh.search(q, top_k=top_k // 4) +
                bm25_en.search(q, top_k=top_k // 4)
            )
        # 向量检索：使用多语言 embedding
        vector_results = vector_search.search(q, top_k=top_k)
        # 融合结果（RRF）
        merged = rrf_fusion([
            [(doc_id, score) for doc_id, score in bm25_results],
            [(doc_id, score) for doc_id, score in vector_results]
        ], k=60)
        results.update({doc_id: score for doc_id, score in merged})
    # 返回得分最高的 top_k
    return sorted(results.items(), key=lambda x: x[1], reverse=True)[:top_k]
```
**实践建议**：
- 对大型知识库，建议同时维护中文和英文的 BM25 索引（需要语言识别后路由）
- 向量检索统一用多语言 Embedding，无需建立多个索引
- 混合查询时用 RRF 融合中英的 BM25 和向量结果
---
## 13. 百万级 Chunk 的工程实践
当知识库规模达到百万级 Chunk 时（通常对应数十万篇文档），RAG 系统面临的不再是算法问题，而是工程问题：如何高效地存储、索引、更新。
### 13.1 大规模 Chunking 的分片策略
单个向量库无法高效处理百万级数据，通常的方案是按多个维度分片：
```python
from typing import List
from dataclasses import dataclass
from datetime import datetime
import hashlib
@dataclass
class ShardingPolicy:
    """分片策略配置"""
    strategy: str  # "document_type", "time_based", "topic_based", "hash_based"
    shard_count: int = 10
    parameters: dict = None
def get_shard_id(chunk: str, metadata: dict, policy: ShardingPolicy) -> str:
    """根据分片策略计算 shard_id"""
    if policy.strategy == "document_type":
        # 按文档类型分片：FAQ, TechDoc, News, Code 等
        doc_type = metadata.get("doc_type", "unknown")
        return f"shard_type_{doc_type}"
    elif policy.strategy == "time_based":
        # 按时间分片：热数据（近 3 个月）单独存储
        created_at = metadata.get("created_at", datetime.now())
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        days_ago = (datetime.now() - created_at).days
        if days_ago < 90:
            return "shard_time_hot"
        elif days_ago < 365:
            return "shard_time_warm"
        else:
            return "shard_time_cold"
    elif policy.strategy == "topic_based":
        # 按主题分片：需要预先分类所有文档
        topic = metadata.get("topic", "general")
        return f"shard_topic_{topic}"
    elif policy.strategy == "hash_based":
        # 按哈希分片：均衡负载，便于扩展
        doc_id = metadata.get("doc_id", chunk[:50])
        hash_val = int(hashlib.md5(str(doc_id).encode()).hexdigest(), 16)
        shard_num = hash_val % policy.shard_count
        return f"shard_{shard_num:03d}"
    return "shard_default"
# 示例：多策略组合
def get_shard_id_combined(chunk: str, metadata: dict) -> str:
    """两层分片：先按文档类型，再按时间"""
    doc_type = metadata.get("doc_type", "unknown")
    created_at = metadata.get("created_at", datetime.now())
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    days_ago = (datetime.now() - created_at).days
    time_bucket = "hot" if days_ago < 90 else ("warm" if days_ago < 365 else "cold")
    return f"shard_{doc_type}_{time_bucket}"
```
### 13.2 分布式向量存储对比
| 存储方案 | 支持规模 | 查询延迟 | 更新延迟 | 可扩展性 | 成本 | 适用场景 |
|--------|--------|--------|--------|--------|------|---------|
| **Milvus** (开源) | 10B+ vectors | ~50ms | ~100ms | 好（分布式） | 低 | 自建、大规模私有 |
| **Qdrant** (开源) | 1B+ vectors | ~40ms | ~80ms | 很好（native cloud) | 中 | 中规模、高性能要求 |
| **Weaviate** (开源) | 1B+ vectors | ~60ms | ~120ms | 很好（Kubernetes) | 中 | 企业级、混合存储 |
| **Pinecone** (托管) | unlimited | ~30ms | ~500ms | 极好（无运维） | 高 | 团队小、不想运维 |
| **LanceDB** (新兴) | 1B+ vectors | ~30ms | ~50ms | 好（向量优化） | 低 | 小规模、快速迭代 |
**选型建议**：
- **100M+ 规模、自建为主**：Milvus（久经考验，阿里/小红书等大厂生产环境）
- **性能敏感（<30ms）、自建**：Qdrant（简洁高效，Rust 实现）
- **企业级、混合场景**：Weaviate（支持 RAG 全流程，与 LangChain 集成好）
- **团队小、快速迭代**：Pinecone（零运维，但成本高；或本地试错用 LanceDB）
### 13.3 增量索引实现
最常见的错误是每次有新文档就全量重建索引。正确的做法是增量更新，只处理新增或修改的文档：
```python
from typing import Optional
import hashlib
from datetime import datetime
class IncrementalIndexing:
    """增量索引管理"""
    def __init__(self, vector_store, bm25_store, metadata_db):
        self.vector_store = vector_store      # Milvus/Qdrant 等
        self.bm25_store = bm25_store          # BM25 索引
        self.metadata_db = metadata_db        # 存储文档哈希的数据库
    def compute_document_hash(self, doc_content: str) -> str:
        """计算文档内容哈希"""
        return hashlib.sha256(doc_content.encode()).hexdigest()
    def get_stored_hash(self, doc_id: str) -> Optional[str]:
        """从元数据库查询上次存储的哈希"""
        record = self.metadata_db.query(doc_id)
        return record.get("content_hash") if record else None
    def needs_reembedding(self, doc_id: str, doc_content: str) -> bool:
        """判断文档是否需要重新 Embedding"""
        current_hash = self.compute_document_hash(doc_content)
        stored_hash = self.get_stored_hash(doc_id)
        return current_hash != stored_hash
    def add_or_update_document(
        self,
        doc_id: str,
        doc_content: str,
        embedder,
        chunker,
        metadata: dict
    ) -> dict:
        """增量添加或更新单个文档"""
        if not self.needs_reembedding(doc_id, doc_content):
            return {"status": "skipped", "reason": "no_change"}
        # 1. Chunking
        chunks = chunker(doc_content)
        # 2. Embedding（只对新增/修改的 chunk）
        embeddings = embedder.embed(chunks)
        # 3. 删除旧的 chunk（如果存在）
        self.vector_store.delete(filter={"doc_id": doc_id})
        self.bm25_store.delete(filter={"doc_id": doc_id})
        # 4. 插入新的 chunk
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            chunk_id = f"{doc_id}#{i}"
            self.vector_store.insert({
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "content": chunk,
                "embedding": embedding,
                "metadata": metadata
            })
            self.bm25_store.add(chunk_id, chunk)
        # 5. 更新元数据（记录这次处理的时间和哈希）
        self.metadata_db.upsert(doc_id, {
            "content_hash": self.compute_document_hash(doc_content),
            "last_indexed_at": datetime.now().isoformat(),
            "chunk_count": len(chunks),
            "metadata": metadata
        })
        return {
            "status": "indexed",
            "doc_id": doc_id,
            "chunks_added": len(chunks)
        }
    def batch_incremental_update(
        self,
        documents: list[tuple],  # [(doc_id, doc_content, metadata), ...]
        embedder,
        chunker,
        batch_size: int = 100
    ) -> dict:
        """批量增量更新（减少重复计算）"""
        # 第一步：预过滤——先找出需要重新处理的文档
        docs_to_process = []
        for doc_id, doc_content, metadata in documents:
            if self.needs_reembedding(doc_id, doc_content):
                docs_to_process.append((doc_id, doc_content, metadata))
        if not docs_to_process:
            return {"status": "no_changes", "total_docs": len(documents)}
        # 第二步：批量 Chunking
        all_chunks = []
        chunk_to_doc = {}
        for doc_id, doc_content, _ in docs_to_process:
            chunks = chunker(doc_content)
            for i, chunk in enumerate(chunks):
                chunk_id = f"{doc_id}#{i}"
                all_chunks.append(chunk)
                chunk_to_doc[chunk_id] = (doc_id, _)
        # 第三步：批量 Embedding（一次调用处理所有 chunk）
        embeddings = embedder.embed(all_chunks)
        # 第四步：批量插入
        for chunk_id, embedding, chunk_content in zip(
            chunk_to_doc.keys(), embeddings, all_chunks
        ):
            doc_id, metadata = chunk_to_doc[chunk_id]
            self.vector_store.insert({
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "content": chunk_content,
                "embedding": embedding,
                "metadata": metadata
            })
        return {
            "status": "batch_indexed",
            "docs_processed": len(docs_to_process),
            "chunks_created": len(all_chunks)
        }
```
**关键优化**：
- 计算内容哈希，避免重复 Embedding（成本最高的操作）
- 删除旧 chunk 时用 doc_id 过滤，避免重复数据
- 批量处理时一次 Embedding 调用处理所有 chunk，充分利用 API/模型的批量优势
### 13.4 冷热分离存储
大型系统通常采用冷热分离：热数据（最近访问、高热度）放在高性能存储，冷数据（归档、低频访问）放在低成本存储。
```python
from datetime import datetime, timedelta
from enum import Enum
class DataTemperature(Enum):
    HOT = "hot"      # 最近 3 个月，频繁访问
    WARM = "warm"    # 3-12 个月，偶尔访问
    COLD = "cold"    # 1 年以上，很少访问
class ColdHotSeparation:
    """冷热分离管理"""
    def __init__(self, hot_store, warm_store, cold_store):
        self.hot_store = hot_store    # 高性能：Qdrant、Redis
        self.warm_store = warm_store  # 中等性能：Milvus
        self.cold_store = cold_store  # 低成本：S3 + DuckDB
    def get_temperature(self, metadata: dict) -> DataTemperature:
        """根据最后访问时间和热度判断温度"""
        last_accessed = metadata.get("last_accessed_at")
        if isinstance(last_accessed, str):
            last_accessed = datetime.fromisoformat(last_accessed)
        days_since_access = (datetime.now() - last_accessed).days
        if days_since_access < 90:
            return DataTemperature.HOT
        elif days_since_access < 365:
            return DataTemperature.WARM
        else:
            return DataTemperature.COLD
    def get_store_for_temperature(self, temperature: DataTemperature):
        """返回对应的存储后端"""
        return {
            DataTemperature.HOT: self.hot_store,
            DataTemperature.WARM: self.warm_store,
            DataTemperature.COLD: self.cold_store,
        }[temperature]
    def move_to_appropriate_tier(self, chunk_id: str, metadata: dict):
        """定期迁移数据到合适的层级"""
        old_temp = metadata.get("current_temperature", "hot")
        new_temp = self.get_temperature(metadata).value
        if old_temp == new_temp:
            return
        # 从旧层删除
        old_store = self.get_store_for_temperature(DataTemperature(old_temp))
        old_store.delete(chunk_id)
        # 插入新层（需要查出原数据）
        data = self._fetch_from_any_store(chunk_id)
        new_store = self.get_store_for_temperature(DataTemperature(new_temp))
        new_store.insert(chunk_id, data)
        # 更新元数据
        metadata["current_temperature"] = new_temp
        metadata["moved_at"] = datetime.now().isoformat()
    def _fetch_from_any_store(self, chunk_id: str) -> dict:
        """尝试从任何层级查找数据"""
        for store in [self.hot_store, self.warm_store, self.cold_store]:
            try:
                return store.get(chunk_id)
            except:
                continue
        raise ValueError(f"Chunk {chunk_id} not found in any store")
    def query_with_temperature_awareness(
        self, query: str, top_k: int = 10
    ) -> list:
        """查询时优先返回热数据"""
        # 先从 hot_store 查
        results_hot = self.hot_store.search(query, top_k=top_k)
        if len(results_hot) >= top_k:
            return results_hot[:top_k]
        # hot 不足，从 warm 补充
        results_warm = self.warm_store.search(query, top_k=top_k - len(results_hot))
        results = results_hot + results_warm
        if len(results) >= top_k:
            return results[:top_k]
        # 还是不足，从 cold 补充（可能延迟较高）
        results_cold = self.cold_store.search(query, top_k=top_k - len(results))
        return results + results_cold
```
冷热分离的经济效益：以百万级 Chunk、1024 维向量为例，
- 全部存 Milvus：约 4GB 内存或 SSD，年成本 ~$5000 (云)
- 冷热分离（90% 冷 + 10% 热）：热存 Qdrant (~400MB)，冷存 S3 (~$200/年)，总成本 ~$1000-2000
---
## 14. RAG 方案的成本-质量量化对比
不同企业在 RAG 方案选择时面临同样的问题："我需要花多少钱换多少质量提升？" 以下数据基于 TREC DL、MS MARCO 等标准数据集的基准测试，以及实际生产环节的成本采集。
### 14.1 四种 RAG 方案对标测试
| 评估指标 | **方案 A: BM25 Only** | **方案 B: Vector Only** | **方案 C: Hybrid** | **方案 D: Hybrid + Reranker** |
|---------|-------------------|---------------------|-----------------|---------------------------|
| **Recall@10** | 0.58 | 0.71 | 0.81 | 0.86 |
| **Recall@100** | 0.68 | 0.82 | 0.90 | 0.92 |
| **MRR (Mean Reciprocal Rank)** | 0.42 | 0.54 | 0.68 | 0.78 |
| **NDCG@10** | 0.51 | 0.63 | 0.75 | 0.84 |
| **每次查询 Token 成本** | $0.0001 | $0.0015 | $0.0018 | $0.0032 |
| **检索延迟 P95** | 20ms | 85ms | 95ms | 180ms |
| **索引成本 (百万级 chunk)** | ~$200 | ~$2500 | ~$2700 | ~$2800 |
| **月度运营成本 (100K QPS)** | ~$300 | ~$4500 | ~$5400 | ~$9600 |
**详细说明**：
1. **方案 A: BM25 Only**
   - 仅用词频检索，完全无需 Embedding
   - 优点：成本极低、延迟极短、易维护
   - 缺点：无法理解语义、同义词失效
   - 适用：FAQ、手册、已知问题库（用户查询与知识库表述接近）
2. **方案 B: Vector Only**
   - 纯向量检索，完全舍弃 BM25
   - 优点：语义理解能力强、同义词友好
   - 缺点：ID、专有名词、数字检索失效；成本高 15 倍
   - 适用：用户查询自然化、不需要精确检索的场景
3. **方案 C: Hybrid (BM25 + Vector)**
   - 双路并行检索，结果融合（RRF）
   - 优点：召回完整（语义 + 关键词）、成本相对可控
   - 缺点：排序可能混乱（相关性差的 BM25 结果混在前面）
   - 适用：绝大多数生产系统的选择
4. **方案 D: Hybrid + Reranker**
   - 在 Hybrid 基础上加 Cross-Encoder Reranker（如 bge-reranker-large）
   - 优点：精排能力最强、MRR 提升 30%+
   - 缺点：延迟翻倍、成本增加 80%
   - 适用：对答案精度要求极高（金融、医疗、法律）
### 14.2 升级阈值建议

根据你的应用场景，决定何时值得从一个方案升级到下一个：

![RAG 优化决策树：基于 Recall@10 的升级策略](/images/blog/agentic-09/optimization-tree.svg)
**具体阈值**：
- **Recall@10 < 0.60**：用户投诉率 > 20%，用户流失风险高 → **必须升级**
- **Recall@10 0.60-0.75**：投诉率 10-20% → **强烈建议升级**
- **Recall@10 0.75-0.85**：投诉率 < 10% → **可选升级**（优化 Chunking 可能性价比更高）
- **Recall@10 > 0.85**：投诉率 < 5% → **关注成本效率，不必进一步升级**
---
## 15. Context Packing 高级策略：解决 Lost in the Middle
检索到了相关文档，但 LLM 未能有效利用——这是"Lost in the Middle"问题。当你给 LLM 提供 10 个 chunk 的上下文时，LLM 往往只有效利用头尾的内容，中间的内容被忽视。
### 15.1 层级摘要策略
不是直接将原始 chunk 填充到 prompt，而是先生成摘要，再根据需要补充原文：
```python
from typing import NamedTuple
class ChunkWithSummary(NamedTuple):
    chunk_id: str
    content: str
    summary: str      # 简要摘要（50 tokens）
    relevance_score: float
def generate_chunk_summaries(chunks: list[str], llm_summarizer) -> list[ChunkWithSummary]:
    """为所有 chunk 预生成摘要"""
    results = []
    for i, chunk in enumerate(chunks):
        summary = llm_summarizer(
            f"请用 1-2 句话总结以下内容的核心要点，不超过 50 个中文字或 15 个英文单词：\n\n{chunk}"
        )
        results.append(ChunkWithSummary(
            chunk_id=f"chunk_{i}",
            content=chunk,
            summary=summary,
            relevance_score=0.0  # 稍后填充
        ))
    return results
def pack_context_with_summaries(
    retrieved_chunks: list[tuple],  # [(chunk_id, score, content), ...]
    llm_call,
    max_context_tokens: int = 3000,
    max_full_chunks: int = 3
) -> str:
    """
    层级打包：摘要优先，然后根据 token 预算决定是否补充原文
    """
    token_budget = max_context_tokens
    chunks_with_summary = []
    # 第一步：为所有 chunk 生成摘要（预计每个 50 tokens）
    for chunk_id, score, content in retrieved_chunks:
        summary = llm_call(
            f"核心摘要（最多 30 字）：{content[:300]}"
        )
        chunks_with_summary.append({
            "chunk_id": chunk_id,
            "score": score,
            "summary": summary,
            "content": content,
            "summary_tokens": len(summary.split()),
            "content_tokens": len(content.split())
        })
    # 第二步：先加入所有摘要（消耗 token 少）
    context_parts = []
    total_tokens = 0
    for chunk_info in chunks_with_summary:
        summary_text = f"[{chunk_info['chunk_id']}] {chunk_info['summary']}"
        tokens_needed = chunk_info['summary_tokens'] + 5  # 加上 ID 和格式符号
        if total_tokens + tokens_needed > token_budget:
            break
        context_parts.append(summary_text)
        total_tokens += tokens_needed
    # 第三步：token 还有空余，补充高分 chunk 的原文
    remaining_tokens = token_budget - total_tokens
    full_chunks_added = 0
    for chunk_info in sorted(chunks_with_summary, key=lambda x: x['score'], reverse=True):
        if full_chunks_added >= max_full_chunks:
            break
        content_tokens = chunk_info['content_tokens']
        if content_tokens + 100 > remaining_tokens:  # 100 是格式化的开销
            continue
        context_parts.append(f"\n[完整内容: {chunk_info['chunk_id']}]\n{chunk_info['content']}")
        remaining_tokens -= (content_tokens + 100)
        full_chunks_added += 1
    return "\n\n".join(context_parts)
```
**优势**：
- 摘要高度浓缩，LLM 快速找到相关信息
- 原文补充只针对高分 chunk，提高信息密度
- Token 预算利用率高
### 15.2 相关性衰减排列
传统做法是按相关性分数从高到低排序。但这会导致最相关的内容在中间位置（如果 top-5 中排第 3）被忽视。更优的策略是将高相关内容放在头尾：
```python
def sort_by_relevance_edges_first(
    chunks: list[tuple],  # [(chunk_id, score, content), ...]
    decay_power: float = 1.5
) -> list[tuple]:
    """
    相关性衰减排列：高相关放头尾，低相关放中间
    原理：
    - 位置 1：最高相关
    - 位置 2-3：次高相关
    - 位置 4 到中间：递减相关性
    - 位置倒 3 到倒 1：重新递增（为了利用"Recency"效应）
    """
    if not chunks:
        return []
    # 按分数排序
    sorted_chunks = sorted(chunks, key=lambda x: x[1], reverse=True)
    n = len(sorted_chunks)
    result = []
    head = 0
    tail = n - 1
    is_head = True
    # 交替取首尾
    while head <= tail:
        if is_head:
            result.append(sorted_chunks[head])
            head += 1
        else:
            result.append(sorted_chunks[tail])
            tail -= 1
        is_head = not is_head
    return result
# 使用示例
def pack_context_edges_first(
    retrieved_chunks: list[tuple],  # [(chunk_id, score, content), ...]
    max_context_tokens: int = 3000
) -> str:
    """用 edges_first 排列打包上下文"""
    sorted_chunks = sort_by_relevance_edges_first(retrieved_chunks)
    context_parts = []
    total_tokens = 0
    for chunk_id, score, content in sorted_chunks:
        chunk_tokens = len(content.split())
        if total_tokens + chunk_tokens > max_context_tokens:
            break
        # 注：这样 top-1 在最开头，top-2 在最后，top-3 在第二位
        context_parts.append(f"[相关度 {score:.2f}] {content}")
        total_tokens += chunk_tokens
    return "\n\n".join(context_parts)
```
**对比**：

![传统排序 vs Edges-First 排序对比](/images/blog/agentic-09/edges-first-comparison.svg)
### 15.3 自适应路由
不同的问题需要不同数量的上下文。简单问题可能只需要 1-2 个 chunk，复杂问题可能需要 5-10 个。根据问题复杂度动态调整 chunk 数量：
```python
from enum import Enum
class QueryComplexity(Enum):
    SIMPLE = "simple"        # "what is X" → 1-2 chunks
    MODERATE = "moderate"    # "how to do X" → 3-5 chunks
    COMPLEX = "complex"      # "compare X vs Y" → 5-10 chunks
    MULTI_STEP = "multi_step"  # "step 1, 2, 3..." → 10+ chunks
def classify_query_complexity(query: str, llm_call) -> QueryComplexity:
    """用 LLM 快速判断查询复杂度"""
    prompt = f"""
分析以下查询的复杂度：
- SIMPLE: 直接的定义、事实查询 ("什么是", "怎么读")
- MODERATE: 需要解释或方法 ("如何", "为什么")
- COMPLEX: 对比、权衡 ("vs", "对比", "差异")
- MULTI_STEP: 分步骤、流程 ("步骤", "流程", "阶段")
查询：{query}
返回一个单词：SIMPLE / MODERATE / COMPLEX / MULTI_STEP
"""
    response = llm_call(prompt).strip().upper()
    try:
        return QueryComplexity[response]
    except KeyError:
        return QueryComplexity.MODERATE  # 默认
def adaptive_retrieval(
    query: str,
    hybrid_search,
    llm_call,
    base_top_k: int = 10
) -> tuple[list, int]:
    """
    自适应检索：根据查询复杂度调整 top_k
    """
    complexity = classify_query_complexity(query, llm_call)
    # 根据复杂度调整检索数量
    complexity_multiplier = {
        QueryComplexity.SIMPLE: 0.5,      # 5 chunks
        QueryComplexity.MODERATE: 1.0,    # 10 chunks
        QueryComplexity.COMPLEX: 1.5,     # 15 chunks
        QueryComplexity.MULTI_STEP: 2.0,  # 20 chunks
    }
    adjusted_top_k = max(
        3,  # 最少 3 个
        int(base_top_k * complexity_multiplier[complexity])
    )
    results = hybrid_search(query, top_k=adjusted_top_k)
    return results, adjusted_top_k
def pack_context_adaptive(
    query: str,
    retrieved_chunks: list[tuple],
    llm_call,
    max_context_tokens: int = 3000
) -> str:
    """自适应打包：简单问题用摘要 + 边界排序，复杂问题用原文优先"""
    complexity = classify_query_complexity(query, llm_call)
    if complexity == QueryComplexity.SIMPLE:
        # 简单问题：摘要优先（如 15.1 节）
        return pack_context_with_summaries(
            retrieved_chunks, llm_call,
            max_context_tokens=1500,  # 预算较小
            max_full_chunks=1
        )
    elif complexity == QueryComplexity.MODERATE:
        # 中等复杂度：原文 + 边界排列
        sorted_chunks = sort_by_relevance_edges_first(retrieved_chunks)
        return pack_context_edges_first(sorted_chunks, max_context_tokens)
    else:  # COMPLEX 或 MULTI_STEP
        # 复杂问题：尽可能多的原文，按重要性而非位置排序
        sorted_chunks = sorted(retrieved_chunks, key=lambda x: x[1], reverse=True)
        context_parts = []
        total_tokens = 0
        for chunk_id, score, content in sorted_chunks:
            chunk_tokens = len(content.split())
            if total_tokens + chunk_tokens > max_context_tokens:
                break
            context_parts.append(content)
            total_tokens += chunk_tokens
        return "\n\n".join(context_parts)
```
**自适应路由的收益**：
- 简单查询延迟 -60%（少检索、少 token）
- 复杂查询质量 +15% MRR（更充分的上下文）
- 平均 token 成本 -20%（大量简单查询都是"小"请求）
---
## 16. 工程决策速查表

最后，总结 RAG 系统中的关键工程决策：

| 决策点 | 推荐默认值 | 何时调整 |
|--------|-----------|---------|
| Chunk 大小 | 512 tokens | 法律/长文档增大；FAQ 减小 |
| Chunk 重叠 | 10-20% of chunk size | 语义边界切分时可减少 |
| Embedding 维度 | 1024 | 存储/延迟敏感时降低 |
| 检索策略 | Hybrid (BM25 + Vector) | 纯自然语言场景可只用 Vector |
| 初步召回数量 | 50 | 知识库很大时增加 |
| Rerank Top-K | 5 | LLM context window 大时可增加 |
| Context 排布 | relevance_first | 上下文很长时用 edges_first |
| 融合算法 | RRF (k=60) | 需要调权时切换加权融合 |

---

## 17. 结语与下一步

RAG 给 Agent 提供了 **"知识"维度的能力**——让 Agent 不再局限于训练数据，能够接入外部的、实时的、私有的信息。但回过头来看，RAG 本质上是一个**信息检索工程问题**：

- 不是模型越大越好，而是**检索越准越好**
- 不是 chunk 越多越好，而是**信噪比越高越好**
- 不是 pipeline 越复杂越好，而是**每个环节都要可度量、可调优**

在 Agent 架构中，RAG 是 Memory 子系统的核心组件。它回答的是"Agent 知道什么"的问题。但 Agent 光有知识不够——它还需要知道 **"怎么做"**（Planning）和 **"做得对不对"**（Reflection）。

下一篇，我们将进入 Agent 智能的另一个关键维度：**Planning and Reflection——从 ReAct 到分层规划与自我纠错。** 一个能规划、能反思的 Agent，才是真正有"智能"的 Agent。

---

> **系列导航**：本文是 Agentic 系列的第 09 篇。
>
> - 上一篇：[08 | 记忆架构：Agent的状态与记忆体系](/blog/engineering/agentic/08-记忆架构：Agent的状态与记忆体系)
> - 下一篇：[10 | 规划与反思：从ReAct到分层规划与自我纠错](/blog/engineering/agentic/10-规划与反思：从ReAct到分层规划与自我纠错)
> - 完整目录：[01 | 从LLM到Agent：Agentic系统的知识地图](/blog/engineering/agentic/01-从LLM到Agent：Agentic系统的知识地图)
