---
title: "Agent基础架构平台"
pubDate: "2026-03-27"
description: "当组织需要运行多个 Agent、服务多业务方、对接多租户时，需要的不是更多 Agent 代码，是一整套基础架构平台。本文给出平台的五层架构、与传统微服务平台的四个本质差异、Token 配额与预扣结算的代码、LLM Gateway 的路由与 fallback 链，以及平台演进四阶段的避坑路径。"
tags: ["Agent", "系统架构", "基础设施", "平台工程"]
slug: "agent-platform-infrastructure"
author: "skyfalling"
series:
  key: "agentic"
  order: 13
---

当一个组织开始同时运行几十上百个 Agent——服务多业务方、对接多租户、调多家模型、用多套工具，需要的不是更多 Agent 代码，是一整套基础架构平台。它和传统微服务平台表面相似——都有网关、注册、调度、可观测——但底层约束完全不同：**Token 是新货币**（成本以 token 计而非 CPU 时间）、**Session 是新单位**（一次"请求"是几分钟的循环而非毫秒级 API 调用）、**非确定性是新常态**（同输入路径不同、资源消耗不同）。这三个差异让每一层都需要重新设计，不是把微服务平台模式照搬过来。下面展开五层架构、Token 配额与租户隔离的代码骨架、LLM Gateway 的路由与 Fallback 链，以及四阶段演进的避坑路径。

---

## 1. 为什么需要平台

大多数 Agent 教程的终点是一个能跑通的 demo。从 demo 到生产、从一个 Agent 到一百个 Agent，中间隔着的不是"更多代码"——是基础架构平台。

类比早期互联网公司后端：每个团队各自搭 Web 框架、各自管数据库连接、各自实现日志系统。后来演化出统一的微服务平台——服务注册发现、配置中心、API 网关、链路追踪、容器编排——开发者只关注业务逻辑。

Agent 领域正在经历同样的演进。当前许多团队每个 Agent 项目自己管 LLM 调用、自己实现会话存储、自己处理工具调用、自己搭监控——**大量重复建设，质量参差不齐**。

平台演进三阶段：

| 阶段 | 特征 | 瓶颈 |
|------|------|------|
| 脚本化 | 直接调 API、内存存对话、硬编码工具 | 不可维护、不可监控、不可扩展 |
| 单体服务化 | 包装成 Web 服务，Redis 存会话，PG 存日志 | Agent 间大量重复代码，无法统一治理 |
| **平台化** | 统一 LLM 网关/工具服务/记忆存储，Agent 配置化注册部署 | 平台本身的建设成本和持续运营复杂度 |

本文聚焦的就是第三阶段——当组织内运行多个 Agent，面向多业务场景，服务多租户时，如何设计支撑 Agent 规模化的基础架构平台。

---

## 2. 与传统微服务平台的四个本质差异

理解这四个差异，才能理解后续每层设计中那些"看似过度"的部分——它们都在应对 Agent 场景的本质挑战。

### 2.1 长会话 vs 短请求

传统微服务处理无状态短请求——毫秒到秒级，请求间无关联。Agent 交互是长会话——一次会话可能数十轮对话，持续几分钟到几小时，每轮决策依赖之前所有轮次。

**工程后果**：会话状态必须持久化；负载均衡需要 Session 亲和性；资源分配粒度从"请求级"变为"会话级"。

### 2.2 非确定性 vs 确定性

传统服务执行路径确定——代码审查就能推断行为。Agent 核心是 LLM 推理——同一输入可能产生不同的工具调用序列、不同的执行路径。**一次请求可能走 2 轮也可能走 8 轮**。

**工程后果**：资源消耗不可预测，需要更灵活的超时和限流；排障不能只靠日志，需要完整运行时追踪；质量保障不能只靠单元测试，需要统计性评估体系。

### 2.3 Token 经济 vs 计算经济

传统服务的主要成本是 CPU 和内存——可以通过加机器线性扩展。Agent 的主要成本是 Token——**旗舰模型与轻量模型可相差 10-30 倍**。

**工程后果**：流控核心维度从 QPS 变为 TPM（Tokens Per Minute）；成本优化是省 Token，不是省机器——Prompt 压缩、模型路由、缓存命中率成为关键指标；预算管理需精确到单次调用级别。

### 2.4 工具调用的安全边界

传统服务调下游 API 是开发者编码时确定的——调什么、传什么写死。Agent 的工具调用是 LLM 运行时动态决策的——**调哪个工具、传什么参数取决于 LLM 推理结果**。

