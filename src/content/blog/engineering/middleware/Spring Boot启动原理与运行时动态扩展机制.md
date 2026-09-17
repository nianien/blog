---
title: "Spring Boot启动原理与运行时动态扩展机制"
pubDate: "2024-02-15"
description: "Spring Boot 的启动流程、动态注册与热更新，本质上是同一个问题的三层回答：如何在不同时间窗口内修改容器状态？本文从源码级别剖析每个机制的设计决策与代价，帮助建立对 Spring 扩展体系的完整心智模型。"
tags: ["Spring Boot", "Spring Cloud", "Java", "源码分析", "动态扩展"]
author: "skyfalling"
---

Spring Boot 的启动流程、动态注册与配置刷新，共同回答一个问题：**在什么时间修改哪一种容器状态，才能让依赖它的对象正确地使用变化？**

这里最容易混淆三件事：注册 BeanDefinition、创建 Bean 实例、更新已有调用方持有的引用。前两件可以由容器完成，第三件通常还需要代理或业务路由机制。

本文以 Spring Boot 3.2、Spring Framework 6.1 和相应 Spring Cloud 2023.0 系列为理解基线。旧版本的 spring.factories 自动配置发现、Bootstrap 配置刷新路径会单独说明；下文流程是职责归纳，不把不同版本源码拼接成同一个实现。

## 启动时先建立环境，再建立对象关系

典型入口保持简单：

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

run 的工作可以按依赖顺序理解：

| 阶段 | 主要职责 |
| --- | --- |
| 准备启动对象 | 保存主配置来源、选择应用类型、加载相应扩展 |
| 准备 Environment | 合并属性源，并按优先级决定实际配置值 |
| 创建与准备 Context | 选择上下文类型、应用 Initializer、加载初始定义 |
| refresh | 执行定义后处理、注册实例后处理器、创建所需单例 |
| 启动回调 | 执行 ApplicationRunner/CommandLineRunner，推进就绪状态 |

应用类型推断不只是“有 Servlet 就一定选 Servlet”：探测条件与优先级依具体版本，也可由配置覆盖。ClassUtils.isPresent 可以在不初始化类的情况下探测可加载性，但不等于完全不加载类。

配置也不是把“系统属性→环境变量→文件→命令行”当作一条固定时序即可理解。多个来源提供同名键时，最终值由属性源优先级决定，profile、导入和测试配置还会影响结果。排障应检查最终 Environment 及来源。

## 扩展发现：spring.factories 与自动配置文件分工

spring.factories 为某类扩展维护实现列表，例如 ApplicationContextInitializer、ApplicationListener。Spring 的加载代码可以按扩展类型获取实现，并结合框架排序机制组织执行。

这不意味着 Java ServiceLoader 只支持单一实现或没有缓存。ServiceLoader 本就能发现同一服务的多个提供者，并在实例内维护加载缓存；Spring 选择自己的机制，是为了契合其扩展登记和实例化需求。[ServiceLoader API](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ServiceLoader.html)

自动配置的入口需要区分版本：

| 版本范围 | 自动配置候选登记 |
| --- | --- |
| 较早的 Boot 2.x | spring.factories 的 EnableAutoConfiguration 项 |
| Boot 2.7 迁移期 | 引入 AutoConfiguration.imports，兼容旧入口 |
| Boot 3.x | 使用 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports |

完整路径中的 org.springframework.boot.autoconfigure 不能省掉。文件每行登记一个自动配置类；候选类还要经过条件与排序处理，并非出现在文件中就必定创建所有 Bean。[自动配置登记](https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html)

ConditionalOnClass 检查类可用性，ConditionalOnProperty 检查属性条件，ConditionalOnMissingBean 结合当时已处理的定义判断是否补齐默认实现。因此自动配置应安排在用户定义有机会生效之后，而不能把条件当成与处理顺序无关的静态布尔值。

## refresh 为什么分开处理定义与实例

BeanDefinition 描述如何构造对象，Bean 实例才是参与运行的对象。将两者分开，允许容器先处理定义，再对普通 Bean 应用已注册的 BeanPostProcessor。

| 扩展点 | 主要操作对象 |
| --- | --- |
| BeanDefinitionRegistryPostProcessor | 增加或调整 BeanDefinition |
| BeanFactoryPostProcessor | 调整工厂中的定义元数据 |
| BeanPostProcessor | 参与对象初始化前后处理，可返回代理 |
| 初始化与销毁回调 | 管理实例自身资源和状态 |

这不是“完整扫描全部定义后才创建第一个对象”的绝对规则。后处理器自己以及它们提前请求的依赖可能较早实例化，进而无法被尚未注册的处理器处理。所以应避免在定义处理阶段随意调用 getBean 创建业务对象。

AOT 可以提前分析并生成部分注册代码，但仍有运行时初始化和资源建立；不能说编译为 native image 就自动消除了所有反射、生命周期或启动成本。

## 启动期动态注册：让正常创建链路接手

如果实现选择在启动时已经确定，可以用条件配置；需要根据元数据批量登记对象时，可以使用 BeanDefinitionRegistryPostProcessor。

下面是局部示例，JpaUserDao/MyBatisUserDao 是项目中已有的实现类。它选择并登记定义，不在此阶段创建 DAO：

```java
@Component
public class DynamicBeanRegistrar implements BeanDefinitionRegistryPostProcessor {
    @Override
    public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
        Class<?> impl = "mybatis".equals(System.getProperty("dao.type"))
                ? MyBatisUserDao.class : JpaUserDao.class;
        GenericBeanDefinition definition = new GenericBeanDefinition();
        definition.setBeanClass(impl);
        definition.setScope(BeanDefinition.SCOPE_SINGLETON);
        registry.registerBeanDefinition("userDao", definition);
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory factory) {
    }
}
```

