---
title: "编程原则的工程实践：从 KISS 到正交性"
description: "编程原则是对抗软件复杂性的核心工具，但工具之间存在内在张力。本文以电商订单系统为主线，将 KISS、DRY、SOLID 等十余条编程原则按目标维度分为四组，逐一拆解其工程含义、典型误用与正确边界，并给出原则冲突时的决策框架和不同项目阶段的原则权重建议。"
pubDate: "2025-10-18"
tags: ["编程原则", "软件设计", "工程实践", "代码质量"]
author: "skyfalling"
---

## 一条元原则

**用最简单的方式解决当下的问题，同时不给下一个人制造麻烦。**

这句话浓缩了所有编程原则的精神内核。KISS 说简单，YAGNI 说克制，DRY 说一致，关注分离说各管各的，迪米特法则说少打听——它们从不同角度描述同一件事：**在复杂性和可维护性之间找到正确的平衡点。**

但现实远比一句话复杂。DRY 要求消除重复，KISS 要求保持简单——两者经常指向相反的方向。YAGNI 说不要为未来设计，开闭原则说要为未来留出扩展空间。**对原则的机械执行，往往比不用原则更危险。**

一个常见的场景：两段业务代码形式上完全相同，有人为了"消除重复"将其抽成通用组件。三个月后，两段代码因为各自的业务需求分别演化，通用组件里堆满了条件分支，变成了一个比原始重复更难维护的怪物。这不是 DRY 的问题，而是没有区分"代码的重复"和"知识的重复"。

本文以一个**电商订单系统**为主线，将这些原则按目标维度分为四组，逐一拆解它们的工程含义和使用边界。文末的决策框架给出了原则冲突时的判断路径——因为真正的工程判断力，不在于记住所有原则，而在于感知原则之间的张力，并做出权衡。

| 维度 | 代表原则 | 常见误用 |
|---|---|---|
| **控制规模** | KISS · YAGNI · Make It Work | 过度设计 / 过早优化 |
| **统一知识** | DRY | 合并碰巧相似的代码 |
| **划定边界** | 关注分离 · 单一职责 · 接口隔离 · 正交性 | 过度拆分 / 胖接口 |
| **管理依赖** | 最小耦合 · 迪米特 · 依赖倒置 · 组合优于继承 · 开闭原则 | 链式穿透 / 滥用继承 / 依赖方向混乱 |


## 控制规模：KISS、YAGNI 与渐进式构建

这组原则的精神内核是一个字：**克制**。在鼓励"多做"的工程文化里，"少做"反而是最难的事。

### KISS：简单不是简陋

KISS（Keep It Simple, Stupid）是最容易被误解的原则之一。"简单"不等于"简陋"或"不做设计"，**真正的简单是深思熟虑后的结果——更少的活动部件、更少的状态、更少的分支路径。** 做到这一点通常比做一个复杂方案更难。

以订单系统中的特性开关为例，对比两种实现：

```java
// Normal: 过度设计——插件式规则引擎
public class FeatureToggleEngine {
    private PluginRegistry pluginRegistry;
    private RuleEvaluator ruleEvaluator;
    private ConfigurationProvider configProvider;
    private FeatureToggleCache cache;

    public boolean isEnabled(String feature, UserContext ctx) {
        Rule rule = configProvider.loadRule(feature);
        List<Plugin> plugins = pluginRegistry.getPlugins(feature);
        EvaluationContext evalCtx = buildContext(ctx, plugins);
        return ruleEvaluator.evaluate(rule, evalCtx);
    }
}
```

```java
// Better: 当系统只有 6 个开关且无灰度需求
public class FeatureFlags {
    private static final Map<String, Boolean> FLAGS = Map.of(
        "new_checkout_flow", true,
        "dark_mode", false,
        "v2_search", true
    );

    public static boolean isEnabled(String feature) {
        return FLAGS.getOrDefault(feature, false);
    }
}
```