**工程后果**：工具调用需要沙箱隔离；参数需要运行时校验，不能信任 LLM 输出；敏感操作需要人工审批机制。

---

## 3. 平台的五层架构

![五层架构](/images/blog/agentic/five-layer-architecture.svg)

| 层 | 职责 |
|---|------|
| **接入层** | 协议适配、流量管理、面向外部世界的入口 |
| **调度层** | Agent 注册、路由、生命周期管理 |
| **运行时层** | Agent 实际执行、状态管理、安全隔离 |
| **能力层** | Agent 运行所需的共享基础能力（LLM Gateway、Tool Service、Memory） |
| **基础设施层** | 底层计算、存储、网络资源 |

各层遵循单向依赖——上层依赖下层，下层不感知上层。这种分层让每层可独立演进和替换。

下面按层展开关键设计。

---

## 4. 接入层：长连接与 Token 流控

### 4.1 流式响应是必须的

Agent 响应不是瞬时的——经过多轮 LLM 推理和工具调用可能耗时数十秒。如果用传统 HTTP 请求-响应，用户面对漫长空白等待。

| 协议 | 特点 |
|------|------|
| **HTTP + SSE** | 最常见。基于标准 HTTP，与 CDN、API Gateway 兼容性好 |
| WebSocket | 双向实时，适合需要中途中断或追加输入的场景。但与 CDN/LB 兼容性差 |
| gRPC Stream | 内部服务间通信 |

SSE 的工程挑战：

| 问题 | 解法 |
|------|------|
| **背压控制** | 客户端消费速度低于服务端产生速度时，服务端维护有界缓冲区，满时暂停 LLM 推理流的消费 |
| **断线重连** | 长连接不可避免会断——为每个 SSE 流分配 stream_id 和递增 event_id；客户端重连时带 Last-Event-ID；服务端从该位置恢复推送（已推送的事件在 Redis 缓存一段时间） |

### 4.2 API Gateway 的特殊配置

传统网关面向短请求设计——超时秒级、请求体 KB 级、不处理流式。Agent 场景下这些默认配置几乎都要调。

| 配置 | 默认 | Agent 场景需要 |
|------|------|---------------|
| 超时 | 30s | 5 分钟（兜底）+ 运行时层的精细超时（30s/轮、最多 10 轮） |
| 请求体 | 1MB | 适当放大（对话历史 + 文件 + 长文档） |
| 连接管理 | 短连接为主 | SSE 长连接会长期占用槽，需单独配置 Agent 路由的最大连接数 |
| 健康检查 | 简单 ping | 包含负载信息（活跃会话数、排队请求数）做智能路由 |

### 4.3 Token 维度的流控

**这是 Agent 平台接入层最独特的设计**。传统流控以 QPS 为核心——一个请求的资源消耗大致相同。

Agent 平台中**同一个请求的资源消耗可能相差 100 倍**——简单问答 500 Token，复杂多步推理 50000 Token。仅限制 QPS 无法保护模型资源——10 个"重请求"可能比 1000 个"轻请求"消耗更多预算。

双维度流控：QPS 保护接入层和调度层，TPM 保护模型资源和预算。

**TPM 流控的难点是请求开始时 Token 消耗未知**。实用方案是**预估 + 事后结算**——类似信用卡的授权和结算：

```python
def admit_request(req: Request, tenant: Tenant) -> AdmissionResult:
    """请求进入时：预估 token 消耗 + 预扣额度"""
    # 1. 估算这次请求大约多少 token
    estimated = estimate_token_consumption(
        input_tokens=count_tokens(req.input),
        agent_kind=req.agent_kind,
    )
    # 简单 Agent ×2 系数，复杂 Agent ×5 系数
    multiplier = AGENT_MULTIPLIER.get(req.agent_kind, 3)
    estimated_total = estimated * multiplier

    # 2. 检查租户 TPM 余额（用 Redis + Lua 保证原子性）
    ok = redis_eval(LUA_RESERVE_TOKENS, keys=[tenant.tpm_key],
                    args=[estimated_total, now_minute()])
    if not ok:
        return AdmissionResult(admit=False, reason="tpm_limit", retry_after_s=30)

    # 3. 预扣，记录预扣量到 reservation_table
    reservation_id = reserve(tenant.id, req.id, estimated_total)
    return AdmissionResult(admit=True, reservation_id=reservation_id,
                           estimated_tokens=estimated_total)

def settle_request(reservation_id: str, actual_tokens: int):
    """请求结束时：用实际消耗替换预扣量"""
    r = get_reservation(reservation_id)
    diff = actual_tokens - r.estimated

    # 实际比预估多/少都要更新租户余额
    redis_incrby(r.tenant.tpm_key, diff)
    record_actual(r.tenant.id, r.request_id, actual_tokens)

    # 用实际数据动态调整该 Agent 的预估系数
    update_multiplier(r.agent_kind,
                     ratio=actual_tokens / r.estimated)
```

