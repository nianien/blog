---
title: "Mousika 规则引擎：让规则可编排、可执行、可解释"
description: "本文基于 Mousika 规则引擎平台，系统解析其如何通过 DSL 编排与 JS 求值分层、四棵同构树贯穿全链路、万物皆 UDF 的统一抽象，实现规则从可视化配置到动态执行再到归因分析的完整闭环。适合对业务规则引擎、DSL 设计、动态规则平台感兴趣的工程师阅读。"
pubDate: 2026-2-17
tags: ["规则引擎", "DSL", "可视化编排", "Java"]
---

# Mousika 规则引擎：让规则可编排、可执行、可解释

> 在大规模业务系统中，业务规则的变更频率远高于代码发布节奏。投放策略、风控拦截条件、流量分配逻辑——这些规则如果硬编码在业务代码中，每次调整都意味着一次发版。
>
> Mousika 是一个面向复杂业务场景的规则引擎平台，它的核心目标是：**让业务规则的变更脱离代码发布周期，通过配置化实现秒级生效**。
>
> 本文基于 Mousika 的实际代码，拆解它是如何让规则**可编排**（可视化流程图 → AST）、**可执行**（DSL 编排 + JS 求值分层、UDF 万物皆函数）、**可解释**（四棵同构树驱动全链路归因）的。

### 阅读指南

- **了解整体架构与设计理念**：阅读第 1–3 章（约 5 分钟）
- **深入 AST 解析与执行引擎原理**：重点阅读第 4、5 章（约 20 分钟）
- **UDF 扩展与事件驱动**：第 6、7 章（约 8 分钟）
- **执行结果与可解释性**：第 8 章（约 5 分钟）
- **平台能力：可视化编排、动态调试与归因分析**：第 9 章（约 10 分钟）
- **设计权衡与工程总结**：第 10 章（约 5 分钟）

---

## 1. 为什么需要规则引擎

### 1.1 业务规则与代码的矛盾

在实际业务系统中，典型的业务规则如：

- "代理商 A 旗下客户不允许跨开户操作"
- "广告主行业为游戏且日预算低于 1 万时，走人工审核"
- "购票人为残疾人时半价，满足特定条件时免费，否则全价"

这些规则有三个共同特征：**变更频繁、逻辑复杂、影响面大**。如果硬编码在业务代码中，每次变更都需要经历 开发→测试→上线 的完整周期。

### 1.2 规则引擎的核心价值

规则引擎解决的本质问题是**规则与代码的解耦**：

```
┌──────────────────────────────────────────────────────────────┐
│                       传统方式                                │
│  业务规则 ──嵌入──→ 业务代码 ──编译──→ 发布 ──部署──→ 生效     │
│                     (变更 = 发版)                             │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                       规则引擎方式                             │
│  业务规则 ──配置──→ 规则平台 ──推送──→ 引擎热加载 ──→ 秒级生效  │
│  业务代码 ──调用──→ 引擎 SDK ──提交 Fact──→ 获取结果            │
│                     (规则变更 ≠ 发版)                          │
└──────────────────────────────────────────────────────────────┘
```

Mousika 在此基础上进一步解决了几个工程问题：
- **如何表达复杂的规则编排逻辑**（条件分支、并行、串行、范围匹配）
- **如何在运行时安全地热更新规则**（MQ 通知 + 定时兜底）
- **如何让规则执行结果可解释**（树形结果 + 动态描述）
- **如何扩展规则的能力边界**（UDF 机制 + 插件化 JAR 加载）

---

## 2. 整体架构

### 2.1 模块全景

Mousika 采用多模块 Maven 工程组织，各模块职责明确：

```
mousika/
├── mousika-core              # 规则引擎内核：解析、执行、结果分析
├── mousika-udf-sdk           # UDF 定义 SDK：注解、函数接口
├── mousika-udf               # 内置系统 UDF（场景调用、RPC 调用等）
├── mousika-runtime-base      # 运行时公共组件：监听器、转换器、ES 写入
├── mousika-rpc               # 中心化 RPC 服务（gRPC/Krpc）
├── mousika-brms              # 规则管理平台后端（Web UI）
├── mousika-sdk               # 业务方调用 SDK（Fact 定义 + RPC 接口）
├── mousika-local-runtime-sdk # 去中心化本地运行时 SDK
├── mousika-consumer          # Kafka 消费者（执行结果对比验证）
└── mousika-test-sdk          # 测试 SDK
```

核心依赖栈：**ANTLR4**（规则语法解析）、**Nashorn**（JS 表达式执行）、**ByteBuddy**（动态类生成）、**Krpc/gRPC**（RPC 通信）、**jOOQ**（数据库访问）、**Kafka/RocketMQ**（消息驱动）。

### 2.2 分层架构

从数据流视角，Mousika 的架构分为四层，每一层都有明确的职责边界：

```
┌─────────────────────────────────────────────────────┐
│                   接入层（SDK / RPC）                  │
│   业务方通过 SDK 提交 Fact 对象 + 场景 Key             │
│   RPC 模式: gRPC/Krpc 远程调用                        │
│   SDK 模式: 进程内直接调用                             │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                   编排层（Suite / Scene）               │
│   RuleSuite: 全局单例，持有所有 Scene                   │
│   RuleScene: 业务场景 → 活跃规则集 + 候选规则集（灰度）  │
│   职责: 场景路由、规则集版本管理、灰度验证                │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                   执行层（Evaluator / AST）             │
│   NodeBuilder: ANTLR4 解析规则表达式 → AST 节点树       │
│   RuleEvaluator: Visitor 模式遍历 AST                  │
│   RuleContextImpl: 执行上下文 + 缓存 + 事件分发          │
│   职责: 规则编排逻辑的解释执行                           │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│                   引擎层（RuleEngine / UDF）            │
│   Nashorn ScriptEngine: 执行单条 JS 表达式              │
│   UdfContainer: UDF 注册 + ByteBuddy 动态编译           │
│   Bindings: $ = Fact, $$ = Context, UDF 函数           │
│   职责: 单条规则的表达式求值                             │
└─────────────────────────────────────────────────────┘
```

**为什么分四层而不是两层？** 关键的设计洞察在于：规则的"编排"和"求值"是两个不同性质的问题。编排（AST 层）处理的是节点之间的逻辑关系（与或非、条件分支、串并行），这是一个树遍历问题；求值（引擎层）处理的是单条规则表达式的计算，这是一个脚本执行问题。将两者分离，使得编排逻辑可以用类型安全的 Java AST 实现，而求值逻辑可以利用 JS 引擎的灵活性——各取所长。

### 2.3 双模部署

Mousika 支持两种部署模式，业务方根据延迟敏感度和运维复杂度选型：

| 模式 | 实现模块 | 规则加载方式 | 特点 |
|------|---------|------------|------|
| **中心化 RPC** | `mousika-rpc` | 从数据库直接加载（`RuleLoaderServiceImpl`） | 统一部署，规则集中管理，有网络开销 |
| **去中心化 SDK** | `mousika-local-runtime-sdk` | 从中心服务拉取（`DecentralizedRuleLoaderServiceImpl`） | 引擎嵌入业务进程，零网络延迟 |

两种模式共享同一个 `mousika-core` 内核。去中心化模式的核心权衡是：**用内存换延迟，用复杂度换自主性**——每个业务进程持有一份规则副本，消除了 RPC 调用开销，但需要自行处理规则同步和版本一致性。

---

## 3. 核心概念模型

在深入实现之前，先厘清 Mousika 的核心领域概念及其关系：