第一种方案支持插件式规则引擎、动态加载、用户维度灰度——但订单系统一共只有 6 个简单的开/关控制。六行代码就能解决的问题，不需要四个类和一套框架。

> **"Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away."** —— Saint-Exupéry

### YAGNI：代码是负债，不是资产

YAGNI（You Ain't Gonna Need It）专门针对"未来需求"的过度设计。

订单系统立项初期，有人提出搭建完整的数据库抽象层，"将来可能要从 MySQL 迁移到 PostgreSQL"。自定义 Query Builder、方言转换器、连接池代理——完全屏蔽底层差异。结果三年过去，迁移从未发生，但抽象层的代价实实在在：无法使用 MySQL 特定优化（如 `INSERT ... ON DUPLICATE KEY UPDATE`）、调试 SQL 要穿透三层封装、ORM 在抽象层下出现诡异行为。

**写出来的每一行代码都是负债。** 它要维护、要测试、要被后来的人理解。如果它解决的是一个不存在的问题，就是纯粹的负债。

### 渐进式构建：Make It Work → Right → Fast

这条原则规定了正确的工作顺序：

1. **Make It Work** — 用最直接的方式实现功能，验证逻辑正确
2. **Make It Right** — 重构结构，处理边界，写测试
3. **Make It Fast** — 只在性能确实是问题时优化

顺序错误的代价极高。订单系统优化期间，有人花一周用位运算、对象池、手写内存管理优化金额计算循环，执行时间从 200μs 降到 15μs。但压测发现瓶颈在库存扣减的数据库全表扫描——耗时 800ms，加个索引降到 5ms。那个循环在整个下单链路里占比不到 0.002%。

> **在优化之前，先量化。** 不要凭直觉猜瓶颈在哪里，用 Profiler 去测。Knuth 说"过早优化是万恶之源"，比这更重要的是：人类的直觉在性能问题上出奇地不靠谱。

**一句话总结：克制是一种能力——不写不需要的代码，不做不需要的抽象，不优化不需要优化的地方。**


## 统一知识：DRY 与它的陷阱

DRY（Don't Repeat Yourself）是被引用最多、同时被误用最多的编程原则。

### DRY 的真正含义

DRY 的原始定义来自《程序员修炼之道》：**"Every piece of knowledge must have a single, unambiguous, authoritative representation within a system."** 关键词是 knowledge（知识），不是 code（代码）。

订单系统中，两段金额校验代码看起来一模一样：

```java
// 订单金额校验
if (amount > 0 && amount <= 100000) {
    processOrder(amount);
}

// 退款金额校验
if (amount > 0 && amount <= 100000) {
    processRefund(amount);
}
```

形式完全相同，但背后是两条独立的业务规则：订单上限和退款上限今天碰巧都是 10 万，但它们由不同的业务方决定、因不同的原因变化。一旦抽成共享的 `validateAmount()`，当运营需要差异化调整（订单上限调到 50 万、退款上限降到 5 万），就会陷入尴尬——共享函数里堆满 `if-else` 分支，比原始重复更难维护。

**错误的 DRY 是消除代码的重复；正确的 DRY 是消除知识的重复。**

### 何时该用 DRY

判断标准：**两段代码不仅看起来一样，而且"改变的原因"也一样。**

订单系统中三个地方做手机号格式校验——用户注册、修改收货信息、绑定支付手机号。这三个场景的校验规则来自同一条业务规则："合法的中国大陆手机号格式"。号段规则变了，三处必须同步修改。这才是真正的知识重复，应该统一：

```java
// 正确的 DRY：一条业务规则，一个权威来源
public class PhoneValidator {
    private static final Pattern CN_MOBILE =
        Pattern.compile("^1[3-9]\\d{9}$");

    public static boolean isValid(String phone) {
        return phone != null && CN_MOBILE.matcher(phone).matches();
    }
}
```

