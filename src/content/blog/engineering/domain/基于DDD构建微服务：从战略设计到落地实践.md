---
title: "基于DDD构建微服务：从战略设计到落地实践"
pubDate: "2026-01-15"
description: "从子域划分、事件风暴、上下文映射八种模式到聚合设计原则，再到 Entity/Value Object/Domain Service 等战术构件的 Java 落地，系统性地拆解 DDD 如何指导微服务的边界划定与内部建模，并覆盖 Outbox、Saga、CQRS 等分布式一致性方案和常见反模式。"
tags: ["DDD", "微服务", "领域驱动设计", "架构设计", "事件驱动", "聚合设计", "战术设计"]
author: "skyfalling"
---

> 微服务架构的核心难题不是技术选型，而是**如何找到正确的服务边界**。拆分得太粗，和单体无异；拆分得太细，分布式的复杂性会吞噬所有收益。领域驱动设计（DDD）提供了一套从问题空间到解决方案空间的完整方法论——战略设计回答"边界在哪里"，战术设计回答"边界内怎么建"。本文以电商领域为主线，从子域划分、事件风暴、上下文映射，一路推进到聚合设计、Entity、Value Object、Domain Service 等战术构件的代码落地，并覆盖 Outbox、Saga、CQRS 等分布式一致性方案。

## 微服务的本质：不是"小"，而是"界限清晰"

微服务中的"微"容易让人把关注点放在服务的规模上，但规模从来不是核心标准。Adrian Cockcroft 对微服务有一个精炼的定义：

> "面向服务的架构由具有**界限上下文**、**松散耦合**的元素组成。"

一个真正的微服务架构应当具备以下特征：

| 特征 | 说明 |
|------|------|
| 业务边界清晰 | 服务以业务上下文为中心，而非技术抽象 |
| 实现细节隐藏 | 通过意图接口暴露功能，不泄露内部实现 |
| 数据独立 | 服务不共享数据库，每个服务拥有自己的数据存储 |
| 故障快速恢复 | 具备容错和弹性能力 |
| 独立部署 | 团队可以自主、频繁地发布变更 |
| 自动化文化 | 自动化测试、持续集成、持续交付 |

归纳起来：**松散耦合的面向服务架构，每个服务封装在定义良好的界限上下文中，支持快速、频繁且可靠的交付。**

微服务的强大之处在于：**边界内建立高内聚，边界外建立低耦合**——倾向于一起改变的事物应该放在一起。但说起来容易做起来难，业务在不断发展，设想也随之改变。因此，**重构能力**是设计系统时必须考虑的关键问题。

## DDD 战略设计：从问题空间到解决方案空间

领域驱动设计（Domain-Driven Design）因 Eric Evans 的同名著作而闻名，它是一组思想、原则和模式，帮助我们基于业务领域的底层模型来设计软件系统。战略设计是 DDD 的宏观层面，关注的是如何划分系统边界、建立团队间的协作契约。

### 基本术语

| 概念 | 定义 | 示例 |
|------|------|------|
| **领域（Domain）** | 组织所从事的业务范围 | 零售、电子商务 |
| **子域（Subdomain）** | 领域下的业务单元，一个领域由多个子域组成 | 目录、购物车、履约、支付 |
| **统一语言（Ubiquitous Language）** | 开发人员与领域专家共同使用的、表达业务模型的语言 | "商品"、"订单"、"履约" |
| **界限上下文（Bounded Context）** | 模型的有效边界，同一术语在不同上下文中含义不同 | 见下文详述 |

### 子域分类：核心域、支撑域与通用域

并非所有子域对业务的价值相同。Eric Evans 将子域分为三类，这个分类直接决定了资源投入的优先级和技术决策：

| 类型 | 特征 | 投入策略 | 电商示例 |
|------|------|---------|---------|
| **核心域（Core Domain）** | 业务的差异化竞争力所在，是组织最独特的能力 | 投入最优秀的团队，自研，持续迭代 | 推荐算法、定价策略、供应链优化 |
| **支撑域（Supporting Subdomain）** | 核心域所依赖的业务能力，有一定定制需求但非核心竞争力 | 可以外包或由普通团队负责 | 订单管理、库存管理、客服系统 |
| **通用域（Generic Subdomain）** | 业界通用的能力，无差异化价值 | 优先购买成熟方案，避免自研 | 认证授权、邮件通知、文件存储 |

这个分类为什么重要？因为它决定了每个微服务应该获得多少投入。核心域值得精雕细琢的聚合设计和充分的领域建模，通用域则应尽量采用开源方案或 SaaS 服务。**把核心域的精力花在通用域上，是最常见的资源错配。**

### 界限上下文：同一个词，不同的含义

以电商系统中的 **"Item"（商品）** 为例，它在不同的上下文中有着截然不同的含义：

| 上下文 | "Item" 的含义 | 关注的属性 |
|--------|-------------|-----------|
| **Catalog（目录）** | 可出售的产品 | 名称、描述、价格、图片、分类 |
| **Cart（购物车）** | 客户添加到购物车的商品选项 | SKU、数量、选中状态 |
| **Fulfillment（履约）** | 将要运送给客户的仓库物料 | 仓库位置、重量、物流单号 |