| 概念 | 类 | 说明 |
|------|---|------|
| **RuleSuite** | `RuleSuite` | 规则套件，顶层容器。持有 `RuleEvaluator` 和所有 `RuleScene`。全局单例（`volatile` + 引用替换实现热更新） |
| **RuleScene** | `RuleScene` | 规则场景，一个业务场景对应一个 Scene（如"广告审核""客户分配"）。包含活跃规则集 + 候选规则集 |
| **RuleConfig** | `RuleConfig` | 规则集配置，包含表达式字符串和解析后的 `RuleNode` AST |
| **RuleDefinition** | `RuleDefinition` | 单条规则定义：规则 ID + JS 表达式 + 通过/未通过描述文案 + 类型标识 |
| **RuleNode** | `RuleNode` | 规则 AST 节点接口，9 种具体节点类型 |
| **RuleContext** | `RuleContextImpl` | 执行上下文，同时是 Visitor、缓存和跨规则状态容器 |
| **UDF** | `@Udf` + `Functions.*` | 用户自定义函数，通过注解或动态 JAR 注册 |
| **Fact** | 业务 POJO | 业务方提交的待匹配数据对象，在 JS 引擎中绑定为 `$` |

它们之间的关系构成了两棵树——**配置树**和**执行树**：

```
配置树（静态结构）                          执行树（运行时构建）

RuleSuite (单例)                          NodeResult
  ├── RuleEvaluator                         ├── expr: "1269->((1242||1243)?...)"
  │     └── RuleEngine                      ├── matched: true/false
  │           ├── sourceScripts             └── details: [RuleResult]
  │           │   {ruleId → JS expr}              ├── RuleResult (1269)
  │           ├── compiledScripts                 │     ├── matched: true
  │           │   {expr → CompiledScript}         │     └── desc: "获取购票人详情"
  │           └── UdfContainer                    └── RuleResult (1242||1243)
  │                 {namespace → UDF tree}              ├── matched: true
  └── scenes                                          └── subRules: [...]
        {sceneKey → RuleScene}
              ├── activeRule: RuleConfig
              │     └── ruleNode: RuleNode (AST)
              └── candidateRules: [RuleConfig]
```

---

## 4. 规则表达式与 AST 解析

### 4.1 DSL 设计：为什么不直接用 JS

一个自然的问题是：既然底层已经用了 Nashorn JS 引擎，为什么不直接让用户写 JS？

答案是 **关注点分离**。用户需要表达的是规则之间的编排关系（"先执行 A，如果通过再执行 B 和 C"），而不是通用编程逻辑。Mousika 设计了一套领域专用语言（DSL），专门用于规则编排：

| 操作符 | 语义 | 节点类型 | 执行语义 |
|-------|------|---------|---------|
| `&&` | 逻辑与 | `AndNode` | **短路求值**：任一子节点为 false 立即返回，不再执行后续节点 |
| `\|\|` | 逻辑或 | `OrNode` | **短路求值**：任一子节点为 true 立即返回 |
| `!` | 逻辑非 | `NotNode` | 对子节点结果取反 |
| `?:` | 条件分支 | `CaseNode` | **惰性求值**：只执行匹配的分支，未执行分支返回 `NaResult` |
| `->` | 串行执行 | `SerNode` | **全量执行**：按顺序执行所有子节点，取最后一个节点的结果 |
| `=>` | 并行执行 | `ParNode` | **并发执行**：线程池并发，任一为 true 则整体为 true |
| `limit(l,h,...)` | 范围匹配 | `LimitNode` | 匹配命中数在 `[l, h]` 区间内为 true |
| `()` | 分组 | — | 改变优先级 |

这套 DSL 与 JS 的关系是：**DSL 负责"编排"（哪些规则按什么逻辑组合），JS 负责"求值"（单条规则怎么计算）**。两者在不同抽象层次工作。

一条实际的规则表达式：

```
1269->((1242||1243)?1246:(1241?1244:1245))
```

在配置平台上渲染为可视化流程图，运营人员通过拖拽节点和连线即可生成这种表达式——他们不需要理解语法。

### 4.2 ANTLR4 解析流程

规则表达式的解析由 `NodeBuilder` 驱动，内部使用 ANTLR4 完成从文本到 AST 的转换。ANTLR4 是业界成熟的 parser generator，Mousika 选择它而非手写 Recursive Descent Parser 的原因是：语法可能随业务演化（如后来添加了 `limit` 和 `=>` 操作符），ANTLR4 的 grammar 文件易于扩展。

解析分为四步：

```
                 ┌────────────────────────────────────────────────────────────┐
                 │                   ANTLR4 解析流程                          │
                 │                                                          │
  输入字符串 ─────→  RuleLexer ──→ Token 流 ──→ RuleParser ──→ ParseTree     │
  "1&&2?3:4"     │   (词法分析)     [ID, &&,    (语法分析)      (语法树)       │
                 │                  ID, ?, ...]                             │
                 └──────────────────────────────┬───────────────────────────┘
                                                │
                 ┌──────────────────────────────▼───────────────────────────┐
                 │              DefaultRuleVisitor (ANTLR4 Visitor)         │
                 │                                                          │
                 │  visitOr()   → OrNode          visitPar()  → ParNode     │
                 │  visitAnd()  → AndNode         visitSer()  → SerNode     │
                 │  visitNot()  → NotNode         visitLimit()→ LimitNode   │
                 │  visitIf()   → CaseNode        visitId()   → ExprNode    │
                 └──────────────────────────────┬───────────────────────────┘
                                                │
                                                ▼
                                        RuleNode AST (可执行)
```

`NodeBuilder` 对解析结果做了**缓存**（`ConcurrentHashMap`），同一表达式只解析一次：

```java
public static RuleNode build(String expr) {
    return nodeCache.computeIfAbsent(expr, ruleExpr -> {
        long begin = System.currentTimeMillis();
        try {
            RuleNode node = Antlr4Parser.parse(ruleExpr, defaultGenerator);
            ListenerProvider.DEFAULT.onParse(
                new RuleEvent(EventType.PARSE_SUCCEED, ruleExpr, node, cost));
            return node;
        } catch (Exception e) {
            ListenerProvider.DEFAULT.onParse(
                new RuleEvent(EventType.PARSE_FAIL, ruleExpr, e, cost));
            throw new RuleParseException(ruleExpr, "rule parse failed:" + ruleExpr, e);
        }
    });
}
```

### 4.3 复合规则的递归解析与环检测

普通规则的叶子节点（`ExprNode`）直接引用一个规则 ID。但 Mousika 还支持**复合规则**（`useType=2`）——一条规则的表达式本身是另一个规则集的编排。这意味着解析时需要递归展开。

`NodeGenerator` 处理了这个递归，并通过 **Stack 做环检测**，防止 A → B → A 的循环依赖：

```java
static NodeGenerator create(Map<String, String> compositeRules) {
    return new NodeGenerator() {
        private RuleNode parseRecursively(String expr, Stack<String> resolved) {
            if (compositeRules.containsKey(expr)) {
                resolved.push(expr);  // 入栈：标记正在解析
                try {
                    return new CompositeNode(expr,
                        NodeParser.parse(compositeRules.get(expr), s -> {
                            if (resolved.contains(s)) {
                                throw new IllegalStateException(
                                    "circular dependency between [" + expr + "] and [" + s + "]");
                            }
                            return parseRecursively(s, resolved);  // 递归展开
                        }));
                } finally {
                    resolved.pop();   // 出栈：回溯
                }
            }
            return new ExprNode(expr);  // 叶子节点
        }
    };
}
```

这本质上是一个**带回溯的深度优先搜索**：`Stack<String> resolved` 维护当前解析路径，如果即将解析的节点已经在路径上，说明存在环依赖，立即抛出异常。`finally` 块确保回溯时正确出栈，不会影响同层的其他分支解析。