实际项目还要避免与已有 userDao 重名。之后由容器按正常路径创建它，才有机会进行依赖注入、初始化和适用的 AOP 增强；“参与完整链路”也不意味着它必然满足每一个切面的匹配条件。

## 运行时注册：生命周期仍在，装配决策不会重放

DefaultListableBeanFactory 可以注册新的定义。之后通过 getBean 创建该对象，**已有的 BeanPostProcessor 仍会参与**，不能声称运行时定义天然绕过 AOP 和初始化。

与此不同，registerSingleton 直接登记一个现成对象，不会自动替它补齐常规创建和初始化过程。只调用 initializeBean 也不等于完成构造与依赖注入，且要使用它返回的对象，因为返回值可能是代理。

以下示例限定在受控、没有并发访问的演示阶段，不能作为线上热插拔方案：

```java
DefaultListableBeanFactory factory =
        (DefaultListableBeanFactory) context.getBeanFactory();
BeanDefinitionBuilder builder = BeanDefinitionBuilder.genericBeanDefinition(beanClass);
for (Object argument : constructorArgs) {
    builder.addConstructorArgValue(argument);
}
factory.registerBeanDefinition(name, builder.getBeanDefinition());
Object created = context.getBean(name);
```

context 是 ConfigurableApplicationContext，beanClass/name/constructorArgs 是调用方已确认的注册参数。注册后创建与登记定义是两个动作，不能靠 unused 参数伪装成已配置构造器。

运行期真正增加的责任包括：

- 已有单例不会自动重新注入新 Bean，预先收集的列表、路由表也不会自动重建
- 新定义不自动重新触发所有启动时后处理器；例如新增配置类不能假定会再次经历完整配置类解析
- 删除定义可能销毁关联单例，但其他对象仍可能持有旧引用，继续使用已经关闭的资源
- 正在服务的工厂不应随意与注册修改并发交错；Spring 官方也不把这种用法作为受支持的通用运行模式

这些边界不能简化为“内部 ArrayList 没加锁，所以一定抛 ConcurrentModificationException”。实现中存在相应同步和复制处理，风险来自整体装配与并发契约，而非看到某个容器类型就能确定。[Bean 登记说明](https://docs.spring.io/spring-framework/reference/core/beans/definition.html)

需要频繁切换插件时，可以让稳定 Bean 持有受控的业务实现注册表，明确新请求何时转向新版本、旧请求何时排空、旧资源何时释放。容器生命周期与业务切换协议分别处理，边界更容易验证。

## 配置刷新分为属性变化与目标重建

Spring Cloud 的 ContextRefresher 负责刷新环境，并触发相关刷新处理。历史 Bootstrap 路径和 Config Data 路径的重载方式不同，不能统一解释成“总是启动一个临时 SpringApplication”。

EnvironmentChangeEvent 可触发配置属性重新绑定和日志配置更新，但并非所有对象都可重绑。不可变对象、构造器绑定方式、删除属性和组件缓存，都需要检查具体版本支持。

RefreshScope 解决的是另一件事：调用方持有稳定代理，实际目标对象由 scope 缓存管理。刷新时销毁并移除缓存目标，后续对代理的方法访问再按需要创建新的目标；不是每次 getBean 都取得一个裸对象，也不是 refreshAll 立即重新创建所有目标。[Spring Cloud Context](https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/application-context-services.html)

| 时点 | 调用方持有的引用 | 实际目标 |
| --- | --- | --- |
| 注入后、尚未调用 | 作用域代理 | 可以尚未创建 |
| 第一次调用 | 同一个代理 | 创建并缓存目标 |
| 刷新失效后 | 仍是代理 | 旧目标销毁，缓存失效 |
| 后续调用 | 仍是代理 | 按新环境创建目标 |

真实实现还要处理销毁回调、锁与事件，不能用 ConcurrentHashMap.clear 就宣称复现了 RefreshScope。

类代理的 final 方法不能按普通可覆盖方法增强。对连接池、客户端等资源，还要检查组件是否支持刷新、旧资源如何关闭，以及新旧配置切换的一致性；例如不能给任意数据源加上注解就保证安全切换。

## 不同刷新能力不能互相替代

| 机制 | 改变什么 | 不自动完成什么 |
| --- | --- | --- |
| 配置属性重绑 | 支持重绑的现有对象属性 | 任意依赖关系和配置类重解析 |
| RefreshScope | 通过代理管理目标失效与重建 | 所有业务对象的原子整体替换 |
| 运行期注册定义 | 新增可创建对象的描述 | 已有调用方引用切换 |
| 重启或重建上下文 | 重新执行更完整的装配流程 | 外部业务事务的自动迁移 |

配置重绑可能执行初始化处理，不能在前文介绍 initializeBean 后又写“重绑绝不会再次初始化”。Cloud Bus 广播刷新也不意味着所有实例在同一个原子时刻切换。

对于开关和只读参数，可以验证其可见性与生效时机；对于相互约束的多个参数，应考虑一次读取同一配置版本；对于客户端或连接池替换，则需要验证旧请求、失败回退和资源释放。刷新端点的暴露与访问权限也必须纳入部署配置。

选择扩展点时，优先放在信息已经齐备、依赖尚未固化的阶段。确实需要运行期变化时，再明确要更新的是定义、属性还是代理目标。这个区分比笼统地说“越晚生命周期越不完整”更能指导实现和排障。
