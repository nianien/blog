---
title: "编程原则的工程实践：从 KISS 到正交性"
description: "编程原则不是教条，而是前人踩过无数坑后留下的路标。KISS、YAGNI、DRY、关注分离、最小耦合、迪米特法则、组合优于继承、正交性——这些原则之间既有共鸣也有冲突，真正的功力在于权衡。"
pubDate: "2025-10-18"
tags: ["编程原则", "软件设计", "工程实践", "代码质量"]
---

## 原则不是教条

几年前带一个校招生，他技术功底不错，学习能力也强，入职没多久就把《重构》和《代码整洁之道》翻了个遍。然后事情开始变得有趣起来。

他接手了一段业务代码，发现订单创建和退款创建里有一段相似的参数校验逻辑。他本能地觉得这违反了 DRY 原则，于是花了两天时间把这段逻辑抽成了一个通用的 `ValidationEngine`，支持规则配置、支持链式校验、支持自定义错误码映射。代码从 20 行变成了 200 行，引入了三个新类和一个配置文件。

上线后第二周，产品说退款的金额上限要从 10 万调到 50 万，但订单的不变。改这个需求本来只需要改一个数字，结果因为共用了 `ValidationEngine`，他不得不在通用逻辑里加了一个 `if-else` 分支来区分场景。再过两周，订单校验需要新增一个风控维度，退款不需要。通用引擎再加一个条件分支。三个月后，这个"消除重复"的引擎变成了一个没人敢碰的怪物。

**这不是 DRY 原则的问题，而是对 DRY 原则的机械理解。** 他看到了代码的重复，却没有看到两段代码背后代表的是两种不同的业务知识——它们今天碰巧相同，但明天一定会分道扬镳。

从那之后我经常跟团队说一句话：编程原则是路标，不是法律。路标告诉你大致方向，但前面是山路还是平路、要不要绕行、能不能抄近道，你得自己判断。更重要的是，这些原则之间经常互相矛盾——DRY 和 KISS 会打架，YAGNI 和开闭原则会冲突，单一职责拆到极致反而会让系统变得更难理解。**真正的功力不在于背诵原则，而在于知道什么时候该用哪一条、什么时候该故意违反哪一条。**

下面我按照主题把常见的编程原则分成几组，聊聊它们在真实工程中的样子。


## 做减法的原则：KISS、YAGNI 与做最简单能工作的事

这三条原则的精神内核是一致的：**克制**。在一个鼓励"多做"的工程文化里，"少做"反而是最难的事。

### KISS：简单不是简陋

KISS（Keep It Simple, Stupid）大概是最容易被误解的原则之一。很多人把"简单"等同于"简陋"或"偷懒"，觉得不用设计模式、不做分层就是 KISS。但恰恰相反，**真正的简单是深思熟虑后的结果，不是偷工减料。** 简单意味着更少的活动部件、更少的状态、更少的分支路径。做到这一点通常比做一个复杂方案更难。

一个真实的例子。我在某个项目里见过一个"特性开关"系统，它的设计是这样的：

```java
// 过度设计的特性开关
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

这套东西支持插件式规则引擎、支持动态加载、支持用户维度的灰度。听起来很专业，但实际上整个系统一共只有 6 个特性开关，而且全都是简单的开/关控制，没有任何灰度需求。真正需要的是什么？

```java
// 够用的特性开关
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

六行代码解决问题。如果未来真的需要灰度能力，到那时候再加也不迟。

Saint-Exupery 说过一句话，我觉得是对 KISS 最好的注解：**"Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away."** 完美不是无可增加，而是无可删减。

### YAGNI：你不会需要它的

YAGNI（You Ain't Gonna Need It）是 KISS 的延伸，专门针对"未来需求"的过度设计。

我经历过一个教科书级别的反面案例。某个团队在项目初期就搭建了一套完整的数据库抽象层，理由是"将来可能要从 MySQL 迁移到 PostgreSQL"。这套抽象层包括自定义的 Query Builder、方言转换器、连接池代理——完全屏蔽了底层数据库的差异。