> **判断规则：如果两段代码因为不同的业务需求而各自演化，即使今天一模一样，也不要合并。如果两段代码永远因为同一个原因而同步变化，即使今天有细微差异，也应该统一。**

**一句话总结：DRY 保护的是知识的一致性，不是代码的形式统一——消除知识重复，容忍代码重复。**


## 划定边界：关注分离、单一职责与正交性

这三条原则本质上在讨论同一个问题：**怎么画线**。在代码中画出清晰的边界，让每一部分各管各的，互不干扰。

### 关注分离：一个方法不该知道太多事情

订单系统中一段极其常见的"全能方法"：

```java
// Normal: 一个方法做五件事
public Response createOrder(HttpRequest request) {
    // 1. 鉴权
    String token = request.getHeader("Authorization");
    User user = tokenService.verify(token);
    if (user == null) return Response.unauthorized();

    // 2. 参数解析与校验
    OrderDTO dto = parseBody(request);
    if (dto.getAmount() <= 0) return Response.badRequest("金额无效");

    // 3. 业务逻辑
    Order order = new Order(user.getId(), dto.getAmount());
    order.applyDiscount(discountService.calculate(user));
    orderRepository.save(order);

    // 4. 发消息通知
    kafkaTemplate.send("order-created", order.toEvent());

    // 5. 构造响应
    return Response.ok(order.toVO());
}
```

鉴权、参数校验、核心逻辑、消息发送、响应构造——五件事耦合在一个方法里。鉴权方式换成 OAuth？改这里。消息中间件换成 RocketMQ？改这里。响应格式加个字段？还是改这里。

```java
// Better: 每一层只关心自己的事
@PostMapping("/orders")
public Response createOrder(@Authenticated User user,
                            @Valid OrderDTO dto) {
    Order order = orderService.create(user, dto);
    return Response.ok(order.toVO());
}

// Service：只负责核心业务逻辑
public Order create(User user, OrderDTO dto) {
    Order order = new Order(user.getId(), dto.getAmount());
    order.applyDiscount(discountService.calculate(user));
    orderRepository.save(order);
    eventPublisher.publish(new OrderCreatedEvent(order));
    return order;
}
```

鉴权交给拦截器，参数校验交给注解，消息发送抽象成事件发布。**改变鉴权方式不需要碰业务逻辑，改变消息中间件不需要碰 Controller。**

### 单一职责：谁会要求你改这段代码

单一职责原则（SRP）经常被简化为"一个类只做一件事"，但 Robert Martin 的原始表述是：**一个类应该只有一个变化的原因（reason to change）。**

"变化的原因"不是技术分类，而是**谁会要求你改这段代码**。订单系统中一个 `OrderService` 同时处理序列化格式和业务校验规则，它就有两个变化的原因：前端团队可能要求改序列化格式（XML → JSON），业务团队可能要求改校验规则（新增实名认证）。两个变化来自不同的利益相关方，进度不同、频率不同，不应该互相影响。

但 SRP 拆到极致也有代价。订单创建流程被拆成 `OrderInputValidator`、`OrderFactory`、`OrderPersistenceService`、`OrderNotificationSender`、`OrderEventPublisher`、`OrderOrchestrator` 六个类——每个类确实只有一个职责，但理解整个流程需要在六个文件之间跳转。如果核心逻辑放在一个 `OrderService` 里可能只有 80 行，读一个文件就能看懂。

> **经验法则：如果两个职责几乎总是同时变化、被同一个人修改、在同一个上下文中讨论，就没必要强行拆开。**

### 接口隔离：不要强迫调用方依赖它不需要的方法

接口隔离原则（ISP）和 SRP 形成互补——SRP 约束的是类的职责，ISP 约束的是接口的粒度。

订单系统中定义了一个"万能"订单服务接口：