| 阶段 | 动作 |
|------|------|
| 请求进入 | 根据输入长度和 Agent 类型估算（简单 Agent 2×，复杂 5×）→ 检查租户 TPM 余额 → 预扣预估量 |
| 执行中 | 实时累加实际消耗 → 超出预估量阈值（150%）触发告警或终止 |
| 请求完成 | 用实际消耗替换预估量 → 更新租户使用记录 → 动态调整预估系数 |

---

## 5. 调度层：Agent Registry 与多租户

调度层让平台从"跑一个 Agent"跨越到"管一群 Agent"。

### 5.1 Agent Registry

类似微服务注册中心（Nacos、Consul），但管理的元数据不同——Agent 特有的属性包括：

```yaml
agent:
  id: "agent-customer-support-v2"
  version: "2.3.1"
  status: "active"  # active / canary / deprecated / disabled

  config:
    model: "gpt-4o"
    max_turns: 10
    system_prompt_ref: "prompt://customer-support/v2.3"
    tools: ["tool://order-query", "tool://refund-process"]

  routing:
    tenants: ["tenant-a", "tenant-b"]
    traffic_weight: 80          # 灰度流量百分比
    fallback_agent: "agent-customer-support-v1"

  health:
    active_sessions: 47
    avg_latency_p95: 3200ms
```

存储选型按规模：< 100 个 Agent 用 Redis/etcd；100-1000 用 PostgreSQL + 缓存；> 1000 用专门的元数据服务。

**配置更新与热生效**对 Agent 平台特别重要——Prompt 修改、模型切换、工具调整，都需要在不重启的情况下立即生效。

### 5.2 多租户隔离

| 维度 | 实现 |
|------|------|
| **资源隔离** | 每租户独立配额：并发会话数、TPM、月度 Token、可用 Agent 列表。区分硬限制（不可突破）和软限制（可临时超出触发告警） |
| **数据隔离** | 共享存储 + tenant_id 过滤（逻辑），或独立数据库（物理）。安全要求高的租户用物理 |
| **模型隔离** | 不同租户的请求队列独立——某租户占满模型供应商速率限制不应影响其他租户 |

多层配额检查的代码骨架：

```python
def check_quotas(req: Request, tenant: Tenant, agent: Agent, session: Session):
    """每次进入 LLM 调用前要过 4 层配额检查"""
    checks = [
        # 平台级
        ("platform_tpm",
         platform_tpm_used() < PLATFORM_TPM_LIMIT,
         "platform-wide tpm exhausted"),
        # 租户级
        ("tenant_monthly",
         tenant.monthly_used < tenant.monthly_quota,
         "tenant monthly token quota exceeded"),
        ("tenant_concurrency",
         tenant.active_sessions < tenant.max_sessions,
         "tenant concurrent sessions limit"),
        # Agent 级
        ("agent_per_minute",
         agent.calls_this_minute < agent.max_per_minute,
         "agent per-minute call limit"),
        # 会话级
        ("session_token",
         session.tokens < session.max_tokens,
         "session token limit reached"),
    ]
    for name, ok, msg in checks:
        if not ok:
            raise QuotaExceeded(scope=name, message=msg)
```

### 5.3 灰度发布

Agent 的灰度比传统服务更重要——**Agent 行为非确定性，即使通过测试，面对真实流量也可能表现不同**。

| 灰度策略 | 适用 |
|---------|------|
| 按流量比例 | 5% → 20% → 100% 渐进切换 |
| 按租户 | 先在特定租户（内部或合作较深）上发布 |
| 按场景 | 对同一 Agent 的不同使用场景选择性切换 |

实现基于路由规则引擎——规则存配置中心（Nacos、Apollo），支持动态更新无需重启。

### 5.4 Prompt 版本化

