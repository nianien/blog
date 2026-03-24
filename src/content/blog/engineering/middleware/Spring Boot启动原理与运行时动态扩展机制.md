---
title: "Spring Boot启动原理与运行时动态扩展机制"
pubDate: "2024-02-15"
description: "Spring Boot 的启动流程、动态注册与热更新，本质上是同一个问题的三层回答：如何在不同时间窗口内修改容器状态？本文从源码级别剖析每个机制的设计决策与代价，帮助建立对 Spring 扩展体系的完整心智模型。"
tags: ["Spring Boot", "Spring Cloud", "Java", "源码分析", "动态扩展"]
author: "skyfalling"
---

> Spring Boot 的"约定优于配置"背后是一套精密的启动和扩展机制。但仅仅知道"发生了什么"是不够的——理解每个机制**为什么这样设计、代价是什么、边界在哪里**，才是深入掌握 Spring 生态的关键。

本文从三个层面剖析 Spring 的扩展体系：启动流程、运行时动态注册、热更新。它们看似独立，实则共同回答一个核心问题：**如何在不同时间窗口内修改容器的状态？**

```
启动前  → spring.factories + @Conditional     → 声明式，零代码扩展
启动中  → BeanDefinitionRegistryPostProcessor → 编程式，享有完整生命周期
运行时  → DefaultListableBeanFactory 直接注册  → 编程式，绕开生命周期保证
配置变更 → ContextRefresher + RefreshScope     → 非破坏性，只重建受影响的部分
```

**越早介入，框架能提供的保证越多；越晚介入，调用者承担的责任越重。** 这条贯穿全文的线索，是理解 Spring 扩展体系的钥匙。


## 一、SpringApplication 启动全流程

### 1.1 入口分析

一个标准的 Spring Boot 应用入口：

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

`SpringApplication.run()` 内部分为两步：**构造 SpringApplication 对象** + **执行 run() 方法**。

```java
public static ConfigurableApplicationContext run(Class<?>[] primarySources, String[] args) {
    return new SpringApplication(primarySources).run(args);
}
```

### 1.2 构造阶段：初始化

`SpringApplication` 构造函数完成四项关键初始化：

```java
public SpringApplication(ResourceLoader resourceLoader, Class<?>... primarySources) {
    this.primarySources = new LinkedHashSet<>(Arrays.asList(primarySources));

    // 1. 推断应用类型
    this.webApplicationType = WebApplicationType.deduceFromClasspath();

    // 2. 加载 ApplicationContextInitializer
    setInitializers(getSpringFactoriesInstances(ApplicationContextInitializer.class));

    // 3. 加载 ApplicationListener
    setListeners(getSpringFactoriesInstances(ApplicationListener.class));

    // 4. 推断主类
    this.mainApplicationClass = deduceMainApplicationClass();
}
```

**应用类型推断**（`deduceFromClasspath()`）：

| 类型 | 判断依据 | 使用的 ApplicationContext |
|------|----------|-------------------------|
| `SERVLET` | classpath 中存在 `Servlet` 和 `ConfigurableWebApplicationContext` | `AnnotationConfigServletWebServerApplicationContext` |
| `REACTIVE` | classpath 中存在 `DispatcherHandler` 且无 `Servlet` | `AnnotationConfigReactiveWebServerApplicationContext` |
| `NONE` | 以上条件均不满足 | `AnnotationConfigApplicationContext` |

推断逻辑通过 `ClassUtils.isPresent()` 探测类是否存在，不实际加载类。

### 1.3 SPI 机制：spring.factories

`getSpringFactoriesInstances()` 是 Spring Boot 的核心扩展点，基于 **SpringFactoriesLoader** 从 `META-INF/spring.factories` 文件中加载实现类。

```properties
# META-INF/spring.factories 示例
org.springframework.context.ApplicationContextInitializer=\
    com.example.MyInitializer1,\
    com.example.MyInitializer2

org.springframework.context.ApplicationListener=\
    com.example.MyListener
```

加载流程：

```
SpringFactoriesLoader.loadFactoryNames(factoryType, classLoader)
    → 扫描所有 JAR 中的 META-INF/spring.factories
    → 按 factoryType 过滤
    → 实例化并排序（@Order）
```

这一机制是 Spring Boot **自动配置**的基础——`spring-boot-autoconfigure.jar` 的 `spring.factories` 中声明了所有自动配置类。