### 4.4 AST 节点的设计哲学

所有节点实现 `RuleNode` 接口，核心方法只有三个：

```java
public interface RuleNode {
    EvalResult eval(RuleContext context);  // 执行
    String expr();                          // 表达式序列化
    NodeType ruleNodeType();                // 类型标识

    // Builder 风格的 default 方法，支持链式组合
    default RuleNode and(RuleNode node)  { return new AndNode(this, node); }
    default RuleNode or(RuleNode node)   { return new OrNode(this, node); }
    default RuleNode not()               { return new NotNode(this); }
    default RuleNode next(RuleNode node) { return new SerNode(this, node); }
}
```

这个设计有两个值得注意的地方：

**1) Interpreter 模式**：每个节点自己负责自己的执行逻辑（`eval` 方法），而不是由一个集中的解释器遍历 AST。这使得添加新节点类型只需要实现接口，不需要修改任何已有代码（符合开闭原则）。

**2) Builder 风格的 default 方法**：`and()` / `or()` / `next()` 直接在接口层提供，使得 AST 可以通过编程方式动态构建，而不仅限于从表达式解析生成：

```java
// 编程方式构建 AST，等价于表达式 "(A && B) || C"
RuleNode tree = ruleA.and(ruleB).or(ruleC);
```

#### 短路求值的实现

`AndNode` 的短路求值实现非常简洁——遍历子节点，一旦遇到 false 立即返回：

```java
public EvalResult eval(RuleContext context) {
    for (RuleNode node : nodes) {
        if (!context.visit(node).isMatched()) {
            return new EvalResult(expr(), false, ruleNodeType());
        }
    }
    return new EvalResult(expr(), true, ruleNodeType());
}
```

注意调用的是 `context.visit(node)` 而非 `node.eval(context)`——这个间接层是关键，它使得 `DefaultNodeVisitor` 有机会在每次节点执行时记录执行树（详见 5.4 节），实现了执行逻辑与追踪逻辑的分离。

#### CaseNode：三态返回

`CaseNode` 是最能体现 Mousika 表达力的节点。传统的三元运算符只有 true/false 两种结果，但 Mousika 的 `CaseNode` 引入了第三种状态——`NaResult`（Not Applicable）：

```java
public EvalResult eval(RuleContext context) {
    EvalResult result = null;
    boolean succeed = context.visit(condition).isMatched();
    if (succeed) {
        if (trueCase != null) result = context.visit(trueCase);
    } else {
        if (falseCase != null) result = context.visit(falseCase);
    }
    return result != null
        ? new EvalResult(expr(), result.getResult(), result.isMatched(), ruleNodeType())
        : new EvalResult(expr(), NaResult.DEFAULT, ruleNodeType());
}
```

当分支为 `null` 时返回 `NaResult`——表示"该分支未被执行"。这在结果分析中至关重要：它允许下游精确区分"规则执行失败"和"规则根本未被评估"。

#### SerNode 与 ParNode：两种执行语义

`SerNode`（串行）和 `ParNode`（并行）是 Mousika 特有的控制流节点：

- **SerNode**（`->`）：按顺序执行所有子节点，**取最后一个节点的结果**。前面的节点视为"前置动作"——它们的执行结果不影响最终判定，但它们可以通过 `$$`（上下文 Map）为后续节点准备数据。

```java
// SerNode.eval() — 全量执行，取最后一个结果
public EvalResult eval(RuleContext context) {
    List<EvalResult> results = nodes.stream()
        .filter(e -> !e.expr().equals("nop"))
        .map(context::visit)
        .collect(Collectors.toList());
    EvalResult result = results.get(results.size() - 1);
    return new EvalResult(expr(), result.getResult(), result.isMatched(), ruleNodeType());
}
```

- **ParNode**（`=>`）：将子节点提交到线程池并发执行，结果聚合策略是**任一为 true 则整体为 true**。

```java
// ParNode.eval() — 并发执行 + ThreadLocal 上下文迁移
public EvalResult eval(RuleContext context) {
    RuleContextImpl ruleContext = (RuleContextImpl) context;
    ThreadLocal<EvalNode> currentEval = ruleContext.getCurrentEval();
    EvalNode stashEvalNode = currentEval.get();  // 暂存主线程的执行节点

    Vector<EvalResult> vector = new Vector<>();
    CountDownLatch latch = new CountDownLatch(nodes.size());

    for (RuleNode node : nodes) {
        executor.execute(() -> {
            try {
                EvalNode root = new EvalNode(null, ruleNodeType());
                currentEval.set(root);  // 每个线程独立的执行树根节点
                EvalResult result = context.visit(node);
                stashEvalNode.getChildren().addAll(root.getChildren());  // 合并回主线程
                vector.add(result);
            } finally {
                currentEval.set(null);
                latch.countDown();
            }
        });
    }
    currentEval.set(stashEvalNode);  // 恢复主线程上下文
    latch.await(timeout, TimeUnit.MILLISECONDS);
    // ...
}
```

`ParNode` 中最复杂的部分是 **ThreadLocal 上下文的迁移**。`DefaultNodeVisitor` 使用 `ThreadLocal<EvalNode>` 追踪当前执行位置，在并行场景下，每个工作线程需要创建独立的执行树根节点，完成后再将子节点合并回主线程的执行树。这里使用 `Vector`（线程安全）收集结果，`EvalNode.children` 也使用 `Vector` 以保证并发写入安全。

#### LimitNode：范围匹配

`LimitNode` 表达的语义是"N 个规则中命中了 M 个，M 是否在 [low, high] 范围内"：

```java
public EvalResult eval(RuleContext context) {
    int hit = 0;
    for (RuleNode node : nodes) {
        EvalResult eval = node.eval(context);
        if (eval.isMatched()) hit++;
        if (high > 0 && hit > high) break;  // 提前终止：已超上限
    }
    return new EvalResult(expr(), result.getResult(),
        hit >= low && (high < 0 || hit <= high), ruleNodeType());
}
```

`high = -1` 表示无上限。这个节点实现了类似 "至少满足 2 个条件中的 1 个" 或 "恰好满足 3 个条件中的 2 个" 这样的投票逻辑，为业务规则提供了灵活的组合能力。

---

## 5. 执行引擎

### 5.1 RuleEngine：JS 脚本编译与缓存

`RuleEngine` 是单条规则的执行核心，基于 **Nashorn JavaScript 引擎**。选择 JS 引擎而非自研表达式求值器的原因是：JS 天然支持属性链访问（`$.advertiser.industry`）、运算符、字符串操作等，省去了大量的解析和执行逻辑开发。

```java
public class RuleEngine {
    private ScriptEngine engine = new ScriptEngineManager().getEngineByName("JavaScript");
    private Map<String, String> sourceScripts = new ConcurrentHashMap<>();         // 源脚本
    private Map<String, CompiledScript> compiledScripts = new ConcurrentHashMap<>(); // 编译缓存
    private UdfContainer udfContainer = new UdfContainer(engine);

    // 初始化时注册内置规则
    {
        this.register(new RuleDefinition("true", "true", "SUCCESS"));
        this.register(new RuleDefinition("false", "false", "FAILED"));
        this.register(new RuleDefinition("null",
            "Java.type('" + NaResult.class.getName() + "').DEFAULT", "NOP"));
        this.register(new RuleDefinition("nop",
            "Java.type('" + NaResult.class.getName() + "').DEFAULT", "NOP"));
    }
}
```

几个关键的设计细节：