**Prompt 不是一段文字，是核心业务逻辑**——它决定 Agent 的行为模式。Prompt 修改等同于代码修改，需要同等级别的版本管理：完整内容、变更说明、关联的测试结果、审批记录。支持版本间 diff 对比，方便排查 Prompt 变更导致的质量问题。

---

## 6. 运行时层：让 Agent 可控

运行时层解决的核心问题：**Agent 本身不可控——非确定性、可能超时、可能死循环、可能调用危险工具——但平台必须可控**。

### 6.1 部署粒度

| 粒度 | 隔离 | 资源效率 | 适用 |
|------|------|--------|------|
| 进程级 | 协程/线程池隔离 | 高 | 轻量 Agent，成本敏感 |
| 容器级 | 容器隔离 | 中 | 最常见，平衡隔离和效率 |
| Serverless | 函数级 | 低（冷启动） | 低频但隔离要求高 |

### 6.2 会话管理

会话不是一次性请求-响应，是有状态的、可能持续很长时间的交互过程。

| 关键能力 | 实现 |
|---------|------|
| 状态持久化 | 持久化到 Redis/数据库——运行时实例可能随时重启或迁移 |
| Session 亲和性 | 同会话路由到同一实例（避免每次都从外部存储加载完整状态） |
| 生命周期 | 空闲超时（30 分钟无活动）+ 绝对超时（24 小时强制） |

**Session 亲和性应作为优化而非依赖**——即使会话被路由到新实例也能通过加载状态正常工作，只是多一次存储访问的开销。

### 6.3 Context Window 管理

LLM 的 context window 有限，但 Agent 对话历史会随轮次增加。超出时表现急剧下降——必须解决。

| 策略 | 信息保留 | 实现成本 |
|------|--------|--------|
| 滑动窗口 | 低（早期信息全丢） | 极低 |
| 摘要压缩 | 中（语义保留） | 中（额外 LLM 调用） |
| 选择性保留 | 高 | 中（需要重要性评分） |
| 分层上下文 | 高 | 高 |

平台应提供统一 Context Manager 组件——开发者通过配置选择策略和参数，不需要自己实现。

### 6.4 工具执行沙箱

| 防护层 | 防什么 |
|--------|-------|
| 参数 Schema 校验 | 类型错误、值域越界 |
| 工具权限 | Agent 越权调用（即使 LLM 输出了其他工具的指令，运行时也应该拦截）|
| 代码执行沙箱 | Docker / gVisor / Firecracker——限网络、限文件系统、限时间内存 |
| 敏感操作审批 | 高风险操作（发邮件、改库、支付）暂停等待人工确认 |

### 6.5 超时与熔断的多层

| 层 | 阈值 | 防什么 |
|---|------|-------|
| 单工具超时 | 30s | 工具阻塞主循环 |
| 单轮总超时 | 60s | 单轮卡死 |
| 全局超时 | 5-10 分钟 | 整个 Agent 失控 |
| Token 预算熔断 | 单次执行上限 | 成本失控 |
| 死循环检测 | 滑动窗口 + 频次统计 | 反复同一序列 |
| 级联熔断 | Circuit Breaker | 下游故障雪崩 |

**Agent 的非确定性使得超时和熔断比传统服务更重要**——没有适当控制，一个失控的 Agent 可以在几分钟内消耗整月预算。

---

## 7. 能力层：把共性能力做成共享基础设施

能力层是平台复用性的核心。对上提供统一抽象，对下适配多种实现。

### 7.1 LLM Gateway

能力层最核心的组件——在 Agent 运行时和 LLM 供应商之间建立抽象层。

![LLM Gateway 架构](/images/blog/agentic/llm-gateway.svg)

| 能力 | 实现 |
|------|------|
| **统一接口** | 屏蔽不同供应商（OpenAI/Anthropic/Google/本地）的 API 差异，对上提供统一调用接口 |
| **智能路由** | 根据请求特征（任务复杂度、Token 长度、延迟要求、成本预算）选择模型——简单问答路由到 GPT-4o-mini，复杂推理路由到 Claude Opus |
| **Fallback** | 主模型超时或不可用时降级到备选。Fallback 链：主模型 → 同级备选 → 低一级 → 错误响应 |
| **语义缓存** | 相同或语义相似的请求直接返回缓存。基于 Embedding 相似度匹配，命中率和准确率需持续监控 |
| **请求排队** | 模型供应商速率限制成为瓶颈时，按租户优先级调度——高优先级先发，低优先级排队 |