结果怎样？三年过去了，数据库迁移从未发生。但这套抽象层带来的问题倒是实实在在：没法用 MySQL 的特定优化（比如 `INSERT ... ON DUPLICATE KEY UPDATE`）、调试 SQL 性能问题时要穿透三层封装才能看到真正执行的语句、ORM 的延迟加载在抽象层下面出现了诡异的行为。团队花了大量时间维护一个解决"想象中的问题"的系统，同时不断给"真实存在的问题"打补丁。

**YAGNI 的核心洞察是：写出来的每一行代码都是负债，不是资产。** 代码要维护、要测试、要被后来的人理解。如果这些代码解决的是一个不存在的问题，那它就是纯粹的负债。

### Make It Work, Make It Right, Make It Fast

这条原则规定了正确的工作顺序，而大多数人搞错了顺序——尤其是第三步。

**先让它跑起来**，用最直接的方式实现功能，验证逻辑是对的。**然后让它正确**，重构代码结构，处理边界情况，写测试。**最后让它快**——但只有在性能确实是问题的时候。

我见过太多提前优化的案例。有一次一个同事花了整整一周优化一个数据处理循环，用上了位运算、对象池、手写内存管理，把循环体的执行时间从 200 微秒降到了 15 微秒。代码从清晰易读变成了只有他自己能看懂的"性能艺术品"。

后来做压测发现，瓶颈根本不在这个循环上，而在数据库的一个全表扫描查询。那个查询耗时 800 毫秒，加个索引就降到了 5 毫秒。他花一周优化的那个循环，在整个请求链路里占比不到 0.002%。

**过早优化是万恶之源**，这话 Knuth 说过。但比这更重要的是：**在优化之前，先量化。** 不要凭直觉猜瓶颈在哪里，用 profiler 去测。人类的直觉在性能问题上出奇地不靠谱。


## 消除重复的原则：DRY 与它的陷阱

DRY（Don't Repeat Yourself）大概是被引用最多、同时也被误用最多的编程原则。

### DRY 的真正含义

DRY 的原始定义来自 Andrew Hunt 和 David Thomas 的《程序员修炼之道》：**"Every piece of knowledge must have a single, unambiguous, authoritative representation within a system."** 注意，这里说的是 knowledge（知识），不是 code（代码）。

**两段代码看起来一模一样，但它们可能代表的是完全不同的知识。** 回到文章开头的例子：

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

这两段代码形式上完全相同，但它们背后的业务知识是不同的。订单金额的上限是 10 万，退款金额的上限也恰好是 10 万——但这是两条独立的业务规则。订单的上限可能因为合规要求调整到 50 万，退款的上限可能因为风控策略降低到 5 万。如果你把它们抽成一个 `validateAmount()` 函数，当业务需要差异化调整时，你就会陷入尴尬。

**错误的 DRY 是消除代码的重复；正确的 DRY 是消除知识的重复。**

### 什么时候该用 DRY

那什么情况下应该消除重复呢？当两段代码不仅看起来一样，而且**改变的原因也一样**的时候。

比如，系统中有三个地方都在做用户手机号的格式校验：注册、修改个人信息、绑定手机号。这三个场景的校验规则来自同一条业务规则——"合法的中国大陆手机号格式"。如果手机号规则变了（比如新增了某个号段），这三个地方必须同步修改。这才是真正的知识重复，应该抽成一个共享函数。

```java
// 这是正确的 DRY：一条业务规则，一个权威来源
public class PhoneValidator {
    private static final Pattern CN_MOBILE =
        Pattern.compile("^1[3-9]\\d{9}$");

    public static boolean isValid(String phone) {
        return phone != null && CN_MOBILE.matcher(phone).matches();
    }
}
```

**判断的标准不是"代码像不像"，而是"改变的原因是不是同一个"。** 如果两段代码因为不同的业务需求而可能各自演化，即使今天一模一样，也不要合并。如果两段代码永远因为同一个原因而同步变化，即使今天看起来有细微差异，也应该统一。


## 划边界的原则：关注分离、单一职责与正交性

这三条原则本质上在讨论同一个问题：**怎么画线**。在代码中画出清晰的边界，让每一部分各管各的，互不干扰。

### 关注分离：一个方法不该知道太多事情