**1) 预编译 + 缓存**：JS 表达式通过 `Compilable.compile()` 预编译为 `CompiledScript`，后续执行直接调用 `compiledScript.eval(bindings)`。编译结果按表达式文本做 key 缓存，避免重复解析。

```java
private CompiledScript compile(String expression, boolean cache) {
    CompiledScript compiled = compiledScripts.get(expression);
    if (compiled == null) {
        compiled = ((Compilable) engine).compile(expression);
        if (cache) compiledScripts.put(expression, compiled);
    }
    return compiled;
}
```

**2) Bindings 隔离**：每次执行都创建独立的 `Bindings`，避免线程间状态污染。三种绑定注入：

```java
private Object doEval(CompiledScript script, Object root, Object context) {
    Bindings bindings = engine.createBindings();
    bindings.putAll(udfContainer.compileUdf());  // UDF 函数（命名空间对象）
    bindings.put("$", root);                      // Fact 数据对象
    bindings.put("$$", context);                   // 执行上下文 Map
    Object result = script.eval(bindings);
    return ScriptUtils.convertIntoJavaObject(result);  // JS 对象 → Java 对象
}
```

**3) 内置规则**：`true`、`false`、`null`、`nop` 是预注册的规则 ID。`null` 和 `nop` 返回 `NaResult.DEFAULT`（通过 Nashorn 的 `Java.type()` 引用 Java 类），用于在 CaseNode 中表示"不执行"。

### 5.2 规则描述的动态插值

每条规则可以配置两个描述文案（分别对应通过/不通过时展示），支持 `{$.field}` 语法引用 Fact 对象字段。`evalRuleDesc()` 方法通过正则替换将模板转换为 JS 字符串拼接表达式，然后复用 JS 引擎执行：

```java
public String evalRuleDesc(String ruleId, Boolean match, Object root, Object context) {
    // 选择对应的描述模板
    String originDesc = match ? explainPair.getRight() : explainPair.getLeft();

    // 正则替换: {$.agentId} → "+$.agentId+"
    // 最终拼接为 JS 字符串表达式: "代理商【"+$.agentId+"】不允许跨开"
    originDesc = "\"" + originDesc.replaceAll("\\{(\\$+\\..+?)\\}", "\\\"+$1+\\\"") + "\"";
    return (String) evalExpr(originDesc, root, context);
}
```

这个设计的巧妙之处在于**复用了 JS 引擎的求值能力**来做模板渲染——不需要引入额外的模板引擎，`$` 绑定在 Bindings 中天然可用。

### 5.3 RuleContextImpl：三位一体的执行上下文

`RuleContextImpl` 是整个执行流程的核心协调者。它的类定义本身就揭示了它的多重身份：

```java
public class RuleContextImpl extends LinkedHashMap<String, Object> implements RuleContext
```

**继承 `LinkedHashMap`**：自身就是上下文 Map，以 `$$` 的身份暴露给 JS 引擎。规则执行过程中可以通过 `$$.put("key", value)` 在规则之间传递状态——这是 `SerNode`（串行节点）能够实现"前置动作准备数据，后续规则使用数据"模式的基础。

**实现 `RuleContext`**：同时承担 Visitor 协调和规则执行两个职责：

```java
// 规则执行：带缓存的幂等执行
public EvalResult eval(String ruleId) {
    return evalCache.computeIfAbsent(ruleId, this::doEval);
}

// Visitor 协调：委托给 DefaultNodeVisitor，同时维护 currentRule
public EvalResult visit(RuleNode node) {
    if (node instanceof ExprNode) {
        this.currentRule.set(node.expr());  // 追踪当前执行的规则 ID
    }
    return visitor.visit(node);
}
```

`evalCache` 使用 `ConcurrentSkipListMap` 实现——有序且线程安全。当同一个规则 ID 在 AST 中被多个分支引用时，只会执行一次，后续直接返回缓存结果。这不仅是性能优化，更保证了**规则执行的幂等性**。

### 5.4 DefaultNodeVisitor：执行树的构建

`DefaultNodeVisitor` 在每次 `visit()` 调用时构建一棵与 AST 平行的**执行树**（`EvalNode` 树）。这棵树记录了"实际执行了哪些节点，每个节点的结果是什么"——这是结果可解释性的基础。

```java
public EvalResult visit(RuleNode node) {
    EvalNode evalNode = new EvalNode(node.expr(), node.ruleNodeType());
    boolean isExprNode = node.getClass() == ExprNode.class;

    currentEval.get().getChildren().add(evalNode);  // 挂到父节点下

    if (!isExprNode) {
        evalNode.setParent(currentEval.get());
        currentEval.set(evalNode);   // 进入子树
    }

    EvalResult result = node.eval(ruleContext);  // 实际执行

    if (!isExprNode) {
        // 缓存复合节点的结果
        ((RuleContextImpl) ruleContext).getEvalCache().put(node.expr(), result);
        currentEval.set(currentEval.get().getParent());  // 回溯到父节点
    }
    return result;
}
```

**区分 ExprNode 和复合节点**是这段代码的关键：`ExprNode`（叶子节点）直接挂到当前节点下作为子节点；复合节点（And/Or/Case 等）则需要"进入"——将 `currentEval` 指向自己，这样它的子节点会被正确地挂到它下面。执行完成后"回溯"到父节点。这本质上是一个**基于 ThreadLocal 的栈帧模拟**，用来在扁平的 `visit()` 调用序列中重建树形结构。

### 5.5 规则类型与决策表

Mousika 通过 `RuleDefinition.useType` 支持三种规则类型：

| useType | 类型 | 处理方式 |
|---------|------|---------|
| 0 | 普通规则 | JS 表达式直接注册到 `RuleEngine` |
| 1 | 决策表 | **转换为 UDF** → 注册为动态函数 → 修改表达式为 `udf($)` |
| 2 | 复合规则 | 规则表达式引用其他规则集 → **递归解析**为 `CompositeNode` |

决策表的处理体现了 Mousika 的统一抽象能力——不引入新的执行机制，而是将决策表转换为 UDF，复用已有的引擎：

```java
case 1: // 决策表
    String udf = "udf_rule_table_$" + ruleDefinition.getRuleId();
    // 将决策表 JSON 配置转换为 RuleTableUdf 函数
    udfDefinitions.add(new UdfDefinition(udf,
        RuleTableUdf.fromJson(ruleDefinition.getExpression())));
    // 修改规则表达式为 UDF 调用
    ruleDefinition.setExpression(udf + "($)");
    break;
```

`RuleTableUdf` 接收 Fact 对象，遍历表格的每一行，检查所有列条件是否匹配——本质上是一个 **多维度 AND 匹配器**。

---

## 6. UDF 扩展机制

UDF（User Defined Function）是 Mousika 的能力扩展基座。决策表、外部 RPC 调用、跨场景规则引用——这些看似不同的功能，全部通过 UDF 机制统一实现。

### 6.1 函数式接口体系

`mousika-udf-sdk` 定义了 `Functions` 类，包含 `Function0` 到 `Function22` 共 23 个函数式接口（对应 0 到 22 个参数），覆盖了所有可能的 UDF 签名：

```java
@Udf(value = "eval", group = "sys.scene")
@Component
public class EvalSceneUdf implements Functions.Function3<String, Object, Map> {
    public Object apply(String sceneKey, Object target, Map context) {
        return RuleSuite.get().evalScene(sceneKey, target, context);
    }
}
```

### 6.2 UdfDelegate：反射代理与自动类型转换

JS 引擎调用 Java UDF 时，参数类型是 JS 对象（Nashorn 的内部类型），需要转换为 Java 类型。`UdfDelegate` 通过**反射 + JSON 序列化**实现了透明的类型桥接：

