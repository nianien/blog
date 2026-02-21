---
title: "Spring Boot启动原理与运行时动态扩展机制"
pubDate: "2024-02-15"
description: "从源码级别剖析Spring Boot的启动全流程，涵盖SpringApplication构造、自动配置加载、SPI扩展机制，以及运行时动态Bean注册与Spring Cloud热更新的实现原理。"
tags: ["Spring Boot", "Spring Cloud", "Java", "源码分析", "动态扩展"]
---

# Spring Boot启动原理与运行时动态扩展机制

> Spring Boot 的"约定优于配置"背后是一套精密的启动和扩展机制。理解 `SpringApplication` 的启动全流程、SPI 加载原理和运行时动态扩展手段，是深入掌握 Spring 生态的关键。

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

### 1.5 自动配置原理

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

这是 Spring 提供的**最规范的动态注册扩展点**，在所有常规 BeanDefinition 加载完成后、Bean 实例化之前执行。

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

        // 设置属性
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

**注意事项**：

- 运行时注册的 Bean 不会触发已完成的 `BeanPostProcessor` 链路
- 如需完整的生命周期管理，应确保在注册后手动触发初始化
- 移除 Bean 时，已注入该 Bean 的其他对象不会自动更新引用

### 2.3 两种方式的对比

| 维度 | BeanDefinitionRegistryPostProcessor | DefaultListableBeanFactory |
|------|-------------------------------------|---------------------------|
| 执行时机 | 启动阶段（refresh 之前） | 运行时（任意时刻） |
| 生命周期 | 完整（所有 PostProcessor 均生效） | 不完整（需手动管理） |
| 安全性 | 高（Spring 框架保证） | 中（需自行处理线程安全和依赖） |
| 适用场景 | 启动时根据条件选择实现 | 运行时插件化加载 |

## 三、Spring Cloud 热更新机制

Spring Cloud 的热更新允许在不重启应用的情况下，动态刷新配置和重建 Bean。

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

`@RefreshScope` 是 Spring Cloud 提供的一个自定义 Scope，它的核心机制是**懒初始化 + 缓存**。

```java
@RefreshScope
@Component
public class DynamicConfig {
    @Value("${app.feature.enabled}")
    private boolean featureEnabled;
}
```

**原理**：

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

### 3.4 @ConfigurationProperties vs @RefreshScope

| 维度 | @ConfigurationProperties + Rebind | @RefreshScope |
|------|----------------------------------|---------------|
| 刷新方式 | 同一实例重新绑定属性 | 销毁旧实例，创建新实例 |
| Bean 引用 | 引用不变 | 通过代理间接引用，引用不变 |
| 适用场景 | 配置属性类（结构化绑定） | 需要完全重建的 Bean |
| 开销 | 低（属性重新绑定） | 中（实例重建） |

**选择建议**：

- 纯配置类优先使用 `@ConfigurationProperties`，属性变更时自动 Rebind
- 包含初始化逻辑的 Bean（如连接池、客户端实例），使用 `@RefreshScope` 确保完全重建

### 3.5 热更新的边界

热更新不是万能的，以下场景无法通过刷新解决：

| 场景 | 原因 |
|------|------|
| 新增自动配置类 | `@Conditional` 只在启动时评估一次 |
| 数据源切换 | 连接池需要关闭旧连接、建立新连接，通常需要重启 |
| Bean 定义变更 | 新增/删除 Bean 不会被刷新机制处理 |
| 第三方库配置 | 非 Spring 管理的组件不受刷新影响 |

## 总结

Spring Boot 的启动和扩展机制可以按三个层次理解：

1. **启动层**：`SpringApplication` 构造阶段通过 SPI 加载初始化器和监听器，`run()` 阶段通过 `@EnableAutoConfiguration` + `@Conditional` 实现自动配置。核心入口是 `spring.factories`
2. **静态扩展**：`BeanDefinitionRegistryPostProcessor` 在启动阶段根据运行时条件动态注册 Bean，享有完整的 Bean 生命周期
3. **运行时扩展**：Spring Cloud 的 `ContextRefresher` 通过重新加载 Environment + Rebind `@ConfigurationProperties` + 清空 `@RefreshScope` 缓存，实现不停机的配置热更新

> Spring Boot 的设计哲学是"约定优于配置"，但其扩展点设计遵循的是"开放封闭原则"——框架的核心流程是封闭的，但每个关键节点都预留了开放的扩展接口（Initializer、PostProcessor、Listener、Scope）。理解这些扩展点的执行时机和作用范围，是高效使用 Spring 生态的前提。