看一段在业务代码里极其常见的"全能方法"：

```java
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

这个方法做了五件事：鉴权、参数校验、核心业务逻辑、消息发送、响应构造。任何一件事的改变都需要修改这个方法。鉴权方式从 JWT 换成 OAuth？改这个方法。消息中间件从 Kafka 换成 RocketMQ？改这个方法。响应格式要加个字段？还是改这个方法。

关注分离之后：

```java
// Controller：只负责 HTTP 层的事务
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

鉴权交给框架的拦截器，参数校验交给注解，消息发送抽象成事件发布。每一层只关心自己那一件事。**改变鉴权方式不需要碰业务逻辑，改变消息中间件不需要碰 Controller。**

### 单一职责：什么是"变化的原因"

单一职责原则（SRP）经常被简化为"一个类只做一件事"，但 Robert Martin 的原始表述是：**一个类应该只有一个变化的原因（reason to change）。**

"变化的原因"是什么？不是技术上的分类，而是**谁会要求你改这段代码**。一个 `UserService` 如果同时处理用户的序列化格式和用户的业务校验规则，那它就有两个变化的原因：前端团队可能要求改序列化格式（比如从 XML 换成 JSON），业务团队可能要求改校验规则（比如新增实名认证）。这两个变化来自不同的利益相关方，进度不同、频率不同、测试方式也不同，它们不应该被塞在同一个类里互相影响。

### 正交性：被低估的核心原则

在我看来，**正交性是所有设计原则中最值得反复强调的一个**，但它很少被单独拿出来讨论。

正交性的意思是：**系统中的一个维度发生变化时，不应该影响其他维度。** 借用线性代数的概念——正交的向量互不干扰，改变一个方向上的分量不会影响另一个方向。

举一个具体的例子。假设你要把日志框架从 Log4j 换成 Logback，你需要改多少个文件？如果答案是"几百个业务类都要改"，那说明你的日志使用和业务逻辑不是正交的——它们耦合在一起了。

非正交的设计：

```java
// 业务代码直接依赖具体的日志实现
import org.apache.log4j.Logger;

public class OrderService {
    private static final Logger log =
        Logger.getLogger(OrderService.class);

    public void create(Order order) {
        log.info("创建订单: " + order.getId());
        // ...业务逻辑
    }
}
```

正交的设计：

```java
// 业务代码依赖抽象
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OrderService {
    private static final Logger log =
        LoggerFactory.getLogger(OrderService.class);

    public void create(Order order) {
        log.info("创建订单: {}", order.getId());
        // ...业务逻辑
    }
}
```

用 SLF4J 这样的门面之后，底层从 Log4j 切换到 Logback 只需要改 POM 依赖和一个配置文件，业务代码一行都不用动。这就是正交——日志实现这个维度的变化，不会波及到业务逻辑这个维度。

**检验正交性的方法很简单：问自己"如果我要替换 X，需要改多少个与 X 无关的文件？"** 如果答案不是"零"或"接近零"，你的设计就有正交性问题。

把这个思路推广到 API 设计上。假设一个配置 API 是这样的：

```java
// 非正交的 API：存储格式和业务语义耦合
config.setJsonProperty("order.maxRetry", "3");
```

调用方既要知道业务配置项的含义，又要知道底层是 JSON 存储。如果将来存储格式换成 YAML 或数据库，所有调用方都要改。正交的设计应该隐藏存储细节：

```java
// 正交的 API：调用方不需要知道存储格式
config.set("order.maxRetry", 3);
```

存储格式是一个维度，业务配置是另一个维度，它们应该可以独立变化。


## 控制依赖的原则：最小耦合、迪米特法则与组合优于继承

前面说的是怎么划边界，这一组原则说的是**划完边界之后，边界两侧怎么打交道**。

### 最小耦合：依赖越少越好

在做架构评审时，我有一个简单的判断标准：**打开一个 Service 类，数一下它的构造函数参数或注入的依赖有多少个。** 如果超过 7 个，这个类几乎一定有问题。