```java
public Object apply(Object... params) {
    // 1. 按参数个数查找匹配的 apply 方法（排除 bridge 方法）
    Method method = Reflections.getMethods(udf.getClass(),
        m -> m.getName().equals("apply")
            && m.getParameterCount() == params.length
            && !m.isBridge()
    ).stream().findFirst().orElseThrow(...);

    // 2. 逐参数做类型转换：JS Object → JSON String → Java Type
    Object[] casts = Reflections.convert(params,
        method.getGenericParameterTypes(), converter);

    // 3. 反射调用
    return Reflections.invoke(method, udf, casts);
}
```

类型转换器的策略是：先尝试将 JS 对象转为 Java 对象（`ScriptUtils.convertIntoJavaObject`），如果类型不匹配，则序列化为 JSON 字符串再反序列化为目标类型。这种 **JSON 作为中间格式** 的做法虽然有性能开销，但保证了 JS 与 Java 之间几乎任意类型都能互通。

### 6.3 UdfContainer：ByteBuddy 动态类生成

UDF 在 JS 引擎中以属性链方式访问（如 `sys.scene.eval(...)`），但 Nashorn 的 `Bindings` 只支持扁平的 key-value。`UdfContainer` 需要将嵌套的 UDF 注册表（`Map<String, Map<String, Object>>`）转换为嵌套的 Java 对象。

它使用 **ByteBuddy 在运行时动态生成 Java 类**：

```java
private static Object compileUdf(String name, Object udf) {
    if (!(udf instanceof HashMap)) return udf;

    Map<String, Object> udfMap = (Map<String, Object>) udf;
    // ByteBuddy 动态生成一个类，为每个 key 创建一个 public 字段
    Builder<Object> subclass = new ByteBuddy()
        .subclass(Object.class)
        .name(name);
    for (Entry<String, Object> entry : udfMap.entrySet()) {
        subclass = subclass.defineField(entry.getKey(), Object.class, Visibility.PUBLIC);
    }
    // 实例化并赋值（递归处理嵌套命名空间）
    Object instance = subclass.make()
        .load(Thread.currentThread().getContextClassLoader())
        .getLoaded().newInstance();
    for (Entry<String, Object> entry : udfMap.entrySet()) {
        instance.getClass().getField(entry.getKey())
            .set(instance, compileUdf(name + "$" + capitalize(entry.getKey()), entry.getValue()));
    }
    return instance;
}
```

对于 `sys.scene.eval` 这样的三层命名空间，ByteBuddy 会生成如下类层次：

```
UDF$Sys            (class, field: scene)
  └── UDF$Sys$Scene    (class, field: eval)
        └── UdfDelegate  (实际的函数代理对象)
```

Nashorn 引擎通过属性访问 `sys.scene.eval(...)` 时，会依次访问 `UDF$Sys` 实例的 `scene` 字段 → `UDF$Sys$Scene` 实例的 `eval` 字段 → 得到 `UdfDelegate` → 调用其 `apply()` 方法。整个过程对 JS 表达式编写者完全透明。

### 6.4 动态 JAR 加载：插件化 UDF

`SpringUdfLoader` 支持在运行时从外部加载 JAR 文件，实现插件化的 UDF 扩展：

```java
protected void loadBeans(File file) {
    // 1. 创建隔离的 ClassLoader
    ClassLoader classLoader = new URLClassLoader(
        new URL[]{classPathToURL(file.getAbsolutePath())}, originClassLoader);

    // 2. 创建独立的 Spring 容器（父容器为主应用容器）
    AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext(...);
    context.setClassLoader(classLoader);
    context.setParent(originContext);

    // 3. 扫描自动配置类（读取 META-INF/spring.factories）
    String[] configurations = getConfigurations(classLoader);
    for (String config : configurations) {
        context.register(classLoader.loadClass(config));
    }

    // 4. 刷新容器，完成 Bean 初始化
    context.refresh();
    this.fileOfContext.put(file, context);
}
```

这里的关键设计是**容器隔离 + 父子关系**：每个 JAR 有独立的 `ClassLoader` 和 `ApplicationContext`，但以主应用容器为父容器——这意味着 JAR 中的 UDF 可以注入主应用的 Bean（如 RPC 客户端），但不会污染主应用的 Bean 空间。

卸载时（`unloadBeans`）需要做 **Spring 缓存清理**：关闭子容器、清理 `AbstractAutoProxyCreator` 的代理缓存、清理 Krpc 的引用缓存、清理 gRPC transport。这些清理工作是防止 ClassLoader 泄漏的关键——如果不清理，被卸载的类仍会被缓存引用，导致 ClassLoader 无法被 GC。

---

## 7. 事件驱动体系

Mousika 的事件体系覆盖了规则生命周期的三个阶段：**解析时、执行时、变更时**。

### 7.1 引擎内事件：观察者模式

`RuleEvent` 是引擎内部的轻量事件对象：

```java
public class RuleEvent {
    private EventType eventType;  // PARSE_SUCCEED / PARSE_FAIL / EVAL_SUCCEED / EVAL_FAIL
    private String ruleExpr;      // 规则表达式或规则 ID
    private Object data;          // 成功时为 EvalResult / RuleNode，失败时为 Exception
    private long cost;            // 耗时（毫秒）
}
```

`ListenerProvider` 实现了经典的**观察者模式**——它自身既是 `RuleListener`，也是监听器注册中心。所有引擎内事件通过 `ListenerProvider.DEFAULT`（全局静态单例）扇出到所有注册的监听器。

事件触发的时机精确定义在两个位置：

| 触发位置 | 事件类型 | 设计意图 |
|---------|---------|---------|
| `NodeBuilder.build()` | `PARSE_SUCCEED` / `PARSE_FAIL` | 监控规则表达式的解析成功率和耗时 |
| `RuleContextImpl.doEval()` | `EVAL_SUCCEED` / `EVAL_FAIL` | 监控每条规则的执行成功率、耗时和异常 |

### 7.2 内置监听器

**RuleEvalLogListener**：日志和错误监控的基础。`EVAL_FAIL` 和 `PARSE_FAIL` 时上报 `ad.mousika.rule.error` 指标，便于配置报警。

**RuleEvalElapsedListener**：性能监控的基础。记录每条规则的执行耗时，按 pass / fail / error 三种状态分维度上报 `ad.mousika.rule.elapsed` 指标。当某条规则突然变慢（比如依赖的外部服务超时），可以通过这个指标快速定位。

### 7.3 规则变更事件（MQ 驱动热加载）

规则热加载是 Mousika 的核心能力之一。变更通知通过 **RocketMQ 广播**推送：

```
BRMS 保存规则
    │
    ▼
发布消息到 ad_infra_mousika_rule_info_notify_topic（广播模式）
    │
    ▼
AbstractNotifyConsumer 接收通知
    │  提取变更的 sceneKey，放入内部队列
    ▼
定时调度器批量处理队列中的变更
    │
    ▼
RuleLoader.loadSuite()
    │  从数据库 / 中心服务重新加载所有规则
    ▼
new RuleSuite(definitions, udfs, scenes)
    │  构造新的 RuleSuite 实例
    ▼
RuleSuite.current = newSuite  (volatile 引用替换)
```

热加载的线程安全依赖两个机制：

1. **`volatile` 引用替换**：`RuleSuite.current` 是 `volatile` 的，新实例构造完成后直接替换引用。正在执行的请求仍持有旧实例的引用（Java GC 的引用计数保证旧实例不会被提前回收），新请求使用新实例。这是一种**无锁的 Copy-on-Write** 策略。