#### 设计洞察：为什么不用 Java 原生 SPI？

Java 自带 `ServiceLoader` 机制，Spring 为什么要"造轮子"？这背后有真实的设计决策。

**Java SPI 的局限**：`ServiceLoader` 是懒加载、顺序不可控、不支持按类型过滤、不支持 `@Order` 排序、每次调用都重新扫描且没有缓存。最关键的问题是——它是为**单一接口对应单一实现**设计的，而 Spring 需要一个**多接口、多实现、带排序、带缓存**的扩展注册中心。

**spring.factories 的本质**：它不是 Java SPI 的替代，而是一个**以文件为载体的全局扩展注册表**。它的设计允许任何 JAR 包声明自己对任意接口的实现，加载方不需要知道有哪些实现者——这是经典的"发现模式"（Discovery Pattern）。

**代价与演进**：`spring.factories` 把"自动配置类"和"普通扩展点"（Initializer、Listener、FailureAnalyzer 等）混在一个文件里，职责不清晰。Spring Boot 3.0 正是为此做了拆分——自动配置类迁移到更语义化的 `META-INF/spring/AutoConfiguration.imports`，`spring.factories` 只保留非自动配置的扩展点。这个演变本身就说明原设计有代价：**一个文件承载多种职责，最终需要拆开。**

### 1.4 run() 阶段：核心执行流程

```java
public ConfigurableApplicationContext run(String... args) {
    // 1. 创建 StopWatch 计时
    StopWatch stopWatch = new StopWatch();
    stopWatch.start();

    // 2. 获取 SpringApplicationRunListeners（通过 spring.factories）
    SpringApplicationRunListeners listeners = getRunListeners(args);
    listeners.starting();

    // 3. 准备环境（解析配置文件、环境变量、命令行参数）
    ConfigurableEnvironment environment = prepareEnvironment(listeners, args);

    // 4. 打印 Banner
    printBanner(environment);

    // 5. 创建 ApplicationContext
    ConfigurableApplicationContext context = createApplicationContext();

    // 6. 准备 Context（应用 Initializer、注册主类为 Bean）
    prepareContext(context, environment, listeners, args);

    // 7. 刷新 Context（核心：触发自动配置、Bean 实例化）
    refreshContext(context);

    // 8. 后置处理
    afterRefresh(context, args);

    stopWatch.stop();
    listeners.started(context);

    // 9. 执行 CommandLineRunner / ApplicationRunner
    callRunners(context, args);

    listeners.running(context);
    return context;
}
```

**关键步骤详解**：

| 步骤 | 核心动作 | 说明 |
|------|----------|------|
| `prepareEnvironment` | 合并配置源 | 系统属性 → 环境变量 → application.yml → 命令行参数 |
| `createApplicationContext` | 根据应用类型创建 Context | Servlet / Reactive / None |
| `prepareContext` | 执行所有 `ApplicationContextInitializer` | 在 `refresh()` 之前的扩展点 |
| `refreshContext` | 调用 `AbstractApplicationContext.refresh()` | 触发 BeanDefinition 加载、自动配置、Bean 实例化 |
| `callRunners` | 执行 `CommandLineRunner` / `ApplicationRunner` | 应用启动后的初始化逻辑 |

### 1.5 refresh()：Spring 最核心的方法

上表中 `refreshContext` 一行看似轻描淡写，但 `AbstractApplicationContext.refresh()` 是整个 Spring 框架最核心的方法——十三个步骤里藏着 Spring 最重要的设计决策：

```java
public void refresh() {
    prepareRefresh();                       // 1. 准备环境
    ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();
    prepareBeanFactory(beanFactory);        // 2. 配置 BeanFactory 标准特性
    postProcessBeanFactory(beanFactory);    // 3. 子类扩展点

    invokeBeanFactoryPostProcessors(beanFactory);  // 4. 执行 BeanFactoryPostProcessor
    registerBeanPostProcessors(beanFactory);       // 5. 注册 BeanPostProcessor

    initMessageSource();                    // 6. 国际化
    initApplicationEventMulticaster();      // 7. 事件广播器
    onRefresh();                            // 8. 子类扩展（如创建 Web Server）
    registerListeners();                    // 9. 注册事件监听器

    finishBeanFactoryInitialization(beanFactory);   // 10. 实例化所有非懒加载单例
    finishRefresh();                        // 11. 发布 ContextRefreshedEvent
}
```