```java
// Normal: 胖接口——所有调用方都要依赖完整接口
public interface OrderService {
    Order create(OrderDTO dto);
    void cancel(Long orderId);
    void refund(Long orderId, BigDecimal amount);
    List<Order> queryByUser(Long userId);
    OrderStatistics getStatistics(LocalDate from, LocalDate to);
    void exportToExcel(OutputStream out);
}
```

交易模块只需要 `create` 和 `cancel`，报表模块只需要 `getStatistics` 和 `exportToExcel`，但两者都被迫依赖完整的 `OrderService` 接口。接口方法签名变化（比如 `exportToExcel` 加了个参数），交易模块也得重新编译。

```java
// Better: 按调用方需求拆分接口
public interface OrderWriteService {
    Order create(OrderDTO dto);
    void cancel(Long orderId);
    void refund(Long orderId, BigDecimal amount);
}

public interface OrderQueryService {
    List<Order> queryByUser(Long userId);
    OrderStatistics getStatistics(LocalDate from, LocalDate to);
}

public interface OrderExportService {
    void exportToExcel(OutputStream out);
}
```

交易模块依赖 `OrderWriteService`，报表模块依赖 `OrderQueryService` + `OrderExportService`。实现类可以同时实现多个接口，但调用方只看到自己需要的部分。

> **ISP 的本质是"最小接口"——调用方只依赖它真正使用的方法，不多也不少。胖接口是隐性耦合的温床。**

### 正交性：改一个维度，不波及其他维度

**正交性是所有设计原则中最值得反复强调的一个**，但它很少被单独讨论。

正交性的意思是：**系统中的一个维度发生变化时，不应该影响其他维度。** 借用线性代数的概念——正交的向量互不干扰，改变一个方向上的分量不会影响另一个方向。

订单系统要增加一种通知渠道——从只有短信，扩展到支持邮件和站内信。看两种架构的扩展成本：

```java
// Normal: 通知逻辑散布在业务代码中——非正交
public class OrderService {
    public void create(Order order) {
        orderRepository.save(order);
        // 通知逻辑和业务逻辑耦合
        String msg = "订单" + order.getId() + "已创建";
        smsClient.send(order.getUserPhone(), msg);
        emailClient.send(order.getUserEmail(), "订单通知", msg);
        // 加站内信？继续在这里加...
    }

    public void cancel(Order order) {
        order.setStatus(CANCELLED);
        orderRepository.save(order);
        // 又是一遍通知逻辑
        String msg = "订单" + order.getId() + "已取消";
        smsClient.send(order.getUserPhone(), msg);
        emailClient.send(order.getUserEmail(), "订单通知", msg);
        // 加站内信？这里也要加...
    }
    // refund()、complete() 里也有同样的通知代码...
}
```

加一个通知渠道（站内信），需要修改 `create()`、`cancel()`、`refund()`、`complete()` 四个方法。**通知渠道（短信/邮件/站内信）和业务事件（创建/取消/退款/完成）是两个独立维度，但在这个设计里它们纠缠在一起。** 4 个事件 × 3 个渠道 = 12 个修改点，任何一个维度的变化都产生乘法级别的改动。

```java
// Better: 两个维度正交——各自独立变化
public class OrderService {
    public void create(Order order) {
        orderRepository.save(order);
        eventPublisher.publish(new OrderCreatedEvent(order));
    }
}

// 通知维度独立于业务事件
public class OrderNotificationListener {
    private List<NotificationChannel> channels; // SMS, Email, InApp...

    @EventListener
    public void on(OrderEvent event) {
        String msg = event.toMessage();
        channels.forEach(ch -> ch.send(event.getUser(), msg));
    }
}

interface NotificationChannel {
    void send(User user, String message);
}
```

加站内信？实现一个 `InAppChannel`，注册到 channels 列表。改通知文案？只改 `toMessage()`。**两个维度完全解耦，变更成本从 O(m×n) 降到 O(1)。**