2. **双重保障**：MQ 通知实现秒级生效，`RuleSuiteRefreshTask` 每 5 分钟定时全量刷新作为兜底——防止 MQ 消息丢失或消费失败导致的规则不一致。

### 7.4 执行审计事件（Kafka + ES）

在中心化 RPC 模式下，每次规则执行的完整上下文会**异步写入 Kafka**（Topic: `ad_mousika_eval_info_topic`）。这条数据链支撑了三个下游场景：

```
规则执行
    │
    ├──→ Kafka (ad_mousika_eval_info_topic)
    │         │
    │         ├──→ EvalCompareService (灰度对比)
    │         │    对比 activeRule 和 candidateRule 的执行结果差异
    │         │    发现不一致时生成验证报告
    │         │
    │         └──→ 数据分析平台 (离线分析)
    │
    └──→ ElasticSearch (实时写入)
              │
              └──→ BRMS 在线调试
                   输入 Fact JSON → 查看执行详情 → 定位规则问题
```

灰度验证的机制是：每个 `RuleScene` 除了 `activeRule`（线上生效的规则集），还可以挂载 `candidateRules`（候选规则集）。执行时，活跃规则集在主线程执行返回结果，候选规则集在独立线程池异步执行，两组结果写入 Kafka 后由 `EvalCompareService` 对比——这使得规则变更可以在不影响线上的前提下提前验证。

---

## 8. 执行结果与可解释性

### 8.1 结果类型层次

规则引擎不仅要给出"通过/不通过"的结论，还要能解释**为什么**。Mousika 的结果体系是一棵与 AST 对应的结果树：

```
NodeResult                          -- 规则集执行结果
  ├── expr: String                  -- 完整规则集表达式
  ├── nodeType: NodeType            -- 根节点类型
  ├── result: Object                -- 原始返回值
  └── details: List<RuleResult>     -- 详细结果树
        └── RuleResult              -- 单条规则结果
              ├── expr: String      -- 规则 ID
              ├── result: Object    -- JS 引擎返回的原始值
              ├── matched: boolean  -- 匹配结果
              ├── desc: String      -- 动态描述（如 "广告主 张三 行业不合规"）
              ├── nodeType          -- 节点类型
              └── subRules: List<RuleResult>  -- 子规则结果（递归）
```

### 8.2 布尔类型转换策略

JS 引擎的返回值类型不确定，Mousika 通过 `EvalResult.parseBoolean()` 做智能转换：

```java
private boolean parseBoolean(Object res) {
    if (res == null)             return false;
    if (res instanceof Boolean)  return (Boolean) res;
    if (res instanceof Number)   return ((Number) res).floatValue() > 0;
    if (res instanceof String)   return ((String) res).toLowerCase().matches("yes|true|1");
    if (res instanceof UdfPredicate) return ((UdfPredicate) res).test();
    return res != null;  // 非 null 对象默认为 true
}
```

`UdfPredicate` 接口是一个扩展点——UDF 可以返回一个实现了 `UdfPredicate` 的对象，通过自定义的 `test()` 方法决定布尔语义。这允许 UDF 返回"富结果"（携带额外数据），同时仍能作为布尔条件参与 AST 的逻辑判断。

### 8.3 描述动态插值的实现原理

规则描述支持 `{$.field}` 语法引用 Fact 字段。`evalRuleDesc()` 通过正则替换将模板转换为 JS 字符串拼接表达式，然后复用 JS 引擎求值：

```
输入模板:  "代理商【{$.agentId}】不允许【{$.customerId}】跨开"
正则替换:  "代理商【"+$.agentId+"】不允许【"+$.customerId+"】跨开"
JS 求值:   "代理商【10086】不允许【20001】跨开"
```

这个设计复用了引擎已有的 JS 执行能力，零额外依赖。

---

## 9. 平台能力：可视化编排、动态调试与归因分析

规则引擎的核心能力在于执行，但一个能**落地生产**的规则平台，还需要回答三个问题：运营人员如何配置规则？配置错了怎么验证？线上规则命中异常时如何定位原因？Mousika 的 BRMS（Business Rule Management System）平台围绕这三个问题，构建了可视化编排、动态调试和归因分析三大前端能力。

### 9.1 可视化规则编排：从流程图到 AST

运营人员不写代码，他们需要的是"画流程图"——在画布上拖拽节点、连接边线，所见即所得。Mousika 的 BRMS 提供了三代 UI 编排方案，逐步演进：

| 版本 | 实现类 | UI 形态 | 适用场景 |
|------|--------|---------|---------|
| v1.0 规则树 | `TreeNode` | 树形嵌套面板 | 简单条件分支（if-else 嵌套） |
| v2.0 流程图 | `GraphNode` | 有向图（节点 + 有向边） | 复杂条件链（多级分支 + 环检测） |
| v3.0 流程图 | `GraphNodeV2` | 结构化流程图（语义化节点类型） | 全场景覆盖（串/并行网关、排他分支、复合条件） |

#### 核心设计：UI 节点到 AST 节点的双向映射

三代方案共享同一个核心接口 `UiConfig`——前后端传输协议：

```java
public interface UiConfig {
    RuleNode toRule();           // UI 配置 → 引擎可执行的 AST
    void valid();                // 配置合法性校验
    Set<Long> collectRuleIds();  // 收集引用的规则 ID 集合
}
```

这个接口是**整个平台能力的锚点**：无论前端用什么形态展示规则（树、图、画布），后端只关心一件事——它能否转换为合法的 `RuleNode` AST。

#### v3.0 流程图的节点类型体系

`GraphNodeV2` 是当前主力方案，它定义了 9 种语义化节点类型，每种节点对应一种 AST 结构：

```
┌──────────────────────────────────────────────────────────────────┐
│                   GraphNodeV2 节点类型体系                        │
│                                                                  │
│  start (EntryNode)          ── 流程入口，委托给子节点              │
│  condition (ConditionNode)  ── 条件分支 → CaseNode               │
│  action (ActionNode)        ── 动作执行 → ExprNode / SerNode     │
│  and (LogicAndNode)         ── 逻辑与 → AndNode                  │
│  or (LogicOrNode)           ── 逻辑或 → OrNode                   │
│  serial (SerialGatewayNode) ── 串行网关 → SerNode                │
│  parallel (ParallelGatewayNode) ── 并行网关 → ParNode            │
│  exclusive (ExclusiveNode)  ── 排他网关 → 嵌套 CaseNode 链        │
│  complexCondition (ComplexConditionNode) ── 复合条件（And/Or 组合）│
└──────────────────────────────────────────────────────────────────┘
```

每种 UI 节点通过 `toRule()` 方法递归生成对应的 AST 节点。以 `ConditionNode` 为例：

```java
public RuleNode toRule() {
    ExprNode exprNode = new ExprNode(String.valueOf(ruleId));
    RuleNode ruleNode = negative ? new NotNode(exprNode) : exprNode;

    // 无出度分支 → 纯条件节点
    if (getTrueCase() == null && getFalseCase() == null) {
        return ruleNode;
    }
    // 有分支 → CaseNode（条件 + true 分支 + false 分支）
    return new CaseNode(ruleNode, getTrueCase().toRule(),
            getFalseCase() == null ? null : getFalseCase().toRule());
}
```

`ExclusiveNode`（排他网关）的转换最为巧妙——它将多个互斥条件分支**从后向前折叠**为嵌套的 `CaseNode` 链：