通过将这些模型分离并隔离在各自的边界内，我们可以自由地表达这些模型而不产生歧义。

> **子域 vs 界限上下文**：子域属于**问题空间**（业务如何看待问题），界限上下文属于**解决方案空间**（如何实现问题的解决方案）。理论上一个子域可以有多个界限上下文，但我们努力做到每个子域只有一个。

## 事件风暴：协作式的边界发现

有了子域和界限上下文的概念，下一个问题是：**具体的边界怎么找出来？** 事件风暴（Event Storming）是 Alberto Brandolini 提出的一种轻量级的协作建模技术，它是将业务知识转化为聚合边界和上下文映射的实操工具。

### 什么是事件风暴？

简单来说，事件风暴是团队在一起进行的头脑风暴，目标是识别系统中发生的各种**领域事件**和**业务流程**。所有相关团队在同一个房间（物理或虚拟），在白板上用不同颜色的便利贴标记事件、命令、聚合和策略，识别重叠概念、模糊的领域语言和冲突的业务流程，最后对相关模型进行分组，发现聚合边界。

### 便利贴颜色约定

| 颜色 | 含义 | 示例 |
|------|------|------|
| 橙色 | **领域事件**（已发生的事实） | "订单已创建"、"支付已完成" |
| 蓝色 | **命令**（触发事件的动作） | "创建订单"、"取消订单" |
| 黄色 | **聚合**（命令作用的对象） | "订单"、"支付"、"库存" |
| 紫色 | **策略/规则**（事件触发的后续逻辑） | "支付完成后发送确认邮件" |
| 红色 | **热点/问题**（需要讨论的疑问） | "退款流程和订单取消是否耦合？" |

### 从事件风暴到聚合边界

事件风暴的关键产出不是事件清单本身，而是通过事件的聚类发现**聚合边界**。具体做法是：先把所有领域事件铺到时间线上，然后把频繁一起出现的事件归拢到同一个聚合，最后观察哪些聚合之间的交互是事件驱动的（松耦合），哪些需要同步调用（紧耦合）。紧耦合的聚合倾向于放在同一个服务内，松耦合的聚合适合拆分为不同服务。

以电商下单场景为例：把"商品已添加到购物车"、"购物车已更新"归入购物车聚合；把"订单已创建"、"订单行已添加"、"订单已提交"归入订单聚合；把"支付已授权"、"支付已完成"、"支付已退款"归入支付聚合。然后观察到"订单已提交"之后触发"支付已授权"是跨聚合的事件流——这两个聚合之间是松耦合的，适合拆分为不同服务。而"订单已创建"和"订单行已添加"总是在同一个事务中发生——它们属于同一个聚合。

一次成功的事件风暴通常会产出：重新定义的聚合列表（这些可能成为新的微服务）、聚合之间的事件流（上下文映射的输入）、热点问题（需要进一步讨论的边界争议）、以及团队对统一语言的共同理解。**事件风暴的产出直接喂入下一步的上下文映射。**

## 上下文映射：定义服务间的协作契约

事件风暴帮我们发现了聚合和它们之间的事件流，上下文映射（Context Mapping）则在此基础上进一步定义：**这些上下文之间应该用什么模式协作？** DDD 定义了一组标准化的映射模式，每种模式反映了不同的团队关系和技术集成方式。

### 八种上下文映射模式

| 模式 | 关系描述 | 适用场景 | 电商示例 |
|------|---------|---------|---------|
| **合作关系（Partnership）** | 两个团队共同协调演进，成败与共 | 两个紧密配合的核心域团队 | 订单团队与支付团队联合迭代新的结算流程 |
| **共享内核（Shared Kernel）** | 两个上下文共享一小部分模型和代码 | 模型高度重叠且变更频率低 | 多个服务共享的 Money 值对象 |
| **客户-供应商（Customer-Supplier）** | 上游供应商提供能力，下游客户提出需求 | 上游有意愿响应下游的需求 | 库存服务（供应商）为订单服务（客户）提供库存查询 API |
| **遵从者（Conformist）** | 下游无条件接受上游模型，无谈判空间 | 上游强势或是第三方不可控系统 | 对接政府税务系统，必须按照其数据格式提交 |
| **防腐层（Anticorruption Layer）** | 下游建立翻译层，隔离外部模型对内部模型的污染 | 集成遗留系统或第三方服务 | 支付服务与第三方支付网关之间的适配层 |
| **开放主机服务（Open Host Service）** | 上游提供标准化的公开协议供多个下游消费 | 上游有多个消费者且接口稳定 | 商品目录服务提供标准 REST API，搜索、推荐、购物车均消费 |
| **发布语言（Published Language）** | 与开放主机服务配合，用标准化格式交换数据 | 需要跨上下文的数据交换标准 | 使用 JSON Schema 定义领域事件的标准格式 |
| **各行其道（Separate Ways）** | 两个上下文完全解耦，不做集成 | 集成成本高于收益 | 内部 BI 系统与面向客户的推荐系统各自维护用户画像 |

