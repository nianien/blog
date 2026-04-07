---
title: "Mousika 规则引擎：让规则可编排、可执行、可解释"
description: "基于 Mousika 规则引擎的实际代码和生产数据，解析 DSL 编排与 JS 求值的分层设计、四棵同构树如何贯穿从可视化配置到归因分析的全链路、万物皆 UDF 的统一扩展机制，以及性能优化、安全机制和高可用保障的工程实践。"
pubDate: 2026-02-17
tags: ["规则引擎", "DSL", "可视化编排"]
author: "skyfalling"
---

> 规则引擎真正的工程挑战不在执行本身，而在于如何让运营人员在画布上配置的东西、引擎实际执行的东西、出了问题后用来排查的东西，始终是"同一棵树"的不同表达。做到这一点，可编排、可执行、可解释就不再是三个独立的问题。
>
> 本文围绕 Mousika 规则引擎平台，沿着规则从配置到执行到归因的数据流，拆解它在每一层做了什么设计决策、以及为什么这么做。

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

![传统方式 vs 规则引擎方式](/images/blog/mousika-rule-engine/01-traditional-vs-engine.svg)

但仅仅把规则从代码里剥离出来并不够。规则一旦变得复杂——包含条件分支、并行判断、跨场景引用——就需要一套专用的编排语言来表达它们之间的组合关系；规则要在线上秒级生效，就需要一套无锁的热加载机制；规则出了问题，运营需要知道"这条数据为什么被拦了"，就需要执行过程本身可追溯、可归因。Mousika 在这几个方向上做了系统性的设计，后文会逐层展开。

### 1.3 为什么自研而非选型

业界已有多个规则引擎方案，但各有其适用边界：

| 方案 | 定位 | 优势 | 局限 |
|---|---|---|---|
| **Drools** | 业务规则管理系统 | 功能全面，社区成熟 | 接入成本高，DSL 学习曲线陡，规则复杂后可读性差 |
| **LiteFlow** | 轻量级规则/流程引擎 | 接入简单，支持多种配置格式 | 配置不灵活，问题排查不方便，复杂场景可读性差 |
| **URule** | 可视化商业决策引擎 | 多款可视化编辑器（决策表、评分卡、决策树） | 每款编辑器针对单一场景，不适合复杂多变的业务组合 |

Mousika 的设计目标是综合以上方案的优势并规避其局限：**可视化编排**保证可读性和低门槛（非开发人员也能配置规则），**DSL + JS 分层**保证灵活性和可扩展性，**平台化**提供从编辑、测试、发布到运维的一站式能力。

---

## 2. 整体架构

### 2.1 模块全景

Mousika 采用多模块 Maven 工程组织，各模块职责明确：

| 模块 | 职责 |
|------|------|
| `mousika-core` | 规则引擎内核：解析、执行、结果分析（约 30 个类） |
| `mousika-udf-sdk` / `mousika-udf` | UDF 定义 SDK + 内置系统 UDF（场景调用、RPC 调用等） |
| `mousika-runtime-base` | 运行时公共组件：监听器、转换器、ES 写入 |
| `mousika-rpc` | 中心化 RPC 服务（gRPC/Krpc） |
| `mousika-brms` | 规则管理平台后端（Web UI） |
| `mousika-sdk` | 业务方调用 SDK（Fact 定义 + RPC 接口） |
| `mousika-local-runtime-sdk` | 去中心化本地运行时 SDK |
| `mousika-consumer` | Kafka 消费者（执行结果对比验证） |

核心依赖栈：**ANTLR4**（规则语法解析）、**Nashorn**（JS 表达式执行）、**ByteBuddy**（动态类生成）、**Krpc/gRPC**（RPC 通信）、**jOOQ**（数据库访问）、**Kafka/RocketMQ**（消息驱动）。

### 2.2 分层架构

从数据流视角，Mousika 的架构分为四层，每一层都有明确的职责边界：

![四层架构](/images/blog/mousika-rule-engine/02-four-layer-architecture.svg)

**为什么分四层而不是两层？** 关键的设计洞察在于：规则的"编排"和"求值"是两个不同性质的问题。编排（AST 层）处理的是节点之间的逻辑关系（与或非、条件分支、串并行），这是一个树遍历问题；求值（引擎层）处理的是单条规则表达式的计算，这是一个脚本执行问题。将两者分离，使得编排逻辑可以用类型安全的 Java AST 实现，而求值逻辑可以利用 JS 引擎的灵活性——各取所长。

### 2.3 双模部署

Mousika 支持两种部署模式，业务方根据延迟敏感度和运维复杂度选型：

| 模式 | 实现模块 | 规则加载方式 | 特点 |
|------|---------|------------|------|
| **中心化 RPC** | `mousika-rpc` | 从数据库直接加载 | 统一部署，规则集中管理，有网络开销 |
| **去中心化 SDK** | `mousika-local-runtime-sdk` | 从中心服务拉取 | 引擎嵌入业务进程，零网络延迟 |

两种模式共享同一个 `mousika-core` 内核。去中心化模式的核心权衡是：**用内存换延迟，用复杂度换自主性**——每个业务进程持有一份规则副本，消除了 RPC 调用开销，但需要自行处理规则同步和版本一致性。

两种模式下 `RuleSuite` 均为进程内全局单例（`volatile` 引用），不同业务场景通过 `RuleScene` 隔离。当多个业务线共享同一实例时，`ParNode` 的并行执行线程池是全局共享的——高优先级场景可以通过去中心化模式独立部署来获得资源隔离。

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