```java
// ExclusiveNode.toRule() — 排他网关的递归折叠
// 输入: [条件A → 动作1, 条件B → 动作2, 条件C → 动作3] + 默认动作D
// 输出: A ? 动作1 : (B ? 动作2 : (C ? 动作3 : D))

while (CollectionUtils.isNotEmpty(ruleNodes)) {
    CaseNode lastCaseNode = (CaseNode) ruleNodes.removeLast();
    if (isHandleLastCondition && defaultNode != null) {
        caseNode = new CaseNode(lastCaseNode.getCondition(),
            lastCaseNode.getTrueCase(), defaultNode.toRule());
        isHandleLastCondition = false;
    } else {
        caseNode = new CaseNode(lastCaseNode.getCondition(),
            lastCaseNode.getTrueCase(), caseNode);
    }
}
```

这意味着运营人员在画布上看到的是"排他网关"（类似 BPMN 中的 XOR Gateway），但引擎实际执行的是嵌套的三元表达式——**视觉语义与执行语义的分离**。

#### JSON 双向序列化与草稿机制

`GraphNodeV2` 通过 Jackson 的 `@JsonTypeInfo` + `@JsonTypeIdResolver` 实现多态 JSON 序列化。每个节点携带 `nodeType` 字段用于反序列化时的类型路由，前后端通过同一份 JSON 结构进行数据交换。

```java
@JsonTypeInfo(use = Id.CUSTOM, property = "nodeType")
@JsonTypeIdResolver(GraphNodeV2NodeTypeResolver.class)
public interface Node {
    String getNodeType();
    RuleNode toRule();
    List<Long> ruleIdList();
}
```

`GraphNodeV2` 还支持**草稿模式**（`isDraft = true`）：运营人员可以保存未完成的流程图配置而不触发 AST 转换和校验——这对于复杂规则集的渐进式编排至关重要。同时，`feUiConfig` 字段存储前端画布的布局信息（节点坐标、连线路径等），确保再次打开时视觉布局不丢失。

#### v2.0 流程图：有向图 + 环检测

`GraphNode`（v2.0）采用经典的有向图模型——节点列表 + 有向边列表：

```java
public class GraphNode implements UiConfig {
    private Map<String, Node> nodeMap;           // 节点集合
    private Map<String, List<Edge>> outComingEdgeMap; // 出边映射

    public RuleNode toRule() {
        String firstNodeId = outComingEdgeMap.get(startNodeId).get(0).getTarget().getId();
        return toRule(firstNodeId, outComingEdgeMap, nodeMap);  // 递归遍历有向图生成 AST
    }
}
```

`valid()` 方法执行三项校验：**单入口检查**（确保只有一个起始节点）、**条件完整性检查**（每个条件节点必须有两条出边）、**环路检测**（DFS + 回溯，防止循环依赖导致执行死循环）。

### 9.2 动态调试：实时验证规则逻辑

规则配置完成后，运营人员需要在发布前验证逻辑正确性。Mousika 提供了两层调试能力：

#### 在线调试（规则集级别）

`RuleDebugController` 暴露 `/api/brms/rule/debug/call` 接口，接受 Fact JSON 和规则集 ID / 规则表达式，**直接调用引擎 RPC 服务**执行并返回完整结果：

```java
public String call(CallParam param) {
    String ruleExpr = param.getExpr();
    if (debugType == DebugTypeEnum.RULE_SET) {
        // 从数据库读取规则集配置
        RuleSetRecord record = ruleSetDao.queryById(Long.parseLong(param.getExpr()));
        ruleExpr = record.getConfig();
    }
    // 构造 gRPC 请求，调用引擎 evalByRuleExpr
    RuleExprRequest request = RuleExprRequest.newBuilder()
        .setRuleExpr(ruleExpr).setRawFact(param.getRequest()).build();
    EvalResponse response = ruleEngineService.evalByRuleExpr(request);
    return ObjectMapperUtils.toJSON(response);
}
```

调试支持两种粒度：**单条规则**（`DebugTypeEnum.RULE`）和**规则集**（`DebugTypeEnum.RULE_SET`）。规则集调试时，先从数据库读取完整的规则集表达式，再提交给引擎执行——确保调试结果与线上一致。

#### 实时表达式调试（未保存的规则）

`/api/brms/rule/debug/execRuleExpr` 接口支持对**尚未保存**的规则表达式进行实时调试——运营人员在编辑器中修改了 JS 表达式后，无需保存即可立即验证：

```java
public String exeRuleExpr(ExeParam exeParam) {
    RuleEngine ruleEngine = new RuleEngine();  // 独立引擎实例，不影响线上
    Object result = ruleEngine.evalExpr(
        exeParam.getRuleExpr(),
        ObjectMapperUtils.fromJson(exeParam.getRequest()),
        new Object()
    );
    return Objects.isNull(result) ? "" : ObjectMapperUtils.toJSON(result);
}
```

注意这里创建了一个全新的 `RuleEngine` 实例——与线上引擎完全隔离，避免调试数据污染生产环境。

#### 智能参数模板生成

调试的痛点之一是构造测试入参。`genRequestModel()` 方法自动分析规则集引用的所有变量（通过正则 `\$[.a-zA-Z_0-9]+` 提取），并生成一个带默认值的 JSON 模板：

```java
// 1. 从规则集中收集所有规则 ID
// 2. 查询规则定义，提取 JS 表达式中的变量引用（如 $.advertiser.industry）
// 3. 按路径层级构建嵌套 JSON 结构
// 4. 通过 Protobuf 反射自动填充默认值

private Object computeDefaultValue(String variablePath) {
    RuleEngine ruleEngine = new RuleEngine();
    for (Object message : pbInstances) {
        Object o = ruleEngine.evalExpr(variablePath, message, new Object());
        if (o != null) return o;
    }
    return "";  // 兜底空字符串
}
```

Mousika 通过类路径扫描加载所有 Protobuf Message 类，构造默认实例，然后用 JS 引擎实际执行变量路径来获取默认值类型——这比静态类型推断更准确，因为它**直接复用了引擎的求值逻辑**。

#### 测试用例与执行路径断言

BRMS 还支持创建持久化的**测试用例**（`RuleSetTestCaseDetail`），每个用例包含：

```java
public class RuleSetTestCaseDetail {
    private String buildSceneConfig;          // 场景构建配置
    private String buildSceneValue;           // 场景参数值
    private String buildRequestParam;         // Fact 入参
    private String expectedExecutionPath;     // 期望执行路径
}
```

`expectedExecutionPath` 是核心字段——它记录了**期望的规则执行路径**（如 `1269->1242->1246`），在回归测试时，系统会将实际执行路径与期望路径对比，发现不一致则标记测试失败。这使得规则变更的影响范围可以通过自动化测试提前发现。

### 9.3 归因分析：从"不通过"到"为什么不通过"

规则引擎最常见的运营诉求是："这条数据为什么被拦截了？"Mousika 的归因分析体系基于**执行树到结果树的转换**，提供从宏观到微观的逐层下钻能力。

#### 执行树 → 结果树的转换

第 5.4 节介绍了 `DefaultNodeVisitor` 在执行过程中构建的 `EvalNode` 执行树。`RuleContextImpl` 将这棵执行树**转换为面向展示的 `RuleResult` 结果树**：

```java
private RuleResult transform(EvalNode node) {
    String expr = node.getExpr();
    EvalResult result = evalCache.get(expr);
    // 动态插值生成人类可读的描述文案
    RuleResult ruleResult = new RuleResult(result, evalDesc(expr), node.getNodeType());
    // 递归转换子节点
    for (EvalNode subNode : node.getChildren()) {
        ruleResult.getSubRules().add(transform(subNode));
    }
    return ruleResult;
}
```

