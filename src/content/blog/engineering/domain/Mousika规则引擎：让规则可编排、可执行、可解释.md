---
title: "Mousika 规则引擎：让规则可编排、可执行、可解释"
description: "基于 Mousika 规则引擎的实际代码与历史项目记录，解析 DSL 编排与 JS 求值的分层设计、配置与运行结果的关联方式，以及 UDF 扩展、规则热加载和归因调试的工程实践。"
pubDate: 2026-02-17
tags: ["规则引擎", "DSL", "可视化编排"]
author: "skyfalling"
---

> 规则引擎真正的工程挑战不在执行本身，而在于如何让运营人员在画布上配置的东西、引擎实际执行的东西、出了问题后用来排查的东西，能够对应到同一套业务语义。做到这一点，可编排、可执行、可解释就不再是三个独立的问题。
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

已定义能力范围内的规则变更，可以通过配置、测试和发布完成；新增业务能力则由研发扩展规则表达式或 UDF。

但仅仅把规则从代码里剥离出来并不够。规则一旦变得复杂——包含条件分支、并行判断、跨场景引用——就需要一套专用的编排语言来表达它们之间的组合关系；规则要在发布后及时生效，就需要变更通知和热加载机制；规则出了问题，运营需要知道"这条数据为什么被拦了"，就需要执行过程本身可追溯、可归因。Mousika 在这几个方向上做了系统性的设计，后文会逐层展开。

### 1.3 将配置、执行与排查放在同一条链路上

Mousika 的目标来自具体的协作需求：研发维护可复用的规则与 UDF，运营组合已经定义的能力，在发布前验证，在执行后查看命中路径。选择自研，是为了让领域模型、编排界面和归因结果围绕这些操作共同设计。

因此，文章关心的不只是表达式能否执行，还包括规则如何引用、变更如何生效、结果如何回到配置界面。

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

[![规则从接入、场景选择、AST 编排到 JS 与 UDF 求值的四层职责](/images/blog/mousika-rule-engine/02-four-layer-architecture.svg)](/images/blog/mousika-rule-engine/02-four-layer-architecture.svg)

**为什么分四层而不是两层？** 关键的设计洞察在于：规则的"编排"和"求值"是两个不同性质的问题。编排（AST 层）处理的是节点之间的逻辑关系（与或非、条件分支、串并行），这是一个树遍历问题；求值（引擎层）处理的是单条规则表达式的计算，这是一个脚本执行问题。将两者分离，使得编排逻辑可以用类型安全的 Java AST 实现，而求值逻辑可以利用 JS 引擎的灵活性——各取所长。

### 2.3 双模部署

Mousika 支持两种部署模式，业务方根据延迟敏感度和运维复杂度选型：

| 模式 | 实现模块 | 规则加载方式 | 特点 |
|------|---------|------------|------|
| **中心化 RPC** | `mousika-rpc` | 从数据库直接加载 | 统一部署，规则集中管理，有网络开销 |
| **去中心化 SDK** | `mousika-local-runtime-sdk` | 从中心服务拉取 | 引擎嵌入业务进程，省去调用引擎服务的网络往返 |

两种模式共享同一个 `mousika-core` 内核。去中心化模式的核心权衡是：**用内存换延迟，用复杂度换自主性**——每个业务进程持有一份规则副本，省去调用中心引擎的 RPC 开销，但需要处理规则同步和版本一致性；规则中的 UDF 仍可能访问远程服务。

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

它们之间的关系构成了两棵树——**配置树**（从 UI 节点到 RuleNode AST）和**执行树**（运行时的 EvalNode 追踪树）。但 Mousika 实际上有**四种相互关联的递归结构**贯穿全链路：运营人员在画布上编排的 **UI Node**，经过解析生成的 **AST RuleNode**，执行过程中构建的 **EvalNode**（第 5.4 节），以及面向展示的 **RuleResult**（第 8.3 节）。它们通过规则 ID、表达式和节点转换建立关联：一个 UI 网关可以展开为多个 AST 节点，短路又会使执行轨迹只包含实际访问的分支。可解释性的基础是业务语义的对应，而非形状完全相同。



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
| `?:` | 条件分支 | `CaseNode` | **惰性求值**：只执行选中分支；该分支不存在时 CaseNode 返回 `NaResult` |
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