其中最值得深入理解的是**防腐层（ACL）**，因为它在微服务集成中使用频率最高。

### 防腐层：隔离外部模型污染

在实际项目中，我们不可避免地要对接第三方系统——支付网关、物流平台、ERP 系统。这些系统的数据模型和你的领域模型往往差异巨大。如果直接在领域代码中使用第三方的数据结构，外部的任何变更都会直接穿透到核心业务逻辑。

防腐层的职责是在两个世界之间做翻译：

```java
// 防腐层：将第三方支付网关的响应转换为内部领域模型
public class PaymentGatewayACL {
    private final ExternalPaymentClient client;

    public PaymentResult authorize(PaymentCommand cmd) {
        // 将内部领域命令转为外部 API 请求
        GatewayRequest request = GatewayRequest.builder()
            .merchantId(config.getMerchantId())
            .amount(cmd.getAmount().toCents())
            .currency(cmd.getAmount().getCurrency().name())
            .cardToken(cmd.getTokenizedCard())
            .build();

        // 调用外部服务
        GatewayResponse response = client.charge(request);

        // 将外部响应转为内部领域模型
        return PaymentResult.builder()
            .transactionId(TransactionId.of(response.getTxnRef()))
            .status(mapStatus(response.getResultCode()))
            .authorizedAmount(Money.of(response.getSettledAmount(), cmd.getAmount().getCurrency()))
            .build();
    }

    private PaymentStatus mapStatus(String gatewayCode) {
        return switch (gatewayCode) {
            case "00" -> PaymentStatus.AUTHORIZED;
            case "05" -> PaymentStatus.DECLINED;
            default -> PaymentStatus.FAILED;
        };
    }
}
```

ACL 的价值在于：当第三方网关从 v2 升级到 v3、字段名和状态码全部变化时，你只需要修改 ACL 内部的映射逻辑，领域层完全不受影响。

### 上下文映射实战：支付场景的边界重新划定

以电商支付场景为例，假设有三个服务都需要处理支付：

| 服务 | 支付相关操作 |
|------|------------|
| 购物车服务 | 在线支付授权 |
| 订单服务 | 订单履约后结算 |
| 联络中心服务 | 支付重试、变更支付方式 |

如果每个服务都内嵌支付聚合并直接对接支付网关，会产生严重问题：支付聚合分散在多个服务中，无法强制执行不变性；联络中心更改支付方式时，订单服务可能正在用旧方式结算；支付网关的任何变更都要改动多个服务、多个团队。

通过上下文映射分析，正确的做法是将支付聚合收拢到一个独立的**支付服务**中，它以 **Open Host Service** 的角色对外提供标准化的支付能力，内部通过 **ACL** 隔离第三方网关：

| 改造项 | 映射模式 | 说明 |
|--------|---------|------|
| 支付服务独立 | Open Host Service | 支付聚合有了专属的界限上下文，对外提供标准支付 API |
| 支付网关对接 | ACL | 在支付服务和支付网关之间加入适配层 |
| 购物车→支付 | Customer-Supplier（同步） | 下单时需要即时的支付授权反馈 |
| 订单→支付 | Published Language（异步事件） | 订单服务发出域事件，支付服务监听并完成结算 |
| 联络中心→支付 | Published Language（异步事件） | 变更支付方式时发出事件，支付服务撤销旧卡、处理新卡 |

这个例子体现了上下文映射的核心价值：**它不只是画图，而是在做架构决策**——哪些服务是上游、哪些是下游、用什么模式集成、团队间的依赖关系是什么。

## 从界限上下文到微服务

战略设计工具（事件风暴 + 上下文映射）帮我们识别了聚合边界和上下文间的协作关系，接下来的问题是：**一个界限上下文应该拆成几个微服务？**

### 界限上下文 ≠ 微服务

以"定价"界限上下文为例，它可能包含三个不同的聚合：

| 聚合 | 职责 |
|------|------|
| **Price（价格）** | 管理目录商品的价格 |
| **Priced Items（定价项）** | 计算商品列表的总价 |
| **Discounts（折扣）** | 管理和应用各类折扣规则 |

如果把这三个聚合放在一个服务中，随着时间推移，界限可能变得模糊，职责开始重叠，最终退化为"大泥球"。

### 拆分策略：从保守到激进

拆分策略的选择取决于你对领域的理解深度：

| 策略 | 适用场景 | 优势 | 风险 |
|------|---------|------|------|
| 一个界限上下文 = 一个微服务 | 领域模糊、业务初期 | 保守安全，避免过早拆分 | 服务可能过大 |
| 一个聚合 = 一个微服务 | 领域清晰、边界确定 | 粒度精细，独立演进 | 分布式复杂度高 |
| 一个界限上下文 = 多个微服务 | 上下文内聚合边界清晰 | 兼顾灵活与可控 | 需要精确的聚合划分 |

> 对于不完全了解的业务领域，建议从**保守策略**开始：将整个界限上下文及其聚合组成单个微服务。确保聚合之间通过接口充分隔离，后续再拆分的成本会低得多。**将两个微服务合并为一个的成本远高于将一个微服务拆分为两个**。

