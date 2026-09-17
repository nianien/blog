---
title: "Java 核心技术：深入理解 JVM"
pubDate: "2021-06-15"
description: "系统剖析JVM核心机制，从类加载的双亲委派模型到运行时内存布局，区分历史实现与现代版本，解释垃圾回收、停顿与资源使用的关系，形成可验证的调优思路。"
tags: ["JVM", "Java", "垃圾回收", "类加载", "性能调优"]
series:
  key: "java-core"
---

> 排查 JVM 问题，要把类由谁加载、内存由谁持有、回收为何跟不上联系起来。程序退出不保证执行最后一次 GC；看见 GC 活跃也不等于已经找到内存增长的原因。

JVM（Java Virtual Machine）是 Java 生态的基石。它屏蔽了底层硬件差异，为 Java 程序提供了一个统一的运行时环境。但这层抽象并非没有代价——内存管理、类加载、即时编译等机制的复杂性，往往是生产环境问题的根源。

本文将沿着 Java 程序的执行链路，从类文件的加载、运行时内存的分配，到对象的回收，系统梳理 JVM 的核心机制。

本文将 JVM 规范与 HotSpot 实现分开讨论。类加载器和对象头的历史细节以 JDK 8 为例；涉及现代调优时以 JDK 21 为参考版本，并明确后续补充，避免把已移除组件当成当前选项。

## 一、类加载机制

### 1.1 类的生命周期

类的主要阶段如下。解析允许延迟进行，并非所有符号都必须在初始化前解析；类也不一定在进程结束前被卸载：

```
加载（Loading）→ 验证（Verification）→ 准备（Preparation）
    → 解析（Resolution）→ 初始化（Initialization）
        → 使用（Using）→ 卸载（Unloading）
```

其中，验证、准备、解析统称为**链接（Linking）**阶段。

| 阶段 | 核心动作 | 说明 |
|------|----------|------|
| **加载** | 读取 .class 字节流，生成 Class 对象 | 由 ClassLoader 执行 |
| **验证** | 校验字节码的合法性和安全性 | 文件格式、元数据、字节码、符号引用验证 |
| **准备** | 为类的静态变量分配内存并赋默认值 | 常规赋值在初始化阶段；常量变量还涉及 ConstantValue 属性规定的初始化 |
| **解析** | 将符号引用替换为直接引用 | 类、字段、方法、接口方法的解析 |
| **初始化** | 执行类构造器 `<clinit>()` | 静态变量赋值和静态代码块的执行 |

### 1.2 ClassLoader 体系

JDK 8 的典型 HotSpot 类加载器层级包含 Bootstrap、Extension 和 Application。JDK 9 起扩展机制被移除，Extension 对应角色由 Platform ClassLoader 接替，也不再使用 rt.jar 布局。以下表格和 Launcher 片段仅用于解释 JDK 8：

```
Bootstrap ClassLoader（引导类加载器）
    ↑ parent
Extension ClassLoader（扩展类加载器）
    ↑ parent
Application ClassLoader（应用类加载器）
    ↑ parent
Custom ClassLoader（自定义类加载器）
```

| ClassLoader | 实现语言 | 加载路径 | 说明 |
|-------------|----------|----------|------|
| **Bootstrap** | C/C++ | `$JAVA_HOME/lib`（rt.jar 等） | JVM 内部实现，Java 中无法直接引用（返回 null） |
| **Extension** | Java | `$JAVA_HOME/lib/ext` | `sun.misc.Launcher$ExtClassLoader` |
| **Application** | Java | classpath | `sun.misc.Launcher$AppClassLoader`，默认的类加载器 |

三者的关系通过 `sun.misc.Launcher` 的构造函数建立：

```java
public Launcher() {
    // 1. 创建 ExtClassLoader
    ExtClassLoader extClassLoader = ExtClassLoader.getExtClassLoader();
    // 2. 创建 AppClassLoader，parent 设为 ExtClassLoader
    AppClassLoader appClassLoader = AppClassLoader.getAppClassLoader(extClassLoader);
    // 3. 设置线程上下文类加载器为 AppClassLoader
    Thread.currentThread().setContextClassLoader(appClassLoader);
}
```

