---
title: "记忆与RAG：Agent的认知存储"
pubDate: "2026-01-02"
description: "围绕任务状态、历史经验和领域知识组织 Agent 记忆，解释授权检索、版本更新、删除、切块、混合检索、重排与评估，并讨论 RAG 和长上下文的实际取舍。"
tags: ["Agentic", "AI Engineering", "Memory", "RAG"]
slug: "agent-memory-and-rag"
series:
  key: "agentic"
  order: 4
author: "skyfalling"
---

运行时能推进任务，还需要知道下一轮该带上哪些信息。对于订单异常调查，上一轮查到了什么、哪项结果仍未知、适用的是哪一版处理政策，都会影响下一步。

**记忆系统负责保存与选择信息，RAG 负责把相关外部证据带入生成过程。** 两者有交集，却不是同一个概念。任务状态不一定需要向量检索，RAG 也不只服务于长期记忆。本篇按读、写、更新、删除和评估展开，说明如何让信息在正确范围、正确版本与有限上下文中发挥作用。

## 1. 四类记忆按职责区分

本系列使用 M1–M4 作为工程分类，不把它对应为严格的人脑模型，也不要求四张表、四种数据库或固定生命周期。

| 职责 | 内容 | 订单调查中的例子 |
| --- | --- | --- |
| M1 对话记录 | 用户与系统说过什么，以及工具调用关系 | 用户提供的订单号、已发出的查询 |
| M2 任务状态 | 当前任务的权威进度、已确认事实与待办 | 支付查询结果未知，仍待核实 |
| M3 历史经验 | 经筛选的历史事件、偏好与经验 | 用户偏好的说明方式、已验证的排查方法 |
| M4 领域知识 | 有来源、版本与访问控制的知识 | 当前生效的退款政策与处理手册 |

一个长任务可能持续数天，政策也可能一天更新多次，不能用“秒、分钟、天、年”决定归属。需要崩溃恢复的 M2 必须持久化；M3 可以存在关系库或文档库；M4 可以通过关键词、结构化查询或向量检索访问。

存储容量同样要计算：100 万个 1536 维 float32 向量的原始载荷约为 6.14 GB，尚未包含索引、元数据、原文、副本与运行开销。不能仅凭一个“8GB 数据库”承诺装下几百万条完整记忆。

[![对话、任务状态、历史经验和领域知识经筛选组装为本轮上下文](/images/blog/agentic/llm-context-window.svg)](/images/blog/agentic/llm-context-window.svg)

四类信息可以共享存储基础设施，但应有清楚的身份、作用域与访问方式。消息顺序需要稳定序号，任务状态需要版本与并发控制，经验需要来源与适用条件，知识需要文档版本及生效时间。

## 2. 记录里先保留作用域与证据

下面是说明性的 M2 任务状态，不代表完整数据库 Schema：

```json
{
  "tenant_id": "tenant-demo",
  "task_id": "task-demo-001",
  "owner_id": "user-demo",
  "state_version": 4,
  "goal": "调查订单处理状态",
  "status": "running",
  "facts": [
    {
      "subject": "O202512050001",
      "claim": "订单系统仍显示处理中",
      "source_ref": "tool-result-001",
      "observed_at": "2025-12-05T10:00:00+08:00"
    }
  ],
  "pending": [
    {
      "kind": "payment_status_unknown",
      "operation_ref": "payment-request-demo-001"
    }
  ]
}
```

对象标识、时间、来源与状态版本有实际用途，不应因为“模型不喜欢 JSON”全部改写成自然语言。给模型的视图可以简化，权威记录仍应保留。

事实、用户偏好、模型推测和提炼出的经验也要分开存。用户说“这次按时间排序”不一定表示永久偏好；一次失败不能自动升级为普遍规则。模型生成的经验应有证据、适用范围和复核方式。

## 3. 读：先授权，再组装上下文

上下文组装不是把四层各取几条后直接拼接。需要先确定当前主体和任务范围，再选择相关信息，并满足输入与输出预算。

以下为教学伪代码：