### 何时应该合并而非拆分？

如果发现两个聚合之间需要强 ACID 事务，这是一个强烈的信号——它们可能应该属于同一个聚合，或者至少属于同一个微服务。在拆分之前，事件风暴和上下文映射可以帮助我们及早识别这些依赖关系。

## 战术设计：边界内的领域建模

战略设计确定了服务边界，接下来的问题是：**边界内部怎么建？** 这就是战术设计的领域——一组用于构建丰富领域模型的构件，其中**聚合**是最核心的概念。

### 聚合（Aggregate）：数据一致性的原子边界

聚合是 DDD 中最重要也最容易被误用的概念。它是**数据变更的原子边界**——一次事务只能修改一个聚合。

> 聚合是关联对象的集群，被视为数据变更的单元。外部引用仅限于指定聚合的一个成员——**聚合根（Aggregate Root）**。在聚合的边界内需应用一组一致性规则。

三条铁律：一致性在单个聚合内保证（跨聚合只能最终一致）；只能通过聚合根的已发布接口修改聚合（外部不能绕过聚合根直接操作内部对象）；任何违反这些规则的行为都有让应用退化为大泥球的风险。

### 聚合设计原则

Vaughn Vernon 在《Implementing Domain-Driven Design》中总结了四条聚合设计原则，这四条原则比定义本身更有实操价值：

**原则一：在聚合边界内保护业务不变量。** 聚合存在的理由是保护不变量（Invariant）。例如"订单总金额必须等于所有订单行金额之和"这条规则，Order 和 OrderLine 必须在同一个聚合内，因为它们共同维护这个不变量。

**原则二：设计小聚合。** 大聚合意味着大事务、大锁、高冲突。一个包含几十个实体的聚合，每次修改都要加载和锁定整个对象图——并发性能会急剧下降。尽量让聚合只包含维护不变量所必需的最小实体集合。

**原则三：通过唯一标识引用其他聚合，而非直接对象引用。** 如果 Order 聚合需要关联 Customer，不要在 Order 内部持有 Customer 对象的引用，而是持有 CustomerId。这强制了聚合边界，避免了跨聚合的事务。

**原则四：使用最终一致性更新其他聚合。** 当一个聚合的变更需要触发另一个聚合的更新时，通过领域事件实现异步通知，而不是在同一个事务中同时修改两个聚合。

### 聚合设计实战：订单聚合

```java
// 聚合根
public class Order {
    private OrderId id;
    private CustomerId customerId;   // 通过 ID 引用，而非持有 Customer 对象
    private OrderStatus status;
    private Money totalAmount;
    private List<OrderLine> lines;   // OrderLine 是聚合内部的实体
    private List<DomainEvent> events = new ArrayList<>();

    // 业务行为封装在聚合根上
    public void addLine(ProductId productId, int quantity, Money unitPrice) {
        if (status != OrderStatus.DRAFT) {
            throw new OrderAlreadySubmittedException(id);
        }
        OrderLine line = new OrderLine(productId, quantity, unitPrice);
        this.lines.add(line);
        recalculateTotal();   // 保护不变量：总金额 = Σ 行金额
    }

    public void submit() {
        if (lines.isEmpty()) {
            throw new EmptyOrderException(id);
        }
        this.status = OrderStatus.SUBMITTED;
        events.add(new OrderSubmitted(id, customerId, totalAmount, lines, Instant.now()));
    }

    public void cancel(String reason) {
        if (!status.isCancellable()) {
            throw new OrderNotCancellableException(id, status);
        }
        this.status = OrderStatus.CANCELLED;
        events.add(new OrderCancelled(
            UUID.randomUUID().toString(),
            id, customerId, totalAmount, reason,
            toCancelledItems(lines), Instant.now(), nextEventVersion()));
    }

    private void recalculateTotal() {
        this.totalAmount = lines.stream()
            .map(OrderLine::lineAmount)
            .reduce(Money.ZERO, Money::add);
    }
}
```

这个设计体现了几个关键点：Order 是聚合根，OrderLine 是内部实体，不对外暴露；Customer 通过 CustomerId 引用，不在 Order 聚合内；所有业务行为（addLine、submit、cancel）都封装在聚合根上，由聚合根保护不变量；状态变更产生领域事件，由聚合内部收集，持久化时一并发布。

如何判断一个聚合是不是太大了？有几个信号：事务冲突频繁（多个用户同时操作同一个聚合）、加载一个聚合需要查询多张表和大量数据、一个看似简单的修改要锁定大量对象。反过来，聚合太小也有问题：如果你发现两个聚合之间需要强 ACID 一致性，它们可能应该属于同一个聚合。

### 实体（Entity）与值对象（Value Object）

这是 DDD 战术设计中最基本的二分法：

| 维度 | 实体（Entity） | 值对象（Value Object） |
|------|--------------|---------------------|
| 标识 | 有唯一标识，即使属性完全相同的两个实例也不相等 | 无标识，仅由属性值决定相等性 |
| 生命周期 | 有生命周期，状态会变化 | 不可变，创建后不再修改 |
| 存储 | 通常有独立的数据库记录 | 通常内嵌在实体中或作为字段 |
| 示例 | Order、Customer、Product | Money、Address、DateRange |