### 1.3 双亲委派模型

**核心规则**：当一个 ClassLoader 收到类加载请求时，首先将请求委派给父加载器处理，只有当父加载器无法完成加载时，才由自身尝试加载。

下面是省略锁、解析与异常声明的阅读伪代码，不是可直接编译的 ClassLoader 实现：

```text
protected Class<?> loadClass(String name, boolean resolve) {
    // 1. 检查类是否已被加载
    Class<?> c = findLoadedClass(name);
    if (c == null) {
        try {
            // 2. 委派给父加载器
            if (parent != null) {
                c = parent.loadClass(name, false);
            } else {
                // parent 为 null 表示委派给 Bootstrap
                c = findBootstrapClassOrNull(name);
            }
        } catch (ClassNotFoundException e) {
            // 父加载器无法加载
        }
        if (c == null) {
            // 3. 父加载器无法加载，自行加载
            c = findClass(name);
        }
    }
    return c;
}
```

**双亲委派的价值**：

- **安全性**：防止核心类库被篡改。即使自定义了一个 `java.lang.String`，也不会被加载，因为 Bootstrap ClassLoader 会优先加载 rt.jar 中的版本
- **共享核心类型**：委派可避免重复定义相同基础类；但 JVM 中类型身份由二进制名称和定义它的类加载器共同决定，同名类可由不同加载器分别定义。[JVMS 类加载规范](https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-5.html)

### 1.4 委派模型的扩展

父优先是常见策略，不是所有加载器都必须遵循的唯一组织方式。以下几种机制需要分别理解：

**场景一：SPI 机制**

Java SPI（Service Provider Interface）的典型问题：核心接口由 Bootstrap ClassLoader 加载（如 `java.sql.Driver`），但实现类在应用 classpath 下（如 MySQL 驱动），Bootstrap 无法向下委派。

解决方案：**线程上下文类加载器（Thread Context ClassLoader）**。

```java
// JDBC DriverManager 的实现
ServiceLoader<Driver> loadedDrivers = ServiceLoader.load(Driver.class);
// ServiceLoader.load() 内部使用 Thread.currentThread().getContextClassLoader()
// 由上下文加载器查找提供者，其加载类时仍可采用父优先委派
```

**场景二：热部署**

OSGi、Tomcat 等容器需要实现类的热替换。Tomcat 为每个 Web 应用创建独立的 ClassLoader（`WebAppClassLoader`），它对应用类可采用本地优先策略，但 Java 核心类及部分容器 API 有委派例外，不能理解为所有类都完全反转顺序。

**场景三：自定义 ClassLoader**

只重写 `findClass()` 会保留继承的父优先 `loadClass()` 流程，并未打破双亲委派。下面的局部示例省略了读取和解密方法，用于说明自定义字节来源：

```java
public class EncryptedClassLoader extends ClassLoader {
    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] encrypted = loadBytesFromDisk(name);
        byte[] decrypted = decrypt(encrypted);  // 解密 class 字节码
        return defineClass(name, decrypted, 0, decrypted.length);
    }
}
```

## 二、运行时内存模型

### 2.1 内存区域划分

JVM 运行时内存分为线程私有和线程共享两大类：

[![线程私有区域与共享区域分开；元空间和堆分代属于具体实现](/images/blog/jvm-runtime/runtime-areas.svg)](/images/blog/jvm-runtime/runtime-areas.svg)

| 区域 | 线程属性 | 存储内容 | 异常 |
|------|----------|----------|------|
| **程序计数器** | 私有 | 当前执行位置；执行 native 方法时规范不定义其值 | JVM 规范未为该区域规定 OOM 条件 |
| **虚拟机栈** | 私有 | 栈帧（局部变量表、操作数栈、方法返回地址） | StackOverflowError / OOM |
| **本地方法栈** | 私有 | Native 方法调用的栈帧 | StackOverflowError / OOM |
| **堆** | 共享 | 对象实例和数组 | OutOfMemoryError: Java heap space |
| **元空间** | 共享 | 类元数据、方法字节码、常量池 | OutOfMemoryError: Metaspace |