> **检验正交性的方法：问自己"如果我要替换 X，需要改多少个与 X 无关的文件？"** 答案不是零或接近零，就有正交性问题。

**一句话总结：关注分离划出边界，单一职责定义边界的粒度，正交性验证边界是否有效。**


## 管理依赖：最小耦合、迪米特法则、组合优于继承与开闭原则

前面说的是怎么划边界，这组原则说的是**划完边界之后，边界两侧怎么打交道**。

### 最小耦合：依赖数量是复杂度的放大器

一个架构评审中的简单判断标准：**打开一个 Service 类，数构造函数参数或注入的依赖。超过 7 个，这个类几乎一定有问题。**

订单系统的 `OrderService` 依赖 15 个服务（UserService、ProductService、InventoryService、PricingService、DiscountService、PaymentService、LogisticsService……），意味着：

- 15 个潜在的变更源——任一接口变更都可能要修改 OrderService
- 15 个潜在的故障点——任一服务故障都可能导致订单创建失败
- 测试时需要 mock 15 个依赖

**耦合的代价不是线性增长，而是组合爆炸。** 解决办法不是从 15 减到 14，而是重新审视职责划分——拆成 3-4 个更小的服务，每个只依赖 3-4 个接口。

### 迪米特法则：不要和陌生人说话

迪米特法则（Law of Demeter）：一个对象只和直接朋友交流，不和朋友的朋友交流。

订单系统中获取收货地址邮编：

```java
// Normal: 链式调用穿透整个对象图
String zipCode = order.getUser().getAddress().getCity().getZipCode();
```

这行代码把调用方和 Order、User、Address、City 四个类的内部结构绑死。后来地址模块重构，将 `City` 拆分为 `Region` 和 `District`——所有使用 `.getCity().getZipCode()` 的地方全部编译报错。**实际影响：47 个文件需要修改，涉及订单、物流、发票、报表四个模块。** 一次结构重构变成了一场跨团队协调。

```java
// Better: 告诉对象做什么，而不是向对象要数据再自己做
String zipCode = order.getShippingZipCode();
```

Order 内部怎么组织 User、Address、City 的关系是它自己的事。外部只知道"可以向 Order 要一个邮编"。当 City 拆分时，**只需修改 `Order.getShippingZipCode()` 的实现——1 个方法，1 个文件。** 47 个改动点缩减为 1 个。

> **迪米特法则的本质是信息隐藏：你不需要知道的结构细节，就不应该知道。知道得越多，耦合得越深。**

### 组合优于继承：继承是最强的耦合

在所有代码关系中，继承是耦合最强的一种——子类不仅依赖父类的接口，还依赖其实现细节。父类改一个方法行为，子类可能就炸了。

```java
// Normal: 继承——看起来合理，但扩展性差
class VIPUser extends User {
    int level;
    void login() {
        super.login();
        recordVIPLogin();
    }
}
// 问题：如果用户同时是 VIP 和企业用户怎么办？单继承困境。
```

```java
// Better: 组合——会员类型变成可替换的策略
class User {
    String name;
    private MembershipStrategy membership;

    void login() {
        // ...基础登录逻辑
        membership.onLogin(this);
    }
}

interface MembershipStrategy {
    void onLogin(User user);
    double getDiscount();
}
```

VIP 和企业会员可以自由组合，新增会员类型不需要修改 User 类。**用"有一个"代替"是一个"，用接口契约代替实现继承。**

### 里氏替换：继承关系的健康检查

里氏替换原则（LSP）为继承设定了底线：**子类必须能在所有使用父类的场景中替代父类，而不引发错误或意外行为。**

订单系统中有一个经典的反面案例：

```java
// Normal: 违反 LSP——子类改变了父类的行为契约
class Rectangle {
    int width, height;
    void setWidth(int w)  { this.width = w; }
    void setHeight(int h) { this.height = h; }
    int area() { return width * height; }
}

class Square extends Rectangle {
    void setWidth(int w)  { this.width = w; this.height = w; }  // 正方形强制宽高相等
    void setHeight(int h) { this.width = h; this.height = h; }
}
```