LLM Gateway 的核心调用伪代码：

```python
class LLMGateway:
    def chat(self, req: ChatRequest, ctx: RequestContext) -> ChatResponse:
        # 1. 语义缓存查找（仅对幂等、可缓存请求）
        if req.cacheable:
            if cached := semantic_cache.get(req, threshold=0.93):
                return cached

        # 2. 路由：根据请求特征 + 当前供应商状态选择模型
        model = router.select(
            features=extract_features(req),
            constraints={
                "max_cost": ctx.budget_remaining,
                "max_latency_p95": ctx.latency_sla,
                "tenant_tier": ctx.tenant.tier,
            },
        )

        # 3. 调用，带 fallback 链
        for attempt, candidate in enumerate(model.fallback_chain):
            try:
                resp = provider_call(
                    candidate, req,
                    timeout=ctx.timeout_budget(attempt),
                )
                if req.cacheable and resp.is_high_quality:
                    semantic_cache.set(req, resp)
                return resp
            except (TimeoutError, RateLimitError, ProviderError) as e:
                log_fallback_event(ctx, candidate, e)
                if attempt == len(model.fallback_chain) - 1:
                    raise          # 链路用尽
        raise UnreachableException()
```

**语义缓存的陷阱**——它在某几类请求上是金矿（基础知识问答、固定流程的客服 FAQ、确定性的工具用法指导），在另几类上是地雷：

| 不能缓存的场景 | 为什么 | 失败时的代价 |
|---|---|---|
| **实时数据查询**（今天股价、当前订单状态）| 缓存命中时返回的是过时数据 | 业务决策基于陈旧信息 |
| **个性化响应**（"我的订单"、"我的余额"）| 不同用户问"我的 X"语义相似，命中错误用户的缓存 | **跨用户数据泄露** |
| **带状态的操作**（"刚才那个改成..."）| 同样的提问在不同对话上下文里答案完全不同 | 答非所问 |
| **创意/写作**（"写个诗"、"想个名字"）| 用户预期每次都新鲜 | 用户体验断崖 |
| **基于工具结果的回答** | 工具结果本身可能变了 | 给出与工具新结果不一致的答案 |

工程上的两条保险：**命中后必须验证关键字段没漂移**（如缓存的回答里说"截至 X 时"，X 时如果已经过期就跳过缓存）；**对高风险路径默认禁用缓存**（涉及金额、账户、合规决策的请求强制走全流程）。**缓存错误的回答比不缓存更危险**——一次错误回答只是体验问题，缓存它会让 N 倍用户复制同一错误。

### 7.2 Tool Service

工具的注册中心和执行代理。

| 能力 | 实现 |
|------|------|
| 工具注册 | 标准化元数据格式：名称、描述、参数 Schema、返回 Schema、权限、调用限制 |
| 工具发现 | 静态声明（Agent 配置列出）或动态发现（按任务需求从工具库搜索） |
| MCP 协议集成 | 支持 MCP 让外部工具通过标准协议接入——极大扩展工具生态 |
| 调用代理 | 添加统一的认证、限流、超时、重试、日志——Agent 不直接调后端 API，通过 Tool Service 间接调，降低耦合 |

### 7.3 Memory Store

记忆系统的层次架构（短期对话、工作记忆、情景、语义/RAG）是单 Agent 视角的话题。**平台层 Memory Store 关心的是另一组问题**——这些问题单 Agent 不会遇到：

| 平台层独有问题 | 怎么解 |
|---|---|
| **作用域与隔离** | 每条记忆带 `tenant_id` + `agent_id` + `scope` (`private` / `shared` / `global`)；查询时硬过滤——租户 A 的私有记忆永远不会泄到租户 B |
| **统一 Embedding 服务** | 各 Agent 不直接调 Embedding API，走平台层统一服务——避免成本不可控、模型版本不一致 |
| **跨 Agent 共享** | 平台运营级别的"全局事实库"（如公司常见缩写、产品名映射），允许多 Agent 只读访问 |
| **Embedding 模型升级的迁移** | 模型升级时，平台层负责全量重建索引——业务 Agent 不参与；切换期间双索引并查 |
| **配额与垃圾回收** | 每租户向量库容量配额；周期性 vacuum 删除超期/被标记的记录；统一的备份与恢复 |

单 Agent 视角的"四层记忆怎么分"是另一回事——平台层不重新设计四层架构，只在四层之上加一组"多租户、统一服务、跨 Agent 共享、运营治理"的横切能力。