解析从词法分析、语法分析进入语法树 Visitor，再生成可执行 AST：

[![编排 DSL 经过词法、语法分析与 Visitor 转换为 RuleNode AST](/images/blog/mousika-rule-engine/04-antlr4-parsing-flow.svg)](/images/blog/mousika-rule-engine/04-antlr4-parsing-flow.svg)

`NodeBuilder` 对解析结果做了缓存（`ConcurrentHashMap`），同一表达式可复用缓存节点。以下摘录省略计时变量与异常通知：

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

**Interpreter 模式**：每个节点自己负责自己的执行逻辑（`eval` 方法），而不是由一个集中的解释器遍历 AST。程序化扩展节点可从实现接口开始；要让 DSL 和 UI 识别它，还需补充语法、解析和界面映射。

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

#### CaseNode：选中分支与空分支

`CaseNode` 是最能体现 Mousika 表达力的节点。它先按条件选择分支，再返回该分支的原始结果和判定；选中的分支不存在时，返回无结果标记 `NaResult`：

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

这里的 `null` 指没有配置所选分支。另一条未选分支不会被访问，判断它没有执行需要结合配置与轨迹。`NaResult` 不是独立的布尔真值：此版本的 EvalResult 将这个非空对象判为 true。

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

`LimitNode` 表达的语义是"N 个规则中命中了 M 个，M 是否在 [low, high] 范围内"（`high = -1` 表示无上限）。这实现了类似"至少满足 2 个条件中的 1 个"或"恰好满足 3 个条件中的 2 个"这样的投票逻辑，为业务规则提供了灵活的组合能力。统计对象是直接子节点，嵌套复合条件整体算一项；当前实现仅在正数上限被超过时提前终止。

---

## 5. 执行引擎

### 5.1 RuleEngine：JS 脚本编译与缓存

`RuleEngine` 是单条规则的执行核心，基于 **Nashorn JavaScript 引擎**。选择 JS 引擎而非自研表达式求值器的原因是：JS 天然支持属性链访问（`$.advertiser.industry`）、运算符、字符串操作等，省去了大量的解析和执行逻辑开发。

几个关键的设计细节：

**按需编译 + 缓存**：注册规则保存源表达式，首次求值时通过 `Compilable.compile()` 预编译为 `CompiledScript`，后续执行直接调用 `compiledScript.eval(bindings)`。编译结果按表达式文本做 key 缓存在 `ConcurrentHashMap` 中，避免重复解析。

**独立绑定表**：每次求值创建独立的 `Bindings`；其中引用的 Fact、上下文与 UDF 对象仍可能被多个分支共享。三种绑定注入：`$`（Fact 数据对象）、`$$`（执行上下文 Map）、UDF 函数（命名空间对象）。

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

**内置规则**：`true`、`false`、`null`、`nop` 是预注册的规则 ID。`null` 和 `nop` 返回 `NaResult.DEFAULT`（通过 Nashorn 的 `Java.type()` 引用 Java 类），用于表示无结果；串并行节点还会跳过表达式名为 `nop` 的子节点。

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