#### 设计洞察：两阶段设计——注册与实例化分离

这段代码最值得深挖的是步骤 4-5 和步骤 10 之间的分离：**为什么 Spring 要把 Bean 的注册（BeanDefinition）和实例化（getBean）分开？**

这个设计解决了一个真实的"鸡生蛋"问题：`BeanPostProcessor` 本身也是 Bean，但它要对所有其他 Bean 的创建过程施加影响。如果边注册边实例化，`BeanPostProcessor` 就无法在所有 Bean 实例化之前就绪——因为它自己还没被创建。

两阶段设计让框架可以：
1. **步骤 4-5**：先完整地扫描、注册所有 BeanDefinition，然后单独实例化并注册所有 `BeanPostProcessor`
2. **步骤 10**：在所有 PostProcessor 就绪后，再按依赖顺序实例化剩余 Bean，保证每个 Bean 都能被所有 PostProcessor 处理

**这个决策的代价**：启动速度慢（必须全量扫描后才能开始实例化）、内存峰值高（所有 BeanDefinition 在实例化前就驻留内存）。GraalVM Native Image 编译 Spring 应用时，正是要在编译期完成这个扫描过程，才能消除运行时的反射开销和扫描延迟。

### 1.6 自动配置原理

`@SpringBootApplication` 是三个注解的组合：

```java
@SpringBootConfiguration    // 等同于 @Configuration
@EnableAutoConfiguration    // 启用自动配置
@ComponentScan              // 包扫描
```

`@EnableAutoConfiguration` 通过 `@Import(AutoConfigurationImportSelector.class)` 触发自动配置类的加载：

```
AutoConfigurationImportSelector
    → SpringFactoriesLoader.loadFactoryNames(EnableAutoConfiguration.class)
    → 从 spring.factories 中读取所有自动配置类
    → 根据 @Conditional 系列注解过滤
    → 注册为 BeanDefinition
```

**@Conditional 条件注解**：

| 注解 | 生效条件 |
|------|----------|
| `@ConditionalOnClass` | classpath 中存在指定类 |
| `@ConditionalOnMissingClass` | classpath 中不存在指定类 |
| `@ConditionalOnBean` | 容器中存在指定 Bean |
| `@ConditionalOnMissingBean` | 容器中不存在指定 Bean |
| `@ConditionalOnProperty` | 配置属性满足指定条件 |
| `@ConditionalOnWebApplication` | 当前是 Web 应用 |

这就是"约定优于配置"的实现原理——当你引入 `spring-boot-starter-web` 时，classpath 中出现了 `DispatcherServlet`，`@ConditionalOnClass(DispatcherServlet.class)` 的自动配置类自动生效，无需手动配置。


## 二、运行时动态 Bean 注册

Spring 容器的 Bean 注册通常在启动阶段完成（XML、`@Component`、`@Bean`）。但某些场景需要在运行时动态注册 Bean。

### 2.1 BeanDefinitionRegistryPostProcessor

这是 Spring 提供的**最规范的动态注册扩展点**，在所有常规 BeanDefinition 加载完成后、Bean 实例化之前执行——恰好处于 `refresh()` 的步骤 4。

```java
@Component
public class DynamicBeanRegistrar implements BeanDefinitionRegistryPostProcessor {

    @Override
    public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
        // 根据配置决定注册哪个实现
        String implType = System.getProperty("dao.type", "jpa");

        GenericBeanDefinition definition = new GenericBeanDefinition();
        if ("mybatis".equals(implType)) {
            definition.setBeanClass(MyBatisUserDao.class);
        } else {
            definition.setBeanClass(JpaUserDao.class);
        }
        definition.setScope(BeanDefinition.SCOPE_SINGLETON);
        definition.setLazyInit(false);
        definition.setAutowireCandidate(true);

        registry.registerBeanDefinition("userDao", definition);
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory factory) {
        // 可选：对 BeanFactory 进行后处理
    }
}
```

**适用场景**：

- 根据配置动态选择接口实现（如数据源、DAO 层实现）
- 框架内部根据元数据批量注册 Bean

因为在 `refresh()` 的两阶段设计中处于"注册阶段"，通过这种方式注册的 Bean 会走完整的生命周期——所有 `BeanPostProcessor` 都会生效，和静态声明的 Bean 没有区别。

### 2.2 DefaultListableBeanFactory 直接注册

在应用运行过程中（Context 已刷新完成），可以通过 `DefaultListableBeanFactory` 直接注册 Bean：

