---
title: "当所有常规路径都被堵死：一次非侵入式 SQL 监控的工程突围"
pubDate: "2024-04-07"
description: "当 ORM 不支持 SQL 拦截、数据库连接由 DBA 维护、框架代码无权修改时，如何实现非侵入式 SQL 监控？本文记录了从执行链路分析、约束排除到字节码注入的完整工程决策过程，并提炼出一套通用的「寻找代理切入点」方法论。"
tags: ["SQL监控", "Java", "字节码", "非侵入式"]
author: "skyfalling"
---

## 问题：一条不合作的执行链路

SQL 监控是后端工程中最基础的需求之一：参数化 SQL 绑定实际值、超长参数列表缩略打印、执行耗时统计与慢查询报警。如果你使用了成熟的 ORM 框架（MyBatis Interceptor、JOOQ Listener），这些都不是问题。

但如果你的技术栈不提供这些能力呢？

一个 SQL 请求的执行链路：`DAO → ORM → DataSource → Connection → Driver → DB`。要实现独立于 ORM 的通用监控，可以在 **DataSource → Connection → Driver** 三个环节切入：

| 切入点 | 方式 | 代表工具 |
|--------|------|----------|
| Driver 层 | JDBC URL 加 logger 参数 | MySQL profileSQL |
| Connection 层 | 代理驱动，修改 JDBC URL | P6Spy、log4jdbc |
| DataSource 层 | 包装 DataSource 对象 | P6DataSource |

三种方案都可以实现 SQL 监控。在本文系统当时的配置与发布约束下，我们选择从 DataSource 切入；这不是其他生产系统的唯一选择。

### 约束条件

这套系统的基础设施有几个硬约束：数据库连接由 DBA 在平台配置，底层数据源是 ShardingSphere + HikariDataSource 的深度封装。

- **Driver 层方案**：需要在 JDBC URL 中加 `logger=Slf4JLogger` 和 `profileSQL=true` 两个参数，而 URL 由 DBA 维护，修改流程长且和标准配置冲突。另外，不同数据库的 Driver 实现不统一（Oracle 就不支持 profileSQL）——**排除**
- **Connection 层方案**：同样需要修改 JDBC URL（`jdbc:p6spy:mysql://...`），且比 Driver 层方案更容易配错——**排除**
- **DataSource 层方案**：不需要改 URL，只需在运行时包装 DataSource 对象——**唯一可行**

可以用 `P6DataSource` 包装原始 DataSource，但这套框架封装了创建过程，**业务侧缺少在所有数据访问模板初始化前统一替换数据源的入口**。问题在初始化时机与覆盖范围，而不是绝对无法取得实例。

框架提供的数据访问入口是一个 `DataSourceConfig` 接口：

```java
public interface DataSourceConfig {
    String bizName();

    default NamedParameterJdbcTemplate read() {
        return InternalDatasourceConfig.readForceAz(this, currentAz(), currentPaz(), "read");
    }

    default NamedParameterJdbcTemplate write() {
        return InternalDatasourceConfig.writeForceAz(this, currentAz(), currentPaz(), "write");
    }
}
```

业务方通过枚举实现该接口来定义数据源。标准 `NamedParameterJdbcTemplate` 可以通过其 `JdbcTemplate` 访问底层 DataSource，因此“框架不直接暴露”不等于完全无法获取。不过，取得引用仍不等于能在所有模板和连接创建之前统一替换它；本文选择在框架的委托数据源初始化路径上插入代理。上述业务类名和代码为说明调用关系的节选。

我们需要解决的具体问题是：在不修改 JDBC URL 和框架业务源码的前提下，统一拦截委托数据源的初始化。


## 核心突破：顺着继承链找到注入点

这是整篇文章最关键的部分——不是"怎么改字节码"，而是**"改哪里"**。

### 定位 DataSource 的创建位置

第一步是找到 DataSource 到底在哪里被 `new` 出来的。框架代码虽然不能修改，但反编译后源码是可以阅读的。

追踪方法有两个：一是在 IDE 中对 `HikariDataSource` 的构造方法设断点，启动应用后查看调用栈；二是在依赖 jar 中全局搜索 `new HikariDataSource`。两种方法都能快速定位到同一个位置。

沿着调用链一路追踪：

```
DataSourceConfig.read()
  → InternalDatasourceConfig.readForceAz()
    → DataSourceFactory.create()
      → new ListenableDataSource<>(bizName, new HikariDataSource(config), ...)
```

`DataSourceFactory.create()` 的关键代码：

```java
public static ListenableDataSource<Failover<Instance>> create(Instance i) {
    return supplyWithRetry(
        DATA_SOURCE_BUILD_RETRY,
        DATA_SOURCE_BUILD_RETRY_DELAY,
        () -> new ListenableDataSource<>(
            bizName,
            new HikariDataSource(config),  // ← 真正的 DataSource 在这里创建
            ds -> i.toString(), i),
        DataSourceFactory::needRetry);
}
```