它们之间的关系构成了两棵树——**配置树**（从 UI 节点到 RuleNode AST）和**执行树**（运行时的 EvalNode 追踪树）。但 Mousika 实际上有**四棵结构同构的树**贯穿全链路：运营人员在画布上编排的 **UI Node**，经过解析生成的 **AST RuleNode**，执行过程中构建的 **EvalNode**（第 5.4 节），以及面向展示的 **RuleResult**（第 8.3 节）。这四棵树节点一一对应、结构一致——正是这种同构性，使得规则从"画出来"到"跑起来"再到"解释清楚"不需要任何结构转换。

![配置树 vs 执行树](/images/blog/mousika-rule-engine/03-config-vs-exec-tree.svg)

---

## 4. 规则表达式与 AST 解析

### 4.1 DSL 设计：为什么不直接用 JS

一个自然的问题是：既然底层已经用了 Nashorn JS 引擎，为什么不直接让用户写 JS？

答案是 **关注点分离**。用户需要表达的是规则之间的编排关系（"先执行 A，如果通过再执行 B 和 C"），而不是通用编程逻辑。Mousika 设计了一套领域专用语言（DSL），专门用于规则编排：

| 操作符 | 语义 | 节点类型 | 执行语义 |
|-------|------|---------|---------|
| `&&` | 逻辑与 | `AndNode` | **短路求值**：任一子节点为 false 立即返回 |
| `\|\|` | 逻辑或 | `OrNode` | **短路求值**：任一子节点为 true 立即返回 |
| `!` | 逻辑非 | `NotNode` | 对子节点结果取反 |
| `?:` | 条件分支 | `CaseNode` | **惰性求值**：只执行匹配的分支，未执行分支返回 `NaResult` |
| `->` | 串行执行 | `SerNode` | **全量执行**：按顺序执行所有子节点，取最后一个结果 |
| `=>` | 并行执行 | `ParNode` | **并发执行**：线程池并发，任一为 true 则整体为 true |
| `limit(l,h,...)` | 范围匹配 | `LimitNode` | 命中数在 `[l, h]` 区间内为 true |

这套 DSL 与 JS 的关系是：**DSL 负责"编排"（哪些规则按什么逻辑组合），JS 负责"求值"（单条规则怎么计算）**。两者在不同抽象层次工作。

一条实际的规则表达式：

```
1269->((1242||1243)?1246:(1241?1244:1245))
```

在配置平台上渲染为可视化流程图，运营人员通过拖拽节点和连线即可生成这种表达式——他们不需要理解语法。

### 4.2 ANTLR4 解析流程

规则表达式的解析由 `NodeBuilder` 驱动，内部使用 ANTLR4 完成从文本到 AST 的转换。选择 ANTLR4 而非手写 Recursive Descent Parser 的原因是：语法可能随业务演化（如后来添加了 `limit` 和 `=>` 操作符），ANTLR4 的 grammar 文件易于扩展。

解析分为四步：

![ANTLR4 解析流程](/images/blog/mousika-rule-engine/04-antlr4-parsing-flow.svg)

`NodeBuilder` 对解析结果做了缓存（`ConcurrentHashMap`），同一表达式只解析一次：

```java
public static RuleNode build(String expr) {
    return nodeCache.computeIfAbsent(expr, ruleExpr -> {
        RuleNode node = Antlr4Parser.parse(ruleExpr, defaultGenerator);
        ListenerProvider.DEFAULT.onParse(
            new RuleEvent(EventType.PARSE_SUCCEED, ruleExpr, node, cost));
        return node;
    });
}
```

### 4.3 复合规则的递归解析与环检测

普通规则的叶子节点（`ExprNode`）直接引用一个规则 ID。但 Mousika 还支持**复合规则**（`useType=2`）——一条规则的表达式本身是另一个规则集的编排。这意味着解析时需要递归展开。

`NodeGenerator` 处理了这个递归，并通过 **Stack 做环检测**，防止 A → B → A 的循环依赖：

```java
private RuleNode parseRecursively(String expr, Stack<String> resolved) {
    if (compositeRules.containsKey(expr)) {
        resolved.push(expr);
        try {
            return new CompositeNode(expr,
                NodeParser.parse(compositeRules.get(expr), s -> {
                    if (resolved.contains(s))
                        throw new IllegalStateException(
                            "circular dependency between [" + expr + "] and [" + s + "]");
                    return parseRecursively(s, resolved);
                }));
        } finally {
            resolved.pop();
        }
    }
    return new ExprNode(expr);
}
```

这本质上是一个**带回溯的深度优先搜索**：`Stack<String> resolved` 维护当前解析路径，如果即将解析的节点已经在路径上，说明存在环依赖，立即抛出异常。

### 4.4 RuleNode 接口与 Interpreter 模式

所有节点实现 `RuleNode` 接口，核心方法只有三个：

```java
public interface RuleNode {
    EvalResult eval(RuleContext context);
    String expr();
    NodeType ruleNodeType();

    // Builder 风格的链式组合
    default RuleNode and(RuleNode node)  { return new AndNode(this, node); }
    default RuleNode or(RuleNode node)   { return new OrNode(this, node); }
    default RuleNode not()               { return new NotNode(this); }
    default RuleNode next(RuleNode node) { return new SerNode(this, node); }
}
```

这个设计有两个值得注意的地方。

**Interpreter 模式**：每个节点自己负责自己的执行逻辑（`eval` 方法），而不是由一个集中的解释器遍历 AST。添加新节点类型只需要实现接口，不需要修改任何已有代码。

**Builder 风格的 default 方法**：AST 可以通过编程方式动态构建（`ruleA.and(ruleB).or(ruleC)`），而不仅限于从表达式解析生成。

### 4.5 关键节点实现

#### 短路求值与 Visitor 间接层