### 2.2 从 PermGen 到 Metaspace

HotSpot 的 Java 8 实现是类元数据存储的一个重要分水岭——**永久代（PermGen）被元空间（Metaspace）取代**。

**永久代的问题**：

- 容量受 `-XX:PermSize` / `-XX:MaxPermSize` 等配置约束，默认值与实现及平台相关，难以统一预估
- 类元数据与普通 Java 对象混在同一 GC 管理体系中，增加了 Full GC 的复杂度
- 动态生成类（如大量使用反射、动态代理）容易触发 `java.lang.OutOfMemoryError: PermGen space`

**元空间的设计**：

| 特性 | PermGen（Java 7-） | Metaspace（Java 8+） |
|------|--------------------|-----------------------|
| 存储位置 | HotSpot 管理的永久代区域，不计入普通对象堆的 Xmx | 本地内存（Native Memory） |
| 容量约束 | 受永久代配置与平台默认值限制 | 可由 MaxMetaspaceSize 限制，也受进程资源限制 |
| 内存分配 | 与堆对象相同的 GC 管理 | 每个 ClassLoader 独立分配，线性分配 |
| 回收策略 | 结合收集器进行类卸载 | 类加载器关联的元数据可在满足卸载条件时回收 |
| 调优参数 | `-XX:MaxPermSize` | `-XX:MaxMetaspaceSize`、`-XX:MetaspaceSize` |

**元空间的内存模型**：

每个 ClassLoader 拥有独立的内存块（chunk）。加载新类时，从当前 chunk 中线性分配空间。普通类的元数据生命周期通常与定义它们的加载器关联；隐藏类等特殊情况另有规则，不能概括为永远不存在单类卸载。

```
ClassLoader A → [chunk1: Class1 Class2 Class3]
ClassLoader B → [chunk2: Class4 Class5]
ClassLoader C → [chunk3: Class6]

当 ClassLoader B 被 GC → chunk2 整块释放
```

**压缩类指针空间（Compressed Class Space）**：

在 64 位 JVM 上，如果开启了压缩类指针（`-XX:+UseCompressedClassPointers`，默认开启），Metaspace 中的 `InstanceKlass`、`ArrayKlass` 及虚方法表会存储在一块独立的内存区域中。该区域大小通过 `-XX:CompressedClassSpaceSize` 控制（默认 1GB）。

### 2.3 对象的内存布局

一个 Java 对象在堆中的内存布局由三部分组成：

[![对象由对象头、实例数据和可选对齐填充组成，尺寸依配置而变](/images/blog/jvm-runtime/object-layout.svg)](/images/blog/jvm-runtime/object-layout.svg)

**传统 Mark Word 的简化结构**（JDK 8、64 位 HotSpot；不适用于所有后续锁实现或对象头模式）：

| 锁状态 | 存储内容 | 标志位 |
|--------|----------|--------|
| 无锁 | 对象哈希码（31bit）、GC 分代年龄（4bit） | 01 |
| 偏向锁 | 线程 ID（54bit）、Epoch（2bit）、GC 年龄 | 01 |
| 轻量级锁 | 指向栈中锁记录的指针 | 00 |
| 重量级锁 | 指向 Monitor 的指针 | 10 |
| GC 标记 | 空 | 11 |

注意：GC 分代年龄占 **4 bit**，最大值为 15。这约束了相关分代收集器的年龄表示范围。实际晋升可早于配置上限，默认值也与收集器有关。

## 三、垃圾回收

### 3.1 对象存活判定

在回收内存之前，JVM 首先需要判断哪些对象是"活"的，哪些是"死"的。

**引用计数法**

每个对象维护一个引用计数器：被引用时加 1，引用失效时减 1。计数为 0 的对象即可回收。

优点：实现简单，判定效率高。
缺陷：**无法解决循环引用问题**。

```java
// A 和 B 互相引用，但外部已无法访问
// 引用计数永远不为 0，无法被回收
class Node { Node field; }
Node a = new Node();  // 假设采用简单引用计数时为 1
Node b = new Node();  // 假设采用简单引用计数时为 1
a.field = b;              // b.refCount = 2
b.field = a;              // a.refCount = 2
a = null;                 // a.refCount = 1（仍不为 0）
b = null;                 // b.refCount = 1（仍不为 0）
```