**跨 Agent 知识共享**——记忆作用域：private（仅当前 Agent）、shared（指定 Agent 组）、global（全平台）。

### 7.4 Prompt 管理服务

Prompt 在生产环境的全生命周期管理。

| 能力 | 实现 |
|------|------|
| 模板与变量注入 | 运行时把模板与变量绑定生成最终 Prompt——变量来自 Agent 配置、租户配置、用户会话上下文、实时查询结果 |
| Prompt 仓库 | 可复用 Prompt 片段（通用安全规则、输出格式、CoT 模板）通过引用而非复制使用 |
| A/B 测试 | 同一 Agent 同时运行多版本 Prompt，按比例分配流量比较效果——Prompt 级灰度发布 |

---

## 8. 弹性伸缩：Token 配额比 QPS 更核心

### 8.1 Agent 负载的特殊性

| 特征 | 后果 |
|------|------|
| CPU 低 + I/O 极高 | **基于 CPU 的自动伸缩策略几乎无效**——主要时间花在等待外部 I/O |
| 内存波动大 | 每个活跃会话占数 MB——大量会话同时活跃时内存急剧上升 |
| 延迟高且方差大 | 几秒到几分钟，与传统服务毫秒级稳定延迟完全不同 |
| 资源消耗不可预测 | 同一 Agent 处理简单问题 1 轮、复杂问题 8 轮，资源消耗相差数倍——**传统容量规划公式 QPS × 单请求资源 在此失效** |

### 8.2 多维度弹性伸缩

运行时层伸缩——核心指标是**活跃会话数和请求排队深度**，不是 CPU 使用率：

| 触发条件（任一）| 阈值 |
|---------------|------|
| 活跃会话/实例 | > 50 |
| 请求排队时间 P95 | > 5s |
| 可用连接数 | < 总数的 20% |

LLM Gateway 伸缩——核心指标是 **Token 消耗速率和模型供应商速率限制余量**。当接近供应商限制时不是"加 Pod"，而是"加模型资源"：

| 触发 | 优先级 | 动作 |
|------|------|------|
| OpenAI TPM > 80% | 1 | 启用排队，对低优先级限速 |
| | 2 | 部分流量路由到 Anthropic 备选 |
| | 3 | 多 API Key 轮转 |

### 8.3 GPU 资源调度

如果运行本地模型，GPU 调度是核心：

| 策略 | 思路 |
|------|------|
| GPU 分时复用 | vGPU（NVIDIA MPS、MIG）逻辑划分，多个小模型共享大显卡 |
| 推理负载感知调度 | 7B 模型 200ms + 8GB VRAM；70B 模型 3s + 80GB（需 2 张 A100）——调度器路由到合适节点 |
| 冷启动优化 | 本地模型加载几十秒到几分钟——预加载常用模型，保持"热实例"随时可用 |

GPU 调度的几个工程现实，比"分时复用、负载感知、冷启动"这三行字更扎心：

- **碎片化代价高**：A100 80GB 拆 4 张 20GB 跑 7B 模型看起来划算，但每张 vGPU 的 KV cache 上限随之降为 1/4，并发 token 容量同步缩水——不是简单地"算力÷4"。MIG 模式比 MPS 隔离更强但灵活度更低，团队要按模型混部模式选
- **同租户优先**：跨租户共享 GPU 时，QoS 抖动会让两个租户都不满意。除非负载特征互补（一个白天热、一个晚上热），否则物理隔离比逻辑隔离运维更省心
- **模型预热是真活**：vLLM/SGLang 加载 70B 模型需要约 1-3 分钟，期间所有请求要排队。生产中通常按"工作时段"预热常用模型，深夜降级到几个保留实例就够
- **混合部署的拐点**：当某个模型的日均 token 量 ≥ 1B token/月时，本地部署的固定成本（GPU 折旧 + 运维）通常已经低于 API 费用——这个阈值是判断"什么时候该从纯 API 切到混合部署"的实用经验值

### 8.4 成本工程：平台层的杠杆

单 Agent 视角的成本优化——模型分层、缓存、Prompt 压缩、工具结果截断、Spot Instance——这是每个 Agent 项目都要做的事。平台层多出两个杠杆：