```java
@Component
public class RuntimeBeanRegistrar implements ApplicationContextAware {

    private ApplicationContext applicationContext;

    @Override
    public void setApplicationContext(ApplicationContext ctx) {
        this.applicationContext = ctx;
    }

    public void registerBean(String name, Class<?> beanClass, Object... constructorArgs) {
        DefaultListableBeanFactory factory =
            (DefaultListableBeanFactory) ((ConfigurableApplicationContext) applicationContext)
                .getBeanFactory();

        BeanDefinitionBuilder builder = BeanDefinitionBuilder
            .genericBeanDefinition(beanClass);

        builder.addPropertyValue("name", "dynamicValue");
        builder.addPropertyReference("dependency", "existingBean");
        builder.setScope(BeanDefinition.SCOPE_SINGLETON);

        factory.registerBeanDefinition(name, builder.getBeanDefinition());
    }

    public void removeBean(String name) {
        DefaultListableBeanFactory factory =
            (DefaultListableBeanFactory) ((ConfigurableApplicationContext) applicationContext)
                .getBeanFactory();
        factory.removeBeanDefinition(name);
    }
}
```

#### 设计洞察：绕开生命周期的真实代价

运行时注册绕开了 `refresh()` 的两阶段保护，这带来几个具体风险：

**1. 生命周期不完整**：运行时注册的 Bean 不会经过已完成的 `BeanPostProcessor` 链路。如果这个 Bean 依赖 AOP 增强（如 `@Transactional`、`@Async`），增强不会自动生效。需要手动调用 `initializeBean()` 来触发初始化回调，但即便如此，某些在 `refresh()` 期间一次性设置的 PostProcessor 状态也无法回溯。

**2. 线程安全风险**：`DefaultListableBeanFactory` 的 `beanDefinitionMap`（ConcurrentHashMap）本身是线程安全的，但 `beanDefinitionNames`（ArrayList）不是。运行时注册会修改这个列表，如果同时有请求正在遍历容器获取 Bean（如 `getBeansOfType()`），就会触发 `ConcurrentModificationException`。Spring 在 `refresh()` 期间用 `synchronized` 块保护这些操作，但运行时注册绕开了这套保护。

**3. 引用悬空**：移除 Bean 时，已注入该 Bean 的其他对象手里拿的还是旧引用——Java 没有"引用更新"的机制。被移除的 Bean 实例不会被 GC 回收（因为还被其他 Bean 引用），形成事实上的内存泄漏。

### 2.3 两种方式的对比

| 维度 | BeanDefinitionRegistryPostProcessor | DefaultListableBeanFactory |
|------|-------------------------------------|---------------------------|
| 执行时机 | 启动阶段（refresh 第 4 步） | 运行时（任意时刻） |
| 生命周期 | 完整（所有 PostProcessor 均生效） | 不完整（需手动管理） |
| 线程安全 | 高（Spring 框架保证单线程执行） | 低（需自行加锁保护） |
| 适用场景 | 启动时根据条件选择实现 | 运行时插件化加载 |
| 框架保证 | 全量 | 几乎没有 |

> **选择建议：能在启动阶段注册的，绝不要推到运行时。** 启动阶段的扩展机制（`BeanDefinitionRegistryPostProcessor`、`@Conditional`）是 Spring 投入最多工程精力保护的路径，用它们出问题的概率最低。


## 三、Spring Cloud 热更新机制

Spring Cloud 的热更新允许在不重启应用的情况下，动态刷新配置和重建 Bean——这是对运行时动态扩展的一种**受控实现**，比直接操作 `BeanFactory` 安全得多。

### 3.1 触发方式

| 方式 | 说明 |
|------|------|
| `/actuator/refresh` 端点 | 手动 POST 触发 |
| Spring Cloud Bus | 通过 MQ 广播 `RefreshRemoteApplicationEvent`，集群统一刷新 |
| Spring Cloud Config Monitor | 配置仓库（Git）的 Webhook 自动触发 |

### 3.2 ContextRefresher 执行流程

当收到刷新事件时，`ContextRefresher.refresh()` 编排整个刷新过程：

```java
public synchronized Set<String> refresh() {
    // 1. 刷新 Environment：重新加载配置源
    Set<String> keys = refreshEnvironment();

    // 2. 刷新 RefreshScope：销毁并重建作用域内的 Bean
    this.scope.refreshAll();

    return keys;
}
```