我见过一个真实的 `OrderService`，它依赖了 15 个其他服务：UserService、ProductService、InventoryService、PricingService、DiscountService、PaymentService、LogisticsService、NotificationService、AuditService、RiskService、ConfigService、CacheService、MetricsService、ABTestService、FeatureFlagService。这意味着这 15 个服务中任何一个的接口变更，都可能导致 `OrderService` 需要修改。任何一个服务出故障，都可能导致订单创建失败。测试这个类需要 mock 15 个依赖。

**耦合的代价不是线性增长的，而是组合爆炸。** 15 个依赖意味着 15 个潜在的变更源、15 个潜在的故障点，以及它们之间可能产生的交互问题。

解决办法不是把 15 个依赖减少到 14 个，而是重新审视这个类的职责划分。一个需要 15 个依赖的类，几乎一定是承担了太多职责。把它拆成 3-4 个更小的服务，每个只依赖 3-4 个接口，整个系统的可维护性会有质的飞跃。

### 迪米特法则：不要和陌生人说话

迪米特法则（Law of Demeter）说的是：一个对象应该只和它的直接朋友交流，不应该和朋友的朋友交流。

看一个经典的"火车残骸"式代码：

```java
// 坏：链式调用穿透了整个对象图
String zipCode = user.getAddress().getCity().getZipCode();
```

这行代码看起来简洁，但它把你的代码和 User、Address、City 三个类的内部结构绑死了。如果 Address 的结构变了（比如 City 不再是一个独立对象而是一个字符串），所有写了这种链式调用的地方都要改。

```java
// 好：告诉对象做什么，而不是向对象要数据再自己做
String zipCode = user.getShippingZipCode();
```

这样 User 内部怎么组织 Address 和 City 的关系，是它自己的事。外部调用方只知道"我可以向 User 要一个邮编"，不需要知道内部是 `address.city.zipCode` 还是 `shippingInfo.postalCode`。

**迪米特法则的本质是信息隐藏：你不需要知道的结构细节，就不应该知道。** 你知道得越多，你被耦合得就越深。

### 组合优于继承：继承是最强的耦合

在所有的代码关系中，继承是耦合最强的一种。子类和父类之间是白盒依赖——子类不仅依赖父类的接口，还依赖它的实现细节。父类改一个私有方法的行为，子类可能就炸了。

一个在业务系统里反复出现的陷阱：

```java
// 第一版：看起来很合理
class User {
    String name;
    String email;
    void login() { ... }
}

class VIPUser extends User {
    int level;
    double discount;
    void login() {
        super.login();
        recordVIPLogin(); // VIP 登录有额外的积分逻辑
    }
}
```

问题出在哪里？有一天 `User` 类的 `login()` 方法增加了一个返回值，或者加了一个参数，`VIPUser` 的覆写方法需要同步修改。更糟的是，如果产品说"用户可以同时是 VIP 用户和企业用户"，你就陷入了 Java 的单继承困境——`VIPEnterpriseUser` 该继承谁？

用组合来解决：

```java
class User {
    String name;
    String email;
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

class VIPMembership implements MembershipStrategy {
    public void onLogin(User user) { /* VIP 积分逻辑 */ }
    public double getDiscount() { return 0.8; }
}
```

用户的会员类型变成了一个可替换的策略。VIP 和企业会员可以自由组合，新增一种会员类型不需要修改 `User` 类。**这就是组合的力量：用"有一个"代替"是一个"，用接口契约代替实现继承。**

这里顺便提一句里氏替换原则（LSP）：如果你的子类不能在所有场景下替代父类使用而不出问题，那你就不应该用继承。很多继承关系在设计时看起来合理（VIPUser "是一个" User），但在实际使用中会违反 LSP——比如 VIPUser 的某些方法有额外的前置条件，或者返回值的语义发生了变化。当你发现继承关系让你不舒服的时候，通常意味着应该用组合。


## 面向未来的原则：开闭原则、为维护者编码与童子军规则

前面的原则关注的是代码的结构，这一组关注的是时间——**代码要活很多年，而写它的人可能早就不在了。**

### 开闭原则：对扩展开放，对修改关闭

开闭原则（OCP）不要停留在抽象层面来理解它，看一个具体场景。

一个支付系统，第一版支持支付宝和微信支付：