**可达性分析（Reachability Analysis）**

JVM 实际采用的方案。从一组称为 **GC Roots** 的根对象出发，沿引用链向下遍历。不再从根可达的对象可以成为回收候选，还要结合引用类型和具体回收处理，不能理解为立刻释放。

GC Roots 包括：

| GC Root 类型 | 说明 |
|--------------|------|
| 虚拟机栈中的局部变量 | 方法正在执行时，栈帧中引用的对象 |
| 方法区中的静态变量 | 类的 `static` 字段引用的对象 |
| 方法区中的常量 | `static final` 引用的对象 |
| JNI 引用 | Native 方法持有的对象引用 |
| 活跃线程 | 所有存活的 Thread 对象 |
| 同步锁持有的对象 | 被 `synchronized` 锁定的对象 |

### 3.2 安全点与 Stop-The-World

部分 GC 阶段需要在一致状态下暂停应用线程，即 **Stop-The-World（STW）**。并发收集器可借助读写屏障和记录机制，让大部分标记或迁移工作与应用并行，不能说整个可达性分析过程都必须暂停。

但并非任何时刻都可以暂停线程。执行 Java 代码的线程会在合适位置配合 safepoint，处于某些阻塞或 native 状态的线程也可被视为已安全。检查位置依赖解释器、编译器和版本，常见位置包括：

- 方法调用处
- 循环的回边（back edge）
- 异常抛出处

JVM 使用**主动式中断**：GC 需要 STW 时，设置一个全局标志，各线程在安全点检查该标志，发现需要暂停则主动挂起。

### 3.3 GC 算法

四种基础 GC 算法，各有适用场景：

**标记-清除（Mark-Sweep）**

```
标记阶段：从 GC Roots 遍历，标记所有存活对象
清除阶段：遍历堆，回收未标记的对象
```

- 优点：实现简单
- 缺点：产生内存碎片，分配大对象时可能找不到连续空间

**标记-整理（Mark-Compact）**

```
标记阶段：同标记-清除
整理阶段：将所有存活对象向内存一端移动，然后清理边界外的空间
```

- 优点：无内存碎片
- 缺点：移动对象开销大，STW 时间更长

**复制算法（Copying）**

```
将内存分为两块：对象空间和空闲空间
GC 时将存活对象从对象空间复制到空闲空间，然后清空整个对象空间
两块空间角色互换
```

- 优点：无碎片、分配高效（指针碰撞）
- 缺点：可用内存减半

**分代收集（Generational Collection）**

基于"大多数对象朝生夕灭"的统计假设，将堆划分为新生代和老年代，针对不同代的特征选择不同算法：

```
新生代（Young Generation）：Eden : S0 : S1 = 8 : 1 : 1
    → 对象存活率低，使用复制算法

老年代（Old Generation）：
    → 对象存活率高，使用标记-清除或标记-整理算法
```

**新生代 GC（Minor GC）流程**：

```
1. 新对象分配在 Eden 区
2. Eden 满触发 Minor GC
3. 存活对象复制到 S0（Survivor From）
4. 下一次 Minor GC，Eden + S0 的存活对象复制到 S1，清空 Eden + S0
5. S0 和 S1 角色交换
6. 对象每经历一次 Minor GC，年龄 +1
7. 年龄达到阈值（默认 15）的对象晋升老年代
```

**晋升与特殊分配的影响因素**（具体规则依赖收集器，下列不能作为通用参数清单）：

- 大对象：部分收集器支持 PretenureSizeThreshold；不能将该参数套用于所有 GC
- 长期存活对象达到晋升条件，这属于经历回收后的晋升而非首次直接分配
- Survivor 空间中相同年龄对象总大小超过 Survivor 一半（动态年龄判定）
- Minor GC 后 Survivor 放不下的存活对象

### 3.4 垃圾收集器