**Step 1：refreshEnvironment()**

```
1. 提取当前 Environment 的所有属性源（排除系统属性、环境变量等标准源）
2. 创建一个临时的 SpringApplication（仅加载 BootstrapApplicationListener 和
   ConfigFileApplicationListener）
3. 运行临时 Application 以重新加载配置文件
4. 将新的属性源替换到当前 Environment
5. 对比新旧属性，返回变更的 Key 集合
6. 发布 EnvironmentChangeEvent
```

**Step 2：EnvironmentChangeEvent 的处理**

`EnvironmentChangeEvent` 触发两个动作：

| 处理器 | 动作 |
|--------|------|
| `ConfigurationPropertiesRebinder` | 重新绑定所有 `@ConfigurationProperties` Bean |
| `LoggingRebinder` | 根据新配置重置日志级别 |

**ConfigurationPropertiesRebinder 的实现**：

```java
// 简化后的核心逻辑
public void rebind(String beanName) {
    // 1. 获取目标 Bean（处理 CGLIB 代理）
    Object bean = applicationContext.getBean(beanName);
    if (AopUtils.isCglibProxy(bean)) {
        bean = getTargetObject(bean);
    }

    // 2. 销毁 Bean（触发 @PreDestroy）
    applicationContext.getAutowireCapableBeanFactory().destroyBean(bean);

    // 3. 重新初始化 Bean（重新绑定属性 + 触发 @PostConstruct）
    applicationContext.getAutowireCapableBeanFactory().initializeBean(bean, beanName);
}
```

`initializeBean()` 内部执行完整的 Bean 初始化生命周期：

```
applyBeanPostProcessorsBeforeInitialization  → 前置处理
    → invokeInitMethods（@PostConstruct / InitializingBean.afterPropertiesSet）
        → applyBeanPostProcessorsAfterInitialization  → 后置处理
```

这意味着 `@ConfigurationProperties` Bean 的属性会被重新从 Environment 中绑定，`@PostConstruct` 会重新执行。

### 3.3 @RefreshScope 原理

`@RefreshScope` 是 Spring Cloud 提供的一个自定义 Scope，它的核心机制是**懒初始化 + 缓存 + 代理**。

```java
@RefreshScope
@Component
public class DynamicConfig {
    @Value("${app.feature.enabled}")
    private boolean featureEnabled;
}
```

**基本流程**：

```
正常状态：
  第一次 getBean() → 创建实例 → 缓存在 RefreshScope 的 cache 中
  后续 getBean()   → 直接返回缓存实例

刷新时（refreshAll）：
  清空 RefreshScope 的 cache
  发布 RefreshScopeRefreshedEvent
  下一次 getBean() → 重新创建实例（读取最新配置）→ 放入缓存
```

```java
// RefreshScope 的简化实现
public class RefreshScope extends GenericScope {
    private final Map<String, Object> cache = new ConcurrentHashMap<>();

    @Override
    public Object get(String name, ObjectFactory<?> objectFactory) {
        return cache.computeIfAbsent(name, k -> objectFactory.getObject());
    }

    public void refreshAll() {
        cache.clear();  // 清空缓存，下次访问时重新创建
        publishEvent(new RefreshScopeRefreshedEvent());
    }
}
```

#### 设计洞察：代理为什么是必要的

上面的缓存机制有一个根本问题：假设 Bean A 依赖了 `@RefreshScope` 的 Bean B。刷新发生时，B 被销毁重建，但 A 手里拿的还是旧的 B 实例——**Java 没有"引用更新"的机制，A 的字段指向的对象不会自动变成新的 B。**

Spring 的解法是：**A 拿到的不是真正的 B，而是 B 的 CGLIB 代理。** 每次调用代理上的方法，代理都去 `RefreshScope` 的缓存里查当前的真实实例，再把方法调用转发过去。刷新后缓存里换了新实例，代理的转发目标自动改变，A 完全感知不到切换。

**这个设计的代价**：

1. **性能开销**：所有方法调用都多了一次缓存查找和方法转发
2. **final 限制**：final 类和 final 方法无法被 CGLIB 代理，`@RefreshScope` 不能用在它们上面
3. **PostProcessor 排除**：`@RefreshScope` 不能用在 `BeanPostProcessor` 上——因为代理创建本身依赖 PostProcessor 链已经就绪，形成循环依赖
4. **序列化问题**：代理对象的序列化行为和真实对象不同，在需要序列化 Bean 的场景（如 Session 存储）会出问题