```java
// 不符合开闭原则：每加一个支付方式都要改这个方法
public void pay(String channel, BigDecimal amount) {
    switch (channel) {
        case "alipay":
            // 支付宝逻辑
            break;
        case "wechat":
            // 微信支付逻辑
            break;
        // 加 Apple Pay？在这里加 case...
    }
}
```

每次新增一个支付渠道，你都需要修改这个方法。修改意味着引入 bug 的可能，意味着需要重新测试所有已有的支付逻辑，意味着合并冲突（如果有两个人同时在加不同的支付方式）。

符合开闭原则的做法：

```java
public interface PaymentGateway {
    boolean supports(String channel);
    PayResult pay(BigDecimal amount, PayContext ctx);
}

// 新增 Apple Pay：写一个新类，不碰任何已有代码
public class ApplePayGateway implements PaymentGateway {
    public boolean supports(String channel) {
        return "apple_pay".equals(channel);
    }
    public PayResult pay(BigDecimal amount, PayContext ctx) {
        // Apple Pay 的具体逻辑
    }
}
```

新增支付渠道变成了新增一个类，完全不需要修改已有的代码。已有的支付宝和微信的逻辑不会因为你加了 Apple Pay 而受到任何影响。

**开闭原则的实现手段是抽象。** 通过定义稳定的接口，让新的变化以"扩展"的形式加入系统，而不是以"修改"的形式侵入已有代码。

### 为维护者编码

有一句在程序员社区流传很广的话：**"Always code as if the person who ends up maintaining your code is a violent psychopath who knows where you live."** 翻译过来就是"写代码时要假设维护者是个知道你家住址的暴脾气"。虽然夸张，但道理是真的。

我接手过一个内部系统的维护工作，原作者已经离职。打开代码的那一刻，我体会到了什么叫"技术暴力"。

变量名全是单字母加数字：`a1`、`b2`、`tmp3`。一个核心方法有 300 行，中间穿插着三层嵌套的 try-catch。最致命的是一段位运算逻辑——用 6 个 bit 分别存储了 6 种业务状态，通过位与和位或来判断组合状态。没有一行注释解释为什么要用位运算（估计是为了"性能"），也没有注释解释每个 bit 代表什么状态。我花了三天才搞懂这 20 行代码在做什么，又花了两天写测试确认我的理解是对的。

这段代码在性能上确实更快——大概快了 0.01 毫秒。但它让每一个后来的维护者多花几天时间来理解。这种"聪明"的代码是真正的技术债。

**为维护者编码的核心原则：**

- 变量名和函数名要表达意图，不要表达实现
- 非显而易见的逻辑必须写注释解释"为什么"，而不是"做什么"
- 不要为了微不足道的性能提升牺牲可读性
- 如果你觉得一段代码需要注释才能看懂，先考虑能不能重写得不需要注释

### 童子军规则

Robert Martin 提出的童子军规则很简单：**离开时让营地比来时更干净。** 映射到代码上就是：每次你碰一个文件，离开时让它比你打开时更好一点——改一个命名、删一段死代码、补一句注释。

但这条规则有一个重要的约束：**范围要合理。** 我见过有人在一个修复线上 bug 的 PR 里顺手重构了整个模块。review 的人分不清哪些改动是修 bug、哪些是重构，测试团队也不知道回归测试的范围应该多大。结果修 bug 的 PR 反复被打回，原本一天能上线的修复拖了一周。

**童子军规则的正确姿势：小步改进，和功能改动明确分开。** 如果重构范围比较大，单独开一个 PR。如果是顺手改的小优化，确保 reviewer 能一眼分辨出来。


## 原则之间的冲突与权衡

如果前面每一条原则都读进去了，你应该已经隐约感觉到一个问题：**这些原则之间是会打架的。** 这不是理论上的可能性，而是每天都在发生的事情。

### DRY vs KISS

两个 API 接口的处理逻辑有 70% 相似。DRY 说：把共同部分抽出来。KISS 说：抽象会增加复杂度。

如果你抽一个共享的 handler，就需要用参数和条件分支来处理那 30% 的差异。结果这个"统一"的 handler 里充满了 `if (isTypeA)` 的判断，比两个独立的 handler 更难理解，也更容易在修改一个场景时不小心影响另一个。