看起来"正方形是矩形"在数学上成立，但在代码里 `setWidth` 会同时修改 `height`，调用方如果假设"设置宽度不影响高度"就会得到错误的面积。**子类偷偷改变了父类方法的行为契约——这就是 LSP 违反。**

当继承关系让你觉得不舒服时，通常意味着应该用组合（上一节的 `MembershipStrategy`）或重新建模（`Rectangle` 和 `Square` 不应该是继承关系，而应该都实现 `Shape` 接口）。

### 开闭原则：新增功能不应该修改已有代码

订单系统的支付模块，两种设计：

```java
// Normal: 每加一个支付方式都要改这个方法
public void pay(String channel, BigDecimal amount) {
    switch (channel) {
        case "alipay": /* ... */ break;
        case "wechat": /* ... */ break;
        // 加 Apple Pay？在这里加 case...
    }
}
```

```java
// Better: 新增支付渠道 = 新增一个类，不碰已有代码
public interface PaymentGateway {
    boolean supports(String channel);
    PayResult pay(BigDecimal amount, PayContext ctx);
}

public class ApplePayGateway implements PaymentGateway {
    public boolean supports(String channel) {
        return "apple_pay".equals(channel);
    }
    public PayResult pay(BigDecimal amount, PayContext ctx) {
        // Apple Pay 的具体逻辑
    }
}
```

新增支付渠道变成新增一个类。支付宝和微信的逻辑不会因为加了 Apple Pay 而受到任何影响。

**开闭原则的实现手段是抽象。** 通过定义稳定的接口，让新的变化以"扩展"的形式加入系统，而不是以"修改"的形式侵入已有代码。开闭原则和正交性在这里形成呼应——它们本质上都在降低变更的传播范围。

### 依赖倒置：高层不应该依赖低层的实现细节

依赖倒置原则（DIP）是开闭原则和组合优于继承的底层支撑：**高层模块不应该依赖低层模块，两者都应该依赖抽象。**

订单系统中，`OrderService` 直接依赖 `MySQLOrderRepository`：

```java
// Normal: 高层直接依赖低层实现
public class OrderService {
    private MySQLOrderRepository repository = new MySQLOrderRepository();

    public void create(Order order) {
        repository.save(order);  // 直接依赖 MySQL 实现
    }
}
```

想把存储从 MySQL 换成 Elasticsearch（订单归档场景），或在测试中用内存数据库——做不到，因为 `OrderService` 和 `MySQLOrderRepository` 焊死了。

```java
// Better: 双方都依赖抽象
public interface OrderRepository {
    void save(Order order);
    Order findById(Long id);
}

public class OrderService {
    private final OrderRepository repository;  // 依赖接口，不依赖实现

    public OrderService(OrderRepository repository) {
        this.repository = repository;
    }
}

// MySQL 实现
public class MySQLOrderRepository implements OrderRepository { /* ... */ }
// ES 实现
public class ESOrderRepository implements OrderRepository { /* ... */ }
// 测试用内存实现
public class InMemoryOrderRepository implements OrderRepository { /* ... */ }
```

**依赖方向反转了**：不再是高层依赖低层，而是低层实现依赖高层定义的抽象接口。切换存储引擎只需要替换注入的实现，`OrderService` 一行不改。

> **DIP 的判断标准：画出模块之间的依赖箭头，如果箭头从高层指向低层的具体实现类——就该引入接口反转依赖方向。**

**一句话总结：依赖越少越好，知道得越少越好，依赖方向朝向抽象，继承能不用就不用，扩展靠新增不靠修改。**


## 原则之间的冲突与决策框架

这些原则之间会打架，这不是理论上的可能性，而是每天都在发生的事情。