这些限制在生产中是真实会踩的坑，但在大多数文档和教程里完全没有提及。

### 3.4 @ConfigurationProperties vs @RefreshScope

| 维度 | @ConfigurationProperties + Rebind | @RefreshScope |
|------|----------------------------------|---------------|
| 刷新方式 | 同一实例重新绑定属性 | 销毁旧实例，创建新实例 |
| Bean 引用 | 引用不变（同一对象） | 通过 CGLIB 代理间接引用 |
| 适用场景 | 配置属性类（结构化绑定） | 需要完全重建的 Bean |
| 开销 | 低（属性重新绑定） | 中（实例重建 + 代理转发） |
| 限制 | 只能刷新属性，初始化逻辑不重新执行 | final 类不可用，不能用于 PostProcessor |

**选择建议**：

- 纯配置类优先使用 `@ConfigurationProperties`，属性变更时自动 Rebind，无需代理
- 包含初始化逻辑的 Bean（如连接池、客户端实例），使用 `@RefreshScope` 确保完全重建

### 3.5 热更新的边界

热更新不是万能的，以下场景无法通过刷新解决：

| 场景 | 原因 |
|------|------|
| 新增自动配置类 | `@Conditional` 只在启动时评估一次 |
| 数据源切换 | 连接池需要关闭旧连接、建立新连接，通常需要重启 |
| Bean 定义变更 | 新增/删除 Bean 不会被刷新机制处理 |
| 第三方库配置 | 非 Spring 管理的组件不受刷新影响 |

> 这张表印证了开头的核心论点：**热更新只能修改"运行时状态"，不能修改"启动时决策"。** `@Conditional` 的评估、Bean 的注册、自动配置类的筛选——这些都是启动时一次性完成的，运行时无法回溯。


## 统一视角：时间窗口与控制力的递减

回到开头的问题——Spring 如何在不同时间窗口内修改容器状态？把四种机制放在一起，可以看到一条清晰的**控制力递减曲线**：

```
┌────────────┬──────────────────────┬──────────────────┬──────────────┐
│  时间窗口  │       机制           │    框架保证      │   调用者责任 │
├────────────┼──────────────────────┼──────────────────┼──────────────┤
│ 启动前     │ spring.factories     │ 完整扫描+排序    │ 只需声明     │
│            │ @Conditional         │ +条件过滤        │              │
├────────────┼──────────────────────┼──────────────────┼──────────────┤
│ 启动中     │ BeanDefinitionReg-   │ 完整生命周期     │ 编写注册逻辑 │
│            │ istryPostProcessor   │ +PostProcessor链 │              │
├────────────┼──────────────────────┼──────────────────┼──────────────┤
│ 运行时     │ DefaultListable-     │ 几乎没有         │ 线程安全     │
│            │ BeanFactory          │                  │ +生命周期管理│
│            │                      │                  │ +引用一致性  │
├────────────┼──────────────────────┼──────────────────┼──────────────┤
│ 配置变更   │ ContextRefresher     │ 受控的部分重建   │ 理解代理限制 │
│            │ + RefreshScope       │ +代理透明切换    │ +识别边界    │
└────────────┴──────────────────────┴──────────────────┴──────────────┘
```

Spring 的设计意图很明确：**尽量把扩展推到更早的阶段。** 启动前的声明式扩展（`spring.factories` + `@Conditional`）是框架投入最多工程精力的路径——零代码、自动排序、条件过滤、完整生命周期，什么都帮你做好了。启动中的编程式扩展（`BeanDefinitionRegistryPostProcessor`）次之，框架仍然保证完整的生命周期。到了运行时，框架能提供的保证骤然下降，线程安全、引用一致性、生命周期回调全部需要调用者自己负责。

热更新（`ContextRefresher` + `@RefreshScope`）是一个折中：它不是让你自由地修改容器，而是在严格限定的范围内（配置属性 + RefreshScope Bean）提供受控的重建能力。代理机制解决了引用一致性问题，缓存机制保证了线程安全，但代价是 final 限制、性能开销和适用范围的局限。

理解这条控制力递减曲线，在面对"应该在什么时机做这个扩展"的问题时，选择就清晰了——**默认选最早的、框架保证最多的那个时间窗口，只在确实需要时才降级到更晚的阶段。**