值对象是被严重低估的战术构件。很多团队习惯性地把所有概念建模为实体，导致领域模型充斥着不必要的 ID 和可变状态。一个好的判断标准：**如果你关心的是"它是哪一个"，用实体；如果你关心的是"它是什么值"，用值对象。**

```java
// 值对象：Money——不可变、无标识、通过值判断相等
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("Amount scale exceeds currency precision");
        }
    }

    public Money add(Money other) {
        assertSameCurrency(other);
        return new Money(amount.add(other.amount), currency);
    }

    public Money multiply(int quantity) {
        return new Money(amount.multiply(BigDecimal.valueOf(quantity)), currency);
    }

    public static final Money ZERO = new Money(BigDecimal.ZERO, Currency.getInstance("CNY"));
}
```

```java
// 值对象：Address——两个 Address 相等，当且仅当所有字段都相等，不需要 ID
public record Address(String province, String city, String district, String street, String zipCode) {}
```

### 领域服务（Domain Service）

当一个业务操作不自然地属于任何一个实体或值对象时，它应该放在领域服务中。领域服务的特点是：无状态、操作涉及多个聚合或外部信息、名称来自统一语言。

```java
// 领域服务：定价策略
public class PricingService {
    private final DiscountPolicyRepository discountRepo;

    /**
     * 计算订单的最终价格，涉及多条折扣规则的组合应用。
     * 这个逻辑不属于 Order（Order 不应该知道折扣规则的细节），
     * 也不属于 DiscountPolicy（单条规则不知道其他规则的存在），
     * 因此放在领域服务中。
     */
    public Money calculateFinalPrice(Order order, CustomerId customerId) {
        List<DiscountPolicy> policies = discountRepo.findApplicable(customerId, order.getLines());
        Money baseTotal = order.getTotalAmount();

        for (DiscountPolicy policy : policies) {
            baseTotal = policy.apply(baseTotal, order);
        }
        return baseTotal;
    }
}
```

一个常见误区是把所有业务逻辑都放在领域服务中，让实体退化为只有 getter/setter 的数据容器——这就是**贫血领域模型（Anemic Domain Model）**反模式，后面会专门讨论。

### 仓储（Repository）与应用服务（Application Service）

Repository 为聚合提供类集合的持久化接口，屏蔽底层存储细节。设计原则是**一个聚合根对应一个 Repository**，内部实体不需要独立的 Repository。

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
    List<Order> findByCustomerId(CustomerId customerId);
}
```

应用服务是领域模型的使用者，负责编排用例流程：接收外部请求、加载聚合、调用领域行为、持久化结果、发布事件。它本身**不包含业务逻辑**。

```java
@Service
@Transactional
public class OrderApplicationService {
    private final OrderRepository orderRepo;
    private final PricingService pricingService;
    private final DomainEventPublisher eventPublisher;

    public void submitOrder(SubmitOrderCommand cmd) {
        // 1. 加载聚合
        Order order = orderRepo.findById(cmd.getOrderId())
            .orElseThrow(() -> new OrderNotFoundException(cmd.getOrderId()));

        // 2. 调用领域服务（跨聚合逻辑）
        Money finalPrice = pricingService.calculateFinalPrice(order, cmd.getCustomerId());
        order.applyFinalPrice(finalPrice);

        // 3. 调用聚合的业务行为
        order.submit();

        // 4. 持久化
        orderRepo.save(order);

        // 5. 发布领域事件
        order.getDomainEvents().forEach(eventPublisher::publish);
    }
}
```

应用服务与领域服务的区别在于：**应用服务编排"做什么"，领域服务封装"怎么做"。** 应用服务知道用例的流程步骤，但不知道业务规则的细节；领域服务知道业务规则，但不知道自己在哪个用例流程中被调用。

### 分层架构与六边形架构

战术设计的构件需要一个合理的代码组织方式。传统的 DDD 分层架构将代码分为四层：

| 层次 | 职责 | 包含的构件 |
|------|------|----------|
| **Interface 层** | 处理 HTTP/gRPC 请求，参数校验，DTO 转换 | Controller、DTO、Assembler |
| **Application 层** | 编排用例流程，事务管理 | Application Service、Command/Query |
| **Domain 层** | 核心业务逻辑，不依赖任何外部框架 | Entity、Value Object、Domain Service、Repository 接口、Domain Event |
| **Infrastructure 层** | 技术实现细节 | Repository 实现、消息队列、外部 API 客户端、ACL |

这里的关键约束是**依赖方向**：上层可以依赖下层，Domain 层不依赖任何外层。这意味着 Repository 的接口定义在 Domain 层，实现放在 Infrastructure 层——依赖倒置原则的典型应用。

更进一步的做法是**六边形架构（Hexagonal Architecture）**，也叫端口-适配器架构。它的核心思想是：领域模型在最内层，所有外部交互通过端口（Port，即接口）和适配器（Adapter，即实现）进行，无论是 HTTP 请求、数据库访问还是消息队列，对领域层来说都是可替换的适配器。六边形架构的实际收益是：你可以在不启动 Spring、不连接数据库的情况下，对领域模型进行全面的单元测试。领域逻辑的正确性不依赖于任何基础设施。

### 贫血领域模型：最常见的战术设计反模式

所谓贫血领域模型，是指实体只有数据属性和 getter/setter，所有业务逻辑都写在 Service 层：

```java
// 贫血模型：Order 退化为数据容器
public class Order {
    private Long id;
    private String status;
    private BigDecimal totalAmount;
    private List<OrderLine> lines;
    // 只有 getter 和 setter，没有业务行为
}