```java
// DRY 的做法：抽一个共享 handler
public Response handleRequest(Request req, boolean isTypeA) {
    // 公共逻辑...
    if (isTypeA) {
        // A 的特殊逻辑
    } else {
        // B 的特殊逻辑
    }
    // 更多公共逻辑...
    if (isTypeA) {
        // A 的另一段特殊逻辑
    }
    // ...
}
```

```java
// KISS 的做法：各写各的，接受重复
public Response handleTypeA(Request req) {
    // A 的完整逻辑，简单直接
}

public Response handleTypeB(Request req) {
    // B 的完整逻辑，简单直接
}
```

在很多情况下，**后者是更好的选择。** 两个独立的方法各自 50 行，比一个 80 行但充满条件分支的"统一方法"更容易理解和维护。这里 KISS 赢了 DRY。

但如果那 70% 的相似逻辑来自同一条业务规则（比如都是同一套风控校验流程），那就应该抽出来——因为这时候 DRY 保护的是知识的一致性，一旦风控规则变了，你不想记住"有两个地方要改"。

**判断标准：重复的是"知识"还是"代码"。如果是知识，DRY 优先；如果只是代码碰巧像，KISS 优先。**

### YAGNI vs 开闭原则

YAGNI 说"不要为未来设计"，开闭原则说"要方便未来扩展"。这两者怎么调和？

答案是：**不要构建功能，但要留下接缝。**

以前面支付系统的例子来说，YAGNI 告诉你不要在第一版就建一个"通用支付网关框架"，支持二十种支付方式的动态注册和热加载。但开闭原则告诉你，至少把支付逻辑藏在一个接口后面，这样将来加新的支付方式时不需要改已有的代码。

**定义一个接口的成本很低，但它留下的扩展空间很大。** 这就是 YAGNI 和 OCP 的平衡点：不构建不需要的实现，但留下简单的扩展接口。接口是轻量的——它不包含实现，不需要维护逻辑，不会引入 bug——但它给未来的变化留了一扇门。

### SRP vs KISS

单一职责拆到极致会怎样？一个简单的用户注册流程被拆成 `UserInputValidator`、`UserFactory`、`UserPersistenceService`、`WelcomeEmailSender`、`RegistrationEventPublisher`、`RegistrationOrchestrator` 六个类。每个类确实只有一个职责，非常"干净"。

但当一个新来的开发者要理解注册流程时，他需要在六个文件之间跳转，理解它们的协作关系，才能拼凑出完整的图景。如果把核心逻辑放在一个 `RegistrationService` 里，可能只有 80 行代码，但读一个文件就能理解整个流程。

**SRP 的目标是让变化可控，但如果拆得太细导致理解成本剧增，就需要退一步。** 实践中的经验法则是：如果两个职责几乎总是同时变化、几乎总是被同一个人修改、几乎总是在同一个上下文中被讨论，那就没必要强行拆开。"一个变化的原因"不是一个精确的定义，它需要你对业务有判断力才能合理运用。


## 结语

写了这么多原则和案例，最后想说的反而是最简单的一句话：**好的代码不是最聪明的代码，而是下一个人能看懂、能改动、能扩展而不心惊胆战的代码。**

编程原则是前人踩过无数坑之后留下的路标。KISS 告诉你克制，DRY 告诉你统一知识，关注分离告诉你画好边界，迪米特法则告诉你管好依赖，开闭原则告诉你面向未来。但这些路标指的是方向，不是精确坐标。你不能闭着眼睛沿着路标走，因为路标之间有时候指向不同的方向——DRY 和 KISS 打架、YAGNI 和 OCP 拉锯、SRP 和可理解性博弈。

**真正的工程判断力，不是记住所有原则然后逐条执行，而是在具体场景下感知到原则之间的张力，然后做出一个"足够好"的决定。** 这种判断力没有捷径，只能通过写代码、犯错误、读别人的代码、维护别人的系统，一点一点积累。

如果非要给出一条元原则的话，我会说：**用最简单的方式解决当下的问题，同时不给下一个人制造麻烦。** 大多数时候，遵循这一条就够了。