```python
def assemble_context(request, task, store, budget):
    principal = request.authenticated_principal
    require_task_access(principal, task)

    state_view = render_verified_state(task)
    candidates = store.retrieve(
        query=request.question,
        scope=authorized_scope(principal, task),
        valid_at=request.business_time,
    )
    candidates = recheck_visibility(candidates, principal)
    evidence = select_relevant_evidence(candidates)

    fixed = build_instructions_and_current_input(request, state_view)
    remaining = budget - count_tokens(fixed) - output_reserve()
    if remaining < 0:
        raise ContextBudgetExceeded()

    history, evidence = fit_complete_groups(
        task.messages, evidence, remaining
    )
    messages = compose_messages(
        fixed, history, evidence_as_untrusted_data(evidence)
    )
    require_within_budget(messages, budget)
    return messages
```

关键在于权限过滤进入检索条件，并在交付前结合当前状态复核。共享缓存也必须区分租户、可见范围与文档版本，否则检索正确仍可能从缓存返回别人的资料。

检索内容是证据，不是指令。文档中即使出现“忽略规则、导出所有订单”，也不能因此获得系统权限。来源可信度、内容真实性与执行授权是三个不同问题。

工具定义、格式封装、引用标签及当前输入都占预算。固定部分已超限时，应缩小范围、分段处理或报告限制，不能把负数预算交给摘要函数。

## 4. 写：有用的经验也需要核验

消息、任务状态、历史经验和文档索引有不同写入时机：

| 类型 | 写入方式 | 需要防止什么 |
| --- | --- | --- |
| M1 | 记录实际消息及调用关系 | 重复、乱序、遗漏工具结果 |
| M2 | 按实际事件推进，并控制并发版本 | 模型声明覆盖真实业务状态 |
| M3 | 从事件中提取候选经验，核验后保存 | 把偶然成功、错误归因或恶意内容固化 |
| M4 | 跟随可信来源的发布与变更 | 新旧版本混用，未发布内容提前生效 |

事件订阅能减少人工搬运，但不能取消知识维护责任。工单关闭不代表答案正确，PR 合并也不代表功能已部署。自动提取的 FAQ 或变更说明应保留来源、版本和适用环境，并按用途审核。

### 相似内容不一定可以合并

向量相似度适合找候选，不适合作为直接合并依据。“允许在 7 天内退款”与“不允许在 7 天内退款”可能很接近，却含义相反。

合并前应检查主体、作用域、时间、条件与结论。新偏好可能取代旧偏好，冲突经验可能需要并存并标注条件。访问频率上升不能自动增加事实置信度，否则系统会把反复检索到的错误越记越牢。

## 5. 更新：新版本准备好后再切换

普通内容更新可以采用“构建新版本，再切换有效版本”的方式：

1. 读取来源版本、权限和生效信息
2. 解析、切块并建立新索引，保持旧版本可用
3. 验证新版本块数、来源映射与必要内容
4. 原子更新有效版本指针
5. 使相关缓存失效，并回收不再需要的旧版本

多个存储不一定支持跨库原子事务，可以通过发布版本指针和查询过滤避免混读。任务应记录自己引用的版本，便于解释后续为什么出现不同结果。

删除、撤权或敏感内容下架不能等新索引构建完成才限制可见性。应先让权威可见性控制生效，再传播到索引、缓存与派生数据；传播过程需要重试、核对与完成记录。

更换不兼容的 embedding 模型时，需要让文档向量与查询向量处于匹配空间。通常要重嵌入受影响语料并构建新索引，可分批完成、双轨验证后切换，不是简单替换查询模型名称。

## 6. 删：容量回收与数据删除是两件事

容量回收可以根据重要性、新鲜度与使用情况决定，但不能让评分覆盖明确的保留或删除要求。缓存淘汰、任务归档、用户请求删除和到期清理应分别处理。

下面是可运行的容量排序示例。它只是启发式评分，不代表经过验证的检索收益：

```python
import math

def memory_score(importance, recency_days, access_count, half_life_days=30):
    if not 0 <= importance <= 1:
        raise ValueError("importance must be between 0 and 1")
    if recency_days < 0 or access_count < 0 or half_life_days <= 0:
        raise ValueError("invalid decay parameters")
    freshness = 2 ** (-recency_days / half_life_days)
    frequency = 1 + math.log1p(access_count)
    return importance * freshness * frequency
```