// 所有逻辑堆在 Service 中
public class OrderService {
    public void addLine(Long orderId, ProductId productId, int qty, Money price) {
        Order order = orderRepo.findById(orderId);
        if (!"DRAFT".equals(order.getStatus())) {
            throw new RuntimeException("...");
        }
        OrderLine line = new OrderLine(productId, qty, price);
        order.getLines().add(line);  // 直接操作内部集合
        BigDecimal total = order.getLines().stream()...
        order.setTotalAmount(total);
        orderRepo.save(order);
    }
}
```

这种写法的问题在于：不变量（总金额 = Σ 行金额）没有被聚合保护，任何地方都可以直接 setTotalAmount 而不更新行项，或者直接操作 lines 集合而不重算总额。当 OrderService 之外的另一个 Service 也需要修改 Order 时，不变量的维护就变成了"记得调用"而非"编译器保证"。

对比之下，前面"聚合设计实战"中的 Order 实现，addLine 方法内部自动 recalculateTotal，外部根本没有 setTotalAmount 方法可调——不变量由聚合自身保护。

## 微服务间的通信与一致性

### 从单体到微服务的一致性挑战

在单体应用中，多个聚合在同一个进程边界内，可以在一个事务中完成：客户下单 → 扣减库存 → 发送邮件。所有操作要么都成功，要么都失败。

但微服务化后，这些聚合分散到了不同的分布式系统中。根据 **CAP 定理**，一个分布式系统只能同时满足一致性（C）、可用性（A）、分区容错（P）中的两个。在现实系统中，分区容错是不可协商的——网络不可靠、虚拟机可以宕机、区域延迟可能恶化。因此我们只能在可用性和一致性之间选择。而在现代互联网应用中，牺牲可用性通常也不可接受。**结论：基于最终一致性设计应用程序。**

### 领域事件设计

领域事件（Domain Event）是实现最终一致性的核心载体。一个设计良好的领域事件应该包含足够的信息让消费者独立处理，而不需要回调生产者查询更多数据：

```java
public record OrderCancelled(
    String eventId,                           // 全局唯一事件 ID，用于消费端幂等去重
    OrderId orderId,
    CustomerId customerId,
    Money orderAmount,
    String reason,
    List<CancelledLineItem> cancelledItems,  // 包含足够的信息让库存服务恢复库存
    Instant occurredAt,
    long eventVersion                         // 用于乱序处理
) implements DomainEvent {

    public record CancelledLineItem(ProductId productId, int quantity) {}
}
```

事件驱动架构避免了两种耦合：行为耦合（一个领域无需规定其他领域应该做什么）和时间耦合（一个流程的完成不依赖于所有系统同时可用）。

### Outbox 模式：保证事件发布的可靠性

事件驱动架构面临一个经典难题：聚合状态的持久化和事件的发布是两个操作——如果数据库写入成功但消息队列发送失败，就会出现数据和事件不一致。

Outbox 模式的解决思路是利用数据库事务的原子性：在同一个事务中，既写入聚合状态，又将事件写入同一数据库的 Outbox 表。然后由一个独立的进程（Relay/Poller 或基于 CDC 的 Debezium）从 Outbox 表读取事件并发布到消息队列。

```sql
-- 在同一个事务中
BEGIN;
  UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = ?;
  INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload, created_at)
    VALUES ('Order', ?, 'OrderCancelled', ?::jsonb, NOW());