最直接的想法：把 `new HikariDataSource(config)` 改成 `new P6DataSource(new HikariDataSource(config))`。但这是框架的代码，没有修改权限。如果只盯着 `DataSourceFactory`，就会陷入死胡同。

### 继承链上的转折

**转折点在于：看一下 `ListenableDataSource` 的继承关系。**

```
ListenableDataSource
  → extends DelegatingDataSource (Spring JDBC)
    → implements DataSource
```

`DelegatingDataSource` 是 Spring JDBC 提供的标准委托类，它的构造方法和 setter：

```java
public class DelegatingDataSource implements DataSource {

    public DelegatingDataSource(DataSource targetDataSource) {
        this.setTargetDataSource(targetDataSource);
    }

    public void setTargetDataSource(@Nullable DataSource targetDataSource) {
        this.targetDataSource = targetDataSource;
    }
}
```

这意味着 `ListenableDataSource` 在构造时，会调用父类 `DelegatingDataSource` 的 `setTargetDataSource()` 方法，保存内部的 `HikariDataSource`。

**如果我们改写 `setTargetDataSource()` 方法，在保存之前先用 `P6DataSource` 包一层，就能实现无侵入的 DataSource 代理：**

```java
public void setTargetDataSource(@Nullable DataSource targetDataSource) {
    this.targetDataSource = targetDataSource == null || targetDataSource instanceof P6DataSource
        ? targetDataSource : new P6DataSource(targetDataSource);
}
```

这个方案的精妙之处在于：

1. **不修改业务源码**——运行时实际改变的是 Spring JDBC 类的方法体，仍需纳入依赖升级和运行环境验证
2. **不改配置**——不需要碰 JDBC URL 或启动参数
3. **位于关键路径上**——所有通过 `ListenableDataSource` 创建的数据源都会经过这个方法
4. **切入点明确**——目标是公开方法，但构造路径、类加载器和版本兼容性仍需逐版验证

> 找到这个切入点不是靠灵感，而是一个系统性过程：**先定位目标行为的执行链路，再沿着继承链寻找可控节点。**


## 字节码改写：三种姿势与选型

确定了"改哪里"，下一步是"怎么改"。

我们需要在运行时修改 `DelegatingDataSource` 的 `setTargetDataSource()` 方法。这里要修改的是类定义本身，因此采用字节码改写；仅对某个实例创建动态代理，不能改变构造过程中的这次调用。