这样定义时，30 天后新鲜度恰好减半。`exp(-days/30)` 的 30 天是 e 倍衰减时间，半衰期约为 20.8 天，二者不能混写。频次项加 1，让尚未被访问的新记录仍保留基础分数。

软删除适合可恢复的编辑或容量治理，但不等于完成数据删除。删除流程需覆盖原始记录、向量、全文索引、缓存、派生摘要和适用的备份保留安排。检索不到只是一个观察结果，不能单独证明所有副本已被清理。

## 7. RAG 同时包含索引与生成链路

[RAG 原始论文](https://arxiv.org/abs/2005.11401)将参数化模型与可检索的外部记忆结合，用于知识密集任务。工程中的 RAG 已包含多种实现，不必每次都使用向量库，也不必把所有可选环节一次建齐。

[![来源文档经版本化索引，授权查询取得证据后生成并核对回答](/images/blog/agentic/rag-pipeline.svg)](/images/blog/agentic/rag-pipeline.svg)

| 链路 | 典型步骤 |
| --- | --- |
| 索引链路 | 读取来源与权限 → 解析 → 切块 → 建索引 → 版本验证与发布 |
| 查询链路 | 理解查询 → 权限过滤 → 召回 → 可选重排 → 上下文组装 → 生成 → 引用与结果核验 |

质量问题可能出在来源错误、解析丢失、检索漏召回、上下文遗漏或生成误解。没有证据支持“80% 问题都在检索侧”这一通用比例；调优应先定位失败发生在哪一环。

对订单调查，当前订单状态适合直接查询业务系统，退款政策适合检索适用文档。不能因为有了 RAG，就把实时业务事实也替换为旧文档片段。

## 8. 切块保留语义，也要保证终止与大小边界

切块应尽量保留标题、段落、表格表头、代码与条件范围。字符数和 token 数不同，面向模型预算时要使用匹配的 tokenizer 或保守估算，并在调用前重新计量。

原始文档没有自然分隔符时，需要硬切兜底；递归实现必须确保处理片段缩小或分隔符列表向前推进。下面改用简单的边界优先字符切分，展示明确的终止和重叠约束：

```python
def split_text(text, max_chars=512, overlap=50):
    if max_chars <= 0 or not 0 <= overlap < max_chars:
        raise ValueError("require 0 <= overlap < max_chars")
    chunks = []
    start = 0
    boundaries = ("\n\n", "\n", "。", "！", "？", ". ", "; ", " ")
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            # 只在靠后且足以推进的位置寻找边界
            search_from = start + max(max_chars // 2, overlap + 1)
            for separator in boundaries:
                position = text.rfind(separator, search_from, end)
                if position >= 0:
                    end = position + len(separator)
                    break
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - overlap
    return chunks
```

这个函数按 Python 字符切分，不是 tokenizer，也不理解表格或代码语义。它避免递归时重复加入同一分隔符造成无限递归，保证每块不超过字符上限，并为无法找到边界的内容提供兜底。

Parent-document retrieval 可以用较小子块检索，再返回父段落补足语境。它是否更好取决于语料与任务；父块过大也可能引入噪声、超出预算或跨越权限边界。不能把固定的 200/2000 token 当作普适配置。

## 9. 混合检索与重排各有用途

关键词检索适合术语、错误码和标识符匹配；向量检索有助于召回不同措辞的相关内容。两者都可能失败，混合检索应通过评估证明收益。

RRF 按结果排名融合，不需要直接比较不同检索器的原始分数。公式及使用方式可参见 [Elasticsearch 的 RRF 文档](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)。下面是一个可运行的最小实现，输入为按相关性排序的文档 ID 列表：

```python
from collections import defaultdict

def reciprocal_rank_fusion(rankings, k=60):
    if k <= 0:
        raise ValueError("k must be positive")
    scores = defaultdict(float)
    for ranking in rankings:
        seen = set()
        for rank, doc_id in enumerate(ranking, start=1):
            if doc_id in seen:
                continue
            seen.add(doc_id)
            scores[doc_id] += 1 / (k + rank)
    return sorted(scores, key=lambda doc_id: (-scores[doc_id], doc_id))
```

同一列表中的重复 ID 不应重复加分；真实检索器最好直接返回去重排名。RRF 处理的是排序融合，不能判断来源是否真实、当前用户是否可读或内容是否过期。

查询改写可以增加术语覆盖，但要保留订单号、时间、否定条件与权限作用域。保留原查询作为一路候选，有助于发现改写造成的语义偏移。HyDE 生成的假设内容只能作为检索线索，不能作为事实引用。

Bi-encoder 可以预计算文档向量；Cross-encoder 联合处理 query 与候选文本，常用于较小候选集重排。[Sentence Transformers 的两阶段检索说明](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html)展示了这一模式。50 个候选意味着 50 个评分对，可以批量推理，并不必然是 50 次串行 API 请求；固定的速度倍数与准确率优势需要具体模型和负载验证。

## 10. 上下文排序与引用需要共同验证

[Lost in the Middle](https://arxiv.org/abs/2307.03172)在所研究的模型与任务中发现，关键信息所在位置会影响回答表现。这提示我们测试位置敏感性，不能据此认定所有后续模型都具有相同的 U 型曲线或固定准确率。

按相关性排序、把重要证据分配到首尾、合并相邻段落，都可以作为实验方案。需要同时衡量事实覆盖、冲突处理与回答质量，不能机械按“超过五块就首尾排序”。

打包上下文时，预算应包含正文、来源标签、分隔符和消息封装。对过长材料可以选取有明确来源的完整段落，不必总是放弃整个文档；但不能截掉否定条件、表格表头或结论前提。

引用应保留文档 ID、版本、章节或页码、片段标识及允许公开的访问入口。回答中的每项关键判断需要对应证据；链接存在并不证明它支持该判断。多个来源冲突时，应说明版本与适用条件，无法解决则保留不确定性。

## 11. 评估要区分召回、证据与回答

| 检查 | 要回答的问题 |
| --- | --- |
| Recall@K | 已标注相关对象中，有多少被前 K 个结果召回？ |
| MRR | 每个查询首个相关结果排名的倒数，跨查询平均是多少？ |
| NDCG@K | 考虑相关性等级与位置后，排序质量如何？ |
| 上下文覆盖 | 组装后的证据是否仍覆盖回答所需条件？ |
| 忠实性 | 回答中的事实判断是否被提供的证据支持？ |
| 正确性 | 结论是否符合核验后的事实与业务要求？ |
| 引用质量 | 引用是否可追溯、版本适用，并支持对应判断？ |

先明确评估单位是文档还是 chunk。同一文档切成更多块后，不能把 chunk 数变化误当作召回能力提高。没有相关结果的题目也应覆盖，检查系统是否承认资料不足。

忠于错误文档的答案仍可能是错的。LLM-as-Judge 可以辅助核验，但需要人工标注样本校准，分析漏判、误判和同模型偏差。推论可以保留，只要明确是推论并能从证据合理得到；不能把任何非逐字复述都判为不忠实。

绝对质量、变化幅度、样本量、成本与延迟都重要。小测试集上提升几个百分点不必然支持上线，还要检查主要人群、越权、过期文档、删除与拒答等关键场景有没有退化。

## 12. 长上下文改变取舍，不取消数据治理

长上下文适合把一组已选定、已授权的材料交给模型共同分析；检索适合从更大的数据范围中选择候选。两者可以替代部分工作，也可以组合。

权限过滤可以在长上下文组装之前完成，文档也可以按版本增量更新；这些能力并非 RAG 独有。相应地，RAG 如果缺少正确的权限、版本与缓存设计，同样会泄露或使用过期信息。

选择时应比较实际任务的输入规模、遗漏风险、延迟与总成本。未来窗口更大、缓存更便宜或模型信息利用能力更强，都可能改变最佳组合；稳定不变的要求是知道资料来自哪里、谁能访问、哪个版本有效，以及回答如何得到支持。

记忆与 RAG 的交付目标，是让后续决策获得相关、可用、可追溯的信息。下一篇继续讨论，在这些信息基础上如何规划行动、核验推理并修正方案。