COMMIT;
```

这样即使消息队列暂时不可用，事件也不会丢失——它安全地保存在数据库中，等待重试发布。

### 事件消费端的可靠性：幂等与乱序

Outbox 解决了生产端的可靠性，但消费端同样面临挑战。Outbox Relay 可能重复发送同一条事件（at-least-once 语义），网络或队列分区可能导致事件乱序到达。消费端必须做好两件事：

**幂等消费**：同一事件重复到达不产生副作用。常见做法是用事件 ID 做去重表：

```java
@Transactional
public void handle(OrderCancelled event) {
    // 幂等检查：如果这条事件已经处理过，直接返回
    if (processedEventRepo.existsById(event.eventId())) {
        return;
    }

    // 执行业务逻辑
    for (var item : event.cancelledItems()) {
        inventory.restoreStock(item.productId(), item.quantity());
    }

    // 记录已处理，与业务操作在同一事务中
    processedEventRepo.save(new ProcessedEvent(event.eventId(), Instant.now()));
}
```

**乱序处理**：事件可能不按发生顺序到达。消费者可以利用事件中的 eventVersion 或时间戳判断：如果收到的事件版本比本地记录的版本更旧，说明是迟到的旧事件，可以安全忽略。

| 角色 | 保障措施 |
|------|---------|
| **生产者** | Outbox 模式确保事件**至少发出一次** |
| **消费者** | 基于事件 ID 去重，以**幂等方式**消费 |
| **乱序处理** | 基于 eventVersion 或时间戳，忽略迟到的旧事件 |

### Saga 模式：跨服务的业务流程编排

当一个业务流程需要跨多个微服务协调（如下单涉及订单、库存、支付三个服务），单个事务无法覆盖，就需要 Saga。Saga 将长事务拆分为一系列本地事务，每个本地事务对应一个补偿操作（Compensating Action），如果某个步骤失败，按反序执行补偿操作来回滚之前的步骤。

Saga 有两种实现方式：

| 方式 | 机制 | 适用场景 | 风险 |
|------|------|---------|------|
| **编排式（Choreography）** | 每个服务监听上一步的事件，决定自己是执行还是补偿 | 步骤少（2-3 步）、参与者少 | 步骤多时流程难以追踪 |
| **协调式（Orchestration）** | 由一个 Saga 协调器集中管理流程状态和步骤推进 | 步骤多、需要可视化流程 | 协调器本身成为关键节点 |

以协调式 Saga 为例，下单流程的每个步骤都定义正向操作和补偿操作：

```java
public class CreateOrderSaga {
    private final List<SagaStep> steps = List.of(
        new SagaStep("reserveInventory", this::reserveInventory, this::releaseInventory),
        new SagaStep("processPayment",   this::processPayment,   this::refundPayment),
        new SagaStep("confirmOrder",     this::confirmOrder,     this::rejectOrder)
    );

    public void execute(CreateOrderCommand cmd) {
        SagaState state = SagaState.start(cmd);

        for (SagaStep step : steps) {
            try {
                step.execute(state);
                state.markCompleted(step.name());
            } catch (Exception e) {
                // 失败：按反序执行已完成步骤的补偿操作
                state.completedSteps().reversed().forEach(
                    completedName -> findStep(completedName).compensate(state)
                );
                state.markFailed(step.name(), e);
                return;
            }
        }
        state.markSucceeded();
    }
}
```

关键在于：每个步骤的正向操作和补偿操作都是本地事务，通过 Outbox 模式保证可靠发布。补偿操作不是"撤销"，而是一个语义上的逆操作——比如"释放库存"而不是"删除库存预留记录"。

### CQRS：读写模型分离

Command Query Responsibility Segregation（CQRS）将系统的读模型和写模型分离：写操作通过聚合根维护业务不变量，读操作通过专门的查询模型提供高性能查询。

CQRS 不是所有微服务都需要的——它适用于**读写差异大**的场景。例如：订单服务的写模型是 Order 聚合（强一致性、完整的业务规则），但运营后台的订单列表页需要关联商品名称、客户信息、物流状态等多个聚合的数据。如果每次查询都通过聚合根加载再拼装，性能和复杂度都不可接受。

CQRS 的做法是维护一个为列表查询优化的只读视图，通过领域事件异步更新：

```java
// 读模型：为查询优化的扁平化视图
public class OrderSummaryView {
    private String orderId;
    private String customerName;    // 冗余存储，避免查询时 join Customer
    private String statusDisplay;
    private BigDecimal totalAmount;
    private LocalDateTime createdAt;
    private String latestTrackingNo; // 冗余存储，避免查询时 join Fulfillment
}

// 事件处理器：监听领域事件，更新读模型
@Component
public class OrderSummaryProjection {

    @EventHandler
    public void on(OrderSubmitted event) {
        Customer customer = customerQueryService.findById(event.customerId());
        OrderSummaryView view = new OrderSummaryView();
        view.setOrderId(event.orderId().value());
        view.setCustomerName(customer.getName());
        view.setStatusDisplay("已提交");
        view.setTotalAmount(event.totalAmount().amount());
        view.setCreatedAt(event.occurredAt());
        summaryViewRepo.save(view);
    }