| 杠杆 | 节省 | 平台层独有的理由 |
|------|------|---------------|
| **统一的语义缓存** | 30-60% | Agent 之间可共享缓存——租户 A 查过的问题，租户 B 也可能问到（在不违反数据隔离的前提下） |
| **模型本地化** | 60-90% | 单 Agent 项目难以摊销 GPU 集群的固定成本；平台聚合多 Agent 流量后，常用模型（7B、13B）本地部署比 API 更经济 |

---

## 9. 平台层观测：Agent Trace 与传统的差异

生产 Agent 的可观测性本身是一个独立话题（三层指标、trace span 模型、日志分级）。平台层在那之上的额外要点：

### 9.1 Agent 追踪 vs 传统追踪

![Agent Trace 结构](/images/blog/agentic/agent-trace-structure.svg)

| 维度 | 传统服务 | Agent |
|------|--------|------|
| 调用链结构 | 线性的服务调用 | 循环中嵌套多种操作类型的树状结构 |
| 关键 Span | RPC 调用 | LLM_CALL / TOOL_CALL / MEMORY_READ |
| 关键属性 | 服务名、HTTP 状态码 | 模型名、Token 数、工具名 |

OpenTelemetry 没有 Agent 标准——社区有 GenAI Semantic Conventions 草案，可参考扩展。

### 9.2 日志分级存储的平台特性

Agent 日志量远大于传统服务——分级存储（热/温/冷）是单 Agent 视角就要做的事。**平台层的额外要点**：跨租户的存储隔离（不同租户的采样池不应混在一起），跨 Agent 的 schema 一致性（避免每个 Agent 自定义日志结构导致下游报表难做），以及与计费的对齐（采样 prompt 既是排障证据也是成本归因证据，平台层要让这两个用途共用一份数据）。

### 9.3 Agent 可观测性专用工具

通用 APM（Datadog、Prometheus）缺失的能力是**原生支持 LLM 调用链可视化和 Token 级成本追踪**。专用工具：

| 工具 | 特点 |
|------|------|
| **LangFuse** | 开源可自部署，Trace + Prompt 管理 + 评估 + 成本 |
| LangSmith | LangChain 官方，与生态深度绑定 |
| Helicone | LLM 代理层，请求日志 + 成本分析 + 缓存 |
| Arize/Phoenix | ML 可观测性扩展到 LLM，质量漂移检测 |

从零建设可选 LangFuse 起步。已有成熟 APM 体系的更好做法是**在现有体系扩展 Agent 自定义指标和 Trace 属性**，不引入独立系统。

---

## 10. 安全治理：平台层的统一拦截

Prompt Injection、Guardrails、数据安全、权限模型这些是单 Agent 视角下的安全工程，每个 Agent 项目都得自己面对。平台层在那之上的额外要点：

### 10.1 模型调用审计

完整记录：谁、什么时间、用哪个 Agent、调哪个模型、消耗多少 Token、花多少钱。

审计不只用于安全合规，也是成本分摊和争议处理的依据——租户质疑账单时可提供详细记录作为凭证。

### 10.2 操作风险分级

| 级别 | 执行策略 | 典型操作 |
|------|--------|---------|
| 低风险 | 自动执行 | 查订单、搜索 KB、获取天气 |
| 中风险 | 执行 + 审计 | 修改用户配置、创工单、更新数据库 |
| 高风险 | 人工实时审批 | 发邮件、退款、删数据、调外部支付 |

审批超时要有明确策略——长时间不审批应通知用户等待、自动拒绝、或升级到更高权限审批者。

### 10.3 多层配额体系

| 层 | 配额项 |
|---|------|
| 平台级 | 所有租户的 TPM 总上限、各模型的全局速率限制 |
| 租户级 | 月度 Token 总额、TPM、并发会话上限、可用 Agent 列表 |
| Agent 级 | 单次执行 Token 上限、单次执行最大轮次、每分钟最大执行次数 |
| 会话级 | 总 Token、会话时长、工具调用次数 |

配额检查需要实时——每次 LLM 调用前检查余额，每次工具调用前检查次数。Redis 存储 + Lua 脚本保证检查和扣减的原子性：

```lua
-- LUA_RESERVE_TOKENS：原子检查 + 预扣
-- KEYS[1] = tenant tpm key (按分钟分桶)
-- ARGV[1] = amount, ARGV[2] = current_minute
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(redis.call('GET', KEYS[1]..':limit') or '999999999')
if used + tonumber(ARGV[1]) > limit then
    return 0
end
redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], 120)   -- 双分钟保留容错
return 1
```

---

## 11. 平台演进的四个阶段