下面保留历史收集器对照，用于读懂旧资料。可组合的范围有版本限制，整堆收集器也不是任意新老年代组合。CMS 已在 JDK 14 移除，不应再作为 JDK 21 的启动选项。[JDK 迁移说明](https://docs.oracle.com/en/java/javase/21/migrate/removed-tools-and-components.html)

| 收集器 | 分代 | 算法 | 线程 | 特点 |
|--------|------|------|------|------|
| **Serial** | 新生代 | 复制 | 单线程 | 简单高效，适合单核或小堆 |
| **ParNew** | 新生代 | 复制 | 多线程 | Serial 的多线程版本，能与 CMS 配合 |
| **Parallel Scavenge** | 新生代 | 复制 | 多线程 | 以吞吐量为目标，支持自适应调节 |
| **Serial Old** | 老年代 | 标记-整理 | 单线程 | Serial 的老年代版本 |
| **Parallel Old** | 老年代 | 标记-整理 | 多线程 | Parallel Scavenge 的老年代搭档 |
| **CMS** | 老年代 | 标记-清除 | 并发 | 以最短停顿为目标 |
| **G1** | 整堆 | 分区 + 复制/整理 | 并发 | 以停顿目标引导回收选择；JDK 9 起常见服务端配置默认 |

**CMS（Concurrent Mark Sweep）**

CMS 的设计目标是**最短回收停顿时间**。它采用标记-清除算法，GC 过程分为四个阶段：

| 阶段 | STW | 说明 |
|------|-----|------|
| 初始标记 | 是 | 仅标记 GC Roots 直接关联的对象，速度很快 |
| 并发标记 | 否 | 从初始标记的对象出发，遍历整个对象图 |
| 重新标记 | 是 | 修正并发标记期间因程序运行产生的引用变动 |
| 并发清除 | 否 | 清除不可达对象 |

CMS 将部分工作移到并发阶段，但重新标记或并发失败后的回退仍可能造成长停顿，不能保证两次 STW 都很短。

**CMS 的局限**：

- **CPU 敏感**：并发阶段占用 CPU 资源，核心数少时影响应用吞吐
- **浮动垃圾**：并发清除阶段新产生的垃圾只能等下次 GC
- **内存碎片**：标记-清除算法的固有问题

**G1（Garbage-First）**

G1 从 JDK 9 起成为常见服务端配置的默认收集器，它将堆划分为多个大小相等的 **Region**（Region 大小由堆规模和配置确定，通常以约 2048 个为选择目标，并非数量固定），每个 Region 可以动态充当 Eden、Survivor 或 Old 区。

[![G1 将堆划分为等大小 Region，角色包括 Eden、Survivor、Old 与 Humongous](/images/blog/jvm-runtime/g1-regions.svg)](/images/blog/jvm-runtime/g1-regions.svg)

G1 的核心优势：

| 特性 | 说明 |
|------|------|
| **停顿目标** | MaxGCPauseMillis 是软目标，G1 根据预测成本选择回收集合，不是延迟上限保证 |
| **疏散存活对象** | 回收集合中的存活对象复制到其他 Region；仍有 Region 尾部浪费和大对象连续空间约束 |
| **大对象处理** | 超过 Region 50% 的大对象分配在 Humongous Region |
| **混合回收** | Mixed GC 同时回收新生代和部分老年代 Region |

G1 的 GC 过程：

| 阶段 | STW | 说明 |
|------|-----|------|
| 初始标记 | 是 | 标记 GC Roots 直接关联对象（借助 Minor GC 完成） |
| 并发标记 | 否 | 遍历对象图，标记存活对象 |
| 最终标记 | 是 | 处理并发阶段遗留的 SATB（Snapshot-At-The-Beginning）记录 |
| 筛选回收 | 是 | 按回收收益排序 Region，将存活对象复制到空 Region |

上述 G1 阶段是简化组织，常规 Young GC、并发标记周期与后续 Mixed GC 不应被读作每轮都严格走完的一条固定流水线。[JDK 21 G1 说明](https://docs.oracle.com/en/java/javase/21/gctuning/garbage-first-g1-garbage-collector1.html)

### 3.5 收集器选型决策

| 场景 | 推荐收集器 | 关键参数 |
|------|-----------|----------|
| 单核 / 小堆（< 1GB） | Serial + Serial Old | `-XX:+UseSerialGC` |
| 多核 / 吞吐量优先 | Parallel Scavenge + Parallel Old | `-XX:+UseParallelGC`（JDK 8 默认） |
| 维护旧版本 CMS 服务 | 仅在仍支持 CMS 的历史 JDK 中讨论 | 升级前验证目标版本及替代方案 |
| 吞吐与停顿折中 | G1，按负载验证 | `-XX:+UseG1GC`（JDK 9+ 默认） |
| 低延迟目标 | 评估 ZGC / Shenandoah | 核对 JDK 版本、发行版支持及并发回收资源开销 |

## 四、JVM 调优实践

### 4.1 关键调优参数

| 参数 | 说明 | 建议 |
|------|------|------|
| `-Xms` / `-Xmx` | 堆初始/最大大小 | 设为相同值，避免运行时动态扩容 |
| `-Xmn` | 固定新生代大小 | 不套用固定比例；使用 G1 时通常保留自适应能力 |
| `-XX:MetaspaceSize` | Metaspace 初始高水位线 | 根据类加载量设定，避免启动时频繁 Full GC |
| `-XX:MaxMetaspaceSize` | Metaspace 上限 | 建议设定上限，防止内存泄漏耗尽系统内存 |
| `-XX:SurvivorRatio` | Eden 与 Survivor 的比例 | 默认 8:1:1，一般无需调整 |
| `-XX:MaxTenuringThreshold` | 部分分代收集器的晋升年龄上限 | 核对目标收集器的默认值和实际年龄分布 |
| `-XX:MaxGCPauseMillis` | G1 目标停顿时间 | 默认 200ms，根据业务 SLA 设定 |

### 4.2 常见问题与排查

| 问题 | 表现 | 排查方向 |
|------|------|----------|
| **频繁 Full GC** | 老年代频繁被填满 | 检查大对象分配、内存泄漏、Metaspace 增长 |
| **长时间 STW** | 应用周期性卡顿 | GC 日志分析、考虑切换为 G1/ZGC |
| **OOM: Java heap space** | 堆内存不足 | 堆转储分析（`jmap -dump`）、排查内存泄漏 |
| **OOM: Metaspace** | 类元数据空间耗尽 | 排查动态类生成（反射、CGLIB 代理）是否失控 |
| **OOM: GC overhead limit** | GC 耗时超过 98% 但回收不到 2% 内存 | 可能是活跃数据过多、堆过小或泄漏；按对应收集器的触发规则检查 |

### 4.3 监控工具

| 工具 | 用途 |
|------|------|
| `jstat -gc` | 实时查看 GC 统计（各代容量、GC 次数和耗时） |
| `jcmd <pid> GC.heap_info` | 查看目标进程堆信息；命令支持以 jcmd <pid> help 为准 |
| `jmap -dump` | 导出堆转储文件（配合 MAT / VisualVM 分析） |
| `jstack` | 导出线程快照（排查死锁、线程阻塞） |
| `jcmd <pid> VM.metaspace` | 在支持的版本中查看元空间，先核对 help |
| GC 日志 | `-Xlog:gc*`（JDK 9+）/ `-XX:+PrintGCDetails`（JDK 8） |

## 总结

JVM 的三大核心机制——类加载、内存管理、垃圾回收——构成了 Java 程序运行的底层基石：

1. **类加载策略**决定类型可见范围；类型身份还包含定义加载器，委派不是 JVM 的唯一安全边界
2. **从 PermGen 到 Metaspace 的演进**反映了 JVM 设计从"固定分配"到"弹性管理"的思路转变
3. **GC 收集器的选型**没有最优解，只有最匹配的方案——吞吐量优先选 Parallel，延迟目标严格时在目标 JDK 支持的收集器中实测，不能把历史 CMS 参数直接复制过去

> 理解 JVM 的意义不在于记住每个参数的默认值，而在于建立"代码行为 → JVM 行为 → 系统表现"的因果链，从而在生产问题出现时，能够从现象追溯到根因。