`AndNode` 的短路求值实现简洁——遍历子节点，一旦遇到 false 立即返回：

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

`CaseNode` 是最能体现 Mousika 表达力的节点。传统的三元运算符只有 true/false 两种结果，但 Mousika 引入了第三种状态——`NaResult`（Not Applicable）：

```java
public EvalResult eval(RuleContext context) {
    boolean succeed = context.visit(condition).isMatched();
    RuleNode branch = succeed ? trueCase : falseCase;
    if (branch != null) {
        EvalResult result = context.visit(branch);
        return new EvalResult(expr(), result.getResult(), result.isMatched(), ruleNodeType());
    }
    return new EvalResult(expr(), NaResult.DEFAULT, ruleNodeType());
}
```

当分支为 `null` 时返回 `NaResult`——表示"该分支未被执行"。这在归因分析中至关重要：它允许下游精确区分"规则执行结果为 false"和"规则根本未被评估"（第 8.4 节会看到这个设计价值的充分体现）。

#### SerNode 与 ParNode：两种执行语义

`SerNode`（`->`）按顺序执行所有子节点，**取最后一个节点的结果**。前面的节点视为"前置动作"，可以通过 `$$`（上下文 Map）为后续节点准备数据。

`ParNode`（`=>`）将子节点提交到线程池并发执行，结果聚合策略是**任一为 true 则整体为 true**。`ParNode` 中最复杂的部分是 ThreadLocal 上下文的迁移——`DefaultNodeVisitor` 使用 `ThreadLocal<EvalNode>` 追踪当前执行位置，在并行场景下，每个工作线程需要创建独立的执行树根节点，完成后再将子节点合并回主线程的执行树：

```java
public EvalResult eval(RuleContext context) {
    RuleContextImpl ruleContext = (RuleContextImpl) context;
    ThreadLocal<EvalNode> currentEval = ruleContext.getCurrentEval();
    EvalNode stashEvalNode = currentEval.get();  // 暂存主线程执行节点

    CountDownLatch latch = new CountDownLatch(nodes.size());
    for (RuleNode node : nodes) {
        executor.execute(() -> {
            try {
                EvalNode root = new EvalNode(null, ruleNodeType());
                currentEval.set(root);  // 每个线程独立的执行树根
                EvalResult result = context.visit(node);
                stashEvalNode.getChildren().addAll(root.getChildren());  // 合并回主线程
                vector.add(result);
            } finally {
                currentEval.set(null);
                latch.countDown();
            }
        });
    }
    currentEval.set(stashEvalNode);
    latch.await(timeout, TimeUnit.MILLISECONDS);
    // ...聚合结果
}
```

使用 `Vector`（线程安全）收集结果，`EvalNode.children` 也使用 `Vector` 以保证并发写入安全。

#### LimitNode：范围匹配

`LimitNode` 表达的语义是"N 个规则中命中了 M 个，M 是否在 [low, high] 范围内"（`high = -1` 表示无上限）。这实现了类似"至少满足 2 个条件中的 1 个"或"恰好满足 3 个条件中的 2 个"这样的投票逻辑，为业务规则提供了灵活的组合能力。执行时会在命中数超过上限时提前终止，避免不必要的计算。

---

## 5. 执行引擎

### 5.1 RuleEngine：JS 脚本编译与缓存

`RuleEngine` 是单条规则的执行核心，基于 **Nashorn JavaScript 引擎**。选择 JS 引擎而非自研表达式求值器的原因是：JS 天然支持属性链访问（`$.advertiser.industry`）、运算符、字符串操作等，省去了大量的解析和执行逻辑开发。

几个关键的设计细节：

**预编译 + 缓存**：JS 表达式通过 `Compilable.compile()` 预编译为 `CompiledScript`，后续执行直接调用 `compiledScript.eval(bindings)`。编译结果按表达式文本做 key 缓存在 `ConcurrentHashMap` 中，避免重复解析。

**Bindings 隔离**：每次执行都创建独立的 `Bindings`，避免线程间状态污染。三种绑定注入：`$`（Fact 数据对象）、`$$`（执行上下文 Map）、UDF 函数（命名空间对象）。

```java
private Object doEval(CompiledScript script, Object root, Object context) {
    Bindings bindings = engine.createBindings();
    bindings.putAll(udfContainer.compileUdf());  // UDF 函数
    bindings.put("$", root);                      // Fact 数据
    bindings.put("$$", context);                   // 上下文 Map
    Object result = script.eval(bindings);
    return ScriptUtils.convertIntoJavaObject(result);
}
```

**内置规则**：`true`、`false`、`null`、`nop` 是预注册的规则 ID。`null` 和 `nop` 返回 `NaResult.DEFAULT`（通过 Nashorn 的 `Java.type()` 引用 Java 类），用于在 CaseNode 中表示"不执行"。

### 5.2 规则描述的动态插值

每条规则可以配置两个描述文案（分别对应通过/不通过时展示），支持 `{$.field}` 语法引用 Fact 对象字段。`evalRuleDesc()` 方法通过正则替换将模板转换为 JS 字符串拼接表达式，然后复用 JS 引擎执行：

```java
// 正则替换: {$.agentId} → "+$.agentId+"
// 最终拼接为 JS 表达式: "代理商【"+$.agentId+"】不允许跨开"
originDesc = "\"" + originDesc.replaceAll("\\{(\\$+\\..+?)\\}", "\\\"+$1+\\\"") + "\"";
return (String) evalExpr(originDesc, root, context);
```

巧妙之处在于**复用了 JS 引擎的求值能力**来做模板渲染——不需要引入额外的模板引擎，`$` 绑定在 Bindings 中天然可用。

### 5.3 RuleContextImpl：三位一体的执行上下文