**不要试图一步到位**。根据业务阶段和实际需求分阶段演进：

![平台演进路径](/images/blog/agentic/platform-evolution.svg)

| 阶段 | 目标 | 关键能力 | 工具选型 |
|------|------|--------|---------|
| **Phase 0** 最小可用 | 第一个 Agent 上生产 | LLM Gateway（LiteLLM）+ 简单日志（ELK） | 单机 + Docker Compose |
| **Phase 1** 多 Agent 管理 | 共性能力抽取 | Agent Registry + Tool Service + 多租户（逻辑隔离）| PG + Redis |
| **Phase 2** 平台运营 | 稳定性和质量 | 灰度发布 + 三层监控 + Prompt 版本化 + 自动化评估 | OpenTelemetry + Prometheus |
| **Phase 3** 规模化治理 | 成本、安全、治理、**开发者体验** | 成本工程 + 安全审计 + 编排引擎 + 开发者体验四件套（见下）| 全栈 |

Phase 3 中"开发者体验"这一项最容易被忽视，但它是平台 ROI 的最终瓶颈——平台再好用，业务团队接不上也白搭。具体包括四件套：

| 开发者体验四件套 | 具体内容 | 没做好的后果 |
|---|---|---|
| **本地开发环境** | 一行命令拉起完整平台栈（Gateway + Registry + Memory Store + 可观测）；mock 模型替代真实 API 调用 | 业务团队要"等环境"才能开发，迭代速度断崖式下降 |
| **Agent 模板与脚手架** | `agent-cli new` 一键生成包含 system prompt、tools、配置、eval、灰度的项目骨架 | 每个团队自己拼，质量参差不齐 |
| **真实环境的快速调试** | 一键复现生产 trace、单步重跑某次 LLM 调用、Agent state 时间旅行 | 出问题查不出来，最后只能"全量回滚 Prompt" |
| **共享组件目录** | 复用度高的 tool、prompt 片段、guardrail 规则做成可索引的目录 | 同一份工具被重复写 N 次，bug 也修 N 次 |

判断开发者体验做得够不够的简单指标：**一个新 Agent 项目从立项到第一个生产灰度需要几天**？低于一周说明平台投入有回报，高于一个月说明开发者体验严重欠债。

### 四个常见的过度设计陷阱

| 陷阱 | 原因 |
|------|------|
| 过早微服务 | Phase 0/1 一个单体服务足够。过早拆分增加运维复杂度 |
| 过早自研 LLM Gateway | LiteLLM、One API 等开源方案已足够。除非有非常特殊需求 |
| 过度追求实时性 | 日志分析、质量评估、成本报表分钟级甚至小时级延迟完全可接受 |
| 试图解决所有 Agent 的通用问题 | 每个 Agent 需求不同——平台提供可组合的能力模块，不是"大而全"的统一框架 |

**最危险的过度设计是在 Phase 0 就规划 Phase 3 的系统**——从最小可用开始，让真实运营痛点驱动架构演进。

---

## 12. 不是微服务复刻，是一组新约束下的重新设计

Agent 基础架构平台容易被低估，因为表面看它和微服务平台很像——都有网关、注册、调度、可观测。但 Token 是新货币（成本以 token 计、不是以 CPU 时间计）、Session 是新单位（一次"请求"是一次几分钟的循环、不是一次毫秒级 API 调用）、非确定性是新常态（同一输入路径不同、资源消耗不同）——这三个本质差异让平台的每一层都需要重新设计，而不是把微服务平台的模式照搬过来。

平台层和单 Agent 层解决的是不同的问题。单 Agent 层关心"这一次 Agent 怎么把任务做对"，平台层关心"几十上百个 Agent 跑在同一套基础设施上怎么不互相干扰、不重复造轮子、不让成本和故障互相传染"。前者的工程焦点是 Memory、Planner、Tools；后者的工程焦点是 Token 配额、租户隔离、共享能力、统一观测。两层都做好才有规模化 Agent 系统。

平台演进的最大风险是 Phase 0 就规划 Phase 3 的系统。从最小可用开始——LLM Gateway 一个、日志一套、Agent 一个，让真实运营痛点驱动架构演进。先有第一个 Agent 上生产，再谈多 Agent 管理，再谈成本治理。这是规避过度设计的唯一方法，也是贯穿整个 Agentic 工程的统一哲学：用最简单的抽象解决问题，复杂度只在必要时引入。