转换过程做了两件关键的事：
1. **关联 evalCache**：从缓存中取出每个节点的实际执行结果（`EvalResult`），包括原始返回值和布尔判定
2. **动态描述插值**：调用 `evalDesc()` 将规则描述模板中的 `{$.field}` 替换为实际的 Fact 字段值，生成如 "广告主【张三】行业【游戏】不合规" 这样的人类可读文案

最终的 `NodeResult` 是一棵**与 AST 同构的结果树**，每个节点都携带了表达式、执行结果、动态描述和子节点列表。

#### 深度遍历：叶子节点的扁平化视图

对于需要快速定位具体命中/未命中规则的场景，`getEvalResults()` 提供了执行树的扁平化视图——只展示叶子节点（`ExprNode`），跳过中间的编排节点：

```java
private void deepTraverse(List<EvalNode> evalNodes, List<NodeResult> nodeResults) {
    for (EvalNode evalNode : evalNodes) {
        if (evalNode.getChildren().size() == 0) {
            // 叶子节点：直接构造 NodeResult
            EvalResult evalResult = evalCache.get(evalNode.getExpr());
            if (Objects.isNull(evalResult)) continue;  // 跳过未完成执行的节点
            RuleResult ruleResult = new RuleResult(evalResult, evalDesc(expr), ...);
            nodeResults.add(new NodeResult(ruleResult.getExpr(), ...));
        } else {
            // 非叶子节点：递归向下
            deepTraverse(evalNode.getChildren(), nodeResults);
        }
    }
}
```

这为前端提供了两种展示模式：**树形归因**（完整的决策路径）和**列表归因**（直接看哪些具体规则通过/未通过）。

#### 验证对比：多规则集横向分析

`ValidationDetail` 支持**同一份 Fact 数据在多个规则集上的横向对比**：

```java
public class ValidationDetail {
    private String bizPrimaryKey;                     // 业务主键
    private List<ValidationResult> validationResults; // 多个规则集的执行结果

    public static class ValidationResult {
        private long ruleSetId;  // 规则集 ID
        private String result;   // 执行结果
        private String desc;     // 结果描述
    }
}
```

运营人员可以选择多个规则集版本（如"当前线上版本"和"待发布版本"），对同一批业务数据进行批量验证，对比结果差异。结果支持**导出 Excel**——`toExcelRow()` 方法将每条数据的多规则集结果格式化为表格行，便于线下分析和审批。

这与第 7 章介绍的灰度验证机制（`candidateRules`）形成互补：灰度验证是**线上流量的自动对比**，验证对比是**指定数据的手动对比**——两者共同保障了规则变更的安全性。

### 9.4 执行路径渲染：从 EvalNode 到可视化

执行路径渲染将规则的实际执行过程"叠加"到规则编排的流程图上，让运营人员直观地看到"数据在规则图中走了哪条路"。

其技术链路是：

```
Fact 数据 ──→ 引擎执行 ──→ EvalNode 执行树 ──→ NodeResult 结果树
                                                    │
    ┌───────────────────────────────────────────────┘
    │
    ▼
前端流程图 ──→ 遍历结果树 ──→ 标记每个节点的状态（通过/未通过/未执行）
              │
              ├── 通过的节点：绿色高亮
              ├── 未通过的节点：红色高亮
              ├── 未执行的分支（NaResult）：灰色
              └── 点击节点 → 展开规则描述 + 原始返回值
```

关键是 `NaResult` 的设计价值在这里得到了充分体现：传统的 true/false 二态无法区分"规则执行结果为 false"和"规则因条件分支未被评估"。`CaseNode` 引入的三态返回使得前端可以精确地将未执行的分支渲染为灰色（Not Applicable），而非误导性地标记为"未通过"。

#### 完整的数据流闭环

从数据写入到归因展示，完整的数据流形成了一个闭环：

```
┌────────────────────────────────────────────────────────────────────┐
│                         数据流闭环                                  │
│                                                                    │
│  配置阶段:  画布编排 ──→ GraphNodeV2 JSON ──→ toRule() ──→ AST     │
│                                                                    │
│  执行阶段:  Fact + AST ──→ DefaultNodeVisitor ──→ EvalNode 执行树   │
│            │                                       │               │
│            └── evalCache（幂等缓存）                └── RuleResult  │
│                                                         结果树     │
│                                                         │          │
│  展示阶段:  结果树 ──→ 叠加到流程图 ──→ 路径高亮 + 节点描述          │
│            │                                                       │
│            ├── 树形归因（递归展开完整决策路径）                       │
│            ├── 列表归因（叶子节点扁平化）                            │
│            └── 横向对比（多版本验证 + Excel 导出）                   │
└────────────────────────────────────────────────────────────────────┘
```

这个闭环的核心设计原则是**同构映射**：配置时的 UI 节点、执行时的 AST 节点、追踪时的 EvalNode、展示时的 RuleResult——四棵树结构一一对应。正是这种同构性，使得从"画规则"到"看结果"的全链路可以自然贯通，而不需要在任何环节做复杂的结构转换。

---

## 10. 设计权衡与工程总结

### 10.1 关键设计决策

| 决策 | 选择 | 权衡 |
|------|------|------|
| 规则表达式执行 | **AST + JS 引擎分层** | AST 保证编排逻辑的类型安全和可控性；JS 引擎提供单条规则求值的灵活性。代价是 Nashorn 在 JDK 11+ 被标记 deprecated |
| UDF 注册表 → JS 可访问对象 | **ByteBuddy 动态生成类** | 让 JS 能以 `sys.scene.eval()` 的属性链方式调用 UDF。代价是动态生成类增加了调试复杂度和 Metaspace 占用 |
| 规则热加载 | **volatile 引用替换（Copy-on-Write）** | 无锁、无停顿。代价是短暂的内存双份（新旧 RuleSuite 共存直到旧实例被 GC） |
| 执行结果追踪 | **ThreadLocal + 栈帧模拟** | 不侵入 AST 节点的执行逻辑。代价是 ParNode 中需要手动处理 ThreadLocal 迁移 |
| 类型转换 | **JSON 作为中间格式** | JS ↔ Java 几乎任意类型可互通。代价是序列化/反序列化的性能开销 |
| 插件 JAR 卸载 | **显式清理 Spring 缓存** | 防止 ClassLoader 泄漏。代价是需要知道 Spring / Krpc 内部的缓存字段（反射访问私有字段） |

### 10.2 架构模式总结

回顾整个 Mousika 的设计，可以提炼出几个核心的架构模式：

1. **DSL + Interpreter 模式**：规则编排语言通过 ANTLR4 解析为 AST，每个节点自解释执行。扩展新操作符只需添加新的 `RuleNode` 实现。

2. **Visitor 模式（变体）**：执行时通过 `context.visit(node)` 间接调用，而非直接 `node.eval(context)`。这个间接层让 `DefaultNodeVisitor` 可以在不修改节点代码的前提下记录执行树。

3. **观察者模式**：`ListenerProvider` 聚合所有 `RuleListener`，引擎在关键路径上触发事件。可观测性（监控、日志、审计）全部通过事件驱动实现，不侵入核心执行逻辑。

4. **Copy-on-Write**：`RuleSuite` 的热加载通过构造新实例 + `volatile` 引用替换实现，正在执行的请求不受影响。

5. **统一抽象**：决策表、复合规则、外部 RPC 调用——所有扩展功能都被归约到 UDF 机制，引擎内核始终只处理"JS 表达式求值"这一件事。

这些模式共同构成了一个**稳定内核 + 灵活扩展**的架构——引擎核心代码量不大（`mousika-core` 约 30 个类），但通过 UDF、事件监听器、规则热加载的扩展点，支撑起了整个业务体系的规则管理需求。