`RuleContextImpl` 是整个执行流程的核心协调者，它的类定义本身就揭示了多重身份：

```java
public class RuleContextImpl extends LinkedHashMap<String, Object> implements RuleContext
```

**继承 `LinkedHashMap`**：自身就是上下文 Map，以 `$$` 的身份暴露给 JS 引擎。规则执行过程中可以通过 `$$.put("key", value)` 在规则之间传递状态——这是 `SerNode` 能够实现"前置动作准备数据，后续规则使用数据"模式的基础。

**实现 `RuleContext`**：同时承担 Visitor 协调和规则执行两个职责。`evalCache` 使用 `ConcurrentSkipListMap` 实现——有序且线程安全。当同一个规则 ID 在 AST 中被多个分支引用时，只会执行一次，后续直接返回缓存结果。这不仅是性能优化，更保证了**规则执行的幂等性**。

### 5.4 DefaultNodeVisitor：构建第三棵同构树

第 3 章提到 Mousika 有四棵结构同构的树，前两棵（UI Node → AST RuleNode）在配置和解析阶段产生。第三棵——**EvalNode 执行树**——在这里诞生。`DefaultNodeVisitor` 在每次 `visit()` 调用时构建一棵与 AST 平行的执行树，记录了"实际执行了哪些节点，每个节点的结果是什么"，是后续归因分析的基础。

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
        ((RuleContextImpl) ruleContext).getEvalCache().put(node.expr(), result);
        currentEval.set(currentEval.get().getParent());  // 回溯到父节点
    }
    return result;
}
```

区分 ExprNode 和复合节点是关键：`ExprNode`（叶子节点）直接挂到当前节点下；复合节点则需要"进入"——将 `currentEval` 指向自己，子节点会被正确地挂到它下面，执行完成后"回溯"到父节点。这本质上是一个**基于 ThreadLocal 的栈帧模拟**，用来在扁平的 `visit()` 调用序列中重建树形结构。

### 5.5 规则类型与决策表

Mousika 通过 `RuleDefinition.useType` 支持三种规则类型：普通规则（`useType=0`，JS 表达式直接注册）、决策表（`useType=1`，**转换为 UDF** 复用引擎执行）、复合规则（`useType=2`，递归解析为 `CompositeNode`）。

决策表的处理体现了 Mousika 的统一抽象能力——不引入新的执行机制，而是将决策表 JSON 转换为 `RuleTableUdf` 函数，修改规则表达式为 `udf_rule_table_$ID($)` 的 UDF 调用形式。`RuleTableUdf` 接收 Fact 对象，遍历表格每一行检查所有列条件是否匹配——本质上是一个多维度 AND 匹配器。

### 5.6 异常处理策略

规则执行中的异常处理遵循**快速失败 + 事件通知**原则。`RuleContextImpl.doEval()` 在单条规则执行失败时会捕获异常，将该规则的执行结果标记为 `false`（即异常等同于"未通过"），同时通过 `ListenerProvider` 触发 `EVAL_FAIL` 事件，上报 `ad.mousika.rule.error` 指标。这意味着在短路求值场景中，`AndNode` 的某个子节点抛异常会被当作 `false` 处理，触发短路直接返回，后续节点不再执行；`OrNode` 则会跳过异常节点继续尝试后续分支。

这个设计的权衡是：**牺牲了异常的精确传播，换取了引擎的容错性**——一条规则的 JS 表达式出错不会导致整个规则集执行中断，但可能导致误判。因此 `EVAL_FAIL` 事件的监控报警配置至关重要。

---

## 6. UDF 扩展机制

UDF（User Defined Function）是 Mousika 的能力扩展基座。决策表、外部 RPC 调用、跨场景规则引用——这些看似不同的功能，全部通过 UDF 机制统一实现。

### 6.1 注册与调用

UDF 通过 `@Udf` 注解声明分组和名称（如 `@Udf(value = "eval", group = "sys.scene")`），配合 `Functions.FunctionN` 函数式接口定义参数签名。JS 引擎中以属性链方式调用：`sys.scene.eval(sceneKey, $, $$)`。

### 6.2 UdfDelegate：反射代理与自动类型转换

JS 引擎调用 Java UDF 时，参数类型是 JS 对象（Nashorn 的内部类型），需要转换为 Java 类型。`UdfDelegate` 通过**反射 + JSON 序列化**实现透明的类型桥接：先尝试将 JS 对象转为 Java 对象（`ScriptUtils.convertIntoJavaObject`），如果类型不匹配，则序列化为 JSON 字符串再反序列化为目标类型。这种 **JSON 作为中间格式** 的做法虽然有性能开销，但保证了 JS 与 Java 之间几乎任意类型都能互通。

### 6.3 UdfContainer：ByteBuddy 动态类生成

UDF 在 JS 引擎中以属性链方式访问（如 `sys.scene.eval(...)`），但 Nashorn 的 `Bindings` 只支持扁平的 key-value。`UdfContainer` 使用 **ByteBuddy 在运行时动态生成 Java 类**，将嵌套的 UDF 注册表转换为嵌套的 Java 对象：

```java
private static Object compileUdf(String name, Object udf) {
    if (!(udf instanceof HashMap)) return udf;
    Map<String, Object> udfMap = (Map<String, Object>) udf;
    // ByteBuddy 动态生成类，为每个 key 创建 public 字段
    Builder<Object> subclass = new ByteBuddy()
        .subclass(Object.class).name(name);
    for (Entry<String, Object> entry : udfMap.entrySet()) {
        subclass = subclass.defineField(entry.getKey(), Object.class, Visibility.PUBLIC);
    }
    Object instance = subclass.make()
        .load(Thread.currentThread().getContextClassLoader())
        .getLoaded().newInstance();
    // 递归处理嵌套命名空间并赋值
    for (Entry<String, Object> entry : udfMap.entrySet()) {
        instance.getClass().getField(entry.getKey())
            .set(instance, compileUdf(name + "$" + capitalize(entry.getKey()), entry.getValue()));
    }
    return instance;
}
```

对于 `sys.scene.eval` 这样的三层命名空间，ByteBuddy 会生成 `UDF$Sys` → `UDF$Sys$Scene` → `UdfDelegate` 的类层次。Nashorn 引擎通过属性访问依次解引用，最终调用 `UdfDelegate.apply()`。整个过程对 JS 表达式编写者完全透明。

### 6.4 动态 JAR 加载：插件化 UDF

`SpringUdfLoader` 支持在运行时从外部加载 JAR 文件，实现插件化的 UDF 扩展。关键设计是**容器隔离 + 父子关系**：每个 JAR 有独立的 `URLClassLoader` 和 `ApplicationContext`，但以主应用容器为父容器——JAR 中的 UDF 可以注入主应用的 Bean（如 RPC 客户端），但不会污染主应用的 Bean 空间。

卸载时需要做 Spring 缓存清理：关闭子容器、清理 `AbstractAutoProxyCreator` 的代理缓存、清理 Krpc 的引用缓存、清理 gRPC transport。这些清理工作是防止 ClassLoader 泄漏的关键——如果不清理，被卸载的类仍会被缓存引用，导致 ClassLoader 无法被 GC，最终耗尽 Metaspace。

---

## 7. 事件驱动体系

UDF 和规则都支持运行时热更新，这就需要一套事件机制来协调变更的传播、执行的追踪和审计的记录。Mousika 的事件体系覆盖了规则生命周期的三个阶段：**解析时、执行时、变更时**。

### 7.1 引擎内事件：观察者模式

`ListenerProvider` 实现了经典的观察者模式——它自身既是 `RuleListener`，也是监听器注册中心。所有引擎内事件通过 `ListenerProvider.DEFAULT`（全局静态单例）扇出到所有注册的监听器。事件触发精确定义在两个位置：`NodeBuilder.build()` 触发解析事件（`PARSE_SUCCEED` / `PARSE_FAIL`），`RuleContextImpl.doEval()` 触发执行事件（`EVAL_SUCCEED` / `EVAL_FAIL`）。

内置监听器包括：`RuleEvalLogListener`（`EVAL_FAIL` 和 `PARSE_FAIL` 时上报错误指标）和 `RuleEvalElapsedListener`（按 pass / fail / error 三种状态分维度上报耗时指标，用于快速定位某条规则突然变慢的问题）。

### 7.2 规则变更事件（MQ 驱动热加载）

规则热加载是 Mousika 的核心能力之一。变更通知通过 **RocketMQ 广播**推送：

![规则变更热加载流程](/images/blog/mousika-rule-engine/05-hot-reload-flow.svg)

热加载的线程安全依赖两个机制。**`volatile` 引用替换**：`RuleSuite.current` 是 `volatile` 的，新实例构造完成后直接替换引用。正在执行的请求仍持有旧实例的引用（旧实例在执行线程的栈帧中仍然可达，GC 不会回收），新请求使用新实例——这是一种无锁的 Copy-on-Write 策略。**双重保障**：MQ 通知实现秒级生效，`RuleSuiteRefreshTask` 每 5 分钟定时全量刷新作为兜底，防止 MQ 消息丢失导致的规则不一致。

### 7.3 执行审计事件（Kafka + ES）

在中心化 RPC 模式下，每次规则执行的完整上下文会异步写入 Kafka（Topic: `ad_mousika_eval_info_topic`）。这条数据链支撑了三个下游场景：

![执行审计数据流](/images/blog/mousika-rule-engine/06-audit-data-flow.svg)

灰度验证的机制值得展开：每个 `RuleScene` 除了 `activeRule`（线上生效的规则集），还可以挂载 `candidateRules`（候选规则集）。执行时，活跃规则集在主线程执行返回结果，候选规则集在独立线程池异步执行，两组结果写入 Kafka 后由 `EvalCompareService` 对比——这使得规则变更可以在不影响线上的前提下提前验证。

---

## 8. 平台能力与可解释性

到目前为止，文章沿着数据流讲完了规则的解析、执行、扩展和运行时事件。但对于运营人员来说，他们面对的不是 AST 和 JS 引擎，而是三个具体问题：怎么配置规则、怎么验证配置对不对、线上出问题了怎么定位原因。这一章从平台视角出发，看 Mousika 如何在配置侧（可视化编排、调试）和输出侧（归因分析、路径渲染）形成闭环——这也是第四棵同构树（RuleResult）最终登场的地方。

### 8.1 可视化规则编排：从流程图到 AST

运营人员不写代码，他们需要的是"画流程图"——在画布上拖拽节点、连接边线，所见即所得。Mousika 的 BRMS 经历了三代 UI 编排方案演进：v1.0 `TreeNode`（树形嵌套面板，适用于简单 if-else）、v2.0 `GraphNode`（有向图 + 环检测，支持复杂条件链）、v3.0 `GraphNodeV2`（结构化流程图，全场景覆盖）。三代方案共享同一个核心接口 `UiConfig`：

```java
public interface UiConfig {
    RuleNode toRule();           // UI 配置 → 引擎可执行的 AST
    void valid();                // 配置合法性校验
    Set<Long> collectRuleIds();  // 收集引用的规则 ID
}
```

这个接口是整个平台能力的锚点：无论前端用什么形态展示规则，后端只关心一件事——它能否转换为合法的 `RuleNode` AST。

#### v3.0 流程图：语义化节点体系

`GraphNodeV2` 是当前主力方案，定义了 9 种语义化节点类型，每种对应一种 AST 结构：

![GraphNodeV2 节点类型体系](/images/blog/mousika-rule-engine/07-graphnodev2-types.svg)

每种 UI 节点通过 `toRule()` 方法递归生成对应的 AST 节点。`ExclusiveNode`（排他网关）的转换最为巧妙——它将多个互斥条件分支**从后向前折叠**为嵌套的 `CaseNode` 链：

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

#### JSON 序列化与草稿机制

`GraphNodeV2` 通过 Jackson 的 `@JsonTypeInfo` + `@JsonTypeIdResolver` 实现多态 JSON 序列化，前后端通过同一份 JSON 结构进行数据交换。还支持**草稿模式**（`isDraft = true`）：运营人员可以保存未完成的流程图配置而不触发 AST 转换和校验——这对于复杂规则集的渐进式编排至关重要。`feUiConfig` 字段存储前端画布的布局信息（节点坐标、连线路径等），确保再次打开时视觉布局不丢失。

### 8.2 动态调试：实时验证规则逻辑

规则配置完成后，运营人员需要在发布前验证逻辑正确性。Mousika 提供了三层调试能力：

| 调试层级 | 接口 | 特点 |
|---------|------|------|
| 规则集级别 | `/api/brms/rule/debug/call` | 从数据库读取规则集配置，调用引擎 RPC 服务执行，确保与线上一致 |
| 实时表达式 | `/api/brms/rule/debug/execRuleExpr` | 对尚未保存的规则表达式进行实时调试，创建独立引擎实例不影响线上 |
| 参数模板生成 | `genRequestModel()` | 自动分析规则引用的变量，通过 Protobuf 反射生成带默认值的 JSON 模板 |

实时表达式调试有一个关键细节：它创建了一个全新的 `RuleEngine` 实例——与线上引擎完全隔离，避免调试数据污染生产环境。

参数模板生成通过类路径扫描加载所有 Protobuf Message 类，构造默认实例，然后用 JS 引擎实际执行变量路径来获取默认值类型——比静态类型推断更准确，因为它**直接复用了引擎的求值逻辑**。

BRMS 还支持持久化的**测试用例**，每个用例包含场景参数、Fact 入参和**期望执行路径**（如 `1269->1242->1246`）。回归测试时，系统将实际执行路径与期望路径对比，发现不一致则标记失败——使得规则变更的影响范围可以通过自动化测试提前发现。

### 8.3 归因分析：第四棵同构树

规则引擎最常见的运营诉求是："这条数据为什么被拦截了？"回答这个问题需要完成四棵同构树的最后一环——将第 5.4 节中 `DefaultNodeVisitor` 构建的 EvalNode 执行树，转换为面向展示的 **RuleResult 结果树**。

#### 结果类型层次

`RuleResult` 是面向展示的递归结构，每个节点携带规则 ID、原始返回值、布尔判定、动态描述（如"广告主【张三】行业【游戏】不合规"）和子规则列表。`RuleContextImpl` 将 EvalNode 执行树转换为 RuleResult 结果树时做两件关键的事：**关联 evalCache**（取出每个节点的实际执行结果）和**动态描述插值**（将规则描述模板中的 `{$.field}` 替换为实际值）。

```java
private RuleResult transform(EvalNode node) {
    EvalResult result = evalCache.get(node.getExpr());
    RuleResult ruleResult = new RuleResult(result, evalDesc(node.getExpr()), node.getNodeType());
    for (EvalNode subNode : node.getChildren()) {
        ruleResult.getSubRules().add(transform(subNode));
    }
    return ruleResult;
}
```

最终的 RuleResult 是一棵与 AST 同构的结果树。为前端提供了两种展示模式：**树形归因**（完整的决策路径）和**列表归因**（通过 `deepTraverse` 只展示叶子节点，直接看哪些具体规则通过/未通过）。

#### 布尔类型转换

JS 引擎的返回值类型不确定，`EvalResult.parseBoolean()` 做智能转换：`null` → false，`Boolean` 直接取值，`Number` 大于 0 为 true，`String` 匹配 `yes|true|1` 为 true，`UdfPredicate` 调用自定义 `test()` 方法。`UdfPredicate` 接口是一个扩展点——UDF 可以返回"富结果"（携带额外数据），同时仍能作为布尔条件参与 AST 的逻辑判断。

#### 验证对比：多规则集横向分析

`ValidationDetail` 支持**同一份 Fact 数据在多个规则集上的横向对比**。运营人员可以选择多个规则集版本（如"当前线上版本"和"待发布版本"），对同一批业务数据进行批量验证，结果支持导出 Excel。这与第 7.3 节的灰度验证机制形成互补：灰度验证是**线上流量的自动对比**，验证对比是**指定数据的手动对比**——两者共同保障了规则变更的安全性。

### 8.4 执行路径渲染：NaResult 的价值兑现

执行路径渲染将规则的实际执行过程"叠加"到规则编排的流程图上，让运营人员直观地看到"数据在规则图中走了哪条路"。

![执行路径渲染](/images/blog/mousika-rule-engine/08-execution-path-rendering.svg)

第 4.4 节中 `CaseNode` 引入的三态返回在这里得到了充分体现：传统的 true/false 二态无法区分"规则执行结果为 false"和"规则因条件分支未被评估"。`NaResult` 使得前端可以精确地将未执行的分支渲染为灰色（Not Applicable），而非误导性地标记为"未通过"。

#### 完整的数据流闭环

从数据写入到归因展示，完整的数据流形成了一个闭环：

![数据流闭环](/images/blog/mousika-rule-engine/09-data-flow-loop.svg)

这个闭环的核心设计原则回到了四棵同构树：配置时的 UI 节点、执行时的 AST 节点、追踪时的 EvalNode、展示时的 RuleResult——四棵树结构一一对应。正是这种同构性，使得从"画规则"到"看结果"的全链路可以自然贯通，而不需要在任何环节做复杂的结构转换。

---

## 9. 设计权衡与工程总结

### 9.1 关键设计决策

| 决策 | 选择 | 权衡 |
|------|------|------|
| 规则表达式执行 | **AST + JS 引擎分层** | AST 保证编排逻辑的类型安全；JS 引擎提供求值灵活性。代价是 Nashorn 在 JDK 11+ deprecated |
| UDF 注册表 → JS 可访问对象 | **ByteBuddy 动态生成类** | JS 以属性链调用 UDF。代价是调试复杂度和 Metaspace 占用 |
| 规则热加载 | **volatile 引用替换（CoW）** | 无锁、无停顿。代价是短暂的内存双份 |
| 执行结果追踪 | **ThreadLocal + 栈帧模拟** | 不侵入 AST 节点。代价是 ParNode 中需手动处理 ThreadLocal 迁移 |
| 类型转换 | **JSON 作为中间格式** | JS ↔ Java 几乎任意类型可互通。代价是序列化性能开销 |
| 插件 JAR 卸载 | **显式清理 Spring 缓存** | 防止 ClassLoader 泄漏。代价是需要反射访问 Spring / Krpc 内部缓存字段 |

### 9.2 Nashorn 的现状与迁移路径

Nashorn 在 JDK 11 中被标记为 deprecated，JDK 15 正式移除。Mousika 早期通过引入 `org.openjdk.nashorn:nashorn-core` 独立依赖继续使用，后续已完成向 GraalJS（GraalVM 的 JavaScript 实现）的迁移。GraalJS 兼容 Nashorn 的大部分 API（`ScriptEngine` / `Bindings` / `Compilable`），迁移的主要工作量集中在 `Java.type()` 等 Nashorn 特有 API 的适配和 UDF 类型桥接层的调整。迁移完成后执行性能提升约 6 倍（得益于 GraalJS 的 JIT 编译优化）。

### 9.3 架构模式总结

回顾整个 Mousika 的设计，可以提炼出几个核心的架构模式：

**DSL + Interpreter 模式**：规则编排语言通过 ANTLR4 解析为 AST，每个节点自解释执行。扩展新操作符只需添加新的 `RuleNode` 实现。

**Visitor 模式（变体）**：执行时通过 `context.visit(node)` 间接调用，而非直接 `node.eval(context)`。这个间接层让 `DefaultNodeVisitor` 可以在不修改节点代码的前提下记录执行树。

**观察者模式**：`ListenerProvider` 聚合所有 `RuleListener`，引擎在关键路径上触发事件。可观测性全部通过事件驱动实现，不侵入核心执行逻辑。

**Copy-on-Write**：`RuleSuite` 的热加载通过构造新实例 + `volatile` 引用替换实现，正在执行的请求不受影响。

**统一抽象**：决策表、复合规则、外部 RPC 调用——所有扩展功能都被归约到 UDF 机制，引擎内核始终只处理"JS 表达式求值"这一件事。

这些模式共同构成了一个**稳定内核 + 灵活扩展**的架构——引擎核心代码量不大（`mousika-core` 约 30 个类），但通过 UDF、事件监听器、规则热加载的扩展点，支撑起了整个业务体系的规则管理需求。

---

## 10. 性能特征

规则引擎在生产环境中是请求链路的关键节点，性能直接影响业务 RT。以下是 Mousika 在实际生产环境中的性能数据。

### 10.1 执行引擎性能

| 指标 | 数值 | 说明 |
|---|---|---|
| **P99 延迟** | 200ms | 生产环境全量请求的 P99 |
| **1200 QPS 下的平均 RT** | 20ms | 中心化部署模式 |
| **日均请求量** | 80 万+ | 场景级请求（单次请求触发一个规则集） |
| **日均规则执行量** | 1200 万+ | 单次请求内多条规则的展开执行 |
| **线上故障** | 0 | 上线以来无 P0/P1 故障 |

### 10.2 关键性能优化手段

| 优化手段 | 原理 | 效果 |
|---|---|---|
| **预编译** | 规则和编排在加载时完成 AST 解析和 JS 编译，请求时直接执行 | 消除运行时解析开销 |
| **中间结果缓存** | `ConcurrentSkipListMap` 缓存同一请求内已执行规则的结果 | 避免重复规则的重复执行 |
| **重复规则复用** | 跨场景引用的规则只执行一次，结果共享 | 规则复用率约 11 倍 |
| **GraalJS 迁移** | 从 Nashorn 迁移到 GraalJS | 执行性能提升约 6 倍 |
| **去中心化模式** | 规则引擎嵌入业务进程，执行过程无 RPC 开销 | RT 降低至个位数毫秒 |

### 10.3 可视化编辑器性能

| 节点规模 | 渲染时间 | 说明 |
|---|---|---|
| 300 节点 | < 0.06s | 覆盖大部分业务场景（平均节点数 80） |
| 2,000 节点 | < 0.193s | 可流畅编辑 |
| 8,000 节点 | < 1s | 极端复杂场景 |
| 80,000 节点 | 可渲染 | 理论上限，非典型场景 |

---

## 11. 安全机制

规则引擎允许用户通过 UDF 上传自定义代码（JS 或 Java），安全性是必须正面解决的问题。

### 11.1 代码执行安全

| 安全层 | 机制 | 说明 |
|---|---|---|
| **类加载隔离** | 自定义 `URLClassLoader`，每个 JAR 插件使用独立的 ClassLoader | 防止插件之间的类冲突，限制可加载的类范围 |
| **Spring 父子容器** | 插件运行在子容器中，与宿主应用容器隔离 | 防止插件访问宿主的 Bean，避免包冲突 |
| **安全检查** | UDF 代码上传时进行静态扫描，拦截危险操作（如文件 IO、网络调用、反射） | 防止恶意代码对系统产生影响 |
| **沙箱运行** | JS 引擎运行在受限环境中，不允许直接访问文件系统和网络 | 限制 UDF 的能力边界 |

### 11.2 数据安全与权限

| 安全维度 | 实现方式 |
|---|---|
| **多租户隔离** | 每个租户的规则、UDF、数据完全隔离，租户 ID 贯穿全链路校验 |
| **RBAC 鉴权** | 集成权限中台，支持多角色控制（管理员、开发者、运营、只读） |
| **SSO 登录** | 统一登录认证，防止未授权访问 |
| **OpenAPI 鉴权** | 外部系统通过 API 调用时需要 Token 鉴权 |
| **审批流程** | 规则发布支持自定义审批流，关键变更需审批通过后才能生效 |
| **操作审计** | 所有规则变更、UDF 上传、发布操作记录完整审计日志 |

---

## 12. 高可用与稳定性

### 12.1 稳定性保障体系

| 维度 | 措施 | 说明 |
|---|---|---|
| **异常监控** | 规则执行异常实时上报，按场景/规则/UDF 维度聚合 | 快速定位问题规则 |
| **性能监控** | 执行耗时按 P50/P99/P999 维度监控，支持按场景下钻 | 发现慢规则 |
| **服务限流** | 按租户/场景维度限流，防止单个场景打爆引擎 | 保护共享资源 |
| **服务熔断** | UDF 外部调用（RPC/HTTP）支持熔断，失败率超阈值自动降级 | 防止外部依赖拖垮引擎 |
| **弹性伸缩** | 中心化部署支持 HPA 自动扩缩容 | 应对流量波动 |
| **兼容性测试** | 规则变更发布前自动运行保存的测试用例 | 防止回归问题 |
| **流量回放** | 支持录制线上流量并回放到新版本规则集 | 验证变更安全性 |
| **小流量验证** | 规则集版本灰度发布，按百分比切换流量 | 降低变更风险 |

### 12.2 边界行为与异常处理

几个需要明确的边界 case 设计决策：

**ParNode 超时行为**：`CountDownLatch.await(timeout, ...)` 超时后，已完成的子节点结果保留，未完成的子节点结果标记为 `NaResult`（Not Applicable）。这意味着并行执行的结果是"尽力而为"——不会因为一个慢分支阻塞整个规则集，但调用方需要处理部分结果缺失的情况。

**缓存与幂等性**：`evalCache` 仅缓存同一次请求内的规则执行结果（请求级缓存，非跨请求缓存）。对于有副作用的 UDF（如 RPC 调用），调用方应在 UDF 实现中自行控制缓存策略，引擎层不对 UDF 的幂等性做假设。

**异常分类处理**：规则执行中的异常分为三类：
- **规则表达式错误**（语法错误、类型不匹配）：在规则加载阶段即被拦截，不会进入执行阶段
- **数据缺失**（Fact 中字段不存在）：映射为 `false`，这是符合业务语义的——"条件不满足时不执行"
- **外部调用错误**（UDF 中的 RPC 超时等）：映射为 `false` 并记录异常堆栈到 Trace，同时触发异常监控告警。对于需要重试的场景，应在 UDF 实现层处理，引擎层不做自动重试

**NaResult 的短路语义**：`OrNode` 遇到 `A || NaResult` 时，如果 A 为 true 则短路返回 true；如果 A 为 false，则继续尝试后续节点；如果所有节点都返回 NaResult，则 OrNode 自身返回 NaResult。`AndNode` 同理：任一节点为 false 则短路，NaResult 不触发短路但最终结果会是 NaResult（如果其他节点均为 true）。

---

## 13. 落地成果

### 13.1 接入规模

| 指标 | 数据 |
|---|---|
| **接入团队** | 商业化、主站、海外等多个事业部，8 个团队 |
| **业务场景** | 90+ |
| **沉淀规则** | 1400+ |
| **公有 UDF** | 28+ |
| **私有 UDF** | 160+ |
| **规则复用次数** | 约 11 倍（对不同场景规则重复使用次数的统计） |

### 13.2 降本增效

| 维度 | 效果 | 说明 |
|---|---|---|
| **沟通成本** | 节约约 1pd / 需求 | 业务规则可视化后一目了然，减少"这条规则到底是什么意思"的反复沟通 |
| **研发提效** | 50% | 部分需求不需要研发参与，运营自助配置规则 |
| **测试提效** | 30% | 回归测试范围收敛到变更的规则，不需要全量回归 |
| **Oncall 提效** | 每周节省约 2pd | 线上 Case 产运可通过执行路径自助排查，不需要研发介入 |

### 13.3 私有化部署

Mousika 支持私有化部署能力，配置端和引擎服务可以独立部署在客户自己的基础设施上。目前已支持国内和海外双配置端的部署模式，数据在物理层面完全隔离。

---

## 总结

回到开篇的问题：如何让配置的东西、执行的东西、排查的东西始终是"同一棵树"？答案就是贯穿全文的四棵同构树——UI Node、AST RuleNode、EvalNode、RuleResult 在每一层保持结构一致，使得规则引擎不只是一个执行器，而是一个让业务规则全生命周期可管理的平台。