动态 Attach 并非 JDK 9 才出现，也不是所有运行环境都允许。改写已加载类需要已安装的 Instrumentation、可修改的目标类及重定义能力；可在启动时加载 Agent，或在允许运行时 Attach 的环境中安装。JDK 21 对动态加载 Agent 发出警告，[JEP 451](https://openjdk.org/jeps/451) 说明了相关限制方向，不能承诺始终无需启动参数。

以下是三种 Byte Buddy 实现方式：

### 方案一：类文件替换

预先编译好一个修改过的 `DelegatingDataSource` 类，运行时整体替换：

```java
new ByteBuddy()
    .redefine(NewDelegatingDataSource.class)
    .name(DelegatingDataSource.class.getName())
    .make()
    .load(Thread.currentThread().getContextClassLoader(),
          ClassReloadingStrategy.fromInstalledAgent());
```

需要在代码中维护一份完整的替换类，当 Spring 版本升级时，替换类可能与原始类不兼容。

### 方案二：直接操作字节码

通过 ASM 级别的 API 逐条编写字节码指令：

```java
new ByteBuddy()
    .redefine(DelegatingDataSource.class)
    .method(named("setTargetDataSource"))
    .intercept(MyImplementation.INSTANCE)
    .make()
    .load(Thread.currentThread().getContextClassLoader(),
          ClassReloadingStrategy.fromInstalledAgent());
```

其中 `MyImplementation` 需要手写 ASM 字节码——`visitVarInsn`、`visitMethodInsn`、`visitFieldInsn` 逐行控制栈操作。可以用 IDEA 的 Byte-Code-Analyzer 插件辅助生成，但本质上仍是在操作底层指令，不可读、无法调试、维护成本极高。

### 方案三：Byte Buddy Advice（最终选择）

```java
public static void redefine() {
    new ByteBuddy()
        .redefine(DelegatingDataSource.class)
        .visit(Advice.to(Decorator.class)
               .on(ElementMatchers.named("setTargetDataSource")
                   .and(ElementMatchers.takesArguments(DataSource.class))))
        .make()
        .load(DelegatingDataSource.class.getClassLoader(),
              ClassReloadingStrategy.fromInstalledAgent()).getLoaded();
}

static class Decorator {
    @Advice.OnMethodEnter
    public static void enter(
            @Advice.Argument(value = 0, readOnly = false)
            DataSource dataSource) {
        if (dataSource != null && !(dataSource instanceof P6DataSource)) {
            dataSource = new P6DataSource(dataSource);
        }
    }
}
```

Advice 的原理不是动态代理，而是直接修改方法体的字节码。上面的代码等价于在方法开头插入一行：

```java
public void setTargetDataSource(@Nullable DataSource targetDataSource) {
    if (targetDataSource != null && !(targetDataSource instanceof P6DataSource)) {
        targetDataSource = new P6DataSource(targetDataSource);
    }
    this.targetDataSource = targetDataSource;
}
```

### 选型对比

| | 类文件替换 | 操作字节码 | Advice |
|---|---|---|---|
| 可读性 | 中（需维护完整类） | 低（ASM 指令） | **高（Java 注解）** |
| 可调试性 | 中 | 低 | **高** |
| 维护成本 | 高（跟随 Spring 版本） | 极高 | **低** |
| 灵活性 | 高 | 极高 | 中 |

**方案三是最终选择**：代码可读、可调试，修改范围精确到方法级别，不依赖原类的完整实现。

> 两个限制需要注意：
> 1. 动态修改已加载的类，不能添加或删除方法/字段，只能修改方法体
> 2. 委托给实例的 MethodDelegation 通常需要保存实例的字段，可能超出重定义限制；静态委托并非必然增加字段，不能一概排除。这里使用 Advice 是为了保持类结构不变

该改写影响同一类加载器内所有调用此父类方法的实例，而非只影响指定业务数据源。应在目标数据源创建之前安装；已有连接不会被追溯包装。还需验证目标类加载器能看到 P6Spy、包装器的 `unwrap` 行为和连接池关闭路径。本文未提供完整 Starter 源码，示例用于说明注入点，不代表任意框架版本都可直接接入。


## 封装成 Starter：开箱即用

目标是让业务方零代码接入——只加一个 Maven 依赖就自动启用 SQL 监控：

```xml
<dependency>
    <groupId>com.kuaishou.ad</groupId>
    <artifactId>sqllog-spring-boot-starter</artifactId>
    <version>制品库查询最新版</version>
</dependency>
```

利用 Spring Boot 的自动配置机制，Starter 在应用启动时自动执行字节码改写逻辑——既不修改业务代码，也不更改系统配置。

Spring Boot 3.0 不再支持通过 `spring.factories` 的自动配置条目注册配置类，改用下面的导入文件（该方式从 Boot 2.7 开始支持）：

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

Starter 应根据目标 Spring Boot 版本提供相应的注册文件，参见 [Spring Boot 3.0 迁移指南](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide#auto-configuration-files)。


## SQL 打印效果

启用后的 SQL 日志输出分为三行：

![作者原系统 SQL 日志：耗时信息、缩略语句和参数展示](https://static.yximgs.com/udata/pkg/EE-KSTACK/28cd44d1451c960cfb982773aab6ec44)

- **第一行**：执行时间、耗时、SQL 操作类型、数据库连接信息
- **第二行**：参数化 SQL（缩略）
- **第三行**：根据参数还原的日志展示文本，并非数据库收到的协议报文

### SQL 缩略打印

回到开头提到的需求——SQL 缩略不是简单的字符串截断，而是解析 SQL 结构，仅对 `IN (...)` 等参数列表进行智能缩略：

```sql
-- 原始 SQL（参数列表超长）
SELECT * FROM user
WHERE id IN (1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008)
AND name IN (SELECT name FROM whitelist
  WHERE name IN ('a','b','c','d','e','f','g','h','i','j','k','l','m'))

-- 缩略后（保留结构，截断参数）
SELECT * FROM user
WHERE id IN (1001, 1002, 1003, 1004, 1005, ...)
AND name IN (SELECT name FROM whitelist
  WHERE name IN ('a','b','c','d','e', ...))
```

这一功能基于 P6Spy 的自定义 `MessageFormattingStrategy` 实现。简单正则只能处理受限的语句格式，无法可靠区分嵌套子查询、字符串内逗号、注释和方言语法；需要保留结构时，应使用相应方言的解析器或可靠的词法处理。上面的省略输出只是日志文本，不能执行。参数展开也不保证等价于驱动的二进制参数绑定；默认脱敏敏感参数并限制日志长度，排查时按授权范围保留必要值。


## 方法论提炼：寻找代理切入点

回过头看，这个问题的具体技术细节（Byte Buddy、P6Spy、Spring Boot Starter）都不是核心——核心是**在不修改外部代码的前提下，找到一个可拦截的切入点**。

面对“第三方组件无法修改但需要增强”的问题，可以按下面的顺序缩小方案范围：

1. **定位目标行为**：从 DAO、ORM、DataSource、Connection 到 Driver，确认行为在哪一层发生
2. **明确可控范围**：把权限、配置归属和兼容性约束逐项列出，再排除无法实施的入口
3. **追踪对象构造**：确认包装对象何时创建、是否存在可拦截的方法，以及类是否已经加载
4. **选择介入方式**：优先评估配置和代理；确实需要改写字节码时，再验证版本兼容、加载顺序与运行权限

本文的解法是一个特定实例，但这套决策路径是通用的。下次遇到"这段代码我不能碰，但我需要改变它的行为"时，不妨沿着这条路径走一遍——答案往往藏在继承链或依赖关系图的某个节点上。