**实现 `RuleContext`**：同时承担 Visitor 协调和规则执行两个职责。`evalCache` 使用 `ConcurrentSkipListMap` 实现——有序且线程安全。同一上下文中已缓存的规则结果可被后续引用复用。并发计算使用 `computeIfAbsent`，但该容器不保证映射函数只被调用一次；有副作用的 UDF 仍需自己的幂等控制，见 [ConcurrentSkipListMap 文档](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/ConcurrentSkipListMap.html#computeIfAbsent(K,java.util.function.Function))。

### 5.4 DefaultNodeVisitor：记录实际访问的节点

第 3 章提到 Mousika 有四种相互关联的递归结构，前两棵（UI Node → AST RuleNode）在配置和解析阶段产生。第三棵——**EvalNode 执行树**——在这里诞生。`DefaultNodeVisitor` 在每次 `visit()` 调用时向执行树加入当前访问的节点，记录了"实际执行了哪些节点，每个节点的结果是什么"，是后续归因分析的基础。

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

### 5.6 将执行错误与条件不满足分开

`RuleContextImpl.doEval()` 成功时发出 EVAL_SUCCEED，失败时发出 EVAL_FAIL，随后抛出带规则 ID 的 RuleEvalException。异常不会自动变成 false：串行求值中的错误会沿调用链向上传播，与/或节点也不会把异常当作普通条件结果继续计算。

这使排查能够区分两件事：业务数据未满足条件，以及规则根本没有正确算完。字段缺失是否抛错取决于表达式访问方式；远程 UDF 的超时、重试与降级也应按该函数的契约处理。

## 6. UDF 扩展机制

UDF（User Defined Function）是 Mousika 的能力扩展基座。决策表、外部 RPC 调用、跨场景规则引用——这些看似不同的功能，全部通过 UDF 机制统一实现。

### 6.1 注册与调用

UDF 通过 `@Udf` 注解声明分组和名称（如 `@Udf(value = "eval", group = "sys.scene")`），配合 `Functions.FunctionN` 函数式接口定义参数签名。JS 引擎中以属性链方式调用：`sys.scene.eval(sceneKey, $, $$)`。

### 6.2 UdfDelegate：反射代理与自动类型转换

JS 引擎调用 Java UDF 时，参数可能是 Nashorn 的内部对象，需要转换为 Java 类型。`UdfDelegate` 先尝试通过 `ScriptUtils.convertIntoJavaObject` 转换；类型不匹配时，再序列化为 JSON 并反序列化为目标类型。JSON 适合桥接兼容的值对象；需要保持精度、泛型结构或对象身份的类型，应单独约定调用契约。

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

变更消息通知运行服务重新加载配置，加载器构建新的 RuleSuite，再替换当前引用。

热加载的线程安全依赖两个机制。**`volatile` 引用替换**：`RuleSuite.current` 是 `volatile` 的，新实例构造完成后直接替换引用。正在执行的请求仍持有旧实例的引用（旧实例在执行线程的栈帧中仍然可达，GC 不会回收），新请求使用新实例——这是一种无锁的 Copy-on-Write 策略。**双重保障**：MQ 通知触发刷新，`RuleSuiteRefreshTask` 默认以 5 分钟 fixed delay 全量加载，减少遗漏通知后长期停留旧版本的情况；刷新失败仍需告警和重试处理。

### 7.3 执行审计事件（Kafka + ES）

在中心化 RPC 模式下，每次规则执行的完整上下文会异步写入 Kafka。这条数据链支撑了三个下游场景：

执行记录供规则结果对比、离线分析和在线归因查询使用。

灰度验证的机制值得展开：每个 `RuleScene` 除了 `activeRule`（线上生效的规则集），还可以挂载 `candidateRules`（候选规则集）。执行时，活跃规则集在主线程执行返回结果，候选规则集在独立线程池异步执行，两组结果写入 Kafka 后由 `EvalCompareService` 对比——这允许在不替换线上返回值的情况下比较结果；候选执行仍消耗资源，有外部副作用的 UDF 需要单独处理。

---

## 8. 平台能力与可解释性

到目前为止，文章沿着数据流讲完了规则的解析、执行、扩展和运行时事件。但对于运营人员来说，他们面对的不是 AST 和 JS 引擎，而是三个具体问题：怎么配置规则、怎么验证配置对不对、线上出问题了怎么定位原因。这一章从平台视角出发，看 Mousika 如何在配置侧（可视化编排、调试）和输出侧（归因分析、路径渲染）形成闭环——RuleResult 在这里把运行结果交给业务读者。

### 8.1 可视化规则编排：从流程图到 AST

运营人员不写代码，他们需要的是"画流程图"——在画布上拖拽节点、连接边线，所见即所得。Mousika 的 BRMS 经历了三代 UI 编排方案演进：v1.0 `TreeNode`（树形嵌套面板，适用于简单 if-else）、v2.0 `GraphNode`（有向图 + 环检测，支持复杂条件链）、v3.0 `GraphNodeV2`（结构化流程图，组合条件与动作）。三代方案共享同一个核心接口 `UiConfig`：

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

UI 条件节点可生成 ExprNode、NotNode 或 CaseNode；串行与并行网关分别生成 SerNode 与 ParNode，排他网关则展开为 CaseNode 链。UI 类型与 AST 类型不是一一对应关系。

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
| 规则集级别 | `/api/brms/rule/debug/call` | 从数据库读取规则集配置，调用引擎 RPC 服务执行，使用引擎服务入口，需选定相同版本与依赖 |
| 实时表达式 | `/api/brms/rule/debug/execRuleExpr` | 对尚未保存的规则表达式进行实时调试，创建独立引擎实例不影响线上 |
| 参数模板生成 | `genRequestModel()` | 自动分析规则引用的变量，通过 Protobuf 反射生成带默认值的 JSON 模板 |

实时表达式调试有一个关键细节：它创建了一个全新的 `RuleEngine` 实例——拥有独立的规则注册状态；若调试 UDF 会调用外部服务，仍需使用演示依赖或控制副作用。

参数模板生成通过类路径扫描加载所有 Protobuf Message 类，构造默认实例，然后用 JS 引擎实际执行变量路径来获取默认值类型——这样可复用引擎的属性访问方式，减少手工构造入参的工作；默认值仍需按业务场景补充。

BRMS 还支持持久化的**测试用例**，每个用例包含场景参数、Fact 入参和**期望执行路径**（如 `1269->1242->1246`）。回归测试时，系统将实际执行路径与期望路径对比，发现不一致则标记失败——使得规则变更的影响范围可以通过自动化测试提前发现。

### 8.3 归因分析：从执行轨迹生成结果树

规则引擎最常见的运营诉求是："这条数据为什么被拦截了？"回答这个问题需要完成从执行到解释的最后一步——将第 5.4 节中 `DefaultNodeVisitor` 构建的 EvalNode 执行树，转换为面向展示的 **RuleResult 结果树**。

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

最终的 RuleResult 按已记录的 EvalNode 层次组织，不包含完整 AST 的所有未执行分支。为前端提供了两种展示模式：**树形归因**（完整的决策路径）和**列表归因**（通过 `deepTraverse` 只展示叶子节点，直接看哪些具体规则通过/未通过）。

#### 布尔类型转换

JS 引擎的返回值类型不确定，`EvalResult.parseBoolean()` 做智能转换：`null` → false，`Boolean` 直接取值，`Number` 大于 0 为 true，`String` 匹配 `yes|true|1` 为 true，`UdfPredicate` 调用自定义 `test()` 方法。`UdfPredicate` 接口是一个扩展点——UDF 可以返回"富结果"（携带额外数据），同时仍能作为布尔条件参与 AST 的逻辑判断。

#### 验证对比：多规则集横向分析

`ValidationDetail` 支持**同一份 Fact 数据在多个规则集上的横向对比**。运营人员可以选择多个规则集版本（如"当前线上版本"和"待发布版本"），对同一批业务数据进行批量验证，结果支持导出 Excel。这与第 7.3 节的灰度验证机制形成互补：灰度验证是**线上流量的自动对比**，验证对比是**指定数据的手动对比**——两者共同保障了规则变更的安全性。

### 8.4 将运行结果映射回编排界面

归因展示同时读取配置和执行信息：配置说明有哪些分支，轨迹说明实际访问了哪些节点，结果说明已计算节点的返回值与判定。未选择或被短路跳过的分支，不应涂成“执行失败”；空分支的 NaResult 则按其无结果含义展示。

[![配置经 AST 执行后生成轨迹与结果，再关联回原流程](/images/blog/mousika-rule-engine/09-data-flow-loop.svg)](/images/blog/mousika-rule-engine/09-data-flow-loop.svg)

这条链路允许运营沿着同一个规则 ID 查看配置、执行和描述。UI 网关展开、复合规则引用和短路都可能改变结构，映射层负责保留它们的业务对应关系。

## 9. 设计权衡与工程总结

### 9.1 关键设计决策

| 决策 | 选择 | 权衡 |
|------|------|------|
| 规则表达式执行 | **AST + JS 引擎分层** | Java 节点定义组合语义，脚本表达单条规则，两层分别演进 |
| UDF 注册表 → JS 可访问对象 | **ByteBuddy 动态生成类** | JS 以属性链调用 UDF。代价是调试复杂度和 Metaspace 占用 |
| 规则热加载 | **volatile 引用替换（CoW）** | 请求读取已发布实例，后台构建新实例后替换引用；加载阶段仍有协调锁 |
| 执行结果追踪 | **ThreadLocal + 栈帧模拟** | 不侵入 AST 节点。代价是 ParNode 中需手动处理 ThreadLocal 迁移 |
| 类型转换 | **JSON 作为中间格式** | 适配兼容的值对象，类型与序列化成本按调用契约处理 |
| 插件 JAR 卸载 | **显式清理 Spring 缓存** | 防止 ClassLoader 泄漏。代价是需要反射访问 Spring / Krpc 内部缓存字段 |

### 9.2 计算引擎的演进

本文展示的是 Mousika 早期基于 JSR-223 与 Nashorn 的实现。Nashorn 在 JDK 11 被标记为待移除，JDK 15 从 JDK 中移除，见 [JEP 372](https://openjdk.org/jeps/372)。项目后续演进到 GraalJS；迁移需要适配引擎初始化、Java 对象访问与 UDF 类型桥接，既有编排语义可以继续保留。

历史项目记录给出 GraalJS 迁移后约 6 倍的性能改善。这是当时工作负载下的观察，缺少完整环境和原始测试记录时，不将它当作两种运行时的通用倍率。

### 9.3 架构模式总结

回顾整个 Mousika 的设计，可以提炼出几个核心的架构模式：

**DSL + Interpreter 模式**：规则编排语言通过 ANTLR4 解析为 AST，每个节点自解释执行。新节点在执行、DSL 解析和 UI 映射三个入口分别扩展。

**Visitor 模式（变体）**：执行时通过 `context.visit(node)` 间接调用，而非直接 `node.eval(context)`。这个间接层让 `DefaultNodeVisitor` 可以在不修改节点代码的前提下记录执行树。

**观察者模式**：`ListenerProvider` 聚合所有 `RuleListener`，引擎在关键路径上触发事件。监听器承接日志和指标，Visitor 承接执行轨迹，业务节点不必重复实现这些能力。

**Copy-on-Write**：`RuleSuite` 的热加载通过构造新实例 + `volatile` 引用替换实现，正在执行的请求不受影响。

**统一抽象**：决策表、复合规则、外部 RPC 调用——所有扩展功能都被归约到 UDF 机制，编排节点保持稳定，叶子表达式通过 UDF 接入业务能力。

这些模式共同构成了一个**稳定内核 + 灵活扩展**的架构——引擎核心代码量不大（`mousika-core` 约 30 个类），但通过 UDF、事件监听器、规则热加载的扩展点，支撑起了整个业务体系的规则管理需求。

---

## 10. 性能特征

规则引擎在生产环境中是请求链路的关键节点，性能直接影响业务 RT。以下保留作者提供的历史生产与前端测试记录，各项采集条件并不相同；它们用于描述项目当时的运行规模，不作为统一环境的基准测试。

### 10.1 执行引擎性能

| 指标 | 数值 | 说明 |
|---|---|---|
| **P99 延迟** | 200ms | 生产环境全量请求的 P99 |
| **1200 QPS 下的平均 RT** | 20ms | 中心化部署模式 |
| **日均请求量** | 80 万+ | 场景级请求（单次请求触发一个规则集） |
| **日均规则执行量** | 1200 万+ | 单次请求内多条规则的展开执行 |
| **线上故障** | 0 | 作者所述观察期内无 P0/P1 故障，观察区间未列明 |

### 10.2 关键性能优化手段

| 优化手段 | 原理 | 效果 |
|---|---|---|
| **预编译** | 编排提前解析，JS 首次求值编译后缓存 | 后续复用编译产物 |
| **中间结果缓存** | `ConcurrentSkipListMap` 缓存同一请求内已执行规则的结果 | 避免重复规则的重复执行 |
| **重复规则复用** | 规则定义由多个场景引用 | 配置复用不等于跨请求共享执行结果 |
| **GraalJS 迁移** | 从 Nashorn 迁移到 GraalJS | 执行性能提升约 6 倍 |
| **去中心化模式** | 规则引擎嵌入业务进程，省去调用中心引擎的 RPC 往返 | RT 降低至个位数毫秒 |

### 10.3 可视化编辑器性能

| 节点规模 | 渲染时间 | 说明 |
|---|---|---|
| 300 节点 | < 0.06s | 覆盖大部分业务场景（平均节点数 80） |
| 2,000 节点 | < 0.193s | 可流畅编辑 |
| 8,000 节点 | < 1s | 极端复杂场景 |
| 80,000 节点 | 可渲染 | 理论上限，非典型场景 |

---

## 11. 插件与运行时的职责边界

Mousika 面向受控的业务规则与可信 UDF。插件加载器用独立类加载器和 Spring 子容器组织生命周期，同时允许插件使用父容器中的基础能力；这种组织方式方便扩展与卸载，并不等于不可信代码的安全沙箱。

规则发布、UDF 上传与调试属于不同权限的操作。部署时应把可配置的规则能力、可调用的 UDF 和可访问的数据范围纳入权限体系；执行 Java 插件与只调整已审核规则参数，也需要不同的授权。独立 Bindings 解决参数绑定组织，不能替代进程与服务层的资源和访问控制。

## 12. 让发布与运行结果可追踪

事件监听器按规则记录成功、失败和耗时，测试用例用于发布前回归，候选规则集用于结果对比。这些能力让配置变更有检查入口，让运行异常能够定位到规则，而不必只依赖最终的通过/拒绝结果。

旧版并行节点采用线程池与限时等待，然后聚合已经收集的结果。等待超时不会自动停止工作线程，也不会为未完成节点补齐 NaResult；业务侧的完成判定必须包含错误和超时信息，不能把部分返回解释为全部执行成功。超时策略与资源保护由运行服务及 UDF 的调用契约共同确定。

缓存服务于当前上下文中的结果复用。跨请求操作、嵌套场景的新上下文以及有副作用的 UDF，需要分别管理结果生命周期与幂等性。

## 13. 落地成果

以下为作者提供的历史项目统计与团队估算，反映当时的接入和协作收益；效率比例不是对照实验中的因果估计。

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

Mousika 支持私有化部署能力，配置端和引擎服务可以独立部署在客户自己的基础设施上。项目历史部署包含国内和海外两个配置端；具体的数据存储与访问范围由部署配置决定。

---

## 让规则的变化成为可管理的过程

Mousika 把业务规则从代码中的分支，变成可以引用、组合、验证和解释的对象。DSL 定义组合语义，JS 与 UDF 提供求值能力，Visitor 留下执行路径，管理平台把这些能力交给配置与排查人员。

这套设计让调整规则有了稳定的操作路径，也为后续增加节点类型、参数模板和更完整的交互界面留下了扩展位置。