    @EventHandler
    public void on(OrderShipped event) {
        summaryViewRepo.updateTracking(event.orderId().value(), event.trackingNo());
        summaryViewRepo.updateStatus(event.orderId().value(), "已发货");
    }
}
```

读模型和写模型之间存在短暂的数据延迟（最终一致性），这在大多数查询场景下是可以接受的。但如果业务要求提交后立刻在列表中看到最新状态，可以在写操作返回后同步更新读模型，或者在前端做乐观更新。

### 何时仍需同步调用？

并非所有场景都适合事件驱动。当需要**即时反馈**时（如购物车→支付授权），仍需同步 API 调用。但要注意：同步调用引入了行为耦合和时间耦合，被调用服务不可用时调用方也会受影响。

**缓解策略**：同步调用作为主路径，辅以基于事件或批处理的异步重试作为降级方案。在用户体验、系统弹性和运营成本之间做好权衡。

## BFF 模式：解耦前端与领域服务

### 问题：服务为了迎合调用者而变形

微服务架构中一个常见的反模式是：**域服务为了满足前端的特定数据需求而编排其他服务**。

以"订单详情页"为例，页面需要同时展示订单信息和退款信息。如果让订单服务调用退款服务来组装复合响应：订单服务的自治性降低、增加故障点、变更成本高。

### 解决方案：Backend for Frontends（BFF）

BFF 是由**消费者团队**（前端团队）创建和维护的后端服务，负责对多个域服务进行集成和编排、为前端提供定制化的数据契约、根据不同终端优化响应格式和体积。

| 对比 | 无 BFF | 有 BFF |
|------|--------|--------|
| 数据编排 | 域服务互相调用，或前端直接调多个服务 | BFF 统一编排，域服务保持纯粹 |
| 变更自主性 | 前端需求变化要改多个域服务 | 前端团队自主改 BFF |
| 性能优化 | 移动端可能获取过多冗余数据 | 可按终端定制负载大小 |
| 技术选型 | 受域服务 API 限制 | BFF 可采用 GraphQL 等灵活方案 |

> **尽早构建 BFF 服务**，可以避免两种不良后果：域服务被迫支持跨域编排，或前端不得不直接调用多个后端服务。

## 常见反模式与陷阱

DDD 微服务实践中有几个高频踩坑点，值得单独拎出来。

### 分布式单体

表面上拆成了多个服务，但所有服务共享同一个数据库，或者每次变更必须同时部署多个服务——这不是微服务，而是分布式单体。它继承了单体的所有缺点（无法独立部署、无法独立扩展），同时还增加了分布式系统的复杂性（网络延迟、分布式事务、运维成本）。

**症状**：部署一个服务需要同时部署另外三个；两个服务的数据库表之间有外键约束；改一个服务的 API 需要另一个服务同步跟改。

### 按技术层拆分而非按业务域拆分

把用户相关的表放在一个"用户服务"、把所有 API 网关逻辑放在"网关服务"、把所有消息处理放在"消息服务"——这是按技术关注点拆分，不是按业务域拆分。结果是每个业务变更都需要改多个服务。

正确的做法是：每个服务对应一个界限上下文或聚合，包含从 API 到数据库的完整垂直切面。

### 数据所有权不清

两个服务同时写同一张表，或者一个服务直接读另一个服务的数据库——这是数据所有权不清的典型表现。解决方案是：每个聚合的数据只由其所属服务管理，其他服务需要数据时通过 API 或事件获取。

### 过早拆分

在业务模型还没有稳定的时候就急于拆分为微服务，结果频繁的需求变更导致服务边界不断调整，重构成本远超单体。**如果你还不确定边界在哪里，就不要拆分。** 先在单体内通过模块边界和接口隔离做好"可拆分"的准备，等业务稳定后再拆分。

## 渐进式拆分路线图

将以上所有工具整合，从单体拆分到微服务的推荐路径：

### 第一步：战略设计

与领域专家一起梳理业务，划分子域并识别核心域、支撑域和通用域。为每个子域确定界限上下文的边界，在每个上下文内建立一致的统一语言。

### 第二步：协作建模

通过事件风暴跨团队协作，识别领域事件、命令、聚合和热点问题。在此基础上绘制上下文映射，明确上下文之间的依赖关系和协作模式。

### 第三步：服务划分

根据聚合和上下文映射，确定每个微服务的边界。区分同步调用和异步事件驱动的通信方式，为不同终端规划 BFF 层。

### 第四步：渐进式拆分

从边缘开始，先拆分耦合最少、边界最清晰的服务。采用**绞杀者模式（Strangler Fig Pattern）**：新功能用微服务实现，老功能逐步迁移。每拆分一个服务，验证边界是否正确，必要时调整。

### 第五步：战术深化

对核心域服务实施完整的战术设计——聚合、Entity、Value Object、Domain Service、Repository、Application Service 分层组织。对支撑域和通用域，根据复杂度决定是否需要完整的战术设计，还是简单的 CRUD 即可。

## 总结

基于 DDD 构建微服务，战略设计和战术设计缺一不可。战略设计决定**边界在哪里**——子域分类告诉你资源优先级，事件风暴发现聚合和事件流，上下文映射定义服务间的协作契约。战术设计决定**边界内怎么建**——聚合保护业务不变量，Entity 和 Value Object 构建领域模型，Repository 和 Application Service 将领域逻辑与基础设施解耦。跨服务的一致性则由 Outbox 保证事件可靠发布、Saga 编排跨服务流程、CQRS 分离读写模型。

几条核心原则值得反复校验：微服务的本质是界限清晰，不是规模小；聚合是数据一致性的原子边界，设计小聚合，通过事件实现跨聚合的最终一致性；上下文映射不只是画图，而是在做架构决策；先在单体内做好模块隔离，再渐进式拆分——合并两个服务的成本远高于拆分一个。

> DDD 不是银弹，它是一种思考方式。它引导我们从业务本质出发，用结构化的方法找到正确的服务边界。在微服务架构中，**找到正确的边界比选择正确的技术栈重要十倍**。