### DRY vs KISS

订单系统中，普通订单和预售订单的处理逻辑有 70% 相似。DRY 说抽出来，KISS 说各写各的。

```java
// DRY 导向：抽共享 handler，但条件分支堆积
public Response handleOrder(Request req, boolean isPresale) {
    // 公共逻辑...
    if (isPresale) { /* 预售的特殊逻辑 */ }
    else { /* 普通订单的特殊逻辑 */ }
    // 更多公共逻辑...
    if (isPresale) { /* 预售的另一段特殊逻辑 */ }
}
```

```java
// KISS 导向：各自独立，接受重复
public Response handleNormalOrder(Request req) { /* 普通订单完整逻辑 */ }
public Response handlePresaleOrder(Request req) { /* 预售订单完整逻辑 */ }
```

两个独立方法各 50 行，通常比一个 80 行充满条件分支的"统一方法"更容易理解和维护。

> **判断标准：重复的是"知识"还是"代码"。知识重复 → DRY 优先；代码碰巧像 → KISS 优先。**

### YAGNI vs 开闭原则

YAGNI 说"不要为未来设计"，开闭原则说"要方便未来扩展"。调和方式：

**不要构建功能，但要留下接缝。**

不要在第一版就建一个"通用支付网关框架"支持二十种支付方式的动态注册和热加载——但至少把支付逻辑藏在一个接口后面。定义一个接口的成本很低，但它留下的扩展空间很大。接口是轻量的——不包含实现，不需要维护逻辑，不会引入 bug——但给未来的变化留了一扇门。

### 决策框架

面对原则冲突时，可以按以下路径做判断：

```
1. 这段代码的变化频率如何？
   → 高频变化：优先正交性和开闭原则，降低变更成本
   → 低频/稳定：优先 KISS，保持简单

2. 重复的是知识还是代码？
   → 同一条业务规则在多处出现：DRY 优先
   → 碰巧相似但各自演化：KISS 优先，容忍重复

3. 抽象带来的复杂度是否超过重复带来的风险？
   → 抽象后更难理解、更难修改：保持重复
   → 不统一会导致不一致性 bug：消除重复

4. 当前团队能否驾驭这个抽象？
   → 团队熟悉相关模式：可以做更精细的设计
   → 团队不熟悉：选择最直接的方案
```

**没有一条原则在所有场景下都正确。** 真正的工程判断力是在具体场景下感知到原则之间的张力，然后做出一个"足够好"的决定。这种判断力没有捷径，只能通过持续的实践和复盘来积累。

### 原则的适用阶段

不同项目阶段，原则的权重不同：

| 阶段 | 首要原则 | 次要原则 | 原因 |
|---|---|---|---|
| **MVP / 验证期** | KISS、YAGNI | Make It Work | 快速验证业务假设最重要，不确定会不会活到明天，不要做多余的抽象 |
| **增长期** | DRY、SRP、ISP | 关注分离 | 团队扩大、需求增多，代码开始有维护压力，需要消除知识重复、理清职责边界 |
| **稳定期 / 规模化** | 正交性、OCP、DIP | 迪米特、LSP | 系统复杂度高，变更频繁但不能出事，需要降低变更的传播范围、保护已有功能 |

**关键洞察**：MVP 阶段过度应用 OCP/DIP 会拖慢交付速度；稳定期还在用 MVP 的"快糙猛"风格会导致技术债爆炸。**原则的权重应该随项目阶段动态调整，而非一成不变。**

回到开头的元原则：**用最简单的方式解决当下的问题，同时不给下一个人制造麻烦。** 好的代码不是最聪明的代码，而是下一个人能看懂、能改动、能扩展而不心惊胆战的代码。代码的读写比是 10:1——一段代码被阅读的次数远远超过被编写的次数。**为维护者编码**不是某一条原则，而是所有原则最终指向的方向。
